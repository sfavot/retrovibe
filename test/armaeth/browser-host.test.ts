import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../src/engine/storage";
import { parsePlainMessages } from "../../src/games/armaeth/data/text";
import { parseHelp } from "../../src/games/armaeth/data/tables";
import { hintTexts, menuOptions, open, rootOptions } from "../../src/games/armaeth/ui/help-tree";
import { InputQueue, type KeyLike, buttonMask, mapKey } from "../../src/games/armaeth/ui/input";
import { createSaveStorage, decodeBase64, encodeBase64 } from "../../src/games/armaeth/ui/saves";
import { MAX_CATCH_UP_TICKS, TICK_MS, TickScheduler } from "../../src/games/armaeth/ui/scheduler";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { Player } from "./player";

const key = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

describe("mapKey : touches du navigateur -> événements DOS", () => {
  it("caractères, accents compris, tels que tapés", () => {
    expect(mapKey(key("a"))).toEqual({ type: "char", char: "a" });
    expect(mapKey(key("é"))).toEqual({ type: "char", char: "é" });
    expect(mapKey(key("ç"))).toEqual({ type: "char", char: "ç" });
    expect(mapKey(key(" "))).toEqual({ type: "char", char: " " });
    expect(mapKey(key("+"))).toEqual({ type: "char", char: "+" });
    expect(mapKey(key("-"))).toEqual({ type: "char", char: "-" });
    expect(mapKey(key("A", { shiftKey: true }))).toEqual({ type: "char", char: "A" });
  });

  it("Entrée, Échap, Retour arrière : caractères de commande du DOS ; Suppr à part", () => {
    expect(mapKey(key("Enter", { code: "Enter" }))).toEqual({ type: "char", char: "\r" });
    expect(mapKey(key("Enter", { code: "NumpadEnter" }))).toEqual({ type: "char", char: "\r" });
    expect(mapKey(key("Escape"))).toEqual({ type: "char", char: "\x1b" });
    expect(mapKey(key("Backspace"))).toEqual({ type: "char", char: "\b" });
    expect(mapKey(key("Delete"))).toEqual({ type: "delete" });
  });

  it("flèches, Début, Fin, Pg. préc., Pg. suiv., Inser : touches de déplacement", () => {
    const expected: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Home: "home", End: "end", PageUp: "pgup", PageDown: "pgdn", Insert: "insert" };
    for (const [name, nav] of Object.entries(expected)) expect(mapKey(key(name))).toEqual({ type: "nav", key: nav });
    expect(mapKey(key("ArrowLeft", { shiftKey: true }))).toEqual({ type: "nav", key: "left" });
  });

  it("F1 à F10 ; F11, F12 et les touches nommées restent au navigateur", () => {
    for (let n = 1; n <= 10; n++) expect(mapKey(key(`F${n}`, { code: `F${n}` }))).toEqual({ type: "function", n });
    expect(mapKey(key("F6", { code: "F6", shiftKey: true }))).toEqual({ type: "function", n: 6, modifier: "shift" });
    expect(mapKey(key("F2", { code: "F2", altKey: true }))).toEqual({ type: "function", n: 2, modifier: "alt" });
    expect(mapKey(key("F11", { code: "F11" }))).toBeNull();
    expect(mapKey(key("F12", { code: "F12" }))).toBeNull();
    for (const name of ["Tab", "Shift", "Control", "Alt", "Dead", "CapsLock", "Meta", "ContextMenu"]) expect(mapKey(key(name))).toBeNull();
  });

  it("Alt + lettre, chiffre, - ou = : lus par `code` (sur Mac, Alt change le caractère)", () => {
    expect(mapKey(key("å", { code: "KeyA", altKey: true }))).toEqual({ type: "alt", key: "a" });
    expect(mapKey(key("π", { code: "KeyP", altKey: true }))).toEqual({ type: "alt", key: "p" });
    expect(mapKey(key("1", { code: "Digit1", altKey: true }))).toEqual({ type: "alt", key: "1" });
    expect(mapKey(key("-", { code: "Minus", altKey: true }))).toEqual({ type: "alt", key: "-" });
    expect(mapKey(key("=", { code: "Equal", altKey: true }))).toEqual({ type: "alt", key: "=" });
    expect(mapKey(key("Alt", { code: "AltLeft", altKey: true }))).toBeNull();
  });

  it("Ctrl / Cmd + touche : au navigateur ; AltGr (Ctrl + Alt) reste un caractère", () => {
    expect(mapKey(key("r", { code: "KeyR", ctrlKey: true }))).toBeNull();
    expect(mapKey(key("r", { code: "KeyR", metaKey: true }))).toBeNull();
    expect(mapKey(key("ArrowLeft", { metaKey: true }))).toBeNull();
    expect(mapKey(key("@", { code: "Digit0", ctrlKey: true, altKey: true }))).toEqual({ type: "char", char: "@" });
  });
});

describe("InputQueue : souris en échantillons d'état", () => {
  it("les déplacements consécutifs sont fusionnés ; coordonnées arrondies et ramenées dans l'écran", () => {
    const q = new InputQueue();
    q.move(10.7, 20.2);
    q.move(30, 40);
    q.move(-5, 999);
    expect(q.drain()).toEqual([{ type: "pointer", x: 0, y: 199, buttons: 0, ctrl: false }]);
    q.move(400, 3);
    expect(q.drain()).toEqual([{ type: "pointer", x: 319, y: 3, buttons: 0, ctrl: false }]);
    expect(q.drain()).toEqual([]);
  });

  it("appui et relâchement ne sont jamais fusionnés avec les déplacements, même dans le même tic", () => {
    const q = new InputQueue();
    q.move(5, 5);
    q.down(1, 6, 7);
    q.move(9, 9);
    q.up(1, 9, 9);
    q.move(1, 1);
    expect(q.drain().map((i) => (i.type === "pointer" ? [i.x, i.y, i.buttons] : null))).toEqual([
      [6, 7, 0],
      [6, 7, 1],
      [9, 9, 1],
      [9, 9, 0],
      [1, 1, 0],
    ]);
  });

  it("boutons gauche et droit cumulés ; Ctrl suit le dernier événement ; bouton du milieu ignoré", () => {
    const q = new InputQueue();
    q.down(buttonMask(0), 10, 10, true);
    q.down(buttonMask(2), 10, 10);
    q.down(buttonMask(1), 10, 10);
    q.up(buttonMask(0), 10, 10);
    const pointers = q.drain().filter((i) => i.type === "pointer");
    expect(pointers.map((i) => (i.type === "pointer" ? i.buttons : -1))).toEqual([0, 1, 1, 3, 2]);
    expect(pointers[1]).toMatchObject({ buttons: 1, ctrl: true });
    expect(pointers[3]).toMatchObject({ buttons: 3, ctrl: false });
  });

  it("un toucher = clic gauche à la dernière position, un appui long = clic droit", () => {
    const q = new InputQueue();
    q.move(100, 50);
    q.tap(1);
    q.tap(buttonMask(2));
    expect(q.drain().map((i) => (i.type === "pointer" ? [i.x, i.y, i.buttons] : null))).toEqual([
      [100, 50, 0],
      [100, 50, 1],
      [100, 50, 0],
      [100, 50, 2],
      [100, 50, 0],
    ]);
  });

  it("perdre le focus relâche les boutons ; les touches restent en file dans l'ordre", () => {
    const q = new InputQueue();
    q.key({ type: "char", char: "a" });
    q.down(1, 3, 4);
    q.releaseAll();
    q.releaseAll();
    q.key({ type: "delete" });
    const inputs = q.drain();
    expect(inputs.map((i) => i.type)).toEqual(["key", "pointer", "pointer", "pointer", "key"]);
    expect(inputs[3]).toMatchObject({ buttons: 0 });
  });
});

describe("sauvegardes : base64 et stockage", () => {
  it("aller-retour sur tous les octets, y compris un monde entier (> 8 192 octets)", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decodeBase64(encodeBase64(all))).toEqual(all);
    const big = new Uint8Array(21880).map((_, i) => (i * 31) & 0xff);
    expect(decodeBase64(encodeBase64(big))).toEqual(big);
    expect(encodeBase64(new Uint8Array(0))).toBe("");
    expect(decodeBase64("")).toEqual(new Uint8Array(0));
  });

  it("base64 invalide : null", () => {
    expect(decodeBase64("!!! pas du base64")).toBeNull();
  });

  it("emplacement vide, valeur illisible ou qui n'est pas un monde : null (jamais d'exception)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new MemoryStorage();
    const saves = createSaveStorage(store);
    expect(saves.read("svg001")).toBeNull();
    store.set("svg001", "@@@");
    expect(saves.read("svg001")).toBeNull();
    store.set("svg001", encodeBase64(Uint8Array.of(1, 2, 3)));
    expect(saves.read("svg001")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("un échec d'écriture est signalé, pas levé", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saves = createSaveStorage({ get: () => null, set: () => false, remove: () => {} });
    expect(() => saves.write("svg001", Uint8Array.of(1))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegardes : un vrai monde", () => {
  it("écrit en base64 puis relu à l'identique, et accepté par le moteur", () => {
    const player = new Player();
    player.skipIntro();
    const { host, engine } = player;
    const store = new MemoryStorage();
    const saves = createSaveStorage(store);
    engine.saveGame();
    const bytes = host.storage.read("svg001")!;
    expect(bytes.length).toBeGreaterThan(20000);
    saves.write("svg001", bytes);
    expect(typeof store.get("svg001")).toBe("string");
    expect(saves.read("svg001")).toEqual(bytes);
  });
});

describe("TickScheduler : 50 Hz sur les images d'écran", () => {
  it("le premier appel ne fait que fixer l'origine ; ensuite un tic toutes les 20 ms", () => {
    const s = new TickScheduler();
    expect(TICK_MS).toBe(20);
    expect(s.due(1000)).toBe(0);
    expect(s.due(1010)).toBe(0);
    expect(s.due(1020)).toBe(1);
    expect(s.due(1040)).toBe(1);
  });

  it("un écran à 60 Hz joue 50 tics par seconde", () => {
    const s = new TickScheduler();
    let total = 0;
    s.due(0);
    for (let frame = 1; frame <= 600; frame++) total += s.due((frame * 1000) / 60);
    expect(total).toBe(500);
  });

  it("un écran à 144 Hz aussi, avec des images sans tic", () => {
    const s = new TickScheduler();
    let total = 0;
    let empty = 0;
    s.due(0);
    for (let frame = 1; frame <= 1440; frame++) {
      const n = s.due((frame * 1000) / 144);
      total += n;
      if (n === 0) empty++;
    }
    expect(total).toBe(500);
    expect(empty).toBeGreaterThan(0);
  });

  it("une image très en retard rattrape au plus MAX_CATCH_UP_TICKS tics, le reste est abandonné", () => {
    const s = new TickScheduler();
    s.due(0);
    expect(s.due(10_000)).toBe(MAX_CATCH_UP_TICKS);
    expect(s.due(10_020)).toBe(1);
  });

  it("resync : après une pause, l'absence n'est pas rattrapée", () => {
    const s = new TickScheduler();
    s.due(0);
    s.due(20);
    s.resync();
    expect(s.due(60_000)).toBe(0);
    expect(s.due(60_020)).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("arbre d'aide (A1FSOS.SYS)", () => {
  const nodes = parseHelp(readOriginal("A1FSOS.SYS"));
  const messages = parsePlainMessages(readOriginal("MSGUTL"));

  it("les étiquettes de MSGUTL 57 à 61 existent", () => {
    for (const id of [57, 58, 59, 60, 61]) expect(messages.messages.get(id)).toBeTruthy();
    expect(messages.messages.get(59)).toMatch(/^Aide n/);
  });

  it("chapitres : Information puis les niveaux de jeu 0 à 3", () => {
    const titles = rootOptions(nodes).map((o) => o.title);
    expect(titles).toEqual(["* Information *", "Niveau de jeu 0", "Niveau de jeu 1", "Niveau de jeu 2", "Niveau de jeu 3"]);
  });

  it("chapitre -> élément -> question -> indices dévoilés dans l'ordre", () => {
    const level0 = rootOptions(nodes)[1];
    const items = open(nodes, level0.node);
    expect(items.type).toBe("menu");
    if (items.type !== "menu") return;
    expect(items.options[0].title).toBe("Ours");
    const questions = open(nodes, items.options[0].node);
    if (questions.type !== "menu") throw new Error("menu attendu");
    expect(questions.options.map((o) => o.title)).toContain("Comment éviter l'ours");
    const hintsMenu = open(nodes, questions.options.find((o) => o.title === "Comment éviter l'ours")!.node);
    if (hintsMenu.type !== "menu") throw new Error("menu attendu");
    const hints = hintTexts(nodes, hintsMenu.options)!;
    expect(hints).toHaveLength(3);
    expect(hints[0]).toBe("Courez simplement plus vite que lui !");
    // un menu titré n'est pas un menu d'indices
    expect(hintTexts(nodes, questions.options)).toBeNull();
  });

  it("une option dont l'enfant est une page s'ouvre en page", () => {
    const info = open(nodes, rootOptions(nodes)[0].node);
    if (info.type !== "menu") throw new Error("menu attendu");
    const page = open(nodes, info.options[0].node);
    expect(page.type).toBe("page");
    if (page.type === "page") expect(page.text).toMatch(/^Les touches de curseur/);
  });

  it("tout l'arbre se parcourt : chaque page est atteinte, aucun menu vide, 20 options au plus", () => {
    const pages = new Set<string>();
    let visited = 0;
    const walk = (node: number): void => {
      const target = open(nodes, node);
      visited++;
      if (target.type === "page") {
        pages.add(target.text);
        return;
      }
      expect(target.options.length).toBeGreaterThan(0);
      expect(target.options.length).toBeLessThanOrEqual(20);
      for (const option of target.options) walk(option.node);
    };
    for (const option of rootOptions(nodes)) walk(option.node);
    expect(visited).toBeGreaterThan(300);
    expect(pages.size).toBeGreaterThan(100);
    expect(menuOptions(nodes, 0)).toEqual([]);
  });
});
