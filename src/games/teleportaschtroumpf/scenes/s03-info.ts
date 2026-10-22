import type { PfnFont } from "../data/font";
import type { Hy8 } from "../data/hy8";
import type { Mcg } from "../data/mcg";
import type { Game } from "../game/rules";
import { hasIngredient } from "../game/state";
import { INGREDIENT_COUNT } from "../game/tables";
import type { SceneContext } from "../engine/scene";
import { TEXT_COLOR, loadDefaultFont } from "./common/text";

/** Nombre de graduations de la barre de temps (`1e20:0007`). */
export const TIME_GRADUATIONS = 27;

/** Ressources de l'écran info S03. */
export interface InfoResources {
  mcg: Mcg;
  sprites: Hy8;
  font: PfnFont;
}

export async function loadInfo(ctx: SceneContext): Promise<InfoResources> {
  const [mcg, sprites, font] = await Promise.all([ctx.resources.mcg("s03a001d.mcg"), ctx.resources.hy8("s03a000s.hy8"), loadDefaultFont(ctx)]);
  return { mcg, sprites, font };
}

/**
 * Nombre de graduations allumées : `min(27, ⌊temps écoulé × 27 / durée⌋)`. Reproduit le calcul 16 bits de l'original
 * (`IMUL AX,AX,0x1b` puis `DIV` non signé, `1e20:0015`) : le produit est tronqué à 16 bits, si bien que la barre retombe
 * quand le temps écoulé dépasse 2427 s (parties de 60 min et plus). Défaut de l'original, conservé.
 */
export function timeGraduations(elapsedSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const product = (Math.floor(elapsedSeconds) * TIME_GRADUATIONS) & 0xffff;
  return Math.min(TIME_GRADUATIONS, Math.floor(product / durationSeconds));
}

/** Texte « points/objectif » d'un joueur (`1e20:0007`) : `5/13`, `12/13` ; l'objectif a toujours deux chiffres. */
export function pointsText(points: number, goalPoints: number): string {
  return `${points}/${String(goalPoints).padStart(2, "0")}`;
}

const PLAYER_ROW_HEIGHT = 0x2e;
const PORTRAIT_X = 0x59;
const PORTRAIT_Y = 0x36;
const ICON_Y = 0x30;
const ICON_X = 0x57;
const ICON_STEP = 0x0e;
const TEXT_X = 0x52;
const TEXT_Y = 0x20;
const BAR_X = 0x126;
const BAR_Y = 0xb3;
const BAR_STEP = 5;
const SPRITE_BAR = 0x18;
const SPRITE_INGREDIENT_OWNED = 6;
const SPRITE_INGREDIENT_MISSING = 0xf;
const SPRITE_DROP = 0xe;
const SPRITE_DROP_EMPTY = 0x17;

/**
 * Dessine l'écran info S03 dans la surface (`1e20:0007`) : palette et fond de `s03a001d.mcg`, barre de temps, puis une
 * rangée par joueur : portrait, ingrédients (ceux de l'objectif d'abord, possédés ou non, puis les autres possédés),
 * points sur l'objectif et goutte de rosée (grisée à 0 point). Le fond (tampon B) contient tout le dessin.
 */
export function drawInfo(ctx: SceneContext, resources: InfoResources, game: Game): void {
  const { surface } = ctx;
  const { state } = game;
  const { mcg, sprites, font } = resources;
  ctx.palette.load(mcg.palette);
  surface.drawMcg(mcg);
  const graduations = timeGraduations(state.elapsed, state.durationSeconds);
  for (let i = 0; i < graduations; i++) surface.drawSprite(sprites, SPRITE_BAR, BAR_X, BAR_Y - i * BAR_STEP);

  state.players.forEach((player, row) => {
    const top = row * PLAYER_ROW_HEIGHT;
    surface.drawSprite(sprites, player.character, PORTRAIT_X, PORTRAIT_Y + top);
    let slot = 0;
    const required = (k: number) => (state.goal.ingredients & (1 << k)) !== 0;
    for (let k = 0; k < INGREDIENT_COUNT; k++) {
      if (!required(k)) continue;
      slot++;
      const sprite = hasIngredient(player, k) ? SPRITE_INGREDIENT_OWNED + k : SPRITE_INGREDIENT_MISSING + k;
      surface.drawSprite(sprites, sprite, slot * ICON_STEP + ICON_X, ICON_Y + top);
    }
    for (let k = 0; k < INGREDIENT_COUNT; k++) {
      if (required(k) || !hasIngredient(player, k)) continue;
      slot++;
      surface.drawSprite(sprites, SPRITE_INGREDIENT_OWNED + k, slot * ICON_STEP + ICON_X, ICON_Y + top);
    }
    slot++;
    const text = Uint8Array.from(pointsText(player.points, state.goal.points), (c) => c.charCodeAt(0));
    const width = surface.drawText(font, text, slot * ICON_STEP + TEXT_X, TEXT_Y + top, TEXT_COLOR);
    surface.drawSprite(sprites, player.points === 0 ? SPRITE_DROP_EMPTY : SPRITE_DROP, slot * ICON_STEP + 0x59 + width, ICON_Y + top);
  });
  surface.commitBackground();
}
