import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../src/engine/storage";
import { defaultPrefs } from "../../src/games/zoombinis/engine/context";
import {
  ANONYMOUS_FILE,
  MAX_SAVES,
  SAVE_ERROR_STRL,
  STORAGE_PREFIX,
  SaveError,
  SaveStore,
  canTypeChar,
  gameFileName,
  normalizeName,
  parseGame,
  serializeGame,
} from "../../src/games/zoombinis/game/saves";
import {
  type GameState,
  cloneGame,
  createSession,
  makeZoombini,
  newGame,
  optionsFromPrefs,
  prefsFromOptions,
} from "../../src/games/zoombinis/game/state";
import { depositToReserve } from "../../src/games/zoombinis/game/team";

/** `STRL` 1100 de TEXTSTR.MHK (jeu de caractères admis pour les noms). */
const CHARSET = " AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890:;'[]{}<>,.-_+=|!@#$%^&*() àäçÇëèéêïîôœüùû";

function richGame(): GameState {
  const g = newGame();
  g.options.music = false;
  g.options.lessAction = true;
  g.campDecor = [1, 2, 3, 0, 4];
  g.townScroll = 3;
  g.mascots = 2;
  g.dialogMemory[4] = 7;
  g.counters = { created: 40, camp1: 5, camp2: 2, town: 17 };
  g.masks = { stage1: 3, stage2: 1, stage3: 4, stage4: 0 };
  g.stageUnbroken = true;
  g.successes[5] = 0x13;
  g.monuments[0] = { stage: 2, level: 1, year: 1996, month: 11, day: 3 };
  g.monuments[5] = { stage: 4, level: 3, year: 2026, month: 2, day: 28 };
  g.levels = [1, 2, 0, 3];
  g.previousScreen = 2;
  g.resumeScreen = 4;
  const z = (n: number) => {
    const m = makeZoombini([(n % 5) + 1, 2, 3, 4], n + 1);
    m.state[0] = n;
    m.state[9] = 255 - n;
    return m;
  };
  depositToReserve(g.camp1, [z(1), z(2)]);
  g.camp1.scroll = 4;
  g.camp1.entries[600] = { attrs: [5, 5, 5, 5], slot: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), state: new Uint8Array(10).fill(9) };
  g.camp1.count = 3;
  depositToReserve(g.population, [z(3)]);
  g.pickerGroup = { members: [z(4)], flagA: true, flagB: false };
  g.camp2Group = { members: [z(5), { ...z(6), present: false }], flagA: false, flagB: true };
  g.group = { members: [z(7), z(8), z(9)], flagA: true, flagB: true };
  g.typeCounts[10] = 2;
  g.typeCounts[624] = 1;
  return g;
}

describe("noms (11a0:3914, 316d)", () => {
  it("espaces de tête et de fin retirés, 18 caractères au plus, jeu de STRL 1100", () => {
    expect(normalizeName("  Léa  ", CHARSET)).toBe("Léa");
    expect(normalizeName("a b", CHARSET)).toBe("a b");
    expect(normalizeName("   ", CHARSET)).toBeNull();
    expect(normalizeName("", CHARSET)).toBeNull();
    expect(normalizeName("A".repeat(18), CHARSET)).toBe("A".repeat(18));
    expect(normalizeName("A".repeat(19), CHARSET)).toBeNull();
    expect(normalizeName("Zoé/Max", CHARSET)).toBeNull();
    expect(normalizeName("Ñoño", CHARSET)).toBeNull();
    expect(normalizeName("çà", CHARSET)).toBe("çà");
  });

  it("saisie : un caractère du jeu tant que le nom a moins de 18 caractères", () => {
    expect(canTypeChar("abc", "d", CHARSET)).toBe(true);
    expect(canTypeChar("abc", "/", CHARSET)).toBe(false);
    expect(canTypeChar("A".repeat(18), "d", CHARSET)).toBe(false);
    expect(canTypeChar("A".repeat(17), "d", CHARSET)).toBe(true);
  });

  it("fichiers ZOOMnnnn", () => {
    expect(gameFileName(0)).toBe("ZOOM0000");
    expect(gameFileName(42)).toBe("ZOOM0042");
  });
});

describe("sérialisation d'une partie", () => {
  it("aller-retour exact, y compris les octets opaques", () => {
    const g = richGame();
    const back = parseGame(serializeGame(g));
    expect(back).toEqual(g);
    expect(back.camp1.entries[600]!.slot).toEqual(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
    expect(back.typeCounts).toBeInstanceOf(Uint8Array);
  });

  it("partie neuve", () => {
    expect(parseGame(serializeGame(newGame()))).toEqual(newGame());
  });

  it("données corrompues : JSON, version, types, bornes", () => {
    const good = JSON.parse(serializeGame(richGame()));
    const bad = (mutate: (o: any) => void): void => {
      const o = structuredClone(good);
      mutate(o);
      expect(() => parseGame(JSON.stringify(o))).toThrow(SaveError);
    };
    expect(() => parseGame("pas du json")).toThrow(SaveError);
    expect(() => parseGame("[]")).toThrow(SaveError);
    expect(() => parseGame("null")).toThrow(SaveError);
    bad((o) => (o.v = 2));
    bad((o) => (o.game.levels = [0, 0, 0]));
    bad((o) => (o.game.levels[0] = 4));
    bad((o) => (o.game.counters.created = 626));
    bad((o) => (o.game.typeCounts[0] = 3));
    bad((o) => o.game.typeCounts.pop());
    bad((o) => (o.game.group.members[0].attrs = [1, 2, 3, 6]));
    bad((o) => (o.game.group.members[0].state = [1, 2]));
    bad((o) => (o.game.options.music = 1));
    bad((o) => (o.game.monuments[0].stage = 5));
    bad((o) => (o.game.camp1.entries[0] = [700, {}]));
    bad((o) => delete o.game.population);
    try {
      parseGame("{");
    } catch (e) {
      expect((e as SaveError).kind).toBe("invalid");
      expect((e as SaveError).strl).toEqual([[1028, 0], [1030, 0]]);
    }
  });

  it("options ↔ préférences de session", () => {
    const g = newGame();
    expect(prefsFromOptions(g.options)).toEqual({ ...defaultPrefs(), magneticMouse: true });
    const prefs = { ...defaultPrefs(), music: false, transitions: false, hideCursorWhileCarrying: false, autoMagnet: true };
    const options = optionsFromPrefs(prefs, { ...g.options, testMode: true, lessAction: true });
    expect(options).toMatchObject({ music: false, transitionsOff: true, hideCursorWhileCarrying: false, autoMagnet: true, testMode: true, lessAction: true });
    expect(prefsFromOptions(options)).toEqual(prefs);
  });
});

describe("liste et parties (rôle du .WHO)", () => {
  it("liste vide, enregistrement, chargement", () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, CHARSET);
    expect(store.list()).toEqual([]);
    const g = richGame();
    const r = store.save("  Léa ", g);
    expect(r).toEqual({ entry: { name: "Léa", file: "ZOOM0000" }, replaced: false });
    expect(store.list()).toEqual([{ name: "Léa", file: "ZOOM0000" }]);
    expect([...storage.data.keys()].sort()).toEqual([`${STORAGE_PREFIX}game:ZOOM0000`, `${STORAGE_PREFIX}who`]);
    expect(store.load("Léa")).toEqual(g);
    // une nouvelle instance relit le même stockage
    expect(new SaveStore(storage, CHARSET).load("Léa")).toEqual(g);
  });

  it("une partie de même nom est remplacée, avec le même fichier et sans nouvelle entrée", () => {
    const store = new SaveStore(new MemoryStorage(), CHARSET);
    store.save("Max", newGame());
    store.save("Zoé", newGame());
    const g = richGame();
    const r = store.save("Max", g);
    expect(r).toMatchObject({ replaced: true, entry: { file: "ZOOM0000" } });
    expect(store.list().map((e) => e.name)).toEqual(["Max", "Zoé"]);
    expect(store.load("Max")).toEqual(g);
    expect(store.load("Zoé")).toEqual(newGame());
    // le compteur n'a avancé que pour les nouvelles parties
    expect(store.save("Ana", newGame()).entry.file).toBe("ZOOM0002");
  });

  it("comparaison exacte des noms (casse comprise)", () => {
    const store = new SaveStore(new MemoryStorage(), CHARSET);
    store.save("max", newGame());
    expect(store.find("Max")).toBeNull();
    expect(store.save("Max", newGame()).replaced).toBe(false);
  });

  it("limite de 50 parties : la 51e est refusée, mais on peut encore remplacer", () => {
    const store = new SaveStore(new MemoryStorage(), CHARSET);
    for (let i = 0; i < MAX_SAVES; i += 1) store.save(`partie ${i}`, newGame());
    expect(store.list()).toHaveLength(50);
    expect(store.list()[49]!.file).toBe("ZOOM0049");
    try {
      store.save("une de trop", newGame());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SaveError);
      expect((e as SaveError).kind).toBe("full");
      expect((e as SaveError).strl).toEqual([[2018, 37]]);
    }
    expect(store.list()).toHaveLength(50);
    expect(store.save("partie 7", richGame()).replaced).toBe(true);
  });

  it("nom invalide, partie inconnue, fichier manquant ou corrompu", () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, CHARSET);
    const kind = (f: () => unknown): string => {
      try {
        f();
      } catch (e) {
        return (e as SaveError).kind;
      }
      return "aucune";
    };
    expect(kind(() => store.save("   ", newGame()))).toBe("badName");
    expect(kind(() => store.save("a/b", newGame()))).toBe("badName");
    expect(kind(() => store.load("Nul"))).toBe("open");
    store.save("Léa", newGame());
    storage.data.delete(`${STORAGE_PREFIX}game:ZOOM0000`);
    expect(kind(() => store.load("Léa"))).toBe("read");
    storage.data.set(`${STORAGE_PREFIX}game:ZOOM0000`, "{}");
    expect(kind(() => store.load("Léa"))).toBe("invalid");
    expect(SAVE_ERROR_STRL.open).toEqual([[1020, 0]]);
    expect(SAVE_ERROR_STRL.write).toEqual([[1022, 0]]);
    expect(SAVE_ERROR_STRL.read).toEqual([[1026, 0]]);
  });

  it("liste corrompue : version, entrée, nombre, compteur", () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, CHARSET);
    const put = (v: unknown): void => void storage.data.set(`${STORAGE_PREFIX}who`, typeof v === "string" ? v : JSON.stringify(v));
    const kind = (): string => {
      try {
        store.list();
      } catch (e) {
        return (e as SaveError).kind;
      }
      return "aucune";
    };
    put("n'importe quoi");
    expect(kind()).toBe("invalid");
    put({ v: 9, next: 0, games: [] });
    expect(kind()).toBe("invalid");
    put({ v: 1, next: 0, games: [{ name: "a", file: "../etc" }] });
    expect(kind()).toBe("invalid");
    put({ v: 1, next: 0, games: Array.from({ length: 51 }, (_, i) => ({ name: `n${i}`, file: gameFileName(i) })) });
    expect(kind()).toBe("invalid");
    put({ v: 1, next: -1, games: [] });
    expect(kind()).toBe("invalid");
    put({ v: 1, next: 3, games: [] });
    expect(kind()).toBe("aucune");
  });

  it("stockage plein : erreur d'écriture, et aucune entrée sans fichier", () => {
    const inner = new MemoryStorage();
    let full = false;
    const store = new SaveStore(
      {
        get: (k) => inner.get(k),
        set: (k, v) => (full ? false : inner.set(k, v)),
        remove: (k) => inner.remove(k),
      },
      CHARSET,
    );
    store.save("Léa", newGame());
    full = true;
    try {
      store.save("Max", newGame());
      expect.unreachable();
    } catch (e) {
      expect((e as SaveError).kind).toBe("write");
      expect((e as SaveError).strl).toEqual([[1022, 0]]);
    }
    expect(store.list().map((e) => e.name)).toEqual(["Léa"]);
  });

  it("la liste n'est pas écrite si le fichier de la partie échoue, et le fichier est retiré si la liste échoue", () => {
    const inner = new MemoryStorage();
    const failOn = { key: "" };
    const store = new SaveStore(
      {
        get: (k) => inner.get(k),
        set: (k, v) => (k.endsWith(failOn.key) && failOn.key !== "" ? false : inner.set(k, v)),
        remove: (k) => inner.remove(k),
      },
      CHARSET,
    );
    failOn.key = "who";
    expect(() => store.save("Léa", newGame())).toThrow(SaveError);
    expect([...inner.data.keys()]).toEqual([]);
    failOn.key = "game:ZOOM0000";
    expect(() => store.save("Léa", newGame())).toThrow(SaveError);
    expect([...inner.data.keys()]).toEqual([]);
  });
});

describe("partie anonyme et écriture automatique (11a0:141e)", () => {
  it("ZBUser", () => {
    const store = new SaveStore(new MemoryStorage(), CHARSET);
    expect(store.loadAnonymous()).toBeNull();
    const g = richGame();
    store.saveAnonymous(g);
    expect(store.loadAnonymous()).toEqual(g);
    expect(store.list()).toEqual([]);
    expect(ANONYMOUS_FILE).toBe("ZBUser");
  });

  it("écriture au changement d'écran seulement si la partie est nommée, hors entraînement", () => {
    const store = new SaveStore(new MemoryStorage(), CHARSET);
    const session = createSession();
    const g = newGame();
    expect(store.autoSave(g, session)).toBe(false);
    store.save("Léa", g);
    session.name = "Léa";
    const g2 = cloneGame(g);
    g2.counters.created = 16;
    g2.resumeScreen = 7;
    expect(store.autoSave(g2, session)).toBe(true);
    expect(store.load("Léa").counters.created).toBe(16);
    expect(store.list()).toHaveLength(1);
    session.training = 1;
    g2.counters.created = 17;
    expect(store.autoSave(g2, session)).toBe(false);
    expect(store.load("Léa").counters.created).toBe(16);
    session.training = 0;
    session.name = "Inconnue";
    expect(store.autoSave(g2, session)).toBe(false);
  });
});
