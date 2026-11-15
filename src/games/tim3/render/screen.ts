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
import { drawParagraph } from "./text";
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

/** Bac : le panneau de `PARTSBIN.ANM`, puis les pièces du bac empilées (mise en page supposée, voir `docs/tim3/graphics.md`). */
export function drawBin(surface: Surface, assets: RenderAssets, world: World, panelOnly = false): void {
  const anm = assets.anm("PARTSBIN.ANM");
  if (anm) {
    const f = imageFrame(anm, 1);
    if (f) drawAnmImage(surface, assets, anm, 1, BIN_PANEL.x - f.x, BIN_PANEL.y - f.y);
  }
  if (!panelOnly) drawBinParts(surface, assets, [...world.bin]);
}

/** Pièces du bac, l'une sous l'autre (icônes de `RenderAssets.binIcon`), centrées dans la colonne ; celles qui ne tiennent pas sont omises. */
function drawBinParts(surface: Surface, assets: RenderAssets, parts: Part[]): void {
  const colX = BIN_PANEL.x + 4;
  const colW = BIN_PANEL.width - 8;
  let y = BIN_PANEL.y + 60;
  const bottom = BIN_PANEL.y + BIN_PANEL.height - 6;
  const old = surface.setClip(colX, BIN_PANEL.y, colW, BIN_PANEL.height);
  for (const p of parts) {
    const icon = assets.binIcon(p.type);
    if (!icon) continue;
    if (y + icon.height > bottom) break;
    surface.blit(icon, colX + ((colW - icon.width) >> 1), y, false, false);
    y += icon.height + 4;
  }
  surface.restoreClip(old);
}

/** Barre de but : fond de `GOALBAR.ANM` (image 1), puis le texte du but dans le cadre. */
export function drawGoalBar(surface: Surface, assets: RenderAssets, goal?: string): void {
  const anm = assets.anm("GOALBAR.ANM");
  if (!anm) return;
  const f = imageFrame(anm, 1);
  if (f) drawAnmImage(surface, assets, anm, 1, GOALBAR.x - f.x, GOALBAR.y - f.y);
  const font = assets.font("GOALFONT.PFT");
  if (goal && font) drawParagraph(surface, font, goal, GOALBAR.x + 20, GOALBAR.y + 9, 530, 46, mapColor(0));
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
