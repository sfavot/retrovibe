/**
 * Primitives de dessin : décor, images plein écran, sprites avec rognage, masque vertical, tri, défilement.
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::showScreen`, `recreate`, `drawSprite`, `vectorToGame`, `vertMaskSub`, `verticalMask`,
 * `sortSprites`, `doSprites`, `fnFadeUp` pour le défilement, `paintBox`/`showGrid`), skydefs.h (GPL v3 ou ultérieure). Toutes les fonctions
 * sont pures : elles reçoivent le tampon et les données nécessaires, la liste de dessin et les variables du jeu restent au moteur.
 *
 * Règles reprises :
 * - **décor** : un décor de jeu (61 440 octets) est stocké **par blocs de 16 x 8** (bloc après bloc, de gauche à droite puis de haut en bas,
 *   chaque bloc en 8 lignes de 16 octets) et non en lignes ; `recreate` ne recopie que les blocs marqués `0x80` ; les images plein écran de
 *   l'introduction, elles, sont en lignes de 320 octets (64 000 octets) ;
 * - **sprite** : couleur 0 transparente ; position `xcood + s_offset_x - 128`, `ycood + s_offset_y - 136` ; rognage en haut et à gauche exact,
 *   en bas exact, à droite **un pixel de plus que nécessaire** (`rightClip = -(320 - (w + x)) + 1`, comportement d'origine conservé) ;
 *   un sprite entièrement hors de l'écran, ou de plus de 192 lignes, n'est pas dessiné ; le dessin ne couvre que les 192 lignes de jeu ;
 * - **blocs touchés** : rectangle en blocs de 16 x 8 couvrant le sprite rogné (`vectorToGame` y ajoute `1`, ou `0x81` si le compact a le bit 3
 *   de son `status`, ce qui force la recomposition du décor au prochain tour) ;
 * - **masque vertical** : après un sprite, on repasse sur lui les blocs des couches de décor 1 à 3 (devant le personnage) : en partant de la
 *   rangée de blocs la plus basse du sprite et en remontant, tant que la case de la grille de la couche est non nulle, on recopie le bloc
 *   `valeur - 1` de la couche (pixels non nuls seulement) ; une case dont le bit `0x8000` est posé est sautée sans dessin ; la remontée
 *   s'arrête à la première case nulle ; le moteur l'appelle après chaque sprite de la couche arrière (`BACK`) et après chaque sprite trié dont le
 *   `status` n'a pas le bit `0x200` ;
 * - **tri** : `sortSprites` classe par `ycood + s_offset_y + s_height` (entier 16 bits non signé) avec le tri à bulles d'origine (échange si
 *   strictement supérieur, donc non stable), au plus 30 sprites par liste (tableau de 30 cases dans ScummVM, un dépassement y écrit hors
 *   tableau) ;
 * - **défilement** (`fnFadeUp`, 123 vers la gauche, 321 vers la droite) : 19 pas de 16 pixels, un pas toutes les 20 ms, puis l'image finale.
 *
 * Écarts volontaires : un sprite qui dépasserait l'écran après rognage (le cas « fatal error » de ScummVM, impossible avec des données
 * valides) est ignoré comme lui ; les lectures hors des couches sont ignorées au lieu de déborder.
 */

import type { SpriteFile } from "../data/sprite";
import {
  BACKGROUND_SIZE,
  GAME_SCREEN_HEIGHT,
  GRID_BLOCK_SIZE,
  GRID_H,
  GRID_H_SHIFT,
  GRID_W,
  GRID_W_SHIFT,
  GRID_X,
  GRID_Y,
  SCREEN_SIZE,
  SCREEN_WIDTH,
  TOP_LEFT_X,
  TOP_LEFT_Y,
} from "./frame-buffer";

/** Bit de la case de grille : bloc à recopier depuis le décor (`recreate`). */
export const GRID_RECREATE = 0x80;
/** Bit de la case de grille : bloc à envoyer à l'écran (`flip`). */
export const GRID_FLIP = 0x01;

/** `Screen::showScreen(fileNum, fullscreen)` : image de 64 000 octets en lignes ; hors plein écran, les 8 dernières lignes sont forcées à 0. */
export function showFullImage(dest: Uint8Array, image: Uint8Array, fullscreen: boolean): void {
  if (image.length < SCREEN_SIZE) throw new Error(`image invalide : ${image.length} octets, ${SCREEN_SIZE} attendus`);
  dest.set(image.subarray(0, SCREEN_SIZE));
  if (!fullscreen) dest.fill(0, BACKGROUND_SIZE, SCREEN_SIZE);
}

/**
 * `Screen::recreate` : recopie dans `dest` (lignes de 320) les blocs de `blocks` (décor par blocs de 16 x 8, 61 440 octets) dont la case de
 * `grid` (480 octets) porte `GRID_RECREATE` ; la case passe alors à `GRID_FLIP` (bit de `flip` posé, bit de recomposition retiré).
 * Sans `grid`, tout le décor est recopié.
 */
export function recreateBackground(dest: Uint8Array, blocks: Uint8Array, grid?: Uint8Array): void {
  if (blocks.length < BACKGROUND_SIZE) throw new Error(`décor invalide : ${blocks.length} octets, ${BACKGROUND_SIZE} attendus`);
  for (let by = 0; by < GRID_Y; by++) {
    for (let bx = 0; bx < GRID_X; bx++) {
      const index = by * GRID_X + bx;
      if (grid) {
        if (!(grid[index]! & GRID_RECREATE)) continue;
        grid[index] = (grid[index]! & ~GRID_RECREATE) | GRID_FLIP;
      }
      let src = index * GRID_BLOCK_SIZE;
      let dst = by * GRID_H * SCREEN_WIDTH + bx * GRID_W;
      for (let line = 0; line < GRID_H; line++) {
        dest.set(blocks.subarray(src, src + GRID_W), dst);
        src += GRID_W;
        dst += SCREEN_WIDTH;
      }
    }
  }
}

/** Décor par blocs vers 320 x 192 en lignes (visionneuse, comparaisons). */
export function deblockBackground(blocks: Uint8Array): Uint8Array {
  const out = new Uint8Array(BACKGROUND_SIZE);
  recreateBackground(out, blocks);
  return out;
}

/** Rectangle de blocs 16 x 8 couvert par un sprite dessiné (`_sprX`, `_sprY`, `_sprWidth`, `_sprHeight` après conversion en blocs). */
export interface SpriteBlocks {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * `Screen::drawSprite` : dessine l'image `frame` (numéro déjà masqué par `& 0x3F`) de `sprite` pour un compact en (`xcood`, `ycood`)
 * dans `dest` (au moins 320 x 192). Rend le rectangle de blocs touchés, ou `null` si rien n'est dessiné.
 */
export function drawSprite(dest: Uint8Array, sprite: SpriteFile, frame: number, xcood: number, ycood: number): SpriteBlocks | null {
  const pixels = sprite.frame(frame);
  const fullWidth = sprite.width;
  const fullHeight = sprite.height;
  let width = fullWidth;
  let height = fullHeight;
  let maskX1 = 0;
  let maskX2 = 0;
  let dataPos = 0;

  let spriteY = ycood + sprite.offsetY - TOP_LEFT_Y;
  if (spriteY < 0) {
    spriteY = -spriteY;
    if (height <= spriteY) return null;
    height -= spriteY;
    dataPos += fullWidth * spriteY;
    spriteY = 0;
  } else {
    let botClip = GAME_SCREEN_HEIGHT - fullHeight - spriteY;
    if (botClip < 0) {
      botClip = -botClip;
      if (height <= botClip) return null;
      height -= botClip;
    }
  }

  let spriteX = xcood + sprite.offsetX - TOP_LEFT_X;
  if (spriteX < 0) {
    spriteX = -spriteX;
    if (width <= spriteX) return null;
    width -= spriteX;
    maskX1 = spriteX;
    spriteX = 0;
  } else {
    let rightClip = SCREEN_WIDTH - (fullWidth + spriteX);
    if (rightClip < 0) {
      rightClip = -rightClip + 1;
      if (width <= rightClip) return null;
      width -= rightClip;
      maskX2 = rightClip;
    }
  }

  if (height > GAME_SCREEN_HEIGHT || spriteY > GAME_SCREEN_HEIGHT) return null;
  if (spriteX + width > SCREEN_WIDTH || spriteY + height > GAME_SCREEN_HEIGHT) return null;

  let screenPos = spriteY * SCREEN_WIDTH + spriteX;
  const stride = width + maskX2 + maskX1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = pixels[dataPos + x + maskX1];
      if (pixel) dest[screenPos + x] = pixel;
    }
    dataPos += stride;
    screenPos += SCREEN_WIDTH;
  }

  const blockX = spriteX >> GRID_W_SHIFT;
  const blockY = spriteY >> GRID_H_SHIFT;
  return {
    x: blockX,
    y: blockY,
    width: ((width + spriteX + GRID_W - 1) >> GRID_W_SHIFT) - blockX,
    height: ((height + spriteY + GRID_H - 1) >> GRID_H_SHIFT) - blockY,
  };
}

/** `Screen::vectorToGame` : ajoute `value` (OU binaire) aux cases de la grille de jeu (480 octets) couvertes par le sprite. */
export function markBlocks(grid: Uint8Array, blocks: SpriteBlocks, value: number): void {
  for (let y = 0; y < blocks.height; y++) {
    for (let x = 0; x < blocks.width; x++) grid[(blocks.y + y) * GRID_X + blocks.x + x]! |= value;
  }
}

/** Couche de décor devant les personnages (couches 1 à 3) : pixels par blocs comme le décor, et sa grille de 480 mots (`u16`). */
export interface MaskLayer {
  /** Pixels du décor de la couche (`LAYER_n_ID`), par blocs de 16 x 8. */
  readonly pixels: Uint8Array;
  /** Grille de la couche (`GRID_n_ID`) : 0 = rien ; bit `0x8000` = case à sauter ; sinon numéro de bloc + 1. */
  readonly grid: Uint16Array;
}

/**
 * `Screen::verticalMask` + `vertMaskSub` : repasse les couches `layers` (couches 1 à 3, `undefined` si la variable de jeu est nulle) sur le
 * sprite qui vient d'être dessiné. Dans ScummVM la boucle interne cherche d'une couche à l'autre mais relit toujours la grille de la couche
 * courante, ce qui revient à n'agir que si la case de cette grille est non nulle.
 */
export function verticalMask(dest: Uint8Array, blocks: SpriteBlocks, layers: ReadonlyArray<MaskLayer | undefined>): void {
  const startGridOfs = (blocks.y + blocks.height - 1) * GRID_X + blocks.x;
  const startScreen = (blocks.y + blocks.height - 1) * GRID_H * SCREEN_WIDTH + blocks.x * GRID_W;
  for (const layer of layers) {
    if (!layer) continue;
    let gridOfs = startGridOfs;
    let screenPos = startScreen;
    for (let widCnt = 0; widCnt < blocks.width; widCnt++) {
      maskColumn(dest, layer, gridOfs, screenPos, blocks.height);
      screenPos += GRID_W;
      gridOfs++;
    }
  }
}

/** `Screen::vertMaskSub` pour une colonne de blocs : remonte depuis la rangée du bas tant que la case de la grille est non nulle. */
function maskColumn(dest: Uint8Array, layer: MaskLayer, gridOfs: number, screenPos: number, rows: number): void {
  for (let row = 0; row < rows; row++) {
    const value = layer.grid[gridOfs] ?? 0;
    if (!value) return;
    if (!(value & 0x8000)) {
      let src = (value - 1) * GRID_BLOCK_SIZE;
      let dst = screenPos;
      if (src + GRID_BLOCK_SIZE <= layer.pixels.length) {
        for (let line = 0; line < GRID_H; line++) {
          for (let x = 0; x < GRID_W; x++) {
            const pixel = layer.pixels[src + x];
            if (pixel) dest[dst + x] = pixel;
          }
          src += GRID_W;
          dst += SCREEN_WIDTH;
        }
      }
    }
    screenPos -= GRID_H * SCREEN_WIDTH;
    gridOfs -= GRID_X;
  }
}

/** Nombre maximal de sprites d'une liste triée (`StSortList sortList[30]`). */
export const MAX_SORTED_SPRITES = 30;

/** Clé de tri de `sortSprites` : `ycood + s_offset_y + s_height` tronqué sur 16 bits. */
export function spriteSortKey(ycood: number, sprite: SpriteFile): number {
  return (ycood + sprite.offsetY + sprite.height) & 0xffff;
}

/** Tri à bulles de `sortSprites` (sur place, non stable) ; `key` est la clé de `spriteSortKey`. */
export function sortSprites<T>(list: T[], key: (item: T) => number): void {
  for (let a = 0; a + 1 < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      if (key(list[a]!) > key(list[b]!)) {
        const tmp = list[a]!;
        list[a] = list[b]!;
        list[b] = tmp;
      }
    }
  }
}

/** Pas d'un défilement (`SCROLL_JUMP`) et nombre de pas intermédiaires (`320 / 16 - 1`). */
export const SCROLL_JUMP = 16;
export const SCROLL_STEPS = SCREEN_WIDTH / SCROLL_JUMP - 1;
export const SCROLL_STEP_MS = 20;

/** Sens du défilement : `123` l'ancien décor sort à gauche (le joueur va à droite), `321` il sort à droite. */
export const ScrollDirection = { left: 123, right: 321 } as const;
export type ScrollDirection = (typeof ScrollDirection)[keyof typeof ScrollDirection];

/**
 * Image du pas `step` (1 à 19) d'un défilement entre `oldScreen` et `newScreen` (320 x 192, en lignes), écrite dans `dest` ; le pas 20 est
 * `newScreen` lui-même (`showScreen(_currentScreen)`).
 */
export function scrollFrame(dest: Uint8Array, oldScreen: Uint8Array, newScreen: Uint8Array, direction: ScrollDirection, step: number): void {
  if (!Number.isInteger(step) || step < 1 || step > SCROLL_STEPS + 1) throw new RangeError(`pas de défilement ${step} hors de 1 à ${SCROLL_STEPS + 1}`);
  const shift = Math.min(step * SCROLL_JUMP, SCREEN_WIDTH);
  for (let y = 0; y < GAME_SCREEN_HEIGHT; y++) {
    const row = y * SCREEN_WIDTH;
    if (direction === ScrollDirection.left) {
      dest.set(oldScreen.subarray(row + shift, row + SCREEN_WIDTH), row);
      dest.set(newScreen.subarray(row, row + shift), row + SCREEN_WIDTH - shift);
    } else {
      dest.set(newScreen.subarray(row + SCREEN_WIDTH - shift, row + SCREEN_WIDTH), row);
      dest.set(oldScreen.subarray(row, row + SCREEN_WIDTH - shift), row + shift);
    }
  }
}

/** `Screen::paintBox` : carré de 8 x 8 en (`x`, `y`) à la couleur 255 (case bloquée de la grille de collision, mode débogage). */
export function paintBox(dest: Uint8Array, x: number, y: number): void {
  const pos = y * SCREEN_WIDTH + x;
  dest.fill(255, pos, pos + 8);
  for (let n = 1; n < 8; n++) {
    dest[pos + n * SCREEN_WIDTH] = 255;
    dest[pos + n * SCREEN_WIDTH + 7] = 255;
  }
  dest.fill(255, pos + 7 * SCREEN_WIDTH, pos + 7 * SCREEN_WIDTH + 7);
}
