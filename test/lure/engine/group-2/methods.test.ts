import { describe, expect, it } from "vitest";
import { CharacterMode, CurrentAction, Field, HotspotId } from "../../../../src/games/lure/engine/ids";
import { METHOD_CATALOG } from "../../../../src/games/lure/engine/methods/catalog";
import { GROUP_2_METHODS } from "../../../../src/games/lure/engine/methods/group-2/index";
import { MethodTable } from "../../../../src/games/lure/engine/methods/index";
import type { SilentSound } from "../../../../src/games/lure/engine/services";
import { hasOriginalFiles } from "../test-host";
import { call, started } from "./helpers";

const soundCalls = (engine: ReturnType<typeof started>): string[] => (engine.sound as SilentSound).calls;
const CELL_DOOR_MUSIC = "addSound 21";

describe("méthodes du groupe L2 : table", () => {
  it("fournit exactement les numéros du catalogue du groupe L2 (20, 23, 24, 26, 65)", () => {
    const expected = METHOD_CATALOG.filter((m) => m.group === "L2").map((m) => m.index);
    expect(Object.keys(GROUP_2_METHODS).map(Number).sort((a, b) => a - b)).toEqual(expected);
    expect(expected).toEqual([20, 23, 24, 26, 65]);
  });

  it("20 et 65 sont la même fonction (`checkCellDoor`)", () => {
    expect(GROUP_2_METHODS[20]).toBe(GROUP_2_METHODS[65]);
  });

  it("une table sans le groupe garde ces numéros en souches, avec le groupe elles sont portées", () => {
    const ctx = { journal: { log: () => {} } } as never;
    expect(new MethodTable(ctx, []).isStub(24)).toBe(true);
    const table = new MethodTable(ctx, [GROUP_2_METHODS]);
    for (const n of [20, 23, 24, 26, 65]) expect(table.isStub(n)).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("20 et 65 checkCellDoor", () => {
  for (const index of [20, 65]) {
    it(`${index} : porte de la cellule ouverte et torche cachée : la musique 21 démarre`, () => {
      const engine = started();
      const join = engine.world.getExitJoin(HotspotId.CELL_DOOR)!;
      join.blocked = 0;
      engine.world.fields.set(Field.TORCH_HIDE, 1);
      const before = soundCalls(engine).filter((c) => c === CELL_DOOR_MUSIC).length;
      call(engine, index);
      expect(soundCalls(engine).filter((c) => c === CELL_DOOR_MUSIC).length).toBe(before + 1);
    });

    it(`${index} : porte fermée ou torche en place : rien`, () => {
      const engine = started();
      const join = engine.world.getExitJoin(HotspotId.CELL_DOOR)!;
      const count = () => soundCalls(engine).filter((c) => c === CELL_DOOR_MUSIC).length;
      const before = count();
      // Porte fermée, torche cachée.
      join.blocked = 1;
      engine.world.fields.set(Field.TORCH_HIDE, 1);
      call(engine, index);
      // Porte ouverte, torche en place.
      join.blocked = 0;
      engine.world.fields.set(Field.TORCH_HIDE, 0);
      call(engine, index);
      expect(count()).toBe(before);
    });
  }

  it("la porte lue est celle du côté de la cellule extérieure (0x2712) : la séquence de la pièce 2 l'appelle à l'entrée", () => {
    const engine = started();
    expect(engine.world.getExitJoin(HotspotId.CELL_DOOR)).toBeDefined();
    // Les deux côtés de la porte partagent la même jonction.
    expect(engine.world.getExitJoin(0x2711)).toBe(engine.world.getExitJoin(HotspotId.CELL_DOOR));
  });
});

describe.skipIf(!hasOriginalFiles)("23 isSkorlInCell", () => {
  it("le Skorl n'est pas dans la cellule au début (pièce 3) : GENERAL = 1", () => {
    const engine = started();
    expect(engine.world.requireHotspot(HotspotId.SKORL).roomNumber).toBe(3);
    call(engine, 23);
    expect(engine.world.fields.get(Field.GENERAL)).toBe(1);
  });

  it("le Skorl dans la pièce 1 : GENERAL = 0 ; ailleurs (2, 4, 0xFFFF) : 1", () => {
    const engine = started();
    const skorl = engine.world.requireHotspot(HotspotId.SKORL);
    for (const [room, expected] of [[1, 0], [2, 1], [4, 1], [0xffff, 1], [1, 0]] as const) {
      skorl.roomNumber = room;
      engine.world.fields.set(Field.GENERAL, 7);
      call(engine, 23);
      expect(engine.world.fields.get(Field.GENERAL), `pièce ${room}`).toBe(expected);
    }
  });
});

describe.skipIf(!hasOriginalFiles)("24 ratpouchPushBricks", () => {
  it("ouvre la sortie des briques, vide la pile de Ratpouch et le lance vers la pièce 7 sans qu'on puisse l'interrompre", () => {
    const engine = started();
    const world = engine.world;
    const join = world.getExitJoin(HotspotId.BRICKS)!;
    expect(join.blocked).not.toBe(0);
    const ratpouch = world.activateHotspot(HotspotId.RATPOUCH)!;
    ratpouch.roomNumber = 2;
    ratpouch.setActions(0x821c00);
    ratpouch.currentActions.addFront(CurrentAction.DISPATCH_ACTION, 2);
    ratpouch.currentActions.addFront(CurrentAction.START_WALKING, 2);

    call(engine, 24);

    expect(join.blocked).toBe(0);
    expect(ratpouch.res.actions).toBe(0);
    expect(ratpouch.currentActions.action()).toBe(CurrentAction.DISPATCH_ACTION);
    expect(ratpouch.currentActions.top().roomNumber).toBe(7);
    // Une seule action : l'ancienne pile a été vidée.
    ratpouch.currentActions.pop();
    expect(ratpouch.currentActions.isEmpty()).toBe(true);
  });

  it("Ratpouch doit être actif (ScummVM déréférence un pointeur nul) : sinon erreur", () => {
    const engine = started();
    expect(engine.world.getActiveHotspot(HotspotId.RATPOUCH)).toBeNull();
    expect(() => call(engine, 24)).toThrow();
  });
});

describe.skipIf(!hasOriginalFiles)("26 pauseRatpouch", () => {
  it("Ratpouch en pause pour 0x7FFF images", () => {
    const engine = started();
    const ratpouch = engine.world.activateHotspot(HotspotId.RATPOUCH)!;
    ratpouch.characterMode = CharacterMode.NONE;
    ratpouch.delayCtr = 0;
    call(engine, 26);
    expect(ratpouch.characterMode).toBe(CharacterMode.PAUSED);
    expect(ratpouch.delayCtr).toBe(0x7fff);
  });

  it("Ratpouch doit être actif : sinon erreur", () => {
    const engine = started();
    expect(() => call(engine, 26)).toThrow();
  });
});
