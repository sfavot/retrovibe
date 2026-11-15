import { describe, expect, it } from "vitest";
import { ImdDecoder } from "../../../src/engine/coktel/data/imd";
import { entriesWithExt, entry, hasOriginalFiles, sha1 } from "../helpers";

describe.skipIf(!hasOriginalFiles)("IMD de Ween", () => {
  it("décode intégralement les 30 films, sans son (28 en version 3, 2 en version 2)", () => {
    const names = entriesWithExt(".IMD");
    expect(names).toHaveLength(30);
    const versions: Record<number, string[]> = {};
    const finals: Uint8Array[] = [];
    let frames = 0;
    for (const name of names) {
      const decoder = new ImdDecoder(entry(name));
      (versions[decoder.header.version] ??= []).push(name);
      expect(decoder.header.sound, name).toBeNull();
      // Plafond : un saut arrière pourrait sinon boucler.
      const limit = decoder.header.frameCount * 4 + 16;
      let calls = 0;
      let decoded = 0;
      while (calls++ < limit && decoder.decodeNextFrame()) decoded++;
      expect(decoded, name).toBeGreaterThan(0);
      expect(decoded, name).toBeLessThanOrEqual(decoder.header.frameCount);
      frames += decoded;
      finals.push(decoder.surface.pixels);
    }
    expect(versions[2]).toEqual(["FINAL.IMD", "WE_17.IMD"]);
    expect(versions[3]).toHaveLength(28);
    expect(frames).toBe(1162);
    expect(sha1(...finals)).toBe("e2fb562ba6866cb95bf80a5f430bb5169b11c33f");
  });
});
