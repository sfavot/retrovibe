import type { Sample } from "../../../audio/web-sample-output";

/**
 * Voix et effets de *Flight of the Amazon Queen* : fichiers `voices/<NOM>.mp3` (MP3 mono 24 kb/s, décision D1 de
 * `docs/fotaq/plan.md`, convertis des `.SB` Ogg d'origine), décodés par le navigateur (`WebSampleOutput.decode`, évolution M4)
 * et gardés en cache.
 *
 * Nom d'un son (`PCSound::playSound`, `engines/queen/sound.cpp`, lu) : les espaces du nom calculé par le moteur deviennent des
 * `0` ; la casse est relevée (fichiers en majuscules, `files.json` insensible à la casse).
 *
 * Écarts avec ScummVM, qui lit et joue le fichier sur-le-champ : le décodage est asynchrone. Le moteur ne le voit pas : un son
 * en cours de chargement compte comme actif (`SampleChannel.active`), puis dure sa vraie durée à partir du début de la lecture,
 * avec une limite d'attente (`LOAD_TIMEOUT_MS`) pour qu'un fichier perdu ne bloque jamais une réplique. Le préchargement
 * (`preload`, par scène : vague T) évite l'attente.
 */

/** Accès aux octets des sons, fourni par l'hôte. */
export interface SoundFiles {
  /** Le son existe (liste de `files.json`, synchrone). `name` est un nom de fichier sans extension, en majuscules. */
  has(name: string): boolean;
  /** Octets du fichier MP3. */
  load(name: string): Promise<Uint8Array>;
}

/** Décodeur : `WebSampleOutput.decode`. */
export interface SampleDecoder {
  decode(bytes: Uint8Array): Promise<Sample>;
}

/** Nom de fichier d'un son : espaces remplacés par `0`, majuscules. */
export function soundFileName(base: string): string {
  return base.replaceAll(" ", "0").toUpperCase();
}

/** Mémoire de voix décodées : au-delà, les moins récemment utilisées sont oubliées (rechargées au besoin). */
const CACHE_LIMIT_FLOATS = 12_000_000;
/** Chargements simultanés d'un préchargement. */
const PRELOAD_PARALLEL = 4;
/** Attente maximale d'un son (ms) avant de le laisser tomber. */
export const LOAD_TIMEOUT_MS = 5000;

export class VoiceBank {
  private readonly cache = new Map<string, Sample>();
  private cachedFloats = 0;
  private readonly loading = new Map<string, Promise<Sample | null>>();

  constructor(
    private readonly files: SoundFiles,
    private readonly decoder: SampleDecoder,
  ) {}

  has(name: string): boolean {
    return this.files.has(name);
  }

  /** Échantillon déjà décodé, ou `undefined` (sans lancer de chargement). */
  peek(name: string): Sample | undefined {
    const sample = this.cache.get(name);
    if (sample) {
      // Réinsère en dernier : le plus récent.
      this.cache.delete(name);
      this.cache.set(name, sample);
    }
    return sample;
  }

  /** Charge et décode un son ; `null` si le fichier manque, est illisible ou ne se décode pas (jamais une erreur). */
  sample(name: string): Promise<Sample | null> {
    const cached = this.peek(name);
    if (cached) return Promise.resolve(cached);
    if (!this.files.has(name)) return Promise.resolve(null);
    let pending = this.loading.get(name);
    if (!pending) {
      pending = this.files
        .load(name)
        .then((bytes) => this.decoder.decode(bytes))
        .then((sample) => {
          this.remember(name, sample);
          return sample;
        })
        .catch(() => null)
        .finally(() => this.loading.delete(name));
      this.loading.set(name, pending);
    }
    return pending;
  }

  private remember(name: string, sample: Sample): void {
    this.cache.set(name, sample);
    this.cachedFloats += sample.data.length;
    for (const [oldest, old] of this.cache) {
      if (this.cachedFloats <= CACHE_LIMIT_FLOATS || oldest === name) break;
      this.cache.delete(oldest);
      this.cachedFloats -= old.data.length;
    }
  }

  /** Précharge des sons (noms de fichiers) ; rend le nombre de sons disponibles à la fin. */
  async preload(names: Iterable<string>): Promise<number> {
    const queue = [...new Set([...names].map(soundFileName))].filter((name) => this.files.has(name));
    let loaded = 0;
    const worker = async (): Promise<void> => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) if (await this.sample(name)) loaded++;
    };
    await Promise.all(Array.from({ length: Math.min(PRELOAD_PARALLEL, queue.length) }, worker));
    return loaded;
  }

  /** Oublie les sons décodés. */
  clear(): void {
    this.cache.clear();
    this.cachedFloats = 0;
  }
}
