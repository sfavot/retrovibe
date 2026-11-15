/**
 * Pulsation de phazer (20), lampe torche (25), Super Phazer (27), lampe à lave (29) et loupe (30), traduits de TIMWIN.EXE.
 * OpenTIM (TEMIM) ne les a pas : tout vient du désassemblage.
 */
import { clampVelocity } from "../../gravity";
import { updateGeometry } from "../../move";
import { F10, type Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { addMobile, chain, createPart, extra, imageScan, wakeInBeam } from "./zone";
import { flipIndex, setPolygon, stateAt, stateFirst, T } from "./support";

// --- pulsation de phazer (20) ------------------------------------------------------------------------------------

/** 440b35 : slot 2 : polygone selon le sens. */
function pulseReset(world: World, p: Part): void {
  setPolygon(world, p, T.pulse, flipIndex(p));
}

/**
 * 440a51 : une pièce de type 19 touchée par la pulsation disparaît (destruction, image = dernière − 1) et laisse une pièce
 * statique de type 41 centrée sur elle. Pas d'équivalent dans les groupes voisins : portée ici (type 19 : `pyro`).
 */
function popType19(world: World, victim: Part): void {
  const b = createPart(world, 0x29);
  if (b) {
    // 4393e0(b, 0x48117c, 0) : liste des pièces statiques.
    world.statics.insertAfter(b, null);
    b.flags0C |= 0x10;
    b.px = (victim.px - 0xf) | 0;
    b.py = (victim.py - 0x13) | 0;
    b.fx = b.px << 9;
    b.fy = b.py << 9;
    updateGeometry(world, b);
  }
  victim.flags10 |= F10.GONE;
  victim.frame = (stateFirst(world, 19, -1) - 1) | 0;
}

/** 440ad4 : slot 0 : la pulsation est touchée par `toucher` ; rend 1 (le contact compte). */
function pulseTouched(world: World, pulse: Part, toucher: Part): number {
  switch (toucher.type) {
    case 4:
      toucher.f24 = 1;
      break;
    case 0x4f:
    case 0x6d:
      toucher.f24 = 2;
      break;
    case 0x13:
      popType19(world, toucher);
      break;
    case 0x37:
      world.special(0x444bda, toucher);
      break;
    case 0x15:
      pulse.vx = (pulse.vx - 1) | 0;
      break;
  }
  return 1;
}

/**
 * 440b62 : slot 1 : à la fin de l'animation (état non nul à l'image), la pulsation disparaît ; sinon elle poursuit son
 * animation ; en vol (image 0), elle prend la direction de sa vitesse, s'arrête si elle n'en a plus, et réveille ce qu'elle touche.
 */
function pulseRun(world: World, p: Part): void {
  if (p.frame !== 0 && stateAt(world, T.pulse, p.frame) !== 0) {
    p.frame--;
    p.flags10 |= F10.GONE;
    return;
  }
  if (p.frame !== 0) {
    p.frame++;
    updateGeometry(world, p);
    return;
  }
  if (p.vx === 0x3000) p.flags10 &= ~0x10;
  else if (p.vx === -0x3000) p.flags10 |= 0x10;
  else {
    p.vertexCount = 0;
    p.vx = p.vy = 0;
    p.frame = 1;
    updateGeometry(world, p);
  }
  wakeInBeam(world, p, 0, 0x18, 0, 0xc);
}

// --- lampe torche (25) -------------------------------------------------------------------------------------------

/** 441138 : slot 0 : touchée par la face voulue (indice de côté 0, compté depuis l'autre bout si la lampe est retournée), elle s'allume. */
function flashlightTouched(world: World, lamp: Part, toucher: Part): number {
  let idx = toucher.contactIndex;
  if (lamp.flags10 & 0x10) {
    const n = world.types.get(T.flashlight).vertexCount;
    idx = (n - idx - 2) | 0;
    if (idx < 0) idx = (idx + n) | 0;
  }
  if (idx === 0) lamp.f24 = 1;
  return 1;
}

/** 4411ac : slot 1 : allumée, l'image avance jusqu'à 2. */
function flashlightRun(world: World, p: Part): void {
  if (p.f24 !== 0 && p.frame !== 2) {
    p.frame++;
    updateGeometry(world, p);
  }
}

// --- Super Phazer (27) -------------------------------------------------------------------------------------------

/** 0x477fb8 / 0x477fbc : point d'attache de la corde {x, y} (image 1 ou autre ; droit ou retourné). */
const PHAZER_ANCHOR = [
  [27, 32, 24, 32],
  [40, 32, 43, 32],
] as const;

/** 4413b0 : point d'attache de la corde (+0xB0) selon l'image et le retournement. */
function superPhazerAnchor(p: Part): void {
  const t = PHAZER_ANCHOR[p.flags10 & 0x10 ? 1 : 0]!;
  const i = p.frame === 1 ? 2 : 0;
  p.ropeAnchor[0] = t[i]!;
  p.ropeAnchor[1] = t[i + 1]!;
}

/** 44153a : slot 2 : charges (+0x104 = +0xFC), point d'attache, polygone selon le sens. */
function superPhazerReset(world: World, p: Part): void {
  p.f104 = p.fFC;
  superPhazerAnchor(p);
  setPolygon(world, p, T.superPhazer, flipIndex(p));
}

/** 4413e4 : slot 1 : déclenché et chargé, il avance son animation et tire une pulsation à l'image de départ du tir. */
function superPhazerRun(world: World, p: Part): void {
  if (p.f24 === 0 || p.f104 === 0) return;
  const fire = stateFirst(world, T.superPhazer, 5);
  const end = stateFirst(world, T.superPhazer, 4);
  if (p.frame === end) {
    p.f104 = (p.f104 - 1) | 0;
    p.frame = 0;
    p.f24 = 0;
    return;
  }
  p.frame++;
  updateGeometry(world, p);
  superPhazerAnchor(p);
  if (p.frame !== fire) return;
  const b = createPart(world, T.pulse);
  if (!b) return;
  addMobile(world, b);
  if (p.flags10 & 0x10) {
    b.flags10 |= 0x10;
    pulseReset(world, b);
    b.px = (p.px - 0x1a) | 0;
    b.prevPx = (b.px + 0x18) | 0;
    b.vx = -0x3000;
  } else {
    b.px = (p.px + 0x42) | 0;
    b.prevPx = (b.px - 0x18) | 0;
    b.vx = 0x3000;
  }
  b.py = b.prevPy = (p.py + 0xd) | 0;
  clampVelocity(b, world.types);
  b.fx = b.px << 9;
  b.fy = b.py << 9;
  updateGeometry(world, b);
}

/** 4415bf : slot 5 (bout de corde) : voir `ropeReaction`. Super Phazer : le tir part du côté ouvert (sens selon le retournement). */
function superPhazerRopeReaction(_w: World, p: Part, flags: number): number {
  const rope = p.ropes[0];
  if (flags === 1) {
    if (rope) rope.n18 = (rope.n18 + 1) | 0;
    return 0;
  }
  const f = flags & 0x8018;
  const m = f & ~0x8000;
  const flip = (p.flags10 & 0x10) !== 0;
  const [open, shut] = flip ? [0x8, 0x10] : [0x10, 0x8];
  if (m === open) return 1;
  if (m === shut && p.f24 !== 0) return 1;
  if (f === shut && p.f24 === 0) p.f24 = 1;
  return 0;
}

// --- lampe à lave (29) -------------------------------------------------------------------------------------------

/** 0x477fc0 / 0x477fc2 : point d'attache de la corde {x, y} (lampe éteinte ou allumée ; en marche : images 1 … état 3). */
const LAVA_ANCHOR = [
  [21, 63],
  [20, 77],
] as const;

/** 441654 : slot 2 : point d'attache selon l'image (0x477fc2 entre 1 et le début de l'état 3, sinon 0x477fc0), polygone. */
function lavaReset(world: World, p: Part): void {
  const a = LAVA_ANCHOR[p.frame > 0 && p.frame < stateFirst(world, T.lavaLamp, 3) ? 1 : 0]!;
  p.ropeAnchor[0] = a[0];
  p.ropeAnchor[1] = a[1];
  setPolygon(world, p, T.lavaLamp, 0);
}

/** 4416c0 : slot 1 : allumée, l'animation tourne en boucle (retour à la première image de l'état 3). */
function lavaRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.frame++;
  if (stateAt(world, T.lavaLamp, p.frame) === -1) p.frame = stateFirst(world, T.lavaLamp, 3);
  lavaReset(world, p);
  updateGeometry(world, p);
}

/** 4416ff : slot 5 (bout de corde). */
function lavaRopeReaction(_w: World, p: Part, flags: number): number {
  const rope = p.ropes[0];
  if (flags === 1) {
    if (rope) rope.n18 = (rope.n18 + 1) | 0;
    return 0;
  }
  const f = flags & 0x8006;
  const m = f & ~0x8000;
  if (m === 2) return 1;
  if (m === 4 && p.f24 !== 0) return 1;
  if (f === 4 && p.f24 === 0) p.f24 = 1;
  return 0;
}

// --- loupe (30) --------------------------------------------------------------------------------------------------

/** Types de sources de lumière que la loupe concentre (25, 29, 34, 45, 75, 78, 79, 138). */
const LIGHTS = new Set([0x19, 0x1d, 0x22, 0x2d, 0x4b, 0x4e, 0x4f, 0x8a]);

/** 4419af : décalage (dx, dy) entre le foyer de la loupe et le point d'accroche de `target`. */
function focusOffset(loupe: Part, target: Part): [number, number] {
  const e = extra(target);
  const lx = loupe.px;
  const ly = (loupe.py + 0xb) | 0;
  const tx = (e.anchorX + target.px) | 0;
  const ty = (e.anchorY + target.py) | 0;
  const dx = loupe.flags10 & 0x10 ? (lx - tx) | 0 : (tx - (lx + loupe.boxW)) | 0;
  return [dx, Math.abs((ly - ty) | 0)];
}

/**
 * 44175c : slot 1 : cherche, dans 0x20 pixels de chaque côté, une source de lumière allumée du bon côté ; si elle existe, la
 * loupe vise le point d'accroche le plus proche (+0xA0) et y chauffe (+0x104 + 1).
 */
function magnifierRun(world: World, p: Part): void {
  imageScan(world, p, 0x3000, -0x20, 0x20, 0, 0);
  const limit75 = stateFirst(world, 75, 2);
  const limit78 = stateFirst(world, 78, 7);
  let best: Part | null = null;
  let lit = false;
  let linked = false;
  let bestRel = 0x190;
  const flipped = (p.flags10 & 0x10) !== 0;
  for (const b of chain(p)) {
    const e = extra(b);
    if (LIGHTS.has(b.type) && b.frame !== 0) {
      if (!lit) {
        if (flipped ? e.relX > 0 : e.relX < 0) lit = true;
        if (b.type === 0x19) {
          if (!((b.flags10 ^ p.flags10) & 0x10)) {
            /* même sens : on garde */
          } else lit = false;
        } else if (b.type === 0x4b) {
          if (b.frame < limit75) lit = false;
        } else if (b.type === 0x4e) {
          if (b.frame < limit78) lit = false;
        } else if (b.type === 0x4f) {
          if (b.f24 !== 1) lit = false;
        }
      }
    } else if (b.flags14 & 4 && b.f24 === 0 && !linked) {
      let ok = flipped ? e.relX < 0 : e.relX > 0;
      const [dx, dy] = focusOffset(p, b);
      if (dx >= 0x30 || dy > dx) ok = false;
      if (ok) {
        if (b === p.links[4]) {
          best = b;
          linked = true;
        } else if (Math.abs(e.relX) < Math.abs(bestRel)) {
          bestRel = e.relX;
          best = b;
        }
      }
    }
    if (lit && linked) break;
  }
  if (!lit) best = null;
  p.links[4] = best;
  if (best) best.f104 = (best.f104 + 1) | 0;
}

/** 44197e : slot 3 (édition) : retournement. */
function magnifierEdit(world: World, p: Part, action: number): void {
  if (action) p.flags10 ^= 0x10;
  updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  const num = (a: unknown): number => (typeof a === "number" ? a : 0);
  // 20
  r.register(0x440ad4, "pulse.touched", (w, p, a) => pulseTouched(w, p, a as Part));
  r.register(0x440b62, "pulse.run", (w, p) => pulseRun(w, p));
  r.register(0x440b35, "pulse.reset", (w, p) => pulseReset(w, p));
  // 25
  r.register(0x441138, "flashlight.touched", (w, p, a) => flashlightTouched(w, p, a as Part));
  r.register(0x4411ac, "flashlight.run", (w, p) => flashlightRun(w, p));
  r.register(0x44117f, "flashlight.reset", (w, p) => setPolygon(w, p, T.flashlight, flipIndex(p)));
  r.register(0x4411ca, "flashlight.edit", (w, p, a) => {
    if (num(a)) p.flags10 ^= 0x10;
    setPolygon(w, p, T.flashlight, flipIndex(p));
  });
  // 27
  r.register(0x4413e4, "superPhazer.run", (w, p) => superPhazerRun(w, p));
  r.register(0x44153a, "superPhazer.reset", (w, p) => superPhazerReset(w, p));
  r.register(0x44157c, "superPhazer.edit", (w, p, a) => {
    if (num(a)) p.flags10 ^= 0x10;
    superPhazerReset(w, p);
    updateGeometry(w, p);
  });
  r.register(0x4415bf, "superPhazer.ropeReaction", (w, p, _puller, _slot = 0, flags = 0) => superPhazerRopeReaction(w, p, flags));
  r.register(0x4414ea, "superPhazer.links", () => 1);
  // 29
  r.register(0x4416c0, "lavaLamp.run", (w, p) => lavaRun(w, p));
  r.register(0x441654, "lavaLamp.reset", (w, p) => lavaReset(w, p));
  r.register(0x4416ff, "lavaLamp.ropeReaction", (w, p, _puller, _slot = 0, flags = 0) => lavaRopeReaction(w, p, flags));
  // 30
  r.register(0x44175c, "magnifier.run", (w, p) => magnifierRun(w, p));
  r.register(0x44197e, "magnifier.edit", (w, p, a) => magnifierEdit(w, p, num(a)));
  r.register(0x441a0a, "magnifier.draw", () => undefined);
}
