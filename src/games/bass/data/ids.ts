/**
 * Identifiants de fichiers de `sky.dsk` et de compacts connus à ce stade.
 *
 * Références : ScummVM engines/sky/sound.cpp (voix, effets), text.cpp (textes, polices), grid.cpp, music/adlibmusic.cpp, control.cpp,
 * compact.h, skydefs.h (GPL v3 ou ultérieure) ; synthèse dans `docs/bass/formats.md`. Un identifiant de fichier est un `u16`
 * (`section << 11 | rang` pour les fichiers de décor, valeurs fixes au-delà de 50 000).
 */

/** Voix : fichier = `SPEECH_BASE + SPEECH_SECTION_BASE[section] + rang` (retirées de `sky.dsk` dans la version versionnée, voir `files.md`). */
export const SPEECH_BASE = 50000;
export const SPEECH_SECTION_BASE = [0, 600, 1100, 2430, 3380, 4530, 5080, 5230] as const;
export const SPEECH_FIRST = 50000;
export const SPEECH_LAST = 55277;

/** Introduction du CD (images, palettes, voix du narrateur) : reste dans `sky.dsk`. */
export const INTRO_FIRST = 59494;
export const INTRO_LAST = 59672;

/** Grilles de collision : 70 fichiers de 120 octets. */
export const GRID_FIRST = 60000;
export const GRID_LAST = 60069;

/** Polices (`text.cpp`). */
export const FONT_MAIN = 60150;
export const FONT_CONTROL_PANEL = 60520;
export const FONT_LINK = 60521;

/** Musique AdLib : pilote et données de la section `s` (0 à 6) = `60202 + 4 * s` ; effets sonores = `60203 + 4 * s`. */
export const MUSIC_FILE_BASE = 60202;
export const SFX_FILE_BASE = 60203;
export const FILES_PER_SECTION = 4;
export const SECTION_COUNT = 7;

export function musicFile(section: number): number {
  checkSection(section);
  return MUSIC_FILE_BASE + FILES_PER_SECTION * section;
}

export function sfxFile(section: number): number {
  checkSection(section);
  return SFX_FILE_BASE + FILES_PER_SECTION * section;
}

function checkSection(section: number): void {
  if (!Number.isInteger(section) || section < 0 || section >= SECTION_COUNT) throw new RangeError(`section ${section} hors de 0 à ${SECTION_COUNT - 1}`);
}

/** Curseurs. */
export const CURSOR_FIRST = 60300;
export const CURSOR_LAST = 60302;

/** Panneau de contrôle : 60500 à 60510 (la palette est le dernier). */
export const CONTROL_PANEL_FIRST = 60500;
export const CONTROL_PANEL_LAST = 60510;
export const CONTROL_PANEL_PALETTE = 60510;

/** Textes : fichier = `TEXT_BASE + 8 * langue + section` (section 0 à 7, la 7 contient l'interface). */
export const TEXT_BASE = 60600;
export const TEXT_SECTIONS = 8;

/** Langues de `SkyEngine` (ordre de `text.cpp`) ; le portage vise le français. */
export const Language = {
  english: 0,
  german: 1,
  french: 2,
  englishUs: 3,
  swedish: 4,
  italian: 5,
  portuguese: 6,
  spanish: 7,
} as const;
export const LANGUAGE_FRENCH = Language.french;

export function textFile(language: number, section: number): number {
  if (!Number.isInteger(language) || language < 0 || language > Language.spanish) throw new RangeError(`langue ${language} invalide`);
  if (!Number.isInteger(section) || section < 0 || section >= TEXT_SECTIONS) throw new RangeError(`section de texte ${section} invalide`);
  return TEXT_BASE + TEXT_SECTIONS * language + section;
}

/** Identifiant du fichier de voix d'un numéro de texte (`section` 0 à 7, `rang` dans la section). */
export function speechFile(section: number, index: number): number {
  const base = SPEECH_SECTION_BASE[section];
  if (base === undefined || !Number.isInteger(index) || index < 0) throw new RangeError(`voix ${section}/${index} invalide`);
  return SPEECH_BASE + base + index;
}

/** Fichier de grille de la grille `grid` (0 à 69). */
export function gridFile(grid: number): number {
  if (!Number.isInteger(grid) || grid < 0 || grid > GRID_LAST - GRID_FIRST) throw new RangeError(`grille ${grid} invalide`);
  return GRID_FIRST + grid;
}
