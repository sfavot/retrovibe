import { describe, expect, it } from "vitest";
import { INVENTORY_TRIGGER, Var } from "../../../src/games/bass/engine/ids";
import { INVENTORY_TAP_LINES, type TapContext, tapKind } from "../../../src/games/bass/ui/input";
import { hasOriginalFiles, makeEngine } from "../engine/helpers";
import { Driver } from "../solution/driver";
import { PHASES } from "../solution/walkthrough";

/** Un toucher dans la bande du haut, sur une sortie, quitte la pièce d'un seul toucher (avant : il ouvrait seulement l'inventaire). */
describe.skipIf(!hasOriginalFiles)("sortie en haut de l'écran, sur les vrais fichiers", () => {
  /** La solution jouée jusqu'au premier écran dont une sortie touche la bande du haut (écran 7 : sortie de gauche, sur toute la hauteur). */
  function setup() {
    const { engine, host } = makeEngine();
    engine.startAfterIntro();
    const driver = new Driver(engine, host);
    driver.cycle(3);
    for (const phase of PHASES) {
      for (const step of phase.steps) {
        driver.run(step);
        if (driver.screen === 7) return { engine, host, driver };
      }
    }
    throw new Error("écran 7 non atteint");
  }

  it("zoneAt trouve la sortie sous le doigt, pas le déclencheur de la barre ; tapKind laisse le toucher agir", () => {
    const { engine, driver } = setup();
    const exit = driver.hotspots().find((h) => h.name === "left_exit_s7")!;
    expect(exit.y0).toBeLessThan(INVENTORY_TAP_LINES);
    const zone = engine.mouse.zoneAt(4, 5);
    expect(zone).toBe(exit.id);
    // Ailleurs sur les lignes 0 et 1, seul le déclencheur de la barre est là : le toucher y ouvre la barre.
    expect(engine.mouse.zoneAt(160, 0)).toBe(INVENTORY_TRIGGER);
    const context: TapContext = { barOpen: false, choosing: false, frozen: false, locked: false, zoneUnder: zone !== null && zone !== INVENTORY_TRIGGER };
    expect(tapKind(0, 5, context)).toBe("click");
    expect(tapKind(0, 5, { ...context, zoneUnder: false })).toBe("bar");
  });

  it("un seul toucher (déplacement puis clic) sur la sortie change d'écran", () => {
    const { engine, host, driver } = setup();
    driver.cycle(3);
    expect(engine.vars[Var.SCREEN]).toBe(7);
    driver.clickAt(4, 5);
    host.push({ type: "release", x: 4, y: 5 });
    for (let i = 0; i < 400 && driver.screen === 7; i++) driver.cycle();
    expect(driver.screen).not.toBe(7);
  });
});
