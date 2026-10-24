/**
 * Mise en page et dessin du Bowling (`bowling.md` §4) : rectangles, ids de ressources et fonctions de dessin pures (surface + archive),
 * sans état de scène. Les rectangles sont `{ x, y, w, h }` (tables de l'original `[gauche, haut, droite, bas[`).
 */
import { TAG_SHAP } from "../data/mohawk";
import { drawMask, drawShape } from "../engine/graphics/blit";
import type { FonFont } from "../engine/graphics/fon";
import { Surface, type Rect } from "../engine/graphics/surface";
import { drawText, measureText } from "../engine/graphics/text";
import { rectFromEdges } from "../engine/gadgets";
import type { Archive } from "../engine/resources";
import type { BowlingQuestion, Choice } from "../game/bowling";

// --- Ressources de BOWLING.DAT ---

export const SHPL_BACKGROUND = 101;
export const SHPL_GUS = 970;
export const SHPL_LIGHTS = 1044;
export const SHPL_PIZZAS = 1800;
/** Palette de la bannière lumineuse : 8 entrées à partir de 218 (`SHPL 1044`). */
export const LIGHTS_PALETTE = { first: 218, count: 8 } as const;
export const CREAM = 0x1b;
export const HIGHLIGHT = 0x7e;
const TEXT = 0;

export const SHAP = {
  background: 101,
  gus: 970,
  eyes: 980,
  label: 990,
  go: 998,
  help: 1002,
  exit: 1004,
  answerMask: 1007,
  bar: 1008,
  barEmpty: 1009,
  level: 1010,
  bonus: 1018,
  bonusLocked: 1024,
  operation: 1030,
  lights: 1044,
  pegs: 1100,
} as const;

// --- Rectangles ---

export const WINDOW_TEXT = rectFromEdges(170, 81, 401, 122);
export const WINDOW_REDRAW: readonly Rect[] = [rectFromEdges(170, 81, 401, 122), rectFromEdges(226, 73, 344, 81)];
export const TIME_BAR = rectFromEdges(162, 122, 409, 138);
export const TUNNEL = rectFromEdges(396, 227, 488, 314);
export const GUS_ZONE = rectFromEdges(96, 241, 212, 402);
export const NAME_RECT = rectFromEdges(205, 212, 357, 227);
export const RANK_RECT = rectFromEdges(205, 231, 357, 246);
export const LABEL_AT = { x: 202, y: 211 } as const;
export const EYE_AT = { x: 161, y: 253 } as const;
export const GO_RECT = rectFromEdges(441, 108, 486, 153);
export const HELP_RECT = rectFromEdges(457, 159, 492, 193);
export const EXIT_RECT = rectFromEdges(64, 231, 109, 261);
export const TROPHY_RECT = rectFromEdges(492, 111, 524, 144);
export const BAR_HALF = 121;

/** Positions des 6 formes d'opération (`SHPL 1030`, coin haut-gauche) et zones cliquables. */
export const OPERATION_SHAPE_AT: readonly (readonly [number, number])[] = [
  [37, 121],
  [73, 121],
  [37, 155],
  [73, 155],
  [37, 186],
  [73, 186],
];
export const OPERATION_EDGES: readonly (readonly [number, number, number, number])[] = [
  [41, 125, 76, 158],
  [77, 125, 112, 158],
  [41, 159, 76, 189],
  [77, 159, 112, 189],
  [41, 190, 76, 223],
  [76, 190, 112, 223],
];
/** Niveaux 1 à 4 : forme normale (22×22) à `normal`, active (plus grande) à `active` ; le bonus a sa propre paire. */
export const LEVEL_SHAPES: readonly { normal: readonly [number, number]; active: readonly [number, number]; edges: readonly [number, number, number, number] }[] = [
  { normal: [231, 265], active: [228, 262], edges: [228, 262, 256, 290] },
  { normal: [258, 250], active: [255, 247], edges: [255, 247, 283, 275] },
  { normal: [288, 250], active: [285, 247], edges: [285, 247, 313, 275] },
  { normal: [313, 265], active: [310, 262], edges: [310, 262, 338, 290] },
  { normal: [256, 275], active: [253, 272], edges: [253, 272, 313, 295] },
];
export const ANSWER_BOXES: readonly Rect[] = [0, 1, 2, 3].map((i) => rectFromEdges(138 + 74 * i, 142, 208 + 74 * i, 196));
/** Pions du « strike zone » (`1108:056c + 8k`, 16×14). */
export const PEG_AT: readonly (readonly [number, number])[] = [
  [120, 54],
  [153, 47],
  [187, 42],
  [224, 39],
  [261, 38],
  [297, 38],
  [333, 39],
  [370, 42],
  [404, 47],
  [437, 54],
];

/** Zones du mode aide de Polly (`DS:08f8`) : 1 = Polly, 2 à 14 = les 13 sujets (`subject1` à `subject13`, descripteurs `20500 + 50k`). */
export const HELP_ZONES: readonly (readonly [number, number, number, number])[] = [
  [420, 272, 516, 432],
  [138, 143, 430, 196],
  [202, 211, 360, 227],
  [381, 221, 489, 297],
  [159, 70, 411, 123],
  [445, 112, 483, 149],
  [228, 247, 338, 295],
  [202, 230, 359, 247],
  [41, 124, 113, 223],
  [114, 33, 458, 71],
  [492, 111, 525, 146],
  [96, 241, 212, 402],
  [64, 231, 109, 261],
  [162, 122, 409, 138],
];

// --- Dessin ---

export interface ViewFonts {
  /** `NCSclB10` : nom et rang. */
  small: FonFont;
  /** `NCSclB12` : phrases d'estimation. */
  medium: FonFont;
  /** `NCSclB14` : opérations et réponses. */
  large: FonFont;
}

function shape(archive: Archive, id: number) {
  if (!archive.has(TAG_SHAP, id)) throw new Error(`BOWLING.DAT : forme ${id} absente`);
  return archive.shap(id);
}

/** Recopie un rectangle de `from` dans `to` (restauration du fond ou présentation). */
export function copyRect(to: Surface, from: Surface, rect: Rect): void {
  to.copyFrom(from, rect, rect.x, rect.y);
}

export function centerText(dst: Surface, font: FonFont, text: string | Uint8Array, rect: Rect): void {
  const width = measureText(font, text);
  drawText(dst, font, text, rect.x + Math.floor((rect.w - width) / 2), rect.y + Math.floor((rect.h - font.height) / 2), TEXT);
}

/** Coupe `text` en lignes de `maxWidth` pixels au plus (espaces), puis centre le bloc dans `rect`. */
export function centerWrapped(dst: Surface, font: FonFont, text: string, rect: Rect): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measureText(font, next) > rect.w) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line !== "") lines.push(line);
  const top = rect.y + Math.floor((rect.h - lines.length * font.height) / 2);
  lines.forEach((l, i) => drawText(dst, font, l, rect.x + Math.floor((rect.w - measureText(font, l)) / 2), top + i * font.height, TEXT));
  return lines;
}

/** Image ou masque du Bowling centré en `(cx, cy)` (`1010:2bb0`) : pizzas, parts de pizza (8), beignets (12), grille (24). */
export function drawPicture(dst: Surface, archive: Archive, choice: Extract<Choice, { kind: "image" | "mask" }>, cx: number, cy: number): void {
  const draw = (index: number, x: number, y: number, mode: 0 | 8 = 8) => drawShape(dst, shape(archive, SHPL_PIZZAS + index - 1), x, y, mode);
  if (choice.kind === "image") {
    draw(choice.index + 1, cx - 23, cy - 23);
    return;
  }
  const bits = choice.bits;
  const has = (k: number) => ((bits >>> k) & 1) !== 0;
  if (choice.cells === 8) {
    const X = cx - 23;
    const Y = cy - 23;
    draw(37, X, Y);
    const sx = [23, 23, 23, 23, 7, 0, 0, 7];
    const sy = [0, 7, 23, 23, 23, 23, 7, 0];
    for (let k = 0; k < 8; k++) if (has(k)) draw(38 + k, X + sx[k]!, Y + sy[k]!);
    draw(46, X, Y);
    const hx = [23, 23, 7, 7];
    const hy = [7, 23, 23, 7];
    for (let j = 0; j < 4; j++) if (has(2 * j) || has(2 * j + 1)) draw(47 + j, X + hx[j]!, Y + hy[j]!);
  } else if (choice.cells === 24) {
    draw(59, cx - 59, cy - 21);
    for (let col = 0; col < 8; col++) for (let row = 0; row < 3; row++) if (has(3 * col + row)) draw(58, cx - 58 + 14 * col, cy - 20 + 13 * row);
    draw(60, cx - 58, cy - 19);
  } else {
    draw(51, cx - 30, cy - 14, 0);
    let top = 11;
    while (top >= 0 && !has(top)) top--;
    const flavor = top < 0 ? 0 : top % 5;
    for (let col = 0; col < 3; col++) for (let row = 0; row < 4; row++) if (has(4 * col + row)) draw(53 + flavor, cx - 28 + 19 * col, cy - 23 + 8 * row);
    draw(52, cx - 30, cy + 14, 0);
  }
}

export function drawPrompt(dst: Surface, base: Surface, archive: Archive, fonts: ViewFonts, question: BowlingQuestion): void {
  for (const rect of WINDOW_REDRAW) copyRect(dst, base, rect);
  const prompt = question.prompt;
  if (prompt.kind === "arithmetic") centerText(dst, fonts.large, prompt.text, WINDOW_TEXT);
  else if (prompt.kind === "estimation") centerWrapped(dst, fonts.medium, prompt.text, WINDOW_TEXT);
  else drawPicture(dst, archive, prompt.picture, 285, 96);
}

/** Case de réponse `slot` : fond crème ou turquoise (`1010:3d0d`) puis contenu (`1010:12ad`). */
export function drawChoice(dst: Surface, archive: Archive, fonts: ViewFonts, question: BowlingQuestion, slot: number, highlighted: boolean): void {
  const box = ANSWER_BOXES[slot]!;
  drawMask(dst, shape(archive, SHAP.answerMask), box.x, box.y, highlighted ? HIGHLIGHT : CREAM);
  const choice = question.choices[slot]!;
  if (choice.kind === "number") centerText(dst, fonts.large, String(choice.value), rectFromEdges(140 + 74 * slot, 144, 206 + 74 * slot, 194));
  else if (choice.kind === "fraction") centerText(dst, fonts.large, choice.text, rectFromEdges(140 + 74 * slot, 144, 206 + 74 * slot, 194));
  else drawPicture(dst, archive, choice, 172 + 74 * slot, 168);
}

/** Cases au repos, sans question (crème). */
export function drawEmptyChoices(dst: Surface, archive: Archive): void {
  for (const box of ANSWER_BOXES) drawMask(dst, shape(archive, SHAP.answerMask), box.x, box.y, CREAM);
}

/** Barre de temps : forme pleine, puis `half` pixels masqués (forme sombre) à chaque extrémité. */
export function drawTimeBar(dst: Surface, archive: Archive, half: number): void {
  dst.pushClip(TIME_BAR);
  drawShape(dst, shape(archive, SHAP.bar), TIME_BAR.x, TIME_BAR.y, 8);
  if (half > 0) {
    for (const clip of [
      { x: TIME_BAR.x, y: TIME_BAR.y, w: half, h: TIME_BAR.h },
      { x: TIME_BAR.x + TIME_BAR.w - half, y: TIME_BAR.y, w: half, h: TIME_BAR.h },
    ]) {
      dst.pushClip(clip);
      drawShape(dst, shape(archive, SHAP.barEmpty), TIME_BAR.x, TIME_BAR.y, 8);
      dst.popClip();
    }
  }
  dst.popClip();
}

/** Pions du « strike zone » : `strikes` formes pleines, les autres montrent le fond. */
export function drawPegs(dst: Surface, base: Surface, archive: Archive, strikes: number): void {
  PEG_AT.forEach(([x, y], k) => {
    const rect = { x, y, w: 16, h: 14 };
    copyRect(dst, base, rect);
    if (k < strikes) drawShape(dst, shape(archive, SHAP.pegs + k), x, y, 0);
  });
}

export function drawRank(dst: Surface, base: Surface, font: FonFont, text: string): void {
  copyRect(dst, base, RANK_RECT);
  centerText(dst, font, text, RANK_RECT);
}

export function drawName(dst: Surface, base: Surface, font: FonFont, name: string): void {
  copyRect(dst, base, NAME_RECT);
  centerText(dst, font, name, NAME_RECT);
}
