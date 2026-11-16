import { describe, expect, it } from "vitest";
import { ArrayType, Segment } from "../../../src/games/gk1/engine/ids";
import {
  formatReg,
  fromInt,
  isNumber,
  isPointer,
  makeReg,
  NULL_REG,
  regAdd,
  regCompare,
  regOffset,
  regSegment,
  regSub,
  SciArray,
  SciError,
  SegManager,
  Table,
  toSint16,
} from "../../../src/games/gk1/engine/memory";

describe("valeurs de la machine virtuelle", () => {
  it("sépare segment et offset, entiers et références", () => {
    const reg = makeReg(0x12, 0x3456);
    expect(reg).toBe(0x123456);
    expect([regSegment(reg), regOffset(reg)]).toEqual([0x12, 0x3456]);
    expect([isNumber(reg), isPointer(reg)]).toEqual([false, true]);
    expect([isNumber(0xffff), isPointer(0xffff)]).toEqual([true, false]);
    // Le plus grand segment tient encore dans un entier non signé de 32 bits.
    expect(regSegment(makeReg(0xffff, 0xffff))).toBe(0xffff);
    expect(makeReg(3, 0x10005)).toBe(makeReg(3, 5));
    expect(toSint16(0xfffe)).toBe(-2);
    expect(fromInt(-2)).toBe(0xfffe);
    expect(formatReg(0xfffe)).toBe("-2");
    expect(formatReg(reg)).toBe("0012:3456");
  });

  it("additionne et soustrait entiers et références", () => {
    const reg = makeReg(9, 100);
    expect(regAdd(0xffff, 3)).toBe(2);
    expect(regAdd(reg, 4)).toBe(makeReg(9, 104));
    expect(regAdd(4, reg)).toBe(makeReg(9, 104));
    expect(regAdd(reg, fromInt(-4))).toBe(makeReg(9, 96));
    expect(() => regAdd(reg, reg)).toThrow(SciError);
    expect(regSub(3, 5)).toBe(0xfffe);
    expect(regSub(reg, 4)).toBe(makeReg(9, 96));
    expect(regSub(makeReg(9, 104), reg)).toBe(4);
    expect(() => regSub(reg, makeReg(8, 0))).toThrow(SciError);
    expect(() => regSub(5, reg)).toThrow(SciError);
  });

  it("compare en signé, en non signé, et les références par leur offset", () => {
    expect(regCompare(0xffff, 1, false)).toBeLessThan(0);
    expect(regCompare(0xffff, 1, true)).toBeGreaterThan(0);
    expect(regCompare(makeReg(9, 0x9000), makeReg(9, 0x10), false)).toBeGreaterThan(0);
    expect(regCompare(makeReg(9, 4), makeReg(9, 4), false)).toBe(0);
    // Une référence est plus grande que tout entier.
    expect(regCompare(makeReg(9, 0), 0x7fff, false)).toBeGreaterThan(0);
    expect(regCompare(0x7fff, makeReg(9, 0), false)).toBeLessThan(0);
  });
});

describe("tables et tableaux", () => {
  it("réutilise le dernier indice libéré", () => {
    const table = new Table<string>(Segment.Lists, "listes");
    const [a, b, c] = [table.allocate("a"), table.allocate("b"), table.allocate("c")];
    expect([a, b, c]).toEqual([makeReg(Segment.Lists, 0), makeReg(Segment.Lists, 1), makeReg(Segment.Lists, 2)]);
    table.release(a);
    table.release(b);
    table.release(b);
    expect(table.size).toBe(1);
    expect(table.get(b)).toBeUndefined();
    expect(table.get(makeReg(Segment.Nodes, 2))).toBeUndefined();
    expect(table.allocate("d")).toBe(b);
    expect(table.allocate("e")).toBe(a);
    expect([...table].map(([, value]) => value)).toEqual(["e", "d", "c"]);
  });

  it("un tableau grandit en écriture, pas en lecture", () => {
    const array = new SciArray(ArrayType.Int16, 2);
    expect(array.size).toBe(2);
    array.set(1, makeReg(4, 2));
    expect(array.get(1)).toBe(makeReg(4, 2));
    expect(() => array.get(2)).toThrow(SciError);
    expect(() => array.set(2, 1)).toThrow(SciError);
    array.fill(1, 3, 7);
    expect([array.size, array.get(0), array.get(3)]).toEqual([4, 0, 7]);
    array.fill(0, 0xffff, 9);
    expect([array.get(0), array.get(3), array.size]).toEqual([9, 9, 4]);
    array.resize(2);
    expect(array.size).toBe(4);
    array.resize(2, true);
    array.resize(4);
    expect([array.size, array.get(2)]).toEqual([4, 0]);
    expect([...array.references()]).toEqual([9, 9, 0, 0]);
  });

  it("copie entre tableaux, y compris sur lui-même et d'octets vers références", () => {
    const bytes = new SciArray(ArrayType.Byte, 4);
    [1, 2, 3, 0x1ff].forEach((value, i) => bytes.set(i, value));
    expect(bytes.get(3)).toBe(0xff);
    bytes.copyFrom(bytes, 0, 1, 3);
    expect([0, 1, 2, 3].map((i) => bytes.get(i))).toEqual([1, 1, 2, 3]);
    const regs = new SciArray(ArrayType.Id);
    regs.copyFrom(bytes, 1, 2, 0xffff);
    expect([regs.size, regs.get(0), regs.get(2), regs.get(4)]).toEqual([5, 0, 1, 3]);
    const copy = regs.clone();
    copy.set(0, 5);
    expect([regs.get(0), copy.get(0), copy.size]).toEqual([0, 5, 5]);
    expect(() => new SciArray(9 as ArrayType)).toThrow(SciError);
  });

  it("une chaîne est un tableau d'octets terminé par 0", () => {
    const text = new SciArray(ArrayType.String, 3);
    expect(text.toByteString()).toBe("");
    text.setByteString("été");
    expect([text.size, text.get(3)]).toEqual([4, 0]);
    expect(text.toByteString()).toBe("été");
    text.set(1, 0);
    expect(text.toByteString()).toBe("é");
    expect(text.references()).toHaveLength(0);
  });
});

describe("gestionnaire de segments", () => {
  it("lit et écrit les cases de variables, adressées en octets", () => {
    const memory = new SegManager();
    const locals = memory.addLocalsSegment(3);
    locals.values = Uint32Array.of(10, 20, 30);
    const address = makeReg(locals.id, 2);
    expect(memory.readCell(address)).toBe(20);
    memory.writeCell(address, 1, 31);
    expect(locals.values[2]).toBe(31);
    expect(() => memory.readCell(address, 2)).toThrow(SciError);
    expect(() => memory.readCell(makeReg(locals.id, 1))).toThrow(/impaire/);
    memory.stack[5] = 77;
    expect(memory.readCell(makeReg(Segment.Stack, 10))).toBe(77);
    expect(() => memory.readCell(makeReg(Segment.Lists, 0))).toThrow(SciError);
    expect(memory.isVariableAddress(address)).toBe(true);
    expect(memory.isVariableAddress(5)).toBe(false);
  });

  it("lit et écrit des chaînes dans un heap de script, un tableau et des variables", () => {
    const memory = new SegManager();
    const script = memory.addScriptSegment(1);
    script.heap = Uint8Array.from([0x41, 0x42, 0, 0x82, 0x43, 0, 0, 0]);
    expect(memory.getString(makeReg(script.id, 0))).toBe("AB");
    expect(memory.getString(makeReg(script.id, 3))).toBe("\x82C");
    memory.setString(makeReg(script.id, 3), "xyz");
    expect([...script.heap]).toEqual([0x41, 0x42, 0, 0x78, 0x79, 0x7a, 0, 0]);
    expect(() => memory.setString(makeReg(script.id, 5), "trop long")).toThrow(SciError);

    const array = memory.arrays.allocate(new SciArray(ArrayType.String));
    memory.setString(array, "salut");
    expect(memory.getString(array)).toBe("salut");
    expect(memory.array(array).size).toBe(6);

    // Deux caractères par case, poids faible d'abord.
    const cells = makeReg(Segment.Stack, 0);
    memory.setString(cells, "abc");
    expect([...memory.stack.subarray(0, 2)]).toEqual([0x6261, 0x0063]);
    expect(memory.getString(cells)).toBe("abc");
    memory.setString(cells, "abcd");
    expect([...memory.stack.subarray(0, 3)]).toEqual([0x6261, 0x6463, 0]);
    expect(memory.getString(cells)).toBe("abcd");

    expect(memory.getString(NULL_REG)).toBe("");
    expect(() => memory.getString(makeReg(Segment.Lists, 0))).toThrow(SciError);
    expect(() => memory.getString(1234)).toThrow(SciError);
  });

  it("refuse les listes, nœuds et tableaux invalides", () => {
    const memory = new SegManager();
    expect(() => memory.list(makeReg(Segment.Lists, 0))).toThrow(/liste/);
    expect(() => memory.node(makeReg(Segment.Nodes, 0))).toThrow(/nœud/);
    expect(memory.node(NULL_REG)).toBeUndefined();
    expect(() => memory.array(0)).toThrow(/tableau/);
    expect(memory.getObject(makeReg(Segment.Clones, 0))).toBeUndefined();
    expect(memory.getObject(makeReg(200, 0))).toBeUndefined();
    expect(memory.isObject(0)).toBe(false);
  });
});
