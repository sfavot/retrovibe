import type { OplSink } from "../../../audio/opl-stream";
import { WebSampleOutput } from "../../../audio/web-sample-output";
import type { HostStorage } from "../../../engine/storage";
import { SoundPrefs, type Muteable } from "../../../ui/sound-prefs";
import { readAdLibBank } from "../data/music";
import { SampleChannel } from "./channel";
import { QueenMusic } from "./music";
import { QueenSound } from "./sound";
import { VoiceBank, type SoundFiles } from "./voices";

/**
 * Son de *Flight of the Amazon Queen* côté hôte : musique AdLib (`music.ts`, pilote `adlib-driver.ts`, sortie OPL2 en worklet),
 * voix et effets MP3 (`voices.ts`, `channel.ts`), logique de ScummVM (`sound.ts`), coupure et volume. Même rôle que
 * `DrasculaAudio` (`docs/drascula/audio.md`) ; voir `docs/fotaq/audio.md`.
 *
 * - **Le temps du jeu ne dépend pas du son.** Une voix est « en cours » pendant sa durée sur l'horloge de l'hôte, que le
 *   contexte existe, soit bloqué (autoplay) ou que le son soit coupé ; la coupure ne fait que passer des gains à 0. La musique
 *   avance elle aussi avec l'horloge de l'hôte (`update`), coupée ou non.
 * - L'hôte appelle `update()` une fois par image d'écran (les écritures OPL sont datées par tick de 4 ms, la régularité de
 *   l'appel n'a pas d'importance), `unlock()` au premier geste, `suspend()` / `resume()` quand l'onglet est masqué.
 * - La préférence « Son » (`createSoundPrefs`) coupe tout ; le volume (`setVolume`) règle la musique seule, comme le curseur du
 *   journal de ScummVM (`Sound::setVolume` ne touche que le type « musique » du mélangeur).
 */

/** Sortie de la musique : une `OplSink` qu'on peut couper, régler et libérer (`WebOpl`, ou un enregistreur de test). */
export interface MusicOutput extends OplSink, Muteable {
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
  setVolume(level: number): void;
}

export interface FotaqAudioOptions {
  /** Millisecondes monotones de l'hôte (`host.now()`). */
  now(): number;
  files: SoundFiles;
  /** Octets de `AQBANK.MUS`. */
  musicData: Uint8Array;
  music: MusicOutput;
  /** Points d'injection des tests. */
  createContext?: () => AudioContext;
  random?: (max: number) => number;
}

export class FotaqAudio implements Muteable {
  private readonly output: WebSampleOutput;
  private readonly music: QueenMusic;
  private readonly voices: VoiceBank;
  private readonly sound: QueenSound;
  private lastUpdate: number;
  private suspended = false;
  private volumeLevel = 1;

  constructor(private readonly options: FotaqAudioOptions) {
    this.output = new WebSampleOutput({ now: options.now, createContext: options.createContext });
    this.music = new QueenMusic({ bank: readAdLibBank(options.musicData), sink: options.music, random: options.random });
    this.voices = new VoiceBank(options.files, this.output);
    this.sound = new QueenSound({
      music: this.music,
      sfx: new SampleChannel(this.voices, this.output),
      speech: new SampleChannel(this.voices, this.output),
    });
    this.lastUpdate = options.now();
  }

  // --- interface de l'hôte du moteur ------------------------------------------------------------------------------------

  /** `FotaqHost.playSong` : numéro de morceau d'une liste de commandes ou d'une cinématique. */
  playSong(song: number): void {
    this.sound.playSong(song);
  }

  /** `FotaqHost.playSfx` : effet sonore de la pièce (image d'animation > 500). */
  playSfx(sfx: number): void {
    this.sound.playSfx(sfx);
  }

  /** Voix d'une réplique : `base` est le nom calculé par le moteur (`020001P2`, espaces = zéros). */
  playSpeech(base: string): void {
    this.sound.playSpeech(base);
  }

  stopSpeech(): void {
    this.sound.stopSpeech();
  }

  stopSfx(): void {
    this.sound.stopSfx();
  }

  stopSong(): void {
    this.sound.stopSong();
  }

  /** Reprend le dernier morceau retenu (après un chargement de partie). */
  playLastSong(): void {
    this.sound.playLastSong();
  }

  get speechActive(): boolean {
    return this.sound.isSpeechActive;
  }

  get sfxActive(): boolean {
    return this.sound.isSfxActive;
  }

  /** Le dernier `playSpeech` a trouvé son fichier de voix. */
  get speechFound(): boolean {
    return this.sound.speechSfxExists;
  }

  /** Une voix de ce nom existe (liste de fichiers, synchrone). */
  hasSpeech(base: string): boolean {
    return this.voices.has(base.replaceAll(" ", "0").toUpperCase());
  }

  /** Précharge des voix ou des effets (noms de fichiers) ; rend le nombre de sons prêts. */
  preload(names: Iterable<string>): Promise<number> {
    return this.voices.preload(names);
  }

  /** La musique tourne (un morceau est en cours). */
  get musicPlaying(): boolean {
    return this.music.isPlaying;
  }

  /** Dernier morceau de musique retenu (`lastOverride`), à sauvegarder avec la partie. */
  get lastSong(): number {
    return this.sound.lastOverride;
  }

  set lastSong(song: number) {
    this.sound.lastOverride = song;
  }

  // --- réglages ---------------------------------------------------------------------------------------------------------

  get sfxOn(): boolean {
    return this.sound.sfxOn;
  }
  set sfxOn(on: boolean) {
    this.sound.sfxOn = on;
  }
  get speechOn(): boolean {
    return this.sound.speechOn;
  }
  set speechOn(on: boolean) {
    this.sound.speechOn = on;
  }
  /** Bascule la musique (journal) : éteinte elle s'arrête, rallumée elle reprend le dernier morceau. */
  get musicOn(): boolean {
    return this.sound.musicOn;
  }
  set musicOn(on: boolean) {
    this.sound.musicOn = on;
    if (on) this.sound.playLastSong();
    else this.sound.stopSong();
  }

  /** Volume de la musique de 0 à 1. */
  get volume(): number {
    return this.volumeLevel;
  }
  set volume(level: number) {
    this.volumeLevel = Math.min(1, Math.max(0, level));
    this.options.music.setVolume(this.volumeLevel);
  }

  // --- vie du contexte --------------------------------------------------------------------------------------------------

  /** Fait avancer la musique au rythme de l'horloge de l'hôte : à appeler une fois par image d'écran. */
  update(): void {
    const now = this.options.now();
    if (!this.suspended) this.music.advance(now - this.lastUpdate);
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
    this.sound.stopSpeech();
    this.sound.stopSfx();
    this.sound.stopSong();
    this.output.close();
    this.options.music.close();
  }
}

/** Préférence « Son » commune (`retrovibe:fotaq:sound`), appliquée à `audio` dès la création. */
export function createSoundPrefs(storage: HostStorage, audio: Muteable): SoundPrefs {
  return new SoundPrefs(storage, audio, "fotaq");
}
