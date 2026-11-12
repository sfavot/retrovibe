import { describe, expect, it } from "vitest";
import { GameState } from "../../../src/games/lure/engine/ids";
import { Driver, hasOriginalFiles, makeEngine } from "./test-host";

/** Fin de partie (`GS_RESTORE`) : la question « Recommencer / Restituer » ne bloque pas le moteur, elle l'attend en séquence. */
describe.skipIf(!hasOriginalFiles)("fin de partie : recommencer ou restituer", () => {
  function setup() {
    const { engine, host } = makeEngine();
    const driver = new Driver(engine, host);
    driver.ticks(5);
    let answer: ((restart: boolean) => void) | undefined;
    let asked = 0;
    (host as { chooseRestartRestore?: (answer: (restart: boolean) => void) => void }).chooseRestartRestore = (reply) => {
      asked++;
      answer = reply;
    };
    return { engine, driver, reply: (restart: boolean) => answer!(restart), asked: () => asked };
  }

  it("le moteur attend la réponse (monde figé) tant que l'hôte n'a pas répondu, puis recommence", () => {
    const { engine, driver, reply, asked } = setup();
    engine.gameState |= GameState.RESTORE_RESTART;
    driver.ticks(3);
    expect(asked()).toBe(1);
    expect(engine.busy).toBe(true);
    const ticks = engine.ticks;
    driver.ticks(20);
    expect(asked()).toBe(1);
    expect(engine.busy).toBe(true);
    expect(engine.ticks).toBe(ticks + 20);

    reply(true);
    driver.ticks(5);
    expect(engine.busy).toBe(false);
    expect(engine.room.roomNumber).toBe(1);
    expect(engine.gameState & GameState.RESTORE).toBe(0);
  });

  it("sans réponse « recommencer » (partie restituée par l'hôte), la séquence abandonnée ne relance rien", () => {
    const { engine, driver, asked } = setup();
    engine.gameState |= GameState.RESTORE_RESTART;
    driver.ticks(3);
    expect(asked()).toBe(1);
    engine.beginResume();
    engine.gameState = 0;
    driver.ticks(10);
    expect(asked()).toBe(1);
    expect(engine.busy).toBe(false);
    expect(engine.gameState & GameState.RESTART).toBe(0);
  });

  it("sans méthode sur l'hôte, la partie recommence tout de suite (comportement par défaut)", () => {
    const { engine, host } = makeEngine();
    const driver = new Driver(engine, host);
    driver.ticks(5);
    engine.gameState |= GameState.RESTORE_RESTART;
    driver.ticks(5);
    expect(engine.busy).toBe(false);
    expect(engine.gameState & GameState.RESTORE).toBe(0);
  });
});
