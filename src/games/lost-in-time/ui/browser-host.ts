import type { Language } from "../data/tot";
import { GameInput } from "../engine/input";
import type { Host } from "../engine/host";
import { PausableClock } from "./clock";

/** Fichier du jeu absent du serveur (ou renvoyé sous forme de page HTML par le serveur de dev). */
function isMissing(response: Response): boolean {
  return !response.ok || (response.headers.get("content-type") ?? "").includes("text/html");
}

/** Nom côté serveur : les fichiers d'origine sont en majuscules, à plat (le jeu peut demander `intro.stk` ou `c:\x`). */
function serverName(name: string): string {
  return name.slice(Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/"), name.lastIndexOf(":")) + 1).toUpperCase();
}

/**
 * Hôte du navigateur : fichiers chargés à la demande (et gardés en mémoire), horloge et image par
 * `requestAnimationFrame`, entrées alimentées par l'interface (`input`).
 */
export class BrowserHost implements Host {
  readonly input = new GameInput();
  language: Language = "fr";
  private readonly files = new Map<string, Promise<Uint8Array | undefined>>();
  private readonly sizes = new Map<string, Promise<number | undefined>>();
  private readonly loaded = new Map<string, Uint8Array>();
  private readonly clock = new PausableClock(() => performance.now());

  /** `baseUrl` : dossier des fichiers du jeu, avec la barre finale. */
  constructor(private readonly baseUrl: string) {}

  private url(name: string): string {
    return this.baseUrl + encodeURIComponent(serverName(name));
  }

  loadFile(name: string): Promise<Uint8Array | undefined> {
    const key = serverName(name);
    let pending = this.files.get(key);
    if (!pending) {
      pending = this.download(key);
      this.files.set(key, pending);
    }
    return pending;
  }

  private async download(key: string): Promise<Uint8Array | undefined> {
    if (key === "") return undefined;
    try {
      const response = await fetch(this.url(key));
      if (isMissing(response)) return undefined;
      const data = new Uint8Array(await response.arrayBuffer());
      this.loaded.set(key, data);
      return data;
    } catch {
      return undefined;
    }
  }

  fileSize(name: string): Promise<number | undefined> {
    const key = serverName(name);
    const known = this.loaded.get(key);
    if (known) return Promise.resolve(known.length);
    let pending = this.sizes.get(key);
    if (!pending) {
      pending = this.probe(key);
      this.sizes.set(key, pending);
    }
    return pending;
  }

  /** Taille par une requête HEAD ; sans Content-Length, on charge le fichier. */
  private async probe(key: string): Promise<number | undefined> {
    if (key === "") return undefined;
    try {
      const response = await fetch(this.url(key), { method: "HEAD" });
      if (isMissing(response)) return undefined;
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > 0) return length;
    } catch {
      return undefined;
    }
    return (await this.loadFile(key))?.length;
  }

  /** Fichier déjà chargé, sans attente (lecture synchrone du moteur). */
  peek(name: string): Uint8Array | undefined {
    return this.loaded.get(serverName(name));
  }

  /** Horloge du jeu : elle s'arrête pendant la pause, pour que les scripts, vidéos et animations ne rattrapent pas le temps perdu. */
  now(): number {
    return this.clock.now();
  }

  /** Met le jeu en pause (onglet masqué) ou le relance ; l'audio suit dans l'interface. */
  setPaused(paused: boolean): void {
    if (paused) this.clock.pause();
    else this.clock.resume();
  }

  nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  random(max: number): number {
    return Math.floor(Math.random() * max);
  }

  date(): Date {
    return new Date();
  }
}
