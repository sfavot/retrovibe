/**
 * Cels du compositeur : images décodées des vues et des pics, dessin dans le tampon indexé (miroir, mise à l'échelle,
 * couleur transparente), lecture d'un pixel (`docs/gk1/formats.md` § 4 et § 5).
 *
 * Référence : `engines/sci/graphics/celobj32.cpp` de ScummVM (`CelObjView`, `CelObjPic`, `CelObj::draw`, `SCALER_NoScale`,
 * `SCALER_Scale`, `MAPPER_NoMD`, `MAPPER_NoMap`, `CelObj::readPixel`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * - **Origine d'un cel de vue** : les champs @4 et @6 de l'en-tête sont un **décalage**, pas le point d'ancrage ; l'ancrage
 *   dans le cel vaut `(largeur / 2 − décalage x, hauteur − décalage y − 1)`. Un bouton de 35×10 au décalage (17, 9) s'ancre
 *   donc en haut à gauche, la marche de Gabriel (43×56, décalage (2, 0)) en bas au milieu. Un cel de pic garde ses champs
 *   tels quels (toujours (0, 0)).
 * - **Miroir** : une boucle qui renvoie à une autre avec l'octet « miroir » se dessine retournée ; l'ancrage x devient alors
 *   `largeur − ancrage x − 1` (`screen-item.ts`). La boucle renvoyée sans miroir montre les mêmes cels à l'endroit.
 * - **Boucle ou cel hors de la vue** : ramenés au dernier, comme `CelObjView`.
 * - **Transparence** : un pixel de la couleur transparente n'est jamais dessiné. Un cel de vue qui contient des couleurs de
 *   remplacement (236 à 254) ne dessine aucune couleur à partir de 236 tant qu'aucun remplacement n'est actif ; dès qu'il y
 *   en a un, un pixel d'une couleur de remplacement active transforme la couleur déjà à l'écran (`remap.ts`), les autres
 *   couleurs à partir de 236 restent invisibles.
 * - **Bitmap** : une image créée par le noyau (`text.ts`) se dessine comme un cel ancré en haut à gauche, sans palette.
 * - **Mise à l'échelle** : le pixel cible `x` lit la colonne `⌊x × 128 / échelle⌋ − ⌊gauche × 128 / échelle⌋` : la grille
 *   d'échantillonnage est attachée à l'écran, pas au cel, comme dans l'original pour les jeux en 320×200.
 *
 * Écarts volontaires : chaque cel est décodé en entier une fois et gardé (ScummVM décode ligne par ligne à chaque dessin et
 * garde cent objets) ; l'indice lu est borné au cel au lieu de supposer que le rectangle cible est exact ; les drapeaux
 * @10 de l'en-tête, toujours nuls sur ce CD, ne sont pas lus.
 */
import { ResourceType } from "../data/ids";
import type { Palette } from "../data/palette";
import { decodePicCel, readPic } from "../data/pic";
import { decodeViewCel, readView, type View } from "../data/view";
import type { Reg, SciBitmap, Table } from "../engine/memory";
import type { ResourceManager } from "../engine/resources";
import { REMAP_END_COLOR, REMAP_START_COLOR, SCALE_ONE } from "./ids";
import type { Rect } from "./rect";
import type { Remap } from "./remap";

export interface Cel {
  readonly width: number;
  readonly height: number;
  /** Point d'ancrage dans le cel : c'est lui qui se pose à la position de l'élément d'écran. */
  readonly originX: number;
  readonly originY: number;
  readonly skipColor: number;
  /** Cel d'une boucle miroir : à dessiner retourné horizontalement. */
  readonly mirrored: boolean;
  /** Contient des couleurs de remplacement (vues seulement). */
  readonly hasRemap: boolean;
  /** `largeur × hauteur` indices, tels que stockés (non retournés). */
  readonly pixels: Uint8Array;
  /** Palette de la ressource d'où vient le cel. */
  readonly palette: Palette | undefined;
}

/** Cel d'un pic : sa priorité dans le plan et sa position dans le pic. */
export interface PicCel extends Cel {
  readonly priority: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Point d'ancrage d'un cel de vue dans le cel, d'après son en-tête (`originX` et `originY` y sont un décalage) ;
 * `mirrored` : pour le cel dessiné retourné.
 */
export function viewCelAnchor(header: { width: number; height: number; originX: number; originY: number }, mirrored = false): { x: number; y: number } {
  const x = (header.width >> 1) - header.originX;
  return { x: mirrored ? header.width - x - 1 : x, y: header.height - header.originY - 1 };
}

/** Nombre de cels de vues gardés décodés avant de vider le cache. */
const VIEW_CEL_CACHE_LIMIT = 2048;
const LOOP_KEY_FACTOR = 0x100;
const VIEW_KEY_FACTOR = 0x10000;

function clampIndex(index: number, count: number): number {
  return index >= count ? count - 1 : index;
}

/** Cels décodés des vues et des pics, à la demande. Une ressource absente ou illisible donne `undefined`. */
export class CelStore {
  private readonly views = new Map<number, View | undefined>();
  private readonly viewCels = new Map<number, Cel>();
  private readonly pics = new Map<number, readonly PicCel[] | undefined>();
  private readonly bitmapCels = new WeakMap<SciBitmap, Cel>();

  constructor(
    private readonly resources: ResourceManager,
    private readonly bitmaps?: Table<SciBitmap>,
  ) {}

  /** Bitmap du noyau vu comme un cel, ou `undefined` s'il a été libéré. */
  bitmap(reg: Reg): Cel | undefined {
    const bitmap = this.bitmaps?.get(reg);
    if (!bitmap) return undefined;
    let cel = this.bitmapCels.get(bitmap);
    if (!cel) {
      cel = { width: bitmap.width, height: bitmap.height, originX: 0, originY: 0, skipColor: bitmap.skipColor, mirrored: false, hasRemap: false, pixels: bitmap.pixels, palette: undefined };
      this.bitmapCels.set(bitmap, cel);
    }
    return cel;
  }

  /** Description de la vue (boucles, en-têtes de cels), ou `undefined` si elle manque. */
  view(number: number): View | undefined {
    if (!this.views.has(number)) {
      const data = this.resources.find(ResourceType.View, number);
      this.views.set(number, data ? readView(data) : undefined);
    }
    return this.views.get(number);
  }

  /** Numéro de boucle ramené dans la vue, ou −1 si la vue manque ou n'a pas de boucle. */
  clampLoop(viewNumber: number, loop: number): number {
    const view = this.view(viewNumber);
    return view && view.loops.length > 0 ? clampIndex(loop, view.loops.length) : -1;
  }

  /** Numéro de cel ramené dans la boucle (elle-même ramenée dans la vue), ou −1. */
  clampCel(viewNumber: number, loop: number, cel: number): number {
    const view = this.view(viewNumber);
    const loopIndex = this.clampLoop(viewNumber, loop);
    const count = loopIndex < 0 ? 0 : view!.loops[loopIndex].cels.length;
    return count > 0 ? clampIndex(cel, count) : -1;
  }

  /** Cel d'une vue ; `loop` et `cel` trop grands désignent le dernier. */
  viewCel(viewNumber: number, loop: number, cel: number): Cel | undefined {
    const view = this.view(viewNumber);
    const loopIndex = this.clampLoop(viewNumber, loop);
    const celIndex = this.clampCel(viewNumber, loop, cel);
    if (!view || celIndex < 0) return undefined;
    const key = viewNumber * VIEW_KEY_FACTOR + loopIndex * LOOP_KEY_FACTOR + celIndex;
    let decoded = this.viewCels.get(key);
    if (!decoded) {
      const header = view.loops[loopIndex].cels[celIndex];
      const pixels = decodeViewCel(view, loopIndex, celIndex);
      const anchor = viewCelAnchor(header);
      decoded = {
        width: header.width,
        height: header.height,
        originX: anchor.x,
        originY: anchor.y,
        skipColor: header.skipColor,
        mirrored: view.loops[loopIndex].mirrored,
        hasRemap: pixels.some((pixel) => pixel >= REMAP_START_COLOR && pixel <= REMAP_END_COLOR && pixel !== header.skipColor),
        pixels,
        palette: view.palette,
      };
      if (this.viewCels.size >= VIEW_CEL_CACHE_LIMIT) this.viewCels.clear();
      this.viewCels.set(key, decoded);
    }
    return decoded;
  }

  /** Cels d'un pic, du fond aux avant-plans, ou `undefined` s'il manque. */
  pic(number: number): readonly PicCel[] | undefined {
    if (!this.pics.has(number)) {
      const data = this.resources.find(ResourceType.Pic, number);
      if (!data) this.pics.set(number, undefined);
      else {
        const pic = readPic(data);
        this.pics.set(
          number,
          pic.cels.map((header, index) => ({
            width: header.width,
            height: header.height,
            originX: header.originX,
            originY: header.originY,
            skipColor: header.skipColor,
            mirrored: false,
            hasRemap: false,
            pixels: decodePicCel(pic, index),
            palette: pic.palette,
            priority: header.priority,
            x: header.x,
            y: header.y,
          })),
        );
      }
    }
    return this.pics.get(number);
  }
}

/** Colonne (ou ligne) du cel lue pour chaque pixel cible de `from` à `to` exclu, le cel mis à l'échelle commençant à `start`. */
function scaleTable(from: number, to: number, start: number, scale: number, size: number, flip: boolean): Int32Array {
  const table = new Int32Array(to - from);
  const origin = Math.trunc((start * SCALE_ONE) / scale);
  for (let i = from; i < to; i++) {
    const index = Math.min(Math.max(Math.floor((i * SCALE_ONE) / scale) - origin, 0), size - 1);
    table[i - from] = flip ? size - 1 - index : index;
  }
  return table;
}

/**
 * Dessine la partie `clip` (en pixels de la cible, déjà bornée à celle-ci) du cel posé en (`x`, `y`), retourné si `mirrored`,
 * à l'échelle `scaleX / 128`, `scaleY / 128`. `remap` : les couleurs de remplacement du moment, pour un cel qui en contient.
 */
export function drawCel(
  target: Uint8Array,
  targetWidth: number,
  cel: Cel,
  clip: Rect,
  x: number,
  y: number,
  mirrored: boolean,
  scaleX = SCALE_ONE,
  scaleY = SCALE_ONE,
  remap?: Remap,
): void {
  const { width, height, pixels, skipColor } = cel;
  const limit = cel.hasRemap ? REMAP_START_COLOR : 0x100;
  const mapped = cel.hasRemap && remap !== undefined && remap.count > 0 ? remap : undefined;
  if (scaleX === SCALE_ONE && scaleY === SCALE_ONE) {
    const top = Math.max(clip.top, y);
    const bottom = Math.min(clip.bottom, y + height);
    const left = Math.max(clip.left, x);
    const right = Math.min(clip.right, x + width);
    for (let ty = top; ty < bottom; ty++) {
      const row = (ty - y) * width;
      const out = ty * targetWidth;
      for (let tx = left; tx < right; tx++) {
        const pixel = pixels[row + (mirrored ? width - 1 - (tx - x) : tx - x)];
        if (pixel === skipColor) continue;
        if (pixel < limit) target[out + tx] = pixel;
        else if (mapped?.enabled(pixel)) target[out + tx] = mapped.apply(pixel, target[out + tx]);
      }
    }
    return;
  }
  if (scaleX <= 0 || scaleY <= 0 || clip.right <= clip.left || clip.bottom <= clip.top) return;
  const columns = scaleTable(clip.left, clip.right, x, scaleX, width, mirrored);
  const rows = scaleTable(clip.top, clip.bottom, y, scaleY, height, false);
  for (let ty = clip.top; ty < clip.bottom; ty++) {
    const row = rows[ty - clip.top] * width;
    const out = ty * targetWidth;
    for (let tx = clip.left; tx < clip.right; tx++) {
      const pixel = pixels[row + columns[tx - clip.left]];
      if (pixel === skipColor) continue;
      if (pixel < limit) target[out + tx] = pixel;
      else if (mapped?.enabled(pixel)) target[out + tx] = mapped.apply(pixel, target[out + tx]);
    }
  }
}

/** Indice de couleur du pixel (`x`, `y`) du cel, vu retourné si `mirrored` ; `undefined` hors du cel. */
export function readCelPixel(cel: Cel, x: number, y: number, mirrored: boolean): number | undefined {
  if (x < 0 || y < 0 || x >= cel.width || y >= cel.height) return undefined;
  return cel.pixels[y * cel.width + (mirrored ? cel.width - 1 - x : x)];
}
