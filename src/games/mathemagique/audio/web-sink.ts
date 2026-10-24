/**
 * `AudioSink` pour le navigateur : Web Audio pour les WAVE, `spessasynth_lib` (soundfont General MIDI) pour le MIDI.
 *
 * - Le contexte n'est créé qu'au premier `unlock()` (geste de l'utilisateur). Avant, `now()` vaut 0 et rien ne sort.
 * - WAVE : un `AudioBufferSourceNode` par voix (plusieurs en même temps, boucle, détection de fin par `onended`).
 * - MIDI : le synthétiseur (`WorkletSynthesizer`) est créé après `unlock()` ; la soundfont réduite se charge en tâche de fond
 *   (`scripts/mathemagique/soundfont.mts`). Tant qu'il n'est pas prêt, les messages MIDI sont ignorés sans erreur.
 * - Les messages MIDI datés partent vers le worklet au plus `FLUSH_WINDOW_MS` avant leur heure : le worklet ne sait pas
 *   annuler un message planifié, alors que `reset()` doit pouvoir couper net ce que le séquenceur a planifié d'avance.
 * - Muet = gain maître à 0 (WAVE et MIDI) ; la lecture continue, comme le moteur l'attend.
 */
import { WorkletSynthesizer } from "spessasynth_lib";
// Le processeur du worklet est un fichier à part : `?url` le fait copier par Vite dans les assets (chemin relatif à `base`).
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import type { AudioSink, MidiSink, PcmSound, WaveHandle } from "./sink";

/** Soundfont réduite, servie par `publicDir` (`original/mathemagique/`). */
export const SOUNDFONT_URL = `${import.meta.env.BASE_URL}mathemagique/mathemagique-gm.sf2`;

/** Au plus cette avance (ms) entre l'envoi au worklet et l'heure d'un message. */
const FLUSH_WINDOW_MS = 30;
const FLUSH_INTERVAL_MS = 8;

export interface WebAudioSinkOptions {
  soundfontUrl?: string;
  /** Crée le contexte audio (par défaut `new AudioContext()`), pour les essais. */
  createContext?: () => AudioContext;
}

interface QueuedMessage {
  at: number;
  message: Uint8Array;
}

export class WebAudioSink implements AudioSink {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private suspended = false;
  private resuming = 0;
  private transition: Promise<unknown> = Promise.resolve();
  private transitions = 0;

  private nextHandle = 1;
  private readonly voices = new Map<WaveHandle, AudioBufferSourceNode>();
  private readonly buffers = new WeakMap<PcmSound, AudioBuffer>();

  private synth: WorkletSynthesizer | null = null;
  private midiReady = false;
  private midiStarted = false;
  private queue: QueuedMessage[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  readonly midi: MidiSink = {
    send: (message, atMs) => this.sendMidi(message, atMs),
    reset: () => this.resetMidi(),
  };

  constructor(private readonly options: WebAudioSinkOptions = {}) {}

  unlock(): void {
    if (!this.ctx) {
      this.ctx = this.options.createContext?.() ?? new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended" && !this.suspended) this.startResume(this.ctx);
    if (!this.midiStarted) {
      this.midiStarted = true;
      void this.startMidi(this.ctx, this.master!);
    }
  }

  now(): number {
    return (this.ctx?.currentTime ?? 0) * 1000;
  }

  // --- WAVE ---------------------------------------------------------------------------------------------------

  playWave(sound: PcmSound, loop: boolean): WaveHandle {
    const handle = this.nextHandle++;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.master || sound.samples.length === 0) return handle;
    const source = ctx.createBufferSource();
    source.buffer = this.bufferOf(ctx, sound);
    source.loop = loop;
    source.connect(this.master);
    source.onended = () => {
      if (this.voices.get(handle) === source) this.voices.delete(handle);
    };
    this.voices.set(handle, source);
    source.start();
    return handle;
  }

  stopWave(handle: WaveHandle): void {
    const source = this.voices.get(handle);
    if (!source) return;
    this.voices.delete(handle);
    source.onended = null;
    try {
      source.stop();
    } catch {
      // déjà arrêté
    }
  }

  isWavePlaying(handle: WaveHandle): boolean {
    return this.voices.has(handle) && this.live;
  }

  private bufferOf(ctx: AudioContext, sound: PcmSound): AudioBuffer {
    let buffer = this.buffers.get(sound);
    if (!buffer) {
      // `createBuffer` exige au moins 3000 Hz.
      buffer = ctx.createBuffer(1, sound.samples.length, Math.max(3000, sound.sampleRate));
      buffer.copyToChannel(sound.samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(sound, buffer);
    }
    return buffer;
  }

  /** Sortie utilisable : contexte démarré, ou figé / en reprise (les voix y sont seulement en pause). */
  private get live(): boolean {
    return this.ctx?.state === "running" || ((this.suspended || this.resuming > 0) && this.ctx !== null);
  }

  // --- MIDI ---------------------------------------------------------------------------------------------------

  private async startMidi(ctx: AudioContext, output: AudioNode): Promise<void> {
    try {
      await ctx.audioWorklet.addModule(processorUrl);
      const synth = new WorkletSynthesizer(ctx);
      synth.connect(output);
      const response = await fetch(this.options.soundfontUrl ?? SOUNDFONT_URL);
      if (!response.ok) throw new Error(`soundfont : HTTP ${response.status}`);
      await synth.soundBankManager.addSoundBank(await response.arrayBuffer(), "main");
      await synth.isReady;
      this.synth = synth;
      this.midiReady = true;
    } catch (error) {
      // Le jeu reste jouable sans musique MIDI.
      console.warn("Mathémagique : synthétiseur MIDI indisponible", error);
    }
  }

  private sendMidi(message: Uint8Array, atMs?: number): void {
    if (!this.midiReady || !this.synth) return;
    if (atMs === undefined || atMs - this.now() <= FLUSH_WINDOW_MS) {
      this.post(message, atMs);
      return;
    }
    this.queue.push({ at: atMs, message });
    this.queue.sort((a, b) => a.at - b.at);
    this.flushTimer ??= setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private post(message: Uint8Array, atMs?: number): void {
    this.synth?.sendMessage(message, 0, atMs === undefined ? undefined : { time: atMs / 1000 });
  }

  private flush(): void {
    const limit = this.now() + FLUSH_WINDOW_MS;
    while (this.queue.length > 0 && this.queue[0].at <= limit) {
      const { at, message } = this.queue.shift()!;
      this.post(message, at);
    }
    if (this.queue.length === 0 && this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private resetMidi(): void {
    this.queue = [];
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    const synth = this.synth;
    if (!this.midiReady || !synth) return;
    synth.stopAll(true);
    for (let channel = 0; channel < 16; channel++) {
      this.post(Uint8Array.of(0xb0 | channel, 123, 0)); // toutes les notes coupées
      this.post(Uint8Array.of(0xb0 | channel, 121, 0)); // contrôleurs remis à zéro
    }
  }

  // --- Préférence « Son » et cycle de vie ------------------------------------------------------------------------

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  suspend(): void {
    this.suspended = true;
    const ctx = this.ctx;
    if (!ctx) return;
    void this.enqueue(() => (ctx.state === "running" ? ctx.suspend() : undefined));
  }

  resume(): void {
    this.suspended = false;
    if (this.ctx) this.startResume(this.ctx);
  }

  /** Exécute `op` tout de suite si aucune transition n'est en cours, sinon à la suite : le dernier appel gagne. */
  private enqueue(op: () => Promise<void> | undefined): Promise<unknown> {
    const run = (): Promise<unknown> => Promise.resolve(op()).catch(() => undefined);
    this.transitions++;
    this.transition = (this.transitions === 1 ? run() : this.transition.then(run)).finally(() => {
      this.transitions--;
    });
    return this.transition;
  }

  private startResume(ctx: AudioContext): void {
    this.resuming++;
    void this.enqueue(() => ctx.resume()).finally(() => {
      this.resuming--;
    });
  }
}
