/**
 * Slots propres des lasers (91, 92, 93) et du mélangeur de faisceaux (95), et panneau solaire (38), traduits de TIMWIN.EXE.
 * Le tracé du faisceau (43ce78), le slot 2 des lasers (43c88a) et la passe 43d013 sont dans `parts/mechanics/laser.ts`.
 */
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import { traceBeam } from "../mechanics/laser";
import type { HandlerRegistry } from "../registry";
import { chain, imageScan } from "./zone";
import { feedLinks, linkBits, stateAt, stateFirst, T } from "./support";

// --- lasers (91, 92, 93) -----------------------------------------------------------------------------------------

/**
 * 43c6de : slot 1 : un laser allumé (+0x24 posé par la passe lasers) anime son image (la direction est dans +0xF0) ; éteint, il revient à la
 * direction de départ. Images repères : premières images des états 9, 4, 3, 2 et nombre d'images (0x481c94 … 0x481ca4).
 */
function laserRun(world: World, p: Part): void {
  const a = stateFirst(world, T.laserRed, 9);
  const b = stateFirst(world, T.laserRed, 4);
  const c = stateFirst(world, T.laserRed, 3);
  const d = stateFirst(world, T.laserRed, 2);
  const e = stateFirst(world, T.laserRed, -1);
  if (p.f24 !== 0) {
    if (!(world.animFlags & 1)) {
      const end = [b, c, d, e][p.editFrame] ?? e;
      p.frame = end - 1 === p.frame ? end - 6 : end - 1;
    } else if (p.frame === 0) p.frame = a;
    else if (p.frame === 1) p.frame = b;
    else if (p.frame === 2) p.frame = c;
    else if (p.frame === 3) p.frame = d;
    else {
      p.frame++;
      if (p.frame === b) p.frame = a;
      else if (p.frame === c) p.frame = b;
      else if (p.frame === d) p.frame = c;
      else if (p.frame === e) p.frame = d;
    }
    updateGeometry(world, p);
  } else if (p.framePrev !== p.framePrev2) {
    p.frame = p.editFrame;
    updateGeometry(world, p);
  }
}

/** 43c93b : slot 3 (édition) : l'action 15 tourne le laser (image 0 … 3 = direction) ; la direction est gardée dans +0xF0. */
function laserEdit(world: World, p: Part, action: number): void {
  if (action === 0xf) {
    p.frame++;
    if (p.frame > 3) p.frame = 0;
  }
  p.editFrame = p.frame;
  world.callType(2, p.type, p);
  updateGeometry(world, p);
}

// --- mélangeur (95) ----------------------------------------------------------------------------------------------

/**
 * 43cb08 (initialisation) : bornes des segments d'animation du mélangeur : pour chacune des 4 orientations, 8 images
 * successives où commence un nouvel état (0x481ca8 … 0x481d28). `t[k][g]` = k-ième borne de l'orientation g ; `end` : dernière.
 */
function mixerBounds(world: World): { t: number[][]; end: number } {
  const t: number[][] = Array.from({ length: 8 }, () => []);
  let b = 0;
  for (let g = 0; g < 4; g++) {
    t[0]![g] = b;
    for (let k = 1; k < 8; k++) {
      do b++;
      while (b !== 0 && stateAt(world, T.mixer, b) === 0);
      t[k]![g] = b;
    }
    // 43cbf6 : un huitième début d'état sépare deux orientations (l'orientation suivante commence après lui).
    do b++;
    while (b !== 0 && stateAt(world, T.mixer, b) === 0);
  }
  return { t, end: b };
}

/** Orientation du mélangeur d'après l'image de départ (0 … 3). */
function mixerOrientation(t0: number[], frame: number): number {
  return frame === t0[0] ? 0 : frame === t0[1] ? 1 : frame === t0[2] ? 2 : 3;
}

/** 43cb08 : slot 2 : repos, polygone de l'orientation, tracé du faisceau. */
function mixerReset(world: World, p: Part): void {
  const { t } = mixerBounds(world);
  p.f24 = 0;
  p.f8C = 0;
  const g = mixerOrientation(t[0]!, p.frame);
  p.poly = world.types.get(T.mixer).polygons![g]!;
  computeEdgeAngles(p.poly, p.vertexCount);
  traceBeam(world, p, g);
}

/**
 * 43c986 : slot 1 : +0x24 reçoit les faisceaux reçus au pas précédent (+0x8C, bits 4 / 2 / 1 des lasers rouge, vert, bleu), puis
 * l'image suit l'animation du mélange (états 1 … 7 selon la combinaison).
 */
function mixerRun(world: World, p: Part): void {
  p.f24 = p.f8C;
  p.f8C = 0;
  if (p.f24 !== 0) {
    const { t, end } = mixerBounds(world);
    const g = mixerOrientation(t[0]!, p.editFrame);
    const pair: [number, number] = (
      {
        1: [t[4]![g]!, t[5]![g]!],
        2: [t[3]![g]!, t[4]![g]!],
        3: [t[7]![g]!, g === 3 ? end : t[0]![g + 1]!],
        4: [t[2]![g]!, t[3]![g]!],
        5: [t[5]![g]!, t[6]![g]!],
        6: [t[6]![g]!, t[7]![g]!],
        7: [t[1]![g]!, t[2]![g]!],
      } as Record<number, [number, number]>
    )[p.f24] ?? [0, 0];
    const [from, to] = pair;
    if (!(world.animFlags & 1)) p.frame = to - 1 === p.frame ? to - 4 : to - 1;
    else if (from > p.frame || to <= p.frame) p.frame = from;
    else {
      p.frame++;
      if (to === p.frame) p.frame = from;
    }
    updateGeometry(world, p);
  } else if (p.framePrev !== p.framePrev2) {
    p.frame = p.editFrame;
    updateGeometry(world, p);
  }
}

/** 43cc9e : slot 3 (édition) : l'action 15 passe à l'orientation suivante. */
function mixerEdit(world: World, p: Part, action: number): void {
  if (action === 0xf) {
    const { t } = mixerBounds(world);
    const t0 = t[0]!;
    p.frame = p.frame === t0[0] ? t0[1]! : p.frame === t0[1] ? t0[2]! : p.frame === t0[2] ? t0[3]! : t0[0]!;
  }
  p.editFrame = p.frame;
  mixerReset(world, p);
  updateGeometry(world, p);
}

// --- panneau solaire (38) ----------------------------------------------------------------------------------------

/** Premières images des états `states` de l'animation de `type` (tables 0x477fe8 … 0x4782b4 lues par 4425e4, 445a89, 44676c). */
const first = (world: World, type: number, states: number[]): number[] => states.map((s) => stateFirst(world, type, s));

/** 442ec0 : slot 2 : l'image dit quelles prises sont liées. */
function solarReset(_w: World, p: Part): void {
  p.frame = linkBits(p);
}

/**
 * 442ee7 : slot 1 : tous les 8 pas, il cherche à ±0x1a pixels une source de lumière allumée (+0x24 ≠ 0) ; selon le type (25, 29, 34, 36,
 * 41, 45, 70, 75, 78, 79, 80, 109, 138) et son image (comparée à des repères d'animation), le panneau s'allume (+0x24 = 1, bit 4 de l'image).
 * Recopie son état dans les pièces liées à chaque pas.
 */
function solarRun(world: World, p: Part): void {
  p.flags10 |= 0x40;
  if ((world.frameCounter & 7) === 4) {
    p.f24 = 0;
    imageScan(world, p, 0x3000, -0x1a, 0x1a, -0x1a, 0x1a);
    for (const b of chain(p)) {
      if (b.f24 === 0) continue;
      switch (b.type) {
        case 0x19:
          if (b.fC8 < 0 ? !(b.flags10 & 0x10) : (b.flags10 & 0x10) !== 0) p.f24 = 1;
          break;
        case 0x1d:
        case 0x22:
        case 0x29:
        case 0x2d:
        case 0x8a:
          p.f24 = 1;
          break;
        case 0x24: {
          const t = first(world, 36, [2, 12, 25]);
          const g = (b.editFrame >= t[1]! ? 1 : 0) + (b.editFrame >= t[2]! ? 1 : 0);
          if (first(world, 36, [9, 14, 23])[g]! <= b.frame) p.f24 = 1;
          break;
        }
        case 0x46: {
          const t = first(world, 70, [2, 13, 18]);
          const g = (b.editFrame >= t[1]! ? 1 : 0) + (b.editFrame >= t[2]! ? 1 : 0);
          if (first(world, 70, [4, 15, 20])[g]! <= b.frame) p.f24 = 1;
          break;
        }
        case 0x4b:
          if (b.frame >= stateFirst(world, 75, 2)) p.f24 = 1;
          break;
        case 0x4e:
          if (b.frame >= stateFirst(world, 78, 7)) p.f24 = 1;
          break;
        case 0x4f:
          if (b.f24 === 1) p.f24 = 1;
          break;
        case 0x50: {
          const t = first(world, 80, [12, 16]);
          const g = b.frame < t[0]! ? 0 : b.frame < t[1]! ? 1 : 2;
          if (first(world, 80, [10, 14, 17])[g]! <= b.frame) p.f24 = 1;
          break;
        }
        case 0x6d:
          if (b.frame > stateFirst(world, 109, 5)) p.f24 = 1;
          break;
      }
    }
    if (p.f24) p.frame |= 4;
    else p.frame &= ~4;
  }
  feedLinks(p, p.f24);
}

export function register(r: HandlerRegistry): void {
  const num = (a: unknown): number => (typeof a === "number" ? a : 0);
  r.register(0x43c6de, "laser.run", (w, p) => laserRun(w, p));
  r.register(0x43c93b, "laser.edit", (w, p, a) => laserEdit(w, p, num(a)));
  r.register(0x43c986, "mixer.run", (w, p) => mixerRun(w, p));
  r.register(0x43cb08, "mixer.reset", (w, p) => mixerReset(w, p));
  r.register(0x43cc9e, "mixer.edit", (w, p, a) => mixerEdit(w, p, num(a)));
  r.register(0x442ee7, "solar.run", (w, p) => solarRun(w, p));
  r.register(0x442ec0, "solar.reset", (w, p) => solarReset(w, p));
}
