import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Opl2 } from "../../../src/audio/opl2";
import type { OplSink } from "../../../src/audio/opl-stream";
import { SPL_INSTRUMENT_OFFSET } from "../../../src/games/voyageurs/data/spl";
import { AdlibSfx } from "../../../src/games/voyageurs/audio/sfx-adlib";
import { bundle, hasOriginalFiles } from "../data/helpers";

const RATE = 44100;

/** `.SPL` synthétique : octets 0..256 vides, puis l'instrument (mode 0, canal 0, deux opérateurs de 13 mots). */
function buildSpl(mode = 0, channel = 0): Uint8Array {
  const data = new Uint8Array(SPL_INSTRUMENT_OFFSET + 60 + 20);
  const view = new DataView(data.buffer);
  data[SPL_INSTRUMENT_OFFSET] = mode;
  data[SPL_INSTRUMENT_OFFSET + 1] = channel;
  const operator = (offset: number, words: number[]): void => words.forEach((w, i) => view.setUint16(offset + 2 * i, w, true));
  // keyScaling, multiplicateur, feedback, attaque, sustain, maintien, déclin, relâchement, niveau, AM, vibrato, échelle, freqMod
  operator(SPL_INSTRUMENT_OFFSET + 2, [0, 1, 3, 15, 2, 1, 4, 5, 20, 0, 0, 0, 0]);
  operator(SPL_INSTRUMENT_OFFSET + 28, [0, 1, 0, 15, 3, 1, 3, 6, 0, 0, 0, 0, 1]);
  return data;
}

interface Recorded {
  writes: Array<[number, number]>;
  sink: OplSink;
}

function recorded(): Recorded {
  const writes: Array<[number, number]> = [];
  return { writes, sink: { write: (reg, value) => writes.push([reg, value]) } };
}

/** Rend `seconds` secondes de la puce après les écritures `writes`. */
function render(writes: ReadonlyArray<readonly [number, number]>, seconds = 0.5): Int16Array {
  const chip = new Opl2(RATE);
  for (const [reg, value] of writes) chip.writeReg(reg, value);
  const out = new Int16Array(Math.round(RATE * seconds));
  chip.generate(out, 0, out.length);
  return out;
}

function hash(samples: Int16Array): string {
  return createHash("sha256").update(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)).digest("hex").slice(0, 16);
}

describe("AdlibSfx (registres)", () => {
  it("initialise la carte comme initCard", () => {
    const { writes, sink } = recorded();
    new AdlibSfx(sink);
    expect(writes.slice(0, 2)).toEqual([[0xbd, 0x20], [0x08, 0x40]]);
    expect(writes.slice(-2)).toEqual([[1, 0x20], [1, 0]]);
    expect(writes).toHaveLength(2 + 9 + 9 + 5 * 18 + 2);
  });

  it("joue la note fixe 12 : F 0x157, octave 1, key-on", () => {
    const { writes, sink } = recorded();
    const sfx = new AdlibSfx(sink);
    writes.length = 0;
    sfx.playSample(2, buildSpl());
    expect(writes).toContainEqual([0xa2, 0x57]);
    expect(writes.at(-1)).toEqual([0xb2, 0x25]); // (1 << 2) | 1 | 0x20
    // instrument : voix 2 = opérateurs de décalage 2 (modulateur) et 5 (porteuse)
    expect(writes).toContainEqual([0x20 | 2, 0x21]); // maintien 0x20, multiplicateur 1
    expect(writes).toContainEqual([0x20 | 5, 0x21]);
    expect(writes).toContainEqual([0xc2, (3 << 1) | 1]); // feedback 3, freqMod nul : bit 0
  });

  it("niveaux de sortie : volume 127 donne le niveau de l'instrument", () => {
    const { writes, sink } = recorded();
    const sfx = new AdlibSfx(sink);
    writes.length = 0;
    sfx.playSample(0, buildSpl());
    // porteuse de la voix 0 = opérateur 3 ; niveau 0 : 63 - ((63*127*2+127)/254) = 0
    expect(writes).toContainEqual([0x40 | 3, 0]);
    // modulateur (opérateur 0), freqMod nul : niveau 20 -> 63 - trunc((43*127*2+127)/254) = 20
    expect(writes).toContainEqual([0x40 | 0, 20]);
  });

  it("stopSample coupe la voix puis tout (stopAll)", () => {
    const { writes, sink } = recorded();
    const sfx = new AdlibSfx(sink);
    sfx.playSample(1, buildSpl());
    writes.length = 0;
    sfx.stopSample(1);
    expect(writes[0]).toEqual([0xb1, 0]);
    expect(writes.filter(([reg]) => reg >= 0x40 && reg < 0x60).every(([, v]) => v === 63)).toBe(true);
    expect(writes.at(-1)).toEqual([0xbd, 0]);
  });

  it("canal invalide ou fichier trop court : ignoré", () => {
    const { writes, sink } = recorded();
    const sfx = new AdlibSfx(sink);
    writes.length = 0;
    sfx.playSample(8, buildSpl());
    sfx.playSample(-1, buildSpl());
    sfx.playSample(0, new Uint8Array(100));
    sfx.stopSample(9);
    expect(writes).toEqual([]);
  });

  it("instrument de rythme (mode 1, canal 6) : voix 6 et registre 0xBD", () => {
    const { writes, sink } = recorded();
    const sfx = new AdlibSfx(sink);
    writes.length = 0;
    sfx.playSample(3, buildSpl(1, 6));
    expect(writes).toContainEqual([0xa6, 0x57]);
    expect(writes).toContainEqual([0xb6, 0x05]); // sans key-on 0x20
    expect(writes.at(-1)).toEqual([0xbd, 0x20 | (1 << 4)]);
  });
});

describe("AdlibSfx (rendu OPL2)", () => {
  it("un SPL synthétique sonne, de façon déterministe", () => {
    const run = (): Int16Array => {
      const { writes, sink } = recorded();
      new AdlibSfx(sink).playSample(0, buildSpl());
      return render(writes);
    };
    const a = run();
    expect(a.some((s) => Math.abs(s) > 500)).toBe(true);
    expect(hash(run())).toBe(hash(a));
    expect(hash(a)).toBe("99310d5c1e32e6d4");
  });

  it("après stopSample, le rendu retombe au silence", () => {
    const { writes, sink } = recorded();
    const sfx = new AdlibSfx(sink);
    sfx.playSample(0, buildSpl());
    sfx.stopSample(0);
    const out = render(writes, 0.3);
    expect(out.slice(-2000).every((s) => Math.abs(s) < 50)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("AdlibSfx (fichiers d'origine)", () => {
  it("ELECT375.SPL sonne, de façon déterministe", () => {
    const data = bundle("PART01").read("ELECT375.SPL");
    const { writes, sink } = recorded();
    new AdlibSfx(sink).playSample(0, data);
    const out = render(writes, 0.6);
    expect(out.some((s) => Math.abs(s) > 500)).toBe(true);
    expect(hash(out)).toBe("bf1e30c18b9de506");
  });

  it("les 42 SPL produisent un son non nul", () => {
    let tested = 0;
    for (const bundleName of ["PART01", "PART02", "PART03", "PART04", "PART04B"] as const) {
      const bb = bundle(bundleName);
      for (const [index, entry] of bb.entries.entries()) {
        if (!entry.name.toUpperCase().endsWith(".SPL")) continue;
        const { writes, sink } = recorded();
        new AdlibSfx(sink).playSample(0, bb.read(index));
        expect(render(writes, 0.3).some((s) => s !== 0), entry.name).toBe(true);
        tested++;
      }
    }
    expect(tested).toBe(42);
  });
});
