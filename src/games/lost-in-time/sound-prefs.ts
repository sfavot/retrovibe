import type { HostStorage } from "../../engine/storage";
import { muteAll, SoundPrefs } from "../../ui/sound-prefs";

/**
 * Clé historique de la préférence « Son » : elle s'ajoute au préfixe du stockage (`lost-in-time:`), donc la valeur
 * enregistrée est `lost-in-time:audio.sound`. Gardée telle quelle pour que les choix déjà faits restent lus (le format
 * commun serait `retrovibe:lost-in-time:sound`).
 */
export const SOUND_KEY = "audio.sound";
/** Ancienne clé « Musique » (avant le bouton unique), lue une fois puis supprimée. */
const LEGACY_MUSIC_KEY = "audio.music";

/**
 * Préférence « Son » de Lost in Time : celle de `src/ui/sound-prefs.ts` (activée par défaut, `"0"` = coupé, relecture
 * entre onglets), appliquée à toutes les sorties (effets Web Audio et piste CD, qui porte aussi ambiances et bruitages).
 * Le moteur continue de tourner à l'identique : les scripts interrogent l'état du son et la position du CD.
 * Propre à Lost in Time : la clé historique et la migration de l'ancienne « Musique ».
 */
export function lostInTimeSoundPrefs(store: HostStorage, targets: readonly { muted: boolean }[]): SoundPrefs {
  migrateLegacyMusic(store);
  return new SoundPrefs(store, muteAll(targets), "lost-in-time", { key: SOUND_KEY });
}

/**
 * Migration : une ancienne « Musique » coupée est reprise une fois dans « Son », puis la clé disparaît
 * (le store ignore lui-même les erreurs de stockage).
 */
function migrateLegacyMusic(store: HostStorage): void {
  if (store.get(LEGACY_MUSIC_KEY) === "0") store.set(SOUND_KEY, "0");
  store.remove(LEGACY_MUSIC_KEY);
}
