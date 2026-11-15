/**
 * Fonctions de TIMWIN.EXE partagées par la famille « pyro » (feu, explosions, création et destruction de pièces en cours
 * de pas) et que le noyau ne fournit pas encore. Elles sont isolées ici et documentées en attendant le groupe
 * `mechanics` : voir `docs/tim3/parts-pyro.md`, « Besoins de noyau ». Correspondance OpenTIM : `c_src/main.c`
 * (`part_new`, `part_alloc`, `insert_part_into_moving_parts`, `find_nearby_parts`) et `src/parts/mod.rs` (TEMIM) ; le
 * binaire de TIM3 fait foi.
 */
import { mul16 } from "../../fixed";
import { computeEdgeAngles, updateGeometry } from "../../move";
import { F10, Part, type RopeData } from "../../part";
import { cos16, sin16 } from "../../tables";
import type { World } from "../../world";

/** Masques de listes de 439ad8 / 439b21. */
export const LIST_STATIC = 0x2000;
export const LIST_MOBILE = 0x1000;

// ---------------------------------------------------------------------------------------------------------------------
// Points d'accroche (+0xB0 … +0xBB, `Part.ropeAnchor`).

/** Point d'accroche `i` (+0xB0 + 2i) : 0 et 1 pour les cordes, 4 (+0xB8) pour la mise à feu. */
export function setAnchor(p: Part, i: number, x: number, y: number): void {
  p.ropeAnchor[2 * i] = x;
  p.ropeAnchor[2 * i + 1] = y;
}

export function anchorX(p: Part, i: number): number {
  return p.ropeAnchor[2 * i]!;
}

export function anchorY(p: Part, i: number): number {
  return p.ropeAnchor[2 * i + 1]!;
}

// ---------------------------------------------------------------------------------------------------------------------
// État global de la famille (données de l'exe modifiées pendant la marche).

interface PyroGlobals {
  /** 0x477fe4 : compte à rebours de l'animation de repos des fusées (120 dans l'image de l'exe). */
  rocketTimer: number;
  /** 0x4780bc : idem pour les lampes d'Aladdin (120). */
  lampTimer: number;
}

/** Ces comptes à rebours sont des champs de `World` (globales de l'exe). */
export function pyroGlobals(world: World): PyroGlobals {
  return world;
}

// ---------------------------------------------------------------------------------------------------------------------
// Animations (44b2c0, 44b19c). L'exe met certains résultats en cache dans des globales au premier slot 2 d'un type ;
// ce sont des fonctions pures de l'ANM, recalculées ici à la demande.

/** 44b2c0(anim, n) : première image de l'état n ; n = −1 : nombre d'images ; état absent : `first` de l'entrée finale. */
export function stateFrame(world: World, type: number, n: number): number {
  const anim = world.types.anims[type];
  if (!anim) return 0;
  if (n === -1) return anim.count;
  for (const s of anim.anm.states) if (s.state === 0 || s.state === n) return s.first;
  return 0;
}

/** 44b19c(anim, i) : état qui commence à l'image i (0 : aucun ; −1 : hors limites ou sans ANM). */
export function stateAt(world: World, type: number, frame: number): number {
  return world.types.anims[type]?.stateAt(frame) ?? -1;
}

/** Première image i ≥ `from` dont l'état n'est pas 0 (boucles de 440364 et 445d52). */
function firstStateFrom(world: World, type: number, from: number): number {
  let i = from;
  while (stateAt(world, type, i) === 0) i++;
  return i;
}

/** 0x481660 (440364, aquarium 15) : première image ≥ 1 qui commence un état (l'aquarium cassé). */
export function fishTankBroken(world: World): number {
  return firstStateFrom(world, 15, 1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Création de pièces en cours de pas : dans le noyau (`engine/zone.ts`).

import { boxScan, clonePart, hotspotScan, imageScan, insertCreated, newPart, placeAt, recyclePart } from "../../zone";

export { clonePart, insertCreated, newPart, placeAt, recyclePart };

// ---------------------------------------------------------------------------------------------------------------------
// Recherches de voisins.

/** 439ad8(masque) puis 439b21(pièce, masque & 0x1000) : statiques (0x2000) puis mobiles (0x1000). */
export function* partsIn(world: World, mask: number): IterableIterator<Part> {
  if (mask & LIST_STATIC) yield* world.statics;
  if (mask & LIST_MOBILE) yield* world.mobiles;
}


/** 434cc4 : voir `engine/zone.ts` (`imageScan`, écarts en +0xC8 / +0xCC). */
export function nearby(world: World, p: Part, mask: number, a: number, b: number, c: number, d: number): void {
  imageScan(world, p, mask, a, b, c, d);
}

/** Parcours de la chaîne +0xC4 (la suivante est lue après l'appel, comme dans l'exe). */
export function* chain(p: Part): IterableIterator<Part> {
  for (let q = p.bucketNext; q; q = q.bucketNext) yield q;
}

/** 4350e6 : voir `engine/zone.ts` (`hotspotScan`, point +0xB8). */
const flammablesIn = hotspotScan;

/** 434eff : voir `engine/zone.ts` (`boxScan`). */
const boxesIn = boxScan;

/**
 * 43beb8(pièce, x0, x1, y0, y1) : flamme dans le rectangle (relatif à la pièce). Allume les pièces inflammables dont le
 * point de mise à feu y tombe (+0x24 = 1), puis agit sur les mobiles qui le recoupent : cafetière (62) et ballon (4)
 * +0x24 = 1, chat (12) qui saute, nitroglycérine (74) qui explose, dirigeable (109) +0x24 = 2.
 */
export function flame(world: World, p: Part, x0: number, x1: number, y0: number, y1: number): void {
  flammablesIn(world, p, x0, x1, y0, y1);
  for (const q of chain(p)) if (q.f24 === 0) q.f24 = 1;
  boxesIn(world, p, LIST_MOBILE, x0, x1, y0, y1);
  for (const q of chain(p)) {
    switch (q.type) {
      case 0x3e:
      case 4:
        q.f24 = 1;
        break;
      case 0x0c: {
        // Chat : saute (début de l'état 4 ou 14 selon le côté, 0x481610[i]) s'il n'y est pas déjà.
        const i = q.frame >= stateFrame(world, 12, 9) ? 1 : 0;
        const jump = stateFrame(world, 12, [4, 14][i]!);
        if (jump > q.frame) {
          q.frame = jump;
          q.fFC = 0;
          updateGeometry(world, q);
        }
        break;
      }
      case 0x4a:
        explodeNitro(world, q);
        break;
      case 0x6d:
        q.f24 = 2;
        break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Explosions créées.

/** 446014 : la nitroglycérine explose : explosion (41) dans les statiques à (x − 36, y − 14), pièce détruite. */
export function explodeNitro(world: World, p: Part): void {
  const e = newPart(world, 0x29);
  if (e) {
    insertCreated(world, world.statics, e);
    placeAt(world, e, (p.px - 0x24) | 0, (p.py - 0xe) | 0);
  }
  // 43087b : zone à redessiner (affichage).
  p.flags10 |= F10.GONE;
  p.frame = stateFrame(world, 0x4a, 3);
}

// ---------------------------------------------------------------------------------------------------------------------
// Géométrie.

export { centreAngle } from "../../bounce";

/** 43a28f(pièce, angle, force) : vitesse = force dans la direction de l'angle (sinus en x, cosinus en y, Q14). */
export function launch(p: Part, angle: number, force: number): void {
  p.vx = mul16(force, sin16(angle)) >> 14;
  p.vy = mul16(force, cos16(angle)) >> 14;
}

/** Polygone `i` du type (copies en miroir comprises), angles de ses côtés recalculés (fin de la plupart des slots 2). */
export function usePolygon(world: World, p: Part, i: number): void {
  const polys = world.types.get(p.type).polygons;
  p.poly = polys ? (polys[i] ?? null) : null;
  if (p.poly) computeEdgeAngles(p.poly, p.vertexCount);
}

// ---------------------------------------------------------------------------------------------------------------------
// Cordes.

/** Bloc de corde (+0xA8) de la pièce, ou `null`. */
export function ropeOf(p: Part): RopeData | null {
  return p.ropes[0];
}

/** 43a093(pièce, autre) : 0 si `autre.links[0]` est la pièce, 1 si `links[1]`, −1 sinon. */
export function linkIndex(p: Part, other: Part): number {
  if (other.links[0] === p) return 0;
  if (other.links[1] === p) return 1;
  return -1;
}
