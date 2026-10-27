import { describe, expect, it } from "vitest";
import { readScene } from "../../src/games/armaeth/data/scene";
import { readSceneArchive } from "../../src/games/armaeth/data/vga-archive";
import { parseWorld } from "../../src/games/armaeth/data/world";
import {
  GRID_COLUMNS,
  GRID_ROWS,
  buildWalkGrid,
  cellIndex,
  createTerrain,
  placementHeight,
  terrainCollision,
  typeAt,
  type Terrain,
} from "../../src/games/armaeth/engine/ground";
import {
  PLACE_EMPTY_WINDOW,
  PLACE_NOT_FOUND,
  PLACE_OUTSIDE_ROOM,
  PLACE_TYPE_CHANGED,
  SEARCH_CLICK,
  SEARCH_FREE,
  createPlacementMemory,
  placeObject,
  quirkySqrt,
  searchPosition,
  type PlaceBody,
  type PlaceEnv,
} from "../../src/games/armaeth/engine/placement";
import { hasOriginalFiles, readOriginal } from "./helpers";

/** Enregistrement de 16 octets de la grille : `{type, plan, rangée, c0, hi0, lo0, c1, hi1, lo1}`. */
function record(type: number, plane: number, row: number, c0: number, hi0: number, lo0: number, c1: number, hi1: number, lo1: number): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  bytes[0] = type;
  bytes[1] = plane;
  [row, c0, hi0, lo0, c1, hi1, lo1].forEach((v, i) => view.setInt16(2 + 2 * i, v, true));
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function syntheticTerrain(records: Uint8Array, planes = 1): Terrain {
  return {
    grid: buildWalkGrid(records),
    limits: { xMin: 0, xMax: 319, yMin: 0, yMax: 179, pMin: 8, pMax: 159 },
    zones: [],
    planes,
    permutation: [0, 1, 2, 3, 4, 5],
    inversePermutation: [0, 1, 2, 3, 4, 5],
    rowRanges: Array.from({ length: 20 }, () => ({ min: 0, max: 319 })),
  };
}

function walker(x: number, y: number, p: number, extra: Partial<PlaceBody> = {}): PlaceBody {
  return { x, y, p, plane: 0, ground: 2, presence: 2, err: 0, info: 0, dep: 0, txt: 0, height: 40, width: 20, ...extra };
}

function envOf(terrain: Terrain, extra: Partial<PlaceEnv> = {}): PlaceEnv {
  return { terrain, inRoom: true, memory: createPlacementMemory(), ...extra };
}

describe("racine entière de 1b11:140e", () => {
  it("rend lo quand hi - lo <= 1, donc un de moins pour certains carrés parfaits", () => {
    expect(quirkySqrt(100, 10 + 5)).toBe(10);
    expect(quirkySqrt(436, 20)).toBe(19); // borne trop petite d'une unité (movement.md § 4.5)
    expect(quirkySqrt(1, 1)).toBe(0); // une distance d'un pixel donne 0 : « parfait »
    expect(quirkySqrt(2, 2)).toBe(1);
  });
});

describe("placement : recherche sur terrain synthétique", () => {
  // un sol plat Y 100 sur les rangées 2 à 4, colonnes 10 à 40
  const flat = syntheticTerrain(concat(...[2, 3, 4].map((row) => record(2, 0, row, 10, 179, 100, 40, 179, 100))));

  it("rend la position quand elle est déjà valide (distance 0)", () => {
    const body = walker(80, 100, 24);
    expect(searchPosition(body, envOf(flat), SEARCH_FREE)).toBe(0);
    expect([body.x, body.y, body.p, body.plane, body.ground]).toEqual([80, 100, 24, 0, 2]);
    expect(body.presence).toBe(2);
  });

  it("choisit la position praticable la plus proche en X et P, à la hauteur du sol", () => {
    const body = walker(10, 30, 24);
    expect(searchPosition(body, envOf(flat), SEARCH_FREE)).toBe(0);
    expect([body.x, body.y, body.p]).toEqual([40, 100, 24]);
    const far = walker(300, 100, 40);
    searchPosition(far, envOf(flat), SEARCH_FREE);
    expect(far.x).toBe(163); // bord droit du sol ; la spirale s'arrête avant la rangée la plus proche (fenêtre rognée)
  });

  it("tolérances et signes : fenêtre autour de la position, repli sur la cible", () => {
    const body = walker(20, 100, 24);
    // tolérance X 4 : aucune case praticable à moins de 4 px de X = 20
    expect(searchPosition(body, envOf(flat), { ...SEARCH_FREE, tolX: 4 })).toBe(PLACE_NOT_FOUND);
    expect([body.x, body.p]).toEqual([20, 24]);
    const right = walker(80, 100, 24);
    expect(searchPosition(right, envOf(flat), { ...SEARCH_FREE, signX: 1, tolX: 10 })).toBe(0);
    expect(right.x).toBe(80);
    // signe -1 en X avec un X sous le minimum de la fenêtre : conflit de bornes
    const memory = createPlacementMemory();
    const below = walker(-5, 100, 24);
    expect(searchPosition(below, envOf(flat, { memory }), { ...SEARCH_FREE, signX: -1 })).toBe(PLACE_EMPTY_WINDOW);
  });

  it("côté figé : la recherche reste le long du bord (modes AX 0 à 5)", () => {
    const body = walker(80, 100, 24);
    // côté 1 : Xmin := Xmax, la seule abscisse possible est 319 (hors sol) : échec
    expect(searchPosition(body, envOf(flat), { ...SEARCH_FREE, side: 1 })).toBe(PLACE_NOT_FOUND);
    const bottom = walker(80, 100, 24);
    // côté 2 (avant) : Pmin := Pmax = 159, hors sol : échec ; côté 0 (fond) : Pmax := Pmin = 8, hors sol : échec
    expect(searchPosition(bottom, envOf(flat), { ...SEARCH_FREE, side: 2 })).toBe(PLACE_NOT_FOUND);
    const left = syntheticTerrain(concat(...[2, 3].map((row) => record(2, 0, row, 0, 179, 100, 79, 179, 100))));
    const edge = walker(120, 100, 20);
    expect(searchPosition(edge, envOf(left), { ...SEARCH_FREE, side: 3 })).toBe(0);
    expect(edge.x).toBe(0);
    expect(edge.p).toBe(20);
  });

  it("type exigé : seules les cases de ce type, 0x11 si le type change", () => {
    const mixed = syntheticTerrain(concat(record(2, 0, 3, 10, 179, 100, 20, 179, 100), record(35, 0, 3, 30, 179, 100, 40, 179, 100)));
    const body = walker(60, 100, 24, { ground: 2 });
    expect(searchPosition(body, envOf(mixed), { ...SEARCH_FREE, type: 35 })).toBe(PLACE_TYPE_CHANGED);
    expect(body.ground).toBe(35);
    expect(body.x).toBe(120);
    const refused = walker(60, 100, 24, { ground: 2 });
    const env = envOf(mixed, { acceptsGround: (type) => type !== 35 });
    searchPosition(refused, env, SEARCH_FREE);
    expect(refused.ground).toBe(2);
    expect(refused.x).toBe(60); // déjà sur une case de type 2
  });

  it("succès dans la salle chargée : le type trouvé passe par 13a8:000a avec l'effet 7 (`1b11:05a8`), pas hors salle", () => {
    const mixed = syntheticTerrain(concat(record(2, 0, 3, 10, 179, 100, 20, 179, 100), record(35, 0, 3, 30, 179, 100, 40, 179, 100)));
    const calls: [number, number][] = [];
    const acceptsGround = (type: number, effect: number): boolean => {
      calls.push([type, effect]);
      return true;
    };
    searchPosition(walker(60, 100, 24), envOf(mixed, { acceptsGround }), { ...SEARCH_FREE, type: 35 });
    expect(calls.at(-1)).toEqual([35, 7]);
    expect(calls.filter(([, effect]) => effect === 7)).toHaveLength(1);
    calls.length = 0;
    searchPosition(walker(60, 100, 24), envOf(mixed, { acceptsGround, inRoom: false }), { ...SEARCH_FREE, type: 35 });
    expect(calls.some(([, effect]) => effect === 7)).toBe(false);
  });

  it("quirk : la spirale ne visite jamais la case (même rangée, colonne - 1)", () => {
    // seule la case 49 de la rangée 5 est praticable ; la cible est dans la colonne 50 de la même rangée
    const lone = syntheticTerrain(concat(record(2, 0, 5, 49, 179, 100, 49, 179, 100), record(2, 0, 6, 49, 179, 100, 49, 179, 100)));
    const body = walker(50 * 4 + 1, 100, 5 * 8 + 2);
    expect(searchPosition(body, envOf(lone), SEARCH_FREE)).toBe(0);
    expect(body.p >> 3).toBe(6); // une rangée plus loin, la case de gauche à même distance est ignorée
    // sans l'omission, (rangée 5, colonne 49) serait plus proche
    const same = syntheticTerrain(record(2, 0, 5, 49, 179, 100, 49, 179, 100));
    const stuck = walker(50 * 4 + 1, 100, 5 * 8 + 2);
    expect(searchPosition(stuck, envOf(same), SEARCH_FREE)).toBe(PLACE_NOT_FOUND);
  });

  it("quirk : DS:0ea8 n'est jamais remis à zéro (un échec rend le dernier code non nul)", () => {
    const memory = createPlacementMemory();
    const ok = walker(80, 100, 24, { ground: 35 });
    // type 35 demandé alors que le sol est de type 2 : trouvé mais le type change... d'abord un échec franc
    expect(searchPosition(ok, envOf(flat, { memory }), { ...SEARCH_FREE, type: 35 })).toBe(PLACE_NOT_FOUND);
    expect(memory.code).toBe(PLACE_NOT_FOUND);
    // un succès avec changement de type laisse 0x11 ...
    const changed = walker(80, 100, 24, { ground: 3 });
    expect(searchPosition(changed, envOf(flat, { memory }), SEARCH_FREE)).toBe(PLACE_TYPE_CHANGED);
    // ... et l'échec suivant le rend tel quel au lieu de 0x14
    const impossible = walker(80, 100, 24);
    expect(searchPosition(impossible, envOf(flat, { memory }), { ...SEARCH_FREE, type: 77 })).toBe(PLACE_TYPE_CHANGED);
    // un succès sans changement remet le code à 0 : l'échec suivant rend 0x14
    expect(searchPosition(walker(80, 100, 24), envOf(flat, { memory }), SEARCH_FREE)).toBe(0);
    expect(searchPosition(walker(80, 100, 24), envOf(flat, { memory }), { ...SEARCH_FREE, type: 77 })).toBe(PLACE_NOT_FOUND);
  });

  it("hors salle : fenêtre maximale, pas de grille, la hauteur courante est conservée ; échec = 0x15", () => {
    const body = walker(400, 77, 300, { ground: 0 });
    const env = envOf(flat, { inRoom: false });
    expect(searchPosition(body, env, SEARCH_FREE)).toBe(0);
    expect([body.x, body.y, body.p, body.presence]).toEqual([319, 77, 255, 1]);
    const none = walker(400, 77, 300, { ground: 0 });
    expect(searchPosition(none, envOf(flat, { inRoom: false }), { ...SEARCH_FREE, signX: 1, tolX: 0 })).toBe(PLACE_OUTSIDE_ROOM);
  });

  it("collision avec un autre objet (résultat 8) écarte le candidat", () => {
    const body = walker(80, 100, 24);
    const env = envOf(flat, { contact: (b) => ({ err: b.x === 80 && b.p === 24 ? 8 : 0, col: 0 }) });
    expect(searchPosition(body, env, SEARCH_FREE)).toBe(0);
    expect([body.x, body.p]).not.toEqual([80, 24]);
    expect(Math.abs(body.x - 80) + Math.abs(body.p - 24)).toBeLessThanOrEqual(2);
  });

  it("masque de profondeur : un candidat à P multiple de 8 est écarté s'il est positif", () => {
    const body = walker(80, 100, 24);
    const env = envOf(flat, { depthBlocked: () => true });
    searchPosition(body, env, SEARCH_FREE);
    expect(body.p & 7).not.toBe(0);
  });

  it("voleur (Dep 1) : Y libre dans la fenêtre, Sol 0, au-dessus du sol de la case", () => {
    const body = walker(80, 60, 24, { dep: 1, ground: 0 });
    expect(searchPosition(body, envOf(flat), SEARCH_FREE)).toBe(0);
    expect([body.x, body.y, body.p, body.ground]).toEqual([80, 60, 24, 0]);
    const low = walker(80, 150, 24, { dep: 1, ground: 0, height: 20 });
    expect(searchPosition(low, envOf(flat), SEARCH_FREE)).toBe(0);
    expect(low.y).toBeLessThanOrEqual(99);
  });

  it("zones (Dep 2 et 4) : balayage des zones, plan 0, type de la zone", () => {
    const terrain: Terrain = {
      ...flat,
      zones: [{ type: 15, plane: 0xff, row: 4, colStart: 20, colEnd: 25, high: 90, low: 70, spare: new Uint8Array(4) }],
    };
    const body = walker(10, 100, 40, { dep: 2, ground: 0 });
    expect(searchPosition(body, envOf(terrain), SEARCH_FREE)).toBe(PLACE_TYPE_CHANGED);
    expect([body.x, body.y, body.p, body.plane, body.ground]).toEqual([80, 90, 39, 0, 15]);
    // hors salle : rien à balayer
    const outside = walker(10, 100, 40, { dep: 2, ground: 0 });
    expect(searchPosition(outside, envOf(terrain, { inRoom: false }), SEARCH_FREE)).toBe(PLACE_OUTSIDE_ROOM);
  });

  it("zones : un marcheur (Dep 0) ne les balaie pas (`1b11:04ed` n'y envoie que Dep 2 et 4), il est posé sur la case de sol la plus proche", () => {
    // régression du robot (puits de la salle 102, vérifié sous DOSBox-X) : au sommet de la corde, le héros remis à la marche (`Dep 0`) est
    // posé sur la margelle (case de sol, `Sol 40`) et non sur la zone de la corde (`Sol 19`), où il tombait dans le puits
    const ground = syntheticTerrain(concat(...[2, 3].map((row) => record(2, 0, row, 10, 179, 100, 40, 179, 100))));
    const terrain: Terrain = {
      ...ground,
      zones: [{ type: 19, plane: 0xff, row: 4, colStart: 20, colEnd: 25, high: 90, low: 70, spare: new Uint8Array(4) }],
    };
    const walking = walker(90, 90, 36, { ground: 19 });
    searchPosition(walking, envOf(terrain), SEARCH_FREE);
    expect(walking.ground).toBe(2);
    expect(walking.p).toBeLessThanOrEqual(31);
    // le même corps en Dep 4 (grimpe) reste sur la zone
    const climbing = walker(90, 90, 36, { ground: 19, dep: 4 });
    searchPosition(climbing, envOf(terrain), SEARCH_FREE);
    expect([climbing.ground, climbing.p]).toEqual([19, 36]);
  });

  it("deux plans : le plan le plus proche en 3D gagne", () => {
    const stairs = syntheticTerrain(
      concat(record(2, 0, 3, 10, 179, 100, 12, 179, 100), record(2, 1, 3, 10, 179, 60, 12, 179, 60)),
      2,
    );
    const body = walker(42, 62, 24);
    expect(searchPosition(body, envOf(stairs), SEARCH_FREE)).toBe(0);
    // le classement entre plans se fait sur le rayon 3D : la hauteur compte, le plan 1 (Y 60) est à 2 pixels
    expect([body.plane, body.y]).toEqual([1, 60]);
    const withTolerance = walker(42, 62, 24);
    expect(searchPosition(withTolerance, envOf(stairs), { ...SEARCH_FREE, tolY: 3 })).toBe(0);
    expect(withTolerance.plane).toBe(1);
    const lower = walker(42, 98, 24);
    expect(searchPosition(lower, envOf(stairs), SEARCH_FREE)).toBe(0);
    expect([lower.plane, lower.y]).toEqual([0, 100]);
  });

  it("rognage des murs (clipWalls) : l'objet n'est pas posé contre un mur qui le couvre", () => {
    const walls = syntheticTerrain(
      concat(record(2, 0, 3, 10, 179, 100, 40, 179, 100), record(1, 0, 3, 24, 120, 40, 24, 120, 40)),
    );
    const plain = walker(97, 100, 24);
    searchPosition(plain, envOf(walls), SEARCH_FREE);
    const clipped = walker(97, 100, 24);
    expect(searchPosition(clipped, envOf(walls, { clipWalls: true }), SEARCH_FREE)).toBe(0);
    expect(clipped.x).toBeLessThan(97); // à gauche du mur, la case du mur n'est plus sous le cœur du sprite
  });
});

describe("placement : murs mémorisés (1b11:0cf2 et 1b11:16b4)", () => {
  /** Sol plat Y 100 des colonnes 10 à 40, rangées 3 et 4, et un mur plein en colonne 30 (X 120 à 123) de la rangée donnée. */
  const withWall = (wallRow: number, floorRows = [3, 4]) =>
    syntheticTerrain(concat(...floorRows.map((row) => record(2, 0, row, 10, 179, 100, 40, 179, 100)), record(1, 0, wallRow, 30, 179, 40, 30, 179, 40)));
  const hero = (x: number, p: number) => walker(x, 100, p, { width: 11, height: 29 });

  it("un mur au bord de l'empreinte écarte l'échantillon dont le sprite le touche (1b11:16b4, retour 1)", () => {
    // sprite de 11 px : X 115 couvre 110..120, donc la colonne 30 (X 120) ; la case de départ (colonne 28) ne la compte pas dans son
    // cœur (colonnes 27 à 29), le mur est seulement mémorisé
    const terrain = withWall(3);
    const clipped = hero(115, 28);
    expect(searchPosition(clipped, envOf(terrain, { clipWalls: true }), SEARCH_FREE)).toBe(0);
    expect(clipped.x).toBe(114);
    const plain = hero(115, 28);
    searchPosition(plain, envOf(terrain), SEARCH_FREE);
    expect(plain.x).toBe(115); // sans le rognage et la mémoire, la position touche le mur
    expect(terrainCollision(terrain, plain).code).toBe(1);
    expect(terrainCollision(terrain, clipped).code).toBe(0);
  });

  it("un mur de la rangée de la case choisie (et non de celle du candidat précédent) n'est jamais touché", () => {
    // la rangée 3 n'a pas de sol sous X 115 : la case retenue est dans la rangée 4, dont la colonne 30 est un mur ; l'empreinte est
    // lue à la rangée de la case examinée (`4a4e0`), pas à `P >> 3` du corps
    const terrain = syntheticTerrain(
      concat(record(2, 0, 3, 10, 179, 100, 27, 179, 100), record(2, 0, 4, 10, 179, 100, 40, 179, 100), record(1, 0, 4, 30, 179, 40, 30, 179, 40)),
    );
    const body = hero(115, 28);
    expect(searchPosition(body, envOf(terrain, { clipWalls: true }), SEARCH_FREE)).toBe(0);
    expect(terrainCollision(terrain, body).code).toBe(0);
  });

  it("un mur du cœur de l'empreinte qui couvre le sprite abandonne la case (retour -1)", () => {
    // mur plein en colonne 28, sous le cœur du sprite de la case 28, de Y 60 à 179 : la case est abandonnée, la position choisie
    // est ailleurs et ne touche pas le mur
    const terrain = syntheticTerrain(concat(record(2, 0, 3, 10, 179, 100, 40, 179, 100), record(1, 0, 3, 28, 179, 60, 28, 179, 60)));
    const body = hero(113, 28);
    expect(searchPosition(body, envOf(terrain, { clipWalls: true }), SEARCH_FREE)).toBe(0);
    expect(terrainCollision(terrain, body).code).toBe(0);
    expect(body.x).not.toBe(113);
  });
});

describe("placer(o, mode) : 1aba:000e", () => {
  const flat = syntheticTerrain(concat(...[2, 3, 4, 5].map((row) => record(2, 0, row, 10, 179, 100, 70, 179, 100))));

  it("mode 0 : objet absent ; 2, 6 et 8 : présence sans vérification", () => {
    const body = walker(80, 100, 24);
    expect(placeObject(body, 0, envOf(flat))).toBe(0);
    expect([body.plane, body.x, body.y, body.p, body.ground, body.presence]).toEqual([0, 0, 0, 0, 0, 0]);
    for (const mode of [2, 6, 8]) {
      const other = walker(1, 2, 3);
      expect(placeObject(other, mode, envOf(flat))).toBe(0);
      expect([other.presence, other.x, other.y, other.p]).toEqual([mode, 1, 2, 3]);
    }
  });

  it("mode 1 : le plus proche, sans contrainte", () => {
    const body = walker(0, 0, 24);
    expect(placeObject(body, 1, envOf(flat))).toBe(0);
    expect(body.x).toBe(40);
  });

  it("mode 3 : tolérance 10 en X et 4 en P", () => {
    const near = walker(36, 100, 24);
    expect(placeObject(near, 3, envOf(flat))).toBe(0);
    expect(near.x).toBe(40);
    const far = walker(20, 100, 24);
    expect(placeObject(far, 3, envOf(flat))).toBe(PLACE_NOT_FOUND);
  });

  it("modes 4 et 5 : type Sol exigé ; le mode 5 se replie sur le mode 1", () => {
    const body = walker(80, 100, 24, { ground: 35 });
    expect(placeObject(body, 4, envOf(flat))).toBe(PLACE_NOT_FOUND);
    const fallback = walker(80, 100, 24, { ground: 35 });
    const result = placeObject(fallback, 5, envOf(flat));
    expect(result).toBe(PLACE_TYPE_CHANGED);
    expect(fallback.ground).toBe(2);
    const same = walker(60, 100, 24, { ground: 2 });
    expect(placeObject(same, 5, envOf(flat))).toBe(0);
  });

  it("mode 9 : tirage dans les étendues maximales puis recherche", () => {
    const draws = [200, 100];
    const body = walker(0, 0, 0, { ground: 7 });
    const env = envOf(flat, { random: () => draws.shift()! });
    expect(placeObject(body, 9, env)).toBe(PLACE_TYPE_CHANGED);
    // X = 200 % 319, P = 100 % 255 (Y vaut 199 pour un marcheur, sans tirage) ; puis recherche : on retombe sur la case la plus proche
    expect(body.plane).toBe(0);
    expect(body.x).toBeLessThanOrEqual(70 * 4 + 3);
    expect(draws.length).toBe(0);
    const bird = walker(0, 0, 0, { dep: 1, ground: 0 });
    const birdDraws = [10, 300, 20];
    placeObject(bird, 9, envOf(flat, { random: () => birdDraws.shift()! }));
    // un voleur peut survoler le vide (plan 0) : la position tirée est valide telle quelle
    expect([bird.x, bird.y, bird.p, bird.ground]).toEqual([10, (300 % 189) + 10, 20, 0]);
  });

  it("mode 10 : Sol = 0 puis recherche le long du côté Inf (côté d'arrivée)", () => {
    const wide = syntheticTerrain(concat(...[2, 3, 4].map((row) => record(2, 0, row, 0, 179, 100, 79, 179, 100))));
    const body = walker(160, 100, 24, { info: 3, ground: 9 });
    expect(placeObject(body, 10, envOf(wide))).toBe(PLACE_TYPE_CHANGED);
    expect(body.x).toBe(0);
    expect(body.ground).toBe(2);
    const right = walker(160, 100, 24, { info: 1 });
    expect(placeObject(right, 10, envOf(wide))).toBe(PLACE_TYPE_CHANGED);
    expect(right.x).toBe(319);
  });

  it("modes 7 et au-delà de 10 : abandon", () => {
    expect(() => placeObject(walker(0, 0, 0), 7, envOf(flat))).toThrow(RangeError);
    expect(() => placeObject(walker(0, 0, 0), 11, envOf(flat))).toThrow(RangeError);
  });
});

describe.skipIf(!hasOriginalFiles)("placement sur les données d'Armaeth", () => {
  const world = parseWorld(readOriginal("A1FCFG.SYS"));

  function sceneFile(id: number): string {
    const letter = String.fromCharCode(65 + Math.floor((id % 100) / 5));
    return `A1F${String(Math.floor(id / 100)).padStart(2, "0")}${letter}.VGA`;
  }
  const terrains = new Map<number, Terrain>();
  function terrainOf(id: number): Terrain {
    let terrain = terrains.get(id);
    if (!terrain) {
      terrain = createTerrain(readScene(readSceneArchive(readOriginal(sceneFile(id))).bytes(id)));
      terrains.set(id, terrain);
    }
    return terrain;
  }

  it("identité : les 59 objets posés de CFG, replacés à leur position, sont retrouvés (mêmes plan et type, Err 0)", () => {
    let total = 0;
    let same = 0;
    for (const o of world.objects) {
      if (o.typ !== 2 || o.location !== 1 || o.dep !== 0 || o.ground === 0) continue;
      const terrain = terrainOf(o.container);
      if (typeAt(terrain.grid, cellIndex(o.plane, o.p >> 3, o.x >> 2)) < 2) continue;
      const body = walker(o.x, o.y, o.p, { plane: o.plane, ground: o.ground });
      const result = searchPosition(body, envOf(terrain), SEARCH_FREE);
      total++;
      if (result === 0 && body.x === o.x && body.p === o.p && body.plane === o.plane && body.y === o.y) same++;
    }
    expect(total).toBe(59);
    expect(same).toBe(59);
  });

  /** Cibles aléatoires dans les salles à un plan, comparées à une recherche exhaustive (distance X / P minimale). */
  function randomTargets(options: { skipHole: boolean; trimHeight: boolean }): { trials: number; equal: number } {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let trials = 0;
    let equal = 0;
    for (const room of world.rooms) {
      if (room.id === 0) continue;
      const terrain = { ...terrainOf(room.id), zones: [] }; // l'étude n'a pas porté le balayage des zones
      if (terrain.planes !== 1) continue;
      const lim = terrain.limits;
      const samples: { x: number; p: number }[] = [];
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLUMNS; col++) {
          if (typeAt(terrain.grid, cellIndex(0, row, col)) < 2) continue;
          for (let sx = 0; sx < 4; sx++) {
            for (let sp = 0; sp < 8; sp++) {
              const x = col * 4 + sx;
              const p = row * 8 + sp;
              if (x < lim.xMin || x > lim.xMax || p < lim.pMin || p > lim.pMax) continue;
              const y = placementHeight(terrain.grid, 0, x, p);
              if (y < lim.yMin || y > lim.yMax) continue;
              samples.push({ x, p });
            }
          }
        }
      }
      if (!samples.length) continue;
      for (let k = 0; k < 15; k++) {
        const tx = Math.floor(lim.xMin + random() * (lim.xMax - lim.xMin));
        const tp = Math.floor(lim.pMin + random() * (lim.pMax - lim.pMin));
        const ty = Math.floor(lim.yMin + random() * (lim.yMax - lim.yMin));
        const body = walker(tx, ty, tp);
        const result = searchPosition(body, envOf(terrain, { trimHeight: options.trimHeight }), SEARCH_FREE);
        let best = Infinity;
        for (const s of samples) {
          if (options.skipHole && s.p >> 3 === tp >> 3 && s.x >> 2 === (tx >> 2) - 1) continue;
          best = Math.min(best, (s.x - tx) ** 2 + (s.p - tp) ** 2);
        }
        trials++;
        if ((result === 0 || result === PLACE_TYPE_CHANGED) && (body.x - tx) ** 2 + (body.p - tp) ** 2 === best) equal++;
      }
    }
    return { trials, equal };
  }

  it("600 cibles aléatoires : 534 identiques à la recherche exhaustive, 539 sans la case ignorée par la spirale, 597 sans rognage de Y", () => {
    expect(randomTargets({ skipHole: false, trimHeight: true })).toEqual({ trials: 600, equal: 534 });
    expect(randomTargets({ skipHole: true, trimHeight: true })).toEqual({ trials: 600, equal: 539 });
    expect(randomTargets({ skipHole: true, trimHeight: false })).toEqual({ trials: 600, equal: 597 });
  });

  it("clic du héros : le point trouvé est à ±4 en X du clic et à ±1 de la hauteur cliquée", () => {
    const terrain = terrainOf(1);
    let checked = 0;
    for (const [cx, cy] of [[100, 120], [220, 140], [150, 130], [60, 110]] as const) {
      const body = walker(cx, cy, 113);
      const result = searchPosition(body, envOf(terrain), SEARCH_CLICK);
      if (result !== 0 && result !== PLACE_TYPE_CHANGED) continue;
      checked++;
      expect(Math.abs(body.x - cx)).toBeLessThanOrEqual(4);
      expect(Math.abs(body.y - cy)).toBeLessThanOrEqual(1);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
