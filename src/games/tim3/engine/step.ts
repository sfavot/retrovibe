/**
 * 433334 : un pas de simulation (« advance parts »), dans l'ordre exact de l'exe, puis 43abff (après-pas).
 * Correspondance OpenTIM : `advance_parts` (`c_src/main.c`, `src/parts/mod.rs`, TEMIM) — mêmes passes, offsets de
 * TIM3. Les fonctions des familles non portées (cordes 43a31d, seaux 43518f/43ab9a/435309, lasers 43d013) passent par
 * `World.special` : souches journalisées tant que la vague Φ2 ne les enregistre pas.
 */
import { bounce, hit, roll } from "./bounce";
import { collide } from "./collide";
import { applyGravity } from "./gravity";
import { movePart } from "./move";
import type { Part } from "./part";
import { F0C, F10, F14 } from "./part";
import type { World } from "./world";

const isBucket = (p: Part) => p.type === 0x11 || p.type === 0x6c;
const active = (p: Part) => !(p.flags10 & F10.GONE) && !(p.flags14 & F14.SUSPENDED);

/** 43be61 : types dont le slot 1 tourne après la réponse au contact (43373c) plutôt qu'avant le déplacement (4335ce). */
export function runsAfterContact(p: Part): number {
  switch (p.type) {
    case 0:
    case 9:
    case 0x44:
      return 4;
    case 0x1c:
    case 0x2c:
      return 3;
    case 0x57:
      return p.frame >= 5 && p.frame <= 0x14 ? 3 : 0;
    default:
      return 0;
  }
}

/** 4335ce : slot 1, déplacement et collisions d'une pièce mobile (la pièce porteuse d'abord si elle n'a pas bougé). */
export function moveAndCollide(world: World, p: Part): void {
  p.flags0C |= F0C.MOVED;
  if (!active(p)) return;
  if (p.type !== 0x3e && !runsAfterContact(p)) world.call(1, p);
  const save = {
    fx: p.fx,
    fy: p.fy,
    flags0C: p.flags0C,
    flags14: p.flags14,
    contact: p.contact,
    left: p.contactLeft,
    right: p.contactRight,
    angle: p.contactAngle,
    index: p.contactIndex,
  };
  movePart(world, p);
  p.flags0C &= ~0xf;
  if (collide(world, p)) {
    const c = p.contact!;
    if (c.flags0C & F0C.IN_MOBILE && !(c.flags0C & F0C.MOVED) && !isBucket(c)) {
      // La pièce touchée n'a pas encore bougé dans ce pas : on annule, on la fait bouger, puis on recommence.
      p.fx = save.fx;
      p.fy = save.fy;
      p.flags0C = save.flags0C;
      p.flags14 = save.flags14;
      p.contact = save.contact;
      p.contactLeft = save.left;
      p.contactRight = save.right;
      p.contactAngle = save.angle;
      p.contactIndex = save.index;
      p.px = p.prevPx;
      p.py = p.prevPy;
      p.drawX = p.prevDrawX;
      p.drawY = p.prevDrawY;
      moveAndCollide(world, c);
      movePart(world, p);
      p.flags0C &= ~0xf;
      collide(world, p);
    }
  }
  if (p.ropes[0]) {
    // 43a31d : tension de corde (Φ2). Sans elle, l'exe refait seulement les collisions.
    const r = world.special(0x43a31d, p);
    let kept: { contact: Part | null; left: number; right: number } | null = null;
    if (r) p.flags0C &= ~0xf;
    else {
      kept = { contact: p.contact, left: p.contactLeft, right: p.contactRight };
      p.contact = null;
    }
    collide(world, p);
    if (kept && p.contact === null) {
      p.contact = kept.contact;
      p.contactLeft = kept.left;
      p.contactRight = kept.right;
    }
  }
}

/** 43373c : réponse au contact (rebond, roulement, choc), après celle de la pièce touchée ; slot 1 des balles. */
export function resolveContact(world: World, p: Part): void {
  p.flags0C |= F0C.DONE;
  if (p.flags0C & F0C.CONTACT_MOBILE && !(p.contact!.flags0C & F0C.DONE)) resolveContact(world, p.contact!);
  if (p.flags14 & F14.SUSPENDED) {
    p.f104 = (p.f104 - 1) | 0;
    if (p.f104 === 0) p.flags14 &= ~F14.SUSPENDED;
    return;
  }
  if (!(p.flags10 & F10.GONE)) {
    if (p.flags0C & 6 && (p.type === 0x36 || p.type === 0x6d || p.type === 0x3b || p.type === 0x21)) world.call(0, p);
    if (p.flags0C & F0C.CONTACT_HEAVY) {
      if (world.call(0, p.contact!, p)) {
        if (p.flags0C & F0C.ROLLING) roll(world, p);
        else bounce(world, p);
      }
    } else if (p.flags0C & F0C.CONTACT_MOBILE) {
      if (world.call(0, p.contact!, p)) hit(world, p);
    }
  }
  if (!(p.flags14 & F14.SUSPENDED) && runsAfterContact(p)) world.call(1, p);
}

/** 433334 : un pas complet. */
export function stepParts(world: World): void {
  for (const p of world.statics) p.flags10 &= ~0x640;
  // Le slot 1 d'une bascule peut ajouter des nœuds (43ab07) : on suit la liste chaînée telle qu'elle évolue.
  for (let i = 0; i < world.aux.length; i++) {
    const p = world.aux[i]!.part;
    if (!(p.flags10 & 0x40)) world.call(1, p);
  }
  // 43aad1 : la liste auxiliaire est rendue aux nœuds libres.
  world.aux = [];
  for (const p of world.statics) if (p.flags10 & 0x800 && !(p.flags10 & 0x2040)) world.call(1, p);
  for (const p of world.statics) if ((p.type === 0x0e || p.type === 0x56) && !(p.flags10 & 0x2040)) world.call(1, p);
  for (const p of world.statics) if (!(p.flags10 & 0x2840)) world.call(1, p);
  for (const p of world.mobiles) if (p.type === 0x3e) world.call(1, p);
  for (const p of world.mobiles) {
    if (active(p)) applyGravity(p, world.types);
    p.flags0C &= ~0x48;
    p.flags14 &= ~0x10;
  }
  for (const p of world.mobiles) if (!isBucket(p) && active(p)) moveAndCollide(world, p);
  for (const p of world.mobiles) {
    if (isBucket(p) && active(p)) {
      p.mass = world.types.get(p.type).mass;
      world.special(0x43518f, p);
      world.special(0x43ab9a, p);
    }
  }
  for (const p of world.mobiles) {
    if (isBucket(p) && active(p)) {
      world.special(0x43518f, p);
      moveAndCollide(world, p);
    }
  }
  for (const p of world.mobiles) {
    if (isBucket(p) && active(p)) {
      world.special(0x43518f, p);
      world.special(0x435309, p);
    }
  }
  for (const p of world.mobiles) if (!(p.flags0C & F0C.DONE)) resolveContact(world, p);
  for (const p of world.statics) if (p.type === 0x5b || p.type === 0x5c || p.type === 0x5d || p.type === 0x5f) world.special(0x43d013, p);
  // Dernière boucle : 439f13 → 439695(p, 1) pour les pièces qui ont bougé ou changé d'image (extrémités des cordes).
  for (const p of world.staticThenMobile()) {
    if (p.flags10 & F10.GONE || p.flags14 & 0x1000 || p.flags14 & F14.SUSPENDED) continue;
    if (p.px !== p.prevPx || p.py !== p.prevPy || p.frame !== p.framePrev) world.redraw(p, 1);
  }
}

/** Après le pas, côté affichage (4309a6 puis 42d2e6(0)) : l'octet +0x28 des pièces est décompté (bit 0x40 gardé). */
function countDownRedraw(world: World): void {
  for (const p of world.staticThenMobile()) if (p.redraw === 0x40) p.redraw = 0;
  for (const list of [world.mobiles, world.statics]) {
    for (const p of list) {
      if (p.redraw === 0) continue;
      p.redraw = ((((p.redraw & 0x3f) - 1) & 0xff) | (p.redraw & 0x40)) << 24 >> 24;
    }
  }
}

/** Un tour de la boucle « machine en marche » (4359a4) côté simulation : 433334, puis 43abff, puis le compteur. */
export function step(world: World): void {
  stepParts(world);
  countDownRedraw(world);
  world.savePrevious();
  world.frameCounter++;
}
