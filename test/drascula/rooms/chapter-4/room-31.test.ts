import { describe, expect, it } from "vitest";
import { Flag, Item, LivingRoom } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, speech, startIn } from "./support";

/** Pièce 31, le salon : la hache, la porte du couloir (`room_31`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le salon (pièce 31)", () => {
  const enter = (flags: Record<number, number> = {}) =>
    startIn(31, { exit: LivingRoom.DoorToCorridor, flags: { [Flag.DoorLivingRoom]: 1, [Flag.LivingRoomUnlocked]: 1, ...flags } });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; on arrive par la porte 117 ouverte", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([117, 145, 160, 161, 162]);
    expect(object(w, LivingRoom.DoorToCorridor).isDoor).toBe(true);
    expect(object(w, LivingRoom.Axe).visible).toBe(true);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it("prendre la hache (145) : l'objet 11 en main, drapeau 13, elle ne revient pas à la rentrée", () => {
    const w = enter();
    expect(speech(w, () => w.act(Verb.Pick, LivingRoom.Axe))).toEqual([]);
    expect(w.state.pickedObject).toBe(Item.Axe);
    expect(w.flags[Flag.AxeTaken]).toBe(1);
    expect(object(w, LivingRoom.Axe).visible).toBe(false);
    w.selectVerb(Verb.None);
    w.goTo(LivingRoom.DoorToCorridor);
    expect(w.room).toBe(27);
    expect(w.state.objExit).toBe(116);
  });

  it("la hache déjà prise n'est plus dans la pièce à la rentrée", () => {
    const w = enter({ [Flag.AxeTaken]: 1 });
    expect(object(w, LivingRoom.Axe).visible).toBe(false);
  });

  it("la porte 117 se ferme (son 4, drapeau 5) et se rouvre (son 3)", () => {
    const w = enter();
    let mark = w.mark();
    w.act(Verb.Close, LivingRoom.DoorToCorridor);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.DoorLivingRoom]).toBe(0);
    expect(object(w, LivingRoom.DoorToCorridor).isDoor).toBe(false);
    mark = w.mark();
    w.act(Verb.Open, LivingRoom.DoorToCorridor);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(object(w, LivingRoom.DoorToCorridor).isDoor).toBe(true);
  });

  it.each([
    [Verb.Look, 161, "470.als"],
    [Verb.Open, 161, "471.als"],
  ])("verbe %i sur la fenêtre %i : roomActions (%s)", (verb, id, voice) => {
    const w = enter();
    expect(speech(w, () => w.act(verb, id))).toEqual([voice]);
  });

  it("le dessin : la hache prise laisse son rectangle (drapeau 13), le premier plan est par-dessus", () => {
    const w = enter({ [Flag.AxeTaken]: 1 });
    w.hero.x = 20;
    const gfx = render(w);
    const taken = comparedPixels(gfx, gfx.draw3, [1, 163, 116, 41, 61, 36], true, 3);
    expect(taken.compared).toBeGreaterThan(50);
    expect(taken.mismatches).toEqual([]);
    const foreground = comparedPixels(gfx, gfx.draw3, [63, 190, 223, 157, 17, 9], false, 2);
    expect(foreground.compared).toBeGreaterThan(10);
    expect(foreground.mismatches).toEqual([]);
  });
});
