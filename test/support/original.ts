import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

/** Entrée de `files.json` (manifeste produit par les scripts d'extraction). */
export interface ManifestEntry {
  path: string;
  size: number;
}

export interface OriginalFiles {
  /** Dossier absolu des fichiers du jeu. */
  readonly dir: string;
  /** Vrai si le fichier sentinelle est présent : sinon les tests qui en dépendent sont ignorés. */
  readonly has: boolean;
  /** Lit un fichier relatif à `dir`, tel que `DESKTOP.DAW` ou `MPC/PVG.MHK`. */
  read(path: string): Uint8Array;
  /** Chemins relatifs à `dir` (séparateur `/`) des fichiers dont le nom satisfait `filter`, triés. Vide si `has` est faux. */
  list(filter?: (name: string) => boolean): string[];
  /** Contenu de `files.json` s'il existe, sinon `null`. */
  manifest(): ManifestEntry[] | null;
}

/**
 * Fichiers originaux d'un jeu, situés dans `original/<game>` (`game` peut désigner un sous-dossier, tel que `teleportaschtroumpf/DATA`).
 * `sentinel` est un fichier relatif à `dir` dont la présence indique que les fichiers sont installés.
 */
export function originalFiles(game: string, sentinel: string): OriginalFiles {
  const dir = resolve(import.meta.dirname, "../../original", game);
  const has = existsSync(resolve(dir, sentinel));

  return {
    dir,
    has,
    read: (path) => readFileSync(resolve(dir, path)),
    list(filter = () => true) {
      const out: string[] = [];
      const walk = (current: string) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const full = resolve(current, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (filter(entry.name)) out.push(relative(dir, full).split(sep).join("/"));
        }
      };
      if (has) walk(dir);
      return out.sort();
    },
    manifest() {
      const file = resolve(dir, "files.json");
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    },
  };
}
