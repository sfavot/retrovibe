import { describe, expect, it } from "vitest";
import { NUM_SERVE_CUSTOMERS } from "../../../../src/games/lure/engine/bar";
import { CurrentAction, HotspotId } from "../../../../src/games/lure/engine/ids";
import { captureSave, parseSave, restoreSave } from "../../../../src/games/lure/engine/save";
import { hasOriginalFiles, makeEngine } from "../test-host";
import { barOf, enterRoom, stand, started } from "./helpers";

const SID_ROOM = 29;
/** Pied d'un client au comptoir de Sid : au-dessus de `(gridLine << 3) + 24` = 128. */
const AT_BAR = 100;
const AWAY = 150;

describe.skipIf(!hasOriginalFiles)("Bar (getBarPlace, BarmanLists)", () => {
  it("trois bars, la liste de chacun est vide au départ", () => {
    const engine = started(makeEngine().engine);
    const bar = barOf(engine);
    for (const room of [29, 32, 35]) {
      const entry = bar.getDetails(room);
      expect(entry.customers).toHaveLength(NUM_SERVE_CUSTOMERS);
      expect(entry.customers.every((c) => c.hotspotId === 0 && c.serveFlags === 0)).toBe(true);
      expect(entry.currentCustomer).toBeNull();
    }
    expect(() => bar.getDetails(30)).toThrow();
  });

  it("un client loin du comptoir marche vers la place libre de la ligne du bar", () => {
    const engine = started(makeEngine().engine);
    enterRoom(engine, SID_ROOM, 200, 60);
    const h = stand(engine, HotspotId.GWEN, SID_ROOM, 60, AWAY + 20);
    expect(engine.bar.getBarPlace(h)).toBe("keepTrying");
    expect(h.currentActions.action()).toBe(CurrentAction.START_WALKING);
    // y = (13 << 3) + 8 ; une place de 4 blocs libres depuis la droite de la grille.
    expect(h.destY).toBe(112);
    expect(h.destX % 8).toBe(0);
    // Pas encore dans la liste, et actionCtr reste nul : il refera la demande une fois arrivé.
    expect(barOf(engine).getDetails(SID_ROOM).customers.every((c) => c.hotspotId === 0)).toBe(true);
    expect(h.actionCtr).toBe(0);
  });

  it("au comptoir : prend un rang (0x82), actionCtr 1, tourné vers le haut ; puis attend d'être servi (0x80)", () => {
    const engine = started(makeEngine().engine);
    enterRoom(engine, SID_ROOM, 200, 60);
    const h = stand(engine, HotspotId.GWEN, SID_ROOM, 60, AT_BAR);
    expect(engine.bar.getBarPlace(h)).toBe("keepTrying");
    const entry = barOf(engine).getDetails(SID_ROOM);
    expect(entry.customers[0]).toEqual({ hotspotId: HotspotId.GWEN, serveFlags: 0x82 });
    expect(h.actionCtr).toBe(1);
    expect(engine.bar.getBarPlace(h)).toBe("keepTrying");
    entry.customers[0]!.serveFlags = 0;
    expect(engine.bar.getBarPlace(h)).toBe("gotThere");
  });

  it("actionCtr non nul mais absent de la liste : remis à zéro, il recommence", () => {
    const engine = started(makeEngine().engine);
    enterRoom(engine, SID_ROOM, 200, 60);
    const h = stand(engine, HotspotId.GWEN, SID_ROOM, 60, AT_BAR);
    h.actionCtr = 1;
    expect(engine.bar.getBarPlace(h)).toBe("keepTrying");
    expect(h.actionCtr).toBe(0);
  });

  it("bar plein (4 clients) : le cinquième attend sans prendre de rang", () => {
    const engine = started(makeEngine().engine);
    enterRoom(engine, SID_ROOM, 200, 60);
    const bar = barOf(engine);
    const entry = bar.getDetails(SID_ROOM);
    entry.customers.forEach((c, i) => {
      c.hotspotId = 0x500 + i;
      c.serveFlags = 0x82;
    });
    const h = stand(engine, HotspotId.GWEN, SID_ROOM, 60, AT_BAR);
    expect(engine.bar.getBarPlace(h)).toBe("keepTrying");
    expect(entry.customers.some((c) => c.hotspotId === HotspotId.GWEN)).toBe(false);
    expect(h.actionCtr).toBe(0);
  });

  it("le barman sert plusieurs clients l'un après l'autre : Gwen, Mallin puis le joueur", () => {
    const engine = started(makeEngine().engine);
    enterRoom(engine, SID_ROOM, 200, 60);
    const bar = barOf(engine);
    const entry = bar.getDetails(SID_ROOM);
    const sid = engine.world.requireActiveHotspot(HotspotId.SID);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    const gwen = stand(engine, HotspotId.GWEN, SID_ROOM, 60, AT_BAR);
    const mallin = stand(engine, HotspotId.MALLIN, SID_ROOM, 120, AT_BAR);
    player.setPosition(220, AT_BAR - player.heightCopy);

    // Les trois se présentent dans cet ordre : rangs 0, 1, 2.
    for (const h of [gwen, mallin, player]) engine.bar.getBarPlace(h);
    expect(entry.customers.slice(0, 3).map((c) => c.hotspotId)).toEqual([HotspotId.GWEN, HotspotId.MALLIN, HotspotId.PLAYER]);
    expect(entry.customers.slice(0, 3).every((c) => c.serveFlags === 0x82)).toBe(true);

    const served: number[] = [];
    const clients = [gwen, mallin, player];
    const state = { playerServed: false, playerReleased: false };
    for (let i = 0; i < 2500 && !state.playerReleased; i++) {
      engine.tick();
      for (const h of clients) {
        if (served.includes(h.hotspotId) && h !== player) continue;
        const own = entry.customers.find((c) => c.hotspotId === h.hotspotId);
        if (!own && h === player && state.playerServed) {
          state.playerReleased = true;
          continue;
        }
        if (h.actionCtr === 0) continue;
        if (engine.bar.getBarPlace(h) === "gotThere") {
          if (h === player) {
            if (!state.playerServed) {
              // Le joueur est au comptoir : le script de la boisson appelle barmanServe (méthode 56).
              state.playerServed = true;
              served.push(h.hotspotId);
              engine.methods.call(56, 0, 0, 0);
              expect(own!.serveFlags & 5).toBe(5);
            }
          } else {
            served.push(h.hotspotId);
            // Le PNJ a sa boisson et s'en va : sa place est libérée au prochain regard du barman.
            h.setPosition(h.x, AWAY - h.heightCopy);
          }
        }
      }
    }
    expect(served).toEqual([HotspotId.GWEN, HotspotId.MALLIN, HotspotId.PLAYER]);
    expect(state.playerReleased).toBe(true);
    // Une fois tout le monde servi, la liste est vidée et le barman reprend ses occupations.
    for (let i = 0; i < 40; i++) engine.tick();
    expect(entry.customers.every((c) => c.hotspotId === 0 && c.serveFlags === 0)).toBe(true);
    expect(entry.currentCustomer).toBeNull();
    expect(sid.frameNumber).toBeLessThan(sid.numFrames);
  });

  it("saveState / restoreState : l'état d'un bar en plein service revient tel quel, ainsi que par la sauvegarde du moteur", () => {
    const { engine } = makeEngine();
    started(engine);
    enterRoom(engine, SID_ROOM, 200, 60);
    const bar = barOf(engine);
    const entry = bar.getDetails(SID_ROOM);
    entry.customers[1] = { hotspotId: HotspotId.GWEN, serveFlags: 0x82 };
    entry.customers[3] = { hotspotId: HotspotId.PLAYER, serveFlags: 5 };
    entry.currentCustomer = 3;
    bar.ewanXOffset = true;
    const state = bar.saveState();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);

    const other = started(makeEngine().engine);
    barOf(other).restoreState(JSON.parse(JSON.stringify(state)));
    expect(barOf(other).saveState()).toEqual(state);
    expect(barOf(other).getDetails(SID_ROOM).currentCustomer).toBe(3);

    // Par la sauvegarde complète.
    const save = captureSave(engine);
    expect(save).not.toBeNull();
    const parsed = parseSave(JSON.parse(JSON.stringify(save)));
    const third = makeEngine().engine;
    expect(restoreSave(third, parsed!)).toBe(true);
    expect(barOf(third).saveState()).toEqual(state);

    // Sans état (ancienne sauvegarde) : listes vides ; `reset` aussi (redémarrage).
    barOf(third).restoreState(undefined);
    expect(barOf(third).getDetails(SID_ROOM).customers.every((c) => c.hotspotId === 0)).toBe(true);
    bar.reset();
    expect(bar.getDetails(SID_ROOM).currentCustomer).toBeNull();
    expect(bar.ewanXOffset).toBe(false);
  });
});
