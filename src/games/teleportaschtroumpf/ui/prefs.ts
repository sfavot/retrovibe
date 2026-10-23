import type { HostStorage } from "../engine/host";

/** Clé de la préférence « Son » (même préfixe que les options parents, `engine/options.ts`). */
export const SOUND_KEY = "retrovibe:teleportaschtroumpf:sound";

/** Sortie que l'on peut couper (`AudioBackend`). */
export interface Muteable {
  setMuted(muted: boolean): void;
}

/**
 * Préférence « Son » : activée par défaut, persistée (`"0"` = coupé) et appliquée à la sortie audio. Indépendante du
 * volume 0 à 15 du jeu. Même principe que `AudioPrefs` de Lost in Time (à partager, voir le rapport).
 */
export class SoundPrefs {
  private on: boolean;

  constructor(
    private readonly storage: HostStorage,
    private readonly target: Muteable,
  ) {
    this.on = this.read();
    this.apply();
  }

  private read(): boolean {
    return this.storage.get(SOUND_KEY) !== "0";
  }

  private apply(): void {
    this.target.setMuted(!this.on);
  }

  isEnabled(): boolean {
    return this.on;
  }

  set(on: boolean): void {
    this.on = on;
    this.apply();
    this.storage.set(SOUND_KEY, on ? "1" : "0");
  }

  toggle(): boolean {
    this.set(!this.on);
    return this.on;
  }

  /** Relit le stockage (un autre onglet a pu changer la préférence) ; vrai si elle a changé. */
  reload(): boolean {
    const on = this.read();
    if (on === this.on) return false;
    this.on = on;
    this.apply();
    return true;
  }
}
