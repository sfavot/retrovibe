/**
 * Son des *Voyageurs du temps* côté hôte : le port audio du moteur (`VoyageursAudio`, `engine/services.ts`) branché sur la musique CD
 * (`cd-music.ts`, MP3 lus en flux par `TrackPlayer`) et les effets OPL2 (`sfx-adlib.ts`, émulateur commun `src/audio/`). Même rôle que
 * `BassAudio` et `DrasculaAudio` ; décisions D3, D4 et D8 de docs/voyageurs/plan.md.
 *
 * - **Le temps du jeu ne dépend pas du son** : aucune attente de fin de piste ou d'effet, rien n'est lu en retour. Coupé ou bloqué par
 *   l'autoplay, le moteur avance pareil.
 * - La préférence « Son » du site (`setMuted`, `createSoundPrefs`) coupe musique et effets sans arrêter la lecture. `setMusicVolume`
 *   règle la musique (0 à 1) ; le volume que les scripts passent à `playSample` est ignoré, comme dans ScummVM (note fixe, volume 127).
 * - L'hôte appelle `unlock()` au premier geste, `suspend()` / `resume()` quand l'onglet est masqué, `close()` en quittant.
 * - Les effets s'écrivent dans la puce à l'horloge de l'hôte (ticks d'une milliseconde, `OPL_TICK_RATE`), sans rapport avec les images.
 *
 * Écart : le fondu (`fadeOut`) est un fondu de volume de 400 ms avant le retour à la piste du décor, là où le CD de ScummVM coupe net.
 * Les pistes bouclent en entier : `TrackPlayer` confie la boucle à l'élément média (`loop`), sans blanc à la reprise.
 */
import type { OplSink } from "../../../audio/opl-stream";
import { TrackPlayer } from "../../../audio/track-player";
import type { HostStorage } from "../../../engine/storage";
import { SoundPrefs, type Muteable } from "../../../ui/sound-prefs";
import type { VoyageursAudio } from "../engine/services";
import { CdMusic, type MusicRequest, type MusicSink } from "./cd-music";
import { AdlibSfx } from "./sfx-adlib";

/** Ticks par seconde de l'horodatage des écritures OPL (la milliseconde de `host.now()`). */
export const OPL_TICK_RATE = 1000;
/** Durée du fondu de `fadeOut`. */
export const FADE_MS = 400;
const FADE_STEP_MS = 40;

/** Sortie de la musique : ordres de `CdMusic`, plus la vie de la page. */
export interface MusicOutput extends MusicSink, Muteable {
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
  /** Volume de la musique de 0 à 1. */
  setVolume(level: number): void;
}

/** Sortie des effets : une puce OPL2 qu'on peut couper et libérer (`WebOpl`, ou un enregistreur de test). */
export interface OplOutput extends OplSink, Muteable {
  unlock(): void;
  suspend(): void;
  resume(): void;
  close(): void;
  setVolume?(level: number): void;
}

export interface VoyageursAudioOptions {
  /** Millisecondes monotones de l'hôte (`host.now()`). */
  now(): number;
  music: MusicOutput;
  opl: OplOutput;
}

export class VoyageursSound implements VoyageursAudio, Muteable {
  private readonly cd: CdMusic;
  private readonly sfx: AdlibSfx;

  constructor(private readonly options: VoyageursAudioOptions) {
    this.cd = new CdMusic(options.music);
    this.beginTick();
    this.sfx = new AdlibSfx(options.opl);
  }

  loadMusic(name: string): void {
    this.cd.loadMusic(name);
  }

  playMusic(): void {
    this.cd.playMusic();
  }

  fadeOut(): void {
    this.cd.fadeOut();
  }

  stopMusic(): void {
    this.cd.stopMusic();
  }

  setBgMusic(slot: number): void {
    this.cd.setBgMusic(slot);
  }

  /** `volume` des scripts ignoré (ScummVM : volume de canal fixé à 127). */
  playSample(channel: number, data: Uint8Array, _volume: number): void {
    this.beginTick();
    this.sfx.playSample(channel, data);
  }

  stopSample(channel: number): void {
    this.beginTick();
    this.sfx.stopSample(channel);
  }

  /** Champ `mus=` des traces du banc (`_currentMusic,_currentMusicStatus,_currentBgSlot`). */
  get musicTrace(): string {
    return this.cd.traceField();
  }

  /** Volume de la musique de 0 à 1. */
  setMusicVolume(level: number): void {
    this.options.music.setVolume(level);
  }

  /** À appeler dans un geste de l'utilisateur. */
  unlock(): void {
    this.options.music.unlock();
    this.options.opl.unlock();
  }

  suspend(): void {
    this.options.music.suspend();
    this.options.opl.suspend();
  }

  resume(): void {
    this.options.music.resume();
    this.options.opl.resume();
  }

  setMuted(muted: boolean): void {
    this.options.music.setMuted(muted);
    this.options.opl.setMuted(muted);
  }

  /** Page quittée. */
  close(): void {
    this.options.music.stop();
    this.options.music.close();
    this.options.opl.close();
  }

  private beginTick(): void {
    this.options.opl.beginTick?.(Math.round(this.options.now() * (OPL_TICK_RATE / 1000)));
  }
}

/** Préférence « Son » commune (`retrovibe:voyageurs:sound`), appliquée à `audio` dès la création. */
export function createSoundPrefs(storage: HostStorage, audio: Muteable): SoundPrefs {
  return new SoundPrefs(storage, audio, "voyageurs");
}

/** Timer injectable (tests : faux temps). */
export interface FadeTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface TrackMusicOptions {
  /** URL d'un fichier de musique (`music/track19.mp3`). */
  trackUrl(file: string): string;
  /** Point d'injection de l'élément média (tests). */
  createAudio?: () => HTMLAudioElement;
  timers?: FadeTimers;
}

/** Sortie de la musique du navigateur : MP3 en flux par `TrackPlayer`, boucle et fondu de volume. */
export class TrackMusicOutput implements MusicOutput {
  private readonly player: TrackPlayer;
  private readonly timers: FadeTimers;
  private base = 1;
  private factor = 1;
  private fadeTimer: unknown = null;

  constructor(private readonly options: TrackMusicOptions) {
    this.player = new TrackPlayer(options.createAudio);
    this.timers = options.timers ?? { setInterval: (cb, ms) => setInterval(cb, ms), clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>) };
  }

  play(file: string, loop: boolean): void {
    this.cancelFade();
    this.applyVolume();
    this.player.play(this.options.trackUrl(file), { loop });
  }

  stop(): void {
    this.cancelFade();
    this.player.stop();
    this.applyVolume();
  }

  fade(next: MusicRequest | null): void {
    this.cancelFade();
    if (!this.player.playing) {
      if (next) this.play(next.file, next.loop);
      else this.stop();
      return;
    }
    const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS));
    let done = 0;
    this.fadeTimer = this.timers.setInterval(() => {
      done++;
      if (done < steps) {
        this.factor = 1 - done / steps;
        this.applyVolume();
        return;
      }
      if (next) this.play(next.file, next.loop);
      else this.stop();
    }, FADE_STEP_MS);
  }

  /** Piste en cours de lecture réelle (faux si bloquée par l'autoplay). */
  get playing(): boolean {
    return this.player.playing;
  }

  setVolume(level: number): void {
    this.base = Math.min(1, Math.max(0, level));
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.player.muted = muted;
  }

  unlock(): void {
    this.player.unlock();
  }

  suspend(): void {
    this.player.suspend();
  }

  resume(): void {
    this.player.resume();
  }

  close(): void {
    this.stop();
  }

  private cancelFade(): void {
    if (this.fadeTimer !== null) this.timers.clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.factor = 1;
  }

  private applyVolume(): void {
    this.player.volume = this.base * this.factor;
  }
}

/** Ordre reçu par un `RecordingMusic`. */
export type MusicCommand =
  | { readonly op: "play"; readonly file: string; readonly loop: boolean }
  | { readonly op: "stop" }
  | { readonly op: "fade"; readonly next: MusicRequest | null };

/** Sortie de musique des tests et du moteur sans écran : note les ordres reçus. */
export class RecordingMusic implements MusicOutput {
  readonly commands: MusicCommand[] = [];
  muted = false;
  volume = 1;
  closed = false;

  play(file: string, loop: boolean): void {
    this.commands.push({ op: "play", file, loop });
  }

  stop(): void {
    this.commands.push({ op: "stop" });
  }

  fade(next: MusicRequest | null): void {
    this.commands.push({ op: "fade", next });
  }

  setVolume(level: number): void {
    this.volume = level;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  unlock(): void {}
  suspend(): void {}
  resume(): void {}

  close(): void {
    this.closed = true;
  }
}

/** Puce OPL2 « muette » des tests : note les écritures `[tick, registre, valeur]`. */
export class RecordingOpl implements OplOutput {
  readonly writes: Array<readonly [number, number, number]> = [];
  muted = false;
  closed = false;
  private tick = 0;

  beginTick(tick: number): void {
    this.tick = tick;
  }

  write(reg: number, value: number): void {
    this.writes.push([this.tick, reg, value]);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  unlock(): void {}
  suspend(): void {}
  resume(): void {}

  close(): void {
    this.closed = true;
  }
}

/** Moteur sans son (tests, banc) : `VoyageursSound` sur des sorties qui ne font qu'enregistrer. */
export function createRecordingAudio(now: () => number = () => 0): { audio: VoyageursSound; music: RecordingMusic; opl: RecordingOpl } {
  const music = new RecordingMusic();
  const opl = new RecordingOpl();
  return { audio: new VoyageursSound({ now, music, opl }), music, opl };
}
