/**
 * Tables statiques du moteur de Croisière pour un cadavre, regroupées par section.
 *
 * Référence : `engines/cruise/staticres.cpp` de ScummVM (GPL v3+). Les nombres viennent du binaire d'origine (via ScummVM) : ils sont
 * recopiés ici sous forme compacte, jamais dérivés d'une autre source. D'autres vagues ajoutent leurs sections à la suite.
 *
 * Écart volontaire : seule la langue française existe dans ce port ; `staticres.h::fontCharacterTable` choisit la table anglaise pour
 * toutes les langues hors allemand, espagnol et russe, donc c'est elle que le français utilise (docs/croisiere/formats.md § 3.4 et 5).
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Police : octet du texte -> numéro de glyphe de `SYSTEM.FNT` (`english_fontCharacterTable`, 256 entrées de type int16)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Valeur de la table pour un octet sans glyphe : ni dessiné ni avancé (`charData < 0`). */
export const NO_GLYPH = -1;

/** Premier octet ASCII mappé (`!`) ; il prend le glyphe 0, puis les glyphes se suivent jusqu'à `FONT_ASCII_LAST` (`}`, glyphe 92). */
export const FONT_ASCII_FIRST = 0x21;
export const FONT_ASCII_LAST = 0x7d;

/** Octets Latin-1 / Windows-1252 accentués et leur glyphe (hors majuscules `À É È Ç Œ`, absentes de la police). */
const ACCENTED_GLYPHS: ReadonlyArray<readonly [byte: number, glyph: number]> = [
  [0xe0, 93], // à
  [0xe4, 94], // ä
  [0xe9, 95], // é
  [0xe8, 96], // è
  [0xea, 97], // ê
  [0xeb, 98], // ë
  [0xee, 99], // î
  [0xef, 100], // ï
  [0xf4, 101], // ô
  [0xf6, 102], // ö
  [0xf9, 103], // ù
  [0xfb, 104], // û
  [0xc5, 105], // Å
  [0xc4, 106], // Ä
  [0xca, 107], // Ê
  [0xcb, 108], // Ë
  [0xce, 109], // Î
  [0xcf, 110], // Ï
  [0xd6, 111], // Ö
  [0xd8, 112], // Ø
  [0xdb, 113], // Û
  [0xdc, 114], // Ü
  [0xe7, 115], // ç
  [0xdf, 116], // ß
  [0xe6, 117], // æ
  [0xe2, 118], // â
];

/** Glyphe de chaque octet (0..255), `NO_GLYPH` s'il n'y en a pas. L'espace (0x20) n'a pas de glyphe : le moteur lui donne une avance fixe. */
export const FONT_CHARACTER_TABLE: Readonly<Int16Array> = (() => {
  const table = new Int16Array(256).fill(NO_GLYPH);
  for (let byte = FONT_ASCII_FIRST; byte <= FONT_ASCII_LAST; byte++) table[byte] = byte - FONT_ASCII_FIRST;
  for (const [byte, glyph] of ACCENTED_GLYPHS) table[byte] = glyph;
  return table;
})();
