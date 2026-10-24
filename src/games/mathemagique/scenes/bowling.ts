/**
 * Bowling for Numbers (scène 1, `BOWLING.DAT` + `GUS.DAT` + `POLLY.DAT`) : six opérations, quatre niveaux et un bonus, dix bonnes réponses
 * = un strike, dix strikes = un niveau. Règles pures : `game/bowling/` ; comportement d'origine : `docs/mathemagique/screens/bowling.md`.
 *
 * Aucun `await` dans un tick : les attentes bloquantes de l'original (animation de quilles, fanfare, bannière, réaction de Gus, 90 ticks
 * après une erreur) sont des étapes d'une petite file (`Step`), pendant laquelle les gadgets sont inactifs et le test de temps suspendu.
 * Dessin : `base` = décor fixe (fond, Gus, étiquette, boutons de niveau) ; `canvas` = `base` + éléments vivants (nom, rang, pions,
 * question, réponses, barre, œil) ; `screen` reçoit des rectangles de `canvas` (les animations de quilles ne sont jamais écrasées).
 */
import { TAG_SHAP } from "../data/mohawk";
import { drawShape } from "../engine/graphics/blit";
import { parseFon } from "../engine/graphics/fon";
import type { PaletteCycler } from "../engine/graphics/palette";
import { Surface, type Rect } from "../engine/graphics/surface";
import { HotspotTable, rectFromEdges, type GadgetGroup, type GadgetSpec } from "../engine/gadgets";
import type { KeyEvent } from "../engine/input";
import { NoRepeatPool } from "../engine/rng";
import type { Archive } from "../engine/resources";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import { SCR_FLAG, type AnimationHandle } from "../engine/scr-player";
import type { MathServices } from "../engine/services";
import type { SoundHandle } from "../engine/sound";
import {
  BOWLING_POLY,
  POLY_ZONE,
} from "../game/poly-config";
import { PolyHelper, createScrPolyPorts, openPolyArchive, rosterIntroFlag } from "../game/poly";
import {
  BowlingProgress,
  EstimationTables,
  GameTimer,
  GUS_CHEERS,
  QuestionPicker,
  STRIKE_WITHOUT_EPILOGUE,
  backgroundMusicId,
  gusTimeUpReaction,
  loadBowlingData,
  pickPinSet,
  pinAnimationId,
  strikeScriptId,
  type BowlingData,
  type BowlingQuestion,
  type StrikeResult,
} from "../game/bowling";
import { MonitorOverlay, loadMonitorFont, type MonitorResult, type TextInputPort } from "./monitor";
import {
  ANSWER_BOXES,
  CREAM,
  EXIT_RECT,
  EYE_AT,
  GO_RECT,
  GUS_ZONE,
  HELP_RECT,
  HELP_ZONES,
  LABEL_AT,
  LEVEL_SHAPES,
  LIGHTS_PALETTE,
  NAME_RECT,
  OPERATION_EDGES,
  OPERATION_SHAPE_AT,
  SHAP,
  SHPL_BACKGROUND,
  SHPL_GUS,
  SHPL_LIGHTS,
  SHPL_PIZZAS,
  TIME_BAR,
  TROPHY_RECT,
  TUNNEL,
  BAR_HALF,
  WINDOW_REDRAW,
  copyRect,
  drawChoice,
  drawEmptyChoices,
  drawName,
  drawPegs,
  drawPrompt,
  drawRank,
  drawTimeBar,
  type ViewFonts,
} from "./bowling-view";

// --- Ressources et constantes (bowling.md §3 à §6) ---

const ARCHIVE = "BOWLING.DAT";
const GUS_ARCHIVE = "GUS.DAT";
const MONITOR_ARCHIVE = "MAINSCRN.DAT";
const HUB_PALETTE_SHPL = 100;
const HUB_PALETTE_FIRST = 10;
const HUB_PALETTE_COUNT = 199;
/** Palette de l'écran : `SHPL 101` couvre les entrées 10 à 245. */
const MAIN_PALETTE_FIRST = 10;
const MAIN_PALETTE_COUNT = 236;

const SOUND = {
  wrong: 1000,
  operation: 1001,
  go: 1007,
  help: 1008,
  level: 1009,
  bonus: 1010,
  afterStrike: 1011,
  fanfare: 1020,
  banner: 1021,
  timeUp: 1022,
} as const;

const FADE_TICKS = 30;
/** Attente après une mauvaise réponse (`1088:10d2(0x5a)`). */
const WRONG_WAIT_TICKS = 90;
/** Garde-fou d'une attente de son (fanfare 5,5 s ≈ 325 ticks, bannière 7,3 s ≈ 430 ticks). */
const SOUND_WAIT_MAX_TICKS = 600;
const LIGHTS_PERIOD = 8;
const GUS_PRELUDE = 18000;
const GUS_EPILOGUE = 18050;
const GUS_CLICK_REACTIONS = [4, 10, 20] as const;
const GUS_SECRET_REACTION = 15;
const EXIT_REACTIONS = 15;
const EYE_OPEN = 2;
const EYE_BLINK_TICKS = 7;

const HELP_KEYS: readonly string[] = [POLY_ZONE, ...Array.from({ length: 13 }, (_, i) => `subject${i + 1}`)];
const HELP_TABLE = HotspotTable.fromEdges(HELP_ZONES);

/** Clé de zone d'aide au point `(x, y)`, ou `null`. */
export function helpZoneAt(x: number, y: number): string | null {
  const rank = HELP_TABLE.hit(x, y);
  return rank === 0 ? null : HELP_KEYS[rank - 1]!;
}

/** `1010:457a(n)` : `n < 31` → `30000 + 50n` (joie), sinon `24950 + 50(n − 31)` (dépit). */
export function gusReactionId(n: number): number {
  return n < GUS_CHEERS ? 30000 + 50 * n : 24950 + 50 * (n - GUS_CHEERS);
}

/** `1010:44ef(n)` : réaction de départ `22000 + 100n`. */
export function gusExitId(n: number): number {
  return 22000 + 100 * n;
}

export interface BowlingOptions {
  /** Clavier virtuel de la saisie du nom (moniteur de connexion). */
  textInput?: TextInputPort;
}

export function createBowlingScene(services: MathServices, opts: BowlingOptions = {}): Scene {
  return new BowlingScene(services, opts);
}

/** Une étape d'une séquence (équivalent d'une attente bloquante de l'original). */
interface Step {
  start?: () => void;
  done: () => boolean;
  finish?: () => void;
  started?: boolean;
}

type Mode = "idle" | "playing";

export class BowlingScene implements Scene {
  private ctx!: SceneContext;
  private archive!: Archive;
  private gus!: Archive;
  private mainscrn: Archive | null = null;
  private fonts!: ViewFonts;
  private data!: BowlingData;
  private monitor: MonitorOverlay | null = null;
  private poly!: PolyHelper;
  private ops!: GadgetGroup;
  private levels!: GadgetGroup;
  private controls!: GadgetGroup;
  private misc!: GadgetGroup;
  private answers!: GadgetGroup;
  private readonly base = new Surface();
  private readonly canvas = new Surface();

  private progress = BowlingProgress.empty();
  private picker!: QuestionPicker;
  private timer = new GameTimer();
  private mode: Mode = "idle";
  private phase: "entering" | "normal" | "leaving" = "entering";
  private phaseTicks = 0;
  private leaveRequested = false;
  private steps: Step[] = [];
  private question: BowlingQuestion | null = null;
  private highlighted = -1;
  private pinSet = 0;
  private musicId = 2000;
  private lastHalf = 0;
  private eye = EYE_OPEN;
  private eyeAt = 0;
  private gusBusy = false;
  private cycle: PaletteCycler | null = null;
  private rainbow: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private hubPalette: Uint8Array | null = null;
  private openedThisTick = false;
  private opening = false;
  private readonly exitPool = new NoRepeatPool(EXIT_REACTIONS);
  /** Journal des animations lancées (tests et outils). */
  readonly played: number[] = [];
  /** Dernière animation de strike lancée (id `SCR`). */
  lastStrike: StrikeResult | null = null;

  constructor(
    private readonly services: MathServices,
    private readonly opts: BowlingOptions,
  ) {}

  // --- Accès pour les tests et les outils ---

  get progressState(): BowlingProgress {
    return this.progress;
  }
  get currentQuestion(): BowlingQuestion | null {
    return this.question;
  }
  get playing(): boolean {
    return this.mode === "playing";
  }
  get busy(): boolean {
    return this.steps.length > 0;
  }
  get gameTimer(): GameTimer {
    return this.timer;
  }
  get questionPicker(): QuestionPicker {
    return this.picker;
  }
  get helper(): PolyHelper {
    return this.poly;
  }
  get monitorOverlay(): MonitorOverlay | null {
    return this.monitor;
  }
  get ready(): boolean {
    return this.phase === "normal";
  }
  get pinSetIndex(): number {
    return this.pinSet;
  }
  get timeBarHalf(): number {
    return this.lastHalf;
  }

  // --- Cycle de vie ---

  async load(ctx: SceneContext): Promise<void> {
    const [bowling, , , mainscrn, small, medium, large] = await Promise.all([
      ctx.resources.open(ARCHIVE),
      ctx.resources.open(GUS_ARCHIVE),
      openPolyArchive(ctx.resources, BOWLING_POLY),
      ctx.resources.open(MONITOR_ARCHIVE).catch(() => null),
      loadMonitorFont(ctx.host),
      ctx.host.loadFile("NCSCLB12.FON").then((bytes) => parseFon(bytes)[0]!),
      ctx.host.loadFile("NCSCLB14.FON").then((bytes) => parseFon(bytes)[0]!),
    ]);
    this.mainscrn = mainscrn;
    this.data = loadBowlingData(bowling.mohawk);
    this.fonts = { small, medium, large };
  }

  enter(ctx: SceneContext): void {
    this.ctx = ctx;
    this.archive = ctx.resources.require(ARCHIVE);
    this.gus = ctx.resources.require(GUS_ARCHIVE);
    const { graphics, gadgets, pointer, scr } = this.services;
    this.services.useArchive(this.archive);
    this.picker = new QuestionPicker(EstimationTables.build(this.data));
    this.mode = "idle";
    this.phase = "entering";
    this.phaseTicks = 0;
    this.leaveRequested = false;
    this.steps = [];
    this.question = null;
    this.highlighted = -1;
    this.gusBusy = false;
    this.cycle = null;
    this.hubPalette = null;
    this.openedThisTick = false;
    this.opening = false;
    this.lastHalf = 0;
    this.eye = EYE_OPEN;
    this.eyeAt = ctx.clock.ticks + 120 + ctx.rng.rand(180);

    const { palette, screen } = graphics;
    for (const shpl of [SHPL_BACKGROUND, SHPL_GUS, SHPL_LIGHTS, SHPL_PIZZAS]) palette.loadShpl(this.archive.shpl(shpl));
    this.rainbow = palette.snapshot(LIGHTS_PALETTE.first, LIGHTS_PALETTE.count);
    this.buildBase();
    this.bind();
    this.pinSet = pickPinSet(ctx.rng);
    this.chooseMusic();
    this.createGroups();
    this.syncMarks();
    gadgets.captureBackground(this.base);

    this.monitor = this.mainscrn
      ? new MonitorOverlay({
          ctx,
          services: this.services,
          archive: this.mainscrn,
          font: this.fonts.small,
          textInput: this.opts.textInput,
          sceneGroups: () => [this.ops, this.levels, this.controls, this.misc, this.answers],
        })
      : null;

    this.poly = new PolyHelper(BOWLING_POLY, {
      ports: createScrPolyPorts({
        config: BOWLING_POLY,
        scr,
        archive: ctx.resources.require(BOWLING_POLY.archive),
        surface: screen,
        cursor: pointer.cursor,
        onDirty: () => ctx.requestPresent(),
      }),
      rng: ctx.rng,
      introFlag: rosterIntroFlag(ctx.roster, BOWLING_POLY.introFlag),
      onClosed: () => {
        this.syncGroups();
        this.repaintAll();
      },
    });

    pointer.cursor.setBase("arrow");
    this.composeAll();
    screen.copyFrom(this.canvas);
    palette.fadeFromBlack(FADE_TICKS);
    this.syncGroups();
    ctx.requestPresent();
  }

  leave(): void {
    this.monitor?.dispose();
    this.monitor = null;
    this.poly.abort();
    this.cycle?.stop(true);
    this.cycle = null;
    this.restoreHubPalette();
    this.persist();
    this.services.endScene();
  }

  exit(): void {
    this.startLeave();
  }

  tick(ctx: SceneContext): void {
    this.ctx = ctx;
    if (this.phase === "entering") {
      if (++this.phaseTicks >= FADE_TICKS) {
        this.phase = "normal";
        this.syncGroups();
      }
      return;
    }
    if (this.phase === "leaving") {
      this.tickSteps();
      if (this.steps.length === 0 && !this.leaveRequested && ++this.phaseTicks >= FADE_TICKS) {
        this.leaveRequested = true;
        ctx.scenes.request(SceneId.hub);
      }
      return;
    }
    if (!this.monitorOpen) {
      this.tickSteps();
      this.tickHelp();
      if (this.steps.length === 0 && !this.poly.active) {
        this.tickTimer();
        this.tickEye();
      }
    }
    this.syncGroups();
    this.openedThisTick = false;
    this.monitor?.tick();
  }

  key(event: KeyEvent): boolean {
    if (this.monitor?.isOpen) return this.monitor.key(event);
    // Touches 1 à 4 : seulement pendant une partie, hors animation (bowling.md §6).
    if (this.mode !== "playing" || this.phase !== "normal" || this.busy || this.poly.active) return false;
    if (event.ctrl || event.alt || !/^[1-4]$/.test(event.key)) return false;
    this.answer(Number(event.key) - 1);
    return true;
  }

  // --- Sauvegarde ---

  private bind(): void {
    const { roster, currentPlayerId: id } = this.ctx.roster;
    this.progress = id === 0 ? BowlingProgress.empty() : BowlingProgress.load(roster, id);
    this.timer = GameTimer.fromRoster(roster);
  }

  private persist(): void {
    const { roster, currentPlayerId: id } = this.ctx.roster;
    if (id === 0) return;
    this.progress.save(roster, id);
    this.ctx.roster.save();
  }

  // --- Décor ---

  private shape(id: number) {
    if (!this.archive.has(TAG_SHAP, id)) throw new Error(`${ARCHIVE} : forme ${id} absente`);
    return this.archive.shap(id);
  }

  private buildBase(): void {
    this.base.pixels.set(this.shape(SHAP.background).pixels);
    drawShape(this.base, this.shape(SHAP.gus), GUS_ZONE.x, GUS_ZONE.y, 8);
    drawShape(this.base, this.shape(SHAP.label), LABEL_AT.x, LABEL_AT.y, 8);
    for (let k = 0; k < 4; k++) drawShape(this.base, this.shape(SHAP.level + 2 * k), LEVEL_SHAPES[k]!.normal[0], LEVEL_SHAPES[k]!.normal[1], 8);
    drawShape(this.base, this.shape(SHAP.bonus), LEVEL_SHAPES[4]!.normal[0], LEVEL_SHAPES[4]!.normal[1], 8);
  }

  /** Recompose `canvas` : décor, nom, rang, pions, barre, cases, question en cours, œil. */
  private composeAll(): void {
    const c = this.canvas;
    c.copyFrom(this.base);
    const player = this.ctx.roster.currentPlayer;
    if (player) drawName(c, this.base, this.fonts.small, player.name);
    drawRank(c, this.base, this.fonts.small, this.data.ranks[this.progress.rank - 1] ?? "");
    drawPegs(c, this.base, this.archive, this.progress.currentStrikes);
    drawTimeBar(c, this.archive, this.lastHalf);
    if (this.question) this.drawQuestion();
    else drawEmptyChoices(c, this.archive);
    this.drawEye();
  }

  private drawEye(): void {
    drawShape(this.canvas, this.shape(SHAP.eyes + this.eye - 1), EYE_AT.x, EYE_AT.y, 0);
  }

  private drawQuestion(): void {
    const q = this.question!;
    drawPrompt(this.canvas, this.base, this.archive, this.fonts, q);
    for (let slot = 0; slot < 4; slot++) drawChoice(this.canvas, this.archive, this.fonts, q, slot, this.highlighted === slot);
  }

  private blit(...rects: Rect[]): void {
    for (const rect of rects) copyRect(this.services.graphics.screen, this.canvas, rect);
    this.ctx.requestPresent();
  }

  private readonly windowArea: Rect = { x: 138, y: 71, w: 292, h: 125 };

  /** Écran entier depuis `canvas`, puis gadgets (après une animation plein écran, l'aide ou le moniteur). */
  private repaintAll(): void {
    const { graphics, gadgets, scr } = this.services;
    graphics.screen.copyFrom(this.canvas);
    gadgets.invalidate();
    gadgets.draw(graphics.screen);
    scr.redraw();
    this.ctx.requestPresent();
  }

  // --- Groupes de gadgets ---

  private createGroups(): void {
    const { gadgets } = this.services;
    this.ops = gadgets.addGroup({
      id: "operations",
      exclusive: true,
      records: OPERATION_EDGES.map(
        (edges, i): GadgetSpec => ({
          rect: rectFromEdges(...edges),
          shapes: { selected: SHAP.operation + 2 * i + 1 },
          shapeX: OPERATION_SHAPE_AT[i]![0],
          shapeY: OPERATION_SHAPE_AT[i]![1],
          pressSound: SOUND.operation + i,
        }),
      ),
      onActivate: (index) => this.onOperation(index - 1),
    });
    this.answers = gadgets.addGroup({
      id: "answers",
      active: false,
      records: ANSWER_BOXES.map((rect): GadgetSpec => ({ rect, focusable: false })),
      onActivate: (index) => this.answer(index - 1),
    });
    this.controls = gadgets.addGroup({
      id: "controls",
      records: [
        { rect: GO_RECT, shapes: { hover: SHAP.go + 1, pressed: SHAP.go + 1 }, blinkPeriod: 20, pressSound: SOUND.go },
        { rect: GO_RECT, hidden: true, shapes: { normal: SHAP.go + 2, hover: SHAP.go + 2, pressed: SHAP.go + 3 } },
        { rect: HELP_RECT, shapes: { normal: SHAP.help, hover: SHAP.help + 1, pressed: SHAP.help + 1 }, pressSound: SOUND.help },
        { rect: EXIT_RECT, shapes: { normal: SHAP.exit, hover: SHAP.exit + 1, pressed: SHAP.exit + 1 } },
      ],
      onActivate: (index) => this.onControl(index),
    });
    this.levels = gadgets.addGroup({
      id: "levels",
      exclusive: true,
      records: LEVEL_SHAPES.map(
        (def, k): GadgetSpec => ({
          rect: rectFromEdges(...def.edges),
          shapes: { selected: SHAP.level + 2 * k + 1 },
          shapeX: def.active[0],
          shapeY: def.active[1],
          pressSound: k === 4 ? SOUND.bonus : SOUND.level,
        }),
      ),
      onActivate: (index) => this.onLevel(index - 1),
    });
    this.misc = gadgets.addGroup({
      id: "misc",
      records: [NAME_RECT, TROPHY_RECT, GUS_ZONE].map((rect): GadgetSpec => ({ rect, focusable: false })),
      onActivate: (index) => this.onMisc(index),
    });
  }

  private get monitorOpen(): boolean {
    return this.monitor?.isOpen === true;
  }

  private syncGroups(): void {
    if (this.monitorOpen) return;
    const free = this.phase === "normal" && !this.busy && !this.poly.active && !this.opening;
    const idle = free && this.mode === "idle";
    this.ops.active = idle;
    this.levels.active = idle;
    this.misc.active = idle;
    this.controls.active = free;
    this.answers.active = free && this.mode === "playing";
    this.controls.record(1).hidden = this.mode === "playing";
    this.controls.record(1).blinkPeriod = idle ? 20 : 0;
    this.controls.record(2).hidden = this.mode !== "playing";
    this.misc.record(1).disabled = this.monitor === null;
  }

  private syncMarks(): void {
    this.ops.records.forEach((record, i) => (record.selected = i === this.progress.operation));
    this.levels.records.forEach((record, k) => (record.selected = k === this.progress.level));
    this.levels.record(5).disabled = !this.progress.bonusUnlocked(this.progress.operation);
  }

  // --- Séquences ---

  private run(...steps: Step[]): void {
    this.steps.push(...steps);
  }

  private tickSteps(): void {
    while (this.steps.length > 0) {
      const step = this.steps[0]!;
      if (!step.started) {
        step.started = true;
        step.start?.();
      }
      if (!step.done()) return;
      this.steps.shift();
      step.finish?.();
    }
  }

  private call(fn: () => void): Step {
    return { start: fn, done: () => true };
  }

  private waitTicks(ticks: number, skippable = false): Step {
    let left = ticks;
    return {
      done: () => {
        if (skippable && this.ctx.input.buttonEvents.some((e) => e.down)) return true;
        return --left < 0;
      },
    };
  }

  /** Joue un `SCR` en mode bloquant (gadgets et pointeur gelés ; un clic l'interrompt si `interruptible`). */
  private play(archive: Archive, id: number, flags: number, voice = false, interruptible = true): Step {
    let handle: AnimationHandle | null = null;
    return {
      start: () => {
        this.played.push(id);
        handle = this.services.scr.start(archive, id, {
          flags: flags | (interruptible ? SCR_FLAG.interruptible : 0),
          blocking: true,
          soundChannel: voice ? "voice" : "effect",
        });
      },
      done: () => handle === null || handle.done,
    };
  }

  /** Joue un son et attend sa fin (plafonné). */
  private playAndWait(id: number): Step {
    let handle: SoundHandle | null = null;
    let ticks = 0;
    return {
      start: () => (handle = this.services.sound.playSound(this.archive, id)),
      done: () => handle === null || !this.services.sound.isPlaying(handle) || ++ticks > SOUND_WAIT_MAX_TICKS,
    };
  }

  private gusReaction(id: number): Step[] {
    return [
      this.call(() => {
        this.gusBusy = true;
        this.services.pointer.cancel();
      }),
      this.play(this.gus, id, SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground | SCR_FLAG.waitSounds, true),
      this.call(() => {
        this.gusBusy = false;
        this.blit(GUS_ZONE);
        this.eyeAt = this.ctx.clock.ticks + 120 + this.ctx.rng.rand(180);
      }),
    ];
  }

  // --- Sélection ---

  private chooseMusic(): void {
    this.musicId = backgroundMusicId(this.progress.level, this.ctx.rng);
  }

  private refreshSelection(): void {
    this.picker.reset();
    this.chooseMusic();
    this.syncMarks();
    drawPegs(this.canvas, this.base, this.archive, this.progress.currentStrikes);
    this.blit(...this.pegRects());
  }

  private pegRects(): Rect[] {
    return [{ x: 114, y: 33, w: 344, h: 38 }];
  }

  private onOperation(op: number): void {
    this.progress.selectOperation(op);
    this.refreshSelection();
  }

  private onLevel(level: number): void {
    if (!this.progress.selectLevel(level)) {
      this.syncMarks();
      return;
    }
    this.refreshSelection();
  }

  // --- Boutons ---

  private onControl(index: number): void {
    if (index === 1) this.startGame();
    else if (index === 2) this.stopGame(true);
    else if (index === 3) this.openHelp();
    else this.startExit();
  }

  private onMisc(index: number): void {
    if (index === 1) this.openName();
    else if (index === 2) {
      this.persist();
      this.ctx.scenes.request(SceneId.trophy);
    } else {
      const input = this.ctx.input;
      const n = input.ctrl && input.shift ? GUS_SECRET_REACTION : GUS_CLICK_REACTIONS[this.ctx.rng.rand1(GUS_CLICK_REACTIONS.length)]!;
      this.run(...this.gusReaction(gusReactionId(n)));
    }
  }

  // --- Partie ---

  private startGame(): void {
    const { sound } = this.services;
    this.progress.startRound();
    this.mode = "playing";
    this.lastHalf = 0;
    this.timer.start(this.ctx.clock.ticks);
    drawTimeBar(this.canvas, this.archive, 0);
    this.blit(TIME_BAR);
    this.syncGroups();
    this.nextQuestion();
    sound.playSound(this.archive, this.musicId, { loop: true, ambient: true });
  }

  /** `1010:3d9d` : arrête la partie, rend la barre pleine, vide la fenêtre et remet les cases au repos. */
  private stopGame(clearTunnel: boolean): void {
    if (this.mode !== "playing") return;
    this.mode = "idle";
    this.timer.stop();
    this.services.sound.stopMusic();
    this.question = null;
    this.highlighted = -1;
    this.lastHalf = 0;
    for (const rect of WINDOW_REDRAW) copyRect(this.canvas, this.base, rect);
    drawEmptyChoices(this.canvas, this.archive);
    drawTimeBar(this.canvas, this.archive, 0);
    this.blit(this.windowArea, TIME_BAR);
    if (clearTunnel) this.blit(TUNNEL);
    this.syncGroups();
  }

  private nextQuestion(): void {
    this.question = this.picker.next({ operation: this.progress.operation, level: this.progress.level, subType: this.progress.subType }, this.ctx.rng);
    this.highlighted = -1;
    this.drawQuestion();
    this.blit(this.windowArea);
  }

  private highlight(slot: number): void {
    this.highlighted = slot;
    for (let s = 0; s < 4; s++) drawChoice(this.canvas, this.archive, this.fonts, this.question!, s, s === slot);
    this.blit(this.windowArea);
  }

  /** Réponse (clic ou touche) à la case `slot` (0 à 3). */
  private answer(slot: number): void {
    const q = this.question;
    if (this.mode !== "playing" || this.busy || !q) return;
    this.timer.suspended = true;
    const correct = slot === q.correctSlot;
    this.picker.answered(correct, slot);
    this.highlight(q.correctSlot);
    if (correct) {
      const n = this.progress.roundCorrect;
      this.run(
        this.play(this.archive, pinAnimationId(this.pinSet, n), 0, false, false),
        this.call(() => {
          if (this.progress.correctAnswer()) this.beginStrike();
          else {
            this.nextQuestion();
            this.timer.suspended = false;
          }
        }),
      );
    } else {
      this.run(
        this.call(() => void this.services.sound.playSound(this.archive, SOUND.wrong)),
        this.waitTicks(WRONG_WAIT_TICKS, true),
        this.call(() => {
          this.nextQuestion();
          this.timer.suspended = false;
        }),
      );
    }
    this.syncGroups();
  }

  private tickTimer(): void {
    if (this.mode !== "playing") return;
    const now = this.ctx.clock.ticks;
    const half = Math.min(this.timer.barHalfWidth(now), BAR_HALF);
    if (half !== this.lastHalf) {
      this.lastHalf = half;
      drawTimeBar(this.canvas, this.archive, half);
      this.blit(TIME_BAR);
    }
    if (this.timer.expired(now)) this.timeUp();
  }

  /** `1010:2a83` : temps écoulé, son, Gus déçu, nouveau jeu de quilles. */
  private timeUp(): void {
    this.stopGame(true);
    this.run(
      this.playAndWait(SOUND.timeUp),
      ...this.gusReaction(gusReactionId(gusTimeUpReaction(this.ctx.rng))),
      this.call(() => {
        this.pinSet = pickPinSet(this.ctx.rng);
        this.syncMarks();
      }),
    );
    this.syncGroups();
  }

  // --- Strike ---

  private beginStrike(): void {
    const { graphics, sound } = this.services;
    const { palette } = graphics;
    this.stopGame(false);
    const result = this.progress.strike(this.ctx.rng);
    this.lastStrike = result;
    const scrId = strikeScriptId(result.animation);
    const saved = palette.snapshot(MAIN_PALETTE_FIRST, MAIN_PALETTE_COUNT);
    const cream = this.creamPalette();
    this.run(
      this.call(() => {
        this.gusBusy = true;
        palette.loadShpl(this.archive.shpl(scrId));
      }),
      ...this.lightsSteps(SOUND.fanfare, [{ shape: 1, x: 128, y: 62 }], cream),
      this.play(this.archive, GUS_PRELUDE, SCR_FLAG.waitSounds, true),
      this.play(this.archive, scrId, SCR_FLAG.waitSounds, false),
      ...(scrId === STRIKE_WITHOUT_EPILOGUE ? [] : [this.play(this.archive, GUS_EPILOGUE, 0)]),
      this.call(() => {
        palette.restore(saved, MAIN_PALETTE_FIRST);
        this.gusBusy = false;
        void sound.playSound(this.archive, SOUND.afterStrike);
        drawPegs(this.canvas, this.base, this.archive, result.strikes);
        this.repaintAll();
      }),
      ...(result.levelCompleted ? this.completionSteps() : []),
      ...(result.levelCompleted || result.gusCheer !== null
        ? this.gusReaction(gusReactionId(result.gusCheer ?? this.ctx.rng.rand1(GUS_CHEERS)))
        : []),
      this.call(() => {
        this.pinSet = pickPinSet(this.ctx.rng);
        this.timer.suspended = false;
        this.syncMarks();
        this.persist();
      }),
    );
    this.syncGroups();
  }

  /** Niveau terminé (`1010:29b1`, `4140`) : file de reprise vidée, rang et pions du nouveau niveau, bannière « LEVEL n » / « BONUS ROUND ». */
  private completionSteps(): Step[] {
    const cream = this.creamPalette();
    return [
      this.call(() => {
        this.picker.reset();
        this.chooseMusic();
        this.syncMarks();
        this.composeAll();
        this.repaintAll();
        this.persist();
      }),
      ...this.lightsSteps(
        SOUND.banner,
        [
          { shape: 1, x: 128, y: 62 },
          { shape: 3, x: 420, y: 66 },
          { shape: 5, x: 38, y: 66 },
        ],
        cream,
      ),
    ];
  }

  private creamPalette(): Uint8Array {
    const { palette } = this.services.graphics;
    const out = new Uint8Array(LIGHTS_PALETTE.count * 3);
    const color = palette.colors.slice(CREAM * 3, CREAM * 3 + 3);
    for (let i = 0; i < LIGHTS_PALETTE.count; i++) out.set(color, i * 3);
    return out;
  }

  /** Fanfare ou bannière (`1010:42a2`) : lumières peintes en crème puis colorées et tournées toutes les 8 ticks pendant que le son joue. */
  private lightsSteps(soundId: number, overlays: { shape: number; x: number; y: number }[], cream: Uint8Array): Step[] {
    const { palette, screen } = this.services.graphics;
    let handle: SoundHandle | null = null;
    let ticks = 0;
    return [
      {
        start: () => {
          palette.restore(cream, LIGHTS_PALETTE.first);
          for (const o of overlays) drawShape(screen, this.shape(SHPL_LIGHTS + o.shape - 1), o.x, o.y, 8);
          this.ctx.requestPresent();
          palette.restore(this.rainbow, LIGHTS_PALETTE.first);
          this.cycle = palette.startCycle({ first: LIGHTS_PALETTE.first, count: LIGHTS_PALETTE.count, period: LIGHTS_PERIOD });
          handle = this.services.sound.playSound(this.archive, soundId);
        },
        done: () => handle === null || !this.services.sound.isPlaying(handle) || ++ticks > SOUND_WAIT_MAX_TICKS,
        finish: () => {
          this.cycle?.stop(false);
          this.cycle = null;
          palette.restore(this.rainbow, LIGHTS_PALETTE.first);
          for (const o of overlays) {
            const s = this.shape(SHPL_LIGHTS + o.shape - 1);
            this.blit({ x: o.x, y: o.y, w: s.width, h: s.height });
          }
        },
      },
    ];
  }

  // --- Sortie ---

  private startExit(): void {
    if (this.phase === "leaving") return;
    this.stopGame(true);
    this.persist();
    this.phase = "leaving";
    this.phaseTicks = 0;
    this.syncGroups();
    this.run(
      ...this.gusReaction(gusExitId(this.exitPool.pick(this.ctx.rng))),
      this.call(() => {
        this.services.sound.stopAll();
        this.services.graphics.palette.fadeToBlack(FADE_TICKS);
      }),
    );
  }

  private startLeave(): void {
    if (this.phase === "leaving") return;
    this.monitor?.dispose();
    this.restoreHubPalette();
    this.poly.abort();
    this.mode = "idle";
    this.persist();
    this.steps = [];
    const { scr, sound, graphics } = this.services;
    scr.stopAll();
    sound.stopAll();
    sound.stopMusic();
    graphics.palette.fadeToBlack(FADE_TICKS);
    this.phase = "leaving";
    this.phaseTicks = 0;
    this.syncGroups();
  }

  // --- Yeux de Gus ---

  private tickEye(): void {
    if (this.gusBusy || this.ctx.clock.ticks < this.eyeAt) return;
    this.eye ^= 3;
    this.eyeAt = this.ctx.clock.ticks + (this.eye === 1 ? EYE_BLINK_TICKS : 120 + this.ctx.rng.rand(180));
    this.drawEye();
    this.blit({ x: EYE_AT.x, y: EYE_AT.y, w: 25, h: 20 });
  }

  // --- Nom (moniteur de connexion) ---

  private openName(): void {
    const monitor = this.monitor;
    if (!monitor || monitor.isOpen || !this.mainscrn) return;
    this.persist();
    const { palette } = this.services.graphics;
    this.hubPalette = palette.snapshot(HUB_PALETTE_FIRST, HUB_PALETTE_COUNT);
    palette.loadShpl(this.mainscrn.shpl(HUB_PALETTE_SHPL));
    monitor.open("signin", (result) => this.onMonitorClosed(result));
  }

  private restoreHubPalette(): void {
    if (!this.hubPalette) return;
    this.services.graphics.palette.restore(this.hubPalette, HUB_PALETTE_FIRST);
    this.hubPalette = null;
  }

  private onMonitorClosed(result: MonitorResult): void {
    this.restoreHubPalette();
    this.bind();
    this.picker.reset();
    this.chooseMusic();
    this.syncMarks();
    this.syncGroups();
    this.composeAll();
    this.repaintAll();
    if (result.ambientChanged && !this.ctx.roster.roster.ambient) this.services.sound.stopAmbient();
  }

  // --- Aide de Polly ---

  private openHelp(): void {
    if (this.poly.active || this.opening) return;
    const { gadgets, graphics, pointer, sound } = this.services;
    this.stopGame(true);
    pointer.cancel();
    sound.stopMusic();
    this.opening = true;
    this.syncGroups();
    gadgets.updatePointer(-1, -1);
    gadgets.draw(graphics.screen);
    this.poly.open();
    this.opening = false;
    this.openedThisTick = true;
    this.syncGroups();
    this.ctx.requestPresent();
  }

  private tickHelp(): void {
    if (!this.poly.active) {
        return;
    }
    const { scr } = this.services;
    if (!scr.blockedThisTick && !this.openedThisTick) {
      const input = this.ctx.input;
      for (const event of input.buttonEvents) if (event.down) this.poly.click(helpZoneAt(event.x, event.y) ?? "none", {});
      if (this.poly.phase === "listening") this.poly.hover(helpZoneAt(input.mouseX, input.mouseY));
    }
    this.poly.tick();
  }
}
