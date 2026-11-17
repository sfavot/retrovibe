import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Engine } from "../../src/engine/infogrames/engine";
import { createSession, type Session } from "../../src/games/asterix/game/state";
import type { MinigameStart } from "../../src/games/asterix/scenes/minigame";
import type { Runtime } from "../../src/games/asterix/scenes/runtime";
import type { GameSave } from "../../src/games/asterix/scenes/save";
import { GAME_CONFIG, createGame, type AsterixGame } from "../../src/games/asterix/scenes/start";
import { encodePng } from "../teleportaschtroumpf/minigames/harness";
import { AsterixTestHost } from "./engine-test-host";

const FRAME_MS = 1000 / 60;

export interface LaunchOptions {
  seed?: number;
  /** Reprise d'une partie sauvegardée. */
  resume?: GameSave | null;
  /** Joue les logos et l'introduction (défaut : non). */
  intro?: boolean;
  /** Sortie son simulée (défaut : coupée, les voix finissent aussitôt). */
  audio?: boolean;
  /** Hôte à réutiliser (stockage conservé d'une séance à l'autre). */
  host?: AsterixTestHost;
  /** Mémoires de séance à réutiliser (décision D13) ; par défaut des mémoires neuves. */
  session?: Session;
  /** Joue d'abord ce mini-jeu, hors partie (tests des mini-jeux). */
  minigame?: MinigameStart;
}

/**
 * Le jeu entier sur le moteur de test : temps simulé à 60 Hz, entrées pilotées, présentations enregistrées. Chaque image
 * attend les lectures de fichiers en cours (les scripts du jeu chargent leurs ressources à la demande).
 */
export class Launched {
  readonly host: AsterixTestHost;
  readonly engine: Engine;
  readonly game: AsterixGame;
  readonly session: Session;
  frames = 0;

  constructor(options: LaunchOptions = {}) {
    this.host = options.host ?? new AsterixTestHost();
    this.host.audio.enabled = options.audio ?? false;
    this.engine = new Engine(this.host, GAME_CONFIG, { seed: options.seed ?? 1 });
    this.session = options.session ?? createSession({ duration: 7200, objectsRequired: 9 });
    this.game = createGame({ resume: options.resume, skipIntro: !options.intro, session: this.session, minigame: options.minigame });
  }

  async start(): Promise<this> {
    await this.engine.start(this.game.scene);
    await this.frame();
    return this;
  }

  /** Socle du jeu (les tables de l'exécutable sont lues pendant les premières images). */
  get rt(): Runtime {
    const runtime = this.game.runtime;
    if (!runtime) throw new Error("le jeu n'a pas encore lu ses tables");
    return runtime;
  }

  get screen(): string {
    return this.game.runtime?.screen ?? "";
  }

  async frame(): Promise<void> {
    this.host.time += FRAME_MS;
    this.engine.frame(this.host.time);
    this.frames++;
    while (this.game.scene.pending) await this.game.scene.pending;
    // Les présentations ne sont gardées que pour la dernière : une partie entière en produit des centaines de milliers.
    if (this.host.presentations.length > 2) this.host.presentations.splice(0, this.host.presentations.length - 1);
  }

  async run(ms: number): Promise<void> {
    const end = this.host.time + ms;
    while (this.host.time < end) await this.frame();
  }

  /** Avance jusqu'à ce que `done()` soit vrai ; échoue après `limitMs` simulées. */
  async until(done: () => boolean, limitMs = 300_000): Promise<void> {
    const end = this.host.time + limitMs;
    while (!done()) {
      if (this.host.time >= end) throw new Error(`condition non atteinte après ${limitMs} ms simulées (écran « ${this.screen} »)`);
      await this.frame();
    }
  }

  /** Avance jusqu'à l'écran interactif `screen`. */
  async untilScreen(screen: string, limitMs = 300_000): Promise<void> {
    await this.until(() => this.screen === screen, limitMs);
  }

  /** Appui bref sur une touche (`KeyboardEvent.code`) : tenue trois images. */
  async tap(code: string): Promise<void> {
    this.host.input.keyDown(code);
    await this.frame();
    await this.frame();
    await this.frame();
    this.host.input.keyUp(code);
    await this.frame();
  }

  /** Clic gauche de la souris en (x, y), pixels 320 × 200. */
  async click(x: number, y: number): Promise<void> {
    this.host.input.pointerHovering = true;
    this.host.input.mouseMove(x, y);
    this.host.input.mouseDown(0);
    await this.frame();
    await this.frame();
    this.host.input.mouseUp(0);
    await this.frame();
  }

  /** Écrit `<ASTERIX_SHOTS>/<nom>.png` avec l'image affichée (rien si la variable n'est pas définie). */
  shot(name: string): void {
    const directory = process.env.ASTERIX_SHOTS;
    if (!directory) return;
    mkdirSync(directory, { recursive: true });
    const { surface, palette } = this.host.lastPresentation;
    writeFileSync(resolve(directory, `${name}.png`), encodePng(320, 200, surface, palette));
  }
}

export async function launch(options: LaunchOptions = {}): Promise<Launched> {
  return new Launched(options).start();
}
