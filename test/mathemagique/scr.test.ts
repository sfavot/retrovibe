import { describe, expect, it } from "vitest";
import {
  MohawkArchive,
  TAG_SCR,
  TAG_SHPL,
  TAG_SNDL,
} from "../../src/data/mohawk/mohawk";
import {
  parseScr,
  resolveScrResources,
  SCR_OFFSCREEN,
} from "../../src/games/mathemagique/data/scr";
import { parseShpl } from "../../src/data/mohawk/shpl";
import { parseSndl } from "../../src/data/mohawk/sndl";
import { archivePaths, hasOriginalFiles, readOriginal } from "./helpers";

/** Zone (haut 10, gauche 20, bas 30, droite 40) puis `ops`, en petit-boutiste. */
function script(...ops: number[]): Uint8Array {
  return new Uint8Array([10, 0, 20, 0, 30, 0, 40, 0, ...ops]);
}

describe("SCR (données synthétiques)", () => {
  it("lit la zone et la liste typée des opcodes", () => {
    const s = parseScr(
      script(
        0x81,
        3,
        0,
        3,
        0, // cellule 1 : forme 3
        0x61,
        0xfe,
        0xff,
        5,
        0, // cellule 1 : position (-2, 5)
        0x21,
        0xf0,
        0xff,
        0x0a,
        0, // cellule 1 : drapeaux (&fff0)|a
        0x01,
        2,
        0,
        7,
        0, // image 2 x 7
        0x07,
        0x03,
        0x2c,
        0x01, // rendu puis son 300
        0x10,
        9,
        0, // hook 0 (9)
        0x00,
      ),
    );
    expect(s.clip).toEqual({ top: 10, left: 20, bottom: 30, right: 40 });
    expect(s.ops).toEqual([
      { op: "shape", cell: 1, shape: 3, echo: 3 },
      { op: "position", cell: 1, x: -2, y: 5 },
      { op: "flags", cell: 1, mask: 0xfff0, or: 0x0a },
      { op: "frame", count: 2, delay: 7 },
      { op: "render" },
      { op: "sound", id: 300 },
      { op: "hook", hook: 0, arg: 9 },
    ]);
    expect(s.size).toBe(8 + 5 + 5 + 5 + 5 + 1 + 3 + 3 + 1);
  });

  it("simule les images : état des cellules, durée et évènements aux bons instants", () => {
    const s = parseScr(
      script(
        0x81,
        1,
        0,
        1,
        0,
        0x61,
        4,
        0,
        6,
        0,
        0x21,
        0xf0,
        0xff,
        0x0a,
        0,
        0x01,
        1,
        0,
        7,
        0, // image 0 : 7 ticks
        0x10,
        0,
        0, // hook pendant l'image 0
        0x81,
        2,
        0,
        2,
        0,
        0x07,
        0x03,
        0x05,
        0x00, // son 5 : attend la fin de l'image 0
        0x01,
        2,
        0,
        5,
        0, // image 1 : 10 ticks
        0x00,
      ),
    );
    expect(s.frames.map((f) => [f.start, f.duration, f.logicalIndex])).toEqual([
      [0, 7, 0],
      [7, 10, 1],
    ]);
    expect(s.duration).toBe(17);
    expect(s.frames[0]!.cells).toEqual([
      { cell: 1, shape: 1, flags: 0x0a, blit: 8, x: 4, y: 6 },
    ]);
    expect(s.frames[1]!.cells[0]).toMatchObject({ shape: 2 });
    expect(s.frames[0]!.events).toEqual([
      { kind: "hook", tick: 0, hook: 0, arg: 0 },
    ]);
    expect(s.frames[1]!.events).toEqual([{ kind: "sound", tick: 7, id: 5 }]);
    expect(s.trailingEvents).toEqual([]);
  });

  it("remet la cellule à zéro quand la forme est 0 et laisse hors écran une cellule non placée", () => {
    const s = parseScr(
      script(
        0x82,
        1,
        0,
        1,
        0,
        0x01,
        1,
        0,
        1,
        0,
        0x82,
        0,
        0,
        0,
        0,
        0x01,
        1,
        0,
        1,
        0,
        0x00,
      ),
    );
    expect(s.frames[0]!.cells).toEqual([
      {
        cell: 2,
        shape: 1,
        flags: 2,
        blit: 2,
        x: SCR_OFFSCREEN,
        y: SCR_OFFSCREEN,
      },
    ]);
    expect(s.frames[1]!.cells).toEqual([]);
  });

  it("refuse un opcode inconnu, un script tronqué et un script sans fin", () => {
    expect(() => parseScr(script(0x08, 0x00))).toThrow(/inconnu/);
    expect(() => parseScr(script(0x01, 1, 0))).toThrow(/tronqué/);
    expect(() => parseScr(script(0x07))).toThrow(/END/);
  });
});

describe("résolution SCR -> SHPL / SNDL (données synthétiques)", () => {
  const ids = {
    shpl: new Set([1200, 1300, 1700]),
    sndl: new Set([1200, 1210, 1301, 1700]),
  };

  it("prend la SHPL et la SNDL de même id quand elles existent", () => {
    expect(resolveScrResources(1700, ids)).toEqual({
      shplId: 1700,
      offset: 0,
      sndlId: 1700,
    });
  });

  it("applique le décalage de SHPL et le repli de SNDL sur la dizaine (bowling)", () => {
    expect(resolveScrResources(1213, ids)).toEqual({
      shplId: 1200,
      offset: 13,
      sndlId: 1210,
    });
    expect(resolveScrResources(1301, ids)).toEqual({
      shplId: 1300,
      offset: 1,
      sndlId: 1301,
    });
  });

  it("signale l'absence de SHPL ou de SNDL par undefined", () => {
    expect(resolveScrResources(900, ids)).toEqual({
      shplId: undefined,
      offset: 0,
      sndlId: undefined,
    });
  });
});

/** Scripts dont des formes dépassent leur `SHPL` : le moteur lèverait « Cast member out of range » (donnée non jouée ?). */
const KNOWN_OUT_OF_RANGE: Record<string, number[]> = { "POLLY.DAT": [35900] };

describe.skipIf(!hasOriginalFiles)("SCR (fichiers du jeu)", () => {
  const archives = archivePaths()
    .filter((path) => /\.DAT$/i.test(path))
    .map((path) => ({ path, archive: MohawkArchive.parse(readOriginal(path)) }))
    .filter(({ archive }) => archive.count(TAG_SCR) > 0);

  it("décode les 995 scripts des 13 archives jusqu'à l'opcode END", () => {
    let scripts = 0;
    for (const { path, archive } of archives) {
      for (const id of archive.ids(TAG_SCR)) {
        const bytes = archive.get(TAG_SCR, id);
        const s = parseScr(bytes);
        expect(s.size, `${path} ${id}`).toBeLessThanOrEqual(bytes.length);
        expect(s.frames.length, `${path} ${id}`).toBeGreaterThan(0);
        expect(s.trailingEvents, `${path} ${id}`).toEqual([]);
        scripts++;
      }
    }
    expect(archives).toHaveLength(13);
    expect(scripts).toBe(995);
  });

  it("totalise les opcodes comptés dans le moteur", () => {
    const counts = new Map<string, number>();
    for (const { archive } of archives) {
      for (const id of archive.ids(TAG_SCR))
        for (const op of parseScr(archive.get(TAG_SCR, id)).ops)
          counts.set(op.op, (counts.get(op.op) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      frame: 30150,
      sound: 2042,
      render: 2042,
      hook: 495,
      flags: 8743,
      position: 38705,
      shape: 46323,
    });
  });

  it("MAINSCRN 1000 : ouverture du rideau du hall", () => {
    const main = MohawkArchive.parse(readOriginal("MAINSCRN.DAT"));
    const s = parseScr(main.get(TAG_SCR, 1000));
    expect(s.clip).toEqual({ top: 244, left: 287, bottom: 331, right: 387 });
    expect(s.frames).toHaveLength(13);
    expect(s.duration).toBe(98);
    expect(s.frames[0]!.cells).toEqual([
      { cell: 0, shape: 14, flags: 0x0a, blit: 8, x: 0, y: -7 },
      { cell: 1, shape: 1, flags: 0x0a, blit: 8, x: 0, y: -7 },
    ]);
  });

  it("BOWLING 1200 : quille qui entre (premier son en deuxième image)", () => {
    const bowling = MohawkArchive.parse(readOriginal("BOWLING.DAT"));
    const s = parseScr(bowling.get(TAG_SCR, 1200));
    expect(s.clip).toEqual({ top: 227, left: 406, bottom: 314, right: 488 });
    expect(s.size).toBe(108);
    expect(s.frames).toHaveLength(6);
    expect(s.duration).toBe(63);
    expect(s.frames[0]).toMatchObject({
      start: 0,
      count: 2,
      delay: 7,
      cells: [{ cell: 12, shape: 1, x: -54, y: -57 }],
    });
    expect(s.frames[1]!.cells[0]).toMatchObject({
      cell: 1,
      shape: 2,
      x: 6,
      y: -46,
    });
    expect(s.frames[1]!.events).toEqual([
      { kind: "sound", tick: 14, id: 14300 },
    ]);
  });

  it("chaque forme référencée existe dans la SHPL résolue (exceptions connues mises à part) et chaque son dans la SNDL", () => {
    const outOfRange: Record<string, number[]> = {};
    for (const { path, archive } of archives) {
      const ids = {
        shpl: new Set(archive.ids(TAG_SHPL)),
        sndl: new Set(archive.ids(TAG_SNDL)),
      };
      for (const id of archive.ids(TAG_SCR)) {
        const label = `${path} ${id}`;
        const { shplId, sndlId } = resolveScrResources(id, ids);
        expect(shplId, label).toBeDefined();
        const { shapeCount } = parseShpl(archive.get(TAG_SHPL, shplId!));
        const script = parseScr(archive.get(TAG_SCR, id));
        if (script.ops.some((op) => op.op === "shape" && op.shape > shapeCount))
          (outOfRange[path] ??= []).push(id);
        const sounds = script.ops.flatMap((op) =>
          op.op === "sound" ? [op.id] : [],
        );
        if (sounds.length > 0) {
          expect(sndlId, label).toBeDefined();
          const list = new Set(parseSndl(archive.get(TAG_SNDL, sndlId!)));
          for (const sound of sounds)
            expect(list.has(sound), `${label} son ${sound}`).toBe(true);
        }
      }
    }
    expect(outOfRange).toEqual(KNOWN_OUT_OF_RANGE);
  });

  it("bowling : 297 scripts avec décalage de SHPL (base 1200, 1300, 1400), 270 sur la SNDL de la dizaine", () => {
    const bowling = MohawkArchive.parse(readOriginal("BOWLING.DAT"));
    const ids = {
      shpl: new Set(bowling.ids(TAG_SHPL)),
      sndl: new Set(bowling.ids(TAG_SNDL)),
    };
    let shifted = 0;
    let tens = 0;
    for (const id of bowling.ids(TAG_SCR)) {
      const r = resolveScrResources(id, ids);
      if (r.offset > 0) {
        shifted++;
        expect([1200, 1300, 1400]).toContain(r.shplId);
      }
      if (r.sndlId !== id) {
        tens++;
        expect(r.sndlId).toBe(id - (id % 10));
      }
    }
    expect([shifted, tens]).toEqual([297, 270]);
  });
});
