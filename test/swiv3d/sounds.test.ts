import { describe, expect, it } from "vitest";
import { parseSoundBank } from "../../src/games/swiv3d/data/sounds";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe.skipIf(!hasOriginalFiles)("SOUNDS.BD de SWIV 3D (fichiers du jeu)", () => {
  const bank = parseSoundBank(readOriginal("SOUNDS.BD"));

  it("contient 26 sons, accessibles par identifiant", () => {
    expect(bank.sounds).toHaveLength(26);
    expect(bank.sounds[0].id).toBe(100004);
    expect(bank.get(600405)?.offset).toBe(289374);
    expect(bank.get(1)).toBeUndefined();
  });

  it("observé : PCM 8 bits à 11025 Hz, mono sauf le son 300202 (stéréo)", () => {
    for (const { wave } of bank.sounds) {
      expect(wave).toMatchObject({ format: 1, sampleRate: 11025, bitsPerSample: 8 });
      expect(wave.data.length).toBeGreaterThan(0);
    }
    expect(bank.sounds.filter((s) => s.wave.channels !== 1).map((s) => s.id)).toEqual([300202]);
  });
});
