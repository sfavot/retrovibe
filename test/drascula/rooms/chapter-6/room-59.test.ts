import { describe, expect, it } from "vitest";
import { Bedroom, Corridor, Flag } from "../../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { startInCorridor } from "./start";

/** Pièce 59, la chambre de B.J. : l'entrée par la porte dérobée, B.J., le téléphone, les portes. */
describe.skipIf(!hasOriginalFiles)("chapitre 6 : la chambre de B.J. (pièce 59)", () => {
  const enter = () => {
    const w = startInCorridor();
    w.act(Verb.Move, Corridor.Torch);
    w.selectVerb(Verb.None);
    w.goTo(Corridor.SecretDoor);
    expect(w.room).toBe(59);
    return w;
  };

  it("on y arrive par la porte dérobée : quelqu'un surgit de l'armoire, la porte claque (animation_19_6)", () => {
    const w = startInCorridor();
    w.act(Verb.Move, Corridor.Torch);
    w.selectVerb(Verb.None);
    const mark = w.mark();
    const { x, y } = w.pointOf(Corridor.SecretDoor);
    w.player.click(x, y);
    // La silhouette de l'armoire est dessinée, puis retirée ; le son 4 (la porte) est joué.
    w.until(() => w.state.anim.wardrobe === 1);
    w.engine.render();
    const { screen, draw3 } = w.engine.gfx;
    let same = 0;
    for (let dy = 0; dy < 80; dy += 7) for (let dx = 0; dx < 35; dx += 5) if (screen.at(161 + dx, 69 + dy) === draw3.at(140 + dx, 23 + dy)) same++;
    expect(same).toBeGreaterThan(30);
    w.settle();
    expect(w.state.anim.wardrobe).toBe(0);
    expect(w.voices(mark)).toContain("s4.als");
    expect(w.host.music.at(-1)).toBe(24);
  });

  it("les objets sont ceux de la fiche ; l'armoire (porte vers le couloir) est condamnée", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([51, 105, 106, 107, 108]);
    expect(w.engine.room.objects[1].isDoor).toBe(false);
    const mark = w.mark();
    w.goTo(Bedroom.Wardrobe);
    expect(w.room).toBe(59);
    expect(w.voices(mark)).toEqual([]);
  });

  it("la porte 108 mène à la taverne (pièce 60, sortie 109)", () => {
    const w = enter();
    w.goTo(Bedroom.Door);
    expect(w.room).toBe(60);
    expect(w.state.objExit).toBe(109);
  });

  it("les objets sans réponse propre : les excuses tournantes du chapitre", () => {
    const w = enter();
    const mark = w.mark();
    w.act(Verb.Look, Bedroom.Chest);
    w.act(Verb.Look, Bedroom.Mirror);
    w.act(Verb.Pick, Bedroom.Chest);
    w.act(Verb.Open, Bedroom.Chest);
    expect(w.voices(mark)).toEqual(["100.als", "101.als", "11.als", "9.als"]);
  });

  it("parler à B.J. : son dialogue, puis le téléphone sonne ; Von Braun explique la potion ; le drapeau 11 retient la conversation", () => {
    const w = enter();
    const mark = w.mark();
    w.selectVerb(Verb.Talk);
    const { x, y } = w.pointOf(Bedroom.BJ);
    w.player.click(x, y);
    w.until(() => w.flags[Flag.BJTalking] === 1);
    // B.J. a parlé, la tête reste refaite par-dessus le décor (`update_59_pre`).
    w.until(() => w.voices(mark).includes("bj14.als") && !w.host.soundActive()); // la pause (40) entre deux répliques : pas de sous-titre sur la tête
    w.player.move(319, 199); // le curseur n'est pas sur la tête
    w.wait(2);
    w.engine.render();
    const { screen, draw3 } = w.engine.gfx;
    let compared = 0;
    for (let dy = 0; dy < 38; dy += 3) {
      for (let dx = 0; dx < 49; dx += 3) {
        const source = draw3.at(1 + dx, 105 + dy);
        if (source === 255) continue;
        expect(screen.at(65 + dx, 103 + dy)).toBe(source);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
    // Le téléphone : l'écran de la conversation (TLEF0) remplace la chambre, sans ses décors animés.
    w.until(() => w.voices(mark).includes("240.als"));
    w.engine.render();
    expect(w.engine.gfx.roomSprites).toBe(false);
    const phone = w.engine.gfx;
    for (let x = 0; x < 320; x += 13) expect(phone.screen.at(x, 185), `x=${x}`).toBe(phone.bg.at(x, 185));
    w.settle(60_000);
    expect(w.flags[Flag.BJTalking]).toBe(0);
    expect(w.flags[Flag.PhoneCalled]).toBe(1);
    const spoken = w.voices(mark);
    expect(spoken).toEqual([
      "259.als", "bj13.als", "263.als", "bj14.als", "264.als", "bj15.als", "265.als",
      "s12.als", "s12.als",
      "240.als", "vb58.als", "241.als", "vb59.als", "242.als", "vb60.als", "196.als", "vb61.als", "244.als", "vb62.als",
      "245.als",
    ]);
    // La chambre est remise telle quelle : décor, feuilles et palette de la pièce.
    expect(w.engine.gfx.roomSprites).toBe(true);
    expect(w.state.takeObject).toBe(false); // `selectVerb(kVerbNone)` à la fin de la conversation
    expect(w.hero.visible).toBe(true);
    expect(w.hero.track).toBe(3);
  });

  it("le téléphone ne sonne qu'une fois : la seconde conversation avec B.J. s'arrête à sa dernière réplique ; la regarder fait la même chose", () => {
    const w = enter();
    w.act(Verb.Talk, Bedroom.BJ, 60_000);
    expect(w.flags[Flag.PhoneCalled]).toBe(1);
    const mark = w.mark();
    w.act(Verb.Look, Bedroom.BJ, 60_000);
    expect(w.voices(mark)).toEqual(["259.als", "bj13.als", "263.als", "bj14.als", "264.als", "bj15.als", "265.als"]);
  });

  it("une autre action sur B.J. : la réponse par défaut", () => {
    const w = enter();
    const mark = w.mark();
    w.act(Verb.Open, Bedroom.BJ);
    expect(w.voices(mark)).toEqual(["9.als"]);
    expect(w.flags[Flag.PhoneCalled]).toBe(0);
  });

  it("le dessin : le lit (roomPreUpdates, drapeau 4 bas) est copié en (65, 106)", () => {
    const w = enter();
    w.player.move(319, 199);
    w.wait(40);
    w.engine.render();
    const { screen, draw3 } = w.engine.gfx;
    let compared = 0;
    for (let dy = 0; dy < 40; dy += 4) {
      for (let dx = 0; dx < 83; dx += 5) {
        const source = draw3.at(1 + dx, 146 + dy);
        if (source === 255) continue;
        expect(screen.at(65 + dx, 106 + dy)).toBe(source);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});
