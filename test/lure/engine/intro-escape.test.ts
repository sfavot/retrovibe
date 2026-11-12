import { describe, expect, it } from "vitest";
import { TICK_MS } from "../../../src/games/lure/engine/cadence";
import { hasOriginalFiles, makeEngine } from "./test-host";

/** Lance l'introduction, avance de `at` ticks, presse Échap ; rend vrai si l'introduction est abandonnée dans les 3 secondes qui suivent. */
function escapeAt(at: number): { aborted: boolean; screen: Uint8Array | null } {
  const { engine, host } = makeEngine({ intro: true });
  for (let i = 0; i < at; i++) {
    engine.tick();
    host.clock += TICK_MS;
  }
  host.push({ type: "action", action: "escape" });
  for (let i = 0; i < 40 && engine.busy; i++) {
    engine.tick();
    host.clock += TICK_MS;
  }
  return { aborted: !engine.busy, screen: engine.sequenceScreen ? engine.sequenceScreen.palette.slice() : null };
}

describe.skipIf(!hasOriginalFiles)("introduction : Échap pendant les écrans fixes", () => {
  it("abandonne toute l'introduction pendant l'attente d'un écran, comme `Introduction::interruptableDelay` de ScummVM", () => {
    // Premier écran : fondu d'entrée (jusqu'au tick 14), attente de 5 s (ticks 15 à 77), puis fondu de sortie et fondu d'entrée du suivant.
    for (const at of [15, 16, 40, 76, 77]) expect(escapeAt(at).aborted, `au tick ${at}`).toBe(true);
    // Deuxième écran, même chose.
    for (const at of [107, 120, 150, 170]) expect(escapeAt(at).aborted, `au tick ${at}`).toBe(true);
  });

  it("une pression pendant un fondu est perdue, comme dans ScummVM (`paletteFadeIn` / `paletteFadeOut` vident les événements à chaque pas) : l'écran suivant vient seul", () => {
    for (const at of [0, 7, 14, 80, 90, 100]) expect(escapeAt(at).aborted, `au tick ${at}`).toBe(false);
  });
});
