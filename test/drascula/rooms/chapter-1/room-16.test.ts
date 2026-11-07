import { describe, expect, it } from "vitest";
import { Inn } from "../../../../src/games/drascula/engine/rooms/chapter-1/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/**
 * La chambre de B.J. de `animation_2_1` : « pièce 16 » de ScummVM au chapitre 1. `update_16_pre` y dessine B.J. debout
 * (`copyRect(37, 99, 170, 90, 26, 76)` depuis `auxbj.alg`) à chaque redessin de la pièce, jusqu'à ce qu'elle soit enlevée.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 1 : la chambre de B.J. (pièce 16)", () => {
  it("B.J. est dessinée debout par le painter du chapitre 1, pas par celui de l'hôtel du chapitre 2", () => {
    const w = new Walkthrough();
    w.act(Verb.Talk, Inn.Barman);
    w.selectVerb(Verb.None);
    const door = w.pointOf(Inn.Back);
    w.player.click(door.x, door.y);
    // Le héros, dans la chambre, parle à B.J. (réplique 224) : la pièce est redessinée avec B.J. debout.
    w.until(() => w.host.sounds.at(-1) === "224.als", 60_000);
    expect(w.state.chapter).toBe(1);
    expect(w.state.room?.number).toBe(16);
    const { gfx } = w.engine;
    expect(gfx.owner).toBe("room");
    w.engine.render();
    let checked = 0;
    for (let dy = 0; dy < 76; dy++) {
      for (let dx = 0; dx < 26; dx++) {
        const source = gfx.draw3.at(37 + dx, 99 + dy);
        if (source !== 255) {
          expect(w.host.screen![(90 + dy) * 320 + 170 + dx], `(${dx}, ${dy})`).toBe(source);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    w.settle(60_000);
  });
});
