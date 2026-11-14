import { WebOpl } from "../../../audio/web-opl";
import type { MusicOutput } from "../audio/audio";
import { MUSIC_TICKS_PER_SECOND } from "../audio/audio";

/**
 * Sortie de la musique du navigateur : l'émulateur OPL2 commun (`src/audio/web-opl.ts`, AudioWorklet) réglé sur les 50 ticks par
 * seconde de la minuterie d'AdLib de BASS. À part de `audio.ts` pour que les tests (sans Vite) n'importent pas le worklet.
 */
export function createWebMusicOutput(): MusicOutput & { setVolume(level: number): void } {
  return new WebOpl({ tickRate: MUSIC_TICKS_PER_SECOND });
}
