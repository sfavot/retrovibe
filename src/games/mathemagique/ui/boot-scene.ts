import { TAG_SHAP, TAG_SHPL } from "../data/mohawk";
import { PLAY_HEIGHT, PLAY_WIDTH } from "../engine/graphics/frame";
import type { Archive } from "../engine/resources";
import type { Scene, SceneContext } from "../engine/scene";
import type { MathServices } from "../engine/services";

const ARCHIVE = "TITLE.DAT";

/** Première forme 8 bits plein écran (576×432) de l'archive, avec son identifiant ; `undefined` s'il n'y en a pas. */
function firstFullScreenShape(archive: Archive): { id: number; pixels: Uint8Array } | undefined {
  for (const id of archive.ids(TAG_SHAP)) {
    const shape = archive.shap(id);
    if (shape.bitsPerPixel === 8 && shape.width === PLAY_WIDTH && shape.height === PLAY_HEIGHT) return { id, pixels: shape.pixels };
  }
  return undefined;
}

/**
 * Scène provisoire (la vraie scène titre viendra avec la vague H) : affiche l'image plein écran de `TITLE.DAT` avec la palette de son
 * `SHPL`, pour vérifier de bout en bout fichiers, décodage, palette et présentation. Ne joue aucun son. Dessine par le service
 * GRAPHICS (surface de jeu et palette de `installServices`) et respecte le contrat des scènes (`useArchive` / `endScene`).
 */
export class BootScene implements Scene {
  constructor(private readonly services: MathServices) {}

  async load(ctx: SceneContext): Promise<void> {
    await ctx.resources.open(ARCHIVE);
  }

  enter(ctx: SceneContext): void {
    const archive = ctx.resources.require(ARCHIVE);
    const image = firstFullScreenShape(archive);
    if (!image) throw new Error(`${ARCHIVE} : aucune image plein écran`);
    // Palette de l'écran : le SHPL de même identifiant que l'image (`TITLE.DAT` : 105), sinon le premier de l'archive.
    const shplId = archive.has(TAG_SHPL, image.id) ? image.id : archive.ids(TAG_SHPL)[0];
    const { screen, palette } = this.services.graphics;
    this.services.useArchive(archive);
    if (shplId !== undefined) palette.loadShpl(archive.shpl(shplId));
    screen.pixels.set(image.pixels);
    ctx.setCursor("arrow");
    ctx.requestPresent();
  }

  leave(): void {
    this.services.endScene();
  }

  tick(): void {}
}
