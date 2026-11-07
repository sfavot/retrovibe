import { describe, expect, it } from "vitest";
import { pauseTicks } from "../../../src/games/drascula/engine/cadence";
import { scaledSize } from "../../../src/games/drascula/engine/perspective";
import { Plane } from "../../../src/games/drascula/render/plane";
import { hasOriginalFiles } from "../helpers";
import { Player } from "../engine/test-host";

/** Ce que l'hôte verrait : le moteur compose et présente l'image courante. */
const screenOf = (player: Player): Plane => {
  player.engine.render();
  return new Plane(player.host.screen!.slice());
};

describe.skipIf(!hasOriginalFiles)("le moteur présente son image", () => {
  it("render() présente l'image du moteur avec la palette affichée", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const before = player.host.presented;
    player.run(3);
    expect(player.host.presented).toBe(before);
    player.engine.render();
    expect(player.host.presented).toBe(before + 1);
    expect(player.host.screen).toBe(player.engine.gfx.screen.pixels);
    expect(player.host.screenPalette).toBe(player.engine.gfx.palette.shown);
    expect(player.host.screen).toHaveLength(64000);
    expect(player.host.screenPalette).toHaveLength(768);
  });

  it("chapitre 1 : l'auberge et le héros réduit à l'ordonnée de ses pieds", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine, hero } = player;
    expect(engine.room.number).toBe(62);
    const expected = scaledSize(engine.room.factors![hero.y + hero.height]);
    expect({ width: hero.width, height: hero.height }).toEqual(expected);
    const bg = engine.gfx.bg;
    const screen = screenOf(player);
    let changed = 0;
    for (let y = hero.y; y < hero.y + hero.height; y++) for (let x = hero.x; x < hero.x + hero.width; x++) if (screen.at(x, y) !== bg.at(x, y)) changed++;
    expect(changed).toBeGreaterThan(hero.width * hero.height * 0.3);
    // loin du héros, l'image est le décor
    expect(screen.at(300, 190)).toBe(bg.at(300, 190));
  });

  it("le héros marche : la position dessinée suit l'état", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine, hero } = player;
    const x0 = hero.x;
    player.perform(engine.walkToPoint(200, 150));
    expect(hero.x).toBeGreaterThan(x0);
    const screen = screenOf(player);
    let changed = 0;
    for (let y = hero.y; y < hero.y + hero.height; y++) for (let x = hero.x; x < hero.x + hero.width; x++) if (screen.at(x, y) !== engine.gfx.bg.at(x, y)) changed++;
    expect(changed).toBeGreaterThan(100);
  });

  it("le curseur est caché pendant une marche scénarisée et revient ensuite", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    expect(engine.cursorVisible).toBe(true);
    engine.run(engine.walkToPoint(200, 150));
    player.run(2);
    expect(engine.cursorVisible).toBe(false);
    player.settle();
    expect(engine.cursorVisible).toBe(true);
  });

  it("pendant une séquence : la réplique en jaune, ni nom survolé ni barre des verbes ; ensuite ils reviennent", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    player.move(10, 10);
    player.run(10);
    expect(engine.state.menuBar).toBe(true);
    engine.run(engine.talk(1));
    player.run(5);
    expect(engine.subtitle?.text).toContain("DEUXI");
    const talking = screenOf(player);
    expect(engine.gfx.palette.textColor).toBe(5);
    // la barre des verbes n'est pas dessinée (hors du curseur, en x < 30) : le haut de l'écran est le décor
    const topBand = (image: Plane): number => {
      let changed = 0;
      for (let y = 2; y < 27; y++) for (let x = 40; x < 300; x++) if (image.at(x, y) !== engine.gfx.bg.at(x, y)) changed++;
      return changed;
    };
    expect(topBand(talking)).toBe(0);
    player.settle();
    player.run(10);
    expect(engine.subtitle).toBeNull();
    const idle = screenOf(player);
    expect(topBand(idle)).toBeGreaterThan(300);
  });

  it("le nom de l'objet survolé s'écrit sous le curseur avec un verbe en main", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    player.key("F1");
    player.move(190, 90);
    player.run(10);
    expect(engine.state.hasName).toBe(true);
    expect(engine.state.textName).toBe("IVROGNE");
    const shot = screenOf(player);
    expect(engine.gfx.palette.textColor).toBe(3);
    expect(shot.pixels.filter((p) => p === 254).length).toBeGreaterThan(50);
  });

  it("clic droit : l'inventaire s'ouvre et se dessine ; un nouveau clic droit le ferme", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    const closed = screenOf(player);
    player.rightClick(160, 100);
    player.run(10);
    expect(engine.state.menuScreen).toBe(true);
    const open = screenOf(player);
    let changed = 0;
    for (let i = 0; i < 64000; i++) if (open.pixels[i] !== closed.pixels[i]) changed++;
    expect(changed).toBeGreaterThan(8000);
    player.rightClick(160, 100);
    player.run(10);
    expect(engine.state.menuScreen).toBe(false);
  });

  it("fondu depuis le noir puis au noir : 64 pas de pause(vitesse), palette du jeu intacte", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine, host } = player;
    engine.render();
    const full = host.screenPalette!.slice();
    engine.run(engine.fadeToBlack(1));
    player.settle();
    engine.render();
    expect(host.screenPalette!.every((value) => value === 0)).toBe(true);
    const start = player.host.clock;
    engine.run(engine.fadeFromBlack(1));
    player.settle();
    engine.render();
    expect(player.host.clock - start).toBeGreaterThanOrEqual(64 * pauseTicks(1) * 10);
    expect([...host.screenPalette!]).toEqual([...full]);
  });

  it("changement de chapitre : le décor et la palette du chapitre suivant remplacent ceux du précédent", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    engine.requestChapter(4);
    player.run(2);
    player.settle();
    expect(engine.chapter).toBe(4);
    expect(engine.room.number).toBe(21);
    expect([...engine.gfx.bg.pixels]).toEqual([...engine.gfx.image(21).pixels]);
    expect(engine.gfx.palette.shown.some((value) => value !== 0)).toBe(true);
  });
});
