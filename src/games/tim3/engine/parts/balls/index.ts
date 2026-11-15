/**
 * Balles sans comportement propre hors du noyau : bowling (0), basket (9), ballon de foot (68), base-ball (28), tennis
 * (44), flipper (43), boule de billard (63). Leur slot 1 tourne après la réponse au contact (43be61) et fait tourner
 * l'image d'après le chemin parcouru. Traduit de TIMWIN.EXE 43bc67 … 43be61.
 */
import { half, idiv } from "../../fixed";
import { computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";

/** 43bc67 : polygone du type, compteurs de rotation à zéro. */
function ballReset(world: World, p: Part): void {
  p.poly = world.types.get(p.type).polygons![0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
  p.fFC = 0;
  p.f104 = 0;
}

/** 43bc9d : bowling, basket, foot : image = chemin parcouru / 6 (16 images pour le basket, 8 sinon). */
function rollingBall(_w: World, p: Part): void {
  if (p.flags0C & 1) {
    p.f104 = (p.px - p.prevPx) | 0;
    p.fFC = (p.fFC + p.f104) | 0;
  } else if (p.flags0C & 2) {
    const d = p.vx >> 9;
    p.f104 = half(d);
    p.fFC = (p.fFC + d) | 0;
  } else p.fFC = (p.fFC + p.f104) | 0;
  p.frame = idiv(p.fFC, 6) & (p.type === 9 ? 0xf : 0x7);
}

/** 43bd21 : base-ball et tennis (petites balles : rotation deux fois plus rapide). */
function smallBall(_w: World, p: Part): void {
  if (p.flags0C & 1) {
    const d = (p.px - p.prevPx) | 0;
    p.f104 = (d + d) | 0;
    p.fFC = (p.fFC + d) | 0;
  } else if (p.flags0C & 2) {
    const d = p.vx >> 9;
    p.f104 = d;
    p.fFC = (p.fFC + d) | 0;
  } else p.fFC = (p.fFC + p.f104) | 0;
  p.frame = idiv(p.fFC, 6) & 7;
}

/**
 * 43bd83 : flipper (boule de 43) : clignotement. Une image non nulle avance jusqu'à la fin de l'animation (44b19c rend
 * −1) ; sinon, un compte à rebours global (0x477d00) relance le clignotement après 40 à 239 pas tirés au hasard (4520a4).
 */
function pinball(world: World, p: Part): void {
  if (!(world.animFlags & 1)) return;
  if (p.frame !== 0) {
    p.frame++;
    if (world.types.anims[p.type]?.stateAt(p.frame) === -1) p.frame = 0;
    return;
  }
  world.pinballTimer = (world.pinballTimer - 1) | 0;
  if (world.pinballTimer > 0) return;
  p.frame++;
  world.pinballTimer = (world.rng.next() % 200) + 40;
}

/** 43bde6 : boule de billard : frottement du tapis (1/256 de la vitesse, puis 8), si la gravité du niveau n'est pas nulle. */
function poolBall(world: World, p: Part): void {
  if (world.gravity === 0) return;
  p.vx = (p.vx - (p.vx >> 8)) | 0;
  p.vy = (p.vy - (p.vy >> 8)) | 0;
  p.vx = towardZero(p.vx);
  p.vy = towardZero(p.vy);
}

function towardZero(v: number): number {
  if (v > 0) return v - 8 < 0 ? 0 : v - 8;
  if (v < 0) return v + 8 > 0 ? 0 : v + 8;
  return v;
}

export function register(r: HandlerRegistry): void {
  r.register(0x43bc67, "ball.reset", (w, p) => ballReset(w, p));
  r.register(0x43bc9d, "ball.run", (w, p) => rollingBall(w, p));
  r.register(0x43bd21, "smallBall.run", (w, p) => smallBall(w, p));
  r.register(0x43bd83, "pinball.run", (w, p) => pinball(w, p));
  r.register(0x43bde6, "poolBall.run", (w, p) => poolBall(w, p));
}
