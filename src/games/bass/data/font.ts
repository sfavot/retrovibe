/**
 * Polices du jeu (60150 principale, 60520 panneau de contrôle, 60521 liens) et dessin d'un glyphe.
 *
 * Référence : ScummVM engines/sky/text.cpp (`Text::Text`, `fnSetFont`, `makeGameCharacter`), skydefs.h (`MAIN_CHAR_HEIGHT`), GPL v3 ou ultérieure.
 *
 * Format : 128 octets de largeurs (indice = code − 0x20), puis par glyphe `hauteur` lignes de `u16` BE de pixels suivi d'un `u16` BE de masque
 * (16 pixels au plus, bit de poids fort à gauche). Pixel posé et masqué : couleur du texte ; masqué seulement : contour (240).
 *
 * Écart volontaire : un code sans glyphe dans le fichier lève une erreur (ScummVM lirait au-delà du tampon).
 */

import { FONT_CONTROL_PANEL, FONT_LINK, FONT_MAIN } from "./ids";

export const FONT_HEADER_SIZE = 128;
/** Premier code représenté dans la table des largeurs. */
export const FIRST_FONT_CHAR = 0x20;
/** Couleur du contour (`makeGameCharacter`). */
export const OUTLINE_COLOR = 240;

export interface FontSpec {
  readonly file: number;
  readonly charHeight: number;
  /** `_dtCharSpacing` : espace ajouté de chaque côté d'un glyphe. */
  readonly charSpacing: number;
}

/** `fnSetFont` : 0 principale, 1 liens, 2 panneau de contrôle. */
export const FONT_SPECS: readonly FontSpec[] = [
  { file: FONT_MAIN, charHeight: 12, charSpacing: 0 },
  { file: FONT_LINK, charHeight: 12, charSpacing: 1 },
  { file: FONT_CONTROL_PANEL, charHeight: 12, charSpacing: 0 },
];
export const FONT_NUMBER_MAIN = 0;
export const FONT_NUMBER_LINK = 1;
export const FONT_NUMBER_CONTROL = 2;

export class SkyFont {
  /** Numéro de police de `fnSetFont` (0, 1 ou 2). */
  readonly fontNumber: number;
  readonly charHeight: number;
  readonly charSpacing: number;
  /** Nombre de glyphes présents dans le fichier (codes `0x20` à `0x20 + glyphCount - 1`). */
  readonly glyphCount: number;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array, fontNumber: number) {
    const spec = FONT_SPECS[fontNumber];
    if (!spec) throw new RangeError(`police ${fontNumber} invalide`);
    if (data.length < FONT_HEADER_SIZE) throw new Error("police invalide : fichier trop court");
    this.data = data;
    this.fontNumber = fontNumber;
    this.charHeight = spec.charHeight;
    this.charSpacing = spec.charSpacing;
    this.glyphCount = Math.floor((data.length - FONT_HEADER_SIZE) / (spec.charHeight * 4));
  }

  /** Largeur brute de la table (`charSet[code - 0x20]`). */
  rawWidth(code: number): number {
    return this.data[this.index(code)]!;
  }

  /** `charWidth` de `makeGameCharacter` : pixels dessinés. */
  glyphWidth(code: number): number {
    return this.rawWidth(code) + 1 - this.charSpacing;
  }

  /** Avance du curseur après un glyphe (`dest = start + charWidth + spacing * 2 - 1`). */
  advance(code: number): number {
    return this.glyphWidth(code) + this.charSpacing * 2 - 1;
  }

  /** Vrai si le glyphe contient au moins un pixel (pixel de texte ou de contour). */
  hasInk(code: number): boolean {
    const base = this.glyphBase(code);
    for (let row = 0; row < this.charHeight; row++) if (this.view(base + row * 4 + 2) !== 0) return true;
    return false;
  }

  /**
   * `makeGameCharacter` : dessine le glyphe `code` à `dest[at]` (tampon indexé de pitch `pitch`) ; rend la position suivante.
   * Les pixels non masqués ne sont pas touchés ; le glyphe ne dépasse pas des lignes du tampon (sinon erreur).
   */
  draw(code: number, dest: Uint8Array, at: number, pitch: number, color: number): number {
    const base = this.glyphBase(code);
    const width = this.glyphWidth(code);
    let rowStart = at;
    for (let i = 0; i < this.charHeight; i++) {
      let data = this.view(base + i * 4);
      let mask = this.view(base + i * 4 + 2);
      let cur = rowStart;
      for (let j = 0; j < width; j++) {
        if (mask & 0x8000) {
          if (cur >= dest.length) throw new RangeError("glyphe hors du tampon");
          dest[cur] = data & 0x8000 ? color : OUTLINE_COLOR;
        }
        mask = (mask << 1) & 0xffff;
        data = (data << 1) & 0xffff;
        cur++;
      }
      rowStart += pitch;
    }
    return at + this.advance(code);
  }

  /** Glyphe en rangées de chaînes (`#` texte, `.` contour, espace vide) : pour l'inspection et les tests. */
  ascii(code: number): string[] {
    const base = this.glyphBase(code);
    const width = Math.max(this.glyphWidth(code), 0);
    const rows: string[] = [];
    for (let i = 0; i < this.charHeight; i++) {
      let data = this.view(base + i * 4);
      let mask = this.view(base + i * 4 + 2);
      let row = "";
      for (let j = 0; j < width; j++) {
        row += mask & 0x8000 ? (data & 0x8000 ? "#" : ".") : " ";
        mask = (mask << 1) & 0xffff;
        data = (data << 1) & 0xffff;
      }
      rows.push(row);
    }
    return rows;
  }

  private index(code: number): number {
    const index = code - FIRST_FONT_CHAR;
    if (!Number.isInteger(code) || index < 0 || index >= this.glyphCount) throw new RangeError(`code ${code} sans glyphe dans la police ${this.fontNumber}`);
    return index;
  }

  private glyphBase(code: number): number {
    return FONT_HEADER_SIZE + this.charHeight * 4 * this.index(code);
  }

  private view(at: number): number {
    return (this.data[at]! << 8) | this.data[at + 1]!;
  }
}
