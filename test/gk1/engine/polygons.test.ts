import { describe, expect, it } from "vitest";
import { findPath, mergePolygons, type Point, pointInPolygon, type PolygonInput, PolygonType } from "../../../src/games/gk1/engine/polygons";

function points(...flat: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

function square(x: number, y: number, side: number): Point[] {
  return points(x, y, x + side, y, x + side, y + side, x, y + side);
}

const text = (path: readonly Point[]): string => path.map((point) => `${point.x},${point.y}`).join(" ");

/**
 * Polygones de la librairie (pièce 210), tels que le script les donne à `AvoidPath` (relevés dans `walk.test.ts`) : le
 * plancher où Gabriel peut marcher (accès contenu) et deux obstacles (accès barré : le bureau de Grace et la table basse).
 */
const BOOKSHOP: PolygonInput[] = [
  {
    type: PolygonType.ContainedAccess,
    points: points(
      ...[100, 91, 90, 103, 51, 118, 20, 132, 61, 142, 68, 143, 101, 130, 170, 144, 225, 144, 209, 155, 212, 174, 224, 174, 247, 144, 319, 144, 319, 105],
      ...[273, 105, 281, 114, 275, 123, 242, 122, 228, 131, 194, 128, 182, 119, 202, 103, 117, 87, 109, 92],
    ),
  },
  { type: PolygonType.BarredAccess, points: points(124, 103, 106, 95, 121, 89, 143, 95, 125, 103) },
  { type: PolygonType.BarredAccess, points: points(57, 122, 70, 126, 54, 138, 31, 130, 41, 124, 50, 124) },
];
/** Zone de jeu de la pièce : le plan du jeu fait 320×190. */
const AREA = { width: 320, height: 190 };

const path = (from: [number, number], to: [number, number], opt = 1): string =>
  text(findPath({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, BOOKSHOP, { ...AREA, opt }));

describe("recherche de chemin dans la librairie", () => {
  it("va tout droit quand rien ne gêne", () => {
    expect(path([110, 110], [140, 110])).toBe("110,110 140,110");
    expect(path([187, 125], [160, 135])).toBe("187,125 160,135");
  });

  it("contourne les coins du plancher", () => {
    // Du fond à droite vers le fond à gauche : par les deux coins rentrants du mur.
    expect(path([280, 130], [150, 94])).toBe("280,130 228,131 194,128 182,119 150,94");
    expect(path([150, 94], [217, 165])).toBe("150,94 182,119 194,128 225,144 217,165");
    expect(path([187, 125], [60, 140])).toBe("187,125 101,130 60,140");
    expect(path([60, 140], [280, 130])).toBe("60,140 101,130 228,131 280,130");
    expect(path([300, 120], [100, 100])).toBe("300,120 228,131 194,128 100,100");
  });

  it("contourne un obstacle par ses sommets", () => {
    // La table basse est entre le départ et l'arrivée.
    expect(path([150, 94], [30, 133])).toBe("150,94 125,103 41,124 31,130 30,133");
  });

  it("une arrivée dans un obstacle est ramenée à son bord", () => {
    expect(pointInPolygon({ x: 120, y: 96 }, BOOKSHOP[1].points)).toBe(true);
    expect(path([187, 125], [120, 96])).toBe("187,125 124,103 119,101");
    expect(path([187, 125], [45, 130])).toBe("187,125 101,130 54,138 44,135");
  });

  it("une arrivée hors du plancher est ramenée à son contour", () => {
    expect(path([187, 125], [300, 50])).toBe("187,125 194,128 228,131 275,123 300,105");
    // Clic de `walk.test.ts` : (150, 90) est dans le mur du fond.
    expect(path([280, 130], [150, 90])).toBe("280,130 228,131 194,128 182,119 150,94");
  });

  it("un départ dans un obstacle en sort d'abord, et garde le point d'origine en tête", () => {
    expect(path([120, 96], [187, 125])).toBe("120,96 119,101 124,103 187,125");
  });

  it("départ égal à l'arrivée : le chemin s'arrête au départ", () => {
    expect(path([187, 125], [187, 125])).toBe("187,125 187,125");
  });

  it("sans polygon, la ligne droite", () => {
    expect(text(findPath({ x: 1, y: 2 }, { x: 30, y: 40 }, [], AREA))).toBe("1,2 30,40");
  });

  it("au clavier (opt 0), s'arrête au premier contour rencontré", () => {
    expect(path([187, 125], [120, 96], 0)).toBe("187,125 125,103 124,103 119,101");
  });

  it("le chemin ne dépend pas de l'orientation des polygones donnés", () => {
    const reversed = BOOKSHOP.map((polygon) => ({ type: polygon.type, points: [...polygon.points].reverse() }));
    const there = findPath({ x: 280, y: 130 }, { x: 150, y: 94 }, reversed, AREA);
    expect(text(there)).toBe("280,130 228,131 194,128 182,119 150,94");
  });
});

describe("obstacles simples", () => {
  const box: PolygonInput = { type: PolygonType.BarredAccess, points: square(40, 40, 20) };

  it("prend le côté le plus court autour d'un carré", () => {
    expect(text(findPath({ x: 10, y: 45 }, { x: 90, y: 45 }, [box], AREA))).toBe("10,45 40,40 60,40 90,45");
    expect(text(findPath({ x: 10, y: 55 }, { x: 90, y: 55 }, [box], AREA))).toBe("10,55 40,60 60,60 90,55");
  });

  it("un polygon d'accès total se traverse si l'on en part ou si l'on y va, et se contourne sinon", () => {
    const open: PolygonInput = { ...box, type: PolygonType.TotalAccess };
    expect(text(findPath({ x: 10, y: 50 }, { x: 50, y: 50 }, [open], AREA))).toBe("10,50 50,50");
    expect(text(findPath({ x: 50, y: 50 }, { x: 90, y: 50 }, [open], AREA))).toBe("50,50 90,50");
    expect(text(findPath({ x: 10, y: 50 }, { x: 90, y: 50 }, [open], AREA))).toBe("10,50 40,40 60,40 90,50");
  });

  it("accès au plus près : on va au bord, puis au point visé", () => {
    expect(text(findPath({ x: 10, y: 50 }, { x: 45, y: 50 }, [{ ...box, type: PolygonType.NearestAccess }], AREA))).toBe("10,50 40,50 45,50");
    expect(text(findPath({ x: 10, y: 50 }, { x: 45, y: 50 }, [box], AREA))).toBe("10,50 40,50");
  });

  it("évite de longer le bord de l'écran", () => {
    // Le mur touche le haut de l'écran : passer par ses sommets du haut coûterait 10 000 de plus chacun.
    const wall: PolygonInput = { type: PolygonType.BarredAccess, points: points(100, 0, 110, 0, 110, 100, 100, 100) };
    expect(text(findPath({ x: 50, y: 10 }, { x: 150, y: 10 }, [wall], AREA))).toBe("50,10 100,100 110,100 150,10");
  });

  it("deux zones permises disjointes, et un mur qui barre l'écran", () => {
    const room: PolygonInput = { type: PolygonType.ContainedAccess, points: square(10, 10, 50) };
    const island: PolygonInput = { type: PolygonType.ContainedAccess, points: square(100, 10, 50) };
    // Deux zones permises disjointes : celle où le départ n'est pas est écartée, l'arrivée est ramenée au bord de la première.
    expect(text(findPath({ x: 20, y: 20 }, { x: 120, y: 30 }, [room, island], AREA))).toBe("20,20 60,30");
    // Le surcoût du bord de l'écran n'est pas une interdiction : sans autre passage, le chemin le longe.
    const wall: PolygonInput = { type: PolygonType.BarredAccess, points: points(80, 0, 90, 0, 90, 189, 80, 189) };
    expect(text(findPath({ x: 20, y: 20 }, { x: 200, y: 30 }, [wall], AREA))).toBe("20,20 80,0 90,0 200,30");
  });

  it("InPolygon : dedans ou sur le bord", () => {
    const shape = square(10, 10, 10);
    expect(pointInPolygon({ x: 15, y: 15 }, shape)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 10 }, shape)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 15 }, shape)).toBe(true);
    expect(pointInPolygon({ x: 21, y: 15 }, shape)).toBe(false);
    expect(pointInPolygon({ x: 5, y: 15 }, shape)).toBe(false);
    expect(pointInPolygon({ x: 15, y: 15 }, [])).toBe(false);
  });
});

describe("fusion de polygones (MergePoly)", () => {
  it("réunit deux carrés qui se chevauchent", () => {
    const result = mergePolygons(square(0, 0, 10), [{ type: PolygonType.BarredAccess, points: square(5, 5, 10) }]);
    expect(result.merged).toEqual([true]);
    expect(text(result.points)).toBe("0,0 10,0 10,5 15,5 15,15 5,15 5,10 0,10");
  });

  it("laisse tels quels des polygones disjoints", () => {
    const result = mergePolygons(square(0, 0, 10), [{ type: PolygonType.BarredAccess, points: square(50, 5, 10) }]);
    expect(result.merged).toEqual([false]);
    expect(text(result.points)).toBe("0,0 10,0 10,10 0,10");
  });

  it("absorbe les polygones l'un après l'autre, et dit lesquels", () => {
    const others = [square(5, 5, 10), square(12, 12, 10), square(100, 12, 10)].map((shape) => ({ type: PolygonType.BarredAccess, points: shape }));
    const result = mergePolygons(square(0, 0, 10), others);
    expect(result.merged).toEqual([true, true, false]);
    expect(text(result.points)).toBe("0,0 10,0 10,5 15,5 15,12 22,12 22,22 12,22 12,15 5,15 5,10 0,10");
  });

  it("l'orientation du polygon absorbé ne compte pas", () => {
    const result = mergePolygons(square(0, 0, 10), [{ type: PolygonType.BarredAccess, points: square(5, 5, 10).reverse() }]);
    expect(text(result.points)).toBe("0,0 10,0 10,5 15,5 15,15 5,15 5,10 0,10");
  });

  it("retire les points répétés à la suite", () => {
    expect(text(mergePolygons(points(0, 0, 0, 0, 10, 0, 10, 10), []).points)).toBe("0,0 10,0 10,10");
  });
});
