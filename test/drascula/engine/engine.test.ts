import { describe, expect, it } from "vitest";
import { ANY_ROOM, DEFAULT_ROOM, INVENTORY_ROOM, findRoomAction } from "../../../src/games/drascula/engine/actions";
import type { DrasculaEngine } from "../../../src/games/drascula/engine/loop";
import { rectContains } from "../../../src/games/drascula/engine/room";
import type { GameScript } from "../../../src/games/drascula/engine/script";
import { type Sequence, skippable, wait } from "../../../src/engine/sequence";
import { pause } from "../../../src/games/drascula/engine/cadence";
import { Verb } from "../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../helpers";
import { CHAPTER_START_ROOMS, ROOM_CHAPTERS } from "./rooms";
import { Player } from "./test-host";

/** Centre de la zone cliquable de l'objet `id` de la pièce chargée. */
function objectCenter(engine: DrasculaEngine, id: number): { x: number; y: number } {
  const object = engine.room.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(`objet ${id} absent`);
  return { x: Math.trunc((object.rect.x1 + object.rect.x2) / 2), y: Math.trunc((object.rect.y1 + object.rect.y2) / 2) };
}

/** Un point de la zone de marche qui n'est ni sur un objet ni sur le héros. */
function freeFloorPoint(engine: DrasculaEngine): { x: number; y: number } {
  const { walk, objects } = engine.room;
  const hero = engine.state.hero;
  for (let y = walk.y2 - 1; y > walk.y1; y -= 3) {
    for (let x = walk.x1 + 1; x < walk.x2; x += 3) {
      const onHero = x >= hero.x && x <= hero.x + hero.width && y >= hero.y && y <= hero.y + hero.height;
      if (!onHero && !objects.some((object) => rectContains(object.rect, x, y))) return { x, y };
    }
  }
  throw new Error("aucun point libre");
}

describe.skipIf(!hasOriginalFiles)("moteur : chapitres", () => {
  for (const [chapter, room] of Object.entries(CHAPTER_START_ROOMS)) {
    it(`le chapitre ${chapter} commence dans la pièce ${room}`, () => {
      const player = new Player({ chapter: Number(chapter) });
      player.settle();
      expect(player.state.room?.number).toBe(room);
      expect(player.state.inventory.slice(1, 7)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(player.state.inventory).toContain(28);
      expect(player.engine.canSave).toBe(true);
    });
  }

  it("chapitre 1 : le téléphone est rangé et le héros entre dans l'auberge jusqu'à (65, 145)", () => {
    const player = new Player();
    expect(player.engine.busy).toBe(true);
    expect(player.engine.canSave).toBe(false);
    player.settle();
    const { hero } = player.state;
    expect(player.state.takeObject).toBe(false);
    expect(hero.x + Math.trunc(hero.width / 2)).toBeLessThanOrEqual(65);
    expect(hero.x + Math.trunc(hero.width / 2)).toBeGreaterThan(65 - 8);
    expect(player.host.music[0]).toBe(21);
  });

  it("une fin de chapitre abandonne la séquence en cours et lance le chapitre suivant", () => {
    const player = new Player();
    player.settle();
    player.engine.run(player.engine.talk(1));
    player.run(3);
    expect(player.engine.subtitle).not.toBeNull();
    player.engine.endChapter();
    player.run(1);
    expect(player.engine.subtitle).toBeNull();
    expect(player.host.soundActive()).toBe(false);
    // Le fondu de la musique (`MusicFadeout`) précède le chapitre suivant.
    expect(player.state.chapter).toBe(1);
    player.settle();
    expect(player.state.chapter).toBe(2);
    expect(player.state.room?.number).toBe(14);
  });

  it("un gestionnaire peut finir le chapitre au milieu d'une séquence", () => {
    const log: string[] = [];
    const script: GameScript = {
      rooms: {
        *62(g, fl) {
          if (g.picked !== Verb.Talk || fl !== 54) return false;
          yield* pause(2);
          g.endChapter();
          log.push("même tour");
          yield* pause(2);
          log.push("jamais");
          return true;
        },
      },
    };
    const player = new Player({ script });
    player.settle();
    player.state.pickedObject = Verb.Talk;
    player.state.takeObject = true;
    player.engine.run(player.engine.checkAction(54));
    player.run(20);
    expect(log).toEqual(["même tour"]);
    player.settle();
    expect(player.state.chapter).toBe(2);
  });

  it("la fin du chapitre 6 termine le jeu", () => {
    const player = new Player({ chapter: 6 });
    player.settle();
    player.engine.endChapter();
    player.run(1);
    expect(player.engine.ended).toBe(false);
    player.run(200);
    expect(player.engine.ended).toBe(true);
    expect(player.host.exits).toBe(1);
  });

  it("Échap saute la cinématique d'introduction, la suite du chapitre est jouée", () => {
    const steps: string[] = [];
    const script: GameScript = {
      animations: {
        *"1_1"() {
          yield* skippable(
            (function* (): Sequence {
              steps.push("logos");
              yield* wait(5000);
              steps.push("jamais");
            })(),
          );
        },
      },
    };
    const player = new Player({ script });
    expect(player.state.takeObject).toBe(true);
    player.key("Escape");
    player.settle();
    expect(steps).toEqual(["logos"]);
    expect(player.state.room?.number).toBe(62);
    expect(player.state.inventory).toContain(28);
  });
});

describe.skipIf(!hasOriginalFiles)("moteur : pièces", () => {
  it("chaque pièce se charge dans son chapitre et y place le héros", () => {
    const byChapter = new Map<number, number[]>();
    for (const [room, chapter] of ROOM_CHAPTERS) byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), room]);
    expect(ROOM_CHAPTERS).toHaveLength(57);
    for (const [chapter, rooms] of byChapter) {
      const player = new Player({ chapter });
      player.settle();
      for (const room of rooms) {
        player.state.hero.x = -1;
        player.engine.run(player.engine.enterRoom(room));
        player.settle();
        expect(player.state.room?.number).toBe(room);
        expect(player.state.room?.factors === null).toBe(chapter === 2);
        expect(player.state.hero.x).not.toBe(-1);
      }
    }
  });

  it("on se déplace d'un clic dans la zone de marche", () => {
    const player = new Player();
    player.settle();
    const target = freeFloorPoint(player.engine);
    const before = { x: player.state.hero.x, y: player.state.hero.y };
    player.click(target.x, target.y);
    player.run(10);
    expect(player.state.hero.moving).toBe(true);
    player.settle();
    const { hero } = player.state;
    expect({ x: hero.x, y: hero.y }).not.toEqual(before);
    expect(Math.abs(hero.y + hero.height - target.y)).toBeLessThanOrEqual(3);
  });

  it("on franchit une porte : le héros apparaît dans la pièce suivante au point de l'objet de sortie", () => {
    const player = new Player();
    player.settle();
    // porte 106 de l'auberge (62) vers la pièce 63, sortie 107
    const door = objectCenter(player.engine, 106);
    player.click(door.x, door.y);
    player.settle();
    expect(player.state.room?.number).toBe(63);
    expect(player.state.objExit).toBe(107);
    const arrival = player.engine.room.objects.find((object) => object.id === 107)!.door!;
    const { hero } = player.state;
    expect(hero.x).toBe(arrival.x);
    expect(hero.y + hero.height).toBe(arrival.y);
    // orientation à l'arrivée : celle de la porte franchie (106 : 1, vers la droite)
    expect(hero.track).toBe(1);
  });

  it("on regarde un objet : le héros y va, se tourne et dit la réponse de roomActions", () => {
    const player = new Player();
    player.settle();
    player.key("F1");
    player.run(5);
    expect(player.state.pickedObject).toBe(Verb.Look);
    const poster = objectCenter(player.engine, 102);
    player.move(poster.x, poster.y);
    player.run(5);
    expect(player.state.hasName).toBe(true);
    expect(player.state.textName).toBe("AFFICHE");
    player.click(poster.x, poster.y);
    let said: string | null = null;
    for (let i = 0; i < 2000 && !said; i++) {
      player.run(1);
      said = player.engine.subtitle?.text ?? null;
    }
    expect(said).toBe(player.engine.data.text("text", 167));
    player.settle();
    expect(player.host.sounds.at(-1)).toBe("167.als");
    expect(player.state.hero.track).toBe(2);
    expect(player.engine.subtitle).toBeNull();
  });

  it("une touche coupe la réplique en cours", () => {
    const player = new Player();
    player.settle();
    player.engine.run(player.engine.talk(167));
    player.run(10);
    expect(player.host.soundActive()).toBe(true);
    player.key(" ");
    player.run(9); // la touche est lue après chaque `pause(3)` (9 ticks)
    expect(player.engine.busy).toBe(false);
    expect(player.engine.subtitle).toBeNull();
  });

  it("on prend un objet de la pièce (gestionnaire de pièce) puis il va dans l'inventaire", () => {
    const script: GameScript = {
      rooms: {
        *62(g, fl) {
          if (g.picked !== Verb.Pick || fl !== 101) return false;
          yield* pause(4);
          g.pickObject(20);
          g.room.objects[g.objectIndex(101)].visible = false;
          return true;
        },
      },
    };
    const player = new Player({ script });
    player.settle();
    player.key("F2");
    const bin = objectCenter(player.engine, 101);
    player.run(5);
    player.click(bin.x, bin.y);
    player.settle();
    expect(player.state.takeObject).toBe(true);
    expect(player.state.pickedObject).toBe(20);
    expect(player.engine.room.objects[player.engine.objectIndex(101)].visible).toBe(false);
    player.key("F8");
    player.run(5);
    expect(player.state.takeObject).toBe(false);
    expect(player.engine.hasObject(20)).toBe(true);
  });

  it("inventaire : on l'ouvre, on prend un verbe, on l'applique à un objet, on repose un objet", () => {
    const player = new Player();
    player.settle();
    const locations = player.engine.data.dat.itemLocations;
    const slotPoint = (slot: number) => ({ x: locations[slot].x + 10, y: locations[slot].y + 10 });
    player.rightClick();
    player.run(5);
    expect(player.state.menuScreen).toBe(true);
    // case 1 : le verbe « regarder »
    let at = slotPoint(1);
    player.click(at.x, at.y);
    player.settle();
    expect(player.state.pickedObject).toBe(Verb.Look);
    expect(player.state.inventory[1]).toBe(0);
    // le téléphone (28) : réponse de la pseudo-pièce 200
    const phoneSlot = player.state.inventory.indexOf(28, 1);
    at = slotPoint(phoneSlot);
    player.run(5);
    player.click(at.x, at.y);
    player.settle();
    const expected = findRoomAction(player.engine.data.dat.roomActions, INVENTORY_ROOM, 1, Verb.Look, 28);
    expect(expected).not.toBeNull();
    expect(player.host.sounds.at(-1)).toBe(`${expected!.speechId}.als`);
    // on prend le téléphone (le verbe tenu revient dans l'inventaire) puis on le repose dans une case vide
    player.engine.selectVerb(Verb.None);
    player.click(at.x, at.y);
    player.settle();
    expect(player.state.pickedObject).toBe(28);
    const empty = player.state.inventory.indexOf(0, 1);
    const free = slotPoint(empty);
    player.run(5);
    player.click(free.x, free.y);
    player.settle();
    expect(player.state.inventory[empty]).toBe(28);
    expect(player.state.takeObject).toBe(false);
    player.rightClick();
    player.run(5);
    expect(player.state.menuScreen).toBe(false);
  });

  it("barre des verbes : la souris en haut de l'écran choisit un verbe", () => {
    const player = new Player();
    player.settle();
    const bar = player.engine.data.dat.verbBarX;
    const x = Math.trunc((bar[2] + bar[3]) / 2);
    player.move(x, 10);
    player.run(10);
    expect(player.state.menuBar).toBe(true);
    player.click(x, 10);
    player.run(5);
    expect(player.state.pickedObject).toBe(Verb.Pick);
  });
});

describe.skipIf(!hasOriginalFiles)("moteur : verbes par défaut (roomActions)", () => {
  it("chaque ligne de roomActions d'une pièce répond par sa réplique (ou celle qui la précède)", () => {
    const chapterOf = new Map(ROOM_CHAPTERS);
    const players = new Map<number, Player>();
    const playerFor = (chapter: number) => {
      let player = players.get(chapter);
      if (!player) {
        player = new Player({ chapter });
        player.settle();
        // pièce 45 (carte des tours) : `updateRoom` y recalcule le nom survolé (`showMap`), qui dépend de la souris
        if (player.state.room?.number === 45) player.perform(player.engine.enterRoom(49));
        players.set(chapter, player);
      }
      return player;
    };
    const actions = playerFor(1).engine.data.dat.roomActions;
    expect(actions).toHaveLength(307);
    let checked = 0;
    for (const row of actions) {
      const pseudo = row.room === DEFAULT_ROOM || row.room === INVENTORY_ROOM || row.room === ANY_ROOM;
      const chapter = row.chapter !== -1 ? row.chapter : (chapterOf.get(row.room) ?? 1);
      if (!pseudo && chapterOf.get(row.room) !== chapter) continue;
      const player = playerFor(chapter);
      const { engine, state } = player;
      if (!pseudo && state.room?.number !== row.room) {
        player.engine.run(engine.enterRoom(row.room));
        player.settle();
      }
      const verb = row.action === Verb.Default ? Verb.Look : row.action;
      const objectId = row.objectId === -1 ? 9999 : row.objectId;
      state.takeObject = true;
      state.pickedObject = verb;
      state.menuScreen = row.room === INVENTORY_ROOM;
      state.hasName = true;
      const table = engine.data.dat.roomActions;
      const expected =
        findRoomAction(table, state.menuScreen ? INVENTORY_ROOM : ANY_ROOM, chapter, verb, objectId) ??
        findRoomAction(table, state.room!.number, chapter, verb, objectId) ??
        findRoomAction(table, DEFAULT_ROOM, chapter, verb, -1);
      const before = player.host.sounds.length;
      player.perform(engine.checkAction(objectId));
      state.menuScreen = false;
      const said = player.host.sounds.slice(before);
      if (expected) expect(said[0], `ligne ${JSON.stringify(row)}`).toBe(`${expected.speechId}.als`);
      else expect(said.length, `ligne ${JSON.stringify(row)} : excuse`).toBeLessThanOrEqual(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(280);
  });

  it("sans réponse, room_0 fait tourner les excuses (chapitres 2, 4, 5, 6)", () => {
    const player = new Player({ chapter: 4 });
    player.settle();
    const { engine, state } = player;
    const said: string[] = [];
    for (let i = 0; i < 4; i++) {
      state.takeObject = true;
      state.pickedObject = Verb.Look;
      state.hasName = true;
      const before = player.host.sounds.length;
      player.perform(engine.checkAction(9999));
      said.push(...player.host.sounds.slice(before));
    }
    const lookDefault = findRoomAction(engine.data.dat.roomActions, DEFAULT_ROOM, 4, Verb.Look, -1);
    expect(lookDefault).toBeNull();
    expect(said).toEqual(["100.als", "101.als", "54.als", "100.als"]);
  });
});
