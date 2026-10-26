import { describe, expect, it } from "vitest";
import type { Level } from "../../../src/games/swiv3d/data/level";
import { input } from "../../../src/games/swiv3d/engine/input";
import { World } from "../../../src/games/swiv3d/engine/world";
import { hasOriginalFiles, loadLevel } from "./helpers";
import { rec } from "./scenario";

describe.skipIf(!hasOriginalFiles)("bonus : attirance (états 1 et 2 de `004463c0`)", () => {
  it("un bonus aspiré suit une droite jusqu'au joueur sans être relevé au-dessus du relief : il peut passer dans le relief", () => {
    const { level, models } = loadLevel("TERRAN00");
    const start = level.objects.find((o) => o.type === 1000)!;
    const heightmap = level.heightmap.slice();
    const groundMap = level.groundMap.slice();
    // cuvette plane de 20 × 20 cases (octet 60 = 240 unités) autour du départ, avec un mur de 480 unités juste derrière le bonus : l'aspiration
    // place d'abord le bonus à 130 unités du joueur sur la droite joueur → bonus, donc dans le mur
    const cx = Math.floor(start.x / 64);
    const cz = Math.floor(start.z / 64);
    const wall = Math.ceil((start.x + 125) / 64);
    for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) heightmap[((cz + dz) & 511) * 512 + ((cx + dx) & 511)] = 60;
    for (let dz = -10; dz <= 10; dz++) for (let c = wall; c <= wall + 3; c++) heightmap[((cz + dz) & 511) * 512 + (c & 511)] = 120;
    // bonus de 25 % de vie (1101) à 95 unités du joueur
    const objects = [start, rec(7000, start.x + 95, start.z, { model: 604, childModel: 606, hitPoints: 10, subtype: 1101 })];
    const lvl: Level = { ...level, heightmap, groundMap, objects };
    const world = World.load(lvl, models, { playerHitPoints: 100 });
    const p = world.player.obj;
    let minClearance = Infinity;
    let sucked = false;
    for (let t = 0; t < 400; t++) {
      world.tick(input({}));
      world.drainEvents();
      for (const o of world.liveObjects()) {
        if (o.update !== "upd_004469fc" || o.state !== 1) continue;
        sucked = true;
        minClearance = Math.min(minClearance, (o.y - world.terrain.height(o.x, o.z)) / 256);
      }
      if (sucked && ![...world.liveObjects()].some((o) => o.update === "upd_004469fc")) break;
      void p;
    }
    expect(sucked).toBe(true);
    // pas de correction de l'exe en dehors de l'accélération (`timer -= 3`) : la trajectoire passe sous le relief
    expect(minClearance).toBeLessThan(0);
    expect(world.player.obj.hp).toBeGreaterThan(100);
  });
});
