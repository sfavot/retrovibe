import { MohawkArchive, TAG_SCR, TAG_SHAP, TAG_SHPL, TAG_SND, TAG_SNDL, TAG_STRL } from "../../../data/mohawk/mohawk";
import { decodeShap, type Shape } from "../../../data/mohawk/shap";
import { parseScr, type ScrScript } from "../data/scr";
import { parseShpl, type ShapeList } from "../../../data/mohawk/shpl";
import { parseSndl } from "../../../data/mohawk/sndl";
import { parseStrl } from "../../../data/mohawk/strl";
import { isMidi, parseMidi, type MidiResource } from "../../../data/mohawk/midi";
import { isWave, parseWave, type Wave } from "../../../data/mohawk/wave";
import type { Host } from "./host";

/**
 * Une archive Mohawk ouverte, avec les ressources décodées une seule fois (mémoïsation par tag et identifiant).
 * Les objets renvoyés sont partagés : ne pas les modifier.
 */
export class Archive {
  private readonly cache = new Map<string, unknown>();

  constructor(
    /** Chemin demandé (`BOWLING.DAT`), tel qu'il a servi de clé. */
    readonly name: string,
    readonly mohawk: MohawkArchive,
  ) {}

  has(tag: string, id: number): boolean {
    return this.mohawk.has(tag, id);
  }

  ids(tag: string): number[] {
    return this.mohawk.ids(tag);
  }

  /** Octets bruts (vue sur l'archive, sans copie) ; lève si la ressource n'existe pas. */
  raw(tag: string, id: number): Uint8Array {
    return this.mohawk.get(tag, id);
  }

  private memo<T>(tag: string, id: number, decode: (bytes: Uint8Array) => T, kind = tag): T {
    const key = `${kind}:${id}`;
    if (this.cache.has(key)) return this.cache.get(key) as T;
    let value: T;
    try {
      value = decode(this.mohawk.get(tag, id));
    } catch (error) {
      throw new Error(`${this.name} ${JSON.stringify(tag)} ${id} : ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    this.cache.set(key, value);
    return value;
  }

  /** Image indexée décodée (`SHAP`). */
  shap(id: number): Shape {
    return this.memo(TAG_SHAP, id, decodeShap);
  }

  /** Liste de formes et palette (`SHPL`). */
  shpl(id: number): ShapeList {
    return this.memo(TAG_SHPL, id, parseShpl);
  }

  /** Script d'animation (`\0SCR`). */
  scr(id: number): ScrScript {
    return this.memo(TAG_SCR, id, parseScr);
  }

  /** Identifiants des sons d'un script (`SNDL`). */
  sndl(id: number): number[] {
    return this.memo(TAG_SNDL, id, parseSndl);
  }

  /** Liste de chaînes (`STRL`). */
  strl(id: number): string[] {
    return this.memo(TAG_STRL, id, parseStrl);
  }

  /** Octets d'un `\0SND` (WAVE ou MIDI) : l'audio (vague F3) les décode. */
  sndBytes(id: number): Uint8Array {
    return this.mohawk.get(TAG_SND, id);
  }

  /** `\0SND` de type WAVE décodé ; lève si c'est un MIDI. */
  wave(id: number): Wave {
    return this.memo(
      TAG_SND,
      id,
      (bytes) => {
        if (!isWave(bytes)) throw new Error("n'est pas un WAVE");
        return parseWave(bytes);
      },
      "wave",
    );
  }

  /** `\0SND` de type MIDI ; lève si c'est un WAVE. */
  midi(id: number): MidiResource {
    return this.memo(
      TAG_SND,
      id,
      (bytes) => {
        if (!isMidi(bytes)) throw new Error("n'est pas un MIDI");
        return parseMidi(bytes);
      },
      "midi",
    );
  }
}

/**
 * Portée d'une archive. `scene` : fermée quand la scène quitte (`releaseScene`) — l'archive principale de chaque scène
 * (`BOWLING.DAT`…) et celles qu'elle ouvre pour elle seule. `persistent` : gardée jusqu'à `release` explicite (`MILKYWAY.DAT`,
 * système, ouvert au démarrage ; `POLLY.DAT` partagée par plusieurs scènes si on veut éviter de la relire).
 */
export type ArchiveScope = "scene" | "persistent";

interface Entry {
  scope: ArchiveScope;
  /** Génération de la scène à laquelle l'archive appartient (voir `Resources.epoch`). */
  epoch: number;
  /** Génération d'avant un `open` fait pendant un chargement de scène sur une archive déjà ouverte : rétablie si le chargement échoue. */
  restoreEpoch?: number;
  promise: Promise<Archive>;
  archive?: Archive;
}

/**
 * Cache d'archives Mohawk ouvertes par nom (insensible à la casse), chargées via `host.loadFile`. L'original ouvre un `.DAT` par scène
 * plus quelques archives partagées (engine.md §2.2) : ici `open()` pendant `Scene.load`, `releaseScene()` à la sortie de la scène.
 * Une archive déjà ouverte est rendue telle quelle (la portée la plus longue l'emporte).
 */
export class Resources {
  private readonly entries = new Map<string, Entry>();
  /** Génération de la scène en cours ; une scène qu'on charge (`Scene.load`) appartient à `epoch + 1`. */
  private epoch = 0;
  private loadingScene = false;

  constructor(private readonly host: Host) {}

  /** Ouvre une archive (ou rend celle déjà ouverte). Un échec n'est pas gardé : on pourra réessayer. */
  open(name: string, scope: ArchiveScope = "scene"): Promise<Archive> {
    const key = name.replace(/\\/g, "/").toLowerCase();
    const epoch = this.loadingScene ? this.epoch + 1 : this.epoch;
    const existing = this.entries.get(key);
    if (existing) {
      if (scope === "persistent") existing.scope = "persistent";
      if (epoch > existing.epoch) {
        if (this.loadingScene) existing.restoreEpoch ??= existing.epoch;
        existing.epoch = epoch;
      }
      return existing.promise;
    }
    const entry: Entry = {
      scope,
      epoch,
      promise: this.host.loadFile(name).then((bytes) => {
        const archive = new Archive(name, MohawkArchive.parse(bytes));
        entry.archive = archive;
        return archive;
      }),
    };
    this.entries.set(key, entry);
    entry.promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.promise;
  }

  /** Archive déjà ouverte, sinon `undefined` (lecture synchrone depuis `enter` / `tick`, une fois `load` terminé). */
  get(name: string): Archive | undefined {
    return this.entries.get(name.replace(/\\/g, "/").toLowerCase())?.archive;
  }

  /** Comme `get` mais lève si l'archive n'a pas été ouverte : oubli d'`open` dans `load`. */
  require(name: string): Archive {
    const archive = this.get(name);
    if (!archive) throw new Error(`Resources : ${name} n'est pas ouverte (open() dans Scene.load)`);
    return archive;
  }

  /** Libère une archive (aide de Poly ou de Gus ouverte temporairement). */
  release(name: string): void {
    this.entries.delete(name.replace(/\\/g, "/").toLowerCase());
  }

  /**
   * Gestionnaire de scènes : la scène suivante commence son `load`. Les archives ouvertes d'ici à `commitScene` lui appartiennent
   * (l'ancienne scène est gelée mais pas encore partie : ses archives restent ouvertes, et celles qu'elles partagent avec la nouvelle
   * sont conservées).
   */
  beginSceneLoad(): void {
    this.loadingScene = true;
  }

  /**
   * Gestionnaire de scènes : le chargement a échoué, l'ancienne scène continue. Les archives de portée `scene` ouvertes par le
   * chargement raté sont libérées ; celles de l'ancienne scène qu'il avait rouvertes lui restent attachées.
   */
  abortSceneLoad(): void {
    const loadingEpoch = this.epoch + 1;
    for (const [key, entry] of this.entries) {
      if (entry.epoch !== loadingEpoch) continue;
      if (entry.restoreEpoch !== undefined) {
        entry.epoch = entry.restoreEpoch;
        entry.restoreEpoch = undefined;
      }
      else if (entry.scope === "scene") this.entries.delete(key);
    }
    this.loadingScene = false;
  }

  /**
   * Gestionnaire de scènes : l'ancienne scène quitte. Libère ses archives de portée `scene` (sauf celles que la nouvelle a rouvertes)
   * et fait de la scène chargée la scène courante.
   */
  commitScene(): void {
    for (const [key, entry] of this.entries) if (entry.scope === "scene" && entry.epoch <= this.epoch) this.entries.delete(key);
    if (this.loadingScene) this.epoch++;
    for (const entry of this.entries.values()) entry.restoreEpoch = undefined;
    this.loadingScene = false;
  }

  /** Noms des archives actuellement connues (ouvertes ou en cours d'ouverture), pour les tests et le débogage. */
  get openNames(): string[] {
    return [...this.entries.keys()];
  }
}
