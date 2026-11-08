/**
 * AudioWorklet de la sortie OPL2 commune : l'émulateur (celui de Lost in Time, `Opl2`) tourne hors du fil principal,
 * au rythme de la carte son, et reçoit les écritures horodatées par tick (`OplStream`). Compilé à part par Vite
 * (import `?worker&url` dans web-opl.ts).
 */
import { Opl2 } from "./opl2";
import { OPL_TICK_RATE, OPL_WORKLET_NAME, OplStream, type OplMessage, type OplWorkletOptions } from "./opl-stream";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: new (options?: any) => AudioWorkletProcessor): void;

class OplProcessor extends AudioWorkletProcessor {
  private readonly stream: OplStream;

  constructor(options?: { processorOptions?: Partial<OplWorkletOptions> }) {
    super(options);
    this.stream = new OplStream(sampleRate, new Opl2(sampleRate), options?.processorOptions?.tickRate ?? OPL_TICK_RATE);
    this.port.onmessage = (e: MessageEvent<OplMessage | "clear">) => {
      if (e.data === "clear") this.stream.clear();
      else this.stream.schedule(e.data.tick, e.data.writes);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    if (!channels?.length) return true;
    this.stream.render(channels[0]);
    for (let c = 1; c < channels.length; c++) channels[c].set(channels[0]);
    return true;
  }
}

registerProcessor(OPL_WORKLET_NAME, OplProcessor);
