import { describe, expect, it } from "vitest";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { ADVENTURE_COMPLETED, NAME_MAX, PILOT_LIMIT, PilotStore, cleanName, isNameChar } from "../../../src/games/swiv3d/screens/pilots";

function store(): { store: PilotStore; raw: MemoryStorage } {
  const raw = new MemoryStorage();
  return { store: new PilotStore(prefixedStorage(raw, "swiv3d:")), raw };
}

describe("pilotes : sauvegarde", () => {
  it("écrit la fiche sous swiv3d:pilot:<n> et la relit à l'identique", () => {
    const { store: s, raw } = store();
    const pilot = s.create("Suzy", 1, 2)!;
    expect(pilot).toMatchObject({ slot: 0, name: "Suzy", language: 1, bestMission: 0, music: 2, playSeconds: 0 });
    pilot.bestMission = 3;
    pilot.playSeconds = 125;
    pilot.language = 0;
    expect(s.save(pilot)).toBe(true);
    expect([...raw.data.keys()]).toEqual(["swiv3d:pilot:0"]);
    expect(new PilotStore(prefixedStorage(raw, "swiv3d:")).get(0)).toEqual(pilot);
    expect(s.list()).toEqual([pilot]);
  });

  it("limite à 10 pilotes, réutilise la première case libre", () => {
    const { store: s } = store();
    for (let i = 0; i < PILOT_LIMIT; i++) expect(s.create(`P${i}`, 1)?.slot).toBe(i);
    expect(s.create("Onze", 1)).toBeNull();
    s.remove(4);
    expect(s.list()).toHaveLength(PILOT_LIMIT - 1);
    expect(s.create("Neuf", 1)?.slot).toBe(4);
  });

  it("coupe le nom à 15 caractères, retire les caractères invalides et refuse un nom vide", () => {
    const { store: s } = store();
    expect(s.create("  Un nom vraiment très long  ", 1)?.name).toBe("Un nom vraiment");
    expect([...cleanName("a".repeat(40))]).toHaveLength(NAME_MAX);
    expect(cleanName("A\tB\u0007C")).toBe("ABC");
    expect(cleanName("日本")).toBe("");
    expect(s.create("   ", 1)).toBeNull();
    expect(s.list()).toHaveLength(1);
  });

  it("accepte lettres accentuées du jeu et ponctuation courante, pas les autres alphabets", () => {
    for (const ch of ["a", "Z", "5", " ", "é", "ç", "'", "-", "?"]) expect(isNameChar(ch)).toBe(true);
    for (const ch of ["\n", "日", "😀", "ab", "", "░"]) expect(isNameChar(ch)).toBe(false);
  });

  it("ignore une fiche corrompue ou hors bornes", () => {
    const { store: s, raw } = store();
    raw.set("swiv3d:pilot:0", "pas du json");
    raw.set("swiv3d:pilot:1", JSON.stringify({ name: "", bestMission: 2 }));
    raw.set("swiv3d:pilot:2", JSON.stringify({ name: "Ok", bestMission: -5, music: 9, language: 7, playSeconds: "x" }));
    expect(s.list()).toEqual([{ slot: 2, name: "Ok", language: 1, bestMission: 0, music: 2, playSeconds: 0 }]);
    expect(s.get(-1)).toBeNull();
    expect(s.get(PILOT_LIMIT)).toBeNull();
  });

  it("garde la mission terminée (0xb4c69) telle quelle", () => {
    const { store: s } = store();
    const p = s.create("Fini", 1)!;
    p.bestMission = ADVENTURE_COMPLETED;
    s.save(p);
    expect(s.get(0)?.bestMission).toBe(ADVENTURE_COMPLETED);
  });

  it("supprime une fiche sans toucher aux autres", () => {
    const { store: s } = store();
    s.create("A", 1);
    s.create("B", 1);
    s.remove(0);
    expect(s.list().map((p) => p.name)).toEqual(["B"]);
  });
});

describe("réglages globaux", () => {
  it("valeurs par défaut sans fiche, puis aller-retour avec bornes", () => {
    const { store: s, raw } = store();
    expect(s.loadGlobal()).toEqual({ language: 1, volumes: { master: 255, music: 255, effects: 255 }, lastPilot: null });
    expect(s.saveGlobal({ language: 0, volumes: { master: 10, music: 20, effects: 30 }, lastPilot: 3 })).toBe(true);
    expect(s.loadGlobal()).toEqual({ language: 0, volumes: { master: 10, music: 20, effects: 30 }, lastPilot: 3 });
    raw.set("swiv3d:global", JSON.stringify({ language: 0, volumes: { master: 999, music: -4 }, lastPilot: 42 }));
    expect(s.loadGlobal()).toEqual({ language: 0, volumes: { master: 255, music: 0, effects: 255 }, lastPilot: null });
    raw.set("swiv3d:global", "{");
    expect(s.loadGlobal().language).toBe(1);
  });
});
