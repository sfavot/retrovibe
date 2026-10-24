/**
 * Super Sticklers (scène 6, `STICKLER.DAT`) : puzzle de lignes. Étude : `docs/mathemagique/screens/sticklers.md`, section « Implémentation ».
 *
 * Machine à états : menu de 9 vignettes par niveau → puzzle (fragments 1 bit teintés, glissés ou cliqués-posés, collés à ≤ 10 px dans la bonne
 * orientation) → récompense (`SCR` 8000 + 50 × (9 × niveau + puzzle), bloquante, rejouable en cliquant le chevalet). Aucune écriture du masque
 * de réussites : seul le drapeau « Poly a déjà présenté le jeu » du roster est posé (enregistré à la sortie).
 *
 * Les règles (collage, éparpillement, rotation) sont dans `SticklersBoard` (`game/puzzle-kit.ts`) ; la scène fait le rendu, les sons, les groupes
 * de gadgets et l'aide de Poly. Aucune copy visible : tout est dessin ou audio.
 */
import { drawShape } from "../engine/graphics/blit";
import { Surface, intersectRect, type Rect } from "../engine/graphics/surface";
import { type GadgetGroup, type GadgetSpec } from "../engine/gadgets";
import type { Archive } from "../engine/resources";
import { SCR_FLAG, type AnimationHandle } from "../engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";
import { ScreenTransition } from "./screen-transition";
import type { KeyEvent } from "../engine/input";
import { PUZZLES_PER_LEVEL, parseSticklersPuzz, puzzId, rewardId, sticklersMenuShplId } from "../game/puzz";
import { PolyHelper, createScrPolyPorts, openPolyArchive, rosterIntroFlag } from "../game/poly";
import { POLY_ZONE, STICKLERS_POLY } from "../game/poly-config";
import {
  type CarriableBoard,
  PuzzleSession,
  type PuzzleMode,
  SticklersBoard,
  THUMB_LAYOUTS,
  attachBoard,
  thumbHoverFrame,
  thumbRect,
  type StickPiece,
} from "../game/puzzle-kit";
import {
  ARCHIVE,
  BACKGROUND_SHPL,
  BUTTON_EDGES,
  BUTTON_ROLES,
  CYCLE,
  EASEL,
  HitHysteresis,
  INK_HOVER,
  INK_PIECE,
  INTRO_SCR,
  MINIATURE_AT,
  MUSIC_SND,
  BUTTON_PRESSED_EDGES,
  SCATTER,
  SND,
  buttonShapeId,
  edgesRect,
  inkThumbFrame,
  partialShpl,
  pieceRect,
  piecePixelHit,
  polyZoneOfButton,
  unionRect,
  type ButtonRole,
} from "./sticklers-view";

/** Photographie de l'état pour les tests et le débogage (ne sert pas à la scène). */
export interface SticklersSnapshot {
  mode: "menu" | "playing" | "solved";
  level: number;
  puzzle: number | null;
  /** Fragments dans l'ordre d'empilement (rang 0 = dessus), `[]` au menu. */
  pieces: readonly StickPiece[];
  /** `SCR` de récompense en cours, ou `null`. */
  reward: number | null;
  polyPhase: string;
  /** Ids des scripts de Poly lancés pendant cette visite. */
  polyPlayed: readonly number[];
  hoverThumb: number;
  /** Stores vénitiens en cours (gadgets et fragments gelés). */
  transitioning: boolean;
}

export interface SticklersScene extends Scene {
  inspect(): SticklersSnapshot;
}

const FULL: Rect = { x: 0, y: 0, w: 576, h: 432 };
/** Stores vénitiens de `1018:09b8` (bandes de 10 lignes) : 15 ticks sur le chevalet (`1df8`), 30 ticks sur l'écran entier (`8bce`). */
const EASEL_BLINDS_TICKS = 15;
const SCREEN_BLINDS_TICKS = 30;
const INTRO_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.restoreBackground;
/** Récompense : fond sauvegardé, interruptible par un clic (avance rapide jusqu'à la dernière image), attend la fin des sons. */
const REWARD_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.interruptible | SCR_FLAG.fastForwardOnInterrupt | SCR_FLAG.waitSounds;

export function createSticklersScene(services: MathServices): SticklersScene {
  const { graphics, sound, scr, gadgets, pointer } = services;
  const { screen, palette } = graphics;

  // --- État ---
  let ctx!: SceneContext;
  let archive!: Archive;
  let polly!: Archive;
  const session = new PuzzleSession();
  let board: SticklersBoard | null = null;
  let shplFirst = 0;
  let poly: PolyHelper | null = null;
  let helpGroup: GadgetGroup | null = null;
  let buttonsGroup!: GadgetGroup;
  let thumbsGroup!: GadgetGroup;
  let replayGroup!: GadgetGroup;
  /** Arrière-plan fixe (SHPL 104) et composition statique : fond + boutons + gabarit ou vignettes. L'écran = base + fragments / cadre de survol. */
  const background = new Surface();
  const base = new Surface();
  const hysteresis = new HitHysteresis();
  let hoverThumb = -1;
  let hoverPiece: StickPiece | null = null;
  /** Rectangle du fragment porté tel que dessiné la dernière fois. */
  let heldRect: Rect | null = null;
  let regrabbing = false;
  let reward: AnimationHandle | null = null;
  let sceneSnapshot: Uint8Array | null = null;
  let leaving = false;
  let rewardPending = false;
  const transition = new ScreenTransition(screen);

  // --- Formes ---
  const shapeOf = (piece: StickPiece) => archive.shap(shplFirst + piece.shapeBase + piece.rotation);
  const sizeOf = (index: number) => {
    const shape = archive.shap(shplFirst + index);
    return { w: shape.width, h: shape.height };
  };

  // --- Composition ---
  function drawOverlay(): void {
    if (session.mode === "menu") {
      if (hoverThumb >= 0) {
        const frame = thumbHoverFrame(THUMB_LAYOUTS.sticklers, hoverThumb);
        drawShape(screen, archive.shap(sticklersMenuShplId(session.level) + 9), frame.x, frame.y, 8, inkThumbFrame(session.level));
      }
      return;
    }
    if (!board) return;
    const ink = (piece: StickPiece) => (piece === hoverPiece ? INK_HOVER : INK_PIECE);
    // Les fragments collés font partie du dessin ; les libres passent dessus, le rang 0 (testé en premier à la prise) au-dessus de tous.
    const pieces = board.pieces;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const piece = pieces[i]!;
      if (piece.placed) drawShape(screen, shapeOf(piece), pieceRect(piece).x, pieceRect(piece).y, 8, ink(piece));
    }
    for (let i = pieces.length - 1; i >= 0; i--) {
      const piece = pieces[i]!;
      if (!piece.placed) drawShape(screen, shapeOf(piece), pieceRect(piece).x, pieceRect(piece).y, 8, ink(piece));
    }
  }

  function compose(rect: Rect): void {
    const r = intersectRect(rect, FULL);
    if (r.w <= 0 || r.h <= 0) return;
    screen.copyFrom(base, r, r.x, r.y);
    screen.pushClip(r);
    try {
      drawOverlay();
    } finally {
      screen.popClip();
    }
    ctx.requestPresent();
  }

  function composeAll(extra: readonly Rect[] = []): void {
    compose(EASEL);
    compose(SCATTER);
    for (const r of extra) compose(r);
  }

  const resetBase = (rect: Rect) => base.copyFrom(background, rect, rect.x, rect.y);

  function paintMenuBase(): void {
    resetBase(EASEL);
    resetBase(SCATTER);
    const first = sticklersMenuShplId(session.level);
    for (let k = 0; k < 9; k++) {
      const r = thumbRect(THUMB_LAYOUTS.sticklers, k);
      drawShape(base, archive.shap(first + k), r.x, r.y, 0);
    }
    palette.loadShpl(partialShpl(archive.shpl(first)));
  }

  function paintPuzzleBase(id: number, puzz: { templateX: number; templateY: number }): void {
    resetBase(EASEL);
    resetBase(SCATTER);
    drawShape(base, archive.shap(id), puzz.templateX, puzz.templateY, 0);
    if (session.level === 2) drawShape(base, archive.shap(id + 1), MINIATURE_AT.x, MINIATURE_AT.y, 0);
    palette.loadShpl(partialShpl(archive.shpl(id)));
  }

  // --- Sons et musique ---
  const play = (id: number) => void sound.playSound(archive, id);

  function startMusic(): void {
    if (!sound.musicPlaying) sound.playSound(archive, MUSIC_SND, { loop: true, ambient: true });
  }

  // --- Groupes ---
  function syncGroups(): void {
    const open = !(poly?.active ?? false) && !transition.active;
    buttonsGroup.active = open;
    thumbsGroup.active = open && session.mode === "menu";
    replayGroup.active = open && session.mode === "solved";
  }

  const piecesActive = () => board !== null && session.piecesEnabled && !(poly?.active ?? false) && !scr.blocking && !transition.active;

  // --- Puzzle ---
  function restoreScenePalette(): void {
    palette.stopCycles(false);
    if (sceneSnapshot) {
      palette.restore(sceneSnapshot);
      sceneSnapshot = null;
    }
  }

  function dirtyOfPieces(): Rect[] {
    return board ? board.pieces.map(pieceRect) : [];
  }

  /**
   * Lance des stores vénitiens sur `rect` : `apply` compose l'état suivant sur l'écran (boutons redessinés compris, ils sont dans la zone de
   * l'écran entier), `done` conclut ou enchaîne la transition suivante. Gadgets et fragments sont gelés tant qu'elle dure.
   */
  function blinds(rect: Rect, ticks: number, apply: () => void, done: () => void): void {
    gadgets.updatePointer(-1, -1);
    transition.begin(
      rect,
      ticks,
      () => {
        apply();
        gadgets.invalidate();
        gadgets.draw(screen);
      },
      done,
    );
    syncGroups();
  }

  function endTransition(): void {
    syncGroups();
    gadgets.invalidate();
    ctx.requestPresent();
  }

  /**
   * Menu du niveau courant (`1048:0816`). Depuis un puzzle, le chevalet est d'abord effacé (écran entier en 30 ticks si les fragments étaient
   * actifs ou si le niveau quitté est le rouge, dont la miniature est dans la zone de dispersion ; chevalet en 15 ticks sinon), puis les
   * vignettes sont révélées sur le chevalet en 15 ticks. Depuis le menu (autre niveau) : seulement les vignettes.
   */
  function showMenu(previous: PuzzleMode, previousLevel: number): void {
    rewardPending = false;
    const old = dirtyOfPieces();
    pointer.cancel();
    stopReward();
    board = null;
    hoverPiece = null;
    heldRect = null;
    hoverThumb = -1;
    const revealMenu = () =>
      blinds(
        EASEL,
        EASEL_BLINDS_TICKS,
        () => {
          // Hypothèse : la palette change au début de la dernière transition (l'original fait un fondu `10a8:0dc4` autour d'elle).
          restoreScenePalette();
          paintMenuBase();
          composeAll(old);
        },
        endTransition,
      );
    if (previous === "menu") {
      revealMenu();
      return;
    }
    const full = previous === "playing" || previousLevel >= 2;
    blinds(
      full ? FULL : EASEL,
      full ? SCREEN_BLINDS_TICKS : EASEL_BLINDS_TICKS,
      () => {
        resetBase(EASEL);
        resetBase(SCATTER);
        composeAll(old);
      },
      revealMenu,
    );
  }

  function startPuzzle(k: number): void {
    if (!session.select(k)) return;
    const id = puzzId(session.level, k);
    const puzz = parseSticklersPuzz(archive.raw("PUZZ", id));
    shplFirst = archive.shpl(id).firstShapeId;
    hysteresis.reset();
    board = new SticklersBoard(session.level, puzz, sizeOf, (piece, x, y) => hysteresis.test(piece, shapeOf(piece), x, y));
    board.scatter(ctx.rng);
    hoverThumb = -1;
    hoverPiece = null;
    heldRect = null;
    attachBoard<StickPiece>(pointer, gate(board), {
      picked(piece) {
        if (!regrabbing) play(SND.grab);
        hoverPiece = null;
        const now = pieceRect(piece);
        compose(heldRect ? unionRect(heldRect, now) : now);
        heldRect = now;
      },
      moved(piece) {
        const now = pieceRect(piece);
        compose(heldRect ? unionRect(heldRect, now) : now);
        heldRect = now;
      },
      dropped(piece, outcome) {
        if (pointer.mode === "clickAndStick") play(SND.drop);
        const now = pieceRect(piece);
        compose(heldRect ? unionRect(heldRect, now) : now);
        heldRect = null;
        if (outcome.complete) win();
      },
    });
    // `1048:0556` : le puzzle est composé puis révélé sur le chevalet en 15 ticks ; la zone de dispersion apparaît tout de suite.
    blinds(
      EASEL,
      EASEL_BLINDS_TICKS,
      () => {
        paintPuzzleBase(id, puzz);
        composeAll();
      },
      endTransition,
    );
  }

  /** Le plateau, sans prise tant que l'aide est ouverte, qu'une animation bloque ou que le puzzle est fini. */
  function gate(inner: SticklersBoard): CarriableBoard<StickPiece> {
    return {
      pickAt: (x, y) => (piecesActive() ? inner.pickAt(x, y) : null),
      lift: (piece) => inner.lift(piece),
      moveTo: (piece, x, y) => inner.moveTo(piece, x, y),
      drop: (piece) => inner.drop(piece),
    };
  }

  function win(): void {
    session.markSolved();
    hoverPiece = null;
    // La récompense démarre au `tick` de la scène, après les crochets de services : une touche (Espace qui colle le dernier fragment) arrive
    // avant eux et interromprait aussitôt l'animation bloquante (drapeau « interruptible »).
    rewardPending = true;
    syncGroups();
  }

  function startReward(): void {
    if (!board || reward) return;
    sceneSnapshot ??= palette.snapshot();
    const id = rewardId(session.level, session.puzzle ?? 0);
    palette.loadShpl(archive.shpl(id));
    sound.stopMusic();
    reward = scr.playBlocking(
      archive,
      id,
      {
        flags: REWARD_FLAGS,
        onHook: (hook, arg) => {
          if (hook !== 0) return;
          if (arg === 0) palette.startCycle(CYCLE);
          else palette.stopCycles(false);
        },
      },
      () => {
        reward = null;
        palette.stopCycles(false);
        startMusic();
      },
    );
    ctx.requestPresent();
  }

  function stopReward(): void {
    if (!reward) return;
    const handle = reward;
    reward = null;
    if (handle.state === "running") handle.interrupt();
  }

  function reset(): void {
    if (!board || session.mode === "menu") return;
    rewardPending = false;
    play(SND.reset);
    const wasSolved = session.mode === "solved";
    pointer.cancel();
    stopReward();
    session.reset();
    hoverPiece = null;
    heldRect = null;
    // `1048:0cf8` : fragments redispersés, révélés sur l'écran entier en 30 ticks.
    blinds(
      FULL,
      SCREEN_BLINDS_TICKS,
      () => {
        if (wasSolved) {
          restoreScenePalette();
          palette.loadShpl(partialShpl(archive.shpl(puzzId(session.level, session.puzzle ?? 0))));
        }
        const old = dirtyOfPieces();
        hysteresis.reset();
        board!.scatter(ctx.rng);
        composeAll([...old, ...dirtyOfPieces()]);
      },
      endTransition,
    );
  }

  /** Espace / Rotate (`1048:1509`) : le fragment tenu, sinon le dernier saisi, s'il n'est pas collé. */
  function rotate(): void {
    if (!board || !piecesActive()) return;
    const piece = board.pieces[0];
    if (!piece || piece.placed) return;
    play(SND.rotate);
    const before = pieceRect(piece);
    const carried = pointer.carried;
    const outcome = board.rotateLast(carried !== null);
    const after = pieceRect(piece);
    hoverPiece = null;
    compose(unionRect(heldRect ?? before, unionRect(before, after)));
    if (carried) {
      // Le centre ne bouge pas : le fragment tenu est repris avec son nouveau rectangle pour que la souris le garde sous le même point.
      heldRect = after;
      regrabbing = true;
      try {
        pointer.carry({ item: piece, x: after.x, y: after.y, width: after.w, height: after.h }, carried.button, ctx.input.mouseX, ctx.input.mouseY);
      } finally {
        regrabbing = false;
      }
    } else {
      heldRect = null;
      if (outcome?.complete) win();
    }
  }

  // --- Boutons ---
  function onButton(index: number): void {
    const role: ButtonRole = BUTTON_ROLES[index - 1]!;
    switch (role) {
      case "level1":
      case "level2":
      case "level3":
        {
          const previous = session.mode;
          const previousLevel = session.level;
          if (session.pressLevel(Number(role.slice(5)) - 1)) showMenu(previous, previousLevel);
        }
        break;
      case "help":
        openHelp();
        break;
      case "reset":
        reset();
        break;
      case "rotate":
        rotate();
        break;
      case "exit":
        leaveToHub();
        break;
    }
  }

  function leaveToHub(): void {
    if (leaving) return;
    leaving = true;
    ctx.scenes.request(SceneId.hub);
  }

  // --- Aide de Poly ---
  function helpZones(): { zone: string; spec: GadgetSpec }[] {
    const zones: { zone: string; spec: GadgetSpec }[] = [];
    const polyZone = STICKLERS_POLY.polyZone!;
    zones.push({ zone: POLY_ZONE, spec: { rect: edgesRect(polyZone) } });
    if (board) {
      for (const piece of board.pieces) {
        zones.push({ zone: "piece", spec: { rect: pieceRect(piece), hit: (x, y) => piecePixelHit(piece, shapeOf(piece), x, y) } });
      }
    }
    BUTTON_EDGES.forEach((edges, i) => zones.push({ zone: polyZoneOfButton(BUTTON_ROLES[i]!), spec: { rect: edgesRect(edges) } }));
    zones.push({ zone: "screen", spec: { rect: EASEL } });
    return zones;
  }

  let helpZoneKeys: string[] = [];

  function openHelp(): void {
    if (!poly || poly.active) return;
    pointer.cancel();
    const zones = helpZones();
    helpZoneKeys = zones.map((z) => z.zone);
    helpGroup = gadgets.addGroup({
      id: "help",
      records: zones.map((z) => ({ ...z.spec, focusable: false })),
      onActivate: (index) => {
        poly?.click(helpZoneKeys[index - 1]!, { menuShown: session.mode === "menu" });
      },
    });
    poly.open({ menuShown: session.mode === "menu" });
    syncGroups();
  }

  function closeHelp(): void {
    if (helpGroup) gadgets.removeGroup(helpGroup);
    helpGroup = null;
    helpZoneKeys = [];
    syncGroups();
    startMusic();
  }

  // --- Scène ---
  return {
    async load(c) {
      await c.resources.open(ARCHIVE);
      await openPolyArchive(c.resources, STICKLERS_POLY);
    },

    enter(c) {
      ctx = c;
      archive = c.resources.require(ARCHIVE);
      polly = c.resources.require(STICKLERS_POLY.archive);
      leaving = false;
      rewardPending = false;
      transition.cancel();
      session.level = 0;
      session.puzzle = null;
      session.mode = "menu";
      board = null;
      hoverThumb = -1;
      hoverPiece = null;
      heldRect = null;
      reward = null;
      sceneSnapshot = null;
      helpGroup = null;
      services.useArchive(archive);
      pointer.cursor.setBase("arrow");

      // Fond, menu du niveau vert. Les boutons (formes « normal » et « appuyé ») sont posés par les gadgets sur le fond vide.
      background.fill(0);
      drawShape(background, archive.shap(BACKGROUND_SHPL), 0, 0, 0);
      palette.loadShpl(archive.shpl(BACKGROUND_SHPL));
      base.copyFrom(background);
      paintMenuBase();

      buttonsGroup = gadgets.addGroup({
        id: "buttons",
        records: BUTTON_EDGES.map((edges, i) => ({
          rect: edgesRect(edges),
          shapes: { normal: buttonShapeId(i, false), pressed: buttonShapeId(i, true) },
          pressedRect: edgesRect(BUTTON_PRESSED_EDGES[i]!),
          pressSound: SND.buttons[i],
        })),
        onActivate: (index) => onButton(index),
      });
      thumbsGroup = gadgets.addGroup({
        id: "thumbs",
        records: Array.from({ length: PUZZLES_PER_LEVEL }, (_, k) => ({ rect: thumbRect(THUMB_LAYOUTS.sticklers, k), pressSound: SND.grab })),
        onActivate: (index) => startPuzzle(index - 1),
      });
      replayGroup = gadgets.addGroup({
        id: "replay",
        records: [{ rect: EASEL, focusable: false }],
        active: false,
        onActivate: () => {
          if (session.mode === "solved" && !(poly?.active ?? false)) startReward();
        },
      });

      poly = new PolyHelper(STICKLERS_POLY, {
        ports: createScrPolyPorts({ config: STICKLERS_POLY, scr, archive: polly, surface: screen, cursor: pointer.cursor, onDirty: () => c.requestPresent() }),
        rng: c.rng,
        introFlag: rosterIntroFlag(c.roster, STICKLERS_POLY.introFlag),
        onClosed: closeHelp,
      });

      // Tout l'écran : la surface partagée garde l'image de la scène précédente (le hub), seul le décor de la SHPL 104 la remplace.
      compose(FULL);
      gadgets.captureBackground(screen);
      // Les boutons sont posés avant l'animation d'entrée : elle sauvegarde le fond de sa zone, qui doit les contenir.
      gadgets.draw(screen);
      palette.fadeFromBlack(30);
      startMusic();
      scr.start(archive, INTRO_SCR, { flags: INTRO_FLAGS });
      c.requestPresent();
    },

    leave(c) {
      poly?.abort();
      transition.cancel();
      services.endScene();
      if (poly?.firstIntroThisVisit) c.roster.save();
      poly = null;
      board = null;
      reward = null;
    },

    tick() {
      if (!poly) return;
      if (transition.active) {
        if (transition.tick(ctx.input.buttonEvents.some((event) => event.down))) ctx.requestPresent();
        return;
      }
      if (rewardPending) {
        rewardPending = false;
        startReward();
      }
      poly.tick();
      if (poly.active) {
        const hovered = gadgets.hovered;
        poly.hover(hovered && helpGroup && hovered.group === helpGroup ? helpZoneKeys[hovered.index - 1]! : null);
        return;
      }
      if (scr.blocking) return;
      if (session.mode === "menu") {
        const hovered = gadgets.hovered;
        const next = hovered && hovered.group === thumbsGroup ? hovered.index - 1 : -1;
        if (next !== hoverThumb) {
          const old = hoverThumb;
          hoverThumb = next;
          if (next >= 0) play(SND.thumbHover);
          for (const k of [old, next]) if (k >= 0) compose(thumbHoverFrame(THUMB_LAYOUTS.sticklers, k));
        }
        return;
      }
      if (board && session.piecesEnabled) {
        // Survol : le fragment libre sous la souris passe à la couleur d'accent, seulement si rien n'est tenu.
        let next: StickPiece | null = null;
        if (!pointer.carried) {
          const { mouseX: x, mouseY: y } = ctx.input;
          next = board.pieces.find((p) => !p.placed && piecePixelHit(p, shapeOf(p), x, y)) ?? null;
        }
        if (next !== hoverPiece) {
          const old = hoverPiece;
          hoverPiece = next;
          for (const p of [old, next]) if (p) compose(pieceRect(p));
        }
      }
    },

    exit() {
      leaveToHub();
    },

    key(event: KeyEvent) {
      if (event.code !== "Space") return false;
      // Pendant l'aide de Poly, Espace est ignoré et non consommé (`DS:32c2 ≠ 0`).
      if (poly?.active) return false;
      if (!event.repeat) rotate();
      return true;
    },

    inspect() {
      return {
        mode: session.mode,
        level: session.level,
        puzzle: session.puzzle,
        pieces: board?.pieces ?? [],
        reward: reward ? reward.scrId : null,
        polyPhase: poly?.phase ?? "closed",
        polyPlayed: poly?.played ?? [],
        hoverThumb,
        transitioning: transition.active,
      };
    },
  };
}
