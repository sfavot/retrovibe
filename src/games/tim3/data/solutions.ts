/**
 * Solution des puzzles de TIM3 (`docs/tim3/formats.md` § 5, « Solution »).
 *
 * Le jeu ne stocke **aucune solution à placer** : un puzzle est réussi quand ses conditions (bloc solution du `.LEV`,
 * lu par `lev.ts`) sont toutes vraies, après un délai éventuel. Les deux `.RES` au nom trompeur servent autour :
 * - `SOLVE.RES` : pour chacune des 149 pièces, les états proposés par la fenêtre « Solution » de l'atelier
 *   (`SOLVE.ITF`) quand on écrit les conditions d'un puzzle maison ;
 *   ```
 *   !Part<n>            (numéro facultatif, parfois précédé d'une espace : l'ordre fait foi)
 *   nom                 (absent pour la pièce 22)
 *   @plages             (pièce testée par sa position seulement)        — ou —
 *   plages \n libellé   (répété : un état nommé et ses plages)
 *   plage = a,b[E][&image[%|&]]  (b = −1 : jusqu'à la fin ; E = explosion)
 *   ```
 * - `BINSOLVE.RES` : les 6 félicitations de fin de catégorie (Travaux pratiques, Faciles, Moyens, Difficiles, Très
 *   difficiles, puis tout le jeu).
 */
import { decodeText } from "../../../data/reader";
import { activeConditions, type LevCondition, type Level, levelParts } from "./lev";

export interface SolveRange {
  from: number;
  /** −1 : jusqu'au dernier état. */
  to: number;
  /** Suffixe `E` : la pièce explose (supposé). */
  explodes: boolean;
  /** Image affichée dans la fenêtre pour cet état (`&n`), si donnée. */
  frame?: number;
  /** Caractère après l'image : `%` (presque partout), `&` (une coquille du canon) ou vide. */
  suffix: string;
}

export interface SolveState {
  label: string;
  ranges: SolveRange[];
}

export interface SolvePart {
  /** Type de pièce = rang du bloc. */
  type: number;
  name: string;
  /** Ligne `@` : pièce dont on teste la position (balles, seaux…), avec ses plages d'états. */
  position?: SolveRange[];
  /** États nommés (« Popped », « Lit »…), vides pour une pièce sans condition possible (murs, décors). */
  states: SolveState[];
}

const RANGE = /^(-?\d+),(-?\d+)(E?)(?:&(\d+)([%&]?))?$/;

export function readSolveRes(bytes: Uint8Array): SolvePart[] {
  const lines = textLines(bytes).map((l) => l.trim());
  const parts: SolvePart[] = [];
  let i = 0;
  while (i < lines.length) {
    const head = /^!Part ?(\d*)$/.exec(lines[i]!);
    if (!head) throw new Error(`TIM3 : SOLVE.RES, ligne ${i + 1} : « !Part » attendu`);
    const type = parts.length;
    if (head[1] && Number(head[1]) !== type) throw new Error(`TIM3 : SOLVE.RES, pièce ${head[1]} au rang ${type}`);
    // Un bloc peut n'avoir ni nom ni état (pièce 22, la télécommande).
    const next = lines[i + 1];
    const name = next === undefined || next.startsWith("!Part") ? "" : next;
    i += name === "" ? 1 : 2;
    const part: SolvePart = { type, name, states: [] };
    while (i < lines.length && !lines[i]!.startsWith("!Part")) {
      const line = lines[i]!;
      if (line.startsWith("@")) {
        part.position = parseRanges(line.slice(1), i);
        i++;
      } else {
        const label = lines[i + 1];
        if (label === undefined || label.startsWith("!Part") || label === "") {
          throw new Error(`TIM3 : SOLVE.RES, ligne ${i + 2} : libellé d'état attendu`);
        }
        part.states.push({ label, ranges: parseRanges(line, i) });
        i += 2;
      }
    }
    parts.push(part);
  }
  return parts;
}

function parseRanges(text: string, line: number): SolveRange[] {
  return text
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((t) => {
      const m = RANGE.exec(t);
      if (!m) throw new Error(`TIM3 : SOLVE.RES, ligne ${line + 1} : plage illisible « ${t} »`);
      const range: SolveRange = { from: Number(m[1]), to: Number(m[2]), explodes: m[3] === "E", suffix: m[5] ?? "" };
      if (m[4] !== undefined) range.frame = Number(m[4]);
      return range;
    });
}

/** Les 6 messages de `BINSOLVE.RES`, dans l'ordre des catégories puis « tout le jeu ». */
export function readBinSolveRes(bytes: Uint8Array): string[] {
  return textLines(bytes);
}

/** Lignes CRLF, sans les lignes vides ni la marque de fin DOS (0x1A) qui terminent les fichiers. */
function textLines(bytes: Uint8Array): string[] {
  const lines = decodeText(bytes).split("\r\n");
  while (lines.length > 0 && /^\x1a?$/.test(lines.at(-1)!.trim())) lines.pop();
  return lines;
}

/** Condition de réussite rapportée à sa pièce. */
export interface GoalCondition extends LevCondition {
  /** Type de la pièce visée. */
  partType: number;
  /** Test de position : aucun, hors de l'écran, ou dans une zone. */
  position: "none" | "offscreen" | "inside";
}

/** Conditions de réussite d'un puzzle, avec le type de chaque pièce visée. */
export function goalConditions(level: Level): GoalCondition[] {
  const parts = levelParts(level);
  return activeConditions(level).map((c) => {
    const part = parts[c.partIndex];
    if (!part) throw new Error(`TIM3 : condition sur la pièce ${c.partIndex}, absente`);
    const rect = [c.rectX, c.rectY, c.rectWidth, c.rectHeight];
    const position = rect.every((v) => v === 0) ? "none" : rect.every((v) => v === -1) ? "offscreen" : "inside";
    return { ...c, partType: part.type, position };
  });
}
