import { u8ToFloat32 } from "../../../audio/pcm";
import type { Sample, SampleVoice, WebSampleOutput } from "../../../audio/web-sample-output";
import { ALS_SAMPLE_RATE, alsSamples } from "../data/als";

/**
 * Voie unique des voix et effets `.ALS`. Reprend `playFile`, `stopSound` et `soundIsActive` (engines/drascula/sound.cpp,
 * ScummVM) : un seul son à la fois (`_soundHandle`), un nouveau son remplace l'ancien ; les 32 octets de silence de chaque bout
 * et le contournement de `3.ALS` viennent de `data/als.ts`.
 *
 * Écarts : le son est « en cours » dès `play`, même si le fichier se charge en différé (l'hôte du navigateur ne précharge pas
 * les 783 sons) ; une erreur de chargement ou de décodage libère la voie au lieu de la laisser occupée. Le temps d'un son
 * est celui de l'horloge du jeu (`WebSampleOutput`), pas celui du navigateur : voir ce module pour la coupure du son.
 */

/** Accès aux fichiers `.ALS` ; le chargement peut être synchrone (fichier préchargé) ou différé. */
export interface SoundFiles {
  /** Le fichier existe-t-il (nom en casse arbitraire) ? Synchrone : `playSound` rend faux s'il manque. */
  has(name: string): boolean;
  load(name: string): Uint8Array | Promise<Uint8Array>;
}

/** Sons décodés gardés en mémoire (une voix décodée pèse 4 fois son fichier). */
const DECODED_CACHE = 8;

export class SoundChannel {
  private token = 0;
  /** Chargement en cours du son demandé en dernier. */
  private loading = false;
  private voice: SampleVoice | null = null;
  private readonly decoded = new Map<string, Sample>();

  constructor(
    private readonly output: WebSampleOutput,
    private readonly files: SoundFiles,
  ) {}

  /** Joue `name` en remplaçant le son en cours ; faux si le fichier n'existe pas (et la voie est alors libre). */
  play(name: string): boolean {
    this.stop();
    if (!this.files.has(name)) return false;
    const token = this.token;
    const key = name.toLowerCase();
    const cached = this.decoded.get(key);
    if (cached) {
      this.start(cached);
      return true;
    }
    let loaded: Uint8Array | Promise<Uint8Array>;
    try {
      loaded = this.files.load(name);
    } catch {
      return false;
    }
    if (loaded instanceof Uint8Array) return this.decode(key, name, loaded, token);
    this.loading = true;
    loaded.then(
      (bytes) => {
        if (token === this.token) this.decode(key, name, bytes, token);
      },
      () => {
        if (token === this.token) this.loading = false;
      },
    );
    return true;
  }

  private decode(key: string, name: string, bytes: Uint8Array, token: number): boolean {
    if (token !== this.token) return true;
    this.loading = false;
    let sample: Sample;
    try {
      sample = { data: u8ToFloat32(alsSamples(bytes, name)), rate: ALS_SAMPLE_RATE };
    } catch {
      return false;
    }
    if (this.decoded.size >= DECODED_CACHE) this.decoded.delete(this.decoded.keys().next().value as string);
    this.decoded.set(key, sample);
    this.start(sample);
    return true;
  }

  private start(sample: Sample): void {
    this.voice = this.output.play(sample);
  }

  /** `stopSound` : arrête le son et annule un chargement en cours. */
  stop(): void {
    this.token++;
    this.loading = false;
    this.voice?.stop();
    this.voice = null;
  }

  /** `soundIsActive` : un son est demandé et pas encore fini. */
  get active(): boolean {
    return this.loading || (this.voice?.playing ?? false);
  }
}
