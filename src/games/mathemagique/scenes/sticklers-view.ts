/**
 * Super Sticklers : constantes d'écran et aides pures de la scène (`docs/mathemagique/screens/sticklers.md` §1.6, §2.3, §3).
 * Rien ici ne touche au moteur : géométrie, palette partielle, test de prise au pixel avec hystérésis, rectangles à redessiner.
 */
import type { Shape } from "../../../data/mohawk/shap";
import type { ShapeList } from "../../../data/mohawk/shpl";
import { hitTestShape } from "../engine/graphics/blit";
import type { Rect } from "../engine/graphics/surface";
import { rectFromEdges } from "../engine/gadgets";
import { edgesToRect, stickBounds, type StickPiece } from "../game/puzzle-kit";

// --- Ressources ---

export const ARCHIVE = "STICKLER.DAT";
/** Fond (chevalet sur un mur de briques). */
export const BACKGROUND_SHPL = 104;
/** Boutons : `SHPL` 2000, deux formes par bouton (normal, appuyé). */
export const BUTTONS_SHAP = 2000;
/** Animation d'accueil (visages des boutons de niveau). */
export const INTRO_SCR = 1000;
export const MUSIC_SND = 100;

export const SND = {
  buttons: [2000, 2001, 2002, 2003],
  reset: 2004,
  rotate: 2005,
  thumbHover: 2010,
  grab: 2012,
  drop: 2013,
} as const;

// --- Palette ---

/** Seules les entrées 154 à 185 des `SHPL` de menu et de puzzle sont poussées (`10a8:0dc4(0x20, 0x9a, …)`) : le reste est du remplissage. */
export const PARTIAL_FIRST = 154;
export const PARTIAL_COUNT = 32;
/** Encre des fragments (noir de la `SHPL` 104) et de survol (entrée 183 de la `SHPL` du puzzle). */
export const INK_PIECE = 245;
export const INK_HOVER = 183;
/** Encre du cadre de survol des vignettes : `163 + niveau`. */
export const inkThumbFrame = (level: number) => 163 + level;
/** Cycle de palette des animations de récompense (hook 0) : 4 entrées dès 156, un cran tous les 7 ticks. */
export const CYCLE = { first: 156, count: 4, period: 7 } as const;

/** La part de `shpl` qui recouvre `[first, first + count)` (les entrées hors de la plage sont ignorées), à passer à `Palette.loadShpl`. */
export function partialShpl(shpl: ShapeList, first = PARTIAL_FIRST, count = PARTIAL_COUNT): ShapeList {
  const total = shpl.rgb.length / 3;
  const from = Math.max(first, shpl.paletteFirst);
  const to = Math.min(first + count, shpl.paletteFirst + total);
  if (to <= from) return { ...shpl, paletteFirst: first, rgb: new Uint8Array(0) };
  return { ...shpl, paletteFirst: from, rgb: shpl.rgb.slice((from - shpl.paletteFirst) * 3, (to - shpl.paletteFirst) * 3) };
}

// --- Zones ---

export const EASEL: Rect = rectFromEdges(37, 26, 293, 282);
export const SCATTER: Rect = rectFromEdges(295, 2, 575, 379);
export const MINIATURE_AT = { x: 300, y: 30 } as const;
export const MINIATURE: Rect = rectFromEdges(295, 25, 395, 125);

/** Les 7 boutons (groupe 1) : `[gauche, haut, droite, bas]`, dans l'ordre 1 à 7 (niveau ×3, Help, Reset, Rotate, Exit). */
export const BUTTON_EDGES = [
  [45, 291, 78, 323],
  [80, 291, 113, 323],
  [115, 291, 148, 323],
  [200, 291, 233, 323],
  [169, 333, 211, 365],
  [250, 291, 283, 323],
  [122, 333, 163, 365],
] as const;

/**
 * Second rectangle de chaque entrée de la table `DS:3216`-source (16 octets : repos puis « appuyé », vérifié dans `MATH`) : la forme « appuyé »
 * est dessinée à son coin haut-gauche (`1038:01af` : la forme d'état `i` va au rectangle `i` de la table), coins bas-droits communs.
 */
export const BUTTON_PRESSED_EDGES = [
  [47, 292, 78, 323],
  [82, 292, 113, 323],
  [117, 292, 148, 323],
  [202, 292, 233, 323],
  [171, 335, 211, 365],
  [252, 292, 283, 323],
  [124, 335, 163, 365],
] as const;

/** `[gauche, haut, droite, bas]` des fiches → `Rect`. */
export const edgesRect = (e: readonly number[]): Rect => rectFromEdges(e[0]!, e[1]!, e[2]!, e[3]!);

export type ButtonRole = "level1" | "level2" | "level3" | "help" | "reset" | "rotate" | "exit";
export const BUTTON_ROLES: readonly ButtonRole[] = ["level1", "level2", "level3", "help", "reset", "rotate", "exit"];

/** Clé de zone de l'aide de Poly pour un bouton (`STICKLERS_POLY.topics`). */
export function polyZoneOfButton(role: ButtonRole): string {
  return role.startsWith("level") ? "level" : role;
}

/** Forme du bouton `i` (0 à 6) : normal = `2000 + 2i` (posée au rectangle de repos), appuyé = `2001 + 2i` (posée au rectangle « appuyé », `BUTTON_PRESSED_EDGES`). */
export const buttonShapeId = (i: number, pressed: boolean) => BUTTONS_SHAP + 2 * i + (pressed ? 1 : 0);

// --- Fragments ---

export function pieceRect(piece: StickPiece): Rect {
  return edgesToRect(stickBounds(piece));
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Le point touche le rectangle du fragment **et** un pixel allumé de son masque (fragments fins : il faut viser le trait). */
export function piecePixelHit(piece: StickPiece, shape: Shape, x: number, y: number): boolean {
  const r = pieceRect(piece);
  if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
  return hitTestShape(shape, x - r.x, y - r.y);
}

/**
 * Prise au pixel avec hystérésis (`1048:1119`) : si la dernière cible (`5954` = forme de base, `5956` = point) est la même et que le point est à
 * moins de 20 px en x **et** en y du dernier succès, c'est un succès sans test de pixel (le trait est fin, le doigt tremble). Un succès au pixel
 * mémorise la cible et le point. Le point doit toujours être dans le rectangle du fragment.
 */
export const HYSTERESIS = 20;

export class HitHysteresis {
  private base = -1;
  private x = 0;
  private y = 0;

  test(piece: StickPiece, shape: Shape, x: number, y: number): boolean {
    const r = pieceRect(piece);
    if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
    if (piece.shapeBase === this.base && Math.abs(x - this.x) < HYSTERESIS && Math.abs(y - this.y) < HYSTERESIS) return true;
    if (!hitTestShape(shape, x - r.x, y - r.y)) return false;
    this.base = piece.shapeBase;
    this.x = x;
    this.y = y;
    return true;
  }

  reset(): void {
    this.base = -1;
  }
}
