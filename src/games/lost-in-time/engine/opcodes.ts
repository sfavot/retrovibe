import type { HotspotDef } from "./host";
import type { Resources } from "./resources";
import { Expression, OP_STOP, type Script } from "./script";
import { bytesToString } from "./variables";

/**
 * Décodage statique des instructions (table fusionnée v1 < v2 < v3 de Lost in Time).
 * Le décodage ne lit aucune variable : les expressions et indices de variables sont
 * repérés par leur offset (`ExprRef` / `VarRef`) puis évalués à l'exécution. L'exécution
 * et le désassembleur partagent donc exactement la même lecture des opérandes.
 * Les noms suivent ceux du désassembleur degob (et de ops.txt).
 */

/** Offset du premier octet d'une expression du script. */
export type ExprRef = number;

export interface VarRef {
  pos: number;
  /** Premier octet de l'indice (peut être un préfixe 14 / 15). */
  first: number;
  /** Type de la variable (opération), 14 ou 15 pour un indice préfixé. */
  type: number;
}

/** Opérande « immédiat sur 16 bits ou expression » (copySprite, createSprite). */
export interface LitOrExpr {
  isExpr: boolean;
  value: number;
}

export interface SwitchCaseExpr {
  kind: "i32" | "i16" | "i8" | "expr";
  value: number;
  pos: number;
}

export interface SceneryDecoded {
  index: ExprRef;
  backs: number[];
  picsCount: number;
  resId: number;
  pics: { pictDescId: number; width: number; height: number; sprResId: number }[];
}

export interface DecodedHotspotDef {
  index: number;
  type: number;
  windowNum: number;
  coords: { exprs: ExprRef[] } | { values: number[] };
  funcPos: number;
  key: number;
  id: number;
  flags: number;
  funcEnter: number;
  funcLeave: number;
  input: { keyVar: VarRef; fontIndex: number; backColor: number; frontColor: number; length: number; str: Uint8Array | null } | null;
  enable: "type1" | "type2" | null;
}

export interface DecodedHotspotBlock {
  /** Offset de l'octet de type du bloc. */
  at: number;
  handleMouse: number;
  duration: number;
  leaveWindowIndex: number;
  hotspotIndex1: number;
  hotspotIndex2: number;
  needRecalc: boolean;
  hotspots: DecodedHotspotDef[];
  /** Offset après le dernier bloc enter / leave des zones. */
  next: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Args = any;

export interface Instr {
  /** Offset de l'octet de commande. */
  at: number;
  /** Offset après l'octet de commande (celui que rapporte degob). */
  pos: number;
  /** Offset de l'instruction suivante. */
  next: number;
  name: string;
  /** Code de la commande (i * 16 + j) pour les commandes, ou code de l'opération de dessin / gob. */
  code: number;
  args: Args;
}

export class Decoder {
  readonly ex = new Expression();

  constructor(
    readonly s: Script,
    readonly res: Resources | null,
  ) {
    this.ex.script = s;
  }

  expr(): ExprRef {
    const p = this.s.pos;
    this.ex.skipExpr(OP_STOP);
    return p;
  }

  v(): VarRef {
    const first = this.s.peekU8();
    const pos = this.s.pos;
    this.ex.parseVarIndex(true);
    return { pos, first, type: this.ex.varType };
  }

  litOrExpr(): LitOrExpr {
    if (this.s.peekU8(1) === 0) return { isExpr: false, value: this.s.readI16() };
    return { isExpr: true, value: this.expr() };
  }

  exprs(n: number): ExprRef[] {
    const out: ExprRef[] = [];
    for (let i = 0; i < n; i++) out.push(this.expr());
    return out;
  }
}

type DecodeFn = (d: Decoder) => Args;

interface OpDef {
  name: string;
  decode: DecodeFn;
}

const none: DecodeFn = () => ({});
const e1: DecodeFn = (d) => ({ a: d.expr() });
const e2: DecodeFn = (d) => ({ a: d.expr(), b: d.expr() });

function decodeSwitch(d: Decoder): Args {
  const s = d.s;
  const value = d.v();
  const cases: { exprs: SwitchCaseExpr[]; blockPos: number }[] = [];
  let len = s.readI8();
  while (len !== -5) {
    const exprs: SwitchCaseExpr[] = [];
    for (let i = 0; i < len; i++) {
      const t = s.peekU8();
      const pos = s.pos;
      if (t === 19) {
        s.skip(1);
        exprs.push({ kind: "i32", value: s.peekI32(), pos });
        s.skip(5);
      } else if (t === 20) {
        s.skip(1);
        exprs.push({ kind: "i16", value: s.peekI16(), pos });
        s.skip(3);
      } else if (t === 21) {
        s.skip(1);
        exprs.push({ kind: "i8", value: s.peekI8(), pos });
        s.skip(2);
      } else {
        exprs.push({ kind: "expr", value: 0, pos });
        d.ex.skipExpr(OP_STOP);
      }
    }
    const blockPos = s.pos;
    cases.push({ exprs, blockPos });
    s.skip(s.peekU16(2) + 2);
    len = s.readI8();
  }
  let defaultPos = 0;
  if (s.peekU8() >> 4 === 4) {
    s.skip(1);
    defaultPos = s.pos;
    s.skipBlock();
  }
  return { value, cases, defaultPos };
}

function decodeIf(d: Decoder): Args {
  const s = d.s;
  const cond = d.expr();
  const thenPos = s.pos;
  s.skipBlock();
  const marker = s.readU8();
  let elsePos = 0;
  if (marker >> 4 === 12) {
    elsePos = s.pos;
    s.skipBlock();
  }
  return { cond, thenPos, elsePos };
}

function decodeAssign(d: Decoder): Args {
  const s = d.s;
  const dest = d.v();
  let loop = 1;
  if (s.peekU8() === 99) {
    s.skip(1);
    loop = s.readU8();
  }
  return { dest, loop, srcs: d.exprs(loop) };
}

const TEXT_VAR_TYPES = new Set([16, 17, 18, 23, 24, 25, 26, 27, 28]);

function decodePrintText(d: Decoder): Args {
  const s = d.s;
  const head = d.exprs(5);
  const chunks: { text: Uint8Array; variable: VarRef | null }[] = [];
  do {
    const start = s.pos;
    let n = 0;
    while (n < 59 && s.peekU8() !== 46 && s.peekU8() !== 200) {
      s.skip(1);
      n++;
    }
    const text = s.data.slice(start, start + n);
    let variable: VarRef | null = null;
    if (s.peekU8() !== 200) {
      s.skip(1);
      if (TEXT_VAR_TYPES.has(s.peekU8())) variable = d.v();
      s.skip(1);
    }
    chunks.push({ text, variable });
  } while (s.peekU8() !== 200);
  s.skip(1);
  return { x: head[0], y: head[1], back: head[2], front: head[3], font: head[4], chunks };
}

const PAL_LENGTHS: Record<number, number> = { 48: 48, 49: 18, 50: 16, 51: 2, 52: 48, 53: 2, 55: 2, 56: 2, 61: 4 };

function decodeScenery(d: Decoder, isStatic: boolean): SceneryDecoded {
  const s = d.s;
  const index = d.expr();
  const backs: number[] = [];
  if (isStatic) {
    const size = s.readI16();
    for (let i = 0; i < size; i++) backs.push(s.readI16());
  }
  const picsCount = s.readI16();
  const resId = s.readI16();
  const pics = [];
  for (let i = 0; i < picsCount; i++) {
    pics.push({ pictDescId: s.readI16(), width: s.readI16(), height: s.readI16(), sprResId: s.readI16() });
  }
  return { index, backs, picsCount, resId, pics };
}

function latin(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return bytesToString(end === -1 ? bytes : bytes.subarray(0, end));
}

function decodeLoadMult(d: Decoder): Args {
  const s = d.s;
  const raw = s.readI16() & 0xffff;
  const index = raw & 0x8000 ? s.readU8() : 0;
  const resId = raw & 0x7fff;
  const out = { index, resId, statics: [] as SceneryDecoded[], anims: [] as SceneryDecoded[], soundKeys: [] as Args[], imds: null as Args };
  const res = d.res?.getResource(resId);
  if (!res) return out;
  const data = res.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const i16At = (o: number): number => (o + 2 <= data.length ? view.getInt16(o, true) : 0);
  let staticCount = ((data[0] << 24) >> 24) + 1;
  let animCount = (((data[1] << 24) >> 24) + 1) & 0xff;
  staticCount &= 0xff;
  const hasImds = (staticCount & 0x80) !== 0;
  staticCount &= 0x7f;
  for (let i = 0; i < staticCount; i++) out.statics.push(decodeScenery(d, true));
  for (let i = 0; i < animCount; i++) out.anims.push(decodeScenery(d, false));
  animCount &= 0xff;

  let dp = 2 + 14 * (staticCount + animCount) + 2;
  let n = i16At(dp);
  dp += 2 + n * 4;
  for (let i = 0; i < 4; i++) {
    n = i16At(dp);
    dp += 2 + n * 10;
  }
  dp += 5 * 16 * 3;
  n = i16At(dp);
  dp += 2 + n * 7;
  n = i16At(dp);
  dp += 2 + n * 80;
  n = i16At(dp);
  dp += 2 + n * (4 + (hasImds ? 0 : 24));
  n = i16At(dp);
  dp += 2;
  const resIds: number[] = [];
  for (let i = 0; i < n; i++) {
    const cmd = i16At(dp + 2);
    resIds[i] = -1;
    if (cmd === 1 || cmd === 4) {
      const resKey = (s.peekU16() << 16) >> 16;
      resIds[i] = resKey;
      let dup = false;
      for (let j = 0; j < i; j++) {
        if (resIds[j] === resKey) {
          dup = true;
          break;
        }
      }
      if (dup) {
        s.skip(2);
        out.soundKeys.push({ keyIndex: i, duplicate: true, id: resKey, name: null });
      } else {
        const id = s.readI16();
        const name = id === -1 ? latin(s.readBytes(9)) : null;
        out.soundKeys.push({ keyIndex: i, duplicate: false, id, name });
      }
    } else if (cmd === 3) {
      s.skip(4);
    }
    dp += 12 + (hasImds ? 0 : 24);
  }
  if (hasImds) {
    const words = s.readI16();
    const execPos = s.pos;
    s.skip(words * 2);
    let files: Uint8Array | null = null;
    if (s.versionMinor >= 3) {
      const count = s.readI16();
      if (count > 0) files = s.readBytes(count * 14).slice();
    }
    out.imds = { execPos, execWords: words, files };
  }
  return out;
}

function decodeLoadSound(d: Decoder): Args {
  const slot = d.expr();
  const id = d.s.readI16();
  const name = id === -1 ? latin(d.s.readBytes(9)) : null;
  return { slot, id, name };
}

function decodeHotspotDefs(d: Decoder, count: number): DecodedHotspotDef[] {
  const s = d.s;
  const out: DecodedHotspotDef[] = [];
  for (let i = 0; i < count; i++) {
    let type = s.readU8();
    let windowNum = 0;
    if (type & 0x40) {
      type -= 0x40;
      windowNum = s.readU8();
    }
    let funcPos = 0;
    let coords: DecodedHotspotDef["coords"];
    if (type & 0x80) {
      funcPos = s.pos;
      coords = { exprs: d.exprs(4) };
    } else {
      coords = { values: [s.readU16(), s.readU16(), s.readU16(), s.readU16()] };
    }
    type &= 0x7f;
    const def: DecodedHotspotDef = {
      index: i, type, windowNum, coords, funcPos, key: 0, id: 0, flags: 0, funcEnter: 0, funcLeave: 0, input: null, enable: null,
    };
    out.push(def);

    if (type === 11 || type === 12) {
      def.enable = type === 11 ? "type2" : "type1";
      s.skip(6);
      def.funcEnter = def.funcLeave = s.pos;
      s.skipBlock();
      continue;
    }
    switch (type) {
      case 0:
        s.skip(6);
        def.funcEnter = s.pos;
        s.skipBlock();
        def.funcLeave = s.pos;
        s.skipBlock();
        def.key = i + ((8 | 2) << 12);
        def.flags = type + (windowNum << 8);
        break;
      case 1: {
        def.key = s.readI16();
        def.id = s.readI16();
        const f = s.readI16();
        def.funcEnter = s.pos;
        s.skipBlock();
        def.funcLeave = s.pos;
        s.skipBlock();
        if (def.key === 0) def.key = i + ((8 | 2) << 12);
        def.flags = type + (windowNum << 8) + (f << 4);
        break;
      }
      case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: {
        const keyVar = d.v();
        const fontIndex = s.readI16();
        const backColor = s.readU8();
        const frontColor = s.readU8();
        let length = 0;
        let str: Uint8Array | null = null;
        if (type >= 5 && type <= 8) {
          length = s.readU16();
          str = s.readBytes(length);
        }
        def.input = { keyVar, fontIndex, backColor, frontColor, length, str };
        const left = coords && "values" in coords ? coords.values[0] : 0;
        if ("values" in coords && left === 0xffff) {
          if (!(type & 1)) s.skipBlock();
          break;
        }
        if (!(type & 1)) {
          def.funcLeave = s.pos;
          s.skipBlock();
        }
        def.flags = type;
        break;
      }
      case 20:
      case 2: {
        def.key = s.readI16();
        def.id = s.readI16();
        const f = s.readI16();
        def.funcLeave = s.pos;
        s.skipBlock();
        def.flags = 2 + (windowNum << 8) + (f << 4);
        break;
      }
      case 21: {
        def.key = s.readI16();
        def.id = s.readI16();
        const f = s.readI16() & 3;
        def.funcEnter = s.pos;
        s.skipBlock();
        def.flags = 2 + (windowNum << 8) + (f << 4);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Bloc de type 2 : zones de la souris. `s.pos` doit être à l'octet de type. */
export function decodeHotspotBlock(d: Decoder): DecodedHotspotBlock {
  const s = d.s;
  const at = s.pos;
  s.skip(1);
  const count = s.readU8();
  const block = {
    at,
    handleMouse: s.peekU8(0),
    duration: s.peekU8(1),
    leaveWindowIndex: s.peekU8(2),
    hotspotIndex1: s.peekU8(3),
    hotspotIndex2: s.peekU8(4),
    needRecalc: s.peekU8(5) !== 0,
  };
  s.skip(6);
  const hotspots = decodeHotspotDefs(d, count);
  return { ...block, hotspots, next: s.pos };
}

export type { HotspotDef };

// --- Tables ---------------------------------------------------------------------------------

const FUNC: Record<number, OpDef> = {
  0x00: { name: "o1_callSub", decode: (d) => ({ offset: d.s.readU16() }) },
  0x01: { name: "o1_callSub", decode: (d) => ({ offset: d.s.readU16() }) },
  0x02: { name: "o1_printTotText", decode: (d) => ({ id: d.s.readI16() }) },
  0x03: { name: "o1_loadCursor", decode: (d) => ({ id: d.s.readI16(), index: d.s.readI8() }) },
  0x05: { name: "o1_switch", decode: decodeSwitch },
  0x06: {
    name: "o1_repeatUntil",
    decode: (d) => {
      const blockPos = d.s.pos;
      d.s.pos = blockPos + d.s.peekU16(2) + 2 + 1;
      const condPos = d.expr();
      return { blockPos, condPos };
    },
  },
  0x07: {
    name: "o1_whileDo",
    decode: (d) => {
      const condPos = d.expr();
      const blockPos = d.s.pos;
      const size = d.s.peekU16(2) + 2;
      d.s.skip(size);
      return { condPos, blockPos, size };
    },
  },
  0x08: { name: "o1_if", decode: decodeIf },
  0x09: { name: "o2_assign", decode: decodeAssign },
  0x0a: {
    name: "o1_loadSpriteToPos",
    decode: (d) => {
      const spriteLeft = d.s.readI16();
      const x = d.expr();
      const y = d.expr();
      const flags = d.s.peekU8();
      d.s.skip(2);
      return { spriteLeft, x, y, flags };
    },
  },
  0x11: { name: "o2_printText", decode: decodePrintText },
  0x12: {
    name: "o1_loadTot",
    decode: (d) => {
      if (d.s.peekU8() & 0x80) {
        d.s.skip(1);
        return { expr: d.expr(), name: null };
      }
      const size = d.s.readU8();
      return { expr: 0, name: bytesToString(d.s.readBytes(size)) };
    },
  },
  0x13: {
    name: "o1_palLoad",
    decode: (d) => {
      const cmd = d.s.readU8();
      return { cmd: cmd & 0x7f, applyNow: !(cmd & 0x80), data: d.s.readBytes(PAL_LENGTHS[cmd & 0x7f] ?? 0).slice() };
    },
  },
  0x14: { name: "o1_keyFunc", decode: (d) => ({ cmd: d.s.readI16() }) },
  0x15: { name: "o1_capturePush", decode: (d) => ({ e: d.exprs(4) }) },
  0x16: { name: "o1_capturePop", decode: none },
  0x17: {
    name: "o2_animPalInit",
    decode: (d) => ({ index: d.s.readI16(), e: d.exprs(2) }),
  },
  0x18: {
    name: "o2_addHotspot",
    decode: (d) => {
      const id = d.expr();
      const funcPos = d.s.pos;
      const e = d.exprs(5);
      return { id, funcPos, left: e[0], top: e[1], width: e[2], height: e[3], flags: e[4], key: d.s.readI16() };
    },
  },
  0x19: { name: "o2_removeHotspot", decode: e1 },
  0x1a: {
    name: "o3_getTotTextItemPart",
    decode: (d) => ({ item: d.s.readI16(), stringVar: d.v(), part: d.expr() }),
  },
  0x1f: { name: "o1_setcmdCount", decode: (d) => ({ count: d.s.readU8() }) },
  0x20: { name: "o1_return", decode: none },
  0x21: { name: "o1_renewTimeInVars", decode: none },
  0x22: { name: "o1_speakerOn", decode: e1 },
  0x23: { name: "o1_speakerOff", decode: none },
  0x24: {
    name: "o1_putPixel",
    decode: (d) => ({ surface: d.s.readI16(), e: d.exprs(3) }),
  },
  0x26: {
    name: "o2_createSprite",
    decode: (d) => {
      const lit = d.s.peekU8(1) === 0;
      const v = lit ? [d.s.readI16(), d.s.readI16(), d.s.readI16()] : d.exprs(3);
      return { lit, v, flag: d.s.readI16() };
    },
  },
  0x27: { name: "o1_freeSprite", decode: (d) => ({ index: d.s.readI16() }) },
  0x30: { name: "o1_returnTo", decode: none },
  0x31: {
    name: "o1_loadSpriteContent",
    decode: (d) => ({ spriteLeft: d.s.readI16(), destSurface: d.s.readI16(), transparency: d.s.readI16() }),
  },
  0x32: {
    name: "o3_copySprite",
    decode: (d) => {
      const src = d.litOrExpr();
      const dest = d.litOrExpr();
      const e = d.exprs(6);
      return { src, dest, e, transparency: d.s.readI16() };
    },
  },
  0x33: { name: "o1_fillRect", decode: (d) => ({ surface: d.s.readI16(), e: d.exprs(5) }) },
  0x34: { name: "o1_drawLine", decode: (d) => ({ surface: d.s.readI16(), e: d.exprs(5) }) },
  0x35: { name: "o1_strToLong", decode: (d) => ({ str: d.v(), dest: d.v() }) },
  0x36: { name: "o1_invalidate", decode: (d) => ({ surface: d.s.readI16(), e: d.exprs(4) }) },
  0x37: { name: "o1_setBackDelta", decode: e2 },
  0x38: { name: "o1_playSound", decode: (d) => ({ e: d.exprs(3) }) },
  0x39: { name: "o2_stopSound", decode: e1 },
  0x3a: { name: "o2_loadSound", decode: decodeLoadSound },
  0x3b: { name: "o1_freeSoundSlot", decode: e1 },
  0x3c: { name: "o1_waitEndPlay", decode: none },
  0x3d: { name: "o1_playComposition", decode: (d) => ({ dataVar: d.v(), freq: d.expr() }) },
  0x3e: { name: "o2_getFreeMem", decode: (d) => ({ free: d.v(), maxFree: d.v() }) },
  0x3f: { name: "o2_checkData", decode: (d) => ({ file: d.expr(), dest: d.v() }) },
  0x41: { name: "o1_cleanupStr", decode: (d) => ({ str: d.v() }) },
  0x42: { name: "o1_insertStr", decode: (d) => ({ str: d.v(), text: d.expr(), pos: d.expr() }) },
  0x43: { name: "o1_cutStr", decode: (d) => ({ str: d.v(), pos: d.expr(), size: d.expr() }) },
  0x44: { name: "o1_strstr", decode: (d) => ({ str: d.v(), needle: d.expr(), res: d.v() }) },
  0x45: { name: "o1_istrlen", decode: (d) => ({ str: d.v(), dest: d.v() }) },
  0x46: { name: "o1_setMousePos", decode: e2 },
  0x47: { name: "o1_setFrameRate", decode: e1 },
  0x48: { name: "o1_animatePalette", decode: none },
  0x49: { name: "o1_animateCursor", decode: none },
  0x4a: { name: "o1_blitCursor", decode: none },
  0x4b: { name: "o1_loadFont", decode: (d) => ({ file: d.expr(), index: d.s.readU16() }) },
  0x4c: { name: "o1_freeFont", decode: (d) => ({ index: d.s.readI16() }) },
  0x4d: { name: "o2_readData", decode: (d) => ({ file: d.expr(), dataVar: d.v(), size: d.expr(), offset: d.expr() }) },
  0x4e: { name: "o2_writeData", decode: (d) => ({ file: d.expr(), dataVar: d.v(), size: d.expr(), offset: d.expr() }) },
  0x4f: { name: "o1_manageDataFile", decode: e1 },
};

const DRAW: Record<number, OpDef> = {
  0x00: { name: "o2_loadMult", decode: decodeLoadMult },
  0x01: { name: "o2_playMult", decode: (d) => ({ checkEscape: d.s.readI16() }) },
  0x02: { name: "o2_freeMultKeys", decode: (d) => ({ index: d.s.readU16() }) },
  0x07: {
    name: "o1_initCursor",
    decode: (d) => ({ hx: d.v(), hy: d.v(), width: d.s.readI16(), height: d.s.readI16(), count: d.s.readI16() }),
  },
  0x08: {
    name: "o1_initCursorAnim",
    decode: (d) => ({ index: d.expr(), low: d.s.readI16(), high: d.s.readI16(), delay: d.s.readI16() }),
  },
  0x09: { name: "o1_clearCursorAnim", decode: e1 },
  0x0a: { name: "o2_setRenderFlags", decode: e1 },
  0x10: { name: "o1_loadAnim", decode: (d) => decodeScenery(d, false) },
  0x11: { name: "o1_freeAnim", decode: e1 },
  0x12: { name: "o1_updateAnim", decode: (d) => ({ e: d.exprs(5), flags: d.s.readI16() }) },
  0x13: { name: "o2_multSub", decode: (d) => ({ e: d.exprs(5) }) },
  0x14: {
    name: "o2_initMult",
    decode: (d) => ({
      left: d.s.readI16(), top: d.s.readI16(), width: d.s.readI16(), height: d.s.readI16(), objCount: d.s.readI16(),
      posX: d.v(), posY: d.v(), animData: d.v(),
    }),
  },
  0x15: { name: "o1_freeMult", decode: none },
  0x16: { name: "o1_animate", decode: none },
  0x17: {
    name: "o2_loadMultObject",
    decode: (d) => {
      const head = d.exprs(3);
      const data: (ExprRef | null)[] = [];
      for (let i = 0; i < 11; i++) {
        if (d.s.peekU8() !== 99) data.push(d.expr());
        else {
          d.s.skip(1);
          data.push(null);
        }
      }
      return { obj: head[0], x: head[1], y: head[2], data };
    },
  },
  0x18: { name: "o1_getAnimLayerInfo", decode: (d) => ({ anim: d.expr(), layer: d.expr(), v: [d.v(), d.v(), d.v(), d.v()] }) },
  0x19: { name: "o1_getObjAnimSize", decode: (d) => ({ obj: d.expr(), v: [d.v(), d.v(), d.v(), d.v()] }) },
  0x1a: { name: "o1_loadStatic", decode: (d) => decodeScenery(d, true) },
  0x1b: { name: "o1_freeStatic", decode: e1 },
  0x1c: { name: "o2_renderStatic", decode: e2 },
  0x1d: { name: "o2_loadCurLayer", decode: e2 },
  0x20: { name: "o2_playCDTrack", decode: e1 },
  0x21: { name: "o2_waitCDTrackEnd", decode: none },
  0x22: { name: "o2_stopCD", decode: none },
  0x23: { name: "o2_readLIC", decode: e1 },
  0x24: { name: "o2_freeLIC", decode: none },
  0x25: { name: "o2_getCDTrackPos", decode: (d) => ({ pos: d.v(), name: d.v() }) },
  0x30: {
    name: "o2_loadFontToSprite",
    decode: (d) => {
      const index = d.s.readI16();
      const v: number[] = [];
      for (let i = 0; i < 4; i++) {
        v.push(d.s.readU8());
        d.s.skip(1);
      }
      return { index, sprite: v[0], base: v[1], width: v[2], height: v[3] };
    },
  },
  0x31: { name: "o1_freeFontToSprite", decode: (d) => ({ index: d.s.readI16() }) },
  0x40: {
    name: "o2_totSub",
    decode: (d) => {
      const length = d.s.readU8();
      let nameExpr = 0;
      let name: string | null = null;
      if (length & 0x80) nameExpr = d.expr();
      else name = bytesToString(d.s.readBytes(length));
      return { length, nameExpr, name, flags: d.s.readU8() };
    },
  },
  0x41: { name: "o2_switchTotSub", decode: (d) => ({ index: d.s.readI16(), func: d.s.readI16() }) },
  0x42: {
    name: "o2_pushVars",
    decode: (d) => {
      const count = d.s.readU8();
      const items: { v: VarRef | null; e: ExprRef }[] = [];
      for (let i = 0; i < count; i++) {
        const t = d.s.peekU8();
        if (t === 25 || t === 28) {
          const v = d.v();
          d.s.skip(1);
          items.push({ v, e: 0 });
        } else items.push({ v: null, e: d.expr() });
      }
      return { items };
    },
  },
  0x43: {
    name: "o2_popVars",
    decode: (d) => {
      const count = d.s.readU8();
      const vars: VarRef[] = [];
      for (let i = 0; i < count; i++) vars.push(d.v());
      return { vars };
    },
  },
  0x50: {
    name: "o2_loadMapObjects",
    decode: (d) => {
      const v = d.v();
      const id = d.s.readI16();
      const sounds: Args[] = [];
      if ((id & 0xffff) < 65520) {
        const n = d.s.readI16();
        for (let i = 0; i < n; i++) {
          const sid = d.s.readI16();
          sounds.push({ id: sid, name: sid === -1 ? latin(d.s.readBytes(9)) : null });
        }
      }
      return { v, id, sounds };
    },
  },
  0x51: { name: "o2_freeGoblins", decode: none },
  0x52: { name: "o2_moveGoblin", decode: (d) => ({ e: d.exprs(3) }) },
  0x53: { name: "o2_writeGoblinPos", decode: (d) => ({ x: d.v(), y: d.v(), index: d.expr() }) },
  0x54: { name: "o2_stopGoblin", decode: e1 },
  0x55: { name: "o2_setGoblinState", decode: (d) => ({ e: d.exprs(3) }) },
  0x56: { name: "o2_placeGoblin", decode: (d) => ({ e: d.exprs(4) }) },
  0x80: {
    name: "o2_initScreen",
    decode: (d) => ({ mode: d.s.readI16(), width: d.expr(), height: d.expr() }),
  },
  0x81: { name: "o2_scroll", decode: (d) => ({ e: d.exprs(6) }) },
  0x82: { name: "o2_setScrollOffset", decode: e2 },
  0x83: { name: "o2_playImd", decode: (d) => ({ name: d.expr(), e: d.exprs(8) }) },
  0x84: { name: "o2_getImdInfo", decode: (d) => ({ name: d.expr(), v: [d.v(), d.v(), d.v(), d.v(), d.v()] }) },
  0x85: { name: "o2_openItk", decode: e1 },
  0x86: { name: "o2_closeItk", decode: none },
  0x87: { name: "o2_setImdFrontSurf", decode: none },
  0x88: { name: "o2_resetImdFrontSurf", decode: none },
};

const GOB: Record<number, OpDef> = {
  0: { name: "o2_loadInfogramesIns", decode: (d) => ({ varName: d.s.readI16() }) },
  1: { name: "o2_startInfogrames", decode: (d) => ({ unused: d.s.readI16() }) },
  2: { name: "o2_stopInfogrames", decode: (d) => ({ unused: d.s.readI16() }) },
  10: { name: "o2_playInfogrames", decode: (d) => ({ varName: d.s.readI16() }) },
  100: { name: "o3_wobble", decode: none },
};

function decodeGoblinFunc(d: Decoder): Args {
  const cmd = d.s.readI16();
  const paramCount = d.s.readI16();
  if (cmd === 101) return { cmd, paramCount, sub: null, subArgs: null };
  const def = GOB[cmd];
  if (!def) d.s.fail(`opcode gob inconnu ${cmd}`);
  return { cmd, paramCount, sub: def.name, subArgs: def.decode(d) };
}

FUNC[0x25] = { name: "o2_goblinFunc", decode: decodeGoblinFunc };

/** Commandes que degob n'imprime pas sous la forme `o?_nom(...)` (flux de contrôle, push / pop). */
export const CONTROL_FLOW_NAMES = new Set([
  "o1_callSub", "o1_switch", "o1_repeatUntil", "o1_whileDo", "o1_if", "o2_assign",
  "o1_return", "o1_returnTo", "o1_setcmdCount", "o1_drawOperations", "o2_pushVars", "o2_popVars",
]);

/** Octet de commande -> (i, j) puis numéro dans la table de fonctions. */
export function splitCommand(cmd: number): number {
  let i = 0;
  let j = cmd;
  if (cmd >> 4 >= 12) {
    i = 16 - (cmd >> 4);
    j = cmd & 0xf;
  } else j = cmd >> 4;
  return i * 16 + j;
}

/**
 * Décode l'instruction à `at`. Le résultat est mis en cache dans le script (immuable).
 * Lève une erreur avec le nom du TOT et l'offset pour une commande inconnue.
 */
export function decodeInstr(script: Script, res: Resources | null, at: number): Instr {
  const cached = script.decoded.get(at) as Instr | undefined;
  if (cached) return cached;
  const savedPos = script.pos;
  const savedFinished = script.finished;
  try {
    script.pos = at;
    const d = new Decoder(script, res);
    const cmd = script.readU8();
    const code = splitCommand(cmd);
    const pos = script.pos;
    let instr: Instr;
    if (code === 0x1e) {
      const sub = script.readU8();
      const def = DRAW[sub];
      if (!def) script.fail(`opcode de dessin inconnu 0x${sub.toString(16)}`, pos);
      const args = def.decode(d);
      instr = { at, pos, next: script.pos, name: def.name, code: 0x1e00 | sub, args };
    } else {
      const def = code < 0x50 ? FUNC[code] : undefined;
      if (!def) script.fail(`opcode inconnu ${code >> 4}.${code & 15} (octet 0x${cmd.toString(16)})`, at);
      const args = def.decode(d);
      instr = { at, pos, next: script.pos, name: def.name, code, args };
    }
    script.decoded.set(at, instr);
    return instr;
  } finally {
    script.pos = savedPos;
    script.finished = savedFinished;
  }
}

/** Décode un bloc de zones (type 2) à l'offset `at`, avec cache. */
export function decodeBlock2(script: Script, res: Resources | null, at: number): DecodedHotspotBlock {
  const key = -at - 1;
  const cached = script.decoded.get(key) as DecodedHotspotBlock | undefined;
  if (cached) return cached;
  const savedPos = script.pos;
  const savedFinished = script.finished;
  try {
    script.pos = at;
    const block = decodeHotspotBlock(new Decoder(script, res));
    script.decoded.set(key, block);
    return block;
  } finally {
    script.pos = savedPos;
    script.finished = savedFinished;
  }
}

// --- Désassemblage -------------------------------------------------------------------------

export interface DisasmOp {
  offset: number;
  name: string;
}

/**
 * Parcourt toutes les fonctions atteignables d'un script (entrées de l'en-tête, appels,
 * fonctions des zones) comme le fait degob, et liste les commandes (offset après l'octet de commande, nom).
 */
export function disassemble(script: Script, res: Resources | null, problems: string[] = []): DisasmOp[] {
  const ops: DisasmOp[] = [];
  const queue: number[] = [];
  const seen = new Set<number>();
  const enqueue = (offset: number): void => {
    if (offset >= 128 && offset !== 0xffff && !seen.has(offset)) {
      seen.add(offset);
      queue.push(offset);
    }
  };
  for (const f of script.header.functions) enqueue(f);

  const block = (start: number): void => {
    let pos = start + 1;
    let cmdCount = script.data[pos++];
    const blockEnd = start + 2 + (script.data[start + 2] | (script.data[start + 3] << 8));
    pos += 2;
    let counter = 0;
    if (cmdCount === 0) return;
    do {
      const ins = decodeInstr(script, res, pos);
      counter++;
      ops.push({ offset: ins.pos, name: ins.name });
      const a = ins.args;
      switch (ins.name) {
        case "o1_callSub": {
          const t = a.offset;
          const type = script.data[t];
          if (type === 1) enqueue(t);
          else if (type === 2) {
            const b = decodeBlock2(script, res, t);
            for (const h of b.hotspots) {
              if (h.input || h.enable) continue;
              if (h.funcEnter) enqueue(h.funcEnter);
              if (h.funcLeave) enqueue(h.funcLeave);
            }
          }
          break;
        }
        case "o1_switch":
          for (const c of a.cases) block(c.blockPos);
          if (a.defaultPos) block(a.defaultPos);
          break;
        case "o1_repeatUntil":
        case "o1_whileDo":
          block(a.blockPos);
          break;
        case "o1_if":
          block(a.thenPos);
          if (a.elsePos) block(a.elsePos);
          break;
        case "o1_setcmdCount":
          cmdCount = a.count;
          counter = 0;
          break;
        default:
          break;
      }
      pos = ins.next;
    } while (counter !== cmdCount);
    if (pos !== blockEnd) problems.push(`bloc @${start} : fin à ${pos}, attendue ${blockEnd}`);
  };

  for (let i = 0; i < queue.length; i++) block(queue[i]);
  return ops;
}
