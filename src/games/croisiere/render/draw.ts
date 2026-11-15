/**
 * Composition de l'écran 320 × 200 indexé, au pixel près : fond, cellules sprite et polygone dans l'ordre de la liste avec leurs masques
 * d'occultation, messages, menu actif ou bandeau « Objet:Verbe », incrustations dans les fonds, message de pause.
 *
 * Références : ScummVM `engines/cruise/` (GPL v3+, release 2026.4.0), lu puis réécrit :
 * - `mainDraw.cpp` : `mainDraw` (partie dessin), `mainDrawPolygons` (construction du masque `polygonMask`), `drawMask`,
 *   `clearMaskBit`, `drawSprite`, `drawMessage`, `drawMenu` ; le rastériseur lui-même est `render/poly.ts` ;
 * - `backgroundIncrust.cpp` : `addBackgroundIncrust` et `regenerateBackgroundIncrust` (dessin), `addBackgroundIncrustSub1` ;
 * - `gfxModule.cpp` : `drawSolidBox` ; `cruise.cpp::pauseEngine` et `font.cpp::drawString` (message de pause) ;
 * - `cruise_main.cpp::testMask`.
 *
 * Le dessin fait partie de la logique, comme dans ScummVM : l'état du rastériseur (`e.display.poly`) est partagé avec le hit-test et
 * les zones de marche, les incrustations modifient les fonds (sauvegardés), et `drawMenu` place les entrées que la souris teste ensuite.
 * Ces fonctions tournent donc toujours, même sans affichage ; seul `CroisiereRenderer.present` dépend de l'hôte.
 *
 * Écarts volontaires (aucun ne se produit sur les données du jeu, à notre connaissance) : un objet introuvable garde les paramètres de
 * l'objet précédent (ScummVM lit une variable non initialisée, en pratique la même case de pile) ; une entrée de fichier absente ou
 * hors de la base n'est ni dessinée ni utilisée comme masque ; la lecture du masque d'un sprite de largeur non multiple de 8, qui
 * dépasse d'un octet le tampon de travail dans ScummVM, lit l'octet suivant du masque d'origine.
 */
import type { FontFile } from "../data/font";
import { parsePolyRecord, type PolyRecord } from "../data/poly-model";
import type { BitmapEntry } from "../data/sets";
import type { Cell } from "../engine/cells";
import type { FileEntry } from "../engine/files";
import { ObjType } from "../engine/ids";
import { int16 } from "../engine/memory";
import { getMultipleObjectParam, type ObjectQuery } from "../engine/objects";
import type { EngineState } from "../engine/state";
import { POLY_MASK_STRIDE, polyBounds, resolvePoly, SCREEN_HEIGHT, SCREEN_WIDTH, type PolyBounds, type PolyResolver } from "./poly";
import { fontFromEntry, fontFromFile, renderTextWith, type TextGfx } from "./text";

export type { TextGfx } from "./text";

/** Fichier de la police système (`loadFNT("system.fnt")`, hors des volumes). */
export const SYSTEM_FONT_FILE = "SYSTEM.FNT";
/** Largeur d'une colonne de menu. */
export const MENU_WIDTH = 160;

// ---------------------------------------------------------------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------------------------------------------------------------

const systemFonts = new WeakMap<EngineState, FontFile | null>();

/** `_systemFNT` : `null` si le fichier manque (les textes ne sont alors pas rendus, comme ScummVM). */
export function systemFont(e: EngineState): FontFile | null {
  if (!systemFonts.has(e)) {
    const bytes = e.readFile(SYSTEM_FONT_FILE);
    systemFonts.set(e, bytes ? fontFromFile(bytes) : null);
  }
  return systemFonts.get(e)!;
}

/** Police de `renderText` : l'entrée `fontFileIndex` si elle est chargée, sinon la police système. */
export function currentFont(e: EngineState): FontFile | null {
  if (e.fontFileIndex !== -1) {
    const entry = e.filesDb.get(e.fontFileIndex);
    if (entry) {
      if (entry.set) throw new Error(`renderText : l'entrée ${e.fontFileIndex} n'est pas une police`);
      return fontFromEntry(entry.data);
    }
  }
  return systemFont(e);
}

/** `renderText(width, text)` avec la police courante. */
export function renderText(e: EngineState, width: number, text: string): TextGfx | null {
  const font = currentFont(e);
  return font ? renderTextWith(font, width, text) : null;
}

/** `drawMessage` : texte rendu posé en `(x, y)`, recadré dans l'écran ; 1 = noir, 2 = `color`. */
export function drawMessage(gfx: TextGfx | null, x: number, y: number, width: number, color: number, out: Uint8Array): void {
  if (!gfx) return;
  if (width > 310) width = 310;
  if (width + x > 319) x = 319 - width;
  if (y < 0) y = 0;
  if (x < 0) x = 0;
  if (y + gfx.height >= 198) y = 198 - gfx.height;
  const ink = color & 0xff;
  let src = 0;
  for (let yp = 0; yp < gfx.height; yp++) {
    const py = y + yp;
    for (let xp = 0; xp < gfx.width; xp++) {
      const value = gfx.pixels[src++]!;
      const px = x + xp;
      if (value && px >= 0 && px < SCREEN_WIDTH && py >= 0 && py < SCREEN_HEIGHT) out[py * SCREEN_WIDTH + px] = value === 1 ? 0 : ink;
    }
  }
}

/** `drawSolidBox` (bornes droite et basse exclues). */
export function drawSolidBox(out: Uint8Array, x1: number, y1: number, x2: number, y2: number, color: number): void {
  for (let y = y1; y < y2; y++) out.fill(color, y * SCREEN_WIDTH + x1, y * SCREEN_WIDTH + x2);
}

/**
 * Message de pause (`pauseEngine(true)`) : bande noire, texte `itemColor` dans la page affichée, puis présentation. La boucle de
 * pause elle-même appartient à l'interface.
 */
export function showPauseMessage(e: EngineState, text: string): void {
  const d = e.display;
  drawSolidBox(d.page00, 64, 100, 256, 117, 0);
  // drawString(10, 100, texte, pPage00, itemColor, 300)
  drawMessage(renderText(e, 300, text), 10, 100, 300 - 10, d.itemColor, d.page00);
  d.showPage();
  e.renderer.present?.(e);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------------------------------------------------------------

/** Entrée de menu (`menuElementStruct`) : `x`, `y` sont posés par `drawMenu`, puis lus par `updateMenuMouse` et `Op_X/YMenuItem`. */
export interface MenuElementView {
  x: number;
  y: number;
  selected: boolean;
  /** Couleur propre, stockée sur un octet (`unsigned char`) : −1 ou 255 = `itemColor`. */
  color: number;
  /** `renderText(160, texte)`. */
  gfx: TextGfx | null;
}

/** Menu (`menuStruct`) : `x = X − 80`, `y = Y` à la création, titre rendu sur 160 pixels. */
export interface MenuView {
  x: number;
  y: number;
  gfx: TextGfx | null;
  elements: readonly MenuElementView[];
}

/** `drawMenu` : place les entrées (colonnes de 160 pixels) et les dessine dans `out` (`pPage10`). */
export function drawMenu(e: EngineState, menu: MenuView | null, out: Uint8Array): void {
  if (!menu || !menu.elements.length) return;
  const d = e.display;
  const count = menu.elements.length;
  const hline = menu.gfx!.height;
  let x = menu.x;
  let y = menu.y + hline;
  const perColumn = Math.trunc((199 - hline * 2) / hline);
  let columns = Math.trunc(count / perColumn);
  if (!columns) {
    columns++;
    if (y + count * hline > 199 - hline) y = 200 - count * hline - hline;
  } else {
    if (count % perColumn) columns++;
    y = hline;
  }
  if (x > 320 - columns * MENU_WIDTH) x = 320 - columns * MENU_WIDTH;
  if (x < 0) x = 0;
  let wx = x + Math.trunc(((columns - 1) * MENU_WIDTH) / 2);
  if (wx <= 320 - MENU_WIDTH) drawMessage(menu.gfx, wx, y - hline, MENU_WIDTH, d.titleColor, out);
  wx = x;
  let wy = y;
  let wc = 0;
  for (const item of menu.elements) {
    item.x = wx;
    item.y = wy;
    const own = item.color & 0xff;
    const color = item.selected ? d.selectColor : own !== 255 ? own : d.itemColor;
    if (wx <= 320 - MENU_WIDTH) drawMessage(item.gfx, wx, wy, MENU_WIDTH, color, out);
    wy += hline;
    if (++wc === perColumn) {
      wc = 0;
      wx += MENU_WIDTH;
      wy = y;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sprites, masques, polygones
// ---------------------------------------------------------------------------------------------------------------------------------

const polyRecords = new WeakMap<FileEntry, PolyRecord>();

/** Enregistrement vectoriel d'une entrée de type polygone. */
export function polyRecord(entry: FileEntry): PolyRecord {
  let record = polyRecords.get(entry);
  if (!record) {
    record = parsePolyRecord(entry.data);
    polyRecords.set(entry, record);
  }
  return record;
}

/** Cible d'un renvoi miroir : l'entrée de la base, si c'est un polygone (dessin et hit-test de `findObject`). */
export function polyResolver(e: EngineState): PolyResolver {
  return (index) => {
    const entry = e.filesDb.get(index);
    return entry && entry.resourceType === ObjType.POLY ? polyRecord(entry) : null;
  };
}

function bitmapOf(entry: FileEntry): BitmapEntry | null {
  return entry.set && entry.set.kind !== "poly" ? entry.set : null;
}

/** `testMask`. */
function testMask(mask: Uint8Array, x: number, y: number, stride: number): boolean {
  return ((mask[y * stride + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;
}

/** `drawMask` : efface dans `work` (`wbStride` octets par ligne, `wbHeight` lignes) les pixels couverts par le masque posé en `(mx, my)`. */
function drawMask(work: Uint8Array, wbStride: number, wbHeight: number, mask: Uint8Array, maskStride: number, maskHeight: number, mx: number, my: number): void {
  const wbWidth = wbStride * 8;
  for (let y = 0; y < maskHeight; y++) {
    const dy = my + y;
    if (dy < 0 || dy >= wbHeight) continue;
    for (let x = 0; x < maskStride * 8; x++) {
      if (!testMask(mask, x, y, maskStride)) continue;
      const dx = mx + x;
      if (dx >= 0 && dx < wbWidth) work[dy * wbStride + (dx >> 3)]! &= ~(0x80 >> (dx & 7));
    }
  }
}

/**
 * Applique les masques des cellules BGMASK non gelées situées à partir de `from` (tous plans confondus) : position et image de l'objet
 * du masque, image de type BGMASK ou SPRITE ; `(ox, oy)` est l'origine du tampon de travail.
 */
function applyMasks(e: EngineState, from: Cell | null, work: Uint8Array, wbStride: number, wbHeight: number, ox: number, oy: number): void {
  for (let c = from; c; c = c.next) {
    if (c.type !== ObjType.BGMASK || c.freeze !== 0) continue;
    const params = getMultipleObjectParam(e, c.overlay, c.idx);
    if (!params) continue;
    const entry = e.filesDb.get(params.fileIdx);
    if (!entry || (entry.resourceType !== ObjType.BGMASK && entry.resourceType !== ObjType.SPRITE)) continue;
    const bitmap = bitmapOf(entry);
    if (!bitmap) continue;
    drawMask(work, wbStride, wbHeight, bitmap.mask, Math.trunc(entry.width / 8), entry.height, params.X - ox, params.Y - oy);
  }
}

/**
 * `drawSprite` : image `width × height` en `(xs, ys)` dans `out`, à travers son masque d'opacité et les masques des cellules qui suivent
 * `cell` (aucun pour une incrustation, `cell = null`).
 */
export function drawSprite(e: EngineState, entry: FileEntry, cell: Cell | null, xs: number, ys: number, out: Uint8Array): void {
  const bitmap = bitmapOf(entry);
  if (!bitmap) return;
  const { width, height } = entry;
  const stride = Math.trunc(width / 8);
  const size = height * stride;
  const work = bitmap.mask.slice(0, size + 1);
  if (cell) applyMasks(e, cell, work, stride, height, xs, ys);
  const pixels = bitmap.pixels;
  let src = 0;
  for (let y = 0; y < height; y++) {
    const py = y + ys;
    for (let x = 0; x < width; x++) {
      const color = pixels[src++]!;
      const px = x + xs;
      if (px >= 0 && px < SCREEN_WIDTH && py >= 0 && py < SCREEN_HEIGHT && testMask(work, x, y, stride)) out[py * SCREEN_WIDTH + px] = color;
    }
  }
}

/** `mainDrawPolygons` : masque d'occultation plein écran des cellules qui suivent, puis dessin cadré du modèle (`render/poly.ts`). */
function drawPolygons(e: EngineState, fileIdx: number, entry: FileEntry, cell: Cell, x: number, y: number, scale: number, out: Uint8Array): void {
  const d = e.display;
  const mask = d.polygonMask;
  mask.fill(0xff);
  applyMasks(e, cell, mask, POLY_MASK_STRIDE, SCREEN_HEIGHT, 0, 0);
  d.poly.drawCell(fileIdx, polyRecord(entry), x, y, scale, out, mask, polyResolver(e));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Incrustations
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Dessin d'une incrustation dans un fond : sprite sans masque de cellule, ou modèle polygonal sans cadrage ni masque
 * (`addBackgroundIncrustSub1`, qui exige un modèle et pas un renvoi miroir).
 */
export function drawIncrust(e: EngineState, entry: FileEntry, x: number, y: number, scale: number, out: Uint8Array): void {
  if (entry.resourceType === ObjType.SPRITE) {
    drawSprite(e, entry, null, x, y, out);
    return;
  }
  const record = polyRecord(entry);
  if (record.kind !== "model") throw new Error("Incrustation d'un renvoi miroir (assertion de ScummVM)");
  e.display.poly.drawModel(record, x, y, scale, out, null);
}

/** Boîte d'un polygone pour la sauvegarde du fond (`flipPoly` puis `getPolySize`), `null` si le renvoi miroir est invalide. */
export function incrustPolyBounds(e: EngineState, fileIdx: number, entry: FileEntry, x: number, y: number, scale: number): PolyBounds | null {
  const poly = resolvePoly(fileIdx, polyRecord(entry), x, y, scale, polyResolver(e));
  return poly ? polyBounds(poly.model, poly.x, poly.y, poly.scale) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Image complète
// ---------------------------------------------------------------------------------------------------------------------------------

const NO_PARAMS: ObjectQuery = { X: 0, Y: 0, baseFileIdx: 0, fileIdx: 0, scale: 0, state: 0, state2: 0, nbState: 0 };

/**
 * Partie dessin de `mainDraw` dans la page de travail (`pPage10`) : copie du fond de l'écran maître, cellules SPRITE non gelées du plan
 * (image du fichier courant, relative à l'objet suivi), messages, puis menu actif ou bandeau de la relation liée. Appelée avant la
 * logique des auto-animations de la même passe (`engine/main-loop.ts`), qui ne modifie rien de ce qui est dessiné avant `freeAutoCell`.
 */
export function drawScreen(e: EngineState): void {
  const d = e.display;
  const page = d.page10;
  const bg = d.backgroundScreens[d.masterScreen];
  if (bg) page.set(bg);

  let params = NO_PARAMS;
  for (const cell of e.cells) {
    if (d.masterScreen !== cell.backgroundPlane || cell.freeze !== 0 || cell.type !== ObjType.SPRITE) continue;
    let x1 = 0;
    let y1 = 0;
    let z1 = 0;
    if (cell.followObjectOverlayIdx !== cell.overlay || cell.followObjectIdx !== cell.idx) {
      params = getMultipleObjectParam(e, cell.followObjectOverlayIdx, cell.followObjectIdx) ?? params;
      x1 = int16(params.X);
      y1 = int16(params.Y);
      z1 = int16(params.fileIdx);
    }
    params = getMultipleObjectParam(e, cell.overlay, cell.idx) ?? params;
    const x2 = int16(x1 + params.X);
    const y2 = int16(y1 + params.Y);
    let z2 = int16(params.fileIdx);
    if (z2 >= 0) z2 = int16(z2 + z1);
    if (params.state < 0 || z2 < 0) continue;
    const entry = e.filesDb.get(z2);
    if (!entry) continue;
    if (entry.resourceType === ObjType.POLY) drawPolygons(e, z2, entry, cell, x2, y2, params.scale, page);
    else if (entry.resourceType === ObjType.SOUND || entry.resType === ObjType.MASK) continue;
    else if (entry.resourceType === ObjType.SPRITE) drawSprite(e, entry, cell, x2, y2, page);
  }

  for (const cell of e.cells) {
    if (cell.type === ObjType.MESSAGE && cell.freeze === 0) drawMessage(cell.gfx as TextGfx | null, cell.x, cell.fieldC, cell.spriteIdx, cell.color, page);
  }

  if (e.currentActiveMenu !== -1) {
    drawMenu(e, e.menuTable[e.currentActiveMenu] ?? null, page);
  } else if (e.linkedRelation && e.linkedMsgList) {
    const banner = e.linkedMsgList;
    drawMessage(banner, 0, e.currentMouseY > banner.height * 2 ? 0 : 200, 320, d.findHighColor(), page);
  }
}
