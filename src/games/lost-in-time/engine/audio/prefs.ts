import type { KeyValueStore } from "../saves";

/** Sortie audio que l'on peut couper sans toucher à l'état du moteur (position, lecture en cours). */
export interface Mutable {
  muted: boolean;
}

const KEY = "audio.sound";
/** Ancienne clé « Musique » (avant le bouton unique), lue une fois puis supprimée. */
const LEGACY_MUSIC_KEY = "audio.music";

/**
 * Préférence « Son » : persistée, et appliquée en coupant toutes les sorties (effets Web Audio et
 * piste CD, qui porte aussi ambiances et bruitages). Le moteur continue de tourner à l'identique :
 * les scripts interrogent l'état du son et la position du CD.
 */
export class AudioPrefs {
  private on: boolean;

  constructor(
    private readonly store: KeyValueStore,
    private readonly targets: readonly Mutable[],
  ) {
    this.on = this.load();
    this.apply();
  }

  private load(): boolean {
    let on = this.store.get(KEY) !== "0";
    // Migration : une ancienne « Musique » coupée est reprise une fois, puis la clé disparaît
    // (le store ignore lui-même les erreurs de stockage).
    if (this.store.get(LEGACY_MUSIC_KEY) === "0") {
      on = false;
      this.store.set(KEY, "0");
    }
    this.store.remove(LEGACY_MUSIC_KEY);
    return on;
  }

  private apply(): void {
    for (const target of this.targets) target.muted = !this.on;
  }

  isEnabled(): boolean {
    return this.on;
  }

  set(on: boolean): void {
    this.on = on;
    this.apply();
    this.store.set(KEY, on ? "1" : "0");
  }

  toggle(): boolean {
    this.set(!this.on);
    return this.on;
  }
}
