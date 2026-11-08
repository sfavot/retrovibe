/**
 * Dialogues à choix (`*.DOG`, `docs/fotaq/talk.md`, vague T) : l'arbre de répliques, les options déjà dites ou cachées, le menu des
 * quatre choix dans le panneau (défilement par deux flèches), la mémoire d'un dialogue (`TalkSelected`), les objets et les états de fin,
 * la cinématique à enchaîner. Réécriture de `Talk::talk`, `load`, `initialTalk`, `findDialogueString`, `disableSentence`,
 * `splitOption`, `splitOptionDefault` et `selectSentence` (engines/queen/talk.cpp, ScummVM, GPL v3 ou ultérieure), lus en entier.
 *
 * La lecture du fichier (en-tête, arbre, phrases) est dans `data/dog.ts` ; l'arbre est recopié ici car le dialogue le modifie (options
 * retirées, remplacées par une autre tête) : le fichier lui-même ne bouge pas.
 *
 * Écarts :
 * - `CHIEF1.DOG` et `CHIEF2.DOG` : ScummVM préfère un fichier du dossier du jeu pour le français ; ils sont lus dans l'archive comme les
 *   autres (`formats.md` § 7) ;
 * - les chiffres du clavier ne choisissent pas une option (`VERB_DIGIT_*` : l'hôte n'a pas d'action pour eux) ; la souris le fait ;
 * - les choix hébreux (`splitOptionHebrew`) et la variante anglaise (une seule colonne sans flèches) ne sont pas portés : seul le
 *   français (flèches, texte coupé à 302 pixels) existe ;
 * - une personne sans acteur valide (`error("Invalid person object")` dans ScummVM) est dite sans animation et notée dans `warnings`.
 */

import type { Sequence } from "../../../engine/sequence";
import { dialogOpeningVoicePrefix, dialogVoicePrefix } from "../data/files";
import type { DogDialog } from "../data/dog";
import { parseDog } from "../data/dog";
import { textWidth } from "../render/font";
import { Ink } from "../render/display";
import { toInt16 } from "./state";
import { GridScreen } from "./grid";
import type { FotaqEngine } from "./loop";
import type { Talk } from "./services";
import { type GameStage, requireGameStage } from "./stage";
import { JoeWalk, Verb } from "./state";
import { type Speaker, joeSpeaker, personSpeaker, speakLine, speakSentence } from "./talk";

const LINE_HEIGHT = 10;
/** Largeur du texte d'un choix (`MAX_TEXT_WIDTH`), retrait des lignes suivantes (`OPTION_TEXT_MARGIN`), remontée du menu (`PUSHUP`). */
const MAX_TEXT_WIDTH = 320 - 18;
const OPTION_TEXT_MARGIN = 24;
const PUSHUP = 4;
/** Zones du panneau pendant un choix : flèches vers le haut et vers le bas (`ARROW_ZONE_UP`, `ARROW_ZONE_DOWN`). */
const ARROW_ZONE_UP = 5;
const ARROW_ZONE_DOWN = 6;
/** Bobs des flèches (`ARROW_BOB_UP`, `ARROW_BOB_DOWN`) et leur image dans la table (images 3 et 4 de `CONTROL.BBK`). */
const ARROW_BOB_UP = 62;
const ARROW_BOB_DOWN = 63;
/** Réponse de Joe quand il quitte un dialogue qu'on lui fait interrompre (« je n'ai pas le temps », réponse 15). */
const LEAVE_RESPONSE = 15;
/** Nombre d'options de choix (1 à 4 ; la 0 est l'en-tête du niveau, la 5 est réservée). */
const CHOICES = 4;

/** Un nœud de l'arbre (`DialogueNode`). */
interface Node {
  head: number;
  /** « Valeur de nœud 1 » : tête du niveau suivant, -1 : fin du dialogue. */
  nodeValue: number;
  stateIndex: number;
  stateValue: number;
}

/** Texte d'un choix coupé à l'étoile (`splitOption`). */
function optionBeforeStar(text: string): string {
  const star = text.indexOf("*");
  return star < 0 ? text : text.slice(0, star);
}

/** Largeur des `length` premiers caractères. */
function widthOf(text: string, length = text.length): number {
  return textWidth(text.slice(0, length));
}

/**
 * `Talk::splitOption` / `splitOptionDefault` : le texte d'un choix tient sur une ligne de 302 pixels ou est coupé aux espaces ; les
 * lignes suivantes sont décalées de 24 pixels (une ligne de plus dès qu'un mot dépasse). Rend les lignes (au plus cinq).
 */
export function splitOption(text: string): string[] {
  let rest = optionBeforeStar(text);
  if (widthOf(rest) <= MAX_TEXT_WIDTH) return [rest];
  const lines: string[] = ["", "", "", "", ""];
  const spaceWidth = widthOf(" ");
  let width = 0;
  let count = 0;
  let maxWidth = MAX_TEXT_WIDTH;
  for (;;) {
    const space = rest.indexOf(" ");
    if (space >= 0) {
      const wordWidth = widthOf(rest, space);
      width += wordWidth;
      if (width > maxWidth) {
        count++;
        lines[count] = rest.slice(0, space + 1);
        width = wordWidth;
        maxWidth = MAX_TEXT_WIDTH - OPTION_TEXT_MARGIN;
      } else {
        lines[count] += rest.slice(0, space + 1);
      }
      width += spaceWidth;
      rest = rest.slice(space + 1);
    } else {
      if (rest !== "") {
        if (width + widthOf(rest) > maxWidth) count++;
        lines[count] += rest;
      }
      count++;
      return lines.slice(0, Math.min(count, 5));
    }
  }
}

/** Phrase de tête `head` d'une section (`findDialogueString`) ; `""` si elle n'y est pas. */
function findSentence(sentences: readonly { head: number; text: string }[], head: number): string {
  return sentences.find((sentence) => sentence.head === head)?.text ?? "";
}

/** Un dialogue en cours. */
class Dialogue {
  private readonly dog: DogDialog;
  /** `_dialogueTree[niveau][option]` : niveaux de 1 à `levelCount`, le niveau 0 est nul. */
  private readonly tree: Node[][];
  private readonly stage: GameStage;
  private oldSelectedIndex = 0;
  private oldSelectedValue = 0;
  private readonly talkString: string[] = ["", "", "", "", ""];
  private readonly joePrefix: string[] = ["", "", "", "", ""];

  constructor(
    private readonly g: FotaqEngine,
    dog: DogDialog,
    private readonly warnings: string[],
  ) {
    this.dog = dog;
    this.stage = requireGameStage(g);
    const blank = (): Node => ({ head: 0, nodeValue: 0, stateIndex: 0, stateValue: 0 });
    this.tree = [Array.from({ length: 6 }, blank)];
    for (const level of dog.tree) {
      this.tree.push(level.map((o) => ({ head: o.head, nodeValue: o.node, stateIndex: o.stateIndex, stateValue: o.stateValue })));
    }
  }

  private get selected() {
    return this.g.state.talkSelected[this.dog.uniqueKey];
  }

  private joePrefixFor(head: number): string {
    return dialogVoicePrefix(this.dog.talkKey, head, "J");
  }

  private personPrefixFor(head: number): string {
    return dialogVoicePrefix(this.dog.talkKey, head, "P");
  }

  /** `Talk::talk` : rend le nom de la cinématique à enchaîner (`""` : aucune). */
  *run(personInRoom: number): Sequence<string> {
    const { g, dog, tree, stage } = this;
    // ScummVM ne charge pas la banque ici (`initPerson(..., false)`) : la personne affichée l'a déjà ; la recharger est sans effet.
    const person = personSpeaker(g, stage, personInRoom, true);
    if (person.plain) this.warnings.push(`${dog.talkKey}: personne ${personInRoom} sans acteur valide`);
    const joe = joeSpeaker();
    const selected = this.selected;
    this.oldSelectedIndex = 0;
    this.oldSelectedValue = 0;

    // Options redéfinies (nouvelle tête) ou déjà dites (retirées, sauf si une condition d'état les rend toujours utiles).
    for (let i = 1; i <= CHOICES; i++) {
      const value = selected.values[i - 1];
      if (value > 0) {
        tree[1][i].head = value;
      } else if (value === -1 && tree[1][i].stateIndex >= 0) {
        tree[1][i] = { head: -1, nodeValue: -1, stateIndex: -1, stateValue: -1 };
      }
    }

    yield* this.initialTalk(joe);
    stage.display.cursorVisible = true;

    let level = 1;
    let retval = 0;
    let head = tree[level][0].head;
    while (retval !== -1) {
      let otherPrefix: string;
      this.talkString[0] = "";
      if (selected.hasTalkedTo && head === 1) {
        this.talkString[0] = dog.person2.greeting;
        otherPrefix = dialogOpeningVoicePrefix(dog.talkKey, "XXXX", "P");
      } else {
        this.talkString[0] = findSentence(dog.personSentences, head);
        otherPrefix = this.personPrefixFor(head);
      }
      if (this.talkString[0] === "" && retval > 1) {
        this.talkString[0] = findSentence(dog.personSentences, retval);
        otherPrefix = this.personPrefixFor(retval);
      }

      // Les répliques de Joe de ce niveau ; une condition d'état sur l'option la cache.
      for (let i = 1; i <= CHOICES; i++) {
        const node = tree[level][i];
        this.talkString[i] = findSentence(dog.joeSentences, node.head);
        if (node.stateIndex < 0 && g.gameState(Math.abs(node.stateIndex)) !== node.stateValue) this.talkString[i] = "";
        this.joePrefix[i] = this.joePrefixFor(node.head);
      }

      // S'il ne reste qu'un choix, il est dit tout de suite (c'est en général la sortie).
      let choicesLeft = 0;
      let selectedSentence = 0;
      for (let i = 1; i <= CHOICES; i++) {
        if (this.talkString[i] !== "") {
          choicesLeft++;
          selectedSentence = i;
        }
      }
      if (choicesLeft === 1) {
        yield* speakSentence(g, this.talkString[0], person, otherPrefix);
        if (g.input.talkQuit) break;
        yield* speakSentence(g, this.talkString[selectedSentence], joe, this.joePrefix[selectedSentence]);
      } else if (person.bobNum > 0) {
        yield* speakSentence(g, this.talkString[0], person, otherPrefix);
        selectedSentence = yield* this.selectSentence(joe);
      } else {
        this.warnings.push(`${dog.talkKey}: bob ${person.bobNum}`);
        selectedSentence = 0;
      }
      if (g.input.talkQuit || g.ended) break;

      retval = tree[level][selectedSentence].nodeValue;
      head = tree[level][selectedSentence].head;
      const oldLevel = level;
      level = 0;
      // Le niveau choisi est celui dont l'en-tête a la tête de la réplique…
      for (let i = 1; i <= dog.levelCount; i++) if (tree[i][0].head === head) level = i;
      if (level === 0) {
        // … sinon celui que désigne la valeur de nœud.
        for (let i = 1; i <= dog.levelCount; i++) for (let j = 0; j <= 5; j++) if (tree[i][j].head === retval) level = i;
        this.disableSentence(oldLevel, selectedSentence);
      } else if (tree[level][0].nodeValue > 0) {
        // Valeur positive : l'option choisie est remplacée par cette tête.
        if (oldLevel === 1) {
          this.oldSelectedIndex = selectedSentence;
          this.oldSelectedValue = selected.values[selectedSentence - 1];
          selected.values[selectedSentence - 1] = tree[level][0].nodeValue;
        }
        tree[oldLevel][selectedSentence].head = tree[level][0].nodeValue;
        tree[level][0].nodeValue = -1;
      } else {
        this.disableSentence(oldLevel, selectedSentence);
      }

      // États posés par le niveau choisi et par la réplique choisie.
      let index = tree[level][0].stateIndex;
      if (index > 0) g.setGameState(index, tree[level][0].stateValue);
      index = tree[oldLevel][selectedSentence].stateIndex;
      if (index > 0) g.setGameState(index, tree[oldLevel][selectedSentence].stateValue);

      // La personne a peut-être quelque chose à dire pour finir.
      if (retval === -1) {
        const last = findSentence(dog.personSentences, head);
        if (last !== "") yield* speakSentence(g, last, person, this.personPrefixFor(head));
      }
    }

    // Objets et états de fin de dialogue.
    for (const condition of dog.conditions) {
      if (condition.state > 0 && g.gameState(condition.state) === condition.value) {
        if (condition.item > 0) g.inventory.insert(condition.item);
        else g.inventory.remove(Math.abs(condition.item));
      }
    }
    g.grid.setupPanel();

    let cutaway = "";
    if (g.gameState(dog.cutaway.state) === dog.cutaway.value) {
      cutaway = dog.cutaway.file;
      // Joe doit pouvoir parler dans la cinématique, même si le dialogue a été quitté sur la ligne qui pose ses états.
      if (cutaway) g.input.talkQuit = false;
    }
    if (g.input.talkQuit) {
      if (this.oldSelectedIndex > 0) selected.values[this.oldSelectedIndex - 1] = this.oldSelectedValue;
      g.input.talkQuit = false;
      stage.display.clearTexts(0, 198);
      yield* g.makeJoeSpeak(LEAVE_RESPONSE, false);
    } else {
      selected.hasTalkedTo = true;
    }
    yield* stage.joeFace(g);
    if (cutaway === "" && person.person) {
      // La personne reprend sa place et son animation.
      const actor = person.person.actor;
      const bob = stage.bobs.bob(actor.bobNumber);
      bob.x = toInt16(actor.x);
      bob.y = toInt16(actor.y);
      stage.actors.resetPersonAnim(actor.bobNumber);
    }
    g.setJoeWalk(JoeWalk.Normal);
    return cutaway;
  }

  /** `Talk::disableSentence` : l'option choisie ne sera plus proposée ; au premier niveau, la mémoire du dialogue s'en souvient. */
  private disableSentence(oldLevel: number, selectedSentence: number): void {
    if (oldLevel === 1 && this.tree[oldLevel][selectedSentence].nodeValue !== -1) {
      // Pas pour l'option de sortie.
      this.oldSelectedIndex = selectedSentence;
      this.oldSelectedValue = this.selected.values[selectedSentence - 1];
      this.selected.values[selectedSentence - 1] = -1;
    }
    this.tree[oldLevel][selectedSentence].head = -1;
    this.tree[oldLevel][selectedSentence].nodeValue = -1;
  }

  /** `Talk::initialTalk` : ce que Joe dit en abordant la personne (la première fois, ou quand il l'a déjà rencontrée). */
  private *initialTalk(joe: Speaker): Sequence {
    const { g, dog } = this;
    const first = dog.joeSentences[0];
    const joeString = first && first.head === 0 ? first.text : "";
    const joe2String = dog.person2.joe;
    if (!this.selected.hasTalkedTo) {
      if (joeString[0] !== "0") yield* speakSentence(g, joeString, joe, dialogOpeningVoicePrefix(dog.talkKey, "SSSS", "J"));
    } else if (joe2String[0] !== "0") {
      yield* speakSentence(g, joe2String, joe, dialogOpeningVoicePrefix(dog.talkKey, "XXXX", "J"));
    }
  }

  /**
   * `Talk::selectSentence` : les choix dans le panneau (quatre au plus, des lignes de 10 pixels, flèches pour défiler), le survol les
   * colore, un clic gauche choisit ; Joe dit alors sa réplique. Rend le numéro du choix (1 à 4) ou 0 (dialogue interrompu).
   */
  private *selectSentence(joe: Speaker): Sequence<number> {
    const { g, stage } = this;
    const display = stage.display;
    const bobs = stage.bobs;
    let selected = 0;
    let startOption = 1;
    display.textCurrentColor(Ink.TalkNormal);

    // Les flèches : bobs au-dessus de tout (leur point d'ancrage est décalé de 200 par le rendu), éteintes pour l'instant.
    const arrowUp = bobs.bob(ARROW_BOB_UP);
    const arrowDown = bobs.bob(ARROW_BOB_DOWN);
    arrowUp.curPos(303 + 8 + g.horizontalScroll, 150 + 1 + 200);
    arrowUp.frameNum = 3;
    arrowDown.curPos(303 + g.horizontalScroll, 175 + 200);
    arrowDown.frameNum = 4;
    arrowUp.active = false;
    arrowDown.active = false;

    const talkZone = [0, 0, 0, 0, 0];
    let rezone = true;
    while (rezone) {
      rezone = false;
      g.grid.clear(GridScreen.Panel);
      g.grid.setZone(GridScreen.Panel, ARROW_ZONE_UP, { x1: MAX_TEXT_WIDTH + 1, y1: 0, x2: 319, y2: 24 });
      g.grid.setZone(GridScreen.Panel, ARROW_ZONE_DOWN, { x1: MAX_TEXT_WIDTH + 1, y1: 25, x2: 319, y2: 49 });
      display.clearTexts(151, 199);
      let sentenceCount = 0;
      let yOffset = 1;
      for (let i = startOption; i <= CHOICES; i++) {
        talkZone[i] = 0;
        if (this.talkString[i] === "") continue;
        sentenceCount++;
        const lines = splitOption(this.talkString[i]);
        if (yOffset < 5) {
          g.grid.setZone(GridScreen.Panel, i, {
            x1: 0,
            y1: yOffset * LINE_HEIGHT - PUSHUP,
            x2: MAX_TEXT_WIDTH,
            y2: (yOffset + lines.length) * LINE_HEIGHT - PUSHUP,
          });
        }
        for (let j = 0; j < lines.length; j++) {
          if (yOffset < 5) display.setText(j === 0 ? 0 : OPTION_TEXT_MARGIN, 150 - PUSHUP + yOffset * LINE_HEIGHT, lines[j]);
          yOffset++;
        }
        talkZone[i] = sentenceCount;
      }
      yOffset--;
      arrowUp.active = startOption > 1;
      arrowDown.active = yOffset > 4;

      g.input.keyVerb = Verb.None;
      g.input.takeMouseButton();
      if (sentenceCount === 0) continue;
      let oldZone = 0;
      const paint = (zone: number, color: number) => {
        const box = g.grid.zone(GridScreen.Panel, zone);
        if (box) for (let y = box.y1; y < box.y2; y += LINE_HEIGHT) display.textColor(150 + y, color);
      };
      while (selected === 0 && !g.input.talkQuit && !g.ended) {
        yield* g.update();
        const zone = g.grid.findZoneForPos(GridScreen.Panel, g.input.mouseX, g.input.mouseY);
        const button = g.input.takeMouseButton();
        if (zone === ARROW_ZONE_UP || zone === ARROW_ZONE_DOWN) {
          if (oldZone > 0) {
            paint(oldZone, Ink.TalkNormal);
            oldZone = 0;
          }
          if (button !== 0) {
            if (zone === ARROW_ZONE_UP && arrowUp.active) startOption--;
            else if (zone === ARROW_ZONE_DOWN && arrowDown.active) startOption++;
          }
          rezone = true;
          break;
        }
        if (oldZone !== zone) {
          if (zone > 0) paint(zone, Ink.Joe);
          if (oldZone > 0) paint(oldZone, Ink.TalkNormal);
          oldZone = zone;
        }
        if (button !== 0) selected = zone;
      }
    }

    g.input.keyVerb = Verb.None;
    g.input.takeMouseButton();
    arrowUp.active = false;
    arrowDown.active = false;
    if (selected > 0) {
      display.clearTexts(0, 198);
      yield* speakSentence(g, this.talkString[selected], joe, this.joePrefix[selected]);
    }
    display.clearTexts(151, 151);
    return selected;
  }
}

/**
 * Répliques et dialogues du moteur réel (vague T) : `speak` dit une réplique (`talk.ts`), `dialogue` joue un `.DOG`. Les fichiers
 * lus sont gardés (ils ne changent pas) ; `warnings` note les cas où ScummVM planterait (personne sans acteur valide).
 */
export class FotaqTalk implements Talk {
  readonly warnings: string[] = [];
  private readonly cache = new Map<string, DogDialog>();

  *speak(g: FotaqEngine, text: string, person: number | null, voicePrefix: string): Sequence {
    yield* speakLine(g, text, person, voicePrefix);
  }

  /** `Logic::startDialogue` (partie `Talk::talk`) : le dialogue passe en plein écran ; il y reste si une cinématique suit. */
  *dialogue(g: FotaqEngine, file: string, personInRoom: number): Sequence<string> {
    const stage = requireGameStage(g);
    // `Talk::Talk`, `Talk::load` : le passage est remis à zéro, le dialogue peut être interrompu sauf si son niveau est négatif.
    g.input.talkQuit = false;
    stage.display.fullscreen = true;
    const dog = this.load(g, file);
    g.input.canQuit = !dog.cannotQuit;
    const cutaway = yield* new Dialogue(g, dog, this.warnings).run(personInRoom);
    if (cutaway === "") stage.display.fullscreen = false;
    return cutaway;
  }

  /** Le dialogue `file` (les noms viennent des données, casse indifférente). */
  load(g: FotaqEngine, file: string): DogDialog {
    const key = file.toUpperCase();
    let dog = this.cache.get(key);
    if (!dog) this.cache.set(key, (dog = parseDog(g.host.readFile(file))));
    return dog;
  }
}
