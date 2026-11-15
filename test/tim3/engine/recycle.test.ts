import { describe, expect, it } from "vitest";
import { F10 } from "../../../src/games/tim3/engine/part";
import { World } from "../../../src/games/tim3/engine/world";
import { newPart, recyclePart } from "../../../src/games/tim3/engine/zone";
import { original, realTypes } from "./helpers";

describe.skipIf(!original.has)("432d00 : pièce recyclée (4393be)", () => {
  it("la pièce recyclée en tête des mobiles en sort et la tête suit (4393e0 lui donne la globale de tête pour précédent, 439566)", () => {
    const w = new World(realTypes());
    const gone = newPart(w, 0x29)!;
    const other = newPart(w, 0x29)!;
    w.mobiles.insertAfter(gone, null);
    w.mobiles.insertAfter(other, gone);
    gone.flags10 |= F10.GONE;
    gone.flags0C |= 0x10;
    const p = recyclePart(w, 0x29);
    expect(p).toBe(gone);
    expect(w.mobiles.head).toBe(other);
    expect([...w.mobiles]).toEqual([other]);
    expect(other.prev).toBeNull();
    expect(w.log.notes).toEqual([]);
  });
});
