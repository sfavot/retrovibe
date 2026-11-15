import { describe, expect, it } from "vitest";
import { Variables } from "../../../src/engine/coktel/variables";
import type { VmContext } from "../../../src/engine/coktel/host";
import { MemoryStorage, type HostStorage } from "../../../src/engine/storage";
import {
  INDEX_SIZE,
  NOTES_SIZE,
  SAVE_FORMAT_VERSION,
  SLOT_COUNT,
  WeenSaves,
  slotKey,
  type SaveGraphics,
} from "../../../src/games/ween/engine/saves";

/** SaveLoad_v2 de Ween sur des variables factices : 3 885 variables = 15 540 octets, comme le jeu. */
const VAR_COUNT = 3885;
const VAR_SIZE = VAR_COUNT * 4;
const slotOffset = (slot: number) => INDEX_SIZE + slot * VAR_SIZE;

function setup(store: HostStorage = new MemoryStorage(), gfx: SaveGraphics | null = null) {
  const vars = new Variables(VAR_COUNT);
  const saves = new WeenSaves(gfx, store);
  saves.attach({ vars } as unknown as VmContext);
  return { vars, saves, store };
}

function fill(vars: Variables, seed: number) {
  for (let i = 0; i < vars.size; i++) vars.bytes[i] = (i * 7 + seed) & 0xff;
}

/** Ce que fait le menu : index (600 octets) à l'offset 0 depuis la variable `at`, puis l'emplacement (taille nulle). */
function saveSlot(s: ReturnType<typeof setup>, slot: number, name: string, at = 1000 * 4) {
  const index = new Uint8Array(INDEX_SIZE);
  index.set(new TextEncoder().encode(name), slot * 40);
  const keep = s.vars.bytes.slice(at, at + INDEX_SIZE);
  s.vars.bytes.set(index, at);
  expect(s.saves.save("CAT.INF", at, INDEX_SIZE, 0)).toBe(true);
  s.vars.bytes.set(keep, at); // l'index fait partie des variables sauvegardées : on restitue les octets d'origine
  return s.saves.save("CAT.INF", 0, 0, slotOffset(slot));
}

function readIndex(s: ReturnType<typeof setup>): string[] {
  expect(s.saves.load("cat.inf", 0x44, INDEX_SIZE, 0)).toBe(true);
  const raw = s.vars.bytes.slice(0x44, 0x44 + INDEX_SIZE);
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const part = raw.subarray(i * 40, (i + 1) * 40);
    const end = part.indexOf(0);
    return new TextDecoder().decode(end < 0 ? part : part.subarray(0, end));
  });
}

describe("SaveLoad_v2 de Ween : fichiers et tailles", () => {
  it("reconnaît cat.inf, cat.cat, save.inf, bloc.inf sans casse ni chemin, rien d'autre", () => {
    const { saves } = setup();
    for (const f of ["cat.inf", "CAT.CAT", "c:\\ween\\Save.Inf", "x/BLOC.INF"]) expect(saves.getSaveMode(f)).toBe("save");
    for (const f of ["intro.stk", "cat.txt", "menu.cat", "OBJET1.CAT"]) expect(saves.getSaveMode(f)).toBe("none");
  });

  it("aucun emplacement : taille -1 ; sinon (dernier emplacement + 1) × taille + 600", () => {
    const s = setup();
    fill(s.vars, 1);
    expect(s.saves.getSize("cat.inf")).toBe(-1);
    expect(saveSlot(s, 3, "quatre")).toBe(true);
    expect(s.saves.getSize("cat.inf")).toBe(4 * VAR_SIZE + INDEX_SIZE);
    expect(s.saves.getSize("CAT.CAT")).toBe(4 * VAR_SIZE + INDEX_SIZE);
    expect(saveSlot(s, 0, "un")).toBe(true);
    expect(s.saves.getSize("cat.inf")).toBe(4 * VAR_SIZE + INDEX_SIZE); // le plus grand compte
  });

  it("sans variables allouées : tailles -1, lectures et écritures refusées", () => {
    const saves = new WeenSaves(null, new MemoryStorage());
    expect(saves.getSize("cat.inf")).toBe(-1);
    expect(saves.load("cat.inf", 0, INDEX_SIZE, 0)).toBe(false);
    expect(saves.save("cat.inf", 0, INDEX_SIZE, 0)).toBe(false);
    expect(saves.save("bloc.inf", 0, 10, 0)).toBe(false);
  });
});

describe("SaveLoad_v2 de Ween : cat.inf, lectures et écritures partielles", () => {
  it("aller-retour d'un emplacement : variables identiques, description dans l'index", () => {
    const s = setup();
    fill(s.vars, 5);
    const snapshot = s.vars.bytes.slice();
    expect(saveSlot(s, 7, "Salle du puits")).toBe(true);
    fill(s.vars, 99);
    expect(s.saves.load("cat.inf", 0, 0, slotOffset(7))).toBe(true);
    expect(s.vars.bytes).toEqual(snapshot);
    expect(readIndex(s)[7]).toBe("Salle du puits");
  });

  it("la lecture explicite (variable 0, taille = varSize) équivaut à la taille nulle", () => {
    const s = setup();
    fill(s.vars, 8);
    const snapshot = s.vars.bytes.slice();
    saveSlot(s, 1, "a");
    fill(s.vars, 3);
    expect(s.saves.load("cat.inf", 0, VAR_SIZE, slotOffset(1))).toBe(true);
    expect(s.vars.bytes).toEqual(snapshot);
  });

  it("index : 15 × 40 octets, emplacements absents à zéro, indépendant de la variable de destination", () => {
    const s = setup();
    fill(s.vars, 2);
    saveSlot(s, 0, "zéro");
    saveSlot(s, 14, "quatorze");
    const names = readIndex(s);
    expect(names[14]).toBe("quatorze");
    expect(names.slice(1, 14).every((n) => n === "")).toBe(true);
    // Lecture en un autre endroit
    expect(s.saves.load("cat.inf", 5000, INDEX_SIZE, 0)).toBe(true);
    expect(s.vars.bytes.subarray(5000, 5040)).toEqual(s.vars.bytes.subarray(0x44, 0x44 + 40));
  });

  it("écritures refusées : taille d'index fausse, décalage hors emplacement, reste non nul, variable non nulle", () => {
    const s = setup();
    fill(s.vars, 4);
    expect(s.saves.save("cat.inf", 0, 599, 0)).toBe(false);
    expect(s.saves.save("cat.inf", 0, INDEX_SIZE, 0)).toBe(true);
    expect(s.saves.save("cat.inf", 0, 0, INDEX_SIZE + 1)).toBe(false); // reste non nul
    expect(s.saves.save("cat.inf", 0, 0, 300)).toBe(false); // avant les emplacements
    expect(s.saves.save("cat.inf", 0, 0, -1)).toBe(false);
    expect(s.saves.save("cat.inf", 4, 0, slotOffset(0))).toBe(true); // dataVar ramené à 0 par la taille nulle
    expect(s.saves.save("cat.inf", 4, 4, slotOffset(0))).toBe(false); // taille ≠ varSize
    expect(s.saves.save("cat.inf", 4, VAR_SIZE, slotOffset(0))).toBe(false); // variable ≠ 0
    expect(s.saves.save("cat.inf", 0, 0, slotOffset(SLOT_COUNT))).toBe(false); // emplacement 15
    expect(s.saves.getSize("cat.inf")).toBe(VAR_SIZE + INDEX_SIZE);
  });

  it("lectures refusées : taille d'index fausse, emplacement vide, reste non nul, variable non nulle", () => {
    const s = setup();
    fill(s.vars, 4);
    saveSlot(s, 2, "x");
    expect(s.saves.load("cat.inf", 0x44, 599, 0)).toBe(false);
    expect(s.saves.load("cat.inf", 0, 0, slotOffset(3))).toBe(false); // vide
    expect(s.saves.load("cat.inf", 0, 0, slotOffset(2) + 4)).toBe(false);
    expect(s.saves.load("cat.inf", 4, VAR_SIZE, slotOffset(2))).toBe(false);
    expect(s.saves.load("cat.inf", 0, 0, slotOffset(SLOT_COUNT))).toBe(false);
    expect(s.saves.load("cat.inf", 0, 0, 100)).toBe(false);
  });

  it("l'emplacement exige l'index écrit juste avant, consommé par l'écriture", () => {
    const s = setup();
    fill(s.vars, 6);
    expect(s.saves.save("cat.inf", 0, 0, slotOffset(0))).toBe(false); // pas d'index
    expect(saveSlot(s, 0, "a")).toBe(true);
    expect(s.saves.save("cat.inf", 0, 0, slotOffset(1))).toBe(false); // index consommé
    expect(readIndex(s)[1]).toBe("");
  });

  it("l'index mémorisé est celui de l'écriture, la description est celle de l'emplacement visé", () => {
    const s = setup();
    fill(s.vars, 6);
    expect(saveSlot(s, 5, "cinq")).toBe(true);
    expect(saveSlot(s, 9, "neuf")).toBe(true);
    const names = readIndex(s);
    expect(names[5]).toBe("cinq");
    expect(names[9]).toBe("neuf");
  });

  it("emplacements pleins : réécrire un emplacement remplace son contenu, les 15 coexistent", () => {
    const s = setup();
    for (let k = 0; k < SLOT_COUNT; k++) {
      fill(s.vars, k + 1);
      expect(saveSlot(s, k, `partie ${k}`)).toBe(true);
    }
    expect(readIndex(s)).toEqual(Array.from({ length: SLOT_COUNT }, (_, k) => `partie ${k}`));
    fill(s.vars, 200);
    const snapshot = s.vars.bytes.slice();
    expect(saveSlot(s, 4, "remplacée")).toBe(true);
    for (let k = 0; k < SLOT_COUNT; k++) {
      fill(s.vars, 0);
      expect(s.saves.load("cat.inf", 0, 0, slotOffset(k))).toBe(true);
      if (k === 4) expect(s.vars.bytes).toEqual(snapshot);
      else expect(s.vars.bytes[0]).toBe((0 + (k + 1)) & 0xff); // i = 0 : seed
    }
    expect(readIndex(s)[4]).toBe("remplacée");
    expect(s.saves.getSize("cat.inf")).toBe(SLOT_COUNT * VAR_SIZE + INDEX_SIZE);
  });

  it("un emplacement écrit avec une autre taille de variables n'apparaît pas et ne se charge pas", () => {
    const store = new MemoryStorage();
    const s = setup(store);
    fill(s.vars, 1);
    saveSlot(s, 0, "ok");
    const json = JSON.parse(store.get(slotKey(0))!);
    json.varSize = VAR_SIZE - 4;
    store.set(slotKey(0), JSON.stringify(json));
    expect(readIndex(s)[0]).toBe("");
    expect(s.saves.load("cat.inf", 0, 0, slotOffset(0))).toBe(false);
  });
});

describe("SaveLoad_v2 de Ween : format versionné", () => {
  it("écrit {v: 1} sous le préfixe de l'appelant, un emplacement par clé", () => {
    const s = setup();
    fill(s.vars, 1);
    saveSlot(s, 2, "x");
    const stored = JSON.parse((s.store as MemoryStorage).data.get(slotKey(2))!);
    expect(stored.v).toBe(SAVE_FORMAT_VERSION);
    expect(slotKey(2)).toBe("cat.s02");
  });

  it("version inconnue, JSON invalide, base64 invalide, taille incohérente : emplacement absent, sans exception", () => {
    const store = new MemoryStorage();
    const s = setup(store);
    fill(s.vars, 1);
    saveSlot(s, 0, "bon");
    const good = store.get(slotKey(0))!;
    const variants: string[] = [
      JSON.stringify({ ...JSON.parse(good), v: 2 }),
      JSON.stringify({ ...JSON.parse(good), v: undefined }),
      "pas du json",
      "null",
      "42",
      JSON.stringify({ ...JSON.parse(good), vars: "***" }),
      JSON.stringify({ ...JSON.parse(good), vars: "AAAA" }),
      JSON.stringify({ ...JSON.parse(good), desc: "AAAA" }),
      JSON.stringify({ v: 1 }),
    ];
    for (const bad of variants) {
      store.set(slotKey(0), bad);
      expect(s.saves.getSize("cat.inf")).toBe(-1);
      expect(readIndex(s)[0]).toBe("");
      expect(s.saves.load("cat.inf", 0, 0, slotOffset(0))).toBe(false);
    }
    // Un emplacement valide voisin reste lisible
    store.set(slotKey(0), good);
    expect(s.saves.load("cat.inf", 0, 0, slotOffset(0))).toBe(true);
  });

  it("bloc-notes : version inconnue ou taille incohérente = absent", () => {
    const store = new MemoryStorage();
    const s = setup(store);
    expect(s.saves.save("bloc.inf", 0, 10, 0)).toBe(true);
    const good = store.get("bloc")!;
    for (const bad of [JSON.stringify({ ...JSON.parse(good), v: 7 }), JSON.stringify({ v: 1, data: "AAAA" }), "{", "[]"]) {
      store.set("bloc", bad);
      expect(s.saves.getSize("bloc.inf")).toBe(-1);
      expect(s.saves.load("bloc.inf", 0, 10, 0)).toBe(false);
    }
  });
});

describe("SaveLoad_v2 de Ween : bloc-notes (NotesHandler 600)", () => {
  it("absent au départ : taille -1, lecture refusée", () => {
    const s = setup();
    expect(s.saves.getSize("bloc.inf")).toBe(-1);
    expect(s.saves.load("bloc.inf", 0, NOTES_SIZE, 0)).toBe(false);
  });

  it("écriture entière puis lecture : 600 octets, aller-retour exact, partielle possible", () => {
    const s = setup();
    for (let i = 0; i < NOTES_SIZE; i++) s.vars.bytes[200 + i] = (i * 3) & 0xff;
    const notes = s.vars.bytes.slice(200, 200 + NOTES_SIZE);
    expect(s.saves.save("bloc.inf", 200, NOTES_SIZE, 0)).toBe(true);
    expect(s.saves.getSize("bloc.inf")).toBe(NOTES_SIZE);
    s.vars.bytes.fill(0);
    expect(s.saves.load("bloc.inf", 1000, NOTES_SIZE, 0)).toBe(true);
    expect(s.vars.bytes.subarray(1000, 1600)).toEqual(notes);
    expect(s.saves.load("bloc.inf", 2000, 40, 80)).toBe(true);
    expect(s.vars.bytes.subarray(2000, 2040)).toEqual(notes.subarray(80, 120));
  });

  it("écriture partielle : le fichier est réécrit en entier, seul le segment demandé est renseigné", () => {
    const s = setup();
    s.vars.bytes.fill(0xaa, 0, NOTES_SIZE);
    s.saves.save("bloc.inf", 0, NOTES_SIZE, 0);
    s.vars.bytes.fill(0xbb, 0, 40);
    expect(s.saves.save("bloc.inf", 0, 40, 40)).toBe(true);
    s.vars.bytes.fill(0);
    expect(s.saves.load("bloc.inf", 0, NOTES_SIZE, 0)).toBe(true);
    expect(s.vars.bytes[0]).toBe(0);
    expect(s.vars.bytes[40]).toBe(0xbb);
    expect(s.vars.bytes[80]).toBe(0);
  });

  it("refus : paramètres négatifs, dépassement des 600 octets", () => {
    const s = setup();
    expect(s.saves.save("bloc.inf", -1, 10, 0)).toBe(false);
    expect(s.saves.save("bloc.inf", 0, -1, 0)).toBe(false);
    expect(s.saves.save("bloc.inf", 0, 10, -1)).toBe(false);
    expect(s.saves.save("bloc.inf", 0, 10, 595)).toBe(false);
    expect(s.saves.save("bloc.inf", 0, NOTES_SIZE, 0)).toBe(true);
    expect(s.saves.load("bloc.inf", 0, 10, 595)).toBe(false);
    expect(s.saves.load("bloc.inf", -1, 10, 0)).toBe(false);
  });

  it("conservé entre deux parties (nouveau gestionnaire, même stockage)", () => {
    const store = new MemoryStorage();
    const a = setup(store);
    a.vars.bytes.set(new TextEncoder().encode("rendez-vous à minuit"), 300);
    expect(a.saves.save("bloc.inf", 300, NOTES_SIZE, 0)).toBe(true);
    const b = setup(store);
    expect(b.saves.getSize("bloc.inf")).toBe(NOTES_SIZE);
    expect(b.saves.load("bloc.inf", 0, NOTES_SIZE, 0)).toBe(true);
    expect(new TextDecoder().decode(b.vars.bytes.subarray(0, 21))).toBe("rendez-vous à minuit");
  });

  it("indépendant des emplacements de cat.inf (clés distinctes)", () => {
    const s = setup();
    fill(s.vars, 9);
    s.saves.save("bloc.inf", 0, NOTES_SIZE, 0);
    expect(s.saves.getSize("cat.inf")).toBe(-1);
    saveSlot(s, 0, "a");
    expect(s.saves.getSize("bloc.inf")).toBe(NOTES_SIZE);
  });
});

describe("SaveLoad_v2 de Ween : stockage indisponible", () => {
  const broken = (mode: "refuse" | "throw"): HostStorage => ({
    get: () => {
      if (mode === "throw") throw new Error("SecurityError");
      return null;
    },
    set: () => {
      if (mode === "throw") throw new Error("QuotaExceededError");
      return false;
    },
    remove: () => {},
  });

  for (const mode of ["refuse", "throw"] as const) {
    it(`stockage qui ${mode === "refuse" ? "refuse les écritures" : "lève des exceptions"} : pas de plantage, échecs propres`, () => {
      const s = setup(broken(mode));
      fill(s.vars, 3);
      expect(s.saves.getSize("cat.inf")).toBe(-1);
      expect(s.saves.getSize("bloc.inf")).toBe(-1);
      expect(s.saves.load("cat.inf", 0x44, INDEX_SIZE, 0)).toBe(true); // index vide
      expect(s.vars.bytes.subarray(0x44, 0x44 + INDEX_SIZE).every((b) => b === 0)).toBe(true);
      expect(saveSlot(s, 0, "x")).toBe(false);
      expect(s.saves.save("bloc.inf", 0, NOTES_SIZE, 0)).toBe(false);
      expect(s.saves.load("bloc.inf", 0, NOTES_SIZE, 0)).toBe(false);
      expect(s.saves.load("cat.inf", 0, 0, slotOffset(0))).toBe(false);
    });
  }
});

describe("SaveLoad_v2 de Ween : save.inf (sprite temporaire, en mémoire)", () => {
  const sprite = (w: number, h: number) => ({ width: w, height: h, pixels: new Uint8Array(w * h) });

  function withGfx() {
    const sprites = Array.from({ length: 100 }, () => null) as ({ width: number; height: number; pixels: Uint8Array } | null)[];
    sprites[20] = sprite(320, 200);
    sprites[21] = sprite(320, 200);
    sprites[22] = sprite(16, 16);
    const calls: string[] = [];
    const wanted = new Uint8Array(768);
    const gfx: SaveGraphics = {
      core: { wanted, setFullPalette: () => calls.push("palette"), touch: () => calls.push("touch") },
      draw: { sprites, forceBlit: () => calls.push("blit") },
    };
    return { gfx, sprites, calls, wanted };
  }

  it("absent tant qu'aucun sprite n'a été écrit : taille -1, lecture refusée (sauf taille nulle)", () => {
    const s = setup(new MemoryStorage(), withGfx().gfx);
    expect(s.saves.getSize("save.inf")).toBe(-1);
    expect(s.saves.load("save.inf", 0, -21, 0)).toBe(false);
    expect(s.saves.load("save.inf", 0, 0, 0)).toBe(true);
    expect(s.saves.save("save.inf", 0, 0, 0)).toBe(true);
    expect(s.saves.getSize("save.inf")).toBe(-1);
  });

  it("sans affichage branché : toujours vu absent, écriture refusée", () => {
    const s = setup();
    expect(s.saves.getSize("save.inf")).toBe(-1);
    expect(s.saves.save("save.inf", 0, -22, 0)).toBe(false);
    expect(s.saves.load("save.inf", 0, -22, 0)).toBe(false);
  });

  it("sauvegarde le sprite désigné par la taille négative, le restitue (avec palette sous -1000), réaffiche", () => {
    const g = withGfx();
    const s = setup(new MemoryStorage(), g.gfx);
    g.sprites[20]!.pixels.fill(7);
    g.wanted.fill(33);
    expect(s.saves.save("save.inf", 0, -21 - 1000, 0)).toBe(true); // sprite 20 avec palette
    expect(s.saves.getSize("save.inf")).toBe(4 + 4 + 1 + 64000 + 768);
    g.sprites[21]!.pixels.fill(0);
    g.wanted.fill(0);
    expect(s.saves.load("save.inf", 0, -22 - 1000, 0)).toBe(true); // vers le sprite 21
    expect(g.sprites[21]!.pixels.every((p) => p === 7)).toBe(true);
    expect(g.wanted.every((p) => p === 33)).toBe(true);
    expect(g.calls).toEqual(["palette", "blit"]);
    g.calls.length = 0;
    expect(s.saves.load("save.inf", 0, -21, 0)).toBe(true); // sans palette, vers l'écran
    expect(g.calls).toEqual(["touch"]);
  });

  it("refus : sprite inexistant ou hors tableau, taille positive, dimensions différentes", () => {
    const g = withGfx();
    const s = setup(new MemoryStorage(), g.gfx);
    expect(s.saves.save("save.inf", 0, -50, 0)).toBe(false); // sprite 49 absent
    expect(s.saves.save("save.inf", 0, -101, 0)).toBe(false); // hors tableau
    expect(s.saves.save("save.inf", 0, 64000, 0)).toBe(false); // positive : pas un sprite
    expect(s.saves.save("save.inf", 0, -21, 0)).toBe(true);
    expect(s.saves.load("save.inf", 0, -23, 0)).toBe(false); // 16 × 16 ≠ 320 × 200
    expect(s.saves.load("save.inf", 0, 64000, 0)).toBe(false);
  });

  it("n'est pas persistant : un nouveau gestionnaire le voit absent", () => {
    const g = withGfx();
    const store = new MemoryStorage();
    setup(store, g.gfx).saves.save("save.inf", 0, -21, 0);
    expect(store.data.size).toBe(0);
    expect(setup(store, g.gfx).saves.getSize("save.inf")).toBe(-1);
  });
});
