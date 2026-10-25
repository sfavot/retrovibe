import { decodeCp437 } from "../../../data/cp437";
import { BinaryReader } from "../../../data/reader";

/**
 * Textes d'*Armaeth* (`AM1.EXE`, voir `docs/armaeth/formats.md` et `re-index.md`).
 *
 * Page de code : CP437. Tous les octets >= 0x80 des messages (0x80-0x9A, 0xA0-0xA5) sont communs à
 * CP437 et CP850, rien ne permet de trancher ; la table de normalisation du message 10 de `MSGINT`
 * (0x80-0x9A et 0xA0-0xA5 sans 0x9B-0x9F) est en CP437.
 */

/** Clé du `NOT` bit à bit appliqué aux messages (`MSG`), au dictionnaire et au texte d'aide : `gm_get_message` `2013:00ec`, `gm_load_dic` `1dd4:002a`. */
export const NOT_KEY = 0xff;
/** Clé du XOR des textes des scripts `CM1..CM4` : `gm_cm_script_step` `1346:0004`. */
export const CM_KEY = 0xbb;

/** Octet de saut de ligne dans un message (■ en CP437) : `gm_draw_text` `327a:0044` le traite comme fin de ligne. */
export const MESSAGE_LINE_BREAK = 0xfe;
/**
 * Espace insécable : `gm_draw_text` découpe les mots sur `0x20`, `0xFA` ou `0xFE`, et réécrit `0xFA` en `0x20` dans le message
 * (`parser.md` § 13.2 et § 15). Ce n'est pas une fin de paragraphe ; `·` en CP437.
 */
export const MESSAGE_SOFT_SPACE = 0xfa;

/** XOR de chaque octet avec `key` (copie). */
export function xorBytes(bytes: Uint8Array, key: number): Uint8Array {
  return Uint8Array.from(bytes, (b) => b ^ key);
}

/** Décode un texte XOR `key` en CP437, sans le NUL de fin éventuel. */
export function decodeXorText(bytes: Uint8Array, key: number): string {
  const plain = xorBytes(bytes, key);
  const end = plain.indexOf(0);
  return decodeCp437(end === -1 ? plain : plain.subarray(0, end));
}

/** Découpe un message sur ses sauts de ligne (■). */
export function messageLines(text: string): string[] {
  return text.split("■");
}

/**
 * Classe d'un identifiant de message pour `gm_get_message` : une lettre donne `lettre - 0x40`
 * (A = 1), un nombre (< 0x41) donne `nombre + 0x1e` (1 à 8 : classes 31 à 38).
 */
export function messageClass(cls: string | number): number {
  const code = typeof cls === "string" ? cls.toUpperCase().charCodeAt(0) : cls;
  return code < 0x41 ? code + 0x1e : code - 0x40;
}

/** Identifiant de message : `classe * 1000 + numéro`. */
export function messageId(cls: string | number, number: number): number {
  return messageClass(cls) * 1000 + number;
}

export interface TmsEntry {
  id: number;
  /** Offset du texte dans `MSG`. */
  offset: number;
}

export interface Tms {
  /** Longueur maximale d'un message, NUL compris (tampon de lecture). */
  maxLength: number;
  /** Entrées triées par identifiant croissant, sans l'entrée finale. */
  entries: TmsEntry[];
  /** Offset de la sentinelle `{0xFFFF, taille de MSG}`. */
  end: number;
}

/** `A1FTMS.SYS` : `u16 n`, `u16 longueur max`, `n` entrées `{u16 id, u32 offset}` (`gm_load_tms` `2013:0000`) ; la dernière est la sentinelle 0xFFFF. */
export function parseTms(bytes: Uint8Array): Tms {
  const r = new BinaryReader(bytes);
  const count = r.u16();
  const maxLength = r.u16();
  if (count < 1 || 4 + 6 * count !== bytes.length) {
    throw new Error(`TMS invalide : ${count} entrées pour ${bytes.length} octets`);
  }
  const entries: TmsEntry[] = [];
  for (let i = 0; i < count; i++) entries.push({ id: r.u16(), offset: r.u32() });
  const last = entries.pop()!;
  if (last.id !== 0xffff) throw new Error("TMS invalide : sentinelle finale absente");
  return { maxLength, entries, end: last.offset };
}

/** Messages du jeu : `TMS` (index) + `MSG` (textes NOT 0xFF terminés par NUL, sans en-tête). */
export class MessageTable {
  readonly tms: Tms;
  private readonly texts = new Map<number, string>();

  constructor(tmsBytes: Uint8Array, msgBytes: Uint8Array) {
    this.tms = parseTms(tmsBytes);
    if (this.tms.end !== msgBytes.length) {
      throw new Error(`MSG invalide : ${msgBytes.length} octets, TMS en attend ${this.tms.end}`);
    }
    const { entries, end } = this.tms;
    entries.forEach((entry, i) => {
      const next = i + 1 < entries.length ? entries[i + 1].offset : end;
      if (next < entry.offset + 1 || next > msgBytes.length) throw new Error(`MSG invalide : message ${entry.id}`);
      this.texts.set(entry.id, decodeXorText(msgBytes.subarray(entry.offset, next), NOT_KEY));
    });
  }

  get count(): number {
    return this.texts.size;
  }

  /** Identifiants dans l'ordre de l'index. */
  get ids(): number[] {
    return [...this.texts.keys()];
  }

  has(id: number): boolean {
    return this.texts.has(id);
  }

  /** Texte du message (■ = saut de ligne). Lève si l'identifiant est absent (le jeu cherche l'identifiant par dichotomie et, s'il manque, le message `S045` le remplace, `parser.md` § 13). */
  messages(id: number): string {
    const text = this.texts.get(id);
    if (text === undefined) throw new Error(`Message ${id} inconnu`);
    return text;
  }
}

/** Liste de messages en clair (`MSGINT`, `MSGHRD`, `MSGUTL`) : indexée par le numéro écrit en tête de ligne. */
export interface PlainMessages {
  /** Nombre annoncé sur la première ligne. */
  declaredCount: number;
  /** Numéro -> texte (CP437, ■ = saut de ligne). */
  messages: Map<number, string>;
}

/** Première ligne = nombre de messages, puis `<numéro> <texte>` par ligne, CRLF (`gm_load_text_table` `351f:0002`). `MSGUTL` n'est pas lu par `AM1.EXE` : c'est `SC0`, `SOS` et l'installateur qui le lisent (`screens.md`). */
export function parsePlainMessages(bytes: Uint8Array): PlainMessages {
  const lines = decodeCp437(bytes).split("\r\n");
  const declaredCount = Number(lines[0]);
  if (!Number.isInteger(declaredCount)) throw new Error("Messages invalides : nombre de messages illisible");
  const messages = new Map<number, string>();
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const match = /^\s*(\d+) (.*)$/.exec(line);
    if (!match) throw new Error(`Messages invalides : ligne « ${line} »`);
    messages.set(Number(match[1]), match[2]);
  }
  if (messages.size !== declaredCount) {
    throw new Error(`Messages invalides : ${messages.size} lus pour ${declaredCount} annoncés`);
  }
  return { declaredCount, messages };
}

/** Numéro du message de `MSGINT` qui contient la table de normalisation des accents. */
export const ACCENT_MESSAGE_ID = 10;

/**
 * Table de normalisation des accents (message 10 de `MSGINT`) : des paires `caractère → remplaçant`
 * (`//`, `::`, `--`, puis `á→a`, `é→e`, `ç→c`…). Le moteur cherche chaque caractère tapé dans la table
 * (`strchr`) et prend l'octet suivant (`gm_parse_command` `1d89:0002`) ; seuls les caractères qui ne sont ni lettres ni chiffres selon la table de classes C sont soumis à la table.
 */
export function parseAccentTable(msgint: PlainMessages): Map<string, string> {
  const raw = msgint.messages.get(ACCENT_MESSAGE_ID);
  if (raw === undefined || raw.length % 2 !== 0) throw new Error("MSGINT : table des accents illisible");
  const table = new Map<string, string>();
  for (let i = 0; i < raw.length; i += 2) table.set(raw[i], raw[i + 1]);
  return table;
}

function isAsciiAlnum(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9");
}

/**
 * Normalisation de la ligne tapée, fidèle à `gm_parse_command` (`1d89:0002`, `docs/armaeth/parser.md` § 3) : minuscules ASCII
 * seulement (`lib_strlwr`), puis chaque caractère qui n'est ni lettre ni chiffre ASCII est cherché dans la table des accents
 * (`parseAccentTable`) et remplacé par son remplaçant ; absent de la table, c'est un séparateur (une seule espace, jamais en tête
 * ni doublée). Les majuscules accentuées `É Ç Ö Ü Ñ` sortent en majuscules ASCII *après* le passage en minuscules et ne
 * retrouvent plus aucun mot : anomalie de l'original, reproduite. Seule implémentation de la normalisation (le parseur la
 * réexporte sous le nom `normalize`).
 */
export function normalizeText(text: string, accents: ReadonlyMap<string, string>): string {
  let out = "";
  let pendingSeparator = false;
  for (const raw of text) {
    const c = raw >= "A" && raw <= "Z" ? raw.toLowerCase() : raw;
    const kept = isAsciiAlnum(c) ? c : accents.get(c);
    if (kept === undefined) {
      pendingSeparator = out !== "";
      continue;
    }
    if (pendingSeparator) out += " ";
    pendingSeparator = false;
    out += kept;
  }
  return out;
}
