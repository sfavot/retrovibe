/**
 * Puzzle Patterns (scène 5, `PATTERNS.DAT`) : menu de 3 × 9 tableaux, huit pièces de deux cases à glisser dans une grille 4 × 4, animation de
 * victoire (dont quatre par cyclage de palette) et aide de Poly. Comportement d'origine : `docs/mathemagique/screens/patterns.md`.
 *
 * Rien de bloquant : les attentes de l'original (voix de félicitation, animation de victoire, fondu de sortie) sont les états de `flow`.
 * Dessin : le décor (fond + vignettes ou cadre-indice) est recomposé dans `decor`, `paint()` y pose le cadre de survol ou les pièces puis
 * laisse les boutons (gadgets) se redessiner par-dessus. Aucune copy : tout est image ou voix.
 */
import { drawMask, drawShape } from "../engine/graphics/blit";
import type { PaletteCycler } from "../engine/graphics/palette";
import { Surface } from "../engine/graphics/surface";
import { rectFromEdges, type GadgetGroup, type GadgetRecord } from "../engine/gadgets";
import type { KeyEvent } from "../engine/input";
import type { Archive } from "../engine/resources";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";
import { SCR_FLAG } from "../engine/scr-player";
import type { SoundHandle } from "../engine/sound";
import { TAG_SHAP } from "../data/mohawk";
import type { ShapeList } from "../data/shpl";
import { parsePatternsPuzz, patternsPuzzId, patternsRewardId, patternsThumbsShplId, type PatternsPuzz } from "../game/puzz";
import { PATTERNS_POLY } from "../game/poly-config";
import { PolyHelper, createScrPolyPorts, openPolyArchive, rosterIntroFlag } from "../game/poly";
import {
  PatternsBoard,
  PuzzleSession,
  THUMB_LAYOUTS,
  attachBoard,
  patternsEndVoice,
  patternsRect,
  thumbRect,
  type CarriableBoard,
  type PatternsPiece,
} from "../game/puzzle-kit";
import {
  type ButtonRole,
  BACKGROUND_ID,
  BUTTONS,
  BUTTON_INDEX,
  CYCLE_PERIOD,
  FACES_SCR,
  FRAME_INNER,
  HINT_FRAME_AT,
  HOVER_COLORS,
  MUSIC_ID,
  PATTERNS_ARCHIVE,
  PUZZLE_PALETTE,
  REWARD_CYCLES,
  SOUNDS,
  helpZoneAt,
  levelOfButton,
  paletteSlice,
  pieceShapeId,
  thumbHoverMaskId,
  thumbShapeId,
} from "./patterns-view";

/** Fondu d'entrée et de sortie (30 ticks, `1088:1b25`). */
const FADE_TICKS = 30;
/** Garde-fou de l'attente de la voix de félicitation (la plus longue dure 3,2 s, soit 190 ticks) : un son muet ou refusé ne bloque pas. */
const VOICE_WAIT_MAX_TICKS = 400;
/** Drapeaux de l'animation de victoire (hypothèse : le descripteur `3292` n'est pas documenté) : coupée par un clic, avance rapide jusqu'à l'image finale, attend ses sons. */
const REWARD_FLAGS = SCR_FLAG.interruptible | SCR_FLAG.fastForwardOnInterrupt | SCR_FLAG.waitSounds;

/** Ce que la scène attend. `free` : l'enfant joue. */
type Flow =
  | { kind: "free" }
  /** Victoire : la voix de félicitation est jouée et attendue, puis l'animation. */
  | { kind: "voice"; voice: SoundHandle | null; ticks: number }
  /** Animation de victoire en cours (bloquante : gadgets et pointeur gelés). */
  | { kind: "reward" }
  /** Sortie : fondu au noir, puis retour au hub. */
  | { kind: "leaving"; ticks: number; requested: boolean };

export function createPatternsScene(services: MathServices): Scene {
  return new PatternsScene(services);
}

export class PatternsScene implements Scene {
  private ctx!: SceneContext;
  private archive!: Archive;
  private polyArchive!: Archive;
  /** Fond 103, sans bouton : sert de fond aux gadgets (`captureBackground`). */
  private readonly base = new Surface();
  /** Fond + vignettes du niveau, ou cadre-indice du puzzle. */
  private readonly decor = new Surface();
  private session = new PuzzleSession();
  private board: PatternsBoard | null = null;
  private puzzleShpl: ShapeList | null = null;
  private thumbsShplId = 0;
  private poly!: PolyHelper;
  private buttons!: GadgetGroup;
  private thumbs!: GadgetGroup;
  private replay!: GadgetGroup;
  private detachBoard: (() => void) | null = null;
  private hoverThumb = -1;
  private flow: Flow = { kind: "free" };
  private cycle: PaletteCycler | null = null;
  private rewardPalette: Uint8Array | null = null;
  /** Aide en cours d'ouverture : les groupes sont déjà fermés mais `poly.active` n'est pas encore vrai. */
  private opening = false;
  /** L'aide s'est ouverte pendant ce tick : les événements bouton qui l'ont ouverte ne sont pas des clics d'aide. */
  private openedThisTick = false;
  /** Reprise d'une pièce par la rotation : pas de son de prise. */
  private recarrying = false;

  constructor(private readonly services: MathServices) {}

  // --- Accès pour les tests et les outils ---

  get puzzleSession(): PuzzleSession {
    return this.session;
  }

  get currentBoard(): PatternsBoard | null {
    return this.board;
  }

  get helper(): PolyHelper {
    return this.poly;
  }

  get flowKind(): Flow["kind"] {
    return this.flow.kind;
  }

  // --- Cycle de vie ---

  async load(ctx: SceneContext): Promise<void> {
    await Promise.all([ctx.resources.open(PATTERNS_ARCHIVE), openPolyArchive(ctx.resources, PATTERNS_POLY)]);
  }

  enter(ctx: SceneContext): void {
    this.ctx = ctx;
    this.archive = ctx.resources.require(PATTERNS_ARCHIVE);
    this.polyArchive = ctx.resources.require(PATTERNS_POLY.archive);
    const { graphics, gadgets, pointer, scr } = this.services;
    const archive = this.archive;

    this.services.useArchive(archive);
    // Niveau remis au vert à chaque entrée, jamais sauvegardé.
    this.session = new PuzzleSession();
    this.board = null;
    this.puzzleShpl = null;
    this.hoverThumb = -1;
    this.flow = { kind: "free" };
    this.opening = false;
    this.openedThisTick = false;

    graphics.palette.loadShpl(archive.shpl(BACKGROUND_ID));
    this.base.pixels.set(archive.shap(BACKGROUND_ID).pixels);

    this.createGroups();
    gadgets.captureBackground(this.base);

    const board: CarriableBoard<PatternsPiece> = {
      pickAt: (x, y) => (this.canPlay ? this.board!.pickAt(x, y) : null),
      lift: (piece) => this.board!.lift(piece),
      moveTo: (piece, x, y) => this.board!.moveTo(piece, x, y),
      drop: (piece) => this.board!.drop(piece),
    };
    this.detachBoard = attachBoard(pointer, board, {
      picked: () => {
        if (!this.recarrying) this.playSound(SOUNDS.pick);
        this.paint();
      },
      moved: () => this.paint(),
      dropped: (_piece, outcome) => {
        this.playSound(SOUNDS.drop);
        this.paint();
        if (outcome.complete) this.startVictory();
      },
    });

    this.poly = new PolyHelper(PATTERNS_POLY, {
      ports: createScrPolyPorts({
        config: PATTERNS_POLY,
        scr,
        archive: this.polyArchive,
        surface: graphics.screen,
        cursor: pointer.cursor,
        onDirty: () => ctx.requestPresent(),
      }),
      rng: ctx.rng,
      introFlag: rosterIntroFlag(ctx.roster, PATTERNS_POLY.introFlag),
      onClosed: () => {
        this.syncGroups();
        this.ensureMusic();
        ctx.requestPresent();
      },
    });

    pointer.cursor.setBase("arrow");
    this.showMenu();
    graphics.palette.fadeFromBlack(FADE_TICKS);
    // Les boutons sont posés avant l'animation d'entrée : elle sauvegarde le fond de sa zone, qui doit les contenir.
    gadgets.draw(graphics.screen);
    this.startFaces();
    ctx.requestPresent();
  }

  leave(ctx: SceneContext): void {
    this.poly.abort();
    this.detachBoard?.();
    this.detachBoard = null;
    this.cycle = null;
    // Le drapeau « Poly a déjà présenté le jeu » est enregistré à la sortie (patterns.md §5).
    if (this.poly.firstIntroThisVisit && ctx.roster.currentPlayerId !== 0) ctx.roster.save();
    this.services.endScene();
  }

  exit(): void {
    this.startLeave();
  }

  tick(ctx: SceneContext): void {
    this.ctx = ctx;
    const flow = this.flow;
    if (flow.kind === "leaving") {
      if (++flow.ticks >= FADE_TICKS && !flow.requested) {
        flow.requested = true;
        ctx.scenes.request(SceneId.hub);
      }
      return;
    }
    if (flow.kind === "voice") this.tickVoice(flow);
    this.tickHelp();
    this.tickHover();
    this.syncGroups();
    this.openedThisTick = false;
  }

  key(event: KeyEvent): boolean {
    if (event.code !== "Space") return false;
    // Poly à l'écran : Espace ignoré et non consommé (patterns.md §1.6).
    if (this.poly.active || this.opening) return false;
    if (!event.repeat) this.rotate();
    return true;
  }

  // --- Groupes de gadgets ---

  private createGroups(): void {
    const { gadgets } = this.services;
    this.buttons = gadgets.addGroup({
      id: "buttons",
      records: BUTTONS.map((def) => ({
        rect: rectFromEdges(def.edges.left, def.edges.top, def.edges.right, def.edges.bottom),
        shapes: { normal: def.shapeId, pressed: def.shapeId + 1 },
        pressSound: def.sound,
      })),
      onActivate: (index) => this.onButton(BUTTONS[index - 1]!.role),
    });
    const layout = THUMB_LAYOUTS.patterns;
    this.thumbs = gadgets.addGroup({
      id: "thumbs",
      records: Array.from({ length: 9 }, (_, k) => ({ rect: thumbRect(layout, k), pressSound: SOUNDS.thumbClick })),
      onActivate: (index) => this.selectPuzzle(index - 1),
    });
    this.replay = gadgets.addGroup({
      id: "replay",
      records: [{ rect: rectFromEdges(FRAME_INNER.left, FRAME_INNER.top, FRAME_INNER.right, FRAME_INNER.bottom), focusable: false }],
      onActivate: () => {
        if (this.session.replayEnabled) this.beginReward();
      },
      active: false,
    });
  }

  /** Les groupes réagissent quand rien d'autre ne tient la main : ni Poly, ni voix ou animation de victoire, ni sortie. */
  private get groupsOpen(): boolean {
    return !this.poly.active && !this.opening && this.flow.kind === "free";
  }

  private syncGroups(): void {
    const open = this.groupsOpen;
    this.buttons.active = open;
    this.thumbs.active = open && this.session.mode === "menu";
    this.replay.active = open && this.session.replayEnabled;
    this.buttons.record(BUTTON_INDEX.reset).disabled = this.session.mode === "menu";
  }

  /** Les pièces se prennent, tournent et se déposent : puzzle en cours, aide fermée, rien d'attendu. */
  private get canPlay(): boolean {
    return this.board !== null && this.session.piecesEnabled && this.groupsOpen;
  }

  // --- Boutons ---

  private onButton(role: ButtonRole): void {
    const level = levelOfButton(role);
    if (level >= 0) {
      if (this.session.pressLevel(level)) this.showMenu();
      return;
    }
    if (role === "help") this.openHelp();
    else if (role === "reset") this.reset();
    else if (role === "rotate") this.rotate();
    else this.startLeave();
  }

  // --- Menu et choix du puzzle ---

  private showMenu(): void {
    const { pointer, graphics } = this.services;
    pointer.cancel();
    this.board = null;
    this.puzzleShpl = null;
    this.hoverThumb = -1;
    this.thumbsShplId = patternsThumbsShplId(this.session.level);
    graphics.palette.loadShpl(this.archive.shpl(this.thumbsShplId));
    this.rebuildDecor();
    this.syncGroups();
    this.paint();
  }

  private selectPuzzle(k: number): void {
    if (!this.session.select(k)) return;
    const id = patternsPuzzId(this.session.level, k);
    const puzzle: PatternsPuzz = parsePatternsPuzz(this.archive.raw("PUZZ", id));
    this.puzzleShpl = this.archive.shpl(id);
    // Seules les entrées 154–225 sont celles du tableau : le fond garde ses couleurs.
    this.services.graphics.palette.loadShpl(paletteSlice(this.puzzleShpl, PUZZLE_PALETTE.first, PUZZLE_PALETTE.count));
    this.board = new PatternsBoard(puzzle);
    this.board.deal(this.ctx.rng);
    this.hoverThumb = -1;
    this.rebuildDecor();
    this.syncGroups();
    this.paint();
  }

  private reset(): void {
    if (!this.session.reset() || !this.board) return;
    this.playSound(SOUNDS.reset);
    this.services.pointer.cancel();
    this.board.deal(this.ctx.rng);
    this.syncGroups();
    this.paint();
  }

  // --- Rotation ---

  /** Espace ou Rotate : quart de tour horaire de la dernière pièce prise (`1040:11b2`). */
  private rotate(): void {
    if (!this.canPlay) return;
    const board = this.board!;
    const { pointer } = this.services;
    const carried = pointer.carried;
    const outcome = board.rotateLast(carried !== null);
    this.playSound(SOUNDS.rotate);
    if (carried) {
      // Le pointeur garde les dimensions de la prise : la pièce portée est reprise avec ses nouvelles dimensions, son centre sous le curseur.
      const piece = carried.item as PatternsPiece;
      const rect = patternsRect(piece);
      this.recarrying = true;
      try {
        pointer.carry(
          { item: piece, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, grab: "center" },
          carried.button,
          this.ctx.input.mouseX,
          this.ctx.input.mouseY,
        );
      } finally {
        this.recarrying = false;
      }
    }
    this.paint();
    if (outcome?.complete) this.startVictory();
  }

  // --- Victoire ---

  /** Tous les morceaux sont à leur place (`1040:14e3`) : sablier, musique coupée, voix de félicitation attendue, puis l'animation. */
  private startVictory(): void {
    const { sound, pointer } = this.services;
    this.session.markSolved();
    pointer.cancel();
    pointer.cursor.setBase("busy");
    sound.stopMusic();
    const voice = sound.playSound(this.archive, patternsEndVoice(this.ctx.rng), { channel: "voice" });
    this.flow = { kind: "voice", voice, ticks: 0 };
    this.syncGroups();
  }

  private tickVoice(flow: Extract<Flow, { kind: "voice" }>): void {
    flow.ticks++;
    if (flow.voice && flow.ticks < VOICE_WAIT_MAX_TICKS && this.services.sound.isPlaying(flow.voice)) return;
    this.beginReward();
  }

  /** `SCR` 20000 + 900·L + 100·k joué jusqu'au bout (aussi pour rejouer : clic sur le tableau résolu). */
  private beginReward(): void {
    const { scr, graphics, pointer } = this.services;
    const rewardId = patternsRewardId(this.session.level, this.session.puzzle!);
    this.flow = { kind: "reward" };
    pointer.cursor.setBase("busy");
    this.rewardPalette = graphics.palette.snapshot(PUZZLE_PALETTE.first, PUZZLE_PALETTE.count);
    this.syncGroups();
    scr.playBlocking(
      this.archive,
      rewardId,
      {
        flags: REWARD_FLAGS,
        onHook: (hook, arg) => {
          if (hook !== 0) return;
          this.cycle?.stop(false);
          this.cycle = null;
          const range = REWARD_CYCLES[rewardId];
          // Hook 0 d'argument 0 : démarre le cyclage ; un argument non nul l'arrête (`1040:1749`).
          if (arg === 0 && range) this.cycle = graphics.palette.startCycle({ first: range.first, count: range.count, period: CYCLE_PERIOD });
        },
      },
      () => this.endReward(),
    );
  }

  private endReward(): void {
    const { graphics, pointer } = this.services;
    this.cycle?.stop(false);
    this.cycle = null;
    graphics.palette.stopCycles(false);
    if (this.rewardPalette) graphics.palette.restore(this.rewardPalette, PUZZLE_PALETTE.first);
    this.rewardPalette = null;
    this.flow = { kind: "free" };
    pointer.cursor.setBase("arrow");
    this.ensureMusic();
    this.syncGroups();
    this.ctx.requestPresent();
  }

  // --- Aide de Poly ---

  private openHelp(): void {
    if (this.poly.active || this.opening || this.flow.kind !== "free") return;
    const { gadgets, graphics, pointer } = this.services;
    pointer.cancel();
    // Les boutons sont redessinés (survol → repos) avant l'arrivée de Poly : elle est composée par-dessus.
    this.opening = true;
    this.syncGroups();
    gadgets.updatePointer(-1, -1);
    gadgets.draw(graphics.screen);
    this.poly.open({ menuShown: this.session.mode === "menu" });
    this.opening = false;
    this.openedThisTick = true;
    this.syncGroups();
    this.ctx.requestPresent();
  }

  private tickHelp(): void {
    if (!this.poly.active) return;
    const { scr } = this.services;
    // Pendant une animation bloquante, le lecteur gère lui-même le clic qui l'interrompt.
    if (!scr.blockedThisTick && !this.openedThisTick) {
      const input = this.ctx.input;
      const pieces = this.board?.pieces ?? [];
      const context = { menuShown: this.session.mode === "menu" };
      for (const event of input.buttonEvents) {
        if (event.down) this.poly.click(helpZoneAt(event.x, event.y, pieces) ?? "none", context);
      }
      if (this.poly.phase === "listening") this.poly.hover(helpZoneAt(input.mouseX, input.mouseY, pieces));
    }
    this.poly.tick();
  }

  // --- Survol des vignettes ---

  private tickHover(): void {
    const { gadgets, sound } = this.services;
    // Aide ouverte, victoire ou sortie : l'écran n'est plus à nous, le cadre reste tel quel.
    if (!this.groupsOpen) return;
    let next = -1;
    if (this.session.mode === "menu") {
      const hovered: GadgetRecord | null = gadgets.hovered;
      if (hovered?.group === this.thumbs) next = hovered.index - 1;
    }
    if (next === this.hoverThumb) return;
    this.hoverThumb = next;
    if (next >= 0) sound.playSound(this.archive, SOUNDS.thumbHover);
    this.paint();
  }

  // --- Sortie ---

  private startLeave(): void {
    if (this.flow.kind === "leaving") return;
    const { scr, sound, pointer, graphics } = this.services;
    this.poly.abort();
    pointer.cancel();
    this.cycle = null;
    graphics.palette.stopCycles(false);
    if (this.rewardPalette) graphics.palette.restore(this.rewardPalette, PUZZLE_PALETTE.first);
    this.rewardPalette = null;
    scr.stopAll();
    sound.stopAll();
    sound.stopMusic();
    graphics.palette.fadeToBlack(FADE_TICKS);
    this.flow = { kind: "leaving", ticks: 0, requested: false };
    pointer.cursor.setBase("arrow");
    this.syncGroups();
  }

  // --- Musique et animation d'entrée ---

  private ensureMusic(): void {
    const { sound } = this.services;
    if (this.flow.kind !== "free" || sound.musicPlaying) return;
    sound.playSound(this.archive, MUSIC_ID, { loop: true, ambient: true });
  }

  private startFaces(): void {
    const { scr } = this.services;
    // Descripteur `329e` : fond sauvegardé, attend ses sons (drapeaux 0x11) ; la musique démarre à la fin (patterns.md §3.6).
    const started = scr.start(this.archive, FACES_SCR, {
      flags: SCR_FLAG.saveBackground | SCR_FLAG.waitSounds,
      onEnd: () => this.ensureMusic(),
    });
    if (started.done) this.ensureMusic();
  }

  // --- Dessin ---

  private shape(id: number) {
    if (!this.archive.has(TAG_SHAP, id)) throw new Error(`${PATTERNS_ARCHIVE} : forme ${id} absente`);
    return this.archive.shap(id);
  }

  /** Fond + vignettes du niveau (menu) ou + cadre-indice du puzzle (en jeu). */
  private rebuildDecor(): void {
    this.decor.copyFrom(this.base);
    if (this.session.mode === "menu") {
      const layout = THUMB_LAYOUTS.patterns;
      for (let k = 0; k < 9; k++) {
        const rect = thumbRect(layout, k);
        drawShape(this.decor, this.shape(thumbShapeId(this.thumbsShplId, k)), rect.x, rect.y, 0);
      }
    } else if (this.puzzleShpl) {
      drawShape(this.decor, this.shape(this.puzzleShpl.firstShapeId), HINT_FRAME_AT.x, HINT_FRAME_AT.y, 8);
    }
  }

  /** Recompose l'écran : décor, cadre de survol ou pièces (le rang 0 au-dessus), puis boutons. Jamais pendant l'aide ni une animation. */
  private paint(): void {
    const { graphics, gadgets } = this.services;
    const screen = graphics.screen;
    screen.copyFrom(this.decor);
    if (this.session.mode === "menu") {
      if (this.hoverThumb >= 0) {
        const rect = thumbRect(THUMB_LAYOUTS.patterns, this.hoverThumb);
        drawMask(screen, this.shape(thumbHoverMaskId(this.thumbsShplId)), rect.x - 4, rect.y - 4, HOVER_COLORS[this.session.level]!);
      }
    } else if (this.board && this.puzzleShpl) {
      const pieces = this.board.pieces;
      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i]!;
        const rect = patternsRect(piece);
        drawShape(screen, this.shape(pieceShapeId(this.puzzleShpl.firstShapeId, piece)), rect.left, rect.top, 0);
      }
    }
    gadgets.invalidate();
    gadgets.draw(screen);
    this.services.scr.redraw();
    this.ctx.requestPresent();
  }

  private playSound(id: number): void {
    this.services.sound.playSound(this.archive, id);
  }
}
