import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { Engine } from "../../../src/games/teleportaschtroumpf/engine/engine";
import type { Scene, SceneContext } from "../../../src/games/teleportaschtroumpf/engine/scene";
import { type Game, newGame } from "../../../src/games/teleportaschtroumpf/game/rules";
import type { MinigameOutcome } from "../../../src/games/teleportaschtroumpf/game/state";
import { DOORS, MAP_LOCATIONS, minigameInfo, type Position } from "../../../src/games/teleportaschtroumpf/game/tables";
import { createMinigame } from "../../../src/games/teleportaschtroumpf/scenes/minigames";
import { type FreeModeScene, createFreeModeScene } from "../../../src/games/teleportaschtroumpf/scenes/s02-map";
import { TestHost, runFor, runUntil } from "../engine-test-host";
import { Session, type SessionOptions } from "../game-helpers";

/**
 * Outils des tests de mini-jeux (`docs/teleportaschtroumpf/engine-ts.md`, « Écrire un mini-jeu ») : lance un mini-jeu seul sur le moteur
 * de test, comme le mode libre (`map/free-mode.ts`), et expose ce que le test doit piloter ou lire.
 *
 * Captures : avec `TELEPORTA_SHOTS=/un/dossier`, `launched.shot("nom")` écrit `nom.png` (320×200, palette indexée, celle qu'afficherait
 * le navigateur : fondu et quantification du DAC compris). Sans la variable, `shot` ne fait rien.
 */

const FRAME_MS = 1000 / 60;

// --- PNG indexé (équivalent de `scripts/teleportaschtroumpf/proto/png.py`) -------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** PNG indexé d'une image `width × height` d'indices de palette ; `palette` : 768 octets RVB 8 bits. */
export function encodePng(width: number, height: number, pixels: Uint8Array, palette: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", palette.subarray(0, 768)),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- Lancement d'un mini-jeu -------------------------------------------------------------------------

export interface LaunchOptions {
  seed?: number;
  /** Niveau de difficulté du joueur (0..2). */
  level?: number;
  character?: number;
  /** Indice de l'oiseau actif pour cette scène (`request.bonus`). */
  bonus?: boolean;
  /** Sortie son active (les voix durent leur durée réelle) : faux par défaut, les voix se terminent aussitôt. */
  audio?: boolean;
  /** Prépare la partie avant l'ouverture du mini-jeu (ingrédients, points, objectif…). */
  setup?(game: Game): void;
  /** Fabrique de la scène à lancer (défaut : le registre `createMinigame`). */
  factory?(id: number, game: Game, onDone: (ctx: SceneContext, outcome: MinigameOutcome) => void): Scene;
}

/** Scène du dessous : le mini-jeu est empilé dessus puis retiré, comme sur le plateau. */
const base: Scene = { step: 1, enter: () => undefined, update: () => undefined, render: () => undefined };

export class LaunchedMinigame {
  outcome: MinigameOutcome | undefined;
  shots = 0;

  constructor(
    readonly host: TestHost,
    readonly engine: Engine,
    readonly game: Game,
    readonly scene: Scene,
  ) {}

  get ctx(): SceneContext {
    return this.engine.ctx;
  }

  /** Simule `ms` millisecondes. */
  run(ms: number, onFrame?: (elapsedMs: number) => void): Promise<void> {
    return runFor(this.engine, this.host, ms, onFrame);
  }

  /** Simule jusqu'à ce que `done()` soit vrai (échoue après `limitMs` simulées). */
  until(done: () => boolean, limitMs = 120_000): Promise<void> {
    return runUntil(this.engine, this.host, done, limitMs);
  }

  /** Attend que le mini-jeu ait rendu son issue et que le plateau ait repris la main. */
  async finish(limitMs = 120_000): Promise<MinigameOutcome> {
    await this.until(() => this.outcome !== undefined && !this.ctx.scenes.transitioning && this.ctx.scenes.depth === 1, limitMs);
    return this.outcome!;
  }

  async tap(code: string, ms = 100): Promise<void> {
    this.host.input.keyDown(code);
    await this.run(ms);
    this.host.input.keyUp(code);
    await this.run(ms);
  }

  /** Écrit `<TELEPORTA_SHOTS>/<nom>.png` avec l'image affichée (rien si la variable n'est pas définie). */
  shot(name: string): void {
    const dir = process.env.TELEPORTA_SHOTS;
    const presentation = this.host.presentations.at(-1);
    if (!dir || !presentation) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${name}.png`), encodePng(320, 200, presentation.surface, presentation.palette));
    this.shots++;
  }
}

/**
 * Lance le mini-jeu `id` sur un moteur de test : partie à un joueur (niveau et personnage au choix), requête ouverte par
 * `Game.openMinigame`, scène empilée avec fondu ; l'issue est rendue dans `.outcome` et la scène retirée avec fondu. Rend la main une fois
 * la scène chargée et entrée.
 */
export async function launchMinigame(id: number, options: LaunchOptions = {}): Promise<LaunchedMinigame> {
  const host = new TestHost();
  host.audio.enabled = options.audio ?? false;
  const engine = new Engine(host, { seed: options.seed ?? 7 });
  const game = newGame({ players: [{ character: options.character ?? 0, level: options.level ?? 0 }] }, engine.ctx.rng);
  options.setup?.(game);
  if (options.bonus) game.state.bonusTag = minigameInfo(id)!.bonusTag!;
  game.openMinigame(id);
  await engine.start(base);
  await runUntil(engine, host, () => !engine.ctx.scenes.transitioning);
  // `launched` n'existe pas encore quand la scène est construite : on le remplit après.
  const holder: { launched?: LaunchedMinigame } = {};
  const scene = (options.factory ?? createMinigame)(id, game, (ctx, outcome) => {
    if (holder.launched) holder.launched.outcome = outcome;
    ctx.scenes.pop({ fade: true });
  });
  const launched = new LaunchedMinigame(host, engine, game, scene);
  holder.launched = launched;
  engine.ctx.scenes.push(scene, { fade: true });
  await runFor(engine, host, FRAME_MS * 2);
  await launched.until(() => !engine.ctx.scenes.transitioning);
  return launched;
}

// --- Parcours d'intégration ----------------------------------------------------------------------------

/** Abscisse d'un pion dans la zone gauche, centrale ou droite d'un écran (`zoneOf`, `game/board.ts`). */
const ZONE_X = [0x20, 0x90, 0x100] as const;

/** Première porte du plateau qui mène au mini-jeu `id` (`DOORS`) : écran, rangée et abscisse où poser le pion. */
export function doorPosition(id: number): Position {
  for (const [index, screen] of DOORS.entries()) {
    for (const row of ["top", "bottom"] as const) {
      const zone = screen[row].indexOf(id);
      if (zone >= 0) return { screen: index + 1, row, x: ZONE_X[zone] };
    }
  }
  throw new RangeError(`aucune porte ne mène à la scène ${id}`);
}

/**
 * Parcours du plateau : une partie réelle (`GameScene`), le pion posé devant la porte du mini-jeu `id`, Espace pour entrer ; rend la
 * session une fois la scène du mini-jeu en place (`session.top() === className`). Le test joue le mini-jeu, puis `session.ready()` rend
 * la main au plateau, où l'issue est appliquée.
 */
export async function enterFromBoard(id: number, className: string, options: SessionOptions = {}): Promise<Session> {
  const session = await Session.start(options);
  await session.ready();
  session.place(doorPosition(id));
  await session.tap("Space");
  await session.settle(className);
  return session;
}

/**
 * Parcours du mode libre : la carte S02, le lieu du mini-jeu `id` choisi aux flèches puis validé ; rend le mini-jeu lancé (sa scène est en
 * place, `game` est la partie à un joueur du mode libre). Retour à la carte : `until(() => free.stage === "map")`.
 */
export async function enterFromFreeMode(id: number, options: { seed?: number } = {}): Promise<LaunchedMinigame & { free: FreeModeScene; press(code: string): Promise<void> }> {
  const location = MAP_LOCATIONS.find((l) => l.scene === id);
  if (!location) throw new RangeError(`aucun lieu de la carte ne mène à la scène ${id}`);
  const host = new TestHost();
  host.audio.enabled = false;
  const engine = new Engine(host, { seed: options.seed ?? 7 });
  const free = createFreeModeScene(() => undefined) as FreeModeScene;
  await engine.start(free);
  const settle = () => runUntil(engine, host, () => !engine.loading && !engine.ctx.scenes.transitioning && !engine.ctx.fade.active);
  await settle();
  await runFor(engine, host, 300);
  const press = async (code: string) => {
    host.input.keyDown(code);
    await runFor(engine, host, 120);
    host.input.keyUp(code);
    await runFor(engine, host, 120);
  };
  for (let k = 1; k < location.k; k++) await press("ArrowUp");
  await press("Space");
  await runUntil(engine, host, () => free.stage === "minigame" && !engine.ctx.scenes.transitioning && !engine.loading);
  await settle();
  const launched = new LaunchedMinigame(host, engine, free.currentGame!, engine.ctx.scenes.top!);
  return Object.assign(launched, { free, press });
}
