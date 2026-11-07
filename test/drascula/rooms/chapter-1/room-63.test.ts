import { describe, expect, it } from "vitest";
import { Inn, Toilets } from "../../../../src/games/drascula/engine/rooms/chapter-1/ids";
import { Verb } from "../../../../src/games/drascula/engine/state";
import { hasOriginalFiles } from "../../helpers";
import { Walkthrough } from "../../walkthrough";

/**
 * Pièce 63, l'arrière-salle du chapitre 1 : ni gestionnaire `room_63` ni `update_63` dans ScummVM ; tout vient de `roomActions`, des
 * réponses par défaut et du rectangle de `roomUpdates`.
 */
describe.skipIf(!hasOriginalFiles)("chapitre 1 : l'arrière-salle (pièce 63)", () => {
  const enter = () => {
    const w = new Walkthrough();
    w.goTo(Inn.Toilets);
    expect(w.room).toBe(63);
    return w;
  };

  it("on y arrive par la porte 107, les objets sont ceux de la fiche", () => {
    const w = enter();
    expect(w.engine.room.objects.map((o) => o.id)).toEqual([107, 103, 109, 110]);
    expect(w.state.objExit).toBe(107);
    expect(w.hero.x).toBe(72);
    expect(w.host.music[0]).toBe(21);
  });

  it.each([
    [Verb.Look, Toilets.Papers, "172.als"],
    [Verb.Look, Toilets.Curtain, "173.als"],
    [Verb.Move, Toilets.Curtain, "174.als"],
  ])("verbe %i sur l'objet %i : la réplique de roomActions", (verb, id, voice) => {
    const w = enter();
    const mark = w.mark();
    w.act(verb, id);
    expect(w.voices(mark)).toEqual([voice]);
  });

  it("le distributeur porte le numéro 103 sur la fiche française, alors que roomActions répond à 108 : réponses par défaut", () => {
    // Écart relevé à ScummVM : `drascula.dat` décrit l'objet 108 (334 « C'est un distributeur… », 333 « Ohé ! machine à tabac… »), la fiche
    // `63.ALD` du pack français le numérote 103. Rien ne le relie donc aux lignes de roomActions : « Regarder » donne « Je ne vois rien de
    // spécial » (54) et « Parler » « Bonjour, toi » (16), comme dans l'original.
    const w = enter();
    let mark = w.mark();
    w.act(Verb.Look, Toilets.VendingMachine);
    expect(w.voices(mark)).toEqual(["54.als"]);
    mark = w.mark();
    w.act(Verb.Talk, Toilets.VendingMachine);
    expect(w.voices(mark)).toEqual(["16.als"]);
  });

  it("la porte 107 ramène à l'auberge, par la porte 106", () => {
    const w = enter();
    w.goTo(Toilets.Door);
    expect(w.room).toBe(62);
    expect(w.state.objExit).toBe(106);
    expect(w.state.chapter).toBe(1);
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
        // Le héros (en avant-plan) ne recouvre pas ce rectangle : il est à gauche, derrière la porte.
        if (w.hero.x <= 83 + dx && 83 + dx <= w.hero.x + w.hero.width && w.hero.y <= 122 + dy && 122 + dy <= w.hero.y + w.hero.height) continue;
        expect(screen.at(83 + dx, 122 + dy)).toBe(source);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });
});
