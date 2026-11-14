/**
 * Fichier généré, ne pas modifier : `python3 -I scripts/bass/gen-tables.py <scummvm>/engines/sky <sortie>`.
 * Source : ScummVM engines/sky/sound.cpp (v2026.4.0, GPL v3 ou ultérieure). Table `_speechConvertTable`.
 */

/** Numéro de texte (section `n >> 12`) vers numéro de fichier de voix : `SPEECH_CONVERT[section] + (n & 0xFFF)` (hors base 50 000). */
export const SPEECH_CONVERT: readonly number[] = [0, 600, 1100, 2430, 3380, 4530, 5080, 5230];
