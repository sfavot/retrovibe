import { describe, expect, it } from "vitest";
import { GM_PATCH_UNMAPPED, readGmPatch } from "../../../src/games/gk1/data/gm-patch";
import { PATCH_ADLIB, PATCH_GENERAL_MIDI, ResourceType, SOUND_CONTROL_CHANNEL, SOUND_END_OF_TRACK, SoundDevice } from "../../../src/games/gk1/data/ids";
import { parsePatchFileName, readPatchFile } from "../../../src/games/gk1/data/resource-map";
import { CHANNEL_FLAG_NO_REMAP, readSound, trackFor } from "../../../src/games/gk1/data/sound";
import { mainIndex, original, PATCH_FILES, tally } from "./real";

/** Son synthétique : en-tête de priorité 80, piste General MIDI à deux canaux, piste MT-32 qui partage le premier. */
function buildSound(): Uint8Array {
  const table = [
    0xf0, 80, 0, 0, 0, 0, 0, 0xff,
    7, 0, 0, 32, 0, 4, 0, 0, 0, 36, 0, 3, 0, 0xff,
    12, 0, 0, 32, 0, 4, 0, 0xff,
    0xff,
  ];
  // Offset 31 : octet nul ; canal 1 à 32 (4 octets), canal 2 à 36 (3 octets).
  return Uint8Array.from([...table, 0, 0x2f, 0x31, 0x00, 0xfc, 0x09, 0x02, 0xfc]);
}

describe("ressource sound SCI", () => {
  it("lit la priorité, les pistes et les canaux", () => {
    const data = buildSound();
    const sound = readSound(data);
    expect(sound.priority).toBe(80);
    expect(sound.tableSize).toBe(31);
    expect(sound.tracks.map((t) => [t.device, t.channels.length])).toEqual([[7, 2], [12, 1]]);
    const [control, drums] = trackFor(sound, SoundDevice.GeneralMidi)!.channels;
    expect(control).toMatchObject({ offset: 32, size: 4, number: SOUND_CONTROL_CHANNEL, flags: CHANNEL_FLAG_NO_REMAP, voices: 1, priority: 3 });
    expect([...control.data]).toEqual([0x00, SOUND_END_OF_TRACK]);
    expect(drums).toMatchObject({ number: 9, flags: 0, voices: 2, priority: 0 });
    expect(trackFor(sound, SoundDevice.Mt32)!.channels[0].offset).toBe(32);
    expect(trackFor(sound, SoundDevice.AdLib)).toBeUndefined();
  });

  it("accepte un son sans piste d'en-tête et refuse les débordements", () => {
    const data = buildSound().subarray(8);
    // Sans l'en-tête, les offsets des canaux sont décalés : on les corrige.
    const fixed = data.slice();
    fixed[3] = 24;
    fixed[9] = 28;
    fixed[17] = 24;
    expect(readSound(fixed).priority).toBeUndefined();
    expect(readSound(fixed).tracks).toHaveLength(2);
    expect(() => readSound(data)).toThrow(/hors de la ressource/);
    expect(() => readSound(Uint8Array.of(7, 0, 0))).toThrow(/tronquée/);
    expect(() => readSound(Uint8Array.of(7))).toThrow(/tronquée/);
    const digital = buildSound();
    digital[32] = 0xfe;
    expect(() => readSound(digital)).toThrow(/numérique/);
  });
});

describe("patch General MIDI", () => {
  it("lit les tables et les octets d'initialisation", () => {
    const data = new Uint8Array(1155 + 3);
    data[0] = 5;
    data[127] = GM_PATCH_UNMAPPED;
    data[128] = 0xf4; // −12 demi-tons
    data[256] = 0x10;
    data[384 + 36] = 35;
    data[512] = 0xfe;
    data[513] = 2;
    data[641 + 2 * 128 + 127] = 100;
    data[1153] = 3;
    data.set([0xf0, 0x7e, 0xf7], 1155);
    const patch = readGmPatch(data);
    expect(patch.programs[0]).toBe(5);
    expect(patch.programs[127]).toBe(GM_PATCH_UNMAPPED);
    expect(patch.keyShift[0]).toBe(-12);
    expect(patch.volumeAdjust[0]).toBe(16);
    expect(patch.percussion[36]).toBe(35);
    expect(patch.rhythmVolumeAdjust).toBe(-2);
    expect(patch.velocityCurve[0]).toBe(2);
    expect(patch.velocityCurves).toHaveLength(4);
    expect(patch.velocityCurves[2][127]).toBe(100);
    expect([...patch.initData]).toEqual([0xf0, 0x7e, 0xf7]);
    expect(() => readGmPatch(data.subarray(0, data.length - 1))).toThrow(/incohérente/);
    expect(() => readGmPatch(data.subarray(0, 600))).toThrow(/tronqué/);
  });
});

describe.skipIf(!original.has)("sons de Gabriel Knight", () => {
  it("lit les 288 sons : pistes par périphérique, canaux, aucun octet inexpliqué hors remplissage nul", () => {
    const index = mainIndex();
    const numbers = index.numbers(ResourceType.Sound);
    expect(numbers).toHaveLength(288);
    const devices: number[] = [];
    const priorities: (number | undefined)[] = [];
    const withoutHeader: number[] = [];
    const empty: number[] = [];
    let sameGmAndMt32 = 0;
    let differentGmAndMt32 = 0;
    for (const n of numbers) {
      const data = index.get(ResourceType.Sound, n);
      const sound = readSound(data);
      priorities.push(sound.priority);
      if (sound.priority === undefined) withoutHeader.push(n);
      const used = new Uint8Array(data.length);
      used.fill(1, 0, sound.tableSize);
      for (const track of sound.tracks) {
        devices.push(track.device);
        for (const channel of track.channels) {
          used.fill(1, channel.offset, channel.offset + channel.size);
          expect(channel.number).toBeLessThanOrEqual(SOUND_CONTROL_CHANNEL);
          expect([0, CHANNEL_FLAG_NO_REMAP]).toContain(channel.flags);
          // Tout canal finit par « fin de piste », parfois suivie d'un octet nul.
          const tail = [...channel.data.subarray(-2)];
          expect(tail[1] === SOUND_END_OF_TRACK || (tail[0] === SOUND_END_OF_TRACK && tail[1] === 0)).toBe(true);
        }
      }
      const gm = trackFor(sound, SoundDevice.GeneralMidi);
      const mt32 = trackFor(sound, SoundDevice.Mt32);
      if (gm && mt32) {
        const offsets = (t: typeof gm) => t.channels.map((c) => `${c.offset}+${c.size}`).join(",");
        if (offsets(gm) === offsets(mt32)) sameGmAndMt32++;
        else differentGmAndMt32++;
      }
      // Restes : un octet nul entre la table et le premier canal ; les sons sans canal finissent par 27 octets nuls.
      const unused: number[] = [];
      used.forEach((u, i) => u === 0 && unused.push(i));
      expect(unused.every((i) => data[i] === 0)).toBe(true);
      if (sound.tracks.length === 0) {
        empty.push(n);
        expect(unused).toHaveLength(27);
      } else {
        expect(unused).toEqual([sound.tableSize]);
      }
    }
    expect(Object.fromEntries(tally(devices))).toEqual({ 0: 286, 6: 209, 7: 275, 9: 1, 11: 257, 12: 286, 18: 285, 19: 228 });
    expect(withoutHeader).toEqual([742]);
    expect(empty).toEqual([264, 801]);
    expect(Object.fromEntries(tally(priorities.map(String)))).toEqual({ 100: 261, 110: 3, 75: 21, 80: 2, undefined: 1 });
    expect([sameGmAndMt32, differentGmAndMt32]).toEqual([194, 81]);
  });

  it("lit les deux sons de PATCHES/", () => {
    for (const path of PATCH_FILES) {
      const id = parsePatchFileName(path)!;
      const sound = readSound(readPatchFile(original.read(path), id.type));
      expect(sound.priority).toBe(100);
      expect(sound.tracks.map((t) => t.device)).toEqual([0, 6, 7, 11, 12, 18, 19]);
      expect(sound.tracks.every((t) => t.channels.length === 1 && t.channels[0].number === SOUND_CONTROL_CHANNEL)).toBe(true);
    }
  });

  it("lit le patch General MIDI (4) et retrouve la taille du patch AdLib (3)", () => {
    const index = mainIndex();
    const data = index.get(ResourceType.Patch, PATCH_GENERAL_MIDI);
    expect(data).toHaveLength(1310);
    const patch = readGmPatch(data);
    expect(patch.initData).toHaveLength(155);
    expect([...patch.programs.subarray(0, 8)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(patch.velocityCurve.every((c) => c < 4)).toBe(true);
    expect(index.get(ResourceType.Patch, PATCH_ADLIB)).toHaveLength(190 * 28 + 62);
  });
});
