/**
 * Rendu logiciel de SWIV 3D dans une image indexée 320×400 (`docs/swiv3d/render.md`) : ciel noir (indice 0), terrain en bandes,
 * puis objets et sprites triés du plus loin au plus proche. La présentation (palette, étirement 4:3) n'est pas ici
 * (`IndexedPresenter`, `src/ui/indexed-canvas.ts`).
 */
import type { RenderAssets } from "./assets";
import { createProjection, setupProjection } from "./camera";
import { Columns } from "./columns";
import { ObjectRenderer } from "./objects";
import { KIND_SPRITE_504, KIND_SPRITE_505 } from "./queue";
import { addSprite, drawSprite504, drawSprite505 } from "./sprites";
import { TerrainRenderer } from "./terrain";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type RenderView } from "./view";

export interface RenderStats {
  /** Primitives mises en file à la dernière image (triangles + sprites, au plus 2995). */
  queued: number;
}

export interface Renderer {
  /** Dessine `view` dans `fb` (`SCREEN_WIDTH × SCREEN_HEIGHT` indices de `palette`, ligne par ligne). */
  render(view: RenderView, fb: Uint8Array): void;
  /** Palette d'exécution RGB 8 bits (256 × 3), celle du niveau (SLV 11003, gamma 0). */
  readonly palette: Uint8Array;
  readonly stats: RenderStats;
}

/** Distance (unités monde) devant la caméra du point qui sert de départ à la construction des rangées du terrain. */
const ROW_TARGET_DISTANCE = 600;

export function createRenderer(assets: RenderAssets): Renderer {
  const projection = createProjection();
  const columns = new Columns();
  const terrain = new TerrainRenderer(assets);
  const objects = new ObjectRenderer(assets);
  const stats: RenderStats = { queued: 0 };

  return {
    palette: assets.palette,
    stats,
    render(view, fb) {
      if (fb.length < SCREEN_WIDTH * SCREEN_HEIGHT) throw new Error("rendu : image trop petite");
      const { camera } = view;
      const waterMode = view.waterMode ?? 3;
      const time = view.time | 0;
      setupProjection(projection, camera);
      fb.fill(0, 0, SCREEN_WIDTH * SCREEN_HEIGHT);

      // Point de départ des rangées : devant la caméra, dans le plan horizontal (le jeu prend la cible lissée de la poursuite).
      const headLength = Math.hypot(projection.fx, projection.fz) || 1;
      const targetX = projection.camX + (ROW_TARGET_DISTANCE * projection.fx) / headLength;
      const targetZ = projection.camZ + (ROW_TARGET_DISTANCE * projection.fz) / headLength;
      terrain.draw(fb, projection, columns, time, waterMode, targetX, targetZ);

      objects.begin(projection, time, waterMode);
      for (const object of view.objects) objects.addObject(object);
      for (const sprite of view.sprites) addSprite(objects.queue, projection, sprite);

      const queue = objects.queue;
      stats.queued = queue.count;
      for (const qi of queue.sorted()) {
        const kind = queue.kind[qi]!;
        if (kind === KIND_SPRITE_505) drawSprite505(fb, columns, assets, projection, queue, qi);
        else if (kind === KIND_SPRITE_504) drawSprite504(fb, columns, assets, projection, queue, qi);
        else objects.drawTriangle(fb, columns, qi);
      }
    },
  };
}
