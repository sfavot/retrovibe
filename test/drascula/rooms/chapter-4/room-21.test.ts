import { describe, expect, it } from "vitest";
import { Flag, Item, Outside } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";
import { speech } from "./support";

/** Pièce 21, le pied du château : la porte, la corde, le mur (`room_21`, qui répond avant `roomActions` au chapitre 4). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le pied du château (pièce 21)", () => {
  it("le chapitre commence ici : objets de la fiche, inventaire de départ, porte condamnée", () => {
    const w = new Walkthrough({ chapter: 4 });
    expect(w.room).toBe(21);
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([100, 101, 141, 179, 173]);
    expect(w.state.inventory.filter((item) => item >= 7)).toEqual([28, 9, 20, 22]);
    expect(w.host.music[0]).toBe(8);
    // La porte du château (101) est fermée à clé : `updateDoor` ne la laisse pas franchir.
    const door = w.engine.room.objects[1];
    expect(door.isDoor).toBe(false);
    expect(w.state.hero.x).toBe(235);
    expect(w.state.hero.y).toBe(164);
  });

  it("ouvrir la porte sans la clé : « C'est fermé à clé » (419), rien ne bouge", () => {
    const w = new Walkthrough({ chapter: 4 });
    expect(speech(w, () => w.act(Verb.Open, Outside.Door))).toEqual(["419.als"]);
    expect(w.flags[Flag.DoorOutside]).toBe(0);
    expect(w.flags[Flag.OutsideUnlocked]).toBe(0);
    w.goTo(Outside.Door);
    expect(w.room).toBe(21);
  });

  it("fermer une porte déjà fermée : rien", () => {
    const w = new Walkthrough({ chapter: 4 });
    expect(speech(w, () => w.act(Verb.Close, Outside.Door))).toEqual([]);
  });

  it("la clé (7) sur la porte : elle se déverrouille et s'ouvre (son 3), on peut la franchir vers le hall", () => {
    const w = new Walkthrough({ chapter: 4 });
    w.engine.addObject(Item.Key);
    const mark = w.mark();
    w.useItem(Item.Key, Outside.Door);
    expect(w.voices(mark)).toEqual(["s3.als"]);
    expect(w.flags[Flag.OutsideUnlocked]).toBe(1);
    expect(w.flags[Flag.DoorOutside]).toBe(1);
    expect(w.state.takeObject).toBe(false);
    expect(w.engine.room.objects[1].isDoor).toBe(true);
    w.goTo(Outside.Door);
    expect(w.room).toBe(23);
    expect(w.state.objExit).toBe(103);
  });

  it("ouvrir puis fermer la porte déverrouillée : sons 3 et 4, la porte se condamne en se fermant", () => {
    const w = new Walkthrough({ chapter: 4 });
    w.flags[Flag.OutsideUnlocked] = 1;
    expect(speech(w, () => w.act(Verb.Open, Outside.Door))).toEqual([]);
    expect(w.flags[Flag.DoorOutside]).toBe(1);
    expect(w.engine.room.objects[1].isDoor).toBe(true);
    const mark = w.mark();
    w.act(Verb.Close, Outside.Door);
    expect(w.voices(mark)).toEqual(["s4.als"]);
    expect(w.flags[Flag.DoorOutside]).toBe(0);
    expect(w.engine.room.objects[1].isDoor).toBe(false);
  });

  it("prendre la corde (141) : l'objet 19 est en main, la corde disparaît de la pièce", () => {
    const w = new Walkthrough({ chapter: 4 });
    w.act(Verb.Pick, Outside.Rope);
    expect(w.state.pickedObject).toBe(Item.Rope);
    expect(w.flags[Flag.RopeTaken]).toBe(1);
    expect(w.engine.room.objects[2].visible).toBe(false);
    // Rangée dans l'inventaire par le verbe suivant ; au retour dans la pièce elle n'y est plus.
    w.selectVerb(Verb.None);
    expect(w.state.inventory).toContain(Item.Rope);
    w.goTo(100);
    expect(w.room).toBe(22);
    w.goTo(102);
    expect(w.room).toBe(21);
    expect(w.engine.room.objects[2].visible).toBe(false);
  });

  it("l'arbre (100) mène à la pièce 22, par la sortie 102 (la porte de la pièce 22)", () => {
    const w = new Walkthrough({ chapter: 4 });
    w.goTo(Outside.Tree);
    expect(w.room).toBe(22);
    expect(w.state.objExit).toBe(102);
  });

  it("le mur (179) sans le grappin : réponse par défaut du chapitre ; la porte 173 est un décor", () => {
    const w = new Walkthrough({ chapter: 4 });
    expect(speech(w, () => w.act(Verb.Look, Outside.Wall))).toEqual(["100.als"]);
    expect(speech(w, () => w.act(Verb.Pick, Outside.Wall))).toEqual(["11.als"]);
    expect(w.state.chapter).toBe(4);
    expect(speech(w, () => w.act(Verb.Talk, Outside.Gate))).toEqual(["16.als"]);
  });

  it("le grappin (21) sur le mur : la montée (st.bin) finit le chapitre 4, le chapitre 5 commence dans la pièce 45", () => {
    const w = new Walkthrough({ chapter: 4 });
    w.engine.addObject(Item.Grapnel);
    w.useItem(Item.Grapnel, Outside.Wall, 60_000);
    expect(w.state.chapter).toBe(5);
    expect(w.room).toBe(45);
  });

  it("un autre objet sur le mur : réponse par défaut (la corde n'est pas le grappin)", () => {
    const w = new Walkthrough({ chapter: 4 });
    w.engine.addObject(Item.Rope);
    expect(speech(w, () => w.useItem(Item.Rope, Outside.Wall))).toEqual(["11.als"]);
    expect(w.state.chapter).toBe(4);
  });
});
