/**
 * Pièces à air : pompe à vélo (16), ventilateur (24), moulinet (40). Traduit de TIMWIN.EXE 440480 (slot 0), 4404cc
 * (slot 2), 4404fe (slot 3), 440536 (slot 1) pour la pompe ; 440f6c, 440f99, 441107 pour le ventilateur ; 44324c,
 * 44326c, 44331d pour le moulinet. OpenTIM (TEMIM, `src/parts/mod.rs`) a la pompe et le ventilateur avec d'autres
 * constantes ; le binaire de TIM3 fait foi.
 */
import { idiv, mul16 } from "../../fixed";
import { clampVelocity } from "../../gravity";
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import { boxScan, chain } from "../../zone";
import type { HandlerRegistry } from "../registry";
import { otherBeltEnd } from "./belt";
import { flipEdit, setPoly, stateAt } from "./common";

/** Côté du polygone touché, ramené à celui de la pièce non retournée. */
function side(world: World, c: Part, owner: Part): number {
  let s = c.contactIndex;
  if (owner.flags10 & 0x10) {
    const n = world.types.get(owner.type).vertexCount;
    s = (n - s - 2) | 0;
    if (s < 0) s = (s + n) | 0;
  }
  return s;
}

/** Pièces légères soufflées : leur animation repart de zéro (2d, 4e, 8a). */
function resetBlown(b: Part): void {
  if (b.type === 0x2d || b.type === 0x4e || b.type === 0x8a) b.f104 = b.f24 = b.frame = 0;
}

/** Souffle sur la chaîne +0xC4 : force × (256 − |écart +0xC8|) >> `shift` / masse ; moulinets touchés lancés. */
function blow(world: World, p: Part, force: number, shift: number, staticPinwheelOnly: boolean): void {
  for (const b of chain(p)) {
    if (staticPinwheelOnly ? b.flags0C & 0x2000 : !(b.flags0C & 0x1000)) {
      if (b.type === 0x28 && (!staticPinwheelOnly || Math.abs(b.fC8) < 0xc8)) {
        b.f24 = 1;
        b.f104 = 0x14;
      }
      continue;
    }
    b.vx = (b.vx + idiv(mul16(force, 0x100 - Math.abs(b.fC8)) >> shift, b.mass)) | 0;
    clampVelocity(b, world.types);
    resetBlown(b);
  }
}

// --- Pompe (16) ---------------------------------------------------------------------------------------------------

/** 4404cc (slot 2) : polygone = image (+3 si retournée). */
function pumpReset(world: World, p: Part): void {
  setPoly(world, p, (p.flags10 & 0x10 ? 3 : 0) + p.frame);
}

/** 440480 (slot 0) : une pièce qui tombe sur la poignée (côtés 0 ou 2) actionne la pompe. */
function pumpAccept(world: World, c: Part): number {
  const s = side(world, c, c.contact!);
  if (s === 0 || s === 2) c.contact!.f24 = 1;
  return 1;
}

/** 0x477ec0 : dernière image de la course de la pompe. */
const PUMP_LAST = 2;

/** 440536 (slot 1) : actionnée, la poignée descend d'une image et souffle sur 128 px devant la buse. */
function pumpRun(world: World, p: Part): void {
  p.flags10 |= 0x40;
  if (p.f24 === 1 && p.frame !== PUMP_LAST) {
    p.frame++;
    const h = p.frameH >> 1;
    let force: number;
    if (p.flags10 & 0x10) {
      boxScan(world, p, 0x3000, -0x80, 0, h - 6, h + 10);
      force = -0x1400;
    } else {
      boxScan(world, p, 0x3000, p.frameW, (p.frameW + 0x80) | 0, h - 6, h + 10);
      force = 0x1400;
    }
    blow(world, p, force, 7, false);
  }
  if (p.frame !== p.framePrev) {
    pumpReset(world, p);
    updateGeometry(world, p);
  }
}

// --- Ventilateur (24) ---------------------------------------------------------------------------------------------

const fanReset = (world: World, p: Part) => setPoly(world, p, p.flags10 & 0x10 ? 1 : 0);

/** 440f99 (slot 1) : alimenté, il tourne et souffle sur 256 px devant lui ; les moulinets fixes proches tournent. */
function fanRun(world: World, p: Part): void {
  if (p.f24 === 0) {
    p.frame = 0;
    updateGeometry(world, p);
    return;
  }
  if (!(world.animFlags & 1)) p.frame = p.frame === 2 ? 1 : 2;
  else {
    p.frame = p.frame === 0 ? 2 : p.frame + 1;
    if (stateAt(world, 0x18, p.frame) !== 0) p.frame = 1;
  }
  let force: number;
  if (p.flags10 & 0x10) {
    boxScan(world, p, 0x3000, p.frameW, (p.frameW + 0x100) | 0, 0, p.frameH);
    force = 0x1000;
  } else {
    boxScan(world, p, 0x3000, -0x100, 0, 0, p.frameH);
    force = -0x1000;
  }
  blow(world, p, force, 8, true);
  updateGeometry(world, p);
}

// --- Moulinet (40) ------------------------------------------------------------------------------------------------

/** 44324c (slot 2) : poulie (0x1a, 0x1a, rayon 3). */
function pinwheelReset(_w: World, p: Part): void {
  p.f88 = p.f89 = 0x1a;
  p.f8C = 3;
}

/** 44326c (slot 1) : soufflé (+0x104 pas), il tourne et entraîne sa courroie (±2). */
function pinwheelRun(world: World, p: Part): void {
  p.f24 = 0;
  if (p.f104 !== 0) {
    p.f104--;
    if (p.f104 !== 0) p.f24 = 1;
  }
  const q = otherBeltEnd(p);
  if (q && !(q.flags10 & 0x800)) q.f24 = p.f24 !== 0 ? (p.flags10 & 0x10 ? -2 : 2) : 0;
  if (p.f24 !== 0) {
    p.frame++;
    if (stateAt(world, 0x28, p.frame) === -1) {
      if (world.animFlags & 1) p.frame = 1;
      else p.frame -= 2;
    }
  } else p.frame = 0;
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x440480, "pump.accept", (w, _p, a) => pumpAccept(w, a as Part));
  r.register(0x4404cc, "pump.reset", (w, p) => pumpReset(w, p));
  r.register(0x4404fe, "pump.edit", (w, p, a) =>
    flipEdit(w, p, typeof a === "number" ? a : 0, pumpReset, () => updateGeometry(w, p)),
  );
  r.register(0x440536, "pump.run", (w, p) => pumpRun(w, p));
  r.register(0x440f6c, "fan.reset", (w, p) => fanReset(w, p));
  r.register(0x440f99, "fan.run", (w, p) => fanRun(w, p));
  r.register(0x441107, "fan.edit", (w, p, a) => flipEdit(w, p, typeof a === "number" ? a : 0, fanReset));
  r.register(0x44324c, "pinwheel.reset", (w, p) => pinwheelReset(w, p));
  r.register(0x44326c, "pinwheel.run", (w, p) => pinwheelRun(w, p));
  r.register(0x44331d, "pinwheel.edit", (w, p, a) => flipEdit(w, p, typeof a === "number" ? a : 0, () => undefined));
}
