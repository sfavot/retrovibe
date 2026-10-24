/**
 * Scène Rockets (scène 7, `NIM.DAT`) : jeu de Nim contre Poly ou contre un ami (screens/rockets.md).
 *
 * Machine à états sans `await` : tout ce qui bloque dans l'original (vols de fusées, voix de Poly, fondus) est une **file d'actions** jouée en
 * mode bloquant par le lecteur de scripts (`SCR_PLAYER`), pendant laquelle les clics sont ignorés (`busy`). Les règles et les tirages sont dans
 * `rockets-logic.ts` (pur, testé à graine fixe) ; l'aide « ? » est `PolyHelper` (`game/poly.ts`, configuration `ROCKETS_POLY`).
 *
 * Dessin : la scène compose elle-même son écran (`paint`) : fond, panneau de M, pavé, fusées, boutons, Poly, du dessous au dessus, dans un rectangle
 * donné. Les animations de Poly sont jouées sur le fond **sans** Poly statique (chaque script dessine tout le personnage) et la pose neutre est
 * redessinée quand un script est interrompu. Un vol saute l'emplacement qui part ; les fusées d'indice supérieur et Poly sont redessinées par-dessus à
 * chaque tick (le hook 0 de l'original).
 *
 * Copy : aucune (tout est voix ou dessin).
 */
import { TAG_SND } from "../data/mohawk";
import { POLY_ZONE, ROCKETS_POLY } from "../game/poly-config";
import { PolyHelper, rosterIntroFlag, type PolyAnimation, type PolyPorts } from "../game/poly";
import { drawShape } from "../engine/graphics/blit";
import type { Rect } from "../engine/graphics/surface";
import { HotspotTable, rectFromEdges, type GadgetGroup, type GadgetSpec } from "../engine/gadgets";
import type { Resources } from "../engine/resources";
import { SCR_FLAG, type AnimationHandle } from "../engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";
import {
  DEFAULT_RULES,
  LAUNCH_SOUNDS,
  MIN_TOTAL,
  PAD_RANDOM_CELL,
  RocketsPools,
  SCR_POLY_ENTER,
  SCR_POLY_GREETING,
  SCR_POLY_LEAVE,
  applyGameResult,
  autoTurnPending,
  canChangeMaxTake,
  canLaunch,
  choosePadValue,
  createState,
  drawLaunchSounds,
  endPolyTurn,
  flightClip,
  flightScrId,
  hitTestSlots,
  isFinished,
  isOver,
  launch,
  layoutScrId,
  maxTakeForPoly,
  newGame,
  nextMaxTake,
  nextRandomTotal,
  padCellOfTotal,
  padCellOrigin,
  parseLayout,
  planAnnounceMaxTake,
  planAnnounceTake,
  planChildWins,
  planEnter,
  planFarewell,
  planGameOver,
  planGoodbye,
  planPolyWins,
  planPrompt,
  planReminder,
  polyChooseTake,
  polyClickKind,
  polyPickSlot,
  remaining,
  rocketMaskId,
  rocketShapeId,
  type LayoutCell,
  type RocketsRules,
  type RocketsState,
  type ScriptStep,
  type Winner,
} from "./rockets-logic";

const ARCHIVE = "NIM.DAT";

// --- Mise en page (§2.2, §2.3) ---

const SCREEN: Rect = { x: 0, y: 0, w: 576, h: 432 };
/** Colonne de Poly (zone de sauvegarde du fond, `DS:7cfa`) : (404, 125) à (576, 432). */
const POLY_COLUMN: Rect = rectFromEdges(404, 125, 576, 432);
const PANEL_RECT: Rect = rectFromEdges(155, 124, 380, 149);
const PAD_AREA: Rect = rectFromEdges(51, 335, 250, 380);

/** `SHAP` de `SHPL` 40000 (id = 40000 + n° − 1). */
const SHAP = {
  background: 40000,
  padLabel: 40001,
  playLabel: 40002,
  filet: 40003,
  padBase: 40016,
  panel: 40017,
  poly: 40027,
  eyesClosed: 40028,
  stop: 40030,
} as const;
/** Chiffre de M (2 à 10) : n° `17 + M`. */
const digitShape = (m: number): number => 40016 + m;
/** Case du pavé enfoncée : cases 0 à 10 = N de 11 à 21, 11 = « ? » (n° `5 + case`). */
const padCellShape = (cell: number): number => 40004 + cell;

const SND = {
  click: 3043,
  help: [3012, 3013] as const,
  random: 3115,
  reset: 3116,
  mode: 3114,
  music: 201,
} as const;
/** Sons préchargés à l'entrée (`1070:0b0d`…) ; 3004, 3006 et 3007 n'existent dans aucune archive. */
const PRELOAD = [SND.click, ...SND.help, SND.random, SND.reset, SND.mode, ...LAUNCH_SOUNDS];

/** Zones d'aide (`DS:290c`, §1.8) : 1 et 2 = Poly, puis clé de `ROCKETS_POLY.topics`. */
const HELP_ZONES = HotspotTable.fromEdges([
  [472, 139, 527, 432],
  [452, 248, 546, 268],
  [264, 357, 318, 380],
  [261, 325, 289, 352],
  [403, 335, 472, 380],
  [333, 335, 402, 380],
  [34, 159, 488, 309],
  [51, 335, 250, 380],
  [294, 326, 323, 351],
  [157, 123, 380, 149],
]);
const HELP_KEYS: readonly (string | null)[] = [null, POLY_ZONE, POLY_ZONE, "reset", "help", "friend", "polyButton", "field", "pad", "exit", "panel"];

/** Position de Poly (forme n° 28), de ses yeux, du panneau stop de l'aide. */
const POLY_POS = { x: 451, y: 139 } as const;
const EYES_POS = { x: 470, y: 160 } as const;
const STOP_POS = { x: 481, y: 254 } as const;

/** Ticks : yeux fermés 6 ticks, prochain clignement dans [120, 300], commentaire sur M 120 ticks après le clic, 15 images de 3 ticks pour le « ? », fondus de 30. */
const BLINK_TICKS = 6;
const BLINK_RANGE: readonly [number, number] = [120, 300];
const COMMENT_DELAY = 120;
const RANDOM_FRAMES = 15;
const RANDOM_FRAME_TICKS = 3;
const FADE_TICKS = 30;

const FLIGHT_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.waitSounds;
const POLY_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.waitSounds;

// --- Actions ---

type Action =
  | { kind: "script"; step: ScriptStep }
  | { kind: "flight"; slot: number; by: Winner }
  | { kind: "call"; run: () => void }
  | { kind: "wait"; until: () => boolean };

interface Running {
  action: Action & { kind: "script" | "flight" };
  handle: AnimationHandle;
  /** Zone de la animation (repère écran), pour la repeindre à la fin. */
  rect: Rect;
}

const rectOfClip = (clip: { left: number; top: number; right: number; bottom: number }): Rect => ({
  x: clip.left,
  y: clip.top,
  w: clip.right - clip.left,
  h: clip.bottom - clip.top,
});

export type RocketsResult = Winner | null;

/** La scène et ce que les tests (et la fenêtre de debug) peuvent observer. */
export interface RocketsScene extends Scene {
  readonly state: RocketsState;
  /** Une animation, une action en file ou un tirage « ? » est en cours : les clics sont ignorés. */
  readonly busy: boolean;
  readonly polyVisible: boolean;
  readonly helpOpen: boolean;
  /** Vainqueur de la dernière partie terminée (`null` : aucune). */
  readonly lastResult: RocketsResult;
  /** Ids des scripts de Poly lancés (hors aide), dans l'ordre. */
  readonly played: readonly number[];
  readonly helper: PolyHelper | null;
}

export interface RocketsOptions {
  /** Règles de compatibilité (`polyStreakResets` : défaut d'origine reproduit). */
  rules?: Partial<RocketsRules>;
}

export function createRocketsScene(services: MathServices, options: RocketsOptions = {}): RocketsScene {
  return new RocketsSceneImpl(services, { ...DEFAULT_RULES, ...options.rules });
}

class RocketsSceneImpl implements RocketsScene {
  private ctx!: SceneContext;
  private archive!: ReturnType<Resources["require"]>;
  private groupA!: GadgetGroup;
  private groupB!: GadgetGroup;
  private groupC!: GadgetGroup;
  private pools = new RocketsPools();
  private launchSounds: number[] = [];
  private _state!: RocketsState;
  private _polyVisible = false;
  private _helpOpen = false;
  private _helper: PolyHelper | null = null;
  private _lastResult: RocketsResult = null;
  private readonly _played: number[] = [];

  private queue: Action[] = [];
  private running: Running | null = null;
  private waiting: (() => boolean) | null = null;
  /** Animations de Poly terminées, à traiter au début du tick (repeindre, visibilité). */
  private readonly ended: AnimationHandle[] = [];
  /** Vol en cours (zone et emplacement) : fusées devant et Poly redessinées à chaque tick. */
  private flight: { slot: number; rect: Rect } | null = null;

  private padHighlight = 0;
  private padRandom: { frames: number; previous: number; until: number; total: number; sound: ReturnType<MathServices["sound"]["playSound"]> } | null = null;
  private stopShown = false;
  private blinkAt: number | null = null;
  private blinkReopenAt: number | null = null;
  private commentAt: number | null = null;
  private leaving = false;
  private wantBusyCursor = false;
  private friendVisual = "";

  constructor(
    private readonly services: MathServices,
    private readonly rules: Readonly<RocketsRules>,
  ) {}

  // --- Observation ---

  get state(): RocketsState {
    return this._state;
  }
  get busy(): boolean {
    return this.leaving || this.running !== null || this.queue.length > 0 || this.waiting !== null || this.padRandom !== null;
  }
  get polyVisible(): boolean {
    return this._polyVisible;
  }
  get helpOpen(): boolean {
    return this._helpOpen;
  }
  get lastResult(): RocketsResult {
    return this._lastResult;
  }
  get played(): readonly number[] {
    return this._played;
  }
  get helper(): PolyHelper | null {
    return this._helper;
  }

  private get screen() {
    return this.services.graphics.screen;
  }

  // --- Cycle de vie ---

  async load(ctx: SceneContext): Promise<void> {
    await ctx.resources.open(ARCHIVE);
  }

  enter(ctx: SceneContext): void {
    this.ctx = ctx;
    this.archive = ctx.resources.require(ARCHIVE);
    const { services, archive } = this;
    const { palette } = services.graphics;
    services.useArchive(archive);
    services.sound.preload(archive, PRELOAD);
    services.sound.stopMusic();
    palette.loadShpl(archive.shpl(SHAP.background));
    palette.loadShpl(archive.shpl(999));

    this._state = createState(this.layoutFor(MIN_TOTAL), ctx.rng);
    this.launchSounds = drawLaunchSounds(this.pools, ctx.rng);
    this.padHighlight = padCellOfTotal(this._state.total);
    this.buildGadgets();
    this._helper = new PolyHelper(ROCKETS_POLY, {
      ports: this.createPolyPorts(),
      rng: ctx.rng,
      introFlag: rosterIntroFlag(ctx.roster, ROCKETS_POLY.introFlag),
      onFirstIntro: () => void ctx.roster.save(),
      onClosed: () => this.closeHelp(),
    });

    // Décor sans Poly ni boutons, puis fond des boutons, puis premier dessin complet.
    this.paint(SCREEN, { poly: false, buttons: false });
    services.gadgets.captureBackground(this.screen);
    this.paint(SCREEN, { poly: false });
    ctx.setCursor("arrow");
    palette.fadeFromBlack(FADE_TICKS);

    // Fondu d'entrée, musique, puis Poly entre, salue et annonce la limite M (`1070:0a37`).
    this.queue.push(
      { kind: "wait", until: () => palette.fade === null },
      { kind: "call", run: () => this.startMusic() },
      ...this.scripts(planEnter()),
      { kind: "call", run: () => this.setPolyVisible(true) },
      ...this.scripts([{ scr: SCR_POLY_GREETING, interruptible: true }]),
      { kind: "call", run: () => this.queueAfter(() => planAnnounceMaxTake(this._state.maxTake, ctx.rng)) },
    );
    ctx.requestPresent();
  }

  leave(): void {
    this._helper?.abort();
    this.queue = [];
    this.waiting = null;
    this.running = null;
    this.flight = null;
    this.padRandom = null;
    this.services.endScene();
  }

  exit(): void {
    if (this.leaving) return;
    this.startLeaving(false);
  }

  tick(ctx: SceneContext): void {
    this.processEnded();
    this._helper?.tick();
    this.updateHelp(ctx);
    this.tickPadRandom(ctx);
    this.runQueue();
    this.tickComment(ctx);
    this.updateBlink(ctx);
    this.keepFriendButtonClean();
    this.drawFront();
    this.updateCursor();
  }

  // --- Disposition et dessin ---

  private layoutFor(total: number): LayoutCell[] {
    return parseLayout(this.archive.scr(layoutScrId(total)), total);
  }

  private shape(id: number) {
    return this.archive.shap(id);
  }

  private draw(id: number, x: number, y: number, mode: 0 | 8 = 8): void {
    drawShape(this.screen, this.shape(id), x, y, mode);
  }

  /**
   * Repeint `rect` du dessous au dessus : fond, panneau de M, étiquettes, pavé, fusées (sauf `skip`), boutons, Poly (pose neutre) et panneau stop.
   * `poly: false` donne le fond nu sous Poly (avant une de ses animations).
   */
  private paint(rect: Rect, options: { poly?: boolean; skip?: number; buttons?: boolean } = {}): void {
    const screen = this.screen;
    screen.pushClip(rect);
    try {
      this.draw(SHAP.background, 0, 0, 0);
      this.draw(SHAP.panel, 155, 124);
      this.draw(digitShape(this._state.maxTake), 267, 124);
      this.draw(SHAP.padLabel, 55, 317);
      this.draw(SHAP.playLabel, 337, 317);
      this.draw(SHAP.filet, 255, 321);
      this.draw(SHAP.filet, 323, 321);
      this.draw(SHAP.padBase, 51, 335, 0);
      const origin = padCellOrigin(this.padHighlight);
      this.draw(padCellShape(this.padHighlight), origin.x, origin.y);
      this.drawRockets(options.skip ?? -1);
      if (options.buttons !== false) this.drawButtons();
      if (options.poly ?? this._polyVisible) this.drawPoly();
    } finally {
      screen.popClip();
    }
    this.ctx.requestPresent();
  }

  private drawRockets(skip: number, from = 0): void {
    const slots = this._state.slots;
    for (let i = from; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.type === null || i === skip) continue;
      this.draw(rocketShapeId(slot.type), slot.x, slot.y);
    }
  }

  private drawButtons(): void {
    const gadgets = this.services.gadgets;
    for (const group of [this.groupA, this.groupB]) {
      for (const record of group.records) {
        const visual = gadgets.visualOf(record);
        if (visual === "hidden") continue;
        const id = gadgets.shapeIdFor(record, visual);
        if (id !== undefined) this.draw(id, record.shapeX, record.shapeY);
      }
    }
  }

  private drawPoly(): void {
    this.draw(SHAP.poly, POLY_POS.x, POLY_POS.y);
    if (this.stopShown) this.draw(SHAP.stop, STOP_POS.x, STOP_POS.y);
  }

  /** Redessine, par-dessus un vol, les fusées d'indice supérieur et Poly (hook 0 de `1070:19e4`). */
  private drawFront(): void {
    const flight = this.flight;
    if (!flight || !this.running) return;
    const screen = this.screen;
    screen.pushClip(flight.rect);
    try {
      this.drawRockets(-1, flight.slot + 1);
      if (this._polyVisible) this.drawPoly();
    } finally {
      screen.popClip();
    }
    this.ctx.requestPresent();
  }

  /** Le bouton « a Friend » déborde sous Poly : quand son aspect change, Poly est redessinée par-dessus. */
  private keepFriendButtonClean(): void {
    if (!this._polyVisible || this.running || this.queue.length > 0) return;
    const record = this.groupB.record(2);
    const visual = this.services.gadgets.visualOf(record);
    if (visual === this.friendVisual) return;
    this.friendVisual = visual;
    this.drawPoly();
    this.ctx.requestPresent();
  }

  private setPolyVisible(visible: boolean): void {
    this._polyVisible = visible;
    // Poly absente : ses zones de clic laissent le champ de fusées à la place (écart : l'original les garde).
    this.groupC.record(1).disabled = !visible || this._helpOpen;
    this.groupC.record(2).disabled = !visible || this._helpOpen;
  }

  // --- Boutons et zones (§2.3) ---

  private buildGadgets(): void {
    const { gadgets } = this.services;
    const rng = this.ctx.rng;
    const button = (l: number, t: number, r: number, b: number, shapes: GadgetSpec["shapes"], pressSound?: GadgetSpec["pressSound"], selected = false): GadgetSpec => ({
      rect: rectFromEdges(l, t, r, b),
      shapes,
      pressSound,
      selected,
    });
    this.groupA = gadgets.addGroup({
      id: "rockets-a",
      records: [
        button(264, 357, 318, 380, { normal: 40100, pressed: 40101 }, SND.reset),
        button(261, 325, 289, 352, { normal: 40102, pressed: 40103 }, () => (rng.range(1, 100) > 50 ? SND.help[0] : SND.help[1])),
        button(294, 326, 323, 351, { normal: 40104, pressed: 40105 }),
      ],
      onActivate: (index) => this.onButtonA(index),
    });
    this.groupB = gadgets.addGroup({
      id: "rockets-b",
      activateOn: "press",
      records: [
        button(333, 335, 403, 380, { normal: 40300, selected: 40301, pressed: 40301 }, SND.mode, true),
        button(403, 335, 472, 380, { normal: 40302, selected: 40303, pressed: 40303 }, SND.mode),
      ],
      onActivate: (index) => (index === 1 ? this.onPolyButton() : this.onFriendButton()),
    });
    const zone = (l: number, t: number, r: number, b: number, disabled = false): GadgetSpec => ({ rect: rectFromEdges(l, t, r, b), disabled, focusable: false });
    this.groupC = gadgets.addGroup({
      id: "rockets-c",
      activateOn: "press",
      records: [
        zone(472, 139, 527, 431, true),
        zone(452, 248, 546, 268, true),
        zone(267, 124, 301, 148),
        zone(34, 159, 488, 309),
        zone(51, 335, 250, 380),
        zone(0, 0, 576, 432, true),
      ],
      onActivate: (index) => this.onZone(index),
    });
  }

  private syncModeButtons(): void {
    this.groupB.record(1).selected = this._state.mode === "poly";
    this.groupB.record(2).selected = this._state.mode === "friend";
  }

  private onButtonA(index: number): void {
    if (this.busy || this._helpOpen) return;
    if (index === 1) this.startGame(this._state.total);
    else if (index === 2) this.openHelp();
    else this.startLeaving(true);
  }

  private onZone(index: number): void {
    if (this.leaving) return;
    if (this._helpOpen) {
      if (index === 6) this.onHelpClick();
      return;
    }
    if (this.busy) return;
    if (index === 1 || index === 2) this.onPolyClick();
    else if (index === 3) this.onMaxTakeClick();
    else if (index === 4) this.onFieldClick();
    else if (index === 5) this.onPadClick();
  }

  // --- Parties ---

  /** Nouvelle partie de `total` fusées (`1070:1171`) : plateau rempli, sons de lancement retirés, écran repeint. */
  private startGame(total: number): void {
    newGame(this._state, total, this.layoutFor(total));
    this.launchSounds = drawLaunchSounds(this.pools, this.ctx.rng);
    this.padHighlight = padCellOfTotal(total);
    this.paint(SCREEN);
  }

  private onPadClick(): void {
    const choice = choosePadValue(this.ctx.input.mouseX, this.ctx.input.mouseY);
    if (!choice) return;
    this.commentAt = null;
    const state = this._state;
    if (choice.kind === "total") {
      // Cliquer le N courant en cours de partie ne fait rien.
      if (choice.total === state.total && !isFinished(state)) return;
      this.playSfx(SND.click);
      this.startGame(choice.total);
      return;
    }
    // « ? » : case enfoncée, attente du relâchement, son 3115, 15 images de 3 ticks (§2.3).
    this.padHighlight = PAD_RANDOM_CELL;
    this.paint(PAD_AREA);
    this.padRandom = { frames: 0, previous: state.total, until: -1, total: state.total, sound: null };
  }

  private tickPadRandom(ctx: SceneContext): void {
    const r = this.padRandom;
    if (!r) return;
    if (r.until < 0) {
      if (ctx.input.isButtonDown("left") || ctx.input.isButtonDown("right") || ctx.input.isButtonDown("middle")) return;
      r.sound = this.playSfx(SND.random);
      r.until = ctx.clock.ticks;
    }
    if (ctx.clock.ticks < r.until) return;
    const n = nextRandomTotal(this._state.total, r.previous, ctx.rng);
    r.previous = n;
    r.total = n;
    this.padHighlight = padCellOfTotal(n);
    this.paint(PAD_AREA);
    r.frames++;
    r.until = ctx.clock.ticks + RANDOM_FRAME_TICKS;
    if (r.frames >= RANDOM_FRAMES) {
      if (r.sound) this.services.sound.stop(r.sound);
      this.padRandom = null;
      this.startGame(n);
    }
  }

  private onMaxTakeClick(): void {
    const state = this._state;
    if (!canChangeMaxTake(state)) return;
    this.playSfx(SND.click);
    state.maxTake = nextMaxTake(state.mode, state.maxTake);
    this.paint(PANEL_RECT);
    // Poly commente la nouvelle limite 2 s plus tard (mode Poly seulement).
    this.commentAt = state.mode === "poly" ? this.ctx.clock.ticks + COMMENT_DELAY : null;
  }

  private tickComment(ctx: SceneContext): void {
    if (this.commentAt === null || ctx.clock.ticks <= this.commentAt || this.busy || this._helpOpen) return;
    this.commentAt = null;
    if (this._polyVisible) this.queue.push(...this.scripts(planAnnounceMaxTake(this._state.maxTake, ctx.rng)));
  }

  private onFieldClick(): void {
    this.commentAt = null;
    const state = this._state;
    if (isFinished(state)) {
      if (this._polyVisible) this.say(planGameOver());
      return;
    }
    if (!canLaunch(state)) return;
    const slot = hitTestSlots(state.slots, this.ctx.input.mouseX, this.ctx.input.mouseY, (type) => this.archive.shap(rocketMaskId(type)));
    if (slot < 0) return;
    this.queue.push({ kind: "flight", slot, by: "child" });
  }

  private onPolyClick(): void {
    if (!this._polyVisible || this._state.mode !== "poly") return;
    this.commentAt = null;
    const kind = polyClickKind(this._state);
    if (kind === "over") this.say(planGameOver());
    else if (kind === "remind") this.say(planReminder(this.ctx.rng, this.pools));
    else this.polyTurn();
  }

  /** Tour de Poly (§1.4) : choix de k, annonce, k vols, fin du coup (invite « à toi » ou fin de partie). */
  private polyTurn(): void {
    const state = this._state;
    const rng = this.ctx.rng;
    const k = polyChooseTake(remaining(state), state.maxTake, state.polyLevel, state.polyHasPlayed, rng);
    state.polyHasPlayed = true;
    this.say(planAnnounceTake(k, rng, this.pools));
    for (let i = 0; i < k; i++) this.queue.push({ kind: "call", run: () => this.polyLaunchOne() });
    this.queue.push({ kind: "call", run: () => this.finishPolyTurn() });
  }

  private polyLaunchOne(): void {
    const slot = polyPickSlot(this._state.slots, this.ctx.rng);
    if (slot >= 0) this.queue.unshift({ kind: "flight", slot, by: "poly" });
  }

  private finishPolyTurn(): void {
    endPolyTurn(this._state);
    if (isFinished(this._state)) this.finishGame();
    else this.say(planPrompt(this.ctx.rng, this.pools));
  }

  /** Fin de partie : la voix de Poly (mode Poly) et l'adaptation du niveau. Mode ami : rien. */
  private finishGame(): void {
    const state = this._state;
    if (!isOver(state) || !state.lastMover) return;
    this._lastResult = state.lastMover;
    if (state.mode !== "poly") return;
    applyGameResult(state, state.lastMover, this.rules);
    this.say(state.lastMover === "poly" ? planPolyWins(this.ctx.rng, this.pools) : planChildWins(this.ctx.rng, this.pools));
  }

  private afterChildLaunch(): void {
    const state = this._state;
    if (isFinished(state)) this.finishGame();
    else if (autoTurnPending(state)) this.polyTurn();
  }

  // --- Modes ---

  private onPolyButton(): void {
    if (this.busy || this._helpOpen) return;
    this.commentAt = null;
    const state = this._state;
    state.mode = "poly";
    state.maxTake = maxTakeForPoly(state.maxTake);
    this.syncModeButtons();
    this.startGame(state.total);
    if (!this._polyVisible) this.queue.push(...this.scripts(planEnter()), { kind: "call", run: () => this.setPolyVisible(true) });
    this.queue.push({ kind: "call", run: () => this.queueAfter(() => planAnnounceMaxTake(state.maxTake, this.ctx.rng)) });
  }

  private onFriendButton(): void {
    if (this.busy || this._helpOpen) return;
    this.commentAt = null;
    this._state.mode = "friend";
    this.syncModeButtons();
    this.startGame(this._state.total);
    if (this._polyVisible) this.say(planFarewell(this.ctx.rng, this.pools));
  }

  // --- Aide (§1.8) ---

  private openHelp(): void {
    this.commentAt = null;
    this._helpOpen = true;
    this.setHelpGroups(true);
    this._helper!.open({ friendMode: this._state.mode === "friend", polyPresent: this._polyVisible });
  }

  /** Aide : les boutons et zones de jeu sont désactivés, la zone plein écran capte tout (`166e(1)`). */
  private setHelpGroups(help: boolean): void {
    this.groupA.active = !help;
    this.groupB.active = !help;
    for (let i = 3; i <= 5; i++) this.groupC.record(i).disabled = help;
    this.groupC.record(1).disabled = help || !this._polyVisible;
    this.groupC.record(2).disabled = help || !this._polyVisible;
    this.groupC.record(6).disabled = !help;
  }

  private helpContext() {
    return { friendMode: this._state.mode === "friend", polyPresent: this._polyVisible };
  }

  private onHelpClick(): void {
    const zone = HELP_ZONES.hit(this.ctx.input.mouseX, this.ctx.input.mouseY);
    const key = HELP_KEYS[zone];
    if (key) this._helper!.click(key, this.helpContext());
  }

  /** Aide : survol (curseur « ? »), panneau stop pendant l'écoute. */
  private updateHelp(ctx: SceneContext): void {
    const helper = this._helper;
    if (!helper || !this._helpOpen) return;
    const listening = helper.phase === "listening";
    helper.hover(listening ? HELP_KEYS[HELP_ZONES.hit(ctx.input.mouseX, ctx.input.mouseY)] ?? null : null);
    if (listening !== this.stopShown) {
      this.stopShown = listening;
      this.paint(rectFromEdges(STOP_POS.x - 1, STOP_POS.y - 1, STOP_POS.x + 27, STOP_POS.y + 27));
    }
  }

  private closeHelp(): void {
    this._helpOpen = false;
    this.stopShown = false;
    this.setHelpGroups(false);
    this.paint(POLY_COLUMN);
  }

  private createPolyPorts(): PolyPorts {
    const cursor = this.services.pointer.cursor;
    return {
      play: (scr, { interruptible }): PolyAnimation => {
        const handle = this.startPolyScript(scr, interruptible);
        return {
          get done() {
            return handle.done;
          },
          get interrupted() {
            return handle.state === "interrupted";
          },
          interrupt: () => handle.interrupt(),
        };
      },
      begin: () => undefined,
      end: () => cursor.setHelpHover(false),
      setHelpHover: (on) => cursor.setHelpHover(on),
    };
  }

  // --- Animations de Poly ---

  /** Joue un script de Poly en mode bloquant, sur le fond nu (le script dessine tout le personnage), décalé de +40 en y (`1070:1e05`). */
  private startPolyScript(scr: number, interruptible: boolean): AnimationHandle {
    this.blinkReopenAt = null;
    this.blinkAt = null;
    // Les gabarits de Poly ne portent pas le panneau stop : il revient quand l'aide écoute à nouveau.
    this.stopShown = false;
    this.paint(POLY_COLUMN, { poly: false });
    const handle = this.services.scr.start(this.archive, scr, {
      flags: POLY_FLAGS | (interruptible ? SCR_FLAG.interruptible : 0),
      offsetY: 40,
      soundChannel: "voice",
      blocking: true,
      onEnd: (animation) => this.ended.push(animation),
    });
    return handle;
  }

  /** Fin d'un script de Poly (au début du tick, après la composition du lecteur) : visibilité, pose neutre si interrompu, clignement réarmé. */
  private processEnded(): void {
    if (this.ended.length === 0) return;
    const ended = this.ended.splice(0);
    for (const handle of ended) {
      const interrupted = handle.state === "interrupted";
      if (handle.scrId === SCR_POLY_ENTER && !interrupted) this.setPolyVisible(true);
      if (handle.scrId === SCR_POLY_LEAVE) this.setPolyVisible(false);
      if (handle.scrId === SCR_POLY_LEAVE || (interrupted && handle.scrId !== SCR_POLY_ENTER)) this.paint(rectOfClip(handle.clip));
    }
  }

  /** Les yeux sont fermés au moment où une animation ou un vol commence : la pose neutre revient d'abord. */
  private reopenEyes(): void {
    if (this.blinkReopenAt === null) return;
    this.blinkReopenAt = null;
    if (this._polyVisible) this.drawPoly();
  }

  /** Clignement (`1070:1ecd`) : à l'échéance, yeux fermés 6 ticks puis la pose neutre revient. */
  private updateBlink(ctx: SceneContext): void {
    if (!this._polyVisible || this.busy) return;
    if (this._helpOpen && this._helper?.phase !== "listening") return;
    const ticks = ctx.clock.ticks;
    if (this.blinkAt === null && this.blinkReopenAt === null) {
      // Réarmé après chaque animation ou vol : prochain clignement dans [120, 300] ticks (`1070:1ecd`).
      this.blinkAt = ticks + ctx.rng.range(BLINK_RANGE[0], BLINK_RANGE[1]);
    } else if (this.blinkReopenAt !== null) {
      if (ticks < this.blinkReopenAt) return;
      this.blinkReopenAt = null;
      this.blinkAt = ticks + ctx.rng.range(BLINK_RANGE[0], BLINK_RANGE[1]);
      this.drawPoly();
      ctx.requestPresent();
    } else if (this.blinkAt !== null && ticks >= this.blinkAt) {
      this.blinkAt = null;
      this.blinkReopenAt = ticks + BLINK_TICKS;
      this.draw(SHAP.eyesClosed, EYES_POS.x, EYES_POS.y);
      ctx.requestPresent();
    }
  }

  // --- File d'actions ---

  private scripts(steps: readonly ScriptStep[]): Action[] {
    return steps.map((step) => ({ kind: "script", step }));
  }

  /** Ajoute les scripts d'une réplique en fin de file. */
  private say(steps: readonly ScriptStep[]): void {
    this.queue.push(...this.scripts(steps));
  }

  /** Ajoute en fin de file des scripts décidés au moment où on y arrive (le tirage se fait alors). */
  private queueAfter(make: () => readonly ScriptStep[]): void {
    this.queue.unshift(...this.scripts(make()));
  }

  private runQueue(): void {
    for (;;) {
      if (this.running) {
        if (!this.running.handle.done) return;
        const finished = this.running;
        this.running = null;
        if (finished.action.kind === "flight") this.completeFlight(finished);
        continue;
      }
      if (this.waiting) {
        if (this.waiting()) return;
        this.waiting = null;
        continue;
      }
      const action = this.queue.shift();
      if (!action) return;
      switch (action.kind) {
        case "call":
          action.run();
          break;
        case "wait":
          this.waiting = () => !action.until();
          break;
        case "script": {
          this._played.push(action.step.scr);
          const handle = this.startPolyScript(action.step.scr, action.step.interruptible);
          this.running = { action, handle, rect: rectOfClip(handle.clip) };
          break;
        }
        case "flight":
          this.startFlight(action);
          break;
      }
    }
  }

  // --- Vols (§2.5, `1070:1778`) ---

  private startFlight(action: Action & { kind: "flight" }): void {
    const slot = this._state.slots[action.slot]!;
    const type = slot.type!;
    this.reopenEyes();
    this.blinkAt = null;
    this.playSfx(this.launchSounds[type]!);
    const clip = flightClip(slot, type);
    const rect = rectOfClip(clip);
    this.flight = { slot: action.slot, rect };
    // L'emplacement qui part n'est plus dans le décor sauvegardé par le lecteur ; les fusées devant et Poly reviennent par `drawFront`.
    this.paint(rect, { skip: action.slot });
    const handle = this.services.scr.start(this.archive, flightScrId(type), {
      flags: FLIGHT_FLAGS,
      clipOverride: clip,
      blocking: true,
    });
    this.running = { action, handle, rect };
    this.drawFront();
  }

  private completeFlight(finished: Running): void {
    const action = finished.action as Action & { kind: "flight" };
    this.flight = null;
    launch(this._state, action.slot, action.by);
    this.paint(finished.rect);
    if (action.by === "child") this.afterChildLaunch();
  }

  // --- Sons, musique, curseur ---

  private playSfx(id: number) {
    if (!this.archive.has(TAG_SND, id)) return null;
    return this.services.sound.playSound(this.archive, id);
  }

  private startMusic(): void {
    // Musique de fond (`SND` 201) seulement si « Ambient Sounds » est actif (`DS:2d64`).
    if (this.archive.has(TAG_SND, SND.music)) this.services.sound.playSound(this.archive, SND.music, { loop: true, ambient: true });
  }

  private updateCursor(): void {
    const helper = this._helper;
    const helperBusy = this._helpOpen && helper !== null && helper.phase !== "listening";
    const busy = this.busy || helperBusy;
    if (busy === this.wantBusyCursor) return;
    this.wantBusyCursor = busy;
    this.services.pointer.cursor.setBase(busy ? "busy" : "arrow");
  }

  // --- Sortie (Exit) ---

  /** Au revoir de Poly (si elle est là), fondu de sortie, retour au hub (`1070:1131`). `farewell` faux : sortie immédiate (fermeture). */
  private startLeaving(farewell: boolean): void {
    if (this.leaving) return;
    this.leaving = true;
    this.commentAt = null;
    if (!farewell) {
      this._helper?.abort();
      this.queue = [];
      this.running?.handle.interrupt();
      this.running = null;
      this.waiting = null;
      this.flight = null;
      this.padRandom = null;
      this._helpOpen = false;
    } else if (this._polyVisible) {
      this.queue.push(...this.scripts(planGoodbye(this.ctx.rng, this.pools)));
    }
    const { palette } = this.services.graphics;
    this.queue.push(
      { kind: "call", run: () => this.setPolyVisible(false) },
      { kind: "call", run: () => palette.fadeToBlack(FADE_TICKS) },
      { kind: "wait", until: () => palette.fade === null || palette.fade.done },
      { kind: "call", run: () => this.ctx.scenes.request(SceneId.hub) },
    );
  }
}
