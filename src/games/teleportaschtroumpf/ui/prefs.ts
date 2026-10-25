import type { HostStorage } from "../engine/host";
import {
  SoundPrefs as SharedSoundPrefs,
  soundPrefKey,
  type Muteable,
} from "../../../ui/sound-prefs";

export type { Muteable };

/** Clé de la préférence « Son » (même préfixe que les options parents, `engine/options.ts`). */
export const SOUND_KEY = soundPrefKey("teleportaschtroumpf");

/**
 * Préférence « Son » du Téléportaschtroumpf : implémentation partagée (`src/ui/sound-prefs.ts`) liée au jeu.
 * Signature conservée pour les appelants (`ui/app.ts`, tests).
 */
export class SoundPrefs extends SharedSoundPrefs {
  constructor(storage: HostStorage, target: Muteable) {
    super(storage, target, "teleportaschtroumpf");
  }
}
