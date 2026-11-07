/** Stockage clé / valeur minimal (compatible avec `HostStorage` du Téléportaschtroumpf et `KeyValueStore` de Lost in Time). */
export interface SoundPrefsStorage {
  get(key: string): string | null;
  set(key: string, value: string): unknown;
}

/** Sortie audio que l'on peut couper sans toucher à l'état du moteur (position, lecture en cours). */
export interface Muteable {
  setMuted(muted: boolean): void;
}

/** Clé de la préférence « Son » d'un jeu : `retrovibe:<jeu>:sound`. */
export function soundPrefKey(game: string): string {
  return `retrovibe:${game}:sound`;
}

/** Réglages facultatifs de `SoundPrefs`. */
export interface SoundPrefsOptions {
  /** Clé de stockage à la place de `soundPrefKey(game)` (clé historique d'un jeu dont les préférences existent déjà). */
  key?: string;
}

/**
 * Préférence « Son » d'un jeu : activée par défaut, persistée (`"0"` = coupé) et appliquée à la sortie audio, sans
 * lien avec les réglages de volume propres au jeu. Une clé par jeu (`retrovibe:<jeu>:sound`), ou la clé historique du jeu
 * (`options.key`) quand des préférences déjà enregistrées par les joueurs doivent rester lues : Lost in Time, dont le
 * stockage est préfixé, garde `audio.sound`.
 */
export class SoundPrefs {
  private on: boolean;
  private readonly key: string;

  constructor(
    private readonly storage: SoundPrefsStorage,
    private readonly target: Muteable,
    game: string,
    options: SoundPrefsOptions = {},
  ) {
    this.key = options.key ?? soundPrefKey(game);
    this.on = this.read();
    this.apply();
  }

  private read(): boolean {
    return this.storage.get(this.key) !== "0";
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
    this.storage.set(this.key, on ? "1" : "0");
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
