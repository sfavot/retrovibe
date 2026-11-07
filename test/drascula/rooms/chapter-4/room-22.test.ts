import { describe, expect, it } from "vitest";
import { Flag, Item, Tree } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Track, Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { speech, startIn } from "./support";

/** Pièce 22, l'arbre : la pie, la clé, la branche (`room_22`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : l'arbre (pièce 22)", () => {
  const enter = (flags: Record<number, number> = {}, items: readonly number[] = []) => startIn(22, { exit: Tree.Exit, flags, items });
  const visible = (w: ReturnType<typeof enter>, id: number) => w.engine.room.objects.find((o) => o.id === id)!.visible;

  it("objets de la fiche : la branche est cachée tant que la pie n'est pas tombée", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([102, 140, 52, 180]);
    expect(visible(w, Tree.Branch)).toBe(false);
    expect(visible(w, Tree.Magpie)).toBe(true);
    expect(visible(w, Tree.Key)).toBe(true);
    expect(w.host.music.at(-1)).toBe(8);
  });

  it("regarder (497) et parler à la pie (498) : roomActions", () => {
    const w = enter();
    expect(speech(w, () => w.act(Verb.Look, Tree.Magpie))).toEqual(["497.als"]);
    expect(speech(w, () => w.act(Verb.Talk, Tree.Magpie))).toEqual(["498.als"]);
  });

  it("prendre la clé avant que la pie soit tombée : elle pourrait arracher un oeil (420)", () => {
    const w = enter();
    expect(speech(w, () => w.act(Verb.Pick, Tree.Key))).toEqual(["420.als"]);
    expect(w.flags[Flag.KeyTaken]).toBe(0);
    expect(w.state.takeObject).toBe(true); // le verbe reste en main
    expect(w.state.inventory).not.toContain(Item.Key);
  });

  describe("la pièce de monnaie (22) sur la pie (52)", () => {
    it("up.bin, la chute (son 1, hoquet), puis les deux répliques ; la pie disparaît et la branche apparaît", () => {
      const w = enter();
      const mark = w.mark();
      w.useItem(Item.Coin, Tree.Magpie, 60_000);
      expect(w.voices(mark)).toEqual(["s1.als", "499.als", "500.als"]);
      expect(w.flags[Flag.MagpieDown]).toBe(1);
      expect(w.state.inventory).not.toContain(Item.Coin);
      expect(w.state.takeObject).toBe(false);
      expect(w.state.hero.track).toBe(Track.Down);
      expect(visible(w, Tree.Magpie)).toBe(false);
      expect(visible(w, Tree.Branch)).toBe(true);
      expect(w.engine.gfx.shake).toBeNull(); // le hoquet a remis l'écran en place
      expect(w.engine.gfx.owner).toBe("room");
    });

    it("la clé se prend ensuite : l'objet 7 en main, la clé disparaît (drapeau 27)", () => {
      const w = enter({ [Flag.MagpieDown]: 1 });
      expect(speech(w, () => w.act(Verb.Pick, Tree.Key))).toEqual([]);
      expect(w.state.pickedObject).toBe(Item.Key);
      expect(w.flags[Flag.KeyTaken]).toBe(1);
      expect(visible(w, Tree.Key)).toBe(false);
    });

    it("à l'entrée suivante : pas de pie, pas de clé si elle est prise", () => {
      const w = enter({ [Flag.MagpieDown]: 1, [Flag.KeyTaken]: 1 });
      expect(visible(w, Tree.Magpie)).toBe(false);
      expect(visible(w, Tree.Branch)).toBe(true);
      expect(visible(w, Tree.Key)).toBe(false);
    });
  });

  describe("la branche (140)", () => {
    it("à la main, elle ne se prend pas (réplique 7 de roomActions)", () => {
      const w = enter({ [Flag.MagpieDown]: 1 });
      expect(speech(w, () => w.act(Verb.Pick, Tree.Branch))).toEqual(["7.als"]);
      expect(w.flags[Flag.BranchCut]).toBe(0);
    });

    it("la hache (11) la coupe : la branche coupée (18) est en main, drapeau 24", () => {
      const w = enter({ [Flag.MagpieDown]: 1 }, [Item.Axe]);
      expect(speech(w, () => w.useItem(Item.Axe, Tree.Branch))).toEqual([]);
      expect(w.state.pickedObject).toBe(Item.Branch);
      expect(w.flags[Flag.BranchCut]).toBe(1);
      expect(visible(w, Tree.Branch)).toBe(false);
      expect(w.state.inventory).toContain(Item.Axe); // la hache n'est jamais retirée
    });

    it("la hache sur la branche invisible (pie debout) : rien ne se passe", () => {
      const w = enter({}, [Item.Axe]);
      const before = w.flags.slice();
      w.takeItem(Item.Axe);
      const object = w.engine.room.objects.find((o) => o.id === Tree.Branch)!;
      w.clickAt(object.rect.x1 + 2, object.rect.y1 + 2);
      expect(w.flags).toEqual(before);
    });

    it("écart hérité de ScummVM : rentrer dans la pièce après la coupe remontre la branche (la pie est tombée)", () => {
      const w = enter({ [Flag.MagpieDown]: 1, [Flag.BranchCut]: 1 });
      expect(visible(w, Tree.Branch)).toBe(true);
    });
  });

  it("la sortie 102 ramène au pied du château, par la porte de l'arbre (100)", () => {
    const w = enter();
    w.goTo(Tree.Exit);
    expect(w.room).toBe(21);
    expect(w.state.objExit).toBe(100);
  });

  it("un objet sans effet sur la pie : réponse par défaut", () => {
    const w = enter();
    expect(speech(w, () => w.useItem(Item.Cross, Tree.Magpie))).toEqual(["11.als"]);
  });
});
