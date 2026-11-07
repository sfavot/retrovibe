import { describe, expect, it } from "vitest";
import { hiccup, roomObject, setDoor, setVisible, toggleDoor } from "../../../src/games/drascula/engine/room-kit";
import { hasOriginalFiles } from "../helpers";
import { Walkthrough } from "../walkthrough";

describe.skipIf(!hasOriginalFiles)("aides communes des pièces (room-kit)", () => {
  it("objets de la pièce par leur numéro : visibilité et passage", () => {
    const w = new Walkthrough();
    const g = w.engine;
    expect(roomObject(g, 106)?.isDoor).toBe(true);
    setDoor(g, 106, false);
    expect(roomObject(g, 106)?.isDoor).toBe(false);
    setDoor(g, 106, true);
    expect(roomObject(g, 106)?.isDoor).toBe(true);
    setDoor(g, 100, true); // un objet sans porte ne devient pas une porte
    expect(roomObject(g, 100)?.isDoor).toBe(false);
    setVisible(g, 100, false);
    expect(roomObject(g, 100)?.visible).toBe(false);
    setVisible(g, 999, true); // absent : sans effet
    expect(roomObject(g, 999)).toBeUndefined();
  });

  it("toggleDoor : ouvre une fois (son 3), ferme une fois (son 4), ignore l'état déjà atteint", () => {
    const w = new Walkthrough({ chapter: 2 });
    const g = w.engine;
    const mark = w.mark();
    w.player.perform(toggleDoor(g, 3, null, "close")); // déjà fermée
    expect(w.voices(mark)).toEqual([]);
    w.player.perform(toggleDoor(g, 3, null, "open"));
    expect(g.flags[3]).toBe(1);
    w.player.perform(toggleDoor(g, 3, null, "open"));
    w.player.perform(toggleDoor(g, 3, null, "close"));
    expect(g.flags[3]).toBe(0);
    expect(w.voices(mark)).toEqual(["s3.als", "s4.als"]);
    expect(g.state.takeObject).toBe(false);
  });

  it("toggleDoor : au chapitre 1 la porte du drapeau 7 ne s'ouvre jamais", () => {
    const w = new Walkthrough();
    const mark = w.mark();
    w.player.perform(toggleDoor(w.engine, 7, null, "open"));
    expect(w.engine.flags[7]).toBe(0);
    expect(w.voices(mark)).toEqual([]);
  });

  it("hiccup : l'écran descend de 0, 1, 2, 1, 0 lignes puis revient à sa place", () => {
    const w = new Walkthrough();
    const g = w.engine;
    g.run(hiccup(g, 5));
    const seen: number[] = [];
    for (let i = 0; i < 200 && g.busy; i++) {
      w.wait(1);
      const y = g.gfx.shake?.y;
      if (y !== undefined && seen.at(-1) !== y) seen.push(y);
    }
    expect(seen).toEqual([0, 1, 2, 1, 0]);
    expect(g.busy).toBe(false);
    expect(g.gfx.shake).toBeNull();
  });

  it("hiccup : l'image est décalée de y lignes (les lignes 1 à 198 vont à partir de y)", () => {
    const w = new Walkthrough();
    const g = w.engine;
    g.render();
    const still = Uint8Array.from(g.gfx.screen.pixels);
    g.gfx.shake = { y: 2, fromRow: 1, rows: 198 };
    g.render();
    const shaken = g.gfx.screen.pixels;
    for (const [row, source] of [[2, 1], [50, 49], [199, 198]]) {
      expect(shaken.slice(row * 320, row * 320 + 320)).toEqual(still.slice(source * 320, source * 320 + 320));
    }
    expect(shaken.slice(0, 320)).toEqual(still.slice(0, 320));
    g.gfx.shake = null;
  });
});
