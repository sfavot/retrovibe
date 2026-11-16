import { describe, expect, it } from "vitest";
import { ResourceType, VOCAB_CLASS_TABLE, VOCAB_OPCODE_NAMES, VOCAB_PROPERTY_OFFSETS, VOCAB_SELECTOR_NAMES } from "../../../src/games/gk1/data/ids";
import { readClassTable, readOpcodeNames, readPropertyOffsets, readSelectorNames } from "../../../src/games/gk1/data/vocab";
import { mainIndex, original } from "./real";

describe("vocabulaires SCI2", () => {
  it("lit des noms de sélecteurs", () => {
    // 2 noms : « x » et « doit ».
    const data = Uint8Array.from([1, 0, 6, 0, 9, 0, 1, 0, 0x78, 4, 0, 0x64, 0x6f, 0x69, 0x74]);
    expect(readSelectorNames(data)).toEqual(["x", "doit"]);
    expect(() => readSelectorNames(data.subarray(0, 13))).toThrow(/hors du vocabulaire/);
    expect(() => readSelectorNames(Uint8Array.of(9, 0, 1, 0))).toThrow(/tronqué/);
  });

  it("lit une table de classes, des opcodes et le vocabulaire 994", () => {
    expect(readClassTable(Uint8Array.of(0, 0, 0xe7, 0xfd, 0, 0, 10, 0))).toEqual([64999, 10]);
    expect(() => readClassTable(new Uint8Array(6))).toThrow(/taille inattendue/);
    // 1 opcode : type 2, « add ».
    expect(readOpcodeNames(Uint8Array.from([1, 0, 4, 0, 5, 0, 2, 0, 0x61, 0x64, 0x64]))).toEqual([{ type: 2, name: "add" }]);
    expect(() => readOpcodeNames(Uint8Array.from([1, 0, 4, 0, 1, 0, 2]))).toThrow(/hors du vocabulaire/);
    expect(readPropertyOffsets(Uint8Array.of(26, 0, 27, 0))).toEqual([26, 27]);
    expect(() => readPropertyOffsets(new Uint8Array(3))).toThrow(/impaire/);
  });
});

describe.skipIf(!original.has)("vocabulaires de Gabriel Knight", () => {
  it("lit les 4 104 sélecteurs", () => {
    const names = readSelectorNames(mainIndex().get(ResourceType.Vocab, VOCAB_SELECTOR_NAMES));
    expect(names).toHaveLength(4104);
    expect(names.slice(0, 10)).toEqual(["plane", "x", "y", "z", "scaleX", "scaleY", "maxScale", "priority", "fixPriority", "inLeft"]);
    expect(names.slice(4096, 4104)).toEqual(["-objID-", "-size-", "-propDict-", "-methDict-", "-classScript-", "-script-", "-super-", "-info-"]);
    for (const expected of ["name", "doit", "init", "play", "view", "loop", "cel", "signal"]) expect(names).toContain(expected);
  });

  it("lit la table des 169 classes, les 128 opcodes et les 79 mots du vocabulaire 994", () => {
    const index = mainIndex();
    const classes = readClassTable(index.get(ResourceType.Vocab, VOCAB_CLASS_TABLE));
    expect(classes).toHaveLength(169);
    expect(classes[0]).toBe(64999);
    for (const script of classes) expect(index.has(ResourceType.Script, script)).toBe(true);

    const opcodes = readOpcodeNames(index.get(ResourceType.Vocab, VOCAB_OPCODE_NAMES));
    expect(opcodes).toHaveLength(128);
    expect(opcodes.slice(0, 12).map((o) => o.name)).toEqual(["bnot", "add", "sub", "mul", "div", "mod", "shr", "shl", "xor", "and", "or", "neg"]);
    expect(opcodes.slice(124).map((o) => o.name)).toEqual(["-sgi", "-sli", "-sti", "-spi"]);

    // Le vocabulaire 994 est une liste de numéros de sélecteurs : les propriétés que l'interpréteur lit directement.
    const names = readSelectorNames(index.get(ResourceType.Vocab, VOCAB_SELECTOR_NAMES));
    const words = readPropertyOffsets(index.get(ResourceType.Vocab, VOCAB_PROPERTY_OFFSETS));
    expect(words).toHaveLength(79);
    expect(words.slice(0, 12).map((w) => names[w])).toEqual(["signal", "illegalBits", "cursor", "style", "state", "font", "key", "max", "useInsetRect", "view", "loop", "cel"]);
    expect(words.every((w) => w < 4096 && names[w].length > 0)).toBe(true);
  });
});
