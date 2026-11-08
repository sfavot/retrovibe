import { parseCal } from "../data/cal";
import type { DatTalkSequence } from "../data/dat";
import type { DialogState } from "../render/font";
import { TextColor } from "../render/palette";
import type { DrasculaEngine } from "./loop";
import { type Sequence, wait } from "../../../engine/sequence";
import { delay, pause } from "./cadence";
import { IgorType } from "../render/heads";
import { Verb } from "./state";

/**
 * Dialogues : les scénarios de `drascula.dat` (`talkSequences`), les choix du joueur (`.CAL`) et les réponses qui s'ensuivent.
 * Réécriture de `playTalkSequence`, `doTalkSequenceCommand`, `converse`, `response` et `cleanupString` (engines/drascula/converse.cpp,
 * ScummVM). Tout est séquence : une réplique dure la durée de sa voix (`talk.ts`), le menu attend le clic du joueur.
 *
 * - **Scénario** (`playTalkSequence(n)`) : les commandes du chapitre en cours, dans l'ordre du fichier, qui sont des pauses, des
 *   drapeaux, des objets, la marche de Von Braun, des répliques de chaque personnage et d'autres choix (`CommandType`). La recherche
 *   s'arrête à la première ligne d'un autre scénario après celles de `n`.
 * - **Choix** (`converse(n)`) : `OP_n.CAL` donne quatre répliques, leurs voix et le numéro de réponse des trois premières ; le
 *   quatrième choix quitte le dialogue. Une réplique choisie est dite par le héros, passe en blanc, puis `response` joue le scénario
 *   de son numéro (sauf 31) ; au chapitre 2 certains numéros lancent une cinématique (`16_2`, `20_2`, `23_2`, `29_2`, `31_2`),
 *   au chapitre 3 le héros grogne (`grr`). `OP_5` (chapitre 2, drapeaux 38 et 33) et `OP_12` (chapitre 6, drapeaux 7 et 10) remplacent
 *   leur troisième choix.
 *
 * Écarts : (1) le menu s'appuie sur la feuille `CAR.ALG` à part, sans toucher à la feuille de dos du héros (`backSurface` de ScummVM) ;
 * (2) le clic est celui du bouton gauche depuis la dernière image (`engine.takeClick`), pas l'état du bouton : un clic bref compte ;
 * (3) les cinématiques du chapitre 2 viennent de `GameScript.animations` (vague P) et sont ignorées si le jeu n'en fournit pas.
 */

/** `TalkSequenceCommands` : le type de commande d'une ligne de `talkSequences`. */
export const CommandType = {
  Pause: 0,
  SetFlag: 1,
  ClearFlag: 2,
  PickObject: 3,
  AddObject: 4,
  BreakOut: 5,
  Converse: 6,
  PlaceVonBraun: 7,
  UpdateRoom: 8,
  UpdateScreen: 9,
  TrackProtagonist: 10,
  PlaySound: 11,
  FinishSound: 12,
  TalkerGeneral: 13,
  TalkerDrunk: 14,
  TalkerPianist: 15,
  TalkerBJ: 16,
  TalkerVonBraunNormal: 17,
  TalkerVonBraunDoor: 18,
  TalkerIgorSeated: 19,
  TalkerWerewolf: 20,
  TalkerMusician: 21,
  TalkerDrascula: 22,
  TalkerBartender0: 23,
  TalkerBartender1: 24,
} as const;

/** Réponses du chapitre 2 qui lancent une cinématique de pièce (`animation_N_2`), et la réponse 31, qui n'a pas de scénario. */
const CHAPTER_2_ANIMATIONS: Readonly<Record<number, string>> = { 16: "16_2", 20: "20_2", 23: "23_2", 29: "29_2", 31: "31_2" };
/** Réponse qui n'a pas de scénario de dialogue. */
const NO_SEQUENCE = 31;
/**
 * Réponse du chapitre 2 dont la cinématique (`animation_29_2`) joue elle-même le scénario, écart voulu : ScummVM le joue aussi avant
 * elle, et Von Braun disait l'histoire puis « Je te l'ai déjà dit ! » dès la première fois (voir `rooms-chapter-2.md` § 7).
 */
const PLAYED_BY_ANIMATION_2 = 29;
/** Pause avant que la réplique choisie soit dite (`delay(100)`). */
const CLICK_DELAY_MS = 100;

/** Hauteur de la ligne d'un choix : 8 pixels par ligne (`8 * print_abc_opc(...)`). */
const CHOICE_LINE_HEIGHT = 8;

export class Dialogs {
  /** Un scénario a demandé la fin du dialogue en cours (`breakOut`). */
  breakOut = false;

  constructor(private readonly g: DrasculaEngine) {}

  // --- Scénarios --------------------------------------------------------------------------------------------------------

  /** Les commandes du scénario `sequence` du chapitre en cours (`playTalkSequence`). */
  commands(sequence: number): DatTalkSequence[] {
    const { chapter } = this.g.state;
    const out: DatTalkSequence[] = [];
    for (const command of this.g.data.dat.talkSequences) {
      if (command.chapter === chapter && command.sequence === sequence) out.push(command);
      else if (out.length > 0) break;
    }
    return out;
  }

  /** Joue le scénario `sequence` du chapitre en cours. */
  *play(sequence: number): Sequence {
    for (const command of this.commands(sequence)) yield* this.run(command);
  }

  /** Une commande (`doTalkSequenceCommand`). */
  *run(command: DatTalkSequence): Sequence {
    const g = this.g;
    const s = g.state;
    const { action } = command;
    const talkers = g.talkers;
    switch (command.commandType) {
      case CommandType.Pause:
        yield* pause(action);
        break;
      case CommandType.SetFlag:
        s.flags[action] = 1;
        break;
      case CommandType.ClearFlag:
        s.flags[action] = 0;
        break;
      case CommandType.PickObject:
        g.pickObject(action);
        break;
      case CommandType.AddObject:
        g.addObject(action);
        break;
      case CommandType.BreakOut:
        this.breakOut = true;
        break;
      case CommandType.Converse:
        yield* this.converse(action);
        break;
      case CommandType.PlaceVonBraun:
        yield* talkers.placeVonBraun(action);
        break;
      case CommandType.UpdateRoom:
        g.updateRoom();
        break;
      case CommandType.UpdateScreen:
        // `updateScreen()` : l'image est présentée à la demande de l'hôte ; un tick laisse l'état se montrer.
        yield* wait(1);
        break;
      case CommandType.TrackProtagonist:
        s.hero.track = action;
        break;
      case CommandType.PlaySound:
        g.playEffect(action);
        break;
      case CommandType.FinishSound:
        yield* g.finishSound();
        break;
      case CommandType.TalkerGeneral:
        yield* g.talk(action);
        break;
      case CommandType.TalkerDrunk:
        yield* talkers.drunk(action);
        break;
      case CommandType.TalkerPianist:
        yield* talkers.pianist(action);
        break;
      case CommandType.TalkerBJ:
        yield* talkers.bj(action);
        break;
      case CommandType.TalkerVonBraunNormal:
        yield* talkers.vonBraun(action, false);
        break;
      case CommandType.TalkerVonBraunDoor:
        yield* talkers.vonBraun(action, true);
        break;
      case CommandType.TalkerIgorSeated:
        yield* talkers.igor(action, IgorType.Seated);
        break;
      case CommandType.TalkerWerewolf:
        yield* talkers.werewolf(action);
        break;
      case CommandType.TalkerMusician:
        yield* talkers.musician(action);
        break;
      case CommandType.TalkerDrascula:
        yield* talkers.drascula(action, 1);
        break;
      case CommandType.TalkerBartender0:
        yield* talkers.bartender(action, 0);
        break;
      case CommandType.TalkerBartender1:
        yield* talkers.bartender(action, 1);
        break;
      default:
        throw new Error(`talkSequences : commande ${command.commandType} inconnue`);
    }
  }

  // --- Choix ------------------------------------------------------------------------------------------------------------

  /**
   * Les quatre choix de `OP_<n>.CAL` avec les remplacements du jeu : texte, voix et numéro de réponse des trois premiers (le quatrième
   * n'en a pas : il quitte).
   */
  choices(index: number): { phrases: string[]; voices: string[]; answers: number[] } {
    const g = this.g;
    const { chapter, flags } = g.state;
    const cal = parseCal(g.host.readFile(`op_${index}.cal`));
    const phrases = cal.choices.map((choice) => choice.text);
    const voices = cal.choices.map((choice) => choice.voice);
    const answers: number[] = [...cal.answers];
    const replace = (text: number, answer: number): void => {
      phrases[2] = g.data.text("text", text);
      voices[2] = `${text}.als`;
      answers[2] = answer;
    };
    if (chapter === 2 && index === 5 && flags[38] === 1 && flags[33] === 1) replace(405, 31);
    if (chapter === 6 && index === 12 && flags[7] === 1) replace(273, 14);
    if (chapter === 6 && index === 12 && flags[10] === 1) replace(274, 15);
    return { phrases, voices, answers };
  }

  /**
   * Ordonnées de la fin de chaque choix (`phrase1_bottom`…) : les choix se suivent à partir de y = 2, chacun occupant 8 pixels par
   * ligne ; la souris en dessous du bord du choix précédent et au-dessus de celui-ci le survole.
   */
  bottoms(phrases: readonly string[]): number[] {
    const font = this.g.gfx.font;
    const bottoms: number[] = [];
    let y = 0;
    for (const phrase of phrases) {
      y += CHOICE_LINE_HEIGHT * font.measureChoice(phrase);
      bottoms.push(y);
    }
    return bottoms;
  }

  /**
   * `converse(index)` : propose les choix de `OP_<index>.CAL` jusqu'à ce que le joueur choisisse le quatrième ou qu'un scénario
   * demande la fin (`breakOut`). Un choix déjà fait reste en blanc ; chaque clic fait dire la réplique au héros puis jouer sa réponse.
   */
  *converse(index: number): Sequence {
    const g = this.g;
    const s = g.state;
    const { phrases, voices, answers } = this.choices(index);
    const states: DialogState[] = ["unselected", "unselected", "unselected", "unselected"];
    this.breakOut = false;
    g.selectVerb(Verb.None);
    g.gfx.palette.setTextColor(TextColor.LightGreen);
    g.listenForClicks = true;
    g.takeClick();
    try {
      while (!this.breakOut) {
        g.updateRoom();
        if (!g.host.musicPlaying() && s.roomMusic !== 0) {
          if (s.chapter === 3 || s.chapter === 5 || s.flags[11] === 0) g.host.playMusic(s.roomMusic);
        }
        g.takeKey();
        // Le menu : y des bords hauts des choix, comme `phrase1_bottom`, etc. (le premier choix commence à y = 2).
        const bottoms = this.bottoms(phrases);
        const y = g.mouseY;
        let hovered = -1;
        for (let i = 0; i < 4; i++) {
          const top = i === 0 ? 0 : bottoms[i - 1];
          if (y > top && y < bottoms[i]) {
            hovered = i;
            break;
          }
        }
        g.choices = { phrases, states, hovered };
        if (hovered >= 0 && hovered < 3) {
          const clicked = states[hovered] === "clicked";
          const palette = g.gfx.palette;
          if (clicked && palette.textColor !== TextColor.White) palette.setTextColor(TextColor.White);
          else if (!clicked && palette.textColor !== TextColor.LightGreen) palette.setTextColor(TextColor.LightGreen);
        } else if (hovered < 0 && g.gfx.palette.textColor !== TextColor.LightGreen) {
          g.gfx.palette.setTextColor(TextColor.LightGreen);
        }
        if (hovered >= 0 && g.takeClick()) {
          yield* delay(CLICK_DELAY_MS);
          if (hovered < 3) states[hovered] = "clicked";
          g.choices = null;
          yield* g.say(phrases[hovered], voices[hovered]);
          if (hovered < 3) yield* this.respond(answers[hovered]);
          else this.breakOut = true;
        } else {
          yield* wait(1);
        }
      }
    } finally {
      g.choices = null;
      g.listenForClicks = false;
    }
    // `breakOut` reste levé (comme dans ScummVM) : un dialogue lancé par la réponse d'un autre termine aussi le premier.
  }

  /**
   * `response(function)` (converse.cpp) : le scénario du numéro de réponse (sauf 31, sans scénario, et 29 au chapitre 2, que
   * `animation_29_2` joue elle-même), puis les suites propres au chapitre.
   */
  *respond(answer: number): Sequence {
    const g = this.g;
    const chapter = g.state.chapter;
    const playedByAnimation = chapter === 2 && answer === PLAYED_BY_ANIMATION_2;
    if (answer !== NO_SEQUENCE && !playedByAnimation) yield* this.play(answer);
    if (chapter === 2) {
      const name = CHAPTER_2_ANIMATIONS[answer];
      if (name) yield* g.animation(name);
    } else if (chapter === 3) {
      yield* g.talkers.growl();
    }
  }
}
