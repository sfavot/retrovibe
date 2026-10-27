import { soundPrefKey, type SoundPrefsStorage } from "../../../ui/sound-prefs";
import { storage } from "./storage";

/** Clé de la préférence « Musique » : même convention que « Son » (`"0"` = coupé, absent = activé). */
export const MUSIC_PREF_KEY = "retrovibe:indy:music";

/** Préférences « Son » (effets) et « Musique », mémorisées localement. Le stockage peut être indisponible : on échoue sans bruit. */
export function audioPrefs(store: SoundPrefsStorage = storage) {
  const read = (key: string) => store.get(key) !== "0";
  const write = (key: string, on: boolean) => void store.set(key, on ? "1" : "0");
  return {
    readSound: () => read(soundPrefKey("indy")),
    readMusic: () => read(MUSIC_PREF_KEY),
    writeSound: (on: boolean) => write(soundPrefKey("indy"), on),
    writeMusic: (on: boolean) => write(MUSIC_PREF_KEY, on),
  };
}

export const indyAudioPrefs = audioPrefs();
