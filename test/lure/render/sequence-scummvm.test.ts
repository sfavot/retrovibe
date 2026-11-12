import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TICK_MS } from "../../../src/games/lure/engine/cadence";
import { barrelSequence, chuteSequence } from "../../../src/games/lure/engine/sequences/index";
import { LureRenderer } from "../../../src/games/lure/render/renderer";
import { hasOriginalFiles, makeEngine } from "../engine/test-host";

interface IntroShot {
  t: number;
  idx: string;
  pal: string;
  steady: boolean;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/scummvm-lure-intro.json", import.meta.url), "utf8")) as { shots: IntroShot[] };
const md5 = (bytes: Uint8Array): string => createHash("md5").update(bytes).digest("hex").slice(0, 12);

describe.skipIf(!hasOriginalFiles)("l'introduction comparée à ScummVM (captures du banc : indices et palette)", () => {
  it("chaque image distincte de ScummVM (indices) est montrée par le portage, dans le même ordre ; palette identique hors fondu", () => {
    const { engine, host, data } = makeEngine({ intro: true });
    const renderer = new LureRenderer(data, { cursor: false });
    const frames: { t: number; idx: string; pal: string }[] = [];
    let t = 0;
    while ((engine.busy || t === 0) && t < 400_000) {
      t += TICK_MS;
      host.clock += TICK_MS;
      if (!renderer.fading) engine.tick();
      renderer.render(engine, TICK_MS);
      frames.push({ t, idx: md5(renderer.output), pal: md5(renderer.palette.subarray(0, 660)) });
    }
    // l'introduction dure 244,5 s dans le portage ; ScummVM y ajoute 5 à 6 s de temps de calcul (voir `docs/lure/graphics.md`)
    expect(t / 1000).toBeGreaterThan(243);
    expect(t / 1000).toBeLessThan(246);

    // Dans l'ordre : chaque image de ScummVM se retrouve, après la précédente.
    let from = 0;
    let missing = 0;
    for (const shot of fixture.shots) {
      let found = -1;
      for (let i = from; i < frames.length; i++) {
        if (frames[i]!.idx === shot.idx) {
          found = i;
          break;
        }
      }
      if (found < 0) missing++;
      else from = found;
    }
    expect(missing).toBe(0);

    // Palette (entrées 0 à 219) : pour une capture hors fondu, une image du portage a les mêmes indices et la même palette.
    const pairs = new Set(frames.map((f) => `${f.idx}:${f.pal}`));
    const steady = fixture.shots.filter((s) => s.steady);
    expect(steady.length).toBeGreaterThan(30);
    const unmatched = steady.filter((s) => !pairs.has(`${s.idx}:${s.pal}`));
    expect(unmatched.map((s) => s.t)).toEqual([]);
  });
});

const sequences = JSON.parse(readFileSync(new URL("./fixtures/scummvm-lure-sequences.json", import.meta.url), "utf8")) as { chute: string[]; barrel: string[] };

describe.skipIf(!hasOriginalFiles)("la chute et le tonneau comparés à ScummVM (captures du banc : indices)", () => {
  for (const [name, make, expected] of [
    ["la chute", chuteSequence, sequences.chute],
    ["le tonneau", barrelSequence, sequences.barrel],
  ] as const) {
    it(`${name} : chaque image distincte de ScummVM (indices) est montrée par le portage, dans le même ordre`, () => {
      const { engine, host, data } = makeEngine();
      const renderer = new LureRenderer(data, { cursor: false });
      engine.tick();
      renderer.render(engine, TICK_MS);
      engine.block(make(engine));
      const frames: string[] = [];
      let ticks = 0;
      do {
        host.clock += TICK_MS;
        // la pièce s'éteint (moteur suspendu), puis la séquence joue
        if (!renderer.fading) engine.tick();
        renderer.render(engine, renderer.fading ? 1000 : TICK_MS);
        if (engine.sequenceScreen && !engine.sequenceScreen.holdRoom) frames.push(md5(renderer.output));
        ticks++;
      } while (engine.busy && ticks < 4000);
      expect(expected.length).toBeGreaterThan(20);
      let from = 0;
      const missing: number[] = [];
      expected.forEach((hash, rank) => {
        const found = frames.indexOf(hash, from);
        if (found < 0) missing.push(rank);
        else from = found;
      });
      expect(missing).toEqual([]);
    });
  }
});
