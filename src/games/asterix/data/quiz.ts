import { decodeCp850 } from "../../../data/cp850";

/**
 * Questions du quiz d'Astérix (`MDF/40/M40*.TXT`, un fichier par pays ; voir `docs/asterix/formats.md`).
 *
 * Texte CP850, lignes terminées par CR LF, deux lignes par question :
 *   `NNXquestion`                       NN = numéro sur deux chiffres, X = niveau (F, M ou D)
 *   `NN réponse1,réponse2,réponse3/B`   B = numéro de la bonne réponse (1 à 3)
 * Le fichier finit parfois par l'octet de fin de fichier DOS (0x1A).
 */

export type QuizLevel = "F" | "M" | "D";

export interface QuizQuestion {
  /** Numéro de la question dans le fichier, à partir de 1. */
  number: number;
  /** Niveau : F (facile), M (moyen) ou D (difficile). */
  level: QuizLevel;
  question: string;
  /** Les trois réponses proposées, dans l'ordre du fichier. */
  answers: [string, string, string];
  /** Rang de la bonne réponse dans `answers`, à partir de 0. */
  correct: number;
}

const DOS_EOF = 0x1a;
const QUESTION = /^(\d\d)([FMD])(.+)$/;
const ANSWERS = /^(\d\d) (.+)\/([1-3]) *$/;

/** Lit un fichier de quiz. Lève une erreur à la première ligne qui ne suit pas le format. */
export function parseQuiz(bytes: Uint8Array): QuizQuestion[] {
  let end = bytes.length;
  if (end > 0 && bytes[end - 1] === DOS_EOF) end--;
  const lines = decodeCp850(bytes.subarray(0, end)).split("\r\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length % 2 !== 0) throw new Error("Quiz : nombre de lignes impair");

  const questions: QuizQuestion[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const q = QUESTION.exec(lines[i]);
    if (!q) throw new Error(`Quiz : ligne ${i + 1} inattendue (question)`);
    const a = ANSWERS.exec(lines[i + 1]);
    if (!a) throw new Error(`Quiz : ligne ${i + 2} inattendue (réponses)`);
    if (a[1] !== q[1]) throw new Error(`Quiz : ligne ${i + 2}, numéro ${a[1]} au lieu de ${q[1]}`);
    const answers = a[2].split(",");
    if (answers.length !== 3) throw new Error(`Quiz : ligne ${i + 2}, ${answers.length} réponses au lieu de 3`);
    questions.push({
      number: Number(q[1]),
      level: q[2] as QuizLevel,
      question: q[3],
      answers: answers as [string, string, string],
      correct: Number(a[3]) - 1,
    });
  }
  return questions;
}
