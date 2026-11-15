/**
 * Descripteurs de types de pièces (table 0x4733a0 de TIMWIN.EXE, 281 entrées, descripteurs de 0x70 octets,
 * `docs/tim3/engine.md` § 2). Plusieurs types partagent un descripteur (décors 110…280) : on garde ce partage, car le
 * chargement des PAR écrit dans le descripteur partagé et le dernier PAR lu l'emporte, comme dans l'exe.
 *
 * Construction (ce que fait 432da8 au démarrage du jeu) :
 * 1. image statique de l'exe (`data/tables/descriptors.ts`, D13) ;
 * 2. 433b13(t) pour t = 0 … 0x118 : `PART%d.ANM` puis `PART%d.PAR` (433b54) ;
 * 3. slot 7 de chaque type avec l'argument 0 (initialisation de type, ex. 43c500).
 * Puis, à chaque niveau, 434141 (accélération et vitesse terminale selon la gravité et la pression).
 */
import type { Anm } from "../data/anm";
import type { PartDef } from "../data/part-def";
import { DESCRIPTOR_WORDS, TYPE_DESCRIPTOR_VA } from "../data/tables/descriptors";
import { Polygon } from "./part";

export const TYPE_COUNT = 0x119;

/** Rectangle d'une image d'ANM, tel que 44b314 le rend : décalage et taille. */
export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Animation d'un type en mémoire (objet de 44b828) : seule la géométrie des images sert à la physique. */
export class TypeAnim {
  constructor(readonly anm: Anm) {}

  /** Nombre d'images adressables (+0x0C) : longueur de la séquence, ou nombre d'images sans séquence. */
  get count(): number {
    return this.anm.sequence.length || this.anm.frames.length;
  }

  /** 44b314(anim, i) : rectangle de l'image i, ou `null` (l'exe rend 0 et ne touche pas au tampon) si i est hors limites. */
  frame(i: number): FrameRect | null {
    if (i >>> 0 >= this.count) return null;
    const f = this.anm.frames[this.anm.sequence.length ? this.anm.sequence[i]! : i]!;
    return { x: f.x, y: f.y, w: f.width, h: f.height };
  }

  /**
   * 44b2c0(anim, n) : image où commence l'état n (premier état si n est absent : celui de l'entrée terminale, ou 0) ;
   * n = −1 : nombre d'images.
   */
  stateFirst(n: number): number {
    if (n === -1) return this.count;
    for (const s of this.anm.states) if (s.state === 0 || s.state === n) return s.first;
    return 0;
  }

  /** 44b19c(anim, i) : état qui commence à l'image i, 0 s'il n'y en a pas, −1 si i est hors limites ou sans états. */
  stateAt(i: number): number {
    if (i >>> 0 >= this.count || this.anm.states.length === 0) return -1;
    for (const s of this.anm.states) {
      if (s.state === 0) return 0;
      if (s.first === i) return s.state;
    }
    return 0;
  }
}

export class TypeDescriptor {
  /** +0x00 … +0x1C : adresses des 8 handlers (0 = aucun). Le registre `parts/registry.ts` les résout. */
  readonly handlers: number[];
  /** +0x20 catégorie, +0x24 sommets par polygone, +0x28 / +0x2C / +0x30 drapeaux initiaux des pièces (+0x0C, +0x10, +0x14). */
  f20: number;
  vertexCount: number;
  flags0C: number;
  flags10: number;
  flags14: number;
  /** +0x34 / +0x38 : boîte de collision fixe (0 = celle de la forme). */
  boxW: number;
  boxH: number;
  /** +0x3C … +0x48 : tailles d'édition (PAR). */
  f3C: number;
  f40: number;
  f44: number;
  f48: number;
  /** +0x4C densité, +0x50 masse, +0x54 élasticité, +0x58 frottement. */
  density: number;
  mass: number;
  elasticity: number;
  friction: number;
  /** +0x5C accélération verticale, +0x60 vitesse terminale (434141). */
  accel: number;
  terminal: number;
  /** +0x64 / +0x68 : taille de la forme. */
  shapeW: number;
  shapeH: number;
  /** +0x6C : polygones (originaux, puis copies en miroir), ou `null`. */
  polygons: Polygon[] | null = null;

  constructor(readonly va: number, words: readonly number[]) {
    this.handlers = words.slice(0, 8);
    const w = (offset: number) => words[offset / 4]! | 0;
    this.f20 = w(0x20);
    this.vertexCount = w(0x24);
    this.flags0C = w(0x28);
    this.flags10 = w(0x2c);
    this.flags14 = w(0x30);
    this.boxW = w(0x34);
    this.boxH = w(0x38);
    this.f3C = w(0x3c);
    this.f40 = w(0x40);
    this.f44 = w(0x44);
    this.f48 = w(0x48);
    this.density = w(0x4c);
    this.mass = w(0x50);
    this.elasticity = w(0x54);
    this.friction = w(0x58);
    this.accel = w(0x5c);
    this.terminal = w(0x60);
    this.shapeW = w(0x64);
    this.shapeH = w(0x68);
    if (w(0x6c) !== 0) throw new Error("TIM3 : descripteur statique avec polygones");
  }
}

/** Types dont 433b54 prend la taille de la forme dans l'ANM avant chaque miroir X (pentes : 2, 99 … 102, 126). */
const SLOPE_TYPES = new Set([2, 99, 100, 101, 102, 126]);

export class TypeTable {
  /** Descripteur de chaque type (références partagées comme dans la table de l'exe). */
  readonly byType: TypeDescriptor[];
  /** 0x480b48 : animation de chaque type (`null` sans ANM). */
  readonly anims: (TypeAnim | null)[];

  constructor(load: { anm(type: number): Anm | null; par(type: number): PartDef | null }) {
    const byVa = new Map<number, TypeDescriptor>();
    for (const [va, words] of DESCRIPTOR_WORDS) byVa.set(va, new TypeDescriptor(va, words));
    this.byType = Array.from(TYPE_DESCRIPTOR_VA, (va) => byVa.get(va)!);
    this.anims = new Array<TypeAnim | null>(TYPE_COUNT).fill(null);
    for (let t = 0; t < TYPE_COUNT; t++) {
      const anm = load.anm(t);
      this.anims[t] = anm ? new TypeAnim(anm) : null;
      const par = load.par(t);
      if (par && par.id === t) this.loadPar(t, par);
    }
    // Slot 7 avec l'argument 0 : deux initialisations touchent aux descripteurs (contrôlé contre le banc pour les 281 types).
    for (let t = 0; t < TYPE_COUNT; t++) {
      const init = this.byType[t]!.handlers[7];
      if (init === 0x43c500) shareShape(this, 2, [99, 100, 101, 102, 126]);
      else if (init === 0x43c65c) shareShape(this, 91, [92, 93]);
    }
  }

  get(type: number): TypeDescriptor {
    const d = this.byType[type];
    if (!d) throw new Error(`TIM3 : type de pièce inconnu ${type}`);
    return d;
  }

  /** 433b54 : propriétés et polygones de `PART%d.PAR`. */
  private loadPar(t: number, par: PartDef): void {
    const d = this.byType[t]!;
    d.density = par.density;
    d.mass = par.mass;
    d.elasticity = par.elasticity;
    d.friction = par.flags;
    d.terminal = par.unknown04;
    d.f44 = par.unknown05;
    d.f48 = par.unknown06;
    d.f3C = par.unknown07;
    d.f40 = par.unknown08;
    d.shapeW = par.width;
    d.shapeH = par.height;
    if (d.mass === 0) d.mass = 1000;
    const shape = par.shapeFlags;
    const total = par.polygons.reduce((n, p) => n + p.vertices.length, 0);
    if (total === 0) return;
    const n = par.polygons.length;
    d.vertexCount = (total / n) | 0;
    const originals = par.polygons.map((p) => Polygon.from(p.vertices.map((v) => [v.x, v.y] as const)));
    const polys = [...originals];
    if (shape & 0x8) {
      originals.forEach((p, i) => {
        if (SLOPE_TYPES.has(t)) {
          const f = this.anims[t]?.frame(i);
          if (f) {
            d.shapeW = f.w;
            d.shapeH = f.h;
          }
        }
        polys.push(mirror(d, p, 2));
      });
    }
    if (shape & 0x10) for (const p of originals) polys.push(mirror(d, p, 1));
    if ((shape & 0x18) === 0x18) for (const p of originals) polys.push(mirror(d, p, 3));
    d.polygons = polys;
  }
}

/**
 * 434019 : copie en miroir d'un polygone. Mode 2 : x' = largeur − x − 1 ; mode 1 : y' = hauteur − y − 1 ; mode 3 : les
 * deux. Les modes 1 et 2 écrivent les sommets à l'envers (sens de parcours conservé).
 */
function mirror(d: TypeDescriptor, src: Polygon, mode: 1 | 2 | 3): Polygon {
  const n = d.vertexCount;
  const out = new Polygon(n);
  for (let k = 0; k < n; k++) {
    const o = mode === 3 ? k : n - 1 - k;
    out.x[o] = mode & 2 ? (d.shapeW - src.x[k]! - 1) | 0 : src.x[k]!;
    out.y[o] = mode & 1 ? (d.shapeH - src.y[k]! - 1) | 0 : src.y[k]!;
  }
  return out;
}

/**
 * Initialisations de type qui partagent des polygones : 43c500(0) donne aux pentes 99 … 102 et 126 ceux de la pente 2,
 * 43c65c(0) donne aux lasers vert et bleu (92, 93) ceux du laser rouge (91), avec leur nombre de sommets.
 */
function shareShape(table: TypeTable, from: number, to: readonly number[]): void {
  const src = table.get(from);
  for (const t of to) {
    const d = table.get(t);
    d.polygons = src.polygons;
    d.vertexCount = src.vertexCount;
  }
}
