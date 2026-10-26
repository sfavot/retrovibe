/**
 * Messages 3D du HUD : quel message du monde devient quel texte flottant (teinte et type de `gm_message_spawn`, `00422f8c`), et
 * quand l'écran de pause en ajoute un. Les appels de l'exécutable sont `FUN_00458f88` (ramassages), `gm_objective_unregister`
 * (`0043ce6c`, objectifs), `gm_player_die` / `0043c046` (« Game over ! ») et `gm_screen_pause` (`00419058`).
 */
import type { MessageType } from "../text3d";
import type { HudMessage } from "./state";

/** Teintes : lignes `0x10`, `0x04`, `0x01`, `0x14` de la table de couleurs du bloc 11003 (rouge, puis les trois autres familles). */
export const TINT = { weapon: 0x1000, powerUp: 0x400, bonus: 0x100, objective: 0x1400, gameOver: 0x1000, menu: 0x400 } as const;

/** Tables de chaînes concernées. */
const TABLE_OBJECTIVES = 20;
const TABLE_PICKUPS = 100;
/** Dans la table 20 : « Accompli » (objectif final) et « Game over ! ». */
const OBJECTIVE_DONE = 0;
const GAME_OVER = 10;

/** Ramassages 100 à 102 et 105 à 108 : teinte `0x400` ; 110 à 113 : `0x100` ; 0 à 19 (armes) : `0x1000` (`00458f88`). */
function pickupTint(id: number): number {
  if (id >= 110) return TINT.bonus;
  if (id >= 100) return TINT.powerUp;
  return TINT.weapon;
}

/**
 * Teinte et type d'un message du monde. Type 10 : « Accompli » de l'objectif final et « Game over ! », figés au centre jusqu'à la sortie
 * du niveau ; type 0 : tout le reste (arme ramassée, objectif de groupe), qui traverse l'écran en 70 ticks.
 */
export function messageStyle(m: Pick<HudMessage, "textTable" | "textId">): { tint: number; type: MessageType } {
  if (m.textTable === TABLE_OBJECTIVES) {
    if (m.textId === GAME_OVER) return { tint: TINT.gameOver, type: 10 };
    return { tint: TINT.objective, type: m.textId === OBJECTIVE_DONE ? 10 : 0 };
  }
  return { tint: m.textTable === TABLE_PICKUPS ? pickupTint(m.textId) : TINT.weapon, type: 0 };
}

/** Clé d'un message du monde : `tick + ticksLeft` ne change pas pendant sa vie, donc un message déjà vu garde la même clé. */
export const messageKey = (m: HudMessage, tick: number): string => `${m.textTable}:${m.textId}:${tick + m.ticksLeft}`;
