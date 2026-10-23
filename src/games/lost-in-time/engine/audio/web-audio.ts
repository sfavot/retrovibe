import type { SoundBackend } from "./backend";
import { WorkletAdlibOutput } from "./adlib/worklet-output";
import type { Mutable } from "./prefs";

/**
 * Effets sonores via Web Audio. Le contexte ne démarre qu'après une interaction (règle des
 * navigateurs) : appeler `unlock()` depuis un gestionnaire d'événement utilisateur.
 */
export class WebAudioSoundBackend implements SoundBackend, Mutable {
  private ctx: AudioContext | null = null;
  /** Gain général : couper le son passe par lui, pas par l'arrêt des sources (le timing reste identique). */
  private master: GainNode | null = null;
  private mutedFlag = false;
  /** Pause de l'interface (onglet masqué) : le contexte est suspendu, sa propre horloge s'arrête avec. */
  private suspended = false;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private queued: AudioBufferSourceNode[] = [];
  private queueEnd = 0;
  private readonly buffers = new WeakMap<Int8Array, AudioBuffer>();
  /** Musique AdLib : synthèse dans un AudioWorklet, branchée sur le même gain général (mute, pause). */
  readonly adlib = new WorkletAdlibOutput();

  constructor() {
    // Une musique AdLib demandée avant tout geste crée le contexte (suspendu), le prochain geste le reprend
    this.adlib.ensureContext = () => this.ensure();
  }

  /** Crée le contexte, le gain général et le worklet AdLib une seule fois. */
  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedFlag ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.adlib.attach(this.ctx, this.master);
      if (this.suspended) void this.ctx.suspend();
    }
    return this.ctx;
  }

  /** À appeler de façon synchrone dans un geste utilisateur : crée puis reprend le contexte. */
  unlock(): void {
    const ctx = this.ensure();
    if (!this.suspended && ctx.state === "suspended") void ctx.resume();
  }

  suspend(): void {
    this.suspended = true;
    if (this.ctx?.state === "running") void this.ctx.suspend();
  }

  resume(): void {
    this.suspended = false;
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  set muted(value: boolean) {
    this.mutedFlag = value;
    if (this.master) this.master.gain.value = value ? 0 : 1;
  }

  private buffer(ctx: AudioContext, pcm: Int8Array, rate: number): AudioBuffer {
    let buffer = this.buffers.get(pcm);
    if (buffer && buffer.sampleRate === rate) return buffer;
    // AudioContext.createBuffer exige au moins 3000 Hz
    buffer = ctx.createBuffer(1, pcm.length, Math.max(3000, rate));
    const out = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 128;
    this.buffers.set(pcm, buffer);
    return buffer;
  }

  playSample(pcm: Int8Array, rate: number, passes: number): void {
    this.stopSample(0);
    const ctx = this.ensure();
    if (pcm.length === 0) return;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(ctx, pcm, rate);
    const gain = ctx.createGain();
    source.connect(gain).connect(this.master ?? ctx.destination);
    source.loop = passes > 1;
    if (passes === Infinity) source.start();
    else source.start(0, 0, source.buffer!.duration * passes);
    this.source = source;
    this.gain = gain;
  }

  stopSample(fadeSeconds: number): void {
    const { ctx, source, gain } = this;
    if (!source) return;
    if (fadeSeconds > 0 && ctx && gain) {
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeSeconds);
      source.stop(ctx.currentTime + fadeSeconds);
      return;
    }
    try {
      source.stop();
    } catch {
      // déjà arrêté
    }
    this.source = null;
    this.gain = null;
  }

  queuePcm(pcm: Int8Array, rate: number): void {
    const ctx = this.ensure();
    if (pcm.length === 0) return;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(ctx, pcm, rate);
    source.connect(this.master ?? ctx.destination);
    this.queueEnd = Math.max(this.queueEnd, ctx.currentTime + 0.05);
    source.start(this.queueEnd);
    this.queueEnd += source.buffer.duration;
    this.queued.push(source);
    source.onended = () => {
      this.queued = this.queued.filter((s) => s !== source);
    };
  }

  clearQueue(): void {
    for (const source of this.queued) {
      try {
        source.stop();
      } catch {
        // déjà arrêté
      }
    }
    this.queued = [];
    this.queueEnd = 0;
  }
}
