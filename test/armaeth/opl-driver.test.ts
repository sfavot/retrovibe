import { describe, expect, it } from "vitest";
import { DRIVER_DATA_FILE_OFFSET } from "../../src/games/armaeth/data/music";
import {
  OPL_DEFAULT_IMAGE,
  OplDriver,
  OplRecorder,
  noteFrequencyWord,
  type OplSink,
} from "../../src/games/armaeth/audio/opl-driver";
import { hasOriginalFiles, readOriginal } from "./helpers";

type Write = [reg: number, value: number];

/** Pilote + liste des écritures. */
function setup(voices = 9) {
  const writes: Write[] = [];
  const sink: OplSink = { write: (reg, value) => writes.push([reg, value]) };
  const driver = new OplDriver(sink);
  driver.voices = voices;
  return { driver, writes };
}

const hex = (writes: Write[]) => writes.map(([r, v]) => `${r.toString(16)}=${v.toString(16)}`);

describe("initialisation", () => {
  it("écrit 01 puis BD, puis tout ce que l'image par défaut fixe, par registre croissant", () => {
    const { driver, writes } = setup();
    driver.init();
    expect(writes.slice(0, 8)).toEqual([
      [0x01, 0x20],
      [0xbd, 0x00],
      [0x00, 0x00],
      [0x01, 0x20],
      [0x20, 0x01],
      [0x21, 0x01],
      [0x22, 0x01],
      [0x23, 0x0b],
    ]);
    const expected: Write[] = [];
    for (let reg = 0; reg < 0xff; reg++) if (OPL_DEFAULT_IMAGE[reg] !== 0xff) expected.push([reg, OPL_DEFAULT_IMAGE[reg]]);
    expect(writes.slice(2)).toEqual(expected);
    // le mode rythme est posé par défaut (BD = 0x20) et A7/B7/A8/B8 règlent les percussions
    expect(writes).toContainEqual([0xbd, 0x20]);
    expect(writes).toContainEqual([0xa7, 0x05]);
    expect(writes).toContainEqual([0xb8, 0x09]);
  });

  it("n'écrit que le registre 01 quand rien ne change, et jamais le registre FF", () => {
    const { driver, writes } = setup();
    driver.init();
    writes.length = 0;
    driver.flush();
    expect(writes).toEqual([[0x01, 0x20]]);
    driver.working[0xff] = 0x12;
    driver.working[0x20] = 0x55;
    driver.working[0x10] = 0x01;
    writes.length = 0;
    driver.flush();
    expect(writes).toEqual([
      [0x01, 0x20],
      [0x10, 0x01],
      [0x20, 0x55],
    ]);
  });

  it("silence : image par défaut, niveaux à 63, BD à 0", () => {
    const { driver, writes } = setup();
    driver.init();
    driver.working[0xb0] = 0x2d;
    driver.working[0xbd] = 0x3f;
    driver.flush();
    writes.length = 0;
    driver.silence();
    expect(writes).toContainEqual([0xb0, 0x00]);
    expect(writes).toContainEqual([0xbd, 0x00]);
    for (let reg = 0x40; reg < 0x55; reg++) expect(driver.working[reg]).toBe(0x3f);
    expect(driver.working[0x55]).toBe(OPL_DEFAULT_IMAGE[0x55]);
    expect(driver.working[0x20]).toBe(OPL_DEFAULT_IMAGE[0x20]);
  });

  it.skipIf(!hasOriginalFiles)("garde l'image par défaut identique à la table de l'exécutable", () => {
    const exe = readOriginal("AM1.EXE");
    const image = Array.from(exe.subarray(DRIVER_DATA_FILE_OFFSET + 0x5de, DRIVER_DATA_FILE_OFFSET + 0x5de + 256));
    expect(OPL_DEFAULT_IMAGE).toEqual(image);
  });
});

describe("fréquences", () => {
  it("note n : numéro F de n % 12 | bloc n / 12 << 10", () => {
    expect(noteFrequencyWord(0)).toBe(0x159);
    expect(noteFrequencyWord(36)).toBe(0x159 | (3 << 10));
    expect(noteFrequencyWord(47)).toBe(0x28b | (3 << 10));
    expect(noteFrequencyWord(95)).toBe(0x28b | (7 << 10));
  });
});

describe("instruments", () => {
  // modulateur 20/40/60/80/E0 = 21 10 f2 73 04, porteuse 22 4f f4 75 01
  const instrument = Uint8Array.of(0, 0x08, 0x21, 0x10, 0xf2, 0x73, 0x04, 0x22, 0x4f, 0xf4, 0x75, 0x01);

  it("voix mélodique : C0, modulateur, porteuse (seuls les bits KSL du niveau)", () => {
    const { driver } = setup();
    driver.init();
    driver.working[0x43] = 0x3f;
    expect(driver.loadInstrument(0, instrument, 0)).toBe(true);
    expect(driver.working[0xc0]).toBe(0x08);
    expect([0x20, 0x40, 0x60, 0x80, 0xe0].map((b) => driver.working[b])).toEqual([0x21, 0x10, 0xf2, 0x73, 0x04]);
    // porteuse de la voix 0 : opérateur 3 (décalage 3) ; niveau 0x3f gardé, KSL 0x40 repris de l'instrument
    expect([0x23, 0x43, 0x63, 0x83, 0xe3].map((b) => driver.working[b])).toEqual([0x22, 0x7f, 0xf4, 0x75, 0x01]);
  });

  it("voix 3 en mode mélodique : opérateurs de décalages 0x08 et 0x0b", () => {
    const { driver } = setup();
    driver.loadInstrument(3, instrument, 0);
    expect(driver.working[0xc3]).toBe(0x08);
    expect(driver.working[0x28]).toBe(0x21);
    expect(driver.working[0x2b]).toBe(0x22);
  });

  it("connexion additive : renvoie faux", () => {
    const { driver } = setup();
    const additive = Uint8Array.from(instrument);
    additive[1] = 0x09;
    expect(driver.loadInstrument(2, additive, 0)).toBe(false);
  });

  it("11 voix : la voix 6 (grosse caisse) a deux opérateurs, les voix 7 à 10 un seul", () => {
    const { driver } = setup(11);
    driver.loadInstrument(6, instrument, 0);
    // grosse caisse : opérateurs 12 et 15 = décalages 0x10 et 0x13
    expect(driver.working[0x30]).toBe(0x21);
    expect(driver.working[0x33]).toBe(0x22);
    driver.loadInstrument(7, instrument, 0);
    // caisse claire : opérateur 16 = décalage 0x14, seulement le modulateur
    expect([0x34, 0x54, 0x74, 0x94, 0xf4].map((b) => driver.working[b])).toEqual([0x21, 0x10, 0xf2, 0x73, 0x04]);
    expect(driver.working[0xc7]).toBe(0x08);
  });

  it("voix 9 et 10 : pas de C0 et pas de drapeau FM", () => {
    const { driver } = setup(11);
    const before = driver.working[0xc8];
    expect(driver.loadInstrument(9, instrument, 0)).toBeUndefined();
    expect(driver.loadInstrument(10, instrument, 0)).toBeUndefined();
    expect(driver.working[0xc8]).toBe(before);
    // cymbale : décalage 0x15 ; charleston : 0x11
    expect(driver.working[0x35]).toBe(0x21);
    expect(driver.working[0x31]).toBe(0x21);
  });

  it("octets hors de la banque : zéros", () => {
    const { driver } = setup();
    driver.loadInstrument(0, Uint8Array.of(0, 0x01, 0x22), 0);
    expect(driver.working[0xc0]).toBe(0x01);
    expect(driver.working[0x20]).toBe(0x22);
    expect(driver.working[0x60]).toBe(0);
  });
});

describe("sortie d'une voix", () => {
  it("voix mélodique : A0/B0 avec la touche, niveaux sur la porteuse seule en FM", () => {
    const { driver } = setup();
    driver.init();
    driver.setVoiceOutput(1, 0x05, 0x0d59, false);
    expect(driver.working[0xa1]).toBe(0x59);
    expect(driver.working[0xb1]).toBe(0x2d);
    // voix 1 : opérateurs 1 (modulateur) et 4 (porteuse) ; le modulateur garde son niveau
    expect(driver.working[0x41]).toBe(OPL_DEFAULT_IMAGE[0x41]);
    expect(driver.working[0x44]).toBe(0x05);
  });

  it("niveau additif : modulateur et porteuse, bits KSL gardés", () => {
    const { driver } = setup();
    driver.working[0x41] = 0x8f;
    driver.working[0x44] = 0x40;
    driver.setVoiceOutput(1, 0x05, 0x0d59, true);
    expect(driver.working[0x41]).toBe(0x85);
    expect(driver.working[0x44]).toBe(0x45);
  });

  it("fréquence nulle : A0 = B0 = 0 (touche relâchée)", () => {
    const { driver } = setup();
    driver.setVoiceOutput(2, 0x3f, 0x0d59, false);
    driver.setVoiceOutput(2, 0x3f, 0, false);
    expect(driver.working[0xa2]).toBe(0);
    expect(driver.working[0xb2]).toBe(0);
  });

  it("11 voix : la grosse caisse écrit A6/B6 sans touche et pose le bit 4 de BD", () => {
    const { driver } = setup(11);
    driver.init();
    driver.setVoiceOutput(6, 0x00, 0x0d59, false);
    expect(driver.working[0xa6]).toBe(0x59);
    expect(driver.working[0xb6]).toBe(0x0d);
    expect(driver.working[0xbd]).toBe(0x30);
  });

  it("11 voix : voix 7 à 10 posent leur bit de BD et n'écrivent pas de hauteur", () => {
    const { driver } = setup(11);
    driver.init();
    const a7 = driver.working[0xa7];
    for (const [voice, bit] of [
      [7, 0x08],
      [8, 0x04],
      [9, 0x02],
      [10, 0x01],
    ]) {
      driver.setVoiceOutput(voice, 0x00, 0x0d59, false);
      expect(driver.working[0xbd] & bit).toBe(bit);
    }
    expect(driver.working[0xbd]).toBe(0x2f);
    expect(driver.working[0xa7]).toBe(a7);
  });

  it("une percussion muette ne retire pas son bit (seule la coupure de touche le fait)", () => {
    const { driver } = setup(11);
    driver.setVoiceOutput(7, 0x00, 0x0d59, false);
    driver.setVoiceOutput(7, 0x3f, 0, false);
    expect(driver.working[0xbd] & 0x08).toBe(0x08);
  });

  it("11 voix, voix 5 : encore mélodique", () => {
    const { driver } = setup(11);
    driver.setVoiceOutput(5, 0x00, 0x0d59, false);
    expect(driver.working[0xb5]).toBe(0x2d);
    expect(driver.working[0xbd] & 0x1f).toBe(0);
  });
});

describe("coupure de touche", () => {
  it("voix mélodique : réécrit B0 avec le bit 5 retiré de l'image envoyée, puis le flush rallume", () => {
    const { driver, writes } = setup();
    driver.init();
    driver.setVoiceOutput(3, 0x00, 0x0d59, false);
    driver.flush();
    writes.length = 0;
    driver.keyOff(3);
    expect(writes).toEqual([[0xb3, 0x0d]]);
    driver.flush();
    expect(writes.slice(1)).toEqual([
      [0x01, 0x20],
      [0xb3, 0x2d],
    ]);
  });

  it("écrit même si la touche était déjà relâchée", () => {
    const { driver, writes } = setup();
    driver.init();
    writes.length = 0;
    driver.keyOff(0);
    expect(writes).toEqual([[0xb0, 0x00]]);
  });

  it("voix de percussion : écrit BD sans le bit de la percussion", () => {
    const { driver, writes } = setup(11);
    driver.init();
    driver.setVoiceOutput(7, 0x00, 0x0d59, false);
    driver.setVoiceOutput(10, 0x00, 0x0d59, false);
    driver.flush();
    expect(driver.sent[0xbd]).toBe(0x29);
    writes.length = 0;
    driver.keyOff(7);
    expect(writes).toEqual([[0xbd, 0x21]]);
    driver.flush();
    expect(writes.slice(1)).toEqual([
      [0x01, 0x20],
      [0xbd, 0x29],
    ]);
  });
});

describe("arrêt d'une voix et mode rythme", () => {
  it("muteVoice : niveau 63 sur les deux opérateurs, bits KSL gardés, écrit tout de suite", () => {
    const { driver, writes } = setup();
    driver.init();
    writes.length = 0;
    driver.muteVoice(0);
    // opérateurs 0 (modulateur, défaut 4f) et 3 (porteuse, défaut 00)
    expect(hex(writes)).toEqual(["1=20", "40=7f", "43=3f"]);
  });

  it("setRhythmMode pose et retire le bit 5 de BD", () => {
    const { driver } = setup();
    driver.setRhythmMode(false);
    expect(driver.working[0xbd]).toBe(0);
    driver.setRhythmMode(true);
    expect(driver.working[0xbd]).toBe(0x20);
  });
});

describe("OplRecorder", () => {
  it("horodate les écritures avec le tick annoncé", () => {
    const rec = new OplRecorder();
    rec.write(1, 2);
    rec.beginTick(5);
    rec.write(3, 4);
    expect(rec.writes).toEqual([
      { tick: 0, reg: 1, value: 2 },
      { tick: 5, reg: 3, value: 4 },
    ]);
    expect(rec.at(5)).toHaveLength(1);
  });
});
