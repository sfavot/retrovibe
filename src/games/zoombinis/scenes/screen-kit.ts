/**
 * Ouverture et fermeture d'un écran de jeu, partie commune des handlers Enter / Exit de l'original (`engine.md` §2.6) :
 * archive de l'écran pour les sons (`11b8:0011`), palette `SHPL` et fond `tBMP` 640 × 480 (`11a8:1475`), features sur ce fond.
 * Chaque écran ajoute ensuite ses groupes de formes, ses scripts et ses objets.
 */
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import { BACKGROUND_ID } from "../data/archives";
import { FEATURES } from "../engine/features";
import type { SceneContext } from "../engine/scene";
import { GRAPHICS, SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/services";
import { ZOOMBINIS_SOUND } from "../engine/sound";

export interface ScreenSetup {
  /** Id du fond (`SHPL` et `tBMP`) : 1000 dans tous les écrans de jeu. */
  background?: number;
  /** Id de la palette, quand elle diffère du fond (ex. `MAP` : `SHPL` 300). */
  palette?: number;
}

/**
 * `enter` d'un écran : palette et fond de `archive`, surface de fond donnée aux features (qui recomposent l'écran à chaque changement),
 * archive des sons de l'écran. Renvoie la surface de fond, sur laquelle l'écran peut encore dessiner (texte fixe, décor) avant
 * `features.invalidate()`.
 */
export function openScreen(ctx: SceneContext, archive: Archive, setup: ScreenSetup = {}): Surface {
  const background = setup.background ?? BACKGROUND_ID;
  const { screen, palette } = ctx.services.get(GRAPHICS);
  palette.loadShpl(archive.shpl(setup.palette ?? background));
  const surface = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
  drawShape(surface, archive.tbmp(background), 0, 0, 0);
  screen.pixels.set(surface.pixels);
  const features = ctx.services.get(FEATURES);
  features.setArchive(archive);
  features.setBackground(surface);
  ctx.services.get(ZOOMBINIS_SOUND).setScreenArchive(archive);
  ctx.requestPresent();
  return surface;
}

/** `leave` d'un écran (handler Exit) : features et groupes libérés, sons de l'écran arrêtés et détachés, curseur rendu. */
export function closeScreen(ctx: SceneContext): void {
  const features = ctx.services.get(FEATURES);
  features.clear();
  features.setBackground(null);
  const sound = ctx.services.get(ZOOMBINIS_SOUND);
  sound.stopEffects();
  sound.setScreenArchive(null);
  ctx.setCursor("system");
}
