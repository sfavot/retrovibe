/**
 * Interrupteur (21), télécommande (22), prise électrique (120), prise activée par laser (96), miroir (94), détecteur laser
 * (148), ordinateur à message (136) et minuteur (137, hors slot 1) : traduits de TIMWIN.EXE.
 * Correspondance OpenTIM : TEMIM n'a que l'interrupteur et la prise (`src/parts/mod.rs`, `electric_outlet`, `switch`) ; ces
 * handlers-ci viennent du désassemblage.
 *
 * Le courant : une pièce « source » (interrupteur, télécommande, minuteur, ordinateur, détecteur…) pose son état dans
 * +0x24 ; son slot 1 le recopie dans les pièces liées en +0xA0 / +0xA4 (prises 120 / 96), dont le slot 1 le propage à son
 * tour, et dont le slot 2 en déduit l'image.
 */
import { computeEdgeAngles, updateGeometry } from "../../move";
import { F0C, type Part } from "../../part";
import type { World } from "../../world";
import type { HandlerRegistry } from "../registry";
import { feedLinks, linkBits, setPolygon, stateAt, stateFirst, T } from "./support";
import { boxScan, chain } from "./zone";

// --- interrupteur (21) -----------------------------------------------------------------------------------------

/** 440c8b interrupteur, slot 2 : polygone selon la position (image ≥ 4 = basculé), bits d'image des liens. */
function switchReset(world: World, p: Part): void {
  p.poly = world.types.get(T.switch).polygons![p.frame >= 4 ? 1 : 0]!;
  p.vertexCount = 4;
  computeEdgeAngles(p.poly, p.vertexCount);
  p.vertexCount = 1;
  p.frame &= 4;
  p.frame |= linkBits(p);
}

/** 440c00 interrupteur, slot 0 : touché par `toucher`, bascule selon le côté touché (angle du côté + 0x4000, bit 15). */
function switchTouched(world: World, sw: Part, toucher: Part): number {
  const ax = (toucher.contactAngle + 0x4000) & 0xffff;
  if (sw.frame < 4) {
    if (!(ax & 0x8000)) {
      sw.frame += 4;
      switchReset(world, sw);
      world.sound(0xbcd, sw);
    }
  } else if (ax & 0x8000) {
    sw.frame -= 4;
    switchReset(world, sw);
    world.sound(0xbcd, sw);
  }
  sw.f24 = sw.frame !== sw.editFrame ? 1 : 0;
  if (toucher.type === T.pulse) toucher.vx = (toucher.vx - 1) | 0;
  return 0;
}

/** 440cee : slot 1 des sources : drapeau « traitée », état recopié dans les pièces liées. */
function sourceRun(_w: World, p: Part): void {
  p.flags10 |= 0x40;
  feedLinks(p, p.f24);
}

/** 440d18 interrupteur, slot 3 (édition) : bascule la position de départ. */
function switchEdit(world: World, p: Part): void {
  p.frame = p.frame < 4 ? 4 : 0;
  p.editFrame = p.frame;
  switchReset(world, p);
}

// --- télécommande (22) -----------------------------------------------------------------------------------------

/** 440d68 : touchée par le dessus (angle du côté nul) quand elle est au repos, elle part. */
function remoteTouched(_w: World, remote: Part, toucher: Part): number {
  if (remote.f24 === 0 && toucher.contactAngle === 0) remote.f24 = 1;
  return 1;
}

/** 0x477fac : y du point d'attache de la corde selon l'image (0 … 4, bornée à 4). */
const REMOTE_ROPE_Y = [5, 5, 7, 10, 14] as const;

/** 440d92 : polygone selon l'image (0 : repos), point d'attache de la corde (0x12, y selon l'image). */
function remoteReset(world: World, p: Part): void {
  setPolygon(world, p, T.remote, p.frame === 0 ? 0 : 1);
  p.ropeAnchor[0] = 0x12;
  p.ropeAnchor[1] = REMOTE_ROPE_Y[p.frame > 4 ? 4 : p.frame]!;
}

/** 440ddf : animation du bouton ; à la fin de l'animation, le signal part dans le lien +0x94. */
function remoteRun(world: World, p: Part): void {
  if (p.f24 === 0) return;
  p.frame++;
  if (stateAt(world, T.remote, p.frame) === -1) {
    p.frame--;
    if (p.f24 === 2) return;
    p.f24 = 2;
    p.links[1]!.f24 = 1;
    return;
  }
  remoteReset(world, p);
  updateGeometry(world, p);
}

/** 440e36 : la télécommande est le bout d'une corde (+0xA8) ; `flags` : drapeaux de la réaction (43a31d). Rend 1 : la corde cède. */
function remoteRopeReaction(_w: World, p: Part, flags: number): number {
  const rope = p.ropes[0];
  if (flags === 1) {
    if (rope) rope.n18 = (rope.n18 + 1) | 0;
    return 0;
  }
  const f = flags & 0x8006;
  const m = f & ~0x8000;
  if (m === 2) return 1;
  if (m === 4 && p.frame !== 0) return 1;
  if (f === 4 && p.f24 === 0) p.f24 = 1;
  return 0;
}

// --- prises (120, 96) et miroir (94) ---------------------------------------------------------------------------

/** 44823e : prise électrique, slot 1 : alimente ses deux prises liées (état forcé à 1, comme l'exe). */
function outletRun(_w: World, p: Part): void {
  p.flags10 |= 0x40;
  feedLinks(p, 1);
}

/** 448218 : prise électrique, slot 2 (et panneau solaire, 442ec0) : l'image dit quelles prises sont liées. */
function outletReset(_w: World, p: Part): void {
  p.frame &= 4;
  p.frame |= linkBits(p);
}

/** 4473a1 : prise activée par laser, slot 1 : transmet son état puis le remet à zéro (le laser le repose à chaque pas). */
function laserOutletRun(_w: World, p: Part): void {
  p.flags10 |= 0x40;
  feedLinks(p, p.f24);
  p.f24 = 0;
}

/** 447358 : prise activée par laser, slot 2. */
function laserOutletReset(world: World, p: Part): void {
  setPolygon(world, p, T.laserOutlet, 0);
  p.frame = p.frame % 7;
  if (p.links[4]) p.frame += 7;
  if (p.links[5]) p.frame += 14;
}

/** 4472f0 : miroir, slot 2 : un polygone par orientation (image 0 … 3). */
function mirrorReset(world: World, p: Part): void {
  setPolygon(world, p, T.mirror, p.frame);
}

/** 447314 : miroir, slot 3 : l'action 15 (tourner) passe à l'orientation suivante. */
function mirrorEdit(world: World, p: Part, action: number): void {
  if (action === 0xf) {
    p.frame++;
    if (p.frame === 4) p.frame = 0;
  }
  p.editFrame = p.frame;
  mirrorReset(world, p);
}

// --- détecteur laser (148) -------------------------------------------------------------------------------------

/** 44891d : détecteur, slot 2 : repos, polygone. */
function detectorReset(world: World, p: Part): void {
  p.f24 = 0;
  setPolygon(world, p, T.detector, 0);
}

/**
 * 44887c : détecteur, slot 1 : l'animation avance tant que le laser le touche (+0x24 posé par 43d013), et revient en arrière
 * sinon. Images repères : premières images des états 3, 4, 5 et nombre d'images (0x482014 … 0x482020).
 */
function detectorRun(world: World, p: Part): void {
  const s3 = stateFirst(world, T.detector, 3);
  const s4 = stateFirst(world, T.detector, 4);
  const s5 = stateFirst(world, T.detector, 5);
  const count = stateFirst(world, T.detector, -1);
  if (p.f24 !== 0) {
    if (p.frame >= s4 && p.frame < s5) p.frame = s5;
    else p.frame++;
    if (p.frame === s4) p.frame = s3;
    else if (p.frame === count) p.frame = s5;
  } else if (p.frame !== 0) {
    if (p.frame < s4) p.frame = s4;
    else if (p.frame < s5) p.frame++;
    else p.frame = s4;
    if (p.frame === s5) p.frame = s4;
  }
  p.f24 = 0;
}

// --- ordinateur à message (136) et minuteur (137) -------------------------------------------------------------

/** 4483b6 : l'ordinateur, touché par le dessus de sa première arête, se met en marche (message). Rend 1 : le contact compte. */
function computerTouched(world: World, c: Part, toucher: Part): number {
  if (toucher.contactIndex === 0 && c.f24 === 0) {
    world.sound(0xc40, c);
    c.f24 = 1;
    c.redraw = 2;
    c.frame = 1;
  }
  return 1;
}

/** 448404 : polygone unique. */
function polygonZero(type: number) {
  return (world: World, p: Part): void => setPolygon(world, p, type, 0);
}

/** 448380 : slot 7 : avec une pièce, la lettre du message (+0xFC) est « A » (0x41) ; sans pièce, la police est chargée (affichage). */
function computerLinks(_w: World, p: Part | null | undefined): number {
  if (p) p.fFC = 0x41;
  return 1;
}

/** 4484bc : le minuteur, touché par la bonne arête (index 0 ou 8, côté haut), se déclenche. */
function timerTouched(world: World, t: Part, toucher: Part): number {
  if (t.f24 !== 0) return 1;
  let idx = toucher.contactIndex;
  if (t.flags10 & 0x10) {
    const n = world.types.get(T.timer).vertexCount;
    let r = (n - idx - 2) | 0;
    idx = r;
    if (r < 0) idx = (r + n) | 0;
  }
  if (idx === 0 || (toucher.contactAngle === 0 && idx === 8)) {
    t.f24 = 1;
    timerReset(world, t);
    world.sound(0xca5, t);
  }
  return 1;
}

/** 448532 : minuteur, slot 2 : polygone selon retournement et état. */
function timerReset(world: World, p: Part): void {
  let i = p.flags10 & 0x10 ? 2 : 0;
  if (p.f24) i++;
  setPolygon(world, p, T.timer, i);
}

/** 448721 : vitesse communiquée par le minuteur à une pièce mobile, d'après sa masse. */
function timerSpeed(mass: number): number {
  const steps: [number, number][] = [[2, 0x1800], [6, 0x1600], [10, 0x1400], [0x15, 0x1200], [0x79, 0x1000], [0x97, 0xe00], [0xc9, 0xc00], [0x709, 0xa00]];
  for (const [limit, speed] of steps) if (mass < limit) return speed;
  return 0x800;
}

/** Décalages de la zone poussée selon l'image (0x478410). */
const TIMER_PUSH = [13, 34, 55];

/**
 * 4485b3 : minuteur, slot 1 : une fois déclenché, il compte (+0x24), s'anime, puis frappe ce qui est devant lui : une pièce
 * mobile reçoit une vitesse horizontale selon sa masse ; les fixes de type 6 (43f907) et 15 (440454) réagissent, celle de
 * type 78 s'active (+0x24 = 1). Les types 6 et 15 sont à `mechanics` / `misc` : appels par `world.special`.
 */
function timerRun(world: World, p: Part): void {
  if (p.f24 !== 0) {
    const a = stateFirst(world, T.timer, 0x23);
    const b = (stateFirst(world, T.timer, 0x13) + 1) | 0;
    const c = stateFirst(world, T.timer, 0x14);
    if (p.f24 <= 2) {
      p.frame++;
      p.f24++;
      p.fFC = 0x14;
    } else if (p.frame < a) {
      p.fFC = (p.fFC - 1) | 0;
      if (p.fFC === 0) {
        p.fFC = 0x14;
        p.frame += 3;
        world.sound(0xc41, p);
      }
    } else if (p.frame !== c) {
      p.frame++;
      const k = (p.frame - b) | 0;
      if (k >= 0 && k < 3) {
        const flipped = (p.flags10 & 0x10) !== 0;
        if (flipped) boxScan(world, p, 0x3000, -TIMER_PUSH[k]!, 0, 0x10, 0x24);
        else boxScan(world, p, 0x3000, 0x30, (TIMER_PUSH[k]! + 0x30) | 0, 0x10, 0x24);
        for (const q of chain(p)) {
          if (q.flags0C & F0C.IN_MOBILE) {
            const v = timerSpeed(q.mass);
            q.vx = flipped ? -v : v;
            if (q.type === 0x36) {
              const g = stateFirst(world, 54, 8);
              if (q.frame < g) q.frame = g;
            }
          } else if (q.type === 6) world.special(0x43f907, q);
          else if (q.type === 15) world.special(0x440454, q);
          else if (q.type === 0x4e) q.f24 = 1;
        }
      }
    }
  }
  if (p.frame !== p.framePrev) updateGeometry(world, p);
}

export function register(r: HandlerRegistry): void {
  const num = (a: unknown): number => (typeof a === "number" ? a : 0);
  // 21
  r.register(0x440c00, "switch.touched", (w, p, a) => switchTouched(w, p, a as Part));
  r.register(0x440cee, "switch.run", (w, p) => sourceRun(w, p));
  r.register(0x440c8b, "switch.reset", (w, p) => switchReset(w, p));
  r.register(0x440d18, "switch.edit", (w, p) => switchEdit(w, p));
  // 22
  r.register(0x440d68, "remote.touched", (w, p, a) => remoteTouched(w, p, a as Part));
  r.register(0x440ddf, "remote.run", (w, p) => remoteRun(w, p));
  r.register(0x440d92, "remote.reset", (w, p) => remoteReset(w, p));
  r.register(0x440e36, "remote.ropeReaction", (w, p, _puller, _slot = 0, flags = 0) => remoteRopeReaction(w, p, flags));
  // 120, 96, 94
  r.register(0x44823e, "outlet.run", (w, p) => outletRun(w, p));
  r.register(0x448218, "outlet.reset", (w, p) => outletReset(w, p));
  r.register(0x4473a1, "laserOutlet.run", (w, p) => laserOutletRun(w, p));
  r.register(0x447358, "laserOutlet.reset", (w, p) => laserOutletReset(w, p));
  r.register(0x4472f0, "mirror.reset", (w, p) => mirrorReset(w, p));
  r.register(0x447314, "mirror.edit", (w, p, a) => mirrorEdit(w, p, num(a)));
  // 148
  r.register(0x44887c, "detector.run", (w, p) => detectorRun(w, p));
  r.register(0x44891d, "detector.reset", (w, p) => detectorReset(w, p));
  // 136, 137
  r.register(0x4483b6, "computer.touched", (w, p, a) => computerTouched(w, p, a as Part));
  r.register(0x448404, "computer.reset", (w, p) => polygonZero(T.computer)(w, p));
  r.register(0x448424, "computer.draw", () => undefined);
  r.register(0x448380, "computer.links", (w, _p, a) => computerLinks(w, a as Part | null | undefined));
  r.register(0x4484bc, "timer.touched", (w, p, a) => timerTouched(w, p, a as Part));
  r.register(0x4485b3, "timer.run", (w, p) => timerRun(w, p));
  r.register(0x448532, "timer.reset", (w, p) => timerReset(w, p));
}

