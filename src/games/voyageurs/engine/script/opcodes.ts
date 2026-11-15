/**
 * Table des opcodes de *Future Wars* (78 entrées définies sur 0x00 à 0x7B).
 *
 * Référence : ScummVM engines/cine/script_fw.cpp (`FWScript::setupTable`, `o1_*`, `checkCollisionFW`, `getZoneFromPositionRaw`,
 * `compareVars`), object.cpp (`compareObjectParam`) (GPL v3 ou ultérieure). docs/voyageurs/engine.md § 2.2.
 *
 * Les opcodes ne connaissent que `VmContext` : l'état (`EngineState`) et les services du moteur (chargements, hasard, souris, son, rendu).
 *
 * Rustines de ScummVM reprises (D7, D8) : toute comparaison de la globale 255 à une valeur immédiate répond « égal » (protection, bogue
 * #3866) ; un point de collision hors de 320 × 200 est en zone 0 (#4581) ; la musique CD passe par `VmContext` (le pilote CD est la vague A).
 * Rustines ignorées : celles des versions Amiga / Atari ST (`CODE2.PRC`, double `break`) et d'Opération Stealth.
 *
 * Écarts volontaires : une division par zéro (plantage dans l'original) laisse la valeur inchangée ; `loadVar` d'un type inconnu
 * (`error` de ScummVM) lève `VmError` ; `setScreenDimensions`, `displayBackground`, `op71` à `op73` ne font que lire leurs arguments,
 * comme dans ScummVM sur PC.
 */

import {
  addMessage,
  addObjectParam,
  addOverlay,
  Cmp,
  compareValues,
  type EngineState,
  freeAnimDataRange,
  getObjectParam,
  modifyObjectParam,
  NUM_MAX_ZONE,
  OverlayType,
  removeOverlay,
  setupObject,
  subObjectParam,
  toI16,
  VAR_COPY_PROTECTION,
} from "../state";
import { type OpcodeInfo, type OpcodeTable, type OpResult, type ScriptInstance, VmError } from "./vm";

/** Services du moteur dont les opcodes ont besoin. */
export interface VmContext {
  readonly state: EngineState;
  /** `getRandomNumber(max)` (inclusif, 32 bits non signé). */
  random(max: number): number;
  /** Position courante de la souris (`getMouseData`). */
  mousePosition(): { x: number; y: number };
  /** Tailles de l'entrée `index` du bundle courant (`_partBuffer[index]`), 0 si absente. */
  partEntrySize(index: number, packed: boolean): number;
  startGlobalScript(index: number): void;
  /** Marque toutes les instances globales d'index `index` (retirées à leur prochain passage). */
  endGlobalScript(index: number): void;
  /** `loadResource` dans le premier emplacement libre. */
  loadResource(name: string): void;
  loadBg(name: string): void;
  loadCt(name: string): void;
  loadPart(name: string): void;
  addToBgList(objIdx: number, filled: boolean): void;
  /** Rustine anti-flash de `o1_blitAndFade` : palette affichée mise au noir avant le fondu d'ouverture. */
  setBlackPalette(): void;
  transformPalette(first: number, last: number, r: number, g: number, b: number): void;
  rotatePalette(a: number, b: number, c: number): void;
  loadMusic(name: string): void;
  playMusic(): void;
  fadeOutMusic(): void;
  stopMusic(): void;
  /** `playSample` DOS : `play` vrai pour une taille 0xFFFF, sinon arrêt du canal. */
  playSample(anim: number, channel: number, volume: number, play: boolean): void;
}

type Handler = (vm: ScriptInstance, ctx: VmContext) => OpResult;

function op(name: string, args: string, run: Handler): OpcodeInfo<VmContext> {
  return { name, args, run };
}

/** Arithmétique sur une locale (`addVar`… `divVar`) : un type d'opérande autre que 0, 1, 2 lit l'index et ne fait rien. */
function varOp(name: string, apply: (a: number, b: number) => number | null): OpcodeInfo<VmContext> {
  return op(name, "bc", (vm, ctx) => {
    const varIdx = vm.byte();
    const type = vm.byte();
    let value: number;
    if (type === 0) value = vm.sword();
    else {
      const index = vm.byte();
      if (type === 1) value = vm.locals[index]!;
      else if (type === 2) value = ctx.state.globals[index]!;
      else return 0;
    }
    const result = apply(vm.locals[varIdx]!, value);
    if (result !== null) vm.locals[varIdx] = result;
    return 0;
  });
}

function div(a: number, b: number): number | null {
  return b === 0 ? null : Math.trunc(a / b);
}

function gotoIf(name: string, test: (compare: number) => boolean): OpcodeInfo<VmContext> {
  return op(name, "b", (vm) => {
    const label = vm.byte();
    if (test(vm.compare)) vm.jump(label);
    return 0;
  });
}

function overlayOp(name: string, type: number, add: boolean): OpcodeInfo<VmContext> {
  return op(name, "b", (vm, ctx) => {
    const objIdx = vm.byte();
    if (add) addOverlay(ctx.state, objIdx, type);
    else removeOverlay(ctx.state, objIdx, type);
    return 0;
  });
}

/** `getZoneFromPositionRaw` (FW) : zone 0 hors de l'écran. */
function zoneAt(state: EngineState, x: number, y: number): number {
  if (x < 0 || x >= 320 || y < 0 || y >= 200) return 0;
  return state.collision[y * 320 + x]! & 0xf;
}

/** `checkCollisionFW` : un pixel de la ligne (x + dx … + n, y + dy) dont la zone remappée vaut `zone`. */
export function checkCollision(state: EngineState, objIdx: number, dx: number, dy: number, count: number, zone: number): number {
  const obj = state.objects[objIdx]!;
  let lx = toI16(obj.x + dx);
  const ly = toI16(obj.y + dy);
  for (let i = 0; i < count; i++, lx = toI16(lx + 1)) {
    const idx = zoneAt(state, lx, ly);
    if (idx < NUM_MAX_ZONE && state.zoneData[idx] === toI16(zone)) return 1;
  }
  return 0;
}

function playSample(vm: ScriptInstance, ctx: VmContext): OpResult {
  const anim = vm.byte();
  let channel = vm.byte();
  vm.word(); // fréquence
  vm.byte(); // répétition
  let volume = vm.sword();
  const size = vm.word();
  if (!ctx.state.anims[anim]) return 0;
  if (volume > 63 || volume < 0) volume = 63;
  if (channel >= 10) channel -= 10;
  if (volume < 50) volume = 50;
  // Version CD : la musique n'est pas coupée (`stopMusic` réservé aux versions disquette).
  ctx.playSample(anim, channel, volume, size === 0xffff);
  return 0;
}

const N = null;

/** Table FW, indexée par `octet - 1`. */
export const FW_OPCODES: OpcodeTable<VmContext> = [
  /* 00 */
  op("modifyObjectParam", "bbw", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    modifyObjectParam(ctx.state, o, p, vm.sword());
    return 0;
  }),
  op("getObjectParam", "bbb", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    vm.locals[vm.byte()] = getObjectParam(ctx.state, o, p);
    return 0;
  }),
  op("addObjectParam", "bbw", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    addObjectParam(ctx.state, o, p, vm.sword());
    return 0;
  }),
  op("subObjectParam", "bbw", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    subObjectParam(ctx.state, o, p, vm.sword());
    return 0;
  }),
  /* 04 */
  op("mulObjectParam", "bbw", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    const value = vm.sword();
    modifyObjectParam(ctx.state, o, p, Math.imul(getObjectParam(ctx.state, o, p), value));
    return 0;
  }),
  op("divObjectParam", "bbw", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    const value = vm.sword();
    const result = div(getObjectParam(ctx.state, o, p), value);
    if (result !== null) modifyObjectParam(ctx.state, o, p, result);
    return 0;
  }),
  op("compareObjectParam", "bbw", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    vm.compare = compareValues(getObjectParam(ctx.state, o, p), vm.sword());
    return 0;
  }),
  op("setupObject", "bwwww", (vm, ctx) => {
    const o = vm.byte();
    const x = vm.word();
    const y = vm.word();
    const mask = vm.word();
    setupObject(ctx.state, o, x, y, mask, vm.word());
    return 0;
  }),
  /* 08 */
  op("checkCollision", "bwwww", (vm, ctx) => {
    const o = vm.byte();
    const dx = vm.sword();
    const dy = vm.sword();
    const count = vm.sword();
    vm.compare = checkCollision(ctx.state, o, dx, dy, count, vm.sword());
    return 0;
  }),
  op("loadVar", "bc", (vm, ctx) => {
    const varIdx = vm.byte();
    const type = vm.byte();
    if (type === 0) {
      vm.locals[varIdx] = vm.sword();
      return 0;
    }
    const index = vm.byte();
    switch (type) {
      case 1:
        vm.locals[varIdx] = vm.locals[index]!;
        break;
      case 2:
        vm.locals[varIdx] = ctx.state.globals[index]!;
        break;
      case 3:
        vm.locals[varIdx] = ctx.mousePosition().x;
        break;
      case 4:
        vm.locals[varIdx] = ctx.mousePosition().y;
        break;
      case 5:
        // `getRandomNumber(n - 1)` : n = 0 demande le tirage brut 32 bits (tronqué à 16 bits).
        vm.locals[varIdx] = ctx.random((index - 1) >>> 0);
        break;
      case 8:
        vm.locals[varIdx] = ctx.partEntrySize(index, true);
        break;
      case 9:
        vm.locals[varIdx] = ctx.partEntrySize(index, false);
        break;
      default:
        throw new VmError(`loadVar : type ${type} inconnu (script ${vm.index}, position ${vm.line})`);
    }
    return 0;
  }),
  varOp("addVar", (a, b) => a + b),
  varOp("subVar", (a, b) => a - b),
  /* 0C */
  varOp("mulVar", (a, b) => Math.imul(a, b)),
  varOp("divVar", div),
  op("compareVar", "bc", (vm, ctx) => {
    const varIdx = vm.byte();
    const type = vm.byte();
    if (type === 0) vm.compare = compareValues(vm.locals[varIdx]!, vm.sword());
    else {
      const index = vm.byte();
      if (type === 1) vm.compare = compareValues(vm.locals[varIdx]!, vm.locals[index]!);
      else if (type === 2) vm.compare = compareValues(vm.locals[varIdx]!, ctx.state.globals[index]!);
    }
    return 0;
  }),
  op("modifyObjectParam2", "bbb", (vm, ctx) => {
    const o = vm.byte();
    const p = vm.byte();
    modifyObjectParam(ctx.state, o, p, vm.locals[vm.byte()]!);
    return 0;
  }),
  /* 10 */
  N,
  N,
  N,
  overlayOp("loadMask0", OverlayType.Sprite, true),
  /* 14 */
  overlayOp("unloadMask0", OverlayType.Sprite, false),
  op("addToBgList", "b", (vm, ctx) => {
    ctx.addToBgList(vm.byte(), false);
    return 0;
  }),
  overlayOp("loadMask1", OverlayType.ClickMask, true),
  overlayOp("unloadMask1", OverlayType.ClickMask, false),
  /* 18 */
  overlayOp("loadMask4", OverlayType.FilledMask, true),
  overlayOp("unloadMask4", OverlayType.FilledMask, false),
  op("addSpriteFilledToBgList", "b", (vm, ctx) => {
    ctx.addToBgList(vm.byte(), true);
    return 0;
  }),
  op("clearBgIncrustList", "", (_vm, ctx) => {
    ctx.state.incrusts = [];
    return 0;
  }),
  /* 1C */
  N,
  op("label", "l", (vm) => {
    const index = vm.byte();
    vm.labels[index] = vm.pos;
    return 0;
  }),
  op("goto", "b", (vm) => {
    vm.jump(vm.byte());
    return 0;
  }),
  gotoIf("gotoIfSup", (c) => c === Cmp.GT),
  /* 20 */
  gotoIf("gotoIfSupEqu", (c) => (c & (Cmp.GT | Cmp.EQ)) !== 0),
  gotoIf("gotoIfInf", (c) => c === Cmp.LT),
  gotoIf("gotoIfInfEqu", (c) => (c & (Cmp.LT | Cmp.EQ)) !== 0),
  gotoIf("gotoIfEqu", (c) => c === Cmp.EQ),
  /* 24 */
  gotoIf("gotoIfDiff", (c) => c !== Cmp.EQ),
  op("removeLabel", "b", (vm) => {
    vm.labels[vm.byte()] = -1;
    return 0;
  }),
  op("loop", "bb", (vm) => {
    const varIdx = vm.byte();
    const label = vm.byte();
    vm.locals[varIdx] = vm.locals[varIdx]! - 1;
    if (vm.locals[varIdx]! >= 0) vm.jump(label);
    return 0;
  }),
  N,
  /* 28 */
  N,
  N,
  N,
  N,
  /* 2C */
  N,
  N,
  N,
  N,
  /* 30 */
  N,
  op("startGlobalScript", "b", (vm, ctx) => {
    ctx.startGlobalScript(vm.byte());
    return 0;
  }),
  op("endGlobalScript", "b", (vm, ctx) => {
    ctx.endGlobalScript(vm.byte());
    return 0;
  }),
  N,
  /* 34 */
  N,
  N,
  N,
  N,
  /* 38 */
  N,
  N,
  N,
  op("loadAnim", "s", (vm, ctx) => {
    ctx.loadResource(vm.string());
    return 0;
  }),
  /* 3C */
  op("loadBg", "s", (vm, ctx) => {
    ctx.loadBg(vm.string());
    return 0;
  }),
  op("loadCt", "s", (vm, ctx) => {
    ctx.loadCt(vm.string());
    return 0;
  }),
  N,
  op("loadPart", "s", (vm, ctx) => {
    ctx.loadPart(vm.string());
    return 0;
  }),
  /* 40 */
  op("closePart", "", () => 0),
  op("loadNewPrcName", "bs", (vm, ctx) => {
    const type = vm.byte();
    const name = vm.string();
    const pending = ctx.state.pending;
    if (type === 0) pending.prc = name;
    else if (type === 1) pending.rel = name;
    else if (type === 2) pending.obj = name;
    else if (type === 3) pending.msg = name;
    return 0;
  }),
  op("requestCheckPendingDataLoad", "", (_vm, ctx) => {
    ctx.state.checkForPendingDataLoadSwitch = 1;
    return 0;
  }),
  N,
  /* 44 */
  N,
  op("blitAndFade", "", (_vm, ctx) => {
    ctx.setBlackPalette();
    ctx.state.fadeInRequested = 1;
    return 0;
  }),
  op("fadeToBlack", "", () => ({ kind: "fadeToBlack" })),
  op("transformPaletteRange", "bbwww", (vm, ctx) => {
    const first = vm.byte();
    const last = vm.byte();
    const r = vm.sword();
    const g = vm.sword();
    ctx.transformPalette(first, last, r, g, vm.sword());
    ctx.state.fadeOutCompleted = 0;
    return 0;
  }),
  /* 48 */
  N,
  op("setDefaultMenuBgColor", "b", (vm, ctx) => {
    ctx.state.messageBg = vm.byte();
    return 0;
  }),
  op("palRotate", "bbb", (vm, ctx) => {
    const a = vm.byte();
    const b = vm.byte();
    ctx.rotatePalette(a, b, vm.byte());
    return 0;
  }),
  N,
  /* 4C */
  N,
  N,
  N,
  op("break", "", () => "break"),
  /* 50 */
  op("endScript", "x", () => "end"),
  op("message", "bwwww", (vm, ctx) => {
    const idx = vm.byte();
    const x = vm.word();
    const y = vm.word();
    const width = vm.word();
    addMessage(ctx.state, idx, x, y, width, vm.word());
    return 0;
  }),
  op("loadGlobalVar", "bc", (vm, ctx) => {
    const varIdx = vm.byte();
    const type = vm.byte();
    if (type === 0) ctx.state.globals[varIdx] = vm.word();
    else {
      const index = vm.byte();
      ctx.state.globals[varIdx] = type === 1 ? vm.locals[index]! : ctx.state.globals[index]!;
    }
    return 0;
  }),
  op("compareGlobalVar", "bc", (vm, ctx) => {
    const varIdx = vm.byte();
    const type = vm.byte();
    if (type === 0) {
      const value = vm.word();
      // D7 : vérification de la protection anti-copie toujours réussie (ScummVM, bogue #3866).
      vm.compare = varIdx === VAR_COPY_PROTECTION ? Cmp.EQ : compareValues(ctx.state.globals[varIdx]!, value);
    } else {
      const index = vm.byte();
      vm.compare = compareValues(ctx.state.globals[varIdx]!, type === 1 ? vm.locals[index]! : ctx.state.globals[index]!);
    }
    return 0;
  }),
  /* 54 */
  N,
  N,
  N,
  N,
  /* 58 */
  N,
  op("declareFunctionName", "s", (vm) => {
    vm.string();
    return 0;
  }),
  op("freePartRange", "bb", (vm, ctx) => {
    const start = vm.byte();
    freeAnimDataRange(ctx.state, start, vm.byte());
    return 0;
  }),
  op("unloadAllMasks", "", (_vm, ctx) => {
    ctx.state.overlays = [];
    return 0;
  }),
  /* 5C */
  N,
  N,
  N,
  N,
  /* 60 */
  N,
  N,
  N,
  op("setScreenDimensions", "wwww", (vm) => {
    for (let i = 0; i < 4; i++) vm.word();
    return 0;
  }),
  /* 64 */
  op("displayBackground", "", () => 0),
  op("initializeZoneData", "", (_vm, ctx) => {
    for (let i = 0; i < NUM_MAX_ZONE; i++) ctx.state.zoneData[i] = i;
    return 0;
  }),
  op("setZoneDataEntry", "bw", (vm, ctx) => {
    const zone = vm.byte();
    const value = vm.sword();
    if (zone < NUM_MAX_ZONE) ctx.state.zoneData[zone] = value;
    return 0;
  }),
  op("getZoneDataEntry", "bb", (vm, ctx) => {
    const zone = vm.byte();
    vm.locals[vm.byte()] = ctx.state.zoneData[zone] ?? 0;
    return 0;
  }),
  /* 68 */
  op("setPlayerCommandPosY", "b", (vm, ctx) => {
    ctx.state.cmdY = vm.byte();
    return 0;
  }),
  op("allowPlayerInput", "", (_vm, ctx) => {
    ctx.state.allowPlayerInput = 1;
    return 0;
  }),
  op("disallowPlayerInput", "", (_vm, ctx) => {
    ctx.state.allowPlayerInput = 0;
    return 0;
  }),
  op("changeDataDisk", "b", (vm, ctx) => {
    ctx.state.currentDisk = vm.byte();
    return 0;
  }),
  /* 6C */
  N,
  op("loadMusic", "s", (vm, ctx) => {
    const name = vm.string();
    ctx.loadMusic(name);
    ctx.state.names.dat = name;
    ctx.state.musicIsPlaying = 0;
    return 0;
  }),
  op("playMusic", "", (_vm, ctx) => {
    ctx.playMusic();
    ctx.state.musicIsPlaying = 1;
    return 0;
  }),
  op("fadeOutMusic", "", (_vm, ctx) => {
    ctx.fadeOutMusic();
    ctx.state.musicIsPlaying = 0;
    return 0;
  }),
  /* 70 */
  op("stopSample", "", (_vm, ctx) => {
    ctx.stopMusic();
    ctx.state.musicIsPlaying = 0;
    return 0;
  }),
  op("op71", "bw", (vm) => {
    vm.byte();
    vm.word();
    return 0;
  }),
  op("op72", "wbw", (vm) => {
    vm.word();
    vm.byte();
    vm.word();
    return 0;
  }),
  op("op73", "wbw", (vm) => {
    vm.word();
    vm.byte();
    vm.word();
    return 0;
  }),
  /* 74 */
  N,
  N,
  N,
  op("playSample", "bbwbww", playSample),
  /* 78 */
  op("playSampleSwapped", "bbwbww", playSample),
  op("disableSystemMenu", "b", (vm, ctx) => {
    ctx.state.disableSystemMenu = vm.byte();
    return 0;
  }),
  overlayOp("loadMask5", OverlayType.Occluder, true),
  overlayOp("unloadMask5", OverlayType.Occluder, false),
];

/** Nombre d'opcodes définis (78). */
export const FW_DEFINED_OPCODES = FW_OPCODES.filter((entry) => entry !== null).length;
