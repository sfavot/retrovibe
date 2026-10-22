import { describe, expect, it } from "vitest";
import { AudioPrefs, type Mutable } from "../../src/games/lost-in-time/engine/audio/prefs";
import { MemoryStore } from "../../src/games/lost-in-time/engine/saves";

const targets = (): [Mutable, Mutable] => [{ muted: false }, { muted: false }];

describe("AudioPrefs", () => {
  it("est activé par défaut", () => {
    const t = targets();
    const prefs = new AudioPrefs(new MemoryStore(), t);
    expect(prefs.isEnabled()).toBe(true);
    expect(t.some((x) => x.muted)).toBe(false);
  });

  it("coupe toutes les sorties d'un coup et persiste", () => {
    const store = new MemoryStore();
    const t = targets();
    const prefs = new AudioPrefs(store, t);
    expect(prefs.toggle()).toBe(false);
    expect(t.every((x) => x.muted)).toBe(true);
    const t2 = targets();
    const reloaded = new AudioPrefs(store, t2);
    expect(reloaded.isEnabled()).toBe(false);
    expect(t2.every((x) => x.muted)).toBe(true);
    expect(reloaded.toggle()).toBe(true);
    expect(t2.some((x) => x.muted)).toBe(false);
  });

  it("migre une ancienne « Musique » coupée une seule fois, puis supprime la clé", () => {
    const store = new MemoryStore();
    store.set("audio.music", "0");
    const prefs = new AudioPrefs(store, targets());
    expect(prefs.isEnabled()).toBe(false);
    expect(store.get("audio.music")).toBeNull();
    prefs.set(true);
    expect(new AudioPrefs(store, targets()).isEnabled()).toBe(true);
  });

  it("ignore une ancienne « Musique » activée", () => {
    const store = new MemoryStore();
    store.set("audio.music", "1");
    expect(new AudioPrefs(store, targets()).isEnabled()).toBe(true);
    expect(store.get("audio.music")).toBeNull();
  });
});
