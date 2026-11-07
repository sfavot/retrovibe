import { describe, expect, it } from "vitest";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { DrasculaEngine } from "../../../src/games/drascula/engine/loop";
import { Inn } from "../../../src/games/drascula/engine/rooms/chapter-1/ids";
import { Verb } from "../../../src/games/drascula/engine/state";
import { SAVE_PREFIX, SaveSlots, loadFromSlot, saveToSlot } from "../../../src/games/drascula/ui/saves";
import { hasOriginalFiles } from "../helpers";
import { Walkthrough } from "../walkthrough";

function setup(options: ConstructorParameters<typeof Walkthrough>[0] = {}) {
  const raw = new MemoryStorage();
  const slots = new SaveSlots(prefixedStorage(raw, SAVE_PREFIX));
  return { raw, slots, w: new Walkthrough(options) };
}

/**
 * Dans ScummVM, `_canSaveLoad` n'est vrai que pendant `updateEvents()` / `getScan()` de la boucle principale (`runCurrentChapter` et
 * l'écran d'inventaire) : ni pendant une séquence (cinématique, réplique, marche scénarisée), ni pendant le menu des choix d'un dialogue
 * (`converse` a sa propre boucle, qui ne l'active pas). Le moteur reproduit : `canSave` est faux dès qu'une séquence a la main.
 */
describe.skipIf(!hasOriginalFiles)("sauvegarde : quand elle est permise", () => {
  it("refusée pendant la séquence d'arrivée dans l'auberge, permise dès que le jeu rend la main", () => {
    const { raw, slots, w } = setup({ settle: false });
    expect(w.engine.busy).toBe(true);
    expect(w.engine.canSave).toBe(false);
    expect(w.engine.saveGame()).toBeNull();
    expect(saveToSlot(w.engine, slots, 1, 0)).toBe("busy");
    expect(raw.data.size).toBe(0);
    w.settle();
    expect(w.engine.canSave).toBe(true);
    expect(saveToSlot(w.engine, slots, 1, 0)).toBe("saved");
    expect(raw.data.size).toBe(1);
  });

  it("refusée pendant le menu des choix d'un dialogue, comme dans l'original", () => {
    const { raw, slots, w } = setup();
    w.selectVerb(Verb.Talk);
    const drunk = w.pointOf(Inn.Drunk);
    w.player.click(drunk.x, drunk.y);
    w.waitForChoices();
    expect(w.engine.choices).not.toBeNull();
    expect(w.engine.canSave).toBe(false);
    expect(w.engine.saveGame()).toBeNull();
    expect(saveToSlot(w.engine, slots, 2, 0)).toBe("busy");
    expect(raw.data.size).toBe(0);
    // le dialogue fini, la sauvegarde est de nouveau permise
    w.choose(3);
    w.settle();
    expect(w.engine.choices).toBeNull();
    expect(saveToSlot(w.engine, slots, 2, 0)).toBe("saved");
  });

  it("refusée pendant une réplique et une marche scénarisée, permise ensuite", () => {
    const { w } = setup();
    w.selectVerb(Verb.Look);
    const { x, y } = w.pointOf(Inn.Skull);
    w.player.click(x, y);
    w.player.run(5);
    expect(w.engine.busy).toBe(true);
    expect(w.engine.saveGame()).toBeNull();
    w.settle();
    expect(w.engine.saveGame()).not.toBeNull();
  });

  it("refusée une fois le jeu fini", () => {
    const { w } = setup();
    w.engine.ended = true;
    expect(w.engine.canSave).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("sauvegarde : chargement", () => {
  it("un emplacement vide ou illisible : « empty », le moteur n'est pas touché", () => {
    const { raw, slots, w } = setup();
    const state = w.state;
    expect(loadFromSlot(w.engine, slots, 3)).toBe("empty");
    raw.set("drascula:slot03", "{pas du json");
    expect(loadFromSlot(w.engine, slots, 3)).toBe("empty");
    raw.set("drascula:slot03", JSON.stringify({ savedAt: 1, save: { version: 99 } }));
    expect(loadFromSlot(w.engine, slots, 3)).toBe("empty");
    expect(w.state).toBe(state);
  });

  it("une sauvegarde dont la pièce n'existe pas dans le chapitre : « failed », le moteur n'est pas touché", () => {
    const { slots, w } = setup();
    const save = w.engine.saveGame()!;
    const state = w.state;
    slots.write(1, { ...save, room: { ...save.room, number: 9999 } }, 0);
    expect(loadFromSlot(w.engine, slots, 1)).toBe("failed");
    // une pièce d'un autre chapitre ne se lit pas non plus dans la disposition de celui-ci
    expect(w.engine.loadGame({ ...save, chapter: 2, room: { ...save.room, number: 9999 } })).toBe(false);
    expect(w.state).toBe(state);
    expect(w.engine.canSave).toBe(true);
  });

  it("charger remet l'état sauvegardé, le temps du moteur et la musique de la pièce ; l'inventaire ouvert se referme", () => {
    const { slots, w } = setup();
    w.flags[20] = 3;
    w.player.run(500);
    const ticks = w.engine.ticks;
    w.toggleInventory();
    expect(w.state.menuScreen).toBe(true);
    expect(saveToSlot(w.engine, slots, 1, 0)).toBe("saved"); // l'écran d'inventaire est la boucle principale : permis
    w.toggleInventory();
    w.flags[20] = 0;
    w.player.run(300);
    expect(loadFromSlot(w.engine, slots, 1)).toBe("loaded");
    w.settle();
    expect(w.flags[20]).toBe(3);
    expect(w.state.menuScreen).toBe(false);
    expect(w.engine.ticks).toBeGreaterThanOrEqual(ticks);
    expect(w.engine.ticks).toBeLessThan(ticks + 300);
    expect(w.engine.canSave).toBe(true);
  });

  it("charger pendant une séquence l'abandonne : la partie reprend au repos dans la pièce sauvegardée", () => {
    const { slots, w } = setup();
    expect(saveToSlot(w.engine, slots, 1, 0)).toBe("saved");
    const room = w.room;
    w.selectVerb(Verb.Look);
    const { x, y } = w.pointOf(Inn.Skull);
    w.player.click(x, y);
    w.player.run(5);
    expect(w.engine.busy).toBe(true);
    expect(loadFromSlot(w.engine, slots, 1)).toBe("loaded");
    expect(w.engine.subtitle).toBeNull();
    w.settle();
    expect(w.room).toBe(room);
    expect(w.engine.canSave).toBe(true);
  });

  it("un moteur construit avec une sauvegarde invalide lève", () => {
    const { w } = setup();
    const save = w.engine.saveGame()!;
    expect(() => new DrasculaEngine(w.host, { restore: { ...save, room: { ...save.room, number: 9999 } } })).toThrow(/inutilisable/);
  });
});
