import { describe, expect, it } from "vitest";
import type { Mutable } from "../../src/engine/coktel/audio/backend";
import { lostInTimeSoundPrefs } from "../../src/games/lost-in-time/sound-prefs";
import { MemoryStore } from "../../src/games/lost-in-time/engine/saves";
import { MemoryStorage, prefixedStorage } from "../../src/engine/storage";
import { SoundPrefs } from "../../src/ui/sound-prefs";

const targets = (): [Mutable, Mutable] => [{ muted: false }, { muted: false }];

describe("préférence « Son » de Lost in Time", () => {
  it("est activé par défaut", () => {
    const t = targets();
    const prefs = lostInTimeSoundPrefs(new MemoryStore(), t);
    expect(prefs.isEnabled()).toBe(true);
    expect(t.some((x) => x.muted)).toBe(false);
  });

  it("coupe toutes les sorties d'un coup et persiste", () => {
    const store = new MemoryStore();
    const t = targets();
    const prefs = lostInTimeSoundPrefs(store, t);
    expect(prefs.toggle()).toBe(false);
    expect(t.every((x) => x.muted)).toBe(true);
    const t2 = targets();
    const reloaded = lostInTimeSoundPrefs(store, t2);
    expect(reloaded.isEnabled()).toBe(false);
    expect(t2.every((x) => x.muted)).toBe(true);
    expect(reloaded.toggle()).toBe(true);
    expect(t2.some((x) => x.muted)).toBe(false);
  });

  it("migre une ancienne « Musique » coupée une seule fois, puis supprime la clé", () => {
    const store = new MemoryStore();
    store.set("audio.music", "0");
    const prefs = lostInTimeSoundPrefs(store, targets());
    expect(prefs.isEnabled()).toBe(false);
    expect(store.get("audio.music")).toBeNull();
    prefs.set(true);
    expect(lostInTimeSoundPrefs(store, targets()).isEnabled()).toBe(true);
  });

  it("ignore une ancienne « Musique » activée", () => {
    const store = new MemoryStore();
    store.set("audio.music", "1");
    expect(lostInTimeSoundPrefs(store, targets()).isEnabled()).toBe(true);
    expect(store.get("audio.music")).toBeNull();
  });

  it("garde la clé historique `lost-in-time:audio.sound` (valeurs « 0 » / « 1 ») et relit un choix déjà enregistré", () => {
    const raw = new MemoryStorage();
    const store = prefixedStorage(raw, "lost-in-time:");
    lostInTimeSoundPrefs(store, targets()).set(false);
    expect(raw.get("lost-in-time:audio.sound")).toBe("0");
    expect(lostInTimeSoundPrefs(store, targets()).isEnabled()).toBe(false);
    lostInTimeSoundPrefs(store, targets()).set(true);
    expect(raw.get("lost-in-time:audio.sound")).toBe("1");
    raw.set("lost-in-time:audio.sound", "0"); // préférence enregistrée par une version précédente
    const t = targets();
    expect(lostInTimeSoundPrefs(store, t).isEnabled()).toBe(false);
    expect(t.every((x) => x.muted)).toBe(true);
  });

  it("relit la préférence changée par un autre onglet", () => {
    const store = new MemoryStore();
    const t = targets();
    const prefs = lostInTimeSoundPrefs(store, t);
    store.set("audio.sound", "0");
    expect(prefs.reload()).toBe(true);
    expect(t.every((x) => x.muted)).toBe(true);
    expect(prefs.reload()).toBe(false);
  });
});

describe("SoundPrefs commun : clé historique", () => {
  it("`options.key` remplace la clé `retrovibe:<jeu>:sound`, sans toucher à l'autre", () => {
    const store = new MemoryStore();
    const target = { setMuted: () => {} };
    new SoundPrefs(store, target, "jeu", { key: "ancienne" }).set(false);
    expect(store.get("ancienne")).toBe("0");
    expect(store.get("retrovibe:jeu:sound")).toBeNull();
    new SoundPrefs(store, target, "jeu").set(false);
    expect(store.get("retrovibe:jeu:sound")).toBe("0");
  });
});
