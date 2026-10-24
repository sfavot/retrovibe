/**
 * Manifeste des fichiers du jeu (`original/mathemagique/files.json`, généré par `scripts/manifest.py`)
 * et résolution de noms.
 *
 * L'EXE demande des noms en casse mixte (`nim.DAT`, `PatFill.DAT`, `milkyway.dat`) alors que les fichiers
 * sont rangés en `NIM.DAT`, `PATFILL.DAT`, `MPC/PVG.MHK` : `GameFiles.resolve` fait la correspondance,
 * insensible à la casse.
 *
 * NB : même contrat que `GameFiles` de Téléportaschtroumpf (sans les scènes) ; candidat à un partage
 * dans `src/data/` si un troisième jeu en a besoin.
 */

export interface GameFileEntry {
  /** Chemin relatif à `original/mathemagique/`, séparateur `/`. */
  path: string;
  size: number;
}

/** Nom de fichier sans dossier. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export class GameFiles {
  readonly entries: readonly GameFileEntry[];
  /** Chemin complet en minuscules -> chemin réel. */
  private readonly byPath = new Map<string, string>();
  /** Nom seul en minuscules -> chemins. */
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
   * Chemin réel d'un fichier, casse indifférente. `name` peut être un chemin complet (`mpc/pvg.mhk`) ou
   * un simple nom (`pvg.mhk`) ; dans ce cas le premier chemin portant ce nom (ordre trié) est renvoyé.
   */
  resolve(name: string): string | undefined {
    const exact = this.byPath.get(name.replace(/\\/g, "/").toLowerCase());
    if (exact) return exact;
    return this.byName.get(baseName(name.replace(/\\/g, "/")).toLowerCase())?.[0];
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

/** Charge `files.json` sous `base` (ex. `/mathemagique`). */
export async function fetchGameFiles(base: string): Promise<GameFiles> {
  const response = await fetch(`${base.replace(/\/$/, "")}/files.json`);
  if (!response.ok) throw new Error(`files.json : HTTP ${response.status}`);
  return new GameFiles((await response.json()) as GameFileEntry[]);
}
