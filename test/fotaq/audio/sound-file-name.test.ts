import { describe, expect, it } from "vitest";
import { soundFileName } from "../../../src/games/fotaq/audio/sound";

describe("soundFileName", () => {
  it("remplace les espaces par des zéros et met en majuscules (PCSound::playSound)", () => {
    expect(soundFileName("02 1P2 1")).toBe("0201P201");
    expect(soundFileName("116Bssss")).toBe("116BSSSS");
  });
});
