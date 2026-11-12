/**
 * Scripts d'animation des hotspots (segment `0x3F0D`) : suites de mots de 16 bits signés ; un mot positif est un numéro d'image (le
 * script s'arrête jusqu'au tick suivant), un mot négatif un opcode `S2_OPCODE_*`.
 *
 * Source (ScummVM, GPL v3+) : `HotspotScript::execute` et `nextVal` (engines/lure/scripts.cpp), opcodes de `scripts.h`.
 *
 * Écarts : aucun. Les deux contournements de ScummVM sont gardés : le son du vin dans la cave (pièce `0x2A`) et l'appareil de la
 * pièce 30 (hotspot 1059, version anglaise EGA : sans effet sur nos données, gardé pour la fidélité).
 */

import type { Segment } from "../data/lure-dat";
import type { LureContext } from "./context";
import type { Hotspot } from "./hotspot";

export const S2 = {
  FRAME_CTR: -1,
  POSITION: -2,
  CHANGE_POS: -3,
  UNLOAD: -4,
  DIMENSIONS: -5,
  JUMP: -6,
  ANIMATION: -7,
  PLAY_SOUND: -8,
  STOP_SOUND: -9,
  ACTIONS: -10,
} as const;

/** Nombre de paramètres de chaque opcode (par valeur absolue). */
const S2_PARAMS: Record<number, number> = { 1: 1, 2: 2, 3: 2, 4: 0, 5: 2, 6: 1, 7: 1, 8: 2, 9: 1, 10: 2 };

function nextVal(segment: Segment, offset: { pos: number }): number {
  if (offset.pos >= segment.length - 1) throw new Error("script de hotspot : décalage invalide");
  const value = segment.i16(offset.pos);
  offset.pos += 2;
  return value;
}

const CELLAR_ROOM = 0x2a;
const APPARATUS_ID = 1059;

/** `HotspotScript::execute` : rend vrai quand le script se termine (`UNLOAD`). */
export function executeHotspotScript(ctx: LureContext, h: Hotspot): boolean {
  const segment = ctx.data.scripts2;
  const offset = { pos: h.hotspotScript };
  let opcode = 0;
  for (;;) {
    if (ctx.room.roomNumber === CELLAR_ROOM) {
      // WORKAROUND de ScummVM : le son du vin qui coule dans la cave.
      if (offset.pos === 0x0ca2) ctx.sound.addSound2(0x2b);
      else if (offset.pos === 0x0d12 || offset.pos === 0x0cc4) ctx.sound.stopSound(0x2b);
    }
    opcode = nextVal(segment, offset);
    switch (opcode) {
      case S2.FRAME_CTR:
        h.frameCtr = nextVal(segment, offset) & 0xffff;
        h.setHotspotScript(offset.pos);
        return false;
      case S2.POSITION: {
        const x = nextVal(segment, offset);
        const y = nextVal(segment, offset);
        h.setPosition(x - 0x80, y - 0x80);
        break;
      }
      case S2.CHANGE_POS: {
        const dx = nextVal(segment, offset);
        const dy = nextVal(segment, offset);
        h.setPosition(h.x + dx, h.y + dy);
        break;
      }
      case S2.UNLOAD:
        return true;
      case S2.DIMENSIONS: {
        const width = (nextVal(segment, offset) << 4) & 0xffff;
        const height = nextVal(segment, offset);
        h.setSize(width, height & 0xffff);
        break;
      }
      case S2.JUMP:
        offset.pos = nextVal(segment, offset) & 0xffff;
        break;
      case S2.ANIMATION:
        h.setAnimation(nextVal(segment, offset) & 0xffff);
        break;
      case S2.PLAY_SOUND: {
        const sound = nextVal(segment, offset);
        const room = nextVal(segment, offset);
        if (room === 0 || ctx.room.roomNumber === room) ctx.sound.addSound2(sound & 0xff);
        break;
      }
      case S2.STOP_SOUND:
        ctx.sound.stopSound(nextVal(segment, offset) & 0xff);
        break;
      case S2.ACTIONS: {
        const low = nextVal(segment, offset) & 0xffff;
        const high = nextVal(segment, offset) & 0xffff;
        h.setActions((low | (high << 16)) >>> 0);
        break;
      }
      default: {
        let frame = opcode;
        if (h.hotspotId === APPARATUS_ID && frame >= h.numFrames) frame = h.numFrames - 1;
        h.setFrameNumber(frame & 0xffff);
        h.setHotspotScript(offset.pos);
        return false;
      }
    }
  }
}

/** Instruction décodée d'un script de hotspot (pour la visionneuse et les tests). */
export interface HotspotScriptOp {
  offset: number;
  /** Opcode (négatif) ou numéro d'image (positif ou nul). */
  opcode: number;
  params: number[];
}

/**
 * Désassemble un script de hotspot depuis `start` jusqu'à `UNLOAD`, en suivant les sauts ; un numéro d'image ou `FRAME_CTR` ne termine
 * pas le script (il reprend au tick suivant). S'arrête aussi sur un saut déjà vu (boucle d'animation).
 */
export function disassembleHotspotScript(segment: Segment, start: number): HotspotScriptOp[] {
  const ops: HotspotScriptOp[] = [];
  const seen = new Set<number>();
  const offset = { pos: start };
  for (;;) {
    if (seen.has(offset.pos)) return ops;
    seen.add(offset.pos);
    const at = offset.pos;
    const opcode = nextVal(segment, offset);
    const count = opcode < 0 ? S2_PARAMS[-opcode] : 0;
    if (count === undefined) throw new Error(`script de hotspot ${start.toString(16)} : opcode ${opcode} inconnu à ${at.toString(16)}`);
    const params: number[] = [];
    for (let i = 0; i < count; i++) params.push(nextVal(segment, offset));
    ops.push({ offset: at, opcode, params });
    if (opcode === S2.UNLOAD) return ops;
    if (opcode === S2.JUMP) offset.pos = params[0]! & 0xffff;
  }
}
