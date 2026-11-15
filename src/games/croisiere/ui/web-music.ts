import { WebOpl } from "../../../audio/web-opl";
import { OPL_TICK_MS } from "../engine/sound-service";

/**
 * Sortie AdLib du navigateur : l'émulateur OPL2 commun (`src/audio/web-opl.ts`, AudioWorklet) réglé sur le callback de 50 Hz du pilote
 * (`OPL_TICK_MS`, plan.md D7). À part pour que les tests (sans Vite) n'importent pas le worklet.
 */
export function createWebMusicOutput(): WebOpl {
  return new WebOpl({ tickRate: 1000 / OPL_TICK_MS });
}
