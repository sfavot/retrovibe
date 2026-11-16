import { describe, expect, it } from "vitest";
import type { MidiSink } from "../../../src/audio/midi-sink";
import { GmDriver, RHYTHM_CHANNEL, splitInitData } from "../../../src/games/gk1/audio/gm-driver";
import { GM_PATCH_UNMAPPED, type GmPatch, readGmPatch } from "../../../src/games/gk1/data/gm-patch";
import { ResourceType, SoundDevice } from "../../../src/games/gk1/data/ids";
import { mainIndex, original } from "../data/real";

class RecordingSink implements MidiSink {
  readonly sent: string[] = [];
  resets = 0;
  send(message: Uint8Array, atMs?: number): void {
    this.sent.push(Array.from(message, (b) => b.toString(16)).join(" ") + (atMs === undefined ? "" : ` @${atMs}`));
  }
  reset(): void {
    this.resets++;
  }
  take(): string[] {
    return this.sent.splice(0);
  }
}

const identity = () => Uint8Array.from({ length: 128 }, (_, i) => i);

/** Patch d'essai : le programme 10 devient 20 (+2 demi-tons, volume −20, courbe 1), 11 est sans équivalent, 12 est la percussion 40. */
function testPatch(): GmPatch {
  const programs = identity();
  programs[10] = 20;
  programs[11] = GM_PATCH_UNMAPPED;
  programs[12] = 128 + 40;
  const keyShift = new Int8Array(128);
  keyShift[10] = 2;
  keyShift[13] = -24;
  const volumeAdjust = new Int8Array(128);
  volumeAdjust[10] = -20;
  volumeAdjust[14] = 100;
  const percussion = identity();
  percussion[35] = 36;
  percussion[50] = GM_PATCH_UNMAPPED;
  const velocityCurve = new Uint8Array(128);
  velocityCurve[10] = 1;
  const half = Uint8Array.from({ length: 128 }, (_, i) => (i === 0 ? 0 : 32 + (i >> 1)));
  return { programs, keyShift, volumeAdjust, percussion, rhythmVolumeAdjust: -27, velocityCurve, velocityCurves: [identity(), half, identity(), identity()], initData: Uint8Array.of(0xf0, 0x7e, 0x7f, 9, 1, 0xf7, 0xb0, 101, 0, 100, 0, 0xc1, 5) };
}

describe("pilote General MIDI", () => {
  it("découpe l'initialisation du patch en messages et l'envoie au branchement", () => {
    expect(splitInitData(testPatch().initData).map((m) => Array.from(m))).toEqual([[0xf0, 0x7e, 0x7f, 9, 1, 0xf7], [0xb0, 101, 0], [0xb0, 100, 0], [0xc1, 5]]);
    expect(() => splitInitData(Uint8Array.of(0xf0, 1))).toThrow();
    expect(() => splitInitData(Uint8Array.of(0xb0, 1))).toThrow();
    const sink = new RecordingSink();
    const driver = new GmDriver(testPatch(), sink);
    expect(sink.sent.slice(0, 4)).toEqual(["f0 7e 7f 9 1 f7", "b0 65 0", "b0 64 0", "c1 5"]);
    expect([driver.device, driver.firstChannel, driver.lastChannel, driver.polyphony, driver.masterVolume]).toEqual([SoundDevice.GeneralMidi, 1, 8, 32, 15]);
  });

  it("traduit programme, transposition, vélocité et volume", () => {
    const sink = new RecordingSink();
    const driver = new GmDriver(testPatch(), sink);
    sink.take();
    driver.send(0xc2, 10, 0);
    // Transposition changée : notes coupées ; volume recalculé (127 − 20) ; programme 20.
    expect(sink.take()).toEqual(["b2 7b 0", "b2 40 0", "b2 7 6b", "c2 14"]);
    driver.send(0x92, 60, 1);
    driver.send(0x92, 60, 127);
    driver.send(0x82, 60, 0);
    driver.send(0x92, 127, 100);
    expect(sink.take()).toEqual(["92 3e 20", "92 3e 5f", "82 3e 0", "92 75 52"]);
    driver.send(0xb2, 7, 100);
    driver.send(0xb2, 7, 10);
    expect(sink.take()).toEqual(["b2 7 50", "b2 7 1"]);
    // Même programme : rien ; transposition de deux octaves vers le bas ramenée dans la tessiture.
    driver.send(0xc2, 10, 0);
    expect(sink.take()).toEqual([]);
    driver.send(0xc3, 13, 0);
    driver.send(0x93, 12, 64);
    expect(sink.take()).toEqual(["b3 7b 0", "b3 40 0", "b3 7 7f", "c3 d", "93 0 40"]);
    // Correction de volume bornée à 127.
    driver.send(0xc4, 14, 0);
    expect(sink.take()).toEqual(["b4 7 7f", "c4 e"]);
  });

  it("fait taire un programme sans équivalent et joue un programme-percussion sur le canal de batterie", () => {
    const sink = new RecordingSink();
    const driver = new GmDriver(testPatch(), sink);
    sink.take();
    driver.send(0xc1, 11, 0);
    driver.send(0x91, 60, 100);
    expect(sink.take()).toEqual(["b1 7b 0", "b1 40 0"]);
    driver.send(0xc1, 12, 0);
    driver.send(0x91, 60, 100);
    driver.send(0x81, 60, 0);
    expect(sink.take()).toEqual(["99 28 64", "89 28 0"]);
    // Retour à un programme joué : le volume repart.
    driver.send(0xc1, 11, 0);
    driver.send(0xc1, 5, 0);
    expect(sink.take()).toEqual(["b1 7b 0", "b1 40 0", "b1 7 7f", "c1 5"]);
  });

  it("canal de batterie : table des percussions, volume corrigé, programme tel quel", () => {
    const sink = new RecordingSink();
    const driver = new GmDriver(testPatch(), sink);
    sink.take();
    driver.send(0xc0 | RHYTHM_CHANNEL, 0, 0);
    driver.send(0x90 | RHYTHM_CHANNEL, 35, 90);
    driver.send(0x90 | RHYTHM_CHANNEL, 50, 90);
    driver.send(0xb0 | RHYTHM_CHANNEL, 7, 127);
    expect(sink.take()).toEqual(["c9 0", "99 24 5a", "b9 7 64"]);
  });

  it("volume maître, coupure du son, autres messages", () => {
    const sink = new RecordingSink();
    const driver = new GmDriver(undefined, sink);
    expect(sink.take()).toHaveLength(16 * 2);
    driver.send(0xb1, 7, 100, 250);
    driver.masterVolume = 3;
    expect(driver.masterVolume).toBe(3);
    expect(sink.take().filter((m) => m.startsWith("b1"))).toEqual(["b1 7 64 @250", "b1 7 14"]);
    driver.send(0xb1, 7, 2);
    driver.masterVolume = 0;
    expect(sink.take().filter((m) => m.startsWith("b1"))).toEqual(["b1 7 1", "b1 7 0"]);
    driver.masterVolume = 99;
    expect(driver.masterVolume).toBe(15);
    sink.take();
    driver.soundOn = false;
    expect(sink.take()).toHaveLength(16);
    driver.send(0xb1, 7, 64);
    driver.send(0xb1, 10, 20);
    driver.send(0xb1, 0x4b, 3);
    driver.send(0xe1, 0, 64);
    driver.send(0xa1, 60, 5);
    driver.send(0xd1, 60, 0);
    expect(sink.take()).toEqual(["b1 a 14", "e1 0 40"]);
    driver.soundOn = true;
    expect(sink.take()).toContain("b1 7 40");
  });

  it("fonctionne sans synthétiseur, puis lui rend l'état des canaux à son arrivée", () => {
    const driver = new GmDriver(testPatch());
    driver.send(0xc1, 10, 0);
    driver.send(0xb1, 7, 90);
    driver.send(0xb1, 10, 30);
    driver.send(0x91, 60, 100);
    const sink = new RecordingSink();
    driver.attach(sink, 500);
    const sent = sink.take();
    expect(sent.slice(0, 4)).toEqual(["f0 7e 7f 9 1 f7 @500", "b0 65 0 @500", "b0 64 0 @500", "c1 5 @500"]);
    expect(sent.filter((m) => /^[bc]1 /.test(m)).slice(1)).toEqual(["c1 14 @500", "b1 7 46 @500", "b1 a 1e @500"]);
    driver.reset();
    expect(sink.resets).toBe(1);
    expect(sink.take()).toHaveLength(4);
    driver.send(0xb1, 7, 127);
    expect(sink.take()).toEqual(["b1 7 7f"]);
    driver.attach(undefined);
    driver.send(0xb1, 7, 127);
    expect(sink.take()).toEqual([]);
  });
});

describe.skipIf(!original.has)("patch 4 réel", () => {
  it("est neutre : seule son initialisation agit (remise à zéro GS, molette à 12 demi-tons)", () => {
    const patch = readGmPatch(mainIndex().get(ResourceType.Patch, 4));
    const neutral = Array.from({ length: 128 }, (_, i) => i);
    expect(Array.from(patch.programs)).toEqual(neutral);
    expect(Array.from(patch.percussion)).toEqual(neutral);
    expect(patch.keyShift.every((v) => v === 0)).toBe(true);
    expect(patch.volumeAdjust.every((v) => v === 0)).toBe(true);
    expect(patch.velocityCurve.every((v) => v === 0)).toBe(true);
    expect(Array.from(patch.velocityCurves[0])).toEqual(neutral);
    expect(patch.rhythmVolumeAdjust).toBe(0);
    const messages = splitInitData(patch.initData).map((m) => Array.from(m, (b) => b.toString(16)).join(" "));
    expect(messages).toHaveLength(1 + 16 * 4);
    expect(messages[0]).toBe("f0 41 10 42 12 40 0 7f 0 41 f7");
    for (let channel = 0; channel < 16; channel++) {
      const status = (0xb0 | channel).toString(16);
      expect(messages.slice(1 + channel * 4, 5 + channel * 4)).toEqual([`${status} 65 0`, `${status} 64 0`, `${status} 6 c`, `${status} 26 0`]);
    }
    // Le pilote réel laisse donc passer un morceau tel quel.
    const sink = new RecordingSink();
    const driver = new GmDriver(patch, sink);
    sink.take();
    driver.send(0xc1, 48, 0);
    driver.send(0x91, 33, 122);
    driver.send(0x99, 49, 97);
    expect(sink.take()).toEqual(["b1 7 7f", "c1 30", "91 21 7a", "99 31 61"]);
  });
});
