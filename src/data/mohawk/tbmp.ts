/**
 * Ressource `tBMP` : même format que `SHAP` (entête 8 octets + LZ 0x100 + RLE 0x10, voir `shap.ts`). Dans `MPC/PVG.MHK` de
 * Mathémagique, c'est toujours une image isolée (128 images décodées sans erreur ; le module qui les lit n'est pas dans MATH).
 *
 * Dans Zoombinis (`docs/zoombinis/engine.md` §5.2), une `tBMP` est soit une image isolée (drapeaux 0x002, 0x012, 0x102 ou
 * 0x112), soit une **planche multi-images** (`11a8:2ae6`), fabriquée comme un faux bitmap :
 *
 * | Octets | Contenu |
 * |---|---|
 * | 0 | u16 nombre d'images `n` (= « largeur » du faux bitmap) |
 * | 2 | u16 hauteur, sans usage |
 * | 4 | u16 pas = `(n + 3) & ~3` |
 * | 6 | u16 drapeaux : 0x0002, ou 0x0102 si la table et les sous-images sont compressées en LZ (12 planches, non décrites par engine.md) |
 * | 8 | `n` décalages u32 absolus (depuis le début de la ressource) des sous-images ; le premier vaut `8 + 4 n` |
 *
 * Avec 0x0102, les octets 8 et suivants sont l'entête LZ de `shap.ts` (10 octets) puis les données ; une fois décompressées, elles
 * contiennent la table et les sous-images comme ci-dessus, les décalages restant comptés comme si l'entête de 8 octets précédait
 * la table (décalage `o` = octet `o - 8` des données décompressées).
 *
 * Chaque sous-image est un `SHAP` complet (entête de 8 octets + pixels, drapeaux 0x012 ou 0x002, jamais de LZ), alignée sur
 * 4 octets : 2 à 5 octets de bourrage suivent une sous-image RLE.
 */
import { decodeShap, FLAG_LZ, type Shape, unpackLz } from "./shap";

const SHEET_FLAGS = 0x0002;
const HEADER_SIZE = 8;

export function decodeTbmp(bytes: Uint8Array): Shape {
  return decodeShap(bytes);
}

/** Table de sous-images d'une planche : octets de la table et des sous-images, et décalage du premier octet de `data` dans la ressource. */
interface Sheet {
  /** Nombre de sous-images. */
  count: number;
  data: Uint8Array;
  /** Position de `data[0]` dans le repère des décalages (8 pour une planche brute comme pour une planche en LZ). */
  base: number;
}

function readSheet(bytes: Uint8Array): Sheet | undefined {
  if (bytes.length < HEADER_SIZE + 4) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(0);
  const flags = view.getUint16(6);
  if (count === 0 || view.getUint16(4) !== ((count + 3) & ~3) || (flags & ~FLAG_LZ) !== SHEET_FLAGS) return undefined;

  let data = bytes.subarray(HEADER_SIZE);
  if (flags & FLAG_LZ) {
    if (bytes.length < 18) return undefined;
    const packedSize = view.getUint32(12);
    try {
      data = unpackLz(bytes, 18, Math.min(bytes.length, 18 + packedSize), view.getUint32(8)).data;
    } catch {
      return undefined;
    }
  }

  const table = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (4 * count > data.length || table.getUint32(0) !== HEADER_SIZE + 4 * count) return undefined;
  let previous = 0;
  for (let i = 0; i < count; i++) {
    const offset = table.getUint32(4 * i);
    if (offset <= previous || offset - HEADER_SIZE >= data.length) return undefined;
    previous = offset;
  }
  return { count, data, base: HEADER_SIZE };
}

/**
 * Vrai si la ressource est une planche multi-images : `largeur == n`, `pas == (n + 3) & ~3`, drapeaux 0x0002 ou 0x0102, premier
 * décalage `8 + 4 n`, décalages strictement croissants et dans la ressource. Une image isolée (15 images brutes de drapeau
 * 0x0002, et les images en LZ) échoue à ce test.
 */
export function isTbmpSheet(bytes: Uint8Array): boolean {
  return readSheet(bytes) !== undefined;
}

/**
 * Décode toutes les images d'une `tBMP` : une seule pour une ressource simple, les `n` sous-images (dans l'ordre, la
 * sous-image `w` du moteur étant à l'indice `w - 1`) pour une planche. Les sous-images sont des `SHAP` sans LZ.
 */
export function decodeTbmpImages(bytes: Uint8Array): Shape[] {
  const sheet = readSheet(bytes);
  if (!sheet) return [decodeTbmp(bytes)];
  const { count, data, base } = sheet;
  const table = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const images: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const start = table.getUint32(4 * i) - base;
    const end = i + 1 < count ? table.getUint32(4 * (i + 1)) - base : data.length;
    images.push(decodeShap(data.subarray(start, end)));
  }
  return images;
}
