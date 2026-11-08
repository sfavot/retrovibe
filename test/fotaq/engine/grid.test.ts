import { describe, expect, it } from "vitest";
import type { JasArea } from "../../../src/games/fotaq/data/jas";
import { Grid, GridScreen, areaScale } from "../../../src/games/fotaq/engine/grid";
import { objectCopy, personNumber, resetRoomImages, roomObjects, walkOffPoint } from "../../../src/games/fotaq/engine/room";
import { Verb, createGameState } from "../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../helpers";
import { gameData } from "./test-host";

function area(y1: number, y2: number, bottom: number, top: number): JasArea {
  return { mapNeighbors: 1, box: { x1: 0, y1, x2: 100, y2 }, bottomScaleFactor: bottom, topScaleFactor: top, object: 0 };
}

describe("échelle d'une zone (Area::calcScale)", () => {
  it("interpole en entiers tronqués entre l'échelle du bas et celle du haut ; 0 devient 100", () => {
    expect(areaScale(area(100, 150, 50, 100), 100)).toBe(50);
    expect(areaScale(area(100, 150, 50, 100), 150)).toBe(100);
    expect(areaScale(area(100, 150, 50, 100), 133)).toBe(83);
    // Échelle décroissante : `ds` négatif, troncature vers zéro comme en C.
    expect(areaScale(area(0, 3, 90, 10), 1)).toBe(64);
    expect(areaScale(area(10, 10, 70, 80), 10)).toBe(100);
    expect(areaScale(area(0, 10, 0, 0), 5)).toBe(100);
  });
});

function world(room: number) {
  const data = gameData();
  const state = createGameState(data);
  state.room = room;
  const w = { data, state };
  const grid = new Grid(w);
  grid.setupPanel();
  grid.setupNewRoom(room);
  return { data, state, grid, w };
}

describe.skipIf(!hasOriginalFiles)("zones (grid.cpp) sur QUEEN.JAS", () => {
  it("les cases du panneau donnent les verbes, les flèches et les cases d'inventaire (findVerbUnderCursor)", () => {
    const { grid } = world(1);
    const verbs = [5, 25, 45, 65, 85, 105, 125, 145].map((x) => grid.findVerbUnderCursor(x, 175));
    expect(verbs).toEqual([Verb.Open, Verb.Close, Verb.Move, Verb.Give, Verb.LookAt, Verb.PickUp, Verb.TalkTo, Verb.Use]);
    expect(grid.findVerbUnderCursor(170, 165)).toBe(Verb.ScrollUp);
    expect(grid.findVerbUnderCursor(170, 190)).toBe(Verb.ScrollDown);
    expect([196, 231, 267, 302].map((x) => grid.findVerbUnderCursor(x, 175))).toEqual([13, 14, 15, 16]);
    // Bandeau du haut du panneau (y < 160) et pièce : aucun verbe.
    expect(grid.findVerbUnderCursor(10, 155)).toBe(Verb.None);
    expect(grid.findVerbUnderCursor(10, 100)).toBe(Verb.None);
  });

  it("chaque pièce se prépare : une zone par objet non supprimé puis par zone de marche", () => {
    const data = gameData();
    for (let room = 1; room <= data.jas.roomCount; room++) {
      const { grid, state } = world(room);
      const objMax = grid.objMax(room);
      const { first, count } = roomObjects(data, room);
      expect(count).toBe(objMax);
      const zones = grid.validZones(GridScreen.Room).map((zone) => zone.n);
      const expected: number[] = [];
      for (let n = 1; n <= objMax; n++) if (state.objects[first + n].name !== 0) expected.push(n);
      for (let n = 1; n <= grid.areaMax(room); n++) expected.push(objMax + n);
      expect(zones).toEqual(expected);
    }
  });

  it("un clic sur un objet donne son numéro dans la pièce ; sur une zone de marche, l'objet qu'elle porte (findObjectNumber)", () => {
    const { grid, data } = world(73);
    // Pièce 73 (hall de l'hôtel) : la clef est l'objet 581, premier objet de la pièce.
    const box = data.jas.objectBoxes[581];
    expect(grid.findObjectNumber(grid.findObjectUnderCursor(box.x1 + 2, box.y1 + 2, 0))).toBe(1);
    expect(grid.findObjectUnderCursor(box.x1 + 2, 160, 0)).toBe(0);
    // Une zone de marche qui porte un objet le désigne ; les autres rien.
    for (let n = 1; n <= grid.areaMax(73); n++) {
      const object = data.jas.rooms[73].areas[n].object;
      expect(grid.findObjectNumber(grid.objMax(73) + n)).toBe(object === 0 ? 0 : object - data.jas.roomFirstObject[73]);
    }
  });

  it("corrige la boîte de l'escalier de la pièce 41 (bug 2913 de ScummVM)", () => {
    const { grid, data } = world(41);
    const zone = 303 - data.jas.roomFirstObject[41];
    expect(grid.zone(GridScreen.Room, zone)).toEqual({ ...data.jas.objectBoxes[303], y1: data.jas.objectBoxes[295].y2 + 1 });
  });

  it("findScale : échelle de la zone de marche sous le point, 100 ailleurs", () => {
    const { grid, state } = world(1);
    const first = state.areas[1][1];
    const x = first.box.x1 + 1;
    const y = first.box.y2;
    if (grid.findAreaForPos(x, y) === 1) expect(grid.findScale(x, y)).toBe(areaScale(first, y));
    expect(grid.findScale(-50, -50)).toBe(100);
  });
});

describe.skipIf(!hasOriginalFiles)("objets d'une pièce (logic.cpp) sur QUEEN.JAS", () => {
  it("personNumber compte les personnes de la pièce jusqu'à l'objet", () => {
    const { w } = world(1);
    // Pièce 1 : Sparky (2) et Faye (3) sont des personnes.
    expect(personNumber(w, 2, 1)).toBe(1);
    expect(personNumber(w, 3, 1)).toBe(2);
    expect(personNumber(w, 1, 1)).toBe(0);
  });

  it("resetRoomImages : supprimé -> image 0, éteint -> -1 (fixe) ou -2 (animé)", () => {
    const { w, state, data } = world(1);
    state.objects[1].image = -(1 + 10);
    state.objects[4].name = 0;
    resetRoomImages(w, 1);
    expect(state.objects[1].image).toBe(data.jas.graphics[1].lastFrame === 0 ? -1 : -2);
    expect(state.objects[4].image).toBe(0);
  });

  it("objectCopy copie le modèle, rend l'objet visible et lui donne le point de sortie du modèle", () => {
    const { w, state } = world(1);
    const real = 4;
    const dummy = 5;
    state.objects[dummy] = { ...state.objects[dummy], name: -77, image: 0 };
    state.walkOffs[1].entryObject = dummy;
    objectCopy(w, dummy, real);
    expect(state.objects[real].name).toBe(77);
    expect(state.objects[dummy].name).toBe(-77);
    expect(walkOffPoint(state, real)).toBe(state.walkOffs[1]);
  });
});
