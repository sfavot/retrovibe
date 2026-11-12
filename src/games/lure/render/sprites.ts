/**
 * Images des hotspots : `Hotspot::setAnimation` (construction de la planche d'images), `Hotspot::copyTo` (découpe et rognage),
 * `Surface::copyTo` avec couleur transparente, et le tri des sprites de `Room::update` (engines/lure/hotspots.cpp, room.cpp, surface.cpp,
 * ScummVM, GPL v3+).
 *
 * La planche d'un hotspot est une surface `largeur x nombre d'images` de hauteur `hauteur`, remplie de `colorOffset` ; chaque pixel
 * d'image (un quartet de 0 à 15) y est écrit **plus `colorOffset`** (décalage de couleur : le même dessin sert à plusieurs personnages avec des
 * palettes différentes). À l'affichage, les pixels égaux à `colorOffset` sont transparents.
 *
 * Cas du Serf du chevalet (`RACK_SERF_ID`, 0x411) : ses huit images n'ont pas la même taille. La planche fait 416 x 27, les images sont lues
 * à la suite avec une largeur et une hauteur qui changent aux images 3 (48 x 25), 4 (hauteur 26), 5 (largeur 32), 6 (hauteur 27) et 7
 * (largeur 16) ; le début de chaque image est gardé (`frameStarts`) et `copyTo` découpe d'après ces débuts.
 *
 * La planche est construite avec la taille, le décalage et l'animation qu'avait le hotspot à `setAnimation` (`Hotspot.animBuild`) ; si un
 * script change ensuite `width` ou `colorOffset`, ScummVM découpe la même planche avec les nouvelles valeurs, et ici aussi.
 *
 * Écarts volontaires : un pixel lu au-delà de la planche (hotspot agrandi après coup) est transparent au lieu de lire la mémoire voisine ;
 * les pixels hors de l'écran sont rognés.
 */

import { decodeAnimation, PIXELFLAG_HAS_TABLE, type Animation } from "../data/anim";
import type { HotspotAnimRecord } from "../data/lure-dat";
import { FULL_SCREEN_HEIGHT, FULL_SCREEN_WIDTH, MENUBAR_Y_SIZE } from "../engine/ids";
import type { Hotspot } from "../engine/hotspot";
import { Surface, type Rect } from "./surface";

/** `RACK_SERF_ID` : le Serf du chevalet. */
export const RACK_SERF_ID = 0x411;
/** Taille de la planche du Serf du chevalet. */
const RACK_SERF_SHEET = { width: 416, height: 27 };

/** Planche d'images d'un hotspot (`Hotspot::_frames`). */
export interface SpriteSheet {
  readonly surface: Surface;
  readonly numFrames: number;
  /** Début de chaque image dans la planche (Serf du chevalet), sinon `null` (images de largeur fixe). */
  readonly frameStarts: readonly number[] | null;
}

/** Ce qu'il faut au moment de `setAnimation` : tel que `Hotspot.animBuild` le garde. */
export interface AnimBuild {
  hotspotId: number;
  width: number;
  height: number;
  colorOffset: number;
}

/** `Hotspot::setAnimation(HotspotAnimData *)` : décode l'animation et construit la planche. */
export function buildSpriteSheet(anim: Animation, record: HotspotAnimRecord, build: AnimBuild): SpriteSheet {
  const rackSerf = build.hotspotId === RACK_SERF_ID;
  const numFrames = anim.numFrames;
  const surface = rackSerf ? new Surface(RACK_SERF_SHEET.width, RACK_SERF_SHEET.height) : new Surface(build.width * numFrames, build.height);
  surface.data.fill(build.colorOffset);
  const frameStarts: number[] = [];

  let width = build.width;
  let height = build.height;
  let src = 0;
  let frameOffset = 0;
  for (let frame = 0; frame < numFrames; frame++) {
    if ((record.flags & PIXELFLAG_HAS_TABLE) !== 0) src = frameOffset;
    let xStart: number;
    if (rackSerf) {
      xStart = frame === 0 ? 0 : frameStarts[frame - 1]! + width;
      frameStarts.push(xStart);
      switch (frame) {
        case 3:
          width = 48;
          height = 25;
          break;
        case 4:
          height = 26;
          break;
        case 5:
          width = 32;
          break;
        case 6:
          height = 27;
          break;
        case 7:
          width = 16;
          break;
        default:
          break;
      }
    } else {
      xStart = frame * build.width;
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width >> 1; x++) {
        const value = anim.nibbles[src++] ?? 0;
        const at = y * surface.width + xStart + x * 2;
        if (xStart + x * 2 + 1 < surface.width && y < surface.height) {
          surface.data[at] = (build.colorOffset + (value >> 4)) & 0xff;
          surface.data[at + 1] = (build.colorOffset + (value & 0xf)) & 0xff;
        }
      }
    }
    if ((record.flags & PIXELFLAG_HAS_TABLE) !== 0) frameOffset += anim.frameSizes[frame]! >> 1;
  }
  return { surface, numFrames, frameStarts: rackSerf ? frameStarts : null };
}

/** `Hotspot::copyTo(dest)` : dessine l'image courante du hotspot dans `dest` (l'écran de 320 x 200). */
export function drawHotspot(dest: Surface, sheet: SpriteSheet, h: Hotspot): void {
  let xPos = h.x;
  let yPos = h.y;
  const hWidth = h.frameWidth;
  const hHeight = h.height;
  const frame = h.frameNumber;
  if (frame >= sheet.numFrames) return; // image hors de la planche (voir `Hotspot.setFrameNumber`)

  const r: Rect = { left: frame * hWidth, top: 0, right: (frame + 1) * hWidth - 1, bottom: hHeight - 1 };
  if (sheet.frameStarts) {
    r.left = sheet.frameStarts[frame] ?? 0;
    r.right = frame === sheet.numFrames - 1 ? sheet.surface.width - 1 : (sheet.frameStarts[frame + 1] ?? sheet.surface.width) - 1;
    r.bottom = hHeight - 1;
  }

  if (xPos < 0) {
    if (xPos + hWidth <= 0) return;
    r.left += -xPos;
    xPos = 0;
  } else if (xPos >= FULL_SCREEN_WIDTH) {
    return;
  } else if (xPos + hWidth > FULL_SCREEN_WIDTH) {
    r.right = r.left + (FULL_SCREEN_WIDTH - xPos - 1);
  }

  if (yPos < 0) {
    if (yPos + hHeight <= MENUBAR_Y_SIZE) return;
    r.top += -yPos + MENUBAR_Y_SIZE;
    yPos = MENUBAR_Y_SIZE;
  } else if (yPos >= FULL_SCREEN_HEIGHT) {
    return;
  } else if (yPos + hHeight > FULL_SCREEN_HEIGHT) {
    r.bottom = r.top + (FULL_SCREEN_HEIGHT - yPos - 1);
  }

  if (r.top >= r.bottom || r.left >= r.right) return;
  sheet.surface.copyRectTo(dest, r, xPos, yPos, h.colorOffset);
}

/** Planches construites, gardées tant que le hotspot garde la même construction (`animBuild`). */
export class SpriteCache {
  private readonly sheets = new WeakMap<AnimBuild, SpriteSheet>();
  private readonly animations = new Map<number, Animation>();

  constructor(private readonly resource: (id: number) => Uint8Array) {}

  /** Planche du hotspot, ou `null` s'il n'a pas d'animation. */
  sheetOf(h: Hotspot): SpriteSheet | null {
    const build = h.animBuild;
    if (!build || !h.anim) return null;
    let sheet = this.sheets.get(build);
    if (!sheet) {
      let anim = this.animations.get(h.anim.animId);
      if (!anim) {
        anim = decodeAnimation(this.resource(h.anim.animId));
        this.animations.set(h.anim.animId, anim);
      }
      sheet = buildSpriteSheet(anim, h.anim, build);
      this.sheets.set(build, sheet);
    }
    return sheet;
  }
}

/**
 * Hotspots du calque 1 dans l'ordre de dessin de `Room::update` : `tempList` est une liste triée par ordonnée du pied (`y + heightCopy`), un
 * hotspot est inséré **avant** le premier dont le pied est strictement plus bas ; à pied égal, le premier arrivé est dessiné d'abord.
 */
export function sortLayer1(candidates: readonly Hotspot[]): Hotspot[] {
  const sorted: Hotspot[] = [];
  for (const h of candidates) {
    const endY = h.y + h.heightCopy;
    let at = 0;
    while (at < sorted.length && !(endY < sorted[at]!.y + sorted[at]!.heightCopy)) at++;
    sorted.splice(at, 0, h);
  }
  return sorted;
}
