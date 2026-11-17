import { parsePfn, type PfnFont } from "./data/font";
import { parseHy8, type Hy8 } from "./data/hy8";
import { parseMcg, type Mcg } from "./data/mcg";
import type { Sound } from "./audio/sound";
import { parseAudioIndex, type AudioEntry } from "./data/audio-index";
import type { Host } from "./host";

/** Index des sons, à la racine du dossier du jeu. */
const AUDIO_INDEX = "audio.json";

/**
 * Chargement des ressources par nom d'origine (`s07a001d.mcg`, `s52d001f.pfn`…) : fichiers lus via
 * `host.loadFile`, décodés une fois et gardés en mémoire (les décodés sont des vues sur les octets lus).
 * Les sons (`sound()`) sont des MP3 accompagnés de l'index `audio.json`, qui en donne la durée exacte.
 *
 * Les vidéos `.mux` ne sont pas gardées (plusieurs Mo, jouées une fois) : `bytes()` les relit à chaque fois,
 * sauf si `prefetch()` les a demandées avant, auquel cas la lecture en cours est consommée une seule fois.
 */
export class Resources {
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly prefetched = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly host: Host) {}

  /** Octets bruts d'un fichier. */
  bytes(name: string): Promise<Uint8Array> {
    const key = name.toLowerCase();
    const early = this.prefetched.get(key);
    if (early) {
      this.prefetched.delete(key);
      return early;
    }
    if (key.endsWith(".mux")) return this.host.loadFile(name);
    return this.memo(`raw:${key}`, () => this.host.loadFile(name));
  }

  /** Lance des lectures en tâche de fond (sans attendre ni échouer bruyamment) ; elles servent aux `load` suivants. */
  prefetch(...names: string[]): void {
    for (const name of names) {
      const key = name.toLowerCase();
      if (!key.endsWith(".mux")) {
        void this.bytes(name).catch(() => undefined);
      } else if (!this.prefetched.has(key)) {
        const promise = this.host.loadFile(name);
        promise.catch(() => undefined);
        this.prefetched.set(key, promise);
      }
    }
  }

  mcg(name: string): Promise<Mcg> {
    return this.memo(`mcg:${name.toLowerCase()}`, async () => parseMcg(await this.bytes(name)));
  }

  hy8(name: string): Promise<Hy8> {
    return this.memo(`hy8:${name.toLowerCase()}`, async () => parseHy8(await this.bytes(name)));
  }

  pfn(name: string): Promise<PfnFont> {
    return this.memo(`pfn:${name.toLowerCase()}`, async () => parsePfn(await this.bytes(name)));
  }

  /**
   * Son demandé par son nom d'origine (`s07a001b.voc`) : le fichier versionné est `<nom>.mp3`, et sa longueur d'origine
   * (nombre d'échantillons, fréquence) vient de l'index `audio.json`, dont les clés sont les chemins des MP3. Le son est
   * préparé pour la sortie (`AudioBackend.prepare` : décodage dans le navigateur, rien sous node) avant d'être rendu.
   */
  sound(name: string): Promise<Sound> {
    return this.memo(`sound:${name.toLowerCase()}`, async () => {
      const file = `${name}.mp3`;
      const [index, data] = await Promise.all([this.audioIndex(), this.bytes(file)]);
      const path = this.host.filePath(file);
      const entry = path === undefined ? undefined : index.get(path);
      if (!entry) throw new Error(`${AUDIO_INDEX} : pas d'entrée pour ${file}`);
      const sound: Sound = { format: "mp3", data, sampleCount: entry.samples, sampleRate: entry.sampleRate };
      await this.host.audio.prepare(sound);
      return sound;
    });
  }

  private audioIndex(): Promise<Map<string, AudioEntry>> {
    return this.memo(`index:${AUDIO_INDEX}`, async () => parseAudioIndex(new TextDecoder().decode(await this.host.loadFile(AUDIO_INDEX))));
  }

  /** Oublie tout ce qui est gardé en mémoire (par exemple en quittant une famille de scènes). */
  clear(): void {
    this.cache.clear();
    this.prefetched.clear();
  }

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    let entry = this.cache.get(key) as Promise<T> | undefined;
    if (!entry) {
      entry = load();
      this.cache.set(key, entry);
      // Un échec n'est pas gardé : on pourra réessayer.
      entry.catch(() => this.cache.delete(key));
    }
    return entry;
  }
}
