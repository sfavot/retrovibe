/** Démarrage réel sur `AUTO00` (fichiers du jeu) jusqu'au chargement de l'écran de protection `XX2` et à son contournement. */
import { describe, expect, it } from "vitest";
import { TestHost } from "../../../src/games/croisiere/engine/host";
import { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { gameFiles, hasOriginalFiles } from "./support";

describe.skipIf(!hasOriginalFiles)("démarrage sans tête", () => {
  it("charge SUPER, LOGO puis XX2 au tour 971 et contourne la protection", () => {
    const engine = new CroisiereEngine(new TestHost(), { files: gameFiles(), seed: 1 });
    const e = engine.state;
    let frame = 0;
    while (e.overlays.findLoaded("XX2") === 0 && frame < 2000) {
      engine.runFrame();
      frame++;
    }
    expect(frame).toBe(971);
    expect(e.overlays.entries.slice(1, 5).map((o) => o.name)).toEqual(["AUTO00", "SUPER", "LOGO", "XX2"]);
    expect(e.protectionCode).toBe(-29430);
    engine.runFrame();
    expect(e.gameSpeed).toBe(100);
    engine.runFrame();
    expect(e.overlays.findLoaded("XX2")).toBe(0);
    expect(e.overlays.findLoaded("I00")).toBe(5);
    expect(e.procs.some((p) => p.overlayNumber === 2 && p.scriptNumber === 4)).toBe(true);
  });
});
