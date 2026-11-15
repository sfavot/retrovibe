/**
 * Grille-pain (81). Traduit de TIMWIN.EXE 446998 … 446c2a. Pas d'équivalent OpenTIM (pièce propre à TIM3).
 * Effets d'affichage (43087b, 439695) ignorés.
 */
import { updateGeometry, computeEdgeAngles } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { cached, collectInRect, frameCount, stateFrame } from "./kernel";
import { strikeZone } from "./strike";

const TOASTER = 81;
const MEL = 0x36;

/**
 * 0x481fac / 0x481fc4 (slot 2, 44b2c0 sur 0x4782c0 / 0x4782d8) : pour les trois séquences (k = 0 … 2), image des états
 * {1, 6, 7} (début) et image de fin (état {6, 7, fin} − 1). (0x481fb8, états {2, 3, 4}, n'est lue par aucun handler porté.)
 */
function frames(world: World): { start: number[]; last: number[] } {
  return cached(world.types, "toaster.frames", () => ({
    start: [1, 6, 7].map((s) => stateFrame(world.types, TOASTER, s)),
    last: [6, 7, -1].map((s) => ((s < 0 ? frameCount(world.types, TOASTER) : stateFrame(world.types, TOASTER, s)) - 1) | 0),
  }));
}

/** 0x4782e4 : décalage vertical (haut de la zone de frappe) aux images début + 4 … 6. */
const STRIKE_TOP = [-0x20, -0x32, -0x4a];

/** Séquence (0 … 2) selon l'image : < fin 0, < fin 1, sinon 2 (comme 446998 et 446ae6). */
function sequence(world: World, p: Part): number {
  const { last } = frames(world);
  if (p.frame < last[0]!) return 0;
  if (p.frame < last[1]!) return 1;
  return 2;
}

/** 446c2a : vitesse donnée à une pièce frappée, d'après sa masse (+0x5C). */
function strikeForce(mass: number): number {
  if (mass < 2) return 0x1400;
  if (mass < 6) return 0x1200;
  if (mass < 10) return 0x1000;
  if (mass < 0x15) return 0xe00;
  if (mass < 0x79) return 0xc00;
  if (mass < 0x97) return 0xa00;
  if (mass < 0xc9) return 0x800;
  return 0x600;
}

/** 0x481664 (posée par 4445e5) : image de repos (état 8) de la pièce 54. */
function melRestFrame(world: World): number {
  return cached(world.types, "toaster.melRest", () => stateFrame(world.types, MEL, 8));
}

/**
 * 446998 (slot 0) : une pièce touche le grille-pain par le côté `contactIndex` (ramené à l'orientation du grille-pain).
 * Au côté 2, le grille-pain qui attend (image de début de séquence) passe à l'image suivante. Accepte toujours.
 */
function toasterAccept(world: World, p: Part, toucher: Part): number {
  const t = toucher.contact ?? p;
  const k = sequence(world, t);
  let side = toucher.contactIndex;
  if (t.flags10 & 0x10) {
    const n = world.types.get(TOASTER).vertexCount;
    side = (n - side - 2) | 0;
    if (side < 0) side = (side + n) | 0;
  }
  if (frames(world).start[k] === t.frame && side === 2) t.frame = (t.frame + 1) | 0;
  return 1;
}

/** 446ae6 (slot 1) : avance l'animation ; aux images début + 4 … 6, lance les pièces de la zone vers le haut. */
function toasterRun(world: World, p: Part): void {
  const { start, last } = frames(world);
  const k = sequence(world, p);
  p.flags10 |= 0x40;
  if (((start[k]! + 1) | 0) < p.frame && last[k] !== p.frame) {
    p.frame = (p.frame + 1) | 0;
  } else if (p.f24 !== 0 && ((start[k]! + 1) | 0) === p.frame) {
    // Au repos déclenché : attend 20 × (k + 1) pas avant de passer à l'image suivante.
    p.fFC = (p.fFC + 1) | 0;
    if ((k + 1) * 20 <= p.fFC) p.frame = (p.frame + 1) | 0;
  }
  if (((start[k]! + 4) | 0) <= p.frame && p.frame <= ((start[k]! + 6) | 0)) {
    const top = STRIKE_TOP[p.frame - start[k]! - 4]!;
    collectInRect(world, p, 0x3000, 8, 0x26, top, 0); // 434eff
    strikeZone(world, p, 0, 8, 0x26, top, 0); // 43dc73
    for (let q = p.bucketNext; q; q = q.bucketNext) {
      if (!(q.flags0C & 0x1000)) continue;
      q.vy = -strikeForce(q.mass) | 0;
      const melRest = melRestFrame(world);
      if (q.type === MEL && q.frame < melRest) q.frame = melRest;
    }
    p.fFC = (p.fFC + 1) | 0;
  }
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

/** 446a10 (slot 2) : polygone selon le retournement (0 ou 1), angles des côtés (439e38). */
function toasterReset(world: World, p: Part): void {
  frames(world);
  const polys = world.types.get(p.type).polygons;
  if (!polys) return;
  p.poly = polys[p.flags10 & 0x10 ? 1 : 0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/** 446aae (slot 3) : tout argument non nul retourne la pièce ; slot 2 ; géométrie. */
function toasterEdit(world: World, p: Part, arg?: number | Part | null): void {
  if (arg) p.flags10 ^= 0x10;
  toasterReset(world, p);
  updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  r.register(0x446998, "toaster.accept", (w, p, a) => (a && typeof a === "object" ? toasterAccept(w, p, a) : 1));
  r.register(0x446ae6, "toaster.run", (w, p) => toasterRun(w, p));
  r.register(0x446a10, "toaster.reset", (w, p) => toasterReset(w, p));
  r.register(0x446aae, "toaster.edit", (w, p, a) => toasterEdit(w, p, a));
}
