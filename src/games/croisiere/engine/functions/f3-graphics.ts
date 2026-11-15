/**
 * Fonctions natives du groupe F3 : fonds, palettes, incrustations, messages, menus et dialogue.
 *
 * Référence : `engines/cruise/function.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `Op_FadeIn`, `Op_FadeOut`,
 * `Op_LoadBackground`, `Op_SetColor`, `Op_AddMessage` (`cell.cpp::createTextObject`), `Op_RemoveMessage`, `Op_SetStringColors`,
 * `Op_AddBackgroundIncrust`, `Op_RemoveBackgroundIncrust`, `Op_UnmergeBackgroundIncrust`, `Op_freeBackgroundInscrustList`,
 * `Op_RemoveBackground`, `Op_SetActiveBackground`, `Op_MsgExist`, `Op_SetFont`, `Op_BgName`, `Op_regenerateBackgroundIncrust`,
 * `Op_ClearScreen`, `Op_VBL`, `Op_Display`, `Op_DialogOn`, `Op_DialogOff`, `Op_SetXDial`, `Op_KillMenu`, `Op_Menu`,
 * `Op_XMenuItem`, `Op_YMenuItem`. Lu puis réécrit (vague C pour la logique, R2 pour les textes rendus et les fondus).
 *
 * Écart volontaire : le TTS de ScummVM n'est pas repris.
 */
import { NBSCREENS, ObjType } from "../ids";
import {
  addBackgroundIncrust,
  freeBackgroundIncrustList,
  regenerateBackgroundIncrust,
  removeBackgroundIncrust,
  unmergeBackgroundIncrust,
} from "../incrust";
import { readCString, strlcpy, strToUpper, writeCString } from "../memory";
import { objectReset } from "../objects";
import type { EngineState } from "../state";
import { orCurrent, type NativeGroup } from "./types";
import { renderText } from "../../render/draw";

/** `createTextObject` : cellule de message en queue, texte rendu avec la police courante. */
export function createTextObject(e: EngineState, ovl: number, messageIdx: number, x: number, y: number, width: number, color: number, plane: number, parentOvl: number, parentIdx: number): void {
  const cell = e.cells.addText(ovl, messageIdx, x, y, width, color, plane, parentOvl, parentIdx);
  const text = e.getText(messageIdx, ovl);
  if (text !== null) cell.gfx = renderText(e, width, text);
  // WORKAROUND de ScummVM (rafraîchissement de l'écran de protection) : il rend le fond « changé ».
  if (e.overlays.entries[ovl]?.name === "XX2" && messageIdx === 0) e.display.backgroundChanged[0] = true;
}

/** `freeMenu` des menus 0 et 1 (`Op_KillMenu`). */
function killMenus(e: EngineState): void {
  for (const i of [0, 1]) {
    if (e.menuTable[i]) {
      e.menuTable[i] = null;
      e.currentActiveMenu = -1;
    }
  }
  e.linkedMsgList = null;
  e.linkedRelation = null;
}

function menuItem(e: EngineState, index: number, axis: "x" | "y"): number {
  const menu = e.menuTable[0];
  if (!menu || !menu.elements.length) return 0;
  const item = menu.elements[index];
  return item ? item[axis] + 1 : 0;
}

export const F3_GRAPHICS: NativeGroup = {
  0x01: {
    name: "FadeIn",
    args: 0,
    impl(e) {
      e.display.doFade = 1;
      return 0;
    },
  },
  0x02: {
    name: "FadeOut",
    args: 0,
    impl(e) {
      e.display.fadeOut(() => e.renderer.present?.(e));
      return 0;
    },
  },
  0x03: {
    name: "LoadBackground",
    args: 2,
    impl(e) {
      const p = e.vm.popPtr();
      const name = strlcpy(p ? readCString(p) : "", 36);
      const idx = e.vm.popVar();
      let result = 0;
      if (idx >= 0 && idx < NBSCREENS) {
        result = e.display.loadBackground(strToUpper(name), idx, (n) => e.readFile(n), () => {
          e.userEnabled = 0;
        });
      }
      return result;
    },
  },
  0x0d: {
    name: "SetColor",
    args: 5,
    impl(e) {
      const b = e.vm.popVar();
      const g = e.vm.popVar();
      const r = e.vm.popVar();
      const end = e.vm.popVar();
      const start = e.vm.popVar();
      e.display.setColor(start, end, r, g, b);
      return 0;
    },
  },
  0x13: {
    name: "AddMessage",
    args: 6,
    impl(e) {
      let color = e.vm.popVar();
      const width = e.vm.popVar();
      const y = e.vm.popVar();
      const x = e.vm.popVar();
      const msg = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      if (color === -1) color = e.display.findHighColor();
      else if (e.display.cvtLoaded) color = e.display.cvtPalette[color & 0x1f]!;
      const cur = e.currentScript!;
      createTextObject(e, ovl, msg, x, y, width, color, e.display.masterScreen, cur.overlayNumber, cur.scriptNumber);
      return 0;
    },
  },
  0x14: {
    name: "RemoveMessage",
    args: 2,
    impl(e) {
      const idx = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      e.cells.remove(ovl, idx, ObjType.MESSAGE, e.display.masterScreen, e.freeCellGfx);
      return 0;
    },
  },
  0x24: {
    name: "SetStringColors",
    args: 4,
    impl(e) {
      e.display.subColor = e.vm.popVar() & 0xff;
      e.display.itemColor = e.vm.popVar() & 0xff;
      e.display.selectColor = e.vm.popVar() & 0xff;
      e.display.titleColor = e.vm.popVar() & 0xff;
      return 0;
    },
  },
  0x2f: {
    name: "AddBackgroundIncrust",
    args: 3,
    impl(e) {
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const cur = e.currentScript!;
      addBackgroundIncrust(e, ovl, obj, cur.scriptNumber, cur.overlayNumber, e.display.masterScreen, type);
      return 0;
    },
  },
  0x30: {
    name: "RemoveBackgroundIncrust",
    args: 2,
    impl(e) {
      const idx = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      removeBackgroundIncrust(e, ovl, idx);
      return 0;
    },
  },
  0x31: {
    name: "UnmergeBackgroundIncrust",
    args: 2,
    impl(e) {
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      unmergeBackgroundIncrust(e, ovl, obj);
      return 0;
    },
  },
  0x32: {
    name: "freeBackgroundInscrustList",
    args: 0,
    impl(e) {
      freeBackgroundIncrustList(e);
      return 0;
    },
  },
  0x33: {
    name: "DialogOn",
    args: 2,
    impl(e) {
      e.dialogueObj = e.vm.popVar();
      e.dialogueOvl = e.vm.popVar();
      if (e.dialogueOvl === 0) e.dialogueOvl = e.currentScript!.overlayNumber;
      e.dialogueEnabled = true;
      return 0;
    },
  },
  0x34: {
    name: "DialogOff",
    args: 0,
    impl(e) {
      e.dialogueEnabled = false;
      objectReset(e);
      if (e.menuTable[0]) {
        e.menuTable[0] = null;
        e.currentActiveMenu = -1;
      }
      return 0;
    },
  },
  0x38: {
    name: "RemoveBackground",
    args: 1,
    impl(e) {
      const idx = e.vm.popVar();
      const d = e.display;
      if (idx > 0 && idx < 8) {
        d.backgroundScreens[idx] = null;
        if (d.masterScreen === idx) {
          d.masterScreen = 0;
          d.backgroundChanged[0] = true;
        }
        d.backgroundNames[idx] = "";
      } else {
        d.backgroundNames[0] = "";
      }
      return 0;
    },
  },
  0x39: {
    name: "SetActiveBackground",
    args: 1,
    impl(e) {
      const d = e.display;
      const current = d.masterScreen;
      const plane = e.vm.popVar();
      if (plane >= 0 && plane < NBSCREENS && d.backgroundScreens[plane]) {
        d.masterScreen = plane;
        d.backgroundChanged[plane] = true;
        d.switchPal = 1;
      }
      return current;
    },
  },
  0x4d: {
    name: "XMenuItem",
    args: 1,
    impl(e) {
      return menuItem(e, e.vm.popVar(), "x");
    },
  },
  0x4e: {
    name: "YMenuItem",
    args: 1,
    impl(e) {
      return menuItem(e, e.vm.popVar(), "y");
    },
  },
  0x4f: {
    name: "Menu",
    args: 0,
    impl(e) {
      return e.menuTable[0] ? 1 : 0;
    },
  },
  0x53: {
    name: "MsgExist",
    args: 0,
    impl(e) {
      return e.isMessage;
    },
  },
  0x54: {
    name: "SetFont",
    args: 1,
    impl(e) {
      e.fontFileIndex = e.vm.popVar();
      return 0;
    },
  },
  0x56: {
    name: "Display",
    args: 1,
    impl(e) {
      const old = e.displayOn;
      const value = e.vm.popVar();
      if (value !== -1) e.displayOn = value;
      return old;
    },
  },
  0x5b: {
    name: "regenerateBackgroundIncrust",
    args: 0,
    impl(e) {
      regenerateBackgroundIncrust(e);
      return 0;
    },
  },
  0x5c: {
    name: "BgName",
    args: 2,
    impl(e) {
      const p = e.vm.popPtr();
      const idx = e.vm.popVar();
      if (idx >= 0 && idx < NBSCREENS && p) {
        const name = e.display.backgroundNames[idx]!;
        writeCString(p, name);
        return name.length ? 1 : 0;
      }
      return 0;
    },
  },
  0x6a: {
    name: "VBL",
    args: 1,
    impl(e) {
      e.vblLimit = e.vm.popVar();
      return 0;
    },
  },
  0x73: {
    name: "SetXDial",
    args: 1,
    impl(e) {
      const old = e.xdial;
      e.xdial = e.vm.popVar();
      return old;
    },
  },
  0x77: {
    name: "ClearScreen",
    args: 1,
    impl(e) {
      const idx = e.vm.popVar();
      const d = e.display;
      const screen = idx >= 0 && idx < NBSCREENS ? d.backgroundScreens[idx] : null;
      if (screen) {
        screen.fill(0);
        d.backgroundChanged[idx] = true;
        d.backgroundNames[0] = "";
      }
      return 0;
    },
  },
  0x7d: {
    name: "KillMenu",
    args: 0,
    impl(e) {
      killMenus(e);
      return 0;
    },
  },
};
