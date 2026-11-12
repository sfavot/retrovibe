import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/**
 * Les flèches pendant l'escalade (`Dep` 2/4, déplacement lié aux zones) pilotent le héros sur la paroi :
 * gauche/droite le long de la surface (`Hor`), haut/bas montent/descendent (`Ver`). Avant le correctif, haut/bas
 * réglaient la profondeur (`Prf`), ce qui sortait le héros de la zone et le faisait « perdre prise ».
 */

/** Un joueur au pied du grand arbre de droite de la salle 9, accroché à la paroi (`Ego 2`). */
function climbing(): Player {
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
  p.walkTo(235, 138); // case 7 au pied du tronc
  p.drain();
  p.say("grimper");
  for (let i = 0; i < 20; i++) p.run(1);
  return p;
}

describe.skipIf(!hasOriginalFiles)("flèches pendant l'escalade", () => {
  it("haut monte (Ver) sans toucher à la profondeur ; rappuyer arrête", () => {
    const p = climbing();
    const hero = p.hero;
    expect([hero.ego, hero.dep]).toEqual([2, 4]);
    expect(hero.speedY).toBe(-1); // « grimper » fait monter
    const p0 = hero.p;
    p.host.key({ type: "nav", key: "up" });
    p.run(3);
    expect([hero.speedY, hero.speedP, hero.p]).toEqual([0, 0, p0]); // rappuyer arrête la montée
    p.host.key({ type: "nav", key: "up" });
    p.run(3);
    expect([hero.speedY, hero.speedP, hero.p]).toEqual([-1, 0, p0]); // et la reprend
  });

  it("bas descend (Ver) au lieu de changer la profondeur", () => {
    const p = climbing();
    const hero = p.hero;
    const p0 = hero.p;
    p.host.key({ type: "nav", key: "down" });
    p.run(3);
    expect([hero.speedY, hero.speedP, hero.p]).toEqual([1, 0, p0]);
    expect(hero.ego).toBe(2); // toujours accroché
  });

  it("gauche/droite se déplacent le long de la paroi sans arrêter la montée", () => {
    const p = climbing();
    const hero = p.hero;
    expect(hero.speedY).toBe(-1);
    p.host.key({ type: "nav", key: "left" });
    p.run(3);
    expect([hero.speedX, hero.speedY]).toEqual([-1, -1]); // diagonale : la montée continue
    p.host.key({ type: "nav", key: "left" });
    p.run(3);
    expect(hero.speedX).toBe(0); // rappuyer arrête le déplacement horizontal
    expect(hero.speedY).toBe(-1); // la montée, elle, continue
  });
});
