import { describe, expect, it } from "vitest";
import { Flag, Item, Laboratory, Room, Towers } from "../../../../src/games/drascula/engine/rooms/chapter-5/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 53, le laboratoire de Frankenstein : la fiche, la vis, le cerveau, l'interrupteur et `animation_12_5`. */
describe.skipIf(!hasOriginalFiles)("chapitre 5 : le laboratoire (pièce 53)", () => {
  const enter = () => {
    const w = new Walkthrough({ chapter: 5 });
    w.goTo(Towers.Tower1);
    w.goTo(112);
    expect(w.room).toBe(Room.Laboratory);
    return w;
  };
  /** Le laboratoire prêt : la vis et le cerveau en place, la fiche dans la prise (drapeaux 2 à 4), sans l'interrupteur. */
  const ready = () => {
    const w = enter();
    w.engine.addObject(Item.Screw);
    w.useItem(Item.Screw, Laboratory.Frankenstein);
    w.useItem(Item.Brain, Laboratory.Frankenstein);
    w.act(Verb.Pick, Laboratory.FloorPlug);
    const socket = w.pointOf(Laboratory.Socket);
    w.clickAt(socket.x, socket.y);
    return w;
  };

  it("les objets sont ceux de la fiche ; la musique est la 23", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([116, 52, 121, 120, 123, 209]);
    expect(w.host.music.at(-1)).toBe(23);
    expect(w.flags[Flag.FrankensteinAwake]).toBe(0);
  });

  it.each([
    [Verb.Look, Laboratory.Socket, "128.als"],
    [Verb.Look, Laboratory.Machine, "129.als"],
    [Verb.Look, Laboratory.Frankenstein, "447.als"],
    [Verb.Talk, Laboratory.Frankenstein, "131.als"],
  ])("verbe %i sur l'objet %i : la réplique de roomActions", (verb, id, voice) => {
    const w = enter();
    const mark = w.mark();
    w.act(verb, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("prendre la fiche : elle est en main (objet 16) et disparaît du sol ; elle ne revient pas dans l'inventaire", () => {
    const w = enter();
    w.act(Verb.Pick, Laboratory.FloorPlug);
    expect(w.state.pickedObject).toBe(Item.Plug);
    expect(w.state.takeObject).toBe(true);
    expect(w.engine.room.objects.find((o) => o.id === Laboratory.FloorPlug)?.visible).toBe(false);
    // Un verbe choisi ensuite ne la range pas non plus.
    w.selectVerb(Verb.Look);
    expect(w.state.inventory).not.toContain(Item.Plug);
  });

  it("l'inventaire ne s'ouvre pas tant qu'on tient la fiche (correctif n° 3885 de ScummVM)", () => {
    const w = enter();
    w.act(Verb.Pick, Laboratory.FloorPlug);
    w.toggleInventory();
    expect(w.state.menuScreen).toBe(false);
  });

  it("la fiche dans la prise : drapeau 2, la fiche est consommée et le sol reste vide, aussi à l'entrée suivante", () => {
    const w = enter();
    w.act(Verb.Pick, Laboratory.FloorPlug);
    const socket = w.pointOf(Laboratory.Socket);
    w.clickAt(socket.x, socket.y);
    expect(w.flags[Flag.PlugConnected]).toBe(1);
    expect(w.state.takeObject).toBe(false);
    w.goTo(Laboratory.Door);
    w.goTo(112);
    expect(w.room).toBe(Room.Laboratory);
    expect(w.engine.room.objects.find((o) => o.id === Laboratory.FloorPlug)?.visible).toBe(false);
  });

  it("la fiche utilisée ailleurs reparaît par terre et reste en main (réponse par défaut de la pièce 0)", () => {
    const w = enter();
    w.act(Verb.Pick, Laboratory.FloorPlug);
    const machine = w.pointOf(Laboratory.Machine);
    const mark = w.mark();
    w.clickAt(machine.x, machine.y);
    expect(w.engine.room.objects.find((o) => o.id === Laboratory.FloorPlug)?.visible).toBe(true);
    expect(w.flags[Flag.PlugConnected]).toBe(0);
    expect(w.state.pickedObject).toBe(Item.Plug);
    expect(w.voices(mark)).toEqual(["11.als"]);
  });

  it.each([
    [Item.Screw, Flag.ScrewFitted],
    [Item.Brain, Flag.BrainFitted],
  ])("l'objet %i sur Frankenstein : « Très bien » (401), le drapeau %i, l'objet est consommé", (item, flag) => {
    const w = enter();
    w.engine.addObject(item);
    const mark = w.mark();
    w.useItem(item, Laboratory.Frankenstein);
    expect(w.voices(mark)).toEqual(["401.als"]);
    expect(w.flags[flag]).toBe(1);
    expect(w.state.inventory).not.toContain(item);
    expect(w.state.takeObject).toBe(false);
  });

  it("l'interrupteur avant que tout soit en place : « Il ne se passe rien » (33), le drapeau 9 retombe", () => {
    const w = enter();
    const mark = w.mark();
    w.act(Verb.Move, Laboratory.Switch);
    expect(w.voices(mark)).toEqual(["33.als"]);
    expect(w.flags[Flag.SwitchOn]).toBe(0);
    expect(w.flags[Flag.FrankensteinAwake]).toBe(0);
    expect(w.room).toBe(Room.Laboratory);
  });

  it("avec deux éléments sur trois, l'interrupteur ne fait toujours rien", () => {
    const w = enter();
    w.engine.addObject(Item.Screw);
    w.useItem(Item.Screw, Laboratory.Frankenstein);
    w.useItem(Item.Brain, Laboratory.Frankenstein);
    const mark = w.mark();
    w.act(Verb.Move, Laboratory.Switch);
    expect(w.voices(mark)).toEqual(["33.als"]);
    expect(w.room).toBe(Room.Laboratory);
  });

  describe("animation_12_5 (tout est en place, l'interrupteur)", () => {
    const flip = () => {
      const w = ready();
      expect(w.flags[Flag.PlugConnected]).toBe(1);
      expect(w.flags[Flag.ScrewFitted]).toBe(1);
      expect(w.flags[Flag.BrainFitted]).toBe(1);
      const mark = w.mark();
      w.selectVerb(Verb.Move);
      const { x, y } = w.pointOf(Laboratory.Switch);
      w.player.click(x, y);
      return { w, mark };
    };

    it("l'éclair, le réveil, la sortie de Frankenstein et le couloir 57 : sons, musiques, drapeaux, position du héros", () => {
      const { w, mark } = flip();
      w.settle(60_000);
      expect(w.room).toBe(Room.Corridor);
      expect(w.flags[Flag.FrankensteinAwake]).toBe(1);
      expect(w.flags[Flag.SwitchOn]).toBe(1);
      const voices = w.voices(mark);
      // Le coup de foudre (5), la marche du monstre puis le hoquet (1) : les sons sont dans cet ordre.
      expect(voices.filter((v) => v === "s5.als")).toHaveLength(1);
      expect(voices.indexOf("s1.als")).toBeGreaterThan(voices.indexOf("s5.als"));
      // Musiques : l'éclair (26), le monstre qui marche (18), le couloir (15).
      const music = w.host.music;
      expect(music.slice(-3)).toEqual([26, 18, 15]);
      expect(w.state.objExit).toBe(104);
      expect(w.hero.visible).toBe(true);
      expect(w.engine.gfx.owner).toBe("room");
      expect(w.engine.gfx.shake).toBeNull();
      // Le héros est au pied de la porte 104 du couloir.
      const door = w.engine.room.objects.find((o) => o.id === 104)!;
      expect(w.hero.x + Math.trunc(w.hero.width / 2)).toBeGreaterThan(door.approach.x - 12);
    });

    it("les palettes passent par les niveaux assombris puis reviennent à celle du jeu", () => {
      const { w } = flip();
      const palettes = new Set<string>();
      for (let tick = 0; tick < 6000 && w.state.room!.number === Room.Laboratory; tick++) {
        w.wait(1);
        if (w.flags[Flag.FrankensteinAwake] === 1) break;
        palettes.add(w.engine.gfx.palette.shown.slice(0, 384).join(","));
      }
      // Les trois palettes assombries, la palette du jeu et celles des animations.
      expect(palettes.size).toBeGreaterThanOrEqual(5);
      w.settle(60_000);
      expect(w.engine.gfx.palette.shown.join(",")).toBe(
        (() => {
          const shown = new Uint8Array(768);
          for (let i = 0; i < 768; i++) shown[i] = (w.engine.gfx.palette.game[i] & 0xff) * 4;
          return shown.join(",");
        })(),
      );
    });

    it("les images de l'éclair (3an11_1.alg à (41, 0)) et du monstre de la table (aux53 à (205, 50)) sont dessinées", () => {
      const { w } = flip();
      const gfx = w.engine.gfx;
      const rays = gfx.sheet("3an11_1.alg");
      const rayX = [1, 46, 91, 136, 181, 226, 271, 181];
      const matched = (frame: number): boolean => {
        let compared = 0;
        for (let dy = 0; dy < 44; dy += 2) {
          for (let dx = 0; dx < 44; dx += 2) {
            const source = rays.at(rayX[frame] + dx, 1 + dy);
            if (source === 255) continue;
            if (gfx.canvas.at(41 + dx, dy) !== source) return false;
            compared++;
          }
        }
        return compared > 10;
      };
      const seen = new Set<number>();
      for (let tick = 0; tick < 6000 && w.flags[Flag.FrankensteinAwake] === 0; tick++) {
        w.wait(1);
        if (gfx.owner !== "canvas") continue;
        for (let frame = 0; frame < 8; frame++) if (matched(frame)) seen.add(frame);
      }
      expect(seen.size).toBeGreaterThanOrEqual(6);
    });

    it("Frankenstein traverse l'écran vers la gauche de 5 pixels par image avant que le héros ne sorte", () => {
      const { w } = flip();
      const gfx = w.engine.gfx;
      const sheet = gfx.sheet("auxfr.alg");
      // Le monstre debout (auxfr, image 0 à 44 x 87 pixels) : on cherche son abscisse dans l'image libre.
      const positions: number[] = [];
      for (let tick = 0; tick < 12_000 && w.state.room!.number === Room.Laboratory; tick++) {
        w.wait(1);
        if (gfx.owner !== "canvas" || !w.host.music.includes(18)) continue;
        let found: number | null = null;
        for (let x = -44; x < 320 && found === null; x++) {
          let compared = 0;
          let same = true;
          for (let dy = 0; dy < 87 && same; dy += 4) {
            for (let dx = 0; dx < 44; dx += 4) {
              const source = sheet.at(1 + dx, 1 + dy);
              if (source === 255) continue;
              compared++;
              if (gfx.canvas.at(x + dx, 81 + dy) !== source) {
                same = false;
                break;
              }
            }
          }
          if (same && compared > 15) found = x;
        }
        if (found !== null && positions.at(-1) !== found) positions.push(found);
      }
      // Image 0 de la marche : positions 199, 174 (cycle de 7 images, une image 0 sur 7), etc.
      expect(positions.length).toBeGreaterThanOrEqual(3);
      expect(positions[0]).toBe(199);
      for (let i = 1; i < positions.length; i++) expect((positions[i - 1] - positions[i]) % 35).toBe(0);
    });
  });
});
