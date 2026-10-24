/**
 * Noyau commun des trois puzzles de Math Workshop : Hidden Picture Puzzles, Puzzle Patterns, Super Sticklers (tâche G3).
 *
 * Tout est **pur** (aucune dépendance au DOM, au moteur ni aux ressources) sauf `attachBoard`, qui branche un plateau sur `PointerService`.
 * Les règles viennent de `docs/mathemagique/screens/{hidden,patterns,sticklers}.md` ; quand un chiffre de la fiche contredit la décompilation
 * (`archives/mathemagique/re/MATH/decomp`), c'est la décompilation qui est suivie et l'écart est noté dans `docs/mathemagique/game-kit.md`.
 *
 * Conventions : rectangles `Edges` = `(gauche, haut, droite, bas)` semi-ouverts comme les `RECT` de l'original ; le hasard est celui du jeu
 * (`MsvcRandom`), consommé **dans l'ordre exact** de l'original pour que les mélanges soient reproductibles à graine fixe.
 *
 * Module `game/` : n'écrit rien d'autre que l'état des plateaux ; les scènes (vague H) dessinent et jouent les sons.
 */
import type { Rect } from "../engine/graphics/surface";
import type { PickResult, PointerService } from "../engine/pointer";
import { NoRepeatPool, type MsvcRandom } from "../engine/rng";
import type { Cell, HiddenPuzz, PatternsPuzz, SticklersPuzz } from "./puzz";
import { LEVELS, PATTERNS_PIECES, PUZZLES_PER_LEVEL, hiddenPuzzId, shapeBases } from "./puzz";

// --- Rectangles `(gauche, haut, droite, bas)` ---

export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const edges = (left: number, top: number, right: number, bottom: number): Edges => ({ left, top, right, bottom });

/** Intersection non vide (`10b0:07f1`) : deux rectangles qui se touchent seulement par un bord ne se coupent pas. */
export function edgesIntersect(a: Edges, b: Edges): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** `PtInRect` (`10b0:0711`) : bornes gauche/haut incluses, droite/bas exclues. */
export function edgesContain(r: Edges, x: number, y: number): boolean {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/** Les deux coins `(gauche, haut)` et `(droite, bas)` de `inner` sont dans `outer` (`1018:00ae`). */
export function cornersInside(outer: Edges, inner: Edges): boolean {
  return edgesContain(outer, inner.left, inner.top) && edgesContain(outer, inner.right, inner.bottom);
}

/** `InsetRect(rect, -d, -d)` : agrandit de `d` de chaque côté (`d` négatif : rétrécit). */
export function inflate(r: Edges, dx: number, dy = dx): Edges {
  return { left: r.left - dx, top: r.top - dy, right: r.right + dx, bottom: r.bottom + dy };
}

export function offsetEdges(r: Edges, dx: number, dy: number): Edges {
  return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
}

export function edgesToRect(r: Edges): Rect {
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Modulo toujours positif (les entrées de l'original sont positives ; garde-fou pour les coordonnées négatives). */
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Zone de jeu 576×432. */
export const PLAY_EDGES = edges(0, 0, 576, 432);

/**
 * Pousse un rectangle hors d'une bande interdite (bas de la télé de Hidden, cartouche de Patterns, boutons de Sticklers) par le côté de
 * **plus faible pénétration** : vers la droite de `bande.right − gauche` si c'est strictement plus petit que `bas − bande.top`, sinon vers
 * le haut (à égalité : vers le haut). `(0, 0)` si le rectangle ne coupe pas la bande.
 */
export function pushOutOfBand(rect: Edges, band: Edges): { dx: number; dy: number } {
  if (!edgesIntersect(rect, band)) return { dx: 0, dy: 0 };
  const dx = band.right - rect.left;
  const dy = rect.bottom - band.top;
  return dx < dy ? { dx, dy: 0 } : { dx: 0, dy: -dy };
}

// --- Rotation, tolérances ---

/**
 * Orientation suivante d'une pièce à `orientations` positions (1, 2 ou 4) : `(r + 1) & (a − 1)`, donc un quart de tour **dans le sens horaire**
 * (Sticklers `1048:1701`) ; 4 pour Hidden et Patterns. Avec une seule orientation, la pièce ne tourne pas.
 */
export function nextRotation(rotation: number, orientations: 1 | 2 | 4 = 4): number {
  return (rotation + 1) & (orientations - 1);
}

/** `|dx| ≤ tolérance` et `|dy| ≤ tolérance`, bornes **incluses** (Sticklers : `JG 10`). */
export function withinTolerance(dx: number, dy: number, tolerance: number): boolean {
  return Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance;
}

/** Cible aimantée : `target` si la pièce en `(x, y)` est à moins de `tolerance` pixels (inclus) en x **et** en y, sinon `null`. */
export function snapToTarget(x: number, y: number, target: { x: number; y: number }, tolerance: number): { x: number; y: number } | null {
  return withinTolerance(x - target.x, y - target.y, tolerance) ? { x: target.x, y: target.y } : null;
}

/**
 * Aimantation sur une grille à pas `cell`, d'origine `origin`, avec arrondi au plus proche **et le décalage `−1` de l'original**
 * (hidden.md §1.5, `1030:1779`) : `origine + c × ⌊(g − origine + c/2 + 1) / c⌋ − 1`. Le coin d'une pièce posée tombe donc sur `origine − 1`
 * (53 pour une télé en 54), `origine + c − 1`, etc.
 */
export function snapAxis(g: number, origin: number, cell: number): number {
  const half = Math.floor(cell / 2);
  return origin + cell * Math.floor((g - origin + half + 1) / cell) - 1;
}

// --- Niveaux et menu de vignettes ---

export type PuzzleMode = "menu" | "playing" | "solved";

/**
 * État commun du menu : 3 « Level Brothers » (vert, orange, rouge) × 9 vignettes. Le niveau n'est **pas sauvegardé** (retour au vert à chaque
 * entrée dans la scène).
 *
 * Règle des boutons de niveau (hidden.md §1.7, patterns.md §3.2, sticklers.md §1.7) : si un puzzle est affiché (en cours **ou** terminé) ou si
 * le niveau change, on revient au menu du niveau demandé ; sinon (menu déjà affiché, même niveau) rien.
 */
export class PuzzleSession {
  level = 0;
  /** Vignette choisie (0 à 8) dans le niveau courant ; `null` au menu. */
  puzzle: number | null = null;
  mode: PuzzleMode = "menu";

  /** Bouton de niveau `level` (0 à 2). Renvoie vrai si le menu doit être (ré)affiché. */
  pressLevel(level: number): boolean {
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS) throw new RangeError(`niveau ${level} hors de 0 à ${LEVELS - 1}`);
    if (this.mode === "menu" && level === this.level) return false;
    this.level = level;
    this.puzzle = null;
    this.mode = "menu";
    return true;
  }

  /** Vignette `k` (0 à 8) cliquée dans le menu : le puzzle commence. Ignoré hors menu. */
  select(k: number): boolean {
    if (this.mode !== "menu") return false;
    if (!Number.isInteger(k) || k < 0 || k >= PUZZLES_PER_LEVEL) throw new RangeError(`puzzle ${k} hors de 0 à ${PUZZLES_PER_LEVEL - 1}`);
    this.puzzle = k;
    this.mode = "playing";
    return true;
  }

  /** Toutes les pièces sont posées : les pièces sont désactivées, la télé devient cliquable pour rejouer. */
  markSolved(): void {
    if (this.mode === "playing") this.mode = "solved";
  }

  /** Reset (bouton 5) : seulement si un puzzle est affiché ; ré-active les pièces d'un puzzle terminé. */
  reset(): boolean {
    if (this.mode === "menu") return false;
    this.mode = "playing";
    return true;
  }

  /** Les pièces réagissent (bit 0 de `31ce` à 0) : puzzle en cours seulement. */
  get piecesEnabled(): boolean {
    return this.mode === "playing";
  }

  /** La télé rejoue l'animation (groupe 3 actif) : puzzle terminé seulement. */
  get replayEnabled(): boolean {
    return this.mode === "solved";
  }
}

/** Disposition des 9 vignettes 72×72 (grille 3×3) du menu d'une activité. */
export interface ThumbLayout {
  x0: number;
  y0: number;
  pitchX: number;
  pitchY: number;
}

export const THUMB_SIZE = 72;

export const THUMB_LAYOUTS = {
  /** `gauche 59 + 78·col, haut 56 + 78·ligne` (hidden.md §3.1). */
  hidden: { x0: 59, y0: 56, pitchX: 78, pitchY: 78 },
  /** `(84 + 78·c, 82 + 78·r)` (patterns.md §3.2). */
  patterns: { x0: 84, y0: 82, pitchX: 78, pitchY: 78 },
  /** `x ∈ {50, 130, 210}`, `y ∈ {38, 118, 198}` (sticklers.md §3.4). */
  sticklers: { x0: 50, y0: 38, pitchX: 80, pitchY: 80 },
} as const satisfies Record<string, ThumbLayout>;

/** Rectangle de la vignette `k` (0 à 8, ligne par ligne). */
export function thumbRect(layout: ThumbLayout, k: number): Rect {
  if (!Number.isInteger(k) || k < 0 || k >= PUZZLES_PER_LEVEL) throw new RangeError(`vignette ${k} hors de 0 à ${PUZZLES_PER_LEVEL - 1}`);
  return { x: layout.x0 + layout.pitchX * (k % 3), y: layout.y0 + layout.pitchY * Math.floor(k / 3), w: THUMB_SIZE, h: THUMB_SIZE };
}

/** Vignette (0 à 8) sous le point, ou −1. */
export function thumbAt(layout: ThumbLayout, x: number, y: number): number {
  for (let k = 0; k < PUZZLES_PER_LEVEL; k++) {
    const r = thumbRect(layout, k);
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return k;
  }
  return -1;
}

/** Cadre de survol : la vignette agrandie de 4 px de chaque côté (hidden.md §3.2, patterns.md §3.3, sticklers.md §3.4). */
export function thumbHoverFrame(layout: ThumbLayout, k: number): Rect {
  const r = thumbRect(layout, k);
  return { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 };
}

// --- Plateaux : interface commune et adaptateur de la pièce portée ---

/** Ce que `attachBoard` demande à un plateau. Les trois plateaux ci-dessous l'implémentent. */
export interface CarriableBoard<T> {
  /** Pièce prise par un appui en `(x, y)` (la pièce du dessus d'abord), avec son rectangle, ou `null`. */
  pickAt(x: number, y: number): PickResult<T> | null;
  /** La pièce vient d'être prise : remontée au rang 0, désaimantée, autres pièces ré-aimantées. */
  lift(piece: T): void;
  /** La pièce portée est en `(x, y)` (coin haut-gauche du rectangle englobant). */
  moveTo(piece: T, x: number, y: number): void;
  /** La pièce est déposée (poussée hors de la bande interdite, aimantée si possible). */
  drop(piece: T): DropOutcome;
}

export interface DropOutcome {
  /** La pièce est maintenant posée. */
  placed: boolean;
  /** Toutes les pièces sont posées / la solution est atteinte. */
  complete: boolean;
}

export interface BoardHooks<T> {
  /** Après `lift` : son de prise (5012 / 6512 / 2012), redessin. */
  picked?(piece: T): void;
  /** Après chaque déplacement. */
  moved?(piece: T): void;
  /** Après `drop` : son de dépose en mode cliquer-poser (5013 / 6513 / 2013), test de fin, redessin. */
  dropped?(piece: T, outcome: DropOutcome): void;
}

/**
 * Branche un plateau sur le `PointerService` (cliquer-poser ou glisser selon la préférence du roster) : `pointer.source` demande les prises au
 * plateau, `pointer.listener` répercute prise, suivi et dépose. `pointer.bounds` reste à la zone de jeu (les pièces restent entièrement à l'écran).
 * Renvoie une fonction qui détache le plateau (sortie de scène : `services.endScene()` remet de toute façon le pointeur à zéro).
 */
export function attachBoard<T>(pointer: PointerService<unknown>, board: CarriableBoard<T>, hooks: BoardHooks<T> = {}): () => void {
  const source = { pick: (x: number, y: number) => board.pickAt(x, y) };
  const listener = {
    onPick: (carried: { item: unknown }) => {
      const piece = carried.item as T;
      board.lift(piece);
      hooks.picked?.(piece);
    },
    onMove: (carried: { item: unknown; x: number; y: number }) => {
      const piece = carried.item as T;
      board.moveTo(piece, carried.x, carried.y);
      hooks.moved?.(piece);
    },
    onDrop: (carried: { item: unknown; x: number; y: number }) => {
      const piece = carried.item as T;
      board.moveTo(piece, carried.x, carried.y);
      hooks.dropped?.(piece, board.drop(piece));
    },
  };
  pointer.source = source;
  pointer.listener = listener;
  return () => {
    if (pointer.source === source) pointer.source = null;
    if (pointer.listener === listener) pointer.listener = {};
  };
}

// =====================================================================================================================================
// Hidden Picture Puzzles (hidden.md)
// =====================================================================================================================================

export const HIDDEN = {
  /** Écran de la télé (`DS:1a1c`), origine de la grille. */
  tv: edges(54, 51, 292, 289),
  /** Côté de la grille en pixels : `cellule × (4 + niveau)`. */
  tvSide: 240,
  /** La pièce doit tenir dans la télé élargie de 15 px pour s'aimanter (`InsetRect(−15, −15)`). */
  snapMargin: 15,
  /** Pile de pièces (`DS:1a14`). */
  pile: edges(332, 35, 544, 398),
  /** Largeur de la pile (212) : une pièce plus large est tournée une fois de plus. */
  pileWidth: 212,
  /** Bande du bas de la télé, interdite aux pièces (`DS:1a44`). */
  bottomBand: edges(0, 304, 298, 432),
  /** Candidats de dispersion tirés par pièce (`1030:0c67`). */
  scatterTries: 10,
} as const;

export function hiddenCellSize(level: number): number {
  return HIDDEN.tvSide / (level + 4);
}

/** Cellules de côté de la grille : 4, 5 ou 6. */
export function hiddenGridSize(level: number): number {
  return level + 4;
}

export interface HiddenPiece {
  /** Rang dans le `PUZZ` (stable : le tableau du plateau est réordonné à chaque prise). */
  id: number;
  cells: Cell[];
  /** Largeur et hauteur en cellules. */
  w: number;
  h: number;
  /** Centre en pixels (`+0x94`, `+0x96`). */
  cx: number;
  cy: number;
  placed: boolean;
}

export function makeHiddenPieces(puzz: HiddenPuzz): HiddenPiece[] {
  return puzz.pieces.map((def, id) => {
    const cells = def.cells.map((c) => ({ ...c }));
    return {
      id,
      cells,
      w: Math.max(...cells.map((c) => c.x)) + 1,
      h: Math.max(...cells.map((c) => c.y)) + 1,
      cx: 0,
      cy: 0,
      placed: false,
    };
  });
}

/** Rectangle englobant (`1030:0e9d`) : `gauche = cx − ⌊L·c/2⌋`, `droite = gauche + L·c` (idem en y). */
export function hiddenBounds(piece: HiddenPiece, c: number): Edges {
  const left = piece.cx - Math.floor((piece.w * c) / 2);
  const top = piece.cy - Math.floor((piece.h * c) / 2);
  return { left, top, right: left + piece.w * c, bottom: top + piece.h * c };
}

/** Rectangles `c × c` des cellules d'une pièce dont le coin haut-gauche est `(left, top)`. */
export function hiddenCellRects(piece: HiddenPiece, left: number, top: number, c: number): Edges[] {
  return piece.cells.map((cell) => ({ left: left + cell.x * c, top: top + cell.y * c, right: left + (cell.x + 1) * c, bottom: top + (cell.y + 1) * c }));
}

/**
 * Un quart de tour horaire (`1030:16b9`) : la cellule `(a, b)` d'une pièce de hauteur `H` devient `(H − 1 − b, a)`, puis largeur et hauteur
 * sont échangées. Le centre ne bouge pas (voir `clampHiddenCenter` pour le rappel dans l'écran).
 */
export function rotateHiddenCells(piece: HiddenPiece): void {
  const h = piece.h;
  for (const cell of piece.cells) {
    const a = cell.x;
    cell.x = h - 1 - cell.y;
    cell.y = a;
  }
  [piece.w, piece.h] = [piece.h, piece.w];
}

/** Ramène le centre dans la zone de jeu rétrécie de la demi-pièce (`1030:14c5` : `InsetRect` puis `10b0:068c`) : la pièce reste entièrement à l'écran. */
export function clampHiddenCenter(piece: HiddenPiece, c: number): void {
  const dx = Math.floor((piece.w * c) / 2);
  const dy = Math.floor((piece.h * c) / 2);
  piece.cx = clamp(piece.cx, PLAY_EDGES.left + dx, PLAY_EDGES.right - dx);
  piece.cy = clamp(piece.cy, PLAY_EDGES.top + dy, PLAY_EDGES.bottom - dy);
}

/**
 * Coin haut-gauche aligné sur la grille pour un coin `(left, top)` (formule du §1.5, **vérifiée sur la décompilation** `1030:1779`) :
 * `x = 54 + c × ⌊(left − 54 + c/2 + 1) / c⌋ − 1`. Avec `c = 60` : 54 → 53, 82 → 53, 83 → 113, 84 → 113.
 * (La fiche, §8, donnait 83 → 53 : écart avec son propre §1.5 et avec le code.)
 */
export function snapCorner(left: number, top: number, c: number): { x: number; y: number } {
  return { x: snapAxis(left, HIDDEN.tv.left, c), y: snapAxis(top, HIDDEN.tv.top, c) };
}

/** Une cellule candidate (placée en `left, top`) coupe-t-elle une cellule d'une autre pièce ? (`1030:1256` / `17f7`, d'abord le rectangle englobant.) */
export function hiddenOverlaps(piece: HiddenPiece, left: number, top: number, others: readonly HiddenPiece[], c: number): boolean {
  const mine = hiddenCellRects(piece, left, top, c);
  for (const other of others) {
    if (other === piece) continue;
    const bounds = hiddenBounds(other, c);
    const theirs = hiddenCellRects(other, bounds.left, bounds.top, c);
    for (const a of mine) if (edgesIntersect(a, bounds) && theirs.some((b) => edgesIntersect(a, b))) return true;
  }
  return false;
}

/**
 * `1030:0be7` : tentative d'aimantation d'une pièce non posée. Conditions : son rectangle englobant (les deux coins) tient dans la télé élargie
 * de 15 px, et la position alignée ne coupe aucune cellule d'une autre pièce de `others` (posée ou non). Renvoie le nouveau centre, ou `null`.
 */
export function trySnapHidden(piece: HiddenPiece, others: readonly HiddenPiece[], c: number): { cx: number; cy: number } | null {
  if (piece.placed) return null;
  const bounds = hiddenBounds(piece, c);
  if (!cornersInside(inflate(HIDDEN.tv, HIDDEN.snapMargin), bounds)) return null;
  const aligned = snapCorner(bounds.left, bounds.top, c);
  if (hiddenOverlaps(piece, aligned.x, aligned.y, others, c)) return null;
  return { cx: piece.cx + (aligned.x - bounds.left), cy: piece.cy + (aligned.y - bounds.top) };
}

/** `1030:0b59`, étape 1 : la pièce (cellules, pas seulement le rectangle) touche la bande du bas ; déplacement de son centre pour l'en sortir, sinon `(0, 0)`. */
export function pushOutOfBottomBand(piece: HiddenPiece, c: number): { dx: number; dy: number } {
  const bounds = hiddenBounds(piece, c);
  const band = HIDDEN.bottomBand;
  const touches = edgesIntersect(bounds, band) && hiddenCellRects(piece, bounds.left, bounds.top, c).some((cell) => edgesIntersect(cell, band));
  return touches ? pushOutOfBand(bounds, band) : { dx: 0, dy: 0 };
}

/**
 * Dispersion initiale dans la pile (`1030:0c67`, aussi appelée par Reset), pour chaque pièce de `n − 1` à `0` :
 *  1. `placée = faux` ; `rand(4)` quarts de tour ; un de plus si la largeur en pixels dépasse la pile (212) ;
 *  2. jusqu'à 10 centres `(gauche + rand(l), haut + rand(h))` dans la pile rétrécie d'une demi-pièce (`+1`) ; on garde **le premier** qui recouvre
 *     le moins de pièces déjà placées par la dispersion (rang supérieur), arrêt dès 0.
 * Hypothèse (arguments perdus par le décompilateur) : `rand(l)` et `rand(h)` = `rand1`, tirage dans `[0, l[` et `[0, h[` ; `rand(4)` = `rand1(4)`.
 */
export function scatterHidden(pieces: HiddenPiece[], level: number, rng: MsvcRandom): void {
  const c = hiddenCellSize(level);
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]!;
    piece.placed = false;
    const turns = rng.rand1(4);
    for (let t = 0; t < turns; t++) rotateHiddenCells(piece);
    if (piece.w * c > HIDDEN.pileWidth) rotateHiddenCells(piece);
    // `FUN_10b0_075e(H·(c/2)+1, L·(c/2)+1)` : le premier argument listé par le décompilateur est dy (ordre de pile inversé), donc dx = L·(c/2)+1.
    const insetArea = inflate(HIDDEN.pile, -(piece.w * (c >> 1) + 1), -(piece.h * (c >> 1) + 1));
    const width = insetArea.right - insetArea.left;
    const height = insetArea.bottom - insetArea.top;
    let bestScore = 0x7fff;
    let best = { cx: insetArea.left, cy: insetArea.top };
    for (let tries = 0; tries < HIDDEN.scatterTries && bestScore !== 0; tries++) {
      piece.cx = insetArea.left + rng.rand1(width);
      piece.cy = insetArea.top + rng.rand1(height);
      const mine = hiddenBounds(piece, c);
      let score = 0;
      for (let j = pieces.length - 1; j > i; j--) if (edgesIntersect(mine, hiddenBounds(pieces[j]!, c))) score++;
      if (score < bestScore) {
        bestScore = score;
        best = { cx: piece.cx, cy: piece.cy };
      }
    }
    piece.cx = best.cx;
    piece.cy = best.cy;
  }
}

/** Fin : toutes les pièces ont le drapeau « posée » (`1030:1db5`) ; comme la somme des cellules vaut `N²`, c'est un pavage exact. */
export function hiddenComplete(pieces: readonly HiddenPiece[]): boolean {
  return pieces.every((p) => p.placed);
}

/**
 * Tirage du découpage (`1030:18eb`) : `13af(0, 9, &historique[niveau])`, un historique de 32 bits par niveau, non sauvegardé, qui vit le temps de la
 * scène. L'identifiant `PUZZ` est `1000 + 32 × niveau + tirage`. `Reset` ne retire pas de nouveau tirage.
 */
export class HiddenSelection {
  readonly pools: NoRepeatPool[] = Array.from({ length: LEVELS }, () => new NoRepeatPool(PUZZLES_PER_LEVEL));

  /** Tire un découpage (0 à 8) du niveau, sans remise ; renvoie aussi l'id `PUZZ`. */
  draw(level: number, rng: MsvcRandom): { draw: number; puzzId: number } {
    const pool = this.pools[level];
    if (!pool) throw new RangeError(`niveau ${level} hors de 0 à ${LEVELS - 1}`);
    const draw = pool.pick(rng);
    return { draw, puzzId: hiddenPuzzId(level, draw) };
  }
}

/** Jingle de fin : `SND 5020 + rand(4)` tiré au lancement du puzzle (`DS:50ec`). */
export function hiddenEndJingle(rng: MsvcRandom): number {
  return 5020 + rng.rand1(4);
}

/**
 * Plateau de Hidden : tableau de pièces **dans l'ordre d'empilement** (indice 0 = dessus = dernière pièce prise, comme `DS:519c`).
 * `lift` / `drop` / `rotateLast` suivent `1030:08d1`, `0b59` et `14c5`.
 */
export class HiddenBoard implements CarriableBoard<HiddenPiece> {
  readonly cell: number;
  /** Rang 0 = dessus. */
  pieces: HiddenPiece[];

  constructor(
    readonly level: number,
    puzz: HiddenPuzz,
  ) {
    this.cell = hiddenCellSize(level);
    this.pieces = makeHiddenPieces(puzz);
  }

  get complete(): boolean {
    return hiddenComplete(this.pieces);
  }

  /** (Re)disperse les pièces dans la pile ; l'ordre d'empilement est conservé (Reset : même découpage, nouvelle dispersion). */
  scatter(rng: MsvcRandom): void {
    scatterHidden(this.pieces, this.level, rng);
  }

  boundsOf(piece: HiddenPiece): Edges {
    return hiddenBounds(piece, this.cell);
  }

  /** Test de prise (`1030:119b`) : rectangle englobant puis **cellule** ; la première pièce touchée dans l'ordre d'empilement gagne. */
  pickAt(x: number, y: number): PickResult<HiddenPiece> | null {
    for (const piece of this.pieces) {
      const b = this.boundsOf(piece);
      if (!edgesContain(b, x, y)) continue;
      if (hiddenCellRects(piece, b.left, b.top, this.cell).some((r) => edgesContain(r, x, y))) {
        return { item: piece, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top };
      }
    }
    return null;
  }

  /**
   * Prise (`08d1`) : la pièce passe en tête du tableau et n'est plus posée ; toutes les **autres pièces non posées** sont retestées de `n − 1`
   * à 1 (une pièce flottante entièrement sur la télé et sans chevauchement s'aimante sans avoir été déposée). La pièce portée (rang 0) n'est
   * jamais un obstacle.
   */
  lift(piece: HiddenPiece): void {
    const index = this.pieces.indexOf(piece);
    if (index < 0) throw new Error("HiddenBoard.lift : pièce inconnue");
    if (index > 0) {
      this.pieces.splice(index, 1);
      this.pieces.unshift(piece);
    }
    piece.placed = false;
    const obstacles = this.pieces.slice(1);
    for (let i = this.pieces.length - 1; i >= 1; i--) {
      const other = this.pieces[i]!;
      const snap = trySnapHidden(other, obstacles, this.cell);
      if (snap) {
        other.cx = snap.cx;
        other.cy = snap.cy;
        other.placed = true;
      }
    }
  }

  /** Suivi de la pièce : `x, y` est le coin haut-gauche du rectangle englobant (`PointerService`). */
  moveTo(piece: HiddenPiece, x: number, y: number): void {
    piece.cx = x + Math.floor((piece.w * this.cell) / 2);
    piece.cy = y + Math.floor((piece.h * this.cell) / 2);
  }

  /** Dépose de la pièce du rang 0 (`0b59`) : poussée hors de la bande du bas, aimantation, test de fin. */
  drop(piece: HiddenPiece = this.pieces[0]!): DropOutcome {
    const push = pushOutOfBottomBand(piece, this.cell);
    piece.cx += push.dx;
    piece.cy += push.dy;
    clampHiddenCenter(piece, this.cell);
    const snap = trySnapHidden(piece, this.pieces.slice(1), this.cell);
    if (snap) {
      piece.cx = snap.cx;
      piece.cy = snap.cy;
      piece.placed = true;
    }
    return { placed: piece.placed, complete: this.complete };
  }

  /**
   * Rotation de la dernière pièce prise (`14c5`, bouton Rotate ou Espace) : si elle n'est pas tenue (`held = false`), elle est reprise (`lift`),
   * tournée, ramenée dans l'écran, puis redéposée (donc éventuellement alignée). Renvoie le résultat de la dépose, `null` si la pièce est tenue.
   * L'appelant vérifie les gardes (Poly à l'écran, pièces désactivées) et joue le son 5005.
   */
  rotateLast(held: boolean): DropOutcome | null {
    const piece = this.pieces[0];
    if (!piece) return null;
    if (!held) this.lift(piece);
    rotateHiddenCells(piece);
    clampHiddenCenter(piece, this.cell);
    return held ? null : this.drop(piece);
  }
}

// =====================================================================================================================================
// Puzzle Patterns (patterns.md)
// =====================================================================================================================================

export const PATTERNS = {
  grid: { x: 78, y: 76, cell: 60, cols: 4, rows: 4 },
  /** Grille `(78, 76, 318, 316)` élargie de 20 px : les deux coins de la pièce doivent y tenir (`10b0:075e(−20, −20)`). */
  snapRegion: edges(58, 56, 338, 336),
  /** Cartouche des boutons, interdit aux pièces (`DS:1cac`). */
  toolbar: edges(0, 354, 351, 432),
  /** Zone de jeu des pièces (hypothèse `DS:8bce` = écran). */
  screen: PLAY_EDGES,
  /** Pile : centre du slot `s` = `(513 − 29·(s mod 4), PILE_Y[⌊s/4⌋] − 17·(s mod 4))`. */
  pileX: 513,
  pileY: [315, 156],
  pieceCount: PATTERNS_PIECES,
} as const;

export interface PatternsPiece {
  /** Identifiant de pièce (0 à 7), indice dans le `PUZZ`. */
  id: number;
  placed: boolean;
  /** Rotation 0 à 3 (0 = orientation correcte). */
  rot: number;
  /** Case haut-gauche une fois posée, −1 sinon. */
  col: number;
  row: number;
  /** Dimensions en cases (1×2 ou 2×1). */
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** Rectangle de la pièce (`1040:0eed`) : `gauche = cx − ⌊(60·larg + 1)/2⌋`, `droite = gauche + 60·larg + 1` (idem en y) : 61×121 ou 121×61. */
export function pieceRect(cx: number, cy: number, w: number, h: number): Edges {
  const cell = PATTERNS.grid.cell;
  const left = cx - Math.floor((cell * w + 1) / 2);
  const top = cy - Math.floor((cell * h + 1) / 2);
  return { left, top, right: left + cell * w + 1, bottom: top + cell * h + 1 };
}

export const patternsRect = (piece: PatternsPiece): Edges => pieceRect(piece.cx, piece.cy, piece.w, piece.h);

/** Quart de tour horaire (`1040:13a8`) : `larg` et `haut` échangées, `rot = (rot + 1) mod 4`. Le centre est conservé (voir `clampPatternsCenter`). */
export function rotatePatternsPiece(piece: PatternsPiece): void {
  [piece.w, piece.h] = [piece.h, piece.w];
  piece.rot = nextRotation(piece.rot, 4);
}

/** Ramène le centre dans l'écran rétréci de la demi-pièce (`1040:1005`) : la pièce reste entièrement à l'écran. */
export function clampPatternsCenter(piece: PatternsPiece): void {
  const r = patternsRect(piece);
  const hx = piece.cx - r.left;
  const hy = piece.cy - r.top;
  piece.cx = clamp(piece.cx, PATTERNS.screen.left + hx, PATTERNS.screen.right - (r.right - r.left - hx));
  piece.cy = clamp(piece.cy, PATTERNS.screen.top + hy, PATTERNS.screen.bottom - (r.bottom - r.top - hy));
}

/** Poussée hors du cartouche (`1040:0c24` étape 1), voir `pushOutOfBand` : bas 380 / gauche 300 → haut de 26 ; gauche 340 → droite de 11. */
export function pushOutOfToolbar(rect: Edges): { dx: number; dy: number } {
  return pushOutOfBand(rect, PATTERNS.toolbar);
}

export interface PatternsSnap {
  cx: number;
  cy: number;
  col: number;
  row: number;
}

/**
 * Aimantation (`1040:0d02`, `13d7`, `1429`) d'une pièce non posée. `ranked` : les pièces dans l'ordre d'empilement (rang 0 = pièce tenue ou
 * déposée, jamais testée ; la pièce elle-même est ignorée).
 *  1. les deux coins du rectangle tiennent dans `(58, 56, 338, 336)` (grille + 20 px) ;
 *  2. nouveau centre `cx + 30 − ((gauche − 78 + 30) mod 60)` (idem en y, origine 76) : arrondi à la case, égalité vers le bas / la droite ;
 *  3. le rectangle décalé, rétréci de 1 px à droite et en bas, ne coupe aucune autre pièce de rang ≥ 1 (elles aussi rétrécies de 1 px, posées ou libres).
 * Pas de test de « bonne case » : n'importe quelle case libre convient.
 */
export function trySnap(piece: PatternsPiece, ranked: readonly PatternsPiece[]): PatternsSnap | null {
  if (piece.placed) return null;
  const rect = patternsRect(piece);
  if (!cornersInside(PATTERNS.snapRegion, rect)) return null;
  const { x, y, cell } = PATTERNS.grid;
  const dx = Math.floor(cell / 2) - mod(rect.left - x + Math.floor(cell / 2), cell);
  const dy = Math.floor(cell / 2) - mod(rect.top - y + Math.floor(cell / 2), cell);
  const moved = offsetEdges(rect, dx, dy);
  const shrunk = { ...moved, right: moved.right - 1, bottom: moved.bottom - 1 };
  for (let i = 1; i < ranked.length; i++) {
    const other = ranked[i]!;
    if (other === piece) continue;
    const r = patternsRect(other);
    if (edgesIntersect(shrunk, { ...r, right: r.right - 1, bottom: r.bottom - 1 })) return null;
  }
  return { cx: piece.cx + dx, cy: piece.cy + dy, col: Math.floor((moved.left - x) / cell), row: Math.floor((moved.top - y) / cell) };
}

/**
 * Mélange (`1040:0d83`, aussi appelé par Reset), **tel que dans l'original, non uniforme** :
 *  1. permutation `a = [0..7]`, puis pour `i = 0..7` : `j = rand1(8)` et échange de `a[i]` et `a[j]` (`j` libre dans `[0, 8[`, pas Fisher-Yates) ;
 *  2. remplissage du slot 7 au slot 0 (le slot 0 finit au premier plan) : pièce `a[s]`, `rot = orient`, 1×2, centre `(513 − 29·(s mod 4), [315, 156][⌊s/4⌋] − 17·(s mod 4))` ;
 *  3. une fois sur deux (`rand1(2) ≠ 0`, tirage fait slot par slot) : deux quarts de tour de plus, `rot += 2` sans changer les dimensions.
 * Rend le tableau dans l'ordre des rangs : l'indice 0 est le dessus.
 */
export function dealPatterns(puzzle: PatternsPuzz, rng: MsvcRandom): PatternsPiece[] {
  const a = Array.from({ length: PATTERNS.pieceCount }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const j = rng.rand1(a.length);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  const pieces: PatternsPiece[] = new Array<PatternsPiece>(a.length);
  for (let s = a.length - 1; s >= 0; s--) {
    const id = a[s]!;
    const piece: PatternsPiece = {
      id,
      placed: false,
      rot: puzzle.orient[id]!,
      col: -1,
      row: -1,
      w: 1,
      h: 2,
      cx: PATTERNS.pileX - 29 * (s % 4),
      cy: PATTERNS.pileY[Math.floor(s / 4)]! - 17 * (s % 4),
    };
    if (rng.rand1(2) !== 0) piece.rot = (piece.rot + 2) % 4;
    pieces[s] = piece;
  }
  return pieces;
}

/** Victoire (`1040:14e3`) : chaque pièce posée **à sa case** (comparaison de l'identifiant, deux pièces d'aspect identique ne sont pas interchangeables) et `rot = 0`. */
export function patternsSolved(pieces: readonly PatternsPiece[], puzzle: PatternsPuzz): boolean {
  return pieces.length === PATTERNS.pieceCount && pieces.every((p) => p.placed && p.rot === 0 && p.col === puzzle.col[p.id] && p.row === puzzle.row[p.id]);
}

/** Voix de fin : `SND 6520 + rand(4)`. */
export function patternsEndVoice(rng: MsvcRandom): number {
  return 6520 + rng.rand1(4);
}

/** Plateau de Patterns : rang 0 = dessus (`DS:5818`). `grab: "center"` : le centre de la pièce suit le curseur. */
export class PatternsBoard implements CarriableBoard<PatternsPiece> {
  pieces: PatternsPiece[] = [];

  constructor(readonly puzzle: PatternsPuzz) {}

  /** Mélange (choix d'un puzzle et Reset). */
  deal(rng: MsvcRandom): void {
    this.pieces = dealPatterns(this.puzzle, rng);
  }

  get solved(): boolean {
    return patternsSolved(this.pieces, this.puzzle);
  }

  /** Prise : rectangle englobant (pas de test au pixel), pièce du dessus d'abord, centre qui suit le curseur. */
  pickAt(x: number, y: number): PickResult<PatternsPiece> | null {
    for (const piece of this.pieces) {
      const r = patternsRect(piece);
      if (edgesContain(r, x, y)) return { item: piece, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, grab: "center" };
    }
    return null;
  }

  /** Prise (`1040:09c3`) : rang 0, non posée, puis ré-aimantation des autres pièces non posées, rangs 7 à 1. */
  lift(piece: PatternsPiece): void {
    const index = this.pieces.indexOf(piece);
    if (index < 0) throw new Error("PatternsBoard.lift : pièce inconnue");
    if (index > 0) {
      this.pieces.splice(index, 1);
      this.pieces.unshift(piece);
    }
    piece.placed = false;
    piece.col = -1;
    piece.row = -1;
    for (let i = this.pieces.length - 1; i >= 1; i--) {
      const other = this.pieces[i]!;
      const snap = trySnap(other, this.pieces);
      if (snap) this.apply(other, snap);
    }
  }

  moveTo(piece: PatternsPiece, x: number, y: number): void {
    const r = patternsRect(piece);
    piece.cx = x + (piece.cx - r.left);
    piece.cy = y + (piece.cy - r.top);
  }

  /** Dépôt (`1040:0c24`) : poussée hors du cartouche, aimantation (sinon la pièce reste libre où elle est), test de victoire. */
  drop(piece: PatternsPiece = this.pieces[0]!): DropOutcome {
    const push = pushOutOfToolbar(patternsRect(piece));
    piece.cx += push.dx;
    piece.cy += push.dy;
    const snap = trySnap(piece, this.pieces);
    if (snap) this.apply(piece, snap);
    return { placed: piece.placed, complete: this.solved };
  }

  /** Rotation de la dernière pièce prise (`1040:11b2`) ; mêmes règles que `HiddenBoard.rotateLast`. */
  rotateLast(held: boolean): DropOutcome | null {
    const piece = this.pieces[0];
    if (!piece) return null;
    if (!held) this.lift(piece);
    rotatePatternsPiece(piece);
    clampPatternsCenter(piece);
    return held ? null : this.drop(piece);
  }

  private apply(piece: PatternsPiece, snap: PatternsSnap): void {
    piece.cx = snap.cx;
    piece.cy = snap.cy;
    piece.col = snap.col;
    piece.row = snap.row;
    piece.placed = true;
  }
}

// =====================================================================================================================================
// Super Sticklers (sticklers.md)
// =====================================================================================================================================

export const STICKLERS = {
  /** Chevalet (zone de jeu). */
  easel: edges(37, 26, 293, 282),
  /** Chevalet élargi de 20 px : les deux coins du fragment doivent y tenir pour se coller. */
  snapArea: edges(17, 6, 313, 302),
  /** Bandeau des boutons sous le chevalet, interdit aux fragments. */
  buttons: edges(37, 282, 293, 368),
  /** Zone d'éparpillement des centres. */
  scatter: edges(295, 2, 575, 379),
  /** Miniature du niveau rouge, interdite aux candidats. */
  miniature: edges(295, 25, 395, 125),
  /** Tolérance de collage en pixels, **incluse**. */
  tolerance: 10,
  scatterCandidates: 20,
  /** Largeur au-delà de laquelle un fragment reçoit une rotation de plus (`1df4 − 1df0`). */
  wideThreshold: 280,
} as const;

/** Taille de la forme `SHAP` d'index 0-based `shapeIndex` dans la `SHPL` du puzzle (fournie par l'appelant : `shpl.shapes[i]`). */
export type ShapeSizer = (shapeIndex: number) => { w: number; h: number };

export interface StickPiece {
  id: number;
  orientations: 1 | 2 | 4;
  /** Orientation courante, 0 à `orientations − 1` (0 = bonne). */
  rotation: number;
  placed: boolean;
  /** Index 0-based de la forme d'orientation 0 dans la `SHPL` ; la forme courante est `shapeBase + rotation`. */
  shapeBase: number;
  /** Centre cible (écran). */
  targetCx: number;
  targetCy: number;
  cx: number;
  cy: number;
  /** Taille de la forme courante. */
  w: number;
  h: number;
}

/**
 * Fragments d'un puzzle : formes consécutives, cible = centre `(x + ⌊w₀/2⌋, y + ⌊h₀/2⌋)` de la forme d'orientation 0 (`SAR 1` au premier éparpillement ;
 * un Reset ne décale plus rien). Les fragments commencent posés sur leur cible, orientation 0, avant `scatterSticklers`.
 */
export function makeStickPieces(puzz: SticklersPuzz, level: number, sizeOf: ShapeSizer): StickPiece[] {
  const bases = shapeBases(puzz, level);
  return puzz.pieces.map((def, id) => {
    const base = bases[id]!;
    const { w, h } = sizeOf(base);
    const targetCx = def.x + (w >> 1);
    const targetCy = def.y + (h >> 1);
    return { id, orientations: def.orientations, rotation: 0, placed: false, shapeBase: base, targetCx, targetCy, cx: targetCx, cy: targetCy, w, h };
  });
}

/** Rectangle du fragment : `gauche = cx − ⌊w/2⌋`, `droite = gauche + w`. */
export function stickBounds(piece: StickPiece): Edges {
  const left = piece.cx - (piece.w >> 1);
  const top = piece.cy - (piece.h >> 1);
  return { left, top, right: left + piece.w, bottom: top + piece.h };
}

function setStickRotation(piece: StickPiece, rotation: number, sizeOf: ShapeSizer): void {
  piece.rotation = rotation;
  const size = sizeOf(piece.shapeBase + rotation);
  piece.w = size.w;
  piece.h = size.h;
}

/** Quart de tour (`1048:1701`, `1509`) : `(r + 1) & (a − 1)`, forme suivante ; le centre ne bouge pas puis est ramené dans l'écran (`clampStickCenter`). */
export function rotateStick(piece: StickPiece, sizeOf: ShapeSizer): void {
  setStickRotation(piece, nextRotation(piece.rotation, piece.orientations), sizeOf);
}

export function clampStickCenter(piece: StickPiece): void {
  const dx = piece.w >> 1;
  const dy = piece.h >> 1;
  piece.cx = clamp(piece.cx, PLAY_EDGES.left + dx, PLAY_EDGES.right - dx);
  piece.cy = clamp(piece.cy, PLAY_EDGES.top + dy, PLAY_EDGES.bottom - dy);
}

/**
 * Éparpillement (`1048:0cf8`, aussi Reset), pour chaque fragment dans l'ordre du `PUZZ` :
 *  - `rand(4)` rotations (soit `k mod a`), une de plus si `w > 280` ;
 *  - zone `(295, 2, 575, 379)` rétrécie de `w/2 + 1` et `h/2 + 1` ; jusqu'à **20 candidats** `(gauche + rand(l), haut + rand(h))` ; score = nombre de
 *    fragments déjà éparpillés (indices inférieurs) que le rectangle coupe ; arrêt à 0, sinon le **premier** de score minimal ;
 *  - niveau rouge : un candidat qui coupe la miniature `(295, 25, 395, 125)` est rejeté **sans compter** parmi les 20 (le tirage reprend ; garde-fou
 *    de 2000 tirages ajouté ici, l'original boucle sans limite).
 * Les fragments sont dé-collés. `rand(n)` = `rand1(n)`.
 */
export function scatterSticklers(pieces: StickPiece[], level: number, rng: MsvcRandom, sizeOf: ShapeSizer): void {
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    piece.placed = false;
    setStickRotation(piece, 0, sizeOf);
    const turns = rng.rand1(4);
    for (let t = 0; t < turns; t++) rotateStick(piece, sizeOf);
    if (piece.w > STICKLERS.wideThreshold) rotateStick(piece, sizeOf);
    const area = inflate(STICKLERS.scatter, -((piece.w >> 1) + 1), -((piece.h >> 1) + 1));
    const width = area.right - area.left;
    const height = area.bottom - area.top;
    let bestScore = 0x7fff;
    let best = { cx: area.left, cy: area.top };
    let counted = 0;
    for (let guard = 0; counted < STICKLERS.scatterCandidates && bestScore !== 0 && guard < 2000; guard++) {
      piece.cx = area.left + rng.rand1(width);
      piece.cy = area.top + rng.rand1(height);
      const mine = stickBounds(piece);
      if (level === 2 && edgesIntersect(mine, STICKLERS.miniature)) continue;
      counted++;
      let score = 0;
      for (let j = 0; j < i; j++) if (edgesIntersect(mine, stickBounds(pieces[j]!))) score++;
      if (score < bestScore) {
        bestScore = score;
        best = { cx: piece.cx, cy: piece.cy };
      }
    }
    piece.cx = best.cx;
    piece.cy = best.cy;
  }
}

/**
 * Collage (`1048:0b83` → `0c36`) : le fragment non collé, d'orientation 0, dont les deux coins (haut-gauche et bas-droite) tiennent dans le chevalet
 * élargi `(17, 6, 313, 302)` et dont le centre est à ≤ 10 px (inclus) en x **et** en y de la cible, est recentré exactement dessus. `null` sinon
 * (le fragment reste où il est, sans sanction).
 */
export function snapTarget(piece: StickPiece): { cx: number; cy: number } | null {
  if (piece.placed || piece.rotation !== 0) return null;
  if (!cornersInside(STICKLERS.snapArea, stickBounds(piece))) return null;
  const snap = snapToTarget(piece.cx, piece.cy, { x: piece.targetCx, y: piece.targetCy }, STICKLERS.tolerance);
  return snap && { cx: snap.x, cy: snap.y };
}

export function sticklersSolved(pieces: readonly StickPiece[]): boolean {
  return pieces.length > 0 && pieces.every((p) => p.placed);
}

/** Plateau de Sticklers. `hit` : test au pixel sur le masque 1 bit du fragment (fourni par la scène : `hitShapeAt`) ; l'hystérésis de 20 px reste à la scène. */
export class SticklersBoard implements CarriableBoard<StickPiece> {
  /** Rang 0 = dernier fragment saisi, testé en premier. */
  pieces: StickPiece[];

  constructor(
    readonly level: number,
    readonly puzz: SticklersPuzz,
    readonly sizeOf: ShapeSizer,
    private readonly hit: (piece: StickPiece, x: number, y: number) => boolean = (piece, x, y) => edgesContain(stickBounds(piece), x, y),
  ) {
    this.pieces = makeStickPieces(puzz, level, sizeOf);
  }

  get solved(): boolean {
    return sticklersSolved(this.pieces);
  }

  /** Éparpille (ou réparpille : Reset) les fragments, recollés à zéro. */
  scatter(rng: MsvcRandom): void {
    scatterSticklers(this.pieces, this.level, rng, this.sizeOf);
  }

  pickAt(x: number, y: number): PickResult<StickPiece> | null {
    for (const piece of this.pieces) {
      if (piece.placed || !this.hit(piece, x, y)) continue;
      const b = stickBounds(piece);
      return { item: piece, x: b.left, y: b.top, width: piece.w, height: piece.h };
    }
    return null;
  }

  /** Prise (`09df`) : le fragment passe à l'indice 0. Les fragments collés ne sont jamais repris. */
  lift(piece: StickPiece): void {
    const index = this.pieces.indexOf(piece);
    if (index < 0) throw new Error("SticklersBoard.lift : fragment inconnu");
    if (index > 0) {
      this.pieces.splice(index, 1);
      this.pieces.unshift(piece);
    }
  }

  moveTo(piece: StickPiece, x: number, y: number): void {
    piece.cx = x + (piece.w >> 1);
    piece.cy = y + (piece.h >> 1);
  }

  /** Dépose (`0b83`) : repoussé hors du bandeau des boutons, puis collage éventuel et test de fin (`17a7`). */
  drop(piece: StickPiece = this.pieces[0]!): DropOutcome {
    const push = pushOutOfBand(stickBounds(piece), STICKLERS.buttons);
    piece.cx += push.dx;
    piece.cy += push.dy;
    clampStickCenter(piece);
    const snap = snapTarget(piece);
    if (snap) {
      piece.cx = snap.cx;
      piece.cy = snap.cy;
      piece.placed = true;
    }
    return { placed: piece.placed, complete: this.solved };
  }

  /**
   * Rotation du fragment tenu, ou du dernier saisi s'il ne l'est pas (`1509`) : il pivote sur place puis est redéposé (il peut donc se coller en tournant).
   * Ignoré si le fragment du rang 0 est collé. L'appelant joue `SND 2005` et vérifie Poly / pièces désactivées.
   */
  rotateLast(held: boolean): DropOutcome | null {
    const piece = this.pieces[0];
    if (!piece || piece.placed) return null;
    rotateStick(piece, this.sizeOf);
    clampStickCenter(piece);
    return held ? null : this.drop(piece);
  }
}
