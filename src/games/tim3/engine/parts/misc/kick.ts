/**
 * Aides partagées par les pièces qui « frappent » d'autres pièces dans une zone (flipper 116, gant, cisailles…) :
 * collecte des pièces dans un rectangle (434eff) et zone courante lue par 43dcb5 (globales 0x481d30 … 0x481d3c, écrites
 * par 43dc3c). BESOIN DE NOYAU / AUTRE GROUPE : 43dcb5 (2 543 octets, « actionner la pièce touchée », aiguillage par type)
 * n'est pas porté ici ; `kick` l'appelle via `World.special(0x43dcb5)` (souche journalisée tant que personne ne
 * l'enregistre) et lit la zone dans `kickZone`.
 */
import type { Part } from "../../part";
import type { World } from "../../world";

/** 0x481d30 (x0), 0x481d34 (x1), 0x481d38 (y0), 0x481d3c (y1) : zone de frappe, en pixels absolus. */
export const kickZone = { x0: 0, x1: 0, y0: 0, y1: 0 };

/** 43dc3c(part, xl, xr, yt, yb) : zone de frappe relative à la position de la pièce. */
export function setKickZone(p: Part, xl: number, xr: number, yt: number, yb: number): void {
  kickZone.x0 = (p.px + xl) | 0;
  kickZone.x1 = (p.px + xr) | 0;
  kickZone.y0 = (p.py + yt) | 0;
  kickZone.y1 = (p.py + yb) | 0;
}

/** 43dcb5(part, 0) : actionner une pièce (aiguillage par type, non portée ici). */
export function kick(world: World, target: Part): void {
  world.special(0x43dcb5, target);
}

/** 439ad8 / 439b21 : pièces des listes demandées par le masque (0x2000 statiques, puis 0x1000 mobiles). */
export function* partsIn(world: World, mask: number): IterableIterator<Part> {
  if (mask & 0x2000) yield* world.statics;
  if (mask & 0x1000) yield* world.mobiles;
}

/**
 * 434eff(part, masque, xl, xr, yt, yb) : chaîne (+0xC4) des autres pièces actives dont la boîte de collision touche le
 * rectangle [px + xl, px + xr[ × [py + yt, py + yb[ ; insertion en tête de chaîne, donc ordre inverse des listes.
 */
export function collectInArea(world: World, part: Part, mask: number, xl: number, xr: number, yt: number, yb: number): void {
  part.bucketNext = null;
  const x0 = (xl + part.px) | 0;
  const x1 = (xr + part.px) | 0;
  const y0 = (yt + part.py) | 0;
  const y1 = (yb + part.py) | 0;
  for (const q of partsIn(world, mask)) {
    if (q === part || q.flags10 & 0x2000 || q.flags14 & 0x4000) continue;
    if (q.px < x1 && q.px + q.boxW > x0 && q.py < y1 && q.py + q.boxH > y0) {
      q.bucketNext = part.bucketNext;
      part.bucketNext = q;
    }
  }
}
