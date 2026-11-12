/**
 * Jeu de caractères du jeu : codes des textes et de la police vers Unicode.
 *
 * Mesuré (pas dans ScummVM, qui garde les octets tels quels) : les codes `0x20` à `0x7D` sont de l'ASCII (la police de `DISK1.VGA`, ressource 4,
 * dessine les glyphes habituels) ; `0x7E` à `0x92` sont des lettres accentuées, identifiées par la forme des glyphes et par des mots connus
 * (« Ch<0x80>teau », « Salle <0x81> manger », « Ext<0x7F>rieure », « Ce<0x82>ant »…). `0x8B` est la coche qui suit « Texte rapide » et
 * « Texte lent » (`frenchTextStrings`).
 */

const EXTENDED: Readonly<Record<number, string>> = {
  0x7e: "Ç",
  0x7f: "é",
  0x80: "â",
  0x81: "à",
  0x82: "ç",
  0x83: "ê",
  0x84: "ë",
  0x85: "è",
  0x86: "ï",
  0x87: "î",
  0x88: "ô",
  0x89: "û",
  0x8a: "ù",
  0x8b: "✓",
  0x8c: "ü",
  0x8d: "ä",
  0x8e: "Ä",
  0x8f: "ö",
  0x90: "Ö",
  0x91: "Ü",
  0x92: "ß",
};

/** Caractère Unicode d'un code du jeu (les codes sans correspondance gardent leur valeur). */
export function gameCharToUnicode(code: number): string {
  return EXTENDED[code] ?? String.fromCharCode(code);
}

/** Convertit une chaîne de codes du jeu (un code par caractère, comme la rend `composeText`). */
export function gameTextToUnicode(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += gameCharToUnicode(text.charCodeAt(i));
  return out;
}

/** Codes qui ne sont pas de l'ASCII imprimable (`0x7E` à `0x92`) : ceux que la table ci-dessus traduit. */
export const EXTENDED_CODES: readonly number[] = Object.keys(EXTENDED).map(Number);
