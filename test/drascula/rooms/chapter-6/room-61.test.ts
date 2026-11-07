import { describe, expect, it } from "vitest";
import { Backroom, Tavern } from "../../../../src/games/drascula/engine/rooms/chapter-6/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { startInTavern } from "./start";

/**
 * Pièce 61, l'arrière-salle : ni `room_61` ni `update_61` dans ScummVM ; tout vient de `roomActions`, des réponses par défaut et du
 * rectangle de `roomUpdates`.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 6 : l'arrière-salle (pièce 61)", () => {
  const enter = () => {
    const w = startInTavern();
    w.goTo(Tavern.BackroomDoor);
    expect(w.room).toBe(61);
    return w;
  };

  it("on y arrive par la porte 111 ; les objets sont ceux de la fiche", () => {
    const w = enter();
    expect(w.state.objExit).toBe(111);
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([116, 117, 118, 111]);
    expect(w.host.music.at(-1)).toBe(17);
  });

  it.each([
    [Verb.Look, Backroom.Papers, "172.als"],
    [Verb.Look, Backroom.Curtain, "173.als"],
    [Verb.Move, Backroom.Curtain, "174.als"],
    [Verb.Open, Backroom.Curtain, "174.als"],
  ])("verbe %i sur l'objet %i : la réplique de roomActions", (verb, id, voice) => {
    const w = enter();
    const mark = w.mark();
    w.act(verb, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("le distributeur n'a pas de ligne de roomActions : regarder donne l'excuse, parler la réponse du chapitre (roomActions de la pièce 0)", () => {
    const w = enter();
    let mark = w.mark();
    w.act(Verb.Look, Backroom.VendingMachine);
    expect(w.voices(mark)).toEqual(["100.als"]);
    mark = w.mark();
    w.act(Verb.Talk, Backroom.VendingMachine);
    expect(w.voices(mark)).toEqual(["16.als"]);
  });

  it("la touche 0 remplace le décor par alcbar.alg (kActionEasterEgg) ; ailleurs, elle ne fait rien ; la sortie recharge le décor", () => {
    const w = enter();
    const before = Uint8Array.from(w.engine.gfx.bg.pixels);
    w.host.push({ type: "key", key: "0" });
    w.wait(10);
    const after = Uint8Array.from(w.engine.gfx.bg.pixels);
    expect(after).not.toEqual(before);
    const outside = startInTavern();
    const tavern = Uint8Array.from(outside.engine.gfx.bg.pixels);
    outside.host.push({ type: "key", key: "0" });
    outside.wait(10);
    expect(Uint8Array.from(outside.engine.gfx.bg.pixels)).toEqual(tavern);
    w.goTo(Backroom.Door);
    expect(w.room).toBe(60);
    expect(Uint8Array.from(w.engine.gfx.bg.pixels)).not.toEqual(after);
  });

  it("la porte 111 ramène à la taverne, par la porte 110", () => {
    const w = enter();
    w.goTo(Backroom.Door);
    expect(w.room).toBe(60);
    expect(w.state.objExit).toBe(110);
    expect(w.state.chapter).toBe(6);
  });

  it("le rectangle de roomUpdates de la pièce (1, 154, 131 x 44) est dessiné en (83, 122)", () => {
    const w = enter();
    w.player.move(319, 199);
    w.wait(40);
    w.engine.render();
    const { screen, draw3 } = w.engine.gfx;
    let compared = 0;
    for (let dy = 0; dy < 44; dy += 3) {
      for (let dx = 0; dx < 131; dx += 5) {
        const source = draw3.at(1 + dx, 154 + dy);
        if (source === 255) continue;
        if (w.hero.x <= 83 + dx && 83 + dx <= w.hero.x + w.hero.width && w.hero.y <= 122 + dy && 122 + dy <= w.hero.y + w.hero.height) continue;
        expect(screen.at(83 + dx, 122 + dy)).toBe(source);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});
