/**
 * Collisions objet ↔ objet d'une cellule de la grille (`gm_objects_update`, `0042a084` ; docs/swiv3d/objects.md §10.1).
 *
 * Pour chaque couple (A, B) de la cellule, A étant avant B dans la liste (tête → queue) : traité si l'un des deux est solide
 * (`classe & 2`), si aucun n'est « fantôme » (`classe & 0x40`) et s'ils ne sont pas de la même famille (propriétaires). Il y a
 * contact si `Σ((Δ >> 8)²) <= rayon²(A) + rayon²(B)` (rayon² = champ `+0x0c` du modèle, 100 sans modèle). Réaction :
 *  - un seul solide et aucun dangereux (`(A.classe & 10) + (B.classe & 10) == 2`) : poussée douce `v ±= 4·n` ;
 *  - sinon dégâts `min(pvA, pvB, 100)` retirés aux deux (sauf invulnérables, `flags & 4`), éclair + « touché » (`flags |= 0x102`),
 *    dégel (`flags &= ~0x20`), recul `v ±= 8·n` pour un solide sans `flags & 8`, `target` = propriétaire de l'autre.
 * Distances brutes, sans correction de période : deux objets de part et d'autre de la couture du tore ne se heurtent pas.
 */
import {
  CLASS,
  FLAG,
  type GameObject,
  type ModelTable,
  radius2,
} from "./objects";
import { normalize256 } from "./fixed";

export interface CollisionHooks {
  /** Appelé pour chaque objet qui perd des pv (après application). */
  onDamage?(o: GameObject, amount: number): void;
}

const n = { x: 0, y: 0, z: 0 };

/** Même famille : l'un possède l'autre (directement ou par la racine), ou ils ont le même propriétaire. */
function sameFamily(a: GameObject, b: GameObject): boolean {
  return (
    a === b.owner.owner ||
    a === b.owner ||
    b === a.owner.owner ||
    b === a.owner ||
    a.owner === b.owner
  );
}

/**
 * Teste tous les couples de `list`, dont la **tête est la fin du tableau** (voir `Grid`). L'ordre (A avant B dans la liste) est
 * celui de l'exe.
 */
export function collideCell(
  list: readonly GameObject[],
  models: ModelTable,
  hooks: CollisionHooks = {},
): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i]!;
    if (a.classe & CLASS.GHOST) continue;
    for (let j = i - 1; j >= 0; j--) {
      const b = list[j]!;
      if (!(b.classe & CLASS.SOLID || a.classe & CLASS.SOLID)) continue;
      if (b.classe & CLASS.GHOST) continue;
      if (sameFamily(a, b)) continue;
      const dx = (b.x - a.x) >> 8;
      const dy = (b.y - a.y) >> 8;
      const dz = (b.z - a.z) >> 8;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > radius2(models, a.model) + radius2(models, b.model)) continue;

      normalize256((b.x - a.x) >> 4, (b.y - a.y) >> 4, (b.z - a.z) >> 4, n);
      if ((b.classe & 10) + (a.classe & 10) === 2) {
        if (a.classe & CLASS.SOLID) {
          a.vx -= n.x * 4;
          a.vy -= n.y * 4;
          a.vz -= n.z * 4;
        }
        if (b.classe & CLASS.SOLID) {
          b.vx += n.x * 4;
          b.vy += n.y * 4;
          b.vz += n.z * 4;
        }
      } else {
        a.target = b.owner;
        b.target = a.owner;
        const m = Math.min(a.hp, b.hp, 100);
        if (!(a.flags & FLAG.INVULNERABLE)) {
          a.flags = (a.flags | 0x102) & ~FLAG.FROZEN;
          a.hp -= m;
          if (a.classe & CLASS.SOLID && !(a.flags & FLAG.NO_KNOCKBACK)) {
            a.vx -= n.x * 8;
            a.vy -= n.y * 8;
            a.vz -= n.z * 8;
          }
          hooks.onDamage?.(a, m);
        }
        if (!(b.flags & FLAG.INVULNERABLE)) {
          if (b.classe & CLASS.SOLID && !(b.flags & FLAG.NO_KNOCKBACK)) {
            b.vx += n.x * 8;
            b.vy += n.y * 8;
            b.vz += n.z * 8;
          }
          b.flags = (b.flags | 0x102) & ~FLAG.FROZEN;
          b.hp -= m;
          hooks.onDamage?.(b, m);
        }
      }
    }
  }
}
