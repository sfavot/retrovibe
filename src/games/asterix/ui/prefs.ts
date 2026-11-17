import type { HostStorage } from "../../../engine/infogrames/host";
import { SoundPrefs as SharedSoundPrefs, soundPrefKey, type Muteable } from "../../../ui/sound-prefs";

/** Clé de la préférence « Son » : `retrovibe:asterix:sound`. */
export const SOUND_KEY = soundPrefKey("asterix");

/** Préférence « Son » d'Astérix : implémentation partagée (`src/ui/sound-prefs.ts`) liée au jeu. */
export class SoundPrefs extends SharedSoundPrefs {
  constructor(storage: HostStorage, target: Muteable) {
    super(storage, target, "asterix");
  }
}
