import { describe, expect, it } from "vitest";
import type { World } from "../../src/games/armaeth/data/world";
import { loadWorldState, serializeWorld } from "../../src/games/armaeth/engine/save";
import { WorldState, readObjectField, writeObjectField } from "../../src/games/armaeth/engine/state";
import { hasOriginalFiles, readOriginal } from "./helpers";

/** Monde synthétique : 3 salles (0 = cadre), un objet d'interface, un héros dans la salle 1. */
function synthetic(): World {
  const raw = (): Uint8Array => new Uint8Array(144);
  const base = {
    gst: 0, mob: 0, dep: 0, txt: 0, light: 0, value: 0, weight: 0, capacity: 0, pickable: 0, canContain: 0, ego: 0, fig: 0, hidden: 0,
    animId: 0, presence: 0, plane: 0, x: 0, y: 0, p: 0, ground: 0, speedX: 0, speedY: 0, speedP: 0,
  };
  const room = (id: number, exits: number[]) => ({
    id, lightOffset: 0, outdoor: 1, musicClass: 0x4d, musicId: 0, musicNumber: 0, exits, barriers: [0, 0, 0, 0, 0, 0], words: new Array(21).fill(0),
  });
  return {
    header: {
      words: new Array(27).fill(0), lastSerial: 5, dictionaryLetters: 8, chapterLevel: 203, score: 0, heroSerial: 2, currentRoom: 101, objectCount: 4, roomCount: 3,
    },
    scoreTable: [
      { id: 0, points: 10, sound: 11, repeats: 0 },
      { id: 1, points: 20, sound: 0, repeats: 0 },
      { id: 2, points: -5, sound: 12, repeats: 2 },
      { id: 3, points: 0, sound: 0, repeats: 0 },
    ],
    deferredEvents: { capacity: 3, events: [] },
    rooms: [room(0, [0, 0, 0, 0, 0, 0]), room(101, [2, 0, 0, 0, 0, 0]), room(102, [0, 0, 1, 0, 0, 0])],
    objects: [
      { ...base, num: 1, serial: 1, typ: 0, location: 1, container: 0, raw: raw() },
      { ...base, num: 1, serial: 2, typ: 2, location: 1, container: 101, raw: raw() },
      { ...base, num: 9, serial: 3, typ: 2, location: 2, container: 2, raw: raw() },
      { ...base, num: 9, serial: 4, typ: 2, location: 1, container: 102, raw: raw() },
    ],
  };
}

describe("état du monde : cas synthétiques", () => {
  it("construit les listes en tête (parcours inverse de la création) et résout les liens", () => {
    const s = new WorldState(synthetic());
    expect(s.interfaceObjects.map((o) => o.serial)).toEqual([1]);
    expect(s.objects.map((o) => o.serial)).toEqual([4, 3, 2]);
    expect(s.hero?.serial).toBe(2);
    expect(s.hero?.contents.map((o) => o.serial)).toEqual([3]);
    expect(s.findBySerial(3)?.holder).toBe(s.hero);
    expect(s.roomById(101)?.listA.map((o) => o.serial)).toEqual([2]);
    expect(s.roomByIndex(0)?.listA).toEqual([]);
    expect(s.findBySerial(1)).toMatchObject({ room: s.rooms[0], location: 1 });
    expect(s.findByNum(9)?.serial).toBe(4);
    expect(s.findAllByNum(9).map((o) => o.serial)).toEqual([4, 3]);
    expect([s.chapter, s.level]).toEqual([2, 3]);
  });

  it("sorties, barrages et salle courante", () => {
    const s = new WorldState(synthetic());
    const r1 = s.roomById(101)!;
    expect(s.neighbour(r1, 0)?.id).toBe(102);
    expect(s.neighbour(r1, 1)).toBeUndefined();
    expect(s.neighbour(r1, 9)).toBeUndefined();
    expect(s.barrier(r1, 0)).toBe(0);
    expect(s.resolveCurrentRoom()?.id).toBe(101);
    s.currentRoom = 0;
    expect(s.resolveCurrentRoom()).toBe(r1);
  });

  it("refuse un monde dont un conteneur est introuvable", () => {
    const w = synthetic();
    w.objects[2].container = 99;
    expect(() => new WorldState(w)).toThrow(/conteneur/);
    const v = synthetic();
    v.objects[1].container = 999;
    expect(() => new WorldState(v)).toThrow(/salle/);
  });

  it("crée des objets avec des numéros de série qui se suivent (0 pour un décor)", () => {
    const s = new WorldState(synthetic());
    const a = s.createObject({ typ: 2, num: 50 });
    const d = s.createObject({ typ: 1, num: 60 });
    const i = s.createObject({ typ: 0, num: 70 });
    expect([a.serial, d.serial, i.serial]).toEqual([6, 0, 7]);
    expect(s.lastSerial).toBe(7);
    expect(s.objects[0]).toBe(a);
    expect(a.location).toBe(0);
    expect(i).toMatchObject({ location: 3, room: s.rooms[0] });
    expect(s.findBySerial(6)).toBe(a);
  });

  it("déplace entre salle et conteneur en tête de liste, refuse les cycles", () => {
    const s = new WorldState(synthetic());
    const hero = s.hero!;
    const extra = s.createObject({ typ: 2, num: 50 });
    s.moveToRoom(extra, s.roomById(101)!);
    expect(s.roomById(101)!.listA.map((o) => o.serial)).toEqual([extra.serial, 2]);
    expect(extra).toMatchObject({ location: 1, container: 101 });
    s.moveToContainer(extra, hero);
    expect(s.roomById(101)!.listA).toEqual([hero]);
    expect(hero.contents.map((o) => o.serial)).toEqual([extra.serial, 3]);
    expect(extra).toMatchObject({ location: 2, container: hero.serial, room: null, holder: hero });
    expect(() => s.moveToContainer(hero, extra)).toThrow(/Cycle/);
    s.moveToRoom(extra, s.roomById(102)!);
    expect(hero.contents.map((o) => o.serial)).toEqual([3]);
    expect(() => s.moveToRoom(s.interfaceObjects[0], s.roomById(101)!)).toThrow();
  });

  it("supprime un objet et son contenu, et oublie le héros", () => {
    const s = new WorldState(synthetic());
    const hero = s.hero!;
    s.deleteObject(hero);
    expect(s.hero).toBeNull();
    expect(s.findBySerial(2)).toBeUndefined();
    expect(s.findBySerial(3)).toBeUndefined();
    expect(s.objects.map((o) => o.serial)).toEqual([4]);
    expect(s.roomById(101)!.listA).toEqual([]);
  });

  it("changer le numéro de série (transit) met à jour la recherche et le contenu", () => {
    const s = new WorldState(synthetic());
    const hero = s.hero!;
    s.setSerial(hero, 10002);
    expect(s.findBySerial(2)).toBeUndefined();
    expect(s.findBySerial(10002)).toBe(hero);
    expect(s.findBySerial(3)?.container).toBe(10002);
  });

  it("addScore : attribue une fois, rejoue le jingle selon les répétitions, ignore l'inconnu", () => {
    const s = new WorldState(synthetic());
    expect(s.maxScore).toBe(35);
    expect(s.addScore(0)).toMatchObject({ points: 10, sound: 11, replay: false });
    expect(s.score).toBe(10);
    expect(s.addScore(0)).toMatchObject({ points: 0, sound: 0, replay: false });
    expect(s.score).toBe(10);
    expect(s.addScore(1)).toMatchObject({ points: 20, sound: 0 });
    expect(s.addScore(2)).toMatchObject({ points: 0, sound: 12, replay: true });
    expect(s.addScore(2)?.replay).toBe(true);
    expect(s.addScore(2)?.replay).toBe(false);
    expect(s.addScore(3)).toMatchObject({ points: 0, replay: false });
    expect(s.addScore(999)).toBeNull();
    expect(s.score).toBe(30);
    expect(s.maxScore).toBe(35);
  });

  it("ne modifie pas le monde source", () => {
    const w = synthetic();
    const s = new WorldState(w);
    s.addScore(0);
    s.hero!.x = 123;
    expect(w.scoreTable[0].points).toBe(10);
    expect(w.objects[1].x).toBe(0);
  });
});

describe("état du monde : besoins du moteur", () => {
  it("resolveObject : héros si num < 1, puis salle chargée, puis listes globales", () => {
    const s = new WorldState(synthetic());
    expect(s.resolveObject(0)).toBe(s.hero);
    expect(s.resolveObject(-3)).toBe(s.hero);
    expect(s.loadedRoom).toBeNull();
    expect(s.wantedRoom?.id).toBe(101);
    // objets de num 9 : le 4 (salle 102) puis le 3 (dans le héros) ; la salle voulue (101) ne contient pas de num 9
    expect(s.resolveObject(9)?.serial).toBe(4);
    const here = s.createObject({ typ: 2, num: 9 });
    s.moveToRoom(here, s.roomById(101)!);
    expect(s.resolveObject(9)).toBe(here);
    s.loadedRoom = s.roomById(102)!;
    expect(s.resolveObject(9)?.serial).toBe(4);
    const decor = s.createObject({ typ: 1, num: 50 });
    expect(s.resolveObject(50)).toBe(decor);
    expect(s.resolveObject(999)).toBeUndefined();
  });

  it("writeObjectField garde raw et champs nommés d'accord, lecture signée comme le moteur", () => {
    const s = new WorldState(synthetic());
    const o = s.hero!;
    for (const [offset, size, value] of [[0x05, 1, 7], [0x06, 1, 2], [0x07, 1, 3], [0x08, 1, 1], [0x0a, 2, -32], [0x2d, 1, 6], [0x2e, 1, 9], [0x32, 2, 100], [0x34, 2, 5], [0x45, 1, 3], [0x46, 1, 4], [0x60, 1, -1], [0x61, 1, 1], [0x62, 1, -1]] as const) {
      writeObjectField(o, offset, size, value, s);
      expect(readObjectField(o, offset, size), `0x${offset.toString(16)}`).toBe(value);
    }
    expect(o).toMatchObject({ gst: 7, mob: 2, dep: 3, txt: 1, light: -32, ego: 6, fig: 9, speedX: -1, speedY: 1, speedP: -1 });
    expect(o.anim).toMatchObject({ dpX: 3, dpY: 4 });
    expect(o.raw[0x60]).toBe(0xff);
    expect(o.raw[0x0a] | (o.raw[0x0b] << 8)).toBe(0xffe0);
    expect(readObjectField(o, 0x32, 2)).toBe(100);
    s.writeField(o, 0x02, 2, 77);
    expect(s.findBySerial(77)).toBe(o);
    // les champs écrits sont ceux de la sauvegarde
    const back = loadWorldStateFrom(s);
    expect(back.findBySerial(77)).toMatchObject({ mob: 2, light: -32, speedX: -1 });
  });

  it("chapitre et niveau se règlent séparément", () => {
    const s = new WorldState(synthetic());
    s.setLevel(1);
    expect([s.chapter, s.level, s.chapterLevel]).toEqual([2, 1, 201]);
    s.setChapter(3);
    expect([s.chapter, s.level]).toEqual([3, 1]);
  });

  it("drapeaux du moteur : saisie permise (4b50), fin de partie (4b67), page d'icônes, indicateurs d'exécution", () => {
    const s = new WorldState(synthetic());
    expect([s.moveEnabled, s.gameOver, s.scriptRunning, s.darkRoom, s.debugLevel, s.selected, s.firstFrame]).toEqual([false, false, false, false, 0, null, false]);
    expect(s.iconPage).toBe(0);
    const page = s.createObject({ typ: 0, num: 3 });
    s.iconPage = 2;
    expect(s.iconPage).toBe(2);
    expect(page.ego).toBe(2);
    s.moveEnabled = true;
    s.gameOver = true;
    s.setLevel(2);
    const back = loadWorldStateFrom(s);
    expect([back.moveEnabled, back.gameOver, back.iconPage, back.level]).toEqual([true, true, 2, 2]);
    expect(back.cadence.delay).toBe(s.cadence.delay);
    s.moveEnabled = false;
    s.gameOver = false;
    expect([s.moveEnabled, s.gameOver, s.headerWords[5] & 0xff]).toEqual([false, false, 0]);
  });

  it("supprimer l'objet sélectionné vide la sélection", () => {
    const s = new WorldState(synthetic());
    s.selected = s.findBySerial(3)!;
    s.deleteObject(s.selected);
    expect(s.selected).toBeNull();
  });
});

function loadWorldStateFrom(state: WorldState): WorldState {
  state.headerWords[0] = 0x786b;
  state.headerWords[1] = 0x00ca;
  return loadWorldState(serializeWorld(state));
}

describe.skipIf(!hasOriginalFiles)("état du monde d'Armaeth (fichiers du jeu)", () => {
  const cfg = loadWorldState(readOriginal("A1FCFG.SYS"));

  it("charge 132 objets (29 d'interface, 103 objets), 60 salles, le héros et l'horloge", () => {
    expect(cfg.rooms).toHaveLength(60);
    expect(cfg.interfaceObjects).toHaveLength(29);
    expect(cfg.objects).toHaveLength(103);
    expect(cfg.decors).toHaveLength(0);
    expect(cfg.hero).toMatchObject({ serial: 158, num: 1 });
    expect(cfg.hero?.room?.id).toBe(1);
    expect(cfg.currentRoom).toBe(1);
    expect(cfg.clock).toEqual({ hour: 10, minute: 0, ticks: 0 });
    expect(cfg.cadence).toEqual({ delay: 6, counter: 0, pause: 0 });
    expect(cfg.lastSerial).toBe(213);
    expect([cfg.chapter, cfg.level]).toEqual([0, 3]);
    expect(cfg.maxScore).toBe(725);
  });

  it("chaque objet est dans sa salle ou son conteneur et trouvable par numéro de série", () => {
    for (const obj of cfg.objects) {
      expect(cfg.findBySerial(obj.serial)).toBe(obj);
      if (obj.location === 1) expect(obj.room?.listA).toContain(obj);
      if (obj.location === 2) expect(obj.holder?.contents).toContain(obj);
    }
    const inLists = cfg.rooms.reduce((n, r) => n + r.listA.length, 0);
    const inContents = cfg.objects.filter((o) => o.holder).length;
    expect(inLists + inContents).toBe(cfg.objects.length);
  });

  it("des objets sont rangés dans des conteneurs et le score se cumule jusqu'à 725", () => {
    expect(cfg.objects.filter((o) => o.holder)).toHaveLength(12);
    const state = loadWorldState(readOriginal("A1FCFG.SYS"));
    for (const e of [...state.scoreTable]) state.addScore(e.id);
    expect(state.score).toBe(725);
    expect(state.maxScore).toBe(725);
  });

  it("les instantanés se chargent aussi (A1FTMP.SVG, SVG001.STD)", () => {
    for (const f of ["A1FTMP.SVG", "SVG001.STD"]) {
      const s = loadWorldState(readOriginal(f));
      expect(s.rooms).toHaveLength(60);
      expect(s.hero).not.toBeNull();
    }
  });
});

describe("état du monde : accesseurs du déplacement, du placement et des trajets", () => {
  it("hauteur, largeur, pas, Err, Inf, Col et Tim lisent et écrivent l'enregistrement aux décalages du moteur", () => {
    const s = new WorldState(synthetic());
    const o = s.hero!;
    o.height = 30;
    o.width = 12;
    o.stepX = 2;
    o.stepY = 4;
    o.stepP = 1;
    o.err = 0x11;
    o.info = 3;
    o.col = 0x1234;
    o.tim = 0xabcd;
    expect([readObjectField(o, 0x4c), readObjectField(o, 0x4d)]).toEqual([30, 12]);
    expect([readObjectField(o, 0x45), readObjectField(o, 0x46), readObjectField(o, 0x47)]).toEqual([2, 4, 1]);
    expect([o.raw[0x3e], o.raw[0x3f], o.raw[0x3c] | (o.raw[0x3d] << 8), o.raw[0x32] | (o.raw[0x33] << 8)]).toEqual([0x11, 3, 0x1234, 0xabcd]);
    // les accesseurs sont énumérables : une copie `{ ...objet }` (sonde de placement) en garde les valeurs
    expect({ ...o }).toMatchObject({ height: 30, width: 12, stepX: 2, stepY: 4, stepP: 1, err: 0x11, info: 3, col: 0x1234, tim: 0xabcd });
    writeObjectField(o, 0x4c, 1, 44);
    expect(o.height).toBe(44);
    writeObjectField(o, 0x3e, 1, 0);
    expect(o.err).toBe(0);
  });

  it("le trajet de chaque objet vit dans +0x63..+0x78 : il est écrit avec le monde et relu", () => {
    const world = synthetic();
    world.header.words[0] = 0x786b; // signature du fichier de monde
    world.header.words[1] = 0x00ca;
    const s = new WorldState(world);
    const o = s.hero!;
    expect(o.path.defined).toBe(false);
    expect(o.path.target).toBeNull();
    o.path.defined = true;
    o.path.remaining = 5;
    o.path.mode = 2;
    o.path.lateral = -1;
    o.path.x1 = 12;
    o.path.x2 = 40;
    o.path.target = { x: 146, y: 121, p: 63, plane: 1 };
    expect([o.raw[0x6e], o.raw[0x63], o.raw[0x64], o.raw[0x76], o.raw[0x77], o.raw[0x6f]]).toEqual([1, 2, 0xff, 12, 40, 1]);
    expect([o.raw[0x6c] | (o.raw[0x6d] << 8), o.raw[0x70] | (o.raw[0x71] << 8), o.raw[0x72], o.raw[0x74]]).toEqual([5, 146, 121, 63]);
    const back = loadWorldState(serializeWorld(s)).hero!;
    expect(back.path).toMatchObject({ defined: true, remaining: 5, mode: 2, lateral: -1, x1: 12, x2: 40, target: { x: 146, y: 121, p: 63, plane: 1 } });
    // les nœuds (`Chm`, un pointeur) ne sont pas dans le fichier : ils sont recalculés
    expect(back.path.nodes).toEqual([]);
    o.path.target = null;
    expect(o.path.target).toBeNull();
  });

  it("un trajet est propre à chaque objet", () => {
    const s = new WorldState(synthetic());
    const [a, b] = [s.hero!, s.findBySerial(4)!];
    a.path.defined = true;
    expect(b.path.defined).toBe(false);
  });
});
