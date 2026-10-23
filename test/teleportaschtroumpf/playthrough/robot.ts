import { Engine } from "../../../src/games/teleportaschtroumpf/engine/engine";
import { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";
import type { Scene } from "../../../src/games/teleportaschtroumpf/engine/scene";
import type { Game } from "../../../src/games/teleportaschtroumpf/game/rules";
import type { MinigameOutcome } from "../../../src/games/teleportaschtroumpf/game/state";
import { minigameInfo } from "../../../src/games/teleportaschtroumpf/game/tables";
import type { GameScene } from "../../../src/games/teleportaschtroumpf/scenes/game";
import { createMenuScene } from "../../../src/games/teleportaschtroumpf/scenes/s07-menu";
import { SEGMENT_WIDTH, STOP_MARGIN, absoluteX, pickDoor, segmentOf, shouldJump, type DoorTarget } from "./board";
import { EDGE_RIGHT } from "../../../src/games/teleportaschtroumpf/game/tables";
import { RobotHost } from "./host";
import { Keys, pilotFor, type Pilot } from "./pilots";
import { randomPlayer } from "./random";

const FRAME_MS = 1000 / 60;

/** Réglages d'une partie du robot (voir l'en-tête de `../playthrough.test.ts`). */
export interface RobotOptions {
  seed: number;
  /** Plafond de temps simulé : au-delà, la partie est abandonnée comme « limite de ticks ». */
  maxSimSeconds: number;
  /** Écran et pixels inchangés pendant cette durée simulée : blocage (une première relance, puis l'aide ou l'abandon à 2×). */
  stuckSeconds: number;
  /** Durée simulée passée dans un mini-jeu avant d'en forcer l'issue (dernier recours). */
  forceAfterSeconds: number;
  /** Mode « coup de pouce » : l'issue de chaque mini-jeu est forcée en réussite après quelques secondes (mène à la victoire S11). */
  assist: boolean;
  debug: boolean;
  log(message: string): void;
}

export interface MinigameRecord {
  scene: number;
  mode: "pilote" | "hasard" | "forcé";
  /** Pourquoi l'issue a été forcée, le cas échéant. */
  reason?: string;
  seconds: number;
  result: string;
}

export interface SeedReport {
  seed: number;
  players: number;
  characters: number[];
  levels: number[];
  assist: boolean;
  outcome: "victoire" | "temps écoulé" | "abandon" | "limite de ticks" | "blocage" | "erreur";
  /** Temps simulé total (depuis le menu) et secondes de jeu écoulées dans la partie. */
  simSeconds: number;
  gameSeconds: number;
  frames: number;
  scenes: string[];
  minigames: MinigameRecord[];
  /** Aides forcées (issue imposée à un mini-jeu), avec la raison. */
  forced: string[];
  blockages: string[];
  notes: string[];
  returnedToMenu: boolean;
  /** La vidéo de fin attendue (S11 ou S42) a bien été lue. */
  endVideo: boolean;
  error?: string;
}

/** Arrêt de la partie sur un blocage qu'aucune aide ne lève. */
class Blocked extends Error {}

interface Playing {
  /** Scène du mini-jeu une fois en place (elle se charge d'abord, derrière un fondu) ; pilote et mode viennent avec. */
  scene: Scene | null;
  id: number;
  start: number;
  mode: "pilote" | "hasard";
  pilot: Pilot | null;
  forced?: string;
  before: { player: number; ingredients: number; points: number };
}

/** Mini-jeux sans interaction : ils rendent leur issue d'eux-mêmes. */
const SELF_PLAYING = [32, 38, 39];

/** Issue de réussite forcée, du type attendu par `Game.resolveMinigame` pour la scène. */
function successOutcome(game: Game, id: number): MinigameOutcome {
  const info = minigameInfo(id);
  switch (info?.kind) {
    case "ingredient":
      return { kind: "ingredient", success: true };
    case "points":
      return { kind: "points", points: 3 };
    case "trade":
      return { kind: "magician", choice: null };
    case "well": {
      const p = game.player;
      if (game.state.pending?.wellMode === "ingredient") {
        const missing = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => (game.state.goal.ingredients & ~p.ingredients & (1 << i)) !== 0);
        return { kind: "well", ingredient: missing ?? null };
      }
      return { kind: "well", destination: null };
    }
    default:
      return { kind: "none" };
  }
}

/**
 * Robot joueur : une partie complète, de S07 à S07, à la façon d'un joueur (entrées clavier simulées sur le moteur de test).
 * Sur le plateau il vise une porte avec les tables de `game/` ; dans un mini-jeu il joue avec le pilote s'il existe, sinon au hasard,
 * et force l'issue en dernier recours (`scene.onDone`) ou en mode « coup de pouce ».
 */
export class Robot {
  readonly host = new RobotHost();
  readonly engine: Engine;
  private readonly rng: BorlandRandom;
  private readonly keys = new Keys(this.host);
  private gameScene: GameScene | null = null;
  private frames = 0;
  private visited = new Set<string>();
  private lastTop = "";
  private playing: Playing | null = null;
  private target: DoorTarget | null = null;
  private turnRef: unknown = null;
  private turnStart = 0;
  private turnStrikes = 0;
  private nextBoardLog = 0;
  /** Ce tour, le robot saute par-dessus les pièges (sinon il les subit, comme un joueur distrait). */
  private avoidTraps = true;
  private readonly playedScenes = new Set<number>();
  /** Gestes d'un tour (pause, aide) et touches à taper dans les écrans annexes (pause, carte, aide). */
  private sideTripAt: number | null = null;
  private sideTripKind: "pause" | "help" = "pause";
  private tapQueue: string[] = [];
  private tapAt = 0;
  private tapUp: string | null = null;
  /** Passages par scène, par joueur (indice de `players` au moment du tour) : varie les portes visées. */
  private readonly visits = new Map<number, Map<number, number>>();
  private spaceUntil = 0;
  private signature = "";
  private signatureSince = 0;
  private nudged = false;
  private readonly report: SeedReport;

  constructor(private readonly options: RobotOptions) {
    this.host.audio.enabled = false;
    this.engine = new Engine(this.host, { seed: options.seed });
    this.rng = new BorlandRandom(options.seed * 7919 + 13);
    const players = 1 + (options.seed % 4);
    this.report = {
      seed: options.seed,
      players,
      characters: [],
      levels: [],
      assist: options.assist,
      outcome: "erreur",
      simSeconds: 0,
      gameSeconds: 0,
      frames: 0,
      scenes: [],
      minigames: [],
      forced: [],
      blockages: [],
      notes: [],
      returnedToMenu: false,
      endVideo: false,
    };
  }

  // --- boucle -------------------------------------------------------------------------------------

  private top(): string | undefined {
    return this.engine.ctx.scenes.top?.constructor.name;
  }

  private get busy(): boolean {
    return this.engine.loading || this.engine.ctx.scenes.transitioning || this.engine.ctx.fade.active;
  }

  private debug(message: string): void {
    if (this.options.debug) this.options.log(`  [graine ${this.options.seed} ${(this.host.time / 1000).toFixed(1)}s] ${message}`);
  }

  /** Une image à 60 Hz ; laisse passer les promesses (voix du plateau, chargements) comme `advance` de `game-helpers.ts`. */
  private async frame(): Promise<void> {
    this.host.time += FRAME_MS;
    this.engine.frame(this.host.time);
    await new Promise((resolve) => setImmediate(resolve));
    const loading = this.engine.whenLoaded;
    if (loading) await loading;
    this.frames++;
    const top = this.top();
    if (top && top !== this.lastTop) {
      this.lastTop = top;
      this.visited.add(top);
      this.debug(`scène ${top}`);
    }
    if (top === "GameScene" && !this.gameScene) this.gameScene = this.engine.ctx.scenes.top as GameScene;
  }

  private async until(done: () => boolean, label: string, limitMs = 120_000): Promise<void> {
    const end = this.host.time + limitMs;
    while (!done()) {
      if (this.host.time >= end) throw new Blocked(`${label} : condition non atteinte après ${limitMs / 1000} s simulées`);
      await this.frame();
    }
  }

  private async run(ms: number): Promise<void> {
    const end = this.host.time + ms;
    while (this.host.time < end) await this.frame();
  }

  private async settle(name: string): Promise<void> {
    await this.until(() => this.top() === name && !this.busy, `attente de ${name}`);
    await this.run(100);
  }

  private async press(code: string, ms = 100): Promise<void> {
    this.host.input.keyDown(code);
    await this.run(ms);
    this.host.input.keyUp(code);
    await this.run(100);
  }

  // --- du menu à la partie ----------------------------------------------------------------------------

  private phaseOf(): string {
    return (this.engine.ctx.scenes.top as unknown as { phase: string }).phase;
  }

  private async startGame(): Promise<void> {
    const { players } = this.report;
    await this.engine.start(createMenuScene());
    await this.settle("MenuScene");
    for (let i = 0; i < 3; i++) await this.press("ArrowDown"); // « Jouer »
    await this.press("Space");

    await this.settle("PlayersScene");
    await this.until(() => this.phaseOf() === "select", "S09 : choix");
    for (let i = 1; i < players; i++) {
      await this.press("ArrowRight");
      await this.until(() => this.phaseOf() === "select", "S09 : voix du nombre");
    }
    await this.press("Space");

    await this.settle("CharactersScene");
    for (let slot = 0; slot < players; slot++) {
      await this.until(() => this.phaseOf() === "pick", `S08 : joueur ${slot + 1}`, 60_000);
      for (let k = this.rng.below(4); k > 0; k--) await this.press(this.rng.below(2) === 0 ? "ArrowLeft" : "ArrowRight");
      for (let k = this.rng.below(3); k > 0; k--) await this.press(this.rng.below(2) === 0 ? "ArrowUp" : "ArrowDown");
      await this.press("Space");
    }
    await this.until(() => this.phaseOf() === "buttons", "S08 : boutons", 60_000);
    await this.press("Space"); // Jouer
    await this.settle("GameScene");
    const { players: list } = this.gameScene!.game.state;
    this.report.characters = list.map((p) => p.character);
    this.report.levels = list.map((p) => p.level);
    this.debug(`partie : ${list.length} joueur(s), personnages ${this.report.characters}, niveaux ${this.report.levels}, objectif ${JSON.stringify(this.gameScene!.game.state.goal)}`);
  }

  // --- plateau --------------------------------------------------------------------------------------

  private releaseBoardKeys(): void {
    this.keys.set("ArrowLeft", false);
    this.keys.set("ArrowRight", false);
    this.keys.set("ArrowUp", false);
    this.keys.set("Space", false);
  }

  /** Le joueur a la main : il marche vers sa porte, s'arrête dans sa zone et appuie. */
  private board(gs: GameScene): void {
    const game = gs.game;
    if (this.turnRef !== game.state.turn) {
      this.turnRef = game.state.turn;
      this.turnStart = this.host.time;
      this.target = null;
      this.turnStrikes = 0;
      const roll = this.rng.below(100);
      this.sideTripAt = roll < 15 ? this.host.time + 1000 + this.rng.below(8000) : null;
      this.sideTripKind = roll < 8 ? "pause" : "help";
      this.avoidTraps = this.rng.below(100) < 75;
    }
    // Un tour qui s'éternise (pion ramené en arrière par des pièges…) : nouvelle porte.
    if (this.host.time - this.turnStart > 180_000) {
      this.turnStart = this.host.time;
      this.target = null;
      this.report.notes.push(`tour très long au joueur ${game.state.current} (écran ${game.player.screen}) : nouvelle porte`);
      if (++this.turnStrikes >= 3) throw new Blocked(`le tour ne se termine pas (écran ${game.player.screen}, ${game.player.row}, x=${game.player.x})`);
    }
    if (!this.target) {
      const mine = this.visits.get(game.state.current) ?? new Map<number, number>();
      this.visits.set(game.state.current, mine);
      this.target = pickDoor(game, this.rng, mine, this.playedScenes);
      if (this.target) {
        mine.set(this.target.scene, (mine.get(this.target.scene) ?? 0) + 1);
        this.playedScenes.add(this.target.scene);
      }
      this.debug(`joueur ${game.state.current} : porte ${this.target ? `S${this.target.scene} (segment ${this.target.segment}, zone ${this.target.zone})` : "aucune"}`);
    }
    if (this.sideTripAt !== null && this.host.time >= this.sideTripAt) {
      this.sideTripAt = null;
      this.releaseBoardKeys();
      this.keys.set(this.sideTripKind === "pause" ? "KeyP" : "Enter", true);
      this.tapUp = this.sideTripKind === "pause" ? "KeyP" : "Enter";
      this.tapAt = this.host.time + 150;
      this.debug(`geste : ${this.sideTripKind === "pause" ? "pause (P)" : "aide (Entrée)"}`);
      return;
    }
    if (this.options.debug && this.host.time >= this.nextBoardLog) {
      this.nextBoardLog = this.host.time + 5000;
      const q = game.player;
      this.debug(`  plateau : écran ${q.screen} ${q.row} x=${q.x} pose=${gs.board.walker.pose} statut=${q.status} cible=${this.target?.at ?? "-"}`);
    }
    if (this.host.time < this.spaceUntil) return;
    this.keys.set("Space", false);
    const p = game.player;
    const diff = this.target ? this.target.at - absoluteX(p.screen, p.row, p.x) : 0;
    if (this.target && Math.abs(diff) > STOP_MARGIN) {
      const dir = diff > 0 ? 1 : -1;
      // Vers l'abscisse visée si la porte est dans ce segment, sinon vers le bord de l'écran.
      const sameSegment = segmentOf(p.screen, p.row) === this.target.segment;
      const toward = sameSegment ? this.target.at - this.target.segment * SEGMENT_WIDTH : dir > 0 ? EDGE_RIGHT : 0;
      const jump = this.avoidTraps && shouldJump(p.screen, p.row, p.x, dir, toward);
      this.keys.set("ArrowRight", diff > 0);
      this.keys.set("ArrowLeft", diff < 0);
      this.keys.set("ArrowUp", jump && !gs.board.walker.busy);
      return;
    }
    this.keys.set("ArrowUp", false);
    this.keys.set("ArrowRight", false);
    this.keys.set("ArrowLeft", false);
    // Appuie quand le pion est à l'arrêt (poses d'attente 0, 1, 8, 9 : ni marche, ni saut, ni arrivée).
    if ([0, 1, 8, 9].includes(gs.board.walker.pose)) {
      this.keys.set("Space", true);
      this.spaceUntil = this.host.time + 150;
    }
  }

  // --- mini-jeux -------------------------------------------------------------------------------------

  /** Le mini-jeu est ouvert (requête de la partie) : on note ses débuts, même s'il se règle trop vite pour être joué (S32, S38, S39). */
  private openRecord(gs: GameScene): void {
    const request = gs.game.state.pending!;
    const player = gs.game.state.players[request.player];
    this.playing = {
      scene: null,
      id: request.scene,
      start: this.host.time,
      mode: "hasard",
      pilot: null,
      before: { player: request.player, ingredients: player.ingredients, points: player.points },
    };
    this.debug(`mini-jeu S${request.scene} ouvert, niveau ${request.level}${request.bonus ? ", indice de l'oiseau" : ""}`);
  }

  /** La scène du mini-jeu est en place : pilote s'il existe, sinon joueur au hasard. */
  private attach(gs: GameScene, scene: Scene): void {
    const playing = this.playing!;
    // Le puits (S14) enchaîne plusieurs scènes : le pilote précédent lâche ses touches avant que le suivant prenne la main.
    playing.pilot?.release();
    let pilot: Pilot | null = null;
    try {
      pilot = pilotFor(playing.id, scene, this.host);
    } catch (error) {
      this.report.notes.push(`pilote S${playing.id} indisponible : ${String(error)}`);
    }
    playing.scene = scene;
    playing.mode = pilot ? "pilote" : "hasard";
    playing.pilot = pilot ?? randomPlayer(this.host, this.rng);
    playing.start = this.host.time;
    void gs;
    this.releaseBoardKeys();
    this.debug(`mini-jeu S${playing.id} en place (${playing.mode})`);
  }

  /** Impose une réussite : le mini-jeu rend son issue comme s'il l'avait gagnée (`onDone` de la scène). */
  private force(gs: GameScene, reason: string): void {
    const playing = this.playing!;
    const outcome = successOutcome(gs.game, playing.id);
    const scene = playing.scene as unknown as { onDone?(ctx: Engine["ctx"], outcome: MinigameOutcome): void };
    // Le puits (S14) commence par une animation qui n'a pas d'issue à rendre : on attend la scène qui la porte.
    if (typeof scene.onDone !== "function" || playing.scene?.constructor.name === "BoardEventScene") return;
    scene.onDone(this.engine.ctx, outcome);
    playing.forced = reason;
    playing.pilot?.release();
    this.report.forced.push(`S${playing.id} : ${reason}`);
    this.debug(`issue forcée S${playing.id} (${reason})`);
  }

  private minigame(gs: GameScene): void {
    const top = this.engine.ctx.scenes.top!;
    if (this.playing!.scene !== top) this.attach(gs, top);
    const playing = this.playing!;
    if (playing.forced) return;
    const seconds = (this.host.time - playing.start) / 1000;
    // Les scènes qui se jouent seules (S32, S38, S39) vont à leur terme sans aide.
    if (this.options.assist && seconds >= 4 && !SELF_PLAYING.includes(playing.id)) return this.force(gs, "coup de pouce");
    if (seconds >= this.options.forceAfterSeconds) return this.force(gs, `non terminé après ${this.options.forceAfterSeconds} s`);
    try {
      playing.pilot!.step();
    } catch (error) {
      this.report.notes.push(`pilote S${playing.id} en erreur (${String(error)}) : jeu au hasard`);
      playing.pilot?.release();
      playing.pilot = randomPlayer(this.host, this.rng);
      playing.mode = "hasard";
    }
  }

  /** Le mini-jeu est fini (la partie a appliqué son issue) : on note ce qu'il a rapporté. */
  private closeMinigame(game: Game): void {
    const playing = this.playing!;
    playing.pilot?.release();
    const { before } = playing;
    const after = game.state.players[before.player];
    const parts: string[] = [];
    if (after) {
      const gained = after.ingredients & ~before.ingredients;
      const lost = before.ingredients & ~after.ingredients;
      for (let i = 0; i < 8; i++) {
        if (gained & (1 << i)) parts.push(`ingrédient ${i}`);
        if (lost & (1 << i)) parts.push(`ingrédient ${i} perdu`);
      }
      if (after.points !== before.points) parts.push(`${after.points > before.points ? "+" : ""}${after.points - before.points} pt`);
    }
    const record: MinigameRecord = {
      scene: playing.id,
      mode: playing.forced ? "forcé" : playing.mode,
      reason: playing.forced,
      seconds: Math.round((this.host.time - playing.start) / 1000),
      result: parts.length > 0 ? parts.join(", ") : "échec / rien",
    };
    this.report.minigames.push(record);
    this.playedScenes.add(record.scene);
    this.debug(`fin S${record.scene} : ${record.result} (${record.mode}, ${record.seconds} s)`);
    this.playing = null;
  }

  // --- décision par image --------------------------------------------------------------------------

  private think(): void {
    const gs = this.gameScene;
    if (!gs?.game) return;
    const game = gs.game;
    const top = this.top();
    if (this.tapUp && this.host.time >= this.tapAt) {
      this.keys.set(this.tapUp, false);
      this.tapUp = null;
    }
    if (this.playing && game.state.phase !== "minigame") this.closeMinigame(game);
    if (!this.playing && game.state.phase === "minigame" && game.state.pending) this.openRecord(gs);
    if (game.state.phase === "over") {
      this.releaseBoardKeys();
      return;
    }
    if (top === "GameScene") {
      if (game.state.phase !== "turn" || !gs.board?.playing || this.busy) return this.releaseBoardKeys();
      return this.board(gs);
    }
    if (game.state.phase === "minigame" && !this.busy && top !== undefined) return this.minigame(gs);
    this.releaseBoardKeys();
    if (game.state.phase === "turn") this.sideScreen(top);
  }

  /**
   * Écrans annexes ouverts depuis le plateau : la pause (S48) reprend la partie, ou va à la carte (S02) ou à l'aide (S45) ; ces deux-là
   * se quittent à Échap / Espace.
   */
  private sideScreen(top: string | undefined): void {
    if (this.busy || this.host.time < this.tapAt || this.tapUp) return;
    if (top === "PauseScene" && this.tapQueue.length === 0) {
      const roll = this.rng.below(10);
      this.tapQueue = roll < 6 ? ["Space"] : roll < 8 ? ["ArrowRight", "ArrowRight", "Space"] : ["ArrowRight", "ArrowRight", "ArrowRight", "Space"];
      this.debug(`pause : ${this.tapQueue.join(" ")}`);
    } else if (top !== "PauseScene" && top !== "GameScene" && this.tapQueue.length === 0 && (top === "MapScene" || top === "HelpScene")) {
      this.tapQueue = ["Escape", "Space"];
    }
    const code = this.tapQueue.shift();
    if (!code) return;
    this.keys.set(code, true);
    this.tapUp = code;
    this.tapAt = this.host.time + 150;
  }

  /** Blocage : même scène et mêmes pixels pendant `stuckSeconds` (relance), puis `2 ×` (aide sur un mini-jeu, sinon abandon). */
  private watchStuck(): void {
    const signature = `${this.top()}:${this.host.fingerprint}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.signatureSince = this.host.time;
      this.nudged = false;
      return;
    }
    const still = (this.host.time - this.signatureSince) / 1000;
    const { stuckSeconds } = this.options;
    if (still >= stuckSeconds && !this.nudged) {
      this.nudged = true;
      this.report.blockages.push(`écran figé ${stuckSeconds} s sur ${this.top()} (t = ${Math.round(this.host.time / 1000)} s) : relance`);
      this.debug(`écran figé sur ${this.top()} : relance`);
      for (const code of ["Space", "Escape", "Enter"]) {
        this.host.input.keyDown(code);
        this.host.input.keyUp(code);
      }
    } else if (still >= stuckSeconds * 2) {
      const gs = this.gameScene;
      if (gs && this.playing && !this.playing.forced) {
        this.report.blockages.push(`blocage dans S${this.playing.id} (${this.top()}) : issue forcée`);
        this.force(gs, "écran figé");
        this.signatureSince = this.host.time;
        this.nudged = false;
      } else {
        throw new Blocked(`écran figé ${Math.round(still)} s sur ${this.top()}`);
      }
    }
  }

  // --- partie complète ----------------------------------------------------------------------------

  async play(): Promise<SeedReport> {
    const report = this.report;
    const maxFrames = Math.round((this.options.maxSimSeconds * 1000) / FRAME_MS);
    try {
      await this.startGame();
      const gs = this.gameScene!;
      for (;;) {
        if (this.frames >= maxFrames) {
          report.outcome = "limite de ticks";
          break;
        }
        this.think();
        await this.frame();
        this.watchStuck();
        if (gs.game.state.phase === "over" && this.top() === "MenuScene" && !this.busy) break;
      }
      if (report.outcome === "erreur") {
        const result = gs.game.state.result;
        report.outcome = result?.kind === "victory" ? "victoire" : result?.kind === "timeout" ? "temps écoulé" : "abandon";
        await this.run(500);
        report.returnedToMenu = this.top() === "MenuScene" && this.engine.ctx.options.lastGameMinutes > 0;
        const loaded = this.host.loaded.join("\n");
        report.endVideo = result?.kind === "victory" ? /S11A\.MUX/i.test(loaded) : result?.kind === "timeout" ? /S42A0[4-7]\d\.MUX/i.test(loaded) : true;
      }
    } catch (error) {
      if (error instanceof Blocked) {
        report.outcome = "blocage";
        report.blockages.push(error.message);
      } else {
        report.outcome = "erreur";
        report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
      }
    }
    this.playing?.pilot?.release();
    this.keys.releaseAll();
    report.simSeconds = Math.round(this.host.time / 1000);
    report.gameSeconds = this.gameScene?.game ? this.gameScene.game.state.elapsed : 0;
    report.frames = this.frames;
    report.scenes = [...this.visited];
    return report;
  }
}
