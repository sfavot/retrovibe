/**
 * Ressource `SNDL` : liste des sons d'un écran. Contrairement au reste de l'archive, ses entiers sont
 * little-endian : nombre u16, puis autant d'identifiants `\0SND` u16. Son identifiant est celui de l'écran
 * `\0SCR` correspondant. Le bourrage de fin de ressource est ignoré.
 */
export function parseSndl(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(0, true);
  if (2 + count * 2 > bytes.length) throw new Error("SNDL : liste tronquée");
  return Array.from({ length: count }, (_, i) => view.getUint16(2 + i * 2, true));
}
