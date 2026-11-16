import type { Sample } from "../../../src/audio/web-sample-output";
import { DIGITAL_LOADING, type DigitalFiles, type DigitalLoading, type DigitalOutput, type DigitalVoice } from "../../../src/games/gk1/audio/digital";
import { original } from "../data/real";

/** Fichiers réels de `original/gk1`, lus sur le disque sans attente ; `missing` : chemins tenus pour absents. */
export function diskFiles(missing: readonly string[] = []): DigitalFiles {
  const known = new Set((original.manifest() ?? []).map((entry) => entry.path));
  for (const path of missing) known.delete(path);
  const decoder = new TextDecoder();
  return {
    has: (path) => known.has(path),
    text: (path) => (known.has(path) ? decoder.decode(original.read(path)) : undefined),
    load: (path) => Promise.resolve(original.read(path)),
  };
}

/** Fichiers inventés : `texts` par chemin (les MP3 sont des chemins sans texte), JSON servis après `delay` demandes. */
export function fakeFiles(texts: Record<string, string>, sounds: readonly string[], delay = 0): DigitalFiles & { loads: string[] } {
  const asked = new Map<string, number>();
  const loads: string[] = [];
  return {
    loads,
    has: (path) => path in texts || sounds.includes(path),
    text: (path): string | undefined | DigitalLoading => {
      const count = (asked.get(path) ?? 0) + 1;
      asked.set(path, count);
      return count <= delay ? DIGITAL_LOADING : texts[path];
    },
    load: (path) => {
      loads.push(path);
      return Promise.resolve(Uint8Array.of(1, 2, 3));
    },
  };
}

/** Sortie factice : le décodage attend `release()`, chaque voix note ce qu'on lui demande. */
export class FakeOutput implements DigitalOutput {
  readonly log: string[] = [];
  private readonly waiting: (() => void)[] = [];
  /** Les décodages échouent. */
  broken = false;
  /** Les décodages attendent `release()`. */
  held = false;

  decode(): Promise<Sample> {
    const sample: Sample = { data: new Float32Array(8), rate: 22050 };
    if (this.broken) return Promise.reject(new Error("décodage"));
    if (!this.held) return Promise.resolve(sample);
    return new Promise((resolve) => this.waiting.push(() => resolve(sample)));
  }

  /** Laisse finir les décodages en attente. */
  release(): void {
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  play(_sample: Sample, options: { loop: boolean; volume: number }): DigitalVoice {
    const id = this.log.filter((line) => line.startsWith("play")).length;
    this.log.push(`play ${id} loop=${options.loop} gain=${options.volume.toFixed(3)}`);
    return {
      stop: () => this.log.push(`stop ${id}`),
      setVolume: (gain) => this.log.push(`gain ${id} ${gain.toFixed(3)}`),
      pause: (paused) => this.log.push(`pause ${id} ${paused}`),
    };
  }
}

/** Laisse passer les promesses en cours (chargement et décodage d'un son). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
