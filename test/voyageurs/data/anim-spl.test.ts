import { describe, expect, it } from "vitest";
import {
  ANIM_HEADER_SIZE,
  animTransparentColor,
  frameTransparentColor,
  readAni,
  readAnimHeader,
  readMsk,
} from "../../../src/games/voyageurs/data/anim";
import { SPL_INSTRUMENT_OFFSET, readSpl } from "../../../src/games/voyageurs/data/spl";
import { BUNDLE_NAMES, bundle, extensionOf, hasOriginalFiles } from "./helpers";

/** En-tête de 22 octets : id BABEEBEA, largeur en octets, hauteur, 6 inconnus, nombre de frames, 6 inconnus. */
function animFile(width: number, height: number, frames: number, body: number[] = []): Uint8Array {
  const out = new Uint8Array(ANIM_HEADER_SIZE + width * height * frames);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xbabeebea);
  view.setInt16(4, width);
  view.setInt16(6, height);
  view.setInt16(14, frames);
  out.set([1, 2, 3, 4, 5, 6], 8);
  out.set([7, 8, 9, 10, 11, 12], 16);
  out.set(body, ANIM_HEADER_SIZE);
  return out;
}

describe("ANI / MSK (synthétiques)", () => {
  it("lit l'en-tête de 22 octets", () => {
    const header = readAnimHeader(animFile(8, 2, 3));
    expect(header).toMatchObject({ id: 0xbabeebea, frameWidth: 8, frameHeight: 2, numFrames: 3 });
    expect([...header.unknown]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(() => readAnimHeader(new Uint8Array(21))).toThrow(RangeError);
  });

  it("décode les frames et construit le masque de transparence par nom", () => {
    // frame 0 : 1 ligne de 16 pixels, tout le plan 0 = couleur 1 ; frame 1 : tout noir (0)
    const file = animFile(8, 1, 2, [0xff, 0xff, 0, 0, 0, 0, 0, 0]);
    const ani = readAni("INCONNU.ANI", file);
    expect(ani.frames).toHaveLength(2);
    expect(ani.frames[0]).toMatchObject({ width: 16, height: 1, transparentColor: 0 });
    expect(new Set(ani.frames[0]!.pixels)).toEqual(new Set([1]));
    expect(new Set(ani.frames[0]!.mask)).toEqual(new Set([0]));
    expect(new Set(ani.frames[1]!.mask)).toEqual(new Set([1]));
    // ALPHA : transparence 0xF, donc rien de transparent ici
    expect(new Set(readAni("alpha.ani", file).frames[1]!.mask)).toEqual(new Set([0]));
  });

  it("ne charge que la frame demandée", () => {
    const file = animFile(8, 1, 2, [0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0]);
    const ani = readAni("X.ANI", file, 1);
    expect(ani.firstFrame).toBe(1);
    expect(ani.frames).toHaveLength(1);
    expect(new Set(ani.frames[0]!.pixels)).toEqual(new Set([2]));
    expect(() => readAni("X.ANI", file.subarray(0, file.length - 1))).toThrow(RangeError);
    expect(() => readAni("X.ANI", file, 2)).toThrow(RangeError);
  });

  it("applique la table de transparence et ses cas particuliers", () => {
    expect(animTransparentColor("ET.ANI", 32)).toBe(0xc);
    expect(animTransparentColor("alpha.ani", 12)).toBe(0xf);
    expect(animTransparentColor("L311.ANI", 10)).toBe(3);
    expect(animTransparentColor("MARCHE.ANI", 32)).toBe(0);
    expect(animTransparentColor("FIN.ANI", 34)).toBe(9);
    expect(animTransparentColor("FIN01.ANI", 34)).toBe(0xb);
    expect(animTransparentColor("L4106.ANI", 5)).toBe(0xf);
    expect(animTransparentColor("TITRE.ANI", 37)).toBe(0xf);
    expect(animTransparentColor("TITRE.ANI", 57)).toBe(0);
    expect(animTransparentColor("L2202.ANM", 40)).toBe(7);
    expect([0, 1, 2, 3].map((f) => frameTransparentColor("L2202.ANI", 40, f))).toEqual([0, 0, 7, 7]);
    expect([0, 1, 2].map((f) => frameTransparentColor("L4601.ANI", 13, f))).toEqual([0xe, 0, 0]);
    expect(frameTransparentColor("ET.ANI", 32, 5)).toBe(0xc);
  });

  it("décode un MSK : 8 pixels par octet, 0 là où le bit est à 1", () => {
    const msk = readMsk(animFile(1, 2, 2, [0b10100000, 0xff, 0x00, 0x0f]));
    expect(msk.frames).toHaveLength(2);
    expect(msk.frames[0]).toMatchObject({ width: 8, height: 2 });
    expect([...msk.frames[0]!.data]).toEqual([0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...msk.frames[1]!.data.subarray(0, 8)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...msk.frames[1]!.data.subarray(8)]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });
});

describe("SPL (synthétique)", () => {
  it("lit l'instrument OPL à l'octet 257", () => {
    const data = new Uint8Array(SPL_INSTRUMENT_OFFSET + 60 + 8);
    const view = new DataView(data.buffer);
    data[257] = 1; // mode
    data[258] = 6; // canal
    // modulateur : multiplicateur 5, attaque 0xA, décroissance 3, niveau de sortie 0x20, modulation de fréquence nulle
    view.setUint16(259 + 2, 5, true);
    view.setUint16(259 + 6, 0xa, true);
    view.setUint16(259 + 12, 3, true);
    view.setUint16(259 + 16, 0x20, true);
    view.setUint16(259 + 18, 1, true); // vibrato d'amplitude
    data[259 + 52] = 7; // forme d'onde du modulateur (& 3)
    data[259 + 54] = 2;
    data[259 + 56] = 9;
    const { instrument, size } = readSpl(data);
    expect(size).toBe(data.length);
    expect(instrument).toMatchObject({ mode: 1, channel: 6, waveSelectModulator: 3, waveSelectCarrier: 2, amDepth: 9 });
    expect(instrument.modulator).toMatchObject({ vibrato: 0x85, attackDecay: 0xa3, outputLevel: 0x20, freqMod: 0 });
    expect(instrument.modulator.feedbackStrength & 1).toBe(1);
    expect(() => readSpl(new Uint8Array(300))).toThrow(RangeError);
  });
});

describe.skipIf(!hasOriginalFiles)("ANI, ANM, MSK et SPL (fichiers d'origine)", () => {
  it("lit les 350 ANI/ANM : taille = 22 + largeur x hauteur x frames", () => {
    let count = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        const ext = extensionOf(entry.name);
        if (ext !== "ANI" && ext !== "ANM") continue;
        const data = b.read(index);
        const header = readAnimHeader(data);
        expect(data.length, entry.name).toBe(ANIM_HEADER_SIZE + header.frameWidth * header.frameHeight * header.numFrames);
        expect(header.id === 0xbabeebea || header.id === 0, entry.name).toBe(true);
        const ani = readAni(entry.name, data);
        expect(ani.frames, entry.name).toHaveLength(header.numFrames);
        count++;
      }
    }
    expect(count).toBe(350);
  });

  it("donne les frames de quelques animations connues", () => {
    const part01 = bundle("PART01");
    const marche = readAni("MARCHE.ANI", part01.read("MARCHE.ANI"));
    expect(marche.header).toMatchObject({ frameWidth: 16, frameHeight: 32, numFrames: 34 });
    expect(marche.frames).toHaveLength(34);
    expect(marche.frames[0]).toMatchObject({ width: 32, height: 32, transparentColor: 0 });
    const alpha = readAni("ALPHA.ANI", part01.read("ALPHA.ANI"));
    expect(alpha.frames).toHaveLength(36);
    expect(alpha.frames[0]).toMatchObject({ width: 16, height: 12, transparentColor: 0xf });
    expect(readAni("ET.ANI", part01.read("ET.ANI")).frames).toHaveLength(34);
    expect(readAni("BOITIER.ANI", part01.read("BOITIER.ANI")).frames).toHaveLength(1);
    const titre = readAni("TITRE.ANI", part01.read("TITRE.ANI"));
    expect(titre.header).toMatchObject({ frameWidth: 88, frameHeight: 57 });
    expect(titre.frames[0]).toMatchObject({ width: 176, transparentColor: 0 });
    expect(readAnimHeader(part01.read("TITRE2.ANI")).id).toBe(0);
  });

  it("applique les cas par frame de L2202.ANI et L4601.ANI", () => {
    const l2202 = readAni("L2202.ANI", bundle("PART03").read("L2202.ANI"));
    expect(l2202.frames.map((f) => f.transparentColor)).toEqual([0, 0, 7, 7]);
    const l4601 = readAni("L4601.ANI", bundle("PART04B").read("L4601.ANI"));
    expect(l4601.frames.map((f) => f.transparentColor)).toEqual([0xe, 0, 0, 0]);
    // une frame seule garde la couleur de son rang dans le fichier
    expect(readAni("L2202.ANI", bundle("PART03").read("L2202.ANI"), 3).frames[0]!.transparentColor).toBe(7);
  });

  it("lit les 139 MSK ; FENETRE.MSK fait 32 x 33 pixels sur une frame", () => {
    let count = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (extensionOf(entry.name) !== "MSK") continue;
        const data = b.read(index);
        const msk = readMsk(data);
        expect(data.length, entry.name).toBe(ANIM_HEADER_SIZE + msk.header.frameWidth * msk.header.frameHeight * msk.header.numFrames);
        count++;
      }
    }
    expect(count).toBe(139);
    const fenetre = readMsk(bundle("PART01").read("FENETRE.MSK"));
    expect(fenetre.frames).toHaveLength(1);
    expect(fenetre.frames[0]).toMatchObject({ width: 32, height: 33 });
    expect(fenetre.frames[0]!.data).toHaveLength(32 * 33);
  });

  it("lit les 42 SPL ; ELECT375.SPL fait 387 octets", () => {
    let count = 0;
    for (const name of BUNDLE_NAMES) {
      const b = bundle(name);
      for (const [index, entry] of b.entries.entries()) {
        if (extensionOf(entry.name) !== "SPL") continue;
        const spl = readSpl(b.read(index));
        expect(spl.size, entry.name).toBe(entry.unpackedSize);
        expect(spl.instrument.channel, entry.name).toBeLessThan(256);
        count++;
      }
    }
    expect(count).toBe(42);
    const elect = readSpl(bundle("PART01").read("ELECT375.SPL"));
    expect(elect.size).toBe(387);
    expect(elect.data[0]).toBe(0x80);
  });
});
