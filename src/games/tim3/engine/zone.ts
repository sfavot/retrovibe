/**
 * Recherches de pièces dans une zone et création de pièces en cours de pas (services du noyau pour les handlers).
 * Traduit de TIMWIN.EXE 434cc4, 434eff, 4350e6, 434ec6, 43beb8, 432d00 (première version écrite par le groupe
 * `electric`, reprise dans le noyau). Pas d'équivalent OpenTIM direct.
 */
import { insertSorted, type PartList } from "./lists";
import { updateGeometry } from "./move";
import { F10, F14, Part, Polygon } from "./part";
import type { World } from "./world";

/** 439ad8 / 439b21 : filtre 0x3000 : statiques puis mobiles ; 0x2000 : statiques seules ; 0x1000 : mobiles seules. */
function candidates(world: World, filter: number): Iterable<Part> {
  if (filter & 0x2000) return filter & 0x1000 ? world.staticThenMobile() : world.statics;
  return filter & 0x1000 ? world.mobiles : [];
}

const skipped = (b: Part): boolean => (b.flags10 & F10.GONE) !== 0 || (b.flags14 & F14.SUSPENDED) !== 0;

/** 434eff(p, filtre, x0, x1, y0, y1) : pièces dont la boîte de collision touche le rectangle (relatif à `p`), chaînées en +0xC4. */
export function boxScan(world: World, p: Part, filter: number, x0: number, x1: number, y0: number, y1: number): void {
  p.bucketNext = null;
  const ax0 = (x0 + p.px) | 0;
  const ax1 = (x1 + p.px) | 0;
  const ay0 = (y0 + p.py) | 0;
  const ay1 = (y1 + p.py) | 0;
  for (const b of [...candidates(world, filter)]) {
    if (b === p || skipped(b)) continue;
    const bx1 = (b.px + b.boxW) | 0;
    const by1 = (b.py + b.boxH) | 0;
    if (b.px < ax1 && bx1 > ax0 && b.py < ay1 && by1 > ay0) {
      b.bucketNext = p.bucketNext;
      p.bucketNext = b;
    }
  }
}

/** 4350e6(p, x0, x1, y0, y1) : pièces à point d'accroche (+0x14 & 4) dans le rectangle ; l'exe parcourt statiques puis mobiles. */
export function hotspotScan(world: World, p: Part, x0: number, x1: number, y0: number, y1: number): void {
  p.bucketNext = null;
  const ax0 = (x0 + p.px) | 0;
  const ax1 = (x1 + p.px) | 0;
  const ay0 = (y0 + p.py) | 0;
  const ay1 = (y1 + p.py) | 0;
  for (const b of [...world.staticThenMobile()]) {
    if (b === p || skipped(b) || !(b.flags14 & 4)) continue;
    const hx = (b.ropeAnchor[8]! + b.px) | 0;
    const hy = (b.ropeAnchor[9]! + b.py) | 0;
    if (hx >= ax0 && hx <= ax1 && hy >= ay0 && hy <= ay1) {
      b.bucketNext = p.bucketNext;
      p.bucketNext = b;
    }
  }
}

/**
 * 434ec6 : vrai si la pièce se mesure par sa boîte de collision plutôt que par son image. Types 6, 12 et 42 seulement,
 * selon leur image : 43f92f, 440058 et 443c19, enregistrées comme fonctions spéciales par leur famille.
 */
export function usesBox(world: World, p: Part): boolean {
  const f = BOX_TEST[p.type];
  return f !== undefined && world.special(f, p) !== 0;
}
const BOX_TEST: Record<number, number> = { 6: 0x43f92f, 12: 0x440058, 0x2a: 0x443c19 };

/**
 * 434cc4(p, filtre, x0, x1, y0, y1) : pièces dont l'image touche celle de `p` (marges x0, x1, y0, y1), chaînées en +0xC8 / +0xCC
 * (écarts +0xC8 / +0xCC de la pièce trouvée). Les types 6, 12 et 42 peuvent se mesurer par leur boîte (434ec6).
 */
export function imageScan(world: World, p: Part, filter: number, x0: number, x1: number, y0: number, y1: number): void {
  p.bucketNext = null;
  const box = (q: Part): [number, number, number, number] =>
    usesBox(world, q) ? [q.px, (q.px + q.boxW) | 0, q.py, (q.py + q.boxH) | 0] : [q.drawX, (q.drawX + q.frameW) | 0, q.drawY, (q.drawY + q.frameH) | 0];
  const [aL, aR, aT, aB] = box(p);
  for (const b of [...candidates(world, filter)]) {
    if (b === p || skipped(b)) continue;
    const [bL, bR, bT, bB] = box(b);
    let dx = (bR - aL) | 0;
    if (dx < x0) continue;
    const dxNeg = dx >= 0 ? -1 : dx;
    const gx = (bL - aR) | 0;
    if (gx > x1) continue;
    const gxPos = gx > 0 ? gx : 1;
    dx = Math.abs(gx) < Math.abs(dx) ? gxPos : dxNeg;
    let dy = (bB - aT) | 0;
    if (dy < y0) continue;
    const dyNeg = dy >= 0 ? -1 : dy;
    const gy = (bT - aB) | 0;
    if (gy > y1) continue;
    const gyPos = gy > 0 ? gy : 1;
    dy = Math.abs(gy) < Math.abs(dy) ? gyPos : dyNeg;
    b.bucketNext = p.bucketNext;
    p.bucketNext = b;
    b.fC8 = dx;
    b.fCC = dy;
  }
}

/** Chaîne +0xC4 de `p` (ordre du chaînage de l'exe : dernière pièce trouvée en tête). */
export function chain(p: Part): Part[] {
  const out: Part[] = [];
  for (let b = p.bucketNext; b; b = b.bucketNext) out.push(b);
  return out;
}

/**
 * 43beb8(p, x0, x1, y0, y1) : « réveille » les pièces touchées par le faisceau de `p` : celles à point d'accroche (+0x24 = 1 si 0),
 * puis, dans la boîte de collision, selon le type : 62 et 4 (+0x24 = 1), 109 (+0x24 = 2), 74 (446014) et 12 (fenêtre d'images
 * d'après des globales posées par le groupe `creatures`, 43bf49 : non portée, appelée par `world.special`).
 */
export function wakeInBeam(world: World, p: Part, x0: number, x1: number, y0: number, y1: number): void {
  hotspotScan(world, p, x0, x1, y0, y1);
  for (const b of chain(p)) if (b.f24 === 0) b.f24 = 1;
  boxScan(world, p, 0x1000, x0, x1, y0, y1);
  for (const b of chain(p)) {
    if (b.type === 62 || b.type === 4) b.f24 = 1;
    else if (b.type === 109) b.f24 = 2;
    else if (b.type === 74) world.special(0x446014, b);
    else if (b.type === 12) world.special(0x43bf49, b);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Création de pièces en cours de pas (432d00, 432d78, 432c1c, 439830), première version écrite par le groupe `pyro`.

/** Remise à zéro des 0x10C octets (pièce recyclée par 432d00, gardée par identité). */
function clearPart(p: Part): void {
  Object.assign(p, new Part());
}

/**
 * 432c1c(pièce, type) : champs du descripteur, position d'édition à −1, slot 7 (échec si 0), slot 2, puis 439b58.
 * Rend faux si le slot 7 refuse (l'exe libère alors la pièce).
 */
function initPart(world: World, p: Part, type: number): boolean {
  const d = world.types.get(type);
  p.type = type;
  p.flags0C = d.flags0C;
  p.flags10 = d.flags10;
  p.flags14 = d.flags14;
  p.boxW = d.boxW;
  p.boxH = d.boxH;
  p.vertexCount = d.vertexCount;
  p.mass = d.mass;
  p.editX = -1;
  p.editY = -1;
  p.frameW = d.boxW;
  p.frameH = d.boxH;
  if (d.handlers[7] !== 0 && world.call(7, p) === 0) return false;
  world.call(2, p);
  p.editFlags10 = p.flags10;
  updateGeometry(world, p);
  return true;
}

/** 432d78(type) : pièce neuve du pool, initialisée ; `null` si le slot 7 refuse. */
export function newPart(world: World, type: number): Part | null {
  const p = new Part();
  return initPart(world, p, type) ? p : null;
}

/**
 * 432d00(type) : réutilise d'abord une pièce créée (+0x0C & 0x10) puis détruite (+0x10 & 0x2000) du même type dans la
 * liste des mobiles, sinon en prend une neuve (432d78). La pièce est marquée « créée » (+0x0C |= 0x10) ; elle n'est
 * dans aucune liste : l'appelant l'insère (4393e0).
 *
 * L'exe la décroche avec 4393be (`PartList.remove`) : la tête de liste suit, car 4393e0 donne pour précédent à la première
 * pièce l'adresse de la globale de tête elle-même (439566), que 4393be met alors à jour comme un maillon.
 */
export function recyclePart(world: World, type: number): Part | null {
  let p: Part | null = null;
  for (let q = world.mobiles.head; q; q = q.next) {
    if (q.flags10 & F10.GONE && q.flags0C & 0x10 && q.type === type) {
      p = q;
      break;
    }
  }
  if (p) {
    world.mobiles.remove(p);
    clearPart(p);
    if (!initPart(world, p, type)) {
      p.flags10 |= F10.GONE;
      p.flags0C |= 0x10;
      p = null;
    }
  }
  p ??= newPart(world, type);
  if (p) p.flags0C |= 0x10;
  return p;
}

/** 4393e0(pièce, liste, 0) puis `+0x0C |= 0x10` : insertion triée d'une pièce créée pendant la marche. */
export function insertCreated(world: World, list: PartList, p: Part): void {
  insertSorted(list, p, world.types, false);
  p.flags0C |= 0x10;
}

/** Position en pixels et en 1/512 (les créations de l'exe posent +0x34/+0x38 puis +0x2C/+0x30 = << 9), puis 439b58. */
export function placeAt(world: World, p: Part, x: number, y: number): void {
  p.px = x;
  p.py = y;
  p.fx = x << 9;
  p.fy = y << 9;
  updateGeometry(world, p);
}

/**
 * 439830 : copie d'une pièce (mur coupé par une explosion) : type, drapeaux, images, tailles, boîte, ancrages +0x88,
 * +0x8C et +0xB0 … +0xB3, polygone propre recopié, état d'édition +0xF0 … +0xF8, puis slot 2. La position n'est pas
 * copiée (zéro, y compris +0x2C/+0x30 et la position d'édition). Les cas des courroies, cordes, balle programmable et
 * lasers (blocs alloués) ne concernent pas les murs et ne sont pas repris.
 */
export function clonePart(world: World, src: Part): Part {
  const p = new Part();
  p.type = src.type;
  p.flags0C = src.flags0C;
  p.flags10 = src.flags10;
  p.flags14 = src.flags14;
  p.frame = src.frame;
  p.framePrev = src.framePrev;
  p.framePrev2 = src.framePrev2;
  p.f24 = src.f24;
  p.shapeW = src.shapeW;
  p.shapeH = src.shapeH;
  p.frameW = src.frameW;
  p.frameH = src.frameH;
  p.boxW = src.boxW;
  p.boxH = src.boxH;
  p.f88 = src.f88;
  p.f89 = src.f89;
  p.f8C = src.f8C;
  p.ropeAnchor.set(src.ropeAnchor.subarray(0, 4));
  p.poly = src.poly;
  const d = world.types.get(src.type);
  p.vertexCount = d.vertexCount;
  if (d.vertexCount !== 0 && !d.polygons && src.poly) {
    const poly = new Polygon(src.poly.length);
    for (let i = 0; i < d.vertexCount && i < poly.length; i++) {
      poly.x[i] = src.poly.x[i]!;
      poly.y[i] = src.poly.y[i]!;
      poly.angle[i] = src.poly.angle[i]!;
    }
    p.poly = poly;
  }
  p.editFrame = src.editFrame;
  p.editF24 = src.editF24;
  p.editFlags10 = src.editFlags10;
  world.call(2, p);
  return p;
}


/** Ancien nom (groupe `electric`) : 432d00. */
export const createPart = recyclePart;

/** 4393e0(p, mobiles, 0) d'une pièce créée. */
export function addMobile(world: World, p: Part): void {
  insertCreated(world, world.mobiles, p);
}
