import type { Fetcher, FileStore } from "../../../ui/file-store";
import { loadInto } from "../../../ui/file-store";
import { type GameFiles, baseName, extensionOf } from "../data/files";
import type { GameData } from "../engine/state";

/**
 * Préchargement des fichiers du jeu. Le moteur lit les fichiers en synchrone (`FotaqHost.readFile`), l'hôte du navigateur les charge
 * donc avant de s'en servir (`docs/fotaq/engine.md`, § 13) :
 *
 * - **Au départ** : `QUEEN.JAS` et `QUEEN2.JAS`, toutes les banques de sprites (`.BBK`, `.ACT`, `.SAM` : 12,9 Mo, lues par les pièces,
 *   les personnes et les cinématiques sans que l'on sache à l'avance lesquelles), les dialogues `.DOG`, les cinématiques `.CUT`, les
 *   générique `.CRD`, la musique `AQBANK.MUS` et `PANEL.PCX`. Le jeu ne démarre qu'une fois tout cela là.
 * - **Par pièce** : le décor `.PCX` (40 Ko en moyenne), et le masque `.MSK` et la table `.LUM` des pièces à lumière dynamique. Le
 *   moteur attend leur arrivée (`FotaqHost.roomFilesReady`) avant de changer de pièce ; `RoomFiles.prefetch` charge à l'avance ceux
 *   des pièces voisines (les sorties de la pièce où l'on est), si bien que l'attente ne se voit presque jamais.
 * - **Les voix et la musique MP3/OPL** ne passent pas par là : voix lues à la demande (`createSoundFiles`), préchargées par scène
 *   (`FotaqHost.preloadSpeech`).
 */

/** Extensions chargées avant de démarrer (en plus de `PANEL.PCX`). */
const BASE_EXTENSIONS = new Set(["JAS", "BBK", "ACT", "SAM", "DOG", "CUT", "CRD", "MUS"]);

/** Chemins (de `files.json`) chargés avant de démarrer : données, banques de sprites, dialogues, cinématiques, musique et panneau. */
export function baseFiles(files: GameFiles): string[] {
  return files.list((path) => !path.includes("/") && (BASE_EXTENSIONS.has(extensionOf(path)) || baseName(path).toUpperCase() === "PANEL.PCX"));
}

/** Pièces où mènent les sorties de la pièce `room` (l'objet d'arrivée de chaque objet de sortie), sans doublon, sans `room`. */
export function neighbourRooms(data: GameData, room: number): number[] {
  const { objects, roomFirstObject } = data.jas;
  const rooms = new Set<number>();
  for (let object = (roomFirstObject[room] ?? 0) + 1; object <= (roomFirstObject[room + 1] ?? 0); object++) {
    const entry = objects[object]?.entryObject ?? 0;
    const target = entry > 0 ? objects[entry]?.room : undefined;
    if (target !== undefined && target > 0 && target !== room) rooms.add(target);
  }
  return [...rooms];
}

/**
 * Fichiers de décor des pièces : `ready(fichiers)` dit s'ils sont tous en mémoire et lance le chargement de ceux qui manquent (le
 * moteur l'interroge à chaque tick tant qu'il attend) ; `prefetch` charge sans rien attendre. Un chargement en cours n'est pas relancé ;
 * un échec est gardé dans `failure` (l'hôte l'affiche) et le chargement peut être redemandé.
 */
export class RoomFiles {
  private readonly pending = new Set<string>();
  /** Dernière erreur de chargement, ou `undefined`. */
  failure: unknown;

  constructor(
    private readonly store: FileStore,
    private readonly files: GameFiles,
    private readonly fetcher: Fetcher,
  ) {}

  /** Les fichiers sont tous en mémoire ? Sinon ceux qui manquent sont demandés. Un fichier hors du manifeste n'attend rien. */
  ready(names: readonly string[]): boolean {
    const missing = names.filter((name) => this.files.has(name) && !this.store.has(name));
    if (missing.length > 0) this.prefetch(missing);
    return missing.length === 0;
  }

  /** Charge en fond ce qui manque (décors de plusieurs pièces). */
  prefetch(names: readonly string[]): void {
    const paths = names.flatMap((name) => {
      const path = this.files.resolve(name);
      return path !== undefined && !this.store.has(path) && !this.pending.has(path) ? [path] : [];
    });
    if (paths.length === 0) return;
    for (const path of paths) this.pending.add(path);
    loadInto(this.store, this.files, paths, this.fetcher).then(
      () => {
        for (const path of paths) this.pending.delete(path);
      },
      (error: unknown) => {
        this.failure = error;
        for (const path of paths) this.pending.delete(path);
      },
    );
  }

  /** Des chargements sont en cours. */
  get loading(): boolean {
    return this.pending.size > 0;
  }
}
