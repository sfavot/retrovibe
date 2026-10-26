import { decodeCp437, encodeCp437 } from "../../../../data/cp437";
import { measureText, type PfnFont } from "../../data/font";
import type { Mcg } from "../../data/mcg";
import { parseQuiz, type Quiz } from "../../data/text";
import type { Voc } from "../../data/voc";
import type { Timer } from "../../engine/clock";
import type { Scene, SceneContext } from "../../engine/scene";
import type { Game } from "../../game/rules";
import { DEFAULT_FONT } from "../common/text";
import { levelTimeLimit, minigameLevel, minigameRequest, pointsOutcome, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S40 « Le Quizz » (`2ee8:000d`, 2 401 octets ; RE : `docs/teleportaschtroumpf/minigames/s40.md`).
 *
 * ### `createQuiz(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 40) : `level` 0..2 raccourcit le temps imparti
 *   (35, 28 ou 21 s), `bonus` (indice de l'oiseau) force le niveau 0 ;
 * - joue : une expression dont un mot est remplacé par « schtroumpf » (`S40A.DAT`, 44 questions) et trois propositions dans un ordre tiré
 *   au sort. Haut / bas (flèches, `Q` / `A`) changent la proposition surlignée, Espace (clic gauche) valide, Entrée (clic droit) la lit à voix haute.
 *   Au doigt (ajout du port), toucher une proposition la choisit et la valide, l'appui long la lit. Le temps écoulé valide la proposition
 *   surlignée ;
 * - rend : `onDone(ctx, { kind: "points", points })` : 1 point si la bonne proposition est choisie, 0 sinon ; l'appelant applique l'issue.
 */

/** Largeur maximale d'une ligne de la question (`2ee8:02b4`, 0xB9 px) et abscisse du bloc de texte (`0x3F`). */
export const TEXT_WIDTH = 0xb9;
export const TEXT_LEFT = 0x3f;
/** Ordonnées de la question selon son nombre de lignes (`2ee8:0399..0464`). */
export const QUESTION_ROWS: readonly (readonly number[])[] = [[0x14], [10, 0x19], [0, 0x0f, 0x1e]];
/** Ordonnées des trois propositions (`2ee8:05d4..062a`) et couleurs du texte : surlignée `0x7B`, autres et question `0x7D`. */
export const ANSWER_ROWS: readonly number[] = [0x73, 0x8c, 0xa5];
export const COLOR_NORMAL = 0x7d;
export const COLOR_SELECTED = 0x7b;
/** Temps imparti : `35 − 7 × niveau` secondes (`2ee8:06ae`). */
export const TIME_LIMIT_SECONDS = 35;
export const TIME_LIMIT_PER_LEVEL = 7;
/** Nombre de questions à ne pas reposer d'affilée (`DS:7C80..7C84`). */
export const RECENT_COUNT = 5;
/** Les questions à partir de la 13e ont leurs voix décalées d'un numéro (`local_f`). */
const SHIFTED_FROM = 13;
/** Voix « clic » jouée quand la sélection change (`s07a001b.voc`, `15f9:089f(·, 1, 0x80)`). */
const MOVE_SOUND = "s07a001b.voc";
const SPACE = 0x20;
const PERIOD = 0x2e;

/** Marge (pixels) autour du bloc de texte pour le doigt : les propositions se touchent sur toute la largeur du parchemin. */
const TOUCH_MARGIN = 6;

/**
 * Ligne de proposition touchée en (x, y), ou `null` : une bande par ligne, de la largeur du bloc de texte, centrée sur le texte et
 * aussi haute que l'écart entre deux lignes (`fontHeight` : hauteur de la police).
 */
export function answerRowAt(x: number, y: number, fontHeight: number): number | null {
  if (x < TEXT_LEFT - TOUCH_MARGIN || x > TEXT_LEFT + TEXT_WIDTH + TOUCH_MARGIN) return null;
  const step = ANSWER_ROWS[1] - ANSWER_ROWS[0];
  const row = Math.floor((y - (ANSWER_ROWS[0] + fontHeight / 2 - step / 2)) / step);
  return row >= 0 && row < ANSWER_ROWS.length ? row : null;
}

/** Temps imparti (secondes) au niveau interne 0..2. */
export function timeLimit(level: number): number {
  return levelTimeLimit(TIME_LIMIT_SECONDS, TIME_LIMIT_PER_LEVEL, level);
}

/** Numéro `n` du fichier `s40a<nnn>t.voc` : question, puis bonne réponse et deux fausses (`3 + 4q + décalage`, `4 + 4q + proposition + décalage`). */
export function questionVoiceNumber(question: number): number {
  return 3 + question * 4 + (question >= SHIFTED_FROM ? 1 : 0);
}
export function answerVoiceNumber(question: number, answer: number): number {
  return 4 + question * 4 + answer + (question >= SHIFTED_FROM ? 1 : 0);
}
/** Voix `s40b<nnn>t.voc` après une mauvaise réponse : `1 + q`, une de plus à partir de la question 3 (`2ee8:090c`, il manque le fichier 4). */
export function wrongVoiceNumber(question: number): number {
  return 1 + question + (question > 2 ? 1 : 0);
}

const pad3 = (n: number) => String(n).padStart(3, "0");

/**
 * Coupe la phrase en au plus trois lignes de `TEXT_WIDTH` px (`2ee8:0273..04c1`). La ligne grandit caractère par caractère ; dès qu'elle
 * dépasse, elle recule jusqu'à la dernière espace (supprimée) ou au dernier point (conservé, et le caractère qui le suit est supprimé : l'original
 * suppose une espace). Même quand tout tient, le recul s'applique : une phrase finissant autrement que par un point perdrait son dernier mot
 * (aucune des 44 ne le fait). La troisième ligne reprend tout le reste, sans mesure.
 */
export function splitPhrase(font: PfnFont, text: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let rest = text;
  for (let n = 0; n < 2 && rest.length > 0; n++) {
    let last = 0;
    while (measureText(font, rest.subarray(0, last + 1)) <= TEXT_WIDTH && last + 1 < rest.length) last++;
    let cut = last;
    while (cut >= 0 && rest[cut] !== SPACE && rest[cut] !== PERIOD) cut--;
    if (cut < 0) {
      // Ni espace ni point : l'original lit hors de la phrase ; on coupe net.
      lines.push(rest.subarray(0, last + 1));
      rest = rest.subarray(last + 1);
    } else if (rest[cut] === SPACE) {
      lines.push(rest.subarray(0, cut));
      rest = rest.subarray(cut + 1);
    } else {
      lines.push(rest.subarray(0, cut + 1));
      rest = rest.subarray(cut + 2);
    }
  }
  if (rest.length > 0) lines.push(rest);
  return lines;
}

/** Abscisse d'un texte centré dans le bloc : `(0xB9 − largeur) / 2 + 0x3F` (division entière du C). */
export function centeredX(font: PfnFont, text: Uint8Array): number {
  return Math.trunc((TEXT_WIDTH - measureText(font, text)) / 2) + TEXT_LEFT;
}

/** Questions tirées récemment, par partie : l'original les garde dans `DS:7C80..7C84`, valables pour toute la session. */
const RECENT = new WeakMap<Game, number[]>();

/**
 * Tire la question (`2ee8:0109..0190`) : `rand × 44 / 0x8000` jusqu'à une question absente des cinq dernières. Au début, les cinq mémoires
 * sont égales (0) : l'original les remplace alors par 0..4, ces cinq questions ne sortent donc pas à la première partie.
 */
export function drawQuestion(game: Game, count: number, below: (n: number) => number): number {
  let recent = RECENT.get(game);
  if (!recent) RECENT.set(game, (recent = Array(RECENT_COUNT).fill(0)));
  if (recent.every((q) => q === recent![0])) recent.splice(0, RECENT_COUNT, 4, 3, 2, 1, 0);
  let question: number;
  do question = below(count);
  while (recent.includes(question));
  recent.unshift(question);
  recent.length = RECENT_COUNT;
  return question;
}

/**
 * Ordre des trois propositions (`2ee8:04c1..05b3`) : `order[i]` est la proposition (0 = la bonne) affichée à la ligne `i`. Trois tirages
 * de `rand × 3 / 0x8000`, chacun refait jusqu'à être nouveau.
 */
export function drawOrder(below: (n: number) => number): [number, number, number] {
  const first = below(3);
  let second: number;
  do second = below(3);
  while (second === first);
  let third: number;
  do {
    do third = below(3);
    while (third === first);
  } while (third === second);
  return [first, second, third];
}

export type QuizPhase = "enter" | "ask" | "choose" | "move" | "read" | "answer" | "result" | "done";

export class QuizScene implements Scene {
  readonly step = 1;
  private readonly level: number;
  private font!: PfnFont;
  private mcg!: Mcg;
  private quiz!: Quiz;
  private moveSound!: Voc;
  private questionVoice!: Voc;
  private answerVoices: Voc[] = [];
  private wrongVoice!: Voc;
  private rightVoices: Voc[] = [];
  private question = 0;
  private lines: Uint8Array[] = [];
  private answers: Uint8Array[] = [];
  private order: [number, number, number] = [0, 1, 2];
  private phase: QuizPhase = "enter";
  private timer: Timer | null = null;
  /** Ligne surlignée (0..2) et dernière ligne annoncée par le clic (`local_2c[4]`). */
  private row = 0;
  private announced = 0;
  /** Verrou de répétition de ↑ / ↓ (`local_47`) et ordonnée de la souris au tick précédent (bord haut / bas). */
  private latch = false;
  private lastMouseY = 100;
  /** Ce que le doigt a demandé sur la ligne touchée, fait une fois le clic de sélection joué : valider ou lire. */
  private touchAction: "validate" | "read" | null = null;
  private successVoice = -1;
  private earned = 0;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    this.level = minigameLevel(minigameRequest(game, 40), 0);
  }

  get stage(): QuizPhase {
    return this.phase;
  }

  /** Niveau interne (0..2) : celui du joueur, 0 avec l'indice de l'oiseau. */
  get internalLevel(): number {
    return this.level;
  }

  /** Numéro de la question (0..43). */
  get questionIndex(): number {
    return this.question;
  }

  /** Ligne surlignée (0..2). */
  get selection(): number {
    return this.row;
  }

  /** Proposition affichée à chaque ligne (0 = la bonne). */
  get rowAnswers(): readonly number[] {
    return this.order;
  }

  /** Lignes de la question, décodées. */
  get questionLines(): string[] {
    return this.lines.map((line) => decodeCp437(line));
  }

  /** Secondes écoulées depuis la fin de la voix de la question. */
  get seconds(): number {
    return this.timer?.seconds ?? 0;
  }

  /** Voix de félicitations tirée (0..5), -1 si la réponse est fausse ou pas encore donnée. */
  get congratulation(): number {
    return this.successVoice;
  }

  /** Points gagnés (0 tant que la partie n'est pas finie ou en cas d'échec). */
  get points(): number {
    return this.earned;
  }

  async load(ctx: SceneContext): Promise<void> {
    const [font, mcg, bytes, moveSound] = await Promise.all([
      ctx.resources.pfn(DEFAULT_FONT),
      ctx.resources.mcg("s40a001d.mcg"),
      ctx.resources.bytes("s40a.dat"),
      ctx.resources.voc(MOVE_SOUND),
    ]);
    this.font = font;
    this.mcg = mcg;
    this.moveSound = moveSound;
    this.quiz = parseQuiz(bytes);
    // Tirage de la question avant tout le reste (comme l'original) : ses voix en dépendent.
    this.question = drawQuestion(this.game, this.quiz.questions.length, (n) => ctx.rng.below(n));
    const q = this.question;
    const voc = (name: string) => ctx.resources.voc(name);
    [this.questionVoice, this.wrongVoice, this.answerVoices, this.rightVoices] = await Promise.all([
      voc(`s40a${pad3(questionVoiceNumber(q))}t.voc`),
      voc(`s40b${pad3(wrongVoiceNumber(q))}t.voc`),
      Promise.all([0, 1, 2].map((a) => voc(`s40a${pad3(answerVoiceNumber(q, a))}t.voc`))),
      // Le tirage de la voix de réussite n'a lieu qu'à la bonne réponse : on charge les six.
      Promise.all([1, 2, 3, 4, 5, 6].map((n) => voc(`s40c${pad3(n)}t.voc`))),
    ]);
  }

  enter(ctx: SceneContext): void {
    const entry = this.quiz.questions[this.question];
    this.lines = splitPhrase(this.font, encodeCp437(entry.text));
    this.answers = [entry.correct, ...entry.wrong].map(encodeCp437);
    this.order = drawOrder((n) => ctx.rng.below(n));
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    // La question reste sur le fond ; seules les propositions sont redessinées (`13fc:0411` efface tout le reste).
    const rows = QUESTION_ROWS[this.lines.length - 1] ?? QUESTION_ROWS[2];
    this.lines.forEach((line, i) => ctx.surface.drawText(this.font, line, centeredX(this.font, line), rows[i] ?? rows[2], COLOR_NORMAL));
    ctx.surface.commitBackground();
    ctx.voice.holdMusic(true);
    this.phase = "enter";
    this.timer = null;
    this.row = 0;
    this.announced = 0;
    this.latch = false;
    this.touchAction = null;
    this.earned = 0;
    this.done = false;
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "enter":
        // L'original attend la fin du fondu d'entrée, puis lit la question jusqu'au bout.
        if (ctx.fade.active) return;
        ctx.voice.play(this.questionVoice);
        this.phase = "ask";
        return;
      case "ask":
        if (ctx.voice.voicePlaying) return;
        // `1f33:0181(2)` : le chrono démarre à la fin de la voix ; la souris revient au centre (`14b3:0039`).
        this.timer = ctx.clock.createTimer();
        ctx.input.warpMouse(0xa0, 100);
        this.lastMouseY = ctx.input.mouseY;
        this.phase = "choose";
        return;
      case "choose":
        this.choose(ctx);
        return;
      case "move":
      case "read":
        // `1f33:03a7(0)` : attente bloquante de la fin du son, sans prise en compte des touches.
        if (!ctx.voice.voicePlaying) this.phase = "choose";
        return;
      case "answer":
        // `1f33:03a7(1)` : un clic gauche (ou un toucher du doigt) coupe la voix de la proposition choisie.
        if (ctx.voice.voicePlaying && !ctx.input.validateNotTouch && ctx.input.touchGesture?.kind !== "tap") return;
        this.conclude(ctx);
        return;
      case "result":
        if (ctx.voice.voicePlaying) return;
        this.finish(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    const { surface } = ctx;
    surface.restoreBackground();
    this.order.forEach((answer, row) => {
      const text = this.answers[answer];
      surface.drawText(this.font, text, centeredX(this.font, text), ANSWER_ROWS[row], row === this.row ? COLOR_SELECTED : COLOR_NORMAL);
    });
  }

  exit(ctx: SceneContext): void {
    ctx.voice.holdMusic(false);
  }

  /** Une itération de la boucle de choix (`2ee8:06ae..0850`). */
  private choose(ctx: SceneContext): void {
    const { input } = ctx;
    // Le bord haut / bas de l'écran émule ↑ / ↓ dans l'original (`14b3:004c`) ; ici seulement à l'arrivée du pointeur sur ce bord, sans
    // quoi un pointeur resté hors du canvas figerait le verrou.
    const mouseY = input.mouseY;
    const edgeUp = mouseY < 2 && this.lastMouseY >= 2;
    const edgeDown = mouseY >= 199 && this.lastMouseY < 199;
    this.lastMouseY = mouseY;
    const up = input.pressed("up") || input.justPressed("up") || edgeUp;
    const down = input.pressed("down") || input.justPressed("down") || edgeDown;
    if (!up && !down) this.latch = false;
    if (up && !this.latch) {
      this.latch = true;
      this.row--;
    }
    if (down && !this.latch) {
      this.latch = true;
      this.row++;
    }
    this.row = Math.min(2, Math.max(0, this.row));
    // Au doigt : la ligne touchée devient la ligne surlignée (avec son clic, comme aux flèches), puis le toucher la valide et l'appui
    // long la lit, comme Espace et Entrée. Le doigt qui se pose ne valide rien : son geste décide au relâchement.
    const gesture = input.touchGesture;
    const touched = gesture && gesture.kind !== "swipe" ? answerRowAt(gesture.x, gesture.y, this.font.height) : null;
    if (touched !== null) {
      this.row = touched;
      this.touchAction = gesture!.kind === "tap" ? "validate" : "read";
    }

    if (input.justPressed("cancel")) {
      ctx.voice.play(this.answerVoices[this.order[this.row]]);
      this.phase = "read";
      return;
    }
    if (this.announced !== this.row) {
      this.announced = this.row;
      ctx.voice.play(this.moveSound);
      this.phase = "move";
      return;
    }
    const touch = this.touchAction;
    this.touchAction = null;
    if (touch === "read") {
      ctx.voice.play(this.answerVoices[this.order[this.row]]);
      this.phase = "read";
      return;
    }
    if (touch === "validate" || input.validateNotTouch || this.timer!.seconds >= timeLimit(this.level)) {
      // `1f33:036d` n'attend plus rien ici ; la voix de la proposition choisie est lue.
      ctx.voice.play(this.answerVoices[this.order[this.row]]);
      this.phase = "answer";
    }
  }

  /** `2ee8:0876..0964` : bonne réponse → un point et une voix de félicitations (`s40c`), sinon la voix `s40b` de la question. */
  private conclude(ctx: SceneContext): void {
    ctx.voice.stop();
    if (this.order[this.row] === 0) {
      this.earned = 1;
      this.successVoice = ctx.rng.below(this.rightVoices.length);
      ctx.voice.play(this.rightVoices[this.successVoice]);
    } else {
      ctx.voice.play(this.wrongVoice);
    }
    this.phase = "result";
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, pointsOutcome(this.earned));
  }
}

export const createQuiz: MinigameFactory = (game, onDone) => new QuizScene(game, onDone);
