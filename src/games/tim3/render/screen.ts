/**
 * Composition de l'écran 640×480 (8 bits indexé) : barre d'outils, aire de jeu, bac de pièces, barre de but.
 *
 * Mise en page : les ANM d'interface (`WTOOLBAR`, `PARTSBIN`, `GOALBAR`, `CNTRLPNL`) sont écrits dans un espace de 640×400 ;
 * le bac est l'image 1 de `PARTSBIN.ANM` en (560, 0), 80×377, et la barre de but l'image 1 de `GOALBAR.ANM`, 640×64. Les
 * positions de la barre d'outils viennent de `WTOOLBAR.ITF` (boutons de 40×34 jointifs sur 640 de large, à y = 66 dans la fenêtre).
 * `TIMWIN.INI` donne 568×378 pour l'aire de jeu (fenêtre de 1024×768 ; en 640×480 le bac recouvre ses 8 derniers pixels).
 * Choix du port : barre d'outils en haut (0 … 34), aire de jeu en (0, 36), barre de but en dessous.
 */
import { stateStart, imageCount, imageFrame, drawAnmImage } from "./anm-draw";
import type { RenderAssets } from "./assets";
import { mapColor } from "./palette";
import { drawParts } from "./parts";
import { Surface } from "./surface";
import { drawParagraph, drawText } from "./text";
import { readItf } from "../data/itf";
import type { Anm } from "../data/anm";
import type { Part } from "../engine/part";
import type { World } from "../engine/world";

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;
export const PLAYFIELD = { x: 0, y: 36, width: 568, height: 378 } as const;
export const TOOLBAR = { x: 0, y: 0, width: 640, height: 34 } as const;
export const BIN_PANEL = { x: 560, y: 36, width: 80, height: 377 } as const;
export const GOALBAR = { x: 0, y: 414, width: 640, height: 64 } as const;

/** Index de palette du fond du niveau (`backgroundColor` du LEV : 1 à 11, 3 par défaut) : couleur logique, comme 413388. */
export function backgroundIndex(backgroundColor: number | undefined): number {
  return mapColor(backgroundColor ?? 3);
}

/** Boutons de la barre d'outils, dans l'ordre de gauche à droite (WTOOLBAR.ITF). */
export const TOOLBAR_BUTTONS = ["TB_GOTO_PUZ", "TB_GOTO_WORK", "TB_GOTO_H2H", "TB_GOTO_TOUR", "TB_GOTO_SIGNIN", "TB_GOTO_TUTORIAL", "TB_DISK", "TB_MUSIC", "TB_GLOBAL", "TB_SWEEP", "TB_HELP", "TB_HINT", "TB_LOCKED", "TB_TEST", "TB_FLAG"] as const;

/** Bouton de la barre d'outils à dessiner. */
export interface ToolbarButtonView {
  name: string;
  /** Image « enfoncé » de `WTOOLBAR.ANM` (la suivante de l'état). */
  pressed?: boolean;
  /** Atténué en palette (`RenderAssets.fadeTable`) : l'ANM n'a pas d'image « désactivé ». */
  disabled?: boolean;
}

export interface ScreenOptions {
  /** Couleur de fond du LEV (1 à 11). */
  backgroundColor?: number;
  /** Texte du but, dans la barre du bas. */
  goal?: string;
  /** Machine en marche : le bouton d'essai est enfoncé. */
  running?: boolean;
  /** Dessine le bac et la barre d'outils (par défaut oui). */
  chrome?: boolean;
  /**
   * Barre d'outils de l'écran de jeu : les boutons à dessiner (les autres restent vides), enfoncés ou grisés
   * (`ui/toolbar.ts`). Sans valeur : rendu de la vague R (`TOOLBAR_BUTTONS`, `TB_TEST` enfoncé en marche).
   */
  toolbar?: readonly ToolbarButtonView[];
  /** La liste du bac est dessinée par l'appelant (`drawBinOverlay`) : `drawBin` ne pose que le panneau. */
  binPanelOnly?: boolean;
}

/** Une image d'un ANM d'interface dont l'état `state` est le premier d'une suite : renvoie l'indice de l'image. */
function imageOfState(anm: Anm, state: number): number {
  for (let i = 0; i < imageCount(anm); i++) if (stateStart(anm, i) === state) return i;
  return -1;
}

/** Aire de jeu seule : fond uni du niveau puis pièces, dans une surface de la taille de l'aire (origine en haut à gauche). */
export function renderPlayfield(assets: RenderAssets, world: World, options: ScreenOptions = {}): Surface {
  const surface = new Surface(PLAYFIELD.width, PLAYFIELD.height);
  surface.clear(backgroundIndex(options.backgroundColor));
  drawParts(surface, assets, world);
  return surface;
}

/**
 * Barre d'outils : les boutons de `WTOOLBAR.ITF`, chacun avec deux images dans `WTOOLBAR.ANM` (relâché, enfoncé). Sans
 * `buttons` : tous ceux de `TOOLBAR_BUTTONS`, `TB_TEST` enfoncé pendant la marche.
 */
export function drawToolbar(surface: Surface, assets: RenderAssets, running = false, buttons?: readonly ToolbarButtonView[]): void {
  const anm = assets.anm("WTOOLBAR.ANM");
  if (!anm || !assets.index.has("WTOOLBAR.ITF")) return;
  const itf = readItf(assets.index.get("WTOOLBAR.ITF"));
  const views: readonly ToolbarButtonView[] = buttons ?? TOOLBAR_BUTTONS.map((name) => ({ name, pressed: running && name === "TB_TEST" }));
  for (const view of views) {
    const c = itf.controls.find((k) => k.name === view.name);
    if (!c) continue;
    const first = imageOfState(anm, c.value);
    if (first < 0) continue;
    const image = first + (view.pressed ? 1 : 0);
    const f = imageFrame(anm, image);
    if (!f) continue;
    const y = c.y - 66;
    drawAnmImage(surface, assets, anm, image, c.x - f.x, y - f.y);
    if (view.disabled) surface.remap(c.x, y, c.width, c.height, assets.fadeTable());
  }
}

/** Bac : le panneau de `PARTSBIN.ANM`, puis les cases du bac (`binLayout`, sans défilement). */
export function drawBin(surface: Surface, assets: RenderAssets, world: World, panelOnly = false): void {
  const anm = assets.anm("PARTSBIN.ANM");
  if (anm) {
    const f = imageFrame(anm, 1);
    if (f) drawAnmImage(surface, assets, anm, 1, BIN_PANEL.x - f.x, BIN_PANEL.y - f.y);
  }
  if (!panelOnly) drawBinSlots(surface, assets, binLayout(assets, [...world.bin], 0));
}

// ------------------------------------------------------------------ cases du bac

/** `PB_LIST` (573, 81, 54 × 247 dans la fenêtre de `PARTSBIN.ITF`), décalé de `BIN_PANEL.y` comme le panneau. */
export const BIN_LIST = { x: 573, y: 81 + BIN_PANEL.y, width: 54, height: 247 } as const;
/**
 * Fenêtre défilante du bac (choix du port) : toute la largeur du panneau (80) sur la hauteur de `PB_LIST`. L'original
 * (417264) range les cases dans la zone cliente de sa fenêtre de bac (56 × 433 hors tout en 640×480, table 0x471f9c) ; 80 de
 * large laissent voir en entier une colonne de la plus grande case (8 + 56 + 16).
 */
export const BIN_VIEW = { x: BIN_PANEL.x, y: BIN_LIST.y, width: BIN_PANEL.width, height: BIN_LIST.height } as const;
/** Partie visible de la fenêtre : l'intérieur du cadre du panneau (4 pixels de chaque côté). */
export const BIN_CLIP = { x: BIN_PANEL.x + 4, y: BIN_LIST.y, width: BIN_PANEL.width - 8, height: BIN_LIST.height } as const;

/** Marge de la fenêtre (417264 : première case en (8, 8), passage à la colonne suivante quand y + h + 8 ≥ hauteur). */
const BIN_MARGIN = 8;
/** Case = icône + 4, + 12 de plus quand le nombre de pièces est affiché (417264 : en largeur comme en hauteur). */
const SLOT_PAD = 4;
const COUNT_PAD = 12;

/** Une case du bac : les pièces consécutives d'un même type (ordre 417133), dessinées une fois avec leur nombre. */
export interface BinSlot {
  type: number;
  parts: Part[];
  /** Case visible à l'écran (colonne × icône et marge du dessous, rognée à `BIN_CLIP`) : zone de prise et d'infobulle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Coin haut gauche de l'icône à l'écran (peut sortir de `BIN_CLIP` : le dessin est rogné). */
  iconX: number;
  iconY: number;
}

export interface BinLayout {
  /** Cases visibles (au moins en partie), en coordonnées de l'écran. */
  slots: BinSlot[];
  /** Décalage horizontal de la fenêtre (pixels), borné à [0, `maxScroll`]. */
  scroll: number;
  maxScroll: number;
  /** Bord gauche de chaque colonne dans la fenêtre non défilée (le défilement s'y cale, `binScrollStep`). */
  columns: number[];
  /** Nombre total de cases. */
  total: number;
  /** Le nombre de pièces est affiché sous chaque icône (oui si absent). */
  counts?: boolean;
}

/**
 * Mise en page du bac (417264, sens 0x47c514 = 1, le seul que pose 416f1d) : les cases s'empilent de haut en bas à partir
 * de (8, 8) ; quand l'icône suivante dépasserait (y + h + 8 ≥ hauteur), on passe à la colonne suivante, large de la plus
 * large case de la précédente, et les icônes d'une colonne sont centrées dans sa largeur. Une case fait l'icône
 * (`RenderAssets.binIcon`) + 4, + 16 avec le nombre (absent dans les modes 1 et 6, palette illimitée : `counts` faux). Un
 * type sans icône n'a pas de case. Le contenu fait 8 + la somme des colonnes de large ; la fenêtre défile en largeur
 * (barre horizontale, 0 … contenu − largeur). `scroll` est borné ici (l'original le garde tel quel quand une case
 * disparaît, 417264 appelé avec 0, et ne le borne qu'au défilement suivant).
 */
export function binLayout(assets: RenderAssets, parts: readonly Part[], scroll: number, counts = true): BinLayout {
  const pad = SLOT_PAD + (counts ? COUNT_PAD : 0);
  const cells: { type: number; parts: Part[]; x: number; y: number; w: number; h: number; column: number }[] = [];
  const columns: number[] = [BIN_MARGIN];
  const widths: number[] = [0];
  let x = BIN_MARGIN;
  let y = BIN_MARGIN;
  let previous: (typeof cells)[number] | undefined;
  for (const p of parts) {
    if (previous && previous.type === p.type) {
      previous.parts.push(p);
      continue;
    }
    const icon = assets.binIcon(p.type);
    if (!icon) {
      previous = undefined;
      continue;
    }
    if (y + icon.height + BIN_MARGIN >= BIN_VIEW.height) {
      x += widths[widths.length - 1]!;
      y = BIN_MARGIN;
      columns.push(x);
      widths.push(0);
    }
    previous = { type: p.type, parts: [p], x, y, w: icon.width, h: icon.height, column: columns.length - 1 };
    cells.push(previous);
    y += icon.height + pad;
    widths[widths.length - 1] = Math.max(widths[widths.length - 1]!, icon.width + pad);
  }
  // Une colonne vide (première icône plus haute que la fenêtre) ne prend pas de place.
  const extent = widths.reduce((a, b) => a + b, 0) + BIN_MARGIN;
  const maxScroll = Math.max(0, extent - BIN_VIEW.width);
  const s = Math.max(0, Math.min(Math.round(scroll), maxScroll));
  const slots: BinSlot[] = [];
  for (const c of cells) {
    const colW = widths[c.column]!;
    const left = BIN_VIEW.x + c.x - s;
    const top = BIN_VIEW.y + c.y;
    const x0 = Math.max(left, BIN_CLIP.x);
    const x1 = Math.min(left + colW, BIN_CLIP.x + BIN_CLIP.width);
    const y1 = Math.min(top + c.h + pad, BIN_CLIP.y + BIN_CLIP.height);
    if (x1 <= x0 || y1 <= top) continue;
    slots.push({ type: c.type, parts: c.parts, x: x0, y: top, width: x1 - x0, height: y1 - top, iconX: left + ((colW - c.w) >> 1), iconY: top });
  }
  return { slots, scroll: s, maxScroll, columns: columns.filter((_, i) => widths[i]! > 0), total: cells.length, counts };
}

/**
 * Défilement d'un cran (choix du port) : `direction` −1 ou 1 cale la colonne précédente ou suivante à la marge gauche.
 * L'original (417fff, WM_HSCROLL) avance de 16 pixels par flèche de sa barre, de la largeur de la fenêtre par page, ou
 * suit le curseur de la barre ; le panneau du port n'a que deux flèches.
 */
export function binScrollStep(layout: BinLayout, direction: number): number {
  const stops = layout.columns.map((c) => Math.min(c - BIN_MARGIN, layout.maxScroll));
  let target = layout.scroll;
  if (direction > 0) target = stops.find((v) => v > layout.scroll) ?? layout.maxScroll;
  else if (direction < 0) target = [...stops].reverse().find((v) => v < layout.scroll) ?? 0;
  return Math.max(0, Math.min(target, layout.maxScroll));
}

/**
 * Cases du bac (4183e7) : icône telle quelle (456270), puis, hors des modes 1 et 6, le nombre « %d » en `MEMOFNT8.PFT`,
 * couleur 0x14 (413388), en (x + l/2 − 6, y + h − 3) depuis le coin de l'icône, même pour 1. Rogné à `BIN_CLIP`. `hover` :
 * case encadrée de blanc (ajout du port, l'original ne marque pas la case survolée).
 */
export function drawBinSlots(surface: Surface, assets: RenderAssets, layout: BinLayout, hover?: BinSlot | null): void {
  const old = surface.setClip(BIN_CLIP.x, BIN_CLIP.y, BIN_CLIP.width, BIN_CLIP.height);
  const font = assets.font("MEMOFNT8.PFT") ?? assets.font("SYS12.FNT");
  for (const s of layout.slots) {
    if (hover === s) surface.strokeRect(s.x + 1, s.y + 1, s.width - 2, s.height - 2, mapColor(15));
    const icon = assets.binIcon(s.type);
    if (!icon) continue;
    surface.blit(icon, s.iconX, s.iconY, false, false);
    if (layout.counts !== false && font) drawText(surface, font, String(s.parts.length), s.iconX + (icon.width >> 1) - 6, s.iconY + icon.height - 3, mapColor(0x14));
  }
  surface.restoreClip(old);
}

/** Bord droit de la barre de but (cadre et reflet de l'image 1) gardé quand la barre est réduite. */
const GOAL_RIGHT_EDGE = 40;

/**
 * Barre de but : fond de `GOALBAR.ANM` (image 1), puis le texte du but dans le cadre. `width` : barre réduite (mode à deux joueurs,
 * table 0x471b80 : le tableau des joueurs est à droite) ; l'image est coupée et son bord droit recollé au bout.
 */
export function drawGoalBar(surface: Surface, assets: RenderAssets, goal?: string, width: number = GOALBAR.width): void {
  const anm = assets.anm("GOALBAR.ANM");
  if (!anm) return;
  const f = imageFrame(anm, 1);
  if (f && width >= GOALBAR.width) drawAnmImage(surface, assets, anm, 1, GOALBAR.x - f.x, GOALBAR.y - f.y);
  else if (f) {
    const edge = Math.min(GOAL_RIGHT_EDGE, width);
    let old = surface.setClip(GOALBAR.x, GOALBAR.y, width - edge, GOALBAR.height);
    drawAnmImage(surface, assets, anm, 1, GOALBAR.x - f.x, GOALBAR.y - f.y);
    surface.restoreClip(old);
    old = surface.setClip(GOALBAR.x + width - edge, GOALBAR.y, edge, GOALBAR.height);
    drawAnmImage(surface, assets, anm, 1, GOALBAR.x + width - GOALBAR.width - f.x, GOALBAR.y - f.y);
    surface.restoreClip(old);
  }
  const font = assets.font("GOALFONT.PFT");
  if (goal && font) drawParagraph(surface, font, goal, GOALBAR.x + 20, GOALBAR.y + 9, Math.min(530, width - 40), 46, mapColor(0));
}

/** Écran complet 640×480. */
export function composeScreen(assets: RenderAssets, world: World, options: ScreenOptions = {}): Surface {
  const screen = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  screen.clear(mapColor(6));
  const field = renderPlayfield(assets, world, options);
  screen.copyFrom(field, 0, 0, field.width, field.height, PLAYFIELD.x, PLAYFIELD.y);
  if (options.chrome !== false) {
    drawToolbar(screen, assets, options.running, options.toolbar);
    drawBin(screen, assets, world, options.binPanelOnly);
    drawGoalBar(screen, assets, options.goal);
  }
  return screen;
}
