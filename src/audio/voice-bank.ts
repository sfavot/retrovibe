import type { Sample } from "./web-sample-output";

/**
 * Banque de voix et de sons compressés (MP3), commune aux jeux dont les voix sont des fichiers à part (Flight of the Amazon Queen,
 * Beneath a Steel Sky) : chargés à la demande, décodés par le navigateur (`WebSampleOutput.decode`) et gardés en cache.
 *
 * Une clé de fichier est libre (`string` ou `number`) : la banque ne l'interprète pas (normalisation des noms, chemins et extension
 * sont l'affaire de l'hôte du jeu, qui fournit `SoundFiles`).
 *
 * Le moteur d'origine lit et joue le fichier sur-le-champ ; ici le décodage est asynchrone. Le moteur ne le voit pas : un son en cours
 * de chargement compte comme actif (`SampleChannel.active`), puis dure sa vraie durée à partir du début de la lecture, avec une limite
 * d'attente (`LOAD_TIMEOUT_MS`) pour qu'un fichier perdu ne bloque jamais une réplique. Le préchargement (`preload`) évite l'attente.
 */

export type SoundKey = string | number;

/** Accès aux octets des sons, fourni par l'hôte. */
export interface SoundFiles<K extends SoundKey = string> {
  /** Le son existe (liste des fichiers du jeu, synchrone). */
  has(key: K): boolean;
  /** Octets du fichier MP3. */
  load(key: K): Promise<Uint8Array>;
}

/** Décodeur : `WebSampleOutput.decode`. */
export interface SampleDecoder {
  decode(bytes: Uint8Array): Promise<Sample>;
}

/** Mémoire de voix décodées : au-delà, les moins récemment utilisées sont oubliées (rechargées au besoin). */
const CACHE_LIMIT_FLOATS = 12_000_000;
/** Chargements simultanés d'un préchargement. */
const PRELOAD_PARALLEL = 4;
/** Attente maximale d'un son (ms) avant de le laisser tomber. */
export const LOAD_TIMEOUT_MS = 5000;

export class VoiceBank<K extends SoundKey = string> {
  private readonly cache = new Map<K, Sample>();
  private cachedFloats = 0;
  private readonly loading = new Map<K, Promise<Sample | null>>();

  constructor(
    private readonly files: SoundFiles<K>,
    private readonly decoder: SampleDecoder,
  ) {}

  has(key: K): boolean {
    return this.files.has(key);
  }

  /** Échantillon déjà décodé, ou `undefined` (sans lancer de chargement). */
  peek(key: K): Sample | undefined {
    const sample = this.cache.get(key);
    if (sample) {
      // Réinsère en dernier : le plus récent.
      this.cache.delete(key);
      this.cache.set(key, sample);
    }
    return sample;
  }

  /** Charge et décode un son ; `null` si le fichier manque, est illisible ou ne se décode pas (jamais une erreur). */
  sample(key: K): Promise<Sample | null> {
    const cached = this.peek(key);
    if (cached) return Promise.resolve(cached);
    if (!this.files.has(key)) return Promise.resolve(null);
    let pending = this.loading.get(key);
    if (!pending) {
      pending = this.files
        .load(key)
        .then((bytes) => this.decoder.decode(bytes))
        .then((sample) => {
          this.remember(key, sample);
          return sample;
        })
        .catch(() => null)
        .finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }
    return pending;
  }

  private remember(key: K, sample: Sample): void {
    this.cache.set(key, sample);
    this.cachedFloats += sample.data.length;
    for (const [oldest, old] of this.cache) {
      if (this.cachedFloats <= CACHE_LIMIT_FLOATS || oldest === key) break;
      this.cache.delete(oldest);
      this.cachedFloats -= old.data.length;
    }
  }

  /** Précharge des sons (sans doublon, les absents sont ignorés) ; rend le nombre de sons disponibles à la fin. */
  async preload(keys: Iterable<K>): Promise<number> {
    const queue = [...new Set(keys)].filter((key) => this.files.has(key));
    let loaded = 0;
    const worker = async (): Promise<void> => {
      for (let key = queue.shift(); key !== undefined; key = queue.shift()) if (await this.sample(key)) loaded++;
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
