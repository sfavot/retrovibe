import { describe, expect, it } from "vitest";
import type { DatRoomAction } from "../../../src/games/drascula/data/dat";
import {
  addObject,
  chooseObject,
  findRoomAction,
  inventorySlotAt,
  nextExcuse,
  removeObject,
  selectVerb,
  verbAtBar,
} from "../../../src/games/drascula/engine/actions";
import { INVENTORY_SIZE, Verb, createGameState } from "../../../src/games/drascula/engine/state";

const row = (room: number, chapter: number, action: number, objectId: number, speechId: number): DatRoomAction => ({
  room,
  chapter,
  action,
  objectId,
  speechId,
});

describe("findRoomAction (roomParse)", () => {
  const table = [
    row(1, -1, Verb.Look, 118, 1),
    row(1, 2, Verb.Default, 118, 2),
    row(1, -1, Verb.Pick, -1, 3),
    row(2, -1, Verb.Look, 5, 4),
    row(1, -1, Verb.Open, 9, 5),
  ];

  it("prend la première ligne qui convient : chapitre, verbe et objet, avec les jokers -1", () => {
    expect(findRoomAction(table, 1, 1, Verb.Look, 118)?.speechId).toBe(1);
    expect(findRoomAction(table, 1, 2, Verb.Talk, 118)?.speechId).toBe(2);
    expect(findRoomAction(table, 1, 1, Verb.Talk, 118)).toBeNull();
    expect(findRoomAction(table, 1, 4, Verb.Pick, 77)?.speechId).toBe(3);
  });

  it("s'arrête après les lignes contiguës de la pièce, comme ScummVM", () => {
    expect(findRoomAction(table, 1, 1, Verb.Open, 9)).toBeNull();
    expect(findRoomAction(table, 2, 1, Verb.Look, 5)?.speechId).toBe(4);
  });
});

describe("inventaire et curseur", () => {
  it("ajoute sans doublon, retire, et lève quand l'inventaire est plein", () => {
    const state = createGameState(1);
    addObject(state, 28);
    addObject(state, 28);
    expect(state.inventory.filter((object) => object === 28)).toHaveLength(1);
    expect(removeObject(state, 28)).toBe(true);
    expect(removeObject(state, 28)).toBe(false);
    for (let n = 1; n < INVENTORY_SIZE; n++) addObject(state, 100 + n);
    expect(() => addObject(state, 7)).toThrow(/plein/);
  });

  it("un verbe ou un objet choisi renvoie l'objet tenu dans l'inventaire (sauf la prise au chapitre 5)", () => {
    const state = createGameState(1);
    chooseObject(state, 20);
    selectVerb(state, Verb.Look);
    expect(state.inventory).toContain(20);
    expect(state.pickedObject).toBe(Verb.Look);
    selectVerb(state, Verb.None);
    expect(state.takeObject).toBe(false);

    const chapter5 = createGameState(5);
    chooseObject(chapter5, 16);
    selectVerb(chapter5, Verb.Look);
    expect(chapter5.inventory).not.toContain(16);
  });

  it("chooseObject ne range pas l'objet tenu quand l'inventaire est ouvert", () => {
    const state = createGameState(1);
    chooseObject(state, 20);
    state.menuScreen = true;
    chooseObject(state, 21);
    expect(state.inventory).not.toContain(20);
    expect(state.pickedObject).toBe(21);
  });

  it("case sous la souris (bornes exclues) et verbe de la barre", () => {
    const locations = [
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: 50, y: 10 },
    ];
    expect(inventorySlotAt(locations, 6, 11)).toBe(1);
    expect(inventorySlotAt(locations, 5, 11)).toBe(0);
    expect(inventorySlotAt(locations, 51, 30)).toBe(2);
    const bar = [0, 26, 65, 108, 152, 196, 241, 285];
    expect(verbAtBar(bar, 10)).toBe(Verb.None);
    expect(verbAtBar(bar, 70)).toBe(Verb.Pick);
    expect(verbAtBar(bar, 65)).toBe(Verb.None);
  });

  it("room_0 fait tourner les excuses aux chapitres 2, 4, 5, 6 seulement", () => {
    const state = createGameState(2);
    state.pickedObject = Verb.Open;
    expect([nextExcuse(state), nextExcuse(state)]).toEqual([11, 109]);
    expect(nextExcuse(createGameState(1))).toBeNull();
    expect(nextExcuse(createGameState(3))).toBeNull();
  });
});
