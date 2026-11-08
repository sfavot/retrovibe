import { describe, expect, it } from "vitest";
import { MoveResult } from "../../../src/games/fotaq/engine/services";
import { GameStage } from "../../../src/games/fotaq/engine/stage";
import { Direction, toInt16 } from "../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../helpers";
import { Player, gameData } from "./test-host";

/** Un joueur dans la pièce `room` avec la vraie scène ; les zones éteintes rencontrées sont notées dans `stops`. */
function enter(room: number) {
  const stops: { area: number; facing: number }[] = [];
  const stage = new GameStage();
  const player = new Player({
    room,
    stage,
    script: {
      *handleSpecialArea(_g, facing, area) {
        stops.push({ area, facing });
        return "";
      },
    },
  });
  player.settle();
  return { player, stage, stops, engine: player.engine };
}

/** Points d'une pièce où Joe entre ou sort : le point de sortie de ses objets de passage, sinon leur position (`makeJoeWalkTo`). */
function exitPoints(player: Player, room: number): { object: number; x: number; y: number }[] {
  const { state, data } = player.engine;
  const first = data.jas.roomFirstObject[room];
  const last = data.jas.roomFirstObject[room + 1];
  const points: { object: number; x: number; y: number }[] = [];
  for (let object = first + 1; object <= last; object++) {
    const data = state.objects[object];
    if (data.entryObject === 0) continue;
    const walkOff = player.engine.walkOffPoint(object);
    if (walkOff) points.push({ object, x: toInt16(walkOff.x), y: toInt16(walkOff.y) });
    else if (data.x !== 0 || data.y !== 0) points.push({ object, x: toInt16(data.x), y: toInt16(data.y) });
  }
  return points;
}

/**
 * Composante connexe de chaque zone de marche (voisines `|mapNeighbors|`, le bit `n - k` désigne la zone `k`), calculée
 * indépendamment de la marche : `component[zone]`.
 */
function areaComponents(player: Player, room: number): number[] {
  const areas = player.state.areas[room];
  const count = areas.length - 1;
  const component: number[] = new Array<number>(count + 1).fill(0);
  let components = 0;
  for (let start = 1; start <= count; start++) {
    if (component[start] !== 0) continue;
    components++;
    const stack = [start];
    while (stack.length > 0) {
      const area = stack.pop() as number;
      if (component[area] !== 0) continue;
      component[area] = components;
      const map = Math.abs(areas[area].mapNeighbors);
      for (let other = 1; other <= count; other++) if (map & (1 << (count - other))) stack.push(other);
    }
  }
  return component;
}

/** Zone d'un point : celle qui le contient, sinon la plus proche (distance au rectangle). */
function areaOf(player: Player, room: number, x: number, y: number): number {
  const areas = player.state.areas[room];
  let best = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let n = 1; n < areas.length; n++) {
    const { box } = areas[n];
    const dx = Math.max(box.x1 - x, 0, x - box.x2);
    const dy = Math.max(box.y1 - y, 0, y - box.y2);
    if (dx * dx + dy * dy < bestDistance) {
      bestDistance = dx * dx + dy * dy;
      best = n;
    }
  }
  return best;
}

function insideAnyArea(player: Player, room: number, x: number, y: number): boolean {
  return player.state.areas[room].slice(1).some((a) => x >= a.box.x1 && x <= a.box.x2 && y >= a.box.y1 && y <= a.box.y2);
}

describe.skipIf(!hasOriginalFiles)("marche de Joe (walk.cpp)", () => {
  it("toute porte est atteignable depuis toute arrivée, dans les 126 pièces", () => {
    const data = gameData();
    let walks = 0;
    let blocked = 0;
    const cut: number[] = [];
    for (let room = 1; room <= data.jas.roomCount; room++) {
      const { player, stage, stops, engine } = enter(room);
      if (player.state.areas[room].length < 2) continue;
      const points = exitPoints(player, room);
      for (const from of points) {
        for (const to of points) {
          // Joe arrive par `from` (sans passer par la pièce voisine), puis va à `to`.
          stage.bobs.bob(0).curPos(from.x, from.y);
          player.state.joe.x = from.x;
          player.state.joe.y = from.y;
          stops.length = 0;
          let result = -99;
          player.perform(
            (function* () {
              result = yield* stage.moveJoe(engine, Direction.None, to.x, to.y, false);
            })(),
          );
          walks++;
          const where = `pièce ${room} : de l'objet ${from.object} (${from.x},${from.y}) à l'objet ${to.object} (${to.x},${to.y})`;
          const components = areaComponents(player, room);
          const connected = components[areaOf(player, room, from.x, from.y)] === components[areaOf(player, room, to.x, to.y)];
          if (!connected) {
            // Les zones ne communiquent pas dans les données : Joe dit qu'il ne peut pas y aller (réponse 4).
            expect(result, where).toBe(MoveResult.Interrupted);
            expect(player.talk.lines.at(-1)?.text, where).toBe(engine.joeResponse(4));
            if (!cut.includes(room)) cut.push(room);
            continue;
          }
          expect([MoveResult.Arrived, MoveResult.SpecialArea], where).toContain(result);
          if (result === MoveResult.Arrived) {
            // Arrivé : au point visé s'il est dans une zone, sinon dans la zone la plus proche.
            expect(insideAnyArea(player, room, player.state.joe.x, player.state.joe.y), where).toBe(true);
            if (insideAnyArea(player, room, to.x, to.y) && engine.grid.findAreaForPos(to.x, to.y) !== 0) {
              expect([player.state.joe.x, player.state.joe.y], where).toEqual([to.x, to.y]);
            }
            expect(stops, where).toHaveLength(0);
          } else {
            // Arrêté par une zone éteinte, et par elle seule.
            blocked++;
            expect(stops, where).toHaveLength(1);
            expect(player.state.areas[room][stops[0].area].mapNeighbors, where).toBeLessThan(0);
          }
        }
      }
    }
    // Décors dont les zones de marche forment plusieurs îlots (relevé sur QUEEN.JAS) : de l'un à l'autre, Joe ne peut pas marcher.
    expect(cut).toEqual([39, 49, 52, 54, 97, 99, 100, 101]);
    expect(walks).toBeGreaterThan(500);
    // Au départ du jeu, quelques zones sont éteintes (ponts, portes à ouvrir) : les arrêts existent mais restent minoritaires.
    expect(blocked).toBeLessThan(walks / 4);
  }, 120_000);

  it("une zone éteinte sur le chemin arrête Joe (-2), allumée il passe", () => {
    const { player, stage, stops, engine } = enter(4);
    const areas = player.state.areas[4];
    const off = areas.findIndex((a) => a.mapNeighbors < 0);
    expect(off).toBeGreaterThan(0);
    const box = areas[off].box;
    const target = { x: Math.trunc((box.x1 + box.x2) / 2), y: Math.trunc((box.y1 + box.y2) / 2) };
    stage.bobs.bob(0).curPos(areas[1].box.x1 + 1, areas[1].box.y2 - 1);
    let result = -99;
    player.perform(
      (function* () {
        result = yield* stage.moveJoe(engine, Direction.None, target.x, target.y, false);
      })(),
    );
    expect(result).toBe(MoveResult.SpecialArea);
    expect(stops).toHaveLength(1);
    expect(stops[0].area).toBe(off);
    // Les zones restent traversables : une fois allumée (signe de `mapNeighbors`), la marche va au bout.
    areas[off].mapNeighbors = Math.abs(areas[off].mapNeighbors);
    stage.bobs.bob(0).curPos(areas[1].box.x1 + 1, areas[1].box.y2 - 1);
    player.perform(
      (function* () {
        result = yield* stage.moveJoe(engine, Direction.None, target.x, target.y, false);
      })(),
    );
    expect(result).toBe(MoveResult.Arrived);
    expect([player.state.joe.x, player.state.joe.y]).toEqual([target.x, target.y]);
  });
});
