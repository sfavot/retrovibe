/**
 * Éditeur de machines, sans navigateur : ce que fait l'écran de construction de TIMWIN.EXE (zone 0x42a000 – 0x449000).
 *
 * Fonctions traduites (le binaire fait foi) :
 * - 42e660 : action sous le pointeur selon la zone (43840d) d'une pièce posée ; 43806a : zones offertes par une pièce ;
 *   42e1e4 : poignées dessinées autour d'elle (`HANDLES.ANM`, états de la table 0x473310).
 * - 42f891 : saisir une pièce posée (elle passe au bac, 4395ba, en gardant l'écart du pointeur, 0x481588 / 0x48158c).
 * - 42ebba, 42f24a : pièce tenue au-dessus de l'aire : position calée sur la grille (16 px décalés de 8, ou 8 px pour les
 *   engrenages, la bascule et 0x8b ; libre avec le bit 0x08 de +0x14), au moins 4 px visibles ; **posée seulement si elle ne
 *   chevauche rien** (437208) ; hors de l'aire, un appui la renvoie au bac (42f978).
 * - 42f63c : touches pendant qu'on tient une pièce : X / Y (retourner, si +0x0C & 0x400 / 0x200), + ou = / − (taille, pas de
 *   16, entre les bornes du type +0x44…+0x48 et +0x3C…+0x40).
 * - 42fa77, 42faad, 42fae3 : retourner (slot 3 : 1 = X, 2 = Y, 15 = quart de tour jusqu'à une position libre).
 * - 42fc4c, 42fd94, 42fea3, 43001d : étirer par un bord (pas de 16, recul jusqu'à ne plus rien chevaucher).
 * - 42ee68 (corde, câble), 42ed3f (courroie) : liens en deux appuis (437f0d : pièce qui accepte une corde, +0x10 & 4, et
 *   point d'accroche le plus proche si +0x10 & 8 ; 438985 / 438932 : courroie entre deux pièces +0x10 & 1, à moins de 140 px).
 * - 438ea8 : une pièce à fiche (+0x14 & 1) posée se branche seule sur une prise libre (+0x14 & 2) à moins de 8 px.
 * - Mode à deux joueurs (mode 2) : une règle du tour (`EditGuard`, `duel.ts`) limite le bac (417190, 41715f, 418207) et les pièces
 *   de l'aire qu'on peut toucher (43013e, 4301cb) ; au bout du temps, la pièce tenue est posée ou rendue (4301f5, `dropHeld`).
 * - Labo (modes 1 et 6) : cadenas d'une pièce (43806a bits 0x10 / 0x400, poignée de 42e1e4, 42e9d8 : +0x14 ^= 0x40, la
 *   télécommande et ses explosifs ensemble), poignée « solution » des pièces +0x14 & 0x8000 (bit 0x200, 42ea99 → `SOLVE.ITF`),
 *   « Verrouiller / Déverrouiller » toutes les pièces (4209e5, 420afc), décors posés et repris (bac à onglets, `bin-tabs.ts`).
 *
 * Le noyau (`World`) garde privées les opérations de bac de l'exe (42f978, 4395ba, 43909c, 4390ff, 438fe3) : l'éditeur
 * les atteint par `core()` (API manquante signalée, voir `docs/tim3/plan.md`, vague U).
 */
import { labTabTypes } from "./bin-tabs";
import type { EditGuard } from "./duel";
import { insertSorted } from "./lists";
import { updateGeometry } from "./move";
import { BeltData, F0C, Part, Polygon, RopeData } from "./part";
import { centerInside } from "./parts/creatures/overlap";
import { findNeighbours, overlapsAnother } from "./parts/creatures/kernel";
import type { World } from "./world";
import { newPart } from "./zone";
import { PROGRAM_TYPES, PartProgram, type ProgramRow } from "./program";

/** Taille de l'aire de jeu (fenêtre de 0x480fc8, +0x18 / +0x1C). */
export const FIELD_WIDTH = 568;
export const FIELD_HEIGHT = 378;
/** Côté d'une poignée et de sa zone (0x24). */
export const HANDLE_SIZE = 36;

/** Zones d'une pièce posée (valeur rendue par 43840d). */
export const Zone = {
  None: 0xa,
  FlipX: 1,
  FlipY: 2,
  WidthLeft: 3,
  WidthRight: 4,
  HeightTop: 5,
  HeightBottom: 6,
  Body: 7,
  Remove: 8,
  Info: 0xc,
  Program: 0xd,
  /** Cadenas (Labo) : 0x0B de 43840d, 42e9d8. */
  Lock: 0xb,
  /** Solution (Labo) : 0x0E de 43840d, 42ea99 → 426d1c (`SOLVE.ITF`). */
  Solution: 0xe,
  Turn: 0xf,
} as const;
export type ZoneId = (typeof Zone)[keyof typeof Zone];

/** Bits de 43806a (zones offertes). */
const Z = {
  WIDTH: 0x1,
  HEIGHT: 0x2,
  FLIP_X: 0x4,
  FLIP_Y: 0x8,
  LOCK: 0x10,
  INFO: 0x20,
  REMOVE: 0x40,
  PROGRAM: 0x80,
  BODY: 0x100,
  SOLUTION: 0x200,
  UNLOCK: 0x400,
  PROGRAM_LOW: 0x800,
} as const;

/** +0x14 : décor (scenery), pièce verrouillée, pièce qui peut entrer dans la solution d'un puzzle maison (43806a). */
const SCENERY = 0x1000;
const LOCKED = 0x40;
const IN_SOLUTION = 0x8000;

/** Poignée dessinée par 42e1e4 : rectangle 36 × 36 et état de `HANDLES.ANM` (table 0x473310). */
export interface Handle {
  zone: ZoneId;
  x: number;
  y: number;
  /** État de `HANDLES.ANM` dont la première image est dessinée. */
  state: number;
}

/** États de `HANDLES.ANM` par poignée (0x473310, index = valeur de 0x48101c). */
export const HANDLE_STATES = [25, 24, 23, 22, 20, 14, 13, 2, 16, 18, 21, 26, 27] as const;

/** Résultat d'un appui de l'éditeur sur l'aire. */
export type EditResult =
  | "placed"
  | "refused"
  | "linked"
  | "linking"
  | "unlinked"
  | "returned"
  | "none";

/** Ce que l'éditeur montre pendant qu'on tient une pièce. */
export interface HeldPreview {
  /** Position permise (pas de chevauchement, lien possible). */
  valid: boolean;
  /** Ligne élastique d'une corde ou d'une courroie en cours de lien (coordonnées de l'aire). */
  line?: { x1: number; y1: number; x2: number; y2: number };
}

/** Opérations privées de `World` utilisées par l'éditeur (mêmes fonctions de l'exe). */
interface CoreEdit {
  remove(x: Part): void;
  toBin(x: Part): void;
  detachBelt(b: Part): void;
  detachRopes(r: Part, both: boolean): void;
  unplug(x: Part): void;
}

function core(world: World): CoreEdit {
  return world as unknown as CoreEdit;
}

const isRope = (p: Part): boolean => p.type === 10 || p.type === 76;
const isBelt = (p: Part): boolean => p.type === 8;
/** Types calés sur une grille de 8 px (42f366) : engrenages, roulotte boulotte, 0x8b. */
const GRID8 = new Set([0x56, 0x0e, 3, 0x8b]);
/** Types posés 3 px sous la grille au lieu de 8 (42f270). */
const LOW_Y = new Set([0x39, 0x62, 0x61, 0x58]);
/** Pentes : + et − changent toujours la largeur (42f63c). */
const SLOPES = new Set([2, 99, 100, 101, 102, 126]);
/** Types dont la taille vient de la pièce (`move.ts`, 439bd7) : la création d'une pièce du Labo leur donne une taille. */
const SIZED = new Set([1, 2, 5, 11, 13, 21, 25, 46, 48, 56, 60, 82, 83, 84, 85, 97, 99, 100, 101, 102, 118, 121, 122, 123, 124, 125, 126, 127]);

/** Point de l'aire testé contre un polygone (4374e9 avec une pièce nulle : le point du pointeur). */
function pointInside(part: Part, x: number, y: number): boolean {
  const probe = new Part();
  probe.poly = new Polygon(1);
  probe.vertexCount = 1;
  probe.px = x;
  probe.py = y;
  return centerInside(probe, part);
}

export interface EditorOptions {
  /** Labo : pièces en nombre illimité (palette), cadenas et poignée « solution », décors déplaçables. */
  lab?: boolean;
  /** Mode à deux joueurs : règle du tour consultée avant de prendre ou de toucher une pièce. */
  guard?: EditGuard;
}

/** 4301f5 : pièces qui retournent au bac quand le temps du tour finit pendant qu'on les tient (corde, câble, courroie, télécommande, explosifs). */
const RETURNED_AT_TIMEOUT = new Set([10, 0x4c, 8, 0x16, 0x37]);

export class Editor {
  /** 0x481194 en mode 9 : pièce tenue (elle est dans la liste du bac pendant ce temps, comme dans l'exe). */
  held: Part | null = null;
  /** 0x481588 / 0x48158c : écart entre le pointeur et le coin de la pièce tenue. */
  grabX = 0;
  grabY = 0;
  /** 0x480904 : dernier maillon d'une corde en cours de pose (pièce ou poulie). */
  ropeLast: Part | null = null;
  /** Dernière position du pointeur sur l'aire (aperçus). */
  private pointer = { x: 0, y: 0 };
  readonly lab: boolean;
  /** Règle du tour (mode à deux joueurs), `null` sinon. */
  readonly guard: EditGuard | null;

  constructor(
    readonly world: World,
    options: EditorOptions = {},
  ) {
    this.lab = options.lab ?? false;
    this.guard = options.guard ?? null;
    // Pièces du bac après 43267a (`World.stowUnlocked`) : deux écarts du noyau corrigés ici (signalés, `docs/tim3/ui.md`).
    // - Boîte du type nulle (+0x34 = 0 : panier 11, diable 13, prise 21, lampe 25) pour une pièce dont la taille vient de la
    //   boîte : on prend la forme du PAR (+0x64), la taille qu'écrivent les LEV pour ces pièces.
    // - Slot 4 traduit ici en repli (pentes, murs) : image et forme recalculées (pente de 32 px : image 1).
    for (const p of world.bin) {
      const resized = SIZED.has(p.type) && (p.boxW <= 0 || p.boxH <= 0);
      if (resized) Object.assign(p, defaultBox(world, p.type));
      if (resized || this.slot4Fallback(p)) this.applySize(p);
    }
  }

  // ------------------------------------------------------------------ requêtes

  /** Pièces du bac à montrer (la pièce tenue exclue), dans l'ordre de la liste (417133). */
  binParts(): Part[] {
    return this.world.bin.toArray().filter((p) => p !== this.held);
  }

  /**
   * Types de la palette du Labo pour l'onglet `tab` du bac (417264 en modes 1 et 6, `bin-tabs.ts`) : tout l'ordre du bac
   * (0x47201c, types 0 à 280, décors compris), filtré par l'onglet. `date` : pièces des fêtes (43b06c).
   */
  static labTypes(world: World, tab = 0, date: Date | null = null): number[] {
    return labTabTypes(world.types, tab, { date }).filter((t) => world.types.anims[t]);
  }

  /**
   * Remplit le bac du Labo avec la palette de l'onglet : une pièce de chaque type (renouvelée quand on la prend) ; les pièces
   * des autres onglets quittent le bac (417264 refait la liste à chaque changement d'onglet).
   */
  stockLab(types: readonly number[]): void {
    if (!this.lab) return;
    const wanted = new Set(types);
    for (const p of this.world.bin.toArray()) if (p !== this.held && !wanted.has(p.type)) this.world.bin.remove(p);
    const present = new Set(this.binParts().map((p) => p.type));
    for (const t of types) if (!present.has(t)) createPart(this.world, t);
  }

  /**
   * 437cc9 (simplifié) : pièce posée sous le point (x, y) de l'aire. Rectangle de la pièce (438319 : position et forme),
   * filtre 1 = accepte une corde (+0x10 & 4), 2 = accepte une courroie (+0x10 & 1) ; les décors (+0x14 & 0x1000) ne se
   * prennent qu'au Labo, où on les pose. Entre plusieurs candidates : celle dont le polygone contient le point, puis la plus petite (437c88).
   */
  partAt(x: number, y: number, filter: 0 | 1 | 2 = 0): Part | null {
    let best: Part | null = null;
    let bestInside = false;
    let bestArea = Infinity;
    for (const p of this.world.staticThenMobile()) {
      if (p.flags14 & SCENERY && !this.lab) continue;
      if (filter === 1 && !(p.flags10 & 4)) continue;
      if (filter === 2 && !(p.flags10 & 1)) continue;
      const r = this.partRect(p);
      if (r.w <= 0 || r.h <= 0) continue;
      if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) continue;
      const inside = p.poly !== null && p.vertexCount > 0 && pointInside(p, x, y);
      const area = r.w * r.h;
      if ((inside && !bestInside) || (inside === bestInside && area < bestArea)) {
        best = p;
        bestInside = inside;
        bestArea = area;
      }
    }
    return best;
  }

  /** 438319 : rectangle d'une pièce (position, taille de la forme) ; corde et courroie : boîte de leurs extrémités. */
  partRect(p: Part): { x: number; y: number; w: number; h: number } {
    if (isRope(p) || isBelt(p)) {
      const pts: number[] = [];
      if (p.belt) for (let i = 0; i < 8; i++) pts.push(p.belt.pos[i]!);
      else if (p.ropes[0]) for (let i = 0; i < 4; i++) pts.push(p.ropes[0].ends[i]!);
      if (pts.every((v) => v === 0)) return { x: 0, y: 0, w: 0, h: 0 };
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(...xs) - 4;
      const y0 = Math.min(...ys) - 4;
      return { x: x0, y: y0, w: Math.max(...xs) + 4 - x0, h: Math.max(...ys) + 4 - y0 };
    }
    return { x: p.px, y: p.py, w: p.shapeW || p.frameW, h: p.shapeH || p.frameH };
  }

  /** La pièce peut-elle être prise ou modifiée (non verrouillée ; un décor seulement au Labo) ? */
  isMovable(p: Part): boolean {
    return !(p.flags14 & LOCKED) && (this.lab || !(p.flags14 & SCENERY));
  }

  /** Mode à deux joueurs (43013e) : la pièce peut-elle être sélectionnée ce tour ? La pièce tenue l'est toujours. */
  mayTouch(p: Part): boolean {
    return p === this.held || !this.guard || this.guard.mayTouch(p);
  }

  /** Mode à deux joueurs (418207) : le bac donne-t-il encore une pièce ce tour ? */
  mayTakeFromBin(): boolean {
    return !this.guard || this.guard.mayTakeFromBin();
  }

  /** Une pièce posée est modifiée (4301cb) ; rend faux si la règle du tour l'interdit. */
  private touch(p: Part): boolean {
    if (p === this.held || !this.guard) return true;
    if (!this.guard.mayTouch(p)) return false;
    this.guard.touched(p);
    return true;
  }

  /**
   * 43806a : zones offertes par une pièce posée. Labo, hors décor : cadenas fermé (0x400, pièce verrouillée) ou ouvert (0x10).
   * Infos sauf décor. Pièce verrouillée : rien d'autre. Sinon : retirer et déplacer ; puis, sauf corde, câble et courroie :
   * largeur (+0x10 & 0x80), hauteur (+0x10 & 0x100), retourner (+0x0C & 0x400 / 0x200, seulement si la pièce retournée ne
   * chevauche rien), programmer (+0x14 & 0x400), et au Labo la solution (+0x14 & 0x8000). Les poignées 0x1000 / 0x2000 des
   * décors (premier plan, arrière-plan : 42ead8, 42eb25) ne sont pas portées.
   */
  zoneMask(p: Part): number {
    let mask = 0;
    if (this.lab && !(p.flags14 & SCENERY)) mask |= p.flags14 & LOCKED ? Z.UNLOCK : Z.LOCK;
    if (!(p.flags14 & SCENERY)) mask |= Z.INFO;
    if (!this.isMovable(p)) return mask;
    mask |= Z.REMOVE | Z.BODY;
    if (isRope(p) || isBelt(p)) return mask;
    if (p.flags10 & 0x80) mask |= Z.WIDTH;
    if (p.flags10 & 0x100) mask |= Z.HEIGHT;
    if (p.flags0C & 0x400 && p.flags0C & 0x200) {
      if (this.flipFits(p, 15)) mask |= Z.FLIP_X | Z.FLIP_Y;
    } else {
      if (p.flags0C & 0x400 && this.flipFits(p, 1)) mask |= Z.FLIP_X;
      if (p.flags0C & 0x200 && this.flipFits(p, 2)) mask |= Z.FLIP_Y;
    }
    if (p.flags14 & 0x400) mask |= mask & Z.WIDTH ? Z.PROGRAM_LOW : Z.PROGRAM;
    if (this.lab && p.flags14 & IN_SOLUTION) mask |= Z.SOLUTION;
    return mask;
  }

  /**
   * 42e1e4 (bits 0x410) : coin de la poignée du cadenas. Ouvert : à droite, en haut. Fermé : à droite s'il reste 18 px dans
   * l'aire, sinon à gauche (+18) ; en haut, sauf si la pièce dépasse de plus de 18 px vers le haut (alors en bas − 18, à gauche).
   */
  private lockCorner(p: Part, r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
    const left = r.x - HANDLE_SIZE;
    const top = r.y - HANDLE_SIZE;
    const right = r.x + r.w;
    if (!(p.flags14 & LOCKED)) return { x: right, y: top };
    if (top < -18) return { x: left + 18, y: r.y + r.h - 18 };
    return { x: FIELD_WIDTH - 18 > right ? right : left + 18, y: top };
  }

  /** Poignées de 42e1e4 autour d'une pièce posée, aux positions de l'exe (coordonnées de l'aire). */
  handles(p: Part): Handle[] {
    const mask = this.zoneMask(p);
    const r = this.partRect(p);
    const left = r.x - HANDLE_SIZE;
    const top = r.y - HANDLE_SIZE;
    const midX = r.x + ((r.w - HANDLE_SIZE) >> 1);
    const midY = r.y + ((r.h - HANDLE_SIZE) >> 1);
    const right = r.x + r.w;
    const bottom = r.y + r.h;
    const out: Handle[] = [];
    if (mask & Z.REMOVE) out.push({ zone: Zone.Remove, x: left, y: top, state: HANDLE_STATES[7] });
    if (mask & Z.SOLUTION) out.push({ zone: Zone.Solution, x: midX, y: top, state: HANDLE_STATES[10] });
    if (mask & Z.WIDTH) {
      out.push({ zone: Zone.WidthLeft, x: left, y: midY, state: HANDLE_STATES[0] });
      out.push({ zone: Zone.WidthRight, x: right, y: midY, state: HANDLE_STATES[1] });
    }
    if (mask & Z.HEIGHT) {
      out.push({ zone: Zone.HeightTop, x: midX, y: top, state: HANDLE_STATES[2] });
      out.push({ zone: Zone.HeightBottom, x: midX, y: bottom, state: HANDLE_STATES[3] });
    }
    if (mask & (Z.FLIP_X | Z.FLIP_Y)) out.push({ zone: this.flipZone(p), x: left, y: bottom, state: HANDLE_STATES[4] });
    if (mask & Z.INFO) out.push({ zone: Zone.Info, x: right, y: bottom, state: HANDLE_STATES[9] });
    if (mask & Z.PROGRAM) out.push({ zone: Zone.Program, x: right, y: midY, state: HANDLE_STATES[8] });
    if (mask & Z.PROGRAM_LOW) out.push({ zone: Zone.Program, x: left + 16, y: bottom - 8, state: HANDLE_STATES[8] });
    if (mask & (Z.LOCK | Z.UNLOCK)) out.push({ zone: Zone.Lock, ...this.lockCorner(p, r), state: HANDLE_STATES[mask & Z.UNLOCK ? 6 : 5] });
    return out;
  }

  /** 43871a : retourner = X seul (+0x0C & 0x600 = 0x400), Y seul (0x200), ou quart de tour (les deux). */
  private flipZone(p: Part): ZoneId {
    const f = p.flags0C & 0x600;
    return f === 0x400 ? Zone.FlipX : f === 0x200 ? Zone.FlipY : Zone.Turn;
  }

  /**
   * 43840d : zone sous le point (x, y) de l'aire pour une pièce posée. Les zones des poignées font 36 px hors de la pièce
   * (bandes de 18 px au milieu des bords pour la taille) ; `large` agrandit ces bandes à toute la poignée (toucher).
   */
  zoneAt(p: Part, x: number, y: number, large = false): ZoneId {
    const mask = this.zoneMask(p);
    const r = this.partRect(p);
    const cx = r.x + (r.w >> 1);
    const cy = r.y + (r.h >> 1);
    const right = r.x + r.w;
    const bottom = r.y + r.h;
    const band = large ? HANDLE_SIZE >> 1 : 9;
    if (mask & (Z.LOCK | Z.UNLOCK)) {
      const c = this.lockCorner(p, r);
      if (x >= c.x && x < c.x + HANDLE_SIZE && y >= c.y && y < c.y + HANDLE_SIZE) return Zone.Lock;
    }
    const inLeft = x >= r.x - HANDLE_SIZE && x < r.x;
    const inRight = x > right && x < right + HANDLE_SIZE;
    const inTop = y >= r.y - HANDLE_SIZE && y < r.y;
    const inBottom = y > bottom && y < bottom + HANDLE_SIZE;
    if (mask & Z.REMOVE && inLeft && inTop) return Zone.Remove;
    if (mask & Z.WIDTH) {
      if (inLeft && y >= cy - band && y < cy + band) return Zone.WidthLeft;
      if (inRight && y >= cy - band && y < cy + band) return Zone.WidthRight;
    }
    if (mask & Z.HEIGHT) {
      if (inTop && x >= cx - band && x < cx + band) return Zone.HeightTop;
      if (inBottom && x >= cx - band && x < cx + band) return Zone.HeightBottom;
    }
    if (mask & (Z.FLIP_X | Z.FLIP_Y) && inLeft && inBottom) return this.flipZone(p);
    if (mask & Z.INFO && x > right && x < right + 41 && y > bottom && y < bottom + 41) return Zone.Info;
    if (mask & Z.SOLUTION && inTop && x >= cx - 18 && x < cx + 18) return Zone.Solution;
    if (mask & Z.PROGRAM && inRight && y >= cy - 18 && y < cy + 18) return Zone.Program;
    if (mask & Z.PROGRAM_LOW && inLeft && inBottom) return Zone.Program;
    if (mask & Z.BODY && x >= r.x && x < right && y >= r.y && y < bottom) return Zone.Body;
    return Zone.None;
  }

  // ------------------------------------------------------------------ pièce tenue

  /** Une pièce du bac est prise (clic dans le bac) : elle est tenue par son centre. Rend faux si le bac la refuse (mode 2, 418207). */
  takeFromBin(part: Part): boolean {
    if (!(part.flags0C & F0C.IN_BIN)) return false;
    if (!this.mayTakeFromBin()) return false;
    this.release();
    this.held = part;
    this.ropeLast = null;
    this.grabX = part.frameW >> 1;
    this.grabY = part.frameH >> 1;
    part.px = part.py = -1;
    this.guard?.taken(part);
    return true;
  }

  /** Labo : nouvelle pièce de ce type, créée dans le bac puis tenue (432d78, sans limite de nombre). */
  takeNew(type: number): Part {
    const p = createPart(this.world, type);
    this.applySize(p);
    p.editFrame = p.frame;
    this.takeFromBin(p);
    return p;
  }

  /**
   * 42f891 : saisir une pièce posée. Courroie : elle lâche ses pièces mais garde la première (on la repose en deux appuis
   * à partir de là) ; corde : elle lâche son second bout ; autre pièce : elle quitte l'aire avec ses courroie et cordes
   * (4395ba). La pièce passe au bac le temps qu'on la tient.
   */
  grab(part: Part, x: number, y: number): void {
    if (!this.isMovable(part) || !this.touch(part)) return;
    this.release();
    this.grabX = x - part.px;
    this.grabY = y - part.py;
    const keep = part.belt?.end1 ?? null;
    if (isBelt(part)) {
      core(this.world).detachBelt(part);
    } else if (isRope(part)) {
      const rope = part.ropes[0];
      this.ropeLast = rope?.end1 ?? null;
      core(this.world).detachRopes(part, false);
    } else {
      this.leaveField(part);
    }
    if (isBelt(part) && keep && part.belt) {
      part.belt.end1 = keep;
      keep.flags10 |= 2;
      keep.editFlags10 = keep.flags10;
      keep.belt = part.belt;
    }
    if (!(part.flags0C & F0C.IN_BIN)) core(this.world).toBin(part);
    this.held = part;
    this.cleanOrphans();
  }

  /** 4395ba en mode 9 : la pièce quitte l'aire ; sa courroie et ses cordes partent au bac. */
  private leaveField(part: Part): void {
    const c = core(this.world);
    if (part.belt && !isBelt(part)) c.detachBelt(part.belt.beltPart);
    if (part.type !== 7) for (const rope of part.ropes) if (rope) c.detachRopes(rope.ropePart, true);
    if (part.type === 7) c.remove(part);
    if (part.flags14 & 3) c.unplug(part);
    if (!(part.flags0C & F0C.IN_BIN)) c.toBin(part);
  }

  /**
   * Suppression des liens orphelins : une corde ou une courroie du bac ne garde aucun bout (sauf celle qu'on tient, en cours
   * de pose), une pièce ne garde pas une courroie ou une corde rangée.
   */
  cleanOrphans(): void {
    const c = core(this.world);
    for (const p of this.world.bin.toArray()) {
      if (p === this.held) continue;
      if (isBelt(p) && p.belt && (p.belt.end1 || p.belt.end2)) c.detachBelt(p);
      if (isRope(p) && p.ropes[0] && (p.ropes[0].end1 || p.ropes[0].end2)) c.detachRopes(p, true);
    }
  }

  /**
   * 42f24a sans appui : position de la pièce tenue pour le pointeur en (x, y) de l'aire (grille de l'exe, au moins 4 px
   * visibles) et validité (437208). Corde et courroie : aperçu du lien.
   */
  hover(x: number, y: number): HeldPreview {
    this.pointer = { x, y };
    const p = this.held;
    if (!p) return { valid: false };
    if (isRope(p)) return this.ropePreview(x, y);
    if (isBelt(p)) return this.beltPreview();
    this.snap(p, x, y);
    return { valid: !overlapsAnother(this.world, p) };
  }

  /** 42f24a : calage de la pièce tenue sur la grille. */
  private snap(p: Part, mx: number, my: number): void {
    const maxX = FIELD_WIDTH - 4;
    const maxY = FIELD_HEIGHT - 4;
    if (p.flags14 & 8) {
      p.px = mx - this.grabX;
      if (p.px + p.frameW <= 4) p.px = 4 - p.frameW;
      if (maxX < p.px) p.px = maxX;
      p.py = my - this.grabY;
      if (p.py + p.frameH <= 4) p.py = 4 - p.frameH;
      if (maxY < p.py) p.py = maxY;
    } else if (GRID8.has(p.type)) {
      p.px = (mx - this.grabX) & ~7;
      if (maxX < p.px) p.px -= 8;
      if (p.px + p.frameW <= 0) p.px += 8;
      p.py = (my - this.grabY) & ~7;
      if (maxY < p.py) p.py -= 8;
      if (p.py + p.frameH <= 0) p.py += 8;
    } else {
      p.px = ((mx - this.grabX) & ~15) + 8;
      if (maxX < p.px) p.px -= 16;
      if (p.px + p.frameW <= 0) p.px += 16;
      p.py = ((my - this.grabY) & ~15) + (LOW_Y.has(p.type) ? 3 : 8);
      if (maxY < p.py) p.py -= 16;
      if (p.py + p.frameH <= 0) p.py += 16;
    }
    p.editX = p.px;
    p.editY = p.py;
    updateGeometry(this.world, p);
  }

  /**
   * Appui sur l'aire en (x, y) pendant qu'on tient une pièce : 42f24a (poser si rien n'est chevauché), 42ee68 (corde),
   * 42ed3f (courroie).
   */
  click(x: number, y: number): EditResult {
    this.pointer = { x, y };
    const p = this.held;
    if (!p) return "none";
    if (isRope(p)) return this.ropeClick(x, y);
    if (isBelt(p)) return this.beltClick(x, y);
    this.snap(p, x, y);
    if (overlapsAnother(this.world, p)) return "refused";
    this.place(p);
    this.held = null;
    this.guard?.placed(p);
    this.pairUp(p);
    return "placed";
  }

  /**
   * 4301f5 : le temps du tour finit pendant qu'on tient une pièce. Corde, câble, courroie, télécommande et explosifs retournent au
   * bac (42f978), comme une pièce qui chevaucherait (437208) ou qui n'a pas encore été montrée dans l'aire ; une autre pièce est
   * posée là où elle est (42ebba).
   */
  dropHeld(): EditResult {
    const p = this.held;
    if (!p) return "none";
    if (RETURNED_AT_TIMEOUT.has(p.type) || p.px === -1 || overlapsAnother(this.world, p)) {
      this.returnHeld();
      return "returned";
    }
    this.place(p);
    this.held = null;
    this.guard?.placed(p);
    this.pairUp(p);
    // Le partenaire neuf d'une télécommande n'a pas de place à lui : il retourne au bac.
    if (this.held) this.returnHeld();
    return "placed";
  }

  /**
   * 42f57b : une télécommande (0x16) ou des explosifs télécommandés (0x37) posés sans partenaire (+0x94) en reçoivent un
   * neuf (432d78), lié des deux côtés (+0x94 et sa copie +0x9C), à la même position, qui devient la pièce tenue (l'écart du
   * pointeur reste celui de la pièce posée).
   */
  private pairUp(p: Part): void {
    if ((p.type !== 0x16 && p.type !== 0x37) || p.links[1]) return;
    const q = newPart(this.world, p.type === 0x16 ? 0x37 : 0x16);
    if (!q) return;
    p.links[1] = p.links[3] = q;
    q.links[1] = q.links[3] = p;
    q.px = p.px;
    q.py = p.py;
    insertSorted(this.world.bin, q, this.world.types, false);
    this.held = q;
  }

  /** 42f4c4 … 42f5f9 : la pièce posée entre dans la liste des statiques ou des mobiles et se branche. */
  private place(p: Part): void {
    const w = this.world;
    if (p.belt && !isBelt(p) && !this.beltFits(p.belt)) core(w).detachBelt(p.belt.beltPart);
    p.editX = p.px;
    p.editY = p.py;
    p.editFlags10 = p.flags10;
    p.editFrame = p.frame;
    w.bin.remove(p);
    p.flags0C &= ~0x3800;
    // 43965b : +0x0C & 0x4000 → statiques, sinon mobiles.
    insertSorted(p.flags0C & 0x4000 ? w.statics : w.mobiles, p, w.types, false);
    if (p.flags14 & 1) this.plugIn(p);
    else if (p.flags14 & 2) core(w).unplug(p);
    p.fx = p.px << 9;
    p.fy = p.py << 9;
    p.prevPx = p.px;
    p.prevPy = p.py;
    w.call(2, p);
    p.editFrame = p.frame;
    w.redraw(p, 2);
  }

  /** 438ea8 : branche une pièce à fiche sur la prise libre la plus récemment trouvée à moins de 8 px (434cc4). */
  private plugIn(p: Part): void {
    const w = this.world;
    const old = p.links[4];
    const oldSide = p.fD0 & 0xff;
    p.links[4] = null;
    let target: Part | null = null;
    let side = 0;
    for (let o = findNeighbours(w, p, 0x2000, -8, 8, -8, 8); o; o = o.bucketNext) {
      if (o === old) {
        target = old;
        side = oldSide;
        break;
      }
      if (!(o.flags14 & 2)) continue;
      if (!o.links[4]) {
        target = o;
        side = 0;
        break;
      }
      if (!o.links[5]) {
        target = o;
        side = 1;
        break;
      }
    }
    if (old && old !== target) {
      old.links[4 + oldSide] = null;
      w.call(2, old);
      old.editFrame = old.frame;
    }
    if (target) {
      target.links[4 + side] = p;
      p.links[4] = target;
      p.fD0 = side;
      w.call(2, target);
      target.editFrame = target.frame;
    }
  }

  /** 42ebba hors de l'aire + appui (ou Échap) : la pièce tenue retourne au bac (42f978) ; au Labo, elle disparaît. */
  returnHeld(): void {
    const p = this.held;
    if (!p) return;
    this.held = null;
    this.guard?.returned(p);
    this.ropeLast = null;
    const c = core(this.world);
    if (isRope(p)) c.detachRopes(p, true);
    else if (isBelt(p)) c.detachBelt(p);
    if (!(p.flags0C & F0C.IN_BIN)) c.toBin(p);
    this.resetForBin(p);
    if (this.lab) this.world.bin.remove(p);
    this.cleanOrphans();
  }

  /** Lâche la pièce tenue sans la poser (fin de partie, changement de puzzle) : comme `returnHeld`. */
  release(): void {
    if (this.held) this.returnHeld();
  }

  /** 43267a pour une pièce : retournements défaits, taille du type, image 0 (comme au rangement du puzzle). */
  private resetForBin(x: Part): void {
    const w = this.world;
    x.frame = x.editFrame = x.type === 0x57 ? x.frame : 0;
    if (x.flags10 & 0x10) this.slot3(x, 1);
    if (x.flags10 & 0x20) this.slot3(x, 2);
    x.editFlags10 = x.flags10;
    const d = w.types.get(x.type);
    if (SIZED.has(x.type)) Object.assign(x, defaultBox(w, x.type));
    else {
      x.boxW = d.boxW;
      x.boxH = d.boxH;
    }
    this.slot4(x, null);
    updateGeometry(w, x);
    w.call(2, x);
    x.px = x.py = -1;
  }

  /** Mode 8 (42e848) : la pièce posée retourne au bac avec ses liens (42f978). */
  removeToBin(p: Part): void {
    if (!this.isMovable(p)) return;
    if (p === this.held) return this.returnHeld();
    if (!this.touch(p)) return;
    this.stow(p);
  }

  /** 42f978 : la pièce posée quitte l'aire pour le bac. */
  private stow(p: Part): void {
    core(this.world).remove(p);
    this.resetForBin(p);
    if (this.lab) this.world.bin.remove(p);
    this.cleanOrphans();
  }

  /** « Dégager la zone de jeu » : toutes les pièces non verrouillées retournent au bac. */
  clearField(): void {
    this.release();
    for (;;) {
      const p = [...this.world.staticThenMobile()].find((q) => this.isMovable(q) && !isRope(q) && !isBelt(q));
      if (!p) break;
      this.stow(p);
    }
    for (const p of [...this.world.staticThenMobile()]) if (this.isMovable(p)) this.stow(p);
  }

  // ------------------------------------------------------------------ cadenas (Labo)

  /**
   * 42e9d8 : poignée du cadenas, la pièce change d'état (+0x14 ^= 0x40) ; une télécommande (0x16) ou des explosifs (0x37) entraînent
   * leur partenaire (+0x94). Rend le nouvel état (vrai : verrouillée), `null` hors du Labo ou pour un décor.
   */
  toggleLock(p: Part): boolean | null {
    if (!this.lab || p.flags14 & SCENERY || p === this.held) return null;
    p.flags14 ^= LOCKED;
    const partner = (p.type === 0x16 || p.type === 0x37) && p.links[1] ? p.links[1] : null;
    if (partner) partner.flags14 ^= LOCKED;
    this.world.redraw(p, 2);
    return (p.flags14 & LOCKED) !== 0;
  }

  /**
   * « Verrouiller » (4209e5) ou « Déverrouiller » (420afc) de la fenêtre `HTLOCK` : toutes les pièces posées, mobiles puis fixes,
   * hors décors (+0x14 & 0x1040 : déjà verrouillées ou décor). Rend le nombre de pièces changées.
   */
  lockAll(locked: boolean): number {
    if (!this.lab) return 0;
    this.release();
    let n = 0;
    for (const list of [this.world.mobiles, this.world.statics]) {
      for (const p of list) {
        if (p.flags14 & SCENERY || ((p.flags14 & LOCKED) !== 0) === locked) continue;
        p.flags14 ^= LOCKED;
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ retournement et taille

  /** La pièce retournée (slot 3) ne chevaucherait-elle rien (43806a) ? Elle est remise dans son état. */
  private flipFits(p: Part, action: 1 | 2 | 15): boolean {
    const frame = p.frame;
    const flags = p.flags10;
    const w = this.world;
    let fits = false;
    if (action === 15) {
      for (let i = 0; i < 4 && !fits; i++) {
        this.slot3(p, 15);
        if (p.frame === frame && p.flags10 === flags) break;
        fits = !overlapsAnother(w, p) && (!p.belt || this.beltFits(p.belt));
      }
    } else {
      this.slot3(p, action);
      fits = !overlapsAnother(w, p) && (!p.belt || this.beltFits(p.belt));
    }
    // Remise dans l'état d'origine (43819d : image et drapeaux, puis slot 3 avec 0).
    p.frame = frame;
    p.flags10 = flags;
    this.slot3(p, 0);
    updateGeometry(w, p);
    return fits;
  }

  /**
   * Retourner une pièce (42fa77, 42faad, 42fae3 ; touches X et Y de 42f63c). Pièce tenue : sans test. Pièce posée : refusé
   * si elle chevaucherait une autre pièce (la poignée n'est alors pas offerte). Rend vrai si la pièce a changé.
   */
  flip(p: Part, axis: "x" | "y" | "turn"): boolean {
    const w = this.world;
    const can = axis === "x" ? p.flags0C & 0x400 : axis === "y" ? p.flags0C & 0x200 : p.flags0C & 0x600;
    if (!can || !this.isMovable(p) || isRope(p) || isBelt(p) || !this.touch(p)) return false;
    if (axis === "turn" || (p.flags0C & 0x600) === 0x600) {
      // 42fae3 : quart de tour jusqu'à une position libre (pièce posée).
      if (p === this.held) {
        this.slot3(p, 15);
      } else {
        for (let i = 0; i < 4; i++) {
          this.slot3(p, 15);
          if (!overlapsAnother(w, p) && (!p.belt || this.beltFits(p.belt))) break;
        }
      }
    } else {
      const action = axis === "x" ? 1 : 2;
      if (p !== this.held && !this.flipFits(p, action)) return false;
      this.slot3(p, action);
    }
    p.editFlags10 = p.flags10;
    p.editFrame = p.frame;
    updateGeometry(w, p);
    if (p !== this.held) this.afterEdit(p);
    return true;
  }

  /**
   * 42f63c, touches + et − : taille de 16 en 16 entre les bornes du type. Largeur si la pièce est au moins aussi large que
   * haute (ou une pente), hauteur sinon. Pièce posée : refusé si elle chevaucherait une autre pièce.
   */
  resize(p: Part, delta: 1 | -1): boolean {
    if (!this.isMovable(p) || isRope(p) || isBelt(p) || !this.touch(p)) return false;
    const d = this.world.types.get(p.type);
    const wide = p.boxH <= p.boxW || SLOPES.has(p.type);
    const save = { w: p.boxW, h: p.boxH };
    if (wide) {
      if (delta > 0 ? p.boxW >= d.f3C : p.boxW <= d.f44) return false;
      p.boxW += 16 * delta;
    } else {
      if (delta > 0 ? p.boxH >= d.f40 : p.boxH <= d.f48) return false;
      p.boxH += 16 * delta;
    }
    this.applySize(p);
    if (p !== this.held && overlapsAnother(this.world, p)) {
      p.boxW = save.w;
      p.boxH = save.h;
      this.applySize(p);
      return false;
    }
    if (p !== this.held) this.afterEdit(p);
    return true;
  }

  /**
   * Slot 3 (édition) de la pièce. 43c62b (pentes) manque au registre du noyau : traduit ici en repli (argument non nul :
   * +0x10 ^= 0x10, puis 43c5c0, le slot 2 des pentes).
   */
  private slot3(p: Part, action: number): void {
    const w = this.world;
    const address = w.types.get(p.type).handlers[3]!;
    if (address === 0x43c62b && !w.handlers.has(address)) {
      if (action) p.flags10 ^= 0x10;
      w.call(2, p);
      return;
    }
    w.call(3, p, action);
  }

  /** Slot 4 (secondaire : taille des murs et des pentes), géométrie (439b58), slot 2. */
  private applySize(p: Part, axis: "width" | "height" | null = null): void {
    this.slot4(p, axis);
    updateGeometry(this.world, p);
    this.world.call(2, p);
  }

  /**
   * Slot 4 de la pièce. Deux handlers manquent au registre du noyau (API manquante signalée) : traduits ici en repli tant
   * qu'aucune famille ne les enregistre.
   * - 43ea14 (murs) : pendant qu'on étire en largeur (0x4815b4 = 0x8003 / 0x8004), l'épaisseur revient à 16 (32 pour le type
   *   0x76) ; en hauteur (0x8005 / 0x8006), la largeur ; puis taille d'image = boîte et coins du polygone propre à la pièce.
   * - 43c5f6 (pentes) : taille d'image = boîte, inclinaison (+0x18 et +0xF0) = largeur / 16 − 1, puis 43c5c0.
   */
  private slot4Fallback(p: Part): boolean {
    const address = this.world.types.get(p.type).handlers[4]!;
    return (address === 0x43ea14 || address === 0x43c5f6) && !this.world.handlers.has(address);
  }

  private slot4(p: Part, axis: "width" | "height" | null): void {
    const w = this.world;
    if (!this.slot4Fallback(p)) {
      w.call(4, p);
      return;
    }
    const address = w.types.get(p.type).handlers[4]!;
    if (address === 0x43c5f6) {
      p.frameW = p.boxW;
      p.frameH = p.boxH;
      p.frame = p.editFrame = (Math.trunc(p.frameW / 16) - 1) | 0;
      w.call(2, p);
      return;
    }
    const thick = p.type === 0x76 ? 0x20 : 0x10;
    if (axis === "width") p.boxH = thick;
    else if (axis === "height") p.boxW = thick;
    p.frameW = p.boxW;
    p.frameH = p.boxH;
    const poly = p.poly;
    if (poly && poly.length >= 4 && !w.types.get(p.type).polygons?.includes(poly)) {
      poly.x[1] = poly.x[2] = (p.frameW - 1) | 0;
      poly.y[2] = poly.y[3] = (p.frameH - 1) | 0;
    }
  }

  /**
   * 42fc4c, 42fd94, 42fea3, 43001d : étirer une pièce posée par un bord jusqu'au pointeur (grille de 16, bornes du type) ;
   * tant qu'elle chevauche, on recule de 16 ; sous la taille minimale, on revient à la taille de départ. Rend vrai si la
   * pièce a changé.
   */
  resizeEdge(p: Part, zone: ZoneId, x: number, y: number): boolean {
    if (!this.touch(p)) return false;
    // 42fb4a : la poignée tenue (0x4815b4 = 0x8003 … 0x8006) est lue par le slot 4 du tuyau 97 (un côté sur 16, l'autre à 38).
    const handle = this.world.resizeHandle;
    this.world.resizeHandle = 0x8000 | zone;
    try {
      return this.stretch(p, zone, x, y);
    } finally {
      this.world.resizeHandle = handle;
    }
  }

  private stretch(p: Part, zone: ZoneId, x: number, y: number): boolean {
    const d = this.world.types.get(p.type);
    const start = { x: p.px, y: p.py, w: p.boxW, h: p.boxH };
    const horizontal = zone === Zone.WidthLeft || zone === Zone.WidthRight;
    const axis = horizontal ? "width" : "height";
    const min = horizontal ? d.f44 : d.f48;
    const max = horizontal ? d.f3C : d.f40;
    if (zone === Zone.WidthLeft || zone === Zone.HeightTop) {
      // Bord gauche (haut) : le bord suit le pointeur, l'autre bord ne bouge pas.
      let edge = ((horizontal ? x : y) & ~15) - 8;
      const pos = horizontal ? start.x : start.y;
      let size = pos - edge + (horizontal ? start.w : start.h);
      if (size > max) {
        edge += size - max;
        size = max;
      } else if (min > size) {
        edge -= min - size;
        size = min;
      }
      if (edge === pos) return false;
      if (horizontal) {
        p.px = edge;
        p.boxW = size;
      } else {
        p.py = edge;
        p.boxH = size;
      }
      this.applySize(p, axis);
      let back = false;
      while (overlapsAnother(this.world, p) && !back) {
        if (horizontal) {
          p.px += 16;
          p.boxW -= 16;
          if (min > p.boxW) {
            p.px = start.x;
            p.boxW = start.w;
            back = true;
          }
        } else {
          p.py += 16;
          p.boxH -= 16;
          if (min > p.boxH) {
            p.py = start.y;
            p.boxH = start.h;
            back = true;
          }
        }
        this.applySize(p, axis);
      }
    } else {
      // Bord droit (bas).
      const pos = horizontal ? start.x : start.y;
      let size = ((horizontal ? x : y) & ~15) + 8 - pos;
      if (max < size) size = max;
      else if (min > size) size = min;
      if (size === (horizontal ? start.w : start.h)) return false;
      if (horizontal) p.boxW = size;
      else p.boxH = size;
      this.applySize(p, axis);
      let back = false;
      while (overlapsAnother(this.world, p) && !back) {
        if (horizontal) p.boxW -= 16;
        else p.boxH -= 16;
        if (min > (horizontal ? p.boxW : p.boxH)) {
          p.boxW = start.w;
          p.boxH = start.h;
          back = true;
        }
        this.applySize(p, axis);
      }
    }
    const changed = p.px !== start.x || p.py !== start.y || p.boxW !== start.w || p.boxH !== start.h;
    if (changed) this.afterEdit(p);
    return changed;
  }

  /** Après une modification d'une pièce posée : état d'édition à jour (+0xE8 …), position fine, zone à redessiner. */
  private afterEdit(p: Part): void {
    p.editX = p.px;
    p.editY = p.py;
    p.editFlags10 = p.flags10;
    p.editFrame = p.frame;
    p.fx = p.px << 9;
    p.fy = p.py << 9;
    this.world.redraw(p, 2);
  }

  // ------------------------------------------------------------------ programmer

  /**
   * Poignée « programmer » (42ea57 → 4249f8) d'une pièce posée : état de la fenêtre `PROG<type>.ITF` (`program.ts`), ou
   * `null` si la pièce n'en a pas. `rows` : lignes de `PROGPART.RES` (`parseProgramRows`).
   */
  program(p: Part, rows: readonly ProgramRow[]): PartProgram | null {
    if (p === this.held || !(this.zoneMask(p) & (Z.PROGRAM | Z.PROGRAM_LOW)) || !PROGRAM_TYPES.includes(p.type)) return null;
    return new PartProgram(this.world, p, rows);
  }

  // ------------------------------------------------------------------ cordes et courroies

  /** 437f0d : pièce qui peut prendre la corde sous le pointeur, avec l'emplacement (accroche la plus proche si deux). */
  private ropeTarget(x: number, y: number): { part: Part; slot: number } | null {
    const t = this.partAt(x, y, 1);
    if (!t || !(t.flags10 & 4)) return null;
    let slot = 0;
    if (t.flags10 & 8) {
      const d0 = Math.abs(x - (t.px + t.ropeAnchor[0]!)) + Math.abs(y - (t.py + t.ropeAnchor[1]!));
      const d1 = Math.abs(x - (t.px + t.ropeAnchor[2]!)) + Math.abs(y - (t.py + t.ropeAnchor[3]!));
      slot = d0 < d1 ? 0 : 1;
    }
    if (t.type === 7) return t.links[0] ? null : { part: t, slot };
    if (t.ropes[slot]) return null;
    return { part: t, slot };
  }

  /** 42ee68 : la cible est-elle permise pour le prochain maillon de la corde tenue ? */
  private ropeValid(rope: RopeData, target: { part: Part; slot: number } | null): target is { part: Part; slot: number } {
    if (!target) return false;
    const t = target.part;
    const end1 = rope.end1;
    if (t === this.ropeLast && end1) return false;
    if (t === end1) return false;
    if (end1) {
      // Pas deux cordes entre les deux mêmes pièces.
      const other = t.ropes[target.slot === 0 ? 1 : 0];
      if (other && (other.end1 === end1 || other.end2 === end1)) return false;
    }
    return true;
  }

  private ropePreview(x: number, y: number): HeldPreview {
    const r = this.held!.ropes[0];
    if (!r) return { valid: false };
    const target = this.ropeTarget(x, y);
    const valid = this.ropeValid(r, target);
    const last = this.ropeLast;
    if (!last || !r.end1) return { valid };
    const slot = last.type === 7 ? 1 : r.slot1 & 1;
    return { valid, line: { x1: last.px + last.ropeAnchor[2 * slot]!, y1: last.py + last.ropeAnchor[2 * slot + 1]!, x2: x, y2: y } };
  }

  /** 42ee68 avec appui : premier bout, poulie traversée, ou second bout (la corde est alors posée). */
  private ropeClick(x: number, y: number): EditResult {
    const ropePart = this.held!;
    const rope = ropePart.ropes[0];
    if (!rope) return "refused";
    const w = this.world;
    const target = this.ropeTarget(x, y);
    // Appui sur la dernière poulie : elle est retirée de la chaîne.
    const last = this.ropeLast;
    if (last && last.type === 7 && target?.part === last) {
      const prev = last.links[1];
      last.links[0] = last.links[2] = null;
      last.links[1] = last.links[3] = null;
      last.ropes[1] = null;
      if (prev) {
        if (prev.type === 7) prev.links[0] = prev.links[2] = null;
        else {
          prev.links[rope.slot1] = null;
          prev.links[2 + rope.slot1] = null;
        }
      }
      this.ropeLast = prev;
      w.special(0x438db6, ropePart, rope);
      return "unlinked";
    }
    if (!this.ropeValid(rope, target)) return "refused";
    const t = target.part;
    const slot = target.slot;
    if (rope.end1 && last) {
      if (last.type === 7) last.links[0] = last.links[2] = t;
      else last.links[rope.slot1] = last.links[2 + rope.slot1] = t;
      if (t.type === 7) {
        t.links[1] = t.links[3] = last;
        t.ropes[1] = rope;
        this.ropeLast = t;
        w.special(0x438db6, ropePart, rope);
        w.call(2, t);
        return "linking";
      }
      t.links[slot] = t.links[2 + slot] = last;
      t.ropes[slot] = rope;
      rope.end2 = rope.origEnd2 = t;
      rope.slot2 = rope.origSlot2 = slot;
      w.call(2, t);
      this.placeLink(ropePart);
      w.special(0x43af6d, ropePart);
      return "linked";
    }
    if (t.type === 7) return "refused";
    t.ropes[slot] = rope;
    rope.end1 = rope.origEnd1 = t;
    rope.slot1 = rope.origSlot1 = slot;
    this.ropeLast = t;
    w.call(2, t);
    return "linking";
  }

  /** 438985 : la courroie tenue peut-elle aller sur la pièce sous le pointeur ? (440 px² … 140 px de distance) */
  private beltTarget(): Part | null {
    const belt = this.held?.belt;
    if (!belt) return null;
    const t = this.partAt(this.pointer.x, this.pointer.y, 2);
    if (!t || t.flags10 & 2 || !(t.flags10 & 1)) return null;
    if (belt.end1) {
      if (t === belt.end1) return null;
      if (!beltClose(belt.end1, t)) return null;
    }
    return t;
  }

  /** 438985 pour une courroie posée : ses deux pièces sont à moins de 140 px (438932). */
  private beltFits(belt: BeltData): boolean {
    if (!belt.end1 || !belt.end2) return true;
    return beltClose(belt.end1, belt.end2);
  }

  private beltPreview(): HeldPreview {
    const belt = this.held!.belt;
    const valid = this.beltTarget() !== null;
    const a = belt?.end1;
    if (!a) return { valid };
    return { valid, line: { x1: a.px + a.f88, y1: a.py + a.f89, x2: this.pointer.x, y2: this.pointer.y } };
  }

  /** 42ed3f avec appui : première pièce, puis seconde (la courroie est alors posée). */
  private beltClick(x: number, y: number): EditResult {
    this.pointer = { x, y };
    const b = this.held!;
    const belt = b.belt;
    if (!belt) return "refused";
    const t = this.beltTarget();
    if (!t) return "refused";
    t.flags10 |= 2;
    t.editFlags10 = t.flags10;
    t.belt = belt;
    if (belt.end1) {
      belt.end2 = t;
      this.placeLink(b);
      this.world.special(0x438c70, b);
      return "linked";
    }
    belt.end1 = t;
    return "linking";
  }

  /** La corde ou la courroie entre dans la liste de l'aire (41715f, 43965b) et n'est plus tenue. */
  private placeLink(p: Part): void {
    const w = this.world;
    w.bin.remove(p);
    p.flags0C &= ~0x3800;
    p.px = p.py = p.editX = p.editY = 0;
    insertSorted(p.flags0C & 0x4000 ? w.statics : w.mobiles, p, w.types, false);
    w.redraw(p, 2);
    this.held = null;
    this.ropeLast = null;
    this.guard?.placed(p);
  }
}

/** 438932 : écart entre les points d'accroche de courroie (+0x88, +0x89) de deux pièces, au carré, sous 0x4C90 (140²). */
function beltClose(a: Part, b: Part): boolean {
  const dx = (a.px + a.f88 - (b.px + b.f88)) | 0;
  const dy = (a.py + a.f89 - (b.py + b.f89)) | 0;
  return ((Math.imul(dx, dx) + Math.imul(dy, dy)) | 0) < 0x4c90;
}

/** Taille par défaut d'une pièce à taille propre : boîte du type (+0x34 / +0x38), sinon forme du PAR (+0x64 / +0x68). */
function defaultBox(world: World, type: number): { boxW: number; boxH: number } {
  const d = world.types.get(type);
  return { boxW: d.boxW > 0 ? d.boxW : Math.max(d.shapeW, 16), boxH: d.boxH > 0 ? d.boxH : Math.max(d.shapeH, 16) };
}

/**
 * Pièce neuve (Labo) : champs initiaux du descripteur comme 43173e pour un enregistrement vide, taille par défaut du type
 * (`defaultBox`), structure de corde ou de courroie, slot 2 ; rangée au bac.
 */
export function createPart(world: World, type: number): Part {
  const d = world.types.get(type);
  const p = new Part();
  p.type = type;
  p.flags0C = d.flags0C;
  p.flags10 = d.flags10;
  p.flags14 = d.flags14;
  p.editFlags10 = p.flags10;
  p.vertexCount = d.vertexCount;
  p.mass = d.mass;
  if (SIZED.has(type)) Object.assign(p, defaultBox(world, type));
  if (isRope(p) || type === 7) p.ropes[0] = new RopeData(p);
  if (isBelt(p)) p.belt = new BeltData(p);
  if (p.vertexCount !== 0 && !d.polygons) p.poly = new Polygon(p.vertexCount);
  p.px = p.py = p.editX = p.editY = -1;
  // 432c1c : slot 7 (structure des lasers, réglages de la balle programmable) avant le slot 2.
  if (d.handlers[7] !== 0) world.call(7, p);
  updateGeometry(world, p);
  world.call(2, p);
  insertSorted(world.bin, p, world.types, false);
  return p;
}
