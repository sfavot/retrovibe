/**
 * Rhythm Shop (scène 2, `RHYTHM.DAT` + `RSHELP.DAT` + `MIDIMPC.DAT`) : la machine Fractionaire 2000 d'Algebird.
 * Étude : `docs/mathemagique/screens/rhythm.md`, sections « Implémentation (logique) » et « Implémentation (scène) ».
 *
 * L'enfant reconstitue la mesure d'un morceau : le Teletune donne la recette, la barre entière est dans le Parts Bin, les outils Cutter / Gluer / Melder
 * fabriquent les fractions dans le Fractionator, et les pièces se glissent dans le Pattern Bin (emplacements imposés). Pattern Bin complet : le morceau
 * (MIDI à repères) est joué, les pièces s'éclairent sur les repères `a`-`x`, Algebird danse sur les repères de temps, puis une animation finale ; la
 * variante suivante du morceau est servie la fois d'après (compteur du roster).
 *
 * Les règles sont dans `game/rhythm/` (`RhythmBoard`, `ErrorLines`, `playRhythmSong`…) ; la scène fait le rendu, les sons, les gadgets, la musique et
 * l'aide de Poly. Machine à états (`RhythmState`) : `entering` (animation 21000) → `idle` ↔ `animating` (coupe, collage, fusion) / `reacting` (réplique
 * d'Algebird) / `playing` (Play Parts, Play Pattern, victoire) / `finale` / `help` → `exiting`. Les boucles bloquantes de l'original deviennent des états
 * sans entrée (groupes de gadgets inactifs, pointeur sans prise) ; un clic ou une touche interrompt la lecture.
 *
 * Aucune copy nouvelle : le Teletune affiche les noms de `STRL` 30001 et le format d'origine `(%d) %d/%d bar(s)` ; le reste est dessin et voix.
 */
import { parseFon, type FonFont } from "../engine/graphics/fon";
import { drawShape } from "../engine/graphics/blit";
import { Surface, intersectRect, type Rect } from "../engine/graphics/surface";
import { type GadgetGroup, type GadgetSpec } from "../engine/gadgets";
import type { KeyEvent } from "../engine/input";
import type { Archive } from "../engine/resources";
import { SCR_FLAG, type AnimationHandle } from "../engine/scr-player";
import { SceneId, type Scene, type SceneContext } from "../engine/scene";
import type { MathServices, SceneArchive } from "../engine/services";
import { MidiPlayer, parsePrograms, parseSysx, type ProgramEntry } from "../audio/sequencer";
import { parseSong, type Song } from "../audio/smf";
import type { Shape } from "../data/shap";
import { PolyHelper, createScrPolyPorts, openPolyArchive, rosterIntroFlag, type PolyPorts } from "../game/poly";
import { LEVEL_COUNT, SONGS_PER_LEVEL, SONG_COUNT, type Plst, type SongInfo, loadPlst, loadSongList, songIndex } from "../game/rhythm/data";
import { ErrorLines } from "../game/rhythm/errors";
import { ALGEBIRD_HELP_SCR, RHYTHM_HELP_ZONES, RHYTHM_POLY } from "../game/rhythm/help-config";
import { RhythmBoard, currentVariant, nextVariant, recipeTexts, type DropResult, type Held } from "../game/rhythm/logic";
import { BIN_EDGES, TOOL_BUTTONS, binContains, type BinId, pieceIndexAt, pieceShapeId } from "../game/rhythm/pieces";
import { partsTimeline, playRhythmSong, songBeats, songBpm, type RhythmCue } from "../game/rhythm/song";
import { DANCE_SHPL, type DancePlan, dancePoses, planDance, poseShapeId } from "./rhythm-dance";
import {
  ALGEBIRD_CLEAN,
  ALGEBIRD_EDGES,
  ALGEBIRD_AT,
  ARCHIVE,
  BACKGROUND_SHAP,
  BUTTONS,
  CUT_FRAMES,
  ENTRY_SCR,
  FONT_MEDIUM,
  FONT_SMALL,
  GLUE_FRAMES,
  GLUE_SOUND_FRAME,
  HELP_PALETTE_SHPL,
  HELP_SOUND_THRESHOLD,
  IDLE_LINES,
  IDLE_SHPL,
  IDLE_STEP_TICKS,
  IDLE_WAIT_MAX,
  IDLE_WAIT_MIN,
  MELD_SCR,
  MIDI_ARCHIVE,
  MIDI_MAP_ARCHIVE,
  NEUTRAL_POSE,
  REACTION_ZONE,
  SND,
  STOP_HAND_AT,
  STOP_HAND_SHAP,
  SYNTHETIC_BASE,
  TELETUNE_EDGES,
  TOOL_FRAME_TICKS,
  TOOL_TOP,
  TOOL_XS,
  WORK_ZONE,
  binRect,
  buttonIndex,
  cutSprites,
  drawBin,
  drawTeletune,
  edgesRect,
  glueSprites,
  pieceRect,
  rectsOverlap,
  teletuneLines,
  toolButtonShapes,
  toolRect,
  toolShapeId,
  unionRect,
  type ButtonRole,
  type Sprite,
} from "./rhythm-view";

export type RhythmState = "entering" | "idle" | "animating" | "reacting" | "playing" | "finale" | "help" | "exiting";

/** Photographie de l'état pour les tests et le débogage (ne sert pas à la scène). */
export interface RhythmSnapshot {
  state: RhythmState;
  level: number;
  /** Rang 0-14 du morceau dans le niveau. */
  slot: number;
  /** Indice global 0-44. */
  song: number;
  songName: string;
  /** Variante chargée (0-3). */
  variant: number;
  recipe: readonly string[];
  parts: readonly number[];
  pattern: readonly number[];
  fractionator: readonly number[];
  activeTool: number;
  /** `SCR` de réaction d'Algebird en cours (ou le dernier lancé), `null` hors réaction. */
  reaction: number | null;
  /** Tous les ids de réaction lancés pendant cette visite, dans l'ordre. */
  reactions: readonly number[];
  /** Pièce éclairée par le repère courant (Pattern Bin) ou par Play Parts (Parts Bin). */
  lit: { bin: BinId; index: number } | null;
  /** Une danse est en cours (motif complet joué) ; pose (1-174) affichée. */
  dancing: boolean;
  pose: number | null;
  dance: DancePlan | null;
  /** Mesures du morceau jouées depuis le début de la lecture. */
  measuresPlayed: number;
  /** Impulsions de Play Parts jouées pendant cette visite. */
  pulses: number;
  polyPhase: string;
  polyPlayed: readonly number[];
  /** Animation d'outil en cours. */
  tool: "cut" | "glue" | "meld" | null;
}

export interface RhythmScene extends Scene {
  inspect(): RhythmSnapshot;
}

const FULL: Rect = { x: 0, y: 0, w: 576, h: 432 };
/** Drapeaux des animations d'Algebird (`DS:119e` = 0x1b) : fond sauvegardé, MIDI gardé, interruptible, attend les sons. */
const REACTION_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.interruptible | SCR_FLAG.waitSounds;
/** Entrée (`DS:11b6` = 0x1f) : en plus, avance rapide à l'interruption. */
const ENTRY_FLAGS = REACTION_FLAGS | SCR_FLAG.fastForwardOnInterrupt;
/** Fusion (`DS:11aa` = 0x13). */
const MELD_FLAGS = SCR_FLAG.saveBackground | SCR_FLAG.keepMidi | SCR_FLAG.waitSounds;
const EXIT_FADE_TICKS = 10;
/** Clignotement de Do It (`1028:3a92`) : éteint 7 ticks, puis allumé 21. */
const BLINK_OFF_TICKS = 7;
const BLINK_PERIOD = 28;
/** Durée d'un tick de la minuterie de 4 ms du jeu, en ms. */
const GAME_TICK_MS = 4;

interface SongData {
  song: Song;
  programs: ProgramEntry[];
}

interface ToolAnimation {
  kind: "cut" | "glue" | "meld";
  frame: number;
  ticks: number;
  /** Contenu du Fractionator avant l'opération. */
  before: number[];
  size: number;
  count: number;
  handle: AnimationHandle | null;
}

interface PlayRun {
  mode: "parts" | "pattern";
  /** Victoire : la lecture est suivie de l'animation finale. */
  victory: boolean;
  /** Mesures à jouer (une seule sans danse). */
  loops: number;
  played: number;
  startedAt: number;
  /** Play Parts : début des pièces en ms depuis le départ, prochaine impulsion, fin. */
  starts: { index: number; atMs: number }[];
  next: number;
  endMs: number;
  /** Le clic qui a lancé la lecture ne l'interrompt pas. */
  fresh: boolean;
}

export function createRhythmScene(services: MathServices): RhythmScene {
  const { graphics, sound, scr, gadgets, pointer } = services;
  const { screen, palette } = graphics;

  // --- Ressources ---
  let ctx!: SceneContext;
  let archive!: Archive;
  let polly!: Archive;
  let midiArchive: Archive | null = null;
  let fonts!: { small: FonFont; medium: FonFont };
  let initMessages: Uint8Array[] = [];
  let player: MidiPlayer | null = null;
  const songCache = new Map<number, SongData | null>();
  const synthetic = new Map<number, Shape>();

  // --- Morceau ---
  let songs: SongInfo[] = [];
  const board = new RhythmBoard();
  let errors!: ErrorLines;
  let level = 0;
  let slot = 0;
  let plst: Plst | null = null;
  let variant = 0;
  let plan: DancePlan | null = null;
  /** Compteurs de variante sans joueur connecté (sinon ceux du roster). */
  const localVariants = new Array<number>(SONG_COUNT).fill(0);

  // --- État ---
  let state: RhythmState = "entering";
  let leaving = false;
  let exitFading = false;
  const background = new Surface();
  const base = new Surface();
  let teletune: ReturnType<typeof teletuneLines> = [];
  let helpHand = false;
  let heldRect: Rect | null = null;
  let lit: { bin: BinId; index: number } | null = null;
  let reaction: AnimationHandle | null = null;
  let reactionThen: (() => void) | null = null;
  const reactions: number[] = [];
  let toolAnim: ToolAnimation | null = null;
  let run: PlayRun | null = null;
  let finalAnimation = 0;
  let pulses = 0;
  let poseShape: number | null = null;
  let dancing = false;
  let danceAnchor = { step: 0, at: 0 };
  let stepsPerMeasure = 16;
  let idleWait = 0;
  let idleLine: { pose: readonly number[]; step: number; ticks: number } | null = null;
  let blink = 0;

  // --- Gadgets et aide ---
  let toolsGroup!: GadgetGroup;
  let buttonsGroup!: GadgetGroup;
  let zoneGroup!: GadgetGroup;
  let helpGroup: GadgetGroup | null = null;
  let poly: PolyHelper | null = null;

  const shapeOf = (id: number): Shape => synthetic.get(id) ?? archive.shap(id);
  const sceneArchive: SceneArchive = {
    get mohawk() {
      return archive.mohawk;
    },
    has: (tag, id) => (tag === "SHAP" && synthetic.has(id)) || archive.has(tag, id),
    shap: shapeOf,
  };

  const play = (id: number) => void sound.playSound(archive, id);

  // --- Roster ---
  const playerId = () => ctx.roster.currentPlayerId;

  function variantCounter(index: number): number {
    return playerId() !== 0 ? ctx.roster.roster.getVar(playerId(), "rhythmVariant", index) : localVariants[index]!;
  }

  function setVariantCounter(index: number, value: number): void {
    if (playerId() !== 0) ctx.roster.roster.setVar(playerId(), "rhythmVariant", value, index);
    else localVariants[index] = value;
  }

  // --- Composition ---
  /**
   * Recopie `rect` de la composition (`base`) sur l'écran, puis les boutons à leur état courant, puis la pièce portée : les animations
   * (réactions, aide) dessinent directement sur l'écran et ne passent pas par ici.
   */
  function compose(rect: Rect): void {
    const r = intersectRect(rect, FULL);
    if (r.w <= 0 || r.h <= 0) return;
    screen.copyFrom(base, r, r.x, r.y);
    screen.pushClip(r);
    try {
      for (const group of [toolsGroup, buttonsGroup]) {
        for (const record of group.records) {
          if (!record.shapes || !rectsOverlap(record.rect, r)) continue;
          const visual = gadgets.visualOf(record);
          if (visual === "hidden") continue;
          const id = gadgets.shapeIdFor(record, visual);
          if (id !== undefined) drawShape(screen, shapeOf(id), record.shapeX, record.shapeY, 8);
        }
      }
      const carried = pointer.carried;
      if (carried) drawShape(screen, shapeOf(pieceShapeId((carried.item as Held).size)), carried.x, carried.y, 8);
    } finally {
      screen.popClip();
    }
    ctx.requestPresent();
  }

  function paintBin(bin: BinId, words: readonly number[] = board.words(bin)): void {
    const rect = binRect(bin);
    base.copyFrom(background, rect, rect.x, rect.y);
    drawBin(base, shapeOf, bin, words, lit?.bin === bin ? lit.index : -1);
  }

  function refreshBin(bin: BinId, words?: readonly number[]): void {
    paintBin(bin, words);
    compose(binRect(bin));
  }

  function refreshBins(): void {
    for (const bin of ["parts", "pattern", "fractionator"] as const) paintBin(bin);
    compose({ x: 187, y: 109, w: 316, h: 250 });
  }

  function paintTeletune(): void {
    const rect = edgesRect(TELETUNE_EDGES);
    base.copyFrom(background, rect, rect.x, rect.y);
    drawTeletune(base, teletune, fonts);
  }

  /** Pose d'Algebird dans la composition (restaure le coin du fond sous la pose précédente). */
  function setPose(shapeId: number | null): void {
    poseShape = shapeId;
    base.copyFrom(background, ALGEBIRD_CLEAN, ALGEBIRD_CLEAN.x, ALGEBIRD_CLEAN.y);
    if (shapeId !== null) drawShape(base, shapeOf(shapeId), ALGEBIRD_AT.x, ALGEBIRD_AT.y, 8);
    compose(ALGEBIRD_CLEAN);
  }

  const neutralPose = () => IDLE_SHPL + NEUTRAL_POSE - 1;

  function paintAll(): void {
    base.copyFrom(background);
    paintTeletune();
    for (const bin of ["parts", "pattern", "fractionator"] as const) paintBin(bin);
    if (poseShape !== null) drawShape(base, shapeOf(poseShape), ALGEBIRD_AT.x, ALGEBIRD_AT.y, 8);
    if (helpHand) drawShape(base, shapeOf(STOP_HAND_SHAP), STOP_HAND_AT.x, STOP_HAND_AT.y, 8);
  }

  // --- Morceau courant ---
  function songData(info: SongInfo): SongData | null {
    if (songCache.has(info.index)) return songCache.get(info.index)!;
    let data: SongData | null = null;
    try {
      if (midiArchive) {
        const midi = midiArchive.midi(info.midiId);
        data = { song: parseSong(midi.smf), programs: parsePrograms(midi.programs) };
      }
    } catch {
      data = null;
    }
    songCache.set(info.index, data);
    return data;
  }

  /** Charge le morceau `slot` du niveau `level` (`1028:1774`) : variante du roster, outils, Teletune, bacs, nouvelle chorégraphie (`1028:28e0`). */
  function loadSong(): void {
    const info = songs[songIndex(level, slot)]!;
    plst = loadPlst(archive, info.plstId);
    variant = currentVariant(variantCounter(info.index), plst.variantCount);
    board.load(plst.pattern, plst.variants[variant]!);
    lit = null;
    const data = songData(info);
    plan = planDance(ctx.rng, data ? songBpm(data.song) : 120);
    stepsPerMeasure = data ? Math.min(24, Math.max(4, songBeats(data.song) * 4)) : 16;
    teletune = teletuneLines(info.name, recipeTexts(plst.pattern), fonts);
    buildToolShapes();
    paintTeletune();
    for (const bin of ["parts", "pattern", "fractionator"] as const) paintBin(bin);
    gadgets.invalidate();
    syncButtons();
    compose(FULL);
  }

  function buildToolShapes(): void {
    for (let i = 0; i < TOOL_BUTTONS; i++) {
      const shapes = toolButtonShapes(shapeOf, board.tools[i] ?? null, fonts);
      synthetic.set(toolShapeId(i, false), shapes.normal);
      synthetic.set(toolShapeId(i, true), shapes.active);
    }
  }

  function setLevel(next: number): void {
    if (next === level) return;
    level = next;
    slot = 0;
    if (playerId() !== 0) ctx.roster.roster.setVar(playerId(), "rhythmLevel", level);
    loadSong();
  }

  function stepSong(delta: number): void {
    slot = (slot + delta + SONGS_PER_LEVEL) % SONGS_PER_LEVEL;
    loadSong();
  }

  // --- Boutons ---
  const levelRole = (i: number): ButtonRole => (["level1", "level2", "level3"] as const)[i]!;

  /** États des boutons d'après le plateau : Do It / Empty / Undo, outil et niveau choisis (le dessin suit au tick). */
  function syncButtons(): void {
    const doIt = buttonsGroup.record(buttonIndex("doIt") + 1);
    doIt.disabled = !board.doItEnabled;
    doIt.selected = board.doItEnabled && board.doItReady && blink % BLINK_PERIOD < BLINK_OFF_TICKS;
    buttonsGroup.record(buttonIndex("empty") + 1).disabled = !board.canEmpty;
    buttonsGroup.record(buttonIndex("undo") + 1).disabled = !board.canUndo;
    for (let i = 0; i < LEVEL_COUNT; i++) buttonsGroup.record(buttonIndex(levelRole(i)) + 1).selected = i === level;
    for (let i = 0; i < TOOL_BUTTONS; i++) toolsGroup.record(i + 1).selected = i === board.activeToolIndex;
  }

  function syncGroups(): void {
    const open = state === "idle";
    toolsGroup.active = open;
    buttonsGroup.active = open;
    zoneGroup.active = open;
    if (helpGroup) helpGroup.active = state === "help";
  }

  function setState(next: RhythmState): void {
    state = next;
    if (next === "idle") {
      idleWait = ctx.rng.range(IDLE_WAIT_MIN, IDLE_WAIT_MAX);
      idleLine = null;
    }
    syncGroups();
  }

  function onButton(index: number): void {
    const role = BUTTONS[index - 1]!.role;
    switch (role) {
      case "playParts":
        startPlayParts();
        break;
      case "playPattern":
        startPlayPattern(false);
        break;
      case "doIt":
        doIt();
        break;
      case "empty":
        board.empty();
        refreshBins();
        break;
      case "undo":
        if (board.undo()) refreshBins();
        break;
      case "level1":
      case "level2":
      case "level3":
        setLevel(Number(role.slice(5)) - 1);
        break;
      case "help":
        openHelp();
        break;
      case "previous":
        stepSong(-1);
        break;
      case "next":
        stepSong(1);
        break;
      case "exit":
        startExit();
        break;
    }
  }

  function chooseTool(result: ReturnType<RhythmBoard["selectTool"]>): void {
    if (!result.changed) return;
    syncButtons();
    if (result.reaction) playReaction(errors.pick(result.reaction));
  }

  // --- Réactions d'Algebird ---
  function playReaction(id: number, then?: () => void): void {
    reactions.push(id);
    reactionThen = then ?? null;
    const back = state === "exiting" || state === "finale" ? state : "reacting";
    state = back;
    syncGroups();
    reaction = scr.playBlocking(archive, id, { flags: REACTION_FLAGS, soundChannel: "voice" }, () => {
      reaction = null;
      // La dernière image reste à l'écran : la composition (fond, pose neutre) reprend la main.
      compose(REACTION_ZONE);
      compose(ALGEBIRD_CLEAN);
      const next = reactionThen;
      reactionThen = null;
      if (state === "reacting" || state === "finale") setState("idle");
      next?.();
    });
    ctx.requestPresent();
  }

  // --- Do It ---
  function doIt(): void {
    const tool = board.activeTool;
    const before = [...board.fractionator];
    const result = board.doIt();
    if (!result.ok) {
      if (result.error !== null) playReaction(errors.pick(result.error, result.ratio));
      return;
    }
    if (!tool) return;
    const size = result.removed[0] ?? 0;
    toolAnim = {
      kind: tool.kind,
      frame: 0,
      ticks: 0,
      before,
      size: tool.kind === "cut" ? size : (result.added[0] ?? 0) / Math.max(1, result.removed.length),
      count: tool.kind === "cut" ? tool.n : result.removed.length,
      handle: null,
    };
    // Pendant l'animation, le Fractionator montre les pièces d'avant.
    paintBin("fractionator", before);
    setState("animating");
    if (tool.kind === "meld") {
      toolAnim.handle = scr.playBlocking(archive, MELD_SCR, { flags: MELD_FLAGS }, () => finishToolAnimation());
      ctx.requestPresent();
      return;
    }
    if (tool.kind === "cut") play(SND.cutStart);
    drawToolFrame();
  }

  function drawToolFrame(): void {
    const anim = toolAnim;
    if (!anim) return;
    let sprites: Sprite[] = [];
    if (anim.kind === "cut") sprites = cutSprites(anim.frame, anim.count, anim.size);
    else if (anim.kind === "glue") {
      if (anim.frame === GLUE_SOUND_FRAME) play(SND.gluing);
      sprites = glueSprites(anim.frame, anim.count, anim.size);
    }
    screen.copyFrom(base, WORK_ZONE, WORK_ZONE.x, WORK_ZONE.y);
    screen.pushClip(WORK_ZONE);
    try {
      for (const sprite of sprites) drawShape(screen, shapeOf(sprite.id), sprite.x, sprite.y, 8);
    } finally {
      screen.popClip();
    }
    ctx.requestPresent();
  }

  function stepToolAnimation(): void {
    const anim = toolAnim;
    if (!anim || anim.kind === "meld") return;
    if (++anim.ticks < TOOL_FRAME_TICKS) return;
    anim.ticks = 0;
    anim.frame++;
    const frames = anim.kind === "cut" ? CUT_FRAMES : GLUE_FRAMES;
    if (anim.frame >= frames || (anim.kind === "glue" && anim.frame >= GLUE_FRAMES - 1)) {
      if (anim.kind === "cut") play(SND.cutEnd);
      finishToolAnimation();
      return;
    }
    drawToolFrame();
  }

  function finishToolAnimation(): void {
    toolAnim = null;
    refreshBins();
    syncButtons();
    setState("idle");
  }

  // --- Glisser-déposer ---
  const BINS: readonly BinId[] = ["fractionator", "parts", "pattern"];

  function binAt(x: number, y: number): BinId | undefined {
    return BINS.find((bin) => binContains(bin, x, y));
  }

  function installPointer(): void {
    pointer.source = {
      pick(x, y) {
        if (state !== "idle") return null;
        const bin = binAt(x, y);
        if (!bin) return null;
        const words = [...board.words(bin)];
        const index = pieceIndexAt(bin, words, x);
        if (index < 0) return null;
        const rect = pieceRect(bin, words, index);
        const held = board.lift(bin, index);
        if (!held) return null;
        return { item: held, x: rect.x, y: rect.y, width: rect.w, height: rect.h };
      },
    };
    pointer.listener = {
      onPick(carried) {
        play(SND.pick);
        const held = carried.item as Held;
        refreshBin(held.from);
        heldRect = { x: carried.x, y: carried.y, w: carried.width, h: carried.height };
        compose(heldRect);
        syncButtons();
      },
      onMove(carried) {
        const now = { x: carried.x, y: carried.y, w: carried.width, h: carried.height };
        compose(heldRect ? unionRect(heldRect, now) : now);
        heldRect = now;
      },
      onDrop(carried, event) {
        const held = carried.item as Held;
        const x = event?.x ?? ctx.input.mouseX;
        const y = event?.y ?? ctx.input.mouseY;
        const bin = binAt(x, y);
        const result = board.drop(held, bin, bin === "pattern" ? pieceIndexAt("pattern", board.words("pattern"), x) : -1);
        const dirty = heldRect ?? { x: carried.x, y: carried.y, w: carried.width, h: carried.height };
        heldRect = null;
        refreshBins();
        compose(dirty);
        syncButtons();
        onDropResult(result);
      },
    };
  }

  function onDropResult(result: DropResult): void {
    if (result.status === "returned") {
      if (result.reason === "outside") return;
      play(SND.refused);
      if (result.error) playReaction(errors.pick(result.error.type, result.error.ratio));
      return;
    }
    if (result.bin === "pattern" && result.victory === "first") startVictory();
  }

  // --- Victoire ---
  function startVictory(): void {
    const info = songs[songIndex(level, slot)]!;
    if (plst) setVariantCounter(info.index, nextVariant(variantCounter(info.index), plst.variantCount));
    finalAnimation = errors.pickFinalAnimation();
    startPlayPattern(true);
  }

  function startFinale(): void {
    if (finalAnimation === 0) {
      setState("idle");
      return;
    }
    const id = finalAnimation;
    finalAnimation = 0;
    state = "finale";
    syncGroups();
    playReaction(id);
  }

  // --- Lecture ---
  function ensurePlayer(): MidiPlayer {
    player ??= new MidiPlayer(ctx.host.audio.midi, { now: () => ctx.host.audio.now(), initMessages });
    return player;
  }

  const audioNow = () => ctx.host.audio.now();

  function lightUp(next: { bin: BinId; index: number } | null): void {
    const old = lit;
    lit = next;
    for (const entry of [old, next]) if (entry) refreshBin(entry.bin);
  }

  function startPlayPattern(victory: boolean): void {
    if (state !== "idle") return;
    const info = songs[songIndex(level, slot)]!;
    const data = songData(info);
    if (!data) {
      if (victory) startFinale();
      return;
    }
    sound.stopMusic();
    const complete = board.complete;
    run = { mode: "pattern", victory, loops: complete && plan ? plan.measures : 1, played: 0, startedAt: audioNow(), starts: [], next: 0, endMs: 0, fresh: true };
    dancing = complete;
    danceAnchor = { step: 0, at: audioNow() };
    setState("playing");
    launchMeasure(data);
  }

  /** Joue une fois la mesure (réécrite : emplacements vides muets) ; la fin de la mesure enchaîne la suivante ou termine la lecture. */
  function launchMeasure(data: SongData): void {
    const current = run;
    if (!current) return;
    playRhythmSong(ensurePlayer(), data.song, {
      pattern: board.pattern,
      programs: data.programs,
      onCue: onCue,
      onEnd: () => {
        if (run !== current) return;
        current.played++;
        if (current.played < current.loops) launchMeasure(data);
        else finishPlay(false);
      },
    });
  }

  function onCue(cue: RhythmCue): void {
    if (!run || run.mode !== "pattern") return;
    if (cue.type === "slot") {
      if (cue.slot < board.pattern.length && board.pattern[cue.slot]! > 0) lightUp({ bin: "pattern", index: cue.slot });
      return;
    }
    if (dancing) {
      const beats = Math.max(1, songBeats(songData(songs[songIndex(level, slot)]!)!.song));
      danceAnchor = { step: run.played * stepsPerMeasure + Math.round(((cue.beat - 1) * stepsPerMeasure) / beats), at: audioNow() };
    }
  }

  function startPlayParts(): void {
    if (state !== "idle") return;
    const info = songs[songIndex(level, slot)]!;
    const data = songData(info);
    const bpm = data ? songBpm(data.song) : 170;
    const beats = data ? songBeats(data.song) : 4;
    const timeline = partsTimeline(board.parts, bpm, beats);
    const measureMs = Math.trunc((beats * 15000) / bpm) * GAME_TICK_MS;
    run = {
      mode: "parts",
      victory: false,
      loops: 1,
      played: 0,
      startedAt: ctx.host.now(),
      starts: timeline.map((entry) => ({ index: entry.index, atMs: entry.startTick * GAME_TICK_MS })),
      next: 0,
      endMs: measureMs,
      fresh: true,
    };
    dancing = false;
    setState("playing");
  }

  function stepPlayParts(current: PlayRun): void {
    const elapsed = ctx.host.now() - current.startedAt;
    while (current.next < current.starts.length && elapsed >= current.starts[current.next]!.atMs) {
      const start = current.starts[current.next++]!;
      pulses++;
      play(SND.pulse);
      lightUp({ bin: "parts", index: start.index });
    }
    if (elapsed >= current.endMs) finishPlay(false);
  }

  function stepDance(): void {
    if (!dancing || !plan || !run) return;
    const stepMs = 15000 / (songBpm(songData(songs[songIndex(level, slot)]!)!.song));
    const global = danceAnchor.step + Math.max(0, Math.floor((audioNow() - danceAnchor.at) / stepMs));
    const measure = Math.min(run.loops - 1, Math.floor(global / stepsPerMeasure));
    const pose = dancePoses(plan, measure, stepsPerMeasure)[global % stepsPerMeasure]!;
    const shape = poseShapeId(pose);
    if (shape !== poseShape) setPose(shape);
  }

  /** Fin de la lecture (`stopped` : clic ou touche). Une lecture de victoire enchaîne l'animation finale, interrompue ou non. */
  function finishPlay(stopped: boolean): void {
    const current = run;
    if (!current) return;
    run = null;
    if (current.mode === "pattern") {
      player?.stop();
      sound.stopAll();
    }
    dancing = false;
    lightUp(null);
    setPose(neutralPose());
    void stopped;
    if (current.victory) startFinale();
    else setState("idle");
  }

  // --- Bavardage d'attente (`1028:309c`, `1028:2fcc`) ---
  function stepIdle(): void {
    if (pointer.carried) return;
    if (idleLine) {
      if (++idleLine.ticks < IDLE_STEP_TICKS) return;
      idleLine.ticks = 0;
      idleLine.step++;
      const pose = idleLine.pose[idleLine.step];
      if (pose === undefined || pose === 0) {
        if (pose === 0 || idleLine.step >= idleLine.pose.length) {
          idleLine = null;
          setPose(neutralPose());
          idleWait = ctx.rng.range(IDLE_WAIT_MIN, IDLE_WAIT_MAX);
        }
        return;
      }
      setPose(IDLE_SHPL + pose - 1);
      return;
    }
    if (--idleWait > 0) return;
    const pose = IDLE_LINES[ctx.rng.rand1(IDLE_LINES.length)]!;
    idleLine = { pose, step: 0, ticks: 0 };
    setPose(IDLE_SHPL + pose[0]! - 1);
  }

  // --- Aide de Poly ---
  function openHelp(): void {
    if (!poly || state !== "idle") return;
    pointer.cancel();
    helpHand = true;
    drawShape(base, shapeOf(STOP_HAND_SHAP), STOP_HAND_AT.x, STOP_HAND_AT.y, 8);
    compose({ x: STOP_HAND_AT.x, y: STOP_HAND_AT.y, w: 25, h: 25 });
    helpGroup = gadgets.addGroup({
      id: "help",
      records: RHYTHM_HELP_ZONES.map((zone) => ({ rect: edgesRect(zone.rect), focusable: false }) satisfies GadgetSpec),
      active: false,
      onActivate: (index) => void poly?.click(RHYTHM_HELP_ZONES[index - 1]!.key),
    });
    setState("help");
    poly.open();
  }

  function closeHelp(): void {
    if (helpGroup) gadgets.removeGroup(helpGroup);
    helpGroup = null;
    helpHand = false;
    const hand = { x: STOP_HAND_AT.x, y: STOP_HAND_AT.y, w: 25, h: 25 };
    base.copyFrom(background, hand, hand.x, hand.y);
    gadgets.invalidate();
    compose(FULL);
    setState("idle");
  }

  // --- Sortie ---
  function startExit(): void {
    if (leaving || state === "exiting") return;
    pointer.cancel();
    if (poly?.active) poly.abort();
    if (helpGroup) {
      gadgets.removeGroup(helpGroup);
      helpGroup = null;
    }
    stopEverything();
    state = "exiting";
    syncGroups();
    playReaction(errors.pick(10), beginExitFade);
  }

  function beginExitFade(): void {
    palette.fadeToBlack(EXIT_FADE_TICKS);
    exitFading = true;
  }

  function stopEverything(): void {
    player?.stop();
    run = null;
    dancing = false;
    toolAnim = null;
    scr.stopAll(true);
  }

  // --- Scène ---
  return {
    async load(c) {
      const [rhythm, , midi, , small, medium] = await Promise.all([
        c.resources.open(ARCHIVE),
        openPolyArchive(c.resources, RHYTHM_POLY),
        c.resources.open(MIDI_ARCHIVE).catch(() => null),
        c.resources.open(MIDI_MAP_ARCHIVE, "persistent").then(
          (map) => {
            initMessages = parseSysx(map.raw("SYSX", 1));
          },
          () => undefined,
        ),
        c.host.loadFile(FONT_SMALL).then((bytes) => parseFon(bytes)[0]!),
        c.host.loadFile(FONT_MEDIUM).then((bytes) => parseFon(bytes)[0]!),
      ]);
      void rhythm;
      midiArchive = midi;
      fonts = { small, medium };
    },

    enter(c) {
      ctx = c;
      archive = c.resources.require(ARCHIVE);
      polly = c.resources.require(RHYTHM_POLY.archive);
      if (midiArchive) midiArchive = c.resources.require(MIDI_ARCHIVE);
      leaving = false;
      exitFading = false;
      state = "entering";
      synthetic.clear();
      songCache.clear();
      reactions.length = 0;
      reaction = null;
      reactionThen = null;
      toolAnim = null;
      run = null;
      lit = null;
      heldRect = null;
      helpHand = false;
      helpGroup = null;
      pulses = 0;
      dancing = false;
      poseShape = neutralPose();
      blink = 0;
      errors = new ErrorLines(c.rng, { noRepeat: false });
      player = null;
      services.useArchive(sceneArchive);
      pointer.cursor.setBase("arrow");

      // Palette : celle de `RSHELP.DAT` (SHPL 999, 17 entrées), puis celle de la SHPL 30000 ; fond plein écran.
      palette.loadShpl(polly.shpl(HELP_PALETTE_SHPL));
      palette.loadShpl(archive.shpl(BACKGROUND_SHAP));
      background.fill(0);
      drawShape(background, archive.shap(BACKGROUND_SHAP), 0, 0, 0);

      songs = loadSongList(archive);
      const saved = playerId() !== 0 ? c.roster.roster.getVar(playerId(), "rhythmLevel") : 0;
      level = saved >= 0 && saved < LEVEL_COUNT ? saved : 0;
      slot = 0;
      plan = null;

      // Les boutons d'outils portent des formes synthétiques (libellé peint sur les formes de la SHPL 30000) : à construire avant les groupes.
      toolsGroup = gadgets.addGroup({
        id: "tools",
        records: Array.from({ length: TOOL_BUTTONS }, (_, i) => ({
          rect: toolRect(i),
          shapes: { normal: toolShapeId(i, false), selected: toolShapeId(i, true) },
          shapeX: TOOL_XS[i]!,
          shapeY: TOOL_TOP,
          pressSound: SND.tool,
          focusable: false,
        })),
        onActivate: (index) => chooseTool(board.selectTool(index - 1)),
      });
      buttonsGroup = gadgets.addGroup({
        id: "buttons",
        records: BUTTONS.map((button) => ({
          rect: edgesRect(button.edges),
          shapes: {
            normal: button.normal,
            pressed: button.pressed,
            ...(button.disabled !== undefined ? { disabled: button.disabled, selected: button.disabled } : {}),
          },
          shapeX: button.edges[0],
          shapeY: button.edges[1],
          pressSound: button.role === "help" ? () => (c.rng.rand(99) < HELP_SOUND_THRESHOLD ? SND.helpHigh : SND.helpLow) : button.sound,
          focusable: false,
        })),
        onActivate: (index) => onButton(index),
      });
      zoneGroup = gadgets.addGroup({
        id: "algebird",
        records: [{ rect: edgesRect(ALGEBIRD_EDGES), focusable: false }],
        onActivate: () => playReaction(errors.pickAlgebirdClick()),
      });
      // Formes des boutons d'outils avant `loadSong` (qui les reconstruit) : un premier jeu vide pour que `captureBackground` les trouve.
      for (let i = 0; i < TOOL_BUTTONS; i++) {
        synthetic.set(toolShapeId(i, false), archive.shap(30064));
        synthetic.set(toolShapeId(i, true), archive.shap(30062));
      }
      void SYNTHETIC_BASE;

      installPointer();
      loadSong();
      paintAll();
      screen.copyFrom(base);
      gadgets.captureBackground(base);
      gadgets.invalidate();
      compose(FULL);

      const ports = createPorts(c);
      poly = new PolyHelper(RHYTHM_POLY, {
        ports,
        rng: c.rng,
        introFlag: rosterIntroFlag(c.roster, RHYTHM_POLY.introFlag),
        onClosed: closeHelp,
      });

      syncGroups();
      palette.fadeFromBlack(30);
      scr.playBlocking(archive, ENTRY_SCR, { flags: ENTRY_FLAGS }, () => {
        compose(FULL);
        setState("idle");
      });
      c.requestPresent();
    },

    leave(c) {
      poly?.abort();
      player?.stop();
      player = null;
      services.endScene();
      if (c.roster.currentPlayerId !== 0) c.roster.save();
      poly = null;
      palette.clearFade();
    },

    tick() {
      if (!poly) return;
      poly.tick();
      switch (state) {
        case "idle":
          blink++;
          syncButtons();
          stepIdle();
          break;
        case "animating":
          syncButtons();
          stepToolAnimation();
          break;
        case "playing":
          player?.tick();
          if (run?.mode === "parts") stepPlayParts(run);
          else stepDance();
          if (run && !run.fresh && ctx.input.buttonEvents.some((e) => e.down)) finishPlay(true);
          if (run) run.fresh = false;
          break;
        case "help": {
          const hovered = gadgets.hovered;
          poly.hover(hovered && helpGroup && hovered.group === helpGroup ? RHYTHM_HELP_ZONES[hovered.index - 1]!.key : null);
          break;
        }
        case "exiting": {
          if (!exitFading || leaving) break;
          const fade = palette.fade;
          if (!fade || fade.done) {
            leaving = true;
            ctx.scenes.request(SceneId.hub);
          }
          break;
        }
        default:
          break;
      }
    },

    exit() {
      startExit();
    },

    key(event: KeyEvent) {
      if (state === "playing") {
        if (!event.repeat) finishPlay(true);
        return true;
      }
      if (state !== "idle" || event.ctrl || event.alt) return false;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      if (digit) {
        if (!event.repeat && Number(digit[1]) - 1 !== board.activeToolIndex && board.tools[Number(digit[1]) - 1]) play(SND.tool);
        if (!event.repeat) chooseTool(board.selectTool(Number(digit[1]) - 1));
        return true;
      }
      if (event.code === "Tab") {
        if (!event.repeat) {
          const before = board.activeToolIndex;
          const result = board.nextTool();
          if (board.activeToolIndex !== before) play(SND.tool);
          chooseTool(result);
        }
        return true;
      }
      return false;
    },

    inspect() {
      const info = songs[songIndex(level, slot)];
      return {
        state,
        level,
        slot,
        song: songIndex(level, slot),
        songName: info?.name ?? "",
        variant,
        recipe: plst ? recipeTexts(plst.pattern) : [],
        parts: board.parts,
        pattern: board.pattern,
        fractionator: board.fractionator,
        activeTool: board.activeToolIndex,
        reaction: reaction ? reaction.scrId : null,
        reactions: [...reactions],
        lit,
        dancing,
        pose: poseShape !== null && poseShape >= DANCE_SHPL && poseShape < DANCE_SHPL + 174 ? poseShape - DANCE_SHPL + 1 : null,
        dance: plan,
        measuresPlayed: run?.played ?? 0,
        pulses,
        polyPhase: poly?.phase ?? "closed",
        polyPlayed: poly?.played ?? [],
        tool: toolAnim?.kind ?? null,
      };
    },
  };

  /** Ports de l'aide : les scripts sont dans `RSHELP.DAT`, sauf la zone Algebird (`SCR` 8500 de `RHYTHM.DAT`). */
  function createPorts(c: SceneContext): PolyPorts {
    const common = { config: RHYTHM_POLY, scr, surface: screen, cursor: pointer.cursor, onDirty: () => c.requestPresent() };
    const help = createScrPolyPorts({ ...common, archive: polly });
    const own = createScrPolyPorts({ ...common, archive });
    return {
      play: (id, options) => (id === ALGEBIRD_HELP_SCR ? own : help).play(id, options),
      begin: () => help.begin?.(),
      end: () => help.end?.(),
      setHelpHover: (on) => help.setHelpHover?.(on),
    };
  }
}

void BIN_EDGES;
void REACTION_ZONE;
