import { describe, expect, it } from "vitest";
import { decodeInstr } from "../../src/games/lost-in-time/engine/opcodes";
import { Expression, Script, ScriptError } from "../../src/games/lost-in-time/engine/script";
import { Variables } from "../../src/games/lost-in-time/engine/variables";

function scriptOf(bytes: number[]): Script {
  const data = new Uint8Array(128 + bytes.length);
  data.set(bytes, 128);
  const s = new Script("TEST.TOT", data);
  s.pos = 128;
  return s;
}

function evaluator(bytes: number[], vars = new Variables(16)) {
  const script = scriptOf(bytes);
  const expr = new Expression({ script, vars, animDataSize: 0, random: () => 0 });
  return { script, vars, expr };
}

describe("Variables", () => {
  it("accède en 8/16/32 bits little-endian et aux chaînes", () => {
    const v = new Variables(4);
    v.writeOff32(0, 0x01020304);
    expect([v.readOff8(0), v.readOff16(0), v.readOff32(0)]).toEqual([4, 0x0304, 0x01020304]);
    v.writeString(8, "abc");
    expect(v.readString(8)).toBe("abc");
    expect(() => v.readOff32(14)).toThrow(RangeError);
  });
});

describe("expressions", () => {
  it("évalue arithmétique, priorités et comparaisons", () => {
    // 2 + 3 * 4  (imm8 21 ; ops ; stop 99)
    const e = evaluator([21, 2, 2, 21, 3, 5, 21, 4, 99]);
    expect(e.expr.evalInt()).toBe(14);
    const cmp = evaluator([21, 5, 34, 21, 3, 99]); // 5 > 3
    expect(cmp.expr.evalBool()).toBe(true);
  });

  it("lit une variable 32 bits et concatène des chaînes", () => {
    const v = new Variables(16);
    v.writeVar32(3, 40);
    const e = evaluator([23, 3, 0, 2, 21, 2, 99], v); // var3 + 2
    expect(e.expr.evalInt()).toBe(42);
    const s = evaluator([22, 0x61, 0x62, 0, 2, 22, 0x63, 0, 99]); // "ab" + "c"
    expect(s.expr.evalString()).toBe("abc");
  });

  it("saute une expression sans l'évaluer", () => {
    const e = evaluator([21, 1, 30, 22, 0x78, 0, 99, 21, 9]);
    e.expr.skipExpr(99);
    expect(e.script.pos).toBe(128 + 7);
  });
});

describe("décodage", () => {
  it("signale une commande inconnue avec le TOT et l'offset", () => {
    const s = scriptOf([0x40]); // 0.4 : jamais défini
    expect(() => decodeInstr(s, null, 128)).toThrow(ScriptError);
    expect(() => decodeInstr(s, null, 128)).toThrow(/TEST\.TOT @128/);
  });
});
