/**
 * Objets du monde : structure d'exécution (miroir de la structure de 0x70 octets de `docs/swiv3d/objects.md` §3), pool de
 * 3 000 emplacements à allocation FIFO, grille de hachage 64×64 (cellules de 512 unités) et création des objets du bloc 105
 * (`gm_level_spawn_objects`, `0043e958`, §4).
 */
import type { Level, LevelObject } from "../data/level";
import type { Model } from "../data/model";
import { wrapQ8 } from "./fixed";
import type { Terrain } from "./terrain";

/** Taille du pool de l'exe (`005876d4`) ; les niveaux n'en utilisent que 581 à 827 au départ. */
export const POOL_SIZE = 3000;
/** Grille de hachage : 64 × 64 cellules ; cellule = `(x >> 17) & 63`, `(z >> 17) & 63` sur des positions Q8. */
export const GRID_SIZE = 64;

/** Bits de classe (`+0x04`, objects.md §3). */
export const CLASS = {
  ALIVE: 0x0001,
  /** Corps solide : participe aux poussées et aux dégâts de contact. */
  SOLID: 0x0002,
  /** Cible des ennemis (le joueur). */
  TARGET: 0x0004,
  /** Dangereux : inflige des dégâts même à un non-solide. */
  DANGEROUS: 0x0008,
  FLYING: 0x0010,
  /** Dépeuplable : mis à `DEPOP_MARK` puis appelé en cellule « moyenne » (mode 1). */
  DEPOP: 0x0020,
  /** Ignoré de toutes les collisions. */
  GHOST: 0x0040,
  PLAYER: 0x0200,
} as const;

/** Drapeaux (`+0x06`, octet bas et suivant ; objects.md §3). */
export const FLAG = {
  /** Texture non animée. */
  NO_ANIM: 0x01,
  /** Éclair de dégât (effacé à chaque image en cellule moyenne). */
  FLASH: 0x02,
  /** Invulnérable : aucun dégât de contact. */
  INVULNERABLE: 0x04,
  /** Pas de recul au contact. */
  NO_KNOCKBACK: 0x08,
  /** Gelé : ni déplacement ni fonction de comportement. */
  FROZEN: 0x20,
  /** Posé à la création. */
  NEW: 0x80,
  /** Posé par un contact. */
  HIT: 0x100,
} as const;

/** Valeur de `classe` pendant l'appel de dépeuplement (l'exe pose -1 sur le mot de 32 bits). */
export const DEPOP_MARK = 0xffff;

/**
 * Fonction de comportement d'un objet (`+0x68`). L'exe stocke un pointeur ; ici une clé résolue dans la table des
 * comportements du `World` à chaque appel, pour que la vague H1 puisse en brancher de nouveaux sans retoucher les objets.
 */
export type UpdateKey = string;

export class GameObject {
  /** Indice dans le pool (stable). */
  readonly slot: number;
  /** `+0x04` classe (0 = emplacement libre), 16 bits bas. */
  classe = 0;
  /** `+0x06` drapeaux (mot haut du dword de classe dans l'exe). */
  flags = 0;
  /** `+0x08` points de vie. */
  hp = 0;
  /** `+0x0c` vitesse/poussée propre au type (`REC[8]`). */
  param = 0;
  /** `+0x14` minuteur (10 à la création) : recharge d'arme et délais. */
  timer = 0;
  /** `+0x18` âge en ticks depuis la création (ou la dernière remise à 0 par le comportement). */
  age = 0;
  /** `+0x1c/0x20/0x24` position Q8 ; y vers le haut. */
  x = 0;
  y = 0;
  z = 0;
  /** `+0x28/0x2c/0x30` vitesse Q8 par tick. */
  vx = 0;
  vy = 0;
  vz = 0;
  /** `+0x34/0x38/0x3c` cap, tangage, roulis (512 pas par tour, non repliés pour le joueur). */
  yaw = 0;
  pitch = 0;
  roll = 0;
  /** `+0x40` nœud courant du bloc 107, -1 au départ. */
  node = -1;
  /** `+0x4c` modèle (`< 10000` : bloc `10000 + id` ; 0 ou ≥ 10000 : sprite ou rien). */
  model = 0;
  /** `+0x50` état de la machine à états / image du sprite / numéro de pièce. */
  state = 0;
  /** `+0x54` sous-type (`REC[7]` : code d'arme, bonus 1000+n, groupe 5000+g). */
  subtype = 0;
  /** `+0x58` cible ; = soi-même quand il n'y en a pas (puis racine du dernier agresseur après un contact). */
  target: GameObject = this;
  /** `+0x5c` propriétaire (racine) ; = soi-même à la création. */
  owner: GameObject = this;
  /** `+0x64` enregistrement du bloc 105 d'origine (null pour les clones créés en cours de jeu). */
  rec: LevelObject | null = null;
  /** `+0x68` clé de la fonction de comportement. */
  update: UpdateKey | null = null;
  /** Cellule de la grille (`((x >> 17) & 63) + ((z >> 11) & 0xfc0)`), -1 hors grille. */
  cell = -1;
  /** Dernier tick où l'objet a été mis à jour (évite un double traitement s'il change de cellule). */
  stamp = -1;

  constructor(slot: number) {
    this.slot = slot;
  }

  get alive(): boolean {
    return this.classe !== 0;
  }

  /** Remise à l'état « emplacement libre ». */
  reset(): void {
    this.classe = 0;
    this.flags = 0;
    this.hp = 0;
    this.param = 0;
    this.timer = 0;
    this.age = 0;
    this.x = this.y = this.z = 0;
    this.vx = this.vy = this.vz = 0;
    this.yaw = this.pitch = this.roll = 0;
    this.node = -1;
    this.model = 0;
    this.state = 0;
    this.subtype = 0;
    this.target = this;
    this.owner = this;
    this.rec = null;
    this.update = null;
    this.cell = -1;
    this.stamp = -1;
  }

  /** Type du bloc 105 d'origine (`REC[0]`), ou 0 pour un objet créé en cours de jeu. */
  get type(): number {
    return this.rec?.type ?? 0;
  }
}

/** Pool d'objets à allocation FIFO (liste libre `005876d4` / `00587700` : on libère en queue, on prend en tête). */
export class ObjectPool {
  readonly objects: GameObject[];
  private readonly free: number[];
  private freeHead = 0;

  constructor(size = POOL_SIZE) {
    this.objects = Array.from({ length: size }, (_, i) => new GameObject(i));
    this.free = Array.from({ length: size }, (_, i) => i);
  }

  /** Nombre d'objets vivants. */
  get liveCount(): number {
    return this.objects.length - (this.free.length - this.freeHead);
  }

  /** Prend un emplacement libre (réinitialisé), ou `null` si le pool est plein. */
  alloc(): GameObject | null {
    if (this.freeHead >= this.free.length) return null;
    const o = this.objects[this.free[this.freeHead++]!]!;
    o.reset();
    if (this.freeHead > 1024 && this.freeHead * 2 > this.free.length) {
      this.free.splice(0, this.freeHead);
      this.freeHead = 0;
    }
    return o;
  }

  release(o: GameObject): void {
    o.reset();
    this.free.push(o.slot);
  }
}

/** Index de cellule de grille d'une position Q8. */
export function cellOf(x: number, z: number): number {
  return (
    ((x >> 17) & (GRID_SIZE - 1)) + ((z >> 11) & (GRID_SIZE * (GRID_SIZE - 1)))
  );
}

/**
 * Grille de hachage 64×64. Chaque liste est un tableau dont la **tête** est la fin (l'exe insère en tête et parcourt de la
 * tête à la queue : on parcourt donc de la fin vers le début, ce qui reproduit l'inversion de l'ordre à chaque tick).
 */
export class Grid {
  readonly cells: GameObject[][] = Array.from(
    { length: GRID_SIZE * GRID_SIZE },
    () => [],
  );

  insert(o: GameObject): void {
    const c = cellOf(o.x, o.z);
    o.cell = c;
    this.cells[c]!.push(o);
  }

  remove(o: GameObject): void {
    if (o.cell < 0) return;
    const list = this.cells[o.cell]!;
    const i = list.lastIndexOf(o);
    if (i >= 0) list.splice(i, 1);
    o.cell = -1;
  }
}

/** Accès au rayon² de collision d'un modèle (`gm_type_radius2`, `0042a010` : 100 si type 0 ou ≥ 10 000 ou modèle absent). */
export type ModelTable = ReadonlyMap<number, Model>;

export function radius2(models: ModelTable, modelId: number): number {
  if (modelId === 0 || modelId >= 10000) return 100;
  return models.get(modelId)?.radiusSquared ?? 100;
}

/** Hauteur de pose d'un objet de niveau (mode 2 de `gm_object_init`) : `terrain(x, z) − modèle[+0x10] · 256`. */
export function groundY(
  terrain: Terrain,
  models: ModelTable,
  modelId: number,
  x: number,
  z: number,
): number {
  const m = modelId > 0 && modelId < 10000 ? models.get(modelId) : undefined;
  return terrain.height(x, z) - (m?.groundOffset ?? 0) * 256;
}

/** Clé de comportement statique `00446d24` (cibles destructibles, décors). */
export const UPDATE_STATIC = "static";
/** Comportement non porté (vague H1) : l'objet reste inerte. */
export const UPDATE_INERT = "inert";

interface SpawnDef {
  classe: number;
  update: UpdateKey;
  /** Enfant cloné du corps (tourelle, antenne, bonus) : classe, clé, modèle (`"child"` = `REC[5]`, sinon un modèle fixe). */
  children?: {
    classe: number;
    update: UpdateKey;
    model: "child" | number;
    count?: number;
  }[];
  /** Le 7000 crée deux objets indépendants : décor (`REC[4]`) et bonus (`REC[5]`, pv 1000). */
  separateChild?: boolean;
}

/**
 * Table de création par type (objects.md §4.4) : classe initiale et enfants. Les clés de comportement autres que
 * `static` sont des emplacements pour H1 (`UPDATE_INERT` tant qu'elles ne sont pas branchées) ; les noms reprennent les
 * adresses de l'exe (`upd_0044ac88`, etc.) pour que H1 sache quoi porter.
 */
const SPAWN: Record<number, SpawnDef> = {
  2000: { classe: 0x0001, update: UPDATE_STATIC },
  2001: { classe: 0x0841, update: UPDATE_STATIC },
  2002: { classe: 0x4081, update: UPDATE_STATIC },
  2003: { classe: 0x4001, update: UPDATE_STATIC },
  2004: {
    classe: 0x0001,
    update: UPDATE_STATIC,
    children: [{ classe: 0x40, update: "upd_0044de9c", model: "child" }],
  },
  3000: {
    classe: 0x4801,
    update: UPDATE_STATIC,
    children: [{ classe: 0x1001, update: "upd_0044ac88", model: "child" }],
  },
  3001: { classe: 0x1001, update: "upd_0044b848" },
  4001: { classe: 0x1001, update: "upd_0044e438" },
  4002: { classe: 0x1001, update: "upd_0044e758" },
  5000: {
    classe: 0x1003,
    update: "upd_0044bca8",
    children: [{ classe: 0x1003, update: "upd_0044d470", model: "child" }],
  },
  5002: {
    classe: 0x1003,
    update: "upd_0044bca8",
    children: [
      { classe: 0x40, update: "upd_004450c4", model: 984, count: 4 },
      { classe: 0x1003, update: "upd_0044d470", model: "child" },
    ],
  },
  5500: {
    classe: 0x1003,
    update: "upd_0044cf1c",
    children: [{ classe: 0x1003, update: "upd_0044d470", model: "child" }],
  },
  6000: { classe: 0x0001, update: "upd_0044d804" },
  6100: {
    classe: 0x0001,
    update: "upd_0044df98",
    children: [{ classe: 0x40, update: "upd_0044de9c", model: "child" }],
  },
  6101: {
    classe: 0x0001,
    update: "upd_0044e0f8",
    children: [{ classe: 0x40, update: "upd_0044de9c", model: "child" }],
  },
  6110: {
    classe: 0x0001,
    update: "upd_0044e2d8",
    children: [{ classe: 0x40, update: "upd_0044de9c", model: "child" }],
  },
  6300: { classe: 0x40, update: "upd_0045199c" },
  7000: { classe: 0x0841, update: UPDATE_STATIC, separateChild: true },
  7002: { classe: 0x0841, update: "upd_00446964" },
  7010: { classe: 0x0001, update: "upd_004482dc" },
  7011: {
    classe: 0x0001,
    update: "upd_004482dc",
    children: [{ classe: 0x40, update: "upd_0044822c", model: 990 }],
  },
};

/** Types de départ du joueur : 1000 (hélicoptère), 1001 (démo, forme 0x2a), 1002 (forme 0x2b). */
export function isPlayerStart(type: number): boolean {
  return type >= 1000 && type <= 1002;
}

export interface SpawnContext {
  terrain: Terrain;
  models: ModelTable;
  pool: ObjectPool;
  grid: Grid;
}

function place(
  o: GameObject,
  ctx: SpawnContext,
  modelId: number,
  x: number,
  z: number,
): void {
  o.x = wrapQ8(x);
  o.z = wrapQ8(z);
  o.y = groundY(ctx.terrain, ctx.models, modelId, o.x, o.z);
  o.timer = 10;
  o.node = -1;
  o.flags |= FLAG.NEW;
  o.model = modelId;
}

/**
 * Crée tous les objets d'un niveau hors départ du joueur (`gm_level_spawn_objects`, mode 2 : pied du modèle posé sur le
 * terrain). `x` et `z` sont repliés dans le tore (TERRAN03 dépasse 32 768). Les enfants (tourelle, antenne, roues) naissent
 * à la position et au cap de leur parent, `owner` = parent. Retourne les corps créés, dans l'ordre des enregistrements.
 */
export function spawnLevelObjects(
  level: Pick<Level, "objects">,
  ctx: SpawnContext,
): GameObject[] {
  const bodies: GameObject[] = [];
  for (const rec of level.objects) {
    if (isPlayerStart(rec.type)) continue;
    const def = SPAWN[rec.type];
    if (!def) continue;
    const x = rec.x * 256;
    const z = rec.z * 256;
    const body = ctx.pool.alloc();
    if (!body) throw new Error("pool d'objets plein");
    body.classe = def.classe;
    body.hp = rec.type === 6300 ? 100 : rec.hitPoints;
    body.subtype = rec.subtype;
    body.param = rec.thrust;
    body.yaw = rec.angle;
    body.rec = rec;
    body.update = def.update;
    place(body, ctx, rec.type === 6300 ? 0 : rec.model, x, z);
    ctx.grid.insert(body);
    bodies.push(body);

    if (def.separateChild) {
      // 7000 : le bonus est un objet indépendant (classe 0x41, pv 1000, modèle REC[5]), sans propriétaire.
      const bonus = ctx.pool.alloc();
      if (!bonus) throw new Error("pool d'objets plein");
      bonus.classe = 0x41;
      bonus.hp = 1000;
      bonus.subtype = rec.subtype;
      bonus.yaw = rec.angle;
      bonus.rec = rec;
      bonus.update = "upd_004469fc";
      place(bonus, ctx, rec.childModel, x, z);
      ctx.grid.insert(bonus);
      continue;
    }
    for (const c of def.children ?? []) {
      for (let k = 0; k < (c.count ?? 1); k++) {
        const child = ctx.pool.alloc();
        if (!child) throw new Error("pool d'objets plein");
        // Clone du parent (004261a0) : position, cap, pv hérités ; état et sous-type remis à 0, propriétaire = parent.
        child.classe = c.classe;
        child.hp = body.hp;
        child.x = body.x;
        child.y = body.y;
        child.z = body.z;
        child.yaw = body.yaw;
        child.model = c.model === "child" ? rec.childModel : c.model;
        child.timer = 10;
        child.flags |= FLAG.NEW;
        child.owner = body;
        child.rec = null;
        child.state = k;
        child.update = c.update;
        ctx.grid.insert(child);
      }
    }
  }
  return bodies;
}
