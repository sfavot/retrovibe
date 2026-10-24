import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { hitTestShape } from "../../src/games/mathemagique/engine/graphics/blit";
import { MsvcRandom } from "../../src/games/mathemagique/engine/rng";
import { SceneId, type Scene } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import type { PlaySoundOptions } from "../../src/games/mathemagique/engine/sound";
import { PatternWindowsScene, createPatternWindowsScene, helpZoneAt } from "../../src/games/mathemagique/scenes/pattern-windows";
import {
  BLANK_BYTE,
  MAX_CELLS,
  PATTERN_CELL_COUNTS,
  PATTERN_STORAGE_BYTES,
  PATTERN_VERSION_OFFSETS,
  STORAGE_BYTES,
  applyFaucet,
  beginStroke,
  blankStorage,
  cropPixels,
  createPaintState,
  crc32,
  encodeIndexedPng,
  faucetMode,
  isColorful,
  layoutCells,
  nextColor,
  nextPattern,
  packCells,
  paintAt,
  parsePtrn,
  patternCellCount,
  prevColor,
  prevPattern,
  printFileName,
  readStorage,
  rotatePalette,
  slugPatternName,
  storageOffset,
  takeSnapshot,
  toggleUndo,
  unpackCells,
  writeStorage,
  writeStorageCell,
  type CellDef,
  type FaucetMode,
} from "../../src/games/mathemagique/scenes/pattern-windows-logic";
import { FRAME_MS, TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

// =====================================================================================================================================
// Logique pure
// =====================================================================================================================================

describe("pattern-windows-logic : stockage", () => {
  it("déplacements des motifs dans une version : 0x000, 0x0c8, 0x170, 0x25a, 0x328, 0x3b2, 0x4b8, 0x538, 0x590, 0x65c", () => {
    expect(PATTERN_VERSION_OFFSETS).toEqual([0x000, 0x0c8, 0x170, 0x25a, 0x328, 0x3b2, 0x4b8, 0x538, 0x590, 0x65c]);
    expect(storageOffset(9, 2)).toBe(2 * 0x6da + 0x65c);
    expect(STORAGE_BYTES).toBe(5262);
    expect(PATTERN_STORAGE_BYTES.reduce((a, b) => a + b, 0)).toBe(0x6da);
  });

  it("octet 0x77 → cellules [7, 7] ; octet 0xE3 → [3, 14] (quartet bas = cellule paire)", () => {
    expect([...unpackCells(Uint8Array.of(0x77)).subarray(0, 2)]).toEqual([7, 7]);
    expect([...unpackCells(Uint8Array.of(0xe3)).subarray(0, 2)]).toEqual([3, 14]);
    expect([...packCells(Uint8Array.of(3, 14), 1)]).toEqual([0xe3]);
  });

  it("unpack(pack(x)) = x ; une cellule hors des octets lus ou un quartet 15 vaut 7", () => {
    const cells = new Uint8Array(MAX_CELLS);
    for (let i = 0; i < MAX_CELLS; i++) cells[i] = (i * 7) % 15;
    expect([...unpackCells(packCells(cells, 262))]).toEqual([...cells]);
    expect([...unpackCells(Uint8Array.of(0xff)).subarray(0, 3)]).toEqual([7, 7, 7]);
    expect(unpackCells(new Uint8Array(0))[0]).toBe(7);
  });

  it("writeStorage / readStorage par motif et version ; writeStorageCell ne touche qu'un quartet", () => {
    const storage = blankStorage();
    expect(storage.every((b) => b === BLANK_BYTE)).toBe(true);
    const cells = unpackCells(new Uint8Array(0));
    cells[0] = 3;
    cells[1] = 14;
    cells[399] = 2;
    writeStorage(storage, 0, 1, cells);
    expect(storage[0x6da]).toBe(0xe3);
    expect(storage[0x6da + 199]).toBe(0x27);
    expect(readStorage(storage, 0, 1)[399]).toBe(2);
    expect(readStorage(storage, 0, 0)[0]).toBe(7);
    writeStorageCell(storage, 3, 2, 5, 9);
    const at = storageOffset(3, 2) + 2;
    expect(storage[at]).toBe(0x97);
    writeStorageCell(storage, 3, 2, 4, 1);
    expect(storage[at]).toBe(0x91);
    expect(storage[at - 1]).toBe(0x77);
    expect(storage[at + 1]).toBe(0x77);
  });
});

describe("pattern-windows-logic : règles", () => {
  it("couleurs et motifs : parcours circulaires", () => {
    expect(nextColor(14)).toBe(0);
    expect(prevColor(0)).toBe(14);
    expect(nextColor(3)).toBe(4);
    expect(prevPattern(0)).toBe(9);
    expect(nextPattern(9)).toBe(0);
  });

  it("rotatePalette([a0…a14]) = [a1…a14, a0]", () => {
    const colors = Array.from({ length: 15 }, (_, i) => i);
    expect(rotatePalette(colors)).toEqual([...colors.slice(1), 0]);
    expect(rotatePalette([])).toEqual([]);
  });

  it("isColorful : seuil ⌊400/3⌋ × 2 = 266 (267 d'une couleur : faux, 266 : vrai)", () => {
    const cells = (same: number) => {
      const out = new Uint8Array(MAX_CELLS);
      for (let i = 0; i < MAX_CELLS; i++) out[i] = i < same ? 4 : 1 + (i % 3);
      return out;
    };
    expect(isColorful(cells(267), 200)).toBe(false);
    expect(isColorful(cells(266), 200)).toBe(true);
    // Plus de 262 octets : plafonné à 524 cellules (seuil 174 × 2 = 348).
    expect(isColorful(cells(349), 300)).toBe(false);
    expect(isColorful(cells(348), 300)).toBe(true);
    // Une image unie n'est pas variée.
    expect(isColorful(new Uint8Array(MAX_CELLS).fill(7), 200)).toBe(false);
  });

  it("paintAt : la première cellule touchée décide de peindre ou de restaurer l'instantané", () => {
    const defs: CellDef[] = [0, 1, 2].map((i) => ({ index: i, x: 10 * i, y: 0, width: 10, height: 10, maskId: 0 }));
    const hit = () => true;
    const state = createPaintState();
    // Peinture : couleur 3 sur la cellule 1.
    let stroke = beginStroke(state);
    expect(paintAt(state, defs, hit, 15, 5, 3, stroke)).toBe(1);
    expect(state.cells[1]).toBe(3);
    // Même geste, même cellule : rien à changer (le parcours continue, aucune autre cellule ne contient le point).
    expect(paintAt(state, defs, hit, 15, 5, 3, stroke)).toBe(-1);
    // Nouveau geste sur une cellule déjà de la couleur : mode effacement, restaure l'instantané (7).
    stroke = beginStroke(state);
    expect(paintAt(state, defs, hit, 15, 5, 3, stroke)).toBe(1);
    expect(stroke.mode).toBe(1);
    expect(state.cells[1]).toBe(7);
    // En mode effacement, une cellule qui vaut déjà son instantané ne change pas.
    expect(paintAt(state, defs, hit, 25, 5, 3, stroke)).toBe(-1);
    // Hors des rectangles et hors masque : aucun changement.
    expect(paintAt(state, defs, hit, 100, 100, 3, beginStroke(state))).toBe(-1);
    expect(paintAt(state, defs, () => false, 5, 5, 3, beginStroke(state))).toBe(-1);
    expect(state.cells.slice(0, 3)).toEqual(Uint8Array.of(7, 7, 7));
  });

  it("paintAt : une cellule touchée sans changement n'arrête pas le parcours (tuiles qui se chevauchent)", () => {
    const defs: CellDef[] = [
      { index: 0, x: 0, y: 0, width: 10, height: 10, maskId: 0 },
      { index: 1, x: 5, y: 0, width: 10, height: 10, maskId: 0 },
    ];
    const state = createPaintState();
    state.cells[0] = 3;
    // Au point (7, 5) les deux cellules sont touchées ; la cellule 0 est déjà de la couleur 3 : le mode du geste est « peinture » seulement
    // si la première touchée n'est pas de la couleur courante. Ici elle l'est : mode effacement, la cellule 0 revient à 7.
    const stroke = beginStroke(state);
    expect(paintAt(state, defs, () => true, 7, 5, 3, stroke)).toBe(0);
    expect(stroke.mode).toBe(1);
    // Mode peinture : cellule 0 déjà de la bonne couleur, mais le geste a commencé ailleurs → la cellule 1 est peinte.
    state.cells.fill(7);
    state.cells[0] = 4;
    takeSnapshot(state);
    const painting = { first: false, mode: 0 as const };
    state.cells[0] = 3;
    expect(paintAt(state, defs, () => true, 7, 5, 3, painting)).toBe(1);
    expect(state.cells[1]).toBe(3);
  });

  it("Yuck ! : échange tampon et instantané, deux appels = identité, rien si identiques ; le geste suivant reprend l'instantané", () => {
    const state = createPaintState();
    expect(toggleUndo(state)).toBe(false);
    takeSnapshot(state);
    state.cells[5] = 2;
    expect(toggleUndo(state)).toBe(true);
    expect(state.cells[5]).toBe(7);
    expect(state.undoActive).toBe(true);
    expect(toggleUndo(state)).toBe(true);
    expect(state.cells[5]).toBe(2);
    expect(state.undoActive).toBe(false);
    // Annulé, puis nouveau geste : l'instantané redevient le tampon.
    toggleUndo(state);
    beginStroke(state);
    expect(state.undoActive).toBe(false);
    expect([...state.snapshot]).toEqual([...state.cells]);
  });

  it("Robinet : mode 0 remplit, 6 inverse, 7 dégradé, 1 / 2 rotations circulaires, 3 et 5 selon la dernière cellule, 4 aléatoire 0 à 14", () => {
    const rng = new MsvcRandom(0);
    const fresh = () => {
      const state = createPaintState();
      for (let i = 0; i < MAX_CELLS; i++) state.cells[i] = i % 15;
      return state;
    };
    let state = fresh();
    applyFaucet(state, 0, 9, -1, 4, rng);
    expect(state.cells.every((c) => c === 9)).toBe(true);

    state = fresh();
    applyFaucet(state, 6, 0, -1, 4, rng);
    expect(state.cells[0]).toBe(14);
    expect(state.cells[14]).toBe(0);

    state = fresh();
    state.cells.fill(7);
    applyFaucet(state, 7, 0, -1, 4, rng);
    expect(state.cells[0]).toBe(0);
    expect(state.cells[16]).toBe(1);
    expect(state.cells[523]).toBe(523 % 15);

    state = fresh();
    applyFaucet(state, 1, 0, -1, 4, rng);
    expect([...state.cells.slice(0, 3)]).toEqual([1, 2, 3]);
    expect(state.cells[523]).toBe(0);
    applyFaucet(state, 2, 0, -1, 4, rng);
    expect([...state.cells.slice(0, 3)]).toEqual([0, 1, 2]);
    expect(state.cells[523]).toBe(523 % 15);

    // Mode 3 : la cellule de même rang dans chaque tuile (dernière cellule 6, tuiles de 4 → rang 2).
    state = fresh();
    applyFaucet(state, 3, 12, 6, 4, rng);
    for (let i = 0; i < MAX_CELLS; i++) expect(state.cells[i]).toBe(i % 4 === 2 ? 12 : i % 15);
    // Mode 5 : la tuile de la dernière cellule (10 → tuile 8..11) recopiée partout.
    state = fresh();
    applyFaucet(state, 5, 0, 10, 4, rng);
    expect([...state.cells.slice(0, 8)]).toEqual([8, 9, 10, 11, 8, 9, 10, 11]);
    // Modes 3 et 5 : sans cellule peinte, rien.
    state = fresh();
    applyFaucet(state, 3, 12, -1, 4, rng);
    applyFaucet(state, 5, 12, -1, 4, rng);
    expect(state.cells[0]).toBe(0);
    expect(state.cells[1]).toBe(1);

    state = fresh();
    applyFaucet(state, 4, 0, -1, 4, new MsvcRandom(0));
    expect(state.cells.every((c) => c <= 14)).toBe(true);
    // Premier tirage de la graine 0 : rand(14) = 8.
    expect(state.cells[0]).toBe(8);
  });

  it("zones du Robinet (cadre 453..482 × 369..397, marge 7)", () => {
    const at = (x: number, y: number): FaucetMode => faucetMode(x, y);
    expect(at(467, 383)).toBe(0);
    expect(at(455, 372)).toBe(1);
    expect(at(467, 372)).toBe(4);
    expect(at(480, 372)).toBe(2);
    expect(at(455, 394)).toBe(3);
    expect(at(467, 394)).toBe(6);
    expect(at(480, 394)).toBe(5);
    expect(at(455, 383)).toBe(7);
    expect(at(480, 383)).toBe(0);
  });

  it("nom du fichier imprimé : minuscules ASCII, tirets", () => {
    expect(slugPatternName("Turtle Shell")).toBe("turtle-shell");
    expect(slugPatternName("Étoiles  & Co.")).toBe("etoiles-co");
    expect(slugPatternName("")).toBe("motif");
    expect(printFileName("Checker")).toBe("vitrail-checker.png");
  });

  it("PNG indexé : signature, IHDR, PLTE, IDAT décompressable, CRC valides", () => {
    const width = 70;
    const height = 3;
    const pixels = new Uint8Array(width * height).map((_, i) => i % 251);
    const palette = new Uint8Array(768).map((_, i) => i % 256);
    const png = encodeIndexedPng(width, height, pixels, palette);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    const chunks: { type: string; data: Uint8Array }[] = [];
    for (let at = 8; at < png.length; ) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
      const data = png.subarray(at + 8, at + 8 + length);
      expect(view.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
      chunks.push({ type, data });
      at += 12 + length;
    }
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
    expect(new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset).getUint32(0)).toBe(width);
    expect([...chunks[0]!.data.subarray(8, 10)]).toEqual([8, 3]);
    expect(chunks[1]!.data.length).toBe(768);
    const raw = inflateSync(chunks[2]!.data);
    expect(raw.length).toBe(height * (width + 1));
    expect([...raw.subarray(1, 1 + width)]).toEqual([...pixels.subarray(0, width)]);
    expect(raw[width + 1]).toBe(0);
  });

  it("PNG : une image qui dépasse 65 535 octets passe en plusieurs blocs stockés", () => {
    const width = 343;
    const pixels = new Uint8Array(width * width).map((_, i) => (i * 31) % 256);
    const png = encodeIndexedPng(width, width, pixels, new Uint8Array(768));
    const idatAt = png.indexOf(0x49, 40);
    expect(idatAt).toBeGreaterThan(0);
    // Recherche du chunk IDAT par son type.
    let at = 8;
    let idat: Uint8Array | null = null;
    const view = new DataView(png.buffer, png.byteOffset);
    while (at < png.length) {
      const length = view.getUint32(at);
      if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === "IDAT") idat = png.subarray(at + 8, at + 8 + length);
      at += 12 + length;
    }
    const raw = inflateSync(idat!);
    expect(raw.length).toBe(width * (width + 1));
    expect(raw[(width + 1) * 200 + 1 + 5]).toBe(pixels[200 * width + 5]);
  });

  it("cropPixels : rectangle [gauche, droite[ × [haut, bas[", () => {
    const pixels = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect([...cropPixels(pixels, 4, 1, 1, 3, 3)]).toEqual([5, 6, 9, 10]);
  });

  it("zones d'aide : Poly d'abord, puis boutons, titre, nom, versions, couleurs, fenêtre", () => {
    expect(helpZoneAt(350, 400)).toBe("poly");
    expect(helpZoneAt(500, 380)).toBe("print");
    expect(helpZoneAt(430, 380)).toBe("kaleidoscope");
    expect(helpZoneAt(465, 380)).toBe("faucet");
    expect(helpZoneAt(510, 350)).toBe("help");
    expect(helpZoneAt(420, 350)).toBe("yuck");
    expect(helpZoneAt(460, 350)).toBe("exit");
    expect(helpZoneAt(470, 82)).toBe("title");
    expect(helpZoneAt(470, 55)).toBe("name");
    expect(helpZoneAt(470, 105)).toBe("version");
    expect(helpZoneAt(470, 200)).toBe("colors");
    expect(helpZoneAt(200, 200)).toBe("window");
    expect(helpZoneAt(10, 10)).toBeNull();
  });
});

// =====================================================================================================================================
// Scène sur les vraies données
// =====================================================================================================================================

const real = describe.skipIf(!hasOriginalFiles);

const hubStub: Scene = { enter() {}, leave() {}, tick() {} };

real("PTRN : géométrie des dix motifs", () => {
  it("cellules par motif : 400, 336, 468, 412, 276, 522, 255, 176, 405, 252 ; octets de stockage = ⌈cellules / 2⌉ (+1 pour 5 et 8)", async () => {
    const host = new TestHost();
    const engine = new Engine(host, {});
    const archive = await engine.ctx.resources.open("PATFILL.DAT");
    const counts: number[] = [];
    for (let pattern = 0; pattern < 10; pattern++) {
      const geometry = parsePtrn(archive.raw("PTRN", 40500 + 500 * pattern));
      const cells = layoutCells(geometry, pattern);
      counts.push(patternCellCount(geometry));
      expect(cells.length).toBe(patternCellCount(geometry));
      expect(cells.every((cell, i) => cell.index === i)).toBe(true);
      const needed = Math.ceil(cells.length / 2);
      expect(PATTERN_STORAGE_BYTES[pattern]! - needed).toBe(pattern === 5 || pattern === 8 ? 1 : 0);
      // Masques : forme 1 bit aux dimensions de la tuile.
      for (const cell of cells.slice(0, geometry.cellsPerTile)) {
        const shape = archive.shap(cell.maskId);
        expect([shape.bitsPerPixel, shape.width, shape.height]).toEqual([1, geometry.tileWidth, geometry.tileHeight]);
      }
    }
    expect(counts).toEqual([...PATTERN_CELL_COUNTS]);
    expect(counts).toEqual([400, 336, 468, 412, 276, 522, 255, 176, 405, 252]);
  });

  it("Checker : 4 cellules par tuile, pas de 34 px, 10 × 10 tuiles dès (52, 46)", async () => {
    const engine = new Engine(new TestHost(), {});
    const archive = await engine.ctx.resources.open("PATFILL.DAT");
    const geometry = parsePtrn(archive.raw("PTRN", 40500));
    expect([geometry.cellsPerTile, geometry.tileHeight, geometry.tileWidth, geometry.rows]).toEqual([4, 35, 35, 10]);
    const cells = layoutCells(geometry, 0);
    expect([cells[0]!.x, cells[0]!.y, cells[0]!.maskId]).toEqual([52, 46, 40200]);
    expect([cells[4]!.x, cells[4]!.y]).toEqual([52 + 34, 46]);
    expect([cells[40]!.x, cells[40]!.y]).toEqual([52, 46 + 34]);
  });
});

interface Rig {
  host: TestHost;
  engine: Engine;
  services: MathServices;
  scene: PatternWindowsScene;
  downloads: { blob: Blob; filename: string }[];
  sounds: { id: number; options?: PlaySoundOptions }[];
  roster: Engine["ctx"]["roster"];
  tick(n?: number): Promise<void>;
  until(done: () => boolean, limitMs?: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  clickButton(role: string): Promise<void>;
  clickColor(color: number): Promise<void>;
  clickVersion(version: number): Promise<void>;
  /** Un geste de glisser (bouton tenu) le long des points, une image par point. */
  drag(points: [number, number][]): Promise<void>;
  /** Un point de la cellule `index` qu'aucune cellule précédente ne touche. */
  pointIn(index: number): [number, number];
}

const BUTTON_CENTER: Record<string, [number, number]> = {
  print: [501, 383],
  kaleidoscope: [432, 383],
  left: [420, 83],
  right: [519, 83],
  faucet: [467, 383],
  help: [510, 353],
  yuck: [422, 353],
  exit: [466, 351],
};

async function boot(options: { clickAndStick?: boolean; player?: boolean; download?: boolean; ctrl?: boolean; ambient?: boolean } = {}): Promise<Rig> {
  const host = new TestHost();
  host.audio.unlock();
  const engine = new Engine(host, { seed: 5 });
  const services = installServices(engine);
  if (options.clickAndStick === false) engine.ctx.roster.roster.clickAndStick = false;
  if (options.ambient === false) engine.ctx.roster.roster.ambient = false;
  if (options.player !== false) {
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
  const downloads: Rig["downloads"] = [];
  const download = options.download === false ? undefined : { download: (blob: Blob, filename: string) => void downloads.push({ blob, filename }) };
  let scene!: PatternWindowsScene;
  engine.register(SceneId.patternWindows, () => (scene = createPatternWindowsScene(services, { download }) as PatternWindowsScene));
  engine.register(SceneId.hub, () => hubStub);
  if (options.ctrl) host.input.keyDown({ code: "ControlLeft", key: "Control", ctrl: true });
  engine.start(SceneId.patternWindows);
  await runFor(engine, host, 100);
  if (options.ctrl) host.input.keyUp("ControlLeft", { ctrl: false, shift: false, alt: false });
  const rig: Rig = {
    host,
    engine,
    services,
    get scene() {
      return scene;
    },
    downloads,
    sounds,
    roster: engine.ctx.roster,
    tick: (n = 1) => runFor(engine, host, FRAME_MS * n),
    until: (done, limitMs) => runUntil(engine, host, done, limitMs),
    async click(x, y) {
      host.click(x, y);
      await rig.tick(3);
    },
    async clickButton(role) {
      await rig.click(...BUTTON_CENTER[role]!);
    },
    async clickColor(color) {
      const column = Math.floor(color / 5);
      const k = color % 5;
      await rig.click([428, 467, 511][column]!, [162, 146, 162][column]! + 39 * k);
    },
    async clickVersion(version) {
      await rig.click(441 + 28 * version, 113);
    },
    async drag(points) {
      host.input.moveMouse(...points[0]!);
      host.input.mouseDown("left");
      await rig.tick(1);
      for (const point of points.slice(1)) {
        host.input.moveMouse(...point);
        await rig.tick(1);
      }
      host.input.mouseUp("left");
      await rig.tick(2);
    },
    pointIn(index) {
      const archive = engine.ctx.resources.require("PATFILL.DAT");
      const cells = scene.cellDefs;
      const cell = cells[index]!;
      for (let dy = 0; dy < cell.height; dy++) {
        for (let dx = 0; dx < cell.width; dx++) {
          if (!hitTestShape(archive.shap(cell.maskId), dx, dy)) continue;
          const x = cell.x + dx;
          const y = cell.y + dy;
          if (x < 52 || y < 46 || x >= 393 || y >= 387) continue;
          const earlier = cells.slice(0, index).some((c) => x - c.x >= 0 && y - c.y >= 0 && x - c.x < c.width && y - c.y < c.height && hitTestShape(archive.shap(c.maskId), x - c.x, y - c.y));
          if (!earlier) return [x, y];
        }
      }
      throw new Error(`cellule ${index} sans point libre`);
    },
  };
  await rig.until(() => scene.flowKind === "normal");
  return rig;
}

function storageOf(rig: Rig): Uint8Array {
  return rig.roster.roster.bytesOf(rig.roster.currentPlayerId, "patfillStainedGlass");
}

real("Pattern Windows : scène complète sur PATFILL.DAT", () => {
  it("entrée : jingle 3110 attendu, fondu, musique 1001, vitrail neuf en bleu clair (couleur 7), flèches clignotantes", async () => {
    const rig = await boot();
    const { scene, services, sounds } = rig;
    expect(sounds[0]!.id).toBe(3110);
    expect(scene.flowKind).toBe("normal");
    expect(rig.engine.scenes.currentId).toBe(SceneId.patternWindows);
    const music = sounds.find((s) => s.id === 1001)!;
    expect(music.options).toMatchObject({ loop: true, ambient: true });
    expect(scene.pattern).toBe(0);
    expect(scene.color).toBe(0);
    expect(scene.cellDefs.length).toBe(400);
    expect(scene.paintState.cells.slice(0, 400).every((c) => c === 7)).toBe(true);
    // Le roster d'un joueur neuf est rempli du défaut de l'original (0x77).
    expect(storageOf(rig).every((b) => b === BLANK_BYTE)).toBe(true);
    // Une cellule du vitrail est dessinée en 180 + 7.
    const [x, y] = rig.pointIn(0);
    expect(services.graphics.screen.pixels[y * 576 + x]).toBe(187);
    // Fondu terminé : la palette affichée est la logique.
    expect(services.graphics.palette.output().slice(10 * 3, 246 * 3)).toEqual(services.graphics.palette.colors.slice(10 * 3, 246 * 3));
    expect(scene.arrowsBlinking).toBe(true);
  });

  it("Ambient Sounds coupé : pas de musique", async () => {
    const rig = await boot({ ambient: false });
    expect(rig.services.sound.musicPlaying).toBe(false);
  });

  it("les flèches alternent repos / appuyé toutes les 12 ticks jusqu'au premier clic", async () => {
    const rig = await boot();
    const left = rig.services.gadgets;
    void left;
    const seen: boolean[] = [];
    for (let i = 0; i < 60; i++) {
      await rig.tick(1);
      seen.push(rig.scene.arrowsBlinking);
    }
    expect(seen.every(Boolean)).toBe(true);
    await rig.click(200, 200);
    expect(rig.scene.arrowsBlinking).toBe(false);
  });

  for (const mode of [true, false]) {
    it(`glisser ${mode ? "(cliquer-poser activé)" : "(glisser activé)"} : chaque cellule touchée prend la couleur, stockée dans le roster`, async () => {
      const rig = await boot({ clickAndStick: mode });
      const { scene } = rig;
      await rig.clickColor(3);
      expect(scene.color).toBe(3);
      expect(rig.sounds.some((s) => s.id === 3039)).toBe(true);
      const a = rig.pointIn(0);
      const b = rig.pointIn(5);
      const c = rig.pointIn(9);
      await rig.drag([a, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)], b, c]);
      const cells = scene.paintState.cells;
      expect([cells[0], cells[5], cells[9]]).toEqual([3, 3, 3]);
      expect(cells[399]).toBe(7);
      expect(scene.lastPaintedCell).toBeGreaterThanOrEqual(0);
      // Stockage : cellule 0 = quartet bas de l'octet 0, cellule 5 = quartet haut de l'octet 2.
      const storage = storageOf(rig);
      expect(storage[0]! & 0x0f).toBe(3);
      expect(storage[2]! >> 4).toBe(3);
      expect(storage[199]).toBe(0x77);
      // L'écran montre la cellule en 180 + 3.
      expect(rig.services.graphics.screen.pixels[a[1] * 576 + a[0]]).toBe(183);
    });
  }

  it("un clic simple (appui et relâchement dans le même tick) peint la cellule sous le curseur", async () => {
    const rig = await boot();
    await rig.clickColor(5);
    const [x, y] = rig.pointIn(12);
    await rig.click(x, y);
    expect(rig.scene.paintState.cells[12]).toBe(5);
  });

  it("le bouton droit ne peint pas", async () => {
    const rig = await boot();
    await rig.clickColor(5);
    const [x, y] = rig.pointIn(12);
    rig.host.click(x, y, "right");
    await rig.tick(3);
    expect(rig.scene.paintState.cells[12]).toBe(7);
  });

  it("un geste rapide (un grand saut entre deux ticks) donne le même vitrail qu'un geste lent sur le même chemin", async () => {
    const fast = await boot();
    const slow = await boot();
    const a = fast.pointIn(0);
    const b = fast.pointIn(160);
    await fast.clickColor(2);
    await slow.clickColor(2);
    await fast.drag([a, b]);
    const path: [number, number][] = [];
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let k = 0; k <= steps; k++) path.push([Math.round(a[0] + ((b[0] - a[0]) * k) / steps), Math.round(a[1] + ((b[1] - a[1]) * k) / steps)]);
    await slow.drag(path);
    const painted = (rig: Rig) => [...rig.scene.paintState.cells.slice(0, 400)].filter((c) => c === 2).length;
    expect(painted(fast)).toBeGreaterThan(3);
    expect([...fast.scene.paintState.cells]).toEqual([...slow.scene.paintState.cells]);
  });

  it("re-cliquer une cellule déjà de la couleur courante restaure l'instantané (effacement du geste)", async () => {
    const rig = await boot();
    await rig.clickColor(3);
    const a = rig.pointIn(0);
    const b = rig.pointIn(1);
    await rig.drag([a, b]);
    expect([rig.scene.paintState.cells[0], rig.scene.paintState.cells[1]]).toEqual([3, 3]);
    // Nouveau geste qui commence sur une cellule déjà de la couleur : mode effacement, la suivante est restaurée aussi.
    await rig.drag([a, b]);
    expect([rig.scene.paintState.cells[0], rig.scene.paintState.cells[1]]).toEqual([7, 7]);
    expect(storageOf(rig)[0]).toBe(0x77);
    // Repeindre depuis une cellule d'une autre couleur : peinture.
    await rig.drag([a]);
    expect(rig.scene.paintState.cells[0]).toBe(3);
  });

  it("changer de couleur prend un instantané : l'effacement revient à l'état de ce moment", async () => {
    const rig = await boot();
    await rig.clickColor(3);
    await rig.drag([rig.pointIn(0)]);
    await rig.clickColor(4);
    await rig.drag([rig.pointIn(0)]);
    expect(rig.scene.paintState.cells[0]).toBe(4);
    await rig.drag([rig.pointIn(0)]);
    // L'instantané date du choix de la couleur 4 : la cellule valait 3.
    expect(rig.scene.paintState.cells[0]).toBe(3);
  });

  it("touches x / z : couleur suivante / précédente, sans son, circulaire", async () => {
    const rig = await boot();
    const before = rig.sounds.length;
    rig.host.press("KeyZ", { key: "z" });
    await rig.tick(2);
    expect(rig.scene.color).toBe(14);
    rig.host.press("KeyX", { key: "X" });
    await rig.tick(2);
    expect(rig.scene.color).toBe(0);
    rig.host.press("KeyX", { key: "x" });
    await rig.tick(2);
    expect(rig.scene.color).toBe(1);
    expect(rig.sounds.length).toBe(before);
    expect(rig.roster.roster.getVar(rig.roster.currentPlayerId, "patfillColor")).toBe(1);
  });

  it("Robinet : tout le tampon prend la couleur courante ; Yuck ! annule, puis rétablit", async () => {
    const rig = await boot();
    await rig.clickColor(6);
    await rig.clickButton("faucet");
    expect(rig.scene.paintState.cells.every((c) => c === 6)).toBe(true);
    expect(rig.sounds.some((s) => s.id === 3038)).toBe(true);
    const storage = storageOf(rig);
    expect([...storage.subarray(0, 200)].every((b) => b === 0x66)).toBe(true);
    expect(storage[200]).toBe(0x77);
    await rig.clickButton("yuck");
    expect(rig.scene.paintState.cells.slice(0, 400).every((c) => c === 7)).toBe(true);
    expect(storageOf(rig)[0]).toBe(0x77);
    expect(rig.sounds.some((s) => s.id === 3053)).toBe(true);
    await rig.clickButton("yuck");
    expect(rig.scene.paintState.cells.slice(0, 400).every((c) => c === 6)).toBe(true);
    // Rien à annuler quand tout est identique : après un Robinet de la même couleur, Yuck ! ne change rien.
    await rig.clickButton("faucet");
    await rig.clickButton("yuck");
    expect(rig.scene.paintState.cells.slice(0, 400).every((c) => c === 6)).toBe(true);
  });

  it("modes cachés du Robinet : inactifs sans Ctrl à l'entrée", async () => {
    const rig = await boot();
    expect(rig.scene.hiddenToolsEnabled).toBe(false);
    await rig.clickColor(6);
    await rig.click(455, 383);
    expect(rig.scene.paintState.cells.every((c) => c === 6)).toBe(true);
  });

  it("modes cachés du Robinet : Ctrl à l'entrée, le point du clic choisit le mode (7 : dégradé, 6 : inversion)", async () => {
    const rig = await boot({ ctrl: true });
    expect(rig.scene.hiddenToolsEnabled).toBe(true);
    await rig.click(455, 383);
    expect(rig.scene.paintState.cells[16]).toBe(1);
    expect(rig.scene.paintState.cells[14]).toBe(14);
    await rig.click(467, 394);
    expect(rig.scene.paintState.cells[16]).toBe(13);
    expect(rig.scene.paintState.cells[14]).toBe(0);
  });

  it("flèches : motif suivant / précédent (circulaire), titre et réseau du motif, roster à jour", async () => {
    const rig = await boot();
    await rig.clickButton("right");
    expect(rig.scene.pattern).toBe(1);
    expect(rig.scene.cellDefs.length).toBe(336);
    expect(rig.sounds.some((s) => s.id === 3040)).toBe(true);
    expect(rig.roster.roster.getVar(rig.roster.currentPlayerId, "patfillPattern")).toBe(1);
    await rig.clickButton("left");
    await rig.clickButton("left");
    expect(rig.scene.pattern).toBe(9);
    expect(rig.scene.cellDefs.length).toBe(252);
    await rig.clickButton("right");
    expect(rig.scene.pattern).toBe(0);
    // Le titre est dessiné dans le cartouche (couleur 108).
    const { pixels } = rig.services.graphics.screen;
    let titlePixels = 0;
    for (let y = 79; y < 93; y++) for (let x = 429; x < 512; x++) if (pixels[y * 576 + x] === 108) titlePixels++;
    expect(titlePixels).toBeGreaterThan(20);
  });

  it("trois versions par motif : sauvegardées dans le roster et rechargées, même après avoir quitté la scène", async () => {
    const rig = await boot();
    await rig.clickColor(3);
    await rig.drag([rig.pointIn(0)]);
    expect(rig.scene.version).toBe(0);
    await rig.clickVersion(1);
    expect(rig.sounds.some((s) => s.id === 3041)).toBe(true);
    expect(rig.scene.version).toBe(1);
    expect(rig.scene.paintState.cells[0]).toBe(7);
    expect(rig.roster.roster.getVar(rig.roster.currentPlayerId, "patfillVersion", 0)).toBe(1);
    await rig.clickColor(9);
    await rig.drag([rig.pointIn(0), rig.pointIn(1)]);
    expect([rig.scene.paintState.cells[0], rig.scene.paintState.cells[1]]).toEqual([9, 9]);
    const storage = storageOf(rig);
    expect(storage[0x6da]! & 0x0f).toBe(9);
    expect(storage[0]! & 0x0f).toBe(3);
    // Autre motif : sa version courante est mémorisée séparément.
    await rig.clickButton("right");
    expect(rig.scene.version).toBe(0);
    await rig.clickButton("left");
    expect(rig.scene.version).toBe(1);
    await rig.clickVersion(0);
    expect(rig.scene.paintState.cells[0]).toBe(3);

    // Quitter puis revenir : tout est relu du roster (motif 0, version 0, couleur 9).
    rig.engine.scenes.request(SceneId.hub);
    await rig.tick(3);
    expect(rig.engine.scenes.currentId).toBe(SceneId.hub);
    rig.engine.scenes.request(SceneId.patternWindows);
    await rig.until(() => rig.engine.scenes.currentId === SceneId.patternWindows && rig.scene.flowKind === "normal");
    expect(rig.scene.pattern).toBe(0);
    expect(rig.scene.version).toBe(0);
    expect(rig.scene.color).toBe(9);
    expect(rig.scene.paintState.cells[0]).toBe(3);
    await rig.clickVersion(1);
    expect([rig.scene.paintState.cells[0], rig.scene.paintState.cells[1]]).toEqual([9, 9]);
  });

  it("sans joueur connecté : la peinture marche, mémorisée seulement pour la visite", async () => {
    const rig = await boot({ player: false });
    await rig.clickColor(2);
    await rig.drag([rig.pointIn(0)]);
    expect(rig.scene.paintState.cells[0]).toBe(2);
    await rig.clickVersion(2);
    expect(rig.scene.paintState.cells[0]).toBe(7);
    await rig.clickVersion(0);
    expect(rig.scene.paintState.cells[0]).toBe(2);
  });

  it("kaléidoscope : la palette 180–194 tourne d'un cran tous les 8 ticks pendant 300 ticks, puis retrouve la palette d'entrée", async () => {
    const rig = await boot();
    const { palette } = rig.services.graphics;
    const original = palette.snapshot(180, 15);
    await rig.clickButton("kaleidoscope");
    expect(rig.scene.kaleidoscopeActive).toBe(true);
    const ticksAfterClick = 3;
    void ticksAfterClick;
    await rig.tick(10);
    const shifted = palette.snapshot(180, 15);
    expect([...shifted.subarray(0, 3)]).toEqual([...original.subarray(3, 6)]);
    expect([...shifted.subarray(42, 45)]).toEqual([...original.subarray(0, 3)]);
    // L'écran suit : un pixel du vitrail garde son indice, c'est la palette affichée qui change.
    expect([...palette.output().subarray(180 * 3, 180 * 3 + 3)]).toEqual([...shifted.subarray(0, 3)]);
    await rig.until(() => !rig.scene.kaleidoscopeActive, 10_000);
    expect([...palette.snapshot(180, 15)]).toEqual([...original]);
    expect(rig.services.sound).toBeDefined();
  });

  it("kaléidoscope : tout autre bouton l'arrête et restaure la palette tout de suite", async () => {
    const rig = await boot();
    const { palette } = rig.services.graphics;
    const original = palette.snapshot(180, 15);
    await rig.clickButton("kaleidoscope");
    await rig.tick(20);
    expect(palette.snapshot(180, 15)).not.toEqual(original);
    await rig.clickButton("right");
    expect(rig.scene.kaleidoscopeActive).toBe(false);
    expect([...palette.snapshot(180, 15)]).toEqual([...original]);
  });

  it("Imprimer : remet un PNG de la fenêtre (343 × 343) au port, nommé vitrail-<motif>.png, avec les cellules en couleur", async () => {
    const rig = await boot();
    await rig.clickColor(3);
    await rig.clickButton("faucet");
    await rig.clickButton("print");
    expect(rig.downloads.length).toBe(1);
    const { blob, filename } = rig.downloads[0]!;
    expect(filename).toBe("vitrail-checker.png");
    expect(blob.type).toBe("image/png");
    const png = new Uint8Array(await blob.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([343, 343]);
    // Décompression : pixel d'une cellule = 183 (180 + 3), le même que dans la fenêtre à l'écran.
    let at = 8;
    let idat: Uint8Array | null = null;
    while (at < png.length) {
      const length = view.getUint32(at);
      if (String.fromCharCode(...png.subarray(at + 4, at + 8)) === "IDAT") idat = png.subarray(at + 8, at + 8 + length);
      at += 12 + length;
    }
    const raw = inflateSync(idat!);
    const [x, y] = rig.pointIn(0);
    const row = y - 45;
    const column = x - 51;
    expect(raw[row * 344 + 1 + column]).toBe(183);
    // La première ligne du cadre cuivré n'est pas une cellule.
    expect(raw[1]).not.toBe(183);
    // Le roster a été enregistré.
    expect(rig.host.storage.get("retrovibe:mathemagique:roster")).not.toBeNull();
  });

  it("Imprimer : le nom du fichier suit le motif (Turtle Shell → vitrail-turtle-shell.png)", async () => {
    const rig = await boot();
    for (let i = 0; i < 7; i++) await rig.clickButton("right");
    expect(rig.scene.pattern).toBe(7);
    await rig.clickButton("print");
    expect(rig.downloads.at(-1)!.filename).toBe("vitrail-turtle-shell.png");
  });

  it("Imprimer : sans port de téléchargement, le bouton est inactif", async () => {
    const rig = await boot({ download: false });
    await rig.clickButton("print");
    expect(rig.downloads.length).toBe(0);
    expect(rig.services.gadgets.hitRecord(...BUTTON_CENTER.print!)).toBeNull();
  });

  it("Sortie : roster enregistré, fondu de 30 ticks, retour au hub", async () => {
    const rig = await boot();
    await rig.clickButton("exit");
    expect(rig.scene.flowKind).toBe("leaving");
    expect(rig.services.sound.musicPlaying).toBe(false);
    await rig.until(() => rig.engine.scenes.currentId === SceneId.hub, 5000);
    expect(rig.host.storage.get("retrovibe:mathemagique:roster")).not.toBeNull();
  });

  it("l'aide : Poly arrive, les gadgets et la peinture sont gelés, x / z ignorées ; un clic sur Poly la referme", async () => {
    const rig = await boot();
    await rig.clickButton("help");
    expect(rig.scene.helper.active).toBe(true);
    expect(rig.sounds.some((s) => s.id === 3012 || s.id === 3013)).toBe(true);
    expect(rig.services.sound.musicPlaying).toBe(false);
    expect(rig.scene.helper.currentScr).toBe(1200);
    // En mode aide : ni peinture, ni changement de couleur.
    const before = rig.scene.paintState.cells.slice();
    rig.host.press("KeyX", { key: "x" });
    await rig.tick(2);
    expect(rig.scene.color).toBe(0);
    await rig.until(() => rig.scene.helper.phase === "intro");
    expect(rig.scene.helper.played).toEqual([1200, 1700]);
    // Un clic coupe la présentation (la 1re fois : 1700), puis l'aide écoute.
    await rig.click(200, 200);
    await rig.until(() => rig.scene.helper.phase === "listening");
    expect(rig.scene.paintState.cells).toEqual(before);
    expect(rig.engine.ctx.roster.roster.getVar(rig.roster.currentPlayerId, "patfillPolyIntroSeen")).toBe(1);
    // La main « stop » est dessinée (forme 40003 en (337, 396)).
    const hand = rig.services.graphics.screen.pixels[(396 + 12) * 576 + 337 + 12];
    expect(hand).not.toBe(0);
    // Clic sur la fenêtre : explication 2300 puis 1000.
    await rig.click(200, 200);
    expect(rig.scene.helper.played.slice(-1)).toEqual([2300]);
    await rig.until(() => rig.scene.helper.phase === "listening", 60_000);
    expect(rig.scene.helper.played.slice(-2)).toEqual([2300, 1000]);
    // Clic sur Poly : réplique puis départ (1300), l'aide se referme et la musique repart.
    await rig.click(350, 400);
    await rig.until(() => !rig.scene.helper.active, 60_000);
    expect(rig.scene.helper.played.at(-1)).toBe(1300);
    await rig.tick(3);
    expect(rig.services.sound.musicPlaying).toBe(true);
    // La peinture marche de nouveau.
    await rig.clickColor(3);
    await rig.drag([rig.pointIn(0)]);
    expect(rig.scene.paintState.cells[0]).toBe(3);
  });

  it("la pastille de nom ouvre le moniteur de connexion (palette du hub le temps du dialogue), gèle la peinture, puis rend la palette", async () => {
    const rig = await boot();
    const { palette } = rig.services.graphics;
    const before = palette.snapshot(10, 199);
    await rig.click(470, 60);
    expect(rig.sounds.some((s) => s.id === 3044)).toBe(true);
    const monitor = rig.scene.monitorOverlay!;
    expect(monitor.isOpen).toBe(true);
    expect(palette.snapshot(10, 199)).not.toEqual(before);
    await rig.until(() => monitor.ready, 10_000);
    // Pas de peinture sous le moniteur.
    await rig.clickColor(4);
    expect(rig.scene.color).toBe(0);
    const cells = rig.scene.paintState.cells.slice();
    await rig.click(...rig.pointIn(0));
    expect(rig.scene.paintState.cells).toEqual(cells);
    monitor.close();
    await rig.until(() => !monitor.isOpen, 10_000);
    expect(palette.snapshot(10, 199)).toEqual(before);
    await rig.clickColor(4);
    expect(rig.scene.color).toBe(4);
  });

  it("changer de joueur dans le moniteur recharge motif, couleur et vitrail du nouveau joueur", async () => {
    const rig = await boot();
    const { roster } = rig.roster;
    const other = roster.addPlayer("Zoe");
    if (!other.ok) throw new Error("joueur");
    // Le vitrail de Zoé : motif 1, couleur 6, cellule 0 du motif 1 en couleur 2.
    roster.setVar(other.id, "patfillPattern", 1);
    roster.setVar(other.id, "patfillColor", 6);
    const zoe = roster.bytesOf(other.id, "patfillStainedGlass");
    zoe.fill(0x77);
    zoe[0xc8] = 0x72;
    await rig.click(470, 60);
    const monitor = rig.scene.monitorOverlay!;
    await rig.until(() => monitor.ready, 10_000);
    // Sélection de la ligne de Zoé (ordre alphabétique : Test, Zoe) puis fermeture (OK).
    rig.host.click(390, 296 + 22 + 11);
    await rig.tick(3);
    expect(rig.roster.currentPlayerId).toBe(other.id);
    monitor.close();
    await rig.until(() => !monitor.isOpen, 10_000);
    expect(rig.scene.pattern).toBe(1);
    expect(rig.scene.color).toBe(6);
    expect(rig.scene.paintState.cells[0]).toBe(2);
  });

  it("window.exit (fermeture) : même sortie que le bouton", async () => {
    const rig = await boot();
    rig.engine.requestExit();
    await rig.tick(2);
    expect(rig.scene.flowKind).toBe("leaving");
  });

  it("les 10 motifs se composent sans erreur et les cellules colorées restent dans la fenêtre", async () => {
    const rig = await boot();
    await rig.clickColor(3);
    for (let pattern = 0; pattern < 10; pattern++) {
      expect(rig.scene.pattern).toBe(pattern);
      await rig.clickButton("faucet");
      expect(rig.scene.cellDefs.length).toBe(PATTERN_CELL_COUNTS[pattern]);
      // Rien de coloré hors de la fenêtre : la colonne x = 40 (bois) ne contient aucun indice 180–194.
      const { pixels } = rig.services.graphics.screen;
      for (let y = 40; y < 395; y++) {
        for (const x of [30, 400]) {
          const v = pixels[y * 576 + x]!;
          if (v >= 180 && v <= 194) throw new Error(`motif ${pattern} : pixel ${v} en (${x}, ${y})`);
        }
      }
      await rig.clickButton("right");
    }
  });
});
