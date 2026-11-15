import { createMonoBuffer, s8ToFloat32 } from "../../../audio/pcm";
import { WebOpl } from "../../../audio/web-opl";
import { type Sample, type SampleVoice, WebSampleOutput } from "../../../audio/web-sample-output";
import type { Mutable, SoundBackend } from "./backend";
import { ADL_TICKS_PER_SECOND } from "./adlib/adl-player";
import { OplAdlibOutput } from "./adlib/output";
import { SPEAKER_GAIN, type SpeakerOutput } from "./pcspeaker";

/**
 * Haut-parleur du PC : un oscillateur carré (PCSpeakerStream::generateSquare de ScummVM, `audio/softsynth/pcspk.cpp`)
 * au volume par défaut de ScummVM, branché sur le gain général (préférence Son, pause).
 */
class WebSpeakerOutput implements SpeakerOutput {
  private osc: OscillatorNode | null = null;
  private frequency = 0;

  constructor(private readonly connection: () => { ctx: AudioContext; master: AudioNode }) {}

  play(frequency: number, durationMs: number): void {
    this.silence();
    const { ctx, master } = this.connection();
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.value = SPEAKER_GAIN;
    osc.connect(gain).connect(master);
    osc.onended = () => {
      gain.disconnect();
      if (this.osc === osc) this.osc = null;
    };
    osc.start();
    if (Number.isFinite(durationMs)) osc.stop(ctx.currentTime + durationMs / 1000);
    this.osc = osc;
    this.frequency = frequency;
  }

  stop(delayMs: number): void {
    if (delayMs <= 0) {
      this.silence();
      return;
    }
    // Une note déjà finie que l'attente prolonge (PCSpeakerStream::stop) : on la rejoue.
    if (!this.osc) {
      if (this.frequency > 0) this.play(this.frequency, delayMs);
      return;
    }
    this.osc.stop(this.osc.context.currentTime + delayMs / 1000);
  }

  private silence(): void {
    const osc = this.osc;
    this.osc = null;
    if (!osc) return;
    try {
      osc.stop();
    } catch {
      // déjà arrêté
    }
  }
}

/**
 * Effets sonores via Web Audio (sorties des sons de `sound.ts`, d'après ScummVM `engines/gob/sound/`). Le contexte ne démarre qu'après une interaction (règle des
 * navigateurs) : appeler `unlock()` depuis un gestionnaire d'événement utilisateur.
 *
 * Le contexte, le gain général (mute), la suspension de l'onglet et la lecture de l'échantillon courant (`playSample`) sont ceux de
 * `WebSampleOutput` (commun aux jeux). Reste propre à ce moteur la file de lecture planifiée (`queuePcm`, sur l'horloge du
 * contexte). La musique AdLib passe par la sortie OPL commune (`WebOpl`, son propre contexte, comme la musique de BASS) :
 * coupure, suspension, déblocage et fermeture suivent ceux des effets.
 */
export class WebAudioSoundBackend implements SoundBackend, Mutable {
  private readonly output = new WebSampleOutput({ now: () => performance.now() });
  private voice: SampleVoice | null = null;
  private queued: AudioBufferSourceNode[] = [];
  private queueEnd = 0;
  private readonly samples = new WeakMap<Int8Array, Sample>();
  private readonly queueBuffers = new WeakMap<Float32Array, AudioBuffer>();
  /** Puce OPL2 de la musique : AudioWorklet commun, écritures datées à 1 000 ticks par seconde. */
  private readonly opl = new WebOpl({ tickRate: ADL_TICKS_PER_SECOND });
  /** Musique AdLib : lecteur ADL sur le fil principal, cadencé par l'horloge du jeu (`update`). */
  readonly adlib: OplAdlibOutput;
  readonly speaker: SpeakerOutput = new WebSpeakerOutput(() => this.output.connection());

  /** `now` : horloge du jeu en millisecondes (arrêtée pendant la pause), qui cadence la musique AdLib. */
  constructor(options: { now: () => number }) {
    this.adlib = new OplAdlibOutput(this.opl, options.now);
  }

  /** Fait avancer la musique AdLib sur l'horloge du jeu : à appeler à chaque image. */
  update(): void {
    this.adlib.update();
  }

  /** À appeler de façon synchrone dans un geste utilisateur : crée puis reprend les contextes. */
  unlock(): void {
    this.output.unlock();
    this.opl.unlock();
  }

  suspend(): void {
    this.output.suspend();
    this.opl.suspend();
  }

  resume(): void {
    this.output.resume();
    this.opl.resume();
  }

  /** Libère les contextes audio (page du jeu quittée) : musique AdLib, haut-parleur et échantillons se taisent. */
  close(): void {
    this.clearQueue();
    this.voice = null;
    this.adlib.unload();
    this.output.close();
    this.opl.close();
  }

  get muted(): boolean {
    return this.output.muted;
  }

  set muted(value: boolean) {
    this.output.setMuted(value);
    this.opl.setMuted(value);
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
