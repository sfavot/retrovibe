import { BinaryReader } from "../../../data/reader";
import { decodeCursor, decodeDib } from "./dib";

/** Curseur monochrome de DESKADV.EXE, décodé en RGBA (le blanc et le noir sont opaques, le reste transparent). */
export interface Cursor {
  id: number;
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  rgba: Uint8ClampedArray;
}

/** Icône de DESKADV.EXE décodée en RGBA (le masque AND rend les pixels transparents). */
export interface Icon {
  id: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Image opaque (ressource BITMAP) de DESKADV.EXE décodée en RGBA, retrouvée par son nom (« CLOSEU », « UPAD »…). */
export interface Bitmap {
  id: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const RT_CURSOR = 1;
const RT_BITMAP = 2;
const RT_ICON = 3;
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
 * Icônes de l'exécutable, indexées par identifiant (ressources ICON : DIB 1, 4 ou 8 bpp avec sa palette, puis le masque AND 1 bpp ;
 * la hauteur de l'en-tête couvre les deux images).
 */
export function readIcons(exe: ArrayBuffer | Uint8Array): Map<number, Icon> {
  const icons = new Map<number, Icon>();
  for (const { type, id, data } of readResources(exe)) {
    if (type !== RT_ICON || typeof id !== "number") continue;
    const dib = decodeDib(data, true);
    if (dib) icons.set(id, { id, ...dib });
  }
  return icons;
}

/** Images (ressources BITMAP à nom, DIB sans masque) de l'exécutable, indexées par nom : les boutons de la bulle de dialogue, par exemple. */
export function readBitmaps(exe: ArrayBuffer | Uint8Array): Map<string, Bitmap> {
  const bitmaps = new Map<string, Bitmap>();
  for (const { type, id, data } of readResources(exe)) {
    if (type !== RT_BITMAP || typeof id !== "string") continue;
    const dib = decodeDib(data, false);
    if (dib) bitmaps.set(id, { id, ...dib });
  }
  return bitmaps;
}

/**
 * Effet sonore (fichier WAV complet) stocké dans les ressources `WAVE` de l'exécutable, ou null s'il n'existe pas.
 * Le jeu en embarque quelques-uns qui ne figurent pas dans la table de sons de DESKTOP.DAW.
 */
export function readWave(exe: ArrayBuffer | Uint8Array, id: number): Uint8Array | null {
  const found = readResources(exe).find((res) => res.type === WAVE_TYPE && res.id === id);
  return found?.data ?? null;
}
