/** Octets 0x80–0xFF de l'IBM437 (page de code DOS américaine), seize caractères par ligne. `TextDecoder` ne gère pas cet encodage. */
const HIGH = [
  "ÇüéâäàåçêëèïîìÄÅ",
  "ÉæÆôöòûùÿÖÜ¢£¥₧ƒ",
  "áíóúñÑªº¿⌐¬½¼¡«»",
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐",
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧",
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀",
  "αßΓπΣσµτΦΘΩδ∞φε∩",
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ",
].join("");

/** Décode du texte CP437 : 0x00–0x7F en ASCII, 0x80–0xFF d'après la table IBM437 (é = 0x82, à = 0x85, ç = 0x87…). */
export function decodeCp437(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte < 0x80 ? String.fromCharCode(byte) : HIGH[byte - 0x80];
  return out;
}
