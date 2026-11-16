import { describe, expect, it } from "vitest";
import { encodeCp850 } from "../../../src/data/cp850";
import { ResourceType } from "../../../src/games/gk1/data/ids";
import { findMessage, messageKey, readMessages, TALKER_NARRATOR } from "../../../src/games/gk1/data/message";
import { mainIndex, original, tally } from "./real";

interface Row {
  key: [number, number, number, number];
  talker: number;
  text: string;
  ref?: [number, number, number];
  comment?: string;
}

/** Ressource message synthétique, au format 4. */
function buildMessages(rows: Row[], version = 4321): Uint8Array {
  const texts = rows.map((r) => [...encodeCp850(r.text), 0]);
  const tails = rows.map((r) => [...encodeCp850(r.comment ?? ""), 0, 1, 2, 3, 4, 5, 6]);
  const textStart = 10 + 11 * rows.length;
  const textEnd = textStart + texts.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(textEnd + tails.reduce((n, t) => n + t.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, version, true);
  view.setUint16(4, textEnd - 6, true);
  view.setUint16(8, rows.length, true);
  let offset = textStart;
  rows.forEach((r, i) => {
    const p = 10 + 11 * i;
    out.set([...r.key, r.talker], p);
    view.setUint16(p + 5, offset, true);
    out.set([...(r.ref ?? [0, 0, 0]), 1], p + 7);
    out.set(texts[i], offset);
    offset += texts[i].length;
  });
  for (const tail of tails) {
    out.set(tail, offset);
    offset += tail.length;
  }
  return out;
}

describe("messages SCI2", () => {
  const rows: Row[] = [
    { key: [1, 2, 3, 1], talker: 99, text: "Déjà là, près du café." },
    { key: [1, 2, 3, 2], talker: 1, text: "Ça alors !", comment: "note" },
    { key: [4, 0, 0, 1], talker: 99, text: "R copie", ref: [1, 2, 3] },
  ];

  it("lit les entrées, le texte CP850, les renvois et les commentaires", () => {
    const resource = readMessages(buildMessages(rows));
    expect(resource.version).toBe(4321);
    expect(resource.entries.map((e) => [messageKey(e), e.talker, e.text, e.comment])).toEqual([
      ["1-2-3-1", 99, "Déjà là, près du café.", ""],
      ["1-2-3-2", 1, "Ça alors !", "note"],
      ["4-0-0-1", 99, "R copie", ""],
    ]);
    expect(resource.entries[0].raw[1]).toBe(0x82);
    expect(resource.entries[0].ref).toBeUndefined();
    expect(resource.entries[2].ref).toEqual({ noun: 1, verb: 2, cond: 3, seq: 1 });
    expect(findMessage(resource, resource.entries[2].ref!)).toBe(resource.entries[0]);
    expect(findMessage(resource, { noun: 9, verb: 9, cond: 9, seq: 9 })).toBeUndefined();
    expect(resource.entries[0].talker).toBe(TALKER_NARRATOR);
  });

  it("refuse une version inconnue, un texte hors zone et des octets en trop", () => {
    expect(() => readMessages(buildMessages(rows, 3411))).toThrow(/version de messages 3411/);
    const bytes = buildMessages(rows);
    expect(() => readMessages(Uint8Array.from([...bytes, 0]))).toThrow(/inexpliqués/);
    expect(() => readMessages(bytes.subarray(0, bytes.length - 3))).toThrow(/tronquée/);
    const moved = bytes.slice();
    new DataView(moved.buffer).setUint16(10 + 5, 4, true);
    expect(() => readMessages(moved)).toThrow(/hors de la zone/);
    expect(() => readMessages(bytes.subarray(0, 6))).toThrow(/tronquée/);
  });
});

/** Nombre de glyphes de toutes les polices sauf la 2. */
const FONT_GLYPHS = 226;

describe.skipIf(!original.has)("messages de Gabriel Knight", () => {
  it("lit les 10 982 messages français des 77 modules, sans reste", () => {
    const index = mainIndex();
    const modules = index.numbers(ResourceType.Message);
    expect(modules).toHaveLength(77);
    let total = 0;
    let refs = 0;
    let comments = 0;
    const versions: number[] = [];
    const talkers = new Map<number, number>();
    const high = new Set<string>();
    let markup = 0;
    const escapes: string[] = [];
    /** Messages dont un octet dépasse les 226 glyphes des polices courantes (« ° », 0xF8). */
    const outOfFont: string[] = [];
    for (const n of modules) {
      const resource = readMessages(index.get(ResourceType.Message, n));
      versions.push(resource.version);
      const keys = new Set(resource.entries.map(messageKey));
      expect(keys.size).toBe(resource.entries.length);
      for (const entry of resource.entries) {
        total++;
        talkers.set(entry.talker, (talkers.get(entry.talker) ?? 0) + 1);
        if (entry.comment) comments++;
        if (/\|[a-zA-Z]\d*\|/.test(entry.text)) markup++;
        const escape = /\\[0-9A-Fa-f]{2}/.exec(entry.text);
        if (escape) escapes.push(`${n}:${escape[0]}`);
        entry.raw.forEach((b, i) => b > 127 && high.add(entry.text[i]));
        if (entry.raw.some((b) => b >= FONT_GLYPHS)) outOfFont.push(`${n}:${messageKey(entry)}`);
        if (!entry.ref) continue;
        refs++;
        // Un renvoi vise toujours la séquence 1 d'un message du même module.
        expect(findMessage(resource, entry.ref)).toBeDefined();
      }
    }
    expect(total).toBe(10982);
    expect(Object.fromEntries(tally(versions))).toEqual({ 4321: 53, 4330: 24 });
    expect(refs).toBe(2441);
    expect(comments).toBe(1358);
    expect(talkers.size).toBe(67);
    expect(talkers.get(TALKER_NARRATOR)).toBe(4346);
    expect(talkers.get(1)).toBe(2712);
    expect(markup).toBe(0);
    expect(escapes).toEqual(["64990:\\1e", "64990:\\1d"]);
    expect(outOfFont).toEqual(["0:29-0-8-1", "0:29-0-8-6", "440:4-10-0-4"]);
    expect([...high].sort().join("")).toBe("°ßàâäçèéêëîïôöùûü");
  });

  it("décode une réplique accentuée de la librairie", () => {
    const resource = readMessages(mainIndex().get(ResourceType.Message, 210));
    expect(resource.entries.some((e) => e.text === "\"Bien, j'espère qu'il te mettra en prison ensuite.\"")).toBe(true);
  });
});
