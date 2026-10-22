import { describe, expect, it } from "vitest";
import { DataFiles } from "../../src/games/lost-in-time/engine/game";
import { HeadlessHost, type VmContext } from "../../src/games/lost-in-time/engine/host";
import { GameSaves, MemoryStore, hasSavedGame, slotKey, PROPS_SIZE, INDEX_SIZE, SHOT_INDEX_SIZE, SHOT_SIZE } from "../../src/games/lost-in-time/engine/saves";
import { Variables } from "../../src/games/lost-in-time/engine/variables";

const VAR_COUNT = 64;

function setup(store = new MemoryStore()) {
  const vars = new Variables(VAR_COUNT);
  const sprites: ({ width: number; height: number; pixels: Uint8Array } | null)[] = new Array(100).fill(null);
  const calls: string[] = [];
  const wanted = new Uint8Array(768);
  const saves = new GameSaves(
    {
      core: { wanted, setFullPalette: () => calls.push("palette"), touch: () => calls.push("touch") },
      draw: { sprites, forceBlit: () => calls.push("blit") },
    },
    store,
  );
  saves.attach({ vars } as unknown as VmContext);
  return { saves, vars, sprites, wanted, calls, store };
}

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("sauvegardes", () => {
  it("distingue sauvegardes, fichiers ignorés et fichiers du jeu", () => {
    const { saves } = setup();
    expect(saves.getSaveMode("cat.inf")).toBe("save");
    expect(saves.getSaveMode("C:\\IMA.INF")).toBe("save");
    expect(saves.getSaveMode("intro.$$$")).toBe("save");
    expect(saves.getSaveMode("BLOC.INF")).toBe("save");
    expect(saves.getSaveMode("prot")).toBe("ignore");
    expect(saves.getSaveMode("config")).toBe("ignore");
    for (const name of ["cat2.inf", "CAT3.INF", "cat4.inf", "intro.stk", "partie1.itk", "partie1.ltk", "part.1", "tome2"]) {
      expect(saves.getSaveMode(name)).toBe("none");
    }
  });

  it("cat.inf : première taille factice, puis aucun fichier", () => {
    const { saves } = setup();
    expect(saves.getSize("cat.inf")).toBe(-1);
    expect(saves.getSize("cat.inf")).toBe(-1);
  });

  it("cat.inf : propriétés globales", () => {
    const { saves, vars } = setup();
    vars.copyFrom(8, text("joker"));
    expect(saves.save("cat.inf", 8, 5, 100)).toBe(true);
    vars.copyFrom(8, new Uint8Array(5));
    expect(saves.load("cat.inf", 8, 5, 100)).toBe(true);
    expect(vars.readString(8, 5)).toBe("joker");
    expect(saves.save("cat.inf", 0, 10, PROPS_SIZE - 4)).toBe(false);
  });
});

describe("sauvegardes avec index complet", () => {
  // 400 variables : de quoi contenir l'index de 1200 octets.
  function bigSetup() {
    const store = new MemoryStore();
    const vars = new Variables(400);
    const sprites: ({ width: number; height: number; pixels: Uint8Array } | null)[] = new Array(100).fill(null);
    sprites[20] = { width: 16, height: 8, pixels: new Uint8Array(128) };
    sprites[21] = { width: 16, height: 8, pixels: new Uint8Array(128) };
    const wanted = new Uint8Array(768);
    const calls: string[] = [];
    const saves = new GameSaves(
      { core: { wanted, setFullPalette: () => calls.push("palette"), touch: () => calls.push("touch") }, draw: { sprites, forceBlit: () => calls.push("blit") } },
      store,
    );
    saves.attach({ vars } as unknown as VmContext);
    return { saves, vars, sprites, wanted, calls, store };
  }
  const SLOT0 = PROPS_SIZE + INDEX_SIZE;
  const SIZE = 400 * 4;

  function saveSlot(ctx: ReturnType<typeof bigSetup>, slot: number, desc: string, marker: number): boolean {
    const { saves, vars, sprites } = ctx;
    // index : la description de l'emplacement dans une mémoire temporaire
    const index = new Uint8Array(INDEX_SIZE);
    index.set(text(desc), slot * 40);
    vars.copyFrom(0, index);
    if (!saves.save("cat.inf", 0, INDEX_SIZE, PROPS_SIZE)) return false;
    vars.copyFrom(0, new Uint8Array(SIZE));
    vars.writeVar32(7, marker);
    sprites[20]!.pixels.fill(marker & 0xff);
    if (!saves.save("ima.inf", 0, -21, SHOT_INDEX_SIZE + slot * SHOT_SIZE)) return false;
    return saves.save("cat.inf", 0, SIZE, SLOT0 + slot * SIZE);
  }

  it("un emplacement n'existe qu'une fois toutes ses parties écrites", () => {
    const ctx = bigSetup();
    const { saves, vars, sprites } = ctx;
    saves.getSize("cat.inf");
    const index = new Uint8Array(INDEX_SIZE);
    index.set(text("Salle 1"), 2 * 40);
    vars.copyFrom(0, index);
    expect(saves.save("cat.inf", 0, INDEX_SIZE, PROPS_SIZE)).toBe(true);
    vars.writeVar32(7, 99);
    expect(saves.save("cat.inf", 0, SIZE, SLOT0 + 2 * SIZE)).toBe(true);
    expect(saves.getSize("cat.inf")).toBe(-1);
    sprites[20]!.pixels.fill(5);
    expect(saves.save("ima.inf", 0, -21, SHOT_INDEX_SIZE + 2 * SHOT_SIZE)).toBe(true);
    expect(saves.getSize("cat.inf")).toBe(3 * SIZE + SLOT0);
    expect(saves.getSize("ima.inf")).toBe(3 * SHOT_SIZE + SHOT_INDEX_SIZE);
  });

  it("un emplacement exige l'index écrit juste avant", () => {
    const { saves } = bigSetup();
    expect(saves.save("cat.inf", 0, SIZE, SLOT0)).toBe(false);
  });

  it("rejette les décalages invalides", () => {
    const { saves } = bigSetup();
    expect(saves.load("cat.inf", 0, SIZE, SLOT0 + 5)).toBe(false);
    expect(saves.load("cat.inf", 4, SIZE, SLOT0)).toBe(false);
    expect(saves.load("cat.inf", 0, SIZE, SLOT0 + 30 * SIZE)).toBe(false);
    expect(saves.load("cat.inf", 0, SIZE, 700)).toBe(false);
    expect(saves.load("cat.inf", 0, SIZE, SLOT0)).toBe(false); // vide
  });

  it("recharge variables, index et capture", () => {
    const ctx = bigSetup();
    const { store } = ctx;
    expect(saveSlot(ctx, 1, "Premier", 0x1234)).toBe(true);
    expect(saveSlot(ctx, 4, "Quatrieme", 0x42)).toBe(true);

    // nouvelle session : même stockage
    const again = bigSetup();
    const fresh = new GameSaves(
      { core: { wanted: again.wanted, setFullPalette() {}, touch() {} }, draw: { sprites: again.sprites, forceBlit() {} } },
      store,
    );
    fresh.attach({ vars: again.vars } as unknown as VmContext);

    expect(fresh.getSize("cat.inf")).toBe(-1); // faux fichier vide de la première question
    expect(fresh.getSize("cat.inf")).toBe(5 * SIZE + SLOT0);

    expect(fresh.load("cat.inf", 0, INDEX_SIZE, PROPS_SIZE)).toBe(true);
    expect(again.vars.readString(1 * 40)).toBe("Premier");
    expect(again.vars.readString(4 * 40)).toBe("Quatrieme");
    expect(again.vars.readOff8(2 * 40)).toBe(0);

    expect(fresh.load("cat.inf", 0, SIZE, SLOT0 + 1 * SIZE)).toBe(true);
    expect(again.vars.readVar32(7)).toBe(0x1234);

    // index des captures
    expect(fresh.load("ima.inf", 0, SHOT_INDEX_SIZE, 0)).toBe(true);
    const flags = [...again.vars.bytes.subarray(0, 31)];
    expect(flags[1]).toBe(1);
    expect(flags[4]).toBe(1);
    expect(flags[0]).toBe(0);
    expect(flags[2]).toBe(0);

    // capture de l'emplacement 4 dans le sprite 21 : rechargée puis recopiée à l'écran
    again.sprites[21]!.pixels.fill(0);
    expect(fresh.load("ima.inf", 0, -22, SHOT_INDEX_SIZE + 4 * SHOT_SIZE)).toBe(true);
    expect(again.sprites[21]!.pixels[0]).toBe(0x42);
  });

  it("sprite temporaire : copie du sprite et de la palette, rien tant qu'il n'est pas écrit", () => {
    const { saves, sprites, wanted, calls } = bigSetup();
    expect(saves.getSize("intro.$$$")).toBe(-1);
    expect(saves.load("intro.$$$", 0, -22, 0)).toBe(false);
    sprites[21]!.pixels.fill(9);
    wanted.fill(33);
    expect(saves.save("intro.$$$", 0, -1022, 0)).toBe(true);
    expect(saves.getSize("intro.$$$")).toBeGreaterThan(0);
    sprites[21]!.pixels.fill(0);
    wanted.fill(0);
    expect(saves.load("intro.$$$", 0, -1022, 0)).toBe(true);
    expect(sprites[21]!.pixels[5]).toBe(9);
    expect(wanted[100]).toBe(33);
    expect(calls).toContain("palette");
    expect(calls).toContain("blit");
    expect(saves.load("intro.$$$", 0, 0, 0)).toBe(true);
    expect(saves.save("intro.$$$", 0, -(100 + 1), 0)).toBe(false); // sprite inexistant
  });

  it("notes : relues telles qu'écrites, taille 2560", () => {
    const { saves, vars } = bigSetup();
    expect(saves.getSize("bloc.inf")).toBe(-1);
    expect(saves.load("bloc.inf", 0, 10, 0)).toBe(false);
    vars.copyFrom(0, text("Indice 1"));
    expect(saves.save("bloc.inf", 0, 9, 0)).toBe(true);
    expect(saves.getSize("bloc.inf")).toBe(2560);
    vars.copyFrom(100, text("Indice 2"));
    expect(saves.save("bloc.inf", 100, 9, 20)).toBe(true);
    vars.copyFrom(0, new Uint8Array(200));
    expect(saves.load("bloc.inf", 0, 9, 0)).toBe(true);
    expect(vars.readString(0)).toBe("Indice 1");
    expect(saves.load("bloc.inf", 0, 9, 20)).toBe(true);
    expect(vars.readString(0)).toBe("Indice 2");
    expect(saves.save("bloc.inf", 0, 10, 2555)).toBe(false);
  });
});

describe("checkData sur les fichiers du jeu", () => {
  it("DataFiles.sizeOf : taille d'un fichier présent, -1 pour un absent (PART.1, TOME1…)", async () => {
    const host = new HeadlessHost({ readFile: (name) => (name === "CAT2.INF" ? new Uint8Array(21) : undefined) });
    const files = new DataFiles(host);
    expect(await files.sizeOf("CAT2.INF")).toBe(21);
    for (const name of ["PART.1", "PART.2", "TOME1", "TOME2"]) expect(await files.sizeOf(name)).toBe(-1);
  });
});

describe("hasSavedGame", () => {
  it("détecte un emplacement rempli", () => {
    const store = new MemoryStore();
    expect(hasSavedGame(store)).toBe(false);
    store.set("bloc", "x"); // les notes ne comptent pas
    expect(hasSavedGame(store)).toBe(false);
    store.set(slotKey(29), "{}");
    expect(hasSavedGame(store)).toBe(true);
  });

  it("traite une erreur de lecture comme « aucune sauvegarde »", () => {
    const broken = {
      get: () => {
        throw new Error("bloqué");
      },
      set: () => false,
      remove: () => {},
    };
    expect(hasSavedGame(broken)).toBe(false);
  });
});
