import { describe, expect, it } from "vitest";
import { Corridor, Flag } from "../../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { startChapter6, startInCorridor } from "./start";

/** Pièce 58, le couloir du début du chapitre 6 : la torche, la porte dérobée, le dessin. */
describe.skipIf(!hasOriginalFiles)("chapitre 6 : le couloir (pièce 58)", () => {
  it("les objets sont ceux de la fiche, la porte dérobée est fermée, la musique est celle de la pièce", () => {
    const w = startInCorridor();
    expect(w.room).toBe(58);
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([103, 104]);
    expect(w.engine.room.objects[1].isDoor).toBe(false);
    expect(w.host.music[0]).toBe(4);
  });

  it("regarder la porte dérobée : la réplique 454 (roomActions) ; la torche : la réponse par défaut", () => {
    const w = startInCorridor();
    let mark = w.mark();
    w.act(Verb.Look, Corridor.SecretDoor);
    expect(w.voices(mark)).toEqual(["454.als"]);
    mark = w.mark();
    w.act(Verb.Look, Corridor.Torch);
    expect(w.voices(mark)).toEqual(["100.als"]);
  });

  it("la porte dérobée est fermée : on ne passe pas, il n'y a ni parole ni son", () => {
    const w = startInCorridor();
    const mark = w.mark();
    w.goTo(Corridor.SecretDoor);
    expect(w.room).toBe(58);
    expect(w.voices(mark)).toEqual([]);
  });

  it("pousser la torche (103) ouvre la porte dérobée, sans un mot ; ouvrir la torche ne fait rien de plus", () => {
    const w = startInCorridor();
    const mark = w.mark();
    w.act(Verb.Move, Corridor.Torch);
    expect(w.flags[Flag.TorchMoved]).toBe(1);
    expect(w.voices(mark)).toEqual([]);
    expect(w.engine.room.objects[1].isDoor).toBe(true);
    expect(w.state.pickedObject).toBe(Verb.Move);
  });

  it("une autre action sur la torche : la réponse par défaut du chapitre, le drapeau reste bas", () => {
    const w = startInCorridor();
    const mark = w.mark();
    w.act(Verb.Pick, Corridor.Torch);
    expect(w.flags[Flag.TorchMoved]).toBe(0);
    expect(w.voices(mark)).toEqual(["11.als"]);
  });

  it("la porte dérobée ouverte mène à la chambre de B.J. (pièce 59, sortie 105)", () => {
    const w = startInCorridor();
    w.act(Verb.Move, Corridor.Torch);
    w.selectVerb(Verb.None);
    w.goTo(Corridor.SecretDoor);
    expect(w.room).toBe(59);
    expect(w.state.objExit).toBe(105);
  });

  it("le dessin : la porte ouverte (feuille annexe, 20 / 60) apparaît à (30, 64) quand la torche a été poussée", () => {
    const w = startInCorridor();
    w.player.move(319, 199);
    w.wait(40);
    const compare = () => {
      w.engine.render();
      const { screen, draw3 } = w.engine.gfx;
      let same = 0;
      for (let dy = 0; dy < 95; dy += 4) for (let dx = 0; dx < 46; dx += 3) if (screen.at(30 + dx, 64 + dy) === draw3.at(20 + dx, 60 + dy)) same++;
      return same;
    };
    const closed = compare();
    w.flags[Flag.TorchMoved] = 1;
    expect(compare()).toBeGreaterThan(closed);
    expect(compare()).toBe(Math.ceil(95 / 4) * Math.ceil(46 / 3));
  });

  it("Igor et Drascula sont dessinés tant que le drapeau 2 est bas, et plus ensuite", () => {
    const w = startInCorridor();
    w.player.move(319, 199);
    w.wait(40);
    const drawn = () => {
      w.engine.render();
      const { screen } = w.engine.gfx;
      const key: number[] = [];
      for (let y = 0; y < 77; y += 2) for (let x = 0; x < 45; x += 2) key.push(screen.at(62 + x, 99 + y));
      return key.join(",");
    };
    w.engine.state.drascula.x = 62;
    w.engine.state.drascula.y = 99;
    const before = drawn();
    w.flags[Flag.CorridorEmpty] = 1;
    expect(drawn()).not.toBe(before);
  });

  it("le pendule décroché : à la fin de la cinématique du cachot, le couloir est vide et le héros libre (voir le cachot)", () => {
    const w = startChapter6();
    expect(w.room).toBe(102);
    expect(w.flags[Flag.ChainLowered]).toBe(1);
  });
});
