import type { RiffWave } from "../../../data/riff-wave";
import type { BufferHandle, PlayOptions, SoundSink, VoiceHandle } from "../audio";

/** Sortie audio dont le gain est multiplié par un facteur réglable : « Volume principal » × « Volume des effets son » (§4.6). */
export class VolumeSink implements SoundSink {
  private scale = 1;

  constructor(private readonly inner: SoundSink) {}

  /** Facteur linéaire de 0 à 1 ; il s'applique aux sons joués ensuite et aux changements de gain en cours. */
  setScale(scale: number): void {
    this.scale = scale;
  }

  createBuffer(wave: RiffWave): BufferHandle {
    return this.inner.createBuffer(wave);
  }

  play(buffer: BufferHandle, options: PlayOptions): VoiceHandle {
    return this.inner.play(buffer, { ...options, gain: options.gain * this.scale });
  }

  setGain(voice: VoiceHandle, gain: number): void {
    this.inner.setGain(voice, gain * this.scale);
  }

  setPan(voice: VoiceHandle, pan: number): void {
    this.inner.setPan(voice, pan);
  }

  setRate(voice: VoiceHandle, rate: number): void {
    this.inner.setRate(voice, rate);
  }

  stop(voice: VoiceHandle): void {
    this.inner.stop(voice);
  }

  setMuted(muted: boolean): void {
    this.inner.setMuted(muted);
  }
}
