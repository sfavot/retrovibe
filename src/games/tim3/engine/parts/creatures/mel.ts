/**
 * Mel Schlemming (54) et sa maison (58), TIMWIN.EXE 444489 … 444f01. Mel marche, tombe, s'écrase, et disparaît quand il
 * entre dans la maison (il quitte alors la partie : +0x10 |= 0x2000). Pas d'équivalent dans OpenTIM (TEMIM n'a que la
 * souris de Mel, type 42 : `src/parts/mod.rs`, hors périmètre) : traduction directe de l'exe.
 *
 * Les globales d'états d'animation (0x481664, 0x481ed0 … 0x481ef0 pour Mel ; 0x481ef4 … 0x481f10 pour la maison) sont
 * calculées par 44b2c0 au premier slot 2 / slot 7 du type : ce sont des fonctions pures de l'ANM, mémorisées par
 * `cached`. NB : 0x481664 (premier état 8 de Mel) est lu par d'autres types (marteau, 44224f …) ; `melStates` l'exporte.
 */
import { ignoresCollision } from "../../collide";
import { abs32, s16 } from "../../fixed";
import { computeEdgeAngles, updateGeometry } from "../../move";
import type { Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { cached, collectInRect, frameCount, overlapsAnother, stateFrame } from "./kernel";

const MEL = 54;
const HOUSE = 58;

/** Premières images des états de l'ANM de Mel (type 54) : globales 0x481664, 0x481ed0 … 0x481ef0. */
export interface MelStates {
  /** 0x481ed8 : état 3 (marche). */
  s3: number;
  /** 0x481664 : état 8 (chute). */
  s8: number;
  /** 0x481ee4 : état 9. */
  s9: number;
  /** 0x481ee8 : état 0xb. */
  sB: number;
  /** 0x481edc : état 0xf. */
  sF: number;
  /** 0x481ee0 : état 0x10. */
  s10: number;
  /** 0x481ed0 : état 0x14. */
  s14: number;
  /** 0x481ed4 : état 0x19. */
  s19: number;
  /** 0x481eec : état 0x33. */
  s33: number;
  /** 0x481ef0 : nombre d'images (44b2c0(anim, −1)). */
  count: number;
}

export function melStates(world: World): MelStates {
  return cached(world.types, "mel.states", () => {
    const t = world.types;
    return {
      s14: stateFrame(t, MEL, 0x14),
      s19: stateFrame(t, MEL, 0x19),
      s3: stateFrame(t, MEL, 3),
      sF: stateFrame(t, MEL, 0xf),
      s10: stateFrame(t, MEL, 0x10),
      s8: stateFrame(t, MEL, 8),
      s9: stateFrame(t, MEL, 9),
      sB: stateFrame(t, MEL, 0xb),
      s33: stateFrame(t, MEL, 0x33),
      count: frameCount(t, MEL),
    };
  });
}

/** Globales 0x481ef4 … 0x481f10 de la maison (ANM du type 58). */
interface HouseStates {
  /** 0x481ef8 (= 0x481f04) : état 4. */
  s4: number;
  /** 0x481efc : état 8 ; 0x481f00 : état 0xd. */
  s8: number;
  sD: number;
  /** 0x481f0c (= 0x481f08) : état 0xe. */
  sE: number;
  /** 0x481f10 : nombre d'images. */
  count: number;
}

function houseStates(world: World): HouseStates {
  return cached(world.types, "mel.house.states", () => {
    const t = world.types;
    return { s4: stateFrame(t, HOUSE, 4), s8: stateFrame(t, HOUSE, 8), sD: stateFrame(t, HOUSE, 0xd), sE: stateFrame(t, HOUSE, 0xe), count: frameCount(t, HOUSE) };
  });
}

/**
 * Tables de pas de 0x4780c8 … 0x4781c4 (relevées dans l'exe) : décalages en pixels de la marche de Mel, indexés par
 * « image − début d'un état ». 0x4780c8 : 17 fois 2 ; 0x47810c : pas de l'état 0x10 (et monté de l'état 3).
 */
const DATA_BASE = 0x4780c8;
// prettier-ignore
const DATA = [
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 2, 11, 5, 4, 4, 8, 10, 3, -20, 10, 0, 3, 2, 1, 3, 1, 0, 2, 5, 4, 8, 13, 4, 14, 1, 6, 8, 10, 4,
  11, 12, 13, 5, -1, 2, 13, 18, 4, 15, 20, 3, 16, 21, 12, 17, 22,
];
/** Mot de la table à l'adresse `base + 4 × index` (hors de la zone relevée : 0, voir la note de fidélité). */
function data(base: number, index: number): number {
  return DATA[(base + 4 * index - DATA_BASE) >> 2] ?? 0;
}

function isPart(a: unknown): a is Part {
  return typeof a === "object" && a !== null;
}

/**
 * 4444cc : slot 0, contact avec Mel. `toucher` (le paramètre de l'exe) est la pièce qui touche Mel, ou Mel lui-même
 * quand le pas l'appelle sur ses propres contacts (43373c). Rend 1 : le contact est accepté.
 */
function melHit(world: World, part: Part, arg: unknown): number {
  const e = isPart(arg) ? arg : part;
  const bx = e.contactAngle & 0xffff;
  let m: Part;
  let other: Part | null;
  if (e.type === MEL) {
    m = e;
    other = e.contact;
  } else {
    m = e.contact ?? part;
    other = e;
    m.fFC = 1;
  }
  const S = melStates(world);
  if (m.frame >= S.s8 && m.frame < S.s9) {
    if (other?.type !== 0x27 && ((s16(bx) - 0x4000) & 0x8000) !== 0) {
      if (m.vy < 0x1000 && abs32(m.vx) < 0xc00) {
        m.frame = m.editFrame;
        if (m.frame !== 0) m.frame++;
      } else {
        m.frame = S.s9;
        m.f104 = m.vy > 0x1c00 ? 1 : 0;
      }
      if (bx === 0) {
        m.vy = 0;
        if (!(other?.type === 5 && other.f24 !== 0)) m.vx = 0;
      }
    }
    updateGeometry(world, m);
  } else if (m.frame !== S.count) {
    // Hors de la chute : Mel fait demi-tour s'il est heurté de face.
    if (m.flags10 & 0x10) {
      if (s16(bx) < -0x2000) {
        m.flags10 ^= 0x10;
        updateGeometry(world, m);
      }
    } else if (s16(bx) > 0x2000) {
      m.flags10 ^= 0x10;
      updateGeometry(world, m);
    }
  }
  return 1;
}

/** 4445e5 : slot 2, polygone selon l'image (le second est celui de la dernière image), compteurs à zéro. */
function melReset(world: World, m: Part): void {
  const S = melStates(world);
  m.fFC = m.frame;
  m.f24 = 0;
  m.poly = world.types.get(m.type).polygons![m.frame === S.count ? 1 : 0]!;
  computeEdgeAngles(m.poly, m.vertexCount);
}

/** 444708 : slot 1 : marche, chute et écrasement de Mel. */
function melRun(world: World, m: Part): void {
  const S = melStates(world);
  if (m.frame < S.s8) {
    const reversed = (m.flags14 & 0x800) !== 0;
    if (reversed) {
      if (m.f24 !== 0) {
        m.frame = S.s8;
        m.vx >>= 2;
        m.f24 = 0;
      } else m.f24 = 1;
    } else if (abs32(m.vy) > 0x600 && m.contact === null) {
      // Tombe depuis plus de trois pas : état de chute.
      if (m.f24 > 2) {
        m.frame = S.s8;
        m.f24 = 0;
      } else m.f24 = (m.f24 + 1) | 0;
    } else m.f24 = 0;
    if (m.frame === S.sF || m.frame === S.s19) {
      // Teste quatre pixels plus bas : plus rien dessous, il tombe.
      m.py = (m.py + 4) | 0;
      if (!overlapsAnother(world, m, ignoresCollision)) {
        m.frame = S.s8;
        m.f24 = 0;
      }
      m.py = (m.py - 4) | 0;
    }
    if (m.frame !== S.s8) {
      if (m.fFC === 0) {
        // À l'arrêt : clignements au hasard (4520a4), seulement si les animations décoratives sont actives.
        if (world.animFlags & 1) {
          m.frame++;
          if (m.frame === S.s14 && world.rng.next() & 1) m.frame = 0;
          if (m.frame === S.s19) m.frame = world.rng.next() & 1 ? S.s14 : 0;
        }
      } else melWalk(m, S);
    }
    updateGeometry(world, m);
  } else if (m.frame < S.s9) {
    m.fFC = 1;
    m.frame++;
    if (m.frame === S.s9) m.frame = (S.s8 + 1) | 0;
    updateGeometry(world, m);
  } else {
    m.frame++;
    if (m.frame === S.sB) {
      if (m.f104 === 0) {
        if (m.frame !== 0) m.frame = (m.editFrame + 1) | 0;
        else m.frame = m.fFC !== 0 ? S.s19 : 0;
      }
    } else if (m.frame === S.count) m.frame = S.s33;
    updateGeometry(world, m);
    if (m.frame === S.count) melReset(world, m);
  }
}

/** 4447cf … 4449f6 : un pas de marche (images ≥ 0xf : table 0x47810c, avant : 0x4780c8), pas sur une pente. */
function melWalk(m: Part, S: MelStates): void {
  const late = m.frame >= S.sF;
  m.frame++;
  if (m.frame <= S.s19) m.frame = (S.s19 + 1) | 0;
  const c = m.contact;
  const blocked = c !== null && c.f24 !== 0 && c.type === 5;
  if (!blocked) {
    const flip = (m.flags10 & 0x10) !== 0;
    const reversed = (m.flags14 & 0x800) !== 0;
    const angle = m.contactAngle & 0xffff;
    const stepX = late ? data(0x47810c, m.frame - S.s10) : data(0x4780c8, m.frame - S.s3);
    // Pas vertical le long de la pente (sens selon l'angle du côté touché, bit 15 : montée à droite).
    const stepY = late ? (flip ? data(0x47810c, m.frame - S.s3) : data(0x4780c8, m.frame - S.s3)) : stepX;
    if (flip) {
      m.px = (m.px - stepX) | 0;
      if (c && angle !== 0 && !(angle & 0x8000) && !reversed) climb(m, stepY);
    } else {
      m.px = (m.px + stepX) | 0;
      if (c && angle & 0x8000 && !reversed) climb(m, stepY);
    }
    m.fx = m.px << 9;
    m.vx = 0;
  }
  if (late) {
    if (m.frame === S.s8) m.frame = S.s10;
  } else if (m.frame === S.sF) m.frame = S.s3;
}

function climb(m: Part, dy: number): void {
  m.py = (m.py + dy) | 0;
  m.fy = m.py << 9;
}

/** 444aab : slot 3, retournement (tout argument non nul) ; pas de mise à jour de la position de dessin. */
function melEdit(world: World, m: Part, action: unknown): void {
  if (typeof action === "number" && action !== 0) m.flags10 ^= 0x10;
  melReset(world, m);
  world.redraw(m, 2); // 43087b : affichage seul ; 439695
}

/**
 * 444adc : après un dépôt de Mel dans l'éditeur (43da1a, `mode` 0/1 : posé sur un support à gauche/à droite, 2/3 :
 * relevé), recale son image. Exposée comme fonction spéciale pour le port de l'éditeur.
 */
export function melDropped(world: World, m: Part, mode: number): void {
  const S = melStates(world);
  if (m.frame === S.s9) m.frame = m.framePrev;
  if (mode >>> 0 < 2) {
    if (m.frame >= S.s19 && m.frame < S.s8) {
      m.frame = m.frame < S.sF ? S.s19 : S.sF;
      if (mode === 0) m.flags10 &= ~0x10;
      else m.flags10 |= 0x10;
    }
  } else if (mode >>> 0 < 4) {
    if (m.frame < S.sB) m.frame = (S.s8 + 1) | 0;
  }
}

/** 444df6 : slot 1 de la maison : engloutit un Mel debout qui entre dans sa zone, puis joue sa fermeture. */
function houseRun(world: World, h: Part): void {
  const H = houseStates(world);
  if (h.frame === h.editFrame || h.editFrame === H.s4) {
    collectInRect(world, h, 0x1000, 0x12, 0x14, 0x28, 0x32);
    const melFall = melStates(world).s8;
    for (let s = h.bucketNext; s; s = s.bucketNext) {
      if (s.type === MEL && s.frame < melFall) {
        h.f24 = 1;
        if (h.frame > H.s4 && h.frame < H.sE) h.frame = H.sE;
        // 43087b : affichage seul.
        s.flags10 |= 0x2000;
      }
    }
  }
  if (h.f24 === 0) return;
  if (h.f24 === 1) {
    h.f24 = 2;
    if (h.frame > H.s4 && h.frame < H.sE) h.frame = H.sE;
    else h.frame++;
  } else {
    h.frame++;
    if (h.frame === H.s4) h.frame = H.s8;
    else if (h.frame === H.sE || h.frame === H.count) h.frame = H.sD;
  }
  updateGeometry(world, h);
}

export function register(r: HandlerRegistry): void {
  r.register(0x4444cc, "mel.hit", (w, p, a) => melHit(w, p, a));
  r.register(0x444708, "mel.run", (w, p) => melRun(w, p));
  r.register(0x4445e5, "mel.reset", (w, p) => melReset(w, p));
  r.register(0x444aab, "mel.edit", (w, p, a) => melEdit(w, p, a));
  r.registerSpecial(0x444adc, "mel.dropped", (w, p, mode) => melDropped(w, p, typeof mode === "number" ? mode : 0));
  r.register(0x444df6, "house.run", (w, p) => houseRun(w, p));
  // 444d50 : initialisation du type (globales d'états, calculées à la demande ici) ; rend 1.
  r.register(0x444d50, "house.typeInit", () => 1);
}
