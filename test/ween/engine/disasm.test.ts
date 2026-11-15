import { describe, expect, it } from "vitest";
import { CONTROL_FLOW_NAMES, disassemble, opcodeTable } from "../../../src/engine/coktel/opcodes";
import { loadResources } from "../../../src/engine/coktel/resources";
import { Script } from "../../../src/engine/coktel/script";
import { entriesWithExt, hasOriginalFiles, loadIntro } from "../helpers";

/**
 * Désassemblage des 67 TOT avec la table de l'interpréteur v2 (Inter_v2, celle de Ween) : toutes les fonctions
 * atteignables se décodent sans opcode inconnu, et chaque bloc finit à sa fin déclarée, sauf le bloc @190
 * d'INTRO1.TOT (`docs/ween/formats.md` § 15.3 : son `else` final bute sur la fin du script, sans effet).
 */
describe.skipIf(!hasOriginalFiles)("désassemblage v2 des TOT de Ween", () => {
  it("67 TOT, aucun opcode inconnu, aucune fin de bloc inattendue", () => {
    const table = opcodeTable(2);
    const names = entriesWithExt(".TOT");
    expect(names).toHaveLength(67);
    const problems: string[] = [];
    const used = new Map<string, number>();
    let total = 0;
    for (const name of names) {
      const res = loadResources(loadIntro(), name, "fr");
      expect(res, name).not.toBeNull();
      const script = new Script(name, res!.tot.script, res!.tot.header);
      const found: string[] = [];
      const ops = disassemble(script, res, found, table);
      problems.push(...found.map((p) => `${name} ${p}`));
      total += ops.length;
      for (const op of ops) if (!CONTROL_FLOW_NAMES.has(op.name)) used.set(op.name, (used.get(op.name) ?? 0) + 1);
    }
    expect(problems).toEqual(["INTRO1.TOT bloc @190 : fin à 1225, attendue 1237"]);
    expect(total).toBeGreaterThan(10_000);
    // Les surcharges v3 de Lost in Time n'apparaissent pas ; les opcodes propres à Ween sont décodés.
    expect([...used.keys()].filter((n) => n.startsWith("o3_"))).toEqual([]);
    for (const name of ["o2_playImd", "o2_totSub", "o2_goblinFunc", "o1_speakerOn", "o2_setScrollOffset"]) {
      expect(used.get(name), name).toBeGreaterThan(0);
    }
  });
});
