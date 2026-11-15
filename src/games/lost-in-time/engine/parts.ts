import type { GameHooks } from "../../../engine/coktel/definition";
import type { Game } from "../../../engine/coktel/game";
import type { Variables } from "../../../engine/coktel/variables";

/**
 * Parties du jeu. MENU.TOT ne lit l'état initial d'une partie (CAT2/3/4.INF, image complète des variables)
 * qu'à son démarrage, d'après la scène de départ (`vs[1133]`) : EMAM1000 (partie 2), EMAM1104 (partie 3),
 * EMAM1036 (partie 4). Aucun script ne le refait quand une cinématique enchaîne seule sur la partie
 * suivante : on repart donc d'un MENU neuf, comme à l'insertion du CD suivant (voir `PartTracker`).
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

/**
 * Suivi de la partie en mémoire, branché sur l'interpréteur par les crochets du jeu.
 *
 * MENU.TOT lit CAT2/3/4.INF (état initial de la partie) seulement à son démarrage, après avoir détecté
 * la partie d'après les PARTIEn.ITK présents (la plus basse gagne). Quand la boucle de MENU lance la scène
 * de départ d'une autre partie que celle en mémoire (cinématique de fin qui enchaîne seule, ex. EMAM1102
 * puis EMAM1104), aucun script ne relit cet état : on repart d'un MENU neuf, comme à l'insertion du CD
 * suivant, en masquant le temps de la détection les PARTIEn.ITK des parties précédentes (`partFloor`).
 * Sans cela la partie 3 démarre avec les variables de la partie 2.
 */
export class PartTracker implements GameHooks {
  /** Partie dont l'état (CATn.INF ou sauvegarde) est en mémoire ; null si inconnue. */
  sessionPart: string | null = null;
  /** Pendant le redémarrage de MENU sur une partie : les PARTIEn.ITK de numéro inférieur sont absents. */
  partFloor = 0;

  beforeTotSub(game: Game, scene: string): boolean {
    if (this.relaunchForPart(game, scene)) return true;
    this.partFloor = 0; // la détection des parties (début de MENU) est passée
    return false;
  }

  hidesFile(_game: Game, file: string): boolean {
    return partOfItk(file) < this.partFloor;
  }

  afterReadData(game: Game, read: { file: string; fromSave: boolean; dataVar: number; size: number }): void {
    // Sauvegarde chargée en entier, ou état initial d'une partie lu par MENU.TOT : l'image des variables
    // est celle de cette partie (pour détecter un enchaînement sur une autre).
    const whole = read.fromSave ? read.size === 0 : read.dataVar === 0 && isPartStateFile(read.file);
    if (whole) this.sessionPart = partOfVariables(game.inter.vars);
  }

  private relaunchForPart(game: Game, scene: string): boolean {
    const wanted = PART_STARTS[scene.toUpperCase()];
    if (!wanted || game.environmentDepth !== 0 || !this.sessionPart || this.sessionPart === wanted.file) return false;
    if (!game.inter.variables) return false;
    this.sessionPart = null;
    this.partFloor = wanted.part;
    game.inter.vars.writeVar32(58, 0);
    game.totToLoad = "MENU.TOT";
    game.inter.terminate = 1;
    return true;
  }
}
