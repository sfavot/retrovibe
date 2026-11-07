/**
 * Ouverture et fermeture d'un écran de jeu, partie commune des handlers Enter / Exit de l'original (`engine.md` §2.6) :
 * archive de l'écran pour les sons (`11b8:0011`), palette `SHPL` et fond `tBMP` 640 × 480 (`11a8:1475`), features sur ce fond.
 * Chaque écran ajoute ensuite ses groupes de formes, ses scripts et ses objets.
 */
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import type { Fade } from "../../../engine/mohawk/graphics/palette";
import { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import { BACKGROUND_ID } from "../data/archives";
import { FEATURES } from "../engine/features";
import type { SceneContext } from "../engine/scene";
import { GRAPHICS, SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/services";
import { ZOOMBINIS_SOUND } from "../engine/sound";

/**
 * Fondu de palette des écrans (`11a8:302b` à l'entrée, `11a8:3065` à la sortie, tous deux via `1050:0043(objet 0, 1, 0, 0xfe, 1, palette)`) : entrées 1 à 254 (`0xfe`),
 * durée 0 donc 500 ms par défaut (`1050:0095`), soit 30 ticks, mode 1 (niveau continu, pas de paliers de 4). Entrée : du noir (la sortie de l'écran précédent l'a laissé
 * affiché) vers la palette de l'écran sauvegardée par `1058:048a(236, 10)` (`DS:64ce`, la `SHPL` chargée) ; sortie : de l'affichage vers le noir, **tenu**.
 * L'original **bloque** pendant le fondu (`1050:020a` boucle jusqu'à la fin, en pompant les messages) : l'écran n'anime rien et ne démarre ses minuteries qu'après
 * (`11a8:2278` suit `302b`) ; ce blocage est à la charge de l'écran (garder le `Fade` rendu et attendre `done`).
 */
export const SCREEN_FADE_TICKS = 30;
const SCREEN_FADE_FIRST = 1;
const SCREEN_FADE_COUNT = 254;

/** `11a8:302b` : fond depuis le noir vers la palette chargée par `openScreen`, juste après le premier dessin de l'écran. */
export function fadeInScreen(ctx: SceneContext): Fade {
  const { palette } = ctx.services.get(GRAPHICS);
  ctx.requestPresent();
  return palette.fadeFromBlack(SCREEN_FADE_TICKS, SCREEN_FADE_FIRST, SCREEN_FADE_COUNT);
}

/** `11a8:3065` : fondu vers le noir, tenu jusqu'à ce que l'écran suivant ouvre (`openScreen` le lève). À faire avant de changer d'écran, puis attendre `done`. */
export function fadeOutScreen(ctx: SceneContext): Fade {
  const { palette } = ctx.services.get(GRAPHICS);
  return palette.fadeToBlack(SCREEN_FADE_TICKS, SCREEN_FADE_FIRST, SCREEN_FADE_COUNT);
}

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
  // Un fondu de sortie tenu (noir) de l'écran précédent ne doit pas masquer un écran qui ne fait pas son fondu d'entrée.
  palette.clearFade();
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
