/**
 * Banques de sprites (`*.BBK`, `*.ACT`, `*.SAM` : trois extensions, un seul format).
 *
 * Source : `BankManager::load` et `BankManager::unpack`, variante PC (engines/queen/bankman.cpp, ScummVM).
 * Disposition : `u16` (petit-boutiste) nombre d'images ; par image quatre `u16` (largeur, hauteur, point
 * d'ancrage x et y), puis `largeur x hauteur` indices de palette, non compressés, ligne par ligne.
 * Les numéros d'images du jeu **commencent à 1** (`frame(n)`) ; ScummVM alias l'image 0 à la première, ce qui
 * n'est pas reproduit (numéro 0 refusé).
 * Écarts volontaires : ScummVM ne vérifie rien de la fin du fichier ; ici une banque doit se parcourir
 * exactement jusqu'à son dernier octet. Le MAX_BANK_SIZE de ScummVM n'est pas imposé.
 * L'indice 0 est transparent dans les images dessinées « masquées » (`Display::blit`, `masked`), c'est-à-dire
 * les sprites et les images collées dans le décor ; ce lecteur rend les indices tels quels.
 */

import { BinaryReader } from "../../../data/reader";

export interface BankFrame {
  width: number;
  height: number;
  /** Point d'ancrage (`xhotspot`, `yhotspot`) dans l'image. */
  hotspotX: number;
  hotspotY: number;
  /** Indices de palette, `width * height` octets : une vue du fichier, pas une copie. */
  pixels: Uint8Array;
}

export class SpriteBank {
  /** Images dans l'ordre du fichier (`frames[0]` est l'image numéro 1). */
  readonly frames: readonly BankFrame[];

  constructor(frames: readonly BankFrame[]) {
    this.frames = frames;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  /** Image de numéro `number` (à partir de 1, comme dans les données du jeu). */
  frame(number: number): BankFrame {
    const frame = this.frames[number - 1];
    if (!frame) throw new RangeError(`image ${number} absente (la banque en compte ${this.frames.length})`);
    return frame;
  }
}

const FRAME_HEADER_SIZE = 8;

export function parseBank(bytes: Uint8Array): SpriteBank {
  if (bytes.length < 2) throw new Error("banque invalide : fichier trop court");
  const reader = new BinaryReader(bytes);
  const count = reader.u16();
  const frames: BankFrame[] = [];
  for (let i = 0; i < count; i++) {
    if (reader.offset + FRAME_HEADER_SIZE > bytes.length) throw new Error(`banque invalide : image ${i + 1} tronquée`);
    const width = reader.u16();
    const height = reader.u16();
    const hotspotX = reader.u16();
    const hotspotY = reader.u16();
    const size = width * height;
    if (reader.offset + size > bytes.length) throw new Error(`banque invalide : image ${i + 1} tronquée`);
    frames.push({ width, height, hotspotX, hotspotY, pixels: reader.bytesView(size) });
  }
  if (!reader.isAtEnd) throw new Error(`banque invalide : ${bytes.length - reader.offset} octets après la dernière image`);
  return new SpriteBank(frames);
}
