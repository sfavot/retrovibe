import { describe, expect, it } from "vitest";
import { SAVE_VERSION, type SaveData, parseSave, restoreState, snapshotState } from "../../../src/games/drascula/engine/save";
import { INVENTORY_SIZE, NUM_FLAGS, type GameState, createGameState } from "../../../src/games/drascula/engine/state";

/** Une partie du chapitre 3 avec de quoi remplir chaque champ : pièce, objets, drapeaux, inventaire, animations. */
function sampleState(): GameState {
  const state = createGameState(3);
  state.room = {
    number: 20,
    music: 4,
    disk: "aux20.alg",
    paletteLevel: 2,
    walk: { x1: 0, y1: 0, x2: 10, y2: 10 },
    hero: null,
    factors: null,
    objects: [
      { id: 7, name: "porte", rect: { x1: 1, y1: 2, x2: 3, y2: 4 }, approach: { x: 5, y: 6 }, track: 1, visible: true, isDoor: true, door: { room: 13, x: 1, y: 2, direction: 3, exit: 8 } },
      { id: 8, name: "lampe", rect: { x1: 9, y1: 8, x2: 7, y2: 6 }, approach: { x: 5, y: 4 }, track: 0, visible: false, isDoor: false, door: null },
    ],
  };
  state.flags[1] = 1;
  state.flags[NUM_FLAGS - 1] = 7;
  state.inventory[1] = 1;
  state.inventory[9] = 28;
  state.anim = { candles: 2, televisionTick: 18_113 };
  state.hero.x = 100;
  state.hero.moving = true;
  state.hero.walkToObject = true;
  state.savedTime = 99;
  state.takeObject = true;
  state.pickedObject = 28;
  state.menuScreen = true;
  state.hasName = true;
  state.textName = "porte";
  state.previousMusic = 4;
  return state;
}

function sampleSave(): SaveData {
  return snapshotState(sampleState(), 1234)!;
}

describe("sauvegarde : instantané et lecture", () => {
  it("l'instantané survit à JSON et se relit à l'identique", () => {
    const save = sampleSave();
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.ticks).toBe(1234);
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it("l'instantané ne partage rien avec l'état vivant", () => {
    const state = sampleState();
    const save = snapshotState(state, 0)!;
    state.flags[1] = 5;
    state.anim.candles = 9;
    state.room!.objects[0].visible = false;
    state.hero.x = 1;
    expect(save.flags[1]).toBe(1);
    expect(save.anim.candles).toBe(2);
    expect(save.room.objects[0].visible).toBe(true);
    expect(save.hero.x).toBe(100);
  });

  it("sans pièce chargée, il n'y a rien à sauvegarder", () => {
    expect(snapshotState(createGameState(1), 0)).toBeNull();
  });

  it("les champs transitoires ne sont pas sauvegardés et sont remis à zéro au chargement, comme ScummVM", () => {
    const save = sampleSave();
    expect(Object.keys(save)).not.toEqual(expect.arrayContaining(["menuScreen", "menuBar", "hasName", "textName", "previousMusic"]));
    const state = restoreState(save, 11);
    expect(state.room).toBeNull(); // le moteur recharge la pièce depuis sa fiche
    expect(state).toMatchObject({ chapter: 3, menuScreen: false, menuBar: false, hasName: false, textName: "", previousMusic: 11 });
    expect(state.hero).toMatchObject({ x: 100, moving: false, walkToObject: false });
    expect(state).toMatchObject({ savedTime: 99, takeObject: true, pickedObject: 28, anim: { candles: 2, televisionTick: 18_113 } });
    expect(state.flags[NUM_FLAGS - 1]).toBe(7);
    expect(state.inventory[9]).toBe(28);
  });
});

describe("sauvegarde : une valeur qui n'en est pas une est refusée", () => {
  const broken = (change: (save: Record<string, unknown>) => void): unknown => {
    const save = JSON.parse(JSON.stringify(sampleSave())) as Record<string, unknown>;
    change(save);
    return save;
  };

  it.each([
    ["null", null],
    ["un nombre", 3],
    ["un tableau", []],
    ["un objet vide", {}],
    ["une autre version", broken((s) => (s.version = SAVE_VERSION + 1))],
    ["l'ancienne version 0", broken((s) => (s.version = 0))],
    ["sans version", broken((s) => delete s.version)],
    ["un chapitre 0", broken((s) => (s.chapter = 0))],
    ["un chapitre 7", broken((s) => (s.chapter = 7))],
    ["un chapitre fractionnaire", broken((s) => (s.chapter = 2.5))],
    ["un chapitre en texte", broken((s) => (s.chapter = "3"))],
    ["trop peu de drapeaux", broken((s) => (s.flags = [0, 1]))],
    ["un drapeau en texte", broken((s) => ((s.flags as unknown[])[3] = "1"))],
    ["un inventaire trop long", broken((s) => (s.inventory = new Array(INVENTORY_SIZE + 1).fill(0)))],
    ["sans pièce", broken((s) => delete s.room)],
    ["une pièce négative", broken((s) => (s.room = { number: -1, objects: [] }))],
    ["un objet de pièce abîmé", broken((s) => ((s.room as { objects: unknown[] }).objects[0] = { id: 1 }))],
    ["un héros sans champ", broken((s) => delete (s.hero as Record<string, unknown>).visible)],
    ["un héros dont un champ n'est pas un nombre", broken((s) => ((s.hero as Record<string, unknown>).x = "10"))],
    ["des animations en texte", broken((s) => (s.anim = { candles: "2" }))],
    ["un temps négatif", broken((s) => (s.ticks = -1))],
    ["un booléen en nombre", broken((s) => (s.takeObject = 1))],
  ])("%s", (_name, value) => {
    expect(parseSave(value)).toBeNull();
  });

  it("les champs en trop sont ignorés (ils ne sont pas copiés dans la partie)", () => {
    const value = broken((s) => (s.extra = "x")) as Record<string, unknown>;
    const save = parseSave(value)!;
    expect(save).not.toBeNull();
    expect("extra" in save).toBe(false);
  });
});
