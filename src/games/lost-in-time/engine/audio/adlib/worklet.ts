/**
 * AudioWorklet de la musique AdLib : la synthèse tourne hors du fil principal, au rythme de la
 * carte son (donc figée avec le contexte quand l'onglet est masqué). Compilé à part par Vite
 * (import `?worker&url` dans worklet-output.ts).
 */
import { AdlibSynth } from "./synth";
import type { AdlibCommand, AdlibEvent } from "./protocol";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class AdlibProcessor extends AudioWorkletProcessor {
  private readonly synth = new AdlibSynth(sampleRate);
  /** Numéro de la lecture en cours, renvoyé à la fin pour écarter les fins périmées. */
  private seq = 0;

  constructor() {
    super();
    this.synth.onStopped = () => this.post({ type: "stopped", seq: this.seq });
    this.port.onmessage = (e: MessageEvent<AdlibCommand>) => {
      const cmd = e.data;
      switch (cmd.type) {
        case "load":
          this.synth.load(cmd.data);
          break;
        case "unload":
          this.synth.unload();
          break;
        case "repeat":
          this.synth.setRepeating(cmd.count);
          break;
        case "play":
          this.seq = cmd.seq;
          this.synth.play();
          break;
        case "stop":
          this.synth.stop();
          break;
      }
    };
  }

  private post(event: AdlibEvent): void {
    this.port.postMessage(event);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    if (!channels?.length) return true;
    this.synth.render(channels[0]);
    for (let c = 1; c < channels.length; c++) channels[c].set(channels[0]);
    return true;
  }
}

registerProcessor("lit-adlib", AdlibProcessor);
