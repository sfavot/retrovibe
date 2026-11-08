/**
 * Répliques de Joe et des personnages (`docs/fotaq/talk.md`, vague T) : découpage d'une réplique en segments (`*NN`, `*FL`…), une voix
 * par segment, texte au-dessus du personnage, animation de la bouche et du torse, durée égale à celle de la voix. Réécriture de
 * `Talk::speak`, `getSpeakCommand`, `speakSegment`, `headStringAnimation`, `stringAnimation`, `defaultAnimation` et `countSpaces`
 * (engines/queen/talk.cpp, talk.h, ScummVM, GPL v3 ou ultérieure), lus en entier.
 *
 * Ce qui bloquait dans ScummVM (`_vm->update()` en boucle) est une séquence : une image de logique est `yield* g.update()`. Les images
 * des personnages sont des références de la table d'images (`FrameTable.unpack`, `overpack` : le rendu copie la bouche sur le torse).
 *
 * Écarts :
 * - le son passe par l'hôte (`playSpeech`, `speechActive`, `stopSpeech`, `FotaqHost`) ; sans voix (fichier absent, voix coupées, hôte
 *   muet), la réplique dure le temps d'un texte (`textFrames`), comme ScummVM ;
 * - les sous-titres sont toujours affichés (`_vm->subtitles()` de ScummVM est un réglage du joueur) ;
 * - ScummVM remet `speechSfxExists` à faux quand un effet est joué (`Sound::playSfx`), y compris celui d'une animation de parole
 *   (images > 500) ; ici une réplique qui a sa voix attend la fin de cette voix malgré l'effet ;
 * - le rectangle de focus (`setFocusRect`, aide de la loupe du système) n'est pas porté ;
 * - un personnage dont l'acteur est introuvable (ScummVM planterait) est dit sans animation : seul le texte et la voix comptent ;
 * - `Talk::speak` est appelée avec le numéro dans la pièce de la personne (`Person` n'existe pas dans le moteur sans tête) : l'acteur est
 *   retrouvé à chaque réplique (`initPerson`).
 */

import type { Sequence } from "../../../engine/sequence";
import { type SpeechCommand, splitSpeech } from "../data/text";
import type { Person } from "./actors";
import { textFrames } from "./cadence";
import type { FotaqEngine } from "./loop";
import { objectForPerson, PERSON_LEFT, PERSON_RIGHT } from "./room";
import { findSpeechParameters, type SpeechParameters } from "./speech-data";
import { type GameStage, requireGameStage } from "./stage";
import { Direction, Grab, JoeWalk, Room, Verb } from "./state";

/** Codes d'animation de parole (`SPEAK_*`) ; un numéro `*NN` positif est une animation du personnage. */
export const Speak = {
  Default: 0,
  FaceLeft: -1,
  FaceRight: -2,
  FaceFront: -3,
  FaceBack: -4,
  Oracle: -5,
  Unknown6: -6,
  AmalOn: -7,
  Pause: -8,
  /** Rien à dire (geste de saisie). */
  None: -9,
} as const;

/** Banque de Joe (images debout et de parole de `JOE_B.BBK`) et couleur de son texte (`joe_actor` de `Talk::speak`). */
const JOE_BANK = 7;
const JOE_COLOR = 14;
/** Images d'attente d'un `*WT`. */
const PAUSE_FRAMES = 10;
/** Positions du texte d'une tête parlante (`speakSegment`). */
const HEAD_TEXT_X = { [Room.FayeHead]: 15, [Room.AzuraHead]: 15 } as const;
const HEAD_TEXT_X_DEFAULT = 150;
const HEAD_TEXT_Y_JOE = 30;
const HEAD_TEXT_Y_PERSON = 60;
/** Images de bouche de l'oracle (`*AO`) avant et après. */
const ORACLE_FRAMES = [5, 8] as const;
const ORACLE_REST_FRAMES = [1, 4] as const;
/** Voix inutile de la version française (doublon de `c30e_101`), jamais jouée. */
const USELESS_VOICE = "C30E_102";

/** Qui parle : Joe (bob 0) ou une personne de la pièce (`Person`). */
export interface Speaker {
  /** `JOE`, ou le nom de l'acteur dans `QUEEN2.JAS` (clé de la table de paroles). */
  name: string;
  bobNum: number;
  color: number;
  /** Emplacement de la banque des images de parole. */
  bank: number;
  /** Les données de l'acteur, `null` pour Joe et pour une personne introuvable. */
  person: Person | null;
  /** Personne introuvable : pas d'animation. */
  plain?: boolean;
}

export function joeSpeaker(): Speaker {
  return { name: "JOE", bobNum: 0, color: JOE_COLOR, bank: JOE_BANK, person: null };
}

/** La personne `noun` (numéro dans la pièce) de la pièce courante ; sans acteur valide, une voix sans animation. */
export function personSpeaker(g: FotaqEngine, stage: GameStage, noun: number, loadBank: boolean): Speaker {
  const person = stage.actors.initPerson(g, noun, "", loadBank);
  if (person) return { name: person.name, bobNum: person.actor.bobNumber, color: person.actor.color, bank: person.actor.bank, person };
  const object = g.currentRoomData + noun;
  const rank = objectForPersonRank(g, object);
  return { name: "", bobNum: rank, color: JOE_COLOR, bank: -1, person: null, plain: true };
}

/** Rang (1 à 3, au plus) de l'objet parmi les personnes de la pièce : le bob qui porte son texte. */
function objectForPersonRank(g: FotaqEngine, object: number): number {
  let rank = 0;
  const first = g.currentRoomData + 1;
  for (let i = first; i <= object; i++) {
    const image = g.state.objects[i]?.image;
    if (image === PERSON_LEFT || image === PERSON_RIGHT) rank++;
  }
  return Math.min(Math.max(rank, 1), 3);
}

/** Nom du fichier de voix du segment `index` (à partir de 0) : préfixe + rang en hexadécimal (`speakSegment`), majuscules. */
export function speechFileName(prefix: string, index: number): string {
  return `${prefix}${(index + 1).toString(16)}`.replaceAll(" ", "0").toUpperCase();
}

/** `atoi` à partir de `offset` : espaces, signe, chiffres ; 0 sinon. */
function atoiAt(text: string, offset: number): number {
  const match = /^\s*[+-]?\d+/.exec(text.slice(offset));
  return match ? Number.parseInt(match[0], 10) : 0;
}

/** Une demande de passage est en cours (`cutawayQuit() || talkQuit()`). */
function quitRequested(g: FotaqEngine): boolean {
  return g.input.cutawayQuit || g.input.talkQuit;
}

/** Une tête parlante : le texte est à un endroit fixe de l'écran et les bobs 1 et 2 portent la bouche (`_talkHead`). */
function isTalkHead(g: FotaqEngine, name: string): boolean {
  if (name === "FAYE-H" || name === "FRANK-H" || name === "AZURA-H" || name === "X3_RITA") return true;
  const room = g.state.room;
  return name === "JOE" && (room === Room.FayeHead || room === Room.AzuraHead || room === Room.FrankHead);
}

/**
 * `Talk::speak` (sans la remise à zéro de `talkQuit`, faite par `FotaqTalk.speak`) : la réplique `sentence` est dite segment par
 * segment. Les commandes `*GD` et `*GM` (geste de saisie) et `*XYnn(x,y)` (déplacement) s'exécutent **avant** le segment qui les
 * précède (`getSpeakCommand` agit pendant l'analyse) ; le texte avant un geste n'est pas dit.
 */
export function* speakSentence(g: FotaqEngine, sentence: string, speaker: Speaker, voicePrefix: string): Sequence {
  const stage = requireGameStage(g);
  g.setJoeWalk(JoeWalk.Speak);
  if (sentence === "") return;
  const head = isTalkHead(g, speaker.name);
  for (const segment of splitSpeech(sentence)) {
    // ScummVM teste la demande de passage à chaque caractère : avant un segment qui a du texte, après chaque commande.
    if (segment.text.length > 0 && quitRequested(g)) return;
    const command = yield* speakCommand(g, stage, segment.command, speaker);
    if (command !== Speak.None) yield* speakSegment(g, stage, segment.text, speaker, command, voicePrefix, segment.index, head);
    if (segment.command.kind !== "none" && quitRequested(g)) return;
  }
}

/** `Talk::getSpeakCommand` : le code du segment ; les gestes et déplacements sont faits ici. */
function* speakCommand(g: FotaqEngine, stage: GameStage, command: SpeechCommand, speaker: Speaker): Sequence<number> {
  switch (command.kind) {
    case "none":
    case "unknown":
      return Speak.Default;
    case "mouth":
      return command.animation;
    case "amalOn":
      return Speak.AmalOn;
    case "face":
      return { left: Speak.FaceLeft, right: Speak.FaceRight, front: Speak.FaceFront, back: Speak.FaceBack }[command.direction];
    case "pause":
      return Speak.Pause;
    case "grab":
      yield* stage.joeGrab(g, command.pose === "down" ? Grab.Down : Grab.Mid);
      return Speak.None;
    case "move":
      if (speaker.name === "JOE") yield* stage.moveJoe(g, Direction.None, command.x, command.y, g.input.cutawayRunning);
      else if (speaker.person) yield* stage.walk.movePerson(g, speaker.person, command.x, command.y, stage.bobs.numFrames, 0);
      return command.animation;
  }
}

/** `Talk::speakSegment` : un segment de texte, avec sa voix, son texte et l'animation du personnage. */
function* speakSegment(
  g: FotaqEngine,
  stage: GameStage,
  text: string,
  speaker: Speaker,
  command: number,
  voicePrefix: string,
  index: number,
  talkHead: boolean,
): Sequence {
  const voice = speechFileName(voicePrefix, index);
  if (voice !== USELESS_VOICE) g.playSpeech(voice);

  let faceCommand = 0;
  switch (command) {
    case Speak.Pause:
      for (let i = 0; i < PAUSE_FRAMES && !g.input.talkQuit && !g.ended; i++) yield* g.update();
      return;
    case Speak.FaceLeft:
    case Speak.FaceRight:
    case Speak.FaceFront:
    case Speak.FaceBack:
      faceCommand = command;
      command = Speak.Default;
      break;
    default:
      break;
  }

  if (speaker.plain) {
    yield* plainSegment(g, stage, text, speaker);
    return;
  }

  const isJoe = speaker.bobNum === 0;
  const { bobNum, bank } = speaker;
  const color = speaker.color;
  const bob = stage.bobs.bob(bobNum);
  const frames = stage.bobs.frames;
  let oracle = false;
  if (!isJoe) {
    if (command === Speak.AmalOn) {
      // L'oracle : l'animation du jeu continue, quatre images de bouche s'ajoutent à la suite de celles de la personne.
      command = Speak.Oracle;
      oracle = true;
      let frameNum = stage.actors.personFrames[bobNum];
      for (let i = ORACLE_FRAMES[0]; i <= ORACLE_FRAMES[1]; i++) frames.unpack(i, frameNum++, bank);
    } else {
      bob.animating = false;
      bob.frameNum = 31 + bobNum;
    }
  }

  let textX: number;
  let textY: number;
  if (talkHead) {
    textX = (HEAD_TEXT_X as Record<number, number>)[g.state.room] ?? HEAD_TEXT_X_DEFAULT;
    textY = isJoe ? HEAD_TEXT_Y_JOE : HEAD_TEXT_Y_PERSON;
  } else {
    textX = bob.x;
    textY = bob.y;
  }

  const joe = g.state.joe;
  const textFlags = talkHead ? 1 : 0;
  if (talkHead && isJoe) {
    stage.setBobText(g, bobNum, text, color, textFlags, textX, textY);
    yield* defaultAnimation(g, stage, text, isJoe, null, 0, bank, talkHead);
  } else {
    if (command === Speak.Unknown6) return;
    let parameters: SpeechParameters;
    if (isJoe) parameters = g.state.room === Room.Room108 ? findSpeechParameters("JOE-E", command, 0) : findSpeechParameters("JOE", command, joe.facing);
    else parameters = findSpeechParameters(speaker.name, command, 0);
    const startFrame = 31 + bobNum;

    let faceDirection: number = 0;
    if (isJoe && joe.facing === Direction.Left) {
      faceDirection = Direction.Left;
    } else if (!isJoe) {
      const object = objectForPerson(g, bobNum);
      const data = object > 0 ? g.state.objects[object] : null;
      if (data?.image === PERSON_LEFT) faceDirection = Direction.Left;
      if (data) {
        if (faceCommand === Speak.FaceLeft) data.image = PERSON_LEFT;
        else if (faceCommand === Speak.FaceRight) data.image = PERSON_RIGHT;
      }
    }
    if (faceCommand !== 0) {
      faceDirection = { [Speak.FaceLeft]: Direction.Left, [Speak.FaceRight]: Direction.Right, [Speak.FaceFront]: Direction.Front, [Speak.FaceBack]: Direction.Back }[faceCommand] ?? 0;
      if (isJoe) joe.facing = faceDirection;
    }
    if (!isJoe) bob.xflip = faceDirection === Direction.Left;

    if (talkHead) yield* headStringAnimation(g, stage, parameters, bobNum, bank);
    stage.setBobText(g, bobNum, text, color, textFlags, textX, textY);

    const animation = parameters.animation;
    if (animation !== "" && animation[0] !== "E") {
      yield* stringAnimation(g, stage, parameters, startFrame, bank);
    } else {
      frames.unpack(parameters.body, startFrame, bank);
      if (text.length === 0 && !isJoe && parameters.bf > 0) {
        frames.overpack(parameters.bf, startFrame, bank);
        yield* g.update();
      }
      if (parameters.rf === -1) {
        // Mouvement du torse : l'image de base, puis les paramètres de l'animation 0.
        frames.overpack(parameters.bf, startFrame, bank);
        parameters = findSpeechParameters(speaker.name, 0, isJoe ? joe.facing : 0);
      }
      if (parameters.rf === -2) {
        frames.overpack(parameters.bf, startFrame, bank);
        parameters = findSpeechParameters(speaker.name, 14, isJoe ? joe.facing : 0);
      }
      yield* defaultAnimation(g, stage, text, isJoe, parameters, startFrame, bank, talkHead);
    }

    // Les textes sont effacés ici : un mouvement de torse les a laissés pendant toute son animation.
    stage.display.clearTexts(0, 198);
    if (oracle) {
      let frameNum = stage.actors.personFrames[bobNum];
      for (let i = ORACLE_REST_FRAMES[0]; i <= ORACLE_REST_FRAMES[1]; i++) frames.unpack(i, frameNum++, bank);
    }
    if (isJoe && !talkHead) yield* closeJoeMouth(g, stage, command, parameters, startFrame, bank);
    yield* g.update();
    return;
  }
  stage.display.clearTexts(0, 198);
  yield* g.update();
}

/** Fin d'un segment de Joe : il reprend sa pose (`joeFace`) ou garde la bouche fermée de l'animation (`speakSegment`, fin). */
function* closeJoeMouth(g: FotaqEngine, stage: GameStage, command: number, parameters: SpeechParameters, startFrame: number, bank: number): Sequence {
  const facing = g.state.joe.facing;
  if (facing === Direction.Front || facing === Direction.Back) {
    // Pas de retournement dans la pièce 69 : Joe y tient probablement le pistolet à dinosaure.
    if (g.state.room !== Room.FinalFight) yield* stage.joeFace(g);
  } else if (command === Speak.Default || command === 6 || command === 7) {
    yield* stage.joeFace(g);
  } else if (command !== 5) {
    if (parameters.rf !== -1) stage.bobs.frames.overpack(parameters.bf, startFrame, bank);
    stage.bobs.frames.overpack(parameters.ff === 0 ? 10 : parameters.ff, startFrame, bank);
  }
}

/** Un personnage sans acteur : le texte sur son bob et le temps de la voix ou du texte. */
function* plainSegment(g: FotaqEngine, stage: GameStage, text: string, speaker: Speaker): Sequence {
  const bob = stage.bobs.bob(speaker.bobNum);
  stage.setBobText(g, speaker.bobNum, text, speaker.color, 1, bob.x, bob.y);
  let len = textFrames(text);
  for (;;) {
    yield* g.update();
    if (g.input.talkQuit) {
      g.stopSpeech();
      break;
    }
    if (g.input.keyVerb === Verb.SkipText) {
      g.input.keyVerb = Verb.None;
      g.stopSpeech();
      break;
    }
    if (g.speechFound ? !g.speechPending : --len <= 0) break;
  }
  stage.display.clearTexts(0, 198);
  yield* g.update();
}

/** `Talk::headStringAnimation` : la bouche d'une tête parlante est le bob 2, posé sur le bob de la tête. */
function* headStringAnimation(g: FotaqEngine, stage: GameStage, parameters: SpeechParameters, bobNum: number, bank: number): Sequence {
  const bob2 = stage.bobs.bob(2);
  if (parameters.animation[0] !== "E") {
    bob2.active = false;
    return;
  }
  const bob = stage.bobs.bob(bobNum);
  const { x, y } = bob;
  let offset = 1;
  for (;;) {
    const frame = atoiAt(parameters.animation, offset);
    if (!frame) break;
    offset += 4;
    stage.bobs.frames.unpack(frame, stage.bobs.numFrames, bank);
    bob2.frameNum = stage.bobs.numFrames;
    bob2.scale = 100;
    bob2.active = true;
    bob2.x = x;
    bob2.y = y;
    yield* g.update();
  }
}

/** `Talk::stringAnimation` : la chaîne d'images de la bouche (`T` : du torse, posées sur l'image de base), une image de jeu chacune. */
function* stringAnimation(g: FotaqEngine, stage: GameStage, parameters: SpeechParameters, startFrame: number, bank: number): Sequence {
  const frames = stage.bobs.frames;
  const animation = parameters.animation;
  let offset = 0;
  let torso: boolean;
  if (animation[0] === "T") {
    torso = true;
    frames.overpack(parameters.body, startFrame, bank);
    offset++;
  } else if (animation[0] === "E") {
    return;
  } else if (!/\d/.test(animation[0])) {
    return;
  } else {
    torso = false;
  }
  for (;;) {
    let frame = atoiAt(animation, offset);
    if (!frame) break;
    offset += 4;
    if (frame > 500) {
      frame -= 500;
      stage.playRoomSfx();
    }
    if (torso) frames.overpack(frame, startFrame, bank);
    else frames.unpack(frame, startFrame, bank);
    yield* g.update();
  }
}

/**
 * `Talk::defaultAnimation` : la bouche bouge (`bf`, `rf` images tirées au hasard, `af` en alternance) tant que la voix dure ou, sans
 * voix, `textFrames` tours de boucle. Chaque tour dure deux images de jeu (une pour une tête parlante), comme dans ScummVM.
 */
function* defaultAnimation(
  g: FotaqEngine,
  stage: GameStage,
  segment: string,
  isJoe: boolean,
  parameters: SpeechParameters | null,
  startFrame: number,
  bank: number,
  talkHead: boolean,
): Sequence {
  const frames = stage.bobs.frames;
  if (segment !== "") {
    let toggle = 0;
    let len = textFrames(segment);
    for (;;) {
      if (parameters) {
        const bf = segment[0] === " " ? 0 : parameters.bf;
        const head = parameters.rf > 0 ? bf + g.rng.inclusive(parameters.rf) : bf;
        if (bf > 0) {
          // La tête bouge.
          toggle ^= 1;
          if (parameters.af && toggle) frames.overpack(parameters.af + head, startFrame, bank);
          else frames.overpack(head, startFrame, bank);
        } else {
          frames.overpack(parameters.body, startFrame, bank);
        }
        if (!talkHead) yield* g.update();
      } else {
        yield* g.update();
      }
      if (g.input.talkQuit) {
        g.stopSpeech();
        break;
      }
      if (g.joeWalk === JoeWalk.Speak) {
        yield* g.update();
      } else {
        yield* g.update(true);
        // Une commande a été choisie : on quitte.
        if (g.joeWalk === JoeWalk.Execute) break;
      }
      // Passer le texte plus vite.
      if (g.input.keyVerb === Verb.SkipText) {
        g.input.keyVerb = Verb.None;
        g.stopSpeech();
        break;
      }
      if (g.speechFound) {
        // La voix est finie : la bouche se ferme.
        if (!g.speechPending) break;
      } else if (--len <= 0) {
        break;
      }
    }
  }
  // La personne ferme la bouche.
  if (!isJoe && parameters && parameters.ff > 0) frames.overpack(parameters.ff, startFrame, bank);
}

/**
 * `Talk::speak` pour le moteur (`Talk.speak`) : une nouvelle réplique remet à zéro la demande de passage (`Talk::Talk`). `person` :
 * numéro dans la pièce de la personne qui parle, `null` pour Joe.
 */
export function* speakLine(g: FotaqEngine, text: string, person: number | null, voicePrefix: string): Sequence {
  g.input.talkQuit = false;
  const stage = requireGameStage(g);
  const speaker = person === null ? joeSpeaker() : personSpeaker(g, stage, person, true);
  if (speaker.plain && text !== "" && text !== "*") g.warn(`réplique sans acteur valide (personne ${person}, pièce ${g.state.room}) : ${text.slice(0, 40)}`);
  yield* speakSentence(g, text, speaker, voicePrefix);
}
