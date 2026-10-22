import { parsePfn, type PfnFont } from "../data/font";
import { parseHy8, type Hy8 } from "../data/hy8";
import { parseMcg, type Mcg } from "../data/mcg";
import { parseVoc, type Voc } from "../data/voc";
import type { Host } from "./host";

/**
 * Chargement des ressources par nom d'origine (`s07a001d.mcg`, `s52d001f.pfn`…) : fichiers lus via
 * `host.loadFile`, décodés une fois et gardés en mémoire (les décodés sont des vues sur les octets lus).
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

  voc(name: string): Promise<Voc> {
    return this.memo(`voc:${name.toLowerCase()}`, async () => parseVoc(await this.bytes(name)));
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
