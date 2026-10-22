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

/** Octet CP437 de chaque caractère (table inverse de `decodeCp437`). */
const REVERSE = (() => {
  const map = new Map<string, number>();
  for (let code = 0; code < 0x100; code++) map.set(decodeCp437(Uint8Array.of(code)), code);
  return map;
})();

/** Encode du texte en CP437 (la police PFN attend ces octets) ; un caractère absent de la page de code devient `?`. */
export function encodeCp437(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => REVERSE.get(char) ?? 0x3f);
}
