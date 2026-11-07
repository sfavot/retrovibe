import { describe, expect, it } from "vitest";
import { Anim, Bedroom, Flag, Item } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Track, Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { comparedPixels, render, repaint, speech, startIn } from "./support";

/** Pièce 26, la chambre d'Igor : la porte, Igor (`animation_1_4`, conversation 6), la perruque, le clignement (`update_26_pre`). */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : la chambre d'Igor (pièce 26)", () => {
  const enter = (flags: Record<number, number> = {}, items: readonly number[] = []) =>
    startIn(26, { exit: Bedroom.Door, flags: { [Flag.DoorBedroom]: 1, ...flags }, items });
  type Room = ReturnType<typeof enter>;
  const object = (w: Room, id: number) => w.engine.room.objects.find((o) => o.id === id)!;

  it("objets de la fiche ; la porte 107 est ouverte ; Igor est là et s'appelle « bossu » tant qu'on ne l'a pas rencontré", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([107, 143, 51, 163, 164, 165, 167, 168, 169]);
    expect(object(w, Bedroom.Door).isDoor).toBe(true);
    expect(object(w, Bedroom.Igor).visible).toBe(true);
    expect(object(w, Bedroom.Igor).name).toBe("BOSSU");
    expect(object(w, Bedroom.Wig).visible).toBe(true);
    expect(w.host.music.at(-1)).toBe(25);
    expect(w.state.savedTime).toBeGreaterThan(0);
  });

  it("Igor déjà rencontré : la pièce garde le nom de la fiche (« igor »), le surnom « bossu » n'est posé que tant qu'il est inconnu", () => {
    const w = enter({ [Flag.IgorMet]: 1 });
    expect(object(w, Bedroom.Igor).name).toBe("IGOR");
  });

  it("Igor n'est plus là quand le héros a réuni frites, farine et cape (drapeau 18) ; la perruque prise a disparu", () => {
    const w = enter({ [Flag.Ready]: 1, [Flag.WigTaken]: 1 });
    expect(object(w, Bedroom.Igor).visible).toBe(false);
    expect(object(w, Bedroom.Wig).visible).toBe(false);
  });

  it.each([
    [Verb.Look, 164, "470.als"],
    [Verb.Open, 164, "471.als"],
    [Verb.Look, 163, "472.als"],
    [Verb.Pick, 163, "473.als"],
    [Verb.Look, 165, "474.als"],
    [Verb.Look, 168, "476.als"],
    [Verb.Pick, 168, "477.als"],
    [Verb.Open, 167, "467.als"],
  ])("verbe %i sur l'objet %i : roomActions (%s)", (verb, id, voice) => {
    const w = enter();
    expect(speech(w, () => w.act(verb, id))).toEqual([voice]);
  });

  describe("la porte 107", () => {
    it("se ferme (son 4) et se rouvre (son 3) ; fermée, on ne peut pas sortir", () => {
      const w = enter();
      let mark = w.mark();
      w.act(Verb.Close, Bedroom.Door);
      expect(w.voices(mark)).toEqual(["s4.als"]);
      expect(object(w, Bedroom.Door).isDoor).toBe(false);
      w.goTo(Bedroom.Door);
      expect(w.room).toBe(26);
      mark = w.mark();
      w.act(Verb.Open, Bedroom.Door);
      expect(w.voices(mark)).toEqual(["s3.als"]);
      w.goTo(Bedroom.Door);
      expect(w.room).toBe(24);
      expect(w.state.objExit).toBe(106);
    });

    it("Igor l'a fermée à clé (drapeau 30) : « Mon Dieu, c'est verrouillé » (421)", () => {
      const w = enter({ [Flag.DoorBedroom]: 0, [Flag.BedroomLocked]: 1 });
      expect(speech(w, () => w.act(Verb.Open, Bedroom.Door))).toEqual(["421.als"]);
      expect(w.flags[Flag.DoorBedroom]).toBe(0);
    });
  });

  describe("parler à Igor (animation_1_4)", () => {
    it("la première fois : « Bonsoir », il se lève (deux poses), se présente (trois répliques), puis la conversation 6", () => {
      const w = enter();
      const mark = w.mark();
      w.selectVerb(Verb.Talk);
      const at = w.pointOf(Bedroom.Igor);
      w.player.click(at.x, at.y);
      w.until(() => w.state.anim[Anim.IgorPose] === 1);
      expect(w.flags[Flag.Ready]).toBe(0);
      w.until(() => w.state.anim[Anim.IgorPose] === 2);
      w.waitForChoices();
      // Pendant la conversation : Igor est debout, la pièce n'est pas dans l'état « prêt à quitter ».
      expect(w.flags[Flag.Ready]).toBe(1);
      expect(w.flags[Flag.IgorStanding]).toBe(1);
      expect(w.flags[Flag.IgorMet]).toBe(1);
      expect(w.state.anim[Anim.IgorPose]).toBe(0);
      expect(object(w, Bedroom.Igor).name).toBe("igor");
      expect(w.voices(mark)).toEqual(["275.als", "i13.als", "i14.als", "i15.als"]);
      // Le quatrième choix quitte la conversation : tout est remis en place.
      expect(w.choose(3)).toBe(false);
      w.settle();
      expect(w.flags[Flag.Ready]).toBe(0);
      expect(w.flags[Flag.IgorStanding]).toBe(0);
      expect(w.state.anim[Anim.IgorPose]).toBe(0);
    });

    it("la conversation 6 : chaque choix est dit puis suivi de la réponse d'Igor", () => {
      const w = enter({ [Flag.IgorMet]: 1 });
      const mark = w.mark();
      w.selectVerb(Verb.Talk);
      const igor = w.pointOf(Bedroom.Igor);
      w.player.click(igor.x, igor.y);
      w.waitForChoices();
      const phrases = w.engine.choices!.phrases;
      expect(phrases).toHaveLength(4);
      expect(w.choose(0)).toBe(true);
      expect(w.choose(3)).toBe(false);
      w.settle();
      expect(w.voices(mark).length).toBeGreaterThan(5);
    });

    it("les fois suivantes : « Hem ! » (356), il se lève, « Comme ça va, Igor ? » (276), sa réplique 6, puis la conversation", () => {
      const w = enter({ [Flag.IgorMet]: 1 });
      const mark = w.mark();
      w.selectVerb(Verb.Talk);
      const igor = w.pointOf(Bedroom.Igor);
      w.player.click(igor.x, igor.y);
      w.waitForChoices();
      expect(w.voices(mark)).toEqual(["356.als", "276.als", "i6.als"]);
      expect(w.flags[Flag.Ready]).toBe(1);
      expect(w.flags[Flag.IgorStanding]).toBe(1);
      w.choose(3);
      w.settle();
      expect(w.flags[Flag.Ready]).toBe(0);
    });
  });

  describe("la perruque (143)", () => {
    it("Igor est là : le héros va vers elle, Igor la défend (« N'y pense même pas ! », i25), le héros revient", () => {
      const w = enter();
      const mark = w.mark();
      w.selectVerb(Verb.Pick);
      const at = w.pointOf(Bedroom.Wig);
      w.player.click(at.x, at.y);
      w.until(() => w.state.anim[Anim.WigGuard] === 1);
      w.settle();
      expect(w.voices(mark)).toEqual(["i25.als"]);
      expect(w.state.anim[Anim.WigGuard]).toBe(0);
      expect(w.flags[Flag.WigTaken]).toBe(0);
      expect(object(w, Bedroom.Wig).visible).toBe(true);
      expect(Math.abs(w.hero.x + Math.trunc(w.hero.width / 2) - 153)).toBeLessThanOrEqual(8); // revenu vers la porte (153, 180)
    });

    it("Igor est parti : le héros la prend, la porte se ferme (son 4), Igor la ferme à clé (i27, i28)", () => {
      const w = enter({ [Flag.Ready]: 1 });
      const mark = w.mark();
      w.act(Verb.Pick, Bedroom.Wig);
      expect(w.voices(mark)).toEqual(["s4.als", "i27.als", "i28.als"]);
      expect(w.flags[Flag.WigTaken]).toBe(1);
      expect(w.flags[Flag.BedroomLocked]).toBe(1);
      expect(w.flags[Flag.DoorBedroom]).toBe(0);
      expect(object(w, Bedroom.Door).isDoor).toBe(false);
      expect(object(w, Bedroom.Wig).visible).toBe(false);
      expect(w.state.inventory).toContain(Item.Wig);
      expect(w.state.hero.track).not.toBe(Track.Up); // il a ensuite marché vers (153, 180)
      // Enfermé : la porte ne se rouvre pas.
      expect(speech(w, () => w.act(Verb.Open, Bedroom.Door))).toEqual(["421.als"]);
      w.goTo(Bedroom.Door);
      expect(w.room).toBe(26);
    });
  });

  describe("le dessin (update_26_pre, update_26)", () => {
    it("le clignement est tiré toutes les 100 ms (valeur de 0 à 10) tant que la pièce est affichée", () => {
      const w = enter();
      const seen = new Set<number>();
      const changes: number[] = [];
      let previous = w.state.savedTime;
      for (let i = 0; i < 600; i++) {
        w.wait(1);
        seen.add(w.state.anim[Anim.Blinking] ?? 0);
        if (w.state.savedTime !== previous) changes.push(w.engine.ticks);
        previous = w.state.savedTime;
      }
      expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...seen)).toBeLessThanOrEqual(10);
      expect(seen.size).toBeGreaterThan(5);
      expect(new Set(changes.slice(1).map((tick, i) => tick - changes[i]))).toEqual(new Set([10]));
    });

    it("l'oeil d'Igor fermé (image 5) est recopié en (226, 106) ; plus quand Igor est parti", () => {
      const w = enter();
      w.hero.x = 20;
      render(w);
      w.state.anim[Anim.Blinking] = 5;
      let gfx = repaint(w);
      expect(comparedPixels(gfx, gfx.draw3, [52, 172, 226, 106, 3, 4], true, 1).mismatches).toEqual([]);
      // Igor parti (drapeau 18) : le dessin d'Igor au repos disparaît (roomPreUpdates) et l'oeil aussi.
      w.flags[Flag.Ready] = 1;
      gfx = repaint(w);
      expect(comparedPixels(gfx, gfx.draw3, [52, 172, 226, 106, 3, 4], true, 1).mismatches.length).toBeGreaterThan(0);
    });

    it("Igor debout (drapeau 20) et sa pose intermédiaire sont recopiés en (199, 95)", () => {
      const w = enter();
      w.hero.x = 20;
      w.flags[Flag.IgorStanding] = 1;
      const gfx = render(w);
      const standing = comparedPixels(gfx, gfx.draw3, [182, 133, 199, 95, 50, 66], true, 4);
      expect(standing.compared).toBeGreaterThan(100);
      expect(standing.mismatches).toEqual([]);
      w.flags[Flag.IgorStanding] = 0;
      w.state.anim[Anim.IgorPose] = 1;
      const rising = render(w);
      expect(comparedPixels(rising, rising.draw3, [131, 133, 199, 95, 50, 66], true, 4).mismatches).toEqual([]);
    });

    it("le héros déguisé (feuille anh_dr.alg, drapeau 29) est dessiné à la place du héros, le premier plan par-dessus", () => {
      const w = enter({ [Flag.Disguised]: 1 });
      w.engine.gfx.loadPic("anh_dr.alg", w.engine.gfx.back);
      w.hero.x = 95;
      w.hero.y = 82;
      w.hero.visible = false;
      const gfx = render(w);
      // (le premier plan, dessiné après, recouvre le coin bas gauche : ses pixels ne comptent pas)
      const body = comparedPixels(gfx, gfx.back, [93, 1, w.hero.x, w.hero.y, 45, 78], false, 3, (x, y) => x < 83 && y >= 102);
      expect(body.compared).toBeGreaterThan(50);
      expect(body.mismatches).toEqual([]);
      const foreground = comparedPixels(gfx, gfx.draw3, [233, 107, 17, 102, 66, 92], false, 5);
      expect(foreground.compared).toBeGreaterThan(30);
      expect(foreground.mismatches).toEqual([]);
    });
  });
});
