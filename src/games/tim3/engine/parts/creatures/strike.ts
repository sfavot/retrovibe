/**
 * Zone de frappe des créatures : 43dc73 (+ 43dc3c) et son dispatcheur par type 43dcb5, partagés par le diable en boîte
 * (13), l'alligator (61), le grille-pain (81) et d'autres pièces (43f188…). Après 434eff (qui chaîne les pièces de la zone
 * par +0xC4), 43dc73 fixe la fenêtre {x0, x1, y0, y1} (positions relatives à la pièce) et appelle 43dcb5 sur chaque pièce
 * de la chaîne : selon son type et son image, la pièce « touchée » prend +0x24 = ±1 (elle se déclenche) quand certains de
 * ses points d'accroche tombent dans la fenêtre.
 * Pas d'équivalent OpenTIM (pièces propres à TIM3) ; le binaire de TIM3 fait foi.
 *
 * Effets d'affichage (43050d, 43087b, 439695) ignorés. 43f907 (moteur 6) et 440454 (aquarium 15) passent par
 * `World.special`, comme chez le gant de boxe (`misc/tools.ts`) ; le slot 2 de la pièce 21 (440c8b) par `World.call`.
 */
import { u16 } from "../../fixed";
import type { Part } from "../../part";
import type { World } from "../../world";

/** 41352a(v, a, b) : v entre a et b (bornes incluses), comparaison sur 16 bits non signés (`cmp cx, dx ; setbe`). */
function within(v: number, a: number, b: number): boolean {
  if (b < a) return u16(v - b) <= u16(a - b);
  return u16(v - a) <= u16(b - a);
}

/**
 * 43dc73(pièce, mode, x0, x1, y0, y1) : fixe la fenêtre (43dc3c : 0x481d30 … 0x481d3c, décalée de la position de la pièce)
 * puis déclenche chaque pièce de la chaîne `part.bucketNext` (43dcb5). `mode` : 0 par défaut, 1 chez d'autres appelants.
 */
export function strikeZone(world: World, part: Part, mode: number, x0: number, x1: number, y0: number, y1: number): void {
  const rect = {
    x0: (part.px + x0) | 0,
    x1: (part.px + x1) | 0,
    y0: (part.py + y0) | 0,
    y1: (part.py + y1) | 0,
  };
  for (let q = part.bucketNext; q; q = q.bucketNext) triggerPart(world, q, mode, rect);
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 43dcb5(pièce, mode) : réaction d'une pièce touchée, d'après son type. */
function triggerPart(world: World, q: Part, mode: number, r: Rect): void {
  const px = q.px;
  const py = q.py;
  const inX = (dx: number): boolean => within((px + dx) | 0, r.x0, r.x1);
  const inY = (dy: number): boolean => within((py + dy) | 0, r.y0, r.y1);
  const flip = (q.flags10 & 0x10) !== 0;
  switch (q.type) {
    case 3:
    case 0x8b:
      triggerSeesaw(q, mode, inX, inY);
      break;
    case 6:
      world.special(0x43f907, q);
      break;
    case 0xf:
      world.special(0x440454, q);
      break;
    case 0x10:
      if (q.f24 !== 0) break;
      if (flip ? inX(0x19) || inX(0x2d) : inX(0) || inX(0x14)) q.f24 = 1;
      break;
    case 0x15:
      triggerType21(world, q, mode, inX, inY);
      break;
    case 0x16:
      if (q.f24 !== 0 || mode !== 1) break;
      if (inX(0xb) || inX(0x1b)) q.f24 = 1;
      break;
    case 0x19:
      if (q.f24 !== 0 || mode !== 1) break;
      if (flip ? inX(0x19) || inX(0x23) : inX(0xa) || inX(0x14)) q.f24 = 1;
      break;
    case 0x25:
    case 0x4d:
      if (q.f24 !== 0) break;
      if (flip ? inX(0x20) || inX(0x36) : inX(0) || inX(0x16)) q.f24 = 1;
      break;
    case 0x4e:
      if (q.f24 !== 0) break;
      if (!(inY(8) || inY(0x18))) break;
      if (inX(0) || inX(0xa) || inX(0x20) || inX(0x2e)) q.f24 = 1;
      break;
    case 0x89:
      if (q.f24 !== 0) break;
      if (!(inY(0) || inY(0xa))) break;
      if (flip ? inX(0x1a) || inX(0x25) : inX(0xb) || inX(0x16)) q.f24 = 1;
      break;
  }
}

/** 43e29c : bascule (3, 0x8b) : selon son image (0 … 2) et le mode, ±1 d'après les points d'accroche touchés. */
function triggerSeesaw(q: Part, mode: number, inX: (d: number) => boolean, inY: (d: number) => boolean): void {
  const frame = q.frame;
  if (mode === 1) {
    if (frame === 0) {
      if (!(inX(0x34) || inX(0x4f))) return;
      if (inY(0) || inY(0xe)) q.f24 = 1;
    } else if (frame === 1) {
      if (!(inY(0x10) || inY(0x17))) return;
      if (inX(0x34) || inX(0x4f)) q.f24 = 1;
      if (inX(0) || inX(0x16)) q.f24 = -1;
    } else if (frame === 2) {
      if (!(inX(0) || inX(0x16))) return;
      if (inY(0) || inY(0xe)) q.f24 = -1;
    }
    return;
  }
  if (frame === 0) {
    if (!(inX(0) || inX(0x16))) return;
    if (inY(0x1b) || inY(0x26)) q.f24 = 1;
  } else if (frame === 1) {
    if (!(inY(0x10) || inY(0x17))) return;
    if (inX(0x34) || inX(0x4f)) q.f24 = -1;
    if (inX(0) || inX(0x16)) q.f24 = 1;
  } else if (frame === 2) {
    if (!(inX(0x34) || inX(0x4f))) return;
    if (inY(0x1b) || inY(0x26)) q.f24 = -1;
  }
}

/** 43dfe9 : pièce 21 (interrupteur à bascule) : change d'état (image ± 4) si la zone touche son bras ; 440c8b puis son 0xBCD. */
function triggerType21(world: World, q: Part, mode: number, inX: (d: number) => boolean, inY: (d: number) => boolean): void {
  if (!(inX(4) || inX(0xc))) return;
  let hit = false;
  if (q.frame < 4 && mode === 1 && inY(7)) hit = true;
  if (q.frame >= 4 && mode === 0 && inY(0x19)) hit = true;
  if (!hit) return;
  if (q.frame < 4) q.frame = (q.frame + 4) | 0;
  else q.frame = (q.frame - 4) | 0;
  world.call(2, q); // 440c8b
  world.sound(0xbcd, q);
  q.f24 = q.frame !== q.editFrame ? 1 : 0;
}
