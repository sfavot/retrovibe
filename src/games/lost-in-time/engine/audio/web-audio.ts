import { createMonoBuffer, s8ToFloat32 } from "../../../../audio/pcm";
import { type Sample, type SampleVoice, WebSampleOutput } from "../../../../audio/web-sample-output";
import type { SoundBackend } from "./backend";
import { WorkletAdlibOutput } from "./adlib/worklet-output";
import type { Mutable } from "./prefs";

/**
 * Effets sonores via Web Audio. Le contexte ne démarre qu'après une interaction (règle des
 * navigateurs) : appeler `unlock()` depuis un gestionnaire d'événement utilisateur.
 *
 * Le contexte, le gain général (mute), la suspension de l'onglet et la lecture de l'échantillon courant (`playSample`) sont ceux de
 * `WebSampleOutput` (commun aux jeux). Restent propres à ce jeu : la file de lecture planifiée (`queuePcm`, sur l'horloge du
 * contexte) et la musique AdLib (worklet), branchées sur le même contexte et le même gain général.
 */
export class WebAudioSoundBackend implements SoundBackend, Mutable {
  private readonly output = new WebSampleOutput({
    now: () => performance.now(),
    onContext: (ctx, master) => this.adlib.attach(ctx, master),
  });
  private voice: SampleVoice | null = null;
  private queued: AudioBufferSourceNode[] = [];
  private queueEnd = 0;
  private readonly samples = new WeakMap<Int8Array, Sample>();
  private readonly queueBuffers = new WeakMap<Float32Array, AudioBuffer>();
  /** Musique AdLib : synthèse dans un AudioWorklet, branchée sur le même gain général (mute, pause). */
  readonly adlib = new WorkletAdlibOutput();

  constructor() {
    // Une musique AdLib demandée avant tout geste crée le contexte (suspendu), le prochain geste le reprend
    this.adlib.ensureContext = () => this.output.connection();
  }

  /** À appeler de façon synchrone dans un geste utilisateur : crée puis reprend le contexte. */
  unlock(): void {
    this.output.unlock();
  }

  suspend(): void {
    this.output.suspend();
  }

  resume(): void {
    this.output.resume();
  }

  get muted(): boolean {
    return this.output.muted;
  }

  set muted(value: boolean) {
    this.output.setMuted(value);
  }

  private sample(pcm: Int8Array, rate: number): Sample {
    let sample = this.samples.get(pcm);
    if (!sample || sample.rate !== rate) {
      sample = { data: s8ToFloat32(pcm), rate };
      this.samples.set(pcm, sample);
    }
    return sample;
  }

  playSample(pcm: Int8Array, rate: number, passes: number): void {
    this.stopSample(0);
    this.output.connection(); // le contexte existe dès la première demande (suspendu avant le premier geste)
    this.voice = this.output.play(this.sample(pcm, rate), { passes });
  }

  stopSample(fadeSeconds: number): void {
    const voice = this.voice;
    if (!voice) return;
    voice.stop(fadeSeconds);
    if (fadeSeconds <= 0) this.voice = null;
  }

  queuePcm(pcm: Int8Array, rate: number): void {
    const { ctx, master } = this.output.connection();
    if (pcm.length === 0) return;
    const sample = this.sample(pcm, rate);
    let buffer = this.queueBuffers.get(sample.data);
    if (!buffer) {
      buffer = createMonoBuffer(ctx, sample.data, sample.rate);
      this.queueBuffers.set(sample.data, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    this.queueEnd = Math.max(this.queueEnd, ctx.currentTime + 0.05);
    source.start(this.queueEnd);
    this.queueEnd += buffer.duration;
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
