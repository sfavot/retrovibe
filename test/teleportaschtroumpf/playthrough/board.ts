import { doorClassAt } from "../../../src/games/teleportaschtroumpf/game/board";
import type { Game } from "../../../src/games/teleportaschtroumpf/game/rules";
import { hasIngredient } from "../../../src/games/teleportaschtroumpf/game/state";
import { DOORS, HAZARDS, JUMP_STEP, minigameInfo, type Row } from "../../../src/games/teleportaschtroumpf/game/tables";
import { MINIGAME_IDS } from "../../../src/games/teleportaschtroumpf/scenes/minigames";
import type { BorlandRandom } from "../../../src/games/teleportaschtroumpf/engine/rng";

/**
 * Visée des portes : le plateau est un seul chemin de 18 segments (écran 1 haut, écran 1 bas, écran 2 haut…), chacun de
 * 0x140 pixels. Une position se ramène à `segment × 0x140 + x` ; le robot choisit une porte (table `DOORS` de `game/`), marche
 * dans sa direction aux flèches, s'arrête au centre de la zone et appuie sur Espace.
 */

export const SEGMENT_WIDTH = 0x140;
/** Centre de chaque zone de porte (gauche 7..0x6A, centre 0x6C..0xD3, droite 0xD5..0x13A). */
export const ZONE_CENTER = [0x38, 0x90, 0x107] as const;
/** Tolérance d'arrêt : la course fait 8 px par image, la zone la plus étroite en fait 104. */
export const STOP_MARGIN = 10;

export const segmentOf = (screen: number, row: Row): number => (screen - 1) * 2 + (row === "bottom" ? 1 : 0);
export const absoluteX = (screen: number, row: Row, x: number): number => segmentOf(screen, row) * SEGMENT_WIDTH + x;

export interface DoorTarget {
  /** Position absolue visée (centre de la zone). */
  at: number;
  segment: number;
  zone: 0 | 1 | 2;
  /** Code de scène derrière la porte. */
  scene: number;
}

/** Les portes que le robot sait viser : mini-jeux ordinaires, et le puits aux vœux s'il est ouvert ce tour. */
export function doorTargets(game: Game): DoorTarget[] {
  const out: DoorTarget[] = [];
  for (const [index, screen] of DOORS.entries()) {
    for (const row of ["top", "bottom"] as const) {
      for (const zone of [0, 1, 2] as const) {
        const scene = screen[row][zone];
        if (scene === null) continue;
        const kind = doorClassAt(index + 1, row, ZONE_CENTER[zone]);
        const well = scene === 14 && kind === "well" && game.state.turn.wellOpen;
        const minigame = MINIGAME_IDS.includes(scene) && (kind === "door" || kind === "notFull");
        if (!well && !minigame) continue;
        const segment = segmentOf(index + 1, row);
        out.push({ at: segment * SEGMENT_WIDTH + ZONE_CENTER[zone], segment, zone, scene });
      }
    }
  }
  return out;
}

/**
 * Choisit la porte du tour : la plus proche, avec un tirage pour varier, un attrait pour les ingrédients qui manquent à l'objectif
 * (les mini-jeux à points tant qu'il manque des points), une pénalité pour ce qui est déjà acquis et pour les portes déjà franchies
 * (`visits` : nombre de passages de ce joueur par scène) et un attrait pour les scènes pas encore jouées dans la partie (`played`).
 */
export function pickDoor(game: Game, rng: BorlandRandom, visits: ReadonlyMap<number, number>, played: ReadonlySet<number>): DoorTarget | null {
  const p = game.player;
  const here = absoluteX(p.screen, p.row, p.x);
  const goal = game.state.goal;
  let best: { door: DoorTarget; cost: number } | null = null;
  for (const door of doorTargets(game)) {
    let cost = Math.abs(door.at - here) / SEGMENT_WIDTH + rng.below(150) / 100 + 0.8 * (visits.get(door.scene) ?? 0) - (played.has(door.scene) ? 0 : 2);
    const info = minigameInfo(door.scene);
    if (info?.kind === "ingredient" && info.ingredient !== undefined) {
      if (hasIngredient(p, info.ingredient)) cost += 4;
      else if ((goal.ingredients & (1 << info.ingredient)) !== 0) cost -= 4;
      else cost += 1.5;
    } else if (info?.kind === "points") cost += p.points < goal.points ? -1.5 : 1.5;
    else if (info?.kind === "bird" || info?.kind === "steal") cost += 0.5;
    if (!best || cost < best.cost) best = { door, cost };
  }
  return best?.door ?? null;
}

/**
 * Saut au-dessus d'un piège de marche (`HAZARDS` avec `walk`) : le saut de 68 px franchit les 48 px du piège s'il part d'une zone étroite
 * juste avant (vers la droite : `[max − 68 + 2, min − 2]`) ou juste après (vers la gauche : `[max + 2, min + 68 − 2]`). Rend vrai si le
 * pion est dans cette zone, pour un piège situé entre lui et `toward` (abscisse visée dans le segment, ou bord).
 */
export function shouldJump(screen: number, row: Row, x: number, dir: -1 | 1, toward: number): boolean {
  for (const h of HAZARDS) {
    if (h.screen !== screen || h.row !== row || !h.walk) continue;
    const [min, max] = h.walk;
    if (dir > 0 && min > x && min <= toward && x >= max - JUMP_STEP + 2 && x <= min - 2) return true;
    if (dir < 0 && max < x && max >= toward && x >= max + 2 && x <= min + JUMP_STEP - 2) return true;
  }
  return false;
}
