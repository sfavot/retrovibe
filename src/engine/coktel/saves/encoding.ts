/**
 * Encodage commun des sauvegardes Coktel : le stockage clé / valeur du navigateur ne contient que du texte,
 * les octets y sont donc en base64, et les emplacements ont la même clé dans tous les jeux.
 */

/** Octets en base64 (par tranches : `String.fromCharCode(...)` plafonne le nombre d'arguments). */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Base64 en octets ; lève une exception si le texte n'est pas du base64. */
export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Clé de stockage d'un emplacement de sauvegarde (`cat.s00`…). */
export function slotKey(slot: number): string {
  return `cat.s${String(slot).padStart(2, "0")}`;
}
