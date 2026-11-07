import { describe, expect, it } from "vitest";
import { Flag, Item, Room, Towers, Workshop } from "../../../../src/games/drascula/engine/rooms/chapter-5/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 55, l'atelier : la vis et la porte piégée (`det.bin`). */
describe.skipIf(!hasOriginalFiles)("chapitre 5 : l'atelier (pièce 55)", () => {
  const enter = () => {
    const w = new Walkthrough({ chapter: 5 });
    w.flags[Flag.WerewolfGone] = 1;
    w.goTo(Towers.Tower2);
    w.goTo(108);
    w.goTo(Towers.Tower4);
    w.goTo(114);
    expect(w.room).toBe(Room.Workshop);
    return w;
  };

  it("les objets sont ceux de la fiche ; la musique est la 15", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([117, 122, 204, 205, 206]);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it.each([
    [Workshop.Screw, "138.als"],
    [Workshop.Camera, "139.als"],
    [Workshop.Alarm, "140.als"],
  ])("regarder l'objet %i : la réplique de roomActions", (id, voice) => {
    const w = enter();
    const mark = w.mark();
    w.act(Verb.Look, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("prendre la vis : en main (objet 12), drapeau 8, elle disparaît ; elle n'est plus là à l'entrée suivante", () => {
    const w = enter();
    w.act(Verb.Pick, Workshop.Screw);
    expect(w.state.pickedObject).toBe(Item.Screw);
    expect(w.flags[Flag.ScrewTaken]).toBe(1);
    expect(w.engine.room.objects.find((o) => o.id === Workshop.Screw)?.visible).toBe(false);
    w.goTo(Workshop.Door);
    w.goTo(114);
    expect(w.room).toBe(Room.Workshop);
    expect(w.engine.room.objects.find((o) => o.id === Workshop.Screw)?.visible).toBe(false);
    expect(w.state.inventory).toContain(Item.Screw);
  });

  it.each([Verb.Look, Verb.Open, Verb.Move, Verb.Talk])("la porte du fond, verbe %i : la détonation (son 11, det.bin), le héros recule", (verb) => {
    const w = enter();
    const mark = w.mark();
    w.selectVerb(verb);
    const { x, y } = w.pointOf(Workshop.TrappedDoor);
    w.player.click(x, y);
    w.until(() => w.engine.gfx.owner === "canvas");
    const before = { x: w.hero.x + Math.trunc(w.hero.width / 2), feet: w.hero.y + w.hero.height };
    w.settle(20_000);
    expect(w.voices(mark)).toEqual(["s11.als"]);
    expect(w.room).toBe(Room.Workshop);
    expect(w.engine.gfx.owner).toBe("room");
    // Arrivé à la porte, il recule : trois pixels vers la gauche, six vers le bas (au pas près).
    expect(w.hero.y + w.hero.height).toBeGreaterThan(before.feet);
    expect(w.hero.x + Math.trunc(w.hero.width / 2)).toBeLessThanOrEqual(before.x);
  });

  it("la détonation est la vidéo det.bin : l'image libre est utilisée", () => {
    const w = enter();
    w.selectVerb(Verb.Look);
    const { x, y } = w.pointOf(Workshop.TrappedDoor);
    w.player.click(x, y);
    w.until(() => w.engine.gfx.owner === "canvas");
    expect(w.engine.gfx.canvas.pixels.some((pixel) => pixel !== 0)).toBe(true);
  });
});
