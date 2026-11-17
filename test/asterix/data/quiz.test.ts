import { describe, expect, it } from "vitest";
import { encodeCp850 } from "../../../src/data/cp850";
import { parseCredits } from "../../../src/games/asterix/data/credits";
import { parseQuiz } from "../../../src/games/asterix/data/quiz";
import { hasOriginalFiles, listOriginal, readOriginal, withSuffix } from "../helpers";

const cp850 = (text: string, eof = false) => {
  const bytes = encodeCp850(text);
  return eof ? Uint8Array.of(...bytes, 0x1a) : bytes;
};

describe("parseQuiz (sans fichier)", () => {
  it("lit les questions, avec ou sans octet de fin de fichier DOS", () => {
    const text = "01Fquel fleuve coule à lugdunum ?\r\n01 la seine,la loire,le rhône/3\r\n02Dqui ?\r\n02 a,b,c/1 \r\n";
    for (const eof of [false, true]) {
      expect(parseQuiz(cp850(text, eof))).toEqual([
        { number: 1, level: "F", question: "quel fleuve coule à lugdunum ?", answers: ["la seine", "la loire", "le rhône"], correct: 2 },
        { number: 2, level: "D", question: "qui ?", answers: ["a", "b", "c"], correct: 0 },
      ]);
    }
  });

  it("refuse les lignes hors format", () => {
    expect(() => parseQuiz(cp850("01Fq ?\r\n"))).toThrow("impair");
    expect(() => parseQuiz(cp850("01Xq ?\r\n01 a,b,c/1\r\n"))).toThrow("ligne 1 inattendue");
    expect(() => parseQuiz(cp850("01Fq ?\r\n01 a,b,c/4\r\n"))).toThrow("ligne 2 inattendue");
    expect(() => parseQuiz(cp850("01Fq ?\r\n02 a,b,c/1\r\n"))).toThrow("numéro 02 au lieu de 01");
    expect(() => parseQuiz(cp850("01Fq ?\r\n01 a,b/1\r\n"))).toThrow("2 réponses au lieu de 3");
  });
});

describe("parseCredits (sans fichier)", () => {
  it("sépare la balise du texte et garde les lignes vides", () => {
    expect(parseCredits(cp850("@1Réalisation\r\n\r\nQuiz : X\r\n@3Fin\r\n", true))).toEqual([
      { style: 1, text: "Réalisation" },
      { style: 0, text: "" },
      { style: 0, text: "Quiz : X" },
      { style: 3, text: "Fin" },
    ]);
  });
});

describe.skipIf(!hasOriginalFiles)("quiz et générique (original/asterix)", () => {
  it("lit les 9 fichiers de quiz : 99 questions numérotées de 1 à 99 par pays", () => {
    const files = listOriginal(withSuffix(".TXT"));
    expect(files.map((f) => f.slice("MDF/40/".length))).toEqual([
      "M40EGYPT.TXT",
      "M40GAULE.TXT",
      "M40GBRET.TXT",
      "M40GERMA.TXT",
      "M40GRECE.TXT",
      "M40IBERE.TXT",
      "M40MEPAL.TXT",
      "M40NORMD.TXT",
      "M40ROMAN.TXT",
    ]);
    const levels = { F: 0, M: 0, D: 0 };
    for (const path of files) {
      const questions = parseQuiz(readOriginal(path));
      expect(questions.map((q) => q.number), path).toEqual(Array.from({ length: 99 }, (_, i) => i + 1));
      for (const q of questions) {
        levels[q.level]++;
        expect(q.question.length, path).toBeGreaterThan(0);
        expect(q.answers.every((a) => a.length > 0), `${path} question ${q.number}`).toBe(true);
        // Aucun caractère de remplacement ni de dessin de boîte : le texte est bien du CP850 accentué.
        expect(`${q.question}${q.answers.join("")}`, path).not.toMatch(/[░-▓│-┐└-┼╚-╬]/);
      }
    }
    expect(levels).toEqual({ F: 270, M: 360, D: 261 });
  });

  it("décode les accents du quiz", () => {
    const gaule = parseQuiz(readOriginal("MDF/40/M40GAULE.TXT"));
    expect(gaule[0]).toEqual({
      number: 1,
      level: "F",
      question: "quelle ville s'appelle aujourd'hui paris ?",
      answers: ["lutetia", "alesia", "parisii"],
      correct: 0,
    });
    expect(gaule[4]).toEqual({
      number: 5,
      level: "F",
      question: "quel fleuve coule à lugdunum ?",
      answers: ["la seine", "la loire", "le rhône"],
      correct: 2,
    });
    expect(gaule[98].question).toBe("où vivaient les arvernes ?");
  });

  it("lit le générique", () => {
    const lines = parseCredits(readOriginal("MDF/47/M47.DAT"));
    expect(lines.length).toBe(126);
    const styles = [0, 0, 0, 0];
    for (const line of lines) styles[line.style]++;
    expect(styles).toEqual([98, 26, 1, 1]);
    const titled = lines.filter((l) => l.style === 1).map((l) => l.text);
    expect(titled.slice(0, 4)).toEqual(["Conception", "INFOGRAMES MULTIMEDIA", "Réalisation", "Bertrand BROCARD"]);
    // Les balises @2 et @3 sont seules sur leur ligne.
    expect(lines.filter((l) => l.style >= 2)).toEqual([
      { style: 2, text: "" },
      { style: 3, text: "" },
    ]);
  });
});
