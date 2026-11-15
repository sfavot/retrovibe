/**
 * Image-sets `.SET` / `.SEC` : table d'entrées et décodage des types 0, 1, 5 et 8 (docs/croisiere/formats.md § 3.2).
 *
 * Référence : `engines/cruise/dataLoader.cpp` (`loadSetEntry`, `decodeGfxUnified`, `updateResFileEntry`) de ScummVM (GPL v3+).
 * Fichier : `"SET\0"` ou `"SEC\0"`, u16 `num`, puis `num` en-têtes de 16 octets (`offset` u32, `width` u16, `height` u16, `type` u16,
 * `transparency` u16 `& 0x1F`, `hotspotY` u16, `hotspotX` u16), puis les données à `6 + 16 * num + offset`. Tout est en grand-boutiste.
 *
 * Dimensions, comme le moteur les établit (`W`, `H` = champs de l'en-tête ; SEC retire `2 × type` à `W`, SET retire 10 aux types 5) :
 * - type 8 : `W × H` pixels chunky ; opaque si `pixel != transparency` ;
 * - type 5 : cinq plans consécutifs ; largeur visible `(W' * 8) / 5`, `W'` = `W` (SEC, déjà réduit de 10) ou `W - 10` (SET, dont le pas
 *   de plan garde les 2 octets de bord : `largeur visible / 8 + 2`) ;
 * - type 1 : un plan, `8 * W'` pixels de large, `transparency` forcée à 0 (opaque = bit à 1) ; masque d'occultation (`OBJ_TYPE_BGMASK`) ;
 * - type 0 : modèle vectoriel `W` octets (`H = 1`), gardé brut ici ; voir `poly-model.ts`.
 * `hotspotX/Y` sont lus mais ignorés par le moteur.
 *
 * Écarts volontaires : le type 4 (4 plans), codé dans ScummVM mais absent des données, lève une erreur, comme tout type inconnu (ScummVM
 * avertit puis laisse l'entrée vide). Une entrée dont les données sortent du fichier lève une erreur (ScummVM copierait au-delà du tampon).
 * Le masque d'opacité reproduit à l'identique la formule de ScummVM, dont le pas de ligne est `largeur / 8` en division entière : si la
 * largeur n'est pas un multiple de 8, les lignes du masque se chevauchent (comportement du moteur d'origine, voir `maskStride`).
 */

const FILE_HEADER_SIZE = 6;
const ENTRY_HEADER_SIZE = 16;
const TRANSPARENCY_MASK = 0x1f;

export type SetKind = "SET" | "SEC";

export interface SetEntryHeader {
  /** Position des données, relative à la fin de la table (`6 + 16 * num`). */
  readonly offset: number;
  readonly width: number;
  readonly height: number;
  readonly type: number;
  /** Couleur transparente : champ `& 0x1F` (0xFFFF donne 31). */
  readonly transparency: number;
  readonly hotspotY: number;
  readonly hotspotX: number;
}

/** Entrée de type 0 : octets de l'enregistrement tels quels (`W` octets). */
export interface PolyEntry {
  readonly kind: "poly";
  readonly header: SetEntryHeader;
  readonly data: Uint8Array;
}

/** Entrée de type 1, 5 ou 8 : image indexée avec son masque d'opacité. */
export interface BitmapEntry {
  readonly kind: "mask" | "sprite";
  readonly header: SetEntryHeader;
  /** Largeur et hauteur en pixels (`width` du moteur une fois l'entrée chargée). */
  readonly width: number;
  readonly height: number;
  /** `width × height` indices de palette. */
  readonly pixels: Uint8Array;
  /** Couleur transparente appliquée (0 pour le type 1, sinon `header.transparency`). */
  readonly transparency: number;
  /** Masque d'opacité, 1 bit par pixel (bit de poids fort = pixel de gauche), 1 = opaque. */
  readonly mask: Uint8Array;
  /** Octets par ligne du masque dans le moteur : `floor(width / 8)`. */
  readonly maskStride: number;
}

export type SetEntry = PolyEntry | BitmapEntry;

export class SetFile {
  readonly kind: SetKind;
  readonly headers: readonly SetEntryHeader[];
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    if (bytes.length < FILE_HEADER_SIZE) throw new Error("SET trop court");
    const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!);
    if ((magic !== "SET" && magic !== "SEC") || bytes[3] !== 0) throw new Error("SET : signature inconnue");
    this.kind = magic;
    this.bytes = bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(4);
    if (FILE_HEADER_SIZE + count * ENTRY_HEADER_SIZE > bytes.length) throw new Error("SET : table d'entrées tronquée");
    const headers: SetEntryHeader[] = [];
    for (let i = 0; i < count; i++) {
      const at = FILE_HEADER_SIZE + i * ENTRY_HEADER_SIZE;
      headers.push({
        offset: view.getUint32(at),
        width: view.getUint16(at + 4),
        height: view.getUint16(at + 6),
        type: view.getUint16(at + 8),
        transparency: view.getUint16(at + 10) & TRANSPARENCY_MASK,
        hotspotY: view.getUint16(at + 12),
        hotspotX: view.getUint16(at + 14),
      });
    }
    this.headers = headers;
  }

  get length(): number {
    return this.headers.length;
  }

  /** Décode l'entrée `index` (`loadSetEntry`). */
  entry(index: number): SetEntry {
    const header = this.headers[index];
    if (!header) throw new Error(`SET : entrée ${index} absente`);
    const sec = this.kind === "SEC";
    let width = header.width;
    if (sec) width -= header.type * 2;
    const resourceSize = width * header.height;
    if (width < 0) throw new Error(`SET : entrée ${index} de largeur négative`);
    const start = FILE_HEADER_SIZE + this.headers.length * ENTRY_HEADER_SIZE + header.offset;
    if (start + resourceSize > this.bytes.length) throw new Error(`SET : entrée ${index} hors du fichier`);
    const data = this.bytes.subarray(start, start + resourceSize);

    switch (header.type) {
      case 0:
        return { kind: "poly", header, data: data.slice() };
      case 1: {
        // Un plan : 16 pixels par mot de 16 bits, bit 15 en premier ; `8 * width` pixels par ligne.
        const pixelWidth = width * 8;
        const pixels = new Uint8Array(pixelWidth * header.height);
        for (let x = 0; x < pixels.length; x += 16) {
          const word = ((data[x / 8] ?? 0) << 8) | (data[x / 8 + 1] ?? 0);
          for (let c = 0; c < 16 && x + c < pixels.length; c++) pixels[x + c] = (word >> (15 - c)) & 1;
        }
        return bitmap("mask", header, pixelWidth, pixels, 0);
      }
      case 5: {
        const visible = ((sec ? width : width - 10) * 8) / 5;
        if (!Number.isInteger(visible) || visible < 0 || visible % 8 !== 0) throw new Error(`SET : entrée ${index}, largeur de plan invalide`);
        const stride = visible / 8 + (sec ? 0 : 2); // octets par ligne de plan
        const plane = header.height * stride;
        const pixels = new Uint8Array(header.height * visible);
        for (let line = 0; line < header.height; line++) {
          for (let x = 0; x < visible; x++) {
            const at = line * stride + (x >> 3);
            const bit = 7 - (x & 7);
            let value = 0;
            for (let p = 0; p < 5; p++) value |= (((data[at + plane * p] ?? 0) >> bit) & 1) << p;
            pixels[line * visible + x] = value;
          }
        }
        return bitmap("sprite", header, visible, pixels, header.transparency);
      }
      case 8:
        return bitmap("sprite", header, width, data.slice(), header.transparency);
      default:
        throw new Error(`SET : type d'entrée ${header.type} non pris en charge`);
    }
  }

  /** Toutes les entrées, décodées. */
  entries(): SetEntry[] {
    return this.headers.map((_, i) => this.entry(i));
  }
}

/** Ajoute le masque d'opacité d'une image (fin de `loadSetEntry`). */
function bitmap(kind: BitmapEntry["kind"], header: SetEntryHeader, width: number, pixels: Uint8Array, transparency: number): BitmapEntry {
  const height = header.height;
  const maskStride = Math.floor(width / 8);
  // `ptrMask` fait au moins la taille des données brutes ; la formule de pas peut écrire jusqu'à `maskStride * height + 1`.
  const mask = new Uint8Array(Math.max(width * height, maskStride * height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[width * y + x] !== transparency) mask[maskStride * y + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { kind, header, width, height, pixels, transparency, mask, maskStride };
}
