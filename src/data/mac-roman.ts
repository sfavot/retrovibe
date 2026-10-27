/** Octets 0x80–0xFF de Mac OS Roman, seize caractères par ligne. `TextDecoder` ne gère pas cet encodage. */
const HIGH = [
  "ÄÅÇÉÑÖÜáàâäãåçéè",
  "êëíìîïñóòôöõúùûü",
  "†°¢£§•¶ß®©™´¨≠ÆØ",
  "∞±≤≥¥µ∂∑∏π∫ªºΩæø",
  "¿¡¬√ƒ≈∆«»…\u00A0ÀÃÕŒœ",
  "–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ",
  "‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ",
  "ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ",
].join("");

/** Décode du texte Mac OS Roman : 0x00–0x7F en ASCII (`\r` reste `\r`), 0x80–0xFF d'après la table (é = 0x8E, à = 0x88, © = 0xA9…). */
export function decodeMacRoman(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte < 0x80 ? String.fromCharCode(byte) : HIGH[byte - 0x80];
  return out;
}
