import { describe, expect, it } from "vitest";
import { Church, Flag } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, startIn } from "./route";

/** Pièce 1, l'église : verbes, portes, lumière et fenêtre bouchée. */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : l'église (pièce 1)", () => {
  it("les objets sont ceux de la fiche", () => {
    const w = startIn(1, { arrival: Church.ToCrossroads });
    expect(w.room).toBe(1);
    expect(objectIds(w)).toEqual([118, 119, 120, 121, 122]);
    expect(w.host.music.at(-1)).toBe(10);
  });

  it("regarder la porte : les deux répliques de room_1 (1, puis 2)", () => {
    const w = startIn(1);
    const mark = w.mark();
    w.act(Verb.Look, Church.Door);
    expect(w.voices(mark)).toEqual(["1.als", "2.als"]);
  });

  it("regarder la fenêtre de droite : « si seulement cette fenêtre n'était pas bloquée » tant que le drapeau 8 est bas", () => {
    const w = startIn(1);
    const mark = w.mark();
    w.act(Verb.Look, Church.WindowRight);
    expect(w.voices(mark)).toEqual(["14.als"]);
  });

  it("la fenêtre débloquée n'a plus cette réplique : l'excuse de la pièce 0", () => {
    const w = startIn(1, { flags: { [Flag.ChapelWindowOpen]: 1 } });
    const mark = w.mark();
    w.act(Verb.Look, Church.WindowRight);
    expect(w.voices(mark)).toEqual(["100.als"]);
  });

  it("verbes de roomActions : prendre la porte (5), l'ouvrir (3), la fermer (4)", () => {
    const w = startIn(1);
    for (const [verb, voice] of [
      [Verb.Pick, "5.als"],
      [Verb.Open, "3.als"],
      [Verb.Close, "4.als"],
    ] as const) {
      const mark = w.mark();
      w.act(verb, Church.Door);
      expect(w.voices(mark), `verbe ${verb}`).toEqual([voice]);
    }
  });

  it("les deux sorties mènent au carrefour (2) et au cimetière (3)", () => {
    const w = startIn(1);
    go(w, Church.ToCrossroads, 2);
    expect(w.hero.x).toBeGreaterThan(0);
    const back = startIn(1);
    go(back, Church.ToCemeteryPath, 3);
  });

  it("update_1_pre : la fenêtre bouchée est dessinée tant que le drapeau 8 est bas", () => {
    const w = startIn(1);
    w.engine.render();
    const gfx = w.engine.gfx;
    const patch = (x: number, y: number) => w.host.screen![(67 + y) * 320 + 208 + x];
    let same = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 27; x++) if (patch(x, y) === gfx.draw3.at(2 + x, 158 + y)) same++;
    expect(same).toBe(27 * 40);
    w.engine.flags[Flag.ChapelWindowOpen] = 1;
    w.engine.render();
    let drawn = 0;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 27; x++) if (patch(x, y) === gfx.draw3.at(2 + x, 158 + y)) drawn++;
    expect(drawn).toBeLessThan(27 * 40);
  });

  it("update_1_pre : la pièce est sombre devant la porte (98 < x < 153), claire ailleurs", () => {
    const w = startIn(1);
    const { palette } = w.engine.gfx;
    const light = (source: Int8Array) => Array.from(source.subarray(235 * 3, 253 * 3));
    w.hero.x = 120;
    w.engine.render();
    expect(light(palette.game)).toEqual(light(palette.dark));
    w.hero.x = 250;
    w.engine.render();
    expect(light(palette.game)).toEqual(light(palette.bright));
  });
});
