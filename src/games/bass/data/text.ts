/**
 * Textes du jeu : sections `60600 + 8 × langue + section`, flux Huffman 0.0372.
 *
 * Référence : ScummVM engines/sky/text.cpp (`Text::getText`, `getTextBit`, `getTextChar`, `patchMessage`) ; l'arbre et les rustines viennent de
 * `tables/` (générées, voir `scripts/bass/gen-tables.py`), GPL v3 ou ultérieure.
 *
 * Format d'une section : `u16` position de la table des tailles, `u16` début du flux ; `u16` par bloc de 32 lignes (taille du bloc en quarts
 * d'octet) à partir de l'octet 4 ; une taille par ligne sur un octet (bit 7 : `(v & 0x7F) << 3`) ; flux Huffman lu bit de poids fort d'abord,
 * chaque ligne se terminant par le code 0. Les positions de lignes sont en quarts d'octet.
 *
 * Écarts volontaires :
 * - les textes sont rendus en chaînes JavaScript dont chaque caractère est un code du jeu (0 à 255), sans le 0 final ; `charset.ts` convertit ;
 * - ScummVM lit au-delà du tampon sur un numéro invalide ; ici un numéro hors de la section ou un flux tronqué lève une erreur ;
 * - le chinois traditionnel et le remake iOS sont ignorés.
 */

import type { SkyDisk } from "./disk";
import { LANGUAGE_FRENCH, TEXT_SECTIONS, textFile } from "./ids";
import { HUFFMAN_372 } from "./tables/huffman-372";
import { PATCHED_MESSAGES } from "./tables/text-patches";

/** Section (0 à 7) d'un numéro de texte. */
export function textSection(textNr: number): number {
  return (textNr & 0xf000) >> 12;
}

/** Rang d'un numéro de texte dans sa section. */
export function textIndex(textNr: number): number {
  return textNr & 0xfff;
}

/** Nombre de lignes d'une section : une taille d'un octet par ligne entre la table des tailles et le début du flux. */
export function sectionLineCount(data: Uint8Array): number {
  return u16(data, 2) - u16(data, 0);
}

function u16(data: Uint8Array, at: number): number {
  if (at < 0 || at + 2 > data.length) throw new RangeError("section de texte tronquée");
  return data[at]! | (data[at + 1]! << 8);
}

/** `getTextChar` : un code décodé, en avançant `state` (octet courant et position de bit, comme ScummVM). */
function decodeLine(data: Uint8Array, nr: number): string {
  let blockNr = nr & 0xfe0;
  let line = nr & 0x1f;
  let offset = 0;

  if (blockNr) {
    // Une entrée de `u16` par bloc de 32 lignes, à partir de l'octet 4 (`do … while`, au moins une).
    for (let block = 0; block < blockNr >> 5; block++) offset += u16(data, 4 + 2 * block);
  }
  if (line) {
    let at = blockNr + u16(data, 0);
    do {
      if (at >= data.length) throw new RangeError(`texte ${nr} : table des tailles tronquée`);
      let skip = data[at++]!;
      if (skip & 0x80) skip = (skip & 0x7f) << 3;
      offset += skip;
    } while (--line);
  }

  let bitPos = ((((offset & 3) ^ 3) + 1) << 1) >>> 0;
  let ptr = (offset >> 2) + u16(data, 2);
  let out = "";
  for (;;) {
    let node = 0;
    for (;;) {
      if (bitPos) bitPos--;
      else {
        ptr++;
        bitPos = 7;
      }
      if (ptr >= data.length) throw new RangeError(`texte ${nr} : flux tronqué`);
      const at = 3 * node;
      node = (data[ptr]! >> bitPos) & 1 ? HUFFMAN_372[at + 1]! : HUFFMAN_372[at]!;
      if (HUFFMAN_372[3 * node] === 0 && HUFFMAN_372[3 * node + 1] === 0) break;
    }
    const code = HUFFMAN_372[3 * node + 2]!;
    if (code === 0) return out;
    out += String.fromCharCode(code);
  }
}

/** Décode la ligne `rank` (0 à 4095) d'une section brute, sans rustine. Lève si la ligne est hors de la section. */
export function decodeSectionLine(data: Uint8Array, rank: number): string {
  if (!Number.isInteger(rank) || rank < 0 || rank >= sectionLineCount(data)) throw new RangeError(`ligne ${rank} hors de la section`);
  return decodeLine(data, rank);
}

/** Texte de remplacement de `Text::patchMessage` pour une langue, ou `undefined`. */
export function patchedMessage(language: number, textNr: number): string | undefined {
  return PATCHED_MESSAGES[language]?.find(([nr]) => nr === textNr)?.[1];
}

/** Accès aux textes d'une langue (les sections sont chargées à la demande, comme `_itemList` de ScummVM). */
export class SkyTexts {
  private readonly sections = new Map<number, Uint8Array>();

  constructor(
    private readonly disk: SkyDisk,
    readonly language: number = LANGUAGE_FRENCH,
  ) {}

  /** Octets bruts de la section `section` (0 à 7). */
  section(section: number): Uint8Array {
    if (!Number.isInteger(section) || section < 0 || section >= TEXT_SECTIONS) throw new RangeError(`section de texte ${section} invalide`);
    let data = this.sections.get(section);
    if (!data) {
      data = this.disk.load(textFile(this.language, section));
      this.sections.set(section, data);
    }
    return data;
  }

  /** Nombre de lignes de la section. */
  lineCount(section: number): number {
    return sectionLineCount(this.section(section));
  }

  /** `Text::getText` : texte `textNr` (`section << 12 | rang`), rustine de la langue appliquée ; codes du jeu, sans le 0 final. */
  getText(textNr: number): string {
    const patch = patchedMessage(this.language, textNr);
    if (patch !== undefined) return patch;
    return decodeSectionLine(this.section(textSection(textNr)), textIndex(textNr));
  }
}
