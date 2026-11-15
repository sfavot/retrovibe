import { describe, expect, it } from "vitest";
import { ScummvmRandom } from "../../../src/engine/rng";
import { checkCollision, FW_DEFINED_OPCODES, FW_OPCODES, type VmContext } from "../../../src/games/voyageurs/engine/script/opcodes";
import { RawObjectScript, RawScript, runScript, ScriptInstance, VmError } from "../../../src/games/voyageurs/engine/script/vm";
import { Cmp, createState, type EngineState, OverlayType } from "../../../src/games/voyageurs/engine/state";

/** Octet d'un opcode nommé (table + 1). */
function code(name: string): number {
  const index = FW_OPCODES.findIndex((entry) => entry?.name === name);
  if (index < 0) throw new Error(`opcode inconnu ${name}`);
  return index + 1;
}

const w = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const s = (text: string) => [...Buffer.from(text, "latin1"), 0];

/** Bytecode : `[nom, ...octets]` par instruction. */
function bytecode(...ops: (string | number | number[])[][]): Uint8Array {
  const out: number[] = [];
  for (const [name, ...args] of ops) {
    out.push(code(name as string));
    for (const a of args) out.push(...(Array.isArray(a) ? a : [a as number]));
  }
  return Uint8Array.from(out);
}

class FakeContext implements VmContext {
  state: EngineState = createState();
  rng = new ScummvmRandom(1);
  calls: string[] = [];
  mouseAt = { x: 12, y: 34 };
  random(max: number): number {
    return this.rng.number(max);
  }
  mousePosition() {
    return this.mouseAt;
  }
  partEntrySize(index: number, packed: boolean): number {
    return packed ? index * 10 : index * 20;
  }
  startGlobalScript(index: number): void {
    this.calls.push(`start ${index}`);
  }
  endGlobalScript(index: number): void {
    this.calls.push(`end ${index}`);
  }
  loadResource(name: string): void {
    this.calls.push(`res ${name}`);
  }
  loadBg(name: string): void {
    this.calls.push(`bg ${name}`);
  }
  loadCt(name: string): void {
    this.calls.push(`ct ${name}`);
  }
  loadPart(name: string): void {
    this.calls.push(`part ${name}`);
  }
  addToBgList(objIdx: number, filled: boolean): void {
    this.calls.push(`incrust ${objIdx} ${filled}`);
  }
  setBlackPalette(): void {
    this.calls.push("black");
  }
  transformPalette(first: number, last: number, r: number, g: number, b: number): void {
    this.calls.push(`pal ${first} ${last} ${r} ${g} ${b}`);
  }
  rotatePalette(a: number, b: number, c: number): void {
    this.calls.push(`rot ${a} ${b} ${c}`);
  }
  loadMusic(name: string): void {
    this.calls.push(`music ${name}`);
  }
  playMusic(): void {
    this.calls.push("play");
  }
  fadeOutMusic(): void {
    this.calls.push("fadeout");
  }
  stopMusic(): void {
    this.calls.push("stop");
  }
  playSample(anim: number, channel: number, volume: number, play: boolean): void {
    this.calls.push(`sample ${anim} ${channel} ${volume} ${play}`);
  }
}

function run(ctx: FakeContext, ...ops: (string | number | number[])[][]): ScriptInstance {
  const script = new ScriptInstance(new RawScript(bytecode(...ops, ["endScript"]), FW_OPCODES), 0);
  expect(runScript(script, FW_OPCODES, ctx)).toBe("end");
  return script;
}

describe("table des opcodes", () => {
  it("définit 78 opcodes sur 0x00 à 0x7B, avec les signatures de ScummVM", () => {
    expect(FW_OPCODES).toHaveLength(0x7c);
    expect(FW_DEFINED_OPCODES).toBe(78);
    expect(FW_OPCODES[0x4f]?.name).toBe("break");
    expect(FW_OPCODES[0x50]).toMatchObject({ name: "endScript", args: "x" });
    expect(FW_OPCODES[0x77]).toMatchObject({ name: "playSample", args: "bbwbww" });
    expect(FW_OPCODES[0x10]).toBeNull();
  });
});

describe("machine à scripts", () => {
  it("l'octet N exécute l'entrée N - 1 ; 0 et les trous sont des no-op d'un octet", () => {
    const ctx = new FakeContext();
    const raw = new RawScript(Uint8Array.of(0, 0x11, code("loadGlobalVar"), 3, 0, ...w(7), code("endScript")), FW_OPCODES);
    expect(runScript(new ScriptInstance(raw, 0), FW_OPCODES, ctx)).toBe("end");
    expect(ctx.state.globals[3]).toBe(7);
  });

  it("break suspend le script et la reprise continue à l'opcode suivant", () => {
    const ctx = new FakeContext();
    const raw = new RawScript(bytecode(["loadGlobalVar", 1, 0, w(1)], ["break"], ["loadGlobalVar", 1, 0, w(2)], ["endScript"]), FW_OPCODES);
    const script = new ScriptInstance(raw, 4);
    expect(runScript(script, FW_OPCODES, ctx)).toBe("break");
    expect(ctx.state.globals[1]).toBe(1);
    expect(runScript(script, FW_OPCODES, ctx)).toBe("end");
    expect(ctx.state.globals[1]).toBe(2);
  });

  it("un script vide reste en place (break sans rien faire)", () => {
    const script = new ScriptInstance(new RawScript(new Uint8Array(0), FW_OPCODES), 2);
    expect(runScript(script, FW_OPCODES, new FakeContext())).toBe("break");
  });

  it("pré-calcule les labels jusqu'au premier endScript seulement", () => {
    const raw = new RawScript(
      bytecode(["label", 1], ["loadVar", 0, 1, 2], ["loadVar", 0, 0, w(5)], ["label", 2], ["endScript"], ["label", 3], ["endScript"]),
      FW_OPCODES,
    );
    expect(raw.labels[1]).toBe(2);
    expect(raw.labels[2]).toBe(13);
    expect(raw.labels[3]).toBe(-1);
  });

  it("les opérandes `c` d'un octet ou d'un mot sont sautés correctement pour trouver les labels", () => {
    const raw = new RawScript(bytecode(["compareVar", 1, 0, w(94)], ["startGlobalScript", 23], ["label", 3], ["endScript"]), FW_OPCODES);
    expect(raw.labels[3]).toBe(9);
  });

  it("goto, sauts conditionnels, label à l'exécution, removeLabel, loop", () => {
    const ctx = new FakeContext();
    // local[0] = 3 ; boucle : global[0] += 1 trois fois (loop décrémente puis saute si >= 0).
    const script = run(
      ctx,
      ["loadVar", 0, 0, w(2)],
      ["label", 1],
      ["loadGlobalVar", 9, 2, 9],
      ["addVar", 1, 0, w(1)],
      ["loadGlobalVar", 0, 1, 1],
      ["loop", 0, 1],
      ["compareVar", 1, 0, w(3)],
      ["gotoIfEqu", 2],
      ["loadGlobalVar", 5, 0, w(99)],
      ["label", 2],
      ["compareVar", 1, 0, w(1)],
      ["gotoIfInf", 3],
      ["gotoIfSup", 4],
      ["label", 3],
      ["loadGlobalVar", 6, 0, w(66)],
      ["label", 4],
      ["removeLabel", 4],
    );
    expect(ctx.state.globals[0]).toBe(3);
    expect(ctx.state.globals[5]).toBe(0);
    expect(ctx.state.globals[6]).toBe(0);
    expect(script.labels[4]).toBe(-1);
  });

  it("un saut vers un label non défini lève VmError", () => {
    const script = new ScriptInstance(new RawScript(bytecode(["goto", 7], ["endScript"]), FW_OPCODES), 0);
    expect(() => runScript(script, FW_OPCODES, new FakeContext())).toThrow(VmError);
  });

  it("arithmétique sur 16 bits signés (débordement) et division par zéro sans effet", () => {
    const ctx = new FakeContext();
    const script = run(
      ctx,
      ["loadVar", 0, 0, w(0x7fff)],
      ["addVar", 0, 0, w(1)],
      ["loadVar", 1, 0, w(300)],
      ["mulVar", 1, 0, w(300)],
      ["loadVar", 2, 0, w(-7 & 0xffff)],
      ["divVar", 2, 0, w(2)],
      ["loadVar", 3, 0, w(5)],
      ["divVar", 3, 0, w(0)],
      ["loadVar", 4, 0, w(10)],
      ["subVar", 4, 1, 3],
      ["loadGlobalVar", 7, 0, w(4)],
      ["mulVar", 4, 2, 7],
    );
    expect(script.locals[0]).toBe(-32768);
    expect(script.locals[1]).toBe((300 * 300) << 16 >> 16);
    expect(script.locals[2]).toBe(-3);
    expect(script.locals[3]).toBe(5);
    expect(script.locals[4]).toBe(20);
  });

  it("comparaisons : registre EQ / GT / LT et sauts >= / <= / !=", () => {
    const ctx = new FakeContext();
    ctx.state.globals[10] = -5;
    const script = run(ctx, ["loadVar", 0, 0, w(4)], ["compareVar", 0, 2, 10]);
    expect(script.compare).toBe(Cmp.GT);
    const s2 = run(ctx, ["compareGlobalVar", 10, 0, w(3)]);
    expect(s2.compare).toBe(Cmp.LT);
    const s3 = run(ctx, ["compareGlobalVar", 10, 2, 10], ["gotoIfSupEqu", 1], ["loadGlobalVar", 1, 0, w(1)], ["label", 1]);
    expect(s3.compare).toBe(Cmp.EQ);
    expect(ctx.state.globals[1]).toBe(0);
  });

  it("D7 : toute comparaison de la globale 255 à une valeur répond « égal »", () => {
    const ctx = new FakeContext();
    ctx.state.globals[255] = 12;
    expect(run(ctx, ["compareGlobalVar", 255, 0, w(143)]).compare).toBe(Cmp.EQ);
    // Avec une variable comme opérande, la comparaison est réelle (comme ScummVM).
    expect(run(ctx, ["compareGlobalVar", 255, 2, 0]).compare).toBe(Cmp.GT);
  });

  it("loadVar : locale, globale, souris, hasard de ScummVM, tailles du bundle", () => {
    const ctx = new FakeContext();
    ctx.state.globals[20] = 77;
    const expected = new ScummvmRandom(1);
    const script = run(
      ctx,
      ["loadVar", 0, 2, 20],
      ["loadVar", 1, 1, 0],
      ["loadVar", 2, 3, 0],
      ["loadVar", 3, 4, 0],
      ["loadVar", 4, 5, 6],
      ["loadVar", 5, 8, 3],
      ["loadVar", 6, 9, 3],
      ["loadVar", 7, 5, 0],
    );
    expect([...script.locals.slice(0, 4)]).toEqual([77, 77, 12, 34]);
    expect(script.locals[4]).toBe(expected.number(5));
    expect([script.locals[5], script.locals[6]]).toEqual([30, 60]);
    // n = 0 : tirage brut 32 bits (`getRandomNumber(0xFFFFFFFF)`), tronqué à 16 bits.
    expect(script.locals[7]).toBe(expected.number(0xffffffff) << 16 >> 16);
    expect(() => run(ctx, ["loadVar", 0, 6, 0])).toThrow(VmError);
  });

  it("paramètres d'objet : lecture, écriture, +, -, ×, ÷, comparaison ; costume -1 = globale 0", () => {
    const ctx = new FakeContext();
    ctx.state.globals[0] = 42;
    const script = run(
      ctx,
      ["modifyObjectParam", 5, 1, w(100)],
      ["addObjectParam", 5, 1, w(20)],
      ["subObjectParam", 5, 2, w(3)],
      ["modifyObjectParam", 5, 4, w(9)],
      ["mulObjectParam", 5, 4, w(3)],
      ["divObjectParam", 5, 1, w(4)],
      ["modifyObjectParam", 5, 5, w(0xffff)],
      ["loadVar", 3, 0, w(-2 & 0xffff)],
      ["modifyObjectParam2", 6, 5, 3],
      ["getObjectParam", 5, 1, 0],
      ["compareObjectParam", 5, 2, w(0)],
    );
    const obj = ctx.state.objects[5]!;
    expect(obj).toMatchObject({ x: 30, y: -3, frame: 27, costume: 42 });
    expect(ctx.state.objects[6]!.costume).toBe(-2);
    expect(script.locals[0]).toBe(30);
    expect(script.compare).toBe(Cmp.LT);
  });

  it("calques : insertion triée par priorité, changement de priorité et setupObject ré-insèrent le sprite", () => {
    const ctx = new FakeContext();
    const { state } = ctx;
    state.objects[1]!.mask = 10;
    state.objects[2]!.mask = 5;
    state.objects[3]!.mask = 10;
    run(ctx, ["loadMask0", 1], ["loadMask0", 2], ["loadMask5", 3], ["loadMask1", 2]);
    // Un nouveau calque passe devant ceux de priorité égale.
    expect(state.overlays.map((o) => `${o.objIdx}:${o.type}`)).toEqual(["2:1", "2:0", "3:5", "1:0"]);
    // Priorité 20 : le sprite repasse devant le premier calque de priorité >= 20, ici le masque 1 du même objet.
    run(ctx, ["modifyObjectParam", 2, 3, w(20)]);
    expect(state.overlays.map((o) => `${o.objIdx}:${o.type}`)).toEqual(["2:0", "2:1", "3:5", "1:0"]);
    run(ctx, ["modifyObjectParam", 1, 3, w(0)]);
    expect(state.overlays.map((o) => `${o.objIdx}:${o.type}`)).toEqual(["1:0", "2:0", "2:1", "3:5"]);
    run(ctx, ["setupObject", 2, w(1), w(2), w(15), w(4)]);
    expect(state.overlays.map((o) => `${o.objIdx}:${o.type}`)).toEqual(["1:0", "2:0", "2:1", "3:5"]);
    expect(state.objects[2]).toMatchObject({ x: 1, y: 2, mask: 15, frame: 4 });
    run(ctx, ["unloadMask5", 3], ["unloadMask1", 2], ["loadMask4", 1], ["unloadMask4", 1]);
    expect(state.overlays.map((o) => `${o.objIdx}:${o.type}`)).toEqual(["1:0", "2:0"]);
    run(ctx, ["message", 4, w(10), w(20), w(200), w(1)]);
    expect(state.overlays.at(-1)).toMatchObject({ objIdx: 4, type: OverlayType.Message, x: 10, y: 20, width: 200, color: 1 });
    run(ctx, ["unloadAllMasks"]);
    expect(state.overlays).toEqual([]);
  });

  it("checkCollision : zone remappée sur une ligne de pixels, zone 0 hors de l'écran", () => {
    const ctx = new FakeContext();
    const { state } = ctx;
    state.objects[1]!.x = 100;
    state.objects[1]!.y = 50;
    state.collision[60 * 320 + 105] = 3;
    run(ctx, ["initializeZoneData"], ["setZoneDataEntry", 3, w(7)], ["setZoneDataEntry", 40, w(1)]);
    expect(state.zoneData[3]).toBe(7);
    expect(checkCollision(state, 1, 0, 10, 5, 7)).toBe(0);
    expect(checkCollision(state, 1, 0, 10, 6, 7)).toBe(1);
    expect(run(ctx, ["checkCollision", 1, w(5), w(10), w(1), w(7)]).compare).toBe(1);
    // Hors de 320 x 200 : zone 0 (remappée en 0 par initializeZoneData).
    expect(checkCollision(state, 1, 0, 200, 1, 0)).toBe(1);
    expect(run(ctx, ["getZoneDataEntry", 3, 9]).locals[9]).toBe(7);
  });

  it("chargements différés, scripts globaux, ressources et fond passent par le contexte", () => {
    const ctx = new FakeContext();
    run(
      ctx,
      ["loadNewPrcName", 0, s("A.PRC")],
      ["loadNewPrcName", 1, s("B.REL")],
      ["loadNewPrcName", 2, s("C.OBJ")],
      ["loadNewPrcName", 3, s("D.MSG")],
      ["requestCheckPendingDataLoad"],
      ["startGlobalScript", 3],
      ["endGlobalScript", 4],
      ["loadPart", s("PART02")],
      ["loadAnim", s("L001.ANI")],
      ["loadBg", s("L1.PI1")],
      ["loadCt", s("L1_MK.NEO")],
      ["addToBgList", 7],
      ["addSpriteFilledToBgList", 8],
      ["declareFunctionName", s("INIT")],
      ["closePart"],
    );
    expect(ctx.state.pending).toEqual({ prc: "A.PRC", rel: "B.REL", obj: "C.OBJ", msg: "D.MSG" });
    expect(ctx.state.checkForPendingDataLoadSwitch).toBe(1);
    expect(ctx.calls).toEqual(["start 3", "end 4", "part PART02", "res L001.ANI", "bg L1.PI1", "ct L1_MK.NEO", "incrust 7 false", "incrust 8 true"]);
  });

  it("interface, palette, musique CD et effets sonores", () => {
    const ctx = new FakeContext();
    ctx.state.anims[4] = { kind: "raw", resource: "A.SPL", part: "", fileIdx: 0, frameIdx: 0, width: 1, height: 1, var1: 0, realWidth: 1, bpp: 4, data: new Uint8Array(1), mask: null, transparentColor: 0 };
    ctx.state.incrusts.push({ objIdx: 1, param: 0, x: 0, y: 0, frame: 0, part: 0, bgIdx: 0 });
    run(
      ctx,
      ["allowPlayerInput"],
      ["disableSystemMenu", 1],
      ["setPlayerCommandPosY", 170],
      ["setDefaultMenuBgColor", 3],
      ["blitAndFade"],
      ["transformPaletteRange", 1, 4, w(1), w(-1 & 0xffff), w(2)],
      ["palRotate", 1, 2, 3],
      ["clearBgIncrustList"],
      ["loadMusic", s("DUGGER.DAT")],
      ["playMusic"],
      ["fadeOutMusic"],
      ["stopSample"],
      ["playSample", 4, 11, w(0), 0, w(10), w(0xffff)],
      ["playSampleSwapped", 4, 2, w(0), 0, w(70), w(5)],
      ["playSample", 9, 1, w(0), 0, w(60), w(0xffff)],
      ["changeDataDisk", 2],
      ["setScreenDimensions", w(1), w(2), w(3), w(4)],
      ["displayBackground"],
      ["op71", 1, w(2)],
      ["op72", w(1), 2, w(3)],
      ["op73", w(1), 2, w(3)],
    );
    const { state } = ctx;
    expect(state).toMatchObject({ allowPlayerInput: 1, disableSystemMenu: 1, cmdY: 170, messageBg: 3, fadeInRequested: 1, currentDisk: 2, musicIsPlaying: 0 });
    expect(state.names.dat).toBe("DUGGER.DAT");
    expect(state.incrusts).toEqual([]);
    expect(ctx.calls).toEqual([
      "black", "pal 1 4 1 -1 2", "rot 1 2 3", "music DUGGER.DAT", "play", "fadeout", "stop", "sample 4 1 50 true", "sample 4 2 63 false",
    ]);
    run(ctx, ["disallowPlayerInput"]);
    expect(state.allowPlayerInput).toBe(0);
  });

  it("freePartRange libère des emplacements de sprites (bornés à la table)", () => {
    const ctx = new FakeContext();
    const slot = { kind: "raw" as const, resource: "", part: "", fileIdx: 0, frameIdx: 0, width: 1, height: 1, var1: 0, realWidth: 1, bpp: 4, data: new Uint8Array(1), mask: null, transparentColor: 0 };
    for (const i of [0, 1, 2, 254]) ctx.state.anims[i] = slot;
    run(ctx, ["freePartRange", 1, 1], ["freePartRange", 250, 20]);
    expect(ctx.state.anims.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)).toEqual([0, 2]);
  });

  it("fadeToBlack rend un effet bloquant ; le script reprend à l'opcode suivant", () => {
    const ctx = new FakeContext();
    const raw = new RawScript(bytecode(["fadeToBlack"], ["loadGlobalVar", 2, 0, w(5)], ["endScript"]), FW_OPCODES);
    const script = new ScriptInstance(raw, 0);
    expect(runScript(script, FW_OPCODES, ctx)).toEqual({ kind: "fadeToBlack" });
    expect(ctx.state.globals[2]).toBe(0);
    expect(runScript(script, FW_OPCODES, ctx)).toBe("end");
    expect(ctx.state.globals[2]).toBe(5);
  });

  it("instance d'objet : la locale 0 compte les exécutions précédentes de l'entrée REL", () => {
    const raw = new RawObjectScript(bytecode(["endScript"]), FW_OPCODES, 0, 1, 0xffff);
    expect([0, 1, 2].map(() => new ScriptInstance(raw, 3).locals[0])).toEqual([0, 1, 2]);
    expect(raw.runCount).toBe(3);
  });

  it("lire hors du bytecode lève VmError", () => {
    const script = new ScriptInstance(new RawScript(Uint8Array.of(code("loadGlobalVar"), 1), FW_OPCODES), 0);
    expect(() => runScript(script, FW_OPCODES, new FakeContext())).toThrow(VmError);
  });
});
