import { type GameFiles, baseName, extensionOf } from "../data/files";

/**
 * Préchargement des fichiers du jeu. Le moteur lit les fichiers en synchrone (`DrasculaHost.readFile`), l'hôte du navigateur les
 * charge donc avant de s'en servir (`graphics.md` § 10).
 *
 * - **Au départ** : `drascula.dat`, les fiches `.ALD`, les dialogues `.CAL` et **toutes les images `.ALG`** (5,7 Mo). Les images ne sont
 *   pas découpées par chapitre : une quarantaine de feuilles hors numérotation (`an2_1`, `cielo`, `his1`…) servent à des cinématiques ou
 *   à des pièces de chapitres différents, et en manquer une ferait tomber le jeu en pleine partie, pour 5 Mo seulement.
 * - **Par chapitre** : les vidéos `.BIN` (23 Mo en tout, jusqu'à 4 Mo chacune), listées ci-dessous d'après les `animate` / `playSsn`
 *   du code (`cinematics/sequences.ts`, `engine/rooms/chapter-N/`) ; un test vérifie que la liste est complète.
 * - **Les voix `.ALS` et la musique** ne passent pas par là : ils sont lus à la demande (`DrasculaAudio`).
 *
 * Le chapitre en cours et le suivant sont toujours prêts avant que le moteur ne tourne : le suivant se charge en fond pendant la partie.
 */

/** Dernier chapitre du jeu. */
export const LAST_CHAPTER = 6;

/**
 * Vidéos `.BIN` lues par chapitre, noms en minuscules. Le chapitre 1 porte l'introduction (logos, histoire, château, armée, éclairs :
 * 15 Mo) et la cinématique de B.J. ; `frel`, `rayo1` et `rayo2` servent aussi au chapitre 5 (ils sont alors déjà chargés).
 */
export const CHAPTER_VIDEOS: Readonly<Record<number, readonly string[]>> = {
  1: [
    "logoddm.bin", "logoalc.bin", "scrollb.bin", "scr2.bin", "scr3.bin", "intro.bin", "lib.bin", "lib2.bin",
    "rayo1.bin", "rayo2.bin", "frel2.bin", "frel.bin", "ag.bin", "lev.bin", "gaf.bin", "bjb.bin", "bes.bin", "rap.bin",
  ],
  2: [],
  3: [],
  4: ["st.bin", "up.bin", "bio.bin"],
  5: ["frel.bin", "rayo1.bin", "rayo2.bin", "det.bin"],
  6: ["man.bin", "fum.bin", "beb.bin", "cnf.bin", "rct.bin", "hbp.bin", "fin.bin", "drf.bin", "qpc.bin", "crd.bin"],
};

/** Chemins (de `files.json`) chargés avant de démarrer : données, fiches, dialogues et toutes les images. */
export function baseFiles(files: GameFiles): string[] {
  return files.list((path) => {
    const extension = extensionOf(path);
    return extension === "ALD" || extension === "CAL" || extension === "ALG" || path.toLowerCase() === "drascula.dat";
  });
}

/** Chemins des vidéos d'un chapitre ; lève si un nom de `CHAPTER_VIDEOS` n'est pas dans la liste des fichiers. */
export function chapterVideos(files: GameFiles, chapter: number): string[] {
  return (CHAPTER_VIDEOS[chapter] ?? []).map((name) => {
    const path = files.resolve(name);
    if (path === undefined) throw new Error(`vidéo absente de la liste des fichiers : ${name}`);
    return path;
  });
}

/** Fichiers du jeu en mémoire, par nom (casse indifférente) : ce que lit `DrasculaHost.readFile`. */
export class FileStore {
  private readonly bytes = new Map<string, Uint8Array>();

  private static key(name: string): string {
    return baseName(name).toUpperCase();
  }

  has(name: string): boolean {
    return this.bytes.has(FileStore.key(name));
  }

  get(name: string): Uint8Array | undefined {
    return this.bytes.get(FileStore.key(name));
  }

  set(name: string, data: Uint8Array): void {
    this.bytes.set(FileStore.key(name), data);
  }

  get size(): number {
    return this.bytes.size;
  }
}

/** Chargeur d'un fichier (`fetchBytes(base, chemin)`) ; injecté pour les tests. */
export type Fetcher = (path: string) => Promise<Uint8Array>;

/** Fichiers chargés en même temps au plus. */
const CONCURRENCY = 8;

/**
 * Charge `paths` dans `store` (ceux qui y sont déjà sont sautés) par petits lots ; `onProgress(chargé, total)` compte en octets
 * (taille du manifeste). Une erreur arrête les chargements non commencés et est relancée.
 */
export async function loadInto(
  store: FileStore,
  files: GameFiles,
  paths: readonly string[],
  fetcher: Fetcher,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const wanted = paths.filter((path) => !store.has(path));
  const sizeOf = (path: string): number => files.size(path) ?? 0;
  const total = wanted.reduce((sum, path) => sum + sizeOf(path), 0);
  let done = 0;
  let next = 0;
  let failure: unknown;
  let failed = false;
  onProgress?.(0, total);
  const worker = async (): Promise<void> => {
    while (!failed && next < wanted.length) {
      const path = wanted[next++];
      try {
        store.set(path, await fetcher(path));
      } catch (error) {
        failed = true;
        failure = error;
        return;
      }
      done += sizeOf(path);
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));
  if (failed) throw failure;
}

/**
 * Chapitres dont les vidéos sont chargées (ou en cours de chargement). `ensure(chapitre)` charge celles du chapitre ; `ready(chapitre)`
 * dit si elles sont toutes là. Un chapitre au-delà du dernier est toujours prêt (il n'existe pas).
 */
export class ChapterLoader {
  private readonly loaded = new Set<number>();
  private readonly pending = new Map<number, Promise<void>>();

  constructor(
    private readonly store: FileStore,
    private readonly files: GameFiles,
    private readonly fetcher: Fetcher,
  ) {}

  ready(chapter: number): boolean {
    return chapter > LAST_CHAPTER || this.loaded.has(chapter);
  }

  /** Lance le chargement des vidéos des chapitres `chapters` (ceux qui sont prêts ou déjà en cours ne sont pas relancés : voir `prepare` pour attendre). */
  ensure(chapters: readonly number[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const wanted = chapters.filter((chapter) => !this.ready(chapter) && !this.pending.has(chapter));
    if (wanted.length === 0) return Promise.resolve();
    const paths = [...new Set(wanted.flatMap((chapter) => chapterVideos(this.files, chapter)))];
    const load = loadInto(this.store, this.files, paths, this.fetcher, onProgress).then(
      () => {
        for (const chapter of wanted) {
          this.loaded.add(chapter);
          this.pending.delete(chapter);
        }
      },
      (error: unknown) => {
        for (const chapter of wanted) this.pending.delete(chapter);
        throw error;
      },
    );
    for (const chapter of wanted) this.pending.set(chapter, load);
    return load;
  }

  /** Le chapitre `chapter` et le suivant, ceux dont le moteur a besoin pour tourner. */
  static needed(chapter: number): number[] {
    return [chapter, chapter + 1].filter((c) => c >= 1 && c <= LAST_CHAPTER);
  }

  /** Le moteur peut-il tourner dans le chapitre `chapter` (le sien et le suivant prêts) ? */
  runnable(chapter: number): boolean {
    return ChapterLoader.needed(chapter).every((c) => this.ready(c));
  }

  /** Charge ce qu'il faut pour faire tourner le moteur dans `chapter` ; ce qui est déjà en cours est attendu, pas relancé. */
  prepare(chapter: number, onProgress?: (done: number, total: number) => void): Promise<void> {
    const pending = ChapterLoader.needed(chapter).flatMap((c) => {
      const promise = this.pending.get(c);
      return promise ? [promise] : [];
    });
    return Promise.all([this.ensure(ChapterLoader.needed(chapter), onProgress), ...pending]).then(() => undefined);
  }
}
