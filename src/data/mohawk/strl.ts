/**
 * Ressource `STRL` : nombre de chaînes u8, puis les chaînes terminées par un NUL (Windows-1252 dans Mathémagique, où
 * toutes les chaînes sont en ASCII ; Mac OS Roman dans Zoombinis). Format du moteur Mohawk, partagé par les deux jeux. Le bourrage de fin de ressource est ignoré.
 */
import { decodeMacRoman } from "../mac-roman";
import { decodeText } from "../reader";

/** Lit une `STRL` ; `encoding` désigne la page de code des chaînes (Windows-1252 par défaut). */
export function parseStrl(bytes: Uint8Array, encoding: "windows-1252" | "mac-roman" = "windows-1252"): string[] {
  const decode = encoding === "mac-roman" ? decodeMacRoman : decodeText;
  const count = bytes[0];
  const out: string[] = [];
  let pos = 1;
  while (out.length < count) {
    if (pos >= bytes.length) throw new Error(`STRL : ${out.length} chaînes lues sur ${count}`);
    let end = bytes.indexOf(0, pos);
    if (end === -1) end = bytes.length;
    out.push(decode(bytes.subarray(pos, end)));
    pos = end + 1;
  }
  return out;
}
