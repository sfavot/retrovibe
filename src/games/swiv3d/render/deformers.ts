/**
 * Déformations du terrain (`gm_deformers_apply`, `004232ac`, `render.md` §10). Tant que la liste active n'est pas vide, chaque
 * sommet du terrain (`gm_terrain_project_flat` / `_lit`), chaque sommet de modèle et chaque position de sprite
 * (`gm_render_objects`) passe par cette fonction juste avant la projection : elle ne touche que la hauteur, la lumière et la
 * couleur du sommet, jamais la carte de hauteur ni la simulation.
 *
 * Les écarts `P - nœud` ne sont pas repliés dans le tore, comme dans l'exe ; les carrés débordent sur 32 bits comme les siens.
 */
import { SIN } from "./tables";
import type { RenderDeformer } from "./view";

/** Sommet en cours de projection (`00587720` x, `00587724` y, `0058771c` z, `00587718` lumière, `00587708` couleur). */
export interface DeformedVertex {
  x: number;
  y: number;
  z: number;
  light: number;
  colour: number;
}

/** Applique les déformations de `list` (dans l'ordre de la liste active) au sommet `p`, sur place. */
export function applyDeformers(list: readonly RenderDeformer[], p: DeformedVertex): void {
  for (const nd of list) {
    const dx = p.x - nd.x;
    const size = nd.life;
    if (nd.type === 0) {
      // Onde de choc : un anneau (creux puis bourrelet) qui s'élargit à mesure que la durée baisse, et un anneau de lumière plus large.
      const dz = p.z - nd.z;
      let u = (((Math.imul(dx, dx) + Math.imul(dz, dz)) | 0) >> 9) + (size - 0x14) * 0x40;
      if (u > 0 && u < 0x200) p.y -= (SIN[u]! * size) >> 5;
      u >>= 1;
      if (u > 0 && u < 0x200) p.light += SIN[u]!;
    } else if (nd.type === 1) {
      // Dôme : un mur qui balaie l'axe x vers les x croissants (seul `dx` compte), plein feu et couleur 0 là où il soulève le sommet.
      const k = (dx >> 2) + (size - 0x1e) * 0x10 + 0x80;
      if (k > 0 && k < 0xff) {
        const h = SIN[k]! * 2 - 300 + nd.y;
        if (p.y < h) {
          p.colour = 0;
          p.light = 1000;
          p.y = h;
        }
      }
    } else if (nd.type === 2) {
      // Anneau lumineux qui s'élargit (caméra de scénario 7800).
      const dz = p.z - nd.z;
      const u = (((Math.imul(dx, dx) + Math.imul(dz, dz)) | 0) >> 11) + (0x19 - size) * -0x40;
      if (u > 0 && u < 0x200) p.light += (SIN[u]! * size) >> 5;
    }
  }
}
