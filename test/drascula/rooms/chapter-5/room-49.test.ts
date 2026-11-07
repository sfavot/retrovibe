import { describe, expect, it } from "vitest";
import { Flag, Item, Office, Room, Towers } from "../../../../src/games/drascula/engine/rooms/chapter-5/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/** Pièce 49, le bureau du loup-garou : la scène d'arrivée, le menu 9, l'os (`animation_5_5`). */
describe.skipIf(!hasOriginalFiles)("chapitre 5 : le bureau du loup-garou (pièce 49)", () => {
  /** Entre dans le bureau depuis la carte ; `arrival` est la voix jouée à l'entrée. */
  const enter = () => {
    const w = new Walkthrough({ chapter: 5 });
    const mark = w.mark();
    w.goTo(Towers.Tower3, 60_000);
    expect(w.room).toBe(Room.Office);
    return { w, mark };
  };

  it("les objets sont ceux de la fiche ; la porte du fond est cachée tant que le loup-garou est là", () => {
    const { w } = enter();
    expect(w.engine.room.objects.map((o) => [o.id, o.visible])).toEqual([
      [109, true],
      [110, false],
      [51, true],
      [200, true],
      [201, true],
      [202, true],
      [203, true],
    ]);
    expect(w.host.music.at(-1)).toBe(20);
  });

  it("à la première entrée : le scénario 4 (le héros crie, le loup-garou répond) et le drapeau 7", () => {
    const { w, mark } = enter();
    expect(w.flags[Flag.WerewolfMet]).toBe(1);
    expect(w.voices(mark)).toEqual(["228.als", "l1.als", "l2.als", "229.als", "l3.als", "l4.als", "230.als", "l5.als", "231.als", "l6.als", "l7.als", "232.als", "l8.als"]);
  });

  it("aux entrées suivantes : rien", () => {
    const { w } = enter();
    w.goTo(Office.DoorLeft);
    expect(w.room).toBe(Room.Towers);
    const mark = w.mark();
    w.goTo(Towers.Tower3);
    expect(w.room).toBe(Room.Office);
    expect(w.voices(mark)).toEqual([]);
  });

  it.each([
    [Verb.Look, Office.Werewolf, "132.als"],
    [Verb.Look, Office.Poster, "133.als"],
    [Verb.Talk, Office.Poster, "134.als"],
    [Verb.Look, Office.Desk, "135.als"],
    [Verb.Look, Office.Window, "137.als"],
  ])("verbe %i sur l'objet %i : la réplique de roomActions", (verb, id, voice) => {
    const { w } = enter();
    const mark = w.mark();
    w.act(verb, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("parler au loup-garou : le menu 9, ses trois réponses puis la sortie", () => {
    const { w } = enter();
    const mark = w.mark();
    w.selectVerb(Verb.Talk);
    const { x, y } = w.pointOf(Office.Werewolf);
    w.player.click(x, y);
    w.waitForChoices();
    expect(w.engine.choices?.phrases).toHaveLength(4);
    expect(w.choose(0)).toBe(true);
    expect(w.choose(1)).toBe(true);
    expect(w.choose(2)).toBe(true);
    expect(w.choose(3)).toBe(false);
    w.settle();
    const spoken = w.voices(mark);
    for (const voice of ["233.als", "l9.als", "234.als", "235.als", "l10.als", "236.als", "237.als", "l15.als", "238.als", "l16.als"]) expect(spoken, voice).toContain(voice);
    expect(w.engine.choices).toBeNull();
  });

  it("l'os sur une autre chose que le loup-garou ou la fenêtre : une excuse, rien ne change", () => {
    const { w } = enter();
    w.flags[Flag.WerewolfMet] = 1;
    w.engine.addObject(Item.Bone);
    const mark = w.mark();
    w.useItem(Item.Bone, Office.Desk);
    expect(w.voices(mark)).toEqual(["11.als"]);
    expect(w.flags[Flag.WerewolfGone]).toBe(0);
    // L'os reste en main.
    expect(w.state.pickedObject).toBe(Item.Bone);
    expect(w.state.takeObject).toBe(true);
  });

  describe.each([
    ["le loup-garou", Office.Werewolf],
    ["la fenêtre", Office.Window],
  ])("l'os donné à %s (animation_5_5)", (_name, target) => {
    const throwBone = () => {
      const { w } = enter();
      w.engine.addObject(Item.Bone);
      // Le héros va d'abord au point d'approche de la cible : l'origine du rectangle de la cinématique est sa position de départ.
      w.goTo(target);
      const start = { x: w.hero.x, y: w.hero.y };
      w.takeItem(Item.Bone);
      const mark = w.mark();
      const { x, y } = w.pointOf(target);
      w.player.click(x, y);
      return { w, start, mark };
    };

    it("le loup-garou est parti, l'os est perdu, la porte du fond et la quatrième tour s'ouvrent", () => {
      const { w } = throwBone();
      w.settle(60_000);
      expect(w.room).toBe(Room.Office);
      expect(w.flags[Flag.WerewolfGone]).toBe(1);
      expect(w.state.inventory).not.toContain(Item.Bone);
      expect(w.state.takeObject).toBe(false);
      const visible = Object.fromEntries(w.engine.room.objects.map((o) => [o.id, o.visible]));
      expect(visible[Office.Werewolf]).toBe(false);
      expect(visible[Office.DoorRight]).toBe(true);
      expect(w.engine.gfx.owner).toBe("room");
      expect(w.hero.track).toBe(1);
      // Le son 1 clôt la scène.
      expect(w.voices().at(-1)).toBe("s1.als");
      w.goTo(Office.DoorRight);
      expect(w.room).toBe(Room.Towers);
      expect(w.state.objExit).toBe(102);
      expect(w.engine.room.objects.find((o) => o.id === Towers.Tower4)?.visible).toBe(true);
    });

    it("les images du lancer sont celles de 3an5_1 puis 3an5_2, dans le rectangle du héros", () => {
      const { w, start } = throwBone();
      const gfx = w.engine.gfx;
      const pixelX = start.x - 53;
      const pixelY = start.y - 9;
      const matched = (sheetName: string, frame: number): boolean => {
        const sheet = gfx.sheet(sheetName);
        const sx = [1, 99, 197, 1, 99, 197, 1, 99, 197][frame];
        const sy = [1, 1, 1, 66, 66, 66, 131, 131, 131][frame];
        let compared = 0;
        for (let dy = 0; dy < 64; dy += 3) {
          for (let dx = 0; dx < 97; dx += 3) {
            const source = sheet.at(sx + dx, sy + dy);
            if (source === 255) continue;
            if (gfx.canvas.at(pixelX + dx, pixelY + dy) !== source) return false;
            compared++;
          }
        }
        return compared > 10;
      };
      const seen = { first: new Set<number>(), second: new Set<number>() };
      for (let tick = 0; tick < 3000 && w.engine.busy; tick++) {
        w.wait(1);
        if (gfx.owner !== "canvas") continue;
        for (let frame = 0; frame < 9; frame++) {
          if (matched("3an5_1.alg", frame)) seen.first.add(frame);
          if (matched("3an5_2.alg", frame)) seen.second.add(frame);
        }
      }
      expect(seen.first.size).toBeGreaterThanOrEqual(8);
      expect(seen.second.size).toBeGreaterThanOrEqual(8);
    });

    it("la mouche emporte le loup-garou : cinq images de 3an5_3 puis cinq de 3an5_4 à (174, 79)", () => {
      const { w } = throwBone();
      const gfx = w.engine.gfx;
      const matched = (sheetName: string, frame: number): boolean => {
        const sheet = gfx.sheet(sheetName);
        const sx = [1, 63, 125, 187, 249][frame];
        let compared = 0;
        for (let dy = 0; dy < 109; dy += 3) {
          for (let dx = 0; dx < 61; dx += 3) {
            if (gfx.canvas.at(174 + dx, 79 + dy) !== sheet.at(sx + dx, 1 + dy)) return false;
            compared++;
          }
        }
        return compared > 10;
      };
      const seen = { third: new Set<number>(), fourth: new Set<number>() };
      for (let tick = 0; tick < 3000 && w.engine.busy; tick++) {
        w.wait(1);
        if (gfx.owner !== "canvas") continue;
        for (let frame = 0; frame < 5; frame++) {
          if (matched("3an5_3.alg", frame)) seen.third.add(frame);
          if (matched("3an5_4.alg", frame)) seen.fourth.add(frame);
        }
      }
      expect([...seen.third].sort()).toEqual([0, 1, 2, 3, 4]);
      // La dernière image de 3an5_4 est recouverte aussitôt par l'image 101 (`updateScreen` du décor, sans attente) : jamais vue.
      expect([...seen.fourth].sort()).toEqual([0, 1, 2, 3]);
    });
  });
});
