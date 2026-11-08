import { afterEach, describe, expect, it, vi } from "vitest";
import { slotKey } from "../../../src/engine/save-slots";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { copy } from "../../../src/games/fotaq/copy";
import { SAVE_VERSION, type SaveData, snapshotState } from "../../../src/games/fotaq/engine/save";
import { OWNERSHIP } from "../../../src/games/fotaq/engine/specials/ownership";
import { BamFlag } from "../../../src/games/fotaq/engine/specials/bam";
import { createGameState } from "../../../src/games/fotaq/engine/state";
import { SAVE_PREFIX, SLOT_COUNT, createSaveSlots, describeSave, loadFromSlot, placeName, resultMessage, saveToSlot, summarizeSlots } from "../../../src/games/fotaq/ui/saves";
import { gameData } from "../engine/test-host";
import { hasOriginalFiles } from "../helpers";
import { Walkthrough } from "../walkthrough";

function sampleSave(room = 22): SaveData {
  const state = createGameState(gameData());
  state.room = room;
  return snapshotState(state, { lastSong: 0, bam: { flag: BamFlag.Stop, index: 0, screenShaked: false, fightTable: 0 }, lightsOff: false });
}

function slots() {
  const raw = new MemoryStorage();
  return { raw, slots: createSaveSlots(prefixedStorage(raw, SAVE_PREFIX)) };
}

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!hasOriginalFiles)("emplacements de sauvegarde", () => {
  it("dix emplacements, tous vides au départ, appelés par leur numéro", () => {
    const { slots: s } = slots();
    const all = summarizeSlots(s);
    expect(all).toHaveLength(SLOT_COUNT);
    expect(SLOT_COUNT).toBe(10);
    expect(all.map((slot) => slot.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(all.every((slot) => slot.empty && slot.savedAt === null)).toBe(true);
    expect(all[2].description).toBe(copy.saveSlot(3));
    expect(copy.saveSlot(3)).toBe("Emplacement 3");
  });

  it("un emplacement écrit se relit à l'identique ; la clé porte le préfixe du jeu", () => {
    const { raw, slots: s } = slots();
    const save = sampleSave();
    expect(s.write(4, save, 1_700_000_000_000)).toBe(true);
    expect(SAVE_PREFIX).toBe("fotaq:");
    expect([...raw.data.keys()]).toEqual(["fotaq:slot04"]);
    expect(slotKey(4)).toBe("slot04");
    expect(s.read(4)).toEqual({ savedAt: 1_700_000_000_000, save });
    expect(JSON.parse(raw.data.get("fotaq:slot04")!)).toMatchObject({ savedAt: 1_700_000_000_000, save: { version: SAVE_VERSION, room: 22 } });
  });

  it("la description dit le lieu (la zone du jeu) et la date", () => {
    const { slots: s } = slots();
    s.write(1, sampleSave(22), Date.UTC(2026, 10, 7, 15, 5));
    const summary = summarizeSlots(s)[0];
    expect(summary.empty).toBe(false);
    expect(summary.description).toMatch(/^Le camp de la Flöda – /);
    expect(summary.description).toContain("2026");
    expect(summary.description).toBe(describeSave(s.read(1)!));
    expect(summary.savedAt).toBe(Date.UTC(2026, 10, 7, 15, 5));
  });

  it("chaque pièce d'un groupe a pour lieu la zone du groupe ; les pièces sans groupe (écrans d'objets et de cinématiques) ont leur nom propre, jamais « Pièce N »", () => {
    const data = gameData();
    const owned = new Set(Object.values(OWNERSHIP).flatMap((group) => group.rooms));
    for (let room = 1; room <= data.jas.roomCount; room++) {
      if (owned.has(room)) expect(placeName(room), `pièce ${room}`).not.toBe(copy.unknownPlace(room));
      else expect(placeName(room), `pièce ${room}`).toBe(copy.roomNames[room]);
      expect(placeName(room), `pièce ${room}`).not.toBe(copy.unknownPlace(room));
    }
    expect(placeName(96)).toBe("L'avion");
    expect(placeName(17)).toBe(copy.zoneNames[1]);
    expect(placeName(41)).toBe(copy.zoneNames[2]);
    expect(placeName(50)).toBe(copy.zoneNames[3]);
    expect(placeName(66)).toBe(copy.zoneNames[4]);
    expect(placeName(76)).toBe(copy.zoneNames[4]);
    expect(placeName(110)).toBe(copy.zoneNames[5]);
    expect(placeName(7)).toBe(copy.zoneNames[6]);
    expect(placeName(9999)).toBe("Pièce 9999");
    // Les zones du texte sont les groupes du jeu, ni plus ni moins.
    expect(Object.keys(copy.zoneNames).map(Number)).toEqual(Object.keys(OWNERSHIP).map(Number));
  });

  it("une partie neuve sauvegardée dans la chambre de départ, l'hôtel ou l'avion d'Anderson est « Le début de l'aventure »", () => {
    for (const room of [70, 71, 72, 73, 74, 75]) expect(placeName(room), `pièce ${room}`).toBe("Le début de l'aventure");
    const { slots: s } = slots();
    s.write(1, sampleSave(70), Date.UTC(2026, 10, 7, 15, 5));
    expect(summarizeSlots(s)[0].description).toMatch(/^Le début de l'aventure – /);
  });

  it("écraser un emplacement remplace son contenu, le vider le rend vide", () => {
    const { slots: s } = slots();
    s.write(1, sampleSave(22), 1);
    s.write(1, sampleSave(50), 2);
    expect(s.read(1)!.save.room).toBe(50);
    s.clear(1);
    expect(s.read(1)).toBeNull();
    expect(summarizeSlots(s)[0].empty).toBe(true);
  });

  it("une valeur illisible vaut emplacement vide, sans exception : JSON cassé, texte, autre version, champ manquant, date absente", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { raw, slots: s } = slots();
    const good = JSON.parse(JSON.stringify({ savedAt: 1, save: sampleSave() })) as { savedAt: number; save: Record<string, unknown> };
    const cases: Record<string, string> = {
      "fotaq:slot01": "{pas du json",
      "fotaq:slot02": "42",
      "fotaq:slot03": "null",
      "fotaq:slot04": JSON.stringify({ ...good, save: { ...good.save, version: SAVE_VERSION + 1 } }),
      "fotaq:slot05": JSON.stringify({ ...good, save: { ...good.save, gameStates: [] } }),
      "fotaq:slot06": JSON.stringify({ save: good.save }),
      "fotaq:slot07": JSON.stringify({ savedAt: "hier", save: good.save }),
      "fotaq:slot08": JSON.stringify({ savedAt: 1 }),
      "fotaq:slot09": "",
    };
    for (const [key, value] of Object.entries(cases)) raw.set(key, value);
    const all = summarizeSlots(s);
    expect(all.slice(0, 9).every((slot) => slot.empty)).toBe(true);
    expect(s.read(1)).toBeNull();
    expect(warn).toHaveBeenCalled();
    // un emplacement bon à côté reste lisible
    raw.set("fotaq:slot10", JSON.stringify(good));
    expect(summarizeSlots(s)[9].empty).toBe(false);
  });

  it("un emplacement qui n'existe pas n'écrit rien et ne lit rien", () => {
    const { raw, slots: s } = slots();
    for (const slot of [0, -1, 11, 1.5, Number.NaN]) {
      expect(s.write(slot, sampleSave(), 1)).toBe(false);
      expect(s.read(slot)).toBeNull();
    }
    expect(raw.data.size).toBe(0);
  });

  it("une écriture refusée par le stockage est signalée, pas levée", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = createSaveSlots({ get: () => null, set: () => false, remove: () => {} });
    expect(full.write(1, sampleSave(), 1)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("les messages du joueur", () => {
    expect(resultMessage("saved", "save")).toBe(copy.saveDone);
    expect(resultMessage("busy", "save")).toBe(copy.saveBusy);
    expect(resultMessage("failed", "save")).toBe(copy.saveFailed);
    expect(resultMessage("loaded", "load")).toBe(copy.loadDone);
    expect(resultMessage("empty", "load")).toBe(copy.loadEmpty);
    expect(resultMessage("failed", "load")).toBe(copy.loadFailed);
    expect(copy.saveDone).toBe("Partie sauvegardée.");
  });
});

describe.skipIf(!hasOriginalFiles)("saveToSlot et loadFromSlot avec le moteur", () => {
  it("sauvegarde au repos, charge dans un moteur neuf ; vide, illisible et refus sont signalés", () => {
    const { raw, slots: s } = slots();
    const w = new Walkthrough({ room: 1, voices: false });
    w.settle();
    expect(saveToSlot(w.engine, s, 3, 1000)).toBe("saved");
    expect(raw.data.has("fotaq:slot03")).toBe(true);
    expect(s.read(3)!.savedAt).toBe(1000);

    const other = new Walkthrough({ room: 20, voices: false });
    other.settle();
    expect(other.room).toBe(20);
    expect(loadFromSlot(other.engine, s, 3)).toBe("loaded");
    other.settle();
    expect(other.room).toBe(1);
    expect(resultMessage("loaded", "load")).toBe(copy.loadDone);

    // Emplacement vide ou illisible : rien n'est chargé.
    expect(loadFromSlot(other.engine, s, 4)).toBe("empty");
    raw.set("fotaq:slot05", "{cassé");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadFromSlot(other.engine, s, 5)).toBe("empty");
    expect(other.room).toBe(1);

    // Une sauvegarde lisible mais d'un autre jeu de données : chargement refusé.
    s.write(6, { ...sampleSave(), objects: [] }, 1);
    expect(loadFromSlot(other.engine, s, 6)).toBe("failed");

    // Le stockage refuse l'écriture, ou le moteur n'a pas la main : pas de sauvegarde.
    expect(saveToSlot(w.engine, createSaveSlots({ get: () => null, set: () => false, remove: () => {} }), 1, 1)).toBe("failed");
    w.engine.run(
      (function* () {
        yield { kind: "ticks", count: 5 } as const;
      })(),
    );
    expect(saveToSlot(w.engine, s, 7, 1)).toBe("busy");
    expect(s.read(7)).toBeNull();
    expect(resultMessage("busy", "save")).toBe(copy.saveBusy);
  });
});
