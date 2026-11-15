/**
 * Diable en boîte (13). Traduit de TIMWIN.EXE 440098 … 4402ee. Pas d'équivalent OpenTIM (pièce propre à TIM3).
 * Effets d'affichage (43050d, 43087b, 439695) ignorés.
 */
import { abs32 } from "../../fixed";
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import { defaultReset } from "../core";
import type { HandlerRegistry } from "../registry";
import { cached, collectInRect, stateFrame } from "./kernel";
import { strikeZone } from "./strike";

const JACK = 13;
const MOUSE_MEL = 0x36;

/** 0x481dac, 0x481db0, 0x481db4 (calculés au slot 2 par 44b2c0) : images des états 4, 5 et 0xD. */
function frames(world: World): { rest: number; strike: number; end: number } {
  return cached(world.types, "jack.frames", () => ({
    rest: stateFrame(world.types, JACK, 4),
    strike: stateFrame(world.types, JACK, 5),
    end: stateFrame(world.types, JACK, 0xd),
  }));
}

/** 0x481664 (posée par 4445e5, slot 2 de Mel) : image de repos (état 8) de la pièce 54. */
function melRestFrame(world: World): number {
  return cached(world.types, "jack.melRest", () => stateFrame(world.types, MOUSE_MEL, 8));
}

/** 0x477eb4 : décalage vertical (haut de la zone de frappe) selon l'image du coup (état 5 + 0 … 2). */
const STRIKE_TOP = [-0x15, -0x22, -0x3b];

/** 439f44 : l'autre bout de la courroie de la pièce (null sans courroie). */
function beltOther(p: Part): Part | null {
  const b = p.belt;
  if (!b) return null;
  return p === b.end1 ? b.end2 : b.end1;
}

/** 4402ee : vitesse donnée à une pièce frappée, d'après sa masse (+0x5C). */
function strikeForce(mass: number): number {
  if (mass < 2) return 0x1800;
  if (mass < 6) return 0x1600;
  if (mass < 10) return 0x1400;
  if (mass < 0x15) return 0x1200;
  if (mass < 0x79) return 0x1000;
  if (mass < 0x97) return 0xe00;
  if (mass < 0xc9) return 0xc00;
  if (mass < 0x709) return 0xa00;
  return 0x800;
}

/** 440098 (slot 2) : ancrages +0x88 / +0x89 / +0x8C, polygone 0 et angles des côtés (439e38). */
function jackReset(world: World, p: Part): void {
  frames(world);
  p.f88 = p.flags10 & 0x10 ? 0x12 : 0x0c;
  p.f89 = 0x12;
  p.f8C = 8;
  defaultReset(world, p);
}

/** 440128 (slot 1) : tourne le ressort d'image en image, puis, à l'état de frappe, lance les pièces de la zone. */
function jackRun(world: World, p: Part): void {
  const { rest, strike, end } = frames(world);
  const flip = (p.flags10 & 0x10) !== 0;
  if (p.frame >= strike) {
    if (p.frame !== end) p.frame = (p.frame + 1) | 0;
  } else {
    if (p.f24 !== 0) {
      // La pièce reliée par la courroie (14 ou 86) à l'arrêt coupe le déclencheur.
      const other = beltOther(p);
      if (other && (other.type === 0xe || other.type === 0x56) && other.framePrev === other.framePrev2) p.f24 = 0;
    }
    if (p.f24 !== 0) {
      if (flip) p.frame = p.f24 < 0 ? (p.frame + 1) | 0 : (p.frame - 1) | 0;
      else p.frame = p.f24 < 0 ? (p.frame - 1) | 0 : (p.frame + 1) | 0;
      if (p.frame === strike) {
        p.frame = rest;
        p.fFC = (p.fFC + 1) | 0;
      } else if (p.frame <= 0) {
        p.frame = (strike - 1) | 0;
        p.fFC = (p.fFC + 1) | 0;
      }
      // sar eax, cl : le décalage est pris modulo 32.
      if (8 >> (abs32(p.f24) >> 1) <= p.fFC) p.frame = strike;
    }
  }
  if (p.frame >= strike && p.frame <= ((strike + 2) | 0)) {
    const top = STRIKE_TOP[p.frame - strike]!;
    collectInRect(world, p, 0x3000, 0, 0x1f, top, 0); // 434eff
    strikeZone(world, p, 0, 0, 0x1f, top, 0); // 43dc73
    for (let q = p.bucketNext; q; q = q.bucketNext) {
      if (!(q.flags0C & 0x1000)) continue;
      const v = strikeForce(q.mass);
      q.vx = flip ? v : -v | 0;
      q.vy = -v | 0;
      const melRest = melRestFrame(world);
      if (q.type === MOUSE_MEL && q.frame < melRest) q.frame = melRest;
    }
  }
  if (p.frame !== p.framePrev) updateGeometry(world, p); // 439b58
}

/** 4402b2 (slot 3) : tout argument non nul retourne la pièce ; slot 2 ; affichage ignoré. */
function jackEdit(world: World, p: Part, arg?: number | Part | null): void {
  if (arg) p.flags10 ^= 0x10;
  jackReset(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x440128, "jack.run", (w, p) => jackRun(w, p));
  r.register(0x440098, "jack.reset", (w, p) => jackReset(w, p));
  r.register(0x4402b2, "jack.edit", (w, p, a) => jackEdit(w, p, a));
}
