/**
 * Adaptateur son du moteur : réalise `CroisiereSound` (services.ts) au-dessus de la façade `audio/sound.ts`, avec un `OplSink` injecté.
 *
 * Cadence (plan.md D7, banc `cruise-virtual-time.patch`) : le callback OPL de 50 Hz tourne à chaque multiple de 20 ms de l'horloge
 * virtuelle, à l'intérieur de `delayMillis` ; une attente longue (10 ms de la boucle, 180 ms de `fadeIn`, 50 ms de `load`) rattrape donc
 * tous les multiples franchis, d'un coup. Ici `elapse(ms)` (appelé par `EngineState.delay`) fait pareil : la phase est « multiples de
 * 20 ms depuis 0 », première échéance à 20 ms, sans rattrapage avant.
 *
 * Attente de `PCSoundFxPlayer::load` (`while (fondu en cours) delayMillis(50)`) : exacte, par l'attente que le moteur passe à `loadMusic`
 * (`EngineState.delay`, qui fait aussi avancer l'horloge du moteur, donc la cadence des tours, et rappelle `elapse`).
 *
 * Référence : `engines/cruise/sound.cpp` de ScummVM (GPL v3+, release 2026.4.0) ; lu puis réécrit.
 */
import type { OplSink } from "../../../audio/opl-stream";
import { CroisiereSound as SoundFacade, type CroisiereSoundState } from "../audio/sound";
import type { SoundFileLoader } from "../audio/module-player";
import type { CroisiereSound } from "./services";

/** Période du callback OPL (ms virtuelles). */
export const OPL_TICK_MS = 20;
/** `delayMillis(50)` de l'attente de `load`. */
const FADE_WAIT_MS = 50;

export class SoundService implements CroisiereSound {
  readonly facade: SoundFacade;
  private clockMs = 0;
  private fading = false;
  private tickCount = 0;

  constructor(sink: OplSink, loadFile: SoundFileLoader, musicVolume?: number, sfxVolume?: number) {
    this.facade = new SoundFacade(sink, loadFile, musicVolume, sfxVolume);
  }

  /** Ticks de 50 Hz joués depuis le début. */
  get ticks(): number {
    return this.tickCount;
  }

  elapse(ms: number): void {
    this.clockMs += ms;
    const due = Math.floor(this.clockMs / OPL_TICK_MS);
    const todo = due - this.tickCount;
    if (todo <= 0) return;
    this.tickCount = due;
    this.facade.tick(todo);
  }

  /** Fondu en cours : lancé par `fadeSong`, fini quand le lecteur s'est arrêté (`songPlayed`). */
  private isFading(): boolean {
    if (this.fading && this.facade.songPlayed()) this.fading = false;
    return this.fading;
  }

  loadMusic(name: string, wait: (ms: number) => void): void {
    while (this.isFading()) wait(FADE_WAIT_MS);
    this.facade.loadSong(name);
  }

  playMusic(): void {
    this.facade.playSong();
  }
  stopMusic(): void {
    this.facade.stopSong();
  }
  removeMusic(): void {
    this.facade.freeSong();
  }
  fadeSong(): void {
    if (this.facade.isPlaying) this.fading = true;
    this.facade.fadeSong();
  }
  songLoaded(): boolean {
    return this.facade.songLoaded;
  }
  songPlayed(): boolean {
    return this.facade.songPlayed();
  }
  isPlaying(): boolean {
    return this.facade.isPlaying;
  }
  musicName(): string {
    return this.facade.getState().musicName;
  }
  numOrders(): number {
    return this.facade.songSize(() => 0);
  }
  setNumOrders(n: number): void {
    this.facade.songSize(() => n);
  }
  setPattern(offset: number, value: number): void {
    this.facade.setPattern(offset, value);
  }
  musicLooping(): boolean {
    return this.facade.getState().looping;
  }
  musicLoop(loop: boolean): void {
    this.facade.songLoop(loop);
  }
  getVolume(): number {
    return this.facade.getState().genVolume;
  }
  setVolume(volume: number): void {
    this.facade.setVolume(63 - volume);
  }
  playSound(data: Uint8Array, size: number, _volume: number): void {
    this.facade.playFX(size > 0 && size < data.length ? data.subarray(0, size) : data);
  }
  stopChannel(channel: number): void {
    this.facade.stopFX(channel);
  }
  startNote(): void {
    this.facade.freqFX();
  }
  saveState(): CroisiereSoundState {
    return this.facade.getState();
  }
  restoreState(state: CroisiereSoundState): void {
    this.fading = false;
    this.facade.restoreState(state);
  }
}
