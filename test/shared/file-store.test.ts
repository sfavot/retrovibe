import { describe, expect, it } from "vitest";
import { GameFiles } from "../../src/data/game-files";
import { FileStore, loadInto } from "../../src/ui/file-store";

const entries = (sizes: Record<string, number>) => Object.entries(sizes).map(([path, size]) => ({ path, size }));
const bytes = (path: string) => new TextEncoder().encode(path);

describe("FileStore", () => {
  it("noms insensibles à la casse, chemin ignoré", () => {
    const store = new FileStore();
    store.set("96.ALG", new Uint8Array([1]));
    expect(store.has("96.alg")).toBe(true);
    expect(store.get("original/96.Alg")).toEqual(new Uint8Array([1]));
    expect(store.get("97.alg")).toBeUndefined();
  });
});

describe("loadInto", () => {
  const files = new GameFiles(entries({ "A.ALG": 100, "B.ALG": 300, "C.ALG": 600 }));

  it("charge tout, compte le progrès en octets, saute ce qui est déjà là", async () => {
    const store = new FileStore();
    store.set("A.ALG", new Uint8Array(1));
    const asked: string[] = [];
    const progress: [number, number][] = [];
    await loadInto(store, files, ["A.ALG", "B.ALG", "C.ALG"], async (path) => (asked.push(path), bytes(path)), (done, total) => progress.push([done, total]));
    expect(asked.sort()).toEqual(["B.ALG", "C.ALG"]);
    expect(store.get("C.ALG")).toEqual(bytes("C.ALG"));
    expect(progress[0]).toEqual([0, 900]);
    expect(progress.at(-1)).toEqual([900, 900]);
  });

  it("une erreur de chargement est relancée", async () => {
    const store = new FileStore();
    await expect(loadInto(store, files, ["A.ALG", "B.ALG"], async (path) => { if (path === "B.ALG") throw new Error("HTTP 404"); return bytes(path); })).rejects.toThrow("HTTP 404");
  });
});
