/**
 * Manifeste des fichiers du jeu (`original/teleportaschtroumpf/files.json`, généré par
 * `scripts/teleportaschtroumpf/manifest.py`) et résolution de noms.
 *
 * L'EXE demande des noms en minuscules (`s22a001d.mcg`) alors que les fichiers sont rangés en
 * `DATA/S22/S22A/S22A001D.MCG` : `GameFiles.resolve` fait la correspondance, insensible à la casse.
 */

export interface GameFileEntry {
  /** Chemin relatif à `original/teleportaschtroumpf/`, séparateur `/`. */
  path: string;
  size: number;
}

export interface SceneFolder {
  /** Identifiant en minuscules, par ex. `s22`. */
  id: string;
  /** Chemin du dossier de la scène, par ex. `DATA/S22`. */
  path: string;
}

/** Nom de fichier sans dossier. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Extension en majuscules, sans le point ; chaîne vide s'il n'y en a pas (`S20H`). */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toUpperCase();
}

export class GameFiles {
  readonly entries: readonly GameFileEntry[];
  /** Nom en minuscules -> chemins (plusieurs si le même nom existe dans plusieurs dossiers). */
  private readonly byName = new Map<string, string[]>();
  private readonly sizes = new Map<string, number>();

  constructor(entries: readonly GameFileEntry[]) {
    this.entries = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const { path, size } of this.entries) {
      const key = baseName(path).toLowerCase();
      const list = this.byName.get(key);
      if (list) list.push(path);
      else this.byName.set(key, [path]);
      this.sizes.set(path, size);
    }
  }

  /**
   * Chemin du fichier de ce nom (casse indifférente). Quelques noms existent dans plusieurs dossiers
   * (ex. `S36A000S.HY8` dans `S36A` et `S36E`) : `folderHint` (nom de dossier, ex. `s36e`, casse indifférente)
   * départage ; sans indice ou sans correspondance, le premier chemin dans l'ordre trié est renvoyé.
   */
  resolve(name: string, folderHint?: string): string | undefined {
    const matches = this.byName.get(baseName(name).toLowerCase());
    if (!matches) return undefined;
    if (folderHint && matches.length > 1) {
      const hint = folderHint.toLowerCase();
      const preferred = matches.find((path) => path.split("/").slice(0, -1).some((part) => part.toLowerCase() === hint));
      if (preferred) return preferred;
    }
    return matches[0];
  }

  /** Tous les chemins portant ce nom. */
  resolveAll(name: string): string[] {
    return [...(this.byName.get(baseName(name).toLowerCase()) ?? [])];
  }

  size(path: string): number | undefined {
    return this.sizes.get(path);
  }

  /** Chemins triés, éventuellement filtrés. */
  list(filter?: (path: string) => boolean): string[] {
    const paths = this.entries.map((entry) => entry.path);
    return filter ? paths.filter(filter) : paths;
  }

  /** Dossiers `DATA/Snn` triés. */
  scenes(): SceneFolder[] {
    const seen = new Map<string, SceneFolder>();
    for (const { path } of this.entries) {
      const match = /^DATA\/(S\d+)\//i.exec(path);
      if (match && !seen.has(match[1])) {
        seen.set(match[1], { id: match[1].toLowerCase(), path: `DATA/${match[1]}` });
      }
    }
    return [...seen.values()];
  }
}

/** Charge `files.json` sous `base` (ex. `/teleportaschtroumpf`). */
export async function fetchGameFiles(base: string): Promise<GameFiles> {
  const response = await fetch(`${base.replace(/\/$/, "")}/files.json`);
  if (!response.ok) throw new Error(`files.json : HTTP ${response.status}`);
  return new GameFiles((await response.json()) as GameFileEntry[]);
}
