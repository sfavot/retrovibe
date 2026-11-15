import { describe, expect, it } from "vitest";
import { INDY_COMPASS_ICONS } from "../../src/games/indy/definition";
import { readIcons } from "../../src/engine/desktop-adventures/data/resources";
import { Assets } from "../../src/engine/desktop-adventures/assets";
import { MAX_HEALTH } from "../../src/engine/desktop-adventures/game";
import { generateStory } from "../../src/games/indy/generation/generator";
import { Direction } from "../../src/engine/desktop-adventures/geometry";
import { WORLD_SIZE, World, WorldSize } from "../../src/engine/desktop-adventures/world";
import { arrowIconId, describeExits } from "../../src/ui/desktop-adventures/compass";
import { HEALTH_COLORS, healthGradient, healthPie } from "../../src/ui/desktop-adventures/health-pie";
import { hasOriginalFiles, loadExe, loadGameData } from "./helpers";

describe("moniteur de santé", () => {
  it("santé pleine : disque vert uni", () => {
    expect(healthPie(MAX_HEALTH)).toEqual({ base: HEALTH_COLORS.green, cover: HEALTH_COLORS.yellow, angle: 0 });
  });

  it("de 300 à 200, le jaune recouvre le vert à partir de 12 h, dans le sens horaire", () => {
    expect(healthPie(250)).toMatchObject({ base: HEALTH_COLORS.green, cover: HEALTH_COLORS.yellow, angle: 180 });
    expect(healthPie(225).angle).toBe(270);
  });

  it("à 200 le disque est entièrement jaune, puis le rouge recouvre le jaune", () => {
    expect(healthPie(200)).toMatchObject({ base: HEALTH_COLORS.yellow, cover: HEALTH_COLORS.red, angle: 0 });
    expect(healthPie(150)).toMatchObject({ base: HEALTH_COLORS.yellow, cover: HEALTH_COLORS.red, angle: 180 });
  });

  it("de 100 à 0, le noir recouvre le rouge ; à 0 tout est noir", () => {
    expect(healthPie(100)).toMatchObject({ base: HEALTH_COLORS.red, cover: HEALTH_COLORS.black, angle: 0 });
    expect(healthPie(50)).toMatchObject({ base: HEALTH_COLORS.red, cover: HEALTH_COLORS.black, angle: 180 });
    expect(healthPie(0)).toMatchObject({ base: HEALTH_COLORS.red, cover: HEALTH_COLORS.black, angle: 360 });
  });

  it("borne la santé hors plage", () => {
    expect(healthPie(-20)).toEqual(healthPie(0));
    expect(healthPie(MAX_HEALTH + 50)).toEqual(healthPie(MAX_HEALTH));
  });

  it("utilise les couleurs pures d'origine", () => {
    expect(HEALTH_COLORS).toEqual({ green: "rgb(0, 255, 0)", yellow: "rgb(255, 255, 0)", red: "rgb(255, 0, 0)", black: "rgb(0, 0, 0)" });
    expect(healthGradient(healthPie(250))).toBe("conic-gradient(rgb(255, 255, 0) 0deg 180deg, rgb(0, 255, 0) 180deg 360deg)");
  });
});

describe("boussole", () => {
  const names = { [Direction.Up]: "haut", [Direction.Down]: "bas", [Direction.Left]: "gauche", [Direction.Right]: "droite" };

  it("choisit la flèche éteinte ou allumée de chaque direction (ICON 3 à 10)", () => {
    expect([Direction.Down, Direction.Left, Direction.Right, Direction.Up].map((d) => [arrowIconId(INDY_COMPASS_ICONS, d, false), arrowIconId(INDY_COMPASS_ICONS, d, true)])).toEqual([
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
    ]);
  });

  it("décrit les directions ouvertes", () => {
    const exits = { [Direction.Up]: false, [Direction.Down]: true, [Direction.Left]: true, [Direction.Right]: false };
    expect(describeExits(exits, names, "rien")).toBe("gauche, bas");
    expect(describeExits({ ...exits, [Direction.Down]: false, [Direction.Left]: false }, names, "rien")).toBe("rien");
  });
});

describe.skipIf(!hasOriginalFiles)("boussole et carte du monde", () => {
  const assets = new Assets(loadGameData());
  const story = generateStory(assets, 7, WorldSize.Medium);
  const world = new World(story, assets);

  it("une direction est ouverte si la carte a un secteur voisin", () => {
    story.sectors.forEach((sector, index) => {
      if (!sector) return;
      const x = index % WORLD_SIZE;
      const y = Math.floor(index / WORLD_SIZE);
      expect(world.exits(sector.zoneId)).toEqual({
        [Direction.Up]: world.at(x, y - 1) !== null,
        [Direction.Down]: world.at(x, y + 1) !== null,
        [Direction.Left]: world.at(x - 1, y) !== null,
        [Direction.Right]: world.at(x + 1, y) !== null,
      });
    });
  });

  it("aucune sortie depuis une pièce", () => {
    const rooms = story.sectors.flatMap((s) => (s ? [...assets.roomsOf(s.zoneId)].filter((z) => z.id !== s.zoneId) : []));
    const room = rooms[0];
    expect(room).toBeDefined();
    expect(Object.values(world.exits(room.id))).toEqual([false, false, false, false]);
  });
});

describe.skipIf(!hasOriginalFiles)("icônes de DESKADV.EXE", () => {
  const icons = readIcons(loadExe());

  it("décode les flèches de la boussole (ICON 3 à 10) en 32×32 RGBA", () => {
    for (let id = 3; id <= 10; id++) {
      const icon = icons.get(id)!;
      expect([icon.width, icon.height]).toEqual([32, 32]);
      expect(icon.rgba.length).toBe(32 * 32 * 4);
    }
  });

  const pixel = (id: number, x: number, y: number) => [...icons.get(id)!.rgba.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];

  it("le dessin occupe le coin haut gauche, le reste est transparent", () => {
    expect(pixel(4, 31, 31)[3]).toBe(0);
    expect(pixel(4, 20, 5)[3]).toBe(0);
  });

  it("les flèches allumées contiennent du vert pur, les éteintes seulement du gris et du blanc", () => {
    const colors = (id: number) => {
      const set = new Set<string>();
      const { rgba } = icons.get(id)!;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) set.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
      return set;
    };
    for (const id of [4, 6, 8, 10]) expect(colors(id).has("0,255,0")).toBe(true);
    for (const id of [3, 5, 7, 9]) expect([...colors(id)].sort()).toEqual(["128,128,128", "255,255,255"]);
  });
});
