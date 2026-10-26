/**
 * Chaînes localisées de SWIV 3D : bloc 100 de `GLOBAL.BD` (voir docs/swiv3d/global-bd.md).
 *
 * Le bloc commence par un répertoire de 163 enregistrements de 8 octets `(id u16, groupe u16, offset u32)` terminé par
 * `(0xffff, 0xffff, …)`. Chaque enregistrement désigne une table : suite de paires `(id de chaîne u32, offset u32)` terminée
 * par `0xffffffff`, les offsets étant relatifs au début du bloc. Les chaînes sont terminées par NUL ; `|` y est un saut de ligne.
 *   - groupes 0 à 7 : une langue chacune (20 tables : 0-13, 20, 22, 100, 200, 1000, 1001) ;
 *   - groupe 99 : tables communes (0 : noms des langues, 1 : « 0 », 2 : un chiffre par langue, la page de glyphes de la police).
 */
import { decodeCp437 } from "../../../data/cp437";
import { BinaryReader } from "../../../data/reader";
import type { BdArchive } from "./bd";

/** Identifiant du bloc des chaînes dans `GLOBAL.BD`. */
export const STRINGS_BLOCK = 100;

/** Groupe des tables communes à toutes les langues. */
export const SHARED_GROUP = 99;

const END_OF_DIRECTORY = 0xffff;
const END_OF_TABLE = 0xffffffff;

export interface StringTables {
  /** Noms des langues, dans l'ordre des groupes 0 à 7 : English, Francais, Deutsch, Espanol, Italiano, Polski, Cestina, Portugu. */
  languages: string[];
  /**
   * Page de glyphes de chaque langue (chiffre de la table commune 2 : `00000110`). Page 0 : les octets 0x80-0xff de la langue
   * sont ceux de la page de code 437 ; page 1 (polonais, tchèque) : autre jeu de glyphes de la police, que `get` ne sait pas décoder
   * (les octets 0x80-0xff y sont rendus tels quels, en Latin-1).
   */
  glyphPages: number[];
  /** Numéros des tables d'une langue, dans l'ordre du fichier. */
  tableIds(language: number): number[];
  /** Chaînes d'une table (id de chaîne → texte), ou `undefined` si la table est absente. */
  table(language: number, table: number): ReadonlyMap<number, string> | undefined;
  /** Chaîne `id` de la table `table` de la langue `language` ; `undefined` si absente. */
  get(language: number, table: number, id: number): string | undefined;
  /** Chaîne d'une table commune (groupe 99). */
  getShared(table: number, id: number): string | undefined;
  /** Octets bruts (sans NUL) d'une chaîne, pour les pages de glyphes que `get` ne décode pas. */
  getBytes(language: number, table: number, id: number): Uint8Array | undefined;
}

interface RawTable {
  entries: Map<number, Uint8Array>;
  decoded: Map<number, string> | null;
}

function readTable(block: Uint8Array, offset: number): Map<number, Uint8Array> {
  const r = new BinaryReader(block);
  r.offset = offset;
  const entries = new Map<number, Uint8Array>();
  for (;;) {
    const id = r.u32();
    if (id === END_OF_TABLE) break;
    const start = r.u32();
    const end = block.indexOf(0, start);
    if (end < 0) throw new Error(`chaînes : texte de la chaîne ${id} non terminé`);
    entries.set(id, block.subarray(start, end));
  }
  return entries;
}

function decode(bytes: Uint8Array, page: number): string {
  return page === 0 ? decodeCp437(bytes) : String.fromCharCode(...bytes);
}

export function parseStrings(bd: BdArchive): StringTables {
  const block = bd.get(STRINGS_BLOCK);
  const r = new BinaryReader(block);
  const groups = new Map<number, Map<number, RawTable>>();
  for (;;) {
    const id = r.u16();
    const group = r.u16();
    const offset = r.u32();
    if (id === END_OF_DIRECTORY) break;
    let tables = groups.get(group);
    if (!tables) groups.set(group, (tables = new Map()));
    tables.set(id, { entries: readTable(block, offset), decoded: null });
  }

  const shared = groups.get(SHARED_GROUP);
  const names = shared?.get(0);
  const pages = shared?.get(2)?.entries.get(0);
  if (!names || !pages) throw new Error("chaînes : tables communes 0 et 2 absentes");
  const languageCount = [...groups.keys()].filter((g) => g !== SHARED_GROUP).length;
  const languages = Array.from({ length: languageCount }, (_, i) => decodeCp437(names.entries.get(i) ?? new Uint8Array()));
  const glyphPages = Array.from({ length: languageCount }, (_, i) => (pages[i] ?? 0x30) - 0x30);

  function rawTable(language: number, table: number): RawTable | undefined {
    return groups.get(language)?.get(table);
  }

  function decodedTable(language: number, table: number): Map<number, string> | undefined {
    const raw = rawTable(language, table);
    if (!raw) return undefined;
    raw.decoded ??= new Map([...raw.entries].map(([id, bytes]) => [id, decode(bytes, glyphPages[language] ?? 0)]));
    return raw.decoded;
  }

  return {
    languages,
    glyphPages,
    tableIds: (language) => [...(groups.get(language)?.keys() ?? [])],
    table: decodedTable,
    get: (language, table, id) => decodedTable(language, table)?.get(id),
    getShared(table, id) {
      const bytes = shared?.get(table)?.entries.get(id);
      return bytes && decodeCp437(bytes);
    },
    getBytes: (language, table, id) => rawTable(language, table)?.entries.get(id),
  };
}
