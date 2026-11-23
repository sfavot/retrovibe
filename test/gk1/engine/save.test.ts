import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveSlots } from "../../../src/engine/save-slots";
import { MemoryStorage } from "../../../src/engine/storage";
import { eventsOf, MouseButton, SciKey } from "../../../src/games/gk1/engine/events";
import { ArrayType } from "../../../src/games/gk1/engine/ids";
import { FileMode, GameFiles, gameFilesOf } from "../../../src/games/gk1/engine/kernel/fileio";
import { saveCatalogueName, saveFileName } from "../../../src/games/gk1/engine/kernel/save";
import { soundManagerOf } from "../../../src/games/gk1/engine/kernel/sound";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { type Reg, SciArray, toSint16 } from "../../../src/games/gk1/engine/memory";
import { readSelector } from "../../../src/games/gk1/engine/object";
import {
  canSaveGame,
  captureGame,
  loadFromSlot,
  loadLatestSave,
  parseSaveImage,
  restartGame,
  restoreGame,
  SAVE_NAME_LENGTH,
  SAVE_SLOT_COUNT,
  SAVE_VERSION,
  type SaveImage,
  type SaveStore,
  saveStoreOf,
  saveToSlot,
  useSaveStorage,
} from "../../../src/games/gk1/engine/save";
import { declareState, loadInstance, packBytes, packWords, saveInstance, unpackBytes, unpackWords } from "../../../src/games/gk1/engine/save-codec";
import { applyKey, EditResult, KEY_CLEAR, newEditState, replaceEditText, type TextEntryRequest, textEntryOf } from "../../../src/games/gk1/engine/text-entry";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { seqPlayerOf } from "../../../src/games/gk1/render/seq-player";
import { fnv1a, mainIndex, original } from "../data/real";

const TITLE_ROOM = 375;
/** La librairie de Gabriel, première pièce du jeu. */
const BOOKSHOP = 210;
const WALK_VIEW = 901;
const GLOBAL_ICON_BAR = 69;
const GLOBAL_USER = 80;
/** Un point du plancher de la librairie, à droite : Gabriel y va quand on y clique avec le curseur de marche. */
const WALK_TARGET = { x: 280, y: 140 };
/** Images jouées après une sauvegarde ou une reprise pour comparer les deux exécutions. */
const FRAMES_AFTER = 240;
/** Sur l'écran titre et dans les fenêtres : icône des réglages de la barre du haut. */
const CONTROL_PANEL_ICON = { x: 265, y: 24 };

// -------------------------------------------------------------------------------------------------------------------------------
// Outils
// -------------------------------------------------------------------------------------------------------------------------------

function newVm(storage?: MemoryStorage): Vm {
  const vm = new Vm(mainIndex());
  useGameClock(vm);
  if (storage) useSaveStorage(vm, storage, () => 1000);
  return vm;
}

/** Joue `count` images comme la page : une image du jeu, puis le son jusqu'à l'horloge du jeu. */
function step(vm: Vm, count = 1): void {
  for (let i = 0; i < count; i++) {
    expect(runFrame(vm).status).toBe(RunStatus.Suspended);
    soundManagerOf(vm).advanceTo(vm.ticks);
  }
}

function item(vm: Vm, name: string) {
  return frameoutOf(vm)
    .planes.flatMap((plane) => plane.items)
    .find((candidate) => candidate.object !== 0 && vm.nameOf(candidate.object) === name);
}

function click(vm: Vm, x: number, y: number): void {
  const events = eventsOf(vm);
  events.move(x, y);
  step(vm, 3);
  events.down(MouseButton.Left, x, y);
  events.up(MouseButton.Left, x, y);
  step(vm, 2);
}

function clickItem(vm: Vm, name: string): void {
  const rect = item(vm, name)!.screenRect;
  click(vm, (rect.left + rect.right) >> 1, (rect.top + rect.bottom) >> 1);
}

/** Somme de contrôle de l'image présentée (curseur compris) et de sa palette. */
function frameHash(vm: Vm): number {
  const frameout = frameoutOf(vm);
  return (fnv1a(frameout.present()) ^ Math.imul(fnv1a(frameout.palette.screen), 31)) >>> 0;
}

/** Joue `count` images et rend la somme de contrôle de chacune. */
function play(vm: Vm, count: number): number[] {
  const hashes: number[] = [];
  for (let i = 0; i < count; i++) {
    step(vm);
    hashes.push(frameHash(vm));
  }
  return hashes;
}

/**
 * La suite d'une partie, pour comparer deux exécutions : quelques images, puis un clic qui fait marcher Gabriel, et la marche.
 * Rend la somme de contrôle de chaque image.
 */
function playOn(vm: Vm): number[] {
  const frames = play(vm, 20);
  eventsOf(vm).down(MouseButton.Left, WALK_TARGET.x, WALK_TARGET.y);
  eventsOf(vm).up(MouseButton.Left, WALK_TARGET.x, WALK_TARGET.y);
  return [...frames, ...play(vm, FRAMES_AFTER)];
}

/** Tout l'état de la partie, en texte : deux exécutions identiques donnent le même. */
function stateOf(vm: Vm): string {
  return JSON.stringify(captureGame(vm));
}

function typeText(vm: Vm, text: string): void {
  for (const character of text) {
    eventsOf(vm).keyDown(character.charCodeAt(0));
    eventsOf(vm).keyUp(character.charCodeAt(0));
    step(vm, 2);
  }
}

const keptByVm = new WeakMap<Vm, Reg[]>();

/** Alloue un tableau pour un test et le garde du ramasse-miettes (aucun script ne le référence). */
function allocate(vm: Vm, array: SciArray): Reg {
  let kept = keptByVm.get(vm);
  if (!kept) {
    const created: Reg[] = [];
    keptByVm.set(vm, (kept = created));
    vm.gcRoots.push(() => created);
  }
  const reg = vm.memory.arrays.allocate(array);
  kept.push(reg);
  return reg;
}

/** Chaîne des scripts (tableau de caractères) portant `text`. */
function stringReg(vm: Vm, text: string): Reg {
  const array = new SciArray(ArrayType.String, 1);
  array.setByteString(text);
  return allocate(vm, array);
}

function callKernel(vm: Vm, name: string, ...args: Reg[]): Reg {
  return vm.kernel.call(vm, vm.kernel.indexOf(name), Uint32Array.from(args));
}

interface Fixtures {
  /** Écran titre, boutons affichés. */
  title: SaveImage;
  /** Dans la librairie, le joueur a la main. */
  bookshop: SaveImage;
}

let fixtures: Fixtures | undefined;

/** Joue une fois du démarrage à la librairie ; les tests repartent ensuite des images prises en route. */
function images(): Fixtures {
  if (fixtures) return fixtures;
  const vm = newVm();
  vm.boot();
  for (let frames = 0; !(currentRoom(vm) === TITLE_ROOM && item(vm, "playButt")); frames++) {
    if (frames > 5000) throw new Error("écran titre introuvable");
    step(vm);
  }
  step(vm, 120);
  const title = captureGame(vm);
  const play = item(vm, "playButt")!.screenRect;
  while (currentRoom(vm) === TITLE_ROOM) {
    click(vm, play.left + 5, play.top + 3);
    step(vm, 20);
  }
  const user = vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values[GLOBAL_USER];
  const value = (name: string): number => toSint16(readSelector(vm.memory, user, vm.selectors.id(name)));
  for (let tries = 0; !(currentRoom(vm) === BOOKSHOP && item(vm, "GKEgo")?.view === WALK_VIEW && value("input") !== 0 && value("controls") !== 0); tries++) {
    if (tries > 500) throw new Error("librairie introuvable");
    eventsOf(vm).keyDown(SciKey.Enter);
    step(vm, 60);
  }
  step(vm, 60);
  // Bouton droit : curseur suivant, jusqu'à celui de la marche.
  const iconBar = vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values[GLOBAL_ICON_BAR];
  const property = (name: string): Reg => readSelector(vm.memory, iconBar, vm.selectors.id(name));
  for (let tries = 0; property("curIcon") !== property("walkIconItem"); tries++) {
    if (tries > 15) throw new Error("curseur de marche introuvable");
    eventsOf(vm).move(150, 120);
    step(vm, 3);
    eventsOf(vm).down(MouseButton.Right, 150, 120);
    eventsOf(vm).up(MouseButton.Right, 150, 120);
    step(vm, 7);
  }
  return (fixtures = { title, bookshop: captureGame(vm) });
}

/** Une machine virtuelle neuve reprise d'une image (copie : une image relue du stockage est toujours un objet neuf). */
function resume(image: SaveImage, storage?: MemoryStorage): Vm {
  const vm = newVm(storage);
  restoreGame(vm, structuredClone(image));
  return vm;
}

/** Ouvre la fenêtre « Sauvegarder » du jeu depuis la librairie : barre d'icônes, panneau de réglages, bouton. */
function openSaveWindow(vm: Vm): void {
  eventsOf(vm).move(160, 2);
  step(vm, 30);
  click(vm, CONTROL_PANEL_ICON.x, CONTROL_PANEL_ICON.y);
  step(vm, 30);
  clickItem(vm, "iconSave");
  step(vm, 40);
  expect(vm.backtrace()[0]).toBe("noyau EditText");
}

interface WindowSave {
  storage: MemoryStorage;
  /** Images qui suivent la sauvegarde, celle où `SaveGame` s'exécute comprise. */
  frames: number[];
  /** État complet après ces images. */
  state: string;
  requests: TextEntryRequest[];
  closed: number;
}

let windowSave: WindowSave | undefined;

/** Sauve « Librairie » par la fenêtre du jeu, au clavier, puis continue de jouer. */
function saveByWindow(): WindowSave {
  if (windowSave) return windowSave;
  const storage = new MemoryStorage();
  const vm = resume(images().bookshop, storage);
  const requests: TextEntryRequest[] = [];
  let closed = 0;
  textEntryOf(vm).host = { opened: (request) => requests.push(request), closed: () => closed++ };
  step(vm, 5);
  openSaveWindow(vm);
  typeText(vm, "Librairiee");
  eventsOf(vm).keyDown(SciKey.Backspace);
  step(vm, 2);
  eventsOf(vm).keyDown(SciKey.Enter);
  const slots = saveStoreOf(vm).slots;
  for (let frames = 0; slots.read(1) === null; frames++) {
    if (frames > 100) throw new Error("la fenêtre du jeu n'a pas sauvé");
    step(vm);
  }
  const frames = [frameHash(vm), ...playOn(vm)];
  return (windowSave = { storage, frames, state: stateOf(vm), requests, closed });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------------------------------------------------------------------
// Sans les fichiers du jeu
// -------------------------------------------------------------------------------------------------------------------------------

describe("codage des sauvegardes", () => {
  it("octets et mots : aller-retour, et les plages répétées se compactent", () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i < 600 ? 7 : i & 0xff));
    expect(unpackBytes(packBytes(bytes))).toEqual(bytes);
    expect(packBytes(bytes).length).toBeLessThan(700);
    expect(unpackBytes(packBytes(new Uint8Array(0)))).toEqual(new Uint8Array(0));
    const words = Uint32Array.from({ length: 500 }, (_, i) => (i % 7 === 0 ? 0x2b0004 + i : i & 0xff));
    expect(unpackWords(packWords(words))).toEqual(words);
    // Une pile vide de 4 096 valeurs : moins d'un caractère pour dix valeurs.
    expect(packWords(new Uint32Array(4096)).length).toBeLessThan(400);
    expect(() => unpackBytes("12:AAAA")).toThrow(/illisible/);
    expect(() => unpackBytes("n'importe quoi")).toThrow();
  });

  it("octets : une longueur annoncée démesurée est refusée avant toute allocation", () => {
    expect(() => unpackBytes("4000000000:AAAA")).toThrow(/illisible/);
    expect(() => unpackBytes("-1:AAAA")).toThrow(/illisible/);
    expect(() => unpackBytes("1e300:AAAA")).toThrow(/illisible/);
    expect(() => unpackBytes("1000:AAAA")).toThrow(/illisible/);
  });

  it("état d'une instance : une clé forgée (__proto__, constructor) est refusée sans toucher aux prototypes", () => {
    class Holder {
      value = 0;
      rect = { left: 1 };
    }
    declareState(Holder, { name: "test.Holder" });
    const holder = new Holder();
    const state = saveInstance(holder);
    const forge = (json: string): never => JSON.parse(json) as never;
    const forged = [
      forge('{"$":"c","n":"test.Holder","f":{"__proto__":{"polluted":1}}}'),
      forge('{"$":"c","n":"test.Holder","f":{"constructor":1}}'),
      forge('{"$":"c","n":"test.Holder","f":{"value":0,"rect":{"__proto__":{"polluted":1}}}}'),
      forge('{"$":"c","n":"test.Holder","f":{"value":{"$":"t","k":"__proto__","d":"0:"}}}'),
    ];
    for (const node of forged) expect(() => loadInstance(holder, node)).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(holder.rect)).toBe(Object.prototype);
    expect(holder.value).toBe(0);
    // L'état écrit par le jeu se relit toujours.
    expect(() => loadInstance(holder, JSON.parse(JSON.stringify(state)) as never)).not.toThrow();
  });

  it("état d'une instance : relu en place, objets partagés gardés, services ignorés", () => {
    class Part {
      level = 0;
      constructor(readonly id: number) {}
    }
    class Box {
      readonly pixels = new Uint8Array(4);
      readonly parts: Part[] = [];
      readonly byId = new Map<number, Part>();
      current: Part | undefined;
      count = 0;
      limit = Infinity;
      rect = { left: 1, top: 2 };
      service = { secret: 1 };
      warn: () => void = () => {};
    }
    declareState(Part, { name: "test.Part", create: (fields) => new Part(fields.id as number) });
    declareState(Box, { name: "test.Box", skip: ["service"] });

    const box = new Box();
    box.pixels.set([1, 2, 3, 4]);
    for (const id of [5, 6, 7]) {
      const part = new Part(id);
      part.level = id * 2;
      box.parts.push(part);
      box.byId.set(id, part);
    }
    box.current = box.parts[1];
    box.count = 3;
    const state = JSON.parse(JSON.stringify(saveInstance(box))) as ReturnType<typeof saveInstance>;
    expect(JSON.stringify(state)).not.toContain("secret");

    const other = new Box();
    const { pixels, parts, service } = other;
    other.rect = { left: 9, top: 9 };
    loadInstance(other, state);
    expect(other.pixels).toBe(pixels);
    expect([...other.pixels]).toEqual([1, 2, 3, 4]);
    expect(other.parts).toBe(parts);
    expect(other.parts.map((part) => [part.id, part.level])).toEqual([[5, 10], [6, 12], [7, 14]]);
    expect(other.parts[0]).toBeInstanceOf(Part);
    // Le même objet par trois chemins : la liste, la table et le champ.
    expect(other.byId.get(6)).toBe(other.parts[1]);
    expect(other.current).toBe(other.parts[1]);
    expect([other.count, other.limit, other.rect]).toEqual([3, Infinity, { left: 1, top: 2 }]);
    expect(other.service).toBe(service);

    class Unknown {}
    box.current = new Unknown() as Part;
    expect(() => saveInstance(box)).toThrow(/non déclarée/);
  });
});

describe("saisie de texte", () => {
  const fits = (text: string): boolean => text.length <= 8;

  it("la première frappe remplace le texte proposé, une touche de déplacement le garde", () => {
    const replaced = newEditState("Ancien");
    expect(applyKey(replaced, 0x4e, 26, fits)).toBe(EditResult.TextChanged);
    expect([replaced.text, replaced.cursor, replaced.changed]).toEqual(["N", 1, true]);

    const kept = newEditState("Ancien");
    expect(applyKey(kept, SciKey.End, 26, fits)).toBe(EditResult.CursorMoved);
    expect(applyKey(kept, 0x21, 26, fits)).toBe(EditResult.TextChanged);
    expect([kept.text, kept.cursor]).toEqual(["Ancien!", 7]);
  });

  it("déplacements, effacements, refrappe, longueur et largeur maximales", () => {
    const edit = newEditState("abcd");
    applyKey(edit, SciKey.End, 6, fits);
    expect(applyKey(edit, SciKey.Right, 6, fits)).toBe(EditResult.None);
    applyKey(edit, SciKey.Left, 6, fits);
    applyKey(edit, SciKey.Backspace, 6, fits);
    expect([edit.text, edit.cursor]).toEqual(["abd", 2]);
    applyKey(edit, SciKey.Delete, 6, fits);
    expect(edit.text).toBe("ab");
    expect(applyKey(edit, SciKey.Delete, 6, fits)).toBe(EditResult.None);
    applyKey(edit, SciKey.Home, 6, fits);
    // Retour arrière en début de champ : rien ne part, mais c'est une modification (comme l'original).
    expect(applyKey(edit, SciKey.Backspace, 6, fits)).toBe(EditResult.TextChanged);
    expect(edit.text).toBe("ab");
    applyKey(edit, SciKey.Insert, 6, fits);
    applyKey(edit, 0x58, 6, fits);
    expect([edit.text, edit.cursor, edit.overwrite]).toEqual(["Xb", 1, true]);
    applyKey(edit, SciKey.Insert, 6, fits);
    for (const character of "123456") applyKey(edit, character.charCodeAt(0), 6, fits);
    expect(edit.text).toBe("X1234b");
    // Un code étendu (flèche, touche de fonction) n'est pas un caractère.
    expect(applyKey(edit, SciKey.PageUp, 6, fits)).toBe(EditResult.None);
    expect(applyKey(edit, KEY_CLEAR, 6, fits)).toBe(EditResult.TextChanged);
    expect([edit.text, edit.cursor]).toEqual(["", 0]);
    for (const character of "0123456789") applyKey(edit, character.charCodeAt(0), 26, fits);
    expect(edit.text).toBe("01234567");
  });

  it("texte venu de la page : coupé à ce qui tient, curseur à la fin", () => {
    const edit = newEditState("Ancien");
    expect(replaceEditText(edit, "Chez Gabriel", 26, fits)).toBe(EditResult.TextChanged);
    expect([edit.text, edit.cursor, edit.changed, edit.clearOnInput]).toEqual(["Chez Gab", 8, true, false]);
    expect(replaceEditText(edit, "Chez Gab", 26, fits)).toBe(EditResult.None);
  });
});

describe("fichiers du jeu sans sauvegarde", () => {
  function files(): { files: GameFiles; storage: MemoryStorage } {
    const storage = new MemoryStorage();
    const store: SaveStore = {
      storage,
      slots: new SaveSlots<SaveImage>(storage, { count: SAVE_SLOT_COUNT, parse: parseSaveImage, name: "test" }),
      now: () => 0,
      restarting: 0,
      saveDir: 0,
      restored: [],
    };
    return { files: new GameFiles(store), storage };
  }

  it("un fichier écrit se relit, se déplace, se renomme, se liste et s'efface, dans le stockage", () => {
    const { files: fs, storage } = files();
    expect(fs.exists("C:\\SIERRA\\gk.log")).toBe(false);
    expect(fs.openFile("gk.log", FileMode.OpenOrFail)).toBe(-1);
    const handle = fs.openFile("C:\\SIERRA\\gk.log", FileMode.Create);
    expect(handle).toBe(1);
    expect(fs.write(handle, Uint8Array.from("un\r\ndeux\ntrois", (c) => c.charCodeAt(0)))).toBe(14);
    expect(fs.seek(handle, 0, 0)).toBe(0);
    expect([fs.readLine(handle, 80), fs.readLine(handle, 3), fs.readLine(handle, 80), fs.readLine(handle, 80), fs.readLine(handle, 80)]).toEqual(["un", "de", "ux", "trois", undefined]);
    expect(fs.seek(handle, -5, 2)).toBe(9);
    expect([...fs.read(handle, 100)]).toEqual([..."trois"].map((c) => c.charCodeAt(0)));
    expect(fs.close(handle)).toBe(true);
    expect(fs.close(handle)).toBe(false);
    expect(storage.get("files")).toBe('["GK.LOG"]');
    expect(storage.get("file:GK.LOG")).not.toBeNull();

    // Mode 0 : ouvre à la fin, pour ajouter.
    const append = fs.openFile("GK.LOG", FileMode.OpenOrCreate);
    fs.write(append, Uint8Array.of(0x21));
    fs.close(append);
    const again = fs.openFile("gk.log", FileMode.OpenOrFail);
    expect(fs.read(again, 100).length).toBe(15);
    fs.close(again);

    expect(fs.rename("gk.log", "old.log")).toBe(true);
    expect(fs.rename("gk.log", "other.log")).toBe(false);
    expect([fs.exists("gk.log"), fs.exists("OLD.LOG")]).toEqual([false, true]);
    fs.close(fs.openFile("note.txt", FileMode.Create));
    expect([fs.findFirst("*.LOG"), fs.findNext()]).toEqual(["OLD.LOG", undefined]);
    expect([fs.findFirst("*.*"), fs.findNext(), fs.findNext()]).toEqual(["NOTE.TXT", "OLD.LOG", undefined]);
    expect(fs.unlink("old.log")).toBe(true);
    expect(fs.unlink("old.log")).toBe(false);
    expect(storage.get("file:OLD.LOG")).toBeNull();
  });

  it("un fichier fourni par la page se lit et ne s'écrit pas ; sans sauvegarde, pas de catalogue ; « buster » existe", () => {
    const { files: fs } = files();
    expect(fs.openFile("version", FileMode.OpenOrFail)).toBe(-1);
    fs.provide("VERSION", Uint8Array.from("01.100.000\r\n", (c) => c.charCodeAt(0)));
    const handle = fs.openFile("version", FileMode.OpenOrFail);
    expect(fs.readLine(handle, 11)).toBe("01.100.000");
    expect(fs.write(handle, Uint8Array.of(1))).toBe(-1);
    expect(fs.openFile("version", FileMode.Create)).toBe(-1);
    expect(fs.exists(saveCatalogueName("GK"))).toBe(false);
    expect(fs.openFile(saveCatalogueName("GK"), FileMode.OpenOrCreate)).toBe(-1);
    expect(fs.exists(saveFileName("GK", 0))).toBe(false);
    expect(fs.unlink(saveFileName("GK", 0))).toBe(false);
    expect(fs.exists("buster")).toBe(true);
    expect(fs.openFile("", FileMode.Create)).toBe(-1);
  });
});

// -------------------------------------------------------------------------------------------------------------------------------
// Avec les fichiers du jeu
// -------------------------------------------------------------------------------------------------------------------------------

describe.skipIf(!original.has)("sauvegardes sur le jeu réel", () => {
  it("aller-retour dans la librairie : après la reprise, les mêmes images et le même état qu'en continuant", { timeout: 120_000 }, () => {
    const storage = new MemoryStorage();
    const vm = resume(images().bookshop, storage);
    step(vm, 30);
    expect(canSaveGame(vm)).toBe(true);
    expect(saveToSlot(vm, 3, "Librairie", "01.100.000")).toBe(true);
    const stored = saveStoreOf(vm).slots.read(3)!;
    expect([stored.savedAt, stored.save.name, stored.save.gameVersion, stored.save.room]).toEqual([1000, "Librairie", "01.100.000", BOOKSHOP]);
    // Une image tient largement dans le stockage du navigateur (20 emplacements).
    expect(storage.get("slot03")!.length).toBeLessThan(150_000);

    // A : la partie continue. Gabriel marche (un clic), la musique joue, l'horloge avance.
    const frames = playOn(vm);
    const state = stateOf(vm);
    expect(new Set(frames).size).toBeGreaterThan(30);

    // B : reprise en place, dans la même machine virtuelle.
    expect(loadFromSlot(vm, 3)).toBe(true);
    expect(playOn(vm)).toEqual(frames);
    expect(stateOf(vm)).toBe(state);

    // C : reprise dans une machine neuve (« Continuer » de la page), sans `boot`.
    const fresh = newVm(storage);
    expect(loadLatestSave(fresh)).toBe(true);
    expect(currentRoom(fresh)).toBe(BOOKSHOP);
    expect(playOn(fresh)).toEqual(frames);
    expect(stateOf(fresh)).toBe(state);
    expect(fresh.kernel.journal.stubs.size).toBe(0);
  });

  it("sauver par la fenêtre du jeu : le nom se tape au clavier, la page est prévenue de la saisie", { timeout: 120_000 }, () => {
    const saved = saveByWindow();
    const slots = new SaveSlots<SaveImage>(saved.storage, { count: SAVE_SLOT_COUNT, parse: parseSaveImage, name: "test" });
    const stored = slots.read(1)!;
    expect([stored.save.name, stored.save.room, stored.savedAt]).toEqual(["Librairie", BOOKSHOP, 1000]);
    expect(slots.summaries(() => "plein", () => "vide").filter((summary) => !summary.empty)).toHaveLength(1);
    // Le champ de saisie du jeu, tel que la page le reçoit pour y poser le sien au toucher.
    expect(saved.requests).toEqual([{ text: "", maxLength: 26, rect: { left: 37, top: 69, right: 198, bottom: 81 } }]);
    expect(saved.closed).toBe(1);
    // Après la sauvegarde la fenêtre se referme et Gabriel marche : la partie continue.
    expect(new Set(saved.frames).size).toBeGreaterThan(30);
  });

  it("sauver au toucher : le texte de la page remplace celui du champ, et une image prise pendant la saisie la reprend", { timeout: 120_000 }, () => {
    const storage = new MemoryStorage();
    const vm = resume(images().bookshop, storage);
    step(vm, 5);
    openSaveWindow(vm);
    const entry = textEntryOf(vm);
    expect(entry.current?.maxLength).toBe(26);
    entry.replaceText("Chez Gab");
    step(vm, 2);

    // Sauvegarde par le menu de la page en pleine saisie, puis reprise ailleurs : le champ est rouvert avec son texte.
    expect(saveToSlot(vm, 7, "en cours")).toBe(true);
    const other = newVm(storage);
    const requests: TextEntryRequest[] = [];
    textEntryOf(other).host = { opened: (request) => requests.push(request), closed: () => {} };
    expect(loadFromSlot(other, 7)).toBe(true);
    step(other, 2);
    step(vm, 2);
    expect(requests.map((request) => request.text)).toEqual(["Chez Gab"]);

    for (const target of [vm, other]) {
      textEntryOf(target).replaceText("Chez Gabriel, é ☺");
      step(target, 2);
      eventsOf(target).keyDown(SciKey.Enter);
      for (let frames = 0; textEntryOf(target).current; frames++) {
        expect(frames).toBeLessThan(100);
        step(target);
      }
      step(target, 30);
    }
    // « é » passe en CP850 (0x82), le caractère inconnu est retiré ; le nom est privé de son blanc final.
    expect(saveStoreOf(vm).slots.read(1)!.save.name).toBe("Chez Gabriel, \x82");
    // La machine reprise a fini la même saisie : elle a écrit par-dessus, dans le même emplacement.
    expect(stateOf(other)).toBe(stateOf(vm));
  });

  it("la fenêtre de sauvegarde se rouvre au même endroit (son script est déchargé à chaque fermeture)", { timeout: 120_000 }, () => {
    const vm = resume(images().bookshop);
    step(vm, 5);
    const rects: unknown[] = [];
    for (let round = 0; round < 3; round++) {
      openSaveWindow(vm);
      rects.push(textEntryOf(vm).current?.rect);
      eventsOf(vm).keyDown(SciKey.Escape);
      step(vm, 60);
      expect(textEntryOf(vm).current).toBeUndefined();
      expect(vm.scripts.loaded(64990)).toBeUndefined();
    }
    expect(rects).toEqual(Array(3).fill({ left: 37, top: 69, right: 198, bottom: 81 }));
  });

  it("RETABLIR à l'écran titre : la fenêtre du jeu reprend la partie, à l'identique", { timeout: 120_000 }, () => {
    const saved = saveByWindow();
    const vm = resume(images().title, saved.storage);
    step(vm, 5);
    expect(currentRoom(vm)).toBe(TITLE_ROOM);
    clickItem(vm, "restoreButt");
    step(vm, 40);
    // La liste de la fenêtre porte le nom de la sauvegarde, lu par `GetSaveFiles`.
    expect(vm.backtrace().some((line) => line.startsWith("Restore::doit"))).toBe(true);
    eventsOf(vm).keyDown(SciKey.Enter);
    for (let frames = 0; currentRoom(vm) !== BOOKSHOP; frames++) {
      if (frames > 100) throw new Error("la fenêtre du jeu n'a pas repris la partie");
      step(vm);
    }
    expect([frameHash(vm), ...playOn(vm)]).toEqual(saved.frames);
    expect(stateOf(vm)).toBe(saved.state);
    expect(vm.kernel.journal.stubs.size).toBe(0);
  });

  it("FileIO et le catalogue : les sauvegardes vues comme les fichiers d'origine", { timeout: 120_000 }, () => {
    const storage = new MemoryStorage();
    const vm = resume(images().bookshop, storage);
    step(vm, 5);
    const SIGNAL = 0xffff;
    const catalogue = stringReg(vm, saveCatalogueName("GK"));
    const FILE_IO = { open: 0, close: 1, readRaw: 2, unlink: 4, readString: 5, exists: 10 };

    // Aucune sauvegarde : pas de catalogue (la fenêtre du jeu l'ouvre pour le savoir), aucun nom.
    expect(callKernel(vm, "FileIO", FILE_IO.open, catalogue)).toBe(SIGNAL);
    expect(callKernel(vm, "FileIO", FILE_IO.exists, catalogue)).toBe(0);
    const names = allocate(vm, new SciArray(ArrayType.String, 1));
    const numbers = allocate(vm, new SciArray(ArrayType.Int16, 1));
    expect(callKernel(vm, "GetSaveFiles", stringReg(vm, "GK"), names, numbers)).toBe(0);

    expect(saveToSlot(vm, 1, "Premi\x8are")).toBe(true);
    expect(saveToSlot(vm, 6, "Une sauvegarde au nom bien trop long pour le jeu")).toBe(true);
    expect(callKernel(vm, "GetSaveFiles", stringReg(vm, "GK"), names, numbers)).toBe(2);
    const nameArray = vm.memory.array(names);
    expect(nameArray.size).toBe(2 * SAVE_NAME_LENGTH + 1);
    const nameAt = (index: number): string => {
      let text = "";
      for (let i = 0; i < SAVE_NAME_LENGTH && nameArray.get(index * SAVE_NAME_LENGTH + i) !== 0; i++) text += String.fromCharCode(nameArray.get(index * SAVE_NAME_LENGTH + i));
      return text;
    };
    expect([nameAt(0), nameAt(1)]).toEqual(["Premi\x8are", "Une sauvegarde au nom bien trop long"]);
    expect([0, 1, 2].map((i) => vm.memory.array(numbers).get(i))).toEqual([0, 5, 0]);

    // Le catalogue, dans le format d'origine : numéro, 36 octets de nom, et 0xFFFF pour finir.
    expect(callKernel(vm, "FileIO", FILE_IO.exists, catalogue)).toBe(1);
    const handle = callKernel(vm, "FileIO", FILE_IO.open, catalogue);
    expect(handle).toBe(1);
    const buffer = allocate(vm, new SciArray(ArrayType.Byte, 0));
    const entry = 2 + SAVE_NAME_LENGTH;
    expect(callKernel(vm, "FileIO", FILE_IO.readRaw, handle, buffer, 200)).toBe(2 * entry + 2);
    const bytes = Array.from({ length: 2 * entry + 2 }, (_, i) => vm.memory.array(buffer).get(i));
    expect([bytes[0], bytes[1], bytes[entry], bytes[entry + 1], bytes[2 * entry], bytes[2 * entry + 1]]).toEqual([0, 0, 5, 0, 0xff, 0xff]);
    expect(String.fromCharCode(...bytes.slice(2, 10))).toBe("Premi\x8are");
    expect(callKernel(vm, "FileIO", FILE_IO.close, handle)).toBe(1);
    expect(callKernel(vm, "FileIO", FILE_IO.close, handle)).toBe(0);
    expect(gameFilesOf(vm).openCount).toBe(0);

    // Les noms d'origine, et l'effacement d'une sauvegarde par `Unlink`, comme le fait la fenêtre du jeu.
    const fileName = allocate(vm, new SciArray(ArrayType.String, 1));
    callKernel(vm, "MakeSaveFileName", fileName, stringReg(vm, "GK"), 5);
    expect(vm.memory.getString(fileName)).toBe("GKsg.005");
    expect(callKernel(vm, "FileIO", FILE_IO.exists, fileName)).toBe(1);
    expect(callKernel(vm, "CheckSaveGame", stringReg(vm, "GK"), 5, stringReg(vm, "01.100.000"))).toBe(1);
    expect(callKernel(vm, "FileIO", FILE_IO.unlink, fileName)).toBe(1);
    expect(callKernel(vm, "FileIO", FILE_IO.unlink, fileName)).toBe(0);
    expect(saveStoreOf(vm).slots.read(6)).toBeNull();
    expect(callKernel(vm, "CheckSaveGame", stringReg(vm, "GK"), 5, stringReg(vm, "01.100.000"))).toBe(0);
    expect(callKernel(vm, "GetSaveFiles", stringReg(vm, "GK"), names, numbers)).toBe(1);

    // `version` : absent tant que la page ne le fournit pas ; ensuite lu comme le script 0 le lit.
    const version = stringReg(vm, "version");
    expect(callKernel(vm, "FileIO", FILE_IO.open, version, FileMode.OpenOrFail)).toBe(SIGNAL);
    gameFilesOf(vm).provide("VERSION", Uint8Array.from("01.100.000\r\n", (c) => c.charCodeAt(0)));
    const versionHandle = callKernel(vm, "FileIO", FILE_IO.open, version, FileMode.OpenOrFail);
    const line = stringReg(vm, "xx.yyy.zzz");
    expect(callKernel(vm, "FileIO", FILE_IO.readString, line, 11, versionHandle)).toBe(line);
    expect(vm.memory.getString(line)).toBe("01.100.000");
    // La fin de ligne restée derrière les dix caractères fait une ligne vide, puis c'est la fin du fichier.
    expect(callKernel(vm, "FileIO", FILE_IO.readString, line, 11, versionHandle)).toBe(line);
    expect(vm.memory.getString(line)).toBe("");
    expect(callKernel(vm, "FileIO", FILE_IO.readString, line, 11, versionHandle)).toBe(0);

    // Dossier des sauvegardes : un tableau de caractères, toujours le même ; chemin valable, place libre.
    const directory = callKernel(vm, "GetSaveDir");
    expect(vm.memory.getString(directory)).toBe("");
    expect(callKernel(vm, "GetSaveDir")).toBe(directory);
    expect([callKernel(vm, "ValidPath", directory), callKernel(vm, "CheckFreeSpace", directory, 2), callKernel(vm, "GameIsRestarting")]).toEqual([1, 1, 0]);
    // Une reprise ferme les fichiers restés ouverts.
    expect(gameFilesOf(vm).openCount).toBe(1);
    expect(loadFromSlot(vm, 1)).toBe(true);
    expect(gameFilesOf(vm).openCount).toBe(0);
  });

  it("une sauvegarde d'une autre version, ou abîmée, est refusée sans toucher à la partie", { timeout: 120_000 }, () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = new MemoryStorage();
    const vm = resume(images().bookshop, storage);
    step(vm, 5);
    expect(saveToSlot(vm, 2, "Bonne")).toBe(true);
    const good = storage.get("slot02")!;
    const before = stateOf(vm);

    // Autre version du format : l'emplacement est vide pour tout le monde.
    storage.set("slot02", good.replace(`"version":${SAVE_VERSION}`, `"version":${SAVE_VERSION + 1}`));
    expect(saveStoreOf(vm).slots.read(2)).toBeNull();
    expect(loadFromSlot(vm, 2)).toBe(false);
    expect(loadLatestSave(vm)).toBe(false);
    expect(callKernel(vm, "CheckSaveGame", stringReg(vm, "GK"), 1, 0)).toBe(0);
    expect(callKernel(vm, "RestoreGame", stringReg(vm, "GK"), 1, 0)).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(parseSaveImage({ ...images().bookshop, format: "autre" })).toBeNull();
    expect(parseSaveImage({ ...images().bookshop, memory: undefined })).toBeNull();
    expect(parseSaveImage(images().bookshop)).not.toBeNull();

    // Bonne version mais contenu abîmé (pile tronquée) : la reprise échoue et l'état d'avant est rétabli.
    const broken = JSON.parse(good) as { savedAt: number; save: SaveImage };
    broken.save.memory.stack = packWords(new Uint32Array(16));
    storage.set("slot02", JSON.stringify(broken));
    expect(loadFromSlot(vm, 2)).toBe(false);
    expect(callKernel(vm, "RestoreGame", stringReg(vm, "GK"), 1, 0)).toBe(0);
    expect([...vm.warnings.keys()].some((message) => message.includes("pile d'une autre taille"))).toBe(true);
    // Les chaînes d'essai allouées par ce test mises à part, rien n'a changé : la partie continue comme si de rien n'était.
    const reference = resume(JSON.parse(before) as SaveImage, storage);
    const after = resume(JSON.parse(stateOf(vm)) as SaveImage, storage);
    expect(play(after, 60)).toEqual(play(reference, 60));

    // Version du jeu différente : `CheckSaveGame` refuse, la fenêtre du jeu ne reprend pas.
    storage.set("slot02", good.replace('"gameVersion":""', '"gameVersion":"01.000.000"'));
    expect(callKernel(vm, "CheckSaveGame", stringReg(vm, "GK"), 1, stringReg(vm, "01.100.000"))).toBe(0);
    expect(callKernel(vm, "CheckSaveGame", stringReg(vm, "GK"), 1, stringReg(vm, "01.000.000"))).toBe(1);
  });

  it("une image forgée (longueur de table ou taille de tableau démesurée, indice hors table) est refusée, l'état d'avant rétabli", { timeout: 120_000 }, () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const vm = resume(images().bookshop);
    step(vm, 5);
    const before = stateOf(vm);
    const forgeries: ((image: SaveImage) => void)[] = [
      (image) => (image.memory.arrays.length = 4e9),
      (image) => (image.memory.clones.length = -1),
      (image) => image.memory.lists.index.push(1e9),
      (image) => {
        image.memory.arrays.index.push(image.memory.arrays.length);
        image.memory.arrays.length++;
        image.memory.arrays.types.push(ArrayType.Byte);
        image.memory.arrays.sizes.push(65535);
      },
      (image) => (image.memory.bitmaps.widths = [1e9]),
      (image) => (image.memory.stack = "4000000000:AAAA"),
    ];
    for (const forge of forgeries) {
      const image = JSON.parse(before) as SaveImage;
      forge(image);
      expect(() => restoreGame(vm, image)).toThrow();
    }
    expect(stateOf(vm)).toBe(before);
  });

  it("pas de sauvegarde pendant une cinématique ; RestartGame ramène à l'écran titre", { timeout: 120_000 }, () => {
    const vm = resume(images().bookshop);
    step(vm, 5);
    seqPlayerOf(vm).play("MAP.SEQ", 7, 0, 0);
    expect(canSaveGame(vm)).toBe(false);
    expect(saveToSlot(vm, 1, "refusée")).toBe(false);
    expect(callKernel(vm, "SaveGame", stringReg(vm, "GK"), 0, stringReg(vm, "refusée"), 0)).toBe(0);
    expect(() => captureGame(vm)).toThrow(/cinématique/);
    seqPlayerOf(vm).cancel();
    expect(canSaveGame(vm)).toBe(true);

    restartGame(vm);
    expect(saveStoreOf(vm).restarting).toBe(1);
    expect(currentRoom(vm)).toBe(0);
    for (let frames = 0; !(currentRoom(vm) === TITLE_ROOM && item(vm, "playButt")); frames++) {
      if (frames > 5000) throw new Error("écran titre introuvable après le redémarrage");
      step(vm);
    }
    // Les scripts ont lu le drapeau puis l'ont remis à zéro (`GameIsRestarting(0)`).
    expect(saveStoreOf(vm).restarting).toBe(0);
    expect(vm.kernel.journal.stubs.size).toBe(0);
  });
});
