/**
 * Exécution du script des missions (bloc 600, docs/swiv3d/screens.md §5) : `gm_main_game` avance d'élément en élément ; ce module en
 * absorbe les éléments internes (variables, pistes, couleur) et ne rend que ce que l'application doit faire.
 */
import { END_MISSION, type MissionScript, type ScriptElement } from "../data/missions";

/** Variables d'état de mission (§5.3) : numéro -> valeur (`0` véhicule, `1` énergie, `100 + k` munitions de l'arme `k`…). */
export type MissionVars = ReadonlyMap<number, number>;

export type ScriptStep =
  /** Début de la mission `index` (élément `200`) : la meilleure mission du pilote passe à `index` si elle est plus basse. */
  | { kind: "mission"; index: number }
  /** Vidéo de briefing (`500`) : musique coupée, texte `.SCR` pour les noms `BR_TER*`. */
  | { kind: "video"; name: string; mission: number }
  /** Niveau à jouer (`300`) avec l'état de la mission et la table des pistes (`400`). */
  | { kind: "level"; name: string; mission: number; vars: MissionVars; tracks: readonly number[] }
  /** Fin du script (`-1`) ; `completed` si l'élément `-2` a été passé (aventure terminée). */
  | { kind: "finished"; completed: boolean };

/** Pistes de CD par défaut, remises en haut de la boucle principale (`{2, 9, 3, 2, 2, 2}`). */
export const DEFAULT_TRACKS: readonly number[] = [2, 9, 3, 2, 2, 2];

export class MissionScriptRunner {
  private at: number;
  private mission = 0;
  private completed = false;
  private finishedFlag = false;
  private tracks: readonly number[] = DEFAULT_TRACKS;
  private readonly vars = new Map<number, number>();

  /**
   * `startMission` : `undefined` = élément 0 (« Commencer le jeu »), sinon l'élément `200 n` (« Continuer », « Rejouer la mission »).
   * Une mission absente du script est une erreur : l'appelant ne propose que des missions listées.
   */
  constructor(
    private readonly script: MissionScript,
    startMission?: number,
  ) {
    if (startMission === undefined) this.at = 0;
    else {
      const found = script.elements.findIndex((e) => e.kind === "mission" && e.index === startMission);
      if (found < 0) throw new Error(`script : mission ${startMission} introuvable`);
      this.at = found;
    }
  }

  get finished(): boolean {
    return this.finishedFlag;
  }

  get currentMission(): number {
    return this.mission;
  }

  /** Prochain pas visible ; après le dernier, renvoie toujours `finished`. */
  next(): ScriptStep {
    const elements = this.script.elements;
    while (!this.finishedFlag) {
      const element = elements[this.at++];
      if (!element || element.kind === "end") {
        this.finishedFlag = true;
        break;
      }
      const step = this.run(element);
      if (step) return step;
    }
    return { kind: "finished", completed: this.completed };
  }

  private run(element: ScriptElement): ScriptStep | null {
    switch (element.kind) {
      case "mission":
        this.mission = element.index;
        // L'état de la mission repart de zéro à chaque mission : les éléments 100-103 qui suivent le refont (`FUN_0046ea00`).
        return { kind: "mission", index: element.index };
      case "variable": {
        const old = this.vars.get(element.variable) ?? 0;
        const v = element.value;
        this.vars.set(element.variable, element.operation === "set" ? v : element.operation === "max" ? Math.max(old, v) : element.operation === "min" ? Math.min(old, v) : old + v);
        return null;
      }
      case "tracks":
        this.tracks = element.tracks;
        return null;
      case "video":
        return { kind: "video", name: element.name, mission: this.mission };
      case "level":
        return { kind: "level", name: element.name, mission: this.mission, vars: new Map(this.vars), tracks: this.tracks };
      case "complete":
        this.completed = true;
        return null;
      case "color":
      case "unknown":
      case "end":
        return null;
    }
  }
}

/**
 * Les missions que « Rejouer la mission » propose : de 0 à la meilleure atteinte (toutes celles de la chaîne si l'aventure est terminée),
 * limitées aux niveaux dont le fichier existe (`hasLevel`) : le script en cite 17, l'édition livrée n'en a que 4.
 */
export function replayableMissions(script: MissionScript, bestMission: number, completed: boolean, hasLevel: (level: string) => boolean): number[] {
  return script.missions
    .filter((m) => m.level !== undefined && m.index !== END_MISSION && hasLevel(m.level) && (completed || m.index <= bestMission))
    .map((m) => m.index);
}
