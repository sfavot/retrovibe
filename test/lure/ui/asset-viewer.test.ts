import { describe, expect, it, vi } from "vitest";
import { fetchGameFiles } from "../../../src/data/game-files";

describe("visionneuse de Lure : manifeste", () => {
  it("fetchGameFiles lit files.json sous /lure", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ path: "LURE-FR.DAT", size: 9 }, { path: "DISK1.VGA", size: 5 }])));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const files = await fetchGameFiles("/lure");
      expect(fetchMock).toHaveBeenCalledWith("/lure/files.json");
      expect(files.list()).toEqual(["DISK1.VGA", "LURE-FR.DAT"]);
      expect(files.has("disk1.vga")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("un manifeste absent est une erreur lisible", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    try {
      await expect(fetchGameFiles("/lure")).rejects.toThrow(/files\.json : HTTP 404/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
