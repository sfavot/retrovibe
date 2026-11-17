import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeLzma, LzmaDecoder } from "../../../src/data/lzma";
import { fromBase64 } from "../helpers";
import { LZMA_VECTORS } from "./lzma-vectors";

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

/** Mêmes règles que `scripts/asterix/lzma_vectors.py` : les données en clair sont reconstruites ici. */
function lcg(seed: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  let x = seed;
  for (let i = 0; i < count; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    out[i] = (x >> 16) & 0xff;
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function windowData(): Uint8Array {
  const pattern = lcg(2, 1500);
  const copies: Uint8Array[] = [];
  for (let i = 0; i < 40; i++) {
    const copy = pattern.slice();
    copy[i] ^= 0xff;
    copies.push(copy);
  }
  return concat(...copies);
}

function runsData(): Uint8Array {
  const abc = new Uint8Array(3000);
  for (let i = 0; i < abc.length; i++) abc[i] = 0x61 + (i % 3);
  return concat(new Uint8Array(70000), abc, new Uint8Array(5000).fill(7), lcg(3, 200), new Uint8Array(300));
}

function contextData(): Uint8Array {
  const noise = lcg(4, 10000);
  const out = new Uint8Array(20000);
  for (let i = 0; i < 5000; i++) out.set([i & 0xff, noise[2 * i] & 3, 0, noise[2 * i + 1] & 0x0f], 4 * i);
  return out;
}

const TEXT =
  "Nous sommes en 50 avant Jésus-Christ. Toute la Gaule est occupée par les Romains… Toute ? Non ! " +
  "Un village peuplé d'irréductibles Gaulois résiste encore et toujours à l'envahisseur.";

const EXPECTED: Record<string, () => Uint8Array> = {
  vide: () => new Uint8Array(0),
  texte: () => new TextEncoder().encode(TEXT),
  aleatoire: () => lcg(1, 3000),
  fenetre: windowData,
  series: runsData,
  "contextes-lc1-lp2-pb1": contextData,
  "contextes-lc0-lp4-pb4": contextData,
  "taille-connue": runsData,
  "taille-connue-lc4-pb0": contextData,
};

const vector = (name: string) => {
  const found = LZMA_VECTORS.find((v) => v.name === name);
  if (!found) throw new Error(`vecteur ${name} absent`);
  return fromBase64(found.base64);
};

describe("decodeLzma (vecteurs produits par Python)", () => {
  it("a une attente pour chaque vecteur", () => {
    expect(LZMA_VECTORS.map((v) => v.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const v of LZMA_VECTORS) {
    it(`décode « ${v.name} » (${v.length} octets)`, () => {
      const out = decodeLzma(fromBase64(v.base64));
      expect(out.length).toBe(v.length);
      expect(sha1(out)).toBe(v.sha1);
      expect(Buffer.from(out).equals(Buffer.from(EXPECTED[v.name]()))).toBe(true);
    });
  }
});

describe("LzmaDecoder", () => {
  it("lit l'en-tête : taille inconnue avec marqueur de fin, ou taille annoncée", () => {
    const unknown = new LzmaDecoder(vector("fenetre"));
    expect(unknown.uncompressedSize).toBeNull();
    expect(unknown.dictionarySize).toBe(4096);
    const known = new LzmaDecoder(vector("taille-connue"));
    expect(known.uncompressedSize).toBe(78500);
    expect(known.dictionarySize).toBe(1 << 16);
  });

  it("donne le même résultat par morceaux de toutes tailles, correspondances coupées comprises", () => {
    for (const name of ["fenetre", "series", "taille-connue", "contextes-lc0-lp4-pb4"]) {
      const whole = decodeLzma(vector(name));
      for (const step of [1, 7, 273, 4096, 5000]) {
        const decoder = new LzmaDecoder(vector(name));
        const out = new Uint8Array(whole.length + step);
        let length = 0;
        for (;;) {
          const n = decoder.read(out, length, step);
          length += n;
          if (n < step) break;
        }
        expect(decoder.finished).toBe(true);
        expect(length).toBe(whole.length);
        expect(sha1(out.subarray(0, length))).toBe(sha1(whole));
        expect(decoder.read(out, 0, 10)).toBe(0);
      }
    }
  });

  it("ne constate la fin qu'en la rencontrant", () => {
    const data = vector("texte");
    const decoder = new LzmaDecoder(data);
    const out = new Uint8Array(decodeLzma(data).length);
    expect(decoder.read(out)).toBe(out.length);
    expect(decoder.finished).toBe(false);
    expect(decoder.read(new Uint8Array(1))).toBe(0);
    expect(decoder.finished).toBe(true);
  });

  it("refuse un en-tête invalide", () => {
    expect(() => new LzmaDecoder(new Uint8Array(10))).toThrow("trop court");
    const badProps = vector("texte").slice();
    badProps[0] = 225;
    expect(() => new LzmaDecoder(badProps)).toThrow("propriétés invalides");
    const badStart = vector("texte").slice();
    badStart[13] = 1;
    expect(() => new LzmaDecoder(badStart)).toThrow("début de flux invalide");
  });

  it("signale un flux tronqué", () => {
    for (const name of ["aleatoire", "series", "taille-connue"]) {
      const data = vector(name);
      expect(() => decodeLzma(data.subarray(0, data.length - 8))).toThrow(/LZMA : /);
      expect(() => decodeLzma(data.subarray(0, data.length >> 1))).toThrow(/LZMA : /);
    }
  });

  it("signale des données corrompues", () => {
    // Taille annoncée plus courte que les données : la correspondance en cours dépasse la fin.
    const short = vector("taille-connue").slice();
    new DataView(short.buffer).setUint32(5, 100, true);
    expect(() => decodeLzma(short)).toThrow("au-delà de la taille annoncée");
    // Taille annoncée plus longue : le flux s'épuise avant.
    const long = vector("taille-connue").slice();
    new DataView(long.buffer).setUint32(5, 500000, true);
    expect(() => decodeLzma(long)).toThrow("marqueur de fin avant la taille annoncée");
  });
});
