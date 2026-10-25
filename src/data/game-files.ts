/**
 * Manifeste des fichiers d'un jeu (`original/<jeu>/files.json`, généré par les scripts de manifeste)
 * et résolution de noms, partagés par les jeux.
 *
 * Les EXE demandent des noms en casse arbitraire (`s22a001d.mcg`, `PatFill.DAT`) alors que les fichiers
 * sont rangés en majuscules dans des sous-dossiers (`DATA/S22/S22A/S22A001D.MCG`) : `GameFiles.resolve`
 * fait la correspondance, insensible à la casse. Module pur : seul `fetchGameFiles` touche à `fetch`.
 */

export interface GameFileEntry {
  /** Chemin relatif à `original/<jeu>/`, séparateur `/`. */
  path: string;
  size: number;
}

/** Nom de fichier sans dossier (les `\` DOS sont traités comme des `/`). */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export class GameFiles {
  readonly entries: readonly GameFileEntry[];
  /** Chemin complet en minuscules -> chemin réel. */
  private readonly byPath = new Map<string, string>();
  /** Nom seul en minuscules -> chemins (plusieurs si le même nom existe dans plusieurs dossiers). */
  private readonly byName = new Map<string, string[]>();
  private readonly sizes = new Map<string, number>();

  constructor(entries: readonly GameFileEntry[]) {
    this.entries = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const { path, size } of this.entries) {
      this.byPath.set(path.toLowerCase(), path);
      const key = baseName(path).toLowerCase();
      const list = this.byName.get(key);
      if (list) list.push(path);
      else this.byName.set(key, [path]);
      this.sizes.set(path, size);
    }
  }

  /**
   * Chemin réel d'un fichier, casse indifférente. `name` peut être un chemin complet (`mpc/pvg.mhk`, accepté
   * avec `\`) ou un simple nom (`pvg.mhk`). Quelques noms existent dans plusieurs dossiers (ex. `S36A000S.HY8`
   * dans `S36A` et `S36E`) : `folderHint` (nom de dossier, ex. `s36e`, casse indifférente) départage ; sans
   * indice ou sans correspondance, le premier chemin dans l'ordre trié est renvoyé.
   */
  resolve(name: string, folderHint?: string): string | undefined {
    const normalized = name.replace(/\\/g, "/");
    const exact = this.byPath.get(normalized.toLowerCase());
    if (exact) return exact;
    const matches = this.byName.get(baseName(normalized).toLowerCase());
    if (!matches) return undefined;
    if (folderHint && matches.length > 1) {
      const hint = folderHint.toLowerCase();
      const preferred = matches.find((path) => path.split("/").slice(0, -1).some((part) => part.toLowerCase() === hint));
      if (preferred) return preferred;
    }
    return matches[0];
  }

  /** Tous les chemins portant ce nom (dernier segment de `name`). */
  resolveAll(name: string): string[] {
    return [...(this.byName.get(baseName(name).toLowerCase()) ?? [])];
  }

  /** `name` correspond-il à un fichier du jeu ? */
  has(name: string): boolean {
    return this.resolve(name) !== undefined;
  }

  size(path: string): number | undefined {
    return this.sizes.get(path);
  }

  /** Chemins triés, éventuellement filtrés. */
  list(filter?: (path: string) => boolean): string[] {
    const paths = this.entries.map((entry) => entry.path);
    return filter ? paths.filter(filter) : paths;
  }
}

/** Charge les entrées de `files.json` sous `base` (ex. `/teleportaschtroumpf`). */
export async function fetchGameFileEntries(base: string): Promise<GameFileEntry[]> {
  const response = await fetch(`${base.replace(/\/$/, "")}/files.json`);
  if (!response.ok) throw new Error(`files.json : HTTP ${response.status}`);
  return (await response.json()) as GameFileEntry[];
}

/** Charge `files.json` sous `base` (ex. `/teleportaschtroumpf`). */
export async function fetchGameFiles(base: string): Promise<GameFiles> {
  return new GameFiles(await fetchGameFileEntries(base));
}
