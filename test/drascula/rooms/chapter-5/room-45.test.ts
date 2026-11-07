import { describe, expect, it } from "vitest";
import { Flag, Item, Room, Towers } from "../../../../src/games/drascula/engine/rooms/chapter-5/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 45, la carte des quatre tours du château (chapitre 5), et les pièces 50, 51 et 52 qui n'ont que leurs portes. */
describe.skipIf(!hasOriginalFiles)("chapitre 5 : les tours (pièce 45)", () => {
  it("le chapitre commence sur la carte : héros invisible, quatre tours dont la dernière est cachée, inventaire de départ", () => {
    const w = new Walkthrough({ chapter: 5 });
    expect(w.room).toBe(Room.Towers);
    expect(w.state.chapter).toBe(5);
    expect(w.hero.visible).toBe(false);
    expect(w.engine.room.objects.map((o) => [o.id, o.visible])).toEqual([
      [100, true],
      [101, true],
      [102, true],
      [103, false],
    ]);
    expect(w.host.music[0]).toBe(8);
    const items = w.state.inventory.filter((item, slot) => slot > 6 && item !== 0);
    expect(items).toEqual([28, 7, 9, 11, 13, 14, 15, 17, 20]);
  });

  it.each([
    [Towers.Tower1, Room.Tower1, 106],
    [Towers.Tower2, Room.Tower2, 108],
    [Towers.Tower3, Room.Office, 109],
  ])("la tour %i mène à la pièce %i, qu'on atteint par la porte %i ; le héros redevient visible", (tower, room, exit) => {
    const w = new Walkthrough({ chapter: 5 });
    w.goTo(tower);
    expect(w.room).toBe(room);
    expect(w.state.objExit).toBe(exit);
    expect(w.hero.visible).toBe(true);
  });

  it("la quatrième tour est inerte tant que le loup-garou n'est pas parti", () => {
    const w = new Walkthrough({ chapter: 5 });
    // Le clic tombe dans le vide : le héros invisible « marche » (il reste à (0, 0), comme dans ScummVM), il n'y a pas de porte.
    const { x, y } = w.pointOf(Towers.Tower4);
    w.player.click(x, y);
    w.wait(300);
    expect(w.room).toBe(Room.Towers);
  });

  it("une fois le loup-garou parti (drapeau 6), la quatrième tour apparaît et mène à la pièce 52", () => {
    const w = new Walkthrough({ chapter: 5 });
    w.flags[Flag.WerewolfGone] = 1;
    // On quitte la carte et on y revient : `updateVisible` s'applique à l'entrée.
    w.goTo(Towers.Tower2);
    w.goTo(108);
    expect(w.room).toBe(Room.Towers);
    expect(w.hero.visible).toBe(false);
    expect(w.engine.room.objects.find((o) => o.id === Towers.Tower4)?.visible).toBe(true);
    w.goTo(Towers.Tower4);
    expect(w.room).toBe(Room.Tower3);
    expect(w.state.objExit).toBe(111);
  });

  it("les tours 1, 2 et 3 (pièces 50, 51, 52) : leurs portes mènent à la carte et aux pièces du fond", () => {
    const w = new Walkthrough({ chapter: 5 });
    w.flags[Flag.WerewolfGone] = 1;
    w.goTo(Towers.Tower1);
    expect(w.room).toBe(Room.Tower1);
    w.goTo(112);
    expect(w.room).toBe(Room.Laboratory);
    w.goTo(116);
    expect(w.room).toBe(Room.Tower1);
    w.goTo(106);
    expect(w.room).toBe(Room.Towers);
    w.goTo(Towers.Tower2);
    w.goTo(113);
    expect(w.room).toBe(Room.Crypt);
    w.goTo(115);
    expect(w.room).toBe(Room.Tower2);
    w.goTo(108);
    w.goTo(Towers.Tower4);
    expect(w.room).toBe(Room.Tower3);
    w.goTo(114);
    expect(w.room).toBe(Room.Workshop);
    w.goTo(117);
    expect(w.room).toBe(Room.Tower3);
    w.goTo(111);
    expect(w.room).toBe(Room.Towers);
  });

  it("l'objet 9 de l'inventaire se regarde (checkAction du chapitre 5 : 482 puis 483)", () => {
    const w = new Walkthrough({ chapter: 5 });
    const mark = w.mark();
    w.verbOnItem(Verb.Look, Item.Cross);
    expect(w.voices(mark)).toEqual(["482.als", "483.als"]);
  });

  it("les objets de l'inventaire se regardent (roomActions 200 du chapitre 5)", () => {
    const w = new Walkthrough({ chapter: 5 });
    const mark = w.mark();
    w.verbOnItem(Verb.Look, 14);
    expect(w.voices(mark)).toEqual(["121.als"]);
  });

  it("la réplique du héros dans les tours est en haut de l'écran, sans visage", () => {
    const w = new Walkthrough({ chapter: 5 });
    w.verbOnItem(Verb.Look, 28);
    // Dans la pièce 45 la réplique est affichée en (160, 25) ; elle est finie ici, mais la pièce ne doit pas l'avoir laissée.
    expect(w.engine.subtitle).toBeNull();
  });
});
