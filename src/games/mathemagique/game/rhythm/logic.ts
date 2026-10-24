/**
 * Logique pure du Rhythm Shop (rhythm.md §1) : règles des trois outils, modèle des trois bacs (Parts Bin, Pattern Bin, Fractionator),
 * glisser-déposer, victoire, recette du Teletune et progression par variantes. Aucune dépendance au DOM, à l'audio ni au hasard.
 *
 * Représentation : listes d'au plus 24 mots signés, sans zéros de fin. `v > 0` pièce de taille `v` (unités de 1/144 de mesure),
 * `v < 0` fantôme (le « trou » laissé dans le Parts Bin par une pièce sortie, ou l'emplacement vide du Pattern Bin).
 *
 * Invariant du Parts Bin : pour chaque pièce qui n'y est pas (dans le Fractionator, posée dans le Pattern Bin, ou portée), il existe un fantôme
 * de même taille. Une coupe découpe le fantôme de la pièce coupée en `n` fantômes, un collage ou une fusion regroupent ceux des pièces assemblées :
 * « Empty » (et le retour d'une pièce) redonne ainsi au bac les pièces telles qu'elles sont dans le Fractionator.
 */
import { MEASURE, SLOT_COUNT, TOOL_BUTTONS, type BinId, type Fraction, type Tool, fractionText, isValidSize, reduceFraction } from "./pieces";
import { type PlstVariant, variantTools } from "./data";
import { type ErrorType, sizeRatio } from "./errors";

// --- Règles des outils (rhythm.md §1.5) ---

/** Plus petite pièce admise à la coupe : `|q| < 9` (moins de 1/16) est refusé. */
export const MIN_CUT_SIZE = 9;

export type CutCheck = { ok: true; piece: number } | { ok: false; error: 3 | 4; ratio: number };

/**
 * `1038:0fc4(9, n, taille)` : `q = taille / n` (division entière). `|q| < 9` → erreur 3 (trop petit) ; `taille ≠ q × n` ou `q` hors de la table
 * des 30 tailles → erreur 4 ; sinon la pièce vaut `q`. `ratio = taille × 10 / n` choisit la réplique de l'erreur 3.
 */
export function checkCut(n: number, size: number): CutCheck {
  const piece = Math.trunc(size / n);
  const ratio = sizeRatio(size, n);
  if (Math.abs(piece) < MIN_CUT_SIZE) return { ok: false, error: 3, ratio };
  if (size !== piece * n || !isValidSize(piece)) return { ok: false, error: 4, ratio };
  return { ok: true, piece };
}

/** Résultat de l'évaluation d'un outil sur le contenu du Fractionator. */
export type ToolEvaluation =
  | { ok: true; /** Pièces retirées du Fractionator. */ removed: number[]; /** Pièces qui les remplacent. */ added: number[] }
  /** `error: null` : échec silencieux (rien à faire, pas de réaction d'Algebird). */
  | { ok: false; error: ErrorType | null; ratio?: number };

const silent: ToolEvaluation = { ok: false, error: null };

/**
 * `1028:38e3` : valide l'outil sur les pièces du Fractionator (positives, dans l'ordre).
 * - Cutter : exactement une pièce (sinon erreur 5), puis `checkCut` (erreurs 3 et 4) ; donne `n` pièces de taille `q`.
 * - Gluer (taille `s`) : au moins 2 pièces (sinon erreur 7), toutes de taille `s` (sinon erreur 6) ; donne une pièce de taille `somme`
 *   (le code d'origine ne vérifie pas que la somme figure dans la table : les 45 `PLST` l'évitent).
 * - Melder (cible `T`) : la somme `S` doit être une taille valide (sinon silence) ; `S < T` → erreur 2 ; `S > T` → silence (refusé dès le dépôt) ;
 *   `S = T` avec au moins 2 pièces → une pièce `T`, avec une seule → rien (silence).
 * Un Fractionator vide ne donne jamais de réaction (le bouton Do It est grisé).
 */
export function evaluateTool(sizes: readonly number[], tool: Tool): ToolEvaluation {
  if (sizes.length === 0) return silent;
  switch (tool.kind) {
    case "cut": {
      if (sizes.length !== 1) return { ok: false, error: 5 };
      const check = checkCut(tool.n, sizes[0]!);
      if (!check.ok) return { ok: false, error: check.error, ratio: check.ratio };
      return { ok: true, removed: [sizes[0]!], added: Array.from({ length: tool.n }, () => check.piece) };
    }
    case "glue": {
      if (sizes.length < 2) return { ok: false, error: 7 };
      if (sizes.some((size) => size !== tool.size)) return { ok: false, error: 6 };
      return { ok: true, removed: [...sizes], added: [sizes.reduce((sum, size) => sum + size, 0)] };
    }
    case "meld": {
      const sum = sizes.reduce((total, size) => total + size, 0);
      if (!isValidSize(sum)) return silent;
      if (sum < tool.target) return { ok: false, error: 2 };
      if (sum > tool.target || sizes.length < 2) return silent;
      return { ok: true, removed: [...sizes], added: [tool.target] };
    }
  }
}

/** Dépôt dans le Fractionator avec un Melder actif : la somme dépasserait la cible (la pièce est rendue, Algebird réagit, type 3). */
export function meldOverflow(sizes: readonly number[], size: number, tool: Tool | null): { ratio: number } | null {
  if (!tool || tool.kind !== "meld") return null;
  const sum = sizes.reduce((total, s) => total + s, 0) + size;
  return sum > tool.target ? { ratio: sizeRatio(sizes[0] ?? size, tool.target) } : null;
}

// --- Recette du Teletune (rhythm.md §8.2 n° 6) ---

export interface RecipeLine {
  /** Nombre de pièces de cette taille. */
  count: number;
  size: number;
  fraction: Fraction;
}

/** Pièces du motif regroupées par taille égale, tailles décroissantes : `[72,36,36]` → `(1) 1/2`, `(2) 1/4`. */
export function recipe(pattern: readonly number[]): RecipeLine[] {
  const counts = new Map<number, number>();
  for (const size of pattern) counts.set(size, (counts.get(size) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, count]) => ({ count, size, fraction: reduceFraction(size) }));
}

/** Format d'origine `(%d) %d/%d %s` avec `bar` si une seule pièce, `bars` sinon : `(2) 1/2 bars`. */
export function recipeLineText(line: RecipeLine): string {
  return `(${line.count}) ${fractionText(line.size)} ${line.count === 1 ? "bar" : "bars"}`;
}

export function recipeTexts(pattern: readonly number[]): string[] {
  return recipe(pattern).map(recipeLineText);
}

// --- Variantes (rhythm.md §1.3, §6) ---

/** Variante courante d'un morceau : le compteur sauvegardé, ramené à 0 s'il atteint le nombre de variantes. */
export function currentVariant(counter: number, variantCount: number): number {
  return counter >= 0 && counter < variantCount ? counter : 0;
}

/** Compteur après une première victoire : variante suivante, modulo le nombre de variantes. */
export function nextVariant(counter: number, variantCount: number): number {
  return (currentVariant(counter, variantCount) + 1) % variantCount;
}

// --- Plateau ---

/** Pièce portée par la souris : retirée de `from` à l'indice `index`. */
export interface Held {
  size: number;
  from: BinId;
  index: number;
}

export type Victory = "none" | "first" | "again";

export type DropResult =
  | { status: "placed"; bin: BinId; index: number; victory: Victory }
  | {
      status: "returned";
      /** `outside` ailleurs que dans un bac ; `refused` emplacement du Pattern Bin de taille différente (son 30004) ; `no-room` Fractionator plein ;
       * `no-ghost` Parts Bin sans fantôme de cette taille ; `meld-overflow` Melder dépassé (réaction d'Algebird `error`). */
      reason: "outside" | "refused" | "no-room" | "no-ghost" | "meld-overflow";
      error?: { type: ErrorType; ratio: number };
    };

export interface ToolSelection {
  changed: boolean;
  /** Réaction d'Algebird (type 1) : changement d'outil en laissant des pièces non fusionnées. */
  reaction?: ErrorType;
}

export type DoItResult = Extract<ToolEvaluation, { ok: true }> & { tool: Tool } | Extract<ToolEvaluation, { ok: false }>;

function withoutZeros(words: readonly number[]): number[] {
  return words.filter((v) => v !== 0);
}

const sum = (words: readonly number[]) => words.reduce((total, v) => total + v, 0);

/**
 * Un morceau en cours : les trois bacs, les 9 boutons d'outils, le test de victoire. Les tableaux se lisent par `parts`, `pattern`, `fractionator`
 * (copies). Les entrées de pièces viennent du glisser-déposer (`lift` / `drop`) ou des boutons (`doIt`, `empty`, `undo`).
 */
export class RhythmBoard {
  private partsWords: number[] = [];
  private patternWords: number[] = [];
  private fractionatorWords: number[] = [];
  private motif: number[] = [];
  private snapshot: { parts: number[]; fractionator: number[] } | null = null;
  private winCounted = false;
  private toolButtons: (Tool | null)[] = Array.from({ length: TOOL_BUTTONS }, () => null);
  private active = 0;

  constructor(motif?: readonly number[], variant?: PlstVariant) {
    if (motif && variant) this.load(motif, variant);
  }

  /** Charge un morceau (`1028:1774`) : Parts Bin = pièces de la variante, Pattern Bin = `-motif`, Fractionator vide, outil 0 (ou le premier non vide). */
  load(motif: readonly number[], variant: PlstVariant): void {
    if (sum(motif) !== MEASURE || motif.length > SLOT_COUNT) throw new Error(`Motif invalide : ${motif.join(",")}`);
    this.motif = [...motif];
    this.partsWords = withoutZeros(variant.parts);
    this.patternWords = motif.map((size) => -size);
    this.fractionatorWords = [];
    this.snapshot = null;
    this.winCounted = false;
    this.toolButtons = variantTools(variant);
    this.active = Math.max(0, this.toolButtons.findIndex((tool) => tool !== null));
  }

  get parts(): readonly number[] {
    return [...this.partsWords];
  }
  get pattern(): readonly number[] {
    return [...this.patternWords];
  }
  get fractionator(): readonly number[] {
    return [...this.fractionatorWords];
  }
  /** Contenu d'un bac par son identifiant. */
  words(bin: BinId): readonly number[] {
    return bin === "parts" ? this.partsWords : bin === "pattern" ? this.patternWords : this.fractionatorWords;
  }
  /** Motif cible (tailles, ordre des emplacements). */
  get target(): readonly number[] {
    return this.motif;
  }
  get tools(): readonly (Tool | null)[] {
    return this.toolButtons;
  }
  get activeToolIndex(): number {
    return this.active;
  }
  get activeTool(): Tool | null {
    return this.toolButtons[this.active] ?? null;
  }

  // --- Outils ---

  /**
   * Choisit un outil (clic ou touches `1`-`9`, indice 0-8). Un bouton vide, hors plage ou déjà actif ne fait rien (`1038:0da3`).
   * Hypothèse : le type 1 se déclenche quand le Fractionator garde au moins deux pièces (« pièces non fusionnées ») ; le changement a lieu quand même.
   */
  selectTool(index: number): ToolSelection {
    if (!Number.isInteger(index) || index < 0 || index >= TOOL_BUTTONS || !this.toolButtons[index] || index === this.active) return { changed: false };
    this.active = index;
    return this.fractionatorWords.length >= 2 ? { changed: true, reaction: 1 } : { changed: true };
  }

  /** Touche Tab : outil suivant non vide (circulaire). */
  nextTool(): ToolSelection {
    for (let step = 1; step < TOOL_BUTTONS; step++) {
      const index = (this.active + step) % TOOL_BUTTONS;
      if (this.toolButtons[index]) return this.selectTool(index);
    }
    return { changed: false };
  }

  /** Do It est cliquable : un outil actif et des pièces dans le Fractionator (hypothèse sur `1028:2ed1`). */
  get doItEnabled(): boolean {
    return this.activeTool !== null && this.fractionatorWords.length > 0;
  }

  /** Do It clignote : l'outil est applicable (`1028:3a38`, `DS:504c == 1`). */
  get doItReady(): boolean {
    const tool = this.activeTool;
    return tool !== null && evaluateTool(this.fractionatorWords, tool).ok;
  }

  get canEmpty(): boolean {
    return this.fractionatorWords.length > 0;
  }

  /** Undo n'est possible que juste après un Do It, tant que les pièces n'ont pas bougé (manuel : « tant que vos pièces sont dans le Fractionator »). */
  get canUndo(): boolean {
    return this.snapshot !== null && this.fractionatorWords.length > 0;
  }

  /** Bouton Do It (`FUN_1028_0000(3)`) : applique l'outil actif au Fractionator ; en cas d'échec rien ne change et `error` dit quelle réplique tirer. */
  doIt(): DoItResult {
    const tool = this.activeTool;
    if (!tool) return { ok: false, error: null };
    const result = evaluateTool(this.fractionatorWords, tool);
    if (!result.ok) return result;
    this.snapshot = { parts: [...this.partsWords], fractionator: [...this.fractionatorWords] };
    this.regroupGhosts(result.removed, result.added);
    this.fractionatorWords = [...result.added];
    return { ...result, tool };
  }

  /** Bouton Empty (`1058:024a`) : toutes les pièces du Fractionator retournent au Parts Bin (leur fantôme redevient pièce). */
  empty(): void {
    for (const size of this.fractionatorWords) {
      const ghost = this.partsWords.indexOf(-size);
      if (ghost >= 0) this.partsWords[ghost] = size;
    }
    this.fractionatorWords = [];
    this.snapshot = null;
  }

  /** Bouton Undo : rétablit le Fractionator et les fantômes d'avant le dernier Do It. */
  undo(): boolean {
    if (!this.canUndo) return false;
    this.partsWords = this.snapshot!.parts;
    this.fractionatorWords = this.snapshot!.fractionator;
    this.snapshot = null;
    return true;
  }

  /** Les fantômes du Parts Bin suivent l'opération : ceux des pièces retirées sont regroupés (ou découpés) en ceux des pièces ajoutées, à la place du premier. */
  private regroupGhosts(removed: readonly number[], added: readonly number[]): void {
    let at = this.partsWords.length;
    for (const size of removed) {
      const ghost = this.partsWords.indexOf(-size);
      if (ghost >= 0) {
        this.partsWords.splice(ghost, 1);
        at = Math.min(at, ghost);
      }
    }
    this.partsWords.splice(at, 0, ...added.map((size) => -size));
    this.partsWords.length = Math.min(this.partsWords.length, SLOT_COUNT);
  }

  // --- Glisser-déposer (rhythm.md §1.4) ---

  /**
   * Prend la pièce `index` d'un bac (son 30005). Parts Bin : la case devient un fantôme ; Fractionator : les pièces se recompactent ; Pattern Bin :
   * l'emplacement redevient vide (`-taille`). `null` sur un fantôme, du vide ou hors plage. Invalide Undo.
   */
  lift(bin: BinId, index: number): Held | null {
    const words = bin === "parts" ? this.partsWords : bin === "pattern" ? this.patternWords : this.fractionatorWords;
    const size = words[index];
    if (size === undefined || size <= 0) return null;
    if (bin === "fractionator") words.splice(index, 1);
    else words[index] = -size;
    this.snapshot = null;
    return { size, from: bin, index };
  }

  /** Le Pattern Bin accepte la pièce : l'emplacement visé contient le fantôme de la même taille. */
  canDropOnPattern(index: number, size: number): boolean {
    return this.patternWords[index] === -size;
  }

  /**
   * Relâche la pièce portée sur `bin` (`undefined` : hors de tout bac). `index` : case visée (`pieceIndexAt`), utile pour le Pattern Bin.
   * - Fractionator : ajoutée à la fin (compactage à gauche) ; refusée s'il est plein (24 cases ou plus de 144 unités) ou si un Melder dépasserait sa cible.
   * - Pattern Bin : acceptée seulement sur le fantôme de même taille.
   * - Parts Bin : la pièce retrouve son fantôme.
   * Une pièce refusée retourne d'où elle vient. Après un dépôt dans le Pattern Bin, `victory` dit si le motif est complet (`first` : première fois,
   * à compter une variante ; `again` : déjà compté).
   */
  drop(held: Held, bin: BinId | undefined, index = -1): DropResult {
    const refuse = (reason: Extract<DropResult, { status: "returned" }>["reason"], error?: { type: ErrorType; ratio: number }): DropResult => {
      this.putBack(held);
      return error ? { status: "returned", reason, error } : { status: "returned", reason };
    };
    if (bin === undefined) return refuse("outside");
    this.snapshot = null;
    if (bin === "fractionator") {
      if (this.fractionatorWords.length >= SLOT_COUNT || sum(this.fractionatorWords) + held.size > MEASURE) return refuse("no-room");
      const overflow = meldOverflow(this.fractionatorWords, held.size, this.activeTool);
      if (overflow) return refuse("meld-overflow", { type: 3, ratio: overflow.ratio });
      this.fractionatorWords.push(held.size);
      return { status: "placed", bin, index: this.fractionatorWords.length - 1, victory: "none" };
    }
    if (bin === "pattern") {
      if (!this.canDropOnPattern(index, held.size)) return refuse("refused");
      this.patternWords[index] = held.size;
      return { status: "placed", bin, index, victory: this.registerVictory() };
    }
    const ghost = this.partsWords.indexOf(-held.size);
    if (ghost < 0) return refuse("no-ghost");
    this.partsWords[ghost] = held.size;
    return { status: "placed", bin, index: ghost, victory: "none" };
  }

  private putBack(held: Held): void {
    if (held.from === "parts") this.partsWords[held.index] = held.size;
    else if (held.from === "pattern") this.patternWords[held.index] = held.size;
    else this.fractionatorWords.splice(Math.min(held.index, this.fractionatorWords.length), 0, held.size);
  }

  // --- Victoire (rhythm.md §1.7) ---

  /** Le Pattern Bin est complet : aucune case négative. */
  get complete(): boolean {
    return isPatternComplete(this.patternWords);
  }

  /** Emplacements remplis (`pattern[i] > 0`), pour la réécriture du MIDI (`rhythmRewrite`). */
  get filled(): boolean[] {
    return filledSlots(this.patternWords);
  }

  private registerVictory(): Victory {
    if (!this.complete) return "none";
    if (this.winCounted) return "again";
    this.winCounted = true;
    return "first";
  }
}

/** Pattern Bin complet : aucune case vide (négative). */
export function isPatternComplete(pattern: readonly number[]): boolean {
  return pattern.length > 0 && pattern.every((v) => v >= 0);
}

/** Drapeaux d'emplacements remplis, sur 24 cases (`pattern[i] > 0`). */
export function filledSlots(pattern: readonly number[]): boolean[] {
  return Array.from({ length: SLOT_COUNT }, (_, i) => (pattern[i] ?? 0) > 0);
}
