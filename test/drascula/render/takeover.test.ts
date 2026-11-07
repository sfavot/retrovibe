import { describe, expect, it } from "vitest";
import { DIALOG_FONT_SHEET } from "../../../src/games/drascula/render/font";
import { Plane } from "../../../src/games/drascula/render/plane";
import { TextColor } from "../../../src/games/drascula/render/palette";
import type { Roll, Scene, TalkView } from "../../../src/games/drascula/render/renderer";
import { hasOriginalFiles } from "../helpers";
import { Player } from "../engine/test-host";

const ROLL: Roll = { face: 0, extra: 0, step: 0 };

/** Image présentée par le moteur après `render()`. */
const shown = (player: Player): Plane => {
  player.engine.render();
  return new Plane(player.host.screen!.slice());
};

describe.skipIf(!hasOriginalFiles)("prise de main sur l'image : image libre", () => {
  it("par défaut la pièce fournit le fond ; clearRoom rend l'image à la séquence, enterRoom la rend à la pièce", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { gfx } = player.engine;
    expect(gfx.owner).toBe("room");
    gfx.clearRoom();
    expect(gfx.owner).toBe("canvas");
    expect(shown(player).pixels.every((v) => v === 0)).toBe(true);
    gfx.canvas.pixels.fill(77);
    expect(shown(player).pixels.every((v) => v === 77)).toBe(true);
    player.perform(player.engine.enterRoom(62));
    expect(gfx.owner).toBe("room");
    expect(shown(player).at(300, 190)).toBe(gfx.bg.at(300, 190));
  });

  it("updateRoom d'une pièce chargée reprend l'écran à une cinématique", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    player.engine.gfx.clearRoom();
    player.engine.updateRoom();
    expect(player.engine.gfx.owner).toBe("room");
  });

  it("en image libre : ni curseur, ni barre des verbes, ni nom ; le sous-titre se pose par-dessus puis disparaît", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    player.move(100, 10);
    player.run(10);
    expect(engine.state.menuBar).toBe(true);
    engine.gfx.clearRoom(); // une cinématique est une séquence : la boucle principale (qui rend la main à la pièce) est suspendue
    engine.gfx.canvas.pixels.fill(5);
    const plain = shown(player);
    expect(plain.pixels.every((v) => v === 5)).toBe(true);
    engine.subtitle = { text: "BONJOUR", x: 160, y: 100, color: TextColor.Yellow };
    const withText = shown(player);
    expect(withText.pixels.some((v) => v === 254)).toBe(true);
    engine.subtitle = null;
    expect(shown(player).pixels.every((v) => v === 5)).toBe(true);
  });

  it("une vue de réplique reçoit les étapes de updateRoom dans l'ordre où elle les appelle, avec le tirage", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    const log: string[] = [];
    engine.gfx.painters[1] = { 62: { pre: () => log.push("accroche pre"), post: () => log.push("accroche post") } };
    const view: TalkView = {
      draw(scene: Scene, roll: Roll) {
        log.push(`tirage ${roll.face}/${roll.extra}/${roll.step}`);
        scene.background();
        scene.pre();
        log.push("tête");
        scene.hero();
        scene.post();
      },
    };
    engine.head = { view, roll: { face: 3, extra: 1, step: 2 } };
    engine.render();
    expect(log).toEqual(["tirage 3/1/2", "accroche pre", "tête", "accroche post"]);
    engine.head = null;
    log.length = 0;
    engine.render();
    expect(log).toEqual(["accroche pre", "accroche post"]);
  });

  it("sans pièce chargée, pre, hero et post ne dessinent rien (cinématique d'avant le premier enterRoom)", () => {
    const player = new Player({ chapter: 1 });
    // L'introduction n'est pas jouée (pas de script) : on se place avant la pièce.
    player.engine.gfx.owner = "canvas";
    const scene = player.engine.gfx.scene({ ...player.state, room: null });
    scene.background();
    const before = player.engine.gfx.screen.pixels.slice();
    scene.pre();
    scene.hero();
    scene.post();
    expect(Array.from(player.engine.gfx.screen.pixels)).toEqual(Array.from(before));
  });

  it("la vue d'une réplique s'applique aussi à l'image libre (talk_drascula_big)", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    engine.gfx.clearRoom();
    engine.gfx.bg.pixels.fill(9);
    engine.head = {
      view: { draw: (scene: Scene) => scene.background() },
      roll: ROLL,
    };
    expect(shown(player).pixels.every((v) => v === 9)).toBe(true);
  });

  it("roomSprites faux : la pièce n'ajoute ni ses mises à jour ni ses accroches, mais garde le héros", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    const log: string[] = [];
    engine.gfx.painters[1] = { 62: { pre: () => log.push("pre"), post: () => log.push("post") } };
    engine.gfx.roomSprites = false;
    engine.render();
    expect(log).toEqual([]);
    engine.gfx.roomSprites = true;
    engine.render();
    expect(log).toEqual(["pre", "post"]);
  });
});

describe.skipIf(!hasOriginalFiles)("prise de main sur l'image : choix de dialogue", () => {
  it("les quatre choix sont dessinés l'un sous l'autre dans leur état, celui qui est survolé par-dessus en état survolé", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    const { engine } = player;
    const gfx = engine.gfx;
    player.move(300, 190); // le curseur loin du texte
    player.run(10);
    const phrases = ["PREMIER CHOIX", "SECOND CHOIX", "TROISIEME CHOIX", "AU REVOIR"];
    const car = gfx.sheet(DIALOG_FONT_SHEET);

    const expected = (hovered: number, states: ("unselected" | "selected" | "clicked")[]): Plane => {
      engine.render();
      const plane = new Plane(gfx.screen.pixels.slice());
      engine.choices = null;
      engine.render();
      const base = new Plane(gfx.screen.pixels.slice());
      let y = 2;
      const tops: number[] = [];
      phrases.forEach((phrase, i) => {
        tops.push(y);
        y += 8 * gfx.font.printChoice(base, car, phrase, y, states[i]);
      });
      if (hovered >= 0) gfx.font.printChoice(base, car, phrases[hovered], tops[hovered], "selected");
      void plane;
      return base;
    };

    engine.choices = { phrases, states: ["unselected", "unselected", "clicked", "unselected"], hovered: -1 };
    const plain = shown(player);
    expect(Array.from(plain.pixels)).toEqual(Array.from(expected(-1, ["unselected", "unselected", "clicked", "unselected"]).pixels));

    engine.choices = { phrases, states: ["unselected", "unselected", "clicked", "unselected"], hovered: 1 };
    const hovered = shown(player);
    expect(Array.from(hovered.pixels)).toEqual(Array.from(expected(1, ["unselected", "unselected", "clicked", "unselected"]).pixels));
    // Le survol change des pixels, et seulement ceux du choix survolé.
    let differing = 0;
    for (let i = 0; i < plain.pixels.length; i++) if (plain.pixels[i] !== hovered.pixels[i]) differing++;
    expect(differing).toBeGreaterThan(20);
  });

  it("le menu n'efface pas la pièce ailleurs que sous les lettres", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    const { engine } = player;
    player.move(300, 190);
    player.run(10);
    const without = shown(player);
    engine.choices = { phrases: ["A", "B", "C", "D"], states: ["unselected", "unselected", "unselected", "unselected"], hovered: -1 };
    const withMenu = shown(player);
    let differing = 0;
    for (let i = 0; i < without.pixels.length; i++) {
      if (without.pixels[i] === withMenu.pixels[i]) continue;
      differing++;
      expect(Math.trunc(i / 320)).toBeLessThan(40); // les quatre lettres sont dans le coin haut gauche
      expect(i % 320).toBeLessThan(10);
    }
    expect(differing).toBeGreaterThan(10);
  });
});
