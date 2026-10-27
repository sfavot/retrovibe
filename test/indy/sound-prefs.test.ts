import { describe, expect, it } from "vitest";
import { MUSIC_PREF_KEY, audioPrefs } from "../../src/games/indy/ui/audio-prefs";

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { get: (k: string) => data.get(k) ?? null, set: (k: string, v: string) => void data.set(k, v), data };
}

describe("préférences audio d'Indy", () => {
  it("active le son et la musique par défaut", () => {
    const prefs = audioPrefs(fakeStore());
    expect(prefs.readSound()).toBe(true);
    expect(prefs.readMusic()).toBe(true);
  });

  it("écrit et relit les deux clés séparément", () => {
    const store = fakeStore();
    const prefs = audioPrefs(store);
    prefs.writeSound(false);
    expect(store.data.get("retrovibe:indy:sound")).toBe("0");
    expect(prefs.readSound()).toBe(false);
    expect(prefs.readMusic()).toBe(true);
    prefs.writeMusic(false);
    expect(store.data.get(MUSIC_PREF_KEY)).toBe("0");
    expect(prefs.readMusic()).toBe(false);
    prefs.writeSound(true);
    expect(store.data.get("retrovibe:indy:sound")).toBe("1");
    expect(prefs.readSound()).toBe(true);
  });
});
