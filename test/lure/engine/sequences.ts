import type { LureData } from "../../../src/games/lure/data/lure-data";
import { Action } from "../../../src/games/lure/data/ids";
import { Op, disassemble } from "../../../src/games/lure/engine/script";

const START_NONVISUAL_HOTSPOT_ID = 0x7530;

/**
 * Actions qu'aucun menu ne propose : « Prends » (verbe 1) de la liste `0x6CAE`, celle du hotspot non visuel `0x753D` (pièce 30) dont le
 * masque d'actions n'a que « Utilise » ; sa séquence (`0xB00`) tombe au milieu d'une instruction.
 */
export const UNREACHABLE_ACTIONS = new Set([`${0x6cae}:1`]);

/** Séquences citées par le code de ScummVM (démarrage, Brenda, retour de Selena, porte du Weregate). */
export const CODE_SEQUENCES = [0x23fc, 0x1e15, 0xcb7, 3941];

export interface SequenceSource {
  offset: number;
  source: string;
}

/**
 * Points d'entrée de `0x3F0C` cités par les données et par le code (`docs/lure/engine.md`, § 8) : pièces, sorties, actions des
 * hotspots, chargements par script, dialogues (pré- et post-séquences, réponses), emplois du temps (`NPC_EXEC_SCRIPT`,
 * `NPC_SUPPORT_OFFSET_COND`), puis, de proche en proche, sous-séquences et séquences différées (`PUSH` avant `EXEC 8`).
 */
export function sequenceEntryPoints(data: LureData): SequenceSource[] {
  const out: SequenceSource[] = [];
  const add = (offset: number, source: string): void => {
    out.push({ offset, source });
  };
  for (const o of CODE_SEQUENCES) add(o, "code");
  for (const room of data.rooms) {
    if (room.sequenceOffset !== 0xffff) add(room.sequenceOffset, `pièce ${room.roomNumber}`);
    for (const exit of room.exits) if (exit.sequenceOffset !== 0xffff) add(exit.sequenceOffset, `sortie de la pièce ${room.roomNumber}`);
  }
  for (const list of data.actionLists.lists) {
    for (const a of list.actions) {
      if (a.sequenceOffset === 0 || a.sequenceOffset >= 0x8000) continue;
      if (UNREACHABLE_ACTIONS.has(`${list.recordId}:${a.action}`)) continue;
      add(a.sequenceOffset, `actions ${list.recordId.toString(16)} verbe ${a.action}`);
    }
  }
  // Pour un hotspot non visuel (>= 0x7530), `scriptLoadFlag` est une direction (`nonVisualDirection`), pas un drapeau.
  for (const h of data.hotspots) {
    if (h.scriptLoadFlag && h.hotspotId < START_NONVISUAL_HOTSPOT_ID) add(h.loadOffset, `chargement de ${h.hotspotId.toString(16)}`);
  }
  for (const rec of data.talk.records) {
    for (const e of rec.entries) {
      if ((e.preSequenceId & 0x3fff) !== 0) add(e.preSequenceId & 0x3fff, `dialogue ${rec.recordId.toString(16)}`);
      if ((e.postSequenceId & 0x8000) !== 0 && e.postSequenceId !== 0xffff) add(e.postSequenceId & 0x7fff, `dialogue ${rec.recordId.toString(16)}`);
    }
    // Une réponse n'est lue que par son rang (`getResponse`) : le rang donné par une entrée, ou n'importe lequel si une séquence le
    // calcule. La liste des réponses de ScummVM n'a pas de fin fiable (elle s'arrête sur un `0xFFFF` qui peut manquer) : au-delà des
    // rangs atteignables, ce sont d'autres données.
    const computed = rec.entries.some((e) => (e.postSequenceId & 0x8000) !== 0 && e.postSequenceId !== 0xffff);
    const reachable = new Set(rec.entries.map((e) => e.postSequenceId));
    for (const [index, r] of rec.responses.entries()) {
      if (!computed && !reachable.has(index) && !rec.responses.slice(0, index).some((p) => p.preSequenceId !== 0)) continue;
      if (r.preSequenceId !== 0) add(r.preSequenceId, `réponse ${rec.recordId.toString(16)}`);
      if ((r.descId & 0x8000) !== 0) add(r.descId & 0x7fff, `réponse ${rec.recordId.toString(16)}`);
      if ((r.postSequenceId & 0x8000) !== 0 && r.postSequenceId !== 0xffff) add(r.postSequenceId & 0x7fff, `réponse ${rec.recordId.toString(16)}`);
    }
  }
  for (const set of data.schedules.schedules) {
    for (const e of set.entries) {
      if (e.action === Action.NPC_EXEC_SCRIPT || e.action === Action.NPC_SUPPORT_OFFSET_COND) add(e.params[0]!, `emploi du temps ${set.id}`);
    }
  }
  return out;
}

/** Toutes les séquences atteignables (points d'entrée, sous-séquences, séquences différées), avec une source chacune. */
export function allSequences(data: LureData): Map<number, string> {
  const found = new Map<number, string>();
  const pending = sequenceEntryPoints(data);
  while (pending.length > 0) {
    const { offset, source } = pending.pop()!;
    if (found.has(offset)) continue;
    found.set(offset, source);
    const decoded = disassemble(data.scripts, offset);
    for (const sub of decoded.subroutines) pending.push({ offset: sub, source: `sous-séquence de ${offset.toString(16)}` });
    const ops = decoded.ops;
    for (let i = 1; i < ops.length; i++) {
      const op = ops[i]!;
      const prev = ops[i - 1]!;
      if (op.opcode === Op.EXEC && op.param === 8 && prev.opcode === Op.PUSH && prev.offset + prev.size === op.offset) {
        pending.push({ offset: prev.param!, source: `différée par ${offset.toString(16)}` });
      }
    }
  }
  return found;
}
