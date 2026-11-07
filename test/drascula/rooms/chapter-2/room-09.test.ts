import { describe, expect, it } from "vitest";
import { Anim, BlindAlley, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, startIn } from "./route";

/** Pièce 9, l'impasse de l'aveugle : lui parler (deux fois), lui donner l'argent, son animation. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : l'impasse de l'aveugle (pièce 9)", () => {
  it("les objets sont ceux de la fiche", () => {
    const w = startIn(9, { arrival: BlindAlley.ToMap });
    expect(objectIds(w)).toEqual([152, 150, 51]);
    expect(w.host.music.at(-1)).toBe(28);
  });

  it("regarder l'aveugle (roomActions, 60) et la porte (35)", () => {
    const w = startIn(9);
    let mark = w.mark();
    w.act(Verb.Look, BlindAlley.Blind);
    expect(w.voices(mark)).toEqual(["60.als"]);
    mark = w.mark();
    w.act(Verb.Look, BlindAlley.Door);
    expect(w.voices(mark)).toEqual(["35.als"]);
  });

  it("update_9_pre : l'aveugle change d'image toutes les 11 ticks et revient à la première après 9", () => {
    const w = startIn(9);
    const seen: number[] = [];
    for (let i = 0; i < 9 * 11 + 20; i++) {
      w.wait(1);
      const frame = w.state.anim[Anim.Blind] ?? 0;
      if (seen.at(-1) !== frame) seen.push(frame);
    }
    expect(seen.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 0]);
  });

  it("update_9_pre : l'image de l'aveugle vient de AUX9.ALG (41 x 72 en (122, 57))", () => {
    const w = startIn(9);
    w.state.anim[Anim.Blind] = 2;
    w.engine.render();
    const gfx = w.engine.gfx;
    let opaque = 0;
    let same = 0;
    for (let y = 0; y < 72; y++) {
      for (let x = 0; x < 41; x++) {
        const source = gfx.draw3.at(110 + x, 51 + y);
        if (source === 255) continue;
        opaque++;
        if (w.host.screen![(57 + y) * 320 + 122 + x] === source) same++;
      }
    }
    expect(opaque).toBeGreaterThan(0);
    expect(same).toBe(opaque);
  });

  it("lui parler la première fois : la musique s'arrête, le décor de la scène (CIEGO1), neuf répliques, drapeau 4 ; la pièce est remise ensuite", () => {
    const w = startIn(9);
    const mark = w.mark();
    w.selectVerb(Verb.Talk);
    const { x, y } = w.pointOf(BlindAlley.Blind);
    w.player.click(x, y);
    w.until(() => w.engine.gfx.owner === "canvas");
    expect(w.host.musicPlaying()).toBe(false);
    expect(w.flags[Flag.BlindStanding]).toBe(1);
    w.settle(60_000);
    // Le héros, puis l'aveugle (d68 à d76) et le hacker (d57 à d64) tour à tour.
    expect(w.voices(mark)).toEqual([
      "60.als", "d68.als", "d57.als", "d69.als", "d58.als", "d70.als", "d59.als", "d71.als", "d60.als",
      "d72.als", "d61.als", "d73.als", "d62.als", "d74.als", "d63.als", "d75.als", "d64.als", "d76.als",
    ]);
    expect(w.flags[Flag.BlindSpoke]).toBe(1);
    expect(w.flags[Flag.BlindSpokeTwice]).toBe(0);
    expect(w.flags[Flag.BlindStanding]).toBe(0);
    expect(w.engine.gfx.owner).toBe("room");
    expect(w.host.musicPlaying()).toBe(true);
    expect(w.host.music.at(-1)).toBe(28);
    expect(w.state.takeObject).toBe(false);
  });

  it("lui parler la seconde fois : une seule réponse de sa part (d77), le drapeau 33", () => {
    const w = startIn(9, { flags: { [Flag.BlindSpoke]: 1 } });
    const mark = w.mark();
    w.act(Verb.Talk, BlindAlley.Blind, 60_000);
    expect(w.voices(mark)).toEqual(["60.als", "d68.als", "d57.als", "d77.als", "d65.als"]);
    expect(w.flags[Flag.BlindSpokeTwice]).toBe(1);
  });

  it("lui donner l'argent : il rend la faucille (14), l'argent n'est plus à nous", () => {
    const w = startIn(9, { items: [Item.Money], flags: { [Flag.BlindSpoke]: 1 } });
    const mark = w.mark();
    w.useItem(Item.Money, BlindAlley.Blind, 60_000);
    expect(w.state.pickedObject).toBe(Item.Sickle);
    expect(w.state.inventory).not.toContain(Item.Money);
    expect(w.voices(mark)).toEqual(["d66.als", "d78.als", "d67.als"]);
    expect(w.flags[Flag.BlindStanding]).toBe(0);
    expect(w.engine.gfx.owner).toBe("room");
    expect(w.host.music.at(-1)).toBe(28);
  });

  it("sans avoir parlé à l'aveugle, il ne répète pas la réplique 66 du héros", () => {
    const w = startIn(9, { items: [Item.Money] });
    const mark = w.mark();
    w.useItem(Item.Money, BlindAlley.Blind, 60_000);
    expect(w.voices(mark)).toEqual(["d78.als", "d67.als"]);
  });

  it("la sortie mène à la carte (10)", () => {
    go(startIn(9), BlindAlley.ToMap, 10);
  });
});
