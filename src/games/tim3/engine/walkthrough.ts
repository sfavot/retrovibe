/**
 * Visite guidée du Labo (« Exercice », mode 6), sans DOM, lue dans TIMWIN.EXE.
 *
 * Le professeur accompagne la construction d'un puzzle maison dans `HELP.ITF` (41d9a3 avec l'identifiant 0, au départ du mode 6 :
 * 422b65, puis à chaque clic sur son portrait de la barre, `TB_WALKTHROUGH` : 41922f). Ses textes sont les 34 lignes de `PROFESOR.RES`
 * (chargées sous 10001, 41d9ac) et ses voix celles de `PROFESOR.VOC` de même rang (41eda1 : 4000 + ligne).
 *
 * **État** (41eaaa, 41dce4) : trois masques d'étapes, `done` (`[0x4728a4]`, étapes finies), `visited` (`[0x4728a8]`, étape déjà
 * demandée une fois) et `have` (`[0x4728a0]`, ce que la machine a déjà). L'étape courante est le premier bit absent de `done` :
 * 1 bienvenue, 2 pièces, 4 musique, 8 but, 0x10 nom, 0x20 solution, 0x40 indices, 0x80 tout verrouiller, 0x100 déverrouiller,
 * 0x200 sauvegarde, 0x400 fin. Le texte est la ligne de base de l'étape, + 1 si `have`, + 2 si `visited` (avec des exceptions,
 * `view`). À chaque affichage, `have` est recalculé d'après la machine : 5 pièces posées au moins (41edd7 compte fixes et
 * mobiles), but écrit (`[0x4811e8]`), nom (`[0x4811c0]`), indices (`[0x47eb74]`), solution (`[0x47fe30]`) ; un but ou un nom effacé
 * rouvre son étape.
 *
 * **Boutons** (41dce4) : « Continuer » (HP_YES) fait l'action de l'étape la première fois (`visited`), puis la valide ; « Retourner »
 * (HP_NO, montré seulement une fois l'étape demandée) refait l'action ; « Salut! » (HP_CANCEL, Échap) quitte la visite après 31136
 * (« Le puzzle n'a pas été sauvegardé… ») ; « Terminé » (HP_DONE) n'apparaît qu'à la fin. Les actions ferment la fenêtre (le joueur
 * travaille, puis clique sur le professeur de la barre) ou ouvrent une autre fenêtre après laquelle la visite revient (41d9a3 :
 * guitare, tout verrouiller, sauvegarde).
 */
import type { LabPuzzle } from "./lab-puzzle";
import type { World } from "./world";

export const WALK_STEP = {
  intro: 0x1,
  parts: 0x2,
  music: 0x4,
  goal: 0x8,
  name: 0x10,
  solution: 0x20,
  hints: 0x40,
  lock: 0x80,
  unlock: 0x100,
  save: 0x200,
  end: 0x400,
} as const;

/** Pièces à poser avant d'aller plus loin (41de8f : plus de 4). */
export const WALK_MIN_PARTS = 5;
/** Longueur du nom du puzzle (41e095 : EDIT de 0x1d caractères). */
export const WALK_NAME_MAX = 29;
/** Ligne de `PROFESOR.RES` affichée pendant la saisie du nom (41e344 : 10034). */
export const WALK_NAME_LINE = 33;
/** `INTRFACE.RES` : « Le puzzle n'a pas été sauvegardé et sera effacé. Désirez-vous quitter? » (41e41b). */
export const WALK_LEAVE_TEXT = 31136;

/** Première ligne de chaque étape (41eb74 … 41ed1b : 10001 + décalage). */
const BASE_LINE: Readonly<Record<number, number>> = {
  [WALK_STEP.intro]: 0,
  [WALK_STEP.parts]: 2,
  [WALK_STEP.music]: 6,
  [WALK_STEP.goal]: 9,
  [WALK_STEP.name]: 13,
  [WALK_STEP.solution]: 21,
  [WALK_STEP.hints]: 17,
  [WALK_STEP.lock]: 25,
  [WALK_STEP.unlock]: 27,
  [WALK_STEP.save]: 29,
  [WALK_STEP.end]: 32,
};

/** Ce que la visite lit de la machine à chaque affichage (41eaaa). */
export interface WalkFacts {
  /** Pièces posées, fixes et mobiles (41edd7). */
  parts: number;
  goal: string;
  hints: number;
  /** Au moins une condition de réussite (429870). */
  solution: boolean;
}

/** Ce que lit 41eaaa : pièces posées (listes des fixes et des mobiles, 41edd7), but, indices et conditions du puzzle maison. */
export function walkFacts(world: World, lab: LabPuzzle | null): WalkFacts {
  return { parts: [...world.statics, ...world.mobiles].length, goal: lab?.goal ?? "", hints: lab?.hintCount ?? 0, solution: (lab?.conditions.length ?? 0) > 0 };
}

/** Boutons de `HELP.ITF` que la visite montre. */
export interface WalkButtons {
  yes: boolean;
  no: boolean;
  cancel: boolean;
  done: boolean;
}

export interface WalkView {
  step: number;
  /** Ligne de `PROFESOR.RES` (0 à 33). */
  line: number;
  /** Voix de `PROFESOR.VOC` (même rang que la ligne) ; `null` pendant la saisie du nom (le professeur ne repart pas, 41e344). */
  voice: number | null;
  buttons: WalkButtons;
  /** Saisie du nom ouverte dans HP_TITLE (EDIT noir sur blanc, 41dc71). */
  naming: boolean;
}

export type WalkButton = "yes" | "no" | "cancel" | "done" | "title";

/** Ce que fait l'hôte après un bouton. */
export type WalkEffect =
  /** Nouveau texte dans la même fenêtre (41e567). */
  | { kind: "refresh" }
  /** La fenêtre se ferme, le joueur travaille ; `goal` : la barre du but prend le focus (action 2), `hints` : l'éditeur d'indices (41d96f). */
  | { kind: "close"; then: "build" | "goal" | "solution" | "hints" | "unlock" }
  /** Action 1 (41da47) : la guitare, puis la visite revient. */
  | { kind: "music" }
  /** Action 3 (41da84 → 4209e5(0)) : toutes les pièces verrouillées, puis la visite revient. */
  | { kind: "lockAll" }
  /** Action 4 (41da8e → 41edfc) : sauvegarde du puzzle (`saved`), puis la visite revient. */
  | { kind: "save" }
  /** « Salut! » : `confirm` 31136 d'abord (visite pas finie), puis le menu principal (mode 7). */
  | { kind: "leave"; confirm: boolean }
  /** Rien. */
  | { kind: "none" };

export class Walkthrough {
  done = 0;
  visited = 0;
  have = 0;
  /** Saisie du nom ouverte (`[0x4728f0]`). */
  naming = false;
  /** Nom du puzzle (`[0x4811c0]`, 29 caractères). */
  name = "";
  /** Texte de la saisie en cours. */
  draft = "";

  constructor(
    /** Le joueur a déjà rencontré le professeur (`[0x4728c0]`) : « Salut! Professeur Tim… » au lieu de la présentation. */
    public met = false,
  ) {}

  /** Étape courante : premier bit absent de `done` (41dce8). */
  get step(): number {
    let bit = 1;
    while (this.done & bit) bit <<= 1;
    return bit;
  }

  get finished(): boolean {
    return this.step === WALK_STEP.end;
  }

  /** 41eaaa : `have` recalculé d'après la machine, puis le texte et les boutons de l'étape. */
  view(facts: WalkFacts): WalkView {
    if (this.met) this.have |= WALK_STEP.intro;
    // 41eadf : 5 pièces au moins (les deux branches de 41eaee posent le bit).
    if (facts.parts >= WALK_MIN_PARTS) this.have |= WALK_STEP.parts;
    else this.have &= ~WALK_STEP.parts;
    this.reopenIf(this.name !== "", WALK_STEP.name);
    this.reopenIf(facts.goal !== "", WALK_STEP.goal);
    if (facts.hints > 0) this.have |= WALK_STEP.hints;
    else this.have &= ~WALK_STEP.hints;
    if (facts.solution) this.have |= WALK_STEP.solution;
    else this.have &= ~WALK_STEP.solution;

    const step = this.step;
    const has = (this.have & step) !== 0;
    const asked = (this.visited & step) !== 0;
    const buttons: WalkButtons = { yes: true, no: asked, cancel: true, done: false };
    let line = BASE_LINE[step]! + (has ? 1 : 0) + (asked ? 2 : 0);
    switch (step) {
      case WALK_STEP.intro:
        // 41ec4c : la présentation n'est faite qu'une fois.
        this.met = true;
        break;
      case WALK_STEP.music:
        // 41ec66 : demandé et déjà là, une ligne de moins ; `have` n'a jamais ce bit, la ligne 7 (« déjà des mélodies ») ne sort pas.
        if (asked && has) line--;
        break;
      case WALK_STEP.goal:
        if (facts.goal === "") buttons.no = false;
        break;
      case WALK_STEP.name:
        if (this.name === "") buttons.no = false;
        break;
      case WALK_STEP.unlock:
        // 41ece0 : 27, ou 28 une fois demandé.
        line = BASE_LINE[step]! + (asked ? 1 : 0);
        break;
      case WALK_STEP.save:
        // 41ecfa : 29 ; sauvegarde ratée 30 ; réussie 31, sans « Retourner ».
        line = BASE_LINE[step]! + (has ? 1 : 0) + (asked ? 1 : 0);
        if (asked) buttons.no = false;
        break;
      case WALK_STEP.end:
        Object.assign(buttons, { yes: false, no: false, cancel: false, done: true });
        line = BASE_LINE[step]!;
        break;
    }
    if (this.naming) return { step, line: WALK_NAME_LINE, voice: null, buttons: { yes: true, no: false, cancel: false, done: false }, naming: true };
    return { step, line, voice: line, buttons, naming: false };
  }

  /** 41eb08 … 41eb32 : un nom ou un but effacé rouvre son étape. */
  private reopenIf(present: boolean, bit: number): void {
    if (present) this.have |= bit;
    else {
      this.have &= ~bit;
      this.done &= ~bit;
    }
  }

  /** Un bouton de la fenêtre (41dce4) ; l'étape est celle du dernier affichage. */
  press(button: WalkButton, facts: WalkFacts): WalkEffect {
    const step = this.step;
    switch (button) {
      case "title":
        return this.naming ? this.commitName() : { kind: "none" };
      case "yes":
        return this.naming ? this.commitName() : this.yes(step, facts);
      case "no":
        return this.no(step);
      case "cancel":
        // 41e401 : visite finie, on part sans question ; sinon 31136.
        return { kind: "leave", confirm: !this.finished };
      case "done":
        return this.finished ? { kind: "leave", confirm: false } : { kind: "none" };
    }
  }

  private mark(bit: number): WalkEffect {
    this.done |= bit;
    return { kind: "refresh" };
  }

  /** 41ddd4 … 41e1d4 : « Continuer ». */
  private yes(step: number, facts: WalkFacts): WalkEffect {
    const asked = (this.visited & step) !== 0;
    switch (step) {
      case WALK_STEP.intro:
        this.met = true;
        this.visited |= step;
        return this.mark(step);
      case WALK_STEP.parts:
        if (asked && facts.parts >= WALK_MIN_PARTS) return this.mark(step);
        this.visited |= step;
        return { kind: "close", then: "build" };
      case WALK_STEP.music:
        if (asked) return this.mark(step);
        this.visited |= step;
        return { kind: "music" };
      case WALK_STEP.goal:
        if (asked && facts.goal !== "") return this.mark(step);
        this.visited |= step;
        return { kind: "close", then: "goal" };
      case WALK_STEP.name:
        if (asked && this.name !== "") return this.mark(step);
        return this.openName();
      case WALK_STEP.solution:
        if (asked) return this.mark(step);
        this.visited |= step;
        return { kind: "close", then: "solution" };
      case WALK_STEP.hints:
        if (asked) return this.mark(step);
        this.visited |= step;
        return { kind: "close", then: "hints" };
      case WALK_STEP.lock:
        this.done |= step;
        this.visited |= step;
        this.have |= step;
        return { kind: "lockAll" };
      case WALK_STEP.unlock:
        if (asked) {
          this.have |= step;
          return this.mark(step);
        }
        this.visited |= step;
        return { kind: "close", then: "unlock" };
      case WALK_STEP.save:
        if (asked) return this.mark(step);
        return { kind: "save" };
      default:
        return { kind: "none" };
    }
  }

  /** 41e20d … 41e3cc : « Retourner ». */
  private no(step: number): WalkEffect {
    switch (step) {
      case WALK_STEP.parts:
        return { kind: "close", then: "build" };
      case WALK_STEP.music:
        return { kind: "music" };
      case WALK_STEP.goal:
        this.visited |= step;
        return { kind: "close", then: "goal" };
      case WALK_STEP.name:
        return this.openName();
      case WALK_STEP.solution:
        return { kind: "close", then: "solution" };
      case WALK_STEP.hints:
        return { kind: "close", then: "hints" };
      case WALK_STEP.lock:
        // 41e3a0 : l'étape est passée sans rien verrouiller.
        return this.mark(step);
      case WALK_STEP.unlock:
        return { kind: "close", then: "unlock" };
      default:
        // Bienvenue, sauvegarde, fin : « Retourner » n'y est jamais montré (41e564).
        return { kind: "none" };
    }
  }

  /** 41e01c / 41e2e5 : saisie ouverte, préremplie avec le nom. */
  private openName(): WalkEffect {
    this.naming = true;
    this.draft = this.name;
    return { kind: "refresh" };
  }

  /** 41df4d / 41dd5b : le texte de la saisie devient le nom du puzzle, l'étape est demandée. */
  private commitName(): WalkEffect {
    this.name = this.draft.replace(/\s+/g, " ").trim().slice(0, WALK_NAME_MAX).trim();
    this.naming = false;
    this.visited |= WALK_STEP.name;
    return { kind: "refresh" };
  }

  /** Fin de l'action 4 (41da8e) : `have` prend le bit de la sauvegarde ; réussie, l'étape est demandée (texte 31). */
  saved(ok: boolean): void {
    this.have |= WALK_STEP.save;
    if (ok) this.visited |= WALK_STEP.save;
  }
}
