import { describe, expect, it } from "vitest";
import { GridScreen } from "../../../src/games/fotaq/engine/grid";
import { RoomDisplay } from "../../../src/games/fotaq/engine/loop";
import type { GameScript } from "../../../src/games/fotaq/engine/script";
import { Outfit } from "../../../src/games/fotaq/engine/services";
import { Direction, GameVar, Item, stateOn } from "../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../helpers";
import { Player, gameData } from "./test-host";

/** Verbes du panneau, dans l'ordre des cases (`clickVerb`). */
const Panel = { Open: 1, Close: 2, Move: 3, Give: 4, Look: 5, PickUp: 6, Talk: 7, Use: 8 } as const;

function description(n: number): string {
  return gameData().texts.objectDescriptions[n];
}

describe.skipIf(!hasOriginalFiles)("moteur : pièces, verbes et inventaire (sans rendu)", () => {
  it("chaque pièce se charge : zones, Joe placé, aucune séquence en attente", () => {
    const data = gameData();
    for (let room = 1; room <= data.jas.roomCount; room++) {
      const player = new Player({ room });
      player.settle();
      expect(player.state.room, `pièce ${room}`).toBe(room);
      expect(player.state.newRoom).toBe(0);
      expect(player.engine.grid.validZones(GridScreen.Room).length, `pièce ${room}`).toBeGreaterThan(0);
      expect(player.engine.canSave).toBe(true);
    }
 }, 60_000);

  it("commence par la pièce 95 (le logo) sans logique de pièce, et par une pièce d'entrée sinon", () => {
    const start = new Player();
    start.settle();
    expect(start.state.room).toBe(95);
    expect(start.state.inventory).toEqual([Item.Bat, Item.Journal, 0, 0]);
    // Hall de l'hôtel par le camion (objet 584, sans point de sortie) : Joe est posé sur l'objet, dos à lui.
    const hotel = new Player({ entryObject: 584 });
    hotel.settle();
    expect(hotel.state.room).toBe(73);
    expect([hotel.state.joe.x, hotel.state.joe.y]).toEqual([62, 107]);
  });

  it("survol : le nom de l'objet précédé de son verbe par défaut ; un verbe du panneau", () => {
    const player = new Player({ entryObject: 584 });
    player.settle();
    const box = gameData().jas.objectBoxes[585];
    player.move(box.x1 + 5, box.y1 + 5);
    player.run(1);
    expect(player.engine.command.line).toEqual({ text: "parler à portier", ink: "normal" });
    player.move(85, 175);
    player.run(1);
    expect(player.engine.command.line).toEqual({ text: "examiner", ink: "normal" });
  });

  it("pièce 1 : examiner le sac (fermé), l'ouvrir, l'examiner : couteau et briquet ; ouvrir la porte et passer en pièce 2", () => {
    const player = new Player({ room: 1 });
    player.settle();
    const { state } = player.engine;

    player.clickVerb(Panel.Look);
    player.clickObject(1);
    expect(player.talk.lines.at(-1)?.text).toBe(description(11));
    expect(player.talk.lines.at(-1)?.voicePrefix).toBe("JOE0051");

    player.clickVerb(Panel.Open);
    player.clickObject(1);
    expect(state.gameStates[1]).toBe(1);
    expect(state.objects[1].image).toBe(4);
    expect(stateOn(state.objects[1].state)).toBe(false);
    expect(player.host.songs).toContain(138);

    player.clickVerb(Panel.Look);
    player.clickObject(1);
    expect(player.talk.lines.at(-1)?.text).toBe(description(83));
    expect(player.engine.inventory.has(3)).toBe(true);
    expect(player.engine.inventory.has(40)).toBe(true);
    expect(state.inventory).toEqual([3, 40, Item.Bat, Item.Journal]);

    // La porte (objet 6) est fermée : y aller ne change pas de pièce.
    player.clickObject(6);
    expect(state.room).toBe(1);
    player.clickVerb(Panel.Open);
    player.clickObject(6);
    expect(state.objects[6].entryObject).toBe(8);
    expect(state.objects[6].image).toBe(-15);
    player.clickObject(6);
    expect(state.room).toBe(2);
    // Entrée par l'objet 8 : Joe part de son point de sortie et marche jusqu'à l'objet.
    expect(player.stage.moves.at(-1)).toEqual({ x: 185, y: 105, facing: Direction.None });
    expect([state.joe.x, state.joe.y]).toEqual([185, 105]);
  });

  it("pièce 2 : utiliser le couteau avec la tige (phrase à deux objets), condition manquée puis remplie", () => {
    const player = new Player({ entryObject: 8 });
    player.settle();
    const { state, command } = player.engine;
    state.items[3].name = Math.abs(state.items[3].name);
    player.engine.inventory.insert(3);
    expect(state.inventory[0]).toBe(3);

    player.clickVerb(Panel.Use);
    player.clickInventory(0);
    expect(command.text).toBe("utiliser couteau avec");
    player.clickObject(7);
    expect(player.talk.lines.at(-1)?.text).toBe(description(84));
    expect(state.objects[7].name).toBeGreaterThan(0);

    state.gameStates[5] = 1;
    player.clickVerb(Panel.Use);
    player.clickInventory(0);
    player.clickObject(7);
    expect(state.gameStates[196]).toBe(1);
    expect(state.objects[7].name).toBeLessThan(0);
    expect(player.talk.lines.at(-1)?.text).toBe(description(135));
    expect(command.text).toBe("");
  });

  it("pièce 73 : prendre la clef (cinématique si la condition manque, puis l'objet passe dans l'inventaire), parler au portier", () => {
    const player = new Player({ entryObject: 584 });
    player.settle();
    const { state, grid } = player.engine;

    player.clickVerb(Panel.PickUp);
    player.clickObject(581);
    expect(player.cutaways.played).toEqual(["c73d.CUT"]);
    expect(state.objects[581].name).toBeGreaterThan(0);

    state.gameStates[145] = 1;
    player.clickVerb(Panel.PickUp);
    player.clickObject(581);
    expect(state.objects[581].name).toBe(0);
    expect(grid.zone(GridScreen.Room, 1)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(player.engine.inventory.has(57)).toBe(true);
    expect(state.inventory[0]).toBe(57);

    // Parler au portier : sans la robe (état 19 ≠ 2), le dialogue de la condition manquée est lancé.
    player.clickVerb(Panel.Talk);
    player.clickObject(585);
    expect(player.talk.dialogues).toEqual([{ file: "laris.DOG", person: 5 }]);
  });

  it("clic droit : verbe par défaut, exécuté sur un objet de la pièce, en construction sur un objet d'inventaire", () => {
    const player = new Player({ entryObject: 584 });
    player.settle();
    // La clef : « examiner » par défaut.
    player.clickObject(581, 2);
    expect(player.talk.lines.at(-1)?.text).toBe(description(658));
    // La batte : « utiliser » par défaut, qui attend un second objet.
    const said = player.talk.lines.length;
    player.clickInventory(0, 2);
    expect(player.engine.command.text).toBe("utiliser batte avec");
    expect(player.talk.lines.length).toBe(said);
  });

  it("un clic pendant la marche l'interrompt et lance la nouvelle commande (update(true) de Walk::animateJoe)", () => {
    const player = new Player({ entryObject: 584 });
    player.settle();
    const { state } = player.engine;
    const start = { x: state.joe.x, y: state.joe.y };
    player.move(150, 140, 1);
    player.move(150, 140, 0);
    player.run(1);
    expect(player.engine.busy).toBe(true);
    const box = gameData().jas.objectBoxes[581];
    player.move(box.x1 + 2, box.y1 + 2, 2);
    player.move(box.x1 + 2, box.y1 + 2, 0);
    player.settle();
    expect(player.stage.moves[player.stage.moves.length - 2]).toMatchObject({ x: 150, y: 140 });
    expect([state.joe.x, state.joe.y]).not.toEqual([150, 140]);
    expect([state.joe.x, state.joe.y]).not.toEqual([start.x, start.y]);
    expect(player.talk.lines.at(-1)?.text).toBe(description(658));
  });

  it("clavier : verbe tapé, journal ; un clic droit coupe la réplique en cours", () => {
    const player = new Player({ entryObject: 584 });
    player.settle();
    player.action("look");
    expect(player.engine.command.text).toBe("examiner");
    player.clickObject(581);
    expect(player.talk.lines.at(-1)?.text).toBe(description(658));

    player.action("journal");
    expect(player.host.journals).toBe(1);

    // Réplique longue (la batte) : elle dure `textFrames` images ; un clic droit (`talkQuit`) l'arrête à l'image suivante. Comme dans
    // ScummVM, l'appui reste ensuite pour la commande : sur la case, il prépare le verbe par défaut de la batte.
    player.clickVerb(Panel.Look);
    const said = player.talk.lines.length;
    player.move(196, 175, 1);
    player.move(196, 175, 0);
    player.run(2);
    expect(player.engine.busy).toBe(true);
    expect(player.talk.lines.length).toBe(said + 1);
    player.move(196, 175, 2);
    player.move(196, 175, 0);
    player.run(2);
    expect(player.engine.busy).toBe(false);
    expect(player.engine.command.text).toBe("utiliser batte avec");
  });

  it("défilement de l'inventaire : une case par flèche, quatre au clic droit, seulement au-delà de quatre objets", () => {
    const player = new Player({ entryObject: 584 });
    player.settle();
    const { state, inventory } = player.engine;
    player.click(170, 165);
    expect(state.inventory).toEqual([Item.Bat, Item.Journal, 0, 0]);
    for (const item of [3, 40, 57]) inventory.insert(item);
    expect(state.inventory).toEqual([57, Item.Bat, Item.Journal, 3]);
    player.click(170, 190);
    expect(state.inventory).toEqual([Item.Bat, Item.Journal, 3, 40]);
    player.click(170, 165, 2);
    expect(state.inventory).toEqual([Item.Journal, 3, 40, 57]);
  });

  it("tenues de Joe (sections spéciales 2 et 3) : cinématique, inventaire, état 19, scène", () => {
    const player = new Player({ entryObject: 584 });
    player.settle();
    const { engine, state } = player;
    engine.inventory.insert(Item.Dress);
    player.perform(engine.joeUseDress(true));
    expect(player.cutaways.played).toEqual(["CDRES.CUT"]);
    expect(engine.inventory.has(Item.Dress)).toBe(false);
    expect(engine.inventory.has(Item.Clothes)).toBe(true);
    expect(state.gameStates[GameVar.JoeDressingMode]).toBe(Outfit.Dress);
    expect(player.stage.outfit).toBe(Outfit.Dress);
    player.perform(engine.joeUseClothes(true));
    expect(player.cutaways.played).toEqual(["CDRES.CUT", "CDCLO.CUT"]);
    expect(engine.inventory.has(Item.Dress)).toBe(true);
    expect(engine.inventory.has(Item.Clothes)).toBe(false);
    expect(state.gameStates[GameVar.JoeDressingMode]).toBe(Outfit.Normal);
    engine.joeUseUnderwear();
    expect(player.stage.outfit).toBe(Outfit.Underwear);
  });

  it("points d'extension (vague L) : pièce spéciale, mouvement spécial, zone éteinte", () => {
    const script: GameScript = {
      // Comme `LogicGame::changeToSpecialRoom` pour le logo : introduction, puis le hall de l'hôtel par le camion.
      *changeToSpecialRoom(g) {
        if (g.state.room !== 95) return false;
        yield* g.playCutaway("COPY.CUT");
        g.state.room = 73;
        g.state.entryObject = 584;
        yield* g.displayRoom(73, RoomDisplay.FadeJoe, 100, 2, true);
        // La cinématique C70D remet la pièce demandée à zéro (`Cutaway::run`) ; la version minimale ne le fait pas.
        g.state.newRoom = 0;
        return true;
      },
      specialMoves: {
        *14(g) {
          g.endGame();
        },
      },
      *handleSpecialArea(_g, _facing, areaNum) {
        return areaNum === 3 ? "C16A.CUT" : "";
      },
    };
    const player = new Player({ script });
    player.settle();
    expect(player.state.room).toBe(73);
    expect(player.cutaways.played).toEqual(["COPY.CUT"]);

    player.perform(player.engine.handleSpecialArea(Direction.Left, 3, 1));
    expect(player.cutaways.played).toEqual(["COPY.CUT", "C16A.CUT"]);
    expect(player.state.joe.facing).toBe(Direction.Left);

    player.engine.run(player.engine.executeSpecialMove(13));
    expect(player.engine.busy).toBe(false);
    player.engine.run(player.engine.executeSpecialMove(14));
    expect(player.host.exits).toBe(1);
    expect(player.engine.ended).toBe(true);
  });
});
