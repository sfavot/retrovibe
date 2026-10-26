import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/** Flèches tenues (option du portage) dans le moteur : `held: "press"` part sans bascule, `held: "release"` arrête. */

function ready(): Player {
  const p = new Player();
  p.skipIntro();
  return p;
}

describe.skipIf(!hasOriginalFiles)("flèches tenues", () => {
  it("jeu d'origine : rappuyer sur la même flèche arrête le héros", () => {
    const p = ready();
    p.host.key({ type: "nav", key: "left" });
    p.run(3);
    expect(p.hero.speedX).toBe(-1);
    p.host.key({ type: "nav", key: "left" });
    p.run(3);
    expect(p.hero.speedX).toBe(0);
  });

  it("flèche tenue : un second appui ne l'arrête pas ; le relâchement l'arrête", () => {
    const p = ready();
    const x = p.hero.x;
    p.host.key({ type: "nav", key: "left", held: "press" });
    p.run(3);
    p.host.key({ type: "nav", key: "left", held: "press" });
    p.run(20);
    expect(p.hero.speedX).toBe(-1);
    expect(p.hero.x).toBeLessThan(x);
    p.host.key({ type: "nav", key: "left", held: "release" });
    p.run(3);
    expect([p.hero.speedX, p.hero.speedP]).toEqual([0, 0]);
    const stopped = p.hero.x;
    p.run(20);
    expect(p.hero.x).toBe(stopped);
  });

  it("relâcher une flèche qui ne mène plus le héros ne l'arrête pas", () => {
    const p = ready();
    p.host.key({ type: "nav", key: "left", held: "press" });
    p.run(3);
    p.host.key({ type: "nav", key: "up", held: "press" });
    p.run(3);
    p.host.key({ type: "nav", key: "left", held: "release" });
    p.run(3);
    expect([p.hero.speedX, p.hero.speedP]).toEqual([0, -1]);
  });

  it("le relâchement passe même pendant que la ligne de saisie est ouverte", () => {
    const p = ready();
    p.host.key({ type: "nav", key: "right", held: "press" });
    p.run(3);
    p.host.type("r");
    p.run(2);
    expect(p.engine.inputLine.open).toBe(true);
    p.host.key({ type: "nav", key: "right", held: "release" });
    p.run(2);
    expect(p.hero.speedX).toBe(0);
  });
});
