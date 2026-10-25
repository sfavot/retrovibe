import { describe, expect, it } from "vitest";
import { TOKEN_GROUPS, findToken, parseCm, tokenName } from "../../src/games/armaeth/data/commands";
import { hasOriginalFiles, readOriginal } from "./helpers";

describe("jetons", () => {
  it("compte 11 groupes et 119 jetons uniques de trois lettres", () => {
    expect(TOKEN_GROUPS).toHaveLength(11);
    const all = TOKEN_GROUPS.flat();
    expect(all).toHaveLength(119);
    expect(new Set(all).size).toBe(119);
    expect(all.every((t) => t.length === 3)).toBe(true);
  });

  it("retrouve un jeton dans les deux sens", () => {
    expect(findToken("svg")).toEqual({ group: 10, token: 6 });
    expect(findToken("TTA")).toEqual({ group: 4, token: 11 });
    expect(tokenName(0, 4)).toBe("cnt");
    expect(tokenName(0, 9)).toBeUndefined();
    expect(findToken("zzz")).toBeUndefined();
  });

  it("refuse un enregistrement tronqué ou un jeton inconnu", () => {
    expect(() => parseCm(Uint8Array.of(1, 0, 2))).toThrow(/CM invalide/);
    expect(() => parseCm(Uint8Array.of(99, 0, 0, 0, 1, 0, 0, 0, 0, 0))).toThrow(/jeton/);
  });
});

describe.skipIf(!hasOriginalFiles)("scripts CM d'Armaeth (fichiers du jeu)", () => {
  const files = [1, 2, 3, 4].map((n) => parseCm(readOriginal(`A1FCM${n}.SYS`)));

  it("découpe chaque fichier exactement", () => {
    expect(files.map((f) => f.length)).toEqual([6, 33, 7, 8]);
    for (const [i, records] of files.entries()) {
      const size = records.reduce((sum, r) => sum + 10 + 2 * r.args.length + r.text.length, 0);
      expect(size, `CM${i + 1}`).toBe(readOriginal(`A1FCM${i + 1}.SYS`).length);
    }
  });

  it("chaque enregistrement désigne un jeton valide et un seul type de commande porte du texte", () => {
    for (const record of files.flat()) {
      expect(tokenName(record.group, record.token)).toBe(record.name);
      expect(record.args.length).toBeLessThanOrEqual(16);
      if (record.text !== "") expect(record.name).toBe("tta");
    }
  });

  it("CM2 est le récit d'introduction et CM4 les conseils de jeu", () => {
    const intro = files[1].filter((r) => r.text !== "");
    expect(intro).toHaveLength(10);
    expect(intro[0].text).toMatch(/^Il y a longtemps, très longtemps, un peuple de nains/);
    expect(intro[6].text).toMatch(/^Vous êtes KILLIAN/);
    expect(intro[9].text).toContain("DOL ARMAETH");
    expect(files[3].find((r) => r.text !== "")?.text).toMatch(/^CONSEILS DE JEU/);
  });

  it("le mot « répétition » (nombre de rappels si cnt vaut 0) vaut 1 partout", () => {
    expect(files.flat().every((r) => r.repeat === 1)).toBe(true);
  });

  it("CM1 et CM3 sont des scripts sans texte qui commencent par cnt 7 puis dgs 99", () => {
    expect(files[0][0]).toMatchObject({ name: "cnt", args: [7] });
    expect(files[0][1]).toMatchObject({ name: "dgs", args: [99] });
    expect(files[2].every((r) => r.text === "")).toBe(true);
  });
});
