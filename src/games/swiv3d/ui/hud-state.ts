/**
 * Monde -> `HudState` (`render/hud/state.ts`) : jauge, armes, score et messages viennent de `world.status`, le radar des objets vivants
 * (champ de classe `+0x04`) et des cibles d'objectif, les viseurs de la cible du joueur et de l'objectif en tête projetés à l'écran.
 */
import type { GameObject } from "../engine/objects";
import type { World } from "../engine/world";
import { createProjection, projectPoint, setupProjection, type ProjectedPoint, type Projection } from "../render/camera";
import type { HudState, RadarBlip, RadarObjective, Reticle } from "../render/hud/state";
import { VIEWPORT, wrapDelta, type RenderCamera } from "../render/view";

/** Q8 -> unités monde. */
const UNIT = 1 / 256;
/** Portée du radar : `gm_find_objects_near_pos(4, 0)` = ±4 cellules de la grille d'objets (cellule = 2^17 en Q8, grille 64 × 64). */
const RADAR_CELLS = 4;
const GRID_MASK = 63;

/** Image du viseur d'après la profondeur `D` de vue (sans le recul de 0x19) : `clamp((D >> 6) - 11, 0, 15)` (`render.md` §9). */
export function crosshairFrame(depth: number): number {
  return Math.max(0, Math.min(15, (depth >> 6) - 11));
}

/** Recul de la perspective ajouté à la profondeur projetée (`D + 0x19`). */
const DEPTH_BIAS = 0x19;
/** Un objet n'a de viseur que si `-10 < D < 2000` et s'il tombe à moins de cette marge du cadre (`00427ec8`, `00427f7e`). */
const RETICLE_DEPTH_MIN = -10;
const RETICLE_DEPTH_MAX = 2000;
const RETICLE_MARGIN_X = 0x14;
const RETICLE_MARGIN_Y = 0x1e;

/** Cellule de la grille d'objets (Q8) et distance torique entre deux cellules. */
const cellOf = (q8: number): number => (q8 >> 17) & GRID_MASK;
const cellDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, GRID_MASK + 1 - d);
};

/** Un objet est-il un point du radar ? Hors joueur, vivant, à ±4 cellules du joueur. */
export function isRadarBlip(o: Pick<GameObject, "classe" | "x" | "z">, player: Pick<GameObject, "x" | "z">): boolean {
  return o.classe !== 0 && cellDistance(cellOf(o.x), cellOf(player.x)) <= RADAR_CELLS && cellDistance(cellOf(o.z), cellOf(player.z)) <= RADAR_CELLS;
}

/** Position torique la plus proche de `value` autour de `around` (unités monde), pour la projection. */
const nearest = (value: number, around: number): number => around + wrapDelta(value - around);

export class HudStateBuilder {
  private readonly projection: Projection = createProjection();
  private readonly point: ProjectedPoint = { x: 0, y: 0, depth: 0 };
  private readonly blips: RadarBlip[] = [];
  /** Viseur jaune (cible du joueur) et rouge (objectif en tête de liste) : l'état de lissage de chacun, `null` tant qu'il n'est pas à l'écran. */
  private yellow: Reticle | null = null;
  private red: Reticle | null = null;

  /**
   * `camera` : caméra de la vue rendue cette image (le viseur se projette avec elle). `missionName` vide : non tracé.
   * `paused`, `inMenu` : voir `HudState`.
   */
  build(world: World, camera: RenderCamera, options: { missionName: string; language: "fr" | "en"; paused: boolean; inMenu?: boolean }): HudState {
    const s = world.status;
    const player = world.player.obj;
    return {
      energy: s.energy,
      maxEnergy: s.maxEnergy,
      shield: s.shield,
      score: s.score,
      cannonPower: s.cannonPower,
      special: s.special,
      specialAmmo: s.specialAmmo,
      specialArmed: s.specialArmed,
      missionName: options.missionName,
      language: options.language,
      messages: s.messages,
      tick: world.tickCount,
      paused: options.paused,
      inMenu: options.inMenu ?? false,
      radar: {
        playerX: player.x * UNIT,
        playerZ: player.z * UNIT,
        playerYaw: player.yaw,
        blips: this.radarBlips(world),
        objectives: this.radarObjectives(world),
      },
      crosshair: this.crosshair(world, camera),
    };
  }

  /** Points du radar : tous les objets proches, avec leur classe `+0x04` (le HUD choisit la couleur selon son masque `0x787f`). */
  private radarBlips(world: World): RadarBlip[] {
    const blips = this.blips;
    blips.length = 0;
    const player = world.player.obj;
    for (const o of world.liveObjects()) {
      if (o === player || !isRadarBlip(o, player)) continue;
      blips.push({ x: o.x * UNIT, z: o.z * UNIT, kind: o.classe });
    }
    return blips;
  }

  /** Cibles d'objectif (liste triée par groupe décroissant) : celles du groupe de tête sont « courantes » (croix rouge, pointeur). */
  private radarObjectives(world: World): RadarObjective[] {
    const list = world.game.objectives;
    const head = list[0]?.group;
    return list.map((e) => ({ x: e.obj.x * UNIT, z: e.obj.z * UNIT, current: e.group === head }));
  }

  /**
   * Viseurs (`gm_render_terrain` `0042718c` pose leur cible, `gm_render_view` `0042b31c` les lisse et les trace) : le jaune (images 0 à
   * 15 du bloc 506) suit la cible du joueur (`+0x58`, choisie par `00438198`) ; le rouge (images 16 à 31) suit l'objet de tête de la
   * liste des objectifs, mais seulement tant que le joueur a une cible. Alignés, c'est que la cible est l'objectif. Aucun viseur sans
   * cible. Chacun garde sa position à l'écran : elle rejoint la nouvelle par `p += (cible - p) >> 1` à chaque image, et l'image tourne
   * d'un pas par image vers `clamp((D >> 6) - 11, 0, 15)`. Un viseur qui sort de l'écran perd son état.
   */
  private crosshair(world: World, camera: RenderCamera): HudState["crosshair"] {
    const player = world.player.obj;
    const target = player.target;
    const hasTarget = target !== player && target.classe !== 0;
    setupProjection(this.projection, camera);

    this.yellow = hasTarget ? this.follow(this.yellow, target) : null;
    const head = world.game.objectives[0]?.obj;
    this.red = hasTarget && head ? this.follow(this.red, head) : null;
    if (!this.yellow && !this.red) return undefined;
    return { yellow: this.yellow && { ...this.yellow }, red: this.red && { ...this.red } };
  }

  /** Projette l'origine de `o` (replié autour de la caméra) et rapproche le viseur de moitié ; `null` : hors de la plage du jeu. */
  private follow(current: Reticle | null, o: Pick<GameObject, "x" | "y" | "z">): Reticle | null {
    const pr = this.projection;
    const p = projectPoint(pr, nearest(o.x * UNIT, pr.camX), o.y * UNIT, nearest(o.z * UNIT, pr.camZ), this.point);
    const depth = p.depth - DEPTH_BIAS;
    if (depth <= RETICLE_DEPTH_MIN || depth >= RETICLE_DEPTH_MAX) return null;
    const width = VIEWPORT.right - VIEWPORT.left;
    const height = VIEWPORT.bottom - VIEWPORT.clipTop;
    if (Math.abs(p.x - pr.cx) >= width + RETICLE_MARGIN_X || Math.abs(pr.cy - p.y) >= height + RETICLE_MARGIN_Y) return null;
    const wanted = crosshairFrame(depth);
    if (!current) return { x: p.x, y: p.y, frame: wanted };
    current.x += (p.x - current.x) >> 1;
    current.y += (p.y - current.y) >> 1;
    current.frame += Math.sign(wanted - current.frame);
    return current;
  }
}
