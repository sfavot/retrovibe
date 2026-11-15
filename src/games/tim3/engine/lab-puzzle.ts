/**
 * Puzzle maison : ce que le Labo ajoute à une machine pour qu'elle se joue comme un puzzle du jeu (TIMWIN.EXE).
 *
 * - **But** : le texte de la barre du but, un contrôle EDIT modifiable au Labo (414fc1 : modes 1 et 6, `[0x4811e8]`, 399 caractères,
 *   retours à la ligne retirés).
 * - **Indices** : 8 emplacements (`[0x47eb74]` = nombre, puis 8 × 0x10C octets : x, y, retournement, texte de 255 caractères), posés et
 *   écrits par l'éditeur d'indices (`HINT.ITF`, 41f3dc ; 41f159 prend le premier emplacement au texte vide).
 * - **Conditions de réussite** : la table 0x47fe30 (un mot « actif », 8 conditions {pièce, état1, état2, nombre, x, y, l, h}, délai
 *   `[0x47ff34]`), remplie par la fenêtre `SOLVE.ITF` (426d1c) depuis la poignée « solution » d'une pièce. Ses choix (427419) :
 *   par le haut (rectangle −500, −2000, 1640, 2000), par le bas (−500, 400, 1640, 3000), hors de l'écran (−1 partout), un état (plage
 *   d'images de `SOLVE.RES`, 429cb8), un endroit précis (rectangle tracé dans l'aire), un nombre de pièces, et le délai.
 * - **Titre** : le nom donné à la sauvegarde (`DR_TITLE` de `DOSBOX`, « Titre: »).
 *
 * Au Labo, une condition tient sa pièce (la table de l'exe garde des pointeurs, 4316e1) ; la sauvegarde la range par index dans la
 * machine (`save.ts`). La session remet les pièces à jour après « Arrêter », qui remplace le monde par sa copie (`remap`).
 */
import { HINT_COUNT } from "../data/text";
import type { LevCondition, LevHint, Level, LevSolution } from "../data/lev";
import type { SolvePart, SolveRange } from "../data/solutions";
import { GoalTest, type GoalSlot } from "./goals";
import type { Part } from "./part";
import type { World } from "./world";

/** Conditions d'un puzzle (8 emplacements de la table 0x47fe30). */
export const MAX_CONDITIONS = 8;
/** Indices d'un puzzle (41fea1 : 8 au plus, 31265 au-delà). */
export const MAX_HINTS = HINT_COUNT;
/** Longueur du but (414fc1 : `GetWindowTextA(…, 0x18f)`) et d'un indice (41f9c7 : 0xFE). */
export const GOAL_MAX = 399;
export const HINT_TEXT_MAX = 254;
/** Contrôle d'une main d'indice : 44 × 43 (42057e), gardé dans l'aire. */
export const HINT_WIDTH = 44;
export const HINT_HEIGHT = 43;

/** Rectangles de 427419 : « Par le haut », « Par le bas », « Hors de l'écran ». */
export const OFF_TOP = { x: -500, y: -2000, width: 1640, height: 2000 } as const;
export const OFF_BOTTOM = { x: -500, y: 400, width: 1640, height: 3000 } as const;
export const OFF_SCREEN = { x: -1, y: -1, width: -1, height: -1 } as const;

export interface LabCondition {
  part: Part;
  state1: number;
  state2: number;
  /** Nombre de pièces de ce type à réunir (0 : cette pièce seulement). */
  count: number;
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
}

/** Les choix de la fenêtre `SOLVE.ITF`. */
export type ConditionKind = "top" | "bottom" | "offscreen" | "position" | "state";

/** Le choix qu'une condition représente. */
export function conditionKind(c: Pick<LevCondition, "rectX" | "rectY" | "rectWidth" | "rectHeight">): ConditionKind {
  const same = (r: { x: number; y: number; width: number; height: number }): boolean => c.rectX === r.x && c.rectY === r.y && c.rectWidth === r.width && c.rectHeight === r.height;
  if (same(OFF_SCREEN)) return "offscreen";
  if (same(OFF_TOP)) return "top";
  if (same(OFF_BOTTOM)) return "bottom";
  return c.rectWidth === 0 ? "state" : "position";
}

/** Première image d'un état d'ANM (44b2c0 ; −1 : le nombre d'images). */
export type StateFirst = (state: number) => number;

/** 429cb8 : plage d'images d'une plage d'états de `SOLVE.RES` (de la première image de `from` à celle de `to` − 1). */
export function rangeFrames(range: SolveRange, first: StateFirst): { state1: number; state2: number } {
  return { state1: first(range.from), state2: first(range.to) - 1 };
}

/**
 * 429ef4 (lu en partie) : variante d'une pièce, c'est-à-dire le rang de la plage qui contient son image dans la ligne `@`, sinon dans le
 * premier état (le ballon a 4 couleurs, chacune avec ses plages). 0 si aucune.
 */
export function solveVariant(solve: SolvePart, frame: number, first: StateFirst): number {
  const ranges = solve.position ?? solve.states[0]?.ranges ?? [];
  const i = ranges.findIndex((r) => {
    const f = rangeFrames(r, first);
    return frame >= f.state1 && frame <= f.state2;
  });
  return Math.max(0, i);
}

/** Hint vide (emplacement libre). */
const freeHint = (): LevHint => ({ x: 0, y: 0, flip: 0, text: "" });

export class LabPuzzle {
  goal = "";
  /** Délai (pas de la machine) avant que le but soit vérifié (`[0x47ff34]`). */
  delay = 0;
  /** 8 emplacements ; texte vide = libre. */
  readonly hints: LevHint[] = Array.from({ length: MAX_HINTS }, freeHint);
  conditions: LabCondition[] = [];

  /** Le puzzle d'un niveau chargé au Labo : conditions rapportées aux pièces par leur index du LEV (`Part.levIndex`). */
  static fromLevel(level: Level, world: World): LabPuzzle {
    const out = new LabPuzzle();
    out.goal = level.goal;
    out.delay = level.solution.delay & 0xffff;
    level.hints.slice(0, MAX_HINTS).forEach((h, i) => {
      if (h.text !== "") out.hints[i] = { x: h.x, y: h.y, flip: h.flip ?? 0, text: h.text };
    });
    const byIndex = new Map<number, Part>();
    for (const p of [...world.statics, ...world.mobiles]) if (p.levIndex >= 0) byIndex.set(p.levIndex, p);
    for (const c of level.solution.conditions) {
      const part = c.partIndex >= 0 ? byIndex.get(c.partIndex) : undefined;
      if (part && out.conditions.length < MAX_CONDITIONS) out.conditions.push({ ...c, part });
    }
    return out;
  }

  get hasGoal(): boolean {
    return this.conditions.length > 0;
  }

  conditionOf(part: Part): LabCondition | null {
    return this.conditions.find((c) => c.part === part) ?? null;
  }

  /**
   * Pose ou remplace la condition de `part` (sans `rect` : aucune position) ; `null` retire la condition. Rend faux si la table est
   * pleine (31089).
   */
  setCondition(part: Part, value: Omit<LabCondition, "part"> | null): boolean {
    const i = this.conditions.findIndex((c) => c.part === part);
    if (value === null) {
      if (i >= 0) this.conditions.splice(i, 1);
      if (this.conditions.length === 0) this.delay = 0;
      return true;
    }
    if (i >= 0) {
      this.conditions[i] = { ...value, part };
      return true;
    }
    if (this.conditions.length >= MAX_CONDITIONS) return false;
    this.conditions.push({ ...value, part });
    return true;
  }

  /** Les conditions dont la pièce a quitté l'aire disparaissent (la pièce retirée au Labo n'existe plus). */
  prune(world: World): void {
    const here = new Set([...world.statics, ...world.mobiles]);
    this.conditions = this.conditions.filter((c) => here.has(c.part));
    if (this.conditions.length === 0) this.delay = 0;
  }

  /** Après « Arrêter » : `from[i]` est devenue `to[i]` (même ordre des listes dans la copie du monde). */
  remap(from: readonly Part[], to: readonly Part[]): void {
    const map = new Map(from.map((p, i) => [p, to[i]]));
    this.conditions = this.conditions.flatMap((c) => {
      const part = map.get(c.part);
      return part ? [{ ...c, part }] : [];
    });
  }

  /** Test de but de ces conditions (436dc6), sur le monde en marche. */
  goalTest(): GoalTest {
    const slots: GoalSlot[] = this.conditions.map((c) => ({ part: c.part, state1: c.state1, state2: c.state2, count: c.count, x: c.rectX, y: c.rectY, w: c.rectWidth, h: c.rectHeight }));
    while (slots.length < MAX_CONDITIONS) slots.push({ part: null, state1: 0, state2: 0, count: 0, x: 0, y: 0, w: 0, h: 0 });
    return new GoalTest(slots, this.hasGoal ? 1 : 0, this.delay);
  }

  /** Bloc solution du LEV : `index` donne le rang d'une pièce dans la machine (−1 : absente, la condition est perdue). */
  solution(index: (p: Part) => number): LevSolution {
    const conditions: LevCondition[] = [];
    for (const c of this.conditions) {
      const partIndex = index(c.part);
      if (partIndex < 0) continue;
      const { part: _part, ...rest } = c;
      conditions.push({ ...rest, partIndex });
    }
    while (conditions.length < MAX_CONDITIONS) conditions.push({ partIndex: -1, state1: 0, state2: 0, count: 0, rectX: 0, rectY: 0, rectWidth: 0, rectHeight: 0 });
    return { unknown00: conditions[0]!.partIndex >= 0 ? 1 : 0, conditions, delay: conditions[0]!.partIndex >= 0 ? this.delay : 0 };
  }

  // ------------------------------------------------------------------ indices

  /** Emplacements des indices écrits. */
  hintSlots(): number[] {
    return this.hints.flatMap((h, i) => (h.text !== "" ? [i] : []));
  }

  get hintCount(): number {
    return this.hintSlots().length;
  }

  /** 41f159 : nouvel indice au premier emplacement libre, en (x, y) de l'aire ; −1 si les 8 sont pris. */
  addHint(x: number, y: number, text: string): number {
    const slot = this.hints.findIndex((h) => h.text === "");
    if (slot < 0 || text === "") return -1;
    this.hints[slot] = { x, y, flip: 0, text: text.slice(0, HINT_TEXT_MAX) };
    return slot;
  }

  setHintText(slot: number, text: string): void {
    const h = this.hints[slot];
    if (h && text !== "") h.text = text.slice(0, HINT_TEXT_MAX);
  }

  /** 41f1bd (après la confirmation 31122) : l'emplacement redevient libre. */
  removeHint(slot: number): void {
    if (this.hints[slot]) this.hints[slot] = freeHint();
  }

  /** 420289 : la main tourne d'un cran (0 → 1 → 3 → 2 → 0 : bas, bas en miroir, haut en miroir, haut). */
  flipHint(slot: number): void {
    const h = this.hints[slot];
    if (h) h.flip = [1, 3, 0, 2][(h.flip ?? 0) & 3]!;
  }

  /** 42057e : la main suit le pointeur, gardée dans l'aire (largeur − 44, hauteur − 43). */
  moveHint(slot: number, x: number, y: number, fieldWidth: number, fieldHeight: number): void {
    const h = this.hints[slot];
    if (!h) return;
    h.x = Math.max(0, Math.min(x, fieldWidth - HINT_WIDTH));
    h.y = Math.max(0, Math.min(y, fieldHeight - HINT_HEIGHT));
  }

  /** Indices du LEV (8 emplacements, les libres à la fin, comme 41f159 les remplit). */
  levHints(): { hintCount: number; hints: LevHint[] } {
    const used = this.hints.filter((h) => h.text !== "").map((h) => ({ ...h }));
    while (used.length < MAX_HINTS) used.push(freeHint());
    return { hintCount: this.hintCount, hints: used };
  }
}
