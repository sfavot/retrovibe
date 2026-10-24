/**
 * Scène 4 : Hidden Picture Puzzles (`HIDDEN.DAT`). Étude : `docs/mathemagique/screens/hidden.md` ; noyau des règles : `game/puzzle-kit.ts`.
 *
 * Un puzzle de polyominos : on pose des pièces (1 à 7 carrés) sur la télé, chaque pièce posée révèle sa part de la photo ; quand tout est posé, un jingle
 * puis la photo s'anime (`SCR` 5100 + 900 × niveau + 100 × (k − 1) en 1-based, soit `hiddenRewardId`). Ni score, ni minuteur.
 *
 * Machine d'états (jamais d'`await` dans un tick) :
 *
 *   welcome ──► menu ──► launching ──► transition ──► playing ──► jingle ──► reward ──► solved
 *                 ▲                                      │  ▲                              │
 *                 └────────────── transition ◄───────────┴──┴── resetting ◄───────────────┘
 *
 *  - `welcome` : accueil des trois « Level Brothers » (`SCR` 2000, bloquant) ; `menu` : 9 vignettes du niveau ;
 *  - `launching` : le son de clic (5011) est joué en entier, puis découpage tiré, pièces dispersées, stores vénitiens vers l'écran de jeu ;
 *  - `playing` : prise, rotation (Rotate / Espace), dépose ; `jingle` : musique coupée, jingle joué en entier, pièces désactivées ;
 *  - `reward` : animation de la photo (bloquante, non interruptible) puis `solved` : la télé rejoue l'animation ;
 *  - `resetting` : son 5004, 30 ticks, nouvelle dispersion du même découpage ; `leaving` : fondu au noir puis retour au hub.
 * L'aide de Poly est un état à part (`PolyHelper`), qui peut s'ouvrir dans `menu`, `playing` et `solved`.
 *
 * Rendu : le fond (`SHPL` 102) est gardé dans `backdrop` ; chaque changement recompose toute la surface de jeu (fond, menu ou plateau, boutons des gadgets,
 * pièce tenue par-dessus). Les transitions composent l'écran cible dans `work` et le révèlent par stores vénitiens (`Blinds`).
 *
 * Aucune copy : tout est dessin et audio.
 */
import { Blinds, revealRects } from "../engine/graphics/transitions";
import { drawShape } from "../engine/graphics/blit";
import { Surface, type Rect } from "../engine/graphics/surface";
import { rectFromEdges, type GadgetGroup, type GadgetSpec } from "../engine/gadgets";
import type { KeyEvent } from "../engine/input";
import { SCR_FLAG } from "../engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";
import type { Archive } from "../engine/resources";
import type { SoundHandle } from "../engine/sound";
import { HIDDEN_POLY, POLY_ZONE } from "../game/poly-config";
import { createScrPolyPorts, openPolyArchive, PolyHelper, rosterIntroFlag } from "../game/poly";
import { hiddenMenuShplId, hiddenPhotoShplId, hiddenRewardId, parseHiddenPuzz } from "../game/puzz";
import { attachBoard, HiddenBoard, hiddenEndJingle, HiddenSelection, PuzzleSession, thumbRect, THUMB_LAYOUTS, type HiddenPiece } from "../game/puzzle-kit";
import {
  drawBoard,
  drawCleanPhoto,
  drawFloatingPiece,
  drawMenu,
  HIDDEN_ARCHIVE,
  HIDDEN_BACKGROUND_SHPL,
  HIDDEN_BORDERS_SHPL,
  HIDDEN_BUTTONS,
  HIDDEN_BUTTONS_SHPL,
  HIDDEN_MUSIC_SND,
  HIDDEN_POLY_ZONE,
  HIDDEN_PRELOAD,
  HIDDEN_SCREEN,
  HIDDEN_SND,
  HIDDEN_TV_EDGES,
  HIDDEN_TV_WITH_BORDERS,
  HIDDEN_WELCOME_SCR,
  type HiddenShapes,
} from "./hidden-view";

export type HiddenPhase = "welcome" | "menu" | "launching" | "transition" | "playing" | "jingle" | "reward" | "solved" | "resetting" | "leaving";

/** Ce que la scène laisse voir (tests, débogage). */
export interface HiddenScene extends Scene {
  readonly phase: HiddenPhase;
  /** Niveau affiché (0 vert, 1 orange, 2 rouge). */
  readonly level: number;
  /** Vignette choisie (0 à 8), `null` au menu. */
  readonly puzzle: number | null;
  readonly board: HiddenBoard | null;
  /** `SCR` de l'animation de fin du puzzle en cours. */
  readonly rewardScr: number | null;
  /** `SND` du jingle de fin tiré au lancement. */
  readonly jingleSnd: number | null;
  readonly poly: PolyHelper | null;
}

/** Ticks d'attente après Reset (`1088:10d2(0x1e, 0)`). */
const RESET_WAIT_TICKS = 30;
/** Durées des stores vénitiens : changement de niveau au menu (télé seule), retour au menu et lancement ou Reset (écran entier). */
const MENU_BLINDS_TICKS = 15;
const SCREEN_BLINDS_TICKS = 30;
const LEAVE_FADE_TICKS = 30;
const WELCOME_FADE_TICKS = 30;

interface PendingTransition {
  blinds: Blinds;
  target: "menu" | "board";
  done: () => void;
  /** Ticks déjà joués : le clic qui a lancé la transition ne doit pas l'achever dans le même tick. */
  age: number;
}

class HiddenSceneImpl implements HiddenScene {
  private ctx!: SceneContext;
  private archive!: Archive;
  private polly!: Archive;

  private readonly backdrop = new Surface();
  private readonly work = new Surface();
  private readonly session = new PuzzleSession();
  private readonly selection = new HiddenSelection();

  private _phase: HiddenPhase = "welcome";
  private _board: HiddenBoard | null = null;
  private _poly: PolyHelper | null = null;
  private _rewardScr: number | null = null;
  private _jingleSnd: number | null = null;
  private photoId = 0;
  private showing: "menu" | "board" = "menu";
  private dirty = false;

  private buttons!: GadgetGroup;
  private thumbs!: GadgetGroup;
  private tv!: GadgetGroup;
  private help!: GadgetGroup;
  private helpZones: string[] = [];

  private transition: PendingTransition | null = null;
  private launchSound: SoundHandle | null = null;
  private jingleHandle: SoundHandle | null = null;
  private resetTicks = 0;
  private hoverThumb = -1;
  private pressedThumb = -1;
  private suppressPickSound = false;
  private hubRequested = false;
  private detachBoard: (() => void) | null = null;

  constructor(private readonly services: MathServices) {}

  // --- Lecture seule (tests) ---

  get phase(): HiddenPhase {
    return this._phase;
  }

  get level(): number {
    return this.session.level;
  }

  get puzzle(): number | null {
    return this.session.puzzle;
  }

  get board(): HiddenBoard | null {
    return this._board;
  }

  get rewardScr(): number | null {
    return this._rewardScr;
  }

  get jingleSnd(): number | null {
    return this._jingleSnd;
  }

  get poly(): PolyHelper | null {
    return this._poly;
  }

  // --- Cycle de vie ---

  async load(ctx: SceneContext): Promise<void> {
    await Promise.all([ctx.resources.open(HIDDEN_ARCHIVE), openPolyArchive(ctx.resources, HIDDEN_POLY)]);
  }

  enter(ctx: SceneContext): void {
    this.ctx = ctx;
    const { services } = this;
    const archive = (this.archive = ctx.resources.require(HIDDEN_ARCHIVE));
    this.polly = ctx.resources.require(HIDDEN_POLY.archive);
    const { screen, palette } = services.graphics;

    services.useArchive(archive);
    palette.loadShpl(archive.shpl(HIDDEN_BACKGROUND_SHPL));
    drawShape(this.backdrop, archive.shap(HIDDEN_BACKGROUND_SHPL), 0, 0, 0);
    this.loadMenuPalette(this.session.level);
    services.sound.preload(archive, HIDDEN_PRELOAD);

    this.buildGroups();
    this._poly = new PolyHelper(HIDDEN_POLY, {
      ports: createScrPolyPorts({
        config: HIDDEN_POLY,
        scr: services.scr,
        archive: this.polly,
        surface: screen,
        cursor: services.pointer.cursor,
        onDirty: () => ctx.requestPresent(),
      }),
      rng: ctx.rng,
      introFlag: rosterIntroFlag(ctx.roster, HIDDEN_POLY.introFlag),
      onClosed: () => this.polyClosed(),
    });

    // Les boutons (formes de repos) sont à poser sur un fond propre : le fond sauvegardé sous chaque bouton est celui de `backdrop`.
    services.gadgets.captureBackground(this.backdrop);
    this.showing = "menu";
    this.repaint();

    palette.fadeFromBlack(WELCOME_FADE_TICKS);
    this._phase = "welcome";
    services.scr.start(archive, HIDDEN_WELCOME_SCR, {
      flags: SCR_FLAG.saveBackground | SCR_FLAG.waitSounds,
      blocking: true,
      onEnd: () => {
        if (this._phase !== "welcome") return;
        this._phase = "menu";
        // Une animation bloquante coupe le MIDI (sans le drapeau « garder le MIDI ») : la musique de fond démarre après l'accueil.
        this.ensureMusic();
      },
    });
    this.applyActivation();
    ctx.requestPresent();
  }

  leave(ctx: SceneContext): void {
    this._poly?.abort();
    this.services.endScene();
    // Le drapeau « Poly a présenté le jeu » est enregistré à la sortie de la scène (hidden.md §5).
    if (this._poly?.firstIntroThisVisit) ctx.roster.save();
    // Le fondu au noir est « tenu » : la scène suivante repart d'une palette libre.
    this.services.graphics.palette.clearFade();
  }

  exit(): void {
    this.leaveToHub();
  }

  key(event: KeyEvent): boolean {
    // Espace : rotation de la dernière pièce prise ; ignorée (et non consommée) si Poly est à l'écran ou si les pièces sont désactivées (hidden.md §1.6).
    if (event.code !== "Space" || !this.canRotate()) return false;
    if (!event.repeat) this.rotate();
    return true;
  }

  tick(ctx: SceneContext): void {
    this._poly?.tick();
    switch (this._phase) {
      case "transition":
        this.tickTransition(ctx);
        break;
      case "launching":
        if (!this.services.sound.isPlaying(this.launchSound)) this.finishLaunch();
        break;
      case "jingle":
        if (!this.services.sound.isPlaying(this.jingleHandle)) this.startReward();
        break;
      case "resetting":
        if (++this.resetTicks >= RESET_WAIT_TICKS) this.finishReset();
        break;
      case "leaving": {
        const fade = this.services.graphics.palette.fade;
        if ((!fade || fade.done) && !this.hubRequested) {
          this.hubRequested = true;
          ctx.scenes.request(SceneId.hub);
        }
        break;
      }
      default:
        break;
    }
    this.trackHover();
    this.applyActivation();
    if (this.dirty) {
      this.dirty = false;
      if (this.canRepaint()) this.repaint();
    }
  }

  // --- Groupes de gadgets ---

  private shapeIdOf(shpl: number, n: number): number {
    return this.archive.shpl(shpl).firstShapeId + n - 1;
  }

  private buildGroups(): void {
    const { gadgets } = this.services;
    const faceSounds = [...HIDDEN_SND.levelFaces, HIDDEN_SND.help];
    const buttonRecords: GadgetSpec[] = HIDDEN_BUTTONS.map((def, i) => {
      const rect = rectFromEdges(...def.edges);
      return {
        rect,
        shapes: { normal: this.shapeIdOf(HIDDEN_BUTTONS_SHPL, def.shapes[0]), pressed: this.shapeIdOf(HIDDEN_BUTTONS_SHPL, def.shapes[1]) },
        pressSound: i < faceSounds.length ? faceSounds[i] : undefined,
      };
    });
    this.buttons = gadgets.addGroup({ id: "buttons", records: buttonRecords, onActivate: (index) => this.onButton(index) });

    const thumbRecords: GadgetSpec[] = Array.from({ length: 9 }, (_, k) => ({ rect: thumbRect(THUMB_LAYOUTS.hidden, k) }));
    this.thumbs = gadgets.addGroup({ id: "thumbnails", records: thumbRecords, onActivate: (index) => this.beginLaunch(index - 1), active: false });

    this.tv = gadgets.addGroup({
      id: "tv",
      records: [{ rect: rectFromEdges(...HIDDEN_TV_EDGES), focusable: false }],
      onActivate: () => this.replay(),
      active: false,
    });

    // Aide de Poly (hidden.md §3.2, §3.7) : Poly, les pièces, les boutons, la télé, dans l'ordre de test de l'original.
    const polyZone = HIDDEN_POLY.polyZone ?? HIDDEN_POLY_ZONE;
    this.helpZones = [POLY_ZONE, "piece", ...HIDDEN_BUTTONS.map((def) => def.zone), "screen"];
    const helpRecords: GadgetSpec[] = [
      { rect: rectFromEdges(...polyZone), focusable: false },
      { rect: { ...HIDDEN_SCREEN }, focusable: false, hit: (x, y) => this._board !== null && this._phase !== "menu" && this._board.pickAt(x, y) !== null },
      ...HIDDEN_BUTTONS.map((def): GadgetSpec => ({ rect: rectFromEdges(...def.edges), focusable: false })),
      { rect: rectFromEdges(...HIDDEN_TV_EDGES), focusable: false },
    ];
    this.help = gadgets.addGroup({
      id: "help",
      records: helpRecords,
      onActivate: (index) => this._poly?.click(this.helpZones[index - 1]!, { menuShown: this.session.mode === "menu" }),
      active: false,
    });
  }

  private onButton(index: number): void {
    const def = HIDDEN_BUTTONS[index - 1]!;
    switch (def.id) {
      case "level0":
      case "level1":
      case "level2":
        this.pressLevel(index - 1);
        break;
      case "help":
        this._poly?.open({ menuShown: this.session.mode === "menu" });
        break;
      case "reset":
        this.beginReset();
        break;
      case "rotate":
        if (this.canRotate()) this.rotate();
        break;
      case "exit":
        this.leaveToHub();
        break;
    }
  }

  /** Activation des groupes selon l'état (bits de désactivation `31ce`, `3200`, `3210` de l'original) et curseur occupé hors des moments interactifs. */
  private applyActivation(): void {
    const interactive = this._phase === "menu" || this._phase === "playing" || this._phase === "solved";
    const polyOpen = this._poly?.active ?? false;
    const free = interactive && !polyOpen;
    this.buttons.active = free;
    this.thumbs.active = free && this._phase === "menu";
    this.tv.active = free && this._phase === "solved";
    this.help.active = polyOpen;
    this.services.pointer.cursor.setBase(interactive || polyOpen ? "arrow" : "busy");
  }

  private piecesActive(): boolean {
    return this._phase === "playing" && this.session.piecesEnabled && !(this._poly?.active ?? false);
  }

  /** Survol des vignettes (son 5010, cadre) et de l'aide (curseur « ? »). */
  private trackHover(): void {
    const { gadgets, sound } = this.services;
    const hovered = gadgets.hovered;
    if (this._poly?.active) {
      this._poly.hover(hovered && hovered.group === this.help ? this.helpZones[hovered.index - 1]! : null);
    }
    if (this._phase !== "menu") {
      this.hoverThumb = this.pressedThumb = -1;
      return;
    }
    const pressed = gadgets.pressed;
    const hover = hovered && hovered.group === this.thumbs ? hovered.index - 1 : -1;
    const press = pressed && pressed.group === this.thumbs ? pressed.index - 1 : -1;
    if (hover === this.hoverThumb && press === this.pressedThumb) return;
    if (hover >= 0 && hover !== this.hoverThumb) sound.playSound(this.archive, HIDDEN_SND.thumbHover);
    this.hoverThumb = hover;
    this.pressedThumb = press;
    this.dirty = true;
  }

  // --- Rendu ---

  private get shapes(): HiddenShapes {
    const archive = this.archive;
    return { borders: archive.shpl(HIDDEN_BORDERS_SHPL).firstShapeId, shape: (id) => archive.shap(id) };
  }

  private canRepaint(): boolean {
    return this._phase !== "transition" && this._phase !== "reward" && this._phase !== "welcome" && !this.services.scr.blocking;
  }

  /** Compose le fond et le contenu (menu ou plateau) dans `target`, sans les boutons ni la pièce tenue. */
  private paintContent(target: Surface, view: "menu" | "board", skip: HiddenPiece | null): void {
    target.copyFrom(this.backdrop);
    if (view === "menu") {
      const first = this.archive.shpl(hiddenMenuShplId(this.session.level)).firstShapeId;
      drawMenu(target, {
        level: this.session.level,
        thumbnails: (k) => this.archive.shap(first + k),
        frame: this.archive.shap(first + 9),
        hovered: this.hoverThumb,
        pressed: this.pressedThumb,
      });
    } else if (this._board) {
      drawBoard(target, this._board.pieces, this._board.cell, { level: this._board.level, photo: this.archive.shap(this.photoId), shapes: this.shapes, skip });
    }
  }

  /** Recompose la surface de jeu : contenu, boutons, puis la pièce tenue au-dessus de tout. */
  private repaint(): void {
    const { screen } = this.services.graphics;
    const { gadgets, pointer } = this.services;
    const held = (pointer.carried?.item as HiddenPiece | undefined) ?? null;
    this.paintContent(screen, this.showing, held);
    gadgets.invalidate();
    gadgets.draw(screen);
    if (held && this._board) drawFloatingPiece(screen, held, this._board.level, this._board.cell, this.shapes);
    this.ctx.requestPresent();
  }

  /** Compose l'écran cible d'une transition dans `work` (boutons de repos compris : les gadgets ne dessinent que sur l'écran). */
  private paintWork(view: "menu" | "board"): void {
    this.paintContent(this.work, view, null);
    for (const def of HIDDEN_BUTTONS) {
      drawShape(this.work, this.archive.shap(this.shapeIdOf(HIDDEN_BUTTONS_SHPL, def.shapes[0])), def.edges[0], def.edges[1], 8);
    }
  }

  private beginTransition(rect: Rect, ticks: number, target: "menu" | "board", done: () => void): void {
    this.paintWork(target);
    this.transition = { blinds: new Blinds(rect, ticks), target, done, age: 0 };
    this._phase = "transition";
    this.dirty = false;
    this.hoverThumb = this.pressedThumb = -1;
  }

  private tickTransition(ctx: SceneContext): void {
    const t = this.transition;
    if (!t) return;
    // Un clic achève la transition d'un coup (`1018:0889`).
    const skip = t.age++ > 0 && ctx.input.buttonEvents.some((event) => event.down);
    const rects = skip ? t.blinds.finish() : t.blinds.step();
    if (rects.length > 0) {
      revealRects(this.services.graphics.screen, this.work, rects);
      ctx.requestPresent();
    }
    if (!t.blinds.done) return;
    this.transition = null;
    this.showing = t.target;
    t.done();
    this.repaint();
  }

  private loadMenuPalette(level: number): void {
    this.services.graphics.palette.loadShpl(this.archive.shpl(hiddenMenuShplId(level)));
  }

  // --- Menu, niveau, lancement ---

  private pressLevel(level: number): void {
    const wasMenu = this.session.mode === "menu";
    if (!this.session.pressLevel(level)) return;
    // Depuis un puzzle : écran entier ; au menu : la télé seule (hidden.md §3.3).
    this.beginTransition(wasMenu ? HIDDEN_TV_WITH_BORDERS : HIDDEN_SCREEN, wasMenu ? MENU_BLINDS_TICKS : SCREEN_BLINDS_TICKS, "menu", () => {
      this._board = null;
      this._rewardScr = this._jingleSnd = null;
      this.loadMenuPalette(this.session.level);
      this._phase = "menu";
    });
  }

  private beginLaunch(k: number): void {
    if (this._phase !== "menu" || !this.session.select(k)) return;
    this.launchSound = this.services.sound.playSound(this.archive, HIDDEN_SND.thumbClick);
    this._phase = "launching";
    this.hoverThumb = this.pressedThumb = -1;
  }

  private finishLaunch(): void {
    const { session, ctx } = this;
    const level = session.level;
    const k = session.puzzle!;
    const { puzzId } = this.selection.draw(level, ctx.rng);
    const board = new HiddenBoard(level, parseHiddenPuzz(this.archive.raw("PUZZ", puzzId)));
    // Ordre des tirages de l'original : découpage, jingle (18eb), puis dispersion (0c67).
    this._jingleSnd = hiddenEndJingle(ctx.rng);
    board.scatter(ctx.rng);
    this._board = board;
    this.photoId = hiddenPhotoShplId(level, k);
    this._rewardScr = hiddenRewardId(level, k);
    this.attach(board);
    this.beginTransition(HIDDEN_SCREEN, SCREEN_BLINDS_TICKS, "board", () => {
      this.services.graphics.palette.loadShpl(this.archive.shpl(this.photoId));
      this._phase = "playing";
    });
  }

  // --- Pièces ---

  private attach(board: HiddenBoard): void {
    const { pointer, sound } = this.services;
    this.detachBoard?.();
    this.detachBoard = attachBoard(pointer, board, {
      picked: () => {
        if (!this.suppressPickSound) sound.playSound(this.archive, HIDDEN_SND.pick);
        this.dirty = true;
      },
      moved: () => {
        this.dirty = true;
      },
      dropped: (_piece, outcome) => {
        // Le son de dépose n'existe qu'en cliquer-poser (en glisser, le relâchement dépose sans son).
        if (pointer.mode === "clickAndStick") sound.playSound(this.archive, HIDDEN_SND.drop);
        this.dirty = true;
        if (outcome.complete) this.beginEnding();
      },
    });
    // Les pièces ne se prennent que pendant le jeu, hors aide.
    const inner = pointer.source!;
    pointer.source = { pick: (x, y, event) => (this.piecesActive() ? inner.pick(x, y, event) : null) };
  }

  private canRotate(): boolean {
    return this._board !== null && this.piecesActive();
  }

  /** Rotate / Espace : quart de tour horaire de la dernière pièce prise, tenue ou non (hidden.md §1.6). */
  private rotate(): void {
    const board = this._board;
    if (!board) return;
    const { pointer, sound } = this.services;
    const carried = pointer.carried;
    sound.playSound(this.archive, HIDDEN_SND.rotate);
    const outcome = board.rotateLast(carried !== null);
    if (carried) this.recarry(carried.item as HiddenPiece, carried.button);
    this.dirty = true;
    if (outcome?.complete) this.beginEnding();
  }

  /** La pièce tournée a une autre taille : le port est repris avec le décalage de prise recalculé, pour qu'elle ne saute pas au prochain mouvement. */
  private recarry(piece: HiddenPiece, button: "left" | "right" | "middle"): void {
    const board = this._board!;
    const { input } = this.ctx;
    const b = board.boundsOf(piece);
    this.suppressPickSound = true;
    try {
      this.services.pointer.carry(
        { item: piece, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, grab: { x: input.mouseX - b.left, y: input.mouseY - b.top } },
        button,
        input.mouseX,
        input.mouseY,
      );
    } finally {
      this.suppressPickSound = false;
    }
  }

  // --- Fin, récompense, rejouer ---

  private beginEnding(): void {
    if (this._phase !== "playing") return;
    const { sound } = this.services;
    this.session.markSolved();
    sound.stopMusic();
    this.jingleHandle = this._jingleSnd === null ? null : sound.playSound(this.archive, this._jingleSnd);
    this._phase = "jingle";
  }

  private startReward(): void {
    const id = this._rewardScr;
    if (id === null || !this._board) return;
    const { graphics, scr } = this.services;
    // Palette de l'animation, photo entière sur la télé (sans les bordures des pièces), puis l'animation (bloquante, non interruptible).
    graphics.palette.loadShpl(this.archive.shpl(id));
    drawCleanPhoto(graphics.screen, this.backdrop, this.archive.shap(this.photoId));
    this.ctx.requestPresent();
    this._phase = "reward";
    scr.start(this.archive, id, {
      flags: SCR_FLAG.waitSounds,
      blocking: true,
      onEnd: () => {
        if (this._phase !== "reward") return;
        this._phase = "solved";
        this.ensureMusic();
      },
    });
  }

  /** Clic sur la télé quand le puzzle est fini : l'animation est rejouée, puis la musique reprend (hidden.md §1.8). */
  private replay(): void {
    if (this._phase !== "solved") return;
    this.services.sound.stopMusic();
    this.startReward();
  }

  // --- Reset ---

  private beginReset(): void {
    if (this.session.mode === "menu" || !this._board || (this._phase !== "playing" && this._phase !== "solved")) return;
    this.services.sound.playSound(this.archive, HIDDEN_SND.reset);
    this.resetTicks = 0;
    this._phase = "resetting";
  }

  private finishReset(): void {
    const board = this._board;
    if (!board) return;
    // Même découpage, nouvelle dispersion (pas de nouveau tirage), pièces réactivées.
    this.session.reset();
    board.scatter(this.ctx.rng);
    this.beginTransition(HIDDEN_SCREEN, SCREEN_BLINDS_TICKS, "board", () => {
      this.services.graphics.palette.loadShpl(this.archive.shpl(this.photoId));
      this.ensureMusic();
      this._phase = "playing";
    });
  }

  // --- Poly, musique, sortie ---

  private polyClosed(): void {
    // Poly est partie : fond rétabli par les ports ; les boutons sont redessinés dans leur état courant, la musique reprend.
    this.services.gadgets.invalidate();
    this.ensureMusic();
    this.ctx.requestPresent();
  }

  private ensureMusic(): void {
    const { sound } = this.services;
    if (!sound.musicPlaying) sound.playMusic(this.archive, HIDDEN_MUSIC_SND, { loop: true, ambient: true });
  }

  /** Exit (bouton 7) : fondu au noir puis retour au hub (`scene_hidden_exit`, `1030:0364`). */
  private leaveToHub(): void {
    if (this._phase === "leaving") return;
    this._poly?.abort();
    this.services.scr.stopAll(true);
    this.services.pointer.cancel();
    this.transition = null;
    this.services.graphics.palette.fadeToBlack(LEAVE_FADE_TICKS);
    this._phase = "leaving";
  }
}

export function createHiddenScene(services: MathServices): HiddenScene {
  return new HiddenSceneImpl(services);
}
