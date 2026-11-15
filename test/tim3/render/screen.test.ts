import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLev } from "../../../src/games/tim3/data/lev";
import { step } from "../../../src/games/tim3/engine/step";
import type { Part } from "../../../src/games/tim3/engine/part";
import { World } from "../../../src/games/tim3/engine/world";
import { BIN_PANEL, PLAYFIELD, RenderAssets, SCREEN_HEIGHT, SCREEN_WIDTH, backgroundIndex, beamColor, composeScreen, drawOrder, mapColor, renderPlayfield } from "../../../src/games/tim3/render";
import { baseIndex, frenchIndex, original } from "../data/real";
import { realTypes, realWorld } from "../engine/helpers";
import { applySolution, type Solution } from "../solutions/apply";
import { checksum } from "./support";

const level = (name: string) => readLev(frenchIndex().get(`${name}.LEV`));

/**
 * Sommes de contrôle de l'aire de jeu au pas 0 (rendu du port, fixées à la vague R : un écart signale un changement de rendu à
 * relire). Niveaux sans cordes, courroies ni lasers : leur tracé dépend de l'état du moteur (Φ2), pas du rendu.
 */
const PLAYFIELD_SUMS: Record<string, string> = {
  TLEV1: "f87403c8",
  ELEV7: "fddfd4e7",
  HLEV29: "13984864",
  HH24: "74a82c72",
};

describe.skipIf(!original.has)("composition réelle", () => {
  const assets = new RenderAssets(frenchIndex());

  it("le fond du niveau est la couleur logique de `backgroundColor`, décalée de 15 dans la palette", () => {
    expect([backgroundIndex(3), backgroundIndex(1), backgroundIndex(11), backgroundIndex(undefined)]).toEqual([18, 16, 26, 18]);
    const lev = level("TLEV1");
    const field = renderPlayfield(assets, realWorld("TLEV1"), { backgroundColor: lev.prefix?.backgroundColor });
    expect(field.pixels[0]).toBe(backgroundIndex(lev.prefix?.backgroundColor));
  });

  for (const name of Object.keys(PLAYFIELD_SUMS)) {
    it(`${name} : aire de jeu de 568×378 stable`, () => {
      const field = renderPlayfield(assets, realWorld(name), { backgroundColor: level(name).prefix?.backgroundColor });
      expect([field.width, field.height]).toEqual([PLAYFIELD.width, PLAYFIELD.height]);
      expect(checksum(field)).toBe(PLAYFIELD_SUMS[name]);
    });
  }

  it("les coins transparents d'un sprite laissent le fond (boule de bowling : coin = fond, centre = sprite)", () => {
    const world = realWorld("TLEV1");
    const ball = [...world.mobiles, ...world.statics].find((p) => p.type === 0)!;
    const lev = level("TLEV1");
    const field = renderPlayfield(assets, world, { backgroundColor: lev.prefix?.backgroundColor });
    const bg = backgroundIndex(lev.prefix?.backgroundColor);
    const px = (x: number, y: number) => field.pixels[y * field.width + x];
    expect(px(ball.px, ball.py)).toBe(bg);
    expect(px(ball.px + 16, ball.py + 16)).not.toBe(bg);
  });

  it("dessine d'abord le plan 8 (fond) puis les plans proches ; les mobiles passent devant les pièces posées d'un même plan", () => {
    const order = drawOrder(realWorld("HLEV29"));
    const layers = order.map((o) => o.layer);
    expect(layers).toEqual([...layers].sort((a, b) => b - a));
    expect(layers[0]).toBeGreaterThanOrEqual(7);
    expect(layers.at(-1)).toBeLessThanOrEqual(3);
  });

  it("l'écran complet fait 640×480 et porte le bac à droite et la barre de but en bas", () => {
    const screen = composeScreen(assets, realWorld("TLEV1"), { backgroundColor: 3, goal: "But" });
    expect([screen.width, screen.height]).toEqual([SCREEN_WIDTH, SCREEN_HEIGHT]);
    // Le panneau du bac recouvre les 80 derniers pixels de l'aire : la colonne n'a plus la couleur du fond.
    const bgIndex = backgroundIndex(3);
    expect(screen.pixels[(BIN_PANEL.y + 150) * SCREEN_WIDTH + BIN_PANEL.x + 2]).not.toBe(bgIndex);
    expect(checksum(screen)).not.toBe(checksum(renderPlayfield(assets, realWorld("TLEV1"))));
  });

  it("l'animation change l'image : une balle qui tombe se déplace à l'écran", () => {
    const world = realWorld("TLEV1");
    const before = checksum(renderPlayfield(assets, world, { backgroundColor: 3 }));
    for (let i = 0; i < 20; i++) step(world);
    const after = checksum(renderPlayfield(assets, world, { backgroundColor: 3 }));
    expect(after).not.toBe(before);
    // Le rendu ne dépend que de l'état du monde : même état, même image.
    expect(checksum(renderPlayfield(assets, world, { backgroundColor: 3 }))).toBe(after);
  });

  it("TLEV4 résolu : les boules sont dans les paniers en osier (avant au plan 0), visibles seulement entre les brins", () => {
    const solution = JSON.parse(readFileSync(resolve(import.meta.dirname, "../solutions/TLEV4.json"), "utf8")) as Solution;
    const world = new World(realTypes());
    world.loadLevel(applySolution(readLev(baseIndex().get("TLEV4.LEV")), solution));
    for (let i = 0; i < 300; i++) step(world);
    const baskets = world.statics.toArray().filter((p) => p.type === 71);
    const within = (b: Part, k: Part) => b.px >= k.px && b.px < k.px + k.frameW && b.py >= k.py && b.py < k.py + k.frameH;
    const balls = world.mobiles.toArray().filter((b) => b.type === 0 && baskets.some((k) => within(b, k)));
    expect(balls.length).toBeGreaterThan(0);
    /** Rendu avec des pièces sorties de l'aire (+0x10 & 0x2000). */
    const render = (hidden: Part[]) => {
      for (const p of hidden) p.flags10 |= 0x2000;
      const pixels = renderPlayfield(assets, world, { backgroundColor: 3 }).pixels;
      for (const p of hidden) p.flags10 &= ~0x2000;
      return pixels;
    };
    const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
    // Pixels qui viennent des boules, sans les paniers puis dans les paniers.
    const alone = diff(render(baskets), render([...baskets, ...balls]));
    const inBasket = diff(render([]), render(balls));
    expect(inBasket).toBeGreaterThan(0);
    expect(inBasket).toBeLessThan(alone / 2);
  });

  it("HLEV8 résolu : les faisceaux des lasers 91, 92, 93 et du mélangeur 95 suivent les tronçons du moteur, à leur couleur", () => {
    const solution = JSON.parse(readFileSync(resolve(import.meta.dirname, "../solutions/HLEV8.json"), "utf8")) as Solution;
    const world = new World(realTypes());
    world.loadLevel(applySolution(readLev(baseIndex().get("HLEV8.LEV")), solution));
    for (let i = 0; i < (solution.goalStep ?? 71); i++) step(world);
    const field = renderPlayfield(assets, world, { backgroundColor: 3 });
    const lasers = world.statics.toArray().filter((p) => [0x5b, 0x5c, 0x5d, 0x5f].includes(p.type) && p.f24 !== 0);
    expect(lasers.map((p) => p.type).sort()).toEqual([0x5b, 0x5c, 0x5d, 0x5f]);
    // Miroirs : 6 tronçons pour 91 et 92, 4 pour 93 ; le mélangeur reçoit les trois (+0x24 = 7, blanc).
    expect(lasers.find((p) => p.type === 0x5f)!.f24).toBe(7);
    for (const p of lasers) {
      const color = mapColor(beamColor(p)!);
      for (let i = 0; i < p.fFC; i++) {
        const b = p.beam!;
        const last = i === p.fFC - 1 && p.vx !== -0x1000;
        const [x0, y0, x1, y1] = [b[2 * i]!, b[2 * i + 1]!, last ? p.vx : b[2 * i + 2]!, last ? p.vy : b[2 * i + 3]!];
        // Tronçons horizontaux ou verticaux : part des pixels à la couleur du faisceau (le reste : pièces au premier plan, croisements).
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1;
        let same = 0;
        for (let k = 0; k < n; k++) {
          const x = x0 + Math.sign(x1 - x0) * k;
          const y = y0 + Math.sign(y1 - y0) * k;
          if (field.pixels[y * field.width + x] === color) same++;
        }
        expect(same / n, `type ${p.type}, tronçon ${i}`).toBeGreaterThan(0.6);
      }
    }
  });
});
