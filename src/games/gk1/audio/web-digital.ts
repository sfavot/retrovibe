/**
 * Sortie Web Audio de l'audio numérique de Gabriel Knight (`DigitalOutput` de `digital.ts`), branchée sur la sortie commune
 * `WebSampleOutput` : même contexte, même gain général (son coupé, volume, onglet masqué), même décodeur MP3.
 *
 * Chaque voix a sa source et son gain, posés sur le gain général (`WebSampleOutput.connection()`), parce que le jeu change le
 * volume d'un son en cours (fondus de `DoSound`) et le met en pause, ce que `WebSampleOutput.play` ne permet pas. La durée
 * d'un son, elle, est comptée par `digital.ts` sur l'horloge du jeu : rien ici ne la décide.
 *
 * Tant que le contexte n'est pas débloqué par un geste (`WebSampleOutput.unlock()`), `play` ne produit aucun son : une source
 * lancée sur un contexte suspendu partirait en retard, au premier clic.
 */
import { createMonoBuffer } from "../../../audio/pcm";
import type { Sample, WebSampleOutput } from "../../../audio/web-sample-output";
import type { DigitalOutput, DigitalVoice } from "./digital";

const SILENT: DigitalVoice = { stop: () => {}, setVolume: () => {}, pause: () => {} };

class WebVoice implements DigitalVoice {
  private source: AudioBufferSourceNode | undefined;
  /** Position de reprise dans le son, en secondes. */
  private offset = 0;
  private startedAt = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly gain: GainNode,
    private readonly loop: boolean,
  ) {
    this.start();
  }

  private start(): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.loop;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = undefined;
      source.disconnect();
      this.gain.disconnect();
    };
    this.startedAt = this.ctx.currentTime;
    source.start(0, this.offset);
    this.source = source;
  }

  private halt(): AudioBufferSourceNode | undefined {
    const source = this.source;
    this.source = undefined;
    if (!source) return undefined;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // déjà arrêtée
    }
    source.disconnect();
    return source;
  }

  stop(): void {
    this.halt();
    this.gain.disconnect();
  }

  setVolume(gain: number): void {
    this.gain.gain.value = gain;
  }

  pause(paused: boolean): void {
    if (paused) {
      if (!this.halt()) return;
      const played = this.offset + this.ctx.currentTime - this.startedAt;
      this.offset = this.loop ? played % this.buffer.duration : played;
    } else if (!this.source && this.offset < this.buffer.duration) this.start();
  }
}

/** Sortie de l'audio numérique sur `output`. */
export function webDigitalOutput(output: WebSampleOutput): DigitalOutput {
  const buffers = new WeakMap<Float32Array, AudioBuffer>();
  return {
    decode: (bytes) => output.decode(bytes),
    play(sample: Sample, options): DigitalVoice {
      const { ctx, master } = output.connection();
      if (ctx.state !== "running" || sample.data.length === 0) return SILENT;
      let buffer = buffers.get(sample.data);
      if (!buffer) buffers.set(sample.data, (buffer = createMonoBuffer(ctx, sample.data, sample.rate)));
      const gain = ctx.createGain();
      gain.gain.value = options.volume;
      gain.connect(master);
      return new WebVoice(ctx, buffer, gain, options.loop);
    },
  };
}
