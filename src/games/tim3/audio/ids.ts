/**
 * Identifiants sonores de TIM3 (`docs/tim3/audio.md`). Le jeu désigne tout son par un numéro (`PlaySound(id, priorité, drapeaux)`,
 * `41126d` dans `TIMWIN.EXE`) ; la classe vient de `id / 1000` (`411b0c`) :
 * - 1000 à 1999 : musique, fichier `SX_%04d.HMI` ;
 * - 2000 à 2999 : piste CD audio (MCI), repli sur un morceau HMI. L'ISO n'a pas de piste CD, et les numéros de musique des puzzles sont tous
 *   en 1000 à 1023 : cette classe n'est pas portée ;
 * - 3000 à 3999 (et au-delà jusqu'à 9999) : effet, fichier `SX_%04d.WAV` ;
 * - 4000 à 4499 PROFESOR.VOC, 4500 à 4999 HELP.VOC, 5000 et suivants GOALS.VOC puis HINT1 à 8.VOC (par tranches de 500, entrée `id % 500`) :
 *   voix, lues par flux (`4247c0`). Le port les désigne par `VoiceRef` plutôt que par ce numéro.
 */

/** Plus petit et plus grand numéro de musique des puzzles (`SX_1000.HMI` à `SX_1023.HMI`). */
export const FIRST_MUSIC = 1000;
export const LAST_MUSIC = 1023;

/** Les numéros d'effet inférieurs à 92 sont des sons d'ambiance : `3800 + n`, joués en boucle, sans relance (drapeaux 7). */
export const AMBIENT_SOUND_LIMIT = 92;
export const AMBIENT_SOUND_BASE = 3800;

/** Drapeaux de `PlaySound` pour un effet (`41126d`). */
export const SOUND_NO_RESTART = 1;
export const SOUND_LOOP = 2;
/** Cherche d'abord un son de même numéro déjà en cours : le rejoue (sans le drapeau 1) ou laisse le premier (avec). */
export const SOUND_UNIQUE = 4;

/** Nombre d'effets simultanés du jeu : 16 emplacements (`449ea0`, `41126d`). */
export const EFFECT_VOICES = 16;

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

export function musicFileName(music: number): string {
  return `SX_${pad4(music)}.HMI`;
}

export function effectFileName(id: number): string {
  return `SX_${pad4(id)}.WAV`;
}

export function isMusicNumber(music: number): boolean {
  return Number.isInteger(music) && music >= FIRST_MUSIC && music <= LAST_MUSIC;
}

/** Numéro et drapeaux d'un effet tels que le jeu les applique : les ambiances (`id < 92`) deviennent `3800 + id` avec les drapeaux 7. */
export function normalizeEffect(id: number, flags: number): { id: number; flags: number } {
  if (id >= 0 && id < AMBIENT_SOUND_LIMIT) return { id: id + AMBIENT_SOUND_BASE, flags: flags | 7 };
  return { id, flags };
}

export const VOICE_ARCHIVES = ["goals", "hint1", "hint2", "hint3", "hint4", "hint5", "hint6", "hint7", "help", "profesor"] as const;
export type VoiceArchive = (typeof VOICE_ARCHIVES)[number];

/** Une réplique : archive d'origine et index de l'entrée (celui du fichier `voices/<archive>/<index sur 3 chiffres>.mp3`). */
export interface VoiceRef {
  readonly archive: VoiceArchive;
  readonly index: number;
}

/** Clé d'une voix pour `SoundFiles` : `goals/017`. L'hôte la traduit en `voices/goals/017.mp3`. */
export function voiceKey(ref: VoiceRef): string {
  return `${ref.archive}/${String(ref.index).padStart(3, "0")}`;
}

/** Voix du but d'un puzzle (`puzzle` = index de `LEVELS.INF`, 0 à 205). */
export function goalVoice(puzzle: number): VoiceRef {
  return { archive: "goals", index: puzzle };
}

/** Voix de l'indice `hint` (1 à 7) d'un puzzle ; `HINT8.VOC` n'existe pas : `null`. */
export function hintVoice(hint: number, puzzle: number): VoiceRef | null {
  if (!Number.isInteger(hint) || hint < 1 || hint > 7) return null;
  return { archive: `hint${hint}` as VoiceArchive, index: puzzle };
}

/** Voix de l'aide (`HELP.VOC`, index de `HELP.RES`, 0 à 187) et du professeur (`PROFESOR.VOC`, 0 à 33). */
export function helpVoice(index: number): VoiceRef {
  return { archive: "help", index };
}

export function professorVoice(index: number): VoiceRef {
  return { archive: "profesor", index };
}
