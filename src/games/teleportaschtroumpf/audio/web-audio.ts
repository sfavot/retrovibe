import type { AudioBackend, PcmSound } from "./backend";

/**
 * Voie son via Web Audio. Le contexte n'est créé qu'après un geste de l'utilisateur (`unlock()`), comme
 * l'exigent les navigateurs ; avant cela, `play` ne fait rien et `playing` reste faux.
 */
export class WebAudioBackend implements AudioBackend {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private duration = 0;
  private looping = false;
  private active = false;
  private gain = 1;
  private readonly buffers = new WeakMap<Uint8Array, AudioBuffer>();

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.gain;
      this.gainNode.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private buffer(ctx: AudioContext, sound: PcmSound): AudioBuffer {
    let buffer = this.buffers.get(sound.samples);
    if (buffer) return buffer;
    // `createBuffer` exige au moins 3000 Hz.
    buffer = ctx.createBuffer(1, sound.samples.length, Math.max(3000, sound.sampleRate));
    const out = buffer.getChannelData(0);
    for (let i = 0; i < out.length; i++) out[i] = (sound.samples[i] - 128) / 128;
    this.buffers.set(sound.samples, buffer);
    return buffer;
  }

  play(sound: PcmSound, loop: boolean): void {
    this.stop();
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.gainNode || sound.samples.length === 0) return;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(ctx, sound);
    source.loop = loop;
    source.connect(this.gainNode);
    source.onended = () => {
      if (this.source === source) this.active = false;
    };
    source.start();
    this.source = source;
    this.startedAt = ctx.currentTime;
    this.duration = source.buffer.duration;
    this.looping = loop;
    this.active = true;
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    this.active = false;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // déjà arrêté
    }
  }

  get playing(): boolean {
    return this.active && this.ctx?.state === "running";
  }

  get position(): number {
    if (!this.active || !this.ctx) return 0;
    const elapsed = this.ctx.currentTime - this.startedAt;
    return this.looping && this.duration > 0 ? elapsed % this.duration : Math.min(elapsed, this.duration);
  }

  setGain(gain: number): void {
    this.gain = gain;
    if (this.gainNode) this.gainNode.gain.value = gain;
  }
}
