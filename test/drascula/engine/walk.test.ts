import { describe, expect, it } from "vitest";
import { parseAld } from "../../../src/games/drascula/data/ald";
import { buildFactors, factorAt, scaledSize } from "../../../src/games/drascula/engine/perspective";
import { createRoomState, placeHero } from "../../../src/games/drascula/engine/room";
import { STEP_X, Step, Track, createHero } from "../../../src/games/drascula/engine/state";
import { moveCharacters, startWalking } from "../../../src/games/drascula/engine/walk";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { ROOM_CHAPTERS } from "./rooms";

describe("perspective (factor_red)", () => {
  it("interpole entre les limites sur la hauteur de la zone de marche", () => {
    const factors = buildFactors({ x1: 0, y1: 100, x2: 320, y2: 150 }, { upper: 50, lower: 100 }, 1, 1);
    expect(factors).toHaveLength(202);
    expect(factors[0]).toBe(50);
    expect(factors[100]).toBe(50);
    expect(factors[125]).toBe(75);
    expect(factors[150]).toBe(100);
    expect(factors[201]).toBe(100);
    expect(factorAt(factors, 500)).toBe(100);
    expect(scaledSize(50)).toEqual({ width: 21, height: 35 });
  });

  it("prolonge la réduction au-dessus de la zone dans la pièce 24", () => {
    const walk = { x1: 0, y1: 100, x2: 320, y2: 110 };
    const factors = buildFactors(walk, { upper: 50, lower: 60 }, 24, 4);
    // l'accumulation continue : 50 - 11, 50 - 12…
    expect(factors[99]).toBe(39);
    expect(factors[98]).toBe(38);
    expect(factors[74]).toBe(50);
  });
});

describe("marche en ligne droite", () => {
  const ctx = (now: number) => ({ chapter: 1, room: 1, factors: new Array(202).fill(100), now });

  it("choisit le quadrant, l'orientation et le pas proportionnel", () => {
    const hero = createHero();
    Object.assign(hero, { x: 100, y: 50, width: 43, height: 70, targetX: 21, targetY: 100 });
    startWalking(hero, 1, 0);
    // pieds en 120, centre en 121 : 100 à gauche, 20 vers le haut, l'horizontale domine
    expect(hero.moving).toBe(true);
    expect(hero.direction).toBe(Step.UpLeft);
    expect(hero.track).toBe(Track.Left);
    expect(hero.stepX).toBe(STEP_X);
    expect(hero.stepY).toBe(1);
  });

  it("avance tous les 6 ticks au plus et s'arrête sur la coordonnée visée", () => {
    const hero = createHero();
    Object.assign(hero, { x: 100, y: 50, width: 43, height: 70, targetX: 61, targetY: 120 });
    startWalking(hero, 1, 0);
    moveCharacters(hero, ctx(3));
    expect(hero.x).toBe(100);
    let now = 0;
    for (let i = 0; i < 20 && hero.moving; i++) moveCharacters(hero, ctx((now += 6)));
    expect(hero.moving).toBe(false);
    // arrêt dès que le milieu est à moins d'un pas (8) du point visé, du côté d'où il vient
    const center = hero.x + Math.trunc(hero.width / 2);
    expect(center).toBeLessThanOrEqual(61);
    expect(center).toBeGreaterThan(61 - STEP_X);
  });

  it("au chapitre 2, marche verticale pure quand le point est sous le héros", () => {
    const hero = createHero();
    Object.assign(hero, { x: 100, y: 50, width: 43, height: 70, targetX: 120, targetY: 150 });
    startWalking(hero, 2, 0);
    expect(hero.track).toBe(Track.Down);
    expect(hero.stepX).toBe(0);
    let now = 0;
    for (let i = 0; i < 20 && hero.moving; i++) moveCharacters(hero, { chapter: 2, room: 14, factors: null, now: (now += 6) });
    expect(hero.moving).toBe(false);
    expect(hero.y + hero.height).toBe(150);
    expect(hero.x).toBe(100);
  });
});

describe.skipIf(!hasOriginalFiles)("trajets des pièces du jeu", () => {
  // Du point d'arrivée de chaque porte vers le point d'approche de chaque objet : le héros arrive toujours (aucun trajet sans fin).
  // Pièce 45 (tours du château, chapitre 5) : le héros y est invisible, `walkToPoint` le place sans le faire marcher.
  for (const [room, chapter] of ROOM_CHAPTERS.filter(([room]) => room !== 45)) {
    it(`pièce ${room} (chapitre ${chapter})`, () => {
      const state = createRoomState(parseAld(readOriginal(`${room}.ALD`), chapter), chapter);
      const starts = state.objects.filter((object) => object.door);
      for (const start of starts.length ? starts : state.objects.slice(0, 1)) {
        for (const goal of state.objects) {
          const hero = createHero();
          if (chapter === 2) {
            hero.width = state.hero?.width ?? hero.width;
            hero.height = state.hero?.height ?? hero.height;
          }
          placeHero(hero, state, start.id, chapter);
          hero.targetX = goal.approach.x;
          hero.targetY = goal.approach.y;
          startWalking(hero, chapter, 0);
          let now = 0;
          let steps = 0;
          while (hero.moving && steps < 400) {
            moveCharacters(hero, { chapter, room, factors: state.factors, now: (now += 6) });
            steps++;
          }
          expect(hero.moving, `${room} : ${start.id} -> ${goal.id}`).toBe(false);
        }
      }
    });
  }
});
