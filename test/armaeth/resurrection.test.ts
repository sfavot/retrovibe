import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/** Résurrection (F4) après une mort dans une salle où l'on n'entre qu'en grimpant : la cime de l'arbre (salle 10). */

/** Un joueur au pied du grand arbre de droite de la salle 9, qui grimpe jusqu'à la cime (salle 10). */
function climbToTreetop(): Player {
  const p = new Player();
  p.skipIntro();
  const state = p.state;
  const hero = p.hero;
  const forest = state.roomById(9)!;
  state.moveToRoom(hero, forest);
  state.wantedRoom = forest;
  hero.info = 6;
  for (let i = 0; i < 200 && state.loadedRoom !== forest; i++) p.run(1);
  for (let i = 0; i < 5; i++) {
    p.run(100);
    p.drain();
  }
  const until = (done: () => boolean) => {
    for (let i = 0; i < 2000 && !done(); i++) {
      p.run(1);
      p.readWindow();
    }
    expect(done()).toBe(true);
  };
  // `-` monte, une flèche déplace le long des branches ; rappuyer arrête
  const key = (k: "-" | "left" | "right") => {
    if (k === "-") p.host.type("-");
    else p.host.key({ type: "nav", key: k });
    p.run(1);
  };
  p.walkTo(235, 138); // case 7 au pied du tronc
  p.drain();
  key("-");
  until(() => hero.y <= 70); // haut de la première branche : il s'arrête
  key("-");
  key("left");
  until(() => hero.x <= 224);
  key("left");
  key("-");
  until(() => hero.y <= 30);
  key("-");
  key("right");
  until(() => hero.x >= 234);
  key("right");
  key("-");
  until(() => state.loadedRoom?.id === 10 && hero.room?.id === 10);
  p.run(10);
  return p;
}

describe.skipIf(!hasOriginalFiles)("résurrection après une mort dans l'arbre", () => {
  it("le héros mort dans la cime (salle 10) ressuscite au pied de l'arbre (salle 9) et peut marcher sans retomber", () => {
    const p = climbToTreetop();
    const state = p.state;
    expect(p.hero.ego).toBe(2); // il grimpe

    // mort sur place (le genre de mort n'importe pas ici)
    state.deleteObject(p.hero);
    state.setHero(null);
    p.run(2);

    p.engine.continueGame();
    p.drain();
    p.run(30);
    const hero = state.hero!;
    expect(hero.room?.id).toBe(9);
    expect(state.loadedRoom?.id).toBe(9);
    expect(hero.presence).toBe(2);

    // il marche quelques pas sans tomber
    p.host.key({ type: "nav", key: "left" });
    for (let i = 0; i < 100; i++) {
      p.run(1);
      p.readWindow();
    }
    expect(state.hero).toBe(hero);
    expect(hero.ego).toBe(0);
  });
});
