import { decodeCp437 } from "../../../data/cp437";
import { BinaryReader } from "../../../data/reader";
import { NOT_KEY, xorBytes } from "./text";

/** Octets d'un mot dans `A1FDIC.SYS` (NUL de remplissage compris). */
export const DIC_WORD_BYTES = 16;

export interface DictionaryEntry {
  /**
   * Code du mot, en clair dans le fichier. `code / 1000` est la classe (voir `wordClass`) ; pour les
   * classes 4, 9, 15 et 22 le code est aussi l'identifiant du message associé dans `TMS`.
   */
  code: number;
  /** Mot en minuscules sans accent, complété à 16 octets par des NUL dans le fichier, ici sans le remplissage. */
  word: string;
}

/**
 * Rôle d'une classe dans l'analyse d'une phrase (`gm_parse_command` `1d89:0002`, `docs/armaeth/parser.md` § 4.2 et § 5.2) :
 * - `preposition` (classe 1) : seul `code % 1000` est conservé, une par phrase ;
 * - `verb` (classes 13, 22 et 24) : emplacement du verbe, le code entier est retenu, un seul par phrase (un second est
 *   jeté sans message) ; la classe 13 (noms propres magiques) occupe cet emplacement mais relève de la famille de
 *   gestionnaires 6, la 24 des commandes système ;
 * - `ignored` (classe 26, articles et particules) : supprimé de la liste, rien n'est mémorisé ;
 * - `noun` (toutes les autres : 0 chiffres, 4, 6, 9, 15, 19) : candidat nominal, deux groupes au plus (direct et indirect).
 */
export type WordRole = "preposition" | "verb" | "ignored" | "noun";

/** Sens d'une classe de mots (`parser.md` § 4.2). */
export type WordKind =
  | "number"
  | "preposition"
  | "decor-mobile"
  | "meta-noun"
  | "decor"
  | "magic-name"
  | "object"
  | "place"
  | "verb"
  | "system-command"
  | "article";

const KIND_BY_CLASS = new Map<number, WordKind>([
  [0, "number"],
  [1, "preposition"],
  [4, "decor-mobile"],
  [6, "meta-noun"],
  [9, "decor"],
  [13, "magic-name"],
  [15, "object"],
  [19, "place"],
  [22, "verb"],
  [24, "system-command"],
  [26, "article"],
]);

export function wordClass(code: number): number {
  return Math.floor(code / 1000);
}

/**
 * Sens de la classe du code : 0 pour un nombre tapé (un mot commençant par un chiffre devient `atoi(mot)`,
 * classe `n / 1000`, donc 0 sous 1000), 4 éléments mobiles de décor, 6 méta-noms (`objet`, `salle`), 9 décors,
 * 13 noms propres magiques, 15 objets manipulables, 19 noms de lieux, 22 verbes, 24 commandes système, 26 articles.
 */
export function wordKind(code: number): WordKind | undefined {
  return KIND_BY_CLASS.get(wordClass(code));
}

export function wordRole(code: number): WordRole {
  const cls = wordClass(code);
  if (cls === 1) return "preposition";
  if (cls === 13 || cls === 22 || cls === 24) return "verb";
  if (cls === 26) return "ignored";
  return "noun";
}

/** Nombre de lettres significatives par défaut (octet de poids faible du 4e mot de l'en-tête du monde, 8 dans les fichiers du jeu). C'est aussi la valeur par défaut de `lookupWord`. */
export const DEFAULT_SIGNIFICANT_LETTERS = 8;

/** `A1FDIC.SYS` : `u16 n` puis `n` enregistrements `{u16 code, mot[16] NOT 0xFF}` triés par mot (`gm_load_dic` `1dd4:002a`). */
export function parseDictionary(bytes: Uint8Array): DictionaryEntry[] {
  const r = new BinaryReader(bytes);
  const count = r.u16();
  if (2 + 18 * count !== bytes.length) throw new Error(`DIC invalide : ${count} mots pour ${bytes.length} octets`);
  const entries: DictionaryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const code = r.u16();
    const raw = xorBytes(r.bytesView(DIC_WORD_BYTES), NOT_KEY);
    const end = raw.indexOf(0);
    entries.push({ code, word: decodeCp437(end === -1 ? raw : raw.subarray(0, end)) });
  }
  return entries;
}

/**
 * Recherche de `gm_dic_lookup` (`1dd4:0156`) : tous les mots dont les `letters` premières lettres
 * (arrondi au pair, entre 4 et 16) sont celles du mot saisi ; si rien ne correspond et que le mot se
 * termine par `s` ou `x`, la recherche est refaite sans cette lettre. Les codes sont dédoublonnés.
 * Le mot doit déjà être en minuscules et sans accent (voir `normalizeText`).
 */
export function lookupWord(
  entries: readonly DictionaryEntry[],
  input: string,
  letters = DEFAULT_SIGNIFICANT_LETTERS,
): number[] {
  const n = Math.min(16, Math.max(4, letters + (letters & 1)));
  let word = input;
  for (;;) {
    const prefix = word.slice(0, n);
    const codes = new Set<number>();
    for (const entry of entries) if (entry.word.slice(0, n) === prefix) codes.add(entry.code);
    if (codes.size > 0 || word.length === 0) return [...codes];
    const last = word[word.length - 1];
    if (last !== "s" && last !== "x") return [];
    word = word.slice(0, -1);
  }
}
