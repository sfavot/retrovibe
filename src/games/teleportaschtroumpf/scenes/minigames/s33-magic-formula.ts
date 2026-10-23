import type { Hy8, Hy8Frame } from "../../data/hy8";
import type { Mcg } from "../../data/mcg";
import type { Voc } from "../../data/voc";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../data/mcg";
import { voiceName } from "../../engine/paths";
import type { Scene, SceneContext } from "../../engine/scene";
import { AnimationPlayer } from "../../engine/sprites";
import type { Surface } from "../../engine/surface";
import type { Timer } from "../../engine/clock";
import type { Game } from "../../game/rules";
import { Clip, SoundHush, drawFrame, goalClip, ingredientOutcome, minigameLevel, minigameRequest, sceneIngredient, type MinigameDone, type MinigameFactory } from "./common";

/**
 * S33 « La Formule Magique » (`1ceb:000c`, 2 885 octets ; RE : `docs/teleportaschtroumpf/minigames/s33.md`).
 *
 * ### `createMagicFormula(game, onDone)`
 *
 * - reçoit : `game`, la partie en cours ; la requête est `game.state.pending` (scène 33) : `level` 0..2 choisit le nombre de formules
 *   (6, 7 ou 8), `bonus` (indice de l'oiseau) le remplace par le niveau 3 (5 formules, sans répétition : le plus facile) ;
 * - joue : un Mastermind à trois emplacements. Une formule secrète de trois symboles est tirée parmi `N` symboles ; le joueur choisit un
 *   symbole par emplacement (haut / bas dans la liste de gauche, gauche / droite pour changer d'emplacement, Espace pour proposer) et
 *   obtient, pour chacun, « bien placé » (2), « présent ailleurs » (1) ou « absent » (0). Il a six essais et 120 secondes ;
 * - rend : `onDone(ctx, { kind: "ingredient", success })` à la fin de la vidéo de fin (passable par Échap ou Espace) ; `Game.resolveMinigame`
 *   donne l'ingrédient 7.
 */

/** Ingrédient donné par la scène (`MINIGAMES`) : 7. */
const INGREDIENT = sceneIngredient(33)!;

/** Vidéo de réussite : `s33c1` quand l'ingrédient est dans l'objectif (`1e52:0008` vrai), `s33c2` sinon. */
export function formulaWinClip(game: Game): string {
  return goalClip(game, INGREDIENT, { inGoal: "s33c1.mux", notInGoal: "s33c2.mux" });
}

// --- Règles pures ---------------------------------------------------------------------------------

/** Nombre de symboles en jeu par niveau 0..3 (`CS:1ceb:0b51` : niveau 0 → 6, 1 → 7, 2 → 8, 3 → 5), le niveau 3 étant celui de l'indice de l'oiseau. */
export const LEVEL_SYMBOLS: readonly number[] = [6, 7, 8, 5];
/** Niveaux où la formule ne répète jamais un symbole (`DS:… == 0 || == 3`, `1ceb:02d1`). */
export const LEVEL_DISTINCT: readonly boolean[] = [true, false, false, true];
/** Niveau forcé par l'indice de l'oiseau (`DS:6F37 == 0x21`). */
export const BIRD_LEVEL = 3;
/** Symboles différents du jeu (3 sprites chacun dans `s33a000s.hy8` : neutre, présent ailleurs, bien placé) et symboles tirés pour la liste. */
export const SYMBOL_GROUPS = 12;
export const LIST_SIZE = 8;
export const SPRITES_PER_SYMBOL = 3;
/** Emplacements de la formule, essais et temps (120 s : `1f33:019a(2) > 0x78`). */
export const SLOTS = 3;
export const MAX_ATTEMPTS = 6;
export const TIME_LIMIT_SECONDS = 120;

/** Réponse par emplacement (sprite = symbole + réponse). */
export const ANSWER_NONE = 0;
export const ANSWER_MISPLACED = 1;
export const ANSWER_EXACT = 2;

/** Voix du symbole (`DS:18BC`, 12 mots) : `s33a` + (3 + valeur) + `t.voc`, soit `s33a003t` à `s33a014t`. */
export const SYMBOL_VOICES: readonly number[] = [8, 7, 10, 4, 2, 1, 0, 3, 5, 9, 11, 6];

interface Dice {
  below(n: number): number;
}

/** Nombre de symboles et répétitions interdites pour un niveau 0..3. */
export function levelRules(level: number): { symbols: number; distinct: boolean } {
  return { symbols: LEVEL_SYMBOLS[level], distinct: LEVEL_DISTINCT[level] };
}

/**
 * Les huit symboles de la liste (`1ceb:01ca..0254`) : indices de sprite (de 3 en 3) de huit groupes différents parmi douze. Le premier est
 * tiré seul, les autres par rejet (un `rand` par essai).
 */
export function drawSymbols(dice: Dice): number[] {
  const list = [dice.below(SYMBOL_GROUPS) * SPRITES_PER_SYMBOL];
  while (list.length < LIST_SIZE) {
    const group = dice.below(SYMBOL_GROUPS);
    if (!list.some((sprite) => sprite / SPRITES_PER_SYMBOL === group)) list.push(group * SPRITES_PER_SYMBOL);
  }
  return list;
}

/**
 * La formule secrète (`1ceb:029a..030b`) : trois positions dans la liste, un `rand × N` chacune ; aux niveaux sans répétition (0 et 3), un
 * tirage identique à un précédent est refait.
 */
export function drawSecret(dice: Dice, symbols: number, distinct: boolean): number[] {
  const secret: number[] = [];
  while (secret.length < SLOTS) {
    const pick = dice.below(symbols);
    if (distinct && secret.includes(pick)) continue;
    secret.push(pick);
  }
  return secret;
}

/**
 * Réponse à une proposition (`1ceb:0522..0629`) : 2 pour chaque symbole bien placé ; pour chaque autre, 1 s'il se trouve à un autre emplacement
 * de la formule qui n'est pas déjà apparié (par un bien placé ou un symbole précédent), 0 sinon.
 */
export function scoreGuess(secret: readonly number[], guess: readonly number[]): number[] {
  const used = secret.map((s, i) => s === guess[i]);
  const answers: number[] = secret.map((s, i) => (s === guess[i] ? ANSWER_EXACT : ANSWER_NONE));
  for (let i = 0; i < SLOTS; i++) {
    if (secret[i] === guess[i]) continue;
    for (let j = 0; j < SLOTS; j++) {
      if (j !== i && !used[j] && secret[j] === guess[i]) {
        used[j] = true;
        answers[i] = ANSWER_MISPLACED;
        break;
      }
    }
  }
  return answers;
}

// --- Géométrie (pixels) ---------------------------------------------------------------------------

const LIST_X = 0x0b;
const LIST_Y0 = 0x20;
const ROW_HEIGHT = 0x16;
const SLOT_X0 = 0x69;
const SLOT_DX = 0x41;
const GUESS_Y = 0xb0;
/** Ligne du bas de la première rangée de réponses, puis une rangée plus haut à chaque essai. */
const ANSWER_Y0 = 0x8e;
/** Étincelles des réponses : leur ligne du bas est 10 px sous celle des symboles ; une par emplacement. */
const SPARK_Y0 = 0x98;
const SPARK_X: readonly number[] = [0x87, 0xc8, 0x109];
const CURSOR_COLOR = 5;
/** Un pas de la logique tous les 5 ticks (`1f33:0348(5)`) ; une touche tenue n'est reprise qu'après 50 centièmes de seconde (`+0x32`). */
const LOGIC_TICKS = 5;
const REPEAT_CENTISECONDS = 0x32;

export type MagicStage = "intro" | "play" | "soundFade" | "names" | "fadeOut" | "video" | "done";

/** Anime comme `12d7:00c1` : rend la frame courante et le compteur suivant (0 après la dernière, ce que le jeu prend pour la fin). */
function stepAnimation(player: AnimationPlayer): { frame: Hy8Frame; counter: number } {
  const frame = player.frame!;
  player.advance();
  return { frame, counter: player.frameIndex };
}

export class MagicFormulaScene implements Scene {
  /** La vidéo de fin exige un pas de 1 tick ; la logique du jeu garde sa cadence de 5 ticks (`LOGIC_TICKS`). */
  readonly step = 1;
  private mcg!: Mcg;
  private sprites!: Hy8;
  private sparks!: Hy8;
  private moveSound!: Voc;
  private exactSound!: Voc;
  private otherSound!: Voc;
  private nameVoices: Voc[] = [];
  private win!: Clip;
  private lose!: Clip;
  private result: Clip | null = null;

  private level = 0;
  private symbolCount = 0;
  private list: number[] = [];
  private secretPicks: number[] = [];
  private phase: MagicStage = "intro";

  // Choix du joueur
  private column = 0;
  private cursor = 0;
  private guessPicks: number[] = [0, 0, 0];
  private latchVertical = false;
  private latchHorizontal = false;
  private stampVertical = 0;
  private stampHorizontal = 0;
  private seen = { up: false, down: false, left: false, right: false, validate: false };
  private lastLogic = 0;

  // Essais
  private attempts = 0;
  private won = false;
  private lost = false;
  private answers: number[] = [0, 0, 0];
  private timer: Timer | null = null;

  // Animation de la réponse
  private animating = false;
  private revealOn = false;
  private revealShown = false;
  private revealCounter = 0;
  private sparkDone = false;
  private sparkPlayer!: AnimationPlayer;
  private sparkShown: Hy8Frame | null = null;
  private pegPlayers: AnimationPlayer[] = [];
  private pegDelay: number[] = [0, 0, 0];
  private pegDone: boolean[] = [false, false, false];
  private pegShown: (Hy8Frame | null)[] = [null, null, null];

  // Fin
  private showSecret = false;
  private readonly hushing = new SoundHush();
  private nameIndex = 0;
  private nameStarted = false;
  private done = false;

  constructor(
    private readonly game: Game,
    private readonly onDone: MinigameDone,
  ) {
    minigameRequest(game, 33);
  }

  // --- Accès pour les tests --------------------------------------------------------------------------

  get stage(): MagicStage {
    return this.phase;
  }

  /** Niveau effectif 0..3 (3 avec l'indice de l'oiseau). */
  get currentLevel(): number {
    return this.level;
  }

  /** Nombre de symboles proposés dans la liste. */
  get symbols(): number {
    return this.symbolCount;
  }

  /** La formule secrète : positions dans la liste (0 = premier symbole). */
  get secret(): readonly number[] {
    return this.secretPicks;
  }

  /** La proposition en cours : une position dans la liste par emplacement. */
  get guess(): readonly number[] {
    return this.guessPicks;
  }

  /** Emplacement choisi (0..2) et position du curseur dans la liste. */
  get selectedColumn(): number {
    return this.column;
  }

  get selectedSymbol(): number {
    return this.cursor;
  }

  /** Propositions faites jusqu'ici et dernière réponse (2 / 1 / 0 par emplacement). */
  get attemptCount(): number {
    return this.attempts;
  }

  get lastAnswers(): readonly number[] {
    return this.answers;
  }

  /** Vrai pendant l'animation d'une réponse (les touches sont alors ignorées). */
  get answering(): boolean {
    return this.animating;
  }

  get succeeded(): boolean {
    return this.won;
  }

  /** Vidéo de fin choisie (`null` avant la fin). */
  get endVideo(): string | null {
    return this.result?.file ?? null;
  }

  // --- Cycle de vie ----------------------------------------------------------------------------------

  async load(ctx: SceneContext): Promise<void> {
    const request = minigameRequest(this.game, 33);
    this.level = minigameLevel(request, BIRD_LEVEL);
    const rules = levelRules(this.level);
    this.symbolCount = rules.symbols;
    // Les tirages se font dans l'ordre de l'original : la liste (une à huit tentatives par symbole), puis la formule.
    this.list = drawSymbols(ctx.rng);
    this.secretPicks = drawSecret(ctx.rng, rules.symbols, rules.distinct);
    const secretVoices = this.secretPicks.map((pick) => voiceName("s33a", 3 + SYMBOL_VOICES[this.list[pick] / SPRITES_PER_SYMBOL]));
    // c1 si l'ingrédient 7 fait partie de l'objectif, c2 sinon (`1ceb:0a79`) ; la vidéo d'échec est `s33b`.
    this.win = new Clip(formulaWinClip(this.game), (c) => this.finish(c));
    this.lose = new Clip("s33b.mux", (c) => this.finish(c));
    [this.mcg, this.sprites, this.sparks, this.moveSound, this.exactSound, this.otherSound, this.nameVoices] = await Promise.all([
      ctx.resources.mcg("s33a001d.mcg"),
      ctx.resources.hy8("s33a000s.hy8"),
      ctx.resources.hy8("s33a001s.hy8"),
      ctx.resources.voc("s33a001b.voc"),
      ctx.resources.voc("s33a003b.voc"),
      ctx.resources.voc("s33a004b.voc"),
      Promise.all(secretVoices.map((name) => ctx.resources.voc(name))),
      this.win.load(ctx),
      this.lose.load(ctx),
    ]);
  }

  enter(ctx: SceneContext): void {
    ctx.palette.load(this.mcg.palette);
    ctx.surface.drawMcg(this.mcg, { asBackground: true });
    this.phase = "intro";
    this.column = 0;
    this.cursor = 0;
    this.guessPicks = [0, 0, 0];
    this.attempts = 0;
    this.won = false;
    this.lost = false;
    this.answers = [0, 0, 0];
    this.animating = false;
    this.showSecret = false;
    this.done = false;
    this.result = null;
    this.sparkPlayer = new AnimationPlayer(this.sparks, 0);
    this.pegPlayers = [0, 1, 2].map(() => new AnimationPlayer(this.sparks, 0));
  }

  update(ctx: SceneContext): void {
    switch (this.phase) {
      case "intro":
        // `13fc:0150(…, 1)` fait son fondu d'entrée avant que la liste ne soit dessinée.
        if (ctx.fade.active) return;
        this.drawList(ctx);
        this.timer = ctx.clock.createTimer();
        this.stampVertical = this.stampHorizontal = ctx.clock.centiseconds;
        this.lastLogic = ctx.clock.ticks - LOGIC_TICKS;
        this.phase = "play";
        return;
      case "play":
        this.collectKeys(ctx);
        if (ctx.clock.ticks - this.lastLogic >= LOGIC_TICKS) {
          this.lastLogic = ctx.clock.ticks;
          this.logicStep(ctx);
        }
        return;
      case "soundFade":
        this.updateSoundFade(ctx);
        return;
      case "names":
        this.updateNames(ctx);
        return;
      case "fadeOut":
        if (ctx.fade.active) return;
        this.phase = "video";
        this.result = this.won ? this.win : this.lose;
        this.result.start(ctx);
        return;
      case "video":
        this.result!.update(ctx);
        return;
      case "done":
        return;
    }
  }

  render(ctx: SceneContext): void {
    if (this.phase === "video" || this.phase === "done") {
      this.result?.render(ctx);
      return;
    }
    this.paint(ctx);
  }

  exit(ctx: SceneContext): void {
    this.win.stop(ctx);
    this.lose.stop(ctx);
    this.hushing.restore(ctx);
    ctx.voice.holdMusic(false);
  }

  // --- Entrées et logique -----------------------------------------------------------------------------

  /** L'original lit les touches tenues à chaque pas de 5 ticks ; un nouvel appui plus court qu'un pas compte quand même. */
  private collectKeys(ctx: SceneContext): void {
    const { input } = ctx;
    this.seen.up ||= input.justPressed("up");
    this.seen.down ||= input.justPressed("down");
    this.seen.left ||= input.justPressed("left");
    this.seen.right ||= input.justPressed("right");
    this.seen.validate ||= input.justPressed("validate");
  }

  private logicStep(ctx: SceneContext): void {
    const { input } = ctx;
    const up = this.seen.up || input.pressed("up");
    const down = this.seen.down || input.pressed("down");
    const left = this.seen.left || input.pressed("left");
    const right = this.seen.right || input.pressed("right");
    const validate = this.seen.validate;
    this.seen = { up: false, down: false, left: false, right: false, validate: false };
    const now = ctx.clock.centiseconds;

    // Verrous de répétition (`1ceb:0387..03c6`) : levés quand la touche est relâchée ou après 50 centièmes de seconde.
    if (now >= this.stampHorizontal + REPEAT_CENTISECONDS || !(left || right)) this.latchHorizontal = false;
    if (now >= this.stampVertical + REPEAT_CENTISECONDS || !(up || down)) this.latchVertical = false;

    if (!this.animating) {
      if (up && !this.latchVertical) this.moveCursor(ctx, -1);
      if (down && !this.latchVertical) this.moveCursor(ctx, 1);
      if (left && this.column > 0 && !this.latchHorizontal) this.moveColumn(ctx, -1);
      if (right && this.column < SLOTS - 1 && !this.latchHorizontal) this.moveColumn(ctx, 1);
    }
    if (validate && !this.animating) this.submit(ctx);
    if (this.animating) this.animate(ctx);

    if (this.timer!.seconds > TIME_LIMIT_SECONDS) this.lost = true;
    // Fin : seulement une fois l'animation terminée ; la victoire l'emporte (`1ceb:09df`).
    if ((this.lost || this.won) && !this.animating) this.beginEnding(ctx);
  }

  private moveCursor(ctx: SceneContext, direction: -1 | 1): void {
    this.latchVertical = true;
    this.stampVertical = ctx.clock.centiseconds;
    this.cursor += direction;
    if (this.cursor < 0) this.cursor = this.symbolCount - 1;
    else if (this.cursor === this.symbolCount) this.cursor = 0;
    this.guessPicks[this.column] = this.cursor;
    ctx.voice.playEffect(this.moveSound);
  }

  private moveColumn(ctx: SceneContext, direction: -1 | 1): void {
    this.latchHorizontal = true;
    this.stampHorizontal = ctx.clock.centiseconds;
    this.column += direction;
    this.cursor = this.guessPicks[this.column];
    ctx.voice.playEffect(this.moveSound);
  }

  /** Espace : la proposition est jugée, les bruitages mélangés sont lancés dans l'ordre de l'original (un seul emplacement : le dernier reste). */
  private submit(ctx: SceneContext): void {
    const answers = scoreGuess(this.secretPicks, this.guessPicks);
    for (let i = 0; i < SLOTS; i++) if (answers[i] === ANSWER_EXACT) ctx.voice.playEffect(this.exactSound);
    for (let i = 0; i < SLOTS; i++) if (answers[i] !== ANSWER_EXACT) ctx.voice.playEffect(this.otherSound);
    this.answers = answers;
    this.attempts++;
    if (answers.every((a) => a === ANSWER_EXACT)) this.won = true;
    else if (this.attempts === MAX_ATTEMPTS) this.lost = true;
    this.animating = true;
    this.revealOn = false;
    this.revealShown = false;
    this.revealCounter = 0;
    this.sparkDone = false;
    this.pegDone = [false, false, false];
    // Les trois délais (0 à 2 pas) avant l'étincelle de chaque symbole, tirés dans cet ordre (`1ceb:0655..06a3`).
    this.pegDelay = [ctx.rng.below(3), ctx.rng.below(3), ctx.rng.below(3)];
  }

  /**
   * Un pas de l'animation de la réponse (`1ceb:06a6..08b2`) : une étincelle sur les trois emplacements ; à sa 3ᵉ image les symboles de
   * la proposition apparaissent avec leur réponse, puis chaque emplacement a sa propre étincelle après un délai de 0 à 2 pas ; quand
   * les trois ont fini et que deux pas ont passé, la rangée est recopiée dans le fond et les touches reprennent.
   */
  private animate(ctx: SceneContext): void {
    this.sparkShown = null;
    this.pegShown = [null, null, null];
    this.revealShown = this.revealOn;
    if (this.revealOn) {
      if (this.revealCounter === 2) {
        this.commitRow(ctx);
        this.animating = false;
      }
      for (let i = 0; i < SLOTS; i++) if (this.pegDelay[i] > 0) this.pegDelay[i]--;
      for (let i = 0; i < SLOTS; i++) {
        if (this.pegDelay[i] === 0 && !this.pegDone[i]) {
          const { frame, counter } = stepAnimation(this.pegPlayers[i]);
          this.pegShown[i] = frame;
          if (counter === 0) this.pegDone[i] = true;
        }
      }
      if (this.pegDone.every(Boolean)) this.revealCounter++;
    }
    if (!this.sparkDone) {
      const { frame, counter } = stepAnimation(this.sparkPlayer);
      this.sparkShown = frame;
      if (counter === 0) this.sparkDone = true;
      if (counter === 3) this.revealOn = true;
    }
  }

  /** `13fc:067d(A, 0x69, y, 0x12C, 0x64)` : la rangée et tout ce qui est dessous (jusqu'à la ligne 199) deviennent le fond. */
  private commitRow(ctx: SceneContext): void {
    const { surface } = ctx;
    surface.restoreBackground();
    this.drawAnswers(surface);
    const top = answerY(this.attempts) - ROW_HEIGHT;
    const bottom = Math.min(SCREEN_HEIGHT - 1, top + 0x64);
    for (let y = Math.max(0, top); y <= bottom; y++) {
      const from = y * SCREEN_WIDTH + SLOT_X0;
      surface.background.set(surface.work.subarray(from, y * SCREEN_WIDTH + SCREEN_WIDTH), from);
    }
  }

  // --- Fin -------------------------------------------------------------------------------------------

  private beginEnding(ctx: SceneContext): void {
    this.hushing.start(ctx);
    this.phase = "soundFade";
  }

  /** `1343:0037` : le volume descend de son niveau à 1, un cran toutes les 20 centièmes de seconde, puis le son est coupé. */
  private updateSoundFade(ctx: SceneContext): void {
    if (!this.hushing.update(ctx)) return;
    ctx.voice.holdMusic(true);
    // Échec : la formule remplace la proposition une fois le son coupé (`1ceb:0a91`).
    this.showSecret = !this.won;
    this.nameIndex = 0;
    this.nameStarted = false;
    this.phase = "names";
  }

  /** Les noms des trois symboles de la formule, l'un après l'autre (`15f9:0e1c` puis `1f33:03a7`). */
  private updateNames(ctx: SceneContext): void {
    if (!this.nameStarted) {
      if (this.nameIndex === SLOTS) {
        this.phase = "fadeOut";
        ctx.fade.out();
        return;
      }
      ctx.voice.play(this.nameVoices[this.nameIndex]);
      this.nameStarted = true;
      return;
    }
    if (ctx.voice.voicePlaying) return;
    this.nameIndex++;
    this.nameStarted = false;
  }

  private finish(ctx: SceneContext): void {
    if (this.done) return;
    this.done = true;
    this.phase = "done";
    this.onDone(ctx, ingredientOutcome(this.won));
  }

  // --- Dessin ----------------------------------------------------------------------------------------

  /** La liste des symboles est dessinée une fois, puis recopiée dans le fond (`12ec:037c`). */
  private drawList(ctx: SceneContext): void {
    const { surface } = ctx;
    for (let i = 0; i < this.symbolCount; i++) surface.drawSprite(this.sprites, this.list[i], LIST_X, LIST_Y0 + i * ROW_HEIGHT);
    surface.commitBackground();
  }

  /** Les trois symboles de la dernière proposition avec leur réponse, sur la rangée de l'essai. */
  private drawAnswers(surface: Surface): void {
    for (let i = 0; i < SLOTS; i++) {
      surface.drawSprite(this.sprites, this.list[this.guessPicks[i]] + this.answers[i], SLOT_X0 + i * SLOT_DX, answerY(this.attempts));
    }
  }

  private paint(ctx: SceneContext): void {
    const { surface } = ctx;
    surface.restoreBackground();
    if (this.phase === "intro") return;
    if (this.showSecret) {
      // Échec : la formule est montrée à la place de la proposition (`1ceb:0a91..0ad2`), sans curseurs.
      for (let i = 0; i < SLOTS; i++) {
        surface.drawSprite(this.sprites, this.list[this.secretPicks[i]] + ANSWER_EXACT, SLOT_X0 + i * SLOT_DX, GUESS_Y);
      }
      return;
    }
    if (this.animating) {
      if (this.revealShown) this.drawAnswers(surface);
      const y = SPARK_Y0 - (this.attempts - 1) * ROW_HEIGHT;
      for (let i = 0; i < SLOTS; i++) if (this.pegShown[i]) surface.drawFrame(this.sparks, this.pegShown[i]!, SPARK_X[i], y);
      if (this.sparkShown) for (const x of SPARK_X) surface.drawFrame(this.sparks, this.sparkShown, x, y);
    }
    for (let i = 0; i < SLOTS; i++) surface.drawSprite(this.sprites, this.list[this.guessPicks[i]], SLOT_X0 + i * SLOT_DX, GUESS_Y);
    drawFrame(surface, this.column * SLOT_DX + SLOT_X0, 0xa0, this.column * SLOT_DX + 0xa5, 0xb1, CURSOR_COLOR);
    drawFrame(surface, LIST_X, this.cursor * ROW_HEIGHT + 0x10, 0x47, this.cursor * ROW_HEIGHT + 0x21, CURSOR_COLOR);
  }
}

/** Ligne du bas de la rangée de réponses du `n`-ième essai (1 à 6). */
function answerY(attempt: number): number {
  return ANSWER_Y0 - (attempt - 1) * ROW_HEIGHT;
}

export const createMagicFormula: MinigameFactory = (game, onDone) => new MagicFormulaScene(game, onDone);
