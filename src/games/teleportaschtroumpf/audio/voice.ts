import type { AudioBackend, PcmSound } from "./backend";

/** Volume maître de l'original : 0 à 15 (`DS:0212`), 15 au maximum. */
export const MAX_VOLUME = 15;
/** Nombre de bips préchargés (`s52d001b.voc`, `s01a002b.voc`, `s01a001b.voc`, engine.md §5.2). */
export const BEEP_COUNT = 3;

/**
 * Voie unique voix / musique (engine.md §5.2, `15f9:089f`).
 *
 * - lancer un son (`play`, `playBeep`, `playPcm`) coupe le précédent, musique comprise ;
 * - la **musique** (`setMusic`) repart au début, en boucle, dès que rien ne joue (appel de `update()` à chaque tick) :
 *   pas de reprise à la position où elle s'était arrêtée ;
 * - `holdMusic(true)` empêche ce redémarrage (pendant une vidéo) ;
 * - les trois **bips** sont des sons courts préchargés par `setBeeps`, joués sur la même voie ;
 * - le **bruitage** mélangé (`playEffect`, `348d:0b42(2, ptr)`, engine.md §5.2 bis) est un second canal, à un seul
 *   emplacement : un nouveau bruitage remplace le précédent, et ni la voie ni la musique ne sont coupées ;
 *   `effectPlaying` est `348d:0b42(1, 0) != 0` (« un bruitage sonne encore ») ;
 * - volume 0–15, transmis au backend sous forme de gain linéaire, pour la voie comme pour le bruitage.
 */
export class VoiceChannel {
  private music: PcmSound | null = null;
  private beeps: PcmSound[] = [];
  private holding = false;
  private current: "voice" | "music" | null = null;
  private level = MAX_VOLUME;

  constructor(private readonly backend: AudioBackend) {
    this.applyVolume();
  }

  get volume(): number {
    return this.level;
  }

  setVolume(volume: number): void {
    this.level = Math.min(MAX_VOLUME, Math.max(0, Math.round(volume)));
    this.applyVolume();
  }

  private applyVolume(): void {
    this.backend.setGain(this.level / MAX_VOLUME);
  }

  /** Vrai si quelque chose sort (voix ou musique). */
  get playing(): boolean {
    return this.current !== null && this.backend.playing;
  }

  /** Vrai si c'est une voix / un bruitage (pas la musique) qui sort. */
  get voicePlaying(): boolean {
    return this.current === "voice" && this.backend.playing;
  }

  /** Position dans le son courant, en secondes. */
  get position(): number {
    return this.backend.position;
  }

  /** Joue une voix ou un bruitage une fois, en coupant le son courant. */
  play(sound: PcmSound): void {
    this.backend.play(sound, false);
    this.current = "voice";
  }

  /** Joue un bruitage mélangé (`348d:0b42(2, ptr)`) : remplace le bruitage précédent, sans couper la voie ni la musique. */
  playEffect(sound: PcmSound): void {
    this.backend.playEffect(sound);
  }

  /** Vrai tant qu'un bruitage sonne (`348d:0b42(1, 0) != 0`). */
  get effectPlaying(): boolean {
    return this.backend.effectPlaying;
  }

  stopEffect(): void {
    this.backend.stopEffect();
  }

  /** Même chose pour du PCM brut (piste son d'une vidéo MUX). */
  playPcm(samples: Uint8Array, sampleRate: number): void {
    this.play({ samples, sampleRate });
  }

  playBeep(index: number): void {
    const beep = this.beeps[index];
    if (beep) this.play(beep);
  }

  setBeeps(beeps: PcmSound[]): void {
    this.beeps = beeps;
  }

  /** Coupe le son courant ; la musique repartira au prochain `update()` si elle est réglée et non retenue. */
  stop(): void {
    this.backend.stop();
    this.current = null;
  }

  /** Fixe (ou retire, avec `null`) la musique de fond jouée en boucle quand rien d'autre ne joue. */
  setMusic(music: PcmSound | null): void {
    this.music = music;
    if (!music && this.current === "music") this.stop();
  }

  get hasMusic(): boolean {
    return this.music !== null;
  }

  holdMusic(hold: boolean): void {
    this.holding = hold;
    if (hold && this.current === "music") this.stop();
  }

  /** À appeler à chaque tick : relance la musique quand la voie est libre. */
  update(): void {
    if (this.backend.playing) return;
    this.current = null;
    if (this.music && !this.holding) {
      this.backend.play(this.music, true);
      // Le backend peut refuser (sortie verrouillée) : on réessaiera au prochain tick.
      this.current = this.backend.playing ? "music" : null;
    }
  }
}
