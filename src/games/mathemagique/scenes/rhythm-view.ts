/**
 * Rhythm Shop : constantes d'écran et aides pures de la scène (`docs/mathemagique/screens/rhythm.md` §1.1, §1.4, §4).
 * Rien ici ne touche au moteur : géométrie, ids de ressources, dessin des bacs et des animations d'outils, étiquettes des boutons d'outils.
 */
import type { Shape } from "../../../data/mohawk/shap";
import { drawShape } from "../engine/graphics/blit";
import type { FonFont } from "../engine/graphics/fon";
import { Surface, type Rect } from "../engine/graphics/surface";
import { drawText, measureText } from "../engine/graphics/text";
import { rectFromEdges } from "../engine/gadgets";
import { BIN_EDGES, MEASURE, PIECE_HEIGHT, type BinId, type Tool, ghostShapeId, pieceShapeId, pieceSpan, reduceFraction } from "../game/rhythm/pieces";

// --- Ressources ---

export const ARCHIVE = "RHYTHM.DAT";
export const MIDI_ARCHIVE = "MIDIMPC.DAT";
export const MIDI_MAP_ARCHIVE = "MIDIMAP.DAT";
export const FONT_SMALL = "NCSCLB10.FON";
export const FONT_MEDIUM = "NCSCLB12.FON";

/** Fond plein écran (le meuble Fractionaire 2000) et palette (`SHPL` 999 de `RSHELP.DAT`, puis celle de la `SHPL` 30000). */
export const BACKGROUND_SHAP = 30000;
export const HELP_PALETTE_SHPL = 999;

/** Animation d'entrée (`DS:11b6`, drapeaux 0x1f) et de fusion (`DS:11aa`, drapeaux 0x13). */
export const ENTRY_SCR = 21000;
export const MELD_SCR = 20000;

export const SND = {
  /** Clic de bouton (Play, niveaux, flèches, Exit). */
  button: 3030,
  /** Do It / Empty / Undo. */
  action: 3031,
  /** Choix d'un outil. */
  tool: 3032,
  helpLow: 3012,
  helpHigh: 3013,
  gluing: 30001,
  cutStart: 30002,
  cutEnd: 30003,
  refused: 30004,
  pick: 30005,
  /** Impulsion de Play Parts. */
  pulse: 30006,
} as const;

/** `SND` 3013 si le tirage (0 à 99) est inférieur à 51, sinon 3012 (`DS:1788`, `1028:0000` cas 9). */
export const HELP_SOUND_THRESHOLD = 51;

// --- Zones ---

/** `[gauche, haut, droite, bas]` des fiches → `Rect`. */
export const edgesRect = (e: readonly number[]): Rect => rectFromEdges(e[0]!, e[1]!, e[2]!, e[3]!);

export const binRect = (bin: BinId): Rect => edgesRect(BIN_EDGES[bin]);

/** Algebird (clic = réplique) : `DS:1850`. Les poses de 148 × 154 pixels sont posées au coin haut-gauche. */
export const ALGEBIRD_EDGES = [19, 257, 166, 410] as const;
export const ALGEBIRD_AT = { x: 19, y: 257 } as const;
export const ALGEBIRD_CLEAN: Rect = { x: 19, y: 257, w: 148, h: 154 };

/** Zone d'effet des réactions d'Algebird (`DS:11d6`, clip des `SCR` 4000 à 11300). */
export const REACTION_ZONE: Rect = rectFromEdges(58, 269, 208, 425);

/** Teletune : texte dans `(36,28)-(147,125)` (`DS:1830`). */
export const TELETUNE_EDGES = [36, 28, 147, 125] as const;
/** Écran bleu du Teletune : centre horizontal et haut du texte. */
export const TELETUNE_CENTER_X = 93;
export const TELETUNE_TEXT_TOP = 42;

/** Zone de travail des animations de coupe et de collage (`DS:150a`). */
export const WORK_ZONE: Rect = rectFromEdges(187, 109, 488, 191);

/** Main stop du mode aide (`SHAP` 30105 : pose `(450, 388)`, hors de l'écran du Teletune). */
export const STOP_HAND_SHAP = 30105;
export const STOP_HAND_AT = { x: 450, y: 388 } as const;

// --- Boutons d'outils ---

/** Les 9 boutons d'outils (3 Cutter, 3 Gluer, 3 Melder) : colonnes `x`, haut 54, 19 × 32 (le rectangle de test fait 20 × 33). */
export const TOOL_XS = [222, 242, 262, 320, 340, 360, 419, 439, 459] as const;
export const TOOL_TOP = 54;
export const TOOL_SHAPE_W = 19;
export const TOOL_SHAPE_H = 32;
export const toolRect = (i: number): Rect => ({ x: TOOL_XS[i]!, y: TOOL_TOP, w: 20, h: 33 });

/** `SHAP` des boutons d'outils : vert (outil actif), vert avec barre de fraction, gris, gris avec barre. */
export const TOOL_SHAPES = { green: 30062, greenBar: 30063, gray: 30064, grayBar: 30065 } as const;

/** Ids des formes synthétiques des boutons d'outils (au-delà de tout id de l'archive) : `SYNTHETIC_BASE + 2 i + (actif ? 1 : 0)`. */
export const SYNTHETIC_BASE = 1_000_000;
export const toolShapeId = (button: number, active: boolean) => SYNTHETIC_BASE + 2 * button + (active ? 1 : 0);

/** Rang (0-based) de la barre de fraction dans une forme de bouton : première ligne noire de la colonne centrale, hors bords. */
export function barRow(shape: Shape): { row: number; color: number } {
  const x = Math.floor(shape.width / 2);
  for (let y = 4; y < shape.height - 4; y++) {
    const value = shape.pixels[y * shape.width + x]!;
    const left = shape.pixels[y * shape.width + x - 3]!;
    if (value !== 0 && value === left && value !== shape.pixels[(y - 1) * shape.width + x]! && value !== shape.pixels[(y + 1) * shape.width + x]!) {
      return { row: y, color: value };
    }
  }
  return { row: Math.floor(shape.height / 2), color: 0 };
}

function copyShape(shape: Shape): Shape {
  return { ...shape, pixels: shape.pixels.slice() };
}

function paintCentered(shape: Shape, font: FonFont, text: string, y: number, color: number): void {
  const surface = new Surface(shape.width, shape.height);
  surface.pixels.set(shape.pixels);
  const x = Math.floor((shape.width - measureText(font, text)) / 2);
  drawText(surface, font, text, x, y, color);
  shape.pixels.set(surface.pixels);
}

/** Libellé d'un outil : Cutter = le nombre de parts ; Gluer / Melder = la fraction réduite, numérateur au-dessus de la barre (`%d\r%d`). */
export function toolLabel(tool: Tool): { top: string; bottom?: string } {
  if (tool.kind === "cut") return { top: String(tool.n) };
  const { num, den } = reduceFraction(tool.kind === "glue" ? tool.size : tool.target);
  return { top: String(num), bottom: String(den) };
}

/**
 * Formes d'un bouton d'outil : `normal` (gris, outil non choisi) et `active` (vert), le libellé peint dessus. Un bouton sans outil reste gris et nu.
 * Les deux polices : `small` pour les fractions, `medium` pour le nombre de parts du Cutter.
 */
export function toolButtonShapes(
  shapeOf: (id: number) => Shape,
  tool: Tool | null,
  fonts: { small: FonFont; medium: FonFont },
): { normal: Shape; active: Shape } {
  const fraction = tool !== null && tool.kind !== "cut";
  const normal = copyShape(shapeOf(fraction ? TOOL_SHAPES.grayBar : TOOL_SHAPES.gray));
  const active = copyShape(shapeOf(fraction ? TOOL_SHAPES.greenBar : TOOL_SHAPES.green));
  if (!tool) return { normal, active };
  const label = toolLabel(tool);
  for (const shape of [normal, active]) {
    if (label.bottom === undefined) {
      paintCentered(shape, fonts.medium, label.top, Math.floor((shape.height - fonts.medium.height) / 2), 0);
    } else {
      const bar = barRow(shape);
      paintCentered(shape, fonts.small, label.top, bar.row - fonts.small.height - 1, bar.color);
      paintCentered(shape, fonts.small, label.bottom, bar.row + 2, bar.color);
    }
  }
  return { normal, active };
}

// --- Boutons ---

export type ButtonRole = "playParts" | "playPattern" | "doIt" | "empty" | "undo" | "level1" | "level2" | "level3" | "help" | "previous" | "next" | "exit";

export interface ButtonSpec {
  role: ButtonRole;
  /** `(gauche, haut, droite, bas)` (`DS:1672`, ordre des rappels `FUN_1028_0000(n)`, n = rang + 1). */
  edges: readonly [number, number, number, number];
  /** `SHAP` de `SHPL` 32000 par état. */
  normal: number;
  pressed: number;
  disabled?: number;
  sound: number;
}

export const BUTTONS: readonly ButtonSpec[] = [
  { role: "playParts", edges: [172, 232, 199, 271], normal: 32000, pressed: 32001, sound: SND.button },
  { role: "playPattern", edges: [172, 306, 199, 345], normal: 32002, pressed: 32003, sound: SND.button },
  { role: "doIt", edges: [286, 199, 386, 227], normal: 32004, pressed: 32005, disabled: 32026, sound: SND.action },
  { role: "empty", edges: [444, 201, 499, 223], normal: 32006, pressed: 32007, disabled: 32027, sound: SND.action },
  { role: "undo", edges: [172, 201, 227, 223], normal: 32008, pressed: 32009, disabled: 32028, sound: SND.action },
  { role: "level1", edges: [44, 155, 73, 183], normal: 32010, pressed: 32011, sound: SND.button },
  { role: "level2", edges: [79, 155, 108, 183], normal: 32012, pressed: 32013, sound: SND.button },
  { role: "level3", edges: [115, 155, 144, 183], normal: 32014, pressed: 32015, sound: SND.button },
  { role: "help", edges: [104, 198, 133, 226], normal: 32016, pressed: 32017, sound: SND.helpLow },
  { role: "previous", edges: [46, 132, 82, 151], normal: 32018, pressed: 32019, sound: SND.button },
  { role: "next", edges: [107, 132, 143, 151], normal: 32020, pressed: 32021, sound: SND.button },
  { role: "exit", edges: [60, 199, 97, 225], normal: 32022, pressed: 32023, sound: SND.button },
];

export const buttonIndex = (role: ButtonRole): number => BUTTONS.findIndex((b) => b.role === role);

// --- Dessin des bacs ---

/** Contour (2 pixels, index blanc du système) d'une pièce « éclairée » (surbrillance des repères du MIDI et de Play Parts). */
export const LIT_COLOR = 255;

export function outline(surface: Surface, rect: Rect, color: number, thickness = 2): void {
  surface.fill(color, { x: rect.x, y: rect.y, w: rect.w, h: thickness });
  surface.fill(color, { x: rect.x, y: rect.y + rect.h - thickness, w: rect.w, h: thickness });
  surface.fill(color, { x: rect.x, y: rect.y, w: thickness, h: rect.h });
  surface.fill(color, { x: rect.x + rect.w - thickness, y: rect.y, w: thickness, h: rect.h });
}

/** Rectangle dessiné de la pièce `index` d'un bac (sprite de `2 × taille + 3` pixels de large). */
export function pieceRect(bin: BinId, words: readonly number[], index: number): Rect {
  const { x, w } = pieceSpan(bin, words, index);
  return { x, y: BIN_EDGES[bin][1], w: w + 3, h: PIECE_HEIGHT };
}

/**
 * Dessine les pièces et les fantômes d'un bac (`1058:0592`) : la pièce de taille `v` est le sprite `pieceShapeId(v)`, le fantôme `-v` le sprite vert
 * `ghostShapeId(v)`. Le fond du bac doit déjà être restauré. `lit` : indice d'une pièce à entourer.
 */
export function drawBin(surface: Surface, shapeOf: (id: number) => Shape, bin: BinId, words: readonly number[], lit = -1): void {
  for (let i = 0; i < words.length; i++) {
    const value = words[i]!;
    if (value === 0) break;
    const id = value > 0 ? pieceShapeId(value) : ghostShapeId(-value);
    if (id === 0) continue;
    const { x } = pieceSpan(bin, words, i);
    drawShape(surface, shapeOf(id), x, BIN_EDGES[bin][1], 8);
  }
  if (lit >= 0 && (words[lit] ?? 0) !== 0) outline(surface, pieceRect(bin, words, lit), LIT_COLOR);
}

// --- Animations d'outils (codées en dur dans `1028`, rhythm.md §1.5) ---

/** Une forme à poser : `SHAP` et position. */
export interface Sprite {
  id: number;
  x: number;
  y: number;
}

/** Cadence des animations de coupe et de collage : 30 unités de la minuterie de 4 ms = 120 ms par image, soit 7 ticks de 17 ms. */
export const TOOL_FRAME_TICKS = 7;

/** Coupe (`1028:3147`) : 10 images ; tables `DS:188a` (hauteur du couteau), `189e` (forme), `18b2` (trait de coupe). */
export const CUT_FRAMES = 10;
const KNIFE_RISE = [160, 141, 123, 98, 93, 55, 98, 123, 162, 0] as const;
const KNIFE_SHAPE = [1, 4, 3, 4, 3, 2, 1, 2, 1, 0] as const;
const CUT_LINE = [0, 0, 0, 0, 0, 5, 5, 5, 5, 5] as const;
const KNIFE_BASE = 30080;

/**
 * Formes de l'image `frame` (0 à 9) d'une coupe de la pièce de taille `size` en `n` parts : un couteau par coupe (`n - 1`), au-dessus du
 * Fractionator, et, de la 6e image, le trait de la coupe sur la pièce.
 */
export function cutSprites(frame: number, n: number, size: number): Sprite[] {
  const sprites: Sprite[] = [];
  const width = Math.trunc((size * 2) / n);
  for (let i = 0; i < n - 1; i++) {
    const x = 184 + (i + 1) * width;
    if (CUT_LINE[frame]) sprites.push({ id: KNIFE_BASE + CUT_LINE[frame]!, x: x + 10, y: BIN_EDGES.fractionator[1] });
    sprites.push({ id: KNIFE_BASE + KNIFE_SHAPE[frame]!, x, y: 109 - KNIFE_RISE[frame]! });
  }
  return sprites;
}

/**
 * Collage (`1028:364e`, relu à l'octet) : 18 images `a` = 1 à 18 de 30 unités de la minuterie. Chaque image pose des formes de 45 × 82 en `y = 109`
 * (`0x6d`), aux joints du Fractionator : abscisse `0xa6 + k × 2 × taille` pour le joint `k` (1 à `144 / taille - 1`).
 * - images 1 à 17 : le pistolet animé (`SHAP` 30086 + `a`) sur chacun des `n - 1` joints des pièces collées ;
 * - hors image 17 : le pistolet au repos (`SHAP` 30086) sur les autres joints de la barre (joints `n` et suivants avant l'image 12, tous à partir
 *   de l'image 12, ce qui recouvre les pistolets animés) ;
 * - image 4 : son ; image 17 : le Fractionator est redessiné avec le résultat (`0592` mode 2) ; image 18 : résultat et pistolets au repos.
 */
export const GLUE_FRAMES = 18;
export const GLUE_SOUND_FRAME = 4;
/** Indice (de 0) de l'image où le Fractionator montre le résultat (`a == 0x11`). */
export const GLUE_RESULT_FRAME = 16;
const GLUE_BASE = 30086;
const GLUE_X0 = 0xa6;
const GLUE_Y = 109;
/** Dernière image où le pistolet animé est posé (`a < 0x12`) et image sans pistolet au repos (`a == 0x11`). */
const GLUE_LAST_ANIMATED = 17;
const GLUE_REST_GUNS_ALL_FROM = 12;
const GLUE_NO_REST_FRAME = 17;

/** Formes de l'image `frame` (0 à 17) d'un collage de `count` pièces de taille `size`. */
export function glueSprites(frame: number, count: number, size: number): Sprite[] {
  const a = frame + 1;
  if (a < 1 || a > GLUE_FRAMES || size <= 0) return [];
  const width = size * 2;
  const joints = Math.trunc(MEASURE / size) - 1;
  const sprites: Sprite[] = [];
  if (a <= GLUE_LAST_ANIMATED) {
    for (let k = 1; k < count; k++) sprites.push({ id: GLUE_BASE + a, x: GLUE_X0 + k * width, y: GLUE_Y });
  }
  if (a !== GLUE_NO_REST_FRAME) {
    for (let k = a < GLUE_REST_GUNS_ALL_FROM ? count : 1; k <= joints; k++) sprites.push({ id: GLUE_BASE, x: GLUE_X0 + k * width, y: GLUE_Y });
  }
  return sprites;
}

// --- Texte du Teletune ---

export interface TeletuneLine {
  text: string;
  font: "medium" | "small";
  y: number;
}

/** Lignes du Teletune : le nom du morceau (police moyenne, réduite s'il est trop large) puis la recette, ligne par ligne. */
export function teletuneLines(name: string, recipe: readonly string[], fonts: { small: FonFont; medium: FonFont }, maxWidth = 98): TeletuneLine[] {
  const lines: TeletuneLine[] = [];
  const nameFont = measureText(fonts.medium, name) <= maxWidth ? "medium" : "small";
  lines.push({ text: name, font: nameFont, y: TELETUNE_TEXT_TOP });
  let y = TELETUNE_TEXT_TOP + fonts[nameFont].height + 10;
  for (const text of recipe) {
    lines.push({ text, font: "small", y });
    y += fonts.small.height + 4;
  }
  return lines;
}

/** Peint les lignes du Teletune, centrées sur l'écran bleu. Le fond doit déjà être restauré. */
export function drawTeletune(surface: Surface, lines: readonly TeletuneLine[], fonts: { small: FonFont; medium: FonFont }, color = 0): void {
  for (const line of lines) {
    const font = fonts[line.font];
    const width = measureText(font, line.text);
    drawText(surface, font, line.text, TELETUNE_CENTER_X - Math.floor(width / 2), line.y, color);
  }
}

// --- Rectangles ---

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Pose neutre d'attente et poses du bavardage (`DS:1168`, indices de la `SHPL` 33000 ; 0 termine la ligne). */
export const IDLE_LINES: readonly (readonly number[])[] = [
  [7, 8, 7, 0, 0],
  [7, 9, 7, 0, 0],
  [7, 10, 11, 10, 7],
  [7, 12, 7, 12, 7],
];
export const IDLE_SHPL = 33000;
export const NEUTRAL_POSE = 7;
/** Délai entre deux poses du bavardage (`1028:2fcc`) et délais d'attente avant le prochain (`1028:309c`). */
export const IDLE_STEP_TICKS = 6;
export const IDLE_WAIT_MIN = 120;
export const IDLE_WAIT_MAX = 300;
