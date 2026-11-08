/**
 * Services que les vagues suivantes fournissent au moteur (`docs/fotaq/engine.md`, § 8) : la scène (marche, bobs, Joe, décor :
 * vagues G2 et R), les répliques et dialogues (vague T), les cinématiques (vague C). Le moteur de la vague G1 (état, commandes,
 * boucle) ne les appelle que par ces interfaces ; chacune a ici une version **minimale** (`StubStage`, `StubTalk`,
 * `StubCutaways`) qui suffit aux tests du moteur et sera remplacée.
 *
 * Correspondance avec ScummVM (engines/queen) : `Stage` regroupe ce que `Command` et `Logic` demandent à `Walk` (`moveJoe`,
 * `stopJoe`), à `Logic` pour les poses de Joe (`joeFace`, `joeGrab`, banques et palette des tenues), à `Graphics`
 * (`setupNewRoom`, `refreshObject`, `clearBob`, `update`) et à `Display` (`palFadeIn`, `palFadeOut`, `screenMode`) ; `Talk`
 * correspond à `Talk::speak` et `Talk::talk` ; `Cutaways` à `Cutaway::run`.
 *
 * Convention : ce qui attend des images (marcher, parler, se tourner) est une séquence et appelle `g.update()` à chaque image,
 * comme ScummVM appelle `_vm->update()`.
 */

import type { Sequence } from "../../../engine/sequence";
import { splitSpeech } from "../data/text";
import { textFrames } from "./cadence";
import type { FotaqEngine } from "./loop";
import { type Direction, type Grab, JoeWalk, Verb } from "./state";

/** Tenue de Joe : valeur de l'état du jeu `GameVar.JoeDressingMode` (`joeUseClothes`, `joeUseUnderwear`, `joeUseDress`). */
export const Outfit = { Normal: 0, Underwear: 1, Dress: 2 } as const;
export type Outfit = (typeof Outfit)[keyof typeof Outfit];

/** Résultat de `moveJoe` (`Walk::moveJoe`) : 0 arrivé, -1 interrompu ou chemin bloqué, -2 arrêté par une zone éteinte. */
export const MoveResult = { Arrived: 0, Interrupted: -1, SpecialArea: -2 } as const;

/** Scène : ce que la vague G2 (marche, bobs, Joe, caméra) et la vague R (décor, palette) implémentent. */
export interface Stage {
  /**
   * Partie graphique de `Logic::setupRoom` : décor de la pièce `room` (`roomBackdrop`), lumière, mode d'écran (`comPanel`),
   * bobs des meubles (`furniture`) et des objets de la pièce courante `g.state.room`.
   */
  setupRoom(g: FotaqEngine, room: number, comPanel: number, inCutaway: boolean, furniture: number[]): void;
  /** Partie graphique de `Logic::eraseRoom` : banques de la pièce, animations des personnes. */
  eraseRoom(g: FotaqEngine): void;
  /** Fondus de palette de la pièce (`palFadeOut`, `palFadeIn`). */
  fadeOut(g: FotaqEngine): Sequence;
  fadeIn(g: FotaqEngine): Sequence;
  /** Fin de `setupJoeInRoom` : le bob de Joe est posé à `g.state.joe` (position, échelle, orientation), caméra. */
  placeJoe(g: FotaqEngine): void;
  /** Une image des bobs et de l'affichage (`Graphics::update`, début de `QueenEngine::update`). */
  frame(g: FotaqEngine): void;
  /**
   * `Walk::moveJoe` : Joe marche jusqu'au point du décor (`facing` > 0 : orientation finale). Met `g.joeWalk` à `Move` ; la marche
   * appelle `g.update(true)` à chaque image (le joueur peut cliquer) et s'arrête si `g.joeWalk` passe à `Execute`. Une zone
   * éteinte sur le chemin appelle `g.handleSpecialArea`.
   */
  moveJoe(g: FotaqEngine, facing: Direction, x: number, y: number, inCutaway: boolean): Sequence<number>;
  /** `Walk::stopJoe`. */
  stopJoe(g: FotaqEngine): void;
  /** `Logic::joeFace` : Joe se tourne vers `g.state.joe.facing` ; `prevFacing` suit. */
  joeFace(g: FotaqEngine): Sequence;
  /** `Logic::joeGrab` : geste de saisie. */
  joeGrab(g: FotaqEngine, grab: Grab): Sequence;
  /** L'image d'un objet a changé (`Graphics::refreshObject`). */
  refreshObject(g: FotaqEngine, object: number): void;
  /** Le bob de l'objet est effacé (`Logic::findBob` puis `Graphics::clearBob`, dans `Command::setObjects`). */
  clearObjectBob(g: FotaqEngine, object: number): void;
  /** Palette et banques d'une tenue de Joe (`palSetJoeNormal`, `palSetJoeDress`, `loadJoeBanks`). */
  setOutfit(g: FotaqEngine, outfit: Outfit): void;
  /** Compose l'image à partir de l'état de la scène et la présente à l'hôte (`host.present`) ; l'hôte l'appelle à chaque image d'écran. */
  render(g: FotaqEngine): void;
}

/** Répliques et dialogues : ce que la vague T implémente (`FotaqTalk`, `dialogs.ts` et `talk.ts` ; moteur par défaut). */
export interface Talk {
  /**
   * `Talk::speak` : une réplique (segments `*`, une voix par segment `<voicePrefix><rang>`). `person` : numéro dans la pièce de
   * la personne qui parle ; `null` : Joe. Met `g.joeWalk` à `Speak`.
   */
  speak(g: FotaqEngine, text: string, person: number | null, voicePrefix: string): Sequence;
  /** `Talk::talk` : dialogue `.DOG` avec la personne `personInRoom` ; rend la cinématique à jouer ensuite (`""` : aucune). */
  dialogue(g: FotaqEngine, file: string, personInRoom: number): Sequence<string>;
}

/** Cinématiques : ce que la vague C implémente (`FotaqCutaways`, `cutaway.ts` ; moteur par défaut). */
export interface Cutaways {
  /** `Cutaway::run` : joue la cinématique `file` (`C21A.CUT`) ; rend la suivante à enchaîner (`""` : aucune). */
  play(g: FotaqEngine, file: string): Sequence<string>;
}

// --- Versions minimales ---------------------------------------------------------------------------------------------------

/**
 * Scène minimale : rien n'est dessiné, Joe se déplace d'un coup après une image (le joueur peut cliquer pendant cette image, ce
 * qui interrompt la marche comme dans ScummVM), se tourne et saisit sans image. Garde la trace des déplacements demandés.
 */
export class StubStage implements Stage {
  readonly moves: { x: number; y: number; facing: Direction }[] = [];
  readonly refreshed: number[] = [];
  readonly cleared: number[] = [];
  outfit: Outfit = Outfit.Normal;
  frames = 0;

  setupRoom(): void {}
  eraseRoom(): void {}
  *fadeOut(): Sequence {}
  *fadeIn(): Sequence {}
  placeJoe(): void {}

  frame(): void {
    this.frames++;
  }

  *moveJoe(g: FotaqEngine, facing: Direction, x: number, y: number): Sequence<number> {
    g.setJoeWalk(JoeWalk.Move);
    const joe = g.state.joe;
    this.moves.push({ x, y, facing });
    let result: number = MoveResult.Arrived;
    if (x !== joe.x || y !== joe.y) {
      yield* g.update(true);
      if (g.input.cutawayQuit || g.joeWalk === JoeWalk.Execute) result = MoveResult.Interrupted;
      else {
        joe.x = x;
        joe.y = y;
      }
    }
    if (result === MoveResult.Arrived && facing > 0) joe.facing = facing;
    yield* this.joeFace(g);
    return result;
  }

  stopJoe(): void {}

  *joeFace(g: FotaqEngine): Sequence {
    g.state.joe.prevFacing = g.state.joe.facing;
  }

  *joeGrab(): Sequence {}

  refreshObject(_g: FotaqEngine, object: number): void {
    this.refreshed.push(object);
  }

  clearObjectBob(_g: FotaqEngine, object: number): void {
    this.cleared.push(object);
  }

  setOutfit(_g: FotaqEngine, outfit: Outfit): void {
    this.outfit = outfit;
  }

  render(): void {}
}

/** Une réplique dite (trace de `StubTalk`). */
export interface SpokenLine {
  /** `null` : Joe. */
  person: number | null;
  text: string;
  voicePrefix: string;
}

/**
 * Répliques minimales : la réplique est notée et dure le temps d'un texte sans voix (`textFrames`) ; un clic droit pendant la
 * réplique (`talkQuit`) ou l'action `skipText` l'arrête. Les dialogues sont notés et ne font rien.
 */
export class StubTalk implements Talk {
  readonly lines: SpokenLine[] = [];
  readonly dialogues: { file: string; person: number }[] = [];

  *speak(g: FotaqEngine, text: string, person: number | null, voicePrefix: string): Sequence {
    g.input.talkQuit = false;
    g.setJoeWalk(JoeWalk.Speak);
    if (!text) return;
    this.lines.push({ person, text, voicePrefix });
    const spoken = splitSpeech(text)
      .filter((segment) => segment.command.kind !== "grab")
      .map((segment) => segment.text)
      .join("");
    for (let i = textFrames(spoken); i > 0; i--) {
      yield* g.update();
      if (g.input.talkQuit) break;
      if (g.input.keyVerb === Verb.SkipText) {
        g.input.keyVerb = Verb.None;
        break;
      }
    }
  }

  *dialogue(_g: FotaqEngine, file: string, personInRoom: number): Sequence<string> {
    this.dialogues.push({ file, person: personInRoom });
    return "";
  }
}

/** Cinématiques minimales : notées, sans effet ni suite. */
export class StubCutaways implements Cutaways {
  readonly played: string[] = [];

  *play(_g: FotaqEngine, file: string): Sequence<string> {
    this.played.push(file);
    return "";
  }
}
