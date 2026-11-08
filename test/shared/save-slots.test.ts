import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveSlots, slotKey } from "../../src/engine/save-slots";
import { MemoryStorage, prefixedStorage } from "../../src/engine/storage";

interface Save {
  version: 1;
  level: number;
}

const parse = (value: unknown): Save | null => {
  const v = value as { version?: unknown; level?: unknown } | null;
  return v && v.version === 1 && typeof v.level === "number" ? (v as Save) : null;
};
const describe_ = ({ save, savedAt }: { save: Save; savedAt: number }): string => `Niveau ${save.level} (${savedAt})`;
const empty = (slot: number): string => `Emplacement ${slot}`;

function slots(count = 4) {
  const raw = new MemoryStorage();
  return { raw, slots: new SaveSlots<Save>(prefixedStorage(raw, "jeu:"), { count, parse, name: "Jeu" }) };
}

afterEach(() => vi.restoreAllMocks());

describe("SaveSlots", () => {
  it("clés slotNN sous le préfixe du stockage ; un emplacement écrit se relit à l'identique", () => {
    const { raw, slots: s } = slots();
    expect(s.count).toBe(4);
    expect(slotKey(3)).toBe("slot03");
    expect(s.write(3, { version: 1, level: 7 }, 1234)).toBe(true);
    expect([...raw.data.keys()]).toEqual(["jeu:slot03"]);
    expect(JSON.parse(raw.data.get("jeu:slot03")!)).toEqual({ savedAt: 1234, save: { version: 1, level: 7 } });
    expect(s.read(3)).toEqual({ savedAt: 1234, save: { version: 1, level: 7 } });
  });

  it("numéros hors des emplacements : lecture vide, écriture refusée, effacement sans effet", () => {
    const { raw, slots: s } = slots();
    for (const slot of [0, 5, 1.5, -1, NaN]) {
      expect(s.read(slot)).toBeNull();
      expect(s.write(slot, { version: 1, level: 1 }, 1)).toBe(false);
      s.clear(slot);
    }
    expect(raw.data.size).toBe(0);
  });

  it("valeur illisible (JSON cassé, autre version, date manquante) = emplacement vide, avertissement, jamais d'exception", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { raw, slots: s } = slots();
    raw.data.set("jeu:slot01", "{pas du json");
    raw.data.set("jeu:slot02", JSON.stringify({ savedAt: 1, save: { version: 2, level: 1 } }));
    raw.data.set("jeu:slot03", JSON.stringify({ save: { version: 1, level: 1 } }));
    raw.data.set("jeu:slot04", "null");
    for (const slot of [1, 2, 3, 4]) expect(s.read(slot)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0][0]).toMatch(/^Jeu : /);
  });

  it("latest rend la sauvegarde la plus récente, null sans sauvegarde lisible", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { raw, slots: s } = slots();
    expect(s.latest()).toBeNull();
    s.write(1, { version: 1, level: 1 }, 100);
    s.write(3, { version: 1, level: 3 }, 300);
    s.write(2, { version: 1, level: 2 }, 200);
    raw.data.set("jeu:slot04", "illisible");
    expect(s.latest()).toEqual({ savedAt: 300, save: { version: 1, level: 3 } });
    expect(warn).toHaveBeenCalled();
  });

  it("clear vide un emplacement", () => {
    const { raw, slots: s } = slots();
    s.write(2, { version: 1, level: 1 }, 1);
    s.clear(2);
    expect(s.read(2)).toBeNull();
    expect(raw.data.size).toBe(0);
  });

  it("une écriture refusée par le stockage est signalée, pas levée", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = new SaveSlots<Save>({ get: () => null, set: () => false, remove: () => {} }, { count: 2, parse, name: "Jeu" });
    expect(full.write(1, { version: 1, level: 1 }, 1)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("summaries : count emplacements dans l'ordre, describe pour les pleins, emptyLabel pour les vides", () => {
    const { slots: s } = slots(3);
    s.write(2, { version: 1, level: 9 }, 50);
    expect(s.summaries(describe_, empty)).toEqual([
      { slot: 1, empty: true, description: "Emplacement 1", savedAt: null },
      { slot: 2, empty: false, description: "Niveau 9 (50)", savedAt: 50 },
      { slot: 3, empty: true, description: "Emplacement 3", savedAt: null },
    ]);
  });
});
