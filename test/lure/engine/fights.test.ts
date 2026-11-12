/**
 * Combats (groupe F) : combat gagné et perdu par une stratégie scriptée, déterminisme, sauvegarde refusée en combat, aller-retour de
 * `saveState` / `restoreState`, touches et souris. La comparaison aux combats de ScummVM est dans `fights-scummvm.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { FightsManager } from "../../../src/games/lure/engine/fights/index";
import type { LureEngine } from "../../../src/games/lure/engine/game";
import { Cursor, GameState, HotspotFlag, HotspotId, TickProc } from "../../../src/games/lure/engine/ids";
import { canSave, captureSave, restoreSave } from "../../../src/games/lure/engine/save";
import { Driver, type TestHost, hasOriginalFiles, makeEngine } from "./test-host";

const PIG = HotspotId.PIG;
const SKORL = HotspotId.SKORL_FIGHTER;
const HEIGHTS = ["fightCursorLeftTop", "fightCursorLeftMiddle", "fightCursorLeftBottom"] as const;

/**
 * Entrée directe dans la pièce du combat (commande `enter` du débogueur). Les pièces 6 et 49 ont une heure de sortie initiale `0xFFFFF` :
 * à la première entrée, ScummVM fait 300 secondes d'avance rapide (soustraction sur 32 bits non signés, voir `room.ts`), qui tirent au
 * hasard ; les graines et positions ci-dessous en tiennent compte.
 */
function startFight(room: number, seed: number) {
  const { engine, host } = makeEngine({ seed });
  const driver = new Driver(engine, host);
  driver.ticks(3);
  engine.room.leaveRoom();
  engine.room.setRoomNumber(room);
  engine.world.requireActiveHotspot(HotspotId.PLAYER).roomNumber = room;
  const fights = engine.fights as FightsManager;
  expect(fights.isFighting).toBe(true);
  return { engine, host, driver, fights };
}

/** Avance jusqu'à la fin du combat : marche vers l'adversaire, puis un coup à chaque hauteur tour à tour. Rend le nombre d'images. */
function play(ctx: { engine: LureEngine; host: TestHost; driver: Driver; fights: FightsManager }, foe: number, period: number): number {
  const { engine, host, driver, fights } = ctx;
  let t = 0;
  for (; t < 5000 && fights.isFighting; t++) {
    if (engine.busy) {
      driver.click(160, 100);
      continue;
    }
    if (t % period === 0) {
      host.push({ type: "actionEnd", action: "fightMoveLeft" });
      const dist = Math.abs(fights.record(HotspotId.PLAYER).fwtrue_x - fights.record(foe).fwtrue_x);
      if (dist > 32) host.push({ type: "action", action: "fightMoveLeft" });
      else host.push({ type: "action", action: HEIGHTS[Math.floor(t / period) % 3]! });
    }
    driver.ticks(1);
  }
  return t;
}

describe.skipIf(!hasOriginalFiles)("combats", () => {
  it("cochon gagné : la hache est au joueur, le joueur reprend son gestionnaire", () => {
    // Graine 5 : la stratégie à l'aveugle gagne (graines 5, 6, 8, 10, 12 sur 1 à 12).
    const ctx = startFight(6, 5);
    play(ctx, PIG, 8);
    const { engine, fights } = ctx;
    expect(fights.isFighting).toBe(false);
    expect(fights.record(PIG).fwhits).toBe(5);
    expect(fights.record(HotspotId.PLAYER).fwhits).toBe(42);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    expect(player.tickProcId).toBe(TickProc.PLAYER);
    expect([player.width, player.height]).toEqual([32, 48]);
    const axe = engine.world.requireHotspot(0x2738);
    expect(axe.roomNumber).toBe(HotspotId.PLAYER);
    expect(axe.flags & HotspotFlag.FOUND).not.toBe(0);
    expect(engine.world.requireHotspot(0x440).layer).toBe(0);
    expect(engine.gameState & GameState.RESTART).toBe(0);
    for (let i = 0; i < 5; i++) ctx.driver.ticks(1);
    expect(engine.dialogText !== null || engine.busy).toBe(true);
  });

  it("cochon perdu : fin de partie, puis la partie recommence sans combat", () => {
    const { engine, driver, fights } = startFight(6, 1);
    let t = 0;
    for (; t < 3000 && fights.isFighting; t++) {
      if (engine.busy) driver.click(160, 100);
      else driver.ticks(1);
    }
    expect(fights.isFighting).toBe(false);
    expect(fights.record(HotspotId.PLAYER).fwhits).toBe(42);
    expect(fights.record(PIG).fwhits).toBe(10);
    expect(engine.gameState & GameState.RESTORE_RESTART).toBe(GameState.RESTORE_RESTART);
    for (let i = 0; i < 40; i++) driver.ticks(1);
    expect(engine.room.roomNumber).toBe(1);
    expect(fights.record(HotspotId.PLAYER).fwhits).toBe(1);
    expect(fights.isFighting).toBe(false);
  });

  it("Skorl : le combat de la pièce 49 se monte et se gagne", () => {
    const ctx = startFight(49, 1);
    const rec = ctx.fights.record(HotspotId.PLAYER);
    expect([rec.fwenemy_ad, rec.fwweapon, rec.fwtrue_x, rec.fwtrue_y]).toEqual([SKORL, 0x445, 240, 136]);
    expect(ctx.engine.world.requireActiveHotspot(HotspotId.PLAYER).res.colorOffset).toBe(96);
    play(ctx, SKORL, 8);
    expect(ctx.fights.record(SKORL).fwhits).toBe(5);
    expect(ctx.fights.isFighting).toBe(false);
  });

  it("déterministe : même graine, même combat ; autre graine, autre combat", () => {
    const trace = (seed: number) => {
      const ctx = startFight(6, seed);
      return play(ctx, PIG, 8) + ":" + ctx.fights.record(PIG).fwhits + ":" + ctx.engine.rng.state;
    };
    expect(trace(1)).toBe(trace(1));
    expect(trace(2)).not.toBe(trace(1));
  });

  it("sauvegarde refusée en combat, permise après", () => {
    const ctx = startFight(6, 1);
    ctx.driver.ticks(3);
    expect(ctx.engine.fights.isFighting).toBe(true);
    expect(canSave(ctx.engine)).toBe(false);
    expect(captureSave(ctx.engine)).toBeNull();
    play(ctx, PIG, 8);
    while (ctx.engine.busy) ctx.driver.click(160, 100);
    ctx.driver.ticks(2);
    expect(canSave(ctx.engine)).toBe(true);
  });

  it("saveState / restoreState : aller-retour des trois enregistrements, dans une sauvegarde aussi", () => {
    const ctx = startFight(6, 5);
    play(ctx, PIG, 8);
    while (ctx.engine.busy) ctx.driver.click(160, 100);
    ctx.driver.ticks(2);
    const state = JSON.parse(JSON.stringify(ctx.fights.saveState()));
    expect(state.fighters).toHaveLength(3);

    const other = makeEngine().engine;
    const copy = other.fights as FightsManager;
    copy.restoreState(state);
    expect(copy.saveState()).toEqual(state);
    expect(copy.record(PIG).fwhits).toBe(5);
    expect(copy.isFighting).toBe(false);
    copy.restoreState({ fighters: "abîmé" });
    expect(copy.record(PIG).fwhits).toBe(0);

    const save = JSON.parse(JSON.stringify(captureSave(ctx.engine)));
    const fresh = makeEngine().engine;
    expect(restoreSave(fresh, save)).toBe(true);
    expect((fresh.fights as FightsManager).saveState()).toEqual(state);
  });

  it("souris : le curseur suit la position, le bouton choisit le coup ; clavier : touche tenue jusqu'au relâchement", () => {
    const { engine, host, driver, fights } = startFight(6, 1);
    const player = engine.world.requireActiveHotspot(HotspotId.PLAYER);
    const rec = fights.record(HotspotId.PLAYER);
    driver.ticks(16);
    while (engine.busy) driver.click(160, 100); // le texte d'entrée apparaît à la treizième image
    const at = (x: number, y: number) => {
      host.push({ type: "pointer", x, y, buttons: 0 });
      driver.ticks(1);
      return engine.room.cursor;
    };
    expect(at(rec.fwtrue_x - 40, 100)).toBe(Cursor.LEFT_ARROW);
    expect(at(rec.fwtrue_x + 60, 100)).toBe(Cursor.RIGHT_ARROW);
    expect(at(rec.fwtrue_x + 10, player.y)).toBe(Cursor.FIGHT_UPPER);
    expect(at(rec.fwtrue_x + 10, player.y + 20)).toBe(Cursor.FIGHT_MIDDLE);
    expect(at(rec.fwtrue_x + 10, player.y + 50)).toBe(Cursor.FIGHT_LOWER);
    expect(rec.fwmove_number).toBe(3);
    host.push({ type: "pointer", x: rec.fwtrue_x + 10, y: player.y + 20, buttons: 1 });
    driver.ticks(1);
    expect(rec.fwmove_number).toBe(2 + 10);
    host.push({ type: "pointer", x: rec.fwtrue_x + 10, y: player.y + 20, buttons: 2 });
    driver.ticks(1);
    expect(rec.fwmove_number).toBe(2 + 5);

    host.push({ type: "pointer", x: 5, y: 100, buttons: 0 }, { type: "action", action: "fightCursorRightBottom" });
    driver.ticks(1);
    expect(rec.fwmove_number).toBe(8);
    driver.ticks(3);
    expect(rec.fwmove_number).toBe(8); // la touche reste prise en compte tant qu'elle n'est pas relâchée
    host.push({ type: "action", action: "fightMoveRight" });
    driver.ticks(1);
    expect(rec.fwmove_number).toBe(14); // une autre touche la remplace
    host.push({ type: "actionEnd", action: "fightMoveRight" });
    driver.ticks(1);
    expect(rec.fwmove_number).toBe(0); // curseur à gauche, aucun bouton
  });

  it("méthodes 15 et 17 et gestionnaires 38 et 39 ne sont plus des souches", () => {
    const { engine } = makeEngine();
    expect(engine.methods.isStub(15)).toBe(false);
    expect(engine.methods.isStub(17)).toBe(false);
    expect(engine.handlers.stubs).not.toContain("fighterAnimHandler");
    expect(engine.handlers.stubs).not.toContain("playerFightAnimHandler");
  });
});
