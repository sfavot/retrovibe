import type { TestHost } from "../../../src/games/bass/engine/host";
import { describe, expect, it } from "vitest";
import { scummvmRandom } from "../../../src/engine/rng";
import { CompactField as F } from "../../../src/games/bass/data/compact-fields";
import { formatScript, scriptCount } from "../../../src/games/bass/engine/disasm";
import { Cpt, F_MODULE_0, Script, ST, Var } from "../../../src/games/bass/engine/ids";
import { MCODES, mcodeNumber } from "../../../src/games/bass/engine/mcodes/index";
import { skyDisk } from "../data/helpers";
import { hasOriginalFiles, makeEngine } from "./helpers";

describe("table des mcodes (Logic::setupMcodeTable)", () => {
  it("115 entrées dans l'ordre de ScummVM, noms du débogueur", () => {
    expect(MCODES).toHaveLength(115);
    expect(MCODES[0]!.name).toBe("fn_cache_chip");
    expect(MCODES[11]!.name).toBe("fn_normal_mouse");
    expect(MCODES[34]!.name).toBe("fn_quit");
    expect(MCODES[61]!.name).toBe("fn_run_anim_mod");
    expect(MCODES[71]!.name).toBe("fn_random");
    expect(MCODES[93]!.name).toBe("fn_enter_section");
    expect(MCODES[114]!.name).toBe("fn_printf");
    expect(new Set(MCODES.map((m) => m.name)).size).toBe(115);
    expect(mcodeNumber("fn_fade_up")).toBe(110);
  });

  it("état du portage : complets, sur service de l'hôte, souches", () => {
    const count = (status: string) => MCODES.filter((m) => m.status === status).length;
    expect({ done: count("done"), service: count("service"), stub: count("stub") }).toEqual({ done: 99, service: 15, stub: 1 });
  });
});

describe.skipIf(!hasOriginalFiles)("mcodes sur le moteur", () => {
  function started() {
    const { engine } = makeEngine();
    engine.startAfterIntro();
    engine.runCycles(1);
    return engine;
  }

  it("fnRandom : RND = getRandomNumber(65536) & a, même suite que Common::RandomSource avec la même graine", () => {
    const engine = started();
    const ref = scummvmRandom(1);
    const fn = MCODES[mcodeNumber("fn_random")]!.fn;
    for (const mask of [0xffff, 7, 0x1f, 0xffffffff]) {
      expect(fn(engine.logic, mask, 0, 0)).toBe(true);
      expect(engine.vars[Var.RND]).toBe((ref.number(65536) & mask) >>> 0);
    }
    // Premier tirage de la graine 1 (valeur relevée dans ScummVM : 1980353283 sur 32 bits).
    expect(scummvmRandom(1).number(65536)).toBe(1980353283 % 65537);
  });

  it("fnStartSub monte d'un niveau et suspend ; fnSendSync pose le sync d'un autre compact", () => {
    const engine = started();
    const L = engine.logic;
    const foster = engine.compacts.require(Cpt.FOSTER);
    L.compact = foster;
    const mode = foster[F.mode]!;
    expect(MCODES[mcodeNumber("fn_start_sub")]!.fn(L, 0x00050123, 0, 0)).toBe(false);
    expect(foster[F.mode]).toBe(mode + 4);
    expect(engine.compacts.getSub(foster, mode + 4)).toBe(0x0123);
    expect(engine.compacts.getSub(foster, mode + 6)).toBe(5);
    expect(MCODES[mcodeNumber("fn_send_sync")]!.fn(L, Cpt.JOEY, 0x10007, 0)).toBe(false);
    expect(engine.compacts.require(Cpt.JOEY)[F.sync]).toBe(7);
  });

  it("fnArrived / fnLeaving comptent les présents dans une variable", () => {
    const engine = started();
    const L = engine.logic;
    L.compact = engine.compacts.require(Cpt.FOSTER);
    engine.vars[700] = 2;
    MCODES[mcodeNumber("fn_arrived")]!.fn(L, 700 * 4, 0, 0);
    expect(engine.vars[700]).toBe(3);
    MCODES[mcodeNumber("fn_leaving")]!.fn(L, 0, 0, 0);
    MCODES[mcodeNumber("fn_leaving")]!.fn(L, 0, 0, 0); // une seule fois
    expect(engine.vars[700]).toBe(2);
  });

  it("fnAddHuman / fnNoHuman : souris rendue (MOUSE_STATUS |= 6, GET_OFF = RESET_MOUSE) puis retirée (script GET_OFF lancé)", () => {
    const engine = started();
    const L = engine.logic;
    engine.vars[Var.MOUSE_STATUS] = 0;
    MCODES[mcodeNumber("fn_add_human")]!.fn(L, 0, 0, 0);
    expect(engine.vars[Var.MOUSE_STATUS]).toBe(6);
    expect(engine.vars[Var.GET_OFF]).toBe(Script.RESET_MOUSE);
    expect(engine.vars[Var.SPECIAL_ITEM]).toBe(0xffffffff);
    MCODES[mcodeNumber("fn_no_human")]!.fn(L, 0, 0, 0);
    expect(engine.vars[Var.MOUSE_STATUS]).toBe(0);
    expect(engine.vars[Var.GET_OFF]).toBe(0);
    expect(engine.mouse.cursor).toBe(6); // RESET_MOUSE (fnNormalMouse) puis fnBlankMouse
  });

  it("fnKillId coupe un compact ; fnForeground / fnSort changent son plan", () => {
    const engine = started();
    const L = engine.logic;
    const joey = engine.compacts.require(Cpt.JOEY);
    joey[F.status] = ST.LOGIC | ST.BACKGROUND;
    MCODES[mcodeNumber("fn_foreground")]!.fn(L, Cpt.JOEY, 0, 0);
    expect(joey[F.status]).toBe(ST.LOGIC | ST.FOREGROUND);
    MCODES[mcodeNumber("fn_sort")]!.fn(L, Cpt.JOEY, 0, 0);
    expect(joey[F.status]).toBe(ST.LOGIC | ST.SORT);
    MCODES[mcodeNumber("fn_kill_id")]!.fn(L, Cpt.JOEY, 0, 0);
    expect(joey[F.status]).toBe(0);
  });

  it("fnRestoreGame : demande la restitution à l'hôte (GameControl) et suspend le script", () => {
    const engine = started();
    expect(MCODES[mcodeNumber("fn_restore_game")]!.fn(engine.logic, 0, 0, 0)).toBe(false);
    expect((engine.host as TestHost).restoreRequests).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("désassembleur", () => {
  it("RESET_MOUSE (module 0, script 0x17) appelle fn_normal_mouse puis sort", () => {
    const bytes = skyDisk().load(F_MODULE_0);
    const module = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.byteLength & ~1)));
    expect(scriptCount(module)).toBeGreaterThan(Script.RESET_MOUSE);
    const text = formatScript(module, Script.RESET_MOUSE);
    expect(text).toContain("call_mcode fn_normal_mouse/0");
    expect(text.trim().split("\n").at(-1)).toMatch(/script_exit$/);
  });
});
