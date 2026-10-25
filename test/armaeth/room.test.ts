import { describe, expect, it } from "vitest";
import type { Scene, SceneDecor } from "../../src/games/armaeth/data/scene";
import type { Sprite } from "../../src/games/armaeth/data/sprite";
import type { World } from "../../src/games/armaeth/data/world";
import type { SpriteSource } from "../../src/games/armaeth/engine/animation";
import {
  ABORT_HERO_PLACEMENT,
  activePlanes,
  armLevelIntro,
  completeHeroTransit,
  enterRoom,
  exitRoom,
  levelIntroShown,
  loadRoom,
  onFirstDisplay,
  planRoomLoad,
  roomMusic,
} from "../../src/games/armaeth/engine/room";
import { loadWorldState } from "../../src/games/armaeth/engine/save";
import { RAW_OFFSET, type GameObject, WorldState, rawU8, setRawU8 } from "../../src/games/armaeth/engine/state";
import { hasOriginalFiles, readOriginal } from "./helpers";

function world(): World {
  const room = (id: number, exits: number[], music = [0, 0]) => ({
    id, lightOffset: 0, outdoor: 1, musicClass: 0x4d, musicId: music[0], musicNumber: music[1], exits, barriers: [0, 0, 0, 0, 0, 0], words: new Array(21).fill(0),
  });
  return {
    header: { words: new Array(27).fill(0), lastSerial: 0, dictionaryLetters: 8, chapterLevel: 3, score: 0, heroSerial: 0, currentRoom: 101, objectCount: 0, roomCount: 4 },
    scoreTable: [{ id: 0, points: 10, sound: 0, repeats: 0 }],
    deferredEvents: { capacity: 4, events: [] },
    rooms: [room(0, [0, 0, 0, 0, 0, 0]), room(101, [2, 0, 0, 0, 0, 0], [5, 7]), room(102, [0, 0, 1, 0, 0, 0], [5, 7]), room(103, [0, 0, 0, 0, 0, 0], [9, 9])],
    objects: [],
  };
}

const oneFrame: Sprite = {
  id: 0,
  frames: [{ width: 3, height: 4, pixels: new Uint8Array(12) }],
  animation: {
    records: 1,
    words: 0,
    bytes: new Uint8Array(),
    figs: [{ index: 0, mirrorLeft: 0, dpX: 1, dpY: 1, directions: Array(4).fill({ start: 0, headerHigh: 0, steps: [{ frame: 0, duration: 3, mirror: false }] }) as never }],
  },
  memoryPointers: new Uint8Array(),
};
const sprites: SpriteSource = { get: () => oneFrame };

function decor(fields: Partial<SceneDecor>): SceneDecor {
  return { num: 1, unused: 0, gst: 0, mob: 1, dep: 0, txt: 0, ego: 0, fig: 0, light: 0, hor: 0, x: 10, y: 20, p: 30, plane: 0, ground: 0, ...fields };
}

function scene(decors: SceneDecor[]): Scene {
  return { header: { x: 8, y: 20, width: 304, height: 160 }, layers: [], decors } as unknown as Scene;
}

describe("requêtes de chargement", () => {
  it("arrête la musique, charge la scène, lance la nouvelle musique en boucle", () => {
    const s = new WorldState(world());
    s.wantedRoom = s.roomById(101)!;
    expect(roomMusic(s.wantedRoom)).toEqual({ soundClass: "M", id: 5, number: 7 });
    expect(planRoomLoad(s, null)).toEqual([
      { type: "stopMusic" },
      { type: "loadScene", sceneId: 101 },
      { type: "playMusic", soundClass: "M", id: 5, number: 7, loop: true },
    ]);
  });

  it("la même musique continue ; une salle sans musique l'arrête", () => {
    const s = new WorldState(world());
    s.wantedRoom = s.roomById(102)!;
    expect(planRoomLoad(s, { soundClass: "M", id: 5, number: 7 })).toEqual([{ type: "loadScene", sceneId: 102 }]);
    s.wantedRoom = s.rooms[0];
    expect(planRoomLoad(s, { soundClass: "M", id: 5, number: 7 })).toEqual([{ type: "stopMusic" }, { type: "loadScene", sceneId: 0 }]);
  });
});

describe("loadRoom et enterRoom", () => {
  it("crée les décors de la scène (Hor 0 -> 1, Xyp 2, phase), détruit les anciens, rend l'origine", () => {
    const s = new WorldState(world());
    s.wantedRoom = s.roomById(101)!;
    const first = loadRoom(s, scene([decor({ num: 4 }), decor({ num: 5, hor: 0xff })]), { sprites, rand: () => 1 });
    expect(first.origin).toEqual({ x: 8, y: 20 });
    expect(s.loadedRoom).toBe(s.roomById(101));
    expect(s.currentRoom).toBe(101);
    expect(s.decors).toHaveLength(2);
    expect(s.roomById(101)!.listB.map((o) => o.num)).toEqual([5, 4]);
    const [d5, d4] = s.roomById(101)!.listB;
    expect(d4).toMatchObject({ serial: 0, typ: 1, speedX: 1, presence: 2, x: 10, y: 20, p: 30 });
    expect(d5.speedX).toBe(-1);
    expect(d4.anim.frame).toBe(0);
    s.wantedRoom = s.roomById(102)!;
    const reset: number[] = [];
    s.createObject({ typ: 2, num: 8 });
    const obj = s.objects[0];
    s.moveToRoom(obj, s.roomById(101)!);
    loadRoom(s, scene([decor({ num: 6 })]), { sprites, rand: () => 0, resetMotion: (o) => reset.push(o.num) });
    expect(reset).toEqual([8]);
    expect(s.decors.map((o) => o.num)).toEqual([6]);
  });

  it("place les objets sans procédure (mode 2 si Xyp 2, sinon 5), arme la première image, Err du héros à 0x11", () => {
    const s = new WorldState(world());
    s.wantedRoom = s.roomById(101)!;
    const a = s.createObject({ typ: 2, num: 1, gst: 0, presence: 2 });
    const b = s.createObject({ typ: 2, num: 2, gst: 0, presence: 1 });
    const c = s.createObject({ typ: 2, num: 3, gst: 7 });
    for (const o of [a, b, c]) s.moveToRoom(o, s.roomById(101)!);
    s.setHero(c);
    loadRoom(s, scene([]), { sprites, rand: () => 0 });
    const placed: [number, number][] = [];
    const result = enterRoom(s, { place: (o, m) => placed.push([o.num, m]), resetMotions: (away) => placed.push([-1, Number(away)]) });
    expect(result).toEqual({ status: "ready", heroAbsent: false });
    expect(placed).toEqual([[2, 5], [1, 2], [-1, 0]]);
    expect(rawU8(c, RAW_OFFSET.err)).toBe(0x11);
    expect(s.firstFrame).toBe(true);
    setRawU8(c, RAW_OFFSET.err, 5);
    enterRoom(s, { place: () => 0, resetMotions: () => {} });
    expect(rawU8(c, RAW_OFFSET.err)).toBe(5);
  });
});

describe("sorties et transit du héros", () => {
  function setup(): { s: WorldState; hero: GameObject } {
    const s = new WorldState(world());
    const hero = s.createObject({ typ: 2, num: 1, gst: 7 });
    s.moveToRoom(hero, s.roomById(101)!);
    s.setHero(hero);
    s.loadedRoom = s.wantedRoom = s.roomById(101)!;
    return { s, hero };
  }

  it("le héros franchit une sortie : salle voulue, Err 0x12, Ser + 10000 ; le rechargement le range et remet Ser", () => {
    const { s, hero } = setup();
    const serial = hero.serial;
    setRawU8(hero, RAW_OFFSET.inf, 0);
    expect(exitRoom(s, hero)).toBe("transit");
    expect(s.wantedRoom).toBe(s.roomById(102));
    expect(rawU8(hero, RAW_OFFSET.err)).toBe(0x12);
    expect(hero.serial).toBe(serial + 10000);
    expect(s.findBySerial(serial + 10000)).toBe(hero);
    loadRoom(s, scene([]), { sprites, rand: () => 0 });
    const result = enterRoom(s, { place: () => 0, resetMotions: () => {} });
    expect(result).toEqual({ status: "ready", heroAbsent: true });
    expect(hero.room).toBe(s.roomById(102));
    expect(hero.serial).toBe(serial);
  });

  it("barrage : Err 0x0F, le héros reste ; autre objet : rangé directement", () => {
    const { s, hero } = setup();
    s.roomById(101)!.barriers[0] = 4;
    setRawU8(hero, RAW_OFFSET.inf, 0);
    expect(exitRoom(s, hero, (_o, code) => code === 4)).toBe("blocked");
    expect(rawU8(hero, RAW_OFFSET.err)).toBe(0x0f);
    expect(s.wantedRoom).toBe(s.roomById(101));
    const npc = s.createObject({ typ: 2, num: 9 });
    s.moveToRoom(npc, s.roomById(101)!);
    s.roomById(101)!.barriers[0] = 0;
    setRawU8(npc, RAW_OFFSET.inf, 0);
    expect(exitRoom(s, npc)).toBe("moved");
    expect(npc.room).toBe(s.roomById(102));
    setRawU8(npc, RAW_OFFSET.inf, 3);
    expect(exitRoom(s, npc)).toBe("none");
  });

  it("échec du rangement : la salle voulue redevient l'ancienne et l'entrée demande de réessayer ; abandon si c'est la salle chargée", () => {
    const { s, hero } = setup();
    s.loadedRoom = s.roomById(102)!;
    s.wantedRoom = s.roomById(102)!;
    setRawU8(hero, RAW_OFFSET.inf, 4);
    expect(completeHeroTransit(s)).toBe(false);
    expect(s.wantedRoom).toBe(s.roomById(101));
    expect(enterRoom(s, { place: () => 0, resetMotions: () => {} })).toEqual({ status: "retry" });
    s.loadedRoom = s.roomById(101)!;
    s.moveToRoom(hero, s.roomById(102)!);
    expect(() => enterRoom(s, { placeHero: () => false, place: () => 0, resetMotions: () => {} })).toThrow(new RegExp(ABORT_HERO_PLACEMENT.toString(16)));
    // placement d'arrivée refusé : retour dans l'ancienne salle
    s.moveToRoom(hero, s.roomById(101)!);
    setRawU8(hero, RAW_OFFSET.inf, 0);
    expect(completeHeroTransit(s, () => false)).toBe(false);
    expect(hero.room).toBe(s.roomById(101));
  });
});

describe("introductions de niveau", () => {
  it("armées une fois à l'entrée des salles 1, 101, 202, 305 : événement 100 + niveau, 60 tics, proc 2000", () => {
    const s = new WorldState(world());
    s.loadedRoom = s.roomById(101)!;
    expect(levelIntroShown(s, 1)).toBe(false);
    expect(onFirstDisplay(s)).toBe(1);
    expect(levelIntroShown(s, 1)).toBe(true);
    expect(s.events.entries).toEqual([{ typ: 0, num: 0, serial: 0, event: 101, counter: 60, procedure: 2000 }]);
    expect(onFirstDisplay(s)).toBeNull();
    s.loadedRoom = s.roomById(102)!;
    expect(onFirstDisplay(s)).toBeNull();
    // les drapeaux des quatre niveaux sont indépendants et se retrouvent dans l'en-tête sauvegardé
    for (const level of [0, 2, 3]) expect(armLevelIntro(s, level)).toBe(true);
    expect([0, 1, 2, 3].every((l) => levelIntroShown(s, l))).toBe(true);
  });

  it("le jeton skp (4b44) supprime l'introduction", () => {
    const s = new WorldState(world());
    s.skipIntro = 7;
    expect(armLevelIntro(s, 0)).toBe(false);
    expect(s.events.size).toBe(0);
  });
});

describe.skipIf(!hasOriginalFiles)("entrée dans les salles du jeu", () => {
  it("la salle de départ de CFG est rejointe par le héros ; la musique vient de l'en-tête de la salle", () => {
    const s = loadWorldState(readOriginal("A1FCFG.SYS"));
    expect(s.wantedRoom).toBe(s.hero?.room);
    expect(planRoomLoad(s, null).map((r) => r.type)).toContain("loadScene");
    s.loadedRoom = s.wantedRoom;
    s.events.capacity = 16;
    expect(levelIntroShown(s, 0)).toBe(false);
    const level = onFirstDisplay(s);
    expect(level === null || [0, 1, 2, 3].includes(level)).toBe(true);
  });

  it("salle 1 : l'introduction du niveau 0 est armée", () => {
    const s = loadWorldState(readOriginal("A1FCFG.SYS"));
    s.loadedRoom = s.roomById(1)!;
    expect(onFirstDisplay(s)).toBeNull(); // capacité 0 : rien n'est armé
    expect(levelIntroShown(s, 0)).toBe(false);
    s.events.capacity = 16;
    expect(onFirstDisplay(s)).toBe(0);
    expect(s.events.find({ typ: 0, num: 0, serial: 0 }, 100)?.counter).toBe(60);
  });
});

describe.skipIf(!hasOriginalFiles)("plans actifs des salles (147f:000a)", () => {
  const state = () => loadWorldState(readOriginal("A1FCFG.SYS"));
  const object = (s: WorldState, num: number) => s.findByNum(num)!;

  it("état initial : stèle fermée, dalle fermée, niveau 3, passerelle intacte", () => {
    const s = state();
    expect(activePlanes(s, 5, 2)).toBe(3);
    expect(activePlanes(s, 108, 2)).toBe(3);
    expect(activePlanes(s, 202, 3)).toBe(2); // chapitre 0 (< 3) : 2 plans
    expect(activePlanes(s, 205, 2)).toBe(1); // sous-niveau 3 : 1 plan
    expect(activePlanes(s, 212, 1)).toBe(object(s, 215).fig === 0 ? 2 : 1);
    expect(activePlanes(s, 312, 2)).toBe(2);
    expect(activePlanes(s, 8, 1)).toBe(1); // les autres salles gardent le compte du fichier
  });

  it("les mécanismes et le niveau changent le nombre de plans", () => {
    const s = state();
    object(s, 16).ego = 4; // stèle ouverte
    expect(activePlanes(s, 5, 3)).toBe(2);
    object(s, 104).ego = 3; // dalle ouverte
    expect(activePlanes(s, 108, 3)).toBe(2);
    object(s, 318).ego = 1; // la passerelle a cédé
    expect(activePlanes(s, 312, 2)).toBe(1);
    object(s, 215).fig = 1;
    expect(activePlanes(s, 212, 2)).toBe(1);
    s.chapterLevel = 300;
    expect(activePlanes(s, 202, 2)).toBe(3);
    s.chapterLevel = 100; // sous-niveau 0 : la salle 205 garde le compte du fichier
    expect(activePlanes(s, 205, 2)).toBe(2);
  });
});
