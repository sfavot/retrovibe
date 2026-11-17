import { describe, expect, it } from "vitest";
import { pcmSound, soundDuration } from "../../src/engine/infogrames/audio/sound";
import { audioDuration, parseAudioIndex } from "../../src/engine/infogrames/data/audio-index";

describe("parseAudioIndex", () => {
  it("lit chemin → [échantillons, fréquence] et donne la durée exacte", () => {
    const index = parseAudioIndex('{"DATA/S07/S07A/S07A001B.VOC.mp3":[4988,19231],"MDF/01/A.MUX.mp3":[22050,11025]}');
    expect([...index.keys()]).toEqual(["DATA/S07/S07A/S07A001B.VOC.mp3", "MDF/01/A.MUX.mp3"]);
    expect(index.get("DATA/S07/S07A/S07A001B.VOC.mp3")).toEqual({ samples: 4988, sampleRate: 19231 });
    expect(audioDuration(index.get("MDF/01/A.MUX.mp3")!)).toBe(2);
  });

  it("refuse tout ce qui n'est pas un objet de paires d'entiers strictement positifs", () => {
    expect(() => parseAudioIndex("[]")).toThrow(/objet attendu/);
    expect(() => parseAudioIndex("null")).toThrow(/objet attendu/);
    for (const value of ["[0,18868]", "[10]", "[10,18868,1]", "[1.5,18868]", '"x"', "[10,-1]"]) {
      expect(() => parseAudioIndex(`{"a.mp3":${value}}`), value).toThrow(/entrée invalide pour a\.mp3/);
    }
  });
});

describe("Sound", () => {
  it("un son PCM dure son nombre d'octets ; un MP3, la longueur d'origine donnée par l'index", () => {
    expect(soundDuration(pcmSound(new Uint8Array(500), 1000))).toBe(0.5);
    expect(soundDuration({ format: "mp3", data: new Uint8Array(10), sampleCount: 18868, sampleRate: 18868 })).toBe(1);
  });
});
