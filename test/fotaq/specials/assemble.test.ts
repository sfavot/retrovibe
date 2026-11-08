import { describe, expect, it } from "vitest";
import type { Sequence } from "../../../src/engine/sequence";
import type { FotaqEngine } from "../../../src/games/fotaq/engine/loop";
import { GROUPS, fotaqScript } from "../../../src/games/fotaq/engine/specials";
import { type GroupScript, assembleSpecials } from "../../../src/games/fotaq/engine/specials/assemble";
import { OWNERSHIP } from "../../../src/games/fotaq/engine/specials/ownership";

function drain<T>(sequence: Sequence<T>): T {
  const step = sequence.next();
  if (!step.done) throw new Error("la séquence attend");
  return step.value;
}
const fake = (room: number) => ({ state: { room } }) as unknown as FotaqEngine;
const noop = function* (): Sequence {};

describe("assemblage des groupes (specials/assemble.ts)", () => {
  it("fusionne les mouvements, les pièces spéciales, les zones et les animations de pièce de chaque groupe", () => {
    const update = () => undefined;
    const script = assembleSpecials({
      1: { specialMoves: { 3: noop }, specialAreas: { 4: function* () { return "C4A.CUT"; } } },
      2: { specialMoves: { 4: noop }, specialRooms: { 95: function* () { return true; } }, roomUpdates: { 74: update } },
    });
    expect(Object.keys(script.specialMoves!)).toEqual(["3", "4"]);
    expect(script.roomUpdates![74]).toBe(update);
  });

  it("refuse un même numéro défini par deux groupes, quelle que soit la table", () => {
    const twice = (key: keyof GroupScript, number: number): (() => unknown) => {
      const item: GroupScript = { [key]: { [number]: key === "roomUpdates" ? () => undefined : noop } } as GroupScript;
      return () => assembleSpecials({ 1: item, 2: item });
    };
    expect(twice("specialMoves", 7)).toThrow(/groupes 1 et 2 : mouvement spécial 7/);
    expect(twice("specialRooms", 95)).toThrow(/pièce spéciale 95/);
    expect(twice("specialAreas", 22)).toThrow(/zones éteintes de la pièce 22/);
    expect(twice("roomUpdates", 74)).toThrow(/animation de la pièce 74/);
  });

  it("aiguille changeToSpecialRoom et handleSpecialArea sur la pièce courante, avec les valeurs par défaut sinon", () => {
    const script = assembleSpecials({
      1: {
        specialRooms: { 95: function* () { return true; } },
        specialAreas: { 4: function* (_g, _facing, area) { return `zone ${area}`; } },
      },
    });
    expect(drain(script.changeToSpecialRoom!(fake(95)))).toBe(true);
    expect(drain(script.changeToSpecialRoom!(fake(96)))).toBe(false);
    expect(drain(script.handleSpecialArea!(fake(4), 1, 3, 2))).toBe("zone 3");
    expect(drain(script.handleSpecialArea!(fake(5), 1, 3, 2))).toBe("");
  });
});

describe("convention des groupes (ownership.ts)", () => {
  const all = Object.keys(OWNERSHIP).map(Number);

  it("les six groupes sont créés et importés, même vides", () => {
    expect(Object.keys(GROUPS).map(Number)).toEqual(all);
    expect(all).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("les groupes ne se recouvrent pas : une pièce et un mouvement n'ont qu'un propriétaire", () => {
    for (const kind of ["rooms", "moves"] as const) {
      const seen = new Map<number, number>();
      for (const n of all) {
        for (const value of OWNERSHIP[n][kind]) {
          expect(seen.get(value), `${kind} ${value} : groupes ${seen.get(value)} et ${n}`).toBeUndefined();
          seen.set(value, n);
        }
      }
    }
  });

  it("tous les mouvements spéciaux de la version DOS (2 à 34 sauf 1 et 35, 36 à 39) ont un groupe", () => {
    const owned = new Set(all.flatMap((n) => OWNERSHIP[n].moves));
    const expected = [...Array.from({ length: 33 }, (_, i) => i + 2), 36, 37, 38, 39].filter((n) => n !== 35);
    expect([...owned].sort((a, b) => a - b)).toEqual(expected);
  });

  it("chaque groupe ne définit que les pièces et les mouvements qui sont à lui", () => {
    for (const n of all) {
      const group: GroupScript = GROUPS[n as keyof typeof GROUPS];
      const owned = OWNERSHIP[n];
      for (const move of Object.keys(group.specialMoves ?? {}).map(Number)) expect(owned.moves, `groupe ${n}, mouvement ${move}`).toContain(move);
      for (const table of [group.specialRooms, group.specialAreas, group.roomUpdates]) {
        for (const room of Object.keys(table ?? {}).map(Number)) expect(owned.rooms, `groupe ${n}, pièce ${room}`).toContain(room);
      }
    }
  });

  it("le script assemblé du jeu fournit les accroches du moteur", () => {
    expect(fotaqScript.changeToSpecialRoom).toBeTypeOf("function");
    expect(fotaqScript.handleSpecialArea).toBeTypeOf("function");
    expect(Object.keys(fotaqScript.specialMoves!).length).toBeGreaterThanOrEqual(9);
  });
});
