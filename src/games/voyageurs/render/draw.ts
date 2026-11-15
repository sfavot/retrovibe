/**
 * Primitives de dessin sur une page 320 × 200 d'indices de couleur : rectangles pleins rognés, bordures simples et doubles, sprite masqué,
 * sprite rempli d'une couleur, mise à jour d'un masque de sprite par un occulteur.
 *
 * Référence : ScummVM engines/cine/gfx.cpp (`FWRenderer::drawPlainBox`, `drawBorder`, `drawDoubleBorder`, `drawLine`, `drawSpriteRaw`,
 * `gfxFillSprite`, `gfxUpdateSpriteMask`) (GPL v3 ou ultérieure). Fonctions pures sur des tampons.
 *
 * Règles reprises :
 * - rectangle : largeur ou hauteur négative = rectangle retourné ; rognage par `Common::Rect::clip` (bornes ramenées dans l'écran, un
 *   rectangle hors écran devient vide) ;
 * - bordure : quatre lignes, celle de droite d'un pixel plus haute (`height + 1`), celle du bas à `y + height` ;
 * - sprite : pixel recopié là où le masque vaut 0 et dans l'écran ; masque absent = tout recopié ;
 * - remplissage : couleur posée là où l'octet de la source vaut 0 (masque MSK : zone masquante ; sprite : couleur 0) ;
 * - occulteur : le masque du sprite reçoit `masque |= source ^ 1` sur la partie commune aux deux rectangles.
 *
 * Écart volontaire : les lectures hors des données d'un sprite (impossibles avec des dimensions cohérentes) sont ignorées.
 */

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const SCREEN_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** `drawPlainBox` (et `drawLine`, cas particulier). */
export function drawPlainBox(page: Uint8Array, x0: number, y0: number, w0: number, h0: number, color: number): void {
  let x = x0;
  let y = y0;
  let width = w0;
  let height = h0;
  if (width < 0) {
    width = -width;
    x -= width;
  }
  if (height < 0) {
    height = -height;
    y -= height;
  }
  const left = clamp(x, 0, SCREEN_WIDTH);
  const top = clamp(y, 0, SCREEN_HEIGHT);
  const right = clamp(x + width, 0, SCREEN_WIDTH);
  const bottom = clamp(y + height, 0, SCREEN_HEIGHT);
  for (let row = top; row < bottom; row++) page.fill(color & 0xff, row * SCREEN_WIDTH + left, row * SCREEN_WIDTH + right);
}

/** `drawBorder`. */
export function drawBorder(page: Uint8Array, x: number, y: number, width: number, height: number, color: number): void {
  drawPlainBox(page, x, y, width, 1, color);
  drawPlainBox(page, x, y + height, width, 1, color);
  drawPlainBox(page, x, y, 1, height, color);
  drawPlainBox(page, x + width, y, 1, height + 1, color);
}

/** `drawDoubleBorder` : bordure intérieure noire (couleur 0), extérieure de couleur `color`. */
export function drawDoubleBorder(page: Uint8Array, x: number, y: number, width: number, height: number, color: number): void {
  drawBorder(page, x + 1, y + 1, width - 2, height - 2, 0);
  drawBorder(page, x, y, width, height, color);
}

/** `drawSpriteRaw` : `width × height` pixels de `sprite` en (x, y), là où `mask` vaut 0 (sans masque : partout). */
export function drawSpriteRaw(page: Uint8Array, sprite: Uint8Array, mask: Uint8Array | null, width: number, height: number, x: number, y: number): void {
  for (let i = 0; i < height; i++) {
    const py = y + i;
    if (py < 0 || py >= SCREEN_HEIGHT) continue;
    for (let j = 0; j < width; j++) {
      const px = x + j;
      if (px < 0 || px >= SCREEN_WIDTH) continue;
      const s = i * width + j;
      if (mask && mask[s] !== 0) continue;
      const value = sprite[s];
      if (value !== undefined) page[py * SCREEN_WIDTH + px] = value;
    }
  }
}

/** `gfxFillSprite` : `color` là où l'octet de `sprite` est nul. */
export function fillSprite(page: Uint8Array, sprite: Uint8Array, width: number, height: number, x: number, y: number, color: number): void {
  for (let i = 0; i < height; i++) {
    const py = y + i;
    if (py < 0 || py >= SCREEN_HEIGHT) continue;
    for (let j = 0; j < width; j++) {
      const px = x + j;
      if (px >= 0 && px < SCREEN_WIDTH && sprite[i * width + j] === 0) page[py * SCREEN_WIDTH + px] = color;
    }
  }
}

/**
 * `gfxUpdateSpriteMask` : masque `dest` (sprite `width × height` en (x, y)) mis à jour par la source `src` (`maskWidth × maskHeight` en
 * (xm, ym)) : `dest |= src ^ 1` là où les deux se recouvrent.
 */
export function updateSpriteMask(
  dest: Uint8Array,
  x: number,
  y: number,
  width0: number,
  height0: number,
  src: Uint8Array,
  xm: number,
  ym: number,
  maskWidth0: number,
  maskHeight0: number,
): void {
  const spritePitch = width0;
  const maskPitch = maskWidth0;
  let width = width0;
  let height = height0;
  let maskWidth = maskWidth0;
  let maskHeight = maskHeight0;
  let d0 = 0;
  let s0 = 0;
  if (y > ym) {
    s0 += (y - ym) * maskPitch;
    maskHeight -= y - ym;
  } else if (y < ym) {
    d0 += (ym - y) * spritePitch;
    height -= ym - y;
  }
  if (x > xm) {
    s0 += x - xm;
    maskWidth -= x - xm;
  } else if (x < xm) {
    d0 += xm - x;
    width -= xm - x;
  }
  const rows = Math.min(maskHeight, height);
  const cols = Math.min(maskWidth, width);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const s = src[s0 + i];
      const at = d0 + i;
      if (s !== undefined && at < dest.length) dest[at] = dest[at]! | (s ^ 1);
    }
    d0 += spritePitch;
    s0 += maskPitch;
  }
}
