import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { PALETTE_BYTES } from "../../src/games/mathemagique/engine/graphics/palette";
import type { Scene } from "../../src/games/mathemagique/engine/scene";
import { SceneId } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import type { PlaySoundOptions } from "../../src/games/mathemagique/engine/sound";
import { parsePatternsPuzz, patternsPuzzId, patternsRewardId } from "../../src/games/mathemagique/game/puzz";
import { PATTERNS, THUMB_LAYOUTS, dealPatterns, patternsRect, thumbRect, type PatternsPiece } from "../../src/games/mathemagique/game/puzzle-kit";
import { MsvcRandom } from "../../src/games/mathemagique/engine/rng";
import { PatternsScene, createPatternsScene } from "../../src/games/mathemagique/scenes/patterns";
import {
  BACKGROUND_ID,
  BUTTONS,
  CYCLE_PERIOD,
  REWARD_CYCLES,
  helpZoneAt,
  paletteSlice,
  pieceShapeId,
  thumbHoverMaskId,
  thumbShapeId,
  type ButtonRole,
} from "../../src/games/mathemagique/scenes/patterns-view";
import { FRAME_MS, TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { MohawkArchive } from "../../src/games/mathemagique/data/mohawk";
import { Archive } from "../../src/games/mathemagique/engine/resources";
import { parseShpl } from "../../src/games/mathemagique/data/shpl";

// =====================================================================================================================================
// Aides pures (sans fichiers du jeu)
// =====================================================================================================================================

describe("patterns-view : aides pures", () => {
  it("la forme d'une pièce suit 4·id + rot + 2 (forme 1 = cadre) dans la SHPL du puzzle", () => {
    expect(pieceShapeId(6600, { id: 0, rot: 0 })).toBe(6601);
    expect(pieceShapeId(6600, { id: 0, rot: 3 })).toBe(6604);
    expect(pieceShapeId(6600, { id: 7, rot: 3 })).toBe(6632);
  });

  it("les vignettes et le masque de survol sont les formes 1 à 9 et 10 de la SHPL du niveau", () => {
    expect(thumbShapeId(6530, 0)).toBe(6530);
    expect(thumbShapeId(6530, 8)).toBe(6538);
    expect(thumbHoverMaskId(6530)).toBe(6539);
  });

  it("les 7 boutons : formes 6500 à 6513 par couples (repos, appuyé)", () => {
    expect(BUTTONS.map((b) => b.role)).toEqual(["green", "orange", "red", "help", "reset", "rotate", "exit"]);
    expect(BUTTONS.map((b) => b.shapeId)).toEqual([6500, 6502, 6504, 6506, 6508, 6510, 6512]);
  });

  it("paletteSlice ne garde que 154–225 d'une SHPL à 236 couleurs", () => {
    const rgb = new Uint8Array(236 * 3);
    for (let i = 0; i < 236; i++) rgb.fill(i, i * 3, i * 3 + 3);
    const slice = paletteSlice({ firstShapeId: 1, shapeCount: 1, paletteFirst: 10, rgb });
    expect(slice.paletteFirst).toBe(154);
    expect(slice.rgb.length / 3).toBe(72);
    expect(slice.rgb[0]).toBe(144);
    // Une SHPL qui commence déjà à 154 est gardée entière.
    const partial = paletteSlice({ firstShapeId: 1, shapeCount: 1, paletteFirst: 154, rgb: new Uint8Array(72 * 3) });
    expect(partial.rgb.length / 3).toBe(72);
    // Une SHPL sans palette reste vide.
    expect(paletteSlice({ firstShapeId: 1, shapeCount: 1, paletteFirst: 0, rgb: new Uint8Array(0) }).rgb.length).toBe(0);
  });

  it("les quatre victoires à cyclage (21100, 21700, 21900, 22600), période de 7 ticks", () => {
    expect(Object.keys(REWARD_CYCLES).map(Number)).toEqual([21100, 21700, 21900, 22600]);
    expect(REWARD_CYCLES[22600]).toEqual({ first: 155, count: 17 });
    expect(CYCLE_PERIOD).toBe(7);
  });

  it("zones de l'aide : Poly d'abord, puis pièces, boutons, cadre", () => {
    const pieces = dealPatterns({ orient: [0, 0, 0, 0, 0, 0, 0, 0], col: [0, 0, 0, 0, 0, 0, 0, 0], row: [0, 0, 0, 0, 0, 0, 0, 0] }, new MsvcRandom(1));
    const top = pieces[0]!;
    expect(helpZoneAt(400, 300, pieces)).toBe("poly");
    expect(helpZoneAt(top.cx, top.cy - 10, pieces)).toBe(top.cx > 362 && top.cx < 438 && top.cy - 10 >= 280 ? "poly" : "piece");
    expect(helpZoneAt(160, 370, [])).toBe("level");
    expect(helpZoneAt(300, 370, [])).toBe("help");
    expect(helpZoneAt(100, 370, [])).toBe("reset");
    expect(helpZoneAt(330, 370, [])).toBe("rotate");
    expect(helpZoneAt(60, 370, [])).toBe("exit");
    expect(helpZoneAt(200, 100, [])).toBe("screen");
    expect(helpZoneAt(10, 10, [])).toBeNull();
  });
});

// =====================================================================================================================================
// Scène sur les vraies données
// =====================================================================================================================================

const real = describe.skipIf(!hasOriginalFiles);

const hubStub: Scene = { enter() {}, leave() {}, tick() {} };

/** Centre d'un bouton de la barre. */
function buttonCenter(role: ButtonRole): [number, number] {
  const b = BUTTONS.find((def) => def.role === role)!;
  return [Math.floor((b.edges.left + b.edges.right) / 2), Math.floor((b.edges.top + b.edges.bottom) / 2)];
}

interface Rig {
  host: TestHost;
  engine: Engine;
  services: MathServices;
  scene: PatternsScene;
  /** Sons demandés au service sonore, dans l'ordre. */
  sounds: { id: number; options?: PlaySoundOptions }[];
  /** Scripts lancés en mode bloquant. */
  blocking: number[];
  tick(n?: number): Promise<void>;
  until(done: () => boolean, limitMs?: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  clickButton(role: ButtonRole): Promise<void>;
  thumb(k: number): Promise<void>;
}

async function boot(options: { clickAndStick?: boolean; player?: boolean } = {}): Promise<Rig> {
  const host = new TestHost();
  host.audio.unlock();
  const engine = new Engine(host, { seed: 11 });
  const services = installServices(engine);
  if (options.clickAndStick === false) engine.ctx.roster.roster.clickAndStick = false;
  if (options.player) {
    const added = engine.ctx.roster.roster.addPlayer("Test");
    if (!added.ok) throw new Error("joueur");
    engine.ctx.roster.currentPlayerId = added.id;
  }
  const sounds: Rig["sounds"] = [];
  const play = services.sound.playSound.bind(services.sound);
  services.sound.playSound = (archive, id, opts) => {
    sounds.push({ id, options: opts });
    return play(archive, id, opts);
  };
  const blocking: number[] = [];
  const playBlocking = services.scr.playBlocking.bind(services.scr);
  services.scr.playBlocking = (archive, id, opts, then) => {
    blocking.push(id);
    return playBlocking(archive, id, opts, then);
  };
  let scene!: PatternsScene;
  engine.register(SceneId.patterns, () => (scene = createPatternsScene(services) as PatternsScene));
  engine.register(SceneId.hub, () => hubStub);
  engine.start(SceneId.patterns);
  await runFor(engine, host, 100);
  const rig: Rig = {
    host,
    engine,
    services,
    scene,
    sounds,
    blocking,
    tick: (n = 1) => runFor(engine, host, FRAME_MS * n),
    until: (done, limitMs) => runUntil(engine, host, done, limitMs),
    async click(x, y) {
      host.click(x, y);
      await rig.tick(3);
      // Les stores vénitiens (15 ou 30 ticks, éventuellement deux à la suite) sont bloquants.
      await rig.until(() => rig.scene.flowKind !== "transition");
    },
    async clickButton(role) {
      await rig.click(...buttonCenter(role));
    },
    async thumb(k) {
      const r = thumbRect(THUMB_LAYOUTS.patterns, k);
      await rig.click(r.x + 36, r.y + 36);
    },
  };
  return rig;
}

/** Fait le tour du puzzle courant avec des clics et des touches (les deux modes de souris). */
async function solveBoard(rig: Rig, mode: "click" | "drag"): Promise<void> {
  const board = rig.scene.currentBoard!;
  const { puzzle } = board;
  const correct = (p: PatternsPiece) => p.placed && p.rot === 0 && p.col === puzzle.col[p.id] && p.row === puzzle.row[p.id];
  for (let guard = 0; guard < 8; guard++) {
    const piece = board.pieces.find((p) => !correct(p));
    if (!piece) break;
    const { cx, cy } = piece;
    if (mode === "click") {
      rig.host.click(cx, cy);
    } else {
      rig.host.input.moveMouse(cx, cy);
      rig.host.input.mouseDown("left");
    }
    await rig.tick(3);
    expect(rig.services.pointer.carried?.item).toBe(piece);
    for (let r = (4 - piece.rot) % 4; r > 0; r--) {
      rig.host.press("Space", { key: " " });
      await rig.tick(2);
    }
    expect(piece.rot).toBe(0);
    const tx = 78 + 60 * puzzle.col[piece.id]! + Math.floor((60 * piece.w + 1) / 2);
    const ty = 76 + 60 * puzzle.row[piece.id]! + Math.floor((60 * piece.h + 1) / 2);
    rig.host.input.moveMouse(tx, ty);
    await rig.tick(3);
    if (mode === "click") rig.host.click(tx, ty);
    else rig.host.input.mouseUp("left");
    await rig.tick(3);
    expect(rig.services.pointer.carried).toBeNull();
    expect(correct(piece)).toBe(true);
  }
}

/** Palette logique 154–225 (RVB). */
function puzzleColors(rig: Rig): Uint8Array {
  return rig.services.graphics.palette.snapshot(154, 72);
}

real("Puzzle Patterns : scène complète sur PATTERNS.DAT", () => {
  it("entrée : fond 103, menu vert, fondu, animation des visages puis musique", async () => {
    const rig = await boot();
    const { scene, host, services } = rig;
    await rig.tick(40);
    expect(rig.engine.scenes.currentId).toBe(SceneId.patterns);
    expect(scene.puzzleSession.mode).toBe("menu");
    expect(scene.puzzleSession.level).toBe(0);
    expect(host.frames.length).toBeGreaterThan(0);
    // Le fondu d'entrée (30 ticks) a abouti : la palette affichée est la palette logique.
    const shown = services.graphics.palette.output();
    expect(shown.slice(10 * 3, 246 * 3)).toEqual(services.graphics.palette.colors.slice(10 * 3, 246 * 3));
    // Les 9 vignettes sont dessinées : pixels non nuls dans chacune.
    const pixels = services.graphics.screen.pixels;
    for (let k = 0; k < 9; k++) {
      const r = thumbRect(THUMB_LAYOUTS.patterns, k);
      expect(pixels[(r.y + 36) * 576 + r.x + 36]).not.toBe(0);
    }
    // Reset est désactivé dans le menu.
    expect(rig.sounds.some((s) => s.id === 100)).toBe(false); // la musique attend la fin de l'animation des visages
    await rig.until(() => services.sound.musicPlaying);
    const music = rig.sounds.find((s) => s.id === 100)!;
    expect(music.options).toMatchObject({ loop: true, ambient: true });
  });

  it("Ambient Sounds coupé : pas de musique de fond", async () => {
    const host = new TestHost();
    host.audio.unlock();
    const engine = new Engine(host, { seed: 3 });
    const services = installServices(engine);
    engine.ctx.roster.roster.ambient = false;
    engine.register(SceneId.patterns, () => createPatternsScene(services));
    engine.start(SceneId.patterns);
    await runFor(engine, host, 6000);
    expect(services.sound.musicPlaying).toBe(false);
  });

  it("boutons de niveau : le menu du niveau choisi (palette 154–188 de sa SHPL), le même niveau ne change rien", async () => {
    const rig = await boot();
    const { scene, services } = rig;
    const archive = rig.engine.ctx.resources.require("PATTERNS.DAT");
    await rig.clickButton("orange");
    expect(scene.puzzleSession.level).toBe(1);
    const thumbs = parseShpl(archive.raw("SHPL", 6530));
    const first = services.graphics.palette.colors.slice(154 * 3, 155 * 3);
    // Valeur éclaircie (v + 31 − ⌊v/8⌋) de la première entrée de la SHPL 6530.
    const bright = (v: number) => (v === 0 ? 0 : v + 31 - Math.floor(v / 8));
    expect([...first]).toEqual([...thumbs.rgb.slice(0, 3)].map(bright));
    const frames = rig.host.frames.length;
    await rig.clickButton("orange");
    expect(scene.puzzleSession.level).toBe(1);
    expect(rig.sounds.filter((s) => s.id === 6502).length).toBeGreaterThan(0);
    expect(rig.host.frames.length).toBeGreaterThanOrEqual(frames);
    await rig.clickButton("red");
    expect(scene.puzzleSession.level).toBe(2);
    await rig.clickButton("green");
    expect(scene.puzzleSession.level).toBe(0);
  });

  it("survol d'une vignette : son 6510 et cadre de survol de la couleur du niveau", async () => {
    const rig = await boot();
    const r = thumbRect(THUMB_LAYOUTS.patterns, 4);
    rig.host.input.moveMouse(r.x + 10, r.y + 10);
    await rig.tick(3);
    expect(rig.sounds.filter((s) => s.id === 6510)).toHaveLength(1);
    // Le cadre (80×80 au pas de 78) passe à 4 px à l'extérieur : colonne r.x − 4, couleur 77 au niveau vert.
    const pixels = rig.services.graphics.screen.pixels;
    const archive = rig.engine.ctx.resources.require("PATTERNS.DAT");
    const mask = archive.shap(6529);
    let drawn = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (mask.pixels[y * 80 + x] && pixels[(r.y - 4 + y) * 576 + r.x - 4 + x] === 77) drawn++;
    expect(drawn).toBeGreaterThan(200);
    // Plus de survol : le cadre disparaît.
    rig.host.input.moveMouse(5, 5);
    await rig.tick(3);
    let left = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (mask.pixels[y * 80 + x] && pixels[(r.y - 4 + y) * 576 + r.x - 4 + x] === 77) left++;
    expect(left).toBeLessThan(drawn / 4);
  });

  it("choix d'un puzzle : son 6511, mélange en deux piles, cadre-indice, palette du tableau, Reset actif", async () => {
    const rig = await boot();
    const { scene, services } = rig;
    const before = services.graphics.palette.snapshot(154, 72);
    await rig.thumb(1);
    expect(scene.puzzleSession.mode).toBe("playing");
    expect(scene.puzzleSession.puzzle).toBe(1);
    expect(rig.sounds.some((s) => s.id === 6511)).toBe(true);
    const board = scene.currentBoard!;
    expect(board.pieces).toHaveLength(8);
    expect(board.pieces.every((p) => !p.placed && p.col === -1)).toBe(true);
    // Le mélange est celui du noyau, sans autre appel au hasard entre-temps : pile du bas pour les slots 0–3, du haut pour 4–7.
    const ys = new Set(board.pieces.map((p) => p.cy));
    expect(Math.max(...ys)).toBeLessThanOrEqual(315);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(156 - 51);
    // Le puzzle 6650 (Papillon) a ses propres couleurs : la palette 154–225 a changé.
    expect(puzzleColors(rig)).not.toEqual(before);
    // Cadre-indice posé en (48, 46) : le cadre doré n'est pas du fond.
    const archive = rig.engine.ctx.resources.require("PATTERNS.DAT");
    const frame = archive.shap(archive.shpl(patternsPuzzId(0, 1)).firstShapeId);
    const pixels = services.graphics.screen.pixels;
    let same = 0;
    for (let y = 0; y < 301; y++) for (let x = 0; x < 301; x++) if (frame.pixels[y * 301 + x] && pixels[(46 + y) * 576 + 48 + x] === frame.pixels[y * 301 + x]) same++;
    expect(same).toBeGreaterThan(5000);
    // Chaque pièce est dessinée à son rectangle : la forme attendue y est (hors pièces recouvertes par une autre, le rang 0 au-dessus).
    const top = board.pieces[0]!;
    const rect = patternsRect(top);
    const shape = archive.shap(pieceShapeId(archive.shpl(patternsPuzzId(0, 1)).firstShapeId, top));
    expect(shape.width).toBe(rect.right - rect.left);
    expect(pixels[(rect.top + 20) * 576 + rect.left + 20]).toBe(shape.pixels[20 * shape.width + 20]);
    // Les vignettes ne répondent plus, le bouton Reset oui.
    await rig.thumb(2);
    expect(scene.puzzleSession.puzzle).toBe(1);
  });

  it("Espace tourne la dernière pièce prise (son 6506) ; Rotate aussi ; ignoré dans le menu", async () => {
    const rig = await boot();
    const { scene, host } = rig;
    host.press("Space", { key: " " });
    await rig.tick(2);
    expect(rig.sounds.some((s) => s.id === 6506)).toBe(false);
    await rig.thumb(0);
    const piece = scene.currentBoard!.pieces[0]!;
    const rot = piece.rot;
    host.press("Space", { key: " " });
    await rig.tick(2);
    expect(piece.rot).toBe((rot + 1) % 4);
    expect(rig.sounds.filter((s) => s.id === 6506)).toHaveLength(1);
    await rig.clickButton("rotate");
    expect(piece.rot).toBe((rot + 2) % 4);
    expect(rig.sounds.filter((s) => s.id === 6506)).toHaveLength(2);
  });

  it("prise : la pièce portée a son centre sous le curseur, le rang 0, et se dépose avec le son 6513 (cliquer-poser)", async () => {
    const rig = await boot();
    const { scene, host } = rig;
    await rig.thumb(0);
    const board = scene.currentBoard!;
    const piece = board.pieces[0]!;
    host.click(piece.cx, piece.cy);
    await rig.tick(3);
    expect(rig.sounds.some((s) => s.id === 6512)).toBe(true);
    host.input.moveMouse(120, 200);
    await rig.tick(3);
    expect(piece.cx).toBe(120);
    expect(piece.cy).toBe(200);
    host.click(120, 200);
    await rig.tick(3);
    expect(rig.sounds.some((s) => s.id === 6513)).toBe(true);
    // (120, 200), pièce 61×121 : rect (90, 140) → aimantée à la case la plus proche, col 0, ligne 1 (ou 2) selon l'arrondi.
    expect(piece.placed).toBe(true);
    expect(piece.col).toBe(Math.floor((patternsRect(piece).left - PATTERNS.grid.x) / 60));
  });

  it("une pièce déposée dans le cartouche des boutons en est repoussée", async () => {
    const rig = await boot();
    const { scene, host } = rig;
    await rig.thumb(0);
    const piece = scene.currentBoard!.pieces[0]!;
    host.click(piece.cx, piece.cy);
    await rig.tick(3);
    host.input.moveMouse(200, 400);
    await rig.tick(3);
    host.click(200, 400);
    await rig.tick(3);
    expect(piece.placed).toBe(false);
    // Bas du rectangle ≤ 354 ou gauche ≥ 351 : plus dans le cartouche (0, 354, 351, 432).
    const r = patternsRect(piece);
    expect(r.bottom <= 354 || r.left >= 351).toBe(true);
  });

  it("boutons enfoncés : la forme appuyée est posée au second rectangle de la table, sans reste de la forme au repos", async () => {
    const rig = await boot();
    // L'animation d'entrée passe sur le décor et le restaure à la fin : on attend qu'elle soit finie.
    await rig.until(() => rig.services.scr.running.length === 0);
    await rig.tick(3);
    const archive = new Archive("PATTERNS.DAT", MohawkArchive.parse(readOriginal("PATTERNS.DAT")));
    const wall = archive.shap(BACKGROUND_ID);
    const screen = rig.services.graphics.screen;
    const expected = (shape: { width: number; height: number; pixels: Uint8Array }, ox: number, oy: number, x: number, y: number) => {
      const v = x >= ox && y >= oy && x < ox + shape.width && y < oy + shape.height ? shape.pixels[(y - oy) * shape.width + (x - ox)]! : 0;
      return v !== 0 ? v : wall.pixels[y * 576 + x]!;
    };
    for (const def of BUTTONS) {
      const { left, top, right, bottom } = def.edges;
      const normal = archive.shap(def.shapeId);
      const pressed = archive.shap(def.shapeId + 1);
      // Table `DS:1c1c` : le rectangle appuyé garde les bords droit et bas de celui du repos.
      expect(def.pressedEdges.right).toBe(right);
      expect(def.pressedEdges.bottom).toBe(bottom);
      expect(def.pressedEdges.right - def.pressedEdges.left).toBe(pressed.width);
      expect(def.pressedEdges.bottom - def.pressedEdges.top).toBe(pressed.height);
      const [cx, cy] = buttonCenter(def.role);
      rig.host.input.moveMouse(cx, cy);
      rig.host.input.mouseDown("left");
      await rig.tick(3);
      if (def.role === "reset") {
        // Désactivé au menu : l'appui ne l'enfonce pas.
        rig.host.input.mouseUp("left");
        continue;
      }
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          expect(screen.get(x, y), `${def.role} appuyé (${x}, ${y})`).toBe(expected(pressed, def.pressedEdges.left, def.pressedEdges.top, x, y));
        }
      }
      rig.host.input.moveMouse(5, 5);
      rig.host.input.mouseUp("left");
      await rig.tick(3);
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) expect(screen.get(x, y), `${def.role} repos (${x}, ${y})`).toBe(expected(normal, left, top, x, y));
      }
    }
  });

  it("stores vénitiens : 15 ticks vers un autre menu ou un puzzle, 30 puis 15 depuis un puzzle actif et 30 au Reset ; un clic les achève", async () => {
    const rig = await boot();
    await rig.until(() => rig.scene.flowKind === "free");
    const between = (n: number, min: number, max: number) => {
      expect(n).toBeGreaterThanOrEqual(min);
      expect(n).toBeLessThanOrEqual(max);
    };
    /** Nombre de ticks de transition déclenchés par un clic. */
    const blinds = async (x: number, y: number) => {
      rig.host.click(x, y);
      let n = 0;
      await rig.tick(1);
      while (rig.scene.flowKind === "transition" && n < 200) {
        await rig.tick(1);
        n++;
      }
      return n;
    };
    const [gx, gy] = buttonCenter("orange");
    between(await blinds(gx, gy), 13, 18);
    const t = thumbRect(THUMB_LAYOUTS.patterns, 0);
    between(await blinds(t.x + 36, t.y + 36), 13, 18);
    expect(rig.scene.puzzleSession.mode).toBe("playing");
    const [rx, ry] = buttonCenter("reset");
    between(await blinds(rx, ry), 28, 33);
    const [vx, vy] = buttonCenter("green");
    between(await blinds(vx, vy), 43, 50);
    expect(rig.scene.puzzleSession).toMatchObject({ mode: "menu", level: 0 });
    // Un clic pendant la transition la termine d'un coup.
    rig.host.click(gx, gy);
    await rig.tick(4);
    expect(rig.scene.flowKind).toBe("transition");
    rig.host.click(200, 200);
    await rig.tick(3);
    expect(rig.scene.flowKind).toBe("free");
    expect(rig.scene.puzzleSession.level).toBe(1);
  });

  it("Reset : nouveau mélange du même puzzle, son 6505 ; sans effet dans le menu", async () => {
    const rig = await boot();
    const { scene, host } = rig;
    await rig.clickButton("reset");
    expect(rig.sounds.some((s) => s.id === 6505)).toBe(false);
    await rig.thumb(3);
    const board = scene.currentBoard!;
    const first = board.pieces.map((p) => ({ id: p.id, rot: p.rot, cx: p.cx, cy: p.cy }));
    // Une pièce posée dans la grille...
    const piece = board.pieces[0]!;
    host.click(piece.cx, piece.cy);
    await rig.tick(3);
    host.input.moveMouse(138, 136);
    await rig.tick(3);
    host.click(138, 136);
    await rig.tick(3);
    expect(piece.placed).toBe(true);
    const expected = new MsvcRandom(0);
    expected.seed(rig.engine.ctx.rng.current);
    const redeal = dealPatterns(board.puzzle, expected);
    await rig.clickButton("reset");
    expect(rig.sounds.filter((s) => s.id === 6505)).toHaveLength(1);
    expect(scene.currentBoard).toBe(board);
    expect(board.pieces.every((p) => !p.placed && p.col === -1 && p.row === -1)).toBe(true);
    expect(board.pieces.map((p) => ({ id: p.id, rot: p.rot, cx: p.cx, cy: p.cy }))).toEqual(redeal.map((p) => ({ id: p.id, rot: p.rot, cx: p.cx, cy: p.cy })));
    // Le mélange a bien changé par rapport au premier.
    expect(board.pieces.map((p) => ({ id: p.id, rot: p.rot, cx: p.cx, cy: p.cy }))).not.toEqual(first);
  });

  it("victoire en cliquer-poser : voix 6520–6523 attendue, puis SCR 20000 + 900·L + 100·k, puis musique et replay", async () => {
    const rig = await boot();
    const { scene, services, host } = rig;
    await rig.thumb(0);
    await rig.until(() => services.sound.musicPlaying);
    await solveBoard(rig, "click");
    expect(scene.currentBoard!.solved).toBe(true);
    expect(scene.puzzleSession.mode).toBe("solved");
    // Musique coupée, voix de félicitation sur le canal voix, animation seulement après la voix.
    expect(services.sound.musicPlaying).toBe(false);
    const voice = rig.sounds.find((s) => s.id >= 6520 && s.id <= 6523)!;
    expect(voice.options?.channel).toBe("voice");
    expect(scene.flowKind).toBe("voice");
    expect(rig.blocking).toEqual([]);
    expect(host.cursor).toBeDefined();
    await rig.until(() => scene.flowKind === "reward");
    expect(rig.blocking).toEqual([patternsRewardId(0, 0)]);
    expect(rig.blocking[0]).toBe(20000);
    await rig.until(() => scene.flowKind === "free", 60_000);
    // La musique reprend et le tableau est cliquable pour rejouer ; les pièces ne réagissent plus.
    expect(services.sound.musicPlaying).toBe(true);
    host.click(480, 200);
    await rig.tick(3);
    expect(services.pointer.carried).toBeNull();
    expect(scene.flowKind).toBe("free");
    host.click(200, 150);
    await rig.tick(3);
    expect(scene.flowKind).toBe("reward");
    expect(rig.blocking).toEqual([20000, 20000]);
    await rig.until(() => scene.flowKind === "free", 60_000);
    // Reset après la victoire : les pièces sont de nouveau actives.
    await rig.clickButton("reset");
    expect(scene.puzzleSession.mode).toBe("playing");
    expect(scene.currentBoard!.solved).toBe(false);
  });

  it("victoire en glisser-déposer", async () => {
    const rig = await boot({ clickAndStick: false });
    expect(rig.services.pointer.mode).toBe("drag");
    await rig.thumb(1);
    await solveBoard(rig, "drag");
    expect(rig.scene.currentBoard!.solved).toBe(true);
    await rig.until(() => rig.scene.flowKind === "reward");
    expect(rig.blocking).toEqual([20100]);
  });

  it("un clic coupe l'animation de victoire", async () => {
    const rig = await boot();
    await rig.thumb(0);
    await solveBoard(rig, "click");
    await rig.until(() => rig.scene.flowKind === "reward");
    await rig.tick(10);
    expect(rig.scene.flowKind).toBe("reward");
    rig.host.click(300, 200);
    await rig.tick(3);
    expect(rig.scene.flowKind).toBe("free");
    expect(rig.services.scr.blocking).toBe(false);
  });

  it("victoire animée par la palette (Orange, Tie dye, SCR 21100) : cyclage de 28 entrées dès 154, période de 7 ticks, palette rétablie ensuite", async () => {
    const rig = await boot();
    const { scene, services } = rig;
    await rig.clickButton("orange");
    await rig.thumb(2);
    const before = puzzleColors(rig);
    await solveBoard(rig, "click");
    await rig.until(() => scene.flowKind === "reward");
    expect(rig.blocking).toEqual([21100]);
    expect(REWARD_CYCLES[21100]).toEqual({ first: 154, count: 28 });
    const start = services.graphics.palette.snapshot(154, 28);
    // Un cran tous les 7 ticks : au bout d'un peu plus de 7 ticks, l'entrée 154 a pris la couleur de l'entrée 155 (sens +1).
    await rig.tick(10);
    const moved = services.graphics.palette.snapshot(154, 28);
    expect(moved).not.toEqual(start);
    // Les entrées hors plage (182 et au-delà) ne bougent pas.
    expect(services.graphics.palette.snapshot(182, 44)).toEqual(before.slice(28 * 3));
    // Le cycle tourne avec un seul pas à la fois : un tour complet (28 crans × 7 ticks) remet les couleurs en place.
    const out = new Uint8Array(PALETTE_BYTES);
    services.graphics.palette.output(out);
    expect([...out.slice(154 * 3, 182 * 3)]).toEqual([...moved]);
    await rig.until(() => scene.flowKind === "free", 60_000);
    expect(puzzleColors(rig)).toEqual(before);
  });

  it("une victoire sans cyclage ne touche pas à la palette", async () => {
    const rig = await boot();
    await rig.thumb(0);
    const before = puzzleColors(rig);
    await solveBoard(rig, "click");
    await rig.until(() => rig.scene.flowKind === "reward");
    await rig.tick(40);
    expect(puzzleColors(rig)).toEqual(before);
  });

  it("aide de Poly : arrivée, grande présentation la 1re fois, explication d'un bouton, clic sur Poly = conseil puis départ ; flag du roster enregistré à la sortie", async () => {
    const rig = await boot({ player: true });
    const { scene, engine, host, services } = rig;
    await rig.until(() => services.sound.musicPlaying);
    await rig.thumb(0);
    const piecesBefore = scene.currentBoard!.pieces.map((p) => ({ cx: p.cx, cy: p.cy }));
    await rig.clickButton("help");
    const poly = scene.helper;
    expect(poly.active).toBe(true);
    expect(poly.played[0]).toBe(35000);
    await rig.until(() => poly.phase === "intro");
    expect(poly.currentScr).toBe(35100);
    expect(engine.ctx.roster.roster.getVar(engine.ctx.roster.currentPlayerId, "patternsPolyIntroSeen")).toBe(1);
    // Pendant l'aide : Espace non consommé, pièces non prenables, boutons gelés.
    host.press("Space", { key: " " });
    await rig.tick(2);
    expect(rig.sounds.some((s) => s.id === 6506)).toBe(false);
    // Un clic coupe la présentation.
    host.click(100, 100);
    await rig.tick(4);
    await rig.until(() => poly.phase === "listening");
    // Clic sur une pièce : explication 35650 (encadrée), la pièce n'est pas prise.
    const pieces = scene.currentBoard!.pieces;
    const piece = pieces.find((p) => helpZoneAt(p.cx, p.cy, pieces) === "piece")!;
    host.click(piece.cx, piece.cy);
    await rig.tick(4);
    expect(services.pointer.carried).toBeNull();
    await rig.until(() => poly.played.includes(35650));
    await rig.until(() => poly.phase === "listening", 60_000);
    // Clic sur Rotate : explication 35800, aucune rotation.
    const rot = piece.rot;
    await rig.clickButton("rotate");
    await rig.until(() => poly.played.includes(35800));
    expect(piece.rot).toBe(rot);
    await rig.until(() => poly.phase === "listening", 60_000);
    // Clic sur Poly : réplique 37000 + 50·r puis départ 35050 ; l'aide se referme et le jeu reprend.
    host.click(400, 350);
    await rig.tick(4);
    expect(poly.phase).toBe("leaving");
    const tip = poly.played.find((id) => id >= 37000 && id < 37000 + 50 * 13);
    expect(tip).toBeDefined();
    expect((tip! - 37000) % 50).toBe(0);
    await rig.until(() => !poly.active, 60_000);
    expect(poly.played.at(-1)).toBe(35050);
    expect(scene.currentBoard!.pieces.map((p) => ({ cx: p.cx, cy: p.cy }))).toEqual(piecesBefore);
    // Le jeu reprend : une pièce se prend de nouveau.
    const again = scene.currentBoard!.pieces[0]!;
    host.click(again.cx, again.cy);
    await rig.tick(3);
    expect(services.pointer.carried?.item).toBe(again);
    host.click(again.cx, again.cy);
    await rig.tick(3);
    // Sortie : le roster est enregistré (drapeau « Poly a présenté »).
    await rig.clickButton("exit");
    await rig.until(() => engine.scenes.currentId === SceneId.hub);
    expect(host.storage.get("retrovibe:mathemagique:roster")).not.toBeNull();
  });

  it("aide dans le menu : la télé explique 35850 ; seconde ouverture = présentation courte 35250", async () => {
    const rig = await boot({ player: true });
    const { scene, host } = rig;
    await rig.clickButton("help");
    const poly = scene.helper;
    await rig.until(() => poly.phase === "intro");
    host.click(100, 100);
    await rig.tick(4);
    await rig.until(() => poly.phase === "listening");
    host.click(200, 100);
    await rig.tick(4);
    await rig.until(() => poly.played.includes(35850));
    await rig.until(() => poly.phase === "listening", 60_000);
    host.click(400, 350);
    await rig.tick(4);
    await rig.until(() => !poly.active, 60_000);
    await rig.clickButton("help");
    await rig.until(() => poly.phase === "intro");
    expect(poly.currentScr).toBe(35250);
  });

  it("Exit : fondu au noir de 30 ticks puis retour au hub ; la musique est coupée", async () => {
    const rig = await boot();
    const { engine, services } = rig;
    await rig.until(() => services.sound.musicPlaying);
    await rig.clickButton("exit");
    expect(engine.scenes.currentId).toBe(SceneId.patterns);
    expect(services.sound.musicPlaying).toBe(false);
    await rig.until(() => engine.scenes.currentId === SceneId.hub);
    expect(services.gadgets.hovered).toBeNull();
  });

  it("la demande de sortie du moteur (exit) suit le même chemin que le bouton Exit", async () => {
    const rig = await boot();
    rig.engine.requestExit();
    await rig.until(() => rig.engine.scenes.currentId === SceneId.hub);
  });

  it("les 27 puzzles se chargent : PUZZ, SHPL, SCR de victoire, formes de pièces", () => {
    const archive = MohawkArchive.parse(readOriginal("PATTERNS.DAT"));
    for (let level = 0; level < 3; level++) {
      for (let k = 0; k < 9; k++) {
        const id = patternsPuzzId(level, k);
        const puzzle = parsePatternsPuzz(archive.get("PUZZ", id));
        expect(puzzle.orient).toHaveLength(8);
        const shpl = parseShpl(archive.get("SHPL", id));
        expect(shpl.shapeCount).toBe(33);
        expect(archive.has("\0SCR", patternsRewardId(level, k))).toBe(true);
        for (let piece = 0; piece < 8; piece++) for (let rot = 0; rot < 4; rot++) expect(archive.has("SHAP", pieceShapeId(shpl.firstShapeId, { id: piece, rot }))).toBe(true);
      }
    }
  });
});
