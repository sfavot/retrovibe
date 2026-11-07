import { describe, expect, it } from "vitest";
import { WorldMap } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 10, la carte du village : pas de gestionnaire ni de dessin ; le moteur donne le nom des lieux au survol (`showMap`). */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : la carte (pièce 10)", () => {
  it("les objets sont ceux de la fiche ; le héros est minuscule (5 x 8)", () => {
    const w = startIn(10, { arrival: WorldMap.ToVillage });
    expect(objectIds(w)).toEqual([146, 148, 149]);
    expect([w.hero.width, w.hero.height]).toEqual([5, 8]);
    expect(w.host.music.at(-1)).toBe(6);
  });

  it("les trois lieux ont leur nom au survol, sans verbe", () => {
    const w = startIn(10);
    for (const id of [WorldMap.ToVillage, WorldMap.ToInn, WorldMap.ToBlindAlley]) {
      const object = objectOf(w, id);
      w.player.move(Math.trunc((object.rect.x1 + object.rect.x2) / 2), Math.trunc((object.rect.y1 + object.rect.y2) / 2));
      w.wait(5);
      expect(w.state.hasName, `objet ${id}`).toBe(true);
      expect(w.state.textName).toBe(object.name);
    }
  });

  it("les trois sorties : le village (4), l'auberge (12), l'impasse de l'aveugle (9)", () => {
    go(startIn(10), WorldMap.ToVillage, 4);
    go(startIn(10), WorldMap.ToInn, 12);
    go(startIn(10), WorldMap.ToBlindAlley, 9);
  });

  it("quitter la carte par le village après avoir donné le livre : le pianiste s'en va (drapeaux 5 et 11)", () => {
    const w = startIn(10, { flags: { 39: 1 } });
    go(w, WorldMap.ToVillage, 4);
    expect(w.flags[5]).toBe(1);
    expect(w.flags[11]).toBe(1);
  });
});
