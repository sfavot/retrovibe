/** Octets 0x80–0xFF de l'IBM850 (page de code DOS « multilingue latin 1 »), seize caractères par ligne. `TextDecoder` ne gère pas cet encodage. */
const HIGH = [
  "ÇüéâäàåçêëèïîìÄÅ",
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ",
  "áíóúñÑªº¿®¬½¼¡«»",
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐",
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤",
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀",
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´",
  // 0xF0 est le trait d'union conditionnel et 0xFF l'espace insécable : écrits en échappements pour rester visibles.
  "­±‗¾¶§÷¸°¨·¹³²■ ",
].join("");

/** Décode du texte CP850 : 0x00–0x7F en ASCII, 0x80–0xFF d'après la table IBM850 (é = 0x82, è = 0x8A, É = 0x90…). */
export function decodeCp850(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte < 0x80 ? String.fromCharCode(byte) : HIGH[byte - 0x80];
  return out;
}

/** Octet CP850 de chaque caractère (table inverse de `decodeCp850`). */
const REVERSE = (() => {
  const map = new Map<string, number>();
  for (let code = 0; code < 0x100; code++) map.set(decodeCp850(Uint8Array.of(code)), code);
  return map;
})();

/** Encode du texte en CP850 ; un caractère absent de la page de code devient `?`. */
export function encodeCp850(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => REVERSE.get(char) ?? 0x3f);
}
