import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTROL_FLOW_NAMES, disassemble } from "../../src/games/lost-in-time/engine/opcodes";
import { loadResources } from "../../src/games/lost-in-time/engine/resources";
import { Script } from "../../src/games/lost-in-time/engine/script";
import { hasOriginalFiles, loadArchive } from "./helpers";

const fixture: Record<string, string[]> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "fixtures/degob-ops.json"), "utf8"),
);

/** TOT dont degob se désynchronise (opcode 0.4 / zones corrompues) : voir les explications ci-dessous. */
export const DEGOB_BROKEN = ["EMAM1000", "EMAM1017", "EMAM1104"];

export function disassembleTot(name: string, problems: string[] = []): string[] {
  const archive = loadArchive("INTRO.STK");
  const res = loadResources(archive, name, "fr")!;
  const script = new Script(name, res.tot.script, res.tot.header);
  const ops = disassemble(script, res, problems).filter((o) => !CONTROL_FLOW_NAMES.has(o.name));
  ops.sort((a, b) => a.offset - b.offset || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return ops.map((o) => `${o.offset}:${o.name}`);
}

describe.skipIf(!hasOriginalFiles)("désassemblage vs degob", () => {
  for (const name of Object.keys(fixture)) {
    it(name, () => {
      const problems: string[] = [];
      const mine = disassembleTot(name, problems);
      const theirs = fixture[name];
      // Chaque bloc se termine exactement à sa fin déclarée : validation indépendante de degob.
      expect(problems).toEqual([]);
      if (!DEGOB_BROKEN.includes(name)) {
        expect(mine).toEqual(theirs);
        return;
      }
      // degob lit 5 mots pour o2_goblinFunc (100 = o3_wobble n'en a que 2) et se désynchronise
      // ensuite (« No such opcodeFunc 0.4 », zones corrompues) puis s'arrête. Tout ce qu'il
      // imprime avant ce point doit être identique ; après, ce sont des faux opcodes.
      const parse = (e: string): [number, string] => {
        const [o, n] = e.split(":");
        return [Number(o), n];
      };
      const firstGob = Math.min(...mine.map(parse).filter(([, n]) => n === "o2_goblinFunc").map(([o]) => o));
      const mineSet = new Set(mine);
      expect(theirs.filter((e) => parse(e)[0] < firstGob && !mineSet.has(e))).toEqual([]);
      expect(theirs.filter((e) => !mineSet.has(e)).every((e) => parse(e)[0] > firstGob)).toBe(true);
      expect(theirs.filter((e) => parse(e)[1] === "o2_goblinFunc").every((e) => mineSet.has(e))).toBe(true);
    });
  }
});
