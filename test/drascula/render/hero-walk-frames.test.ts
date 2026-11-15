import { describe, expect, it } from "vitest";
import { walkFrameColumns } from "../../../src/games/drascula/render/renderer";
import { hasOriginalFiles } from "../helpers";
import { Player } from "../engine/test-host";

describe("colonnes des images de la marche (`_frameX`)", () => {
  it("cumul de la largeur du héros, six images", () => {
    expect(walkFrameColumns(43)).toEqual([43, 86, 129, 172, 215, 258]);
    expect(walkFrameColumns(39)).toEqual([39, 78, 117, 156, 195, 234]);
  });
});

describe.skipIf(!hasOriginalFiles)("marche du héros au chapitre 2", () => {
  it("aucune image de la marche ne sort des feuilles du héros (pas de rectangle noir derrière lui)", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    const { engine } = player;
    const gfx = engine.gfx;
    const frames = new Set<number>();
    for (const [x, y] of [[60, 150], [250, 170], [150, 120], [280, 140]]) {
      player.click(x, y);
      for (let f = 0; f < 120; f++) {
        player.run(9);
        engine.render();
        const hero = engine.state.hero;
        if (!hero.moving) continue;
        frames.add(hero.frame);
        const pal = gfx.palette.shown;
        let black = 0;
        for (let row = Math.max(hero.y, 0); row < Math.min(hero.y + hero.height, 200); row++)
          for (let col = Math.max(hero.x, 0); col < Math.min(hero.x + hero.width, 320); col++) {
            const c = gfx.screen.pixels[row * 320 + col];
            const b = gfx.bg.pixels[row * 320 + col];
            if (pal[c * 3] + pal[c * 3 + 1] + pal[c * 3 + 2] === 0 && pal[b * 3] + pal[b * 3 + 1] + pal[b * 3 + 2] > 60) black++;
          }
        expect(black, `image ${hero.frame}`).toBeLessThan(150);
      }
    }
    expect(frames.size).toBe(6);
  });

  it("vue de loin du village (pièce 10, héros de 5 x 8) : la marche dessine la petite figure, pas un carré noir", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    player.perform(player.engine.enterRoom(10));
    player.settle();
    const { engine } = player;
    const gfx = engine.gfx;
    let checked = 0;
    for (const [x, y] of [[60, 80], [250, 70], [150, 60], [280, 90]]) {
      player.click(x, y);
      for (let f = 0; f < 60; f++) {
        player.run(9);
        engine.render();
        const hero = engine.state.hero;
        if (!hero.moving) continue;
        const pal = gfx.palette.shown;
        let black = 0;
        for (let row = hero.y; row < hero.y + hero.height; row++)
          for (let col = hero.x; col < hero.x + hero.width; col++) {
            const c = gfx.screen.pixels[row * 320 + col];
            if (c !== gfx.bg.pixels[row * 320 + col] && pal[c * 3] + pal[c * 3 + 1] + pal[c * 3 + 2] === 0) black++;
          }
        expect(black, `sens ${hero.track}, image ${hero.frame}`).toBeLessThan(5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
