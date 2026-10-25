import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodePng } from "../../scripts/lib/png.mjs";
import { Lcg } from "../../src/engine/rng";
import { readDefaultPalette } from "../../src/games/armaeth/data/palette";
import { readScene, type Scene } from "../../src/games/armaeth/data/scene";
import type { Sprite, SpriteFig } from "../../src/games/armaeth/data/sprite";
import { SPRITE_FAMILIES, parseDef } from "../../src/games/armaeth/data/tables";
import { readCountedArchive, readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import type { World } from "../../src/games/armaeth/data/world";
import { type SpriteKey, type SpriteSource, SpriteLibrary, loadObjectSprite } from "../../src/games/armaeth/engine/animation";
import { loadRoom } from "../../src/games/armaeth/engine/room";
import { loadWorldState } from "../../src/games/armaeth/engine/save";
import { RAW_OFFSET, type GameObject, WorldState, rawU8, setRawU8 } from "../../src/games/armaeth/engine/state";
import {
  ERR_TRANSIT,
  EngineAbort,
  type UpdateHooks,
  applyDrawCommands,
  clearBehaviors,
  drawList,
  runFrame,
  updateList,
  updateObject,
} from "../../src/games/armaeth/engine/update";
import { Compositor } from "../../src/games/armaeth/render/compositor";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { vga6ToRgb8 } from "../../src/ui/indexed-canvas";

function emptyWorld(): World {
  const room = (id: number) => ({
    id, lightOffset: 0, outdoor: 1, musicClass: 0x4d, musicId: 0, musicNumber: 0, exits: [0, 0, 0, 0, 0, 0], barriers: [0, 0, 0, 0, 0, 0], words: new Array(21).fill(0),
  });
  return {
    header: { words: new Array(27).fill(0), lastSerial: 0, dictionaryLetters: 8, chapterLevel: 3, score: 0, heroSerial: 0, currentRoom: 1, objectCount: 0, roomCount: 3 },
    scoreTable: [{ id: 0, points: 10, sound: 0, repeats: 0 }],
    deferredEvents: { capacity: 4, events: [] },
    rooms: [room(0), room(1), room(2)],
    objects: [],
  };
}

/** Ressource à une Fig : deux images de 1 tic dans les quatre directions. */
function blinker(): Sprite {
  const seq = { start: 0, headerHigh: 0, steps: [{ frame: 0, duration: 1, mirror: false }, { frame: 1, duration: 1, mirror: false }] };
  const fig: SpriteFig = { index: 0, mirrorLeft: 0, dpX: 1, dpY: 1, directions: [seq, seq, seq, seq] };
  const frames = [0, 1].map(() => ({ width: 2, height: 2, pixels: new Uint8Array(4) }));
  return { id: 0, frames, animation: { records: 1, words: 0, bytes: new Uint8Array(), figs: [fig] }, memoryPointers: new Uint8Array() };
}

const sprites: SpriteSource = { get: (key: SpriteKey) => (key.family === "ANM" ? undefined : blinker()) };

interface Probe {
  state: WorldState;
  hooks: UpdateHooks;
  log: string[];
  procs: Map<number, (obj: GameObject) => number>;
  fired: number[];
}

/** État à deux salles, salle 1 chargée, avec des mouchards à la place du mouvement et des procédures. */
function probe(): Probe {
  const state = new WorldState(emptyWorld());
  state.loadedRoom = state.wantedRoom = state.rooms[1];
  const log: string[] = [];
  const procs = new Map<number, (obj: GameObject) => number>();
  const fired: number[] = [];
  const hooks: UpdateHooks = {
    sprites,
    mover: { move: (o) => log.push(`move ${o.num}`), reset: (o) => log.push(`reset ${o.num}`) },
    behaviors: { resolve: (o) => procs.get(o.num) },
    fire: (e) => fired.push(e.event),
  };
  return { state, hooks, log, procs, fired };
}

function put(p: Probe, num: number, fields: Partial<GameObject> = {}, room = 1): GameObject {
  const obj = p.state.createObject({ typ: 2, num, ...fields });
  p.state.moveToRoom(obj, p.state.rooms[room]);
  return obj;
}

describe("updateObject", () => {
  it("Mob 1 : un pas d'animation dans la salle chargée, aucun ailleurs ; Mob 2 : déplacement si l'objet est dans une salle", () => {
    const p = probe();
    const here = put(p, 1, { mob: 1, speedX: 1 });
    const there = put(p, 2, { mob: 1, speedX: 1 }, 2);
    const mover = put(p, 3, { mob: 2 }, 2);
    const held = p.state.createObject({ typ: 2, num: 4, mob: 2 });
    p.state.moveToContainer(held, here);
    for (const o of [here, there]) loadObjectSprite(o, sprites);
    updateObject(p.state, here, p.hooks);
    updateObject(p.state, there, p.hooks);
    expect(here.anim.frame).toBe(1);
    expect(there.anim.frame).toBe(0);
    updateObject(p.state, mover, p.hooks);
    updateObject(p.state, held, p.hooks);
    expect(p.log).toEqual(["move 3"]);
  });

  it("icône d'inventaire (Xyp 8 ou 0x0B) animée hors de la salle", () => {
    const p = probe();
    const icon = put(p, 5, { mob: 1, presence: 8, speedX: 1 }, 2);
    loadObjectSprite(icon, sprites);
    updateObject(p.state, icon, p.hooks);
    expect(icon.anim.frame).toBe(1);
  });

  it("Err 0x12 : le héros est laissé en paix, les autres voient leur mouvement annulé", () => {
    const p = probe();
    const hero = put(p, 1, { gst: 0 });
    p.state.setHero(hero);
    const other = put(p, 2);
    setRawU8(hero, RAW_OFFSET.err, ERR_TRANSIT);
    setRawU8(other, RAW_OFFSET.err, ERR_TRANSIT);
    expect(updateObject(p.state, hero, p.hooks)).toBe(7);
    expect(rawU8(hero, RAW_OFFSET.err)).toBe(ERR_TRANSIT);
    updateObject(p.state, other, p.hooks);
    expect(rawU8(other, RAW_OFFSET.err)).toBe(0);
    expect(p.log).toEqual(["reset 2"]);
  });

  it("résout la procédure une fois (table selon Typ), la mémorise et rend sa valeur ; absente : arrêt du moteur", () => {
    const p = probe();
    const tables: number[] = [];
    p.hooks.behaviors = { resolve: (o, t) => (tables.push(t), () => o.num) };
    const obj = put(p, 9, { gst: 7 });
    const decor = p.state.createObject({ typ: 1, num: 3, gst: 7 });
    p.state.moveToRoom(decor, p.state.rooms[1]);
    const ui = p.state.interfaceObjects[0] ?? p.state.createObject({ typ: 0, num: 6, gst: 7 });
    expect(updateObject(p.state, obj, p.hooks)).toBe(9);
    expect(updateObject(p.state, obj, p.hooks)).toBe(9);
    updateObject(p.state, decor, p.hooks);
    updateObject(p.state, ui, p.hooks);
    expect(tables).toEqual([2, 3, 7]);
    clearBehaviors(p.state, 0);
    expect(obj.behavior).toBeNull();
    p.hooks.behaviors = { resolve: () => undefined };
    expect(() => updateObject(p.state, put(p, 10, { gst: 7 }), p.hooks)).toThrow(EngineAbort);
  });
});

describe("updateList : parcours et reprise en tête", () => {
  it("parcourt dans l'ordre de la liste (inverse de la création)", () => {
    const p = probe();
    const order: number[] = [];
    for (const n of [1, 2, 3]) {
      p.procs.set(n, () => (order.push(n), 7));
      put(p, n, { gst: 7 });
    }
    updateList(p.state, () => p.state.objects, p.hooks);
    expect(order).toEqual([3, 2, 1]);
  });

  it("un objet qui rend 0 fait recommencer la liste : les précédents sont mis à jour deux fois", () => {
    const p = probe();
    const order: number[] = [];
    let first = true;
    p.procs.set(1, () => (order.push(1), 7));
    p.procs.set(2, () => {
      order.push(2);
      if (first) {
        first = false;
        return 0;
      }
      return 7;
    });
    p.procs.set(3, () => (order.push(3), 7));
    for (const n of [1, 2, 3]) put(p, n, { gst: 7 });
    updateList(p.state, () => p.state.objects, p.hooks);
    expect(order).toEqual([3, 2, 3, 2, 1]);
  });

  it("un objet qui détruit son suivant relance le parcours en tête", () => {
    const p = probe();
    const order: number[] = [];
    p.procs.set(1, () => (order.push(1), 7));
    p.procs.set(2, () => {
      order.push(2);
      const next = p.state.findByNum(1);
      if (next) p.state.deleteObject(next);
      return 7;
    });
    p.procs.set(3, () => (order.push(3), 7));
    for (const n of [1, 2, 3]) put(p, n, { gst: 7 });
    updateList(p.state, () => p.state.objects, p.hooks);
    expect(order).toEqual([3, 2, 3, 2]);
  });

  it("une procédure qui rend toujours 0 est arrêtée", () => {
    const p = probe();
    p.procs.set(1, () => 0);
    put(p, 1, { gst: 7 });
    expect(() => updateList(p.state, () => p.state.objects, p.hooks)).toThrow(/sans fin/);
  });
});

describe("runFrame", () => {
  it("rend reload tant que la salle voulue n'est pas chargée, en ne mettant à jour que l'interface", () => {
    const p = probe();
    const ui = p.state.createObject({ typ: 0, num: 6, gst: 7 });
    let n = 0;
    p.procs.set(6, () => (n++, 7));
    p.state.wantedRoom = p.state.rooms[2];
    expect(runFrame(p.state, p.hooks).status).toBe("reload");
    expect(n).toBe(1);
    expect(ui.behavior).not.toBeNull();
  });

  it("première image : décors seulement, ni objets ni horloge ; ensuite un tic toutes les délai + 1 images", () => {
    const p = probe();
    const seen: string[] = [];
    p.procs.set(1, () => (seen.push("objet"), 7));
    p.procs.set(2, () => (seen.push("décor"), 7));
    put(p, 1, { gst: 7 });
    const decor = p.state.createObject({ typ: 1, num: 2, gst: 7 });
    p.state.moveToRoom(decor, p.state.rooms[1]);
    p.state.firstFrame = true;
    p.state.cadence.delay = 2;
    const clock = p.state.clock.ticks;
    const first = runFrame(p.state, p.hooks);
    expect(first).toMatchObject({ status: "ran", firstFrame: true, tick: true });
    expect(seen).toEqual(["décor"]);
    expect(p.state.clock.ticks).toBe(clock);
    const ticks: boolean[] = [];
    for (let i = 0; i < 6; i++) ticks.push(runFrame(p.state, p.hooks).tick);
    expect(ticks).toEqual([false, false, true, false, false, true]);
    expect(p.state.clock.ticks).toBe(clock + 2);
  });

  it("événements différés échus et horloge au tic ; touche = tic forcé ; pause = rien", () => {
    const p = probe();
    p.state.events.operate({ typ: 0, num: 0, serial: 0 }, 105, 3, 1, 2000);
    p.state.cadence.delay = 0;
    runFrame(p.state, p.hooks); // tic 1 : compteur 1 -> 0
    expect(p.fired).toEqual([]);
    const second = runFrame(p.state, p.hooks);
    expect(p.fired).toEqual([105]);
    expect(second.clock).toEqual({ minuteElapsed: false, paletteDirty: false });
    p.state.cadence.pause = 7;
    expect(runFrame(p.state, p.hooks).tick).toBe(false);
    expect(runFrame(p.state, p.hooks, { keyPressed: true }).tick).toBe(true);
  });

  it("l'horloge signale la minute et la palette à recalculer", () => {
    const p = probe();
    p.state.cadence.delay = 0;
    p.state.clock.ticks = 99;
    p.state.clock.minute = 9;
    const seen: boolean[] = [];
    p.hooks.onClock = (a) => seen.push(a.paletteDirty);
    runFrame(p.state, p.hooks);
    expect(p.state.clock).toMatchObject({ minute: 10, ticks: 0 });
    expect(seen).toEqual([true]);
  });
});

describe("drawList", () => {
  it("ordre des passes, filtres Xyp / Mob, miroir, fantôme et priorité", () => {
    const p = probe();
    const hero = put(p, 1, { mob: 2, presence: 2, x: 10, y: 20, p: 300, hidden: 5 });
    p.state.setHero(hero);
    const bag = p.state.createObject({ typ: 2, num: 2, mob: 1, presence: 8, x: 1, y: 2, p: 3 });
    p.state.moveToContainer(bag, hero);
    const sel = p.state.createObject({ typ: 2, num: 3, mob: 0, presence: 8, x: 4, y: 5, p: 6 });
    const chest = put(p, 4, { mob: 0, presence: 2, x: 7, y: 8, p: 9 });
    p.state.moveToContainer(sel, chest);
    p.state.selected = chest;
    const cursor = p.state.createObject({ typ: 0, num: 5, mob: 1, presence: 6, x: 50, y: 60, p: 250 });
    const decor = p.state.createObject({ typ: 1, num: 6, mob: 0, presence: 2, x: 11, y: 12, p: 13 });
    p.state.moveToRoom(decor, p.state.rooms[1]);
    const absent = put(p, 7, { mob: 1, presence: 0 });
    for (const o of [hero, bag, sel, chest, cursor, decor, absent]) o.anim.frame = 1;
    hero.anim.mirror = 1;
    const dyn = drawList(p.state, "dynamic").map((c) => c.serial);
    // sélection (aucune dynamique), interface, inventaire, décors (aucun dynamique), objets
    expect(dyn).toEqual([cursor.serial, bag.serial, hero.serial]);
    const stat = drawList(p.state, "static").map((c) => c.serial);
    expect(stat).toEqual([sel.serial, decor.serial, chest.serial]);
    const all = drawList(p.state);
    expect(all).toHaveLength(6);
    const heroCommand = all.find((c) => c.serial === hero.serial)!;
    expect(heroCommand).toMatchObject({ x: 10, y: 20, priority: 300 & 0xff, flip: true, ghost: 5, relative: true, dynamic: true, resource: { family: "OBJ", id: 1 }, frame: 1 });
    expect(all.find((c) => c.serial === cursor.serial)).toMatchObject({ relative: false, resource: { family: "INT", id: 5 } });
    // sans image choisie : pas de commande
    hero.anim.frame = -1;
    expect(drawList(p.state, "dynamic").map((c) => c.serial)).not.toContain(hero.serial);
  });
});

function loadScene(id: number): Scene {
  const file = `A1F${String(Math.floor(id / 100)).padStart(2, "0")}${String.fromCharCode(65 + Math.floor((id % 100) / 5))}.VGA`;
  return readScene(readSceneArchive(readOriginal(file)).bytes(id));
}

describe.skipIf(!hasOriginalFiles)("liste de dessin des salles du jeu", () => {
  const archives = Object.fromEntries(SPRITE_FAMILIES.map((f) => [f, readCountedArchive(readOriginal(`A1F${f}.VGA`))])) as ConstructorParameters<typeof SpriteLibrary>[0];
  const library = new SpriteLibrary(archives, parseDef(readOriginal("A1FDEF.SYS")));

  function enter(id: number) {
    const state = loadWorldState(readOriginal("A1FCFG.SYS"));
    state.wantedRoom = state.roomById(id)!;
    const scene = loadScene(id);
    const loaded = loadRoom(state, scene, { sprites: library, rand: () => new Lcg(1).next() });
    return { state, scene, loaded };
  }

  it.each([2, 3, 8])("salle %i : une commande par objet et par décor, aux positions de CFG et de la scène", (id) => {
    const { state, scene, loaded } = enter(id);
    expect(state.loadedRoom).toBe(loaded.room);
    const commands = drawList(state, "all");
    for (const obj of loaded.room.listA) {
      const c = commands.find((k) => k.serial === obj.serial);
      expect(c, `objet ${obj.num}`).toMatchObject({ x: obj.x, y: obj.y, priority: obj.p & 0xff, resource: { family: "OBJ", id: obj.num }, relative: true, flip: false });
    }
    const decorCommands = commands.filter((k) => k.serial === 0);
    const expected = scene.decors.filter((d) => d.mob === 0 || d.mob !== 0).length;
    expect(loaded.room.listB).toHaveLength(expected);
    for (const d of scene.decors) {
      expect(decorCommands.some((k) => k.x === d.x && k.y === d.y && k.priority === (d.p & 0xff) && k.resource.id === d.num && k.resource.family === "DEC")).toBe(true);
    }
    // les objets statiques précèdent les dynamiques
    const firstDynamic = commands.findIndex((k) => k.dynamic);
    if (firstDynamic >= 0) expect(commands.slice(firstDynamic).every((k) => k.dynamic)).toBe(true);
  });

  it("compose une image de la salle 8 en PNG (scène, objets, décors, interface)", () => {
    const { state, scene, loaded } = enter(8);
    const c = new Compositor();
    c.setFrame(loadScene(0));
    c.drawScene(scene);
    const drawn = applyDrawCommands(c, drawList(state, "all"), library, loaded.origin);
    expect(drawn).toBeGreaterThan(5);
    c.present();
    // Image de contrôle écrite seulement si `ARMAETH_PNG_DIR` est défini (comme `engine.test.ts`).
    const dir = process.env.ARMAETH_PNG_DIR;
    if (!dir) return;
    const palette = vga6ToRgb8(readDefaultPalette(readOriginal("AM1.EXE")));
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/room8.png`, encodePng(320, 200, { indexed: c.screen.pixels, palette }));
  });
});
