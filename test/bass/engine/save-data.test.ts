import { describe, expect, it } from "vitest";
import { FONT_SPECS } from "../../../src/games/bass/data/font";
import { FILE_LIST_SIZE, ITEM_LIST_SIZE } from "../../../src/games/bass/engine/files";
import { NUM_SCRIPT_VARS, Var } from "../../../src/games/bass/engine/ids";
import { type SaveContent, parseSaveWords, writeSaveWords } from "../../../src/games/bass/engine/save-data";

const COMPACT_WORDS = 6;

function content(patch: Partial<SaveContent> & { section?: number } = {}): SaveContent {
  const vars = new Uint32Array(NUM_SCRIPT_VARS);
  vars[Var.CUR_SECTION] = patch.section ?? 2;
  const reloadList = new Uint32Array(FILE_LIST_SIZE);
  reloadList.set([0x8000 | 202, 150, 3]);
  return { gameVersion: 288, sounds: [0, 0], music: 1, charSet: 0, mouseType: 1, palette: 0, vars, reloadList, compactWords: new Uint16Array(COMPACT_WORDS).fill(7), ...patch };
}

const read = (c: SaveContent) => parseSaveWords(writeSaveWords(c), COMPACT_WORDS);

describe("sauvegarde (mots) : lecture validée avant toute restitution", () => {
  it("une sauvegarde valide se relit à l'identique", () => {
    const c = content();
    const data = read(c);
    expect(data.header.charSet).toBe(0);
    expect(data.vars[Var.CUR_SECTION]).toBe(2);
    expect(Array.from(data.reloadList.subarray(0, 4))).toEqual([0x8000 | 202, 150, 3, 0]);
    expect(Array.from(data.compactWords)).toEqual(Array.from(c.compactWords));
  });

  it("une police hors de la table est refusée", () => {
    expect(() => read(content({ charSet: FONT_SPECS.length }))).toThrow();
    expect(() => read(content({ charSet: 0xffffffff }))).toThrow();
    expect(() => read(content({ charSet: FONT_SPECS.length - 1 }))).not.toThrow();
  });

  it("une section inexistante est refusée", () => {
    expect(() => read(content({ section: 6 }))).toThrow();
    expect(() => read(content({ section: 0xffffffff }))).toThrow();
    expect(() => read(content({ section: 5 }))).not.toThrow();
  });

  it("une liste de fichiers non terminée, ou visant un emplacement hors de la table, est refusée", () => {
    expect(() => read(content({ reloadList: new Uint32Array(FILE_LIST_SIZE).fill(150) }))).toThrow();
    const full = new Uint32Array(FILE_LIST_SIZE).fill(150);
    full[FILE_LIST_SIZE - 1] = 0;
    expect(() => read(content({ reloadList: full }))).not.toThrow();
    const slot = new Uint32Array(FILE_LIST_SIZE);
    slot[0] = ITEM_LIST_SIZE;
    expect(() => read(content({ reloadList: slot }))).toThrow();
  });
});
