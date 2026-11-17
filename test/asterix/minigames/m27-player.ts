import { VideoPlayer, markerValue } from "../../../src/engine/infogrames/video";
import { MARKER_ZONES, MAX_POS, MIN_POS, MOVE_NONE, zoneOf, type TempeteState } from "../../../src/games/asterix/scenes/minigames/m27";
import type { Launched } from "../game-helpers";
import { minigameState, type MinigamePlayer } from "./harness";

/** Un marqueur `08` de la vidéo : l'image qui le porte et sa valeur. */
export interface Wave {
  frame: number;
  value: number;
}

/** Images de la vidéo où un marqueur lu à l'image `frame` touche : le danger est jugé de `frame + 2` à `frame + 5`. */
export const DANGER_FIRST = 2;
export const DANGER_LAST = 5;
/** Deux marqueurs à moins de 11 images l'un de l'autre s'évitent d'un seul placement (un mouvement dure 8 images). */
const CLUSTER_FRAMES = 10;

/** Marqueurs de la vidéo du mini-jeu, lus dans une copie neuve du fichier (le lecteur du jeu n'est pas touché). */
export async function wavesOf(run: Launched, video: string): Promise<Wave[]> {
  const player = new VideoPlayer(await run.rt.ctx.resources.video(video));
  const waves: Wave[] = [];
  player.seek(player.frameCount - 1, (frame, markers) => {
    for (const marker of markers) waves.push({ frame, value: markerValue(marker) });
  });
  return waves;
}

/** Zones interdites par les prochains marqueurs (le premier pas encore passé et ceux qui le suivent de près), puis par le groupe d'après. */
function forbidden(waves: readonly Wave[], frame: number): [Set<number>, Set<number>] {
  const threats = waves.filter((wave) => MARKER_ZONES[wave.value] && wave.frame + DANGER_LAST > frame);
  const first = threats[0];
  const near = threats.filter((wave) => wave.frame <= first.frame + CLUSTER_FRAMES);
  const next = threats[near.length];
  const later = next ? threats.filter((wave) => wave.frame >= next.frame && wave.frame <= next.frame + CLUSTER_FRAMES) : [];
  const zones = (group: readonly Wave[]): Set<number> => new Set(group.flatMap((wave) => MARKER_ZONES[wave.value]));
  return [first ? zones(near) : new Set(), zones(later)];
}

/** Distance de `pos` à la position la plus proche hors des zones `zones`. */
function distanceToSafety(pos: number, zones: ReadonlySet<number>): number {
  let best = Infinity;
  for (let other = MIN_POS; other <= MAX_POS; other++) if (!zones.has(zoneOf(other))) best = Math.min(best, Math.abs(other - pos));
  return best;
}

/**
 * Touche à presser à cette image, `null` s'il n'y a rien à faire. En danger au prochain groupe de marqueurs : la position
 * sûre la plus proche. Déjà à l'abri : on se rapproche, sans quitter l'abri, de ce qui sera sûr au groupe d'après (deux
 * mouvements ne tiennent pas toujours entre deux vagues).
 */
export function dodgeKey(state: TempeteState, waves: readonly Wave[]): string | null {
  if (state.phase === 0 || state.move !== MOVE_NONE || state.hit || state.won) return null;
  const [now, later] = forbidden(waves, state.frame);
  const safe = (pos: number): boolean => pos >= MIN_POS && pos <= MAX_POS && !now.has(zoneOf(pos));
  let best = state.pos;
  let bestCost = Infinity;
  const consider = (pos: number): void => {
    const away = Math.abs(pos - state.pos);
    const cost = safe(state.pos) ? distanceToSafety(pos, later) * 10 + away : away * 10 + distanceToSafety(pos, later);
    if (cost < bestCost) [best, bestCost] = [pos, cost];
  };
  if (safe(state.pos)) {
    consider(state.pos);
    for (const step of [-1, 1]) for (let pos = state.pos + step; safe(pos); pos += step) consider(pos);
  } else for (let pos = MIN_POS; pos <= MAX_POS; pos++) if (safe(pos)) consider(pos);
  return best < state.pos ? "ArrowLeft" : best > state.pos ? "ArrowRight" : null;
}

/** Robot de la Tempête : se range avant chaque vague pour gagner ; reste au centre pour perdre (toutes les vidéos y frappent). */
export const playM27: MinigamePlayer = async (run, win) => {
  const state = minigameState<TempeteState>(run);
  const waves = win ? await wavesOf(run, state.video) : [];
  let pressedAt = -1;
  while (run.screen === "minigame") {
    const key = win && state.frame > pressedAt ? dodgeKey(state, waves) : null;
    if (key) {
      pressedAt = state.frame;
      await run.tap(key);
    } else await run.frame();
  }
};
