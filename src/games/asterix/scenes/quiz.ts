import { decodeCp850, encodeCp850 } from "../../../data/cp850";
import { parseQuiz, type QuizQuestion } from "../data/quiz";
import { quizNumber, quizOrder, quizWelcomeVoice } from "../game/rules";
import type { Play } from "./game";
import { DOWN, UP, VOICES, type Script, type Zone } from "./runtime";
import { confirm } from "./screens";

/**
 * Case pays : le quiz (`25f1:042d`, `docs/asterix/engine.md` §10.7). Une question du niveau Réflexion du joueur, trois
 * réponses dans un ordre tiré au hasard, 15 secondes ; une bonne réponse donne l'objet du pays. Une mauvaise réponse
 * peut être rattrapée une fois contre une gourde.
 */

/** Largeur d'une ligne de question (29 caractères) et pas du tampon `DS:7204` (30 octets par ligne). */
const LINE_CHARS = 0x1d;
const LINE_STRIDE = 0x1e;
const SPACE = 0x20;
const QUESTION_MARK = 0x3f;
const CARRIAGE_RETURN = 0x0d;

/**
 * `25f1:0046` (mise en page) : découpe la question en lignes de 29 caractères au plus, coupées au dernier espace. Un
 * `?` qui se retrouverait seul en début de ligne emmène avec lui le dernier mot de la ligne précédente. Opérations sur
 * les octets du tampon d'origine, reprises telles quelles.
 */
export function layoutQuestion(question: string): string[] {
  const source = Uint8Array.of(...encodeCp850(question), CARRIAGE_RETURN, 0x0a);
  const at = (index: number): number => source[index] ?? 0;
  const buffer = new Uint8Array(0x96 + LINE_STRIDE);
  // `25f1:0003` : copie jusqu'à `max` octets, en s'arrêtant sur le retour chariot qui suit un `?`.
  const copyLine = (to: number, from: (i: number) => number, max: number): number => {
    let i = 0;
    while (i < max && (from(i) !== CARRIAGE_RETURN || from(i - 1) !== QUESTION_MARK)) {
      buffer[to + i] = from(i);
      i++;
    }
    buffer[to + i] = 0;
    return i;
  };
  let offset = 0;
  let line = 0;
  let copied = 0;
  for (;;) {
    if (line > 0x73) break;
    while (at(offset) === SPACE) offset++;
    if (at(offset) === QUESTION_MARK) {
      // Le `?` seul : le dernier mot de la ligne précédente descend avec lui.
      let end = line - 2;
      if (buffer[line - 2] === SPACE) {
        while (buffer[end] === SPACE) end--;
        copied = LINE_STRIDE;
      }
      while (buffer[end] !== SPACE) end--;
      buffer[end] = 0;
      const start = end + 1;
      const length = line - 1 - start;
      copyLine(line, (i) => buffer[start + i], length);
      const tail = line + length;
      if (copied < LINE_STRIDE) {
        buffer[tail] = SPACE;
        buffer[tail + 1] = QUESTION_MARK;
        buffer[tail + 2] = 0;
      } else {
        buffer[tail] = QUESTION_MARK;
        buffer[tail + 1] = 0;
      }
      break;
    }
    const base = offset;
    copied = copyLine(line, (i) => at(base + i), LINE_CHARS);
    if (copied < LINE_CHARS) break;
    offset += LINE_CHARS;
    const last = buffer[line + LINE_CHARS - 1];
    if (last !== SPACE && last !== QUESTION_MARK && at(offset) !== SPACE) {
      let cut = line + LINE_CHARS - 1;
      while (buffer[cut] !== SPACE) {
        cut--;
        offset--;
      }
      buffer[cut] = 0;
    }
    line += LINE_STRIDE;
  }
  return [0, 1, 2, 3, 4].map((i) => {
    const start = i * LINE_STRIDE;
    let end = start;
    while (buffer[end] !== 0) end++;
    return decodeCp850(buffer.subarray(start, end));
  });
}

/** Zones (D11) des trois réponses, en (20, 118 + 18i). */
const ANSWER_ZONES: readonly Zone[] = [0, 1, 2].map((i) => ({ x1: 12, y1: 0x76 + 0x12 * i - 3, x2: 310, y2: 0x76 + 0x12 * i + 13 }));

/** `25f1:042d` : la case pays du joueur courant. */
export function* quizSquare(play: Play): Script {
  const { rt, board } = play;
  const { game, session, tables } = rt;
  const player = board.player;
  const { resources } = rt.ctx;
  const moveSound = yield* rt.load(resources.sound("b40-01b.voc"));
  const rightSound = yield* rt.load(resources.sound("b40-08a.voc"));
  const wrongSound = yield* rt.load(resources.sound("b40-01a.voc"));
  const country = Math.floor(player.pos / 6);
  const questions = parseQuiz(yield* rt.load(resources.bytes(tables.quizFiles[country])));
  const wrong = function* (): Script {
    rt.ctx.voice.play(wrongSound);
    yield* rt.waitSound();
    yield* rt.wait(0x19);
  };

  yield* rt.voice(quizWelcomeVoice(game, country, rt.rnd), VOICES.announce);
  rt.voiceKey = VOICES.quiz;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Rattrapage : la gourde est prise d'entrée.
    if (attempt === 1) player.gourds--;
    const number = quizNumber(session, player.reflexion, country, rt.rnd);
    const question = questions.find((q) => q.number === number) as QuizQuestion;
    const order = quizOrder(rt.rnd);
    yield* rt.picture("M40DA000.MCC", 0x4001);
    // Musique : `m40ma`, ou une fois sur trois l'une des cinq (`e` remplacée par `f` en français).
    let letter = "a";
    if (rt.rnd() % 3 === 0) {
      letter = String.fromCharCode(0x61 + (rt.rnd() % 5));
      if (letter === "e") letter = "f";
    }
    yield* rt.music(`m40m${letter}.voc`);
    rt.textColor = 0xff;
    layoutQuestion(question.question).forEach((text, i) => rt.text(0x14, i * 0x12 + 0x1e, text));
    rt.commit();
    rt.effect(moveSound);
    let cursor = 0;
    let answered = false;
    rt.screen = "quiz";
    rt.hint = { correct: order.indexOf(question.correct), number, country };
    rt.startChrono(2);
    do {
      const directions = rt.dirs();
      let moved = false;
      if (directions & DOWN && cursor < 2) {
        rt.effect(moveSound);
        moved = true;
        cursor++;
      }
      if (directions & UP && cursor > 0 && !moved) {
        rt.effect(moveSound);
        moved = true;
        cursor--;
      }
      const click = rt.click(ANSWER_ZONES);
      if (typeof click === "number") cursor = click;
      rt.restore();
      // La ligne du curseur est en couleur 0xf0, les autres en 0xff (`25f1:0386`).
      for (let i = 0; i < 3; i++) {
        rt.textColor = i === cursor ? 0xf0 : 0xff;
        rt.text(0x14, i * 0x12 + 0x76, question.answers[order[i]]);
      }
      rt.textColor = 0xff;
      if (moved) yield* rt.wait(0xf);
      if (click !== null) answered = true;
      else yield;
    } while (!answered && rt.chrono(2) < 15);
    rt.screen = "";
    yield* rt.music(null);
    rt.stopSound();
    // L'écran, réponses comprises, devient le fond des vidéos de résultat.
    rt.ctx.surface.commitBackground();
    if (!answered) {
      // Temps écoulé : pas de rattrapage.
      yield* wrong();
      yield* rt.moduleVideo(0x28, 4, { overlay: true });
      break;
    }
    yield* rt.waitRelease();
    if (order[cursor] === question.correct) {
      rt.ctx.voice.play(rightSound);
      yield* rt.waitSound();
      yield* rt.wait(0x19);
      if (player.objects[country]) {
        yield* rt.moduleVideo(0x28, 0, { overlay: true });
        break;
      }
      player.objectCount++;
      player.objects[country] = true;
      yield* rt.picture(`M40DB00${country}.MCC`);
      rt.commit();
      const generic = country === 8 || (rt.rnd() & 1) !== 0;
      yield* rt.voice(generic ? (rt.rnd() % 3) + 0x24 : country + 0xc);
      if (country !== 0) {
        if (player.objectCount === game.objectsRequired) yield* rt.voice(5, VOICES.marble);
        if (player.objectCount > game.objectsRequired) yield* rt.voice(6, VOICES.marble);
      }
      break;
    }
    yield* wrong();
    if (attempt === 1 || player.gourds === 0) {
      yield* rt.moduleVideo(0x28, (rt.rnd() % 3) + 1, { overlay: true });
      break;
    }
    if (!(yield* confirm(rt, player.character + 6, player.character))) break;
  }
  yield* rt.cleanup();
}
