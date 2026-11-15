/**
 * Moteur à souris (6). Traduit de TIMWIN.EXE 43f718 (slot 2), 43f793 (slot 0), 43f7ac (slot 1), 43f8cb (slot 3),
 * 43f907 (démarrage), 43f92f (boîte, 434ec6). OpenTIM (TEMIM `src/parts/mod.rs`, « mort cage ») : même idée, autre code.
 */
import { updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import { chain, imageScan } from "../../zone";
import type { HandlerRegistry } from "../registry";
import { otherBeltEnd } from "./belt";
import { flipEdit, setPoly, stateFirst } from "./common";

/** 43f718 : poulie (+0x88 = 0x0b ou 0x25 selon le retournement, +0x89 = 0x0b, rayon 6), polygone 0. */
function mouseReset(world: World, p: Part): void {
  p.f88 = p.flags10 & 0x10 ? 0x0b : 0x25;
  p.f89 = 0x0b;
  p.f8C = 6;
  setPoly(world, p, 0);
}

/** 43f907 : la souris court pendant 100 pas, sens selon le retournement. */
export function mouseStart(p: Part): void {
  p.f24 = p.flags10 & 0x10 ? -1 : 1;
  p.fFC = 0x64;
}

/** 43f92f : la boîte de collision sert de zone (434ec6) tant que la souris est au repos ou dans ses premières images. */
function mouseUsesBox(world: World, p: Part): number {
  return p.frame < stateFirst(world, 6, 6) && p.frame !== 0 ? 1 : 0;
}

/** 43f7ac (slot 1) : un chat (12) tout près lance la souris ; la courroie reçoit 2 × le sens ; animation et repos. */
function mouseRun(world: World, p: Part): void {
  const run = stateFirst(world, 6, 6);
  const end = stateFirst(world, 6, -1);
  if (p.f24 === 0) {
    imageScan(world, p, 0x1000, -0x10, 0x10, 0, 0);
    for (const b of chain(p))
      if (b.type === 0x0c) {
        mouseStart(p);
        break;
      }
  }
  const q = otherBeltEnd(p);
  if (q && !(q.flags10 & 0x800)) q.f24 = (p.f24 + p.f24) | 0;
  if (p.f24 !== 0) {
    if (p.frame < run) p.frame = run;
    else {
      p.frame++;
      if (p.frame === end) {
        if (world.animFlags & 1) p.frame = run;
        else p.frame -= 2;
      }
    }
    p.fFC = (p.fFC - 1) | 0;
    if (p.fFC === 0) {
      p.f24 = 0;
      p.frame = 0;
    }
  } else if (world.animFlags & 1) {
    if (p.frame !== 0) {
      p.frame++;
      if (p.frame === run) p.frame = 0;
    } else {
      // 0x477e74 : délai avant que la souris au repos remue.
      world.mouseIdleTimer = (world.mouseIdleTimer - 1) | 0;
      if (world.mouseIdleTimer <= 0) {
        p.frame++;
        world.mouseIdleTimer = (world.rng.next() % 200) + 0x28;
      }
    }
  }
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x43f718, "mouseMotor.reset", (w, p) => mouseReset(w, p));
  r.register(0x43f793, "mouseMotor.accept", (_w, p, a) => {
    mouseStart((a as Part | null)?.contact ?? p);
    return 1;
  });
  r.register(0x43f7ac, "mouseMotor.run", (w, p) => mouseRun(w, p));
  r.register(0x43f8cb, "mouseMotor.edit", (w, p, a) => flipEdit(w, p, typeof a === "number" ? a : 0, mouseReset));
  r.registerSpecial(0x43f907, "mouseMotor.start", (_w, p) => mouseStart(p));
  r.registerSpecial(0x43f92f, "mouseMotor.usesBox", (w, p) => mouseUsesBox(w, p));
}
