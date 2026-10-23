import type { AdlibOutput } from "../backend";
import type { AdlibCommand, AdlibEvent } from "./protocol";
import workletUrl from "./worklet.ts?worker&url";

/**
 * Pont vers l'AudioWorklet AdLib. Tant que le contexte audio n'existe pas (avant le premier geste
 * de l'utilisateur) ou que le module charge, l'état demandé est gardé puis rejoué à la connexion.
 */
export class WorkletAdlibOutput implements AdlibOutput {
  onStopped: (() => void) | null = null;
  private node: AudioWorkletNode | null = null;
  private attaching = false;
  private data: Uint8Array | null = null;
  private repeating = 0;
  private wantPlay = false;
  private seq = 0;
  /** Crée le contexte audio à la demande (appelé quand un morceau est demandé sans contexte). */
  ensureContext: (() => void) | null = null;

  /** Crée le worklet dans `ctx`, sa sortie va vers `destination`. */
  attach(ctx: AudioContext, destination: AudioNode): void {
    if (this.node || this.attaching) return;
    this.attaching = true;
    ctx.audioWorklet.addModule(workletUrl).then(
      () => {
        const node = new AudioWorkletNode(ctx, "lit-adlib", { numberOfInputs: 0, outputChannelCount: [2] });
        node.port.onmessage = (e: MessageEvent<AdlibEvent>) => {
          // une fin qui vient d'une lecture déjà remplacée ne compte plus
          if (e.data.type === "stopped" && e.data.seq === this.seq) {
            this.wantPlay = false;
            this.onStopped?.();
          }
        };
        node.connect(destination);
        this.node = node;
        this.replay();
      },
      (error) => console.warn("Musique AdLib indisponible", error),
    );
  }

  private send(cmd: AdlibCommand): void {
    if (!this.node && !this.attaching) this.ensureContext?.();
    this.node?.port.postMessage(cmd);
  }

  /** Rejoue l'état demandé dans un worklet tout neuf. */
  private replay(): void {
    if (this.data) this.send({ type: "load", data: this.data });
    this.send({ type: "repeat", count: this.repeating });
    if (this.wantPlay) this.send({ type: "play", seq: this.seq });
  }

  load(data: Uint8Array): void {
    this.data = data;
    this.wantPlay = false;
    this.repeating = 0; // le chargement décharge d'abord l'ancien morceau (stopPlay)
    this.send({ type: "load", data });
  }

  unload(): void {
    this.data = null;
    this.wantPlay = false;
    this.repeating = 0;
    this.send({ type: "unload" });
  }

  setRepeating(count: number): void {
    this.repeating = count;
    this.send({ type: "repeat", count });
  }

  play(): void {
    this.wantPlay = true;
    this.seq++;
    this.send({ type: "play", seq: this.seq });
  }

  stop(): void {
    this.wantPlay = false;
    this.repeating = 0;
    this.send({ type: "stop" });
  }
}
