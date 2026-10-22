import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import type { Action } from "../../src/games/teleportaschtroumpf/engine/input";
import { saveOptions } from "../../src/games/teleportaschtroumpf/engine/options";
import type { PlayerSetup } from "../../src/games/teleportaschtroumpf/game/rules";
import type { Position } from "../../src/games/teleportaschtroumpf/game/tables";
import { GameScene, createGameScene } from "../../src/games/teleportaschtroumpf/scenes/game";
import { TestHost } from "./engine-test-host";

const FRAME_MS = 1000 / 60;

/**
 * Comme `runFor` de `engine-test-host.ts`, mais laisse passer les promesses entre deux images : le plateau charge ses voix
 * en tâche de fond (`VoiceLine`), ce qui ne se résout que quand le test rend la main à la boucle d'événements.
 */
export async function advance(engine: Engine, host: TestHost, ms: number): Promise<void> {
  const end = host.time + ms;
  while (host.time < end) {
    host.time += FRAME_MS;
    engine.frame(host.time);
    await new Promise((resolve) => setImmediate(resolve));
    const loading = engine.whenLoaded;
    if (loading) await loading;
  }
}

export async function advanceUntil(engine: Engine, host: TestHost, done: () => boolean, limitMs = 180_000): Promise<void> {
  const end = host.time + limitMs;
  while (!done()) {
    if (host.time >= end) throw new Error(`condition non atteinte après ${limitMs} ms simulées`);
    await advance(engine, host, FRAME_MS * 2);
  }
}

export interface SessionOptions {
  players?: PlayerSetup[];
  seed?: number;
  /** Sortie son active (les voix durent leur durée réelle) : faux par défaut, les voix se terminent aussitôt. */
  audio?: boolean;
  durationIndex?: number;
  messageIndex?: number;
}

/** Une partie lancée sur le moteur de test, avec les gestes de l'utilisateur. */
export class Session {
  finished = false;
  readonly scene: GameScene;
  /** Scènes vues au sommet de la pile depuis le début, sans doublon consécutif. */
  readonly history: string[] = [];

  private constructor(
    readonly host: TestHost,
    readonly engine: Engine,
    scene: GameScene,
  ) {
    this.scene = scene;
  }

  static async start(options: SessionOptions = {}): Promise<Session> {
    const host = new TestHost();
    host.audio.enabled = options.audio ?? false;
    const engine = new Engine(host, { seed: options.seed ?? 7 });
    const { options: parent } = engine.ctx;
    parent.durationIndex = options.durationIndex ?? 0;
    parent.messageIndex = options.messageIndex ?? 0;
    saveOptions(host.storage, parent);
    const holder: { session?: Session } = {};
    const scene = createGameScene({ players: options.players ?? [{ character: 0 }], options: parent }, () => {
      if (holder.session) holder.session.finished = true;
    });
    await engine.start(scene);
    const session = new Session(host, engine, scene);
    holder.session = session;
    return session;
  }

  get ctx() {
    return this.engine.ctx;
  }

  get game() {
    return this.scene.game;
  }

  get board() {
    return this.scene.board;
  }

  top(): string | undefined {
    return this.engine.ctx.scenes.top?.constructor.name;
  }

  async run(ms: number): Promise<void> {
    const end = this.host.time + ms;
    while (this.host.time < end) {
      await advance(this.engine, this.host, FRAME_MS);
      const top = this.top();
      if (top && this.history.at(-1) !== top) this.history.push(top);
    }
  }

  async until(done: () => boolean, limitMs = 180_000): Promise<void> {
    const end = this.host.time + limitMs;
    while (!done()) {
      if (this.host.time >= end) throw new Error(`condition non atteinte après ${limitMs} ms simulées`);
      await this.run(FRAME_MS * 2);
    }
  }

  /** Attend une scène (par le nom de sa classe), la fin des transitions et des fondus. */
  async settle(name: string): Promise<void> {
    await this.until(() => this.top() === name && !this.engine.loading && !this.ctx.scenes.transitioning && !this.ctx.fade.active);
    await this.run(100);
  }

  /** Le joueur a la main sur le plateau (annonce finie, plus aucun événement à présenter). */
  async ready(): Promise<void> {
    await this.until(() => this.top() === "GameScene" && !!this.scene.board?.playing && !this.engine.loading && !this.ctx.scenes.transitioning && !this.ctx.fade.active);
  }

  async tap(code: string, ms = 150): Promise<void> {
    this.host.input.keyDown(code);
    await this.run(ms);
    this.host.input.keyUp(code);
    await this.run(150);
  }

  async hold(code: string, ms: number): Promise<void> {
    this.host.input.keyDown(code);
    await this.run(ms);
    this.host.input.keyUp(code);
  }

  /** Pose le pion du joueur courant à `to` (état de la partie et plateau montré). */
  place(to: Position, facingRight = true): void {
    const p = this.game.player;
    p.screen = to.screen;
    p.row = to.row;
    p.x = to.x;
    p.facingRight = facingRight;
    this.board.moveTo(this.ctx, to, { facingRight });
  }

  /** Les secondes de partie écoulées sont décalées (le temps simulé reste le même). */
  setElapsed(seconds: number): void {
    this.game.state.elapsed = seconds;
  }

  /** Le chrono du tour a déjà couru `seconds` secondes. */
  setElapsedTurn(seconds: number): void {
    this.game.state.turn.elapsed = seconds;
  }

  action(action: Action): boolean {
    return this.host.input.pressed(action);
  }
}
