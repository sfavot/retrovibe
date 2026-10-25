import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage, prefixedStorage } from "../../src/engine/storage";
import { localStorageStore } from "../../src/ui/local-storage";

describe("MemoryStorage", () => {
  it("lit, écrit et efface", () => {
    const s = new MemoryStorage();
    expect(s.get("a")).toBeNull();
    expect(s.set("a", "1")).toBe(true);
    expect(s.get("a")).toBe("1");
    s.remove("a");
    expect(s.get("a")).toBeNull();
  });
});

describe("prefixedStorage", () => {
  it("préfixe toutes les clés dans le stockage sous-jacent", () => {
    const base = new MemoryStorage();
    const s = prefixedStorage(base, "jeu:");
    s.set("k", "v");
    expect(base.data.get("jeu:k")).toBe("v");
    expect(s.get("k")).toBe("v");
    expect(base.get("k")).toBeNull();
    s.remove("k");
    expect(base.data.size).toBe(0);
  });
});

describe("localStorageStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("délègue à localStorage", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    const s = localStorageStore();
    expect(s.set("a", "1")).toBe(true);
    expect(s.get("a")).toBe("1");
    s.remove("a");
    expect(s.get("a")).toBeNull();
  });

  it("avale les erreurs (stockage absent, plein ou bloqué)", () => {
    const boom = () => {
      throw new Error("bloqué");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    const s = localStorageStore();
    expect(s.get("a")).toBeNull();
    expect(s.set("a", "1")).toBe(false);
    expect(() => s.remove("a")).not.toThrow();
  });
});
