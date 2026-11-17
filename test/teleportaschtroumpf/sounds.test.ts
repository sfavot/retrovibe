import { describe, expect, it } from "vitest";
import { soundDuration } from "../../src/engine/infogrames/audio/sound";
import { parseAudioIndex } from "../../src/engine/infogrames/data/audio-index";
import { Resources } from "../../src/engine/infogrames/resources";
import { originalFiles } from "../support/original";
import { TestHost } from "./engine-test-host";

const original = originalFiles("teleportaschtroumpf", "audio.json");

/**
 * Les 975 VOC du jeu sont versionnés en MP3 (`<nom>.VOC.mp3`) ; `audio.json` garde le nombre d'échantillons et la
 * fréquence du PCM d'origine. Les valeurs attendues ici sont celles que donnait la lecture des VOC.
 */
describe.skipIf(!original.has)("sons du jeu (MP3 + audio.json)", () => {
  const index = parseAudioIndex(new TextDecoder().decode(original.read("audio.json")));
  const entry = (path: string) => index.get(path)!;

  it("l'index décrit les 975 MP3 du manifeste, et il ne reste aucun VOC", () => {
    const paths = original.manifest()!.map((e) => e.path);
    expect(paths.filter((p) => /\.voc$/i.test(p))).toEqual([]);
    expect([...index.keys()].sort()).toEqual(paths.filter((p) => p.endsWith(".mp3")).sort());
    expect(index.size).toBe(975);
    for (const path of index.keys()) expect(path, path).toMatch(/^DATA\/.+\.VOC\.mp3$/);
  });

  it("garde les fréquences et les longueurs d'origine", () => {
    const rates = new Map<number, number>();
    let samples = 0;
    for (const e of index.values()) {
      rates.set(e.sampleRate, (rates.get(e.sampleRate) ?? 0) + 1);
      samples += e.samples;
    }
    expect([...rates].sort((a, b) => a[0] - b[0])).toEqual([[11025, 1], [18868, 959], [19231, 15]]);
    // Somme des échantillons des 975 VOC d'origine.
    expect(samples).toBe(85_963_386);
    // Les trois musiques, un bip, un bruitage, et le seul fichier à 11 025 Hz (bloc VOC de type 9).
    expect(entry("DATA/S52/S52M/S52M001M.VOC.mp3")).toEqual({ samples: 1_430_181, sampleRate: 18868 });
    expect(entry("DATA/S52/S52M/S52M002M.VOC.mp3")).toEqual({ samples: 456_470, sampleRate: 19231 });
    expect(entry("DATA/S52/S52M/S52M003M.VOC.mp3")).toEqual({ samples: 501_668, sampleRate: 18868 });
    expect(entry("DATA/S07/S07A/S07A001B.VOC.mp3")).toEqual({ samples: 4988, sampleRate: 19231 });
    expect(entry("DATA/S01/S01A/S01A001B.VOC.mp3")).toEqual({ samples: 4071, sampleRate: 18868 });
    expect(entry("DATA/S30/S30A/S30A.VOC.mp3")).toEqual({ samples: 8_726_107, sampleRate: 11025 });
  });

  it("Resources.sound rend le MP3 avec la longueur de l'index, sans le décoder, et le garde en mémoire", async () => {
    const host = new TestHost();
    const resources = new Resources(host);
    const beep = await resources.sound("s07a001b.voc");
    expect(beep).toMatchObject({ format: "mp3", sampleCount: 4988, sampleRate: 19231 });
    expect(soundDuration(beep)).toBe(4988 / 19231);
    // Les octets sont ceux du fichier MP3 (en-tête ID3v2 écrit par ffmpeg), pas du PCM.
    expect(String.fromCharCode(...beep.data.subarray(0, 3))).toBe("ID3");
    expect(beep.data.length).toBe(original.manifest()!.find((e) => e.path === "DATA/S07/S07A/S07A001B.VOC.mp3")!.size);
    expect(host.loaded).toContain("DATA/S07/S07A/S07A001B.VOC.mp3");
    expect(await resources.sound("S07A001B.VOC")).toBe(beep);
  });

  it("un nom présent dans plusieurs dossiers est pris dans celui que donne son gabarit", async () => {
    const host = new TestHost();
    expect(host.filePath("s13c.voc.mp3")).toBe("DATA/S13/S13C/S13C.VOC.mp3");
    expect(host.filePath("s20ad01m.voc.mp3")).toBe("DATA/S20/S20A/S20AD01M.VOC.mp3");
    expect((await new Resources(host).sound("s13c.voc")).sampleCount).toBe(74_208);
  });

  it("un son absent est refusé", async () => {
    await expect(new Resources(new TestHost()).sound("s17a004t.voc")).rejects.toThrow(/introuvable/);
  });
});
