/**
 * Textes du jeu : décodeur de bits (`0x3F19`), noms (ressource 9) et trois ressources de textes (`0x10`, `0x11`, `0x12`).
 *
 * Source : `StringData` (engines/lure/strings.cpp, ScummVM, GPL v3+), tables écrites à la main de `create_lure` pour `0x3F19`.
 * Formats :
 * - **table de décodage** (`0x3F19`) : suite d'enregistrements `caractère` (1 octet), suite de `'0'` / `'1'` terminée par un octet nul ; la
 *   liste se termine par un octet `0xFF`. La suite de bits est lue dans l'ordre du flux : le premier bit lu est le bit de rang 0 de
 *   la valeur. Code préfixe (au plus 18 bits) ; au plus 218 entrées (145 en français) ;
 * - **ressource de textes** : `u16` position de la table des longueurs, `u16` position des données binaires, puis des `u16` (un par
 *   bloc de 32 textes : longueur cumulée du bloc, en unités de 2 bits), puis un octet par texte (longueur en unités de 2 bits si bit 7
 *   nul, sinon `(v & 0x7F) << 3`, approximation par excès), puis le flux de bits. Début d'un texte : somme des blocs précédents plus les
 *   longueurs des textes qui précèdent dans le bloc ; puis des bits `1` (chacun saute 2 octets) terminés par un bit `0`, puis un bit
 *   « avec articles » ; le premier caractère suit. Entre deux textes le flux contient 2 à 20 bits de remplissage (mesuré) ;
 * - **noms** (ressource 9) : `u16` positions (le premier donne aussi le nombre de noms x 2), chaîne terminée par 0 à chaque position.
 * Un texte est une suite de caractères du jeu terminée par un caractère nul. `%` suivi de `1` ou d'un autre caractère insère le nom du hotspot ou
 * du personnage ; un code `>= 0xA0` insère le fragment de nom d'indice `code - 0xA0` (ressource 9) ; les identifiants portent un numéro
 * d'article dans les trois bits de poids fort (`id & 0x1FFF` pour le texte).
 *
 * Remappage selon la pièce (`StringData::initPosition`) : dans une pièce `>= 0x2A`, les identifiants 2 000 à 3 999 renvoient au texte `0x76` ;
 * dans une pièce `< 0x2A`, ceux de 4 000 et plus aussi.
 *
 * Écarts volontaires : le texte n'est pas copié dans un tampon de 1 024 octets (pas de dépassement possible) ; la correction du texte italien
 * non terminé n'est pas portée ; le décodage renvoie des éléments typés (`LureText`) et la composition finale est dans `composeText`.
 */

/** `STRING_ID_RANGE` et `STRING_ID_UPPER` : un identifiant de texte appartient à l'une des trois ressources. */
export const STRING_ID_RANGE = 0x7d0;
export const STRING_ID_UPPER = 0xfa0;
/** Texte renvoyé pour les identifiants hors de la plage de la pièce. */
export const STRING_REMAP_ID = 0x76;
export const STRING_REMAP_ROOM = 0x2a;
export const NAMES_RESOURCE_ID = 9;
export const STRINGS_RESOURCE_IDS = [0x10, 0x11, 0x12] as const;
export const STRING_DECODER_RESOURCE_ID = 0x3f19;
export const MAX_NUM_CHARS = 218;

interface TrieNode {
  zero?: TrieNode;
  one?: TrieNode;
  char?: number;
}

/** Table de décodage `0x3F19` sous forme d'arbre binaire. */
export class CharacterDecoder {
  private readonly root: TrieNode = {};
  /** Nombre de codes. */
  readonly size: number;
  /** Caractères que la table sait produire (code du jeu, 0 = fin de texte comprise). */
  readonly characters: ReadonlySet<number>;

  constructor(table: Uint8Array) {
    let at = 0;
    let count = 0;
    const characters = new Set<number>();
    while (table[at] !== 0xff) {
      if (at >= table.length) throw new Error("table de décodage invalide : marque de fin 0xFF absente");
      const char = table[at++]!;
      let node = this.root;
      let bits = 0;
      while (table[at] !== 0) {
        if (at >= table.length) throw new Error("table de décodage invalide : séquence non terminée");
        const bit = table[at++]!;
        if (bit !== 0x30 && bit !== 0x31) throw new Error("table de décodage invalide : caractère inattendu dans une séquence de bits");
        if (node.char !== undefined) throw new Error("table de décodage invalide : un code est le préfixe d'un autre");
        const key = bit === 0x31 ? "one" : "zero";
        node = node[key] ??= {};
        bits++;
      }
      at++;
      if (bits === 0 || bits > 18) throw new Error("table de décodage invalide : longueur de code hors de 1 à 18 bits");
      if (node.char !== undefined || node.zero || node.one) throw new Error("table de décodage invalide : codes en conflit");
      node.char = char;
      characters.add(char);
      if (++count > MAX_NUM_CHARS) throw new Error("table de décodage invalide : plus de 218 codes");
    }
    if (at + 1 !== table.length) throw new Error("table de décodage invalide : octets après la marque de fin");
    this.size = count;
    this.characters = characters;
  }

  /** Lit un caractère (`StringData::readCharacter`) avec `readBit()` ; lève si la séquence est inconnue. */
  read(readBit: () => number): number {
    let node = this.root;
    for (let bits = 0; bits < 18; bits++) {
      const next = readBit() === 1 ? node.one : node.zero;
      if (!next) break;
      node = next;
      if (node.char !== undefined) return node.char;
    }
    throw new Error("séquence de bits inconnue dans un texte");
  }
}

/** Élément d'un texte décodé. */
export type TextPart =
  | { kind: "text"; value: string }
  /** `%1` : nom du hotspot ; tout autre caractère après `%` : nom du personnage. */
  | { kind: "hotspot" }
  | { kind: "character" }
  /** Fragment de nom d'indice `index` (code >= 0xA0). */
  | { kind: "name"; index: number };

export interface LureText {
  /** Vrai si les articles du hotspot et du personnage s'insèrent (`initPosition` retourne le dernier bit lu). */
  readonly includeArticles: boolean;
  readonly parts: readonly TextPart[];
  /** Codes bruts (hors fin de texte, `%` compris, fragments de noms `>= 0xA0` compris), pour les tests de jeu de caractères. */
  readonly codes: readonly number[];
  /** Position (en bits depuis le début de la ressource) du premier caractère et du bit qui suit le caractère nul final. */
  readonly startBit: number;
  readonly endBit: number;
}

export class LureTexts {
  private readonly names: Uint8Array;
  private readonly tables: readonly [Uint8Array, Uint8Array, Uint8Array];
  private readonly decoder: CharacterDecoder;

  constructor(names: Uint8Array, tables: readonly [Uint8Array, Uint8Array, Uint8Array], decoderTable: Uint8Array) {
    this.names = names;
    this.tables = tables;
    this.decoder = new CharacterDecoder(decoderTable);
  }

  get characterDecoder(): CharacterDecoder {
    return this.decoder;
  }

  /** Nombre de textes d'une des trois ressources (0, 1 ou 2). */
  count(set: 0 | 1 | 2): number {
    const table = this.tables[set];
    return (table[2]! | (table[3]! << 8)) - (table[0]! | (table[1]! << 8));
  }

  /** Nombre de fragments de noms. */
  get nameCount(): number {
    return (this.names[0]! | (this.names[1]! << 8)) >> 1;
  }

  /** `getName` : fragment ou nom d'indice `index`, en codes du jeu (sans l'octet nul final). */
  nameCodes(index: number): Uint8Array {
    if (index < 0 || index >= this.nameCount) throw new RangeError(`indice de nom ${index} invalide`);
    const start = this.names[index * 2]! | (this.names[index * 2 + 1]! << 8);
    let end = start;
    while (this.names[end] !== 0) end++;
    return this.names.subarray(start, end);
  }

  /** Ressource et rang d'un identifiant, après le remappage dépendant de la pièce (`roomNumber` omis = aucun remappage). */
  locate(stringId: number, roomNumber?: number): { set: 0 | 1 | 2; index: number } {
    let id = stringId;
    if (roomNumber !== undefined) {
      if (roomNumber >= STRING_REMAP_ROOM && id >= STRING_ID_RANGE && id < STRING_ID_UPPER) id = STRING_REMAP_ID;
      if (roomNumber < STRING_REMAP_ROOM && id >= STRING_ID_UPPER) id = STRING_REMAP_ID;
    }
    if (id < STRING_ID_RANGE) return { set: 0, index: id };
    if (id < STRING_ID_RANGE * 2) return { set: 1, index: id - STRING_ID_RANGE };
    return { set: 2, index: id - STRING_ID_RANGE * 2 };
  }

  /** `StringData::initPosition` pour un rang dans une ressource : position du premier bit et drapeau des articles. */
  private position(set: 0 | 1 | 2, index: number): { bytePos: number; bitMask: number; includeArticles: boolean } {
    const table = this.tables[set];
    const word = (at: number): number => table[at]! | (table[at + 1]! << 8);
    let total = 0;
    let at = 4;
    for (let block = index >> 5; block > 0; block--, at += 2) total += word(at);

    const inBlock = index & 0x1f;
    if (inBlock !== 0) {
      let p = (index & 0xffe0) + word(0);
      for (let i = 0; i < inBlock; i++) {
        const v = table[p++]!;
        total += (v & 0x80) === 0 ? v : (v & 0x7f) << 3;
      }
    }

    let bitMask = 0x80;
    if ((total & 3) !== 0) bitMask >>= (total & 3) * 2;
    let bytePos = (total >> 2) + word(2);

    const readBit = (): number => {
      if (bytePos >= table.length) throw new Error("texte non terminé : fin de la ressource atteinte");
      const result = (table[bytePos]! & bitMask) !== 0 ? 1 : 0;
      bitMask >>= 1;
      if (bitMask === 0) {
        bitMask = 0x80;
        bytePos++;
      }
      return result;
    };
    while (readBit() !== 0) bytePos += 2;
    const includeArticles = readBit() !== 0;
    return { bytePos, bitMask, includeArticles };
  }

  /** Décode le texte de rang `index` de la ressource `set`. */
  decodeAt(set: 0 | 1 | 2, index: number): LureText {
    if (index < 0 || index >= this.count(set)) throw new RangeError(`texte ${index} absent de la ressource ${STRINGS_RESOURCE_IDS[set]}`);
    const table = this.tables[set];
    const start = this.position(set, index);
    const includeArticles = start.includeArticles;
    let { bytePos, bitMask } = start;
    const bitOffset = (): number => bytePos * 8 + (Math.clz32(bitMask) - 24);
    const startBit = bitOffset();
    const readBit = (): number => {
      if (bytePos >= table.length) throw new Error("texte non terminé : fin de la ressource atteinte");
      const result = (table[bytePos]! & bitMask) !== 0 ? 1 : 0;
      bitMask >>= 1;
      if (bitMask === 0) {
        bitMask = 0x80;
        bytePos++;
      }
      return result;
    };

    const parts: TextPart[] = [];
    const codes: number[] = [];
    let run = "";
    const flush = (): void => {
      if (run !== "") parts.push({ kind: "text", value: run });
      run = "";
    };
    for (let ch = this.decoder.read(readBit); ch !== 0; ch = this.decoder.read(readBit)) {
      if (ch === 0x25) {
        // '%'
        flush();
        const which = this.decoder.read(readBit);
        parts.push({ kind: which === 0x31 ? "hotspot" : "character" });
        codes.push(0x25, which);
      } else if (ch >= 0xa0) {
        flush();
        parts.push({ kind: "name", index: ch - 0xa0 });
        codes.push(ch);
      } else {
        run += String.fromCharCode(ch);
        codes.push(ch);
      }
    }
    flush();
    return { includeArticles, parts, codes, startBit, endBit: bitOffset() };
  }

  /** `StringData::getString` : texte d'identifiant `stringId` (les bits de poids fort portent l'article et sont ignorés). */
  decode(stringId: number, roomNumber?: number): LureText | undefined {
    const id = stringId & 0x1fff;
    if (id === 0) return undefined;
    const { set, index } = this.locate(id, roomNumber);
    return this.decodeAt(set, index);
  }
}

export interface ComposeOptions {
  hotspotName?: string;
  characterName?: string;
  hotspotArticle?: number;
  characterArticle?: number;
  /** Textes des articles (`S_ARTICLE_LIST` de `0x3F17`), indexés par `article - 1`. */
  articles?: readonly string[];
}

/**
 * Assemble un texte décodé en chaîne de codes du jeu (non convertie en Unicode : voir `charset.ts`), comme `StringData::getString` : un nom
 * absent est ignoré, un numéro d'article positif ajoute le texte de l'article devant le nom.
 */
export function composeText(texts: LureTexts, text: LureText, options: ComposeOptions = {}): string {
  let out = "";
  for (const part of text.parts) {
    if (part.kind === "text") {
      out += part.value;
    } else if (part.kind === "name") {
      out += String.fromCharCode(...texts.nameCodes(part.index));
    } else {
      const isHotspot = part.kind === "hotspot";
      const name = isHotspot ? options.hotspotName : options.characterName;
      if (name === undefined) continue;
      const article = !text.includeArticles ? 0 : ((isHotspot ? options.hotspotArticle : options.characterArticle) ?? 0);
      out += article > 0 ? (options.articles?.[article - 1] ?? "") + name : name;
    }
  }
  return out;
}
