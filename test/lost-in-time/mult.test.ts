import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Game } from "../../src/games/lost-in-time/engine/game";
import { installGraphics } from "../../src/games/lost-in-time/engine/graphics";
import { HeadlessHost, NullSubsystems, WaitingForInput } from "../../src/games/lost-in-time/engine/host";
import { Hotspots } from "../../src/games/lost-in-time/engine/hotspots";
import { decodeInstr, disassemble } from "../../src/games/lost-in-time/engine/opcodes";
import { loadResources } from "../../src/games/lost-in-time/engine/resources";
import { StepBudgetExceeded } from "../../src/games/lost-in-time/engine/interpreter";
import { installVideo } from "../../src/games/lost-in-time/engine/video";
import { installMult } from "../../src/games/lost-in-time/engine/mult";
import { composeFrame } from "../../src/games/lost-in-time/render/canvas";
import { hasOriginalFiles } from "./helpers";

const ORIGINAL = resolve(import.meta.dirname, "../../original/lost-in-time");
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR ?? resolve(tmpdir(), "lit-snapshots");

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Jeu complet (graphismes, zones, mult), sans vidéo ni son. Les attentes du joueur lèvent WaitingForInput. */
function makeGame(maxSteps: number, maxFrames: number, video = false) {
  const host = new HeadlessHost({
    readFile: (name) => {
      const path = resolve(ORIGINAL, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
  });
  const next = host.nextFrame.bind(host);
  host.nextFrame = () => {
    if (host.frames > maxFrames) throw new WaitingForInput("trop d'images");
    return next();
  };
  const sys = new NullSubsystems();
  const gfx = installGraphics(sys);
  const mult = installMult(sys, gfx);
  if (video) installVideo(sys, gfx);
  const hotspots = new Hotspots(sys);
  sys.hotspots = hotspots;
  const attach = sys.attach!.bind(sys);
  sys.attach = (vm) => {
    attach(vm);
    hotspots.attach(vm);
  };
  const game = new Game(host, sys, { maxSteps });
  game.inter.keyFuncLimit = 3000;
  return { host, game, gfx, mult, sys };
}

async function runUntilWait(run: () => Promise<void>): Promise<string> {
  try {
    await run();
    return "terminé";
  } catch (e) {
    if (e instanceof WaitingForInput) return `attente : ${e.reason}`;
    if (e instanceof StepBudgetExceeded) return "budget";
    throw e;
  }
}

function litPixels(rgba: Uint8ClampedArray): number {
  let lit = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] | rgba[i + 1] | rgba[i + 2]) lit++;
  return lit;
}

function snapshot(name: string, frame: { width: number; height: number; rgba: Uint8ClampedArray }): void {
  if (!process.env.SNAPSHOT) return;
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(resolve(SNAPSHOT_DIR, `${name}.png`), png(frame.width, frame.height, frame.rgba));
}

describe.skipIf(!hasOriginalFiles)("mult : scène du jeu", () => {
  it("INTRO > MENU > EMAM1017 : mult chargé, scène affichée, les boucles d'animation attendent le joueur", async () => {
    const { game, gfx, host, sys, mult } = makeGame(3_000_000, 1500, true);
    const counts: Record<string, number> = {};
    for (const m of ["loadMult", "initMult", "animate"] as const) {
      const orig = mult[m].bind(mult) as (...a: unknown[]) => unknown;
      (mult as any)[m] = (...a: unknown[]) => {
        counts[m] = (counts[m] ?? 0) + 1;
        return orig(...a);
      };
    }
    const outcome = await runUntilWait(() => game.start());
    sys.draw.blitInvalidated();
    const frame = composeFrame(gfx, host.input.mouseX, host.input.mouseY);
    snapshot("EMAM1017", frame);
    expect(outcome).toMatch(/^attente/);
    expect(game.curTotFile).toBe("EMAM1017.TOT");
    expect(counts.loadMult).toBe(1);
    expect(counts.initMult).toBe(1);
    expect(counts.animate).toBeGreaterThan(100);
    expect(litPixels(frame.rgba)).toBeGreaterThan(30_000);
  });
});

describe.skipIf(!hasOriginalFiles)("mult : animations réelles", () => {
  for (const tot of ["EMAM1000.TOT", "EMAM1015.TOT", "EMAM1013.TOT"]) {
    it(`${tot} : loadAnim, objets animés, rendu`, async () => {
      const { game, gfx, host, sys, mult } = makeGame(1_000_000, 100_000);
      await game.files.openArchive("INTRO.STK", true);
      const res = loadResources(game.files, tot, "fr")!;
      game.script.load(tot, res.tot.script, res.tot.header);
      game.resources = res;
      game.animDataSize = game.script.animDataSize;
      game.inter.allocateVars(game.script.variablesCount & 0xffff);

      // Charge les animations du TOT comme le script (loadAnim), puis la ressource mult.
      const loaded: number[] = [];
      for (const o of disassemble(game.script, res, [])) {
        if (o.name !== "o1_loadAnim" || loaded.length >= 4) continue;
        const ins = decodeInstr(game.script, res, o.offset - 1);
        loaded.push(mult.loadAnim(game.inter.sceneryArgs(ins.args as never, false)) - 100);
      }
      expect(loaded.length).toBeGreaterThan(0);
      expect(loaded.every((i) => i >= 0 && i < 10)).toBe(true);
      const layerCounts = loaded.map((i) => mult.scenery.getAnimLayersCount(i));
      expect(layerCounts.every((n) => n > 0)).toBe(true);

      // Palette en dégradé de gris, fond uni.
      for (let i = 0; i < 256; i++) gfx.core.wanted.fill(Math.floor((i * 63) / 255), i * 3, i * 3 + 3);
      gfx.core.setFullPalette();
      sys.draw.fillRect(21, 0, 0, 320, 200, 40);
      sys.draw.blitInvalidated();

      mult.initMult({ left: 0, top: 0, width: 320, height: 200, objCount: 4, posXVar: 400, posYVar: 440, animDataVar: 800 });
      const before = gfx.draw.back.pixels.slice();
      // Objets sur les couches qui ont plusieurs images, sinon les premières.
      const choices: [number, number][] = [];
      loaded.forEach((anim, k) => {
        for (let l = 0; l < layerCounts[k]; l++) if ((mult.scenery.getAnimLayer(anim, l)?.framesCount ?? 0) > 1) choices.push([anim, l]);
      });
      loaded.forEach((anim) => choices.push([anim, 0]));
      for (let obj = 0; obj < 4 && obj < choices.length; obj++) {
        const [anim, layer] = choices[obj];
        mult.loadMultObject({ objIndex: obj, x: 40 + obj * 70, y: 90, data: [anim, layer, 0, 1, obj + 1, 0, 0, 0, 0, 0, 0] });
      }

      const frames = new Set<number>();
      const hashes = new Set<string>();
      for (let i = 0; i < 80; i++) {
        await mult.animate();
        sys.draw.blitInvalidated();
        const a = (mult as any).objects[0].anim;
        frames.add(a.frame * 1000 + (mult as any).objects[0].posX.value);
        let h = 0;
        for (const px of gfx.draw.back.pixels) h = (h * 31 + px) | 0;
        hashes.add(String(h));
        await host.nextFrame();
        if (i === 12) snapshot(`anim-${tot.replace(".TOT", "")}`, composeFrame(gfx, 0, 0));
      }
      const changed = gfx.draw.back.pixels.some((px, i) => px !== before[i]);
      expect(changed).toBe(true);
      if (choices.some(([a, l]) => (mult.scenery.getAnimLayer(a, l)?.framesCount ?? 0) > 1)) {
        expect(frames.size).toBeGreaterThan(1);
        expect(hashes.size).toBeGreaterThan(1);
      }
    });
  }
});
