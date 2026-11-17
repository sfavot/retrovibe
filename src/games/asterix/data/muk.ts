/**
 * Structure des animations `.MUK` d'Astérix, telle que la lit `19b9:000c` (voir `docs/asterix/formats.md`).
 *
 * Pas d'en-tête : une suite d'enregistrements commençant par un octet de type.
 *  - 0 : une valeur u16 (rangée en `DS:6425` ; absent des 31 fichiers du CD, rôle inconnu) ;
 *  - 1 : une palette de 768 octets, appliquée aussitôt ;
 *  - 2 : `u32 taille`, `u32` de rôle inconnu (lu puis ignoré), puis un bloc vidéo MUX de `taille` octets, décodé par la
 *        même routine que les images des MUX (`2b17:0119`).
 *
 * Les MUK ne sont pas versionnés tels quels : `scripts/asterix-extract.sh` les convertit en conteneurs `.vid`
 * (`video.ts`), qui gardent les palettes, les valeurs de type 0 et le second champ. Ce lecteur ne décode pas les images :
 * il découpe le fichier d'origine en enregistrements.
 */

const PALETTE_BYTES = 768;

export type MukRecord =
  | { type: "value"; value: number }
  | { type: "palette"; palette: Uint8Array }
  | {
      type: "video";
      /** Second champ de l'enregistrement (rôle inconnu). */
      field: number;
      /** Bloc vidéo MUX, en-tête de 13 octets compris (vue sur le fichier). */
      payload: Uint8Array;
    };

/** Découpe un `.MUK` en enregistrements, jusqu'au dernier octet. */
export function parseMuk(bytes: Uint8Array): MukRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: MukRecord[] = [];
  let pos = 0;
  const need = (count: number, what: string) => {
    if (pos + count > bytes.length) throw new Error(`MUK : ${what} tronqué à l'offset ${pos}`);
  };
  while (pos < bytes.length) {
    const type = bytes[pos++];
    if (type === 0) {
      need(2, "enregistrement 0");
      records.push({ type: "value", value: view.getUint16(pos, true) });
      pos += 2;
    } else if (type === 1) {
      need(PALETTE_BYTES, "palette");
      records.push({ type: "palette", palette: bytes.subarray(pos, pos + PALETTE_BYTES) });
      pos += PALETTE_BYTES;
    } else if (type === 2) {
      need(8, "enregistrement 2");
      const size = view.getUint32(pos, true);
      const field = view.getUint32(pos + 4, true);
      pos += 8;
      need(size, "bloc vidéo");
      records.push({ type: "video", field, payload: bytes.subarray(pos, pos + size) });
      pos += size;
    } else {
      throw new Error(`MUK : enregistrement de type ${type} inconnu à l'offset ${pos - 1}`);
    }
  }
  return records;
}
