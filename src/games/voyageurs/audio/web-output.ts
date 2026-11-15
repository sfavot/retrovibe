import { WebOpl } from "../../../audio/web-opl";
import { OPL_TICK_RATE, type OplOutput } from "./audio";

/**
 * Sortie des effets du navigateur : l'émulateur OPL2 commun (`src/audio/web-opl.ts`, AudioWorklet), horodaté à la milliseconde.
 * À part de `audio.ts` pour que les tests (sans Vite) n'importent pas le worklet.
 */
export function createWebOplOutput(): OplOutput {
  return new WebOpl({ tickRate: OPL_TICK_RATE });
}
