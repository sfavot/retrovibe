import type { Variables } from "./variables";

/**
 * Parties du jeu. MENU.TOT ne lit l'état initial d'une partie (CAT2/3/4.INF, image complète des variables)
 * qu'à son démarrage, d'après la scène de départ (`vs[1133]`) : EMAM1000 (partie 2), EMAM1104 (partie 3),
 * EMAM1036 (partie 4). Aucun script ne le refait quand une cinématique enchaîne seule sur la partie
 * suivante : on repart donc d'un MENU neuf, comme à l'insertion du CD suivant (voir `Game.relaunchForPart`).
 */
export const PART_STARTS: Record<string, { file: string; part: number }> = {
  EMAM1000: { file: "CAT2.INF", part: 2 },
  EMAM1104: { file: "CAT3.INF", part: 3 },
  EMAM1036: { file: "CAT4.INF", part: 4 },
};

/**
 * Fichier d'état initial de la partie que décrit l'image des variables, d'après les variables que
 * MENU.TOT teste lui-même : lieu `v8[13433]` (1 = partie 2, 3 = partie 4, 2 = Briscarde) et, pour la
 * Briscarde, `v8[8256]` (0 = partie 1, 1 = partie 3, qui choisit le fichier PARTIEn.ITK). Null si inconnue.
 */
export function partOfVariables(v: Variables): string | null {
  switch (v.readOff8(13433)) {
    case 1:
      return "CAT2.INF";
    case 2:
      return v.readOff8(8256) === 1 ? "CAT3.INF" : null;
    case 3:
      return "CAT4.INF";
    default:
      return null;
  }
}

/** Fichier d'état d'une partie lu par le jeu (CAT2.INF à CAT4.INF), sinon null. */
export function isPartStateFile(file: string): boolean {
  return /^CAT[234]\.INF$/i.test(file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1));
}

/** Numéro de la partie d'un fichier PARTIEn.ITK, sinon 0. */
export function partOfItk(file: string): number {
  const m = /^PARTIE([1-4])\.ITK$/i.exec(file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1));
  return m ? Number(m[1]) : 0;
}
