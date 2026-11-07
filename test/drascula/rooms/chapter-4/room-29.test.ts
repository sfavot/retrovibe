import { describe, expect, it } from "vitest";
import { Flag, Kitchen } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { speech, startIn } from "./support";

/** Pièce 29, la cuisine : la porte du garde-manger (`room_29`) et les objets de `roomActions`. */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : la cuisine (pièce 29)", () => {
  const enter = (flags: Record<number, number> = {}) => startIn(29, { exit: Kitchen.DoorToCorridor, flags });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; la porte du garde-manger (114) est fermée au départ, celle du couloir ouverte", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([113, 114, 152, 153, 154, 155, 156, 154]);
    expect(object(w, Kitchen.DoorToCorridor).isDoor).toBe(true);
    expect(object(w, Kitchen.DoorToPantry).isDoor).toBe(false);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it("la porte 114 s'ouvre (drapeau 4, son 3) puis mène au garde-manger (sortie 115) ; elle se ferme (son 4)", () => {
    const w = enter();
    let mark = w.mark();
    w.act(Verb.Open, Kitchen.DoorToPantry);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.DoorPantry]).toBe(1);
    expect(object(w, Kitchen.DoorToPantry).isDoor).toBe(true);
    w.goTo(Kitchen.DoorToPantry);
    expect(w.room).toBe(30);
    expect(w.state.objExit).toBe(115);

    const closing = enter({ [Flag.DoorPantry]: 1 });
    mark = closing.mark();
    closing.act(Verb.Close, Kitchen.DoorToPantry);
    expect(closing.voices(mark)).toEqual(["s4.als"]);
    expect(object(closing, Kitchen.DoorToPantry).isDoor).toBe(false);
  });

  it("la porte du couloir (113) ramène au grand couloir (sortie 112)", () => {
    const w = enter();
    w.goTo(Kitchen.DoorToCorridor);
    expect(w.room).toBe(27);
    expect(w.state.objExit).toBe(112);
  });

  it.each([
    [Verb.Look, 152, "463.als"],
    [Verb.Open, 152, "464.als"],
    [Verb.Look, 153, "465.als"],
    [Verb.Pick, 154, "466.als"],
    [Verb.Open, 156, "467.als"],
  ])("verbe %i sur l'objet %i : roomActions (%s)", (verb, id, voice) => {
    const w = enter();
    expect(speech(w, () => w.act(verb, id))).toEqual([voice]);
  });
});
