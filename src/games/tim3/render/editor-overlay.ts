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
import { BIN_PANEL, PLAYFIELD } from "./screen";
import type { Surface } from "./surface";
import { drawText } from "./text";

/** `PB_LIST` (573, 81, 54 × 247) dans l'écran du port. */
export const BIN_LIST = { x: 573, y: 81 + BIN_PANEL.y, width: 54, height: 247 } as const;
/** `PB_LEFT` / `PB_RIGHT` (flèches de défilement, 22 × 24) et `PB_PLAY` (34 × 33, Démarrer / Arrêter). */
export const BIN_UP = { x: 565, y: 336 + BIN_PANEL.y, width: 22, height: 24 } as const;
export const BIN_DOWN = { x: 586, y: 336 + BIN_PANEL.y, width: 22, height: 24 } as const;
export const BIN_PLAY = { x: 564, y: 6 + BIN_PANEL.y, width: 32, height: 33 } as const;
/** États de `PARTSBIN.ANM` : bouton de marche (2), flèches (5, 6). */
const STATE_PLAY = 2;
const STATE_UP = 5;
const STATE_DOWN = 6;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/** Une case du bac : les pièces consécutives d'un même type (ordre 417133), dessinées une fois avec leur nombre. */
export interface BinSlot {
  type: number;
  parts: Part[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BinLayout {
  slots: BinSlot[];
  /** Index de la première case affichée et nombre total de cases. */
  first: number;
  total: number;
  /** Le nombre de pièces est affiché sous chaque icône (oui si absent). */
  counts?: boolean;
}

/**
 * Mise en page du bac (417264) : chaque case prend l'icône (`RenderAssets.binIcon`) plus 4 pixels, plus 12 pour le nombre de
 * pièces quand il est affiché (pas dans les modes 1 et 6 du jeu, où le bac est une palette illimitée). Le jeu range les
 * cases en lignes dans une fenêtre défilante ; le port les empile dans la colonne de `PB_LIST`.
 */
const SLOT_MARGIN = 4;
const COUNT_ROOM = 12;
/** Case sans icône (ne devrait pas arriver avec les données d'origine). */
const EMPTY_ICON = 18;

function slotHeight(assets: RenderAssets, type: number, counts: boolean): number {
  return (assets.binIcon(type)?.height ?? EMPTY_ICON) + SLOT_MARGIN + (counts ? COUNT_ROOM : 0);
}

/**
 * Cases du bac à partir de la case `first`, tant qu'elles tiennent dans `PB_LIST`. `counts` : le nombre de pièces est
 * affiché sous l'icône (vrai par défaut, comme dans les puzzles ; faux pour une palette illimitée comme le Labo).
 */
export function binLayout(assets: RenderAssets, parts: readonly Part[], first: number, counts = true): BinLayout {
  const groups: { type: number; parts: Part[] }[] = [];
  for (const p of parts) {
    const last = groups[groups.length - 1];
    if (last && last.type === p.type) last.parts.push(p);
    else groups.push({ type: p.type, parts: [p] });
  }
  const start = Math.max(0, Math.min(first, Math.max(0, groups.length - 1)));
  const slots: BinSlot[] = [];
  let y = BIN_LIST.y;
  for (let i = start; i < groups.length; i++) {
    const h = slotHeight(assets, groups[i]!.type, counts);
    if (y + h > BIN_LIST.y + BIN_LIST.height && slots.length > 0) break;
    slots.push({ ...groups[i]!, x: BIN_LIST.x, y, width: BIN_LIST.width, height: h });
    y += h;
  }
  return { slots, first: start, total: groups.length, counts };
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

/** Liste du bac (remplace celle de `drawBin`), flèches et bouton de marche. */
export function drawBinOverlay(surface: Surface, assets: RenderAssets, overlay: BinOverlay): void {
  const panel = assets.anm("PARTSBIN.ANM");
  if (panel) {
    // Fond de la liste : on efface ce que `drawBin` a pu y poser.
    const f = imageFrame(panel, 1);
    if (f) {
      const old = surface.setClip(BIN_LIST.x, BIN_LIST.y, BIN_LIST.width, BIN_LIST.height);
      drawAnmImage(surface, assets, panel, 1, BIN_PANEL.x - f.x, BIN_PANEL.y - f.y);
      surface.restoreClip(old);
    }
    const play = stateImage(panel, STATE_PLAY);
    if (play >= 0) drawAnmImage(surface, assets, panel, play + (overlay.running ? 1 : 0), 0, BIN_PANEL.y);
    const { first, total, slots } = overlay.layout;
    const up = stateImage(panel, STATE_UP);
    const down = stateImage(panel, STATE_DOWN);
    if (up >= 0 && first > 0) drawAnmImage(surface, assets, panel, up, 0, BIN_PANEL.y);
    if (down >= 0 && first + slots.length < total) drawAnmImage(surface, assets, panel, down, 0, BIN_PANEL.y);
  }
  // Les icônes font jusqu'à 56 (64 pour le type 26) pixels de large : on les laisse déborder de `PB_LIST` sur le cadre.
  const old = surface.setClip(BIN_PANEL.x + 4, BIN_LIST.y, BIN_PANEL.width - 8, BIN_LIST.height);
  const font = assets.font("MEMOFNT8.PFT") ?? assets.font("SYS12.FNT");
  for (const s of overlay.layout.slots) {
    if (overlay.hover === s) surface.strokeRect(s.x + 1, s.y + 1, s.width - 2, s.height - 2, mapColor(15));
    const icon = assets.binIcon(s.type);
    const w = icon?.width ?? 0;
    const h = icon?.height ?? EMPTY_ICON;
    const x = s.x + ((s.width - w) >> 1);
    const y = s.y + (SLOT_MARGIN >> 1);
    if (icon) surface.blit(icon, x, y, false, false);
    // 4183e7 : « %d » en MEMOFNT8, couleur 0x14 (413388), en (x + l/2 − 6, y + h − 3) depuis le coin de l'icône.
    if (overlay.layout.counts !== false && font) drawText(surface, font, String(s.parts.length), x + (w >> 1) - 6, y + h - 3, mapColor(0x14));
  }
  surface.restoreClip(old);
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

/** Flèche d'indice : la main de `CURSORS.BMP` (image 3, supposé), point chaud à la position de l'indice dans l'aire. */
export function drawHintArrow(surface: Surface, assets: RenderAssets, x: number, y: number, flip: number): void {
  const c = cursorAt(assets, 3);
  if (!c) return;
  const old = surface.setClip(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
  const fx = (flip & 1) !== 0;
  const fy = (flip & 2) !== 0;
  const hx = fx ? c.image.width - c.hotX : c.hotX;
  const hy = fy ? c.image.height - c.hotY : c.hotY;
  surface.blit(c.image, PLAYFIELD.x + x - hx, PLAYFIELD.y + y - hy, fx, fy);
  surface.restoreClip(old);
}

/** Curseur `CURSORS.BMP` numéro `index` (438055) au point (x, y) de l'écran. */
export function drawCursorAt(surface: Surface, assets: RenderAssets, index: number, x: number, y: number): void {
  const c = cursorAt(assets, index);
  if (c) drawCursor(surface, c, x, y);
}
