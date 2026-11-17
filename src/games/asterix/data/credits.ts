import { decodeCp850 } from "../../../data/cp850";

/**
 * Générique d'Astérix (`MDF/47/M47.DAT` ; voir `docs/asterix/formats.md`).
 *
 * Texte CP850, lignes terminées par CR LF. Une ligne peut commencer par une balise `@1`, `@2` ou `@3`, qui choisit sa
 * présentation (rôle exact à établir par le désassemblage du module 47) ; les lignes vides espacent les blocs.
 */

export interface CreditsLine {
  /** Chiffre de la balise `@N` en tête de ligne, 0 s'il n'y en a pas. */
  style: number;
  text: string;
}

const DOS_EOF = 0x1a;
const TAG = /^@(\d)/;

/** Lit le générique, ligne par ligne (lignes vides comprises). */
export function parseCredits(bytes: Uint8Array): CreditsLine[] {
  let end = bytes.length;
  if (end > 0 && bytes[end - 1] === DOS_EOF) end--;
  const lines = decodeCp850(bytes.subarray(0, end)).split("\r\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => {
    const tag = TAG.exec(line);
    return tag ? { style: Number(tag[1]), text: line.slice(2) } : { style: 0, text: line };
  });
}
