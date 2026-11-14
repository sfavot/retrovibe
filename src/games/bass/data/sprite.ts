/**
 * Fichiers de sprites : en-tête `DataFileHeader` suivi de `s_n_sprites` images de `s_sp_size` octets.
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::drawSprite`), struc.h (`DataFileHeader`), mouse.cpp (`Mouse::spriteMouse`),
 * GPL v3 ou ultérieure.
 *
 * Format (vérifié sur les fichiers réels, voir `docs/bass/graphics.md`) :
 * - l'image `n` commence à `22 + n * s_sp_size` ; ses pixels sont `s_width x s_height` octets en lignes, un octet par pixel, indices de la
 *   palette du jeu ; `s_sp_size` vaut `s_width * s_height` ;
 * - la couleur 0 est transparente (`if (spriteData[x]) screenPtr[x] = spriteData[x]`) ;
 * - le moteur numérote l'image par `frame & 0x3F` (64 images au plus : `frame >> 6` est l'identifiant du fichier) ;
 * - le décalage `(s_offset_x, s_offset_y)` (signé) se compte depuis la position du compact (`xcood`, `ycood`) ;
 * - le bit 2 du drapeau (« 32 couleurs ») n'est jamais lu par le moteur du CD : les pixels sont toujours des octets ; il est conservé dans
 *   l'en-tête mais n'a aucune incidence sur le décodage.
 *
 * Écarts volontaires : un numéro d'image hors du fichier lève une erreur (ScummVM lirait au-delà du tampon) ; le numéro n'est pas masqué ici,
 * c'est `frameIndexOf` qui applique `& 0x3F`.
 */

import { DATA_FILE_HEADER_SIZE, type DataFileHeader, parseDataFileHeader } from "./header";

/** Masque du numéro d'image dans `compact.frame` ; `frame >> FRAME_FILE_SHIFT` est l'identifiant du fichier. */
export const FRAME_INDEX_MASK = 0x3f;
export const FRAME_FILE_SHIFT = 6;

/** Numéro d'image d'un compact (`frame & 0x3F`). */
export function frameIndexOf(frame: number): number {
  return frame & FRAME_INDEX_MASK;
}

/** Identifiant du fichier de sprites d'un compact (`frame >> 6`). */
export function spriteFileOf(frame: number): number {
  return frame >> FRAME_FILE_SHIFT;
}

export class SpriteFile {
  readonly header: DataFileHeader;
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly frameSize: number;
  readonly frameCount: number;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.header = parseDataFileHeader(bytes);
    this.bytes = bytes;
    this.width = this.header.width;
    this.height = this.header.height;
    this.offsetX = this.header.offsetX;
    this.offsetY = this.header.offsetY;
    this.frameSize = this.header.spriteSize;
    this.frameCount = this.header.numSprites;
    if (this.frameSize < this.width * this.height) throw new Error(`sprite invalide : image de ${this.frameSize} octets pour ${this.width} x ${this.height}`);
    if (DATA_FILE_HEADER_SIZE + this.frameCount * this.frameSize > bytes.length) {
      throw new Error(`sprite invalide : ${this.frameCount} images de ${this.frameSize} octets dans un fichier de ${bytes.length} octets`);
    }
  }

  /** Pixels de l'image `index` (`width * height` octets, lignes les unes après les autres) : vue sur le fichier, à ne pas modifier. */
  frame(index: number): Uint8Array {
    if (!Number.isInteger(index) || index < 0 || index >= this.frameCount) throw new RangeError(`image ${index} hors de 0 à ${this.frameCount - 1}`);
    const start = DATA_FILE_HEADER_SIZE + index * this.frameSize;
    return this.bytes.subarray(start, start + this.width * this.height);
  }
}
