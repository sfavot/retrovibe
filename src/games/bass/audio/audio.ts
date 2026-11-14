/**
 * Son de *Beneath a Steel Sky* côté hôte : musique AdLib (`adlib-music.ts`, sortie OPL2 commune), effets échantillonnés (`sfx.ts`) et voix
 * MP3 (`speech.ts`), coupure et suspension. Même rôle que `FotaqAudio` et `LureAudio` ; voir `docs/bass/audio.md`.
 *
 * Le moteur ne voit que `BassSound` (`engine/services.ts`) : `loadSection`, `startMusic`, `startFx`, `stopFx`, `pauseFx`, `unPauseFx`,
 * `checkFxQueue`, `startSpeech`, `speechFinished`, `stopSpeech`.
 *
 * - **Le temps du jeu ne dépend pas du son.** Voix et effets durent sur l'horloge de l'hôte (`WebSampleOutput`), que le contexte existe, soit
 *   bloqué (autoplay) ou que le son soit coupé. La musique avance avec la même horloge (`update`, ticks de 50 Hz), coupée ou non.
 * - L'hôte appelle `update()` une fois par image d'écran, `unlock()` au premier geste, `suspend()` / `resume()` quand l'onglet est masqué.
 * - La préférence « Son » du site (`setMuted`) coupe tout. Le volume de la musique (`musicVolume`, de 0 à 127, panneau de contrôle) entre dans
 *   le calcul des niveaux de l'OPL (`AdlibMusic.setVolume`), pas dans un gain général. Les effets ont leur interrupteur (`fxOff`, `SF_FX_OFF`) ;
 *   les voix le leur (`speechOn`, `SF_ALLOW_SPEECH`).
 * - Comme `Sound::loadSection` de ScummVM (`_mixer->stopAll()`), un changement de section coupe aussi la voix en cours.
 */

import type { OplSink } from "../../../audio/opl-stream";
import type { SamplePlayer } from "../../../audio/sample-channel";
import { VoiceBank, type SoundFiles } from "../../../audio/voice-bank";
import { WebSampleOutput } from "../../../audio/web-sample-output";
import type { HostStorage } from "../../../engine/storage";
import { SoundPrefs, type Muteable } from "../../../ui/sound-prefs";
import { musicFile, sfxFile } from "../data/ids";
import type { BassSound } from "../engine/services";
import { AdlibMusic } from "./adlib-music";
import { BassSfx, type SavedSounds } from "./sfx";
import { BassSpeech } from "./speech";

/** Minuterie de la musique d'origine (`opl->start(onTimer, 50)`). */
export const MUSIC_TICKS_PER_SECOND = 50;
/** Au plus 2 s de ticks de musique rattrapés en une mise à jour (onglet figé, longue image). */
const MAX_CATCH_UP_TICKS = MUSIC_TICKS_PER_SECOND * 2;

/** Sortie de la musique : une `OplSink` qu'on peut couper et libérer (`WebOpl`, ou un enregistreur de test). */
export interface MusicOutput extends OplSink, Muteable {
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
}

/** Le pilote de musique vu de l'hôte : `AdlibMusic` y répond tel quel. */
export interface BassMusicDriver {
  loadSection(section: number): void;
  startMusic(param: number): void;
  stopMusic(): void;
  setVolume(volume: number): void;
  tick(): void;
  getState(): { readonly section: number; readonly song: number; readonly volume: number };
  restoreState(state: { readonly section: number; readonly song: number; readonly volume: number }): void;
}

/** Ce qu'une sauvegarde garde du son (`prepareSaveData` de ScummVM : deux effets, musique). */
export interface BassAudioState {
  readonly sounds: SavedSounds;
  readonly music: { readonly section: number; readonly song: number; readonly volume: number };
}

export interface BassAudioOptions {
  /** Millisecondes monotones de l'hôte (`host.now()`). */
  now(): number;
  /** Octets décompressés d'un fichier de `sky.dsk` (musique `musicFile(s)`, effets `sfxFile(s)`). */
  loadFile(fileId: number): Uint8Array;
  /** Voix : `voices/<id>.mp3` (identifiant de 50000 à 55277). */
  voices: SoundFiles<number>;
  music: MusicOutput;
  /** Pièce courante (`SCREEN & 0xFF`). */
  screen(): number;
  /** Points d'injection (tests, ou pilote de remplacement). */
  createContext?: () => AudioContext;
  createMusic?: (sink: OplSink, loadFile: (section: number) => Uint8Array) => BassMusicDriver;
}

export class BassAudio implements BassSound, Muteable {
  readonly sfx: BassSfx;
  readonly speech: BassSpeech;
  private readonly output: WebSampleOutput;
  private readonly bank: VoiceBank<number>;
  private readonly music: BassMusicDriver;
  private lastUpdate: number;
  /** Temps (ms) écoulé depuis le dernier tick de musique lancé. */
  private tickRemainder = 0;
  private suspended = false;

  /** Sortie d'échantillons partagée (voix et ambiances de l'introduction du CD, qui ne passent pas par `BassSfx`). */
  get samplePlayer(): SamplePlayer {
    return this.output;
  }

  constructor(private readonly options: BassAudioOptions) {
    this.output = new WebSampleOutput({ now: options.now, createContext: options.createContext });
    this.bank = new VoiceBank<number>(options.voices, this.output);
    const player: SamplePlayer = this.output;
    this.sfx = new BassSfx({ output: player, loadFile: (section) => options.loadFile(sfxFile(section)), screen: options.screen });
    this.speech = new BassSpeech(this.bank, player);
    const loadMusic = (section: number): Uint8Array => options.loadFile(musicFile(section));
    this.music = options.createMusic?.(options.music, loadMusic) ?? new AdlibMusic(options.music, loadMusic);
    this.lastUpdate = options.now();
  }

  // --- interface du moteur (`BassSound`) ----------------------------------------------------------------------------------

  /**
   * `fnEnterSection` : musique et effets de la section (`Sound::loadSection` coupe aussi la voix, comme `_mixer->stopAll()`).
   * `gameRestored` : juste après un chargement de partie, la file des effets à relancer est gardée.
   */
  loadSection(section: number, gameRestored = false): void {
    this.music.loadSection(section);
    this.sfx.loadSection(section, gameRestored);
    this.speech.stop();
  }

  startMusic(music: number): void {
    this.music.startMusic(music);
  }

  startFx(sound: number, channel: number): void {
    this.sfx.startFx(sound, channel);
  }

  stopFx(): void {
    this.sfx.stopFx();
  }

  pauseFx(): void {
    this.sfx.pauseFx();
  }

  unPauseFx(): void {
    this.sfx.unPauseFx();
  }

  checkFxQueue(): void {
    this.sfx.checkFxQueue();
  }

  startSpeech(textNum: number): boolean {
    return this.speech.start(textNum);
  }

  speechFinished(): boolean {
    return this.speech.finished();
  }

  stopSpeech(): void {
    this.speech.stop();
  }

  /** Séquences (`IC_MAKE_SOUND`, `IC_FX_VOLUME`) : `Sound::playSound(son, volume, voie)`. */
  playSound(sound: number, volume: number, channel: number): void {
    this.sfx.playSound(sound, volume, channel);
  }

  /** Coupe la musique (`MusicBase::stopMusic`) ; le morceau en cours n'est pas oublié. */
  stopMusic(): void {
    this.music.stopMusic();
  }

  // --- réglages -----------------------------------------------------------------------------------------------------------

  /** Volume de la musique, de 0 à 127 (curseur du panneau de contrôle). */
  get musicVolume(): number {
    return this.music.getState().volume;
  }
  set musicVolume(volume: number) {
    this.music.setVolume(volume);
  }

  get fxOff(): boolean {
    return this.sfx.fxOff;
  }
  set fxOff(off: boolean) {
    this.sfx.fxOff = off;
  }

  get speechOn(): boolean {
    return this.speech.allowed;
  }
  set speechOn(on: boolean) {
    this.speech.allowed = on;
  }

  /** Précharge des voix (numéros de texte) ; rend le nombre de voix prêtes. */
  preloadSpeech(textNums: Iterable<number>): Promise<number> {
    return this.speech.preload(textNums);
  }

  // --- sauvegarde ---------------------------------------------------------------------------------------------------------

  getState(): BassAudioState {
    return { sounds: this.sfx.savedSounds, music: this.music.getState() };
  }

  /**
   * Chargement de partie : musique relancée, effets sauvegardés remis dans la file. Le moteur appelle ensuite `loadSection(section, true)`
   * (`SF_GAME_RESTORED`), qui garde cette file.
   */
  restoreState(state: BassAudioState): void {
    this.sfx.restoreState(state.sounds);
    this.music.restoreState(state.music);
  }

  // --- vie du contexte ----------------------------------------------------------------------------------------------------

  /** Fait avancer la musique au rythme de l'horloge de l'hôte (50 ticks par seconde) : à appeler une fois par image d'écran. */
  update(): void {
    const now = this.options.now();
    if (!this.suspended) {
      this.tickRemainder += Math.max(0, now - this.lastUpdate);
      const period = 1000 / MUSIC_TICKS_PER_SECOND;
      let ticks = Math.floor(this.tickRemainder / period);
      this.tickRemainder -= ticks * period;
      ticks = Math.min(ticks, MAX_CATCH_UP_TICKS);
      for (; ticks > 0; ticks--) this.music.tick();
    }
    this.lastUpdate = now;
  }

  /** À appeler dans un geste de l'utilisateur. */
  unlock(): void {
    this.output.unlock();
    this.options.music.unlock();
  }

  suspend(): void {
    this.update();
    this.suspended = true;
    this.output.suspend();
    this.options.music.suspend();
  }

  resume(): void {
    this.suspended = false;
    this.lastUpdate = this.options.now();
    this.output.resume();
    this.options.music.resume();
  }

  setMuted(muted: boolean): void {
    this.output.setMuted(muted);
    this.options.music.setMuted(muted);
  }

  /** Page quittée. */
  close(): void {
    this.speech.stop();
    this.sfx.close();
    this.music.stopMusic();
    this.output.close();
    this.options.music.close();
  }
}

/** Préférence « Son » commune (`retrovibe:bass:sound`), appliquée à `audio` dès la création. */
export function createSoundPrefs(storage: HostStorage, audio: Muteable): SoundPrefs {
  return new SoundPrefs(storage, audio, "bass");
}
