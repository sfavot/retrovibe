/**
 * Vocabulaires SCI2 (`docs/gk1/formats.md` § 8) : noms des sélecteurs (997), table des classes (996), noms des opcodes (998),
 * indices des propriétés que l'interpréteur lit directement (994).
 *
 * Référence : `engines/sci/engine/kernel.cpp` (`Kernel::loadSelectorNames`), `seg_manager.cpp` (`SegManager::createClassTable`)
 * et `script.cpp` (`Kernel::loadOpcodes`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - 997 : `u16 nombre − 1 | u16 offset[] | { u16 longueur ; caractères }`.
 * - 996 : entrées de 4 octets `u16 0 (rempli au chargement) | u16 numéro de script`, indexées par numéro de classe.
 * - 998 : `u16 nombre | u16 offset[] | { u16 longueur ; u16 type ; nom }` (la longueur compte le type).
 * - 994 : suite de `u16`.
 *
 * Écart volontaire : ScummVM ne lit pas le vocabulaire 994 (il retrouve ces sélecteurs par leur nom).
 */
import { BinaryReader } from "../../../data/reader";

const CLASS_ENTRY_SIZE = 4;

/** Noms des sélecteurs ; l'indice est le numéro du sélecteur. */
export function readSelectorNames(data: Uint8Array): string[] {
  const r = new BinaryReader(data);
  const count = r.u16() + 1;
  if (2 + 2 * count > data.length) throw new Error("GK1 : vocabulaire des sélecteurs tronqué");
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    r.offset = 2 + 2 * i;
    r.offset = r.u16();
    const length = r.u16();
    if (r.offset + length > data.length) throw new Error("GK1 : nom de sélecteur hors du vocabulaire");
    names.push(r.string(length));
  }
  return names;
}

/** Numéro du script qui définit chaque classe ; l'indice est le numéro de classe (« espèce »). */
export function readClassTable(data: Uint8Array): number[] {
  if (data.length % CLASS_ENTRY_SIZE !== 0) throw new Error("GK1 : table des classes de taille inattendue");
  const r = new BinaryReader(data);
  const scripts: number[] = [];
  while (!r.isAtEnd) {
    r.u16();
    scripts.push(r.u16());
  }
  return scripts;
}

export interface OpcodeName {
  /** Type d'opérandes selon le débogueur d'origine. */
  readonly type: number;
  readonly name: string;
}

/** Noms des opcodes ; l'indice est le numéro d'opcode (octet de code >> 1). */
export function readOpcodeNames(data: Uint8Array): OpcodeName[] {
  const r = new BinaryReader(data);
  const count = r.u16();
  if (2 + 2 * count > data.length) throw new Error("GK1 : vocabulaire des opcodes tronqué");
  const out: OpcodeName[] = [];
  for (let i = 0; i < count; i++) {
    r.offset = 2 + 2 * i;
    r.offset = r.u16();
    const length = r.u16();
    if (length < 2 || r.offset + length > data.length) throw new Error("GK1 : nom d'opcode hors du vocabulaire");
    const type = r.u16();
    out.push({ type, name: r.string(length - 2) });
  }
  return out;
}

/** Vocabulaire 994 : mots de 16 bits, dans l'ordre fixé par l'interpréteur. */
export function readPropertyOffsets(data: Uint8Array): number[] {
  if (data.length % 2 !== 0) throw new Error("GK1 : vocabulaire 994 de taille impaire");
  const r = new BinaryReader(data);
  const out: number[] = [];
  while (!r.isAtEnd) out.push(r.u16());
  return out;
}
