import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP_GOAL, HELP_INTRO, HELP_NOTHING, HelpTable, helpTable } from "../../../src/games/tim3/data/help";
import { baseIndex, frenchIndex, original } from "./real";

const bytes = (lines: string[]): Uint8Array => new TextEncoder().encode(lines.join("\r\n") + "\r\n");

describe("HELP.RES (table de l'aide du professeur)", () => {
  // Deux langues alignées ligne à ligne : l'anglais a l'identifiant Windows, le français celui de l'ancien panneau.
  const english = bytes(["09009  Clock.", "35003  Use help.", "13026  Question mark.", "09000  The goal.", "23200  Sorry."]);
  const french = bytes(["09009  Horloge.", "10006  Utilisez l'aide.\\n\\nVoila.", "13026  Point d'interrogation.", "09000  Le but.", "23200  Desole."]);

  it("le rang de la ligne est celui de la voix ; le texte est la ligne française de ce rang, « \\n » compris", () => {
    const t = new HelpTable(french, english);
    expect(t.find(35003)).toEqual({ id: 35003, rank: 1, text: "Utilisez l'aide.\n\nVoila." });
    expect(t.find(10006)).toEqual({ id: 10006, rank: 1, text: "Utilisez l'aide.\n\nVoila." });
    expect(t.find(23200)?.rank).toBe(4);
  });

  it("9001 à 9999 n'ont pas d'aide, 9000 (le but) en a ; 15019 prend le texte de 13026 ; inconnu : rien", () => {
    const t = new HelpTable(french, english);
    expect(t.find(9009)).toBeNull();
    expect(t.find(HELP_GOAL)?.text).toBe("Le but.");
    expect(t.find(15019)).toEqual({ id: 15019, rank: 2, text: "Point d'interrogation." });
    expect(t.find(12345)).toBeNull();
  });

  it("sans fichier de base, la recherche se fait dans la langue seule", () => {
    expect(new HelpTable(english).find(35003)?.text).toBe("Use help.");
  });
});

describe.skipIf(!original.has)("HELP.RES du jeu", () => {
  const help = helpTable(frenchIndex());

  it("le fichier anglais reste lisible sous FRENCH.DAT (`ResourceIndex.base`)", () => {
    const index = frenchIndex();
    expect(index.entry("HELP.RES")?.volume).toBe("FRENCH.DAT");
    expect(index.base("HELP.RES")?.volume).toMatch(/^RESOURCE\.00/);
    expect(baseIndex().base("HELP.RES")?.data).toBe(baseIndex().get("HELP.RES"));
  });

  it("aide de l'aide (23100) et « Je suis désolé » (23200) : textes français, voix 113 et 114", () => {
    expect(help.size).toBeGreaterThanOrEqual(184);
    const intro = help.find(HELP_INTRO)!;
    expect(intro.rank).toBe(113);
    expect(intro.text).toMatch(/^Salut! Professeur Tim/);
    expect(intro.text).toContain("\n\n");
    expect(help.find(HELP_NOTHING)).toMatchObject({ rank: 114, text: expect.stringMatching(/^Je suis désolé/) });
  });

  it("boutons de la barre : trouvés par l'identifiant anglais (35003), texte français de la même ligne", () => {
    expect(help.find(35003)).toMatchObject({ rank: 12, text: expect.stringMatching(/^Utilisez "l'Aide"/) });
    expect(help.find(35005)).toMatchObject({ rank: 28, text: expect.stringMatching(/drapeau vert/) });
    // Le français garde l'identifiant de l'ancien panneau pour la même ligne.
    expect(help.find(11003)?.rank).toBe(28);
  });

  it("menu principal (16010 : ligne française), bac, but ; duels sans aide", () => {
    expect(help.find(16010)).toMatchObject({ rank: 67, text: expect.stringMatching(/mode Jeu/) });
    expect(help.find(11014)?.text).toMatch(/corbeille des éléments/);
    expect(help.find(9000)?.rank).toBe(6);
    expect(help.find(9005)).toBeNull();
  });

  const voices = `${original.dir}/voices/help`;
  it.skipIf(!existsSync(voices))("chaque aide a sa voix et sa synchro labiale", () => {
    const lipsync = JSON.parse(readFileSync(`${original.dir}/voices/lipsync.json`, "utf8")) as { help: Record<string, string> };
    for (let rank = 0; rank < help.size; rank++) {
      expect(existsSync(`${voices}/${String(rank).padStart(3, "0")}.mp3`), `voix ${rank}`).toBe(true);
      expect(lipsync.help[String(rank)], `synchro ${rank}`).toBeTypeOf("string");
    }
  });
});
