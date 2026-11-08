import { describe, expect, it } from "vitest";
import { MOVE_DATA, movePersonData } from "../../../src/games/fotaq/engine/actors";
import { GridScreen } from "../../../src/games/fotaq/engine/grid";
import { PERSON_LEFT, PERSON_RIGHT } from "../../../src/games/fotaq/engine/room";
import { GameStage } from "../../../src/games/fotaq/engine/stage";
import { Item, JoeWalk } from "../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../helpers";
import { Player, gameData } from "./test-host";

/** Verbes du panneau, dans l'ordre des cases (`clickVerb`). */
const Panel = { Open: 1, Close: 2, Move: 3, Give: 4, Look: 5, PickUp: 6, Talk: 7, Use: 8 } as const;

const description = (n: number): string => gameData().texts.objectDescriptions[n];

/** Le parcours de `loop.test.ts` (G1), rejoué avec la vraie scène : Joe marche, se tourne et saisit pour de bon. */
describe.skipIf(!hasOriginalFiles)("parcours G1 avec la vraie marche", () => {
  const start = (options: ConstructorParameters<typeof Player>[0] = {}) => {
    const stage = new GameStage();
    const player = new Player({ stage, ...options });
    player.settle();
    return { player, stage, engine: player.engine, state: player.state };
  };

  it("pièce 1 : le sac, la porte, puis la pièce 2 où Joe part du point de sortie et marche jusqu'à l'objet 8", () => {
    const { player, stage, state } = start({ room: 1 });
    player.clickVerb(Panel.Look);
    player.clickObject(1);
    expect(player.talk.lines.at(-1)?.text).toBe(description(11));
    player.clickVerb(Panel.Open);
    player.clickObject(1);
    expect(state.objects[1].image).toBe(4);
    // Le bob du sac ouvert est dans la scène.
    const bob = stage.bobs.bob(stage.bobs.findBob(player.engine, 1));
    expect(bob.active).toBe(true);
    expect(stage.bobs.frames.frame(bob.frameNum)).toMatchObject({ image: gameData().jas.graphics[4].firstFrame });

    player.clickObject(6);
    expect(state.room).toBe(1);
    player.clickVerb(Panel.Open);
    player.clickObject(6);
    player.clickObject(6);
    expect(state.room).toBe(2);
    expect([state.joe.x, state.joe.y]).toEqual([185, 105]);
    expect([stage.bobs.bob(0).x, stage.bobs.bob(0).y]).toEqual([185, 105]);
    expect(stage.bobs.bob(0).moving).toBe(false);
  });

  it("entrée par l'objet 8 : Joe apparaît au point de sortie et marche (plusieurs images) jusqu'à l'objet", () => {
    const { stage, state, engine } = start({ entryObject: 8 });
    const walkOff = engine.walkOffPoint(8);
    expect(walkOff).not.toBeNull();
    // Le point de sortie est autre que l'objet : Joe est arrivé en marchant, plusieurs images après l'affichage de la pièce.
    expect([walkOff?.x, walkOff?.y]).not.toEqual([state.objects[8].x, state.objects[8].y]);
    expect([state.joe.x, state.joe.y]).toEqual([state.objects[8].x, state.objects[8].y]);
    expect([stage.bobs.bob(0).x, stage.bobs.bob(0).y]).toEqual([state.joe.x, state.joe.y]);
    expect(stage.frames).toBeGreaterThan(5);
    expect(state.room).toBe(2);
  });

  it("pièce 2 : utiliser le couteau avec la tige (condition manquée puis remplie)", () => {
    const { player, state } = start({ entryObject: 8 });
    state.items[3].name = Math.abs(state.items[3].name);
    player.engine.inventory.insert(3);
    player.clickVerb(Panel.Use);
    player.clickInventory(0);
    player.clickObject(7);
    expect(player.talk.lines.at(-1)?.text).toBe(description(84));
    state.gameStates[5] = 1;
    player.clickVerb(Panel.Use);
    player.clickInventory(0);
    player.clickObject(7);
    expect(state.gameStates[196]).toBe(1);
    expect(player.talk.lines.at(-1)?.text).toBe(description(135));
  });

  it("pièce 73 : prendre la clef (Joe marche jusqu'à elle), parler au portier", () => {
    const { player, state, engine, stage } = start({ entryObject: 584 });
    const key = state.objects[581];
    player.clickVerb(Panel.PickUp);
    player.clickObject(581);
    expect(player.cutaways.played).toEqual(["c73d.CUT"]);
    // Joe est allé jusqu'à l'objet.
    expect([state.joe.x, state.joe.y]).toEqual([key.x, key.y]);
    state.gameStates[145] = 1;
    player.clickVerb(Panel.PickUp);
    player.clickObject(581);
    expect(state.objects[581].name).toBe(0);
    expect(engine.grid.zone(GridScreen.Room, 1)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(engine.inventory.has(Item.Journal + 55)).toBe(true);
    // Le bob de la clef est éteint (image supprimée) ; le saisissement a laissé Joe immobile.
    expect(stage.bobs.bob(0).moving).toBe(false);
    player.clickVerb(Panel.Talk);
    player.clickObject(585);
    expect(player.talk.dialogues).toEqual([{ file: "laris.DOG", person: 5 }]);
  });

  it("un clic pendant la marche l'arrête en route (le bob s'arrête entre les deux points) et lance la nouvelle commande", () => {
    const { player, state, stage } = start({ entryObject: 584 });
    const origin = { x: state.joe.x, y: state.joe.y };
    player.move(150, 140, 1);
    player.move(150, 140, 0);
    player.run(3);
    expect(player.engine.busy).toBe(true);
    expect(player.engine.joeWalk).toBe(JoeWalk.Move);
    expect(stage.bobs.bob(0).moving).toBe(true);
    const box = gameData().jas.objectBoxes[581];
    player.move(box.x1 + 2, box.y1 + 2, 2);
    player.move(box.x1 + 2, box.y1 + 2, 0);
    player.settle();
    expect([state.joe.x, state.joe.y]).not.toEqual([150, 140]);
    expect([state.joe.x, state.joe.y]).not.toEqual([origin.x, origin.y]);
    expect(player.talk.lines.at(-1)?.text).toBe(description(658));
  });

  it("cliquer sur chaque objet de plusieurs pièces fait marcher Joe jusqu'au bout sans bloquer le jeu", () => {
    for (const room of [1, 2, 3, 5, 73]) {
      const { player, state, engine } = start({ room });
      const first = engine.currentRoomData + 1;
      const last = engine.data.jas.roomFirstObject[room + 1];
      for (let object = first; object <= last; object++) {
        if (state.objects[object].name <= 0 || state.objects[object].entryObject !== 0) continue;
        if (!engine.data.jas.objectBoxes[object] || engine.grid.zone(GridScreen.Room, object - first + 1) === undefined) continue;
        player.clickVerb(Panel.Look);
        player.clickObject(object);
        expect(engine.busy, `pièce ${room}, objet ${object}`).toBe(false);
        expect(state.room).toBe(room);
      }
    }
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("marche d'un personnage (movePerson)", () => {
  it("un personnage marche jusqu'au point visé, s'arrête sur son image debout, tourné du bon côté, et sa personne est retournée", () => {
    // Première pièce où une personne se tient dans une zone de marche assez large pour qu'elle y marche.
    let found: { stage: GameStage; player: Player; object: number; box: { x1: number; x2: number } } | null = null;
    for (let room = 1; room <= 115 && !found; room++) {
      const stage = new GameStage();
      const player = new Player({ room, stage });
      player.settle();
      const { engine } = player;
      for (let object = engine.currentRoomData + 1; object <= engine.data.jas.roomFirstObject[room + 1]; object++) {
        const image = engine.state.objects[object].image;
        if ((image !== PERSON_LEFT && image !== PERSON_RIGHT) || engine.state.objects[object].name <= 0) continue;
        const noun = object - engine.currentRoomData;
        const probe = stage.actors.initPerson(engine, noun, null, false);
        if (!probe || probe.anim !== null) continue;
        const bob = stage.bobs.bob(probe.actor.bobNumber);
        const area = engine.grid.findAreaForPos(bob.x, bob.y);
        if (area === 0) continue;
        const box = player.state.areas[room][area].box;
        if (box.x2 - box.x1 > 40) found = { stage, player, object, box };
        if (found) break;
      }
    }
    expect(found).not.toBeNull();
    const { stage, player, object, box } = found as NonNullable<typeof found>;
    const engine = player.engine;
    const noun = object - engine.currentRoomData;
    const person = stage.actors.initPerson(engine, noun, null, false) as NonNullable<ReturnType<typeof stage.actors.initPerson>>;
    const moves = movePersonData(person.name);
    expect(moves.moveSpeed, `pas de marche de ${person.name}`).toBeGreaterThan(0);
    const bob = stage.bobs.bob(person.actor.bobNumber);
    const startX = bob.x;
    // Vers le bord le plus éloigné de la zone de marche où il se trouve.
    const goLeft = startX - box.x1 >= box.x2 - startX;
    const targetX = goLeft ? box.x1 + 1 : box.x2 - 1;
    expect(Math.abs(targetX - startX)).toBeGreaterThan(10);
    let result = -99;
    player.perform(
      (function* () {
        result = yield* stage.walk.movePerson(engine, person, targetX, bob.y, 60, PERSON_RIGHT);
      })(),
    );
    expect(result).toBe(0);
    expect(bob.x).toBe(targetX);
    expect(bob.moving).toBe(false);
    expect(bob.animating).toBe(false);
    expect(bob.xflip).toBe(goLeft);
    expect(engine.state.objects[object].image).toBe(goLeft ? PERSON_LEFT : PERSON_RIGHT);
    expect(bob.frameNum).toBe(31 + person.actor.bobNumber);
    expect(stage.bobs.frames.frame(bob.frameNum)?.image).toBe(moves.frontStandingFrame);
    // Retour vers la droite.
    player.perform(
      (function* () {
        result = yield* stage.walk.movePerson(engine, person, startX, bob.y, 60, goLeft ? PERSON_LEFT : PERSON_RIGHT);
      })(),
    );
    expect(bob.x).toBe(startX);
    expect(bob.xflip).toBe(!goLeft);
    expect(engine.state.objects[object].image).toBe(goLeft ? PERSON_RIGHT : PERSON_LEFT);
  });

  it("la table des pas : 20 personnages ; un nom inconnu n'a aucun pas", () => {
    expect(MOVE_DATA).toHaveLength(20);
    expect(movePersonData("sparky").moveSpeed).toBe(5);
    expect(movePersonData("inconnu")).toMatchObject({ walkLeft1: 0, moveSpeed: 0 });
    // FRANK marche à gauche en images positives (7 à 12) et à droite en 1 à 6 : deux séries distinctes, sans retournement.
    expect(movePersonData("FRANK")).toMatchObject({ walkLeft1: 7, walkRight1: 1 });
  });
});
