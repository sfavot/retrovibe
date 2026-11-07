import { describe, expect, it } from "vitest";
import { Anim, Flag, Item, Study } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Track, Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, repaint, speech, startIn } from "./support";

/** Pièce 34, le bureau : l'armoire au pieu, la torche et l'étagère qui pivote (`room_34`, `animation_8_4`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le bureau (pièce 34)", () => {
  const enter = (flags: Record<number, number> = {}) => startIn(34, { exit: Study.DoorToCorridor, flags });
  const object = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; seule la porte du couloir est ouverte au départ", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([119, 120, 122, 146]);
    expect(object(w, Study.DoorToCorridor).isDoor).toBe(true);
    expect(object(w, Study.Wardrobe).isDoor).toBe(false);
    expect(object(w, Study.Bookcase).isDoor).toBe(false);
    expect(w.host.music.at(-1)).toBe(15);
  });

  it("la porte 119 ramène au grand couloir (sortie 118)", () => {
    const w = enter();
    w.goTo(Study.DoorToCorridor);
    expect(w.room).toBe(27);
    expect(w.state.objExit).toBe(118);
  });

  describe("l'armoire (120)", () => {
    it("la première ouverture : son 3, « J'ai trouvé un pieu en pin » (425), le héros de face, le pieu (14) en main, drapeaux 8 et 25", () => {
      const w = enter();
      const mark = w.mark();
      w.act(Verb.Open, Study.Wardrobe);
      expect(w.voices(mark)).toEqual(["s3.als", "425.als"]);
      expect(w.flags[Flag.StudyWardrobe]).toBe(1);
      expect(w.flags[Flag.StakeTaken]).toBe(1);
      expect(w.state.pickedObject).toBe(Item.Stake);
      expect(w.state.hero.track).toBe(Track.Down);
      // Écart hérité de ScummVM : `room_34` rend l'état de l'armoire par l'index 2 (l'étagère) : `isDoor` de l'armoire n'est relu qu'au
      // prochain clic sur elle (`exitRoom` appelle `updateDoor`), ce qui suffit au joueur.
      expect(object(w, Study.Wardrobe).isDoor).toBe(false);
      w.selectVerb(Verb.None);
      w.goTo(Study.Wardrobe);
      expect(w.room).toBe(35);
    });

    it("ouverte, elle mène à l'armoire de la pièce 35 (sortie 121)", () => {
      const w = enter();
      w.act(Verb.Open, Study.Wardrobe);
      w.selectVerb(Verb.None);
      w.goTo(Study.Wardrobe);
      expect(w.room).toBe(35);
      expect(w.state.objExit).toBe(121);
    });

    it("la deuxième ouverture (après une fermeture) ne redonne pas de pieu ; fermée, elle ne se franchit plus", () => {
      const w = enter();
      w.act(Verb.Open, Study.Wardrobe);
      w.selectVerb(Verb.None);
      let mark = w.mark();
      w.act(Verb.Close, Study.Wardrobe);
      expect(w.voices(mark)).toEqual(["s4.als"]);
      expect(w.flags[Flag.StudyWardrobe]).toBe(0);
      w.goTo(Study.Wardrobe);
      expect(w.room).toBe(34);
      mark = w.mark();
      w.act(Verb.Open, Study.Wardrobe);
      expect(w.voices(mark)).toEqual(["s3.als"]);
      w.goTo(Study.Wardrobe);
      expect(w.room).toBe(35);
    });
  });

  describe("la torche (146) et l'étagère (122)", () => {
    it("regarder (458) et prendre (459) : roomActions", () => {
      const w = enter();
      expect(speech(w, () => w.act(Verb.Look, Study.Torch))).toEqual(["458.als"]);
      expect(speech(w, () => w.act(Verb.Pick, Study.Torch))).toEqual(["459.als"]);
      expect(w.flags[Flag.Bookcase]).toBe(0);
    });

    it("pousser la torche : l'étagère pivote (quatorze images, la dernière aussitôt remplacée), puis s'ouvre (son 3, drapeau 7) sur le labyrinthe", () => {
      const w = enter();
      const mark = w.mark();
      w.selectVerb(Verb.Move);
      const at = w.pointOf(Study.Torch);
      w.player.click(at.x, at.y);
      const seen: number[] = [];
      w.until(() => {
        const frame = w.state.anim[Anim.Bookcase] ?? 0;
        if (frame > 0 && seen.at(-1) !== frame) seen.push(frame);
        return !w.engine.busy && frame === 0 && seen.length > 0;
      });
      w.settle();
      // La quatorzième image est posée puis remplacée dans le même tick par la pièce redessinée (`toggleDoor`), comme dans ScummVM.
      expect(seen).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
      expect(w.voices(mark)).toEqual(["s3.als"]);
      expect(w.flags[Flag.Bookcase]).toBe(1);
      expect(object(w, Study.Bookcase).isDoor).toBe(true);
      expect(w.state.anim[Anim.Bookcase]).toBe(0);
      w.goTo(Study.Bookcase);
      expect(w.room).toBe(36);
      expect(w.state.objExit).toBe(123);
    });

    it("chaque image est la partie de an_8.alg indiquée, copiée en (77, 45) par-dessus la pièce", () => {
      const w = enter();
      w.selectVerb(Verb.Move);
      const at = w.pointOf(Study.Torch);
      w.player.click(at.x, at.y);
      w.player.move(319, 199);
      for (const [frame, sx, sy] of [[1, 1, 1], [4, 223, 1], [5, 1, 74], [8, 223, 74], [13, 149, 74]] as const) {
        w.until(() => w.state.anim[Anim.Bookcase] === frame);
        const gfx = repaint(w);
        const { compared, mismatches } = comparedPixels(gfx, gfx.draw2, [sx, sy, 77, 45, 73, 72], true, 6);
        expect(compared).toBeGreaterThan(100);
        expect(mismatches, `image ${frame}`).toEqual([]);
      }
      w.settle();
    });

    it("l'étagère ouverte (drapeau 7) est un rectangle de roomPreUpdates ; la torche peut être poussée de nouveau sans effet", () => {
      const w = enter({ [Flag.Bookcase]: 1 });
      w.hero.x = 250;
      const gfx = render(w);
      const { compared, mismatches } = comparedPixels(gfx, gfx.draw3, [99, 127, 73, 41, 79, 72], true, 5);
      expect(compared).toBeGreaterThan(100);
      expect(mismatches).toEqual([]);
      expect(object(w, Study.Bookcase).isDoor).toBe(true);
      const mark = w.mark();
      w.act(Verb.Move, Study.Torch, 5_000);
      expect(w.voices(mark)).toEqual([]);
      expect(w.flags[Flag.Bookcase]).toBe(1);
    });
  });
});
