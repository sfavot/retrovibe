import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Game } from "../../src/games/lost-in-time/engine/game";
import { installGraphics } from "../../src/games/lost-in-time/engine/graphics";
import { HeadlessHost, NullSubsystems, WaitingForInput } from "../../src/games/lost-in-time/engine/host";
import { StepBudgetExceeded } from "../../src/games/lost-in-time/engine/interpreter";
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

function makeGame(maxSteps: number) {
  const host = new HeadlessHost({
    readFile: (name) => {
      const path = resolve(ORIGINAL, name);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
    },
  });
  const sys = new NullSubsystems({
    overrides: {
      hotspots: {
        evaluate: () => {
          throw new WaitingForInput("zones de la souris");
        },
        check: () => {
          throw new WaitingForInput("hotspots.check");
        },
      },
    },
  });
  const gfx = installGraphics(sys);
  const game = new Game(host, sys, { maxSteps });
  game.inter.keyFuncLimit = 3000;
  return { host, game, gfx };
}

async function runUntilWait(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    if (!(e instanceof WaitingForInput) && !(e instanceof StepBudgetExceeded)) throw e;
  }
}

/** Nombre de couleurs distinctes visibles et de pixels non noirs. */
function stats(rgba: Uint8ClampedArray) {
  const colors = new Set<number>();
  let lit = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const v = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    colors.add(v);
    if (v !== 0) lit++;
  }
  return { colors: colors.size, lit };
}

function snapshot(name: string, frame: { width: number; height: number; rgba: Uint8ClampedArray }): void {
  if (!process.env.SNAPSHOT) return;
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(resolve(SNAPSHOT_DIR, `${name}.png`), png(frame.width, frame.height, frame.rgba));
}

describe.skipIf(!hasOriginalFiles)("graphiques", () => {
  it("INTRO : premiers écrans non noirs, palette plausible", async () => {
    const { game, gfx, host } = makeGame(300_000);
    await runUntilWait(() => game.start());
    const frame = composeFrame(gfx, host.input.mouseX, host.input.mouseY);
    const s = stats(frame.rgba);
    expect(s.lit).toBeGreaterThan(1000);
    expect(s.colors).toBeGreaterThan(4);
    snapshot("intro", frame);
  });

  for (const tot of (process.env.TOTS ?? "EMAM1017.TOT,MENU.TOT").split(",")) {
    it(`${tot} : affichage`, async () => {
      const { game, gfx, host } = makeGame(300_000);
      await game.files.openArchive("INTRO.STK", true);
      const data = game.files.get(tot);
      if (!data) return;
      game.inter.allocateVars(new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0x2c, true) & 0xffff);
      game.sys.draw.loadFont(0, "jeulet1.let");
      await runUntilWait(() => game.runTot(tot));
      game.sys.draw.blitInvalidated();
      const frame = composeFrame(gfx, host.input.mouseX, host.input.mouseY);
      snapshot(tot.replace(".TOT", ""), frame);
      expect(frame.width).toBeGreaterThan(0);
      if (tot === "MENU.TOT") {
        const s = stats(frame.rgba);
        expect(s.lit).toBeGreaterThan(30_000);
        expect(s.colors).toBeGreaterThan(30);
      }
    });
  }
});
