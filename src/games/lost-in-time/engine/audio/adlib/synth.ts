import type { AdlibOutput } from "../backend";
import { AdlPlayer } from "./adl-player";

/**
 * Lecteur ADL + OPL2 prêt à rendre de l'audio : c'est la partie pure (sans navigateur), utilisée
 * telle quelle dans l'AudioWorklet et dans les tests.
 */
export class AdlibSynth implements AdlibOutput {
  onStopped: (() => void) | null = null;
  private readonly player: AdlPlayer;
  /** Échantillons nuls consécutifs en sortie : au-delà d'une seconde à l'arrêt, on ne synthétise plus. */
  private silentRun = 0;

  constructor(readonly sampleRate: number) {
    this.player = new AdlPlayer(sampleRate);
    this.player.onFinished = () => this.onStopped?.();
  }

  load(data: Uint8Array): void {
    this.player.load(data);
  }

  unload(): void {
    this.player.unload();
  }

  setRepeating(count: number): void {
    this.player.setRepeating(count);
  }

  play(): void {
    this.silentRun = 0;
    this.player.startPlay();
  }

  stop(): void {
    this.player.stopPlay();
  }

  get playing(): boolean {
    return this.player.isPlaying();
  }

  get repeating(): number {
    return this.player.getRepeating();
  }

  /** Rend `length` échantillons mono dans `out` ; du silence sans calcul quand plus rien ne sonne. */
  render(out: Float32Array, offset = 0, length = out.length - offset): void {
    if (length <= 0) return;
    if (!this.player.isPlaying() && this.silentRun > this.sampleRate) {
      out.fill(0, offset, offset + length);
      return;
    }
    this.player.render(out, offset, length);
    let silent = 0;
    for (let i = offset + length - 1; i >= offset && out[i] === 0; i--) silent++;
    this.silentRun = silent === length ? this.silentRun + length : silent;
  }
}
