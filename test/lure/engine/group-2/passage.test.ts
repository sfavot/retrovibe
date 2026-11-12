import { describe, expect, it } from "vitest";
import { gameTextToUnicode } from "../../../../src/games/lure/data/charset";
import type { LureEngine } from "../../../../src/games/lure/engine/game";
import { Field, GameState, HotspotId } from "../../../../src/games/lure/engine/ids";
import { captureSave, parseSave, restoreSave } from "../../../../src/games/lure/engine/save";
import { Play } from "../../solution/runner";
import { HS, ZONE_CELL_END_ROOM, ZONE_CELL_STEPS } from "../../solution/zone-cell";
import { type TestHost, hasOriginalFiles, makeEngine } from "../test-host";

/** Pièces traversées, dans l'ordre, par la solution de la zone (sans doublon consécutif). */
const EXPECTED_ROOMS = [1, 2, 3, 4, 3, 2, 7, 8, 9, 10];

/** Capture, aller-retour par du vrai JSON (ce que fait un emplacement), puis reprise dans un moteur neuf (le pointeur est celui de la souris). */
function resume(engine: LureEngine): { engine: LureEngine; host: TestHost } {
  const save = captureSave(engine);
  expect(save, "sauvegarde refusée entre deux étapes").not.toBeNull();
  const parsed = parseSave(JSON.parse(JSON.stringify(save)));
  expect(parsed).not.toBeNull();
  const next = makeEngine();
  expect(restoreSave(next.engine, parsed!)).toBe(true);
  Object.assign(next.engine.mouse, engine.mouse);
  next.engine.room.mouseX = engine.mouse.x;
  next.engine.room.mouseY = engine.mouse.y;
  return next;
}

/** Note la pièce courante quand elle change (la pièce 0 d'avant le premier tick est ignorée). */
function noteRoom(rooms: number[], engine: LureEngine): void {
  const room = engine.room.roomNumber;
  if (room !== 0 && rooms.at(-1) !== room) rooms.push(room);
}

function outcome(engine: LureEngine) {
  const world = engine.world;
  return {
    room: engine.room.roomNumber,
    caught: (engine.gameState & GameState.CAUGHT) !== 0,
    prisonerDead: world.fields.get(Field.PRISONER_DEAD),
    torchHidden: world.fields.get(Field.TORCH_HIDE),
    bricksBlocked: world.getExitJoin(HotspotId.BRICKS)!.blocked,
    serfFreed: world.fields.get(14),
    ratpouchActive: world.getActiveHotspot(HotspotId.RATPOUCH) !== null,
    bottleInInventory: world.requireHotspot(HS.BOTTLE).roomNumber === HotspotId.PLAYER,
    bottleFilled: world.fields.get(Field.BOTTLE_FILLED),
    knifeInInventory: world.requireHotspot(HS.KNIFE).roomNumber === HotspotId.PLAYER,
  };
}

const EXPECTED_OUTCOME = {
  room: ZONE_CELL_END_ROOM,
  caught: false,
  prisonerDead: 3,
  torchHidden: 2,
  bricksBlocked: 0,
  serfFreed: 1,
  ratpouchActive: true,
  // La liqueur est donnée (champ 18 : 0 vide, 1 pleine, 2 donnée) ; la bouteille reste à Diermot, comme le couteau.
  bottleInInventory: true,
  bottleFilled: 2,
  knifeInInventory: true,
};

describe.skipIf(!hasOriginalFiles)("passage : la zone de la cellule (pièces 1 à 9, jusqu'au village)", () => {
  it("la solution, jouée par de vrais clics, mène du début de la partie au village sans être capturé", () => {
    const { engine, host } = makeEngine();
    const play = new Play(engine, host);
    const rooms: number[] = [];
    play.run(ZONE_CELL_STEPS, () => {
      // Ni capture ni redémarrage à aucun moment (un redémarrage ramènerait en pièce 1 avec l'état neuf).
      expect(engine.gameState & GameState.CAUGHT).toBe(0);
      noteRoom(rooms, engine);
    });
    noteRoom(rooms, engine);

    expect(rooms).toEqual(EXPECTED_ROOMS);
    expect(outcome(engine)).toEqual(EXPECTED_OUTCOME);
    expect(play.log.steps).toBe(ZONE_CELL_STEPS.length);

    // Ce que Diermot a lu en chemin : la torche, le tonneau, la bouteille remplie, la mort du prisonnier.
    const text = play.log.dialogs.join("\n");
    expect(text).toContain("La torche glisse");
    expect(text).toContain("forte liqueur Skorl");
    expect(text).toContain("dernières paroles");
    // L'inventaire en fin de zone.
    expect(play.inventory()).toContain(gameTextToUnicode(engine.text(engine.world.requireHotspot(HS.KNIFE).nameId)));
  });

  it("même solution avec une sauvegarde et une reprise dans un moteur neuf après chaque étape : même issue", () => {
    let { engine, host } = makeEngine();
    const rooms: number[] = [];
    const pointerHistory: Array<[number, number]> = [];
    for (const [index, step] of ZONE_CELL_STEPS.entries()) {
      const play = new Play(engine, host);
      noteRoom(rooms, engine);
      try {
        play.run([step]);
      } catch (error) {
        throw new Error(`étape ${index} (${JSON.stringify(step, (_k, v) => (typeof v === "function" ? "fn" : v))}) : ${(error as Error).message}`);
      }
      expect(engine.gameState & GameState.CAUGHT, `capturé à l'étape ${index}`).toBe(0);
      pointerHistory.push([engine.mouse.x, engine.mouse.y]);
      ({ engine, host } = resume(engine));
    }
    noteRoom(rooms, engine);

    expect(rooms).toEqual(EXPECTED_ROOMS);
    expect(outcome(engine)).toEqual(EXPECTED_OUTCOME);
    expect(pointerHistory).toHaveLength(ZONE_CELL_STEPS.length);
  });

  it("la sauvegarde d'une partie en cours de zone se relit identique (aller-retour)", () => {
    const { engine, host } = makeEngine();
    const play = new Play(engine, host);
    // Jusqu'à la salle de torture, Ratpouch libéré.
    play.run(ZONE_CELL_STEPS.slice(0, 12));
    const first = captureSave(engine);
    expect(first).not.toBeNull();
    const next = resume(engine);
    expect(JSON.stringify(captureSave(next.engine))).toBe(JSON.stringify(first));
  });
});
