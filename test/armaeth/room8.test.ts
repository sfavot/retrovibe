import { describe, expect, it } from "vitest";
import { terrainCollision, type Terrain } from "../../src/games/armaeth/engine/ground";
import type { GameObject } from "../../src/games/armaeth/engine/state";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/**
 * Salle 8 de bout en bout : la pile de bois (sol 65, une rampe de 4 cases entre deux murs) et le coffret (`Num 9`, sur la
 * corniche en haut de la pile). Régression du trajet abandonné par le garde-fou : les positions que le placement donnait au
 * héros touchaient un mur (mémoire des murs `1b11:16b4` non portée), puis le suivi de trajet (`30d9:0184`) n'était pas fidèle.
 */

interface Internals {
  terrain: Terrain;
  inReach(obj: GameObject): boolean;
}

describe.skipIf(!hasOriginalFiles)("salle 8 : la pile de bois et le coffret", () => {
  function enter(): Player {
    const p = new Player();
    p.skipIntro();
    p.engine.sendToRoom(8, true);
    p.run(60);
    p.drain(5);
    expect(p.state.loadedRoom!.id).toBe(8);
    return p;
  }
  const coffret = (p: Player) => p.state.objects.find((o) => o.num === 9 && o.typ === 2)!;
  const internals = (p: Player) => p.engine as unknown as Internals;

  it("le héros est posé sur la pile (sol 65) sans toucher un mur, de tous les X voisins", () => {
    const p = enter();
    const hero = p.hero;
    expect(hero.ground).toBe(65);
    const { terrain } = internals(p);
    expect(terrainCollision(terrain, hero).code).toBe(0);
    // le placement libre autour de la position d'origine ne rend jamais une position contre un mur
    for (let x = 200; x <= 236; x++) {
      Object.assign(hero, { x, y: 140, p: 113 });
      const result = p.engine.place(hero, 1);
      expect([0, 0x11]).toContain(result);
      expect(terrainCollision(terrain, hero).code).toBe(0);
    }
  });

  it("clic des bottes sur la corniche : le héros monte la pile et arrive à portée du coffret", () => {
    const p = enter();
    const hero = p.hero;
    hero.x = 217; // X impair : le couloir de la pile ne laisse passer que X 197 à 199 en P 56 (voir game.test.ts pour X pair)
    p.engine.place(hero, 1);
    expect(hero.ground).toBe(65);
    p.walkTo(231, 74, 6000);
    expect(hero.path.defined).toBe(false);
    expect(hero.ground).toBe(2);
    expect(hero.y).toBeLessThan(80);
    expect(internals(p).inReach(coffret(p))).toBe(true);
  });

  it("ouvrir le coffret : le héros marche jusqu'à lui par la pile, puis la commande est rejouée", () => {
    const p = enter();
    const hero = p.hero;
    hero.x = 217;
    p.engine.place(hero, 1);
    const said = p.say("ouvrir le coffret");
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/il vous faut l'objet adéquat/); // le coffret est fermé à clef : rien sans l'objet adéquat
    expect(internals(p).inReach(coffret(p))).toBe(true);
    expect(p.say("regarder le coffret")[0]).toMatch(/solidement fermé à clef/);
  });
});
