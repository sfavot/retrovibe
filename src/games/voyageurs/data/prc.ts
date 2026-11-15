/**
 * Fichiers `.PRC` : table de scripts globaux (bytecode).
 *
 * Référence : ScummVM engines/cine/prc.cpp (`loadPrc`) et script.h (`NUM_MAX_SCRIPT`) (GPL v3 ou ultérieure). Format : nombre de scripts
 * (u16, 50), puis leurs tailles (u16 chacune, 0 = absent), puis les scripts concaténés. Grand-boutiste.
 * docs/voyageurs/formats.md § 2.6.
 *
 * Écarts volontaires : seule la structure est lue (le bytecode est interprété par le moteur) ; un fichier tronqué lève une erreur ;
 * la protection anti-copie (`L201.ANI` comme nom de PRC, qui quitte vers le lanceur) est laissée à l'appelant : `COPY_PROT_FAIL_PRC_NAME`.
 */
import { BinaryReader } from "../../../data/reader";

export const NUM_MAX_SCRIPT = 50;
/** Faux nom de PRC chargé par le jeu quand la protection échoue (`cine.h`). */
export const COPY_PROT_FAIL_PRC_NAME = "L201.ANI";

export interface Prc {
  /** Un élément par script ; vide quand la taille annoncée est 0. */
  readonly scripts: readonly Uint8Array[];
}

export function readPrc(data: Uint8Array): Prc {
  const reader = new BinaryReader(data);
  const count = reader.u16be();
  if (count > NUM_MAX_SCRIPT) throw new RangeError(`PRC : ${count} scripts, ${NUM_MAX_SCRIPT} au plus`);
  if (2 + count * 2 > data.length) throw new RangeError("PRC tronqué : table des tailles hors du fichier");
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) sizes.push(reader.u16be());
  const scripts: Uint8Array[] = [];
  for (const size of sizes) {
    if (reader.offset + size > data.length) throw new RangeError("PRC tronqué : script hors du fichier");
    scripts.push(data.slice(reader.offset, reader.offset + size));
    reader.offset += size;
  }
  return { scripts };
}
