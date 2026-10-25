import { type DictionaryEntry, lookupWord, wordClass, wordRole } from "../data/dictionary";
import { normalizeText } from "../data/text";

/**
 * Analyse des phrases tapées dans *Armaeth* : normalisation (`gm_parse_command` `1d89:0002`), remplissage des
 * emplacements verbe / préposition / groupes nominaux (`1d89:0175..02ae`) et résolution des noms de classe 15 en
 * objets (`206a:0002`). Voir `docs/armaeth/parser.md` § 3 à § 6.2. Sans DOM ni état global : l'exécution des
 * verbes (§ 6.3 et suivants) est hors de ce module.
 */

/** Nombre maximal de codes par groupe nominal (tableaux de pile de `gm_dic_lookup`). */
export const MAX_CANDIDATES = 60;
/** Nombre maximal d'objets par nom résolu (`206a:0002`). */
export const MAX_RESOLVED_OBJECTS = 10;
/** Distance carrée maximale d'un candidat (`206a:0240`). */
export const MAX_DISTANCE = 64000;
/** Préposition « à » : forcée pour un second groupe nominal sans préposition. */
export const PREPOSITION_TO = 8;

// ---------------------------------------------------------------------------------------------------------------
// Normalisation et découpage

/**
 * Normalisation de `gm_parse_command` (§ 3) : implémentée une seule fois, dans `data/text.ts` (`normalizeText`), avec la table
 * des accents de `parseAccentTable`.
 */
export const normalize = normalizeText;

/** Mots de la ligne normalisée (`strtok` sur l'espace). */
export function tokenize(normalized: string): string[] {
  return normalized.split(" ").filter((word) => word !== "");
}

/** Une ligne qui commence par `/` est un jeton de script, pas une phrase (§ 3, point 5). */
export function isScriptLine(normalized: string): boolean {
  return normalized.startsWith("/");
}

// ---------------------------------------------------------------------------------------------------------------
// Remplissage des emplacements

export type ParseStatus =
  /** Phrase analysée (éventuellement incomplète : voir `isExecutable`). */
  | "ok"
  /** Aucun mot : `gm_execute_command` ne fait rien. */
  | "empty"
  /** Ligne commençant par `/` : jeton de script, non traité ici. */
  | "script"
  /** Un mot absent du dictionnaire : message `S015`, la saisie reste ouverte. */
  | "unknown-word"
  /** Un troisième groupe nominal : message `S015`, la saisie reste ouverte. */
  | "too-many-nouns";

export interface ParsedCommand {
  status: ParseStatus;
  /** Ligne normalisée. */
  normalized: string;
  /** Code complet du verbe (classes 13, 22, 24), 0 si absent (`DGROUP:4cba`). */
  verb: number;
  /** Préposition 1-8 (`code % 1000`), 0 si absente (`4cbc`). */
  preposition: number;
  /** Codes candidats du groupe nominal direct (`4cca`). */
  direct: number[];
  /** Codes candidats du groupe nominal indirect (`4d42`). */
  indirect: number[];
  /** Mot fautif quand `status` vaut `unknown-word`. */
  unknownWord?: string;
}

/** Valeur d'un mot qui commence par un chiffre : `atoi(mot)` (chiffres de tête seuls). */
function atoi(word: string): number {
  const match = /^\d+/.exec(word);
  return match ? Number(match[0]) : 0;
}

/**
 * Remplissage des emplacements (§ 5.2). `letters` est le nombre de lettres significatives du dictionnaire
 * (en-tête du monde, 8 par défaut). Défauts fidèles : un second verbe ou une seconde préposition est jeté sans
 * message, les articles (classe 26) disparaissent, un mot qui fournit le verbe ou la préposition perd ses autres sens.
 */
export function parseCommand(
  text: string,
  dictionary: readonly DictionaryEntry[],
  accents: ReadonlyMap<string, string>,
  letters?: number,
): ParsedCommand {
  const normalized = normalize(text, accents);
  const result: ParsedCommand = { status: "ok", normalized, verb: 0, preposition: 0, direct: [], indirect: [] };
  if (isScriptLine(normalized)) return { ...result, status: "script" };
  const words = tokenize(normalized);
  if (words.length === 0) return { ...result, status: "empty" };

  for (const word of words) {
    const codes = /^\d/.test(word) ? [atoi(word)] : lookupWord(dictionary, word, letters);
    if (codes.length === 0) return { ...result, status: "unknown-word", unknownWord: word };

    const nouns: number[] = [];
    let consumed = false;
    for (const code of codes) {
      if (consumed) break;
      const role = wordRole(code);
      if (role === "ignored") continue;
      if (role === "preposition") {
        if (result.preposition === 0) {
          result.preposition = code % 1000;
          consumed = true;
        }
        continue;
      }
      if (role === "verb") {
        if (result.verb === 0) {
          result.verb = code;
          consumed = true;
        }
        continue;
      }
      nouns.push(code);
    }
    // hypothèse (parser.md § 5.2) : « le mot est entièrement consommé » vaut aussi pour les noms déjà retenus
    // avant le code consommé ; l'ordre des codes d'un mot n'est pas conservé par l'original (swap-remove), ce
    // qui n'a de conséquence que pour un mot à la fois préposition/verbe et nom.
    const candidates = consumed ? [] : nouns.slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) continue;

    if (result.direct.length > 0 && result.indirect.length > 0) return { ...result, status: "too-many-nouns" };
    let toIndirect: boolean;
    if (result.preposition === 0) {
      toIndirect = result.direct.length !== 0;
      if (toIndirect) result.preposition = PREPOSITION_TO;
    } else {
      toIndirect = result.indirect.length === 0;
    }
    if (toIndirect) result.indirect = candidates;
    else result.direct = candidates;
  }
  return result;
}

/**
 * `gm_execute_command` n'exécute que si le verbe est présent et si une préposition est suivie d'un complément
 * indirect (§ 5.3) ; sinon il affiche `S015` et la boîte se ferme.
 */
export function isExecutable(parsed: ParsedCommand): boolean {
  if (parsed.status !== "ok" || parsed.verb === 0) return false;
  return parsed.preposition === 0 || parsed.indirect.length > 0;
}

/**
 * Valeur de `gm_parse_command` vue de la ligne de saisie (`finishSubmit`) : la phrase est remise dans la ligne
 * pour une phrase vide, un mot inconnu ou trois groupes nominaux ; une phrase reconnue (même sans effet) ferme la boîte.
 */
export function needsRetry(parsed: ParsedCommand): boolean {
  return parsed.status === "empty" || parsed.status === "unknown-word" || parsed.status === "too-many-nouns";
}

// ---------------------------------------------------------------------------------------------------------------
// Résolution des noms en objets (§ 6.2)

/** Champs d'un objet du monde utiles à la résolution (`WorldObject` de `data/world.ts` les fournit). */
export interface ResolverObject {
  /** `Num` : type de l'objet, `code % 1000` d'un nom de classe 15. */
  num: number;
  /** `Ser` : numéro de série. */
  serial: number;
  /** `Cod` : 1 = dans une salle, 2 = dans un objet. */
  location: number;
  /** Identifiant de la salle (`location` 1) ou série du conteneur (`location` 2). */
  container: number;
}

/**
 * Ce que la résolution demande à l'état du jeu (implémenté par le module d'état). Les prédicats portent les règles
 * qui dépendent de la lumière et de la géométrie (`219b:0000`, `2120:0075`, `206a:0240`).
 */
export interface ResolverWorld {
  /** Tous les objets du monde. */
  readonly objects: readonly ResolverObject[];
  /** Le héros (un élément de `objects`). */
  readonly hero: ResolverObject;
  /** Identifiant de la salle courante (`DGROUP:4b84`). */
  readonly room: number;
  /** Visible (`219b:0000`) : `Inv` nul et assez de lumière. */
  isVisible(object: ResolverObject): boolean;
  /** À portée du héros (`2120:0075`), drapeau B des objets de la salle. */
  isInReach(object: ResolverObject): boolean;
  /** Carré de la distance au héros (`206a:0240`) pour un objet de la salle. */
  distanceSquared(object: ResolverObject): number;
  /** Le décor (classes 4 et 9) de code `code` est-il présent dans la salle (`1e08:0014` ≠ −1) ? */
  hasDecor(code: number): boolean;
}

export interface ResolvedObject {
  object: ResolverObject;
  /** Drapeau A : 7 = le héros lui-même, 1 = dans son inventaire, 0 = dans la salle (ou dans l'objet indirect). */
  flagA: 0 | 1 | 7;
  /** Drapeau B : 7 = à portée, 0 sinon. */
  flagB: 0 | 7;
  /** Carré de la distance (0 pour l'inventaire). */
  distance: number;
}

export interface ResolvedNoun {
  /** Code du mot. */
  code: number;
  /** `objects` : classe 15 (objets triés, inventaire d'abord puis du plus proche au plus loin) ; `decor` : classes 4 et 9 ; `other` : 6, 19, nombres. */
  kind: "objects" | "decor" | "other";
  /** Classe 15 : objets trouvés (peut être vide). */
  objects: ResolvedObject[];
  /** Classes 4 et 9 : le décor est-il présent dans la salle ? */
  decorPresent: boolean;
}

export interface ResolvedCommand {
  direct: ResolvedNoun[];
  indirect: ResolvedNoun[];
}

/**
 * Objets de type `num` visibles dans la portée du héros (salle ou conteneur du héros, puis inventaire), 10 au plus,
 * triés par distance croissante ; à distance égale l'inventaire passe avant (hypothèse, parser.md § 6.2 :
 * tri à bulles stable, inventaire ajouté en dernier mais de distance 0).
 */
export function resolveObjectsOfType(num: number, world: ResolverWorld): ResolvedObject[] {
  const { hero } = world;
  const found: ResolvedObject[] = [];
  const inScope = (o: ResolverObject) =>
    hero.location === 1 ? o.location === 1 && o.container === world.room : o.location === hero.location && o.container === hero.container;
  for (const o of world.objects) {
    if (found.length >= MAX_RESOLVED_OBJECTS) break;
    if (o.num !== num || !inScope(o) || !world.isVisible(o)) continue;
    if (o === hero || o.serial === hero.serial) found.push({ object: o, flagA: 7, flagB: 7, distance: 0 });
    else {
      const distance = Math.min(MAX_DISTANCE, world.distanceSquared(o));
      found.push({ object: o, flagA: 0, flagB: world.isInReach(o) ? 7 : 0, distance });
    }
  }
  for (const o of world.objects) {
    if (found.length >= MAX_RESOLVED_OBJECTS) break;
    if (o.num !== num || o.location !== 2 || o.container !== hero.serial || !world.isVisible(o)) continue;
    found.push({ object: o, flagA: 1, flagB: 7, distance: 0 });
  }
  const rank = (r: ResolvedObject) => (r.flagA === 1 ? 0 : 1);
  return found
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.distance - b.r.distance || rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * Résolution d'un code nominal. Pour un complément direct dont l'indirect est déjà résolu en `within`, les
 * candidats sont complétés (si moins de 10) par l'objet de même type contenu dans `within` (`21e7:0022`),
 * avec A = B = 0 : `prendre la clef dans le coffre` marche même si la clef n'est pas visible seule.
 */
export function resolveNoun(code: number, world: ResolverWorld, within?: ResolverObject): ResolvedNoun {
  const cls = wordClass(code);
  if (cls === 15) {
    const objects = resolveObjectsOfType(code % 1000, world);
    if (within && objects.length < MAX_RESOLVED_OBJECTS) {
      // hypothèse (parser.md § 6.2) : un seul objet ajouté, jamais en double d'un objet déjà trouvé.
      const inner = world.objects.find(
        (o) => o.num === code % 1000 && o.location === 2 && o.container === within.serial && !objects.some((r) => r.object === o),
      );
      if (inner) objects.push({ object: inner, flagA: 0, flagB: 0, distance: 0 });
    }
    return { code, kind: "objects", objects, decorPresent: false };
  }
  if (cls === 4 || cls === 9) return { code, kind: "decor", objects: [], decorPresent: world.hasDecor(code) };
  return { code, kind: "other", objects: [], decorPresent: false };
}

/**
 * Résout les deux groupes nominaux d'une phrase (sans complément par le contenu de l'indirect : l'appelant utilise
 * `resolveNoun(code, world, objetIndirect)` pour chaque objet indirect, boucle de § 6.3).
 */
export function resolveObjects(parsed: Pick<ParsedCommand, "direct" | "indirect">, world: ResolverWorld): ResolvedCommand {
  return {
    direct: parsed.direct.map((code) => resolveNoun(code, world)),
    indirect: parsed.indirect.map((code) => resolveNoun(code, world)),
  };
}
