/**
 * Fichiers `.REL` : scripts d'objets (relations).
 *
 * Référence : ScummVM engines/cine/rel.cpp (`loadRel`) (GPL v3 ou ultérieure). Format : nombre d'entrées (u16, 255) ; par entrée un en-tête
 * de 8 octets (taille, p1, p2, p3 : u16 chacun) ; puis les corps concaténés. Grand-boutiste. docs/voyageurs/formats.md § 2.7.
 * `p1` à `p3` désignent (type d'action, objet, …) pour la table des relations ; seul le moteur les interprète.
 *
 * Écart volontaire : un fichier tronqué lève une erreur (ScummVM lirait hors du tampon).
 */
import { BinaryReader } from "../../../data/reader";

export interface RelEntry {
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  /** Bytecode ; vide si la taille annoncée est 0. */
  readonly script: Uint8Array;
}

export function readRel(data: Uint8Array): RelEntry[] {
  const reader = new BinaryReader(data);
  const count = reader.u16be();
  if (2 + count * 8 > data.length) throw new RangeError("REL tronqué : en-têtes hors du fichier");
  const headers: { size: number; p1: number; p2: number; p3: number }[] = [];
  for (let i = 0; i < count; i++) headers.push({ size: reader.u16be(), p1: reader.u16be(), p2: reader.u16be(), p3: reader.u16be() });
  return headers.map(({ size, p1, p2, p3 }) => {
    if (reader.offset + size > data.length) throw new RangeError("REL tronqué : script hors du fichier");
    const script = data.slice(reader.offset, reader.offset + size);
    reader.offset += size;
    return { p1, p2, p3, script };
  });
}
