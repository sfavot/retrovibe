/**
 * Jeu de caractères des textes français : codes du jeu vers Unicode.
 *
 * Mesuré (pas dans ScummVM, qui garde les octets tels quels) : la police 60150 n'a pas de glyphes accentués aux codes habituels ; les
 * lettres accentuées détournent des caractères ASCII. Chaque correspondance a été établie en dessinant le glyphe de la police
 * (`SkyFont.ascii`) et confirmée par des mots connus (« Temp+rature », « =tre s>r », « /a », « ^a SUFFIT », « O SUIS-JE ? »…).
 * Les codes de 0x20 à 0x7E qui ne sont pas listés ici sont de l'ASCII ordinaire.
 *
 * Limites : la table vise les textes français (langue 2). Les autres langues détournent d'autres codes (le `#` de l'allemand dessine un
 * `ü`, par exemple) ; dans les chaînes brouillées de l'écran piraté, le `#` reste donc un `#`. Le code 9 (tabulation) ne dessine rien et
 * arrête l'affichage (`displayText` s'arrête au premier code inférieur à 0x20) : il termine des textes anglais laissés dans les fichiers.
 */

/** Codes détournés, avec le glyphe constaté dans la police 60150. */
const FRENCH_DIVERTED: Readonly<Record<number, string>> = {
  0x2b: "é", // + : e accent aigu
  0x2f: "ç", // / : c cédille
  0x3d: "ê", // = : e circonflexe
  0x3e: "û", // > : u circonflexe
  0x40: "ô", // @ : o circonflexe
  0x5b: "â", // [ : a circonflexe
  0x5d: "è", // ] : e accent grave
  0x5e: "Ç", // ^ : C cédille (« ^a SUFFIT ! »)
  0x5f: "î", // _ : i circonflexe (« Contrema_tre », « bo_te », « s'il vous pla_t » ; relevé en vague K)
  0x60: "‘", // ` : guillemet simple ouvrant (« `Reich.' », fermé par l'apostrophe 0x27)
  0x7b: "ï", // { : i tréma
  0x80: "<", // flèche gauche des curseurs de l'interface
  0x81: ">", // flèche droite
  0x82: "/", // barre oblique (le 0x2f étant pris par le ç)
  0x91: "à", // a accent grave
  0x92: "Ù", // U accent grave (« OÙ SUIS-JE ? »)
};

/** Codes de 0x20 à 0xFF que le français détourne : ceux que la table traduit. */
export const FRENCH_DIVERTED_CODES: readonly number[] = Object.keys(FRENCH_DIVERTED).map(Number);

/** Caractère Unicode d'un code des textes français ; les codes non détournés gardent leur valeur (ASCII). */
export function gameCharToUnicode(code: number): string {
  return FRENCH_DIVERTED[code] ?? String.fromCharCode(code);
}

/** Convertit une chaîne de codes du jeu (un code par caractère, comme la rend `SkyTexts.getText`) en texte lisible. */
export function toUnicode(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += gameCharToUnicode(text.charCodeAt(i));
  return out;
}
