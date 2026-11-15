/**
 * Chat Curie (type 12) : TIMWIN.EXE 43fa20 (slot 2), 43fb20 (slot 0), 43fb72 (slot 1), 440020 (slot 3), 440058 (boîte de
 * 434ec6). Pas d'équivalent dans OpenTIM (le chat de TEMIM, type 12 aussi, a une autre machine à états : `src/parts/mod.rs`
 * ne sert que de guide pour les noms) ; le binaire de TIM3 fait foi.
 *
 * L'ANM du chat est coupée en deux moitiés (images < 48160c : moitié 0, sinon moitié 1 : le chat qui a mangé) ; chaque
 * état de la moitié 0 a son jumeau de la moitié 1 (états 1 / 9, 8 / 0xb, 7 / 0xc, 6 / 0xd, 5 / 0xa, 4 / 0xe). Les globales
 * 481608 … 481da4 de l'exe sont la première image de ces états, que le premier slot 2 calcule : ici, calculées à la demande.
 */
import { abs32 } from "../../fixed";
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { cached, findNeighbours, frameCount, overlapsAnother, registerBoxHook, relativeOf, stateAt, stateFrame } from "./kernel";

export const CAT = 12;
const MOUSE = 42;

/** 4371af : paires de types qui ne se gênent pas pour 437208 (chat / souris / fromage, souris / fromage, Mel / sa maison). */
export function pairIgnored(a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === 12 && (hi === 42 || hi === 52)) return true;
  if (lo === 42 && (hi === 52 || hi === 42)) return true;
  if (lo === 54 && (hi === 54 || hi === 58)) return true;
  return false;
}

/** Première image de chaque état, moitié 0 / moitié 1 (globales 481608 … 481da8 et 48160c = `half`). */
interface CatFrames {
  /** 48160c : première image de la moitié 1 (état 9). */
  half: number;
  /** 481608 : repos (états 1 / 9). */
  idle: [number, number];
  /** 481d84 : états 8 / 0xb, 481d8c : 7 / 0xc, 481d94 : 6 / 0xd (animations de repos tirées au hasard). */
  a8: [number, number];
  a7: [number, number];
  a6: [number, number];
  /** 481610 : accroupi (4 / 0xe) ; 481d9c : bond et réception (5 / 0xa). */
  crouch: [number, number];
  pounce: [number, number];
  /** 481da4 : fin de la moitié (première image de l'état 9, puis nombre d'images de l'ANM). */
  end: [number, number];
}

function pair(types: World["types"], a: number, b: number): [number, number] {
  const f = (id: number) => (id < 0 ? frameCount(types, CAT) : stateFrame(types, CAT, id));
  return [f(a), f(b)];
}

function frames(world: World): CatFrames {
  return cached(world.types, "cat", () => {
    const t = world.types;
    const idle = pair(t, 1, 9);
    return { half: idle[1], idle, a8: pair(t, 8, 0xb), a7: pair(t, 7, 0xc), a6: pair(t, 6, 0xd), crouch: pair(t, 4, 0xe), pounce: pair(t, 5, 0xa), end: pair(t, 9, -1) };
  });
}

/** 481660 : première image d'un état (après la première) de l'ANM du type 15, 481668 : dernière image de celle du type 67. */
function type15Mark(world: World): number {
  return cached(world.types, "cat.t15", () => {
    let i = 1;
    while (stateAt(world.types, 15, i) === 0) i++;
    return i;
  });
}
function type67Last(world: World): number {
  return cached(world.types, "cat.t67", () => (frameCount(world.types, 67) - 1) | 0);
}

/** Compteurs globaux de l'exe (477eb0 : repos du chat, 4780b8 : repos de la souris), valeurs de départ de l'image de l'exe. */
interface Timers {
  cat: number;
  mouse: number;
}
/** Vue sur `World.catTimer` / `World.newtonMouseTimer`. */
export function timersOf(world: World): Timers {
  return {
    get cat() {
      return world.catTimer;
    },
    set cat(v: number) {
      world.catTimer = v;
    },
    get mouse() {
      return world.newtonMouseTimer;
    },
    set mouse(v: number) {
      world.newtonMouseTimer = v;
    },
  };
}

/** 43fa20 : polygone (original ou retourné d'après +0x10 & 0x10) et angles de ses côtés. */
function catReset(world: World, p: Part): void {
  p.poly = world.types.get(CAT).polygons![p.flags10 & 0x10 ? 1 : 0]!;
  computeEdgeAngles(p.poly, p.vertexCount);
}

/**
 * 43fb20 : slot 0, appelé avec la pièce qui touche le chat (`toucher.contact` est le chat). Hors type 11, un chat qui
 * n'est pas déjà accroupi ou en bond s'accroupit.
 */
function catAccept(world: World, _p: Part, toucher: Part): number {
  const cat = toucher.contact!;
  const c = frames(world);
  const h = cat.frame < c.half ? 0 : 1;
  if (toucher.type !== 0xb && c.crouch[h] > cat.frame) {
    cat.frame = c.crouch[h];
    cat.fFC = 0;
    updateGeometry(world, cat);
  }
  return 1;
}

/** 43fd2b / 43ffaf : saut de 44 pixels dans le sens du chat ; rend vrai si un obstacle l'empêche. */
function stepForward(world: World, p: Part, step: number): boolean {
  p.px = (p.px + step) | 0;
  updateGeometry(world, p);
  return overlapsAnother(world, p, pairIgnored);
}

/** 43fb72 : slot 1, une fois par pas. */
function catRun(world: World, p: Part): void {
  const c = frames(world);
  // esi : 1 si la pièce ne tombe pas (déplacement vertical d'au plus 1 pixel).
  const still = abs32((p.py - p.prevPy) | 0) <= 1;
  let h = p.frame < c.half ? 0 : 1;
  let jumpUp = 0;
  body: {
    if (p.flags10 & 0x20) {
      // Chat en chute (drapeau 0x20 posé par le bond raté) : ne se relève qu'en touchant le sol.
      if (p.flags0C & 2) {
        p.flags10 &= ~0x20;
        p.frame = 0;
      } else if (c.crouch[h] === p.frame) p.frame++;
      break body;
    }
    if (c.idle[h] === p.frame) {
      // Au repos : tire au hasard (4520a4) une animation de repos quand le compteur 477eb0 est écoulé.
      if (world.animFlags & 1) {
        const t = timersOf(world);
        t.cat = (t.cat - 1) | 0;
        if (t.cat <= 0) {
          t.cat = (world.rng.next() % 0x8c) + 0x50;
          const r = world.rng.next() % 3;
          p.frame = r === 0 ? c.a8[h] : r === 1 ? c.a7[h] : c.a6[h];
        }
      }
    } else if (p.frame !== 0) {
      // Avant l'accroupi : l'animation en cours avance jusqu'au début de l'état suivant, puis retour au repos.
      if (c.crouch[h] > p.frame) {
        p.frame++;
        if (stateAt(world.types, CAT, p.frame) !== 0) p.frame = c.idle[h];
      }
    }
    if (!still && c.pounce[h] > p.frame) {
      // En l'air avant le bond : après cinq pas, le chat bascule (0x20) en accroupi.
      if (p.fFC > 4) {
        p.flags10 |= 0x20;
        p.frame = c.crouch[h];
        p.fFC = 0;
      } else p.fFC = (p.fFC + 1) | 0;
      break body;
    }
    if (c.crouch[h] <= p.frame && c.pounce[h] > p.frame) {
      // Accroupi : boucle de l'état 4, puis bond de 44 pixels après 13 pas.
      p.frame++;
      if (c.pounce[h] === p.frame) p.frame = c.crouch[h] + 1;
      p.fFC = (p.fFC + 1) | 0;
      if (p.fFC > 0xc) {
        const step = p.flags10 & 0x10 ? -44 : 44;
        p.fFC = 0;
        if (stepForward(world, p, step)) {
          p.px = (p.px - 2 * step) | 0;
          updateGeometry(world, p);
          if (overlapsAnother(world, p, pairIgnored)) {
            p.px = (p.px + step) | 0;
            updateGeometry(world, p);
            p.frame = 0;
          } else {
            p.frame = c.pounce[h];
            p.flags10 ^= 0x10;
          }
        } else p.frame = c.pounce[h];
        p.fx = p.px << 9;
      }
      break body;
    }
    if (c.pounce[h] <= p.frame) {
      // Réception du bond : fin de l'état 5, retour au repos.
      jumpUp = 1;
      p.frame++;
      if (c.end[h] === p.frame) p.frame = c.idle[h];
    } else jumpUp = 0;
    if (!(p.flags0C & 1)) break body;
    if (c.crouch[h] <= p.frame && c.pounce[h] > p.frame) break body;
    // Cherche devant soi (400 pixels, dans la bande verticale du chat) la proie : balle 15, souris 42, pièce 67.
    if (p.flags10 & 0x10) findNeighbours(world, p, 0x3000, -400, 0, 0, 0);
    else findNeighbours(world, p, 0x3000, 0, 400, 0, 0);
    for (let n = p.bucketNext; n; n = n.bucketNext) {
      let reach = -1;
      if (n.type === 15) reach = n.frame >= type15Mark(world) ? 0x124 : 0x60;
      else if (n.type === MOUSE) {
        const dx = (n.px - p.px + 0x10) | 0;
        const dy = (n.py - p.py) | 0;
        let lo: number;
        let hi: number;
        if (p.flags10 & 0x10) {
          lo = c.end[h] - 1 > p.frame ? -4 : -30;
          hi = 0x36;
        } else {
          lo = 0x22;
          hi = c.end[h] - 1 > p.frame ? 0x36 : 0x56;
        }
        if (lo < dx && dx < hi && dy > 10 && dy < 0x28) {
          // 43087b : redessin ignoré. La souris est mangée ; le chat passe à la moitié « repu » de l'ANM.
          n.flags10 |= 0x2000;
          if (h === 0) {
            h = 1;
            p.frame = (c.half + p.frame - c.idle[0]) | 0;
            if (p.frame >= c.end[1]) p.frame = c.half;
          }
        } else if (dy > 10) reach = jumpUp ? 0x190 : 0x154;
      } else if (n.type === 67) reach = n.frame === type67Last(world) ? 0xe0 : -1;
      if (abs32(relativeOf(n).dx) < reach && c.crouch[h] > p.frame) {
        const step = p.flags10 & 0x10 ? -44 : 44;
        p.fFC = 0;
        if (stepForward(world, p, step)) {
          p.px = (p.px - step) | 0;
          updateGeometry(world, p);
          p.frame = 0;
        } else p.frame = c.pounce[h];
        p.fx = p.px << 9;
        break;
      }
    }
  }
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

/** 440020 : slot 3, édition : tout argument non nul retourne le chat en X. 43087b, 439695 : redessin ignoré. */
function catEdit(world: World, p: Part, action: number): void {
  if (action !== 0) p.flags10 ^= 0x10;
  catReset(world, p);
  updateGeometry(world, p);
}

/** 440058 : la boîte de collision (et non le rectangle de dessin) sert aux recherches de voisins du chat pendant les états 8 … 5. */
export function catUsesBox(world: World, p: Part): boolean {
  const c = frames(world);
  const h = p.frame < c.half ? 0 : 1;
  return c.a8[h] <= p.frame && c.pounce[h] > p.frame;
}
registerBoxHook(CAT, catUsesBox);

export function registerCat(r: HandlerRegistry): void {
  r.register(0x43fb20, "cat.accept", (w, p, a) => catAccept(w, p, a as Part));
  r.register(0x43fb72, "cat.run", (w, p) => catRun(w, p));
  r.register(0x43fa20, "cat.reset", (w, p) => catReset(w, p));
  r.register(0x440020, "cat.edit", (w, p, a) => catEdit(w, p, typeof a === "number" ? a : 0));
}
