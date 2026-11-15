/**
 * Fonctions natives du groupe F1 : objets, états, cellules, base de fichiers.
 *
 * Référence : `engines/cruise/function.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `Op_LoadAbs`, `Op_AddCell`,
 * `Op_InitializeState`, `Op_RemoveCell`, `Op_FreeCell`, `Op_RemoveFrame`, `Op_FreezeCell`, `Op_FindObject`, `Op_WriteObject`,
 * `Op_ReadObject`, `Op_ThemeReset`, `Op_FrameExist`, `Op_LinkObjects`, `Op_FindSet`, `Op_AutoCell`, `Op_Sizeof`, `Op_Preload`,
 * `Op_FreePreload`, `Op_LoadFrame`. Lu puis réécrit (vague C ; à vérifier contre la trace du banc en F1).
 *
 * Bizarreries reproduites : `Op_WriteObject` et `Op_ReadObject` ne remplacent pas l'overlay 0 par l'overlay courant ; un objet
 * introuvable rend 0 (ScummVM : variable non initialisée).
 */
import { Freeze, NUM_FILE_ENTRIES, ObjType, ScriptType } from "../ids";
import { readCString, strlcpy, strToUpper } from "../memory";
import { getMultipleObjectParam, getSingleObjectParam, objectReset, objInit, setObjectPosition } from "../objects";
import { orCurrent, type NativeGroup } from "./types";

export const F1_OBJECTS: NativeGroup = {
  0x04: {
    name: "LoadAbs",
    args: 2,
    impl(e) {
      const p = e.vm.popPtr();
      const slot = e.vm.popVar();
      if (slot < 0 || slot >= NUM_FILE_ENTRIES || !p) return 0;
      return e.filesDb.loadFullBundle(strToUpper(strlcpy(readCString(p), 36)), slot);
    },
  },
  0x05: {
    name: "AddCell",
    args: 3,
    impl(e) {
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const cur = e.currentScript!;
      e.cells.add(e, ovl, obj, type, e.display.masterScreen, cur.overlayNumber, cur.scriptNumber, cur.type);
      return 0;
    },
  },
  0x07: {
    name: "InitializeState",
    args: 3,
    impl(e) {
      const state = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      objInit(e, ovl, obj, state);
      return 0;
    },
  },
  0x08: {
    name: "RemoveCell",
    args: 3,
    impl(e) {
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      e.cells.remove(ovl, obj, type, e.display.masterScreen, e.freeCellGfx);
      return 0;
    },
  },
  0x09: {
    name: "FreeCell",
    args: 0,
    impl(e) {
      e.cells.freeAll(e.freeCellGfx);
      return 0;
    },
  },
  0x0b: {
    name: "RemoveFrame",
    args: 2,
    impl(e) {
      const count = e.vm.popVar();
      const start = e.vm.popVar();
      e.filesDb.resetRange(start, count);
      return 0;
    },
  },
  0x16: {
    name: "FreezeCell",
    args: 6,
    impl(e) {
      const newFreeze = e.vm.popVar();
      const oldFreeze = e.vm.popVar();
      const plane = e.vm.popVar();
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      e.cells.freeze(ovl, obj, type, plane, oldFreeze, newFreeze);
      return 0;
    },
  },
  0x2a: {
    name: "FindObject",
    args: 2,
    impl(e) {
      const p = e.vm.popPtr();
      const name = p ? strlcpy(readCString(p), 36) : "";
      const ovl = orCurrent(e, e.vm.popVar());
      return e.overlays.procParam(ovl, 40, name);
    },
  },
  0x2c: {
    name: "WriteObject",
    args: 4,
    impl(e) {
      const value = e.vm.popVar();
      const param = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = e.vm.popVar();
      const old = getSingleObjectParam(e, ovl, obj, param) ?? 0;
      setObjectPosition(e, ovl, obj, param, value);
      return old;
    },
  },
  0x2d: {
    name: "ReadObject",
    args: 3,
    impl(e) {
      const member = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = e.vm.popVar();
      return getSingleObjectParam(e, ovl, obj, member) ?? 0;
    },
  },
  0x36: {
    name: "ThemeReset",
    args: 0,
    impl(e) {
      objectReset(e);
      return 0;
    },
  },
  0x41: {
    name: "FrameExist",
    args: 1,
    impl(e) {
      const idx = e.vm.popVar();
      if (idx < 0 || idx > 255) return 0;
      return e.filesDb.get(idx) ? 1 : 0;
    },
  },
  0x4b: {
    name: "LinkObjects",
    args: 5,
    impl(e) {
      const type = e.vm.popVar();
      const obj2 = e.vm.popVar();
      const ovl2 = orCurrent(e, e.vm.popVar());
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      e.cells.link(ovl, obj, type, ovl2, obj2);
      return 0;
    },
  },
  0x5a: {
    name: "FindSet",
    args: 1,
    impl(e) {
      const p = e.vm.popPtr();
      if (!p) return -1;
      return e.filesDb.findSet(strToUpper(strlcpy(readCString(p), 36)));
    },
  },
  0x65: {
    name: "AutoCell",
    args: 10,
    impl(e) {
      const signal = e.vm.popVar();
      const loop = e.vm.popVar();
      const wait = e.vm.popVar();
      const animStep = e.vm.popVar();
      const end = e.vm.popVar();
      const start = e.vm.popVar();
      const type = e.vm.popVar();
      const change = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const cur = e.currentScript!;
      const cell = e.cells.add(e, ovl, obj, ObjType.SPRITE, e.display.masterScreen, cur.overlayNumber, cur.scriptNumber, cur.type);
      if (!cell) return 0;
      cell.animSignal = signal;
      cell.animLoop = loop;
      cell.animWait = wait;
      cell.animStep = animStep;
      cell.animEnd = end;
      cell.animStart = start;
      cell.animType = type;
      cell.animChange = change;
      if (type) {
        if (cur.type === ScriptType.PROC) e.changeScriptParamInList(cur.overlayNumber, cur.scriptNumber, e.procs, -1, Freeze.autoCell);
        else if (cur.type === ScriptType.REL) e.changeScriptParamInList(cur.overlayNumber, cur.scriptNumber, e.rels, -1, Freeze.autoCell);
      }
      if (change === 5) objInit(e, cell.overlay, cell.idx, start);
      else setObjectPosition(e, cell.overlay, cell.idx, cell.animChange, start);
      if (wait < 0) {
        const q = getMultipleObjectParam(e, ovl, obj);
        cell.animCounter = (q?.state2 ?? 0) - 1;
      }
      return 0;
    },
  },
  0x66: {
    name: "Sizeof",
    args: 2,
    impl(e) {
      const index = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      return (getMultipleObjectParam(e, ovl, index)?.nbState ?? 0) - 1;
    },
  },
  0x67: {
    name: "Preload",
    args: 2,
    impl(e) {
      e.vm.popPtr();
      e.vm.popVar();
      return 0;
    },
  },
  0x68: {
    name: "FreePreload",
    args: 0,
    impl() {
      return 0;
    },
  },
  0x6b: {
    name: "LoadFrame",
    args: 4,
    impl(e) {
      const p = e.vm.popPtr();
      const count = e.vm.popVar();
      const start = e.vm.popVar();
      const dest = e.vm.popVar();
      if (dest >= 0 && dest < NUM_FILE_ENTRIES && p) e.filesDb.loadFileRange(strToUpper(strlcpy(readCString(p), 36)), start, dest, count);
      return 0;
    },
  },
};
