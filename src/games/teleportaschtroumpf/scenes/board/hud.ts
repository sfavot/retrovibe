import { measureText, type PfnFont } from "../../data/font";
import type { Hy8 } from "../../data/hy8";
import type { Surface } from "../../engine/surface";
import type { Player } from "../../game/state";
import { hasIngredient } from "../../game/state";
import { INGREDIENT_COUNT } from "../../game/tables";
import { TEXT_COLOR } from "../common/text";
import { pointsText } from "../s03-info";

/**
 * Bandeau du bas du plateau (`1e52:060b`, appelée par `291e:125c` à chaque écran) : portrait du joueur, ingrédients de
 * l'objectif (grisés tant qu'ils manquent), puis les autres ingrédients possédés, points sur l'objectif et goutte de
 * rosée. Sprites de `s01a001s.hy8` : 0 à 5 portraits, 6 + i ingrédient possédé, 15 + i ingrédient manquant, 14 goutte,
 * 23 goutte grisée (aucun point).
 */
const PORTRAIT_X = 0x55;
export const BASE_Y = 0xb6;
export const TEXT_Y = 0xa7;
export const ICON_X = 0x50;
export const ICON_STEP = 0x12;
/** Décalage de la rangée des ingrédients non demandés (`0x55` au lieu de `0x50` dans l'original). */
const EXTRA_X = 0x55;
const SPRITE_OWNED = 6;
export const SPRITE_MISSING = 15;
const SPRITE_DROP = 14;
export const SPRITE_DROP_EMPTY = 23;

/**
 * Dessine le bandeau de `player` dans le tampon de travail. Sans `goal`, seul le portrait est dessiné : c'est l'état du
 * bandeau avant S19, qui montre ensuite les ingrédients et les points un par un (`1e52:0324`).
 */
export function drawHud(surface: Surface, hud: Hy8, font: PfnFont, player: Player, goal: { ingredients: number; points: number } | null): void {
  surface.drawSprite(hud, player.character, PORTRAIT_X, BASE_Y);
  if (goal === null) return;
  let slot = 0;
  for (let i = 0; i < INGREDIENT_COUNT; i++) {
    if ((goal.ingredients & (1 << i)) === 0) continue;
    const sprite = hasIngredient(player, i) ? SPRITE_OWNED + i : SPRITE_MISSING + i;
    surface.drawSprite(hud, sprite, ICON_X + slot * ICON_STEP, BASE_Y);
    slot++;
  }
  for (let i = 0; i < INGREDIENT_COUNT; i++) {
    if ((goal.ingredients & (1 << i)) !== 0 || !hasIngredient(player, i)) continue;
    surface.drawSprite(hud, SPRITE_OWNED + i, EXTRA_X + slot * ICON_STEP, BASE_Y);
    slot++;
  }
  const text = Uint8Array.from(pointsText(player.points, goal.points), (c) => c.charCodeAt(0));
  surface.drawText(font, text, ICON_X + slot * ICON_STEP, TEXT_Y, TEXT_COLOR);
  const dropX = ICON_X + 0xc + slot * ICON_STEP + measureText(font, text);
  surface.drawSprite(hud, player.points === 0 ? SPRITE_DROP_EMPTY : SPRITE_DROP, dropX, BASE_Y);
}
