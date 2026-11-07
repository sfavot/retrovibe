import { describe, expect, it } from "vitest";
import { Anim, Crossroads, Flag } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 2, le carrefour : la cabane indiquée par l'ivrogne, la chauve-souris, le nom des objets au survol. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : le carrefour (pièce 2)", () => {
  it("les objets sont ceux de la fiche ; la cabane est cachée tant que l'ivrogne n'en a pas parlé", () => {
    const w = startIn(2, { arrival: Crossroads.Church });
    expect(objectIds(w)).toEqual([123, 125, 127, 175]);
    expect(objectOf(w, Crossroads.Hut).visible).toBe(false);
    expect(w.host.music.at(-1)).toBe(6);
    const known = startIn(2, { flags: { [Flag.HutKnown]: 1 } });
    expect(objectOf(known, Crossroads.Hut).visible).toBe(true);
  });

  it("la cabane n'est une porte qu'une fois indiquée (drapeau 40) ; alors elle mène à la pièce 17", () => {
    const closed = startIn(2);
    expect(objectOf(closed, Crossroads.Hut).isDoor).toBe(false);
    closed.goTo(Crossroads.Hut);
    expect(closed.room).toBe(2);
    const open = startIn(2, { flags: { [Flag.HutKnown]: 1 } });
    expect(objectOf(open, Crossroads.Hut).isDoor).toBe(true);
    go(open, Crossroads.Hut, 17);
  });

  it("les autres sorties : l'église (1), le village (4), le cimetière (3)", () => {
    go(startIn(2), Crossroads.Church, 1);
    go(startIn(2), Crossroads.Village, 4);
    go(startIn(2), Crossroads.Cemetery, 3);
  });

  it("le héros du carrefour est minuscule (fiche : 5 x 8)", () => {
    const w = startIn(2);
    expect(w.hero.width).toBe(5);
    expect(w.hero.height).toBe(8);
  });

  it("update_2 : la chauve-souris passe à l'image suivante toutes les 6 ticks et revient à la première après 41 images", () => {
    const w = startIn(2);
    const first = w.state.anim[Anim.Bat] ?? 0;
    w.wait(6);
    expect(w.state.anim[Anim.Bat]).toBe(first + 1);
    const seen = new Set<number>();
    for (let i = 0; i < 41 * 6 + 12; i++) {
      w.wait(1);
      seen.add(w.state.anim[Anim.Bat] ?? 0);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 41 }, (_, n) => n));
  });

  it("update_2 : l'image de la chauve-souris vient de AUX2.ALG (37 x 21 en (239, 19))", () => {
    const w = startIn(2);
    w.state.anim[Anim.Bat] = 0;
    w.engine.render();
    const gfx = w.engine.gfx;
    let same = 0;
    let opaque = 0;
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 37; x++) {
        const source = gfx.draw3.at(0 + x, 179 + y);
        if (source === 255) continue;
        opaque++;
        if (w.host.screen![(19 + y) * 320 + 239 + x] === source) same++;
      }
    }
    expect(opaque).toBeGreaterThan(0);
    expect(same).toBe(opaque);
  });

  it("showMap : le nom des objets visibles survolés s'affiche sans verbe, portes comprises", () => {
    const w = startIn(2);
    const door = objectOf(w, Crossroads.Village);
    w.player.move(Math.trunc((door.rect.x1 + door.rect.x2) / 2), Math.trunc((door.rect.y1 + door.rect.y2) / 2));
    w.wait(5);
    expect(w.state.hasName).toBe(true);
    expect(w.state.textName).toBe(door.name);
    w.player.move(5, 5);
    w.wait(5);
    expect(w.state.hasName).toBe(false);
  });
});
