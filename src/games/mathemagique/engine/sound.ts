/**
 * Service sonore : couche fine au-dessus de `AudioSink` (WAVE) et de `MidiPlayer` (MIDI), à l'échelle d'une scène.
 *
 * L'original (engine.md §6) a une table de voix (`1088:1498(canal, \0SND, id)`), un WAVE et un MIDI à la fois par défaut,
 * une préférence « Ambient Sounds » (`DS:2d64`, roster) qui commande la musique de fond et les bavardages, et la voix de Poly
 * qui remplace la précédente. Ici :
 *  - `playSound` joue un `\0SND` sans en connaître le type (WAVE ou MIDI), comme `1088:1498` ;
 *  - canal `voice` : une seule voix à la fois, la nouvelle remplace l'ancienne (Poly, Gus) ; canal `effect` : plusieurs en parallèle ;
 *  - `ambient: true` : le son n'est joué que si la préférence « Ambient Sounds » est active (`ambientEnabled`) ;
 *  - `preload` / `release` : préchargement par liste (`SNDL`) ; la conversion en flottants est faite une fois par archive (`pcm.ts`) ;
 *  - MIDI : une musique à la fois, bouclée si demandé (repères `setup end` / `loop end`) ; le séquenceur est avancé par `tick()`.
 *    Un seul séquenceur pour toute la scène : `playSong` sert aux scènes qui ont besoin d'options de lecture propres (réécriture, repères,
 *    tempo : Rhythm Shop) ; il suit les mêmes règles que `playMusic` (remplace la musique, `stopMusic` / `releaseAll` / `stopAmbient`,
 *    reprise quand le synthétiseur devient prêt).
 * Rien n'utilise de minuteur : le moteur appelle `tick()` à chaque tick (voir `installServices`).
 */
import { loadPcm } from "../audio/pcm";
import { MidiPlayer, parsePrograms, parseSysx, type PlayOptions, type ProgramEntry } from "../audio/sequencer";
import { parseSong, type Song } from "../audio/smf";
import type { AudioSink, WaveHandle } from "../audio/sink";
import { isMidi, parseMidi } from "../data/midi";
import { TAG_SND, type MohawkArchive } from "../data/mohawk";
import { defineService } from "./scene";

/** Tout ce qui porte une archive Mohawk (`Archive` de `resources.ts` en est une). */
export interface WaveArchive {
  readonly mohawk: MohawkArchive;
}

/** `voice` : une seule voix à la fois (la nouvelle remplace l'ancienne) ; `effect` : plusieurs en parallèle. */
export type SoundChannel = "effect" | "voice";

export interface PlaySoundOptions {
  /** Rejoue en boucle (WAVE) ; pour un MIDI, boucle entre `loop start` / `setup end` et `loop end`. */
  loop?: boolean;
  /** Défaut `effect`. Sans effet pour un MIDI (une seule musique à la fois). */
  channel?: SoundChannel;
  /** Joué seulement si « Ambient Sounds » est actif (musique de fond des activités, bavardages de Poly). */
  ambient?: boolean;
  /** MIDI : rappel de fin (non bouclé, pas après `stop`). */
  onEnd?: () => void;
}

/**
 * Options de `playSong` : celles de `MidiPlayer.play` (`loop`, `rewrite`, `bpm`, `programs`, `onMarker`, `onEnd`, repères de boucle) et `ambient`.
 */
export interface PlaySongOptions extends PlayOptions {
  /** Joué seulement si « Ambient Sounds » est actif. */
  ambient?: boolean;
}

/** Son lancé. Pour un MIDI, `wave` vaut -1. */
export interface SoundHandle {
  readonly id: number;
  readonly kind: "wave" | "midi";
  readonly channel: SoundChannel;
  readonly ambient: boolean;
  readonly wave: WaveHandle;
  /** Vrai après `stop` ou remplacement. */
  stopped: boolean;
}

/** Sons préchargés ensemble (`SNDL` d'un écran). */
export interface PreloadSet {
  readonly ids: readonly number[];
  release(): void;
}

export interface SoundServiceOptions {
  /** Préférence « Ambient Sounds » (`roster.ambient`) ; défaut : toujours actif. */
  ambientEnabled?: () => boolean;
  /** Messages d'initialisation `MIDIMAP.DAT` (`loadMidiMap`). */
  midiInit?: readonly Uint8Array[];
}

const songCache = new WeakMap<MohawkArchive, Map<number, { song: Song; programs: ProgramEntry[] }>>();

function loadSong(archive: MohawkArchive, id: number): { song: Song; programs: ProgramEntry[] } {
  let byId = songCache.get(archive);
  if (!byId) {
    byId = new Map();
    songCache.set(archive, byId);
  }
  let entry = byId.get(id);
  if (!entry) {
    const midi = parseMidi(archive.get(TAG_SND, id));
    entry = { song: parseSong(midi.smf), programs: parsePrograms(midi.programs) };
    byId.set(id, entry);
  }
  return entry;
}

export class SoundService {
  private readonly ambientEnabled: () => boolean;
  private readonly player: MidiPlayer;
  private readonly waves = new Set<SoundHandle>();
  private voice: SoundHandle | null = null;
  private music: SoundHandle | null = null;
  private musicRequest: { song: Song; options: PlaySongOptions } | null = null;
  private readonly preloads = new Set<PreloadSet>();

  constructor(
    private readonly audio: AudioSink,
    options: SoundServiceOptions = {},
  ) {
    this.ambientEnabled = options.ambientEnabled ?? (() => true);
    this.player = new MidiPlayer(audio.midi, { now: () => audio.now(), initMessages: options.midiInit });
  }

  /** `SYSX` 1 de `MIDIMAP.DAT` : réglages envoyés avant chaque musique (reset des contrôleurs, volume, pan). */
  loadMidiMap(archive: { raw(tag: string, id: number): Uint8Array }): void {
    this.player.setInitMessages(parseSysx(archive.raw("SYSX", 1)));
  }

  /** La préférence « Ambient Sounds » est active. */
  get ambient(): boolean {
    return this.ambientEnabled();
  }

  // --- Lecture ---

  /**
   * Joue le `\0SND` `id` (WAVE ou MIDI, détecté à l'en-tête). Renvoie `null` si un son d'ambiance est demandé alors que la préférence
   * est coupée. Lève si la ressource est absente.
   */
  playSound(archive: WaveArchive, id: number, options: PlaySoundOptions = {}): SoundHandle | null {
    if (options.ambient && !this.ambientEnabled()) return null;
    const bytes = archive.mohawk.get(TAG_SND, id);
    return isMidi(bytes) ? this.playMusic(archive, id, options) : this.playWave(archive, id, options);
  }

  /** Joue un WAVE. Canal `voice` : la voix précédente est coupée. */
  playWave(archive: WaveArchive, id: number, options: PlaySoundOptions = {}): SoundHandle | null {
    if (options.ambient && !this.ambientEnabled()) return null;
    const channel = options.channel ?? "effect";
    const pcm = loadPcm(archive.mohawk, id);
    if (channel === "voice" && this.voice) this.stop(this.voice);
    const handle: SoundHandle = {
      id,
      kind: "wave",
      channel,
      ambient: options.ambient ?? false,
      wave: this.audio.playWave(pcm, options.loop ?? false),
      stopped: false,
    };
    this.waves.add(handle);
    if (channel === "voice") this.voice = handle;
    return handle;
  }

  /** Joue un MIDI ; la musique précédente est remplacée. `loop` : boucle (musiques de fond). */
  playMusic(archive: WaveArchive, id: number, options: PlaySoundOptions = {}): SoundHandle | null {
    if (options.ambient && !this.ambientEnabled()) return null;
    const { song, programs } = loadSong(archive.mohawk, id);
    return this.start(id, song, { loop: options.loop ?? false, programs, ambient: options.ambient, onEnd: options.onEnd });
  }

  /**
   * Joue un morceau déjà décodé avec les options du séquenceur (réécriture, tempo, repères `onMarker`, `onEnd`, boucle). Même séquenceur et
   * mêmes règles que `playMusic` : remplace la musique en cours, coupé par `stop` / `stopMusic` / `releaseAll` (et `stopAmbient` si `ambient`),
   * avancé par `tick()`. Renvoie `null` si `ambient` est demandé alors que la préférence est coupée.
   *
   * `restartMusic` rejoue aussi ce morceau avec les mêmes options (donc la même réécriture) quand le synthétiseur devient prêt : les repères
   * déjà passés sont signalés de nouveau et `onEnd` n'arrive qu'une fois, à la fin de la lecture rejouée.
   */
  playSong(song: Song, options: PlaySongOptions = {}): SoundHandle | null {
    if (options.ambient && !this.ambientEnabled()) return null;
    return this.start(-1, song, options);
  }

  private start(id: number, song: Song, options: PlaySongOptions): SoundHandle {
    this.stopMusic();
    const handle: SoundHandle = { id, kind: "midi", channel: "effect", ambient: options.ambient ?? false, wave: -1, stopped: false };
    this.music = handle;
    this.musicRequest = { song, options };
    this.startSequencer(handle, song, options);
    return handle;
  }

  /**
   * Rejoue depuis le début la dernière musique demandée, avec la même poignée, si elle est toujours voulue (ni `stopMusic`, ni fin,
   * ni `releaseAll` depuis). Sert quand le synthétiseur devient prêt après la demande : les messages MIDI envoyés avant étaient perdus.
   */
  restartMusic(): void {
    const request = this.musicRequest;
    const handle = this.music;
    if (!request || !handle || handle.stopped) return;
    this.startSequencer(handle, request.song, request.options);
  }

  private startSequencer(handle: SoundHandle, song: Song, options: PlaySongOptions): void {
    this.player.play(song, {
      ...options,
      onEnd: () => {
        handle.stopped = true;
        if (this.music === handle) {
          this.music = null;
          this.musicRequest = null;
        }
        options.onEnd?.();
      },
    });
  }

  /** Le son joue encore (WAVE : sort réellement ; MIDI : séquenceur actif). */
  isPlaying(handle: SoundHandle | null | undefined): boolean {
    if (!handle || handle.stopped) return false;
    if (handle.kind === "midi") return this.music === handle && this.player.playing;
    const playing = this.audio.isWavePlaying(handle.wave);
    if (!playing) this.forget(handle);
    return playing;
  }

  /** Au moins un des sons est en cours (attente de fin de tous les sons d'un écran, drapeau 4 des animations). */
  anyPlaying(handles: Iterable<SoundHandle>): boolean {
    for (const handle of handles) if (this.isPlaying(handle)) return true;
    return false;
  }

  get voicePlaying(): boolean {
    return this.isPlaying(this.voice);
  }

  get musicPlaying(): boolean {
    return this.isPlaying(this.music);
  }

  stop(handle: SoundHandle | null | undefined): void {
    if (!handle || handle.stopped) return;
    if (handle.kind === "midi") {
      if (this.music === handle) this.stopMusic();
      return;
    }
    this.audio.stopWave(handle.wave);
    this.forget(handle);
  }

  stopVoice(): void {
    this.stop(this.voice);
  }

  /** Coupe tous les WAVE (la musique continue). */
  stopAll(): void {
    for (const handle of [...this.waves]) this.stop(handle);
  }

  stopMusic(): void {
    if (!this.music) return;
    const handle = this.music;
    this.music = null;
    this.musicRequest = null;
    handle.stopped = true;
    this.player.stop();
  }

  /** Coupe les sons et la musique marqués `ambient` (la préférence vient d'être décochée). */
  stopAmbient(): void {
    for (const handle of [...this.waves]) if (handle.ambient) this.stop(handle);
    if (this.music?.ambient) this.stopMusic();
  }

  /** Tempo et séquenceur : à appeler à chaque tick du moteur. */
  tick(): void {
    this.player.tick();
  }

  // --- Préchargement ---

  /** Convertit les WAVE de `ids` maintenant (les MIDI et les ids absents sont ignorés). */
  preload(archive: WaveArchive, ids: readonly number[]): PreloadSet {
    const kept: number[] = [];
    for (const id of ids) {
      const bytes = archive.mohawk.find(TAG_SND, id);
      if (!bytes || isMidi(bytes)) continue;
      loadPcm(archive.mohawk, id);
      kept.push(id);
    }
    const set: PreloadSet = {
      ids: kept,
      release: () => {
        this.preloads.delete(set);
      },
    };
    this.preloads.add(set);
    return set;
  }

  /** Précharge la liste de sons d'un écran (`SNDL` de même id que le `SCR`, ou de la dizaine pour le Bowling). */
  preloadSndl(archive: WaveArchive & { sndl(id: number): number[] }, sndlId: number): PreloadSet {
    return this.preload(archive, archive.sndl(sndlId));
  }

  /** Nombre d'ensembles préchargés encore tenus (tests, débogage). */
  get preloadedSets(): number {
    return this.preloads.size;
  }

  /** Libère tout : à la sortie d'une scène (`leave`). Coupe les WAVE et la musique. */
  releaseAll(): void {
    this.stopAll();
    this.stopMusic();
    this.preloads.clear();
    this.voice = null;
  }

  private forget(handle: SoundHandle): void {
    handle.stopped = true;
    this.waves.delete(handle);
    if (this.voice === handle) this.voice = null;
  }
}

export const SOUND = defineService<SoundService>("mathemagique.sound");
