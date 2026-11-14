/**
 * Voix : numéro de texte → identifiant de fichier de voix → chemin du MP3 versionné.
 *
 * Référence : ScummVM engines/sky/sound.cpp (`Sound::_speechConvertTable`, `Sound::startSpeech`), GPL v3 ou ultérieure.
 * La table de conversion (8 valeurs) est `SPEECH_SECTION_BASE` de `ids.ts`, déjà vérifiée contre `sky.dnr` ; pas de copie ici.
 *
 * Écart : ScummVM indexe la table avec `textNum >> 12` sans borne (une section de 8 à 15 lit hors table) ; ici ces numéros n'ont pas de voix.
 */

import { SPEECH_BASE, SPEECH_SECTION_BASE, speechFile } from "./ids";

/** Section d'un numéro de texte (`textNum >> 12`) et rang dans la section (`textNum & 0xFFF`). */
export function splitTextNumber(textNum: number): { section: number; index: number } {
  return { section: (textNum >> 12) & 0xf, index: textNum & 0xfff };
}

/** Identifiant (50000 à 55277) du fichier de voix d'un numéro de texte, ou `undefined` si la section n'existe pas (8 à 15). */
export function speechFileOfText(textNum: number): number | undefined {
  const { section, index } = splitTextNumber(textNum);
  if (section >= SPEECH_SECTION_BASE.length) return undefined;
  return speechFile(section, index);
}

/** Chemin du MP3 d'un identifiant de voix, relatif à la racine des données du jeu. */
export function voicePath(fileId: number): string {
  if (!Number.isInteger(fileId) || fileId < SPEECH_BASE) throw new RangeError(`identifiant de voix ${fileId} invalide`);
  return `voices/${fileId}.mp3`;
}

/** Chemin du MP3 d'un numéro de texte, ou `undefined` si la section n'existe pas (le fichier peut ne pas exister : ~1 700 répliques sans voix). */
export function voicePathOfText(textNum: number): string | undefined {
  const id = speechFileOfText(textNum);
  return id === undefined ? undefined : voicePath(id);
}
