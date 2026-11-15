/**
 * Explosifs : explosion (41), dynamite (19), explosifs télécommandés (55), nitroglycérine (74), et ce que fait le
 * souffle (murs percés, aquarium cassé, moteur à souris lancé, pièces projetées). Traduit de TIMWIN.EXE 443354 …
 * 444bda, 440974 … 440a51, 445f70 … 446014. Correspondance OpenTIM : `src/parts/mod.rs` (TEMIM : `dynamite`,
 * `explosion`) ; le binaire de TIM3 fait foi.
 */
import { abs32, s16 } from "../../fixed";
import { updateGeometry } from "../../move";
import { F10, type Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import {
  centreAngle,
  chain,
  clonePart,
  explodeNitro,
  fishTankBroken,
  insertCreated,
  launch,
  LIST_MOBILE,
  LIST_STATIC,
  nearby,
  placeAt,
  recyclePart,
  setAnchor,
  stateAt,
  stateFrame,
  usePolygon,
} from "./kernel";

/** Pièce qui touche (argument du slot 0 dans l'exe) : `arg` quand le noyau la passe, sinon la pièce elle-même. */
function mover(self: Part, arg: unknown): Part {
  return arg && typeof arg === "object" ? (arg as Part) : self;
}

// ---------------------------------------------------------------------------------------------------------------------
// Explosion (41).

/** 4434f3 : force du souffle selon la masse de la pièce projetée (+0x5C). */
function blastForce(mass: number): number {
  if (mass < 2) return 0x1800;
  if (mass < 6) return 0x1600;
  if (mass < 0xa) return 0x1400;
  if (mass < 0x15) return 0x1200;
  if (mass < 0x79) return 0x1000;
  if (mass < 0x97) return 0xe00;
  if (mass < 0xc9) return 0xc00;
  if (mass < 0x709) return 0xa00;
  return 0x800;
}

/** Types de murs que le souffle perce (443569). */
const BREAKABLE_WALLS = new Set([1, 0x30, 0x3c, 0x53, 0x55, 0x7d]);

/** 43e8cc (slot 2 des murs) : rectangle de la taille de l'image. */
function wallReset(world: World, p: Part): void {
  const h = world.handlers.get(0x43e8cc);
  if (h) h.fn(world, p);
  else world.stub(0x43e8cc, p);
}

/**
 * 443569(mur, explosion) : perce un trou de 64 px (aligné sur 16 px) centré sur l'explosion. Le mur est raccourci, coupé
 * en deux (copie 439830 insérée dans les statiques) ou détruit. Seuls +0x34/+0x44 (ou +0x38/+0x48) et la taille de
 * l'image changent : la position fine +0x2C/+0x30 reste (zéro pour la copie).
 */
function breakWall(world: World, w: Part, e: Part): void {
  const cx = ((e.frameW >> 1) + e.px) | 0;
  const cy = ((e.frameH >> 1) + e.py) | 0;
  if (w.frameW > w.frameH) {
    const lo = (((cx - 0x40) & -0x10) + 8) | 0;
    const hi = (((cx + 0x18) & -0x10) + 8) | 0;
    const end = (w.px + w.frameW) | 0;
    if (lo > w.px) {
      if (hi < end) {
        const n = clonePart(world, w);
        insertCreated(world, world.statics, n);
        n.frameW = (end - hi) | 0;
        n.px = n.drawX = hi;
        n.py = n.drawY = w.py;
        w.frameW = (lo - w.px) | 0;
        wallReset(world, n);
      } else if (end > lo) w.frameW = (lo - w.px) | 0;
      wallReset(world, w);
    } else if (hi < end) {
      if (hi > w.px) {
        w.frameW = (end - hi) | 0;
        w.px = w.drawX = hi;
        wallReset(world, w);
      }
    } else if (hi > w.px && end > lo) w.flags10 |= F10.GONE;
  } else {
    const lo = (((cy - 0x40) & -0x10) + 8) | 0;
    const hi = (((cy + 8) & -0x10) + 8) | 0;
    const end = (w.py + w.frameH) | 0;
    if (lo > w.py) {
      if (hi < end) {
        const n = clonePart(world, w);
        insertCreated(world, world.statics, n);
        n.frameH = (end - hi) | 0;
        n.px = n.drawX = w.px;
        n.py = n.drawY = hi;
        w.frameH = (lo - w.py) | 0;
        wallReset(world, n);
      } else if (end > lo) w.frameH = (lo - w.py) | 0;
      wallReset(world, w);
    } else if (hi < end) {
      if (hi > w.py) {
        w.frameH = (end - hi) | 0;
        w.py = w.drawY = hi;
        wallReset(world, w);
      }
    } else if (hi > w.py && end > lo) w.flags10 |= F10.GONE;
  }
}

/** 440454 : l'aquarium (15) se casse : image de l'aquarium cassé, plus de polygone. */
function breakFishTank(world: World, p: Part): void {
  const broken = fishTankBroken(world);
  if (p.frame >= broken) return;
  p.frame = broken;
  p.poly = null;
  updateGeometry(world, p);
}

/** 43f907 : le moteur à souris (6) se met à tourner pour 100 pas (porté par mechanics). */
export function startMouseMotor(world: World, p: Part): void {
  world.special(0x43f907, p);
}

/**
 * 443354 : slot 1 de l'explosion. L'animation avance (pièce détruite à la fin) ; à l'image 1, le souffle agit sur les
 * pièces voisines (434cc4, image 0) : mobiles projetées selon leur masse, ou allumées, ou qui explosent ; statiques :
 * murs percés, aquarium cassé, moteur à souris lancé, explosifs télécommandés.
 */
function explosionRun(world: World, p: Part): void {
  p.f24 = 1;
  p.frame++;
  if (stateAt(world, p.type, p.frame) === -1) {
    p.frame--;
    // 43087b : zone à redessiner.
    p.flags10 |= F10.GONE;
  } else updateGeometry(world, p);
  if (p.frame !== 1) return;
  p.frame = 0;
  updateGeometry(world, p);
  nearby(world, p, LIST_STATIC | LIST_MOBILE, -0x28, 0x14, -0x18, 8);
  p.frame = 1;
  updateGeometry(world, p);
  for (const q of chain(p)) {
    if (q.flags0C & 0x1000) {
      switch (q.type) {
        case 0x4a:
          explodeNitro(world, q);
          break;
        case 4:
          q.f24 = 1;
          break;
        case 0x13:
          explodeDynamite(world, q);
          break;
        case 0x4f:
        case 0x6d:
          q.f24 = 2;
          break;
        default: {
          const force = blastForce(q.mass);
          launch(q, s16(centreAngle(p, q)), force);
          if (q.type === 0x36) {
            // 0x481664 : début de l'état 8 du type 54.
            const f = stateFrame(world, 0x36, 8);
            if (q.frame < f) q.frame = f;
          }
        }
      }
    } else if (q.type === 0x37) explodeRemote(world, q);
    else if (BREAKABLE_WALLS.has(q.type)) breakWall(world, q, p);
    else if (q.type === 0x0f) breakFishTank(world, q);
    else if (q.type === 6) startMouseMotor(world, q);
  }
  // 435b14(0) : extrémités des murs (dessin).
}

// ---------------------------------------------------------------------------------------------------------------------
// Dynamite (19).

/** 440a51 : la dynamite explose : explosion (41, recyclée si possible) à (x − 15, y − 19), dynamite détruite. */
function explodeDynamite(world: World, p: Part): void {
  const e = recyclePart(world, 0x29);
  if (e) {
    insertCreated(world, world.statics, e);
    placeAt(world, e, (p.px - 0xf) | 0, (p.py - 0x13) | 0);
  }
  p.flags10 |= F10.GONE;
  p.frame = (stateFrame(world, 0x13, -1) - 1) | 0;
}

/** 440974 : slot 0 : touchée par une balle de phazer (20), elle explose. */
function dynamiteAccept(world: World, self: Part, arg: unknown): number {
  const m = mover(self, arg);
  if (m.type === 0x14) explodeDynamite(world, m.contact!);
  return 1;
}

/** 4409d0 : slot 1 : allumée (+0x24, ou chauffée plus de 20 pas, +0x104), la mèche brûle jusqu'à la fin de l'ANM. */
function dynamiteRun(world: World, p: Part): void {
  if (p.f24 === 0 && p.f104 > 0x14) p.f24 = 1;
  if (p.f24 === 0) return;
  if (stateAt(world, 0x13, p.frame) === -1) {
    explodeDynamite(world, p);
    return;
  }
  p.frame++;
  updateGeometry(world, p);
}

/** 0x477fa8 : point de mise à feu de la dynamite (bout de la mèche), sans et avec retournement. */
const DYNAMITE_FUSE = [
  [1, 5],
  [52, 5],
] as const;

/** 440994 : slot 2 : polygone et point de mise à feu selon le retournement en X. */
function dynamiteReset(world: World, p: Part): void {
  const i = p.flags10 & F10.FLIP_X ? 1 : 0;
  usePolygon(world, p, i);
  setAnchor(p, 4, DYNAMITE_FUSE[i]![0], DYNAMITE_FUSE[i]![1]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Explosifs télécommandés (55).

/** 0x478130 : décalages verticaux des deux explosions (y − n). */
const REMOTE_BLASTS = [-20, 10] as const;

/** 444bda : deux explosions (41, recyclées si possible) à (x, y + 20) et (x, y − 10), pièce détruite. */
function explodeRemote(world: World, p: Part): void {
  for (const dy of REMOTE_BLASTS) {
    const e = recyclePart(world, 0x29);
    if (!e) break;
    insertCreated(world, world.statics, e);
    placeAt(world, e, p.px, (p.py - dy) | 0);
  }
  p.flags10 |= F10.GONE;
  p.frame = (stateFrame(world, 0x37, -1) - 1) | 0;
}

/** 444b60 : slot 0 : touchés par une balle de phazer, ils explosent. */
function remoteAccept(world: World, self: Part, arg: unknown): number {
  const m = mover(self, arg);
  if (m.type === 0x14) explodeRemote(world, m.contact!);
  return 1;
}

/** 444ba0 : slot 1 : déclenchés (+0x24, par le détonateur), l'animation avance puis ils explosent. */
function remoteRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.frame++;
  if (stateAt(world, 0x37, p.frame) === -1) {
    explodeRemote(world, p);
    return;
  }
  updateGeometry(world, p);
}

// ---------------------------------------------------------------------------------------------------------------------
// Nitroglycérine (74).

/** 445f70 : slot 0 : toute pièce qui la touche la fait exploser. */
function nitroAccept(world: World, self: Part, arg: unknown): number {
  explodeNitro(world, mover(self, arg).contact!);
  return 1;
}

/** 445f8a : slot 1 : explose si elle touche quelque chose à plus de 1 px par pas (|vx| + |vy| > 0x200) ; scintille. */
function nitroRun(world: World, p: Part): void {
  if (p.contact && ((abs32(p.vx) + abs32(p.vy)) | 0) > 0x200) explodeNitro(world, p);
  if (p.flags10 & F10.GONE || !(world.animFlags & 1)) return;
  p.frame++;
  if (stateAt(world, 0x4a, p.frame) !== 0) p.frame = 1;
}

export function register(r: HandlerRegistry): void {
  r.register(0x443354, "explosion.run", (w, p) => explosionRun(w, p));
  r.register(0x440974, "dynamite.accept", (w, p, a) => dynamiteAccept(w, p, a));
  r.register(0x4409d0, "dynamite.run", (w, p) => dynamiteRun(w, p));
  r.register(0x440994, "dynamite.reset", (w, p) => dynamiteReset(w, p));
  // 440a20 : slot 3 : toute action retourne en X, puis slot 2 (sans 439b58 ; affichage et 439695 laissés à l'éditeur).
  r.register(0x440a20, "dynamite.edit", (w, p, a) => {
    if (a) p.flags10 ^= F10.FLIP_X;
    dynamiteReset(w, p);
  });
  r.register(0x444b60, "remote.accept", (w, p, a) => remoteAccept(w, p, a));
  r.register(0x444ba0, "remote.run", (w, p) => remoteRun(w, p));
  r.register(0x444b80, "remote.reset", (w, p) => usePolygon(w, p, 0));
  r.register(0x445f70, "nitro.accept", (w, p, a) => nitroAccept(w, p, a));
  r.register(0x445f8a, "nitro.run", (w, p) => nitroRun(w, p));
  r.register(0x445ff4, "nitro.reset", (w, p) => usePolygon(w, p, 0));
  // Points d'entrée appelés par d'autres familles (minuteur, pulsation de phazer, gant…).
  r.registerSpecial(0x446014, "nitro.explode", (w, p) => explodeNitro(w, p));
  r.registerSpecial(0x440a51, "dynamite.explode", (w, p) => explodeDynamite(w, p));
  r.registerSpecial(0x444bda, "remote.explode", (w, p) => explodeRemote(w, p));
  r.registerSpecial(0x440454, "fishTank.break", (w, p) => breakFishTank(w, p));
}
