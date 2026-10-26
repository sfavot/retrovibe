/**
 * Monde -> `HudState` (`render/hud/state.ts`) : jauge, armes, score et messages viennent de `world.status`, le radar des objets vivants
 * (champ de classe `+0x04`) et des cibles d'objectif, le viseur de la cible du joueur projetée à l'écran.
 */
import type { GameObject } from "../engine/objects";
import type { World } from "../engine/world";
import { createProjection, projectPoint, setupProjection, type ProjectedPoint, type Projection } from "../render/camera";
import type { HudState, RadarBlip, RadarObjective } from "../render/hud/state";
import { wrapDelta, type RenderCamera } from "../render/view";

/** Q8 -> unités monde. */
const UNIT = 1 / 256;
/** Portée du radar : `gm_find_objects_near_pos(4, 0)` = ±4 cellules de la grille d'objets (cellule = 2^17 en Q8, grille 64 × 64). */
const RADAR_CELLS = 4;
const GRID_MASK = 63;

/** Image du viseur d'après la profondeur `D` : `clamp((D >> 6) - 11, 0, 15)` (`render.md` §9). */
export function crosshairFrame(depth: number): number {
  return Math.max(0, Math.min(15, (depth >> 6) - 11));
}

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

/** Un viseur (position à l'écran lissée, image tournante). */
interface Reticle {
  x: number;
  y: number;
  frame: number;
}

/** Position torique la plus proche de `value` autour de `around` (unités monde), pour la projection. */
const nearest = (value: number, around: number): number => around + wrapDelta(value - around);

export class HudStateBuilder {
  private readonly projection: Projection = createProjection();
  private readonly point: ProjectedPoint = { x: 0, y: 0, depth: 0 };
  private readonly blips: RadarBlip[] = [];
  /** Viseur jaune (extérieur, suit la cible) et rouge (intérieur : point visé), `null` sans cible. */
  private yellow: Reticle | null = null;
  private red: Reticle | null = null;

  /**
   * `camera` : caméra de la vue rendue cette image (le viseur se projette avec elle). `missionName` vide : non tracé.
   * `paused` : voir `HudState.paused`.
   */
  build(world: World, camera: RenderCamera, options: { missionName: string; language: "fr" | "en"; paused: boolean }): HudState {
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
   * Viseur (`gm_render_view` `0042b31c`, `00437c38`) : un viseur jaune sur la cible du joueur (`+0x58`) et un viseur rouge sur le point
   * visé (devant le joueur à la distance de la cible, à sa hauteur : seul le cap se règle à la main, le tangage est automatique,
   * `rules.md` § 3.3). Alignés = cible verrouillée. Position rejointe par `p += (cible - p) >> 1` à chaque image, image qui tourne d'un pas
   * par image vers `clamp((D >> 6) - 11, 0, 15)`. L'association des couleurs aux deux positions est une hypothèse (`rules.md` § 7.5).
   * Sans cible, seul le viseur jaune reste, au point visé à 1 000 unités.
   */
  private crosshair(world: World, camera: RenderCamera): HudState["crosshair"] {
    const player = world.player.obj;
    const target = player.target;
    const hasTarget = target !== player && target.classe !== 0;
    setupProjection(this.projection, camera);

    const yaw = (player.yaw * 2 * Math.PI) / 512;
    const px = player.x * UNIT;
    const pz = player.z * UNIT;
    let aim: { x: number; y: number; z: number };
    let yellowAt: { x: number; y: number; z: number };
    if (hasTarget) {
      const tx = nearest(target.x * UNIT, px);
      const tz = nearest(target.z * UNIT, pz);
      const ty = target.y * UNIT;
      const reach = Math.hypot(tx - px, tz - pz);
      yellowAt = { x: tx, y: ty, z: tz };
      aim = { x: px + Math.sin(yaw) * reach, y: ty, z: pz + Math.cos(yaw) * reach };
    } else {
      aim = { x: px + Math.sin(yaw) * 1000, y: player.y * UNIT, z: pz + Math.cos(yaw) * 1000 };
      yellowAt = aim;
    }
    this.yellow = this.follow(this.yellow, yellowAt);
    this.red = hasTarget ? this.follow(this.red, aim) : null;
    const yellow = this.yellow;
    if (!yellow) return undefined;
    return { x: yellow.x, y: yellow.y, yellowFrame: yellow.frame, redFrame: this.red?.frame ?? null };
  }

  /** Projette `at` (unités monde, replié autour de la caméra) et rapproche le viseur de moitié ; `null` : derrière la caméra. */
  private follow(current: Reticle | null, at: { x: number; y: number; z: number }): Reticle | null {
    const pr = this.projection;
    const p = projectPoint(pr, nearest(at.x, pr.camX), at.y, nearest(at.z, pr.camZ), this.point);
    if (p.depth <= 0) return null;
    const wanted = crosshairFrame(p.depth);
    if (!current) return { x: p.x, y: p.y, frame: wanted };
    current.x += (p.x - current.x) >> 1;
    current.y += (p.y - current.y) >> 1;
    current.frame += Math.sign(wanted - current.frame);
    return current;
  }
}
