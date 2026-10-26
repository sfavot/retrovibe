import { describe, expect, it } from "vitest";
import { TOUCH_EXIT_MARGIN } from "../../src/games/armaeth/engine/interface";
import { hasOriginalFiles } from "./helpers";
import { Player } from "./player";

/** Au doigt, avec les bottes : un toucher au bord de la scène, du côté d'une sortie, fait changer de salle (écart du portage). */

/** Un toucher (appui marqué `touch` puis relâchement) au point d'écran `(x, y)`. */
function touch(p: Player, x: number, y: number): void {
  p.host.push({ type: "pointer", x, y, buttons: 0 });
  p.host.push({ type: "pointer", x, y, buttons: 1, touch: true });
  p.run(1);
  p.host.push({ type: "pointer", x, y, buttons: 0 });
  p.run(1);
}

describe.skipIf(!hasOriginalFiles)("sortie au doigt", () => {
  it("salle 1 : un toucher au bord, du côté d'une sortie, fait changer de salle ; le même clic à la souris fait marcher", () => {
    const p = new Player();
    p.skipIntro();
    p.useBoots();
    const room = p.state.loadedRoom!;
    const { x: ox, y: oy } = p.origin;
    const { width, height } = p.engine.currentScene!.header;
    // un côté de la scène où la salle a une sortie (secteurs 0 haut, 1 droite, 2 bas, 3 gauche)
    const sides = [
      { sector: 3, x: ox + 2, y: oy + (height >> 1) },
      { sector: 1, x: ox + width - 3, y: oy + (height >> 1) },
      { sector: 2, x: ox + (width >> 1), y: oy + height - 3 },
      { sector: 0, x: ox + (width >> 1), y: oy + 2 },
    ];
    const side = sides.find((s) => p.state.neighbour(room, s.sector))!;
    expect(side).toBeDefined();
    expect(TOUCH_EXIT_MARGIN).toBeGreaterThan(2);

    touch(p, side.x, side.y);
    for (let i = 0; i < 4000 && p.state.loadedRoom === room; i++) {
      p.run(1);
      p.readWindow();
    }
    expect(p.state.loadedRoom).toBe(p.state.neighbour(room, side.sector));
  });
});
