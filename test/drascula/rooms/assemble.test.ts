import { describe, expect, it } from "vitest";
import type { DrasculaEngine } from "../../../src/games/drascula/engine/loop";
import { CHAPTERS, drasculaScript } from "../../../src/games/drascula/engine/rooms";
import { assembleScript } from "../../../src/games/drascula/engine/rooms/assemble";
import type { ChapterScript } from "../../../src/games/drascula/engine/script";
import type { Sequence } from "../../../src/games/drascula/engine/sequence";
import { ROOM_CHAPTERS } from "../engine/rooms";

const fakeEngine = (chapter: number) => ({ chapter }) as unknown as DrasculaEngine;
function drain<T>(sequence: Sequence<T>): T {
  const step = sequence.next("ok");
  if (!step.done) throw new Error("la séquence attend");
  return step.value;
}

describe("assemblage des chapitres", () => {
  const handler = (answer: boolean) =>
    function* (): Sequence<boolean> {
      return answer;
    };

  it("fusionne les gestionnaires, les painters et les animations de chaque chapitre", () => {
    const painter = { pre: () => undefined };
    const chapters: Record<number, ChapterScript> = {
      1: { rooms: { 62: handler(true) }, painters: { 62: painter }, animations: { "2_1": function* () {} } },
      2: { rooms: { 14: handler(false) }, animations: { "16_2": function* () {} } },
    };
    const script = assembleScript(chapters, { animations: { "1_1": function* () {} } });
    expect(Object.keys(script.rooms!)).toEqual(["14", "62"]);
    expect(script.painters![1]![62]).toBe(painter);
    expect(Object.keys(script.animations!).sort()).toEqual(["16_2", "1_1", "2_1"]);
  });

  it("range les painters par chapitre : une même pièce peut avoir un painter dans deux chapitres", () => {
    const first = { pre: () => undefined };
    const second = { post: () => undefined };
    const script = assembleScript({ 1: { painters: { 16: first } }, 2: { painters: { 16: second } } });
    expect(script.painters![1]![16]).toBe(first);
    expect(script.painters![2]![16]).toBe(second);
  });

  it("refuse une même clé dans deux chapitres, ou une animation déjà fournie par les cinématiques communes", () => {
    const handlers = (n: number): ChapterScript => ({ rooms: { [n]: handler(true) } });
    expect(() => assembleScript({ 1: handlers(5), 2: handlers(5) })).toThrow(/chapitres 1 et 2 : pièce \(gestionnaire\) 5/);
    expect(() => assembleScript({ 1: { animations: { x: function* () {} } }, 2: { animations: { x: function* () {} } } })).toThrow(/animation x/);
    expect(() => assembleScript({ 4: { animations: { castle: function* () {} } } }, { animations: { castle: function* () {} } })).toThrow(/cinématiques communes/);
  });

  it("n'appelle les points globaux que pour le chapitre en cours, avec les valeurs par défaut de ScummVM sinon", () => {
    const calls: string[] = [];
    const chapter2: ChapterScript = {
      *checkAction(_g, id) {
        calls.push(`check ${id}`);
        return true;
      },
      *canExit() {
        return false;
      },
      *leaving() {
        return false;
      },
      roomLoaded: () => void calls.push("loaded"),
      tick: () => void calls.push("tick"),
      frame: () => (function* () {})(),
    };
    const script = assembleScript({ 2: chapter2 });
    expect(drain(script.checkAction!(fakeEngine(2), 7))).toBe(true);
    expect(drain(script.checkAction!(fakeEngine(1), 7))).toBe(false);
    expect(drain(script.canExit!(fakeEngine(2), 0))).toBe(false);
    expect(drain(script.canExit!(fakeEngine(3), 0))).toBe(true);
    expect(drain(script.leaving!(fakeEngine(2), 0))).toBe(false);
    expect(drain(script.leaving!(fakeEngine(6), 0))).toBe(true);
    script.roomLoaded!(fakeEngine(1));
    script.roomLoaded!(fakeEngine(2));
    script.tick!(fakeEngine(5));
    script.tick!(fakeEngine(2));
    expect(calls).toEqual(["check 7", "loaded", "tick"]);
    expect(script.frame!(fakeEngine(1))).toBeNull();
    expect(script.frame!(fakeEngine(2))).not.toBeNull();
  });
});

describe("le script du jeu", () => {
  it("assemble les six chapitres et les cinématiques communes", () => {
    expect(Object.keys(CHAPTERS)).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const name of ["1_1", "castle", "1_6", "5_6", "9_6"]) expect(drasculaScript.animations![name], name).toBeTypeOf("function");
  });

  // Convention (docs/drascula/rooms.md) : un chapitre ne définit que des pièces de son chapitre, et nomme ses animations `<n>_<chapitre>`.
  it.each(Object.entries(CHAPTERS))("le chapitre %s ne définit que ses pièces et ses animations", (key, script) => {
    const chapter = Number(key);
    const rooms = new Map(ROOM_CHAPTERS);
    const keys = [...Object.keys(script.rooms ?? {}), ...Object.keys(script.painters ?? {})].map(Number);
    // Exception : la chambre de B.J. du chapitre 1 est la « pièce 16 » de ScummVM (`update_16_pre`), un numéro du chapitre 2.
    for (const room of keys) if (!(chapter === 1 && room === 16)) expect(rooms.get(room), `pièce ${room}`).toBe(chapter);
    for (const name of Object.keys(script.animations ?? {})) expect(name, name).toMatch(new RegExp(`^\\d+_${chapter}$`));
  });
});
