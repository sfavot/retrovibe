import { BinaryReader } from "../../../data/reader";

/** Curseur monochrome de DESKADV.EXE, décodé en RGBA (le blanc et le noir sont opaques, le reste transparent). */
export interface Cursor {
  id: number;
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  rgba: Uint8ClampedArray;
}

const RT_CURSOR = 1;
const DIB_HEADER_SIZE = 40;
/** Type de la ressource personnalisée qui contient les effets sonores enfouis dans l'exécutable. */
const WAVE_TYPE = "WAVE";

/** Ressource brute de la table d'un exécutable NE. Un type ou un id numérique est un entier (bit 15 retiré), sinon c'est un nom. */
interface Resource {
  type: number | string;
  id: number | string;
  data: Uint8Array;
}

/**
 * Table de ressources d'un exécutable Windows 16 bits (format NE) : facteur d'alignement, puis des blocs
 * (type, nombre d'entrées, 4 octets réservés, entrées de 12 octets : offset et longueur en unités de 2^shift,
 * drapeaux, id, 4 octets réservés). Sans le bit 15, un type ou un id est l'offset d'un nom
 * (octet de longueur puis ASCII) relatif au début de la table.
 */
function readResources(exe: ArrayBuffer | Uint8Array): Resource[] {
  const bytes = exe instanceof Uint8Array ? exe : new Uint8Array(exe);
  const r = new BinaryReader(bytes);
  r.offset = 0x3c;
  const ne = r.u32();
  r.offset = ne;
  if (r.tag().slice(0, 2) !== "NE") throw new Error("En-tête NE introuvable dans l'exécutable");
  r.offset = ne + 0x24;
  const table = ne + r.u16();
  r.offset = table;
  const shift = r.u16();

  const name = (offset: number) => {
    const at = table + offset;
    return String.fromCharCode(...bytes.subarray(at + 1, at + 1 + bytes[at]));
  };
  const resources: Resource[] = [];
  for (;;) {
    const rawType = r.u16();
    if (rawType === 0) break;
    const count = r.u16();
    r.offset += 4;
    for (let i = 0; i < count; i++) {
      const offset = r.u16() << shift;
      const length = r.u16() << shift;
      r.u16(); // drapeaux
      const rawId = r.u16();
      r.offset += 4; // réservé
      resources.push({
        type: rawType & 0x8000 ? rawType & 0x7fff : name(rawType),
        id: rawId & 0x8000 ? rawId & 0x7fff : name(rawId),
        data: bytes.subarray(offset, offset + length),
      });
    }
  }
  return resources;
}

/**
 * Curseurs de l'exécutable, indexés par identifiant.
 * Chaque ressource CURSOR est un hotspot (2 × u16) suivi d'un DIB 1 bpp dont la hauteur couvre deux masques :
 * le XOR (couleur), puis le AND (transparence) — lignes de bas en haut, rangées de 4 octets.
 */
export function readCursors(exe: ArrayBuffer | Uint8Array): Map<number, Cursor> {
  const cursors = new Map<number, Cursor>();
  for (const { type, id, data } of readResources(exe)) {
    if (type !== RT_CURSOR || typeof id !== "number") continue;
    const cursor = decodeCursor(data, id);
    if (cursor) cursors.set(cursor.id, cursor);
  }
  return cursors;
}

/**
 * Effet sonore (fichier WAV complet) stocké dans les ressources `WAVE` de l'exécutable, ou null s'il n'existe pas.
 * Le jeu en embarque quelques-uns qui ne figurent pas dans la table de sons de DESKTOP.DAW.
 */
export function readWave(exe: ArrayBuffer | Uint8Array, id: number): Uint8Array | null {
  const found = readResources(exe).find((res) => res.type === WAVE_TYPE && res.id === id);
  return found?.data ?? null;
}

function decodeCursor(data: Uint8Array, id: number): Cursor | null {
  const r = new BinaryReader(data);
  const hotspotX = r.u16();
  const hotspotY = r.u16();
  if (r.u32() !== DIB_HEADER_SIZE) return null;
  const width = r.i32();
  const height = r.i32() / 2;
  r.offset += 2; // plans
  if (r.u16() !== 1) return null; // seuls les curseurs 1 bpp sont gérés
  r.offset = 4 + DIB_HEADER_SIZE;
  const colors = [r.u32(), r.u32()]; // BGRx
  const stride = Math.ceil(width / 32) * 4;
  const masks = data.subarray(r.offset);
  if (masks.length < stride * height * 2) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const bit = (row: number, x: number) => (masks[row * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  for (let y = 0; y < height; y++) {
    const stored = height - 1 - y; // le DIB est stocké de bas en haut
    for (let x = 0; x < width; x++) {
      const and = bit(height + stored, x);
      const xor = bit(stored, x);
      // AND=1, XOR=0 : transparent. AND=1, XOR=1 : inversion de l'écran, rendue ici en transparent aussi.
      if (and) continue;
      const color = colors[xor];
      const o = (y * width + x) * 4;
      rgba[o] = (color >> 16) & 0xff;
      rgba[o + 1] = (color >> 8) & 0xff;
      rgba[o + 2] = color & 0xff;
      rgba[o + 3] = 0xff;
    }
  }
  return { id, width, height, hotspotX, hotspotY, rgba };
}
