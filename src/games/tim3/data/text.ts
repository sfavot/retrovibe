/**
 * Textes de TIM3 (`docs/tim3/formats.md` § 7). Windows-1252 ; les `.RES` sont en CRLF ; `SYSTEM.RES` garde des `\n` littéraux
 * (deux caractères). L'anglais vient de `RESOURCE.001`, une langue se superpose par nom de fichier (`ResourceIndex.overlay`) :
 * `loadTexts` lit donc le texte de la langue active telle que l'index la présente.
 *
 * - `LEVELS.INF` : `u16 n`, `u16 offset[n]`, puis par puzzle 10 chaînes NUL : titre, but, 8 indices (vides = "").
 * - `INFO.RES` : `"%3d.\tnom\tdescription"` par pièce.
 * - `MUSIC.RES`, `SOUND.RES` : `identifiant nom` ; `DESCRIPT.RES`, `HELP.RES` : `identifiant  texte`.
 * - Les autres `.RES` textuels (`SYSTEM.RES`…) : une ligne par chaîne.
 */
import { BinaryReader, decodeText } from "../../../data/reader";
import type { ResourceIndex } from "./volume";

export const HINT_COUNT = 8;

export interface LevelText {
  readonly title: string;
  readonly goal: string;
  /** Huit indices, `""` quand le puzzle en a moins. */
  readonly hints: string[];
}

export interface PartInfo {
  readonly id: number;
  readonly name: string;
  readonly description: string;
}

export interface IdText {
  readonly id: number;
  readonly text: string;
}

export function parseLevelsInf(bytes: Uint8Array): LevelText[] {
  const r = new BinaryReader(bytes);
  const count = r.u16();
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(r.u16());
  if (offsets[0] !== r.offset) throw new Error("TIM3 : LEVELS.INF ne commence pas après la table d'offsets");

  const out: LevelText[] = [];
  for (let i = 0; i < count; i++) {
    if (r.offset !== offsets[i]) throw new Error(`TIM3 : LEVELS.INF, offset du puzzle ${i} incohérent`);
    const strings: string[] = [];
    for (let s = 0; s < 2 + HINT_COUNT; s++) {
      const end = bytes.indexOf(0, r.offset);
      if (end === -1) throw new Error("TIM3 : LEVELS.INF tronqué");
      strings.push(decodeText(bytes.subarray(r.offset, end)));
      r.offset = end + 1;
    }
    out.push({ title: strings[0], goal: strings[1], hints: strings.slice(2) });
  }
  if (!r.isAtEnd) throw new Error("TIM3 : octets restants dans LEVELS.INF");
  return out;
}

/**
 * Lignes d'un `.RES` (CRLF), sans la fin de fichier : vide, ou le marqueur DOS `0x1A` que portent 10 `.RES` français.
 * Les lignes vides intermédiaires sont conservées.
 */
export function parseLines(bytes: Uint8Array): string[] {
  const lines = decodeText(bytes).split("\r\n");
  if (lines[lines.length - 1] === "\x1a") lines.pop();
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Remplace les `\n` littéraux de `SYSTEM.RES` par de vrais retours à la ligne. */
export function unescapeNewlines(text: string): string {
  return text.replaceAll("\\n", "\n");
}

export function parseInfoRes(bytes: Uint8Array): PartInfo[] {
  const out: PartInfo[] = [];
  for (const line of parseLines(bytes)) {
    if (line === "") continue;
    const match = /^\s*(\d+)\.\t([^\t]*)\t(.*)$/.exec(line);
    if (!match) throw new Error(`TIM3 : ligne d'INFO.RES illisible : ${line.slice(0, 40)}`);
    out.push({ id: Number(match[1]), name: match[2], description: match[3] });
  }
  return out;
}

/** `MUSIC.RES`, `SOUND.RES`, `DESCRIPT.RES`, `HELP.RES` : `identifiant`, espaces, texte ; lignes vides ignorées. */
export function parseIdTable(bytes: Uint8Array): IdText[] {
  const out: IdText[] = [];
  for (const line of parseLines(bytes)) {
    if (line === "") continue;
    const match = /^(\d+)\s+(.*)$/.exec(line);
    if (!match) throw new Error(`TIM3 : ligne à identifiant illisible : ${line.slice(0, 40)}`);
    out.push({ id: Number(match[1]), text: match[2] });
  }
  return out;
}

/**
 * Texte de `INTRFACE.RES` par identifiant (`lines` : `parseLines` du fichier). TIMWIN.EXE charge le fichier sous les numéros
 * 2000 + n (421159 → 453958) et ne garde que les trois derniers chiffres d'un identifiant de texte (4213b9 : `2000 + id % 1000`) :
 * 31107, 21107 et 1107 désignent la même entrée. L'entrée n (à partir de 1) est la n-ième ligne, une ligne terminée par « \ » se
 * prolongeant sur la suivante (lignes 303 à 306 : une seule entrée, donc 31397 est à la ligne 400). `""` hors du fichier.
 */
export function interfaceText(lines: readonly string[], id: number): string {
  const wanted = id % 1000;
  let entry = 1;
  let text = "";
  for (const line of lines) {
    if (line.endsWith("\\")) {
      text += line.slice(0, -1);
      continue;
    }
    if (entry === wanted) return text + line;
    text = "";
    entry++;
  }
  return "";
}

export interface GameTexts {
  readonly levels: LevelText[];
  readonly parts: PartInfo[];
  readonly music: IdText[];
  readonly sounds: IdText[];
  /** Lignes de `SYSTEM.RES`, `\n` littéraux conservés (`unescapeNewlines`). */
  readonly system: string[];
}

/** Textes de la langue présentée par l'index (anglais seul, ou avec une langue superposée). */
export function loadTexts(index: ResourceIndex): GameTexts {
  return {
    levels: parseLevelsInf(index.get("LEVELS.INF")),
    parts: parseInfoRes(index.get("INFO.RES")),
    music: parseIdTable(index.get("MUSIC.RES")),
    sounds: parseIdTable(index.get("SOUND.RES")),
    system: parseLines(index.get("SYSTEM.RES")),
  };
}
