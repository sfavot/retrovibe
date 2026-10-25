/**
 * AudioWorklet de la sortie OPL2 d'Armaeth : l'émulateur (celui de Lost in Time, `Opl2`) tourne hors du fil principal,
 * au rythme de la carte son, et reçoit les écritures horodatées par tick (`OplStream`). Compilé à part par Vite
 * (import `?worker&url` dans web-opl.ts).
 */
import { Opl2 } from "../../../audio/opl2";
import { OplStream, type OplMessage } from "./opl-stream";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class OplProcessor extends AudioWorkletProcessor {
  private readonly stream = new OplStream(sampleRate, new Opl2(sampleRate));

  constructor() {
    super();
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

registerProcessor("armaeth-opl", OplProcessor);
