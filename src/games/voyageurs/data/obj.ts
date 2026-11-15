/**
 * Fichiers `.OBJ` : table d'objets du jeu.
 *
 * Référence : ScummVM engines/cine/object.cpp (`loadObject`) et object.h (`NUM_MAX_OBJECT`) (GPL v3 ou ultérieure). Format : nombre
 * d'entrées (u16, 255), taille d'entrée (u16, 32), puis par entrée : x, y (i16), masque (u16), frame, costume (i16), nom de 20 octets, partie (u16).
 * Grand-boutiste. docs/voyageurs/formats.md § 2.8.
 *
 * Écarts volontaires : `loadObject` n'écrase pas un objet de costume -2 déjà présent dans la table du moteur et force `costume = 0` pour les
 * dix premiers objets de `INTRO.OBJ` : ces deux règles dépendent de l'état du moteur, elles restent à l'appelant (`INTRO_OBJ_NAME`). Les noms sont
 * décodés en CP437 (ils sont en ASCII dans les fichiers livrés).
 */
import { decodeCp437 } from "../../../data/cp437";
import { BinaryReader } from "../../../data/reader";

export const NUM_MAX_OBJECT = 255;
export const OBJECT_ENTRY_SIZE = 32;
export const OBJECT_NAME_LENGTH = 20;
export const INTRO_OBJ_NAME = "INTRO.OBJ";

export interface ObjEntry {
  readonly x: number;
  readonly y: number;
  readonly mask: number;
  readonly frame: number;
  readonly costume: number;
  readonly name: string;
  readonly part: number;
}

export function readObj(data: Uint8Array): ObjEntry[] {
  const reader = new BinaryReader(data);
  const count = reader.u16be();
  const entrySize = reader.u16be();
  if (count > NUM_MAX_OBJECT) throw new RangeError(`OBJ : ${count} objets, ${NUM_MAX_OBJECT} au plus`);
  if (entrySize < OBJECT_ENTRY_SIZE) throw new RangeError(`OBJ : taille d'entrée ${entrySize} < ${OBJECT_ENTRY_SIZE}`);
  if (4 + count * entrySize > data.length) throw new RangeError("OBJ tronqué");
  const entries: ObjEntry[] = [];
  for (let i = 0; i < count; i++) {
    reader.offset = 4 + i * entrySize;
    const x = reader.i16be();
    const y = reader.i16be();
    const mask = reader.u16be();
    const frame = reader.i16be();
    const costume = reader.i16be();
    const rawName = reader.bytesView(OBJECT_NAME_LENGTH);
    const end = rawName.indexOf(0);
    const name = decodeCp437(end === -1 ? rawName : rawName.subarray(0, end));
    const part = reader.u16be();
    entries.push({ x, y, mask, frame, costume, name, part });
  }
  return entries;
}
