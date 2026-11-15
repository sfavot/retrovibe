import { describe, expect, it } from "vitest";
import {
  ACTOR_END,
  ACTOR_INVSTAT,
  ACTOR_MOVE,
  ACTOR_STAT,
  CURSORS,
  CURSOR_PALETTE,
  CURSOR_TRANSPARENT,
  CursorType,
  cursorPixels,
  END_TEXT_FRENCH,
  FALLBACK_LANGUAGE_STRINGS,
  NOTE_TABLE,
  OPL_FREQ_TABLE,
  OPL_OPERATORS_TABLE,
  OPL_VOICE_OPERATORS_TABLE,
} from "../../../src/games/croisiere/data/static-tables";

/** FNV-1a 32 bits des valeurs écrites en décimal, séparées par des virgules (même calcul que l'extraction du source de ScummVM). */
function checksum(values: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(values.join(","))) h = Math.imul(h ^ c, 0x01000193) >>> 0;
  return `0x${h.toString(16).padStart(8, "0")}`;
}

describe("static-tables (staticres.cpp, release 2026.4.0)", () => {
  it("mouvements d'acteur : 4 directions de 13 entrées terminées par 0, sommes de contrôle", () => {
    for (const table of [ACTOR_MOVE, ACTOR_END, ACTOR_STAT, ACTOR_INVSTAT]) {
      expect(table).toHaveLength(4);
      for (const row of table) expect(row).toHaveLength(13);
    }
    for (const row of ACTOR_MOVE) expect(row[12]).toBe(0);
    expect(checksum(ACTOR_MOVE.flat())).toBe("0xe1f24209");
    expect(checksum(ACTOR_END.flat())).toBe("0xd691cf52");
    expect(checksum(ACTOR_STAT.flat())).toBe("0x0349a011");
    expect(checksum(ACTOR_INVSTAT.flat())).toBe("0x9e4c1e51");
    // La marche à gauche est la marche à droite en miroir ; l'attente inverse renverse l'attente.
    expect(ACTOR_MOVE[3]!.map(Math.abs)).toEqual(ACTOR_MOVE[1]);
    expect(ACTOR_END[3]![0]).toBe(-ACTOR_END[1]![0]!);
    expect(ACTOR_INVSTAT[1]!.slice(0, 5)).toEqual([...ACTOR_STAT[0]!.slice(0, 5)].reverse());
  });

  it("curseurs : 7 types, 64 octets, sommes de contrôle et points chauds", () => {
    expect(CURSORS).toHaveLength(7);
    const expected: Record<keyof typeof CursorType, [string, number, number]> = {
      normal: ["0x6c05ed78", 1, 1],
      disk: ["0x1e473bd9", 0, 0],
      cross: ["0x8a6f7f83", 7, 7],
      noMouse: ["0x29aad26b", 0, 0],
      walk: ["0x7328e483", 10, 6],
      exit: ["0x19073f65", 10, 6],
      magnifyingGlass: ["0xc70c93db", 10, 6],
    };
    for (const [name, index] of Object.entries(CursorType)) {
      const cursor = CURSORS[index]!;
      const [sum, hx, hy] = expected[name as keyof typeof CursorType];
      expect(cursor.bitmap, name).toHaveLength(64);
      expect(checksum(Array.from(cursor.bitmap)), name).toBe(sum);
      expect([cursor.hotspotX, cursor.hotspotY], name).toEqual([hx, hy]);
    }
    expect(CURSOR_PALETTE).toEqual([[0, 0, 0], [255, 255, 255]]);
  });

  it("cursorPixels : forme = 1, contour seul = 0, reste transparent", () => {
    const normal = cursorPixels(CURSORS[CursorType.normal]!);
    expect(normal).toHaveLength(256);
    // Ligne 0 : forme 0x0000, contour 0xC000 -> deux pixels noirs à gauche. Ligne 1 : forme 0x4000 (pixel 1 blanc), contour 0xE000.
    expect(Array.from(normal.subarray(0, 4))).toEqual([0, 0, CURSOR_TRANSPARENT, CURSOR_TRANSPARENT]);
    expect(Array.from(normal.subarray(16, 20))).toEqual([0, 1, 0, CURSOR_TRANSPARENT]);
    const none = cursorPixels(CURSORS[CursorType.noMouse]!);
    expect(none.every((p) => p === CURSOR_TRANSPARENT)).toBe(true);
    const ones = cursorPixels(CURSORS[CursorType.disk]!).filter((p) => p === 1).length;
    expect(ones).toBeGreaterThan(50);
  });

  it("chaînes de repli et texte de fin", () => {
    expect(FALLBACK_LANGUAGE_STRINGS.french).toHaveLength(13);
    expect(FALLBACK_LANGUAGE_STRINGS.english).toHaveLength(13);
    expect(FALLBACK_LANGUAGE_STRINGS.french[0]).toBe(""); // pause vide : DELPHINE.LNG prime
    expect(FALLBACK_LANGUAGE_STRINGS.french[5]).toBe("Inventaire");
    expect(FALLBACK_LANGUAGE_STRINGS.english[12]).toBe("Quit");
    expect(END_TEXT_FRENCH).toBe("Fin");
  });
});

describe("static-tables (sound.cpp)", () => {
  it("tables OPL2 : tailles et sommes de contrôle", () => {
    expect(NOTE_TABLE).toHaveLength(96);
    expect(OPL_FREQ_TABLE).toHaveLength(12);
    expect(OPL_OPERATORS_TABLE).toHaveLength(18);
    expect(OPL_VOICE_OPERATORS_TABLE).toHaveLength(22);
    expect(checksum(NOTE_TABLE)).toBe("0xfed9fc76");
    expect(checksum(OPL_FREQ_TABLE)).toBe("0x517d665f");
    expect(checksum(OPL_OPERATORS_TABLE)).toBe("0x3c5ebd6c");
    expect(checksum(OPL_VOICE_OPERATORS_TABLE)).toBe("0x22d25fb2");
    // Les périodes décroissent (notes de plus en plus aiguës), de 0xEEE à 0x00F ; les F-number croissent.
    for (let i = 1; i < NOTE_TABLE.length; i++) expect(NOTE_TABLE[i]!).toBeLessThan(NOTE_TABLE[i - 1]!);
    expect([NOTE_TABLE[0], NOTE_TABLE[95]]).toEqual([0xeee, 0x00f]);
    for (let i = 1; i < OPL_FREQ_TABLE.length; i++) expect(OPL_FREQ_TABLE[i]!).toBeGreaterThan(OPL_FREQ_TABLE[i - 1]!);
  });
});
