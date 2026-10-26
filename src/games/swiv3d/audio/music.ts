/**
 * Musique de SWIV 3D : pistes du CD en `MUSIC/TRACKnn.MP3`, une seule à la fois, en boucle.
 *
 * L'exécutable (screens.md §8) n'a qu'une table de 6 entiers indexée par la **préférence** (0 SWIV, 1 Classique,
 * 2 Divers) : `{2, 9, 3}` par défaut (menus), remplacée pour la durée d'une mission par l'élément `400` du
 * script. Les trois premières entrées servent seules ; elles sont ici figées par contexte.
 */

export type MusicPreference = "swiv" | "classical" | "misc";
export type MusicContext = "menu" | "level:TERRAN00" | "level:TERRAN01" | "level:TERRAN02" | "level:TERRAN03" | "silent";

export const MUSIC_PREFERENCES: readonly MusicPreference[] = ["swiv", "classical", "misc"];
export const MUSIC_CONTEXTS: readonly MusicContext[] = [
  "menu",
  "level:TERRAN00",
  "level:TERRAN01",
  "level:TERRAN02",
  "level:TERRAN03",
  "silent",
];

/** Numéro de piste (`TRACKnn`) par contexte et par préférence (ordre SWIV, Classique, Divers). */
const TRACKS: Readonly<Record<Exclude<MusicContext, "silent">, readonly [number, number, number]>> = {
  menu: [2, 9, 3],
  "level:TERRAN00": [3, 9, 2],
  "level:TERRAN01": [4, 10, 10],
  "level:TERRAN02": [5, 9, 6],
  "level:TERRAN03": [6, 9, 3],
};

/** Numéro de piste à jouer, ou `null` en silence (vidéos, crédits). */
export function trackFor(context: MusicContext, preference: MusicPreference): number | null {
  if (context === "silent") return null;
  return TRACKS[context][MUSIC_PREFERENCES.indexOf(preference)];
}

/** Nom de fichier relatif au dossier du jeu : `MUSIC/TRACK09.MP3`. */
export function trackFile(track: number): string {
  return `MUSIC/TRACK${String(track).padStart(2, "0")}.MP3`;
}

/** Ce que `MusicSystem` utilise de `TrackPlayer` (`src/audio/track-player.ts`). */
export interface MusicPlayer {
  play(url: string, options?: { loop?: boolean }): void;
  stop(): void;
  suspend(): void;
  resume(): void;
  unlock(): void;
  muted: boolean;
}

export class MusicSystem {
  private contextValue: MusicContext = "silent";
  private preferenceValue: MusicPreference;
  private currentTrack: number | null = null;

  /** `baseUrl` : dossier du jeu, avec ou sans `/` final (`/swiv3d`). */
  constructor(
    private readonly player: MusicPlayer,
    private readonly baseUrl = "",
    preference: MusicPreference = "swiv",
  ) {
    this.preferenceValue = preference;
  }

  get context(): MusicContext {
    return this.contextValue;
  }

  get preference(): MusicPreference {
    return this.preferenceValue;
  }

  /** Piste en cours de lecture (ou `null`). */
  get track(): number | null {
    return this.currentTrack;
  }

  get muted(): boolean {
    return this.player.muted;
  }

  set muted(value: boolean) {
    this.player.muted = value;
  }

  /** Change de contexte : relance la musique si le contexte change (début de niveau, retour au menu), coupe en `silent`. */
  setContext(context: MusicContext): void {
    if (context === this.contextValue) return;
    this.contextValue = context;
    this.restart();
  }

  /** Change de préférence (menu Musique, changement de pilote) : la piste ne redémarre que si elle diffère. */
  setPreference(preference: MusicPreference): void {
    if (preference === this.preferenceValue) return;
    this.preferenceValue = preference;
    if (trackFor(this.contextValue, preference) !== this.currentTrack) this.restart();
  }

  /** Relance la piste du contexte (nouvelle tentative du même niveau). */
  restart(): void {
    const track = trackFor(this.contextValue, this.preferenceValue);
    this.currentTrack = track;
    if (track === null) {
      this.player.stop();
      return;
    }
    this.player.play(this.url(track), { loop: true });
  }

  stop(): void {
    this.contextValue = "silent";
    this.currentTrack = null;
    this.player.stop();
  }

  /** Onglet masqué. */
  suspend(): void {
    this.player.suspend();
  }

  resume(): void {
    this.player.resume();
  }

  /** À appeler après une interaction de l'utilisateur (politique d'autoplay). */
  unlock(): void {
    this.player.unlock();
  }

  private url(track: number): string {
    const base = this.baseUrl === "" || this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    return base + trackFile(track);
  }
}
