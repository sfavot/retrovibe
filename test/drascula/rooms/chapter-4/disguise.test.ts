import { describe, expect, it } from "vitest";
import { Anim, Bedroom, Flag, Item, Landing } from "../../../../src/games/drascula/engine/rooms/chapter-4/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { heroPoint, repaint, speech, startIn, useOnHero } from "./support";

/**
 * Le déguisement : `animation_6_4` (Igor s'en va), `animation_5_4` (le héros se déguise, sort de la chambre) et `animation_7_4`
 * (sur le palier, il quitte le déguisement et reçoit la clé du salon).
 */
describe.skipIf(!hasOriginalFiles)("chapitre 4 : le déguisement en Drascula", () => {
  /** Dans la chambre d'Igor, tout réuni, la perruque prise et la porte fermée à clé : l'état juste avant le déguisement. */
  const ready = () =>
    startIn(26, {
      exit: Bedroom.Door,
      flags: {
        [Flag.Ready]: 1,
        [Flag.WigTaken]: 1,
        [Flag.FriesTaken]: 1,
        [Flag.FlourTaken]: 1,
        [Flag.CapeTaken]: 1,
        [Flag.BedroomLocked]: 1,
        [Flag.DoorBedroom]: 0,
      },
      items: [Item.Wig, Item.Fries, Item.Flour, Item.Cape],
    });

  describe("animation_5_4 : le déguisement", () => {
    it.each([
      ["la perruque", Item.Wig],
      ["les frites", Item.Fries],
      ["la farine", Item.Flour],
      ["la cape", Item.Cape],
    ])("%s sur le héros : métamorphose, Igor s'excuse (i29, i30), le héros sort sur le palier où il se déshabille (427)", (_name, item) => {
      const w = ready();
      expect(w.engine.room.objects[0].isDoor).toBe(false); // enfermé
      const mark = w.mark();
      useOnHero(w, item);
      expect(w.voices(mark)).toEqual(["s3.als", "i29.als", "i30.als", "427.als"]);
      expect(w.room).toBe(24);
      expect(w.state.objExit).toBe(106);
      expect(w.flags[Flag.Disguised]).toBe(0);
      expect(w.flags[Flag.BedroomLocked]).toBe(0);
      expect(w.flags[Flag.DoorBedroom]).toBe(1);
      expect(w.state.hero.visible).toBe(true);
      expect(w.state.takeObject).toBe(false);
      expect(w.state.chapter).toBe(4);
      for (const gone of [Item.Fries, Item.Wig, Item.Flour, Item.Cape]) expect(w.state.inventory, String(gone)).not.toContain(gone);
      expect(w.state.inventory).toContain(Item.LivingRoomKey);
    });

    it("pendant la scène : bio.bin joue à l'écran, puis le héros déguisé est dessiné à (95, 82) et la porte s'ouvre", () => {
      const w = ready();
      w.takeItem(Item.Wig);
      const at = heroPoint(w);
      w.player.click(at.x, at.y);
      // Le héros marche vers le coin de la pièce puis disparaît ; la métamorphose occupe l'écran.
      w.until(() => !w.state.hero.visible);
      expect(w.state.hero.track).toBeLessThanOrEqual(3);
      w.until(() => w.engine.gfx.owner === "canvas");
      w.until(() => w.flags[Flag.Disguised] === 1);
      // (95, 82), puis `updateRoom` applique la taille de la perspective en gardant le coin bas droit.
      expect(Math.abs(w.state.hero.x - 95)).toBeLessThanOrEqual(12);
      expect(Math.abs(w.state.hero.y - 82)).toBeLessThanOrEqual(12);
      expect(w.engine.gfx.owner).toBe("room");
      // `anh_dr.alg` est la feuille « de dos » le temps de la scène.
      expect(w.engine.gfx.back.pixels).toEqual(w.engine.gfx.sheet("anh_dr.alg").pixels);
      w.until(() => w.flags[Flag.DoorBedroom] === 1);
      expect(w.host.sounds.at(-1)).toBe("s3.als");
      w.settle(60_000);
      expect(w.engine.gfx.back.pixels).toEqual(w.engine.gfx.sheet(99).pixels);
      expect(w.engine.gfx.front.pixels).toEqual(w.engine.gfx.sheet(96).pixels);
    });

    it("pendant le fondu au noir qui suit i30, le héros déguisé reste à l'écran : aucun pixel de 99.ALG (feuille « de dos » rechargée) dans sa zone", () => {
      const w = ready();
      w.takeItem(Item.Wig);
      const at = heroPoint(w);
      w.player.click(at.x, at.y);
      w.until(() => w.host.sounds.includes("i30.als"));
      const fullPalette = w.engine.gfx.palette.shown.slice();
      // Le fondu commence : la palette affichée s'éloigne de celle du jeu.
      w.until(() => w.engine.gfx.palette.shown.some((v, i) => v !== fullPalette[i]));
      const { x, y } = w.state.hero;
      const gfx = w.engine.gfx;
      const dress = gfx.sheet("anh_dr.alg");
      const plain = gfx.sheet(99);
      // 99.ALG est bien la feuille de `back` à ce moment, et ses pixels de la zone diffèrent de ceux du déguisement.
      expect(gfx.back.pixels).toEqual(plain.pixels);
      let differing = 0;
      for (let dy = 0; dy < 78; dy++) for (let dx = 0; dx < 45; dx++) if (plain.at(93 + dx, 1 + dy) !== dress.at(93 + dx, 1 + dy)) differing++;
      expect(differing).toBeGreaterThan(100);
      let fromPlain = 0;
      let frames = 0;
      for (let i = 0; i < 10 && w.engine.gfx.palette.shown.some((v) => v !== 0); i++, w.wait(8)) {
        const screen = repaint(w).screen;
        frames++;
        for (let dy = 0; dy < 78; dy++) {
          for (let dx = 0; dx < 45; dx++) {
            const p = plain.at(93 + dx, 1 + dy);
            if (p !== 255 && p !== dress.at(93 + dx, 1 + dy) && screen.at(x + dx, y + dy) === p) fromPlain++;
          }
        }
      }
      expect(frames).toBeGreaterThan(3);
      expect(fromPlain).toBe(0);
    });

    it("le fondu au noir part exactement de la dernière image de i30 : Igor debout, son sous-titre et le héros déguisé restent à l'écran", () => {
      const w = ready();
      w.takeItem(Item.Wig);
      const at = heroPoint(w);
      w.player.click(at.x, at.y);
      w.until(() => w.host.sounds.includes("i30.als"));
      const gfx = w.engine.gfx;
      const fullPalette = gfx.palette.shown.slice();
      // Dernière image composée tant que la réplique est affichée (ce que `screenSurface` de ScummVM garde ; le curseur n'en fait
      // pas partie, c'est un calque du système).
      w.engine.cursorVisible = false;
      let last = new Uint8Array(0);
      w.until(() => {
        if (w.engine.subtitle === null) return true;
        last = repaint(w).screen.pixels.slice();
        return false;
      });
      expect(last.length).toBeGreaterThan(0);
      w.until(() => gfx.palette.shown.some((v, i) => v !== fullPalette[i]));
      expect(repaint(w).screen.pixels).toEqual(last);
    });

    it("Échap saute la métamorphose, la suite est la même", () => {
      const w = ready();
      w.takeItem(Item.Cape);
      const at = heroPoint(w);
      w.player.click(at.x, at.y);
      w.until(() => w.engine.gfx.owner === "canvas");
      w.wait(30);
      w.key("Escape");
      w.settle(60_000);
      expect(w.room).toBe(24);
      expect(w.state.inventory).toContain(Item.LivingRoomKey);
    });

    it("sans que tout soit réuni (drapeau 18), ou sans la perruque, rien ne se passe : réponse par défaut", () => {
      const early = startIn(26, { exit: Bedroom.Door, flags: { [Flag.DoorBedroom]: 1, [Flag.WigTaken]: 1 }, items: [Item.Cape, Item.Wig] });
      expect(speech(early, () => useOnHero(early, Item.Cape))).toEqual(["11.als"]);
      expect(early.flags[Flag.Disguised]).toBe(0);
      expect(early.room).toBe(26);

      const noWig = startIn(26, { exit: Bedroom.Door, flags: { [Flag.DoorBedroom]: 1, [Flag.Ready]: 1 }, items: [Item.Cape] });
      expect(speech(noWig, () => useOnHero(noWig, Item.Cape))).toEqual(["11.als"]);
      expect(noWig.room).toBe(26);
    });
  });

  describe("avant d'avoir tout réuni (checkAction du chapitre)", () => {
    it("les frites sur le héros : « Je ne crois pas que ce soit le meilleur moment pour manger cette merde… » (481), dans toutes les pièces", () => {
      const w = startIn(24, { exit: Landing.DoorToHall, flags: { [Flag.DoorLanding]: 1 }, items: [Item.Fries, Item.Flour] });
      expect(speech(w, () => useOnHero(w, Item.Fries))).toEqual(["481.als"]);
      expect(speech(w, () => useOnHero(w, Item.Flour))).toEqual(["487.als"]);
    });

    it("tout réuni (drapeau 18), les frites sur le héros hors de la chambre : réponse par défaut", () => {
      const w = startIn(24, { exit: Landing.DoorToHall, flags: { [Flag.DoorLanding]: 1, [Flag.Ready]: 1 }, items: [Item.Fries] });
      expect(speech(w, () => useOnHero(w, Item.Fries))).toEqual(["11.als"]);
    });
  });

  describe("animation_6_4 : Igor s'en va", () => {
    it("la chambre d'Igor est montrée 1,8 s (Igor de face en (104, 71)), il dit « Ça suffit pour aujourd'hui » (i26), puis tout est remis", () => {
      const w = startIn(30, { exit: 115, flags: { [Flag.DoorPantry]: 1, [Flag.HingesOiled]: 1, [Flag.FriesTaken]: 1, [Flag.CapeTaken]: 1 } });
      const before = {
        room: w.engine.room,
        bg: w.engine.gfx.sheet(30).pixels,
      };
      w.selectVerb(Verb.Open);
      const at = w.pointOf(144);
      w.player.click(at.x, at.y);
      w.until(() => w.engine.gfx.owner === "canvas");
      const heroX = w.hero.x;
      const { canvas, front } = w.engine.gfx;
      // Igor de face (rangée 138 de auxigor.alg), recopié en (104, 71) sur l'image libre.
      let compared = 0;
      for (let y = 0; y < 61; y += 4) {
        for (let x = 0; x < 54; x += 3) {
          const source = front.at(1 + x, 138 + y);
          if (source === 255) continue;
          expect(canvas.at(104 + x, 71 + y)).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(50);
      const mark = w.mark();
      w.settle(60_000);
      expect(w.voices(mark)).toEqual(["i26.als"]);
      // La pièce 30 est revenue : même pièce, mêmes feuilles, même héros.
      expect(w.engine.room).toBe(before.room);
      expect(w.engine.gfx.owner).toBe("room");
      expect(w.engine.gfx.bg.pixels).toEqual(before.bg);
      expect(w.engine.gfx.front.pixels).toEqual(w.engine.gfx.sheet(96).pixels);
      expect(w.engine.gfx.draw3.pixels).toEqual(w.engine.gfx.sheet(w.engine.room.disk).pixels);
      expect(w.state.hero.visible).toBe(true);
      expect(w.state.hero.x).toBe(heroX);
      expect(w.flags[Flag.Ready]).toBe(1);
      expect(w.state.takeObject).toBe(false);
    });

    it("Igor ne part qu'avec les trois objets : deux ne suffisent pas, le troisième déclenche la scène", () => {
      const w = startIn(30, { exit: 115, flags: { [Flag.DoorPantry]: 1, [Flag.HingesOiled]: 1, [Flag.CapeTaken]: 1 } });
      w.act(Verb.Open, 144);
      expect(w.flags[Flag.FlourTaken]).toBe(1);
      expect(w.flags[Flag.Ready]).toBe(0); // les frites manquent
      expect(w.host.sounds.includes("i26.als")).toBe(false);
    });
  });

  describe("animation_7_4 : sur le palier, le déguisement s'en va", () => {
    it("arrivé déguisé (drapeau 29) sur le palier : écran noir, réplique 427, fondu, objets échangés contre la clé du salon", () => {
      const w = startIn(24, {
        exit: Landing.DoorToBedroom,
        flags: { [Flag.Disguised]: 1, [Flag.BedroomLocked]: 1, [Flag.DoorBedroom]: 1 },
        items: [Item.Fries, Item.Wig, Item.Flour, Item.Cape],
      });
      expect(w.flags[Flag.Disguised]).toBe(0);
      expect(w.flags[Flag.BedroomLocked]).toBe(0);
      expect(w.state.inventory).toContain(Item.LivingRoomKey);
      for (const gone of [Item.Fries, Item.Wig, Item.Flour, Item.Cape]) expect(w.state.inventory).not.toContain(gone);
      expect(w.host.sounds).toContain("427.als");
    });

    it("sans déguisement, entrer sur le palier ne déclenche rien", () => {
      const w = startIn(24, { exit: Landing.DoorToBedroom, flags: { [Flag.DoorBedroom]: 1 } });
      expect(w.host.sounds.includes("427.als")).toBe(false);
      expect(w.state.inventory).not.toContain(Item.LivingRoomKey);
      expect(w.state.anim[Anim.IgorPose] ?? 0).toBe(0);
    });
  });
});
