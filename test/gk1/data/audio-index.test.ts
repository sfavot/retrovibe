import { describe, expect, it } from "vitest";
import { AUDIO_INDEX_PATH, AudioIndex, audioPath, parseDurationJson, parseSyncJson, readAudio36Map, readSfxMap, samplesToTicks, syncPath, voiceClipName, voiceIndexPath, voicePath } from "../../../src/games/gk1/data/audio-index";
import { ResourceType, SFX_MAP_NUMBER } from "../../../src/games/gk1/data/ids";
import { messageKey, readMessages } from "../../../src/games/gk1/data/message";
import { mainIndex, original } from "./real";

const FF = 0xff;

describe("index audio", () => {
  it("nomme les fichiers de voix, de synchro et de bruitages", () => {
    const key = { module: 210, noun: 6, verb: 0, cond: 113, seq: 1 };
    expect(voiceClipName(key)).toBe("6-0-113-1");
    expect(voicePath(key)).toBe("voices/210/6-0-113-1.mp3");
    expect(syncPath(50)).toBe("voices/50/sync.json");
    expect(audioPath(101)).toBe("audio/101.mp3");
    expect(voiceIndexPath(50)).toBe("voices/50/index.json");
    expect(AUDIO_INDEX_PATH).toBe("audio/index.json");
  });

  it("lit un index.json et convertit les échantillons en ticks comme Audio32::play", () => {
    const durations = parseDurationJson('{"6-0-20-1":44100,"12":1}');
    expect(durations.get("6-0-20-1")).toBe(44100);
    expect(durations.get("12")).toBe(1);
    expect(() => parseDurationJson("[1]")).toThrow(/mal formé/);
    expect(() => parseDurationJson('{"a":0}')).toThrow(/durée invalide pour a/);
    expect(() => parseDurationJson('{"a":1.5}')).toThrow(/durée invalide/);
    expect(() => parseDurationJson('{"a":"x"}')).toThrow(/durée invalide/);
    // Millisecondes tronquées, ticks tronqués, plus 1 : 44 100 échantillons = 2 000 ms = 120 ticks, rendus 121.
    expect(samplesToTicks(44100)).toBe(121);
    expect(samplesToTicks(1)).toBe(1);
    expect(samplesToTicks(23)).toBe(1);
    // 54 464 échantillons = 2 470 ms (tronqué) = 148,2 ticks, tronqués à 148, rendus 149.
    expect(samplesToTicks(54464)).toBe(149);
    // 22 050 échantillons = 1 000 ms = 60 ticks, rendus 61 ; un de moins = 999 ms = 59,94 ticks, rendus 60.
    expect(samplesToTicks(22050)).toBe(61);
    expect(samplesToTicks(22049)).toBe(60);
  });

  it("lit un sync.json et refuse les repères mal formés", () => {
    const cues = parseSyncJson('{"6-0-20-1":[0,10,3,4],"1-1-1-1":[]}');
    expect(cues.get("6-0-20-1")).toEqual([{ tick: 0, cue: 10 }, { tick: 3, cue: 4 }]);
    expect(cues.get("1-1-1-1")).toEqual([]);
    expect(() => parseSyncJson("[1,2]")).toThrow(/mal formé/);
    expect(() => parseSyncJson('{"a":[1]}')).toThrow(/repères invalides pour a/);
    expect(() => parseSyncJson('{"a":[1,-2]}')).toThrow(/repères invalides/);
    expect(() => parseSyncJson('{"a":"x"}')).toThrow(/repères invalides/);
  });

  it("lit une map audio36 (drapeau de synchro) et la map des bruitages", () => {
    const terminator = new Array(11).fill(FF);
    const map = Uint8Array.from([0, 0, 0, 0, 6, 0, 20, 0x81, 1, 2, 3, 9, 0, 6, 0, 30, 2, 4, 5, 6, ...terminator]);
    expect(readAudio36Map(map)).toEqual([
      { noun: 6, verb: 0, cond: 20, seq: 1, hasSync: true },
      { noun: 6, verb: 0, cond: 30, seq: 2, hasSync: false },
    ]);
    expect(() => readAudio36Map(map.subarray(0, map.length - 1))).toThrow(/fin de la map audio36/);
    expect(() => readAudio36Map(map.subarray(0, 9))).toThrow(/tronquée|sans fin/);
    expect(() => readAudio36Map(Uint8Array.from([0, 0, 0, 0, 1, 1, 1, 0x41, 0, 0, 0, ...terminator]))).toThrow(/RAVE/);

    expect(readSfxMap(Uint8Array.of(12, 0, 0, 0, 0, 13, 0, 1, 2, 3, FF, FF, FF, FF, FF))).toEqual([12, 13]);
    expect(() => readSfxMap(Uint8Array.of(12, 0, 0, 0, 0, FF, FF))).toThrow(/fin de la map des bruitages/);
    expect(() => readSfxMap(Uint8Array.of(12, 0, 0, 0, 0))).toThrow(/sans fin/);
  });

  it("indexe un manifeste", () => {
    const index = new AudioIndex([
      { path: "voices/50/6-0-20-1.mp3" },
      { path: "voices/50/sync.json" },
      { path: "audio/12.mp3" },
      { path: "RESOURCE.MAP" },
    ]);
    const key = { module: 50, noun: 6, verb: 0, cond: 20, seq: 1 };
    expect(index.voice(key)).toBe("voices/50/6-0-20-1.mp3");
    expect(index.voice({ ...key, seq: 2 })).toBeUndefined();
    expect(index.sound(12)).toBe("audio/12.mp3");
    expect(index.sound(13)).toBeUndefined();
    expect(index.sync(50)).toBe("voices/50/sync.json");
    expect(index.sync(51)).toBeUndefined();
    expect([index.voiceCount, index.audioCount]).toEqual([1, 1]);
  });
});

describe.skipIf(!original.has)("audio de Gabriel Knight", () => {
  it("retrouve un fichier pour les 7 469 clips des 73 maps audio36 et pour les 186 bruitages de la map 65535", () => {
    const resources = mainIndex();
    const audio = new AudioIndex(original.manifest()!);
    expect(audio.voiceCount).toBe(7469);
    expect(audio.audioCount).toBe(231);

    const maps = resources.numbers(ResourceType.Map).filter((n) => n !== SFX_MAP_NUMBER);
    expect(maps).toHaveLength(73);
    let clips = 0;
    let withSync = 0;
    let syncEntries = 0;
    let durationEntries = 0;
    let totalSamples = 0;
    let withoutMessage = 0;
    let voicedMessages = 0;
    const syncModules: number[] = [];
    const modulesWithoutMessages: number[] = [];
    for (const module of maps) {
      // Une map audio36 porte le numéro de la ressource message de son module.
      if (!resources.has(ResourceType.Message, module)) modulesWithoutMessages.push(module);
      const messages = new Set(resources.has(ResourceType.Message, module) ? readMessages(resources.get(ResourceType.Message, module)).entries.map(messageKey) : []);
      const path = audio.sync(module);
      const cues = path ? parseSyncJson(new TextDecoder().decode(original.read(path))) : undefined;
      if (cues) {
        syncModules.push(module);
        syncEntries += cues.size;
      }
      const durations = parseDurationJson(new TextDecoder().decode(original.read(voiceIndexPath(module))));
      durationEntries += durations.size;
      for (const entry of readAudio36Map(resources.get(ResourceType.Map, module))) {
        clips++;
        const key = { module, ...entry };
        expect(audio.voice(key)).toBe(voicePath(key));
        const samples = durations.get(voiceClipName(entry));
        expect(samples).toBeDefined();
        totalSamples += samples!;
        expect(samplesToTicks(samples!)).toBeGreaterThan(0);
        if (messages.has(voiceClipName(entry))) voicedMessages++;
        else withoutMessage++;
        if (!entry.hasSync) continue;
        withSync++;
        const list = cues?.get(voiceClipName(entry));
        expect(list).toBeDefined();
        for (let i = 1; i < list!.length; i++) expect(list![i].tick).toBeGreaterThanOrEqual(list![i - 1].tick);
      }
    }
    expect(clips).toBe(7469);
    expect(durationEntries).toBe(7469);
    // 8 h 54 min 35 s de voix (`files.md`).
    expect(Math.round(totalSamples / 22050)).toBe(32075);
    expect(withSync).toBe(1777);
    expect(syncModules).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 670]);
    expect(syncEntries).toBe(1785);
    // Le module 339 n'a qu'un clip et pas de ressource message.
    expect(modulesWithoutMessages).toEqual([339]);
    expect(withoutMessage).toBe(12);
    expect(10982 - voicedMessages).toBe(3525);

    const sfx = readSfxMap(resources.get(ResourceType.Map, SFX_MAP_NUMBER));
    expect(sfx).toHaveLength(186);
    const sfxDurations = parseDurationJson(new TextDecoder().decode(original.read(AUDIO_INDEX_PATH)));
    expect(sfxDurations.size).toBe(231);
    for (const number of sfx) {
      expect(audio.sound(number)).toBe(audioPath(number));
      expect(sfxDurations.get(String(number))).toBeGreaterThan(0);
    }
  });
});
