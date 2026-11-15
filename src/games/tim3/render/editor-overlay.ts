/**
 * Ce que l'écran de construction dessine par-dessus l'aire et le bac : liste du bac (`PARTSBIN.ITF` : `PB_LIST`, flèches
 * `PB_LEFT` / `PB_RIGHT`, bouton `PB_PLAY`), pièce tenue, poignées d'une pièce posée (`HANDLES.ANM`, 42e1e4), ligne
 * élastique d'une corde ou d'une courroie en cours de pose (couleurs 0x88 permis / 0x87 refusé, 42ee54), flèche d'indice et
 * curseur. Aucune dépendance au navigateur.
 *
 * Mise en page (choix du port, `docs/tim3/graphics.md`) : les contrôles de `PARTSBIN.ITF` sont dans l'espace 640×400 de la
 * fenêtre du bac ; le port les décale de `BIN_PANEL.y` (36) comme le panneau.
 */
import type { Part } from "../engine/part";
import type { World } from "../engine/world";
import { drawAnmImage, imageCount, imageFrame, stateStart } from "./anm-draw";
import type { RenderAssets } from "./assets";
import { cursorAt, drawCursor } from "./cursors";
import { mapColor } from "./palette";
import { drawPart, layersOf } from "./parts";
import { ropeLine } from "./ropes";
import { BIN_CLIP, BIN_PANEL, PLAYFIELD, drawBinSlots, type BinLayout, type BinSlot } from "./screen";
import type { Surface } from "./surface";

/** `PB_LEFT` / `PB_RIGHT` (flèches de défilement, 22 × 24) et `PB_PLAY` (34 × 33, Démarrer / Arrêter). */
export const BIN_LEFT = { x: 565, y: 336 + BIN_PANEL.y, width: 22, height: 24 } as const;
export const BIN_RIGHT = { x: 586, y: 336 + BIN_PANEL.y, width: 22, height: 24 } as const;
export const BIN_PLAY = { x: 564, y: 6 + BIN_PANEL.y, width: 32, height: 33 } as const;
/** États de `PARTSBIN.ANM` : bouton de marche (2), flèches (5, 6). */
const STATE_PLAY = 2;
const STATE_LEFT = 5;
const STATE_RIGHT = 6;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/** Icône de bac du type `type`, coin haut gauche en (x, y) (456270, sans retournement). Renvoie sa taille. */
export function drawBinIcon(surface: Surface, assets: RenderAssets, type: number, x: number, y: number): { width: number; height: number } | null {
  const icon = assets.binIcon(type);
  if (!icon) return null;
  surface.blit(icon, x, y, false, false);
  return { width: icon.width, height: icon.height };
}

/** Image d'un état d'une ANM (première image de l'état), −1 s'il n'existe pas. */
export function stateImage(anm: { states: { first: number; state: number }[] }, state: number): number {
  return anm.states.find((s) => s.state === state)?.first ?? -1;
}

export interface BinOverlay {
  layout: BinLayout;
  running: boolean;
  /** Case sous le pointeur (mise en valeur). */
  hover?: BinSlot | null;
}

/**
 * Liste du bac (remplace celle de `drawBin`), flèches et bouton de marche. Flèche allumée (états 5 et 6 de
 * `PARTSBIN.ANM`) quand la fenêtre peut défiler de ce côté (choix du port : la barre de défilement de l'original n'est
 * jamais grisée, elle disparaît quand tout tient, `SetScrollRange` 0 … 0).
 */
export function drawBinOverlay(surface: Surface, assets: RenderAssets, overlay: BinOverlay): void {
  const panel = assets.anm("PARTSBIN.ANM");
  if (panel) {
    // Fond de la liste : on efface ce que `drawBin` a pu y poser.
    const f = imageFrame(panel, 1);
    if (f) {
      const old = surface.setClip(BIN_CLIP.x, BIN_CLIP.y, BIN_CLIP.width, BIN_CLIP.height);
      drawAnmImage(surface, assets, panel, 1, BIN_PANEL.x - f.x, BIN_PANEL.y - f.y);
      surface.restoreClip(old);
    }
    const play = stateImage(panel, STATE_PLAY);
    if (play >= 0) drawAnmImage(surface, assets, panel, play + (overlay.running ? 1 : 0), 0, BIN_PANEL.y);
    const { scroll, maxScroll } = overlay.layout;
    const left = stateImage(panel, STATE_LEFT);
    const right = stateImage(panel, STATE_RIGHT);
    if (left >= 0 && scroll > 0) drawAnmImage(surface, assets, panel, left, 0, BIN_PANEL.y);
    if (right >= 0 && scroll < maxScroll) drawAnmImage(surface, assets, panel, right, 0, BIN_PANEL.y);
  }
  drawBinSlots(surface, assets, overlay.layout, overlay.hover);
}

/** Pièce tenue, dessinée dans l'aire à sa position (tous ses plans), encadrée de rouge si elle ne peut pas être posée là. */
export function drawHeldPart(surface: Surface, assets: RenderAssets, world: World, part: Part, valid: boolean, inField: boolean): void {
  const [a, b] = layersOf(world.types.get(part.type).f20);
  const old = inField ? surface.setClip(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height) : null;
  const view = { x: -PLAYFIELD.x, y: -PLAYFIELD.y };
  for (const layer of [8, 7, 6, 5, 4, 3, 2, 1, 0]) if (layer === a || layer === b) drawPart(surface, assets, world, part, layer, view);
  if (!valid && inField) surface.strokeRect(PLAYFIELD.x + part.px - 1, PLAYFIELD.y + part.py - 1, (part.frameW || part.shapeW) + 2, (part.frameH || part.shapeH) + 2, mapColor(4));
  if (old) surface.restoreClip(old);
}

/** Poignée (42e1e4) : image `frame` de `HANDLES.ANM` (origine au coin de la poignée, coordonnées de l'aire). */
export interface HandleView {
  x: number;
  y: number;
  /** Image de `HANDLES.ANM` (première image de l'état, ou suivante quand le pointeur est dessus). */
  frame: number;
}

/** Image suivante d'une poignée animée : on revient au début de l'état quand une autre commence (42e2a2). */
export function nextHandleFrame(assets: RenderAssets, frame: number, base: number): number {
  const anm = assets.anm("HANDLES.ANM");
  if (!anm) return frame;
  const n = frame + 1;
  return n >= imageCount(anm) || stateStart(anm, n) !== 0 ? base : n;
}

export function drawHandles(surface: Surface, assets: RenderAssets, handles: readonly HandleView[]): void {
  const anm = assets.anm("HANDLES.ANM");
  if (!anm) return;
  const old = surface.setClip(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
  for (const h of handles) drawAnmImage(surface, assets, anm, h.frame, PLAYFIELD.x + h.x, PLAYFIELD.y + h.y);
  surface.restoreClip(old);
}

/** Ligne élastique d'un lien en cours (coordonnées de l'aire) : 0x88 si la cible est permise, 0x87 sinon. */
export function drawRubberBand(surface: Surface, line: { x1: number; y1: number; x2: number; y2: number }, valid: boolean): void {
  const old = surface.setClip(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
  ropeLine(surface, PLAYFIELD.x + line.x1, PLAYFIELD.y + line.y1, PLAYFIELD.x + line.x2, PLAYFIELD.y + line.y2, valid ? 0x88 : 0x87);
  surface.restoreClip(old);
}

/** Main d'un indice : contrôle de 44 × 43 posé en (x, y) de l'emplacement LEV, dans l'aire (41ef54). */
export function hintRect(x: number, y: number): Rect {
  return { x: PLAYFIELD.x + x, y: PLAYFIELD.y + y, width: 44, height: 43 };
}

/**
 * Main d'un indice (433268) : image 41 de `HANDLES.BMP` (main vers le bas) si `flip` ≤ 1, 42 (vers le haut) sinon, en miroir
 * gauche-droite et 4 pixels plus à gauche si `flip` est impair ; posée au coin du contrôle de l'indice, dans l'aire.
 */
export function drawHintArrow(surface: Surface, assets: RenderAssets, x: number, y: number, flip: number): void {
  const image = assets.bitmap("HANDLES.BMP")?.frames[flip <= 1 ? 41 : 42];
  if (!image) return;
  const mirror = (flip & 1) !== 0;
  const r = hintRect(x, y);
  const old = surface.setClip(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
  surface.blit(image, r.x - (mirror ? 4 : 0), r.y, mirror, false);
  surface.restoreClip(old);
}

/** Curseur `CURSORS.BMP` numéro `index` (438055) au point (x, y) de l'écran. */
export function drawCursorAt(surface: Surface, assets: RenderAssets, index: number, x: number, y: number): void {
  const c = cursorAt(assets, index);
  if (c) drawCursor(surface, c, x, y);
}
