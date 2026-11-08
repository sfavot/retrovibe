import { describe, expect, it } from "vitest";
import { textFrames } from "../../../src/games/fotaq/engine/cadence";
import { Inventory } from "../../../src/games/fotaq/engine/inventory";
import {
  Direction,
  Grab,
  type GameData,
  type GameState,
  Item,
  Verb,
  cloneState,
  createGameState,
  stateDefaultVerb,
  stateDirection,
  stateGrab,
  stateOn,
  stateTalks,
  toInt16,
  usesWith,
  withDefaultVerb,
  withOn,
} from "../../../src/games/fotaq/engine/state";
import { gameData } from "./test-host";
import { hasOriginalFiles } from "../helpers";

describe("mot d'état d'un objet (state.cpp)", () => {
  it("lit l'orientation, la saisie, les bits allumé / parle / utiliser avec et le verbe par défaut", () => {
    // 0x403 : porte de la pièce 73 (saisie « milieu », de dos, fermée, verbe par défaut 0, « utiliser » sans second objet).
    expect(stateGrab(0x403)).toBe(Grab.Mid);
    expect(stateDirection(0x403)).toBe(Direction.Back);
    expect(stateDirection(0b0100)).toBe(Direction.Right);
    expect(stateDirection(0b1000)).toBe(Direction.Left);
    expect(stateDirection(0b1100)).toBe(Direction.Front);
    expect(stateOn(0x100)).toBe(true);
    expect(stateOn(0x0ff)).toBe(false);
    expect(stateTalks(0x200)).toBe(true);
    expect(usesWith(0x000)).toBe(true);
    expect(usesWith(0x400)).toBe(false);
    expect([0, 1, 3, 6, 7, 8, 9, 12, 14].map((code) => stateDefaultVerb(code << 4))).toEqual([
      Verb.None,
      Verb.Open,
      Verb.Close,
      Verb.LookAt,
      Verb.Move,
      Verb.Give,
      Verb.TalkTo,
      Verb.Use,
      Verb.PickUp,
    ]);
  });

  it("change le bit allumé et le verbe par défaut sans toucher au reste (alterOn, alterDefaultVerb)", () => {
    expect(withOn(0x0003, true)).toBe(0x0103);
    expect(withOn(0xffff, false)).toBe(0xfeff);
    for (const verb of [Verb.Open, Verb.Close, Verb.Move, Verb.Give, Verb.Use, Verb.PickUp, Verb.TalkTo, Verb.LookAt]) {
      const state = withDefaultVerb(0xf50f, verb);
      expect(stateDefaultVerb(state)).toBe(verb);
      expect(state & 0xff0f).toBe(0xf50f);
    }
    expect(withDefaultVerb(0x0ff0, Verb.WalkTo)).toBe(0x0f00);
  });

  it("textFrames : deux images par caractère (au moins dix) divisées par le tiers de la vitesse (countSpaces)", () => {
    expect(textFrames("")).toBe(2);
    expect(textFrames("x".repeat(35))).toBe(10);
    expect(textFrames("x".repeat(35), 9)).toBe(23);
  });

  it("toInt16 relit un mot de 16 bits signé", () => {
    expect(toInt16(65506)).toBe(-30);
    expect(toInt16(32767)).toBe(32767);
  });
});

/** Monde minimal : `count` objets d'inventaire, possédés si leur numéro est dans `owned`. */
function world(count: number, owned: number[]): { data: GameData; state: GameState } {
  const items = Array.from({ length: count + 1 }, (_, i) => ({
    name: i === 0 ? 0 : owned.includes(i) ? i : -i,
    description: 0,
    state: 0,
    frame: 0,
    sfxDescription: 0,
  }));
  const state = { items, inventory: [0, 0, 0, 0], gameStates: new Array(211).fill(0), room: 1 } as unknown as GameState;
  return { data: {} as GameData, state };
}

describe("inventaire (logic.cpp)", () => {
  it("l'objet ajouté prend la première case, les suivants en boucle derrière", () => {
    const w = world(10, [2, 5, 8]);
    const inventory = new Inventory(w);
    inventory.insert(7);
    expect(w.state.inventory).toEqual([7, 8, 2, 5]);
    expect(inventory.has(7)).toBe(true);
    inventory.remove(8);
    expect(w.state.inventory).toEqual([2, 5, 7, 0]);
    expect(inventory.has(8)).toBe(false);
  });

  it("défile seulement au-delà de quatre objets, d'un objet ou de quatre", () => {
    const w = world(12, [1, 2, 3, 4]);
    const inventory = new Inventory(w);
    inventory.setup();
    expect(w.state.inventory).toEqual([Item.Bat, Item.Journal, 0, 0]);
    w.state.inventory = [1, 2, 3, 4];
    inventory.scroll(1, false);
    expect(w.state.inventory).toEqual([1, 2, 3, 4]);
    inventory.insert(9);
    expect(w.state.inventory).toEqual([9, 1, 2, 3]);
    inventory.scroll(1, false);
    expect(w.state.inventory).toEqual([1, 2, 3, 4]);
    inventory.scroll(1, true);
    expect(w.state.inventory).toEqual([9, 1, 2, 3]);
    inventory.scroll(4, true);
    expect(w.state.inventory).toEqual([1, 2, 3, 4]);
  });

  it("le dernier objet n'est jamais proposé par « suivant » (nextInventoryItem de ScummVM), mais par « précédent »", () => {
    const w = world(5, [5]);
    const inventory = new Inventory(w);
    expect(inventory.next(1)).toBe(0);
    expect(inventory.previous(1)).toBe(5);
    expect(inventory.owned()).toBe(0);
  });

  it("retire les objets de l'hôtel une seule fois, dans la pièce 1", () => {
    const w = world(61, [Item.Crowbar, Item.Dress, Item.Chicken, Item.Bat]);
    const inventory = new Inventory(w);
    inventory.removeHotelItems();
    expect([Item.Crowbar, Item.Dress, Item.Chicken].map((item) => inventory.has(item))).toEqual([false, false, false]);
    expect(inventory.has(Item.Bat)).toBe(true);
    expect(w.state.gameStates[3]).toBe(1);
    inventory.insert(Item.Crowbar);
    inventory.removeHotelItems();
    expect(inventory.has(Item.Crowbar)).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("état de départ (QUEEN.JAS)", () => {
  it("commence dans la pièce de l'objet d'entrée (95, le logo), états nuls, copie indépendante des données", () => {
    const data = gameData();
    const state = createGameState(data);
    expect(state.room).toBe(95);
    expect(state.objects).toHaveLength(793);
    expect(state.items).toHaveLength(101);
    expect(state.gameStates.every((value) => value === 0)).toBe(true);
    state.objects[1].name = -1;
    state.areas[1][1].mapNeighbors = -99;
    expect(data.jas.objects[1].name).not.toBe(-1);
    expect(data.jas.rooms[1].areas[1].mapNeighbors).not.toBe(-99);
    const copy = cloneState(state);
    expect(JSON.parse(JSON.stringify(copy))).toEqual(state);
  });

  it("les objets d'inventaire nommés par ScummVM portent les bons noms", () => {
    const { jas, texts } = gameData();
    const name = (item: number) => texts.objectNames[Math.abs(jas.items[item].name)];
    expect([Item.Bat, Item.Journal, Item.Crowbar, Item.Dress, Item.Clothes, Item.Hay, Item.Oil, Item.Chicken].map(name)).toEqual([
      "batte",
      "journal",
      "barre à mine",
      "robe",
      "vêtements",
      "paille",
      "huile",
      "poulet",
    ]);
  });
});
