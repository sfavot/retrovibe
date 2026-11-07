import { describe, expect, it } from "vitest";
import { Flag, Hallway, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, startIn } from "./route";

/** Pièce 15, le couloir : le distributeur de cigarettes (deux pièces, puis un coup de pied). */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : le couloir (pièce 15)", () => {
  it("les objets sont ceux de la fiche ; le distributeur est prêt (drapeau 27 levé au début du chapitre)", () => {
    const w = startIn(15, { arrival: Hallway.Stairs });
    expect(objectIds(w)).toEqual([172, 188, 205, 206]);
    expect(w.flags[Flag.MachineReady]).toBe(1);
    expect(w.host.music.at(-1)).toBe(21);
    expect([w.hero.width, w.hero.height]).toEqual([39, 64]);
  });

  it("regarder et parler au distributeur, regarder les papiers et le rideau : roomActions", () => {
    const w = startIn(15);
    for (const [verb, id, voice] of [
      [Verb.Look, Hallway.Machine, "334.als"],
      [Verb.Talk, Hallway.Machine, "333.als"],
      [Verb.Look, 205, "172.als"],
      [Verb.Look, 206, "173.als"],
      [Verb.Move, 206, "174.als"],
    ] as const) {
      const mark = w.mark();
      w.act(verb, id);
      expect(w.voices(mark), `verbe ${verb} sur ${id}`).toEqual([voice]);
    }
  });

  it("les deux pièces dans le distributeur : le son 8, « c'est du vol ! » (338), une pièce rendue (19), le drapeau 27 baisse", () => {
    const w = startIn(15, { items: [Item.TwoCoins] });
    const mark = w.mark();
    w.useItem(Item.TwoCoins, Hallway.Machine);
    expect(w.voices(mark)).toEqual(["s8.als", "338.als"]);
    expect(w.state.pickedObject).toBe(Item.OneCoin);
    expect(w.state.inventory).not.toContain(Item.TwoCoins);
    expect(w.flags[Flag.MachineReady]).toBe(0);
    expect(w.engine.gfx.owner).toBe("room");
  });

  it("la pièce qui reste : avant le coup de pied « j'ai une autre pièce » (335) ; après, le héros refuse de fumer (336, 337 et son rire)", () => {
    const w = startIn(15, { items: [Item.OneCoin], flags: { [Flag.MachineReady]: 0 } });
    let mark = w.mark();
    w.useItem(Item.OneCoin, Hallway.Machine);
    expect(w.voices(mark)).toEqual(["335.als"]);
    w.selectVerb(Verb.None);
    w.engine.flags[Flag.MachineReady] = 1;
    mark = w.mark();
    w.useItem(Item.OneCoin, Hallway.Machine);
    expect(w.voices(mark)).toEqual(["336.als", "337.als", "46.als"]);
    expect(w.hero.track).toBe(1);
  });

  it("le coup de pied (pousser) après les pièces : la cinématique 34_2 (son 8), « enfin ! » (339), les cigarettes en main, drapeaux 26 et 27", () => {
    const w = startIn(15, { flags: { [Flag.MachineReady]: 0 } });
    const mark = w.mark();
    w.act(Verb.Move, Hallway.Machine, 60_000);
    expect(w.voices(mark)).toEqual(["s8.als", "339.als"]);
    expect(w.state.pickedObject).toBe(Item.Cigarettes);
    expect(w.flags[Flag.CigarettesTaken]).toBe(1);
    expect(w.flags[Flag.MachineReady]).toBe(1);
    expect(w.engine.gfx.owner).toBe("room");
  });

  it("pousser le distributeur sans avoir mis de pièces : rien (l'excuse de la pièce 0)", () => {
    const w = startIn(15);
    const mark = w.mark();
    w.act(Verb.Move, Hallway.Machine);
    expect(w.voices(mark)).toEqual(["19.als"]);
    expect(w.flags[Flag.CigarettesTaken]).toBe(0);
  });

  it("le coup de pied rend leurs feuilles au héros (face, côté, dos) ", () => {
    const w = startIn(15, { flags: { [Flag.MachineReady]: 0 } });
    const gfx = w.engine.gfx;
    const sheets = ["front", "extra", "back"] as const;
    const before = sheets.map((name) => Array.from(gfx[name].pixels.subarray(0, 3000)));
    w.act(Verb.Move, Hallway.Machine, 60_000);
    expect(sheets.map((name) => Array.from(gfx[name].pixels.subarray(0, 3000)))).toEqual(before);
  });

  it("l'escalier mène à l'auberge (14)", () => {
    go(startIn(15), Hallway.Stairs, 14);
  });

  it("le premier plan du couloir (roomUpdates) est dessiné par-dessus le héros", () => {
    const w = startIn(15);
    w.engine.render();
    const gfx = w.engine.gfx;
    let opaque = 0;
    let same = 0;
    for (let y = 0; y < 44; y++) {
      for (let x = 0; x < 131; x++) {
        const source = gfx.draw3.at(1 + x, 154 + y);
        if (source === 255) continue;
        opaque++;
        if (w.host.screen![(122 + y) * 320 + 83 + x] === source) same++;
      }
    }
    expect(same).toBe(opaque);
  });
});
