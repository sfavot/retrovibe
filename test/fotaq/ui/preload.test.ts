import { describe, expect, it } from "vitest";
import { FileStore } from "../../../src/ui/file-store";
import { GameFiles } from "../../../src/games/fotaq/data/files";
import { RoomFiles, baseFiles, neighbourRooms } from "../../../src/games/fotaq/ui/preload";
import { gameData } from "../engine/test-host";
import { hasOriginalFiles, readManifest } from "../helpers";

const entries = (sizes: Record<string, number>) => Object.entries(sizes).map(([path, size]) => ({ path, size }));
const bytes = (path: string) => new TextEncoder().encode(path);

describe("baseFiles", () => {
  it("données, banques, dialogues, cinématiques, musique et panneau ; ni décors, ni voix, ni lumière, ni jaquette", () => {
    const files = new GameFiles(
      entries({
        "QUEEN.JAS": 1, "QUEEN2.JAS": 1, "OBJECTS.BBK": 1, "AMAZON.ACT": 1, "FACES.SAM": 1, "AND1.DOG": 1, "C1.CUT": 1, "CREDIT1.CRD": 1, "AQBANK.MUS": 1, "PANEL.PCX": 1,
        "B1.PCX": 1, "B1.MSK": 1, "B1.LUM": 1, "AQ.RL": 1, "README-FOTAQ.txt": 1, "COVER.png": 1, "voices/020001P2.mp3": 1,
      }),
    );
    expect(baseFiles(files).sort()).toEqual(
      ["AMAZON.ACT", "AND1.DOG", "AQBANK.MUS", "C1.CUT", "CREDIT1.CRD", "FACES.SAM", "OBJECTS.BBK", "PANEL.PCX", "QUEEN.JAS", "QUEEN2.JAS"],
    );
  });

  it.skipIf(!hasOriginalFiles)("sur les vrais fichiers : 13 à 14 Mo au départ, aucun décor de pièce", () => {
    const files = new GameFiles(readManifest());
    const base = baseFiles(files);
    const total = base.reduce((sum, path) => sum + (files.size(path) ?? 0), 0);
    expect(total).toBeGreaterThan(12_000_000);
    expect(total).toBeLessThan(15_000_000);
    expect(base.filter((path) => /\.(PCX|MSK|LUM)$/i.test(path))).toEqual(["PANEL.PCX"]);
  });
});

describe.skipIf(!hasOriginalFiles)("neighbourRooms", () => {
  it("les pièces où mènent les sorties de la pièce", () => {
    const data = gameData();
    for (let room = 1; room <= data.jas.roomCount; room++) {
      const next = neighbourRooms(data, room);
      expect(next).not.toContain(room);
      for (const target of next) expect(target).toBeGreaterThan(0);
    }
    // Un hall d'hôtel (73) a des sorties ; une pièce d'écran (96, l'avion) n'en a pas.
    expect(neighbourRooms(data, 73).length).toBeGreaterThan(0);
  });
});

describe("RoomFiles", () => {
  const files = new GameFiles(entries({ "B1.PCX": 100, "B1.MSK": 50, "B1.LUM": 5, "B2.PCX": 200 }));

  it("ready charge ce qui manque et répond non jusqu'à l'arrivée ; un fichier hors du manifeste n'attend rien", async () => {
    const store = new FileStore();
    const asked: string[] = [];
    const rooms = new RoomFiles(store, files, async (path) => (asked.push(path), bytes(path)));
    expect(rooms.ready(["B1.PCX", "B1.MSK"])).toBe(false);
    expect(rooms.ready(["B1.PCX", "B1.MSK"])).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rooms.ready(["B1.PCX", "B1.MSK"])).toBe(true);
    expect(asked.sort()).toEqual(["B1.MSK", "B1.PCX"]);
    expect(rooms.ready(["B1.PCX", "ABSENT.LUM"])).toBe(true);
    expect(rooms.loading).toBe(false);
  });

  it("prefetch charge en fond sans doublon ; un échec est gardé et le chargement peut être redemandé", async () => {
    const store = new FileStore();
    let fail = true;
    const asked: string[] = [];
    const rooms = new RoomFiles(store, files, async (path) => {
      asked.push(path);
      if (fail) throw new Error("réseau");
      return bytes(path);
    });
    rooms.prefetch(["B2.PCX"]);
    rooms.prefetch(["B2.PCX"]);
    expect(rooms.loading).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual(["B2.PCX"]);
    expect((rooms.failure as Error).message).toBe("réseau");
    fail = false;
    expect(rooms.ready(["B2.PCX"])).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rooms.ready(["B2.PCX"])).toBe(true);
  });
});
