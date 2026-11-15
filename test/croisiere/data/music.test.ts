import { describe, expect, it } from "vitest";
import {
  adlFileName,
  ADL_SIZE,
  MUSIC_PATTERN_SIZE,
  musicEvent,
  parseAdlInstrument,
  parseMusicModule,
} from "../../../src/games/croisiere/data/music";
import { CruiseVolumes } from "../../../src/games/croisiere/data/volumes";
import { originalFiles } from "../../support/original";

const original = originalFiles("croisiere", "VOL.CNF");
const REQUIRED = ["VOL.CNF", "D1", "D2", "D3", "D4", "D5"];
const hasOriginalFiles = original.has && REQUIRED.every((name) => original.list((n) => n === name).length === 1);

/** Module minimal : 2 patterns, 3 ordres, un instrument « NYLON_AT.H32 ». */
function tinyModule(): Uint8Array {
  const out = new Uint8Array(2400 + 2 * MUSIC_PATTERN_SIZE);
  out[0] = 90;
  out.set(Array.from("NYLON_AT.H32", (c) => c.charCodeAt(0)), 20);
  out[470] = 3;
  out[471] = 180;
  out.set([0, 1, 0], 472);
  // pattern 1, ligne 2, voix 3 : période 0x0123, instrument 2, effet 5, paramètre 9
  out.set([0x01, 0x23, 0x25, 0x09], 2400 + MUSIC_PATTERN_SIZE + 2 * 16 + 3 * 4);
  // pattern 0, ligne 0, voix 0 : période négative
  out.set([0xff, 0xfe, 0, 0], 2400);
  return out;
}

describe("music (synthétique)", () => {
  it("lit volumes, noms d'instrument, ordres, tempo et événements", () => {
    const module = parseMusicModule(tinyModule());
    expect(module.volumes[0]).toBe(90);
    expect(module.instrumentNames[0]).toBe("NYLON_AT.H32");
    expect(module.instrumentNames[1]).toBe("");
    expect(module.instrumentFiles[0]).toBe("NYLON_AT.ADL");
    expect(module.instrumentFiles[1]).toBe("");
    expect(module.numOrders).toBe(3);
    expect(module.tempo).toBe(180);
    expect(module.eventsDelay).toBe(Math.trunc((64 * 100) / 1060)); // 6 ticks de 20 ms
    expect(module.orders.slice(0, 3)).toEqual([0, 1, 0]);
    expect(module.patternCount).toBe(2);
    expect(musicEvent(module, 1, 2, 3)).toEqual({ freq: 0x123, instrument: 2, effect: 5, param: 9 });
    expect(musicEvent(module, 0, 0, 0).freq).toBe(-2);
    expect(() => musicEvent(module, 2, 0, 0)).toThrow(RangeError);
    expect(() => musicEvent(module, 0, 64, 0)).toThrow(RangeError);
  });

  it("refuse un module trop court, aux motifs mal alignés ou aux ordres hors motifs", () => {
    expect(() => parseMusicModule(new Uint8Array(100))).toThrow(/trop court/);
    expect(() => parseMusicModule(new Uint8Array(2400 + 1500))).toThrow(/multiple/);
    const bad = tinyModule();
    bad[472] = 5;
    expect(() => parseMusicModule(bad)).toThrow(/motif 5/);
  });

  it("nomme le fichier .ADL en remplaçant l'extension du dernier point", () => {
    expect(adlFileName("NYLON_AT.H32")).toBe("NYLON_AT.ADL");
    expect(adlFileName("abc")).toBe("ABC.ADL");
    expect(adlFileName("")).toBe("");
  });

  it("lit un timbre ADL petit-boutiste (opérateur 13 mots)", () => {
    const adl = new Uint8Array(ADL_SIZE);
    adl.set([1, 6, 7, 6, 48], 0); // mode, canal, ondes (masquées à 2 bits), amDepth
    adl.set([0x02, 0x00, 0x04, 0x00], 6); // modulateur : keyScaling 2 puis multiplicateur 4
    adl[6 + 24] = 1; // modulateur : connexion
    adl[32 + 16] = 63; // porteuse : outputLevel
    const ins = parseAdlInstrument(adl);
    expect(ins).toMatchObject({ mode: 1, channel: 6, waveSelectMod: 3, waveSelectCar: 2, amDepth: 48 });
    expect(ins.modulator).toMatchObject({ keyScaling: 2, freqMultiplier: 4, connection: 1 });
    expect(ins.carrier.outputLevel).toBe(63);
    expect(() => parseAdlInstrument(new Uint8Array(57))).toThrow(RangeError);
  });
});

describe.skipIf(!hasOriginalFiles)("music (fichiers originaux)", () => {
  const volumes = CruiseVolumes.open((name) => original.read(name));
  const moduleNames = [...new Set(volumes.entries.filter((e) => /^CORP\d+$/.test(e.name)).map((e) => e.name))];

  it("analyse les 12 modules CORPn distincts (14 entrées, pas de CORP12) : nombre de motifs entier et ordres valides", () => {
    expect(volumes.entries.filter((e) => /^CORP\d+$/.test(e.name))).toHaveLength(14);
    expect(moduleNames).toHaveLength(12);
    expect(moduleNames).not.toContain("CORP12");
    for (const name of moduleNames) {
      const module = parseMusicModule(volumes.readFile(name));
      expect(module.patternCount, name).toBeGreaterThan(0);
      expect(module.numOrders, name).toBeGreaterThan(0);
      expect(module.eventsDelay, name).toBeGreaterThan(0);
    }
    const corp13 = parseMusicModule(volumes.readFile("CORP13"));
    expect(corp13.patternCount).toBe(13); // (15 712 - 2 400) / 1 024
    expect(corp13.numOrders).toBe(17);
    expect(corp13.tempo).toBe(166);
  });

  it("chaque instrument nommé par un module existe dans les volumes en .ADL de 58 octets", () => {
    let instruments = 0;
    for (const name of moduleNames) {
      for (const file of parseMusicModule(volumes.readFile(name)).instrumentFiles.filter(Boolean)) {
        expect(volumes.has(file), `${name} : ${file}`).toBe(true);
        instruments++;
      }
    }
    expect(instruments).toBeGreaterThan(50);
    const adls = [...new Set(volumes.entries.filter((e) => e.name.endsWith(".ADL")).map((e) => e.name))];
    expect(adls).toHaveLength(49);
    for (const name of adls) {
      const bytes = volumes.readFile(name);
      expect(bytes.length, name).toBe(ADL_SIZE);
      const ins = parseAdlInstrument(bytes);
      expect(ins.modulator.freqMultiplier & 0xf, name).toBeLessThan(16);
    }
  });
});
