import { decodeCp437 } from "../../../data/cp437";

/** Scène listée dans DESCRIPT.ION. */
export interface SceneDescription {
  /** Identifiant tel qu'écrit dans le fichier, par ex. `s18`. */
  id: string;
  /** Nom de la scène, par ex. « Le Lac Glacé ». */
  name: string;
}

/** DESCRIPT.ION : une ligne `sNN Nom de scène` par scène (CP437, fins de ligne CRLF). */
export function parseDescription(bytes: Uint8Array): SceneDescription[] {
  const scenes: SceneDescription[] = [];
  for (const line of decodeCp437(bytes).split(/\r?\n/)) {
    const match = /^(s\d+)\s+(.+?)\s*$/.exec(line);
    if (match) scenes.push({ id: match[1], name: match[2] });
  }
  return scenes;
}

/** Entrée d'un fichier .DAT : une clé entre guillemets, puis les lignes de texte jusqu'à une ligne vide. */
export interface KeyedText {
  key: string;
  lines: string[];
}

/**
 * Format commun des .DAT de texte du jeu (CP437, CRLF) : des lignes de commentaire commençant
 * par `#`, puis des blocs séparés par une ligne vide, chacun composé d'une ligne `"clé"` suivie
 * de ses lignes de texte. Les textes sont restitués tels quels.
 */
export function parseKeyedTexts(bytes: Uint8Array): KeyedText[] {
  const entries: KeyedText[] = [];
  let current: KeyedText | null = null;
  for (const line of decodeCp437(bytes).split(/\r?\n/)) {
    const key = /^"([^"]*)"\s*$/.exec(line);
    if (key) {
      current = { key: key[1], lines: [] };
      entries.push(current);
    } else if (line.trim() === "") {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
    // Hors bloc : commentaires `#` ignorés.
  }
  return entries;
}

/** Question du quiz (scène 40). */
export interface QuizQuestion {
  /** Numéro de la question, de 0 à N-1. */
  id: number;
  /** Expression à trouver, un mot étant remplacé par « schtroumpf ». */
  text: string;
  /** Bonne réponse (toujours listée en premier dans le fichier). */
  correct: string;
  /** Les deux mauvaises réponses. */
  wrong: string[];
}

export interface Quiz {
  /** Nombre de questions annoncé par l'en-tête (`"100"`, valeur inchangée du fichier). */
  header: string;
  questions: QuizQuestion[];
}

/**
 * S40A.DAT : un bloc d'en-tête `"100"` (note de 2 lignes), puis 44 blocs `"n"` de quatre
 * lignes : phrase, bonne réponse, deux mauvaises réponses.
 */
export function parseQuiz(bytes: Uint8Array): Quiz {
  const [head, ...rest] = parseKeyedTexts(bytes);
  if (!head) throw new Error("Quiz : fichier vide");
  const questions = rest.map((entry, index) => {
    const [text, correct, ...wrong] = entry.lines;
    if (Number(entry.key) !== index || !text || !correct || wrong.length !== 2) {
      throw new Error(`Quiz : bloc « ${entry.key} » mal formé`);
    }
    return { id: index, text, correct, wrong };
  });
  return { header: head.key, questions };
}

/** S49A.DAT : textes des écrans « Confirmation » (clés `S49_01T`…`S49_12T`, une ligne chacun). */
export function parseConfirmationTexts(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(parseKeyedTexts(bytes).map((entry) => [entry.key, entry.lines.join("\n")]));
}
