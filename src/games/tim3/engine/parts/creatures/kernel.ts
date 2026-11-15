/**
 * Fonctions de TIMWIN.EXE partagées par les types « créatures » et que le noyau (`engine/*.ts`) ne porte pas encore.
 * Elles vivent ici, isolées et documentées, en attendant que le groupe `mechanics` les ajoute au noyau : voir
 * `docs/tim3/parts-creatures.md` (« Besoins de noyau »). Correspondance OpenTIM : `src/parts/mod.rs` (TEMIM) pour les
 * recherches de pièces voisines ; le binaire de TIM3 fait foi.
 */
import { ignoresCollision } from "../../collide";
import { mul16 } from "../../fixed";
import { F0C, F10, F14, type Part } from "../../part";
import { cos16, sin16 } from "../../tables";
import type { TypeTable } from "../../types";
import type { World } from "../../world";
import { boxScan, imageScan, usesBox } from "../../zone";
import type { HandlerRegistry } from "../registry";
import { centerInside, edgesCross } from "./overlap";

/** Masques de listes de 439ad8 / 439b21. */
export const LIST_STATIC = 0x2000;
export const LIST_MOBILE = 0x1000;

/** 44b2c0(anim du type, état) : première image de l'état `id` ; 0 si le type n'a pas d'ANM ou pas de cet état. */
export function stateFrame(types: TypeTable, type: number, id: number): number {
  const anm = types.anims[type]?.anm;
  if (!anm) return 0;
  for (const s of anm.states) if (s.state === 0 || s.state === id) return s.first;
  return 0;
}

/** 44b2c0(anim, −1) : nombre d'images adressables (+0x0C de l'animation) ; 0 sans ANM. */
export function frameCount(types: TypeTable, type: number): number {
  return types.anims[type]?.count ?? 0;
}

/** 44b19c(anim, i) : état qui commence à l'image i (0 : aucun, −1 : hors limites). */
export function stateAt(types: TypeTable, type: number, frame: number): number {
  return types.anims[type]?.stateAt(frame) ?? -1;
}

/**
 * Valeurs que l'exe calcule une fois dans des globales (au premier slot 2 d'un type, par 44b2c0 sur l'ANM) : ce sont
 * des fonctions pures de l'ANM, calculées ici à la demande et mémorisées par table de types.
 */
const caches = new WeakMap<TypeTable, Map<string, unknown>>();
export function cached<T>(types: TypeTable, key: string, build: () => T): T {
  let m = caches.get(types);
  if (!m) caches.set(types, (m = new Map()));
  if (!m.has(key)) m.set(key, build());
  return m.get(key) as T;
}

/**
 * 439ad8(masque) puis 439b21(pièce, masque & 0x1000) : parcours des statiques (si 0x2000) puis des mobiles (si 0x1000).
 * (Le bac, 0x800, n'est atteint que si les deux autres listes sont vides : jamais utilisé par les créatures.)
 */
export function* partsIn(world: World, mask: number): IterableIterator<Part> {
  if (mask & LIST_STATIC) yield* world.statics.toArray();
  if (mask & LIST_MOBILE) yield* world.mobiles.toArray();
}


/**
 * 434ec6 : certains types (6 : moteur, 12 : chat, 42 : souris) décident par leur image si c'est leur boîte de collision
 * (+0x34, +0x7C) ou leur rectangle de dessin (+0x44, +0x6C) qui sert aux recherches de voisins (`engine/zone.ts`,
 * `usesBox`). Les tests du chat (440058) et de la souris (443c19) sont enregistrés comme fonctions spéciales par
 * `registerBoxHooks` ; celui du moteur (43f92f) par `mechanics`.
 */
type BoxHook = (world: World, p: Part) => boolean;
const boxHooks = new Map<number, BoxHook>();
export function registerBoxHook(type: number, hook: BoxHook): void {
  boxHooks.set(type, hook);
}
const BOX_HOOK_ADDRESS: Record<number, number> = { 12: 0x440058, 42: 0x443c19 };
export function registerBoxHooks(r: HandlerRegistry): void {
  for (const [type, hook] of boxHooks) {
    const address = BOX_HOOK_ADDRESS[type];
    if (address !== undefined) r.registerSpecial(address, `boxHook.${type}`, (w, p) => (hook(w, p) ? 1 : 0));
  }
}

export { usesBox };

/** Champs +0xC8 / +0xCC que 434cc4 écrit dans chaque pièce trouvée (écarts horizontal et vertical signés). */
export function relativeOf(p: Part): { dx: number; dy: number } {
  return { dx: p.fC8, dy: p.fCC };
}

/** 434eff : voir `engine/zone.ts` (`boxScan`). Rend la tête de la chaîne (`part.bucketNext`). */
export function collectInRect(world: World, part: Part, mask: number, x0: number, x1: number, y0: number, y1: number): Part | null {
  boxScan(world, part, mask, x0, x1, y0, y1);
  return part.bucketNext;
}

/** 434cc4 : voir `engine/zone.ts` (`imageScan`, écarts dans +0xC8 / +0xCC). Rend la tête de la chaîne. */
export function findNeighbours(world: World, part: Part, mask: number, dxMin: number, dxMax: number, dyMin: number, dyMax: number): Part | null {
  imageScan(world, part, mask, dxMin, dxMax, dyMin, dyMax);
  return part.bucketNext;
}

/**
 * 437208(pièce) : la boîte de collision de la pièce, à sa position actuelle, recoupe-t-elle une autre pièce qui la gêne ?
 * Rend faux si la pièce est verrouillée (+0x15 & 0x10, soit 0x1000 de +0x14). Parcourt statiques puis mobiles (439ad8 /
 * 439b21), saute les paires de types qui ne se heurtent pas (4371af), la pièce elle-même, les pièces sorties (+0x11 & 0x20)
 * ou verrouillées / en attente (+0x15 & 0x50), puis, si les boîtes se recoupent, teste les polygones : arêtes qui se
 * coupent (4372f8), puis centre de chaque pièce dans le polygone de l'autre (4374e9, dans les deux sens).
 */
export function overlapsAnother(world: World, part: Part, ignores: (t1: number, t2: number) => boolean = ignoresCollision): boolean {
  if (part.flags14 & 0x1000) return false;
  const x0 = part.px;
  const y0 = part.py;
  const x1 = (x0 + part.boxW) | 0;
  const y1 = (y0 + part.boxH) | 0;
  for (const o of partsIn(world, LIST_STATIC | LIST_MOBILE)) {
    if (ignores(part.type, o.type) || o === part || o.flags10 & F10.GONE || o.flags14 & (0x1000 | F14.SUSPENDED)) continue;
    const ox1 = (o.px + o.boxW) | 0;
    const oy1 = (o.py + o.boxH) | 0;
    if (o.px < x1 && ox1 > x0 && o.py < y1 && oy1 > y0) {
      if (edgesCross(part, o) || centerInside(part, o) || centerInside(o, part)) return true;
    }
  }
  return false;
}

/** 43a28f(pièce, angle, vitesse) : vitesse (+0x54, +0x58) = produit 16 × 16 de la vitesse par (cos, sin) de l'angle, `sar 14`. */
export function setVelocityFromAngle(p: Part, angle: number, speed: number): void {
  p.vx = mul16(speed, cos16(angle)) >> 14;
  p.vy = mul16(speed, sin16(angle)) >> 14;
}

export { F0C };
