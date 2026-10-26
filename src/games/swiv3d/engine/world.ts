/**
 * Monde pur et déterministe de SWIV 3D : charge un niveau et l'avance d'un tick de 25 ms (40 Hz) à partir des entrées du joueur.
 * Aucune dépendance au DOM, à `Date` ni à `Math.random`. Voir `docs/swiv3d/player.md` §2 et `objects.md` §2.
 *
 * Ordre d'un tick (`gm_game_tick`, `0043c234`) : mise à jour des objets (cellules actives autour du joueur : `pos += vel`,
 * fonction `+0x68`, repli dans le tore, âge ; collisions de la cellule ; dépeuplement des cellules moyennes), puis fonction pilote
 * du joueur (entrées), puis caméra.
 *
 * Écarts assumés : un seul joueur (pas de réseau ni d'écran partagé) ; pas de zones temporaires `0058770c` ; l'ordre de parcours
 * des cellules est celui de la table 11×11 (ligne par ligne) ; un objet déjà traité ce tick n'est pas retraité s'il change de
 * cellule (`stamp`) ; les collisions s'appliquent à la cellule traitée (l'exe réutilise l'indice de cellule du dernier objet).
 */
import type { Level, LevelObject } from "../data/level";
import { MAP_SIZE } from "../data/level";
import { parseBd } from "../data/bd";
import { listModels, parseModel, type Model } from "../data/model";
import { Camera } from "./camera";
import { collideCell } from "./collisions";
import type { WorldEvent } from "./events";
import { wrapQ8 } from "./fixed";
import type { PlayerInput } from "./input";
import {
  CLASS,
  DEPOP_MARK,
  FLAG,
  Grid,
  type GameObject,
  GRID_SIZE,
  ObjectPool,
  type ModelTable,
  UPDATE_INERT,
  UPDATE_STATIC,
  isPlayerStart,
  spawnLevelObjects,
} from "./objects";
import {
  FORM_DEMO,
  FORM_DYING,
  Player,
  UPDATE_PLAYER_HELI,
  UPDATE_PLAYER_INERT,
  UPDATE_PLAYER_VEHICLE,
  pilot,
  playerHeliUpdate,
  playerVehicleUpdate,
  setForm,
  type PlayerContext,
} from "./player";
import { Terrain } from "./terrain";

/** Fonction de comportement d'un objet (`+0x68`), appelée après `pos += vel`. H1 en enregistre via `registerBehavior`. */
export type Behavior = (world: World, o: GameObject) => void;

export interface WorldOptions {
  /** pv de départ du joueur (profil `+0x3c`) ; 496 au départ de la mission 0 (`rules.md` §6.1). */
  playerHitPoints?: number;
  /** Forme de départ (profil `+0x38`) ; défaut : 0 (hélicoptère), 0x2a pour un départ de type 1001, 0x2b pour 1002. */
  startForm?: number;
  /** Cadence (images/s) du lissage de caméra appelé par `tick` ; 0 = pas de lissage automatique (le rendu appelle `updateCamera`). Défaut 40. */
  cameraFps?: number;
  /** Mission à eau (drapeau `00577670 & 2`) : la carte 102 donne le type de sol des véhicules. */
  water?: boolean;
}

/** Table de mise à jour des cellules : mode 0 = proche, 1 = moyenne, 2 = ignorée (`00480c90`, 11 × 11, objects.md §2). */
const CELL_MODES: readonly number[] = [
  2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 0, 0, 0, 1, 1, 2, 2, 2, 1, 1, 0,
  0, 0, 0, 0, 1, 1, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
  1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 1, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 1, 1, 0,
  0, 0, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2,
];

/** Points d'une cible statique détruite (`0042ebc4`, objects.md §10.3). */
const STATIC_SCORE = 73;

/** Lit tous les modèles `10xxx` d'un fichier `.SLV` (clé = emplacement `id % 1000`, comme les champs `REC[4]`/`REC[5]`). */
export function loadModels(
  slvBytes: Uint8Array,
  name = "SLV",
): Map<number, Model> {
  const bd = parseBd(slvBytes, name);
  const models = new Map<number, Model>();
  for (const id of listModels(bd)) {
    const m = parseModel(bd.get(id), id);
    models.set(m.slot, m);
  }
  return models;
}

export class World {
  readonly level: Level;
  readonly models: ModelTable;
  readonly terrain: Terrain;
  readonly pool: ObjectPool;
  readonly grid: Grid;
  readonly player: Player;
  readonly camera = new Camera();
  /** Objets posés par le niveau (un par enregistrement du bloc 105 hors départ du joueur), dans l'ordre du bloc. */
  readonly levelObjects: readonly GameObject[];
  /** Ticks de logique exécutés (pause exclue). */
  tickCount = 0;
  /** Événements émis depuis le dernier `drainEvents`. */
  events: WorldEvent[] = [];
  readonly options: Required<Pick<WorldOptions, "cameraFps" | "water">>;
  private readonly behaviors = new Map<string, Behavior>();
  private readonly playerContext: PlayerContext;

  private constructor(level: Level, models: ModelTable, opts: WorldOptions) {
    this.level = level;
    this.models = models;
    this.terrain = Terrain.fromLevel(level);
    this.pool = new ObjectPool();
    this.grid = new Grid();
    this.options = {
      cameraFps: opts.cameraFps ?? 40,
      water: opts.water ?? false,
    };
    this.playerContext = {
      terrain: this.terrain,
      models,
      groundType: (x, z) => this.groundType(x, z),
      emit: (e) => this.events.push(e),
    };

    this.registerBehavior(UPDATE_INERT, () => {});
    this.registerBehavior(UPDATE_STATIC, staticTarget);
    this.registerBehavior(UPDATE_PLAYER_HELI, () =>
      playerHeliUpdate(this.player, this.playerContext),
    );
    this.registerBehavior(UPDATE_PLAYER_VEHICLE, () =>
      playerVehicleUpdate(this.player, this.playerContext),
    );
    this.registerBehavior(UPDATE_PLAYER_INERT, () => {});

    const ctx = {
      terrain: this.terrain,
      models,
      pool: this.pool,
      grid: this.grid,
    };
    // Joueur d'abord (créé par le type 1000/1001/1002), puis les objets du niveau.
    const start = level.objects.find((o) => isPlayerStart(o.type));
    if (!start)
      throw new Error(
        `${level.name} : pas de point de départ du joueur (types 1000-1002)`,
      );
    this.player = this.spawnPlayer(start, opts);
    this.levelObjects = spawnLevelObjects(level, ctx);

    this.camera.setGoal(this.player.obj, this.terrain);
    this.camera.snap();
  }

  /** Charge un niveau. `models` : modèles par emplacement (`loadModels`) ; un modèle absent a un rayon² de 100 et aucun décalage de pose. */
  static load(
    level: Level,
    models: ModelTable,
    options: WorldOptions = {},
  ): World {
    return new World(level, models, options);
  }

  private spawnPlayer(rec: LevelObject, opts: WorldOptions): Player {
    const o = this.pool.alloc();
    if (!o) throw new Error("pool d'objets plein");
    o.x = wrapQ8(rec.x * 256);
    o.z = wrapQ8(rec.z * 256);
    // mode 0 de gm_object_init : y = terrain(x, z) + 0x50 · 256 (80 unités au-dessus du sol)
    o.y = this.terrain.height(o.x, o.z) + 0x50 * 256;
    o.yaw = rec.angle;
    o.hp = opts.playerHitPoints ?? 496;
    o.timer = 10;
    o.flags |= FLAG.NEW;
    o.rec = rec;
    const p = new Player(o);
    this.grid.insert(o);
    setForm(
      p,
      opts.startForm ??
        (rec.type === 1001 ? FORM_DEMO : rec.type === 1002 ? FORM_DYING : 0),
    );
    this.events.length = 0; // le changement de forme initial n'est pas un événement de jeu
    return p;
  }

  /** Type de sol sous (x, z) Q8 (`00577664`) : carte 102 en mission à eau, sinon 0xff (sol normal). */
  groundType(x: number, z: number): number {
    if (!this.options.water) return 0xff;
    return this.level.groundMap[
      ((z >> 14) & (MAP_SIZE - 1)) * MAP_SIZE + ((x >> 14) & (MAP_SIZE - 1))
    ]!;
  }

  /** Enregistre (ou remplace) une fonction de comportement : c'est le point d'accroche de H1. */
  registerBehavior(key: string, fn: Behavior): void {
    this.behaviors.set(key, fn);
  }

  emit(e: WorldEvent): void {
    this.events.push(e);
  }

  /** Vide et retourne la file d'événements. */
  drainEvents(): WorldEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Change la forme du joueur (plate-forme de transformation, menu de bonus). */
  setPlayerForm(form: number): void {
    setForm(this.player, form, (e) => this.events.push(e));
  }

  /** Crée un objet du pool à l'état « neuf » (point d'entrée pour les projectiles et effets de H1). */
  spawn(
    init: Partial<
      Pick<
        GameObject,
        | "classe"
        | "hp"
        | "x"
        | "y"
        | "z"
        | "vx"
        | "vy"
        | "vz"
        | "yaw"
        | "model"
        | "update"
        | "subtype"
        | "param"
      >
    > & { owner?: GameObject },
  ): GameObject | null {
    const o = this.pool.alloc();
    if (!o) return null;
    Object.assign(o, init);
    o.timer = 10;
    o.flags |= FLAG.NEW;
    o.x = wrapQ8(o.x);
    o.z = wrapQ8(o.z);
    if (init.owner) o.owner = init.owner;
    this.grid.insert(o);
    return o;
  }

  /** Avance la simulation d'un tick de 25 ms. `input.pause` : tick sauté (la pause de l'exe est un menu bloquant). */
  tick(input: PlayerInput): void {
    if (input.pause) return;
    this.tickCount++;
    this.updateObjects();
    this.updatePlayer(input);
    this.camera.setGoal(this.player.obj, this.terrain);
    if (this.options.cameraFps > 0) this.camera.smooth(this.options.cameraFps);
  }

  /** Lissage de la caméra pour une image de rendu à `fps` images/s (si `cameraFps` est 0). */
  updateCamera(fps: number): void {
    this.camera.smooth(fps);
  }

  private updatePlayer(input: PlayerInput): void {
    const p = this.player;
    if (!p.dead && p.obj.hp <= 0) {
      // Mort : la séquence (forme 0x2b, explosions, caméra figée) est portée par H1/R3 ; ici le joueur devient un fantôme inerte.
      p.dead = true;
      p.obj.classe = CLASS.GHOST;
      this.events.push({ kind: "playerDied" });
    }
    pilot(p, input, (e) => this.events.push(e));
  }

  /** Cellules actives autour du joueur avec leur mode, dans l'ordre de découverte (`0042a084` §1). */
  private activeCells(): { cell: number; mode: number }[] {
    const o = this.player.obj;
    const cx = (o.x >> 17) - 5;
    const cz = (o.z >> 17) - 5;
    const out: { cell: number; mode: number }[] = [];
    for (let j = 0; j < 11; j++) {
      for (let i = 0; i < 11; i++) {
        const mode = CELL_MODES[j * 11 + i]!;
        if (mode === 2) continue;
        const cell =
          ((cz + j) & (GRID_SIZE - 1)) * GRID_SIZE +
          ((cx + i) & (GRID_SIZE - 1));
        if (this.grid.cells[cell]!.length > 0) out.push({ cell, mode });
      }
    }
    return out;
  }

  private updateObjects(): void {
    for (const { cell, mode } of this.activeCells()) {
      if (mode === 0) this.updateNearCell(cell);
      else this.updateMediumCell(cell);
    }
  }

  private updateNearCell(cell: number): void {
    const items = this.grid.cells[cell]!;
    this.grid.cells[cell] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const o = items[i]!;
      if (o.stamp !== this.tickCount) {
        o.stamp = this.tickCount;
        if (!(o.flags & FLAG.FROZEN)) {
          o.x += o.vx;
          o.y += o.vy;
          o.z += o.vz;
          if (o.update) this.behaviors.get(o.update)?.(this, o);
          o.x = wrapQ8(o.x);
          o.z = wrapQ8(o.z);
        }
        o.age++;
      }
      if (o.classe === 0) {
        o.cell = -1;
        this.pool.release(o);
      } else this.grid.insert(o);
    }
    collideCell(this.grid.cells[cell]!, this.models, {
      onDamage: (o, amount) => {
        if (o === this.player.obj)
          this.events.push({
            kind: "playerDamaged",
            amount,
            source: "contact",
          });
      },
    });
  }

  private updateMediumCell(cell: number): void {
    const items = this.grid.cells[cell]!;
    this.grid.cells[cell] = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const o = items[i]!;
      o.flags &= ~FLAG.FLASH;
      if (!(o.classe & CLASS.DEPOP)) {
        this.grid.insert(o);
        continue;
      }
      // Dépeuplement : classe = -1 pendant l'appel ; si elle l'est encore au retour, l'objet disparaît.
      o.classe = DEPOP_MARK;
      if (o.update) this.behaviors.get(o.update)?.(this, o);
      if (o.classe === DEPOP_MARK) {
        o.cell = -1;
        this.pool.release(o);
      } else this.grid.insert(o);
    }
  }

  /** Objets vivants (le joueur inclus), dans l'ordre des emplacements du pool. */
  *liveObjects(): IterableIterator<GameObject> {
    for (const o of this.pool.objects) if (o.classe !== 0) yield o;
  }

  /** Empreinte (FNV-1a 32 bits) de l'état de simulation : joueur, objets vivants, compteur de ticks. Sert aux tests de déterminisme. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      h ^= v | 0;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.tickCount);
    const p = this.player;
    mix(p.form);
    mix(p.accYaw);
    mix(p.accPitch);
    mix(p.accRoll);
    mix(p.thrust);
    for (const o of this.liveObjects()) {
      mix(o.slot);
      mix(o.classe);
      mix(o.flags);
      mix(o.hp);
      mix(o.x);
      mix(o.y);
      mix(o.z);
      mix(o.vx);
      mix(o.vy);
      mix(o.vz);
      mix(o.yaw);
      mix(o.pitch);
      mix(o.roll);
      mix(o.state);
      mix(o.age);
    }
    return h >>> 0;
  }
}

/** Cible statique `00446d24` (2000, 2002, 2003, base de 3000, décor de 7000) : gelée tant qu'intacte, fumée à la 1ʳᵉ blessure, détruite à pv ≤ 0. */
function staticTarget(world: World, o: GameObject): void {
  if (o.age === 0) o.state = o.hp;
  if (o.hp !== o.state && o.hp > 0) {
    o.state = o.hp;
    world.emit({ kind: "smoke", x: o.x, y: o.y, z: o.z });
  }
  if (o.hp <= 0) {
    o.classe = 0;
    world.emit({
      kind: "objectDestroyed",
      type: o.type,
      model: o.model,
      childModel: o.rec?.childModel ?? 0,
      subtype: o.subtype,
      x: o.x,
      y: o.y,
      z: o.z,
      yaw: o.yaw,
      score: STATIC_SCORE,
    });
  } else {
    o.flags |= FLAG.FROZEN;
  }
}

/** Séquence d'entrées sur `ticks` ticks : une fonction par tick ou un tableau (répété sur le dernier élément si plus court). */
export type InputScript = PlayerInput[] | ((tick: number) => PlayerInput);

/**
 * Charge un niveau et joue un script d'entrées ; retourne le monde. Aide pour les tests et les vagues suivantes.
 * `inputs` est un tableau (un élément par tick) ou une fonction du numéro de tick (à partir de 0) avec `ticks`.
 */
export function simulate(
  level: Level,
  models: ModelTable,
  inputs: InputScript,
  ticks = Array.isArray(inputs) ? inputs.length : 0,
  options: WorldOptions = {},
): World {
  const world = World.load(level, models, options);
  for (let t = 0; t < ticks; t++)
    world.tick(typeof inputs === "function" ? inputs(t) : inputs[t]!);
  return world;
}
