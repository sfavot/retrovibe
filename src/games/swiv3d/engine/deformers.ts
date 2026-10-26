/**
 * Réserve des déformations du terrain (`render.md` §10) : 5 nœuds de 0x18 octets (`0056f2d8`), liste libre `00587714` et liste
 * active `00587704`, toutes deux chaînées par `+0x14` et manipulées par la tête. `gm_level_spawn_objects` (`0043e958`) chaîne les
 * 5 nœuds dans la liste libre (le dernier en tête) et vide la liste active ; la bombe et la méga-bombe (`gm_upd_bomb_fly`,
 * `gm_upd_bomb_shockwave`) et la caméra de scénario 7800 (`gm_upd_camera`, non portée : types absents des niveaux) en prennent
 * un ; le mortier (`gm_upd_mortar`) attend seulement qu'un nœud soit libre. À la fin de `gm_game_tick` (`0043c234`), chaque nœud
 * actif perd 1 de durée (`+0x0c`) : ceux qui tombent à 0 retournent en tête de la liste libre, les autres en tête d'une nouvelle
 * liste active (l'ordre de la liste s'inverse donc à chaque tick).
 *
 * La déformation n'existe que dans le rendu (`gm_deformers_apply`, `render/deformers.ts`) : la hauteur du sol des objets et des
 * collisions (`gm_terrain_height`) n'en tient pas compte. Seule la caméra de poursuite la voit (« plan large », `camera.ts`).
 */

/** Nombre de nœuds de la réserve (`0056f2d8`, 5 × 0x18 octets). */
export const DEFORMER_POOL_SIZE = 5;

/** Type `+0x10` : onde de choc (bombe), dôme (méga-bombe), anneau lumineux (caméra de scénario 7800). */
export const DEFORMER_WAVE = 0;
export const DEFORMER_DOME = 1;
export const DEFORMER_RING = 2;

export interface Deformer {
  /** `+0x00`, `+0x04`, `+0x08` : position Q8 (`y` n'est posé que par les bombes, la caméra 7800 garde l'ancienne valeur). */
  x: number;
  y: number;
  z: number;
  /** `+0x0c` : ticks restants, qui servent aussi de rayon / phase à la déformation. */
  life: number;
  /** `+0x10` : `DEFORMER_*`. */
  type: number;
}

export class Deformers {
  /** Liste active `00587704`, tête en premier (ordre de parcours de `gm_deformers_apply`). */
  readonly active: Deformer[] = [];
  /** Liste libre `00587714`, tête en premier. */
  readonly free: Deformer[] = [];

  constructor() {
    // `gm_level_spawn_objects` : nœud 0 à 4 poussés en tête, le nœud 4 est donc le premier pris.
    for (let i = 0; i < DEFORMER_POOL_SIZE; i++) this.free.unshift({ x: 0, y: 0, z: 0, life: 0, type: 0 });
  }

  /** Liste libre non vide (`DAT_00587714 != 0`) : condition d'explosion du mortier et des bombes. */
  get available(): boolean {
    return this.free.length > 0;
  }

  /** Prend le nœud de tête de la liste libre et le met en tête de la liste active ; `null` si la réserve est vide. */
  take(x: number, y: number, z: number, life: number, type: number): Deformer | null {
    const d = this.free.shift();
    if (!d) return null;
    this.active.unshift(d);
    d.x = x;
    d.y = y;
    d.z = z;
    d.life = life;
    d.type = type;
    return d;
  }

  /** Fin de `gm_game_tick` : durée - 1, nœuds échus (durée < 1) rendus à la réserve, liste active reconstruite à l'envers. */
  tick(): void {
    if (this.active.length === 0) return;
    const nodes = this.active.splice(0);
    for (const d of nodes) {
      d.life--;
      if (d.life < 1) this.free.unshift(d);
      else this.active.unshift(d);
    }
  }
}
