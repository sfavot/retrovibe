/**
 * Animations : images de sprites des hotspots et séquences plein écran.
 *
 * Sources (ScummVM, GPL v3+) :
 * - `AnimationDecoder::decode_data` et `decode_data_2` (engines/lure/decode.cpp), décompression des images de sprites. ScummVM l'a recopiée de
 *   l'exécutable sans en comprendre le détail ; elle est réécrite ici avec les mêmes registres (`currData`, `bitCtr`, `dx`, retenue) parce que
 *   l'ordre exact des décalages fait le format. Disposition d'une ressource d'animation : `u16` nombre d'images N, N `u16` (taille de chaque
 *   image en pixels), 6 octets (non lus), puis le flux. Le flux commence par 16 paires d'octets qui se scindent en quatre tables de 16
 *   quartets (`dest[0..0x40)`, les « favoris » de chaque couleur), puis des codes de 2 à 4 bits : favori n° 1, 2, 3 ou 4 de la couleur
 *   précédente, ou répétition d'un quartet (longueur sur 8, 8, 6 ou 5 bits), ou quartet nouveau ; longueur 0 sur 16 bits = fin. La sortie
 *   (à partir de `dest[0x40]`) contient des quartets, deux pixels par octet, image après image ;
 * - `Hotspot::setAnimation` (hotspots.cpp) pour le découpage en images (la taille d'une image vient du hotspot, pas de la ressource) ;
 * - `AnimationSequence` (animseq.cpp) pour les séquences : un écran VGA (`vgaDecode`, au plus `MAX_ANIM_DECODER_BUFFER_SIZE` octets) dont
 *   les 64 000 premiers octets sont l'image de départ et le reste les pixels des images suivantes, et la ressource `id + 1` (« lignes »)
 *   qui dit, pour chaque image, combien de pixels copier puis combien en sauter.
 *
 * Écarts volontaires : l'EGA n'est pas porté ; le tampon de sortie est dimensionné comme dans ScummVM (`(somme((taille+31)/32) + 0x81) << 4`)
 * et toute écriture en dehors est une erreur (en C++ elle serait silencieuse) ; les tailles d'image forcées (`sizeOverrides`) et le cas du
 * Serf du chevalet (`RACK_SERF_ID`, images de largeurs différentes) relèvent du moteur et du rendu, pas de ce lecteur.
 */

import { SCREEN_SIZE, vgaDecode } from "./picture";

/** `MAX_ANIM_DECODER_BUFFER_SIZE`. */
export const MAX_ANIM_DECODER_BUFFER_SIZE = 300000;
/** Drapeau de `HotspotAnimResource.flags` : les images sont placées par la table de tailles et non bout à bout (`PIXELFLAG_HAS_TABLE`). */
export const PIXELFLAG_HAS_TABLE = 4;
const TABLE_SIZE = 0x40;

/** `AnimationDecoder::decode_data` : renvoie le nombre d'octets écrits dans `dest` (tables comprises). */
export function decodeAnimationData(src: Uint8Array, dest: Uint8Array, srcPos: number): number {
  let pSrc = srcPos;
  let pDest = 0;
  const srcAt = (index: number): number => src[index] ?? 0;
  const write = (index: number, value: number): void => {
    if (index >= dest.length) throw new Error("décompression d'animation : sortie plus grande que prévu");
    dest[index] = value;
  };

  for (let n = 0; n < 16; n++, pDest++) {
    let value = srcAt(pSrc++);
    write(pDest + 0x10, value & 0xf);
    write(pDest, (value >> 4) & 0xf);
    value = srcAt(pSrc++);
    write(pDest + 0x30, value & 0xf);
    write(pDest + 0x20, (value >> 4) & 0xf);
  }

  pDest = TABLE_SIZE;
  let currData = (srcAt(pSrc) << 8) | srcAt(pSrc + 1);
  pSrc += 2;
  let bitCtr = 4;
  write(pDest, (currData >> 8) & 0xf0);
  let tableOffset = currData >> 12;
  currData = (currData << 4) & 0xffff;
  let dx = 1;
  let carry = false;

  const getByte = (): void => {
    currData = (currData & 0xff00) | srcAt(pSrc++);
  };
  const rcl = (): void => {
    const result = (currData & 0x8000) !== 0;
    currData = ((currData << 1) + (carry ? 1 : 0)) & 0xffff;
    carry = result;
  };
  /** `rcl` puis `--bitCtr` avec rechargement : le motif répété partout dans l'original. */
  const shift = (): void => {
    rcl();
    bitCtr = (bitCtr - 1) & 0xffff;
    if (bitCtr === 0) {
      getByte();
      bitCtr = 8;
    }
  };
  const setHigh = (value: number, high: number): number => ((value & 0xff) | (high << 8)) & 0xffff;
  const setLow = (value: number, low: number): number => (value & 0xff00) | (low & 0xff);
  const at = (offset: number): number => dest[tableOffset + offset]!;

  /** `decode_data_2` : lit 8 bits dans l'octet haut de `dx`. */
  const decodeData2 = (): void => {
    dx = setHigh(dx, currData >> 8);
    for (let v = 0; v < 8; v++) {
      rcl();
      bitCtr = (bitCtr - 1) & 0xffff;
      if (bitCtr === 0) {
        if (pSrc >= src.length) currData &= 0xff00;
        else getByte();
        bitCtr = 8;
      }
    }
  };

  let loopFlag = true;
  while (loopFlag) {
    for (;;) {
      carry = false;
      shift();
      if (!carry) {
        tableOffset = at(0);
        break;
      }
      shift();
      if (!carry) {
        shift();
        tableOffset = !carry ? at(0x10) : at(0x20);
        break;
      }
      shift();
      if (!carry) {
        tableOffset = at(0x30);
        break;
      }

      dx = setHigh(dx, currData >> 12);
      carry = false;
      for (let ctr = 0; ctr < 4; ctr++) shift();

      const dxHigh = dx >> 8;
      let saved: number;
      if (dxHigh === at(0)) {
        saved = bitCtr;
        const savedDx = dx;
        decodeData2();
        dx = setLow(dx, dx >> 8);
        decodeData2();
        bitCtr = setLow(setHigh(bitCtr, dx & 0xff), dx >> 8);
        dx = savedDx;
        if (bitCtr === 0) {
          loopFlag = false; // fin de la décompression
          break;
        }
      } else if (dxHigh === at(0x10)) {
        saved = bitCtr;
        decodeData2();
        bitCtr = dx >> 8;
      } else if (dxHigh === at(0x20)) {
        dx = setHigh(dx, currData >> 10);
        for (let v = 0; v < 6; v++) shift();
        saved = bitCtr;
        bitCtr = dx >> 8;
      } else if (dxHigh === at(0x30)) {
        dx = setHigh(dx, currData >> 11);
        for (let v = 0; v < 5; v++) shift();
        saved = bitCtr;
        bitCtr = dx >> 8;
      } else {
        tableOffset = dx >> 8; // quartet nouveau
        break;
      }

      // Répétition : bitCtr quartets de valeur tableOffset
      if ((dx & 1) === 1) {
        write(pDest, dest[pDest]! | tableOffset);
        pDest++;
        bitCtr = (bitCtr - 1) & 0xffff;
        dx &= 0xfffe;
      }
      dx = setHigh(dx, tableOffset << 4);
      tableOffset = (tableOffset | (dx >> 8)) & 0xff;
      for (let pairs = bitCtr >> 1; pairs > 0; pairs--) write(pDest++, tableOffset);
      bitCtr &= 1;
      if (bitCtr !== 0) {
        write(pDest, tableOffset & 0xf0);
        dx |= 1;
      }
      bitCtr = saved;
      tableOffset &= 0x0f;
    }

    if (loopFlag) {
      dx ^= 1;
      if ((dx & 1) !== 0) {
        dx = setHigh(dx, tableOffset << 4);
        write(pDest, dx >> 8);
      } else {
        write(pDest, dest[pDest]! | tableOffset);
        pDest++;
      }
    }
  }
  return pDest;
}

export interface Animation {
  /** Nombre d'images (premier `u16` de la ressource). */
  readonly numFrames: number;
  /** Taille de chaque image en pixels, telle que l'annonce l'en-tête. */
  readonly frameSizes: readonly number[];
  /** Quartets décompressés (deux pixels par octet, poids fort d'abord), sans les 0x40 octets de tables. */
  readonly nibbles: Uint8Array;
}

/** Décompresse une ressource d'animation de hotspot (`Hotspot::setAnimation`). */
export function decodeAnimation(src: Uint8Array): Animation {
  if (src.length < 2) throw new Error("animation invalide : ressource trop courte");
  const numFrames = src[0]! | (src[1]! << 8);
  if (numFrames < 1 || numFrames >= 100) throw new Error(`animation invalide : ${numFrames} images`);
  const headerEnd = 2 + numFrames * 2;
  if (src.length < headerEnd + 6) throw new Error("animation invalide : en-tête tronqué");
  const frameSizes: number[] = [];
  let totalSize = 0;
  for (let i = 0; i < numFrames; i++) {
    const size = src[2 + i * 2]! | (src[3 + i * 2]! << 8);
    frameSizes.push(size);
    totalSize += Math.floor((size + 31) / 32);
  }
  const dest = new Uint8Array((totalSize + 0x81) << 4);
  const end = decodeAnimationData(src, dest, headerEnd + 6);
  return { numFrames, frameSizes, nibbles: dest.subarray(TABLE_SIZE, end) };
}

/**
 * Image `index` d'une animation sous forme de pixels de 0 à 15 (`largeur x hauteur`, ligne par ligne). Le moteur ajoute `colorOffset` du
 * hotspot. Avec `PIXELFLAG_HAS_TABLE` la position de l'image est la somme des demi-tailles de l'en-tête, sinon les images se suivent.
 */
export function animationFrame(anim: Animation, index: number, width: number, height: number, flags: number): Uint8Array {
  if (index < 0 || index >= anim.numFrames) throw new RangeError(`image ${index} absente (l'animation en compte ${anim.numFrames})`);
  let start = 0;
  if ((flags & PIXELFLAG_HAS_TABLE) !== 0) {
    for (let i = 0; i < index; i++) start += anim.frameSizes[i]! >> 1;
  } else {
    start = index * ((width * height) >> 1);
  }
  const pixels = new Uint8Array(width * height);
  const bytesPerRow = width >> 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bytesPerRow; x++) {
      const value = anim.nibbles[start + y * bytesPerRow + x] ?? 0;
      pixels[y * width + x * 2] = value >> 4;
      pixels[y * width + x * 2 + 1] = value & 0xf;
    }
  }
  return pixels;
}

/** Séquence plein écran (`AnimationSequence`) : écran de départ et images suivantes en différences. */
export class AnimationSequence {
  /** Écran de départ, 320 x 200 (les 64 000 premiers octets de la sortie décompressée). */
  readonly initialScreen: Uint8Array;
  private readonly pixels: Uint8Array;
  private readonly lines: Uint8Array;
  private pixelPos = 0;
  private linePos = 0;

  /** `screenData` : la ressource de l'écran ; `lineData` : la ressource `id + 1`. */
  constructor(screenData: Uint8Array, lineData: Uint8Array) {
    const decoded = vgaDecode(screenData, MAX_ANIM_DECODER_BUFFER_SIZE);
    if (decoded.length < SCREEN_SIZE) throw new Error("séquence invalide : l'écran de départ est trop court");
    this.initialScreen = decoded.subarray(0, SCREEN_SIZE);
    this.pixels = decoded.subarray(SCREEN_SIZE);
    this.lines = lineData;
  }

  /** Nombre d'octets de pixels des images (tous les paquets). */
  get pixelBytes(): number {
    return this.pixels.length;
  }

  /** Vrai s'il reste une image à appliquer (`step()` de ScummVM : pixels et lignes encore disponibles). */
  get hasFrame(): boolean {
    return this.pixelPos < this.pixels.length - 1 && this.linePos < this.lines.length - 1;
  }

  /** Remet la séquence au début (répétition de la séquence). */
  rewind(): void {
    this.pixelPos = 0;
    this.linePos = 0;
  }

  /** Applique l'image suivante à `screen` (320 x 200) : `AnimationSequence::vgaDecodeFrame`. */
  applyNextFrame(screen: Uint8Array): void {
    let screenPos = 0;
    const readLength = (): number => {
      let len = this.lines[this.linePos++]!;
      if (len === 0) {
        len = this.lines[this.linePos]! | (this.lines[this.linePos + 1]! << 8);
        this.linePos += 2;
      }
      return len;
    };
    while (screenPos < SCREEN_SIZE) {
      let len = readLength();
      screen.set(this.pixels.subarray(this.pixelPos, this.pixelPos + len), screenPos);
      screenPos += len;
      this.pixelPos += len;
      len = readLength();
      screenPos += len;
    }
  }
}
