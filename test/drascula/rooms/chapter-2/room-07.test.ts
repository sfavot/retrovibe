import { describe, expect, it } from "vitest";
import { Chapel, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 7, la chapelle : la bougie. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : la chapelle (pièce 7)", () => {
  it("les objets sont ceux de la fiche", () => {
    const w = startIn(7, { arrival: Chapel.ToBedroom });
    expect(objectIds(w)).toEqual([142, 164, 169, 190]);
    expect(w.host.music.at(-1)).toBe(27);
  });

  it("regarder le retable et la porte : roomActions", () => {
    const w = startIn(7);
    let mark = w.mark();
    w.act(Verb.Look, 169);
    expect(w.voices(mark)).toEqual(["44.als"]);
    mark = w.mark();
    w.act(Verb.Look, Chapel.ToWell);
    expect(w.voices(mark)).toEqual(["35.als"]);
  });

  it("prendre la bougie : en main (objet 17), drapeau 35, elle disparaît ; au retour elle est encore prise", () => {
    const w = startIn(7);
    w.act(Verb.Pick, Chapel.Candle);
    expect(w.state.pickedObject).toBe(Item.Candle);
    expect(w.flags[Flag.CandleTaken]).toBe(1);
    expect(objectOf(w, Chapel.Candle).visible).toBe(false);
    w.selectVerb(Verb.None);
    w.player.perform(w.engine.enterRoom(7));
    expect(objectOf(w, Chapel.Candle).visible).toBe(false);
  });

  it("le dessin de la bougie (roomPreUpdates, drapeau 35 bas) disparaît du décor avec elle", () => {
    const w = startIn(7);
    const gfx = w.engine.gfx;
    const candle = (x: number, y: number) => w.host.screen![(162 + y) * 320 + 158 + x] === gfx.draw3.at(1 + x, 72 + y);
    w.engine.render();
    let drawn = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 19; x++) if (candle(x, y)) drawn++;
    expect(drawn).toBe(12 * 19);
    w.engine.flags[Flag.CandleTaken] = 1;
    w.engine.render();
    drawn = 0;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 19; x++) if (candle(x, y)) drawn++;
    expect(drawn).toBeLessThan(12 * 19);
  });

  it("les sorties : la chambre (6) ; la porte du puits (19)", () => {
    go(startIn(7), Chapel.ToBedroom, 6);
    go(startIn(7), Chapel.ToWell, 19);
  });
});
