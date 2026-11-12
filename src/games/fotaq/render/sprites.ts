/**
 * Dessin des images de banque : copie masquée (l'indice 0 est transparent), image retournée, réduction, découpe dans une boîte.
 * Réécriture de `Display::blit` (engines/queen/display.cpp), `Graphics::shrinkFrame` et `Graphics::drawBob`
 * (engines/queen/graphics.cpp, ScummVM, GPL v3 ou ultérieure), et d'un cache des banques lues.
 *
 * Écarts :
 * - `shrinkFrame` de ScummVM, quand l'image réduite aurait une largeur ou une hauteur nulle, laisse le tampon de la réduction
 *   précédente et le dessine quand même ; ici l'image n'est pas dessinée ;
 * - une échelle nulle (ScummVM diviserait par zéro) ne dessine rien ;
 * - la copie est rognée aux limites du plan (ScummVM ne contrôle que la boîte).
 */

import { type SpriteBank, parseBank } from "../data/bank";
import type { Box } from "../data/jas";

/** Une image à dessiner : taille et indices de palette (lignes contiguës). */
export interface Image {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Un plan d'indices : `pixels` de `width` colonnes. */
export interface Surface {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/**
 * `Display::blit` masqué : copie `w` x `h` pixels de `src` (lignes de `srcPitch`, à partir de `srcOffset`) en `(x, y)` ; l'indice 0
 * n'est pas copié. Retournée (`xflip`), `x` est la colonne du **premier** pixel (le pixel de gauche de la source va à droite) et
 * l'image s'étend vers la gauche, comme `*(dstBuf - i)` de ScummVM.
 */
export function blitMasked(dst: Surface, x: number, y: number, src: Uint8Array, srcOffset: number, srcPitch: number, w: number, h: number, xflip: boolean): void {
  for (let j = 0; j < h; j++) {
    const py = y + j;
    if (py < 0 || py >= dst.height) continue;
    const from = srcOffset + j * srcPitch;
    const row = py * dst.width;
    for (let i = 0; i < w; i++) {
      const px = xflip ? x - i : x + i;
      if (px < 0 || px >= dst.width) continue;
      const value = src[from + i];
      if (value !== 0) dst.pixels[row + px] = value;
    }
  }
}

/** `Display::blit` sans masque (cases de l'inventaire) : copie opaque. */
export function blitOpaque(dst: Surface, x: number, y: number, image: Image): void {
  for (let j = 0; j < image.height; j++) {
    const py = y + j;
    if (py < 0 || py >= dst.height) continue;
    for (let i = 0; i < image.width; i++) {
      const px = x + i;
      if (px >= 0 && px < dst.width) dst.pixels[py * dst.width + px] = image.pixels[j * image.width + i];
    }
  }
}

/** `Display::fill` : rectangle de couleur unie. */
export function fillRect(dst: Surface, x: number, y: number, w: number, h: number, color: number): void {
  for (let j = 0; j < h; j++) {
    const py = y + j;
    if (py < 0 || py >= dst.height) continue;
    for (let i = 0; i < w; i++) {
      const px = x + i;
      if (px >= 0 && px < dst.width) dst.pixels[py * dst.width + px] = color;
    }
  }
}

/**
 * `Graphics::shrinkFrame` : taille `(dimension * pourcentage + 50) / 100`, pixel pris à `i * 100 / pourcentage` (plus proche
 * voisin). `null` si l'image réduite est vide.
 */
export function shrinkFrame(frame: Image, percentage: number): Image | null {
  const width = Math.trunc((frame.width * percentage + 50) / 100);
  const height = Math.trunc((frame.height * percentage + 50) / 100);
  if (width <= 0 || height <= 0) return null;
  const pixels = new Uint8Array(width * height);
  const source = (i: number): number => Math.trunc((i * 100) / percentage);
  for (let y = 0; y < height; y++) {
    const row = Math.min(source(y), frame.height - 1) * frame.width;
    for (let x = 0; x < width; x++) pixels[y * width + x] = frame.pixels[row + Math.min(source(x), frame.width - 1)];
  }
  return { width, height, pixels };
}

/**
 * `Graphics::drawBob` : l'image (réduite si `scale` < 100) est dessinée avec son coin haut gauche en `(x, y)`, découpée par la boîte
 * `box` (bornes comprises ; l'écran de jeu 0,0 à 319,149, ou l'écran entier 0,0 à 319,199, ou la boîte propre du bob).
 */
export function drawBob(screen: Surface, frame: Image, xflip: boolean, scale: number, box: Box, x: number, y: number): void {
  if (scale <= 0) return;
  let image: Image | null = frame;
  if (scale < 100) image = shrinkFrame(frame, scale);
  if (!image) return;
  const { width: w, height: h } = image;
  if (w === 0 || h === 0 || !(x <= box.x2 && y <= box.y2 && x + w > box.x1 && y + h > box.y1)) return;
  let xSkip = 0;
  let ySkip = 0;
  let wNew = w;
  let hNew = h;
  if (x < box.x1) {
    xSkip = box.x1 - x;
    wNew -= xSkip;
    x = box.x1;
  }
  if (y < box.y1) {
    ySkip = box.y1 - y;
    hNew -= ySkip;
    y = box.y1;
  }
  if (x + wNew > box.x2 + 1) wNew = box.x2 - x + 1;
  if (y + hNew > box.y2 + 1) hNew = box.y2 - y + 1;
  if (wNew <= 0 || hNew <= 0) return;
  let offset = w * ySkip;
  if (!xflip) {
    offset += xSkip;
  } else {
    offset += w - wNew - xSkip;
    x += wNew - 1;
  }
  blitMasked(screen, x, y, image.pixels, offset, w, wNew, hNew, xflip);
}

/**
 * Image de base avec `over` copiée par-dessus le **début de ses pixels** (`BankManager::overpack`) : `memcpy` de la source dans le
 * tampon de la destination, sans changer sa taille ni son point d'ancrage. Si la source dépasse la destination (en largeur ou en
 * hauteur), ScummVM la décompresse à la place (`unpack`) : c'est alors `over` qui est rendue.
 */
export function overpackFrame<T extends Image>(base: T, over: T): T {
  if (base.width < over.width || base.height < over.height) return over;
  // Copie explicite : sous Node, les pixels d'une banque sont une vue d'un Buffer, dont `slice` partage la mémoire avec le fichier.
  const pixels = new Uint8Array(base.pixels);
  pixels.set(over.pixels.subarray(0, over.width * over.height));
  return { ...base, pixels };
}

/** Banques lues et analysées une fois (`BankManager::load`), par nom de fichier. */
export class BankCache {
  private readonly banks = new Map<string, SpriteBank>();

  constructor(private readonly readFile: (name: string) => Uint8Array) {}

  bank(name: string): SpriteBank {
    const key = name.toUpperCase();
    let bank = this.banks.get(key);
    if (!bank) this.banks.set(key, (bank = parseBank(this.readFile(name))));
    return bank;
  }
}
