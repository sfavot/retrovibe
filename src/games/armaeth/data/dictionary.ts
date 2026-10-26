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

/** `strncmp(mot, entrée, n)` : octets comparés jusqu'au premier NUL commun ; un mot plus court se termine par un NUL implicite. */
function strncmp(a: string, b: string, n: number): number {
  for (let i = 0; i < n; i++) {
    const x = i < a.length ? a.charCodeAt(i) : 0;
    const y = i < b.length ? b.charCodeAt(i) : 0;
    if (x !== y) return x - y;
    if (x === 0) return 0;
  }
  return 0;
}

/** Maximum de codes rendus par `gm_dic_lookup` (tableau de pile de 60 mots). */
const MAX_CODES = 60;

/**
 * Recherche de `gm_dic_lookup` (`1dd4:0156`, désassemblé, `parser.md` § 4.1) : sur les `letters` premières lettres (arrondies au pair,
 * entre 4 et 16), dichotomie qui démarre sur le dernier mot (`lo = 0`, `hi = mid = n - 1`, `mid = (lo + hi) / 2`, arrêt quand `mid` ne
 * change plus). Si le mot du milieu correspond, son code est rangé en premier, puis le balayage parcourt **tous** les autres mots (sans
 * s'arrêter au premier écart) : d'abord vers le bas (`mid - 1` à 0), puis vers le haut (`mid + 1` à `n - 1`), dans la limite de 60 codes.
 * Les doublons sont ensuite retirés : pour chaque code gardé, le doublon est remplacé par le dernier code du tableau (l'ordre n'est donc
 * pas celui du fichier). Si rien ne correspond et que le mot finit par `s` ou `x`, la lettre est supprimée et la recherche refaite.
 * Le mot doit déjà être en minuscules et sans accent (voir `normalizeText`).
 */
export function lookupWord(
  entries: readonly DictionaryEntry[],
  input: string,
  letters = DEFAULT_SIGNIFICANT_LETTERS,
): number[] {
  const n = Math.min(16, Math.max(4, letters + (letters & 1)));
  const count = entries.length;
  let word = input;
  for (;;) {
    const out: number[] = [];
    if (count > 0) {
      let lo = 0;
      let hi = count - 1;
      let mid = count - 1;
      for (;;) {
        const cmp = strncmp(word, entries[mid]!.word, n);
        if (cmp === 0) {
          out.push(entries[mid]!.code);
          for (let i = mid - 1; i >= 0 && out.length < MAX_CODES; i--) if (strncmp(word, entries[i]!.word, n) === 0) out.push(entries[i]!.code);
          for (let i = mid + 1; i < count && out.length < MAX_CODES; i++) if (strncmp(word, entries[i]!.word, n) === 0) out.push(entries[i]!.code);
          break;
        }
        if (cmp < 0) hi = mid;
        else lo = mid;
        const next = (hi + lo) >> 1;
        if (next === mid) break;
        mid = next;
      }
    }
    // dédoublonnage de `1dd4:02a0` : le doublon cède sa place au dernier code du tableau
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (out[j] !== out[i]) continue;
        const last = out.pop()!;
        if (j < out.length) out[j] = last;
        j--;
      }
    }
    if (out.length > 0 || word.length === 0) return out;
    const last = word[word.length - 1];
    if (last !== "s" && last !== "x") return out;
    word = word.slice(0, -1);
  }
}
