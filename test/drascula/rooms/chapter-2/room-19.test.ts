import { describe, expect, it } from "vitest";
import { Flag, Well } from "../../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { go, objectIds, objectOf, startIn } from "./route";

/** Pièce 19, le puits : fermé tant que la potion n'est pas faite ; le franchir finit le chapitre (`animation_35_2`). */
describe.skipIf(!hasOriginalFiles)("chapitre 2 : le puits (pièce 19)", () => {
  it("les objets sont ceux de la fiche ; le puits est fermé au départ ; la musique est la 27", () => {
    const w = startIn(19, { arrival: Well.ToChapel });
    expect(objectIds(w)).toEqual([170, 173, 214]);
    expect(objectOf(w, Well.Well).isDoor).toBe(false);
    expect(w.host.music.at(-1)).toBe(27);
  });

  it("regarder le cyprès (191) et la porte (roomActions)", () => {
    const w = startIn(19);
    const mark = w.mark();
    w.act(Verb.Look, 214);
    expect(w.voices(mark)).toEqual(["191.als"]);
  });

  it("le puits fermé ne laisse pas passer : le héros reste dans la pièce, le chapitre continue", () => {
    const w = startIn(19);
    w.goTo(Well.Well);
    expect(w.room).toBe(19);
    expect(w.state.chapter).toBe(2);
  });

  it("la porte mène à la chapelle (7)", () => {
    go(startIn(19), Well.ToChapel, 7);
  });

  it("le puits ouvert (drapeau 36) : le héros s'y jette (son 1, le hoquet), fondu au noir, et le chapitre 3 commence", () => {
    const w = startIn(19, { flags: { [Flag.WellOpen]: 1 } });
    const mark = w.mark();
    w.goTo(Well.Well, 60_000);
    expect(w.voices(mark)).toEqual(["s1.als"]);
    expect(w.state.chapter).toBe(3);
    expect(w.room).toBe(20);
    expect(w.engine.gfx.shake).toBeNull();
    expect(w.host.exits).toBe(0);
  });
});
