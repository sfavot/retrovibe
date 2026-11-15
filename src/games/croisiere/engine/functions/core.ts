/**
 * Fonctions natives du cœur (vague C) : overlays, processus, gel des parents, attente de clic, chaînes, aléatoire.
 *
 * Référence : `engines/cruise/function.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `Op_LoadOverlay`, `Op_FreeOverlay`,
 * `Op_FindOverlay`, `Op_RemoveOverlay`, `Op_FreezeOverlay`, `Op_AddProc`, `Op_Exec`, `Op_RemoveProc`, `Op_FindProc`,
 * `Op_FindSymbol`, `Op_FreezeParent`, `Op_UnfreezeParent`, `Op_UserWait`, `Op_Random`, `Op_Strcpy`, `Op_Strcat`, `Op_Itoa`,
 * `Op_comment`, `Op_Sec`. Lu puis réécrit.
 *
 * Bizarreries reproduites : `Op_AddProc` range les arguments dans l'ordre de dépilement, `Op_Exec` dans l'ordre d'empilement ;
 * `Op_Strcpy` / `Op_Strcat` / `Op_Itoa` écrivent sans borne (jusqu'à la fin du bloc ici) ; `Op_Random(n)` = 0 si n < 2, sinon
 * `getRandomNumber(n - 1)`.
 */
import { Freeze, ScriptType } from "../ids";
import { readCString, readU8, strlcpy, strToUpper, writeI16, writeU8, type Ptr } from "../memory";
import { orCurrent, type NativeGroup } from "./types";

function needPtr(p: Ptr | null, what: string): Ptr {
  if (!p) throw new Error(`${what} : pointeur nul`);
  return p;
}

/** Copie d'une chaîne C octet par octet (source et destination peuvent se recouvrir, comme la boucle de ScummVM). */
function copyCString(src: Ptr, dst: Ptr, dstStart: number): number {
  let i = 0;
  let d = dstStart;
  for (;;) {
    const c = readU8(src.block, src.offset + i);
    if (!c) break;
    writeU8(dst.block, d, c);
    i++;
    d++;
  }
  writeU8(dst.block, d, 0);
  return d;
}

/** `printf("%<w>d")` pour `Op_Itoa` (largeur négative = alignement à gauche). */
function formatInt(value: number, width: number | null): string {
  const s = String(value);
  if (width === null || width === 0) return s;
  return width > 0 ? s.padStart(width, " ") : s.padEnd(-width, " ");
}

export const CORE: NativeGroup = {
  0x06: {
    name: "AddProc",
    args: -1,
    impl(e) {
      const count = e.vm.popVar();
      const params: number[] = [];
      for (let i = 0; i < count; i++) params.push(e.vm.popVar());
      const script = e.vm.popVar();
      let overlay = e.vm.popVar();
      const cur = e.currentScript!;
      if (!overlay) overlay = cur.overlayNumber;
      if (!overlay) return 0;
      const { bss } = e.attachScript(e.procs, overlay, script, cur.type, cur.scriptNumber, cur.overlayNumber, ScriptType.PROC);
      if (bss) params.forEach((v, i) => writeI16(bss, i * 2, v));
      return 0;
    },
  },
  0x0a: {
    name: "RemoveProc",
    args: 2,
    impl(e) {
      const idx = e.vm.popVar();
      const overlay = orCurrent(e, e.vm.popVar());
      e.removeScript(overlay, idx, e.procs);
      return 0;
    },
  },
  0x0c: {
    name: "LoadOverlay",
    args: 1,
    impl(e) {
      const raw = readCString(needPtr(e.vm.popPtr(), "LoadOverlay"));
      if (!raw.length) return 0;
      const name = strToUpper(raw);
      const result = e.overlays.load(name);
      e.overlays.updateAllScriptsImports();
      e.nextOverlay = strlcpy(name, 38);
      return result;
    },
  },
  0x10: {
    name: "FreeOverlay",
    args: 1,
    impl(e) {
      const name = strlcpy(readCString(needPtr(e.vm.popPtr(), "FreeOverlay")), 36);
      if (name) e.releaseOverlay(strToUpper(name));
      return 0;
    },
  },
  0x11: {
    name: "FindOverlay",
    args: 1,
    impl(e) {
      const name = strToUpper(strlcpy(readCString(needPtr(e.vm.popPtr(), "FindOverlay")), 36));
      return e.overlays.findLoaded(name);
    },
  },
  0x15: {
    name: "UserWait",
    args: 0,
    impl(e) {
      e.userWait = true;
      const cur = e.currentScript!;
      if (cur.type === ScriptType.PROC) e.changeScriptParamInList(cur.overlayNumber, cur.scriptNumber, e.procs, -1, Freeze.userWait);
      else if (cur.type === ScriptType.REL) e.changeScriptParamInList(cur.overlayNumber, cur.scriptNumber, e.rels, -1, Freeze.userWait);
      return 0;
    },
  },
  0x2b: {
    name: "FindProc",
    args: 2,
    impl(e) {
      const name = strlcpy(readCString(needPtr(e.vm.popPtr(), "FindProc")), 36);
      return e.overlays.procParam(e.vm.popVar(), ScriptType.PROC, name);
    },
  },
  0x2e: {
    name: "RemoveOverlay",
    args: 1,
    impl(e) {
      const idx = e.vm.popVar();
      const name = e.overlays.entries[idx]?.name ?? "";
      if (name.length) e.releaseOverlay(name);
      return 0;
    },
  },
  0x3c: {
    name: "Random",
    args: 1,
    impl(e) {
      const n = e.vm.popVar();
      if (n < 2) return 0;
      return e.rnd.number(n - 1);
    },
  },
  0x62: {
    name: "FreezeParent",
    args: 0,
    impl(e) {
      const cur = e.currentScript!;
      if (cur.var1A === ScriptType.PROC) e.changeScriptParamInList(cur.var18, cur.var16, e.procs, -1, Freeze.parent);
      else if (cur.var1A === ScriptType.REL) e.changeScriptParamInList(cur.var18, cur.var16, e.rels, -1, Freeze.parent);
      return 0;
    },
  },
  0x63: {
    name: "UnfreezeParent",
    args: 0,
    impl(e) {
      const cur = e.currentScript!;
      if (cur.var1A === ScriptType.PROC) e.changeScriptParamInList(cur.var18, cur.var16, e.procs, -1, 0);
      else if (cur.var1A === ScriptType.REL) e.changeScriptParamInList(cur.var18, cur.var16, e.rels, -1, 0);
      return 0;
    },
  },
  0x64: {
    name: "Exec",
    args: -1,
    impl(e) {
      const count = e.vm.popVar();
      const table: number[] = new Array(Math.max(count, 0)).fill(0);
      for (let i = 0; i < count; i++) table[count - i - 1] = e.vm.popVar();
      const script = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const cur = e.currentScript!;
      const { bss } = e.attachScript(e.procs, ovl, script, cur.type, cur.scriptNumber, cur.overlayNumber, -ScriptType.PROC);
      if (!bss || count <= 0) return 0;
      table.forEach((v, i) => writeI16(bss, i * 2, v));
      return 0;
    },
  },
  0x6c: {
    name: "FreezeOverlay",
    args: 2,
    impl(e) {
      const value = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const entry = e.overlays.entry(ovl);
      const old = entry.executeScripts;
      entry.executeScripts = value;
      return old;
    },
  },
  0x6d: {
    name: "Strcpy",
    args: 2,
    impl(e) {
      const src = needPtr(e.vm.popPtr(), "Strcpy");
      const dst = needPtr(e.vm.popPtr(), "Strcpy");
      copyCString(src, dst, dst.offset);
      return 0;
    },
  },
  0x6e: {
    name: "Strcat",
    args: 2,
    impl(e) {
      const src = needPtr(e.vm.popPtr(), "Strcat");
      const dst = needPtr(e.vm.popPtr(), "Strcat");
      let end = dst.offset;
      while (end < dst.block.length && dst.block[end]) end++;
      copyCString(src, dst, end);
      return 0;
    },
  },
  0x6f: {
    name: "Itoa",
    args: -1,
    impl(e) {
      const count = e.vm.popVar();
      const params: number[] = [];
      for (let i = count - 1; i >= 0; i--) params[i] = e.vm.popVar();
      const value = e.vm.popVar();
      const dst = needPtr(e.vm.popPtr(), "Itoa");
      const text = formatInt(value, count ? params[0]! : null);
      for (let i = 0; i < text.length; i++) writeU8(dst.block, dst.offset + i, text.charCodeAt(i));
      writeU8(dst.block, dst.offset + text.length, 0);
      return 0;
    },
  },
  0x70: {
    name: "comment",
    args: 1,
    impl(e) {
      const p = e.vm.popPtr();
      e.warn(`COMMENT: "${p ? readCString(p) : ""}"`);
      return 0;
    },
  },
  0x72: {
    name: "FindSymbol",
    args: 3,
    impl(e) {
      const type = e.vm.popVar();
      const name = readCString(needPtr(e.vm.popPtr(), "FindSymbol"));
      const ovl = orCurrent(e, e.vm.popVar());
      return e.overlays.procParam(ovl, type, name);
    },
  },
  0x7b: {
    name: "Sec",
    args: 1,
    impl(e) {
      const di = e.vm.popVar();
      const si = 1 - e.op7BVar;
      const sign = di ? Math.trunc(di / Math.abs(di)) : 0;
      e.op7BVar = -sign;
      return si;
    },
  },
};
