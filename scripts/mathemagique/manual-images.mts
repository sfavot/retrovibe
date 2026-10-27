// Génère les illustrations de la page manuel de Math Workshop : `original/mathemagique/manuel/*.png`.
// Usage : npx vite-node scripts/mathemagique/manual-images.mts
// (aucun téléchargement ; lit `original/mathemagique/`, écrit dans `original/mathemagique/manuel/`, puis régénère `files.json`)
//
// Les écrans sont ceux du vrai jeu : le moteur tourne sur l'hôte de test (`test/mathemagique/engine-test-host.ts`, temps simulé à
// 60 Hz, entrées pilotées), les scènes sont celles du site, et on enregistre la dernière image présentée (576×432, indices de
// palette + palette de l'instant, fondus et éclaircissement appliqués) en PNG à palette. Poly est rendue seule, avec transparence,
// à partir de `MAINSCRN.DAT` comme dans `render-samples.mts`.
// Le script d'extraction du CD (scripts/mathemagique-extract.sh) conserve `MANUEL.html` et `manuel/`.
//
// Dette : l'hôte de test vit dans `test/` ; un module partagé entre tests et scripts (comme `render-samples.mts`, qui a sa copie
// de l'encodeur PNG) éviterait d'importer depuis `test/`.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { MohawkArchive, TAG_SHAP, TAG_SHPL } from "../../src/data/mohawk/mohawk";
import { applyShpl, createPalette, type Palette } from "../../src/games/mathemagique/data/palette";
import { decodeShap } from "../../src/data/mohawk/shap";
import { parseShpl } from "../../src/data/mohawk/shpl";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { PLAY_HEIGHT, PLAY_WIDTH, type Frame } from "../../src/games/mathemagique/engine/graphics/frame";
import { SceneId } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import { THUMB_LAYOUTS, thumbRect } from "../../src/games/mathemagique/game/puzzle-kit";
import { registerScenes } from "../../src/games/mathemagique/scenes";
import { MONITOR_NAME_RULES } from "../../src/games/mathemagique/scenes/monitor";
import type { BowlingScene } from "../../src/games/mathemagique/scenes/bowling";
import type { HiddenScene } from "../../src/games/mathemagique/scenes/hidden";
import { HUB_OBJECT_EDGES } from "../../src/games/mathemagique/scenes/hub-logic";
import type { PatternsScene } from "../../src/games/mathemagique/scenes/patterns";
import type { RhythmScene } from "../../src/games/mathemagique/scenes/rhythm";
import type { RocketsScene } from "../../src/games/mathemagique/scenes/rockets";
import { achievementBit } from "../../src/games/mathemagique/engine/roster";
import { FRAME_MS, TestHost, runFor, runUntil } from "../../test/mathemagique/engine-test-host";

const original = resolve(import.meta.dirname, "../../original/mathemagique");
const outDir = resolve(original, "manuel");

// --- PNG à palette ---------------------------------------------------------------------------------------------------------------

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const buf = Buffer.alloc(12 + body.length);
  buf.writeUInt32BE(body.length, 0);
  buf.write(type, 4, "latin1");
  body.copy(buf, 8);
  buf.writeUInt32BE(crc32(buf.subarray(4, 8 + body.length)), 8 + body.length);
  return buf;
}

/** PNG 8 bits à palette (`rgb` = 256 × RVB), filtre choisi ligne par ligne (aucun, gauche, haut) ; `transparent` = indice transparent. */
function encodeIndexedPng(width: number, height: number, pixels: Uint8Array, rgb: Uint8Array, transparent?: number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  const score = (row: Uint8Array): number => row.reduce((sum, v) => sum + (v < 128 ? v : 256 - v), 0);
  for (let y = 0; y < height; y++) {
    const line = pixels.subarray(y * width, (y + 1) * width);
    const candidates = [0, 1, 2].map((filter) => {
      const row = new Uint8Array(width);
      for (let x = 0; x < width; x++) {
        const left = x > 0 ? line[x - 1]! : 0;
        const up = y > 0 ? pixels[(y - 1) * width + x]! : 0;
        row[x] = (line[x]! - (filter === 1 ? left : filter === 2 ? up : 0)) & 255;
      }
      return { filter, row };
    });
    // Le filtre « aucun » est préféré aux indices de palette quand le gain est faible : les indices n'ont pas de continuité de teinte.
    const best = candidates.reduce((a, b) => (score(b.row) < score(a.row) * 0.9 ? b : a));
    raw[y * (width + 1)] = best.filter;
    raw.set(best.row, y * (width + 1) + 1);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 3; // palette
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("PLTE", Buffer.from(rgb.subarray(0, 768))),
  ];
  if (transparent !== undefined) parts.push(chunk("tRNS", Buffer.from(Array.from({ length: transparent + 1 }, (_, i) => (i === transparent ? 0 : 255)))));
  parts.push(chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// --- Parties pilotées ------------------------------------------------------------------------------------------------------------

/** Hôte de test qui ne garde que la dernière image (des minutes de jeu simulées feraient des gigaoctets). */
class ShotHost extends TestHost {
  last: Frame | null = null;
  override present(frame: Frame): void {
    this.last = { pixels: frame.pixels.slice(), palette: frame.palette.slice() };
  }
}

interface Game {
  host: ShotHost;
  engine: Engine;
  services: MathServices;
  /** Scène courante, typée à la demande. */
  scene<T>(): T;
  run(ms: number): Promise<void>;
  until(done: () => boolean, limitMs?: number): Promise<void>;
  click(x: number, y: number, ms?: number): Promise<void>;
}

interface BootOptions {
  /** Scène de départ (défaut : le titre). */
  start?: SceneId;
  /** Joueurs créés d'avance : nom, réussites du Bowling (opération 0 à 5, niveau 0 à 4). */
  players?: { name: string; seen?: boolean; achievements?: [number, number][] }[];
  /** Joueur connecté (indice dans `players`). */
  current?: number;
}

async function boot(options: BootOptions = {}): Promise<Game> {
  const host = new ShotHost();
  host.audio.unlock();
  const engine = new Engine(host, { seed: 3 });
  const services = installServices(engine);
  registerScenes(engine, services);
  const { roster } = engine.ctx.roster;
  options.players?.forEach((p, i) => {
    const added = roster.addPlayer(p.name, MONITOR_NAME_RULES);
    if (!added.ok) throw new Error(`joueur refusé : ${p.name}`);
    if (p.seen) roster.setVar(added.id, "hubPolyIntroSeen", 1);
    let mask = 0;
    for (const [op, level] of p.achievements ?? []) mask |= 1 << achievementBit(op, level);
    if (mask) roster.setMask(added.id, mask >>> 0);
    if (i === options.current) engine.ctx.roster.currentPlayerId = added.id;
  });
  engine.start(options.start);
  const game: Game = {
    host,
    engine,
    services,
    scene: <T,>() => engine.scenes.current as T,
    run: (ms) => runFor(engine, host, ms),
    until: (done, limitMs = 120_000) => runUntil(engine, host, done, limitMs),
    async click(x, y, ms = 100) {
      host.click(x, y);
      await runFor(engine, host, ms);
    },
  };
  await game.run(100);
  return game;
}

/** Enregistre l'image présentée (écran de jeu 576×432). */
function save(game: Game, name: string): void {
  const frame = game.host.last;
  if (!frame) throw new Error(`${name} : aucune image présentée`);
  const lit = frame.pixels.reduce((n, v) => n + (v === 0 ? 0 : 1), 0);
  if (lit < 20_000) throw new Error(`${name} : écran vide (${lit} pixels)`);
  const png = encodeIndexedPng(PLAY_WIDTH, PLAY_HEIGHT, frame.pixels, frame.palette);
  writeFileSync(resolve(outDir, `${name}.png`), png);
  console.log(`${name}.png  ${(png.length / 1024).toFixed(0)} Ko`);
}

const center = (object: number): [number, number] => {
  const [l, t, r, b] = HUB_OBJECT_EDGES[object - 1]!;
  return [Math.floor((l + r) / 2), Math.floor((t + b) / 2)];
};

// --- Les captures ----------------------------------------------------------------------------------------------------------------

const PLAYERS = [
  { name: "Léa", seen: true, achievements: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [1, 0], [3, 0], [5, 0], [5, 1]] as [number, number][] },
  { name: "Max", seen: true, achievements: [[0, 0], [4, 0]] as [number, number][] },
  { name: "Zoé", seen: true, achievements: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [3, 0], [4, 0], [4, 1], [5, 0]] as [number, number][] },
];

/** Titre → porte → hub → connexion, puis préférences et hub au repos. */
async function hubShots(): Promise<void> {
  const game = await boot({ players: PLAYERS });
  await game.run(800);
  game.host.press("Space"); // passe le logo
  await game.run(2500);
  game.host.click(290, 300); // la porte
  await game.until(() => game.engine.scenes.currentId === SceneId.hub, 30_000);
  await game.run(1200);
  game.host.click(520, 20); // passe l'accueil de Poly : le moniteur de connexion s'ouvre
  await game.run(2500);
  save(game, "connexion");
  game.host.press("Enter", { key: "Enter" });
  await game.run(20_000); // Poly a fini d'accueillir le joueur et se tient à son pupitre
  save(game, "hub");
  // Ctrl + clic sur Sign-in : préférences.
  game.host.input.moveMouse(247, 362);
  game.host.input.mouseDown("left", { ctrl: true });
  game.host.input.mouseUp("left", { ctrl: true });
  await game.run(2500);
  save(game, "preferences");
}

async function bowlingShot(): Promise<void> {
  const game = await boot({ start: SceneId.bowling, players: PLAYERS, current: 0 });
  const scene = () => game.scene<BowlingScene>();
  await game.until(() => scene().ready);
  await game.click(463, 130); // GO!
  await game.until(() => scene().currentQuestion !== null && !scene().busy);
  await game.run(400);
  save(game, "bowling");
}

async function trophyShot(): Promise<void> {
  const game = await boot({ start: SceneId.trophy, players: PLAYERS, current: 0 });
  await game.run(3000);
  save(game, "hall-of-fame");
}

async function rhythmShot(): Promise<void> {
  const game = await boot({ start: SceneId.rhythm, players: PLAYERS, current: 0 });
  const scene = () => game.scene<RhythmScene>();
  await game.until(() => scene().inspect().state === "idle", 60_000);
  await game.run(500);
  save(game, "rhythm-shop");
}

async function patternWindowsShot(): Promise<void> {
  const game = await boot({ start: SceneId.patternWindows, players: PLAYERS, current: 0 });
  await game.run(8000);
  // Quelques coups de pinceau (glisser) : une couleur par bande, la touche x passe à la couleur suivante.
  const stroke = async (y: number) => {
    game.host.input.moveMouse(60, y);
    game.host.input.mouseDown("left");
    for (let x = 60; x <= 385; x += 12) {
      game.host.input.moveMouse(x, y);
      await game.run(FRAME_MS);
    }
    game.host.input.mouseUp("left");
    await game.run(100);
  };
  const rows = [90, 150, 210, 270, 330];
  for (const y of rows) {
    game.host.press("KeyX", { key: "x" });
    game.host.press("KeyX", { key: "x" });
    await game.run(100);
    await stroke(y);
  }
  save(game, "pattern-windows");
}

async function hiddenShots(): Promise<void> {
  const game = await boot({ start: SceneId.hidden, players: PLAYERS, current: 0 });
  const scene = () => game.scene<HiddenScene>();
  await game.until(() => scene().phase === "menu");
  await game.run(600);
  save(game, "hidden-menu");
  await game.click(59 + 78 * 1 + 36, 56 + 78 * 1 + 36, 100);
  await game.until(() => scene().phase === "playing");
  await game.run(400);
  save(game, "hidden-puzzle");
}

async function patternsShot(): Promise<void> {
  const game = await boot({ start: SceneId.patterns, players: PLAYERS, current: 0 });
  await game.run(1500);
  const r = thumbRect(THUMB_LAYOUTS.patterns, 4);
  await game.click(r.x + 36, r.y + 36, 3000);
  const scene = () => game.scene<PatternsScene>();
  await game.until(() => scene().currentBoard !== null);
  await game.run(1500);
  // Trois pièces remises à leur place, pour montrer le cadre qui se remplit.
  const board = scene().currentBoard!;
  const { puzzle } = board;
  for (const piece of board.pieces.slice(0, 3)) {
    game.host.click(piece.cx, piece.cy);
    await game.run(60);
    for (let turns = (4 - piece.rot) % 4; turns > 0; turns--) {
      game.host.press("Space", { key: " " });
      await game.run(40);
    }
    const tx = 78 + 60 * puzzle.col[piece.id]! + Math.floor((60 * piece.w + 1) / 2);
    const ty = 76 + 60 * puzzle.row[piece.id]! + Math.floor((60 * piece.h + 1) / 2);
    game.host.input.moveMouse(tx, ty);
    await game.run(60);
    game.host.click(tx, ty);
    await game.run(80);
  }
  await game.run(500);
  save(game, "puzzle-patterns");
}

async function sticklersShot(): Promise<void> {
  const game = await boot({ start: SceneId.sticklers, players: PLAYERS, current: 0 });
  await game.run(3000);
  const r = thumbRect(THUMB_LAYOUTS.sticklers, 0);
  await game.click(r.x + 36, r.y + 36, 1500);
  await game.run(1500);
  save(game, "super-sticklers");
}

async function rocketsShot(): Promise<void> {
  const game = await boot({ start: SceneId.rockets, players: PLAYERS, current: 0 });
  const scene = () => game.scene<RocketsScene>();
  await game.run(2000);
  await game.until(() => !scene().busy, 300_000);
  await game.run(500);
  save(game, "rockets");
}

/** Poly seule (SHAP 104 de `MAINSCRN.DAT`, palette du hub), fond transparent. */
function polyShot(): void {
  const archive = MohawkArchive.parse(readFileSync(resolve(original, "MAINSCRN.DAT")));
  const palette: Palette = createPalette();
  applyShpl(palette, parseShpl(archive.get(TAG_SHPL, 100)));
  const shape = decodeShap(archive.get(TAG_SHAP, 104));
  const rgb = new Uint8Array(768);
  rgb.set(palette.subarray(0, 768));
  const png = encodeIndexedPng(shape.width, shape.height, shape.pixels, rgb, 0);
  writeFileSync(resolve(outDir, "poly.png"), png);
  console.log(`poly.png  ${(png.length / 1024).toFixed(0)} Ko (${shape.width}×${shape.height})`);
}

mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2);
const steps: [string, () => void | Promise<void>][] = [
  ["poly", polyShot],
  ["hub", hubShots],
  ["bowling", bowlingShot],
  ["hall-of-fame", trophyShot],
  ["rhythm", rhythmShot],
  ["pattern-windows", patternWindowsShot],
  ["hidden", hiddenShots],
  ["patterns", patternsShot],
  ["sticklers", sticklersShot],
  ["rockets", rocketsShot],
];
for (const [name, step] of steps) if (only.length === 0 || only.includes(name)) await step();

if (only.length === 0) {
  const total = readdirSync(outDir).reduce((sum, f) => sum + readFileSync(resolve(outDir, f)).length, 0);
  console.log(`${readdirSync(outDir).length} images, ${(total / 1024).toFixed(0)} Ko`);
  execFileSync("python3", ["-I", resolve(import.meta.dirname, "../manifest.py"), original], { stdio: "inherit" });
}
