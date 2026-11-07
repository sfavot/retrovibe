import { describe, expect, it } from "vitest";
import { CoffinRoom, Crypt, Flag, Item, Laboratory, Office, Room, Towers, Workshop } from "../../../../src/games/drascula/engine/rooms/chapter-5/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { solveChapter5 } from "../../solutions";
import { Walkthrough } from "../../walkthrough";

/**
 * Passage du chapitre 5 : la solution jouée à la souris, du pied des tours du château jusqu'au début du chapitre 6.
 * Solution : l'os du squelette (crypte, tour 2) pour chasser le loup-garou (bureau, tour 3) ; la vis (atelier, tour 4) et le cerveau
 * (inventaire) pour Frankenstein, la fiche du laboratoire (tour 1) branchée à la prise, l'interrupteur ; puis le couloir et le cercueil.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 5 : passage", () => {
  it("la solution : on arrive à la pièce 58 du chapitre 6", () => {
    const w = new Walkthrough({ chapter: 5 });
    expect(w.room).toBe(Room.Towers);
    solveChapter5(w);
  });

  it("la partie complète : on parle au squelette et à B.J., on tente la porte piégée, puis on passe", () => {
    const w = new Walkthrough({ chapter: 5 });
    // La crypte : le squelette (menu 10), l'os, B.J. (scène puis menu 8, l'épingle), le cadenas.
    w.goTo(Towers.Tower2);
    w.goTo(113);
    w.selectVerb(Verb.Talk);
    const skeleton = w.pointOf(Crypt.Skeleton);
    w.player.click(skeleton.x, skeleton.y);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(3)).toBe(false);
    w.settle();
    w.act(Verb.Pick, Crypt.Bone);
    w.selectVerb(Verb.Talk);
    const cell = w.pointOf(Crypt.Cell);
    w.player.click(cell.x, cell.y);
    expect(w.choose(2)).toBe(false);
    w.settle();
    expect(w.state.pickedObject).toBe(Item.Pin);
    w.useItem(Item.Pin, Crypt.Padlock);
    expect(w.state.inventory).not.toContain(Item.Pin);
    // Le loup-garou : on lui parle d'abord, puis l'os sur la fenêtre.
    w.goTo(Crypt.Door);
    w.goTo(108);
    w.goTo(Towers.Tower3, 60_000);
    w.selectVerb(Verb.Talk);
    const wolf = w.pointOf(Office.Werewolf);
    w.player.click(wolf.x, wolf.y);
    expect(w.choose(1)).toBe(true);
    expect(w.choose(3)).toBe(false);
    w.settle();
    w.useItem(Item.Bone, Office.Window, 60_000);
    expect(w.flags[Flag.WerewolfGone]).toBe(1);
    // L'atelier : la porte piégée, puis la vis.
    w.goTo(Office.DoorRight);
    expect(w.room).toBe(Room.Towers);
    w.goTo(Towers.Tower4);
    w.goTo(114);
    w.act(Verb.Look, Workshop.TrappedDoor);
    expect(w.room).toBe(Room.Workshop);
    w.act(Verb.Pick, Workshop.Screw);
    // Le laboratoire : sans la fiche, rien ne se passe ; avec tout, Frankenstein sort.
    w.goTo(Workshop.Door);
    w.goTo(111);
    w.goTo(Towers.Tower1);
    w.goTo(112);
    w.useItem(Item.Screw, Laboratory.Frankenstein);
    w.useItem(Item.Brain, Laboratory.Frankenstein);
    w.act(Verb.Move, Laboratory.Switch);
    expect(w.room).toBe(Room.Laboratory);
    w.act(Verb.Pick, Laboratory.FloorPlug);
    const socket = w.pointOf(Laboratory.Socket);
    w.clickAt(socket.x, socket.y);
    w.act(Verb.Move, Laboratory.Switch, 60_000);
    expect(w.room).toBe(Room.Corridor);
    w.goTo(104);
    w.act(Verb.Look, CoffinRoom.Coffin);
    w.selectVerb(Verb.Open);
    const coffin = w.pointOf(CoffinRoom.Coffin);
    w.player.click(coffin.x, coffin.y);
    w.until(() => w.state.chapter === 6 && w.room === 58, 60_000);
  });

  it("Échap pendant les cinématiques du laboratoire ne coupe que la vidéo en cours : le héros arrive quand même dans le couloir", () => {
    const w = new Walkthrough({ chapter: 5 });
    w.engine.addObject(Item.Screw);
    w.goTo(Towers.Tower1);
    w.goTo(112);
    w.useItem(Item.Screw, Laboratory.Frankenstein);
    w.useItem(Item.Brain, Laboratory.Frankenstein);
    w.act(Verb.Pick, Laboratory.FloorPlug);
    const socket = w.pointOf(Laboratory.Socket);
    w.clickAt(socket.x, socket.y);
    w.selectVerb(Verb.Move);
    const flip = w.pointOf(Laboratory.Switch);
    w.player.click(flip.x, flip.y);
    for (let tick = 0; tick < 60_000 && w.room === Room.Laboratory; tick++) {
      if (tick % 25 === 0) w.key("Escape");
      w.wait(1);
    }
    w.settle(60_000);
    expect(w.room).toBe(Room.Corridor);
    expect(w.flags[Flag.FrankensteinAwake]).toBe(1);
  });
});
