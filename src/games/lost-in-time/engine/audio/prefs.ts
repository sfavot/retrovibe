import { SoundPrefs, type Muteable } from "../../../../ui/sound-prefs";
import type { KeyValueStore } from "../saves";

/** Sortie audio que l'on peut couper sans toucher à l'état du moteur (position, lecture en cours). */
export interface Mutable {
  muted: boolean;
}

/**
 * Clé historique de la préférence « Son » : elle s'ajoute au préfixe du stockage (`lost-in-time:`), donc la valeur
 * enregistrée est `lost-in-time:audio.sound`. Gardée telle quelle pour que les choix déjà faits restent lus (le format
 * commun serait `retrovibe:lost-in-time:sound`).
 */
export const SOUND_KEY = "audio.sound";
/** Ancienne clé « Musique » (avant le bouton unique), lue une fois puis supprimée. */
const LEGACY_MUSIC_KEY = "audio.music";

/**
 * Préférence « Son » : persistée, et appliquée en coupant toutes les sorties (effets Web Audio et
 * piste CD, qui porte aussi ambiances et bruitages). Le moteur continue de tourner à l'identique :
 * les scripts interrogent l'état du son et la position du CD.
 *
 * La logique (valeur par défaut, `"0"` = coupé, relecture entre onglets) est celle de `src/ui/sound-prefs.ts` ; ici
 * restent la clé historique et la migration de l'ancienne « Musique ».
 */
export class AudioPrefs {
  private readonly prefs: SoundPrefs;

  constructor(store: KeyValueStore, targets: readonly Mutable[]) {
    migrateLegacyMusic(store);
    const output: Muteable = {
      setMuted(muted) {
        for (const target of targets) target.muted = muted;
      },
    };
    this.prefs = new SoundPrefs(store, output, "lost-in-time", { key: SOUND_KEY });
  }

  /**
   * Relit la préférence depuis le stockage (autre onglet qui l'a changée) ; retourne vrai si elle a changé.
   * Sans cela, un onglet garde son ancienne valeur et la réécrit au prochain clic.
   */
  reload(): boolean {
    return this.prefs.reload();
  }

  isEnabled(): boolean {
    return this.prefs.isEnabled();
  }

  set(on: boolean): void {
    this.prefs.set(on);
  }

  toggle(): boolean {
    return this.prefs.toggle();
  }
}

/**
 * Migration : une ancienne « Musique » coupée est reprise une fois dans « Son », puis la clé disparaît
 * (le store ignore lui-même les erreurs de stockage).
 */
function migrateLegacyMusic(store: KeyValueStore): void {
  if (store.get(LEGACY_MUSIC_KEY) === "0") store.set(SOUND_KEY, "0");
  store.remove(LEGACY_MUSIC_KEY);
}
