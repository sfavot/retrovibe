/**
 * Commandes du joueur et interpréteur des listes de commandes de `QUEEN.JAS` (`docs/fotaq/engine.md`, § 6). Réécriture de
 * `Command` et `CmdText` (engines/queen/command.cpp, command.h, ScummVM) : construction de la phrase de commande (« utiliser
 * clef avec porte ») au clic et au clavier, survol, puis exécution : marche jusqu'à l'objet, choix de la liste de commandes,
 * conditions sur les états du jeu, effets (zones, objets, inventaire, image de l'objet, morceau, sections spéciales), réplique,
 * cinématique ou dialogue, état ouvert / fermé.
 *
 * Ce qui bloquait dans ScummVM (`executeCurrentAction` et tout ce qu'elle appelle) est une séquence ; la lecture du joueur
 * (`updatePlayer`, survol, choix) est synchrone. Le texte de la ligne de commande est un état (`text`, `line`) que le rendu dessine
 * (vague R).
 *
 * Écarts volontaires :
 * - seul le texte français existe : la variante hébraïque et la variante grecque de `CmdText` ne sont pas portées ;
 * - `nextObjectDescription` de ScummVM boucle sans fin pour une description aléatoire à un seul texte : la boucle est bornée (le
 *   cas n'existe pas dans le jeu) ;
 * - le hasard (`randomizer.getRandomNumber(n)`, de 0 à n) est le `Lcg` du moteur, à graine fixée par l'hôte.
 * Correctifs de ScummVM reproduits : la liste 649 n'est jamais exécutée (bug 2636, cascade de la pièce 56) ; la commande d'objet
 * 175 est corrigée à la lecture (`data/jas.ts`).
 */

import type { Sequence } from "../../../engine/sequence";
import type { JasCommand, JasItem, JasObject } from "../data/jas";
import { GridScreen, ROOM_ZONE_HEIGHT } from "./grid";
import { MouseButton } from "./host";
import type { FotaqEngine } from "./loop";
import { isPerson, objectCopy } from "./room";
import {
  JoeWalk,
  Verb,
  isActionVerb,
  isInventoryScrollVerb,
  isInventoryVerb,
  stateDefaultVerb,
  stateDirection,
  stateGrab,
  stateOn,
  toInt16,
  usesWith,
  withDefaultVerb,
  withOn,
} from "./state";

/** Liste de commandes ignorée (bug 2636 de ScummVM : cascade de gauche de la pièce 56 ; la cinématique est jouée par la 648). */
const SKIPPED_COMMAND = 649;
/** Réponses de Joe (numéros de `joeResponses`, texte français de `QUEEN2.JAS`) dites par le moteur. */
const Reply = {
  /** « On dirait que ça ne s'ouvre pas. » */
  DoesNotOpen: 1,
  /** « On dirait que ça ne marche pas. » */
  DoesNotWork: 2,
  /** « Je ne peux pas déplacer ça. » */
  CantMove: 3,
  /** « C'est déjà ouvert ! », « C'est déjà fermé ! » */
  AlreadyOpen: 9,
  AlreadyClosed: 10,
  /** « Il ne vaut mieux pas, je pourrais en avoir besoin. » */
  MightNeedIt: 11,
  /** « Je dois prendre ça avant de faire quoi que ce soit. » */
  TakeItFirst: 12,
  /** « Je transporte déjà ça. » */
  AlreadyCarrying: 14,
  /** « Je n'aime pas me comporter en grosse brute. » */
  NoBully: 18,
  /** « Non merci. Je suis un solitaire… » */
  NoThanks: 20,
  /** 24 à 26, au hasard : pas de réponse à attendre. */
  NoAnswer: 24,
  /** 27 à 29, au hasard : Joe garde l'objet. */
  KeepIt: 27,
  /** 5 à 8, au hasard : « Qu'est-ce que j'en ferais ? »… */
  DontNeedIt: 5,
} as const;

/** Encre de la ligne de commande (`INK_CMD_NORMAL`, `INK_CMD_SELECT`). */
export type CommandInk = "normal" | "select";

/** Texte affiché sur la ligne de commande. */
export interface CommandLine {
  text: string;
  ink: CommandInk;
}

function endsWithFile(description: string, extension: string): boolean {
  return description.length > 4 && description.slice(-4).toUpperCase() === extension;
}

export class Command {
  // --- `CmdState` ---
  /** Verbe sous le curseur ou tapé (`verb`). */
  verb: number = Verb.None;
  /** Verbe de la commande en construction (`action`). */
  action: number = Verb.None;
  oldVerb: number = Verb.None;
  /** Objet sous le curseur, numéro dans la pièce (`noun`). */
  noun = 0;
  oldNoun = 0;
  /** Sujets de la commande : objet du jeu (> 0) ou objet d'inventaire (< 0, `-n`). */
  subject: [number, number] = [0, 0];
  /** 2 : la commande attend son second objet (« utiliser X avec… », « donner X à… »). */
  commandLevel = 1;
  /** Verbe et objet de la commande à exécuter (`selAction`, `selNoun`). */
  selAction: number = Verb.None;
  selNoun = 0;
  // --- `Command` ---
  /** La commande est complète (`_parse`). */
  parse = false;
  /** Boutons du clic en cours (`_mouseKey`). */
  mouseKey = 0;
  /** Point visé dans le décor (`_selPosX`, défilement compris ; `_selPosY`). */
  selPosX = 0;
  selPosY = 0;
  /** Phrase de commande construite (`CmdText::_command`). */
  text = "";
  /** Ce qu'affiche la ligne de commande (`setTextCentered` à `COMMAND_Y_POS`) ; `null` : rien. */
  line: CommandLine | null = null;

  constructor(private readonly g: FotaqEngine) {}

  private get objects(): JasObject[] {
    return this.g.state.objects;
  }

  private get lists(): JasCommand[] {
    return this.g.data.jas.commands.lists;
  }

  // --- Ligne de commande (`CmdText`) --------------------------------------------------------------------------------------

  private setVerb(verb: number): void {
    this.text = this.g.verbName(verb);
  }

  private addLinkWord(verb: number): void {
    this.text += ` ${this.g.verbName(verb)}`;
  }

  private addObject(name: string): void {
    this.text += ` ${name}`;
  }

  private display(ink: CommandInk, text = this.text): void {
    this.line = { text, ink };
  }

  /** Affichage temporaire : la phrase suivie d'un nom d'objet (`displayTemp`). */
  private displayTemp(ink: CommandInk, name: string): void {
    this.line = { text: `${this.text} ${name}`, ink };
  }

  /** Efface la ligne de commande (`clearTexts(COMMAND_Y_POS)`). */
  clearLine(): void {
    this.line = null;
  }

  /**
   * Une commande est en construction : un verbe choisi, ou le premier objet de « utiliser … avec » / « donner … à ». Une sauvegarde
   * ne la garde pas (`loadGame` remet la commande à zéro, comme ScummVM).
   */
  get pending(): boolean {
    return this.commandLevel !== 1 || this.verb !== Verb.None || this.selAction !== Verb.None || this.subject[0] !== 0 || this.subject[1] !== 0;
  }

  /** Remet la commande à zéro (`Command::clear`) ; `clearTexts` efface aussi la ligne affichée. */
  clear(clearTexts: boolean): void {
    this.text = "";
    if (clearTexts) this.line = null;
    this.parse = false;
    this.commandLevel = 1;
    this.oldVerb = this.verb = this.action = Verb.None;
    this.oldNoun = this.noun = 0;
    this.subject = [0, 0];
    this.selAction = Verb.None;
    this.selNoun = 0;
  }

  // --- Lecture du joueur ---------------------------------------------------------------------------------------------------

  /** Une image de lecture du joueur (`updatePlayer`) : survol, verbe tapé, clic. */
  updatePlayer(): void {
    const { input } = this.g;
    if (this.g.joeWalk !== JoeWalk.Move) {
      this.lookForCurrentObject(input.mouseX, input.mouseY);
      this.lookForCurrentIcon(input.mouseX, input.mouseY);
    }
    if (input.keyVerb !== Verb.None) {
      if (input.keyVerb === Verb.UseJournal) {
        this.g.useJournal();
      } else if (input.keyVerb !== Verb.SkipText) {
        this.verb = input.keyVerb;
        if (isInventoryVerb(this.verb)) {
          this.noun = this.selNoun = 0;
          this.oldNoun = 0;
          this.oldVerb = Verb.None;
          this.grabSelectedItem();
        } else {
          this.grabSelectedVerb();
        }
      }
      input.keyVerb = Verb.None;
    }
    this.mouseKey = input.takeMouseButton();
    if (this.mouseKey > 0) this.grabCurrentSelection();
  }

  private grabCurrentSelection(): void {
    const { grid, input } = this.g;
    this.selPosX = input.mouseX;
    this.selPosY = input.mouseY;
    const zone = grid.findObjectUnderCursor(this.selPosX, this.selPosY, this.g.horizontalScroll);
    this.noun = grid.findObjectNumber(zone);
    this.verb = grid.findVerbUnderCursor(this.selPosX, this.selPosY);
    this.selPosX += this.g.horizontalScroll;
    if (isActionVerb(this.verb) || isInventoryScrollVerb(this.verb)) {
      this.grabSelectedVerb();
    } else if (isInventoryVerb(this.verb)) {
      this.grabSelectedItem();
    } else if (this.noun !== 0) {
      this.grabSelectedNoun();
    } else if (this.selPosY < ROOM_ZONE_HEIGHT && this.verb === Verb.None) {
      // Clic sans commande dans le décor : Joe y marche.
      this.clear(true);
      this.g.setJoeWalk(JoeWalk.Execute);
    }
  }

  /** Ajoute un objet à la commande ; si elle est complète, la confie à la boucle (`grabSelectedObject`). */
  private grabSelectedObject(object: number, objectState: number, objectName: number): void {
    if (this.action !== Verb.None) this.addObject(this.g.objectName(objectName));
    this.subject[this.commandLevel - 1] = object;
    if (this.action === Verb.Use && this.commandLevel === 1 && usesWith(objectState)) {
      this.commandLevel = 2;
      this.addLinkWord(Verb.With);
      this.display("normal");
      this.parse = false;
    } else if (this.action === Verb.Give && this.commandLevel === 1) {
      this.commandLevel = 2;
      this.addLinkWord(Verb.To);
      this.display("normal");
      this.parse = false;
    } else {
      this.parse = true;
    }
    if (this.parse) {
      this.verb = Verb.None;
      this.g.setJoeWalk(JoeWalk.Execute);
      this.selAction = this.action;
      this.action = Verb.None;
    }
  }

  /** Objet d'inventaire de la case `verb` (`findItemData`), s'il y en a un. */
  private itemAt(verb: number): JasItem | null {
    const item = this.g.inventory.find(verb - Verb.Inventory1);
    return item === 0 ? null : this.g.state.items[item];
  }

  private grabSelectedItem(): void {
    const data = this.itemAt(this.verb);
    if (!data || data.name <= 0) return;
    const item = this.g.inventory.find(this.verb - Verb.Inventory1);
    const keyVerb = this.g.input.keyVerb;
    // Au clavier sans commande en cours : le verbe par défaut de l'objet ; au clic gauche : « examiner ».
    if (this.mouseKey === MouseButton.Left || (keyVerb !== Verb.None && this.verb !== Verb.None)) {
      if (this.action === Verb.None) {
        if (keyVerb !== Verb.None) {
          this.verb = stateDefaultVerb(data.state);
          if (this.verb === Verb.None) {
            this.verb = Verb.LookAt;
            this.setVerb(Verb.LookAt);
          }
          this.action = this.verb;
        } else {
          this.action = Verb.LookAt;
          this.setVerb(Verb.LookAt);
        }
      }
      this.verb = Verb.None;
    } else if (this.text === "") {
      this.verb = Verb.LookAt;
      this.action = Verb.LookAt;
      this.setVerb(Verb.LookAt);
    } else {
      this.verb = this.commandLevel === 2 && this.parse ? this.action : stateDefaultVerb(data.state);
      if (this.verb === Verb.None) {
        this.action = Verb.LookAt;
        this.setVerb(Verb.LookAt);
      } else {
        this.action = this.verb;
      }
      this.verb = Verb.None;
    }
    this.grabSelectedObject(-item, data.state, data.name);
  }

  /** Objet du jeu d'un numéro dans la pièce (`findObjectData`), s'il y en a un. */
  private objectInRoom(noun: number): JasObject | null {
    return noun === 0 ? null : this.objects[noun + this.g.currentRoomData];
  }

  private grabSelectedNoun(): void {
    const data = this.objectInRoom(this.noun);
    if (!data || data.name <= 0) {
      // Objet éteint : Joe marche simplement.
      this.clear(true);
      this.noun = 0;
      this.g.setJoeWalk(JoeWalk.Execute);
      return;
    }
    if (this.verb === Verb.None) {
      if (this.mouseKey === MouseButton.Left) {
        if ((this.commandLevel !== 2 && this.action === Verb.None) || (this.commandLevel === 2 && this.parse)) {
          this.verb = Verb.WalkTo;
          this.action = Verb.WalkTo;
          this.setVerb(Verb.WalkTo);
        }
      } else if (this.mouseKey === MouseButton.Right) {
        if (this.text === "") {
          this.verb = stateDefaultVerb(data.state);
          this.selAction = this.verb === Verb.None ? Verb.WalkTo : this.verb;
          this.setVerb(this.selAction);
          this.addObject(this.g.objectName(data.name));
        } else {
          this.verb =
            (this.commandLevel === 2 && !this.parse) || this.action !== Verb.None ? this.action : stateDefaultVerb(data.state);
          this.action = this.verb === Verb.None ? Verb.WalkTo : this.verb;
          this.verb = Verb.None;
        }
      }
    }
    this.selNoun = 0;
    this.grabSelectedObject(this.g.currentRoomData + this.noun, data.state, data.name);
  }

  private grabSelectedVerb(): void {
    if (isInventoryScrollVerb(this.verb)) {
      // Défile d'un objet, de quatre au clic droit.
      this.g.inventory.scroll(this.mouseKey === MouseButton.Right ? 4 : 1, this.verb === Verb.ScrollUp);
      return;
    }
    this.action = this.verb;
    this.subject = [0, 0];
    if (this.g.joeWalk === JoeWalk.Move && this.verb !== Verb.None) this.g.setJoeWalk(JoeWalk.Normal);
    this.commandLevel = 1;
    this.oldVerb = Verb.None;
    this.oldNoun = 0;
    this.setVerb(this.verb);
    this.display("normal");
  }

  /** Survol d'un objet de la pièce : son nom, précédé du verbe par défaut si aucun verbe n'est choisi (`lookForCurrentObject`). */
  private lookForCurrentObject(cursorX: number, cursorY: number): void {
    const { grid } = this.g;
    this.noun = grid.findObjectNumber(grid.findObjectUnderCursor(cursorX, cursorY, this.g.horizontalScroll));
    if (this.oldNoun === this.noun) return;
    const data = this.objectInRoom(this.noun);
    if (!data || data.name <= 0) {
      this.oldNoun = this.noun;
      this.clearLine();
      if (this.action !== Verb.None) this.display("normal");
      return;
    }
    if (this.action === Verb.None) {
      const verb = stateDefaultVerb(data.state);
      this.setVerb(verb === Verb.None ? Verb.WalkTo : verb);
      if (this.noun === 0) this.text = "";
    }
    this.displayTemp("normal", this.g.objectName(data.name));
    this.oldNoun = this.noun;
  }

  /** Survol du panneau : verbe, ou objet d'inventaire précédé de son verbe par défaut (`lookForCurrentIcon`). */
  private lookForCurrentIcon(cursorX: number, cursorY: number): void {
    this.verb = this.g.grid.findVerbUnderCursor(cursorX, cursorY);
    if (this.oldVerb === this.verb) return;
    if (this.action === Verb.None) this.text = "";
    this.clearLine();
    if (isInventoryVerb(this.verb)) {
      const data = this.itemAt(this.verb);
      if (data && data.name > 0) {
        if (this.action === Verb.None) {
          const verb = stateDefaultVerb(data.state);
          this.setVerb(verb === Verb.None ? Verb.LookAt : verb);
        }
        this.displayTemp("normal", this.g.objectName(data.name));
      }
    } else if (isActionVerb(this.verb)) {
      this.display("normal", this.g.verbName(this.verb));
    } else if (this.verb === Verb.None) {
      this.display("normal");
    }
    this.oldVerb = this.verb;
  }

  // --- Exécution -----------------------------------------------------------------------------------------------------------

  /** Listes de commandes qui correspondent exactement au verbe et aux deux sujets (`CmdListData::match`), dans l'ordre. */
  matchingLists(verb: number, subject1: number, subject2: number): number[] {
    const out: number[] = [];
    this.lists.forEach((list, id) => {
      if (id > 0 && list.verb === verb && list.object1 === subject1 && list.object2 === subject2) out.push(id);
    });
    return out;
  }

  /**
   * Exécute la commande choisie (`executeCurrentAction`) : Joe va à l'objet, puis la première liste de commandes dont les
   * conditions sont remplies est exécutée ; si aucune ne l'est, la condition manquée de la dernière liste fait parler Joe, ou
   * « examiner » donne la description de l'objet.
   */
  *executeCurrentAction(): Sequence {
    const g = this.g;
    g.state.entryObject = 0;
    if (this.mouseKey === MouseButton.Right && this.subject[0] > 0) {
      const data = this.objects[this.subject[0]];
      if (!data || data.name <= 0) {
        yield* this.cleanupCurrentAction();
        return;
      }
      this.verb = stateDefaultVerb(data.state);
      this.selAction = this.verb === Verb.None ? Verb.WalkTo : this.verb;
      this.setVerb(this.selAction);
      this.addObject(g.objectName(data.name));
    }
    this.display("select");
    this.selNoun = this.noun;
    this.commandLevel = 1;

    if (yield* this.handleWrongAction()) {
      yield* this.cleanupCurrentAction();
      return;
    }

    const matching = this.matchingLists(this.selAction, this.subject[0], this.subject[1]);
    if (matching.length === 0) {
      yield* this.sayInvalidAction(this.selAction, this.subject[0], this.subject[1]);
      this.clear(true);
      yield* this.cleanupCurrentAction();
      return;
    }

    let cond = 0;
    let list = this.lists[0];
    for (let i = 0; i < matching.length; i++) {
      const id = matching[i];
      if (id === SKIPPED_COMMAND) continue;
      list = this.lists[id];
      const last = i === matching.length - 1;
      cond = list.setConditions ? yield* this.setConditions(id, last) : 0;
      if (cond === -1 && last) {
        // Condition manquée sans réplique : « examiner » donnera la description.
        break;
      } else if (cond === -2 && last) {
        // Joe a déjà répondu.
        yield* this.cleanupCurrentAction();
        return;
      } else if (cond >= 0) {
        cond = yield* this.executeCommand(id, cond);
        break;
      }
    }

    if (this.selAction === Verb.UseJournal) {
      this.clear(true);
      return;
    }
    if (cond <= 0 && this.selAction === Verb.LookAt) {
      yield* this.lookAtSelectedObject();
    } else {
      // Morceau joué après l'action.
      if (list.song < 0) g.host.playSong(-list.song);
      this.clear(true);
    }
    yield* this.cleanupCurrentAction();
  }

  private *cleanupCurrentAction(): Sequence {
    yield* this.g.stage.joeFace(this.g);
    this.oldNoun = 0;
    this.oldVerb = Verb.None;
  }

  /**
   * Avant d'exécuter : une marche simple (clic dans le décor), un sujet caché, une sortie utilisée comme une porte, la marche
   * jusqu'à l'objet et une porte fermée arrêtent la commande (`handleWrongAction`, rend vrai).
   */
  private *handleWrongAction(): Sequence<boolean> {
    const g = this.g;
    const objMax = g.grid.objMax(g.state.room);
    if ((this.selAction === Verb.WalkTo || this.selAction === Verb.None) && (this.selNoun > objMax || this.selNoun === 0)) {
      if (this.selAction === Verb.None) this.clearLine();
      yield* g.stage.moveJoe(g, 0, this.selPosX, this.selPosY, false);
      return true;
    }
    for (const subject of this.subject) {
      if (subject > 0 && this.objects[subject].name <= 0) return true;
    }
    if (this.selAction === Verb.Use && this.subject[0] > 0 && this.objects[this.subject[0]].entryObject > 0) {
      this.selAction = Verb.WalkTo;
    }
    if (this.selNoun > 0 && this.selNoun <= objMax) {
      const object = g.currentRoomData + this.selNoun;
      if ((yield* this.makeJoeWalkTo(this.selPosX, this.selPosY, object, this.selAction, true)) !== 0) return true;
      if (this.selAction === Verb.WalkTo && this.objects[object].entryObject < 0) return true;
    }
    return false;
  }

  /**
   * Joe va à l'objet (`makeJoeWalkTo`) : à sa position s'il en a une ; « aller vers » une sortie ouverte demande la pièce suivante
   * et vise le point de sortie. Rend le résultat de la marche (0 : arrivé ; sinon le changement de pièce est annulé).
   */
  *makeJoeWalkTo(x: number, y: number, object: number, verb: number, mustWalk: boolean): Sequence<number> {
    const g = this.g;
    const state = g.state;
    const data = this.objects[object];
    if (data.x !== 0 || data.y !== 0) {
      x = toInt16(data.x);
      y = toInt16(data.y);
    }
    if (verb === Verb.WalkTo) {
      state.entryObject = data.entryObject;
      if (data.entryObject > 0) {
        state.newRoom = this.objects[data.entryObject].room;
        const walkOff = g.walkOffPoint(object);
        if (walkOff) {
          x = toInt16(walkOff.x);
          y = toInt16(walkOff.y);
        }
      }
    } else {
      state.entryObject = 0;
      state.newRoom = 0;
    }
    let result = 0;
    if (mustWalk) {
      const facing = stateDirection(data.state);
      const joe = state.joe;
      if (x === joe.x && y === joe.y) {
        joe.facing = facing;
        yield* g.stage.joeFace(g);
      } else {
        result = yield* g.stage.moveJoe(g, facing, x, y, false);
        if (result !== 0) state.newRoom = 0;
      }
    }
    return result;
  }

  /** Aucune liste ne correspond : Joe dit pourquoi (`sayInvalidAction`). */
  private *sayInvalidAction(action: number, subject1: number, subject2: number): Sequence {
    const g = this.g;
    const isPersonObject = (object: number) => isPerson(this.objects[object].image);
    switch (action) {
      case Verb.LookAt:
        yield* this.lookAtSelectedObject();
        break;
      case Verb.Open:
        yield* g.makeJoeSpeak(Reply.DoesNotOpen);
        break;
      case Verb.Use:
        if (subject1 < 0 && g.state.items[-subject1].sfxDescription > 0) {
          yield* g.makeJoeSpeak(g.state.items[-subject1].sfxDescription, true);
        } else {
          yield* g.makeJoeSpeak(Reply.DoesNotWork);
        }
        break;
      case Verb.TalkTo:
        yield* g.makeJoeSpeak(Reply.NoAnswer + g.rng.inclusive(2));
        break;
      case Verb.Close:
        yield* g.makeJoeSpeak(Reply.DoesNotWork);
        break;
      case Verb.Move:
        yield* g.makeJoeSpeak(subject1 > 0 && isPersonObject(subject1) ? Reply.NoBully : Reply.CantMove);
        break;
      case Verb.Give:
        if (subject1 >= 0) {
          yield* g.makeJoeSpeak(Reply.TakeItFirst);
        } else if (subject2 <= 0) {
          yield* g.makeJoeSpeak(Reply.MightNeedIt);
        } else if (isPersonObject(subject2)) {
          yield* g.makeJoeSpeak(Reply.KeepIt + g.rng.inclusive(2));
        }
        break;
      case Verb.PickUp:
        if (subject1 < 0) yield* g.makeJoeSpeak(Reply.AlreadyCarrying);
        else if (isPersonObject(subject1)) yield* g.makeJoeSpeak(Reply.NoThanks);
        else yield* g.makeJoeSpeak(Reply.DontNeedIt + g.rng.inclusive(3));
        break;
      default:
        break;
    }
  }

  /**
   * Conditions d'une liste (`setConditions`) : chaque état testé (numéro > 0) doit avoir sa valeur ; si c'est le cas, les états
   * à poser (numéro <= 0) le sont et la réplique du dernier est rendue (0 : aucune). Sinon rien n'est posé : rend -2 si Joe a
   * dit la réplique de la condition manquée (ou joué la cinématique, le dialogue qu'elle nomme) — seulement pour la dernière
   * liste (`last`) —, -1 sinon.
   */
  *setConditions(id: number, last: boolean): Sequence<number> {
    const g = this.g;
    const states = g.data.jas.commands.states;
    const toSet: number[] = [];
    let failed = 0;
    for (let i = 1; i < states.length; i++) {
      const record = states[i];
      if (record.id !== id) continue;
      if (record.slot > 0) {
        if (g.gameState(record.slot) !== record.value) {
          failed = i;
          break;
        }
      } else {
        toSet.push(i);
      }
    }
    if (failed > 0) {
      const speak = states[failed].speakValue;
      if (speak > 0 && last) {
        const description = g.objectDescriptionText(speak);
        if (!(yield* this.executeIfCutaway(description)) && !(yield* this.executeIfDialog(description))) {
          yield* g.makeJoeSpeak(speak, true);
        }
        return -2;
      }
      return -1;
    }
    let result = 0;
    for (const i of toSet) {
      g.setGameState(Math.abs(states[i].slot), states[i].value);
      result = states[i].speakValue;
    }
    return result;
  }

  /**
   * Effets d'une liste dont les conditions sont remplies (`executeCommand`) ; `condResult` est la description que Joe dira
   * (> 0), ou qui nomme la cinématique ou le dialogue à jouer. Rend `condResult` (0 si une cinématique ou un dialogue a été joué).
   */
  *executeCommand(id: number, condResult: number): Sequence<number> {
    const g = this.g;
    const list = this.lists[id];
    if (list.setAreas) this.setAreas(id);

    // Pas de geste de saisie pour « parler à » et « aller vers ».
    if (this.selAction !== Verb.TalkTo && this.selAction !== Verb.WalkTo) {
      for (const subject of this.subject) {
        if (subject > 0) yield* g.stage.joeGrab(g, stateGrab(this.objects[subject].state));
      }
    }

    let cutDone = false;
    if (condResult > 0) {
      // Cinématique ou dialogue avant la mise à jour des objets.
      const description = g.objectDescriptionText(condResult);
      if (yield* this.executeIfCutaway(description)) {
        condResult = 0;
        cutDone = true;
      } else if (yield* this.executeIfDialog(description)) {
        condResult = 0;
      }
    }

    const subject = this.subject[0];
    const oldImage = subject > 0 ? this.objects[subject].image : 0;
    if (list.setObjects) this.setObjects(id);
    if (list.setItems) this.setItems(id);

    if (list.imageOrder !== 0 && subject > 0) {
      const data = this.objects[subject];
      if (list.imageOrder < 0) {
        // Image éteinte, si elle ne l'est pas déjà.
        if (data.image > 0) data.image = -(data.image + 10);
      } else {
        data.image = list.imageOrder;
      }
      g.stage.refreshObject(g, subject);
    } else if (subject > 0 && this.objects[subject].image !== oldImage) {
      g.stage.refreshObject(g, subject);
    }

    // Morceau joué avant l'action, sauf pour ouvrir et fermer (l'action peut échouer).
    if (this.selAction !== Verb.None && this.selAction !== Verb.Open && this.selAction !== Verb.Close && list.song > 0) {
      g.host.playSong(list.song);
    }

    switch (list.specialSection) {
      case 1:
        g.useJournal();
        this.selAction = Verb.UseJournal;
        return condResult;
      case 2:
        yield* g.joeUseDress(true);
        break;
      case 3:
        yield* g.joeUseClothes(true);
        break;
      case 4:
        g.joeUseUnderwear();
        break;
      default:
        break;
    }

    if (subject > 0) yield* this.changeObjectState(this.selAction, subject, list.song, cutDone);
    if (condResult > 0) yield* g.makeJoeSpeak(condResult, true);
    return condResult;
  }

  /** La description nomme une cinématique : elle est jouée, avec celles qu'elle enchaîne (`executeIfCutaway`). */
  private *executeIfCutaway(description: string): Sequence<boolean> {
    if (!endsWithFile(description, ".CUT")) return false;
    this.clearLine();
    let next = yield* this.g.playCutaway(description);
    while (next) next = yield* this.g.playCutaway(next);
    return true;
  }

  /** La description nomme un dialogue : il est joué avec l'objet de la commande, puis les cinématiques qu'il enchaîne (`executeIfDialog`). */
  private *executeIfDialog(description: string): Sequence<boolean> {
    if (!endsWithFile(description, ".DOG")) return false;
    this.clearLine();
    let next = yield* this.g.startDialogue(description, this.selNoun);
    while (next) next = yield* this.g.playCutaway(next);
    return true;
  }

  /**
   * Ouvrir, fermer, déplacer (`changeObjectState`) : l'objet change d'état (bit « allumé » = fermé) et de verbe par défaut ; une
   * porte ouvre ou ferme aussi la porte de l'autre côté. Pas de changement si une cinématique a déjà été jouée.
   */
  private *changeObjectState(action: number, object: number, song: number, cutDone: boolean): Sequence {
    const g = this.g;
    const data = this.objects[object];
    if (action === Verb.Open && !cutDone) {
      if (!stateOn(data.state)) {
        yield* g.makeJoeSpeak(Reply.AlreadyOpen);
        return;
      }
      data.state = withDefaultVerb(withOn(data.state, false), Verb.None);
      if (song !== 0) g.host.playSong(Math.abs(song));
      if (data.entryObject !== 0) {
        this.openOrCloseAssociatedObject(action, Math.abs(data.entryObject));
        data.entryObject = Math.abs(data.entryObject);
      }
    } else if (action === Verb.Close && !cutDone) {
      if (stateOn(data.state)) {
        yield* g.makeJoeSpeak(Reply.AlreadyClosed);
        return;
      }
      data.state = withDefaultVerb(withOn(data.state, true), Verb.Open);
      if (song !== 0) g.host.playSong(Math.abs(song));
      if (data.entryObject !== 0) {
        this.openOrCloseAssociatedObject(action, Math.abs(data.entryObject));
        data.entryObject = -Math.abs(data.entryObject);
      }
    } else if (action === Verb.Move) {
      data.state = withOn(data.state, false);
    }
  }

  /**
   * La porte associée suit (`openOrCloseAssociatedObject`) : la première liste « ouvrir » / « fermer » de cette porte dont un état
   * testé est rempli (ou qui n'a pas de condition) donne son image ; la porte passe ouverte ou fermée.
   */
  private openOrCloseAssociatedObject(action: number, other: number): void {
    const g = this.g;
    const states = g.data.jas.commands.states;
    let found = 0;
    for (let id = 1; id < this.lists.length && found === 0; id++) {
      const list = this.lists[id];
      if (list.verb !== action || list.object1 !== other || list.object2 !== 0) continue;
      if (!list.setConditions) {
        found = id;
        break;
      }
      for (let j = 1; j < states.length; j++) {
        const record = states[j];
        if (record.id === id && record.slot > 0 && g.gameState(record.slot) === record.value) {
          found = id;
          break;
        }
      }
    }
    if (found === 0) return;
    const list = this.lists[found];
    const data = this.objects[other];
    if (list.imageOrder !== 0) data.image = list.imageOrder;
    if (action === Verb.Open && stateOn(data.state)) {
      data.state = withDefaultVerb(withOn(data.state, false), Verb.None);
      data.entryObject = Math.abs(data.entryObject);
    } else if (action === Verb.Close && !stateOn(data.state)) {
      data.state = withDefaultVerb(withOn(data.state, true), Verb.Open);
      data.entryObject = -Math.abs(data.entryObject);
    }
  }

  /** Zones de marche allumées (> 0) ou éteintes (< 0) par la liste (`setAreas`). */
  setAreas(id: number): void {
    const g = this.g;
    const records = g.data.jas.commands.areas;
    for (let i = 1; i < records.length; i++) {
      const record = records[i];
      if (record.id !== id) continue;
      const area = g.grid.area(record.room, Math.abs(record.area));
      area.mapNeighbors = record.area > 0 ? Math.abs(area.mapNeighbors) : -Math.abs(area.mapNeighbors);
    }
  }

  /**
   * Objets montrés, cachés, supprimés ou remplacés par un modèle (`setObjects`). Un objet supprimé de la pièce courante perd sa
   * zone ; son image s'éteint, sauf si c'est le sujet de la commande (l'image de celui-ci est réglée par `imageOrder`) ou une
   * personne.
   */
  setObjects(id: number): void {
    const g = this.g;
    const records = g.data.jas.commands.objects;
    for (let i = 1; i < records.length; i++) {
      const record = records[i];
      if (record.id !== id) continue;
      const destination = Math.abs(record.destination);
      const data = this.objects[destination];
      if (record.destination > 0) {
        data.name = Math.abs(data.name);
        if (record.source === -1 && data.name !== 0) {
          data.name = 0;
          if (data.room === g.state.room) {
            if (destination !== this.subject[0] && !isPerson(data.image)) data.image = -(data.image + 10);
            g.grid.setZone(GridScreen.Room, destination - g.currentRoomData, { x1: 0, y1: 0, x2: 1, y2: 1 });
          }
        }
        if (record.source > 0) {
          const image1 = data.image;
          const image2 = this.objects[record.source].image;
          objectCopy(g, record.source, destination);
          if (image1 !== 0 && image2 === 0 && data.room === g.state.room) g.stage.clearObjectBob(g, destination);
        }
        if (destination !== this.subject[0]) g.stage.refreshObject(g, destination);
      } else if (data.name > 0) {
        data.name = -data.name;
        g.stage.refreshObject(g, destination);
      }
    }
  }

  /**
   * Objets d'inventaire ajoutés (> 0) ou retirés (< 0) par la liste (`setItems`) ; avec une source, l'objet prend d'abord les
   * données de la source (un objet qui en remplace un autre).
   */
  setItems(id: number): void {
    const g = this.g;
    const items = g.state.items;
    const records = g.data.jas.commands.inventory;
    for (let i = 1; i < records.length; i++) {
      const record = records[i];
      if (record.id !== id) continue;
      const destination = Math.abs(record.destination);
      if (record.destination > 0) {
        if (record.source > 0) {
          items[destination] = { ...items[record.source] };
          items[destination].name = Math.abs(items[destination].name);
        }
        g.inventory.insert(destination);
      } else {
        if (items[destination].name > 0) g.inventory.remove(destination);
        if (record.source > 0) {
          items[destination] = { ...items[record.source] };
          items[destination].name = -Math.abs(items[destination].name);
        }
      }
    }
  }

  /**
   * Description à dire pour un objet à descriptions successives (`nextObjectDescription`) : 0 la première puis au hasard, 1 au
   * hasard, 2 dans l'ordre en boucle, 3 dans l'ordre jusqu'à la dernière.
   */
  private nextObjectDescription(index: number, firstDescription: number): number {
    const record = this.g.state.objectDescriptions[index];
    const diff = (record.lastDescription - firstDescription) & 0xffff;
    if (record.type === 0 && record.lastSeenNumber === 0) {
      // La première fois : la première description.
      record.lastSeenNumber = firstDescription;
    } else if (record.type === 0 || record.type === 1) {
      // Au hasard, différente de la précédente (bornée : voir l'en-tête).
      let next = record.lastSeenNumber;
      for (let tries = 0; next === record.lastSeenNumber && tries < 1000 && diff > 0; tries++) {
        next = firstDescription + this.g.rng.inclusive(diff);
      }
      record.lastSeenNumber = next;
    } else if (record.type === 2) {
      record.lastSeenNumber++;
      if (record.lastSeenNumber > record.lastDescription) record.lastSeenNumber = firstDescription;
    } else if (record.type === 3 && record.lastSeenNumber !== record.lastDescription) {
      record.lastSeenNumber++;
    }
    return record.lastSeenNumber;
  }

  /** « Examiner » : Joe dit la description de l'objet ou de l'objet d'inventaire (`lookAtSelectedObject`). */
  private *lookAtSelectedObject(): Sequence {
    const g = this.g;
    const subject = this.subject[0];
    let description: number;
    if (subject < 0) {
      description = g.state.items[-subject].description;
    } else {
      const data = this.objects[subject];
      if (data.name <= 0) return;
      description = data.description;
    }
    const records = g.state.objectDescriptions;
    for (let i = 1; i < records.length; i++) {
      if (records[i].object === subject) {
        description = this.nextObjectDescription(i, description);
        break;
      }
    }
    if (description !== 0) yield* g.makeJoeSpeak(description, true);
    yield* g.stage.joeFace(g);
  }
}
