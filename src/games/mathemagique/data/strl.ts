/**
 * Ressource `STRL` : nombre de chaînes u8, puis les chaînes terminées par un NUL (Windows-1252 ;
 * toutes les chaînes du jeu sont en ASCII). Le bourrage de fin de ressource est ignoré.
 */
import { decodeText } from "../../../data/reader";

export function parseStrl(bytes: Uint8Array): string[] {
  const count = bytes[0];
  const out: string[] = [];
  let pos = 1;
  while (out.length < count) {
    if (pos >= bytes.length) throw new Error(`STRL : ${out.length} chaînes lues sur ${count}`);
    let end = bytes.indexOf(0, pos);
    if (end === -1) end = bytes.length;
    out.push(decodeText(bytes.subarray(pos, end)));
    pos = end + 1;
  }
  return out;
}
