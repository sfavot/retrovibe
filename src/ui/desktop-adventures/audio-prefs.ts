import { soundPrefKey, type SoundPrefsStorage } from "../sound-prefs";
import { storage } from "./storage";

/** Clé de la préférence « Musique » d'un jeu : même convention que « Son » (`"0"` = coupé, absent = activé). */
export const musicPrefKey = (game: string) => `retrovibe:${game}:music`;

export type AudioPrefs = ReturnType<typeof audioPrefs>;

/** Préférences « Son » (effets) et « Musique » d'un jeu, mémorisées localement. Le stockage peut être indisponible : on échoue sans bruit. */
export function audioPrefs(game: string, store: SoundPrefsStorage = storage) {
  const read = (key: string) => store.get(key) !== "0";
  const write = (key: string, on: boolean) => void store.set(key, on ? "1" : "0");
  return {
    readSound: () => read(soundPrefKey(game)),
    readMusic: () => read(musicPrefKey(game)),
    writeSound: (on: boolean) => write(soundPrefKey(game), on),
    writeMusic: (on: boolean) => write(musicPrefKey(game), on),
  };
}
