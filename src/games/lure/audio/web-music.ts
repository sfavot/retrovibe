import { WebOpl } from "../../../audio/web-opl";
import { TIMER_RATE } from "./smf-player";
import type { MusicOutput } from "./audio";

/**
 * Sortie de la musique du navigateur : l'émulateur OPL2 commun (`src/audio/web-opl.ts`, AudioWorklet) réglé sur les 250 ticks par seconde
 * du pilote. À part de `audio.ts` pour que les tests (sans Vite) n'importent pas le worklet.
 */
export function createWebMusicOutput(): MusicOutput {
  return new WebOpl({ tickRate: TIMER_RATE });
}
