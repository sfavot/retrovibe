import { describe, expect, it } from "vitest";
import {
  COMPACT_ELEM_COUNT,
  COMPACT_FIELD_COUNT,
  COMPACT_WORDS,
  CompactField,
  C_ACTION_MODE,
  C_ANIM_UP,
  C_BASE_MODE,
  C_GRID_WIDTH,
  C_MEGA_SET,
  C_SP_COLOR,
  C_STAND_UP,
  C_TURN_TABLE,
  MEGASET_WORDS,
  MegaSetField,
  NEXT_MEGA_SET,
  compactElemLocation,
  megaSetBase,
  megaSetIndex,
  megaSetWord,
  toInt16,
} from "../../../src/games/bass/data/compact-fields";
import { CptType } from "../../../src/games/bass/data/cpt";
import { hasOriginalFiles, skyCpt } from "./helpers";

describe("champs de compact", () => {
  it("numérote 55 champs distincts de 0 à 54 puis quatre MegaSet de 14 mots", () => {
    const values = Object.values(CompactField).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: COMPACT_FIELD_COUNT }, (_, i) => i));
    const mega = Object.values(MegaSetField).sort((a, b) => a - b);
    expect(mega).toEqual(Array.from({ length: MEGASET_WORDS }, (_, i) => i));
    expect(COMPACT_WORDS).toBe(111);
    expect(megaSetBase(0)).toBe(55);
    expect(megaSetBase(3)).toBe(55 + 3 * 14);
  });

  it("traduit les décalages DOS des scripts (skydefs.h) en indices de mot", () => {
    expect(NEXT_MEGA_SET).toBe(144);
    expect(COMPACT_ELEM_COUNT).toBe(114 + 4 * 144);
    expect(compactElemLocation(C_BASE_MODE)).toEqual({ source: "compact", megaSet: 0, word: CompactField.logic });
    expect(compactElemLocation(C_ACTION_MODE)).toEqual({ source: "compact", megaSet: 0, word: CompactField.sync });
    expect(compactElemLocation(C_SP_COLOR)).toEqual({ source: "compact", megaSet: 0, word: CompactField.spColor });
    expect(compactElemLocation(C_MEGA_SET)).toEqual({ source: "compact", megaSet: 0, word: CompactField.megaSet });
    expect(compactElemLocation(C_GRID_WIDTH)).toEqual({ source: "megaSet", megaSet: 0, word: MegaSetField.gridWidth });
    expect(compactElemLocation(C_ANIM_UP)).toEqual({ source: "megaSet", megaSet: 0, word: MegaSetField.animUpId });
    expect(compactElemLocation(C_STAND_UP)).toEqual({ source: "megaSet", megaSet: 0, word: MegaSetField.standUpId });
    expect(compactElemLocation(C_TURN_TABLE)).toEqual({ source: "turnTable", megaSet: 0, word: 0 });
    // Direction `dir` du `MegaSet` de rang 1 : `C_ANIM_UP + megaSet + dir * 4`.
    expect(compactElemLocation(C_ANIM_UP + NEXT_MEGA_SET + 3 * 4)).toEqual({ source: "megaSet", megaSet: 1, word: MegaSetField.animRightId });
    expect(compactElemLocation(C_TURN_TABLE + 3 * NEXT_MEGA_SET + 4 * 7)).toEqual({ source: "turnTable", megaSet: 3, word: 7 });
    // Un décalage au milieu d'un champ de 4 octets désigne le premier mot, comme dans ScummVM.
    expect(compactElemLocation(C_ANIM_UP + 2).word).toBe(0);
    expect(() => compactElemLocation(COMPACT_ELEM_COUNT)).toThrow(RangeError);
    expect(() => compactElemLocation(-1)).toThrow(RangeError);
  });

  it("choisit le MegaSet d'après le champ megaSet et lit des mots signés", () => {
    expect([0, 144, 288, 432].map(megaSetIndex)).toEqual([0, 1, 2, 3]);
    expect(() => megaSetIndex(2)).toThrow(RangeError);
    expect(() => megaSetIndex(576)).toThrow(RangeError);
    const cpt = new Uint16Array(111);
    cpt[CompactField.megaSet] = 144;
    cpt[megaSetBase(1) + MegaSetField.gridWidth] = 7;
    expect(megaSetWord(cpt, MegaSetField.gridWidth)).toBe(7);
    expect(toInt16(0xfffe)).toBe(-2);
    expect(toInt16(5)).toBe(5);
  });
});

describe.skipIf(!hasOriginalFiles)("champs de compact (sky.cpt du jeu)", () => {
  it("Foster (compact 3) : un compact complet de 111 mots dont le MegaSet actif est valide", () => {
    const foster = skyCpt().get(3)!;
    expect(foster.type).toBe(CptType.compact);
    expect(foster.size).toBe(COMPACT_WORDS);
    expect(() => megaSetIndex(foster.data[CompactField.megaSet]!)).not.toThrow();
    // Les tables d'animation et de rotation désignées existent.
    const turnTable = skyCpt().get(megaSetWord(foster.data, MegaSetField.turnTableId))!;
    expect(turnTable.type).toBe(CptType.turnTable);
    expect(turnTable.size).toBe(25);
  });
});
