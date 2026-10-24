/**
 * Aide au rendu de Hidden Picture Puzzles (scène 4) : constantes d'écran, bordures des pièces, dessin du menu et du plateau.
 *
 * Tout est **pur** : des fonctions de dessin sur une `Surface`, des tables et des calculs de rectangles. La scène (`hidden.ts`) y ajoute le
 * cycle de vie, les sons et les services. Sources : `docs/mathemagique/screens/hidden.md` §1.7 (boutons), §2.2 (révélation), §2.4 (bordures),
 * §3.1 (rectangles), §3.2 (cadre de survol des vignettes).
 */
import type { Shape } from "../data/shap";
import { drawShape } from "../engine/graphics/blit";
import { ClipMask, type Rect, type Surface } from "../engine/graphics/surface";
import { edgesToRect, hiddenBounds, hiddenCellRects, thumbHoverFrame, thumbRect, THUMB_LAYOUTS, type HiddenPiece } from "../game/puzzle-kit";
import { PUZZLES_PER_LEVEL } from "../game/puzz";

// --- Identifiants de ressources de `HIDDEN.DAT` ---

export const HIDDEN_ARCHIVE = "HIDDEN.DAT";
/** `SHPL` du fond 576×432 (palette 10 à 245) : la télé vide, sans les boutons. */
export const HIDDEN_BACKGROUND_SHPL = 102;
/** `SHPL` de l'accueil des trois « Level Brothers » : `SCR` 2000. */
export const HIDDEN_WELCOME_SCR = 2000;
/** `SHPL` des 7 boutons × 2 états (repos, appui). */
export const HIDDEN_BUTTONS_SHPL = 5000;
/** `SHPL` des formes de bordure : 12 par niveau. */
export const HIDDEN_BORDERS_SHPL = 5030;
/** Musique de fond (MIDI). */
export const HIDDEN_MUSIC_SND = 100;

/** Sons (hidden.md §4). */
export const HIDDEN_SND = {
  levelFaces: [5000, 5001, 5002],
  help: 5003,
  reset: 5004,
  rotate: 5005,
  thumbHover: 5010,
  thumbClick: 5011,
  pick: 5012,
  drop: 5013,
} as const;

/** Sons préchargés à l'entrée (musique exclue : ce sont des WAVE). */
export const HIDDEN_PRELOAD: readonly number[] = [5000, 5001, 5002, 5003, 5004, 5005, 5010, 5011, 5012, 5013, 5020, 5021, 5022, 5023];

// --- Rectangles (hidden.md §3.1) ---

/** Écran de la télé, et origine de la photo (238×238 posée en `(54, 51)`). */
export const HIDDEN_TV: Rect = { x: 54, y: 51, w: 238, h: 238 };
/** La grille réelle commence en `(53, 50)` : les bordures des pièces débordent d'un pixel. */
export const HIDDEN_TV_WITH_BORDERS: Rect = { x: 53, y: 50, w: 240, h: 240 };
export const HIDDEN_SCREEN: Rect = { x: 0, y: 0, w: 576, h: 432 };
/** Épaisseur des bordures (formes de `SHPL` 5030). */
export const BORDER = 5;

/** Couleurs de palette des pièces non posées, par niveau (vert, orange, rouge : `DS:1ab4`). */
export const HIDDEN_FLAT_COLORS = [86, 61, 140] as const;
/** Couleur du cadre de survol d'une vignette, par niveau (`DS:1a5c`), et couleur d'appui (hypothèse sur `10a8:0d27`). */
export const HIDDEN_HOVER_FRAME_COLORS = [141, 139, 140] as const;
export const HIDDEN_PRESSED_FRAME_COLOR = 74;

// --- Boutons (hidden.md §1.7) ---

export type HiddenButtonId = "level0" | "level1" | "level2" | "help" | "reset" | "rotate" | "exit";

export interface HiddenButtonDef {
  id: HiddenButtonId;
  /** `(gauche, haut, droite, bas)` de la table `DS:1994`. */
  edges: readonly [number, number, number, number];
  /** Second rectangle de la table `DS:1994` (« appuyé », lu dans `MATH`) : la forme d'appui y est posée, pas au coin du rectangle de repos. */
  pressedEdges: readonly [number, number, number, number];
  /** Indices (1-based) des formes de `SHPL` 5000 : repos, appui. */
  shapes: readonly [number, number];
  /** Clé de zone de l'aide de Poly (`HIDDEN_POLY.topics`). */
  zone: "level" | "help" | "reset" | "rotate" | "exit";
}

export const HIDDEN_BUTTONS: readonly HiddenButtonDef[] = [
  { id: "level0", edges: [52, 308, 85, 340], pressedEdges: [54, 309, 85, 340], shapes: [1, 2], zone: "level" },
  { id: "level1", edges: [88, 308, 121, 340], pressedEdges: [90, 309, 121, 340], shapes: [3, 4], zone: "level" },
  { id: "level2", edges: [124, 308, 157, 340], pressedEdges: [126, 309, 157, 340], shapes: [5, 6], zone: "level" },
  { id: "help", edges: [228, 306, 261, 338], pressedEdges: [230, 307, 261, 338], shapes: [7, 8], zone: "help" },
  { id: "reset", edges: [52, 346, 94, 378], pressedEdges: [54, 348, 94, 378], shapes: [9, 10], zone: "reset" },
  { id: "rotate", edges: [265, 307, 298, 339], pressedEdges: [267, 308, 298, 339], shapes: [11, 12], zone: "rotate" },
  { id: "exit", edges: [116, 346, 157, 378], pressedEdges: [118, 348, 157, 378], shapes: [13, 14], zone: "exit" },
];

/** Zone cliquable de Poly (aide) et télé (`DS:1a04`, `1a1c`). */
export const HIDDEN_POLY_ZONE = [311, 280, 388, 432] as const;
export const HIDDEN_TV_EDGES = [54, 51, 292, 289] as const;

// --- Bordures des pièces (hidden.md §2.4) ---

/** Formes de côté : N, E, S, W → 2, 3, 4, 1 si la voisine de ce côté est absente. */
const SIDE_SHAPES = { n: 2, e: 3, s: 4, w: 1 } as const;
/** Coins convexes (deux côtés adjacents absents) et concaves (deux côtés présents, diagonale absente) : NO, NE, SE, SO. */
const CONVEX = { nw: 9, ne: 11, se: 12, sw: 10 } as const;
const CONCAVE = { nw: 5, ne: 7, se: 8, sw: 6 } as const;

export interface CellBorders {
  /** Colonne et ligne de la cellule dans la pièce. */
  x: number;
  y: number;
  /** Formes de bordure (1 à 12, 0 : aucune). */
  n: number;
  e: number;
  s: number;
  w: number;
  nw: number;
  ne: number;
  se: number;
  sw: number;
}

/** Côtés et coins de bordure de chaque cellule, **recalculés** pour la forme actuelle de la pièce (après chaque rotation). */
export function pieceBorders(piece: Pick<HiddenPiece, "cells">): CellBorders[] {
  const has = (x: number, y: number): boolean => piece.cells.some((c) => c.x === x && c.y === y);
  return piece.cells.map(({ x, y }) => {
    const north = has(x, y - 1);
    const east = has(x + 1, y);
    const south = has(x, y + 1);
    const west = has(x - 1, y);
    const corner = (a: boolean, b: boolean, diagonal: boolean, convex: number, concave: number): number => (!a && !b ? convex : a && b && !diagonal ? concave : 0);
    return {
      x,
      y,
      n: north ? 0 : SIDE_SHAPES.n,
      e: east ? 0 : SIDE_SHAPES.e,
      s: south ? 0 : SIDE_SHAPES.s,
      w: west ? 0 : SIDE_SHAPES.w,
      nw: corner(north, west, has(x - 1, y - 1), CONVEX.nw, CONCAVE.nw),
      ne: corner(north, east, has(x + 1, y - 1), CONVEX.ne, CONCAVE.ne),
      se: corner(south, east, has(x + 1, y + 1), CONVEX.se, CONCAVE.se),
      sw: corner(south, west, has(x - 1, y + 1), CONVEX.sw, CONCAVE.sw),
    };
  });
}

/** Id `SHAP` de la forme de bordure `n` (1 à 12) du niveau. */
export function borderShapeId(firstShapeId: number, level: number, n: number): number {
  return firstShapeId + 12 * level + n - 1;
}

/** Rectangle visible de la photo pour une cellule posée en `(left, top)` : `c × c` rétréci de 5 px sur chaque côté exposé (hidden.md §2.2). */
export function revealRect(borders: CellBorders, left: number, top: number, c: number): Rect {
  const l = borders.w ? BORDER : 0;
  const t = borders.n ? BORDER : 0;
  const r = borders.e ? BORDER : 0;
  const b = borders.s ? BORDER : 0;
  return { x: left + l, y: top + t, w: c - l - r, h: c - t - b };
}

/** Rectangles où la photo est visible pour un ensemble de pièces posées. */
export function photoRevealRects(pieces: readonly HiddenPiece[], c: number): Rect[] {
  const rects: Rect[] = [];
  for (const piece of pieces) {
    const bounds = hiddenBounds(piece, c);
    const borders = pieceBorders(piece);
    for (const cell of borders) rects.push(revealRect(cell, bounds.left + cell.x * c, bounds.top + cell.y * c, c));
  }
  return rects;
}

// --- Dessin ---

/** Ce dont le rendu a besoin de l'archive. */
export interface HiddenShapes {
  /** Id `SHAP` de la première forme de bordure du niveau (`SHPL` 5030). */
  borders: number;
  shape(id: number): Shape;
}

/** Aplat de la pièce (couleur du niveau) puis bordures des côtés exposés et des coins. */
function drawBorders(dst: Surface, piece: HiddenPiece, left: number, top: number, level: number, c: number, shapes: HiddenShapes): void {
  const far = c - BORDER;
  const at = (n: number, dx: number, dy: number): void => {
    if (n) drawShape(dst, shapes.shape(borderShapeId(shapes.borders, level, n)), dx, dy, 8);
  };
  for (const cell of pieceBorders(piece)) {
    const x = left + cell.x * c;
    const y = top + cell.y * c;
    at(cell.n, x, y);
    at(cell.e, x + far, y);
    at(cell.s, x, y + far);
    at(cell.w, x, y);
    at(cell.nw, x, y);
    at(cell.ne, x + far, y);
    at(cell.se, x + far, y + far);
    at(cell.sw, x, y + far);
  }
}

/** Pièce non posée (ou tenue) : aplat de la couleur du niveau sur chaque cellule, puis bordures. */
export function drawFloatingPiece(dst: Surface, piece: HiddenPiece, level: number, c: number, shapes: HiddenShapes): void {
  const bounds = hiddenBounds(piece, c);
  for (const cell of hiddenCellRects(piece, bounds.left, bounds.top, c)) dst.fill(HIDDEN_FLAT_COLORS[level]!, edgesToRect(cell));
  drawBorders(dst, piece, bounds.left, bounds.top, level, c, shapes);
}

export interface BoardPaint {
  level: number;
  /** Photo 238×238 (forme de `SHPL` 5070 + …). */
  photo: Shape;
  shapes: HiddenShapes;
  /** Pièce à ne pas dessiner (la pièce tenue, dessinée en dernier par l'appelant). */
  skip?: HiddenPiece | null;
}

/**
 * Plateau : la photo écrêtée sur l'union des cellules posées (rétrécies des bordures), leurs bordures, puis les pièces libres de la dernière à la
 * première (indice 0 = dessus). Écart avec l'original : les pièces libres passent toujours au-dessus des pièces posées (l'original suit l'ordre du
 * tableau, qui ne diffère que si une pièce libre en recouvre une posée).
 */
export function drawBoard(dst: Surface, pieces: readonly HiddenPiece[], c: number, paint: BoardPaint): void {
  const placed = pieces.filter((p) => p.placed);
  if (placed.length > 0) {
    dst.mask = new ClipMask(dst.width, dst.height, photoRevealRects(placed, c));
    try {
      drawShape(dst, paint.photo, HIDDEN_TV.x, HIDDEN_TV.y, 0);
    } finally {
      dst.mask = null;
    }
    for (const piece of placed) {
      const bounds = hiddenBounds(piece, c);
      drawBorders(dst, piece, bounds.left, bounds.top, paint.level, c, paint.shapes);
    }
  }
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]!;
    if (!piece.placed && piece !== paint.skip) drawFloatingPiece(dst, piece, paint.level, c, paint.shapes);
  }
}

/** Photo entière sur la télé, sans bordures (fin du puzzle, rejouer). */
export function drawCleanPhoto(dst: Surface, backdrop: Surface, photo: Shape): void {
  dst.copyFrom(backdrop, HIDDEN_TV_WITH_BORDERS);
  drawShape(dst, photo, HIDDEN_TV.x, HIDDEN_TV.y, 0);
}

export interface MenuPaint {
  level: number;
  /** Formes de `SHPL` 7800 + 10 × niveau : 1 à 9 vignettes, 10 cadre. */
  thumbnails: (k: number) => Shape;
  frame: Shape;
  /** Vignette survolée (0 à 8), ou −1. */
  hovered: number;
  /** Vignette enfoncée (0 à 8), ou −1. */
  pressed: number;
}

/** Menu : les 9 vignettes, plus le cadre de survol (agrandi de 4 px) autour de la survolée. */
export function drawMenu(dst: Surface, paint: MenuPaint): void {
  for (let k = 0; k < PUZZLES_PER_LEVEL; k++) {
    const r = thumbRect(THUMB_LAYOUTS.hidden, k);
    drawShape(dst, paint.thumbnails(k), r.x, r.y, 0);
  }
  const framed = paint.pressed >= 0 ? paint.pressed : paint.hovered;
  if (framed >= 0) {
    const f = thumbHoverFrame(THUMB_LAYOUTS.hidden, framed);
    drawShape(dst, paint.frame, f.x, f.y, 8, paint.pressed >= 0 ? HIDDEN_PRESSED_FRAME_COLOR : HIDDEN_HOVER_FRAME_COLORS[paint.level]!);
  }
}
