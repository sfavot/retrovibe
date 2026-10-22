import { BinaryReader } from "../../../data/reader";

export interface TotHeader {
  /** « 1.3 » : octets 39 à 41. */
  version: string;
  variablesCount: number;
  /** 0 : textes dans le fichier de langue ; 0xFFFFFFFF : aucun texte. */
  textsOffset: number;
  resourcesOffset: number;
  animDataSize: number;
  imFileNumber: number;
  exFileNumber: number;
  communHandling: number;
  /** Offsets des 14 fonctions d'entrée du script. */
  functions: number[];
  /** Fin du script : début de la première table (textes ou ressources). */
  scriptEnd: number;
  textsSize: number;
  resourcesSize: number;
}

export interface TotResource {
  /** Décalage dans la zone de ressources du TOT, ou index dans COMMUN.IM<n> si `inIm`. */
  offset: number;
  size: number;
  width: number;
  height: number;
  inIm: boolean;
  /** Pour `inIm` : index dans la table d'offsets de COMMUN.IM<n>. */
  index: number;
}

export interface TotResourceData {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Tot {
  header: TotHeader;
  /** Octets [0, scriptEnd) du fichier, en-tête de 128 octets compris : les offsets du script s'y rapportent. */
  script: Uint8Array;
  /** null si le TOT n'a pas de table de ressources. */
  resources: TotResource[] | null;
  /** null si le TOT n'a pas de textes. */
  texts: TextTable | null;
  /** Fichier complet. */
  file: Uint8Array;
}

const HEADER_SIZE = 128;
const NONE = 0xffffffff;

export function parseTotHeader(file: Uint8Array): TotHeader {
  if (file.length < HEADER_SIZE || file[40] !== 0x2e) throw new Error("TOT : en-tête invalide");
  const reader = new BinaryReader(file);
  const version = String.fromCharCode(file[39], file[40], file[41]);
  reader.offset = 44;
  const variablesCount = reader.u32();
  const textsOffset = reader.u32();
  const resourcesOffset = reader.u32();
  const animDataSize = reader.u16();
  reader.offset = 59;
  const imFileNumber = reader.u8();
  const exFileNumber = reader.u8();
  const communHandling = reader.u8();
  reader.offset = 100;
  const functions: number[] = [];
  for (let i = 0; i < 14; i++) functions.push(reader.u16());

  const fileSize = file.length;
  const texts = textsOffset === NONE ? 0 : textsOffset;
  const resources = resourcesOffset === NONE ? 0 : resourcesOffset;

  let scriptEnd = fileSize;
  if (texts > 0) scriptEnd = Math.min(scriptEnd, texts);
  if (resources > 0) scriptEnd = Math.min(scriptEnd, resources);

  let textsSize = 0;
  let resourcesSize = 0;
  if (texts > 0 && resources > 0) {
    if (texts > resources) {
      textsSize = fileSize - texts;
      resourcesSize = texts - resources;
    } else {
      textsSize = resources - texts;
      resourcesSize = fileSize - resources;
    }
  } else if (texts > 0) {
    textsSize = fileSize - texts;
  } else if (resources > 0) {
    resourcesSize = fileSize - resources;
  }

  return {
    version,
    variablesCount,
    textsOffset,
    resourcesOffset,
    animDataSize,
    imFileNumber,
    exFileNumber,
    communHandling,
    functions,
    scriptEnd,
    textsSize,
    resourcesSize,
  };
}

function parseResourceTable(file: Uint8Array, header: TotHeader): TotResource[] | null {
  if (header.resourcesOffset === NONE || header.resourcesOffset === 0) return null;
  const reader = new BinaryReader(file);
  reader.offset = header.resourcesOffset;
  const count = reader.i16();
  if (header.resourcesOffset + 3 + count * 10 > file.length) {
    throw new Error("TOT : table de ressources hors du fichier");
  }
  reader.u8();
  const items: TotResource[] = [];
  for (let i = 0; i < count; i++) {
    const offset = reader.i32();
    const size = reader.u16();
    const width = reader.i16();
    const height = reader.i16();
    const inIm = offset < 0;
    items.push({ offset, size, width, height, inIm, index: inIm ? -offset - 1 : i });
  }
  return items;
}

/**
 * Ressource d'un TOT. `im` = contenu de COMMUN.IM<n> pour les ressources partagées.
 * Retourne null si la ressource est vide ou hors limites.
 */
export function getTotResource(tot: Tot, id: number, im?: Uint8Array): TotResourceData | null {
  const item = tot.resources?.[id];
  if (!item || item.size === 0) return null;

  let start: number;
  let source: Uint8Array;
  if (item.inIm) {
    if (!im || item.index * 4 + 4 > im.length) return null;
    source = im;
    start = new DataView(im.buffer, im.byteOffset, im.byteLength).getUint32(item.index * 4, true);
  } else {
    source = tot.file;
    start = tot.header.resourcesOffset + 3 + (tot.resources?.length ?? 0) * 10 + item.offset;
  }
  if (start < 0 || start + item.size > source.length) return null;
  return {
    data: source.subarray(start, start + item.size),
    width: item.width,
    height: item.height,
  };
}

/** Table des textes : i16 nombre (14 bits), puis (offset, taille) u16 par texte. */
export class TextTable {
  readonly count: number;
  private readonly items: { offset: number; size: number }[] = [];

  constructor(private readonly data: Uint8Array) {
    const reader = new BinaryReader(data);
    this.count = reader.i16() & 0x3fff;
    for (let i = 0; i < this.count; i++) {
      this.items.push({ offset: reader.u16(), size: reader.u16() });
    }
  }

  /** Octets bruts du texte, ou null s'il est absent ou hors limites. */
  get(id: number): Uint8Array | null {
    const item = this.items[id];
    if (!item || item.offset === 0xffff || item.size === 0) return null;
    if (item.offset + item.size > this.data.length) return null;
    return this.data.subarray(item.offset, item.offset + item.size);
  }
}

export type Language = "fr" | "us" | "gb" | "de" | "it" | "es";

const LANGUAGE_EXTENSIONS: Record<Language, string> = {
  fr: "DAT",
  us: "USA",
  gb: "ANG",
  de: "ALL",
  it: "ITA",
  es: "ESP",
};

/** Nom du fichier de textes d'un TOT pour une langue (ex. `EMAM1000.DAT`). */
export function localizedTextFile(base: string, language: Language): string {
  return `${base.replace(/\.[^.]*$/, "")}.${LANGUAGE_EXTENSIONS[language]}`;
}

/**
 * Analyse un TOT. Si ses textes sont externes (textsOffset = 0), `localizedTexts`
 * est le contenu du fichier de langue.
 */
export function parseTot(file: Uint8Array, localizedTexts?: Uint8Array): Tot {
  const header = parseTotHeader(file);
  const resources = parseResourceTable(file, header);

  let texts: TextTable | null = null;
  if (header.textsOffset === 0) {
    if (localizedTexts && localizedTexts.length >= 2) texts = new TextTable(localizedTexts);
  } else if (header.textsOffset !== NONE) {
    texts = new TextTable(file.subarray(header.textsOffset, header.textsOffset + header.textsSize));
  }

  return { header, script: file.subarray(0, header.scriptEnd), resources, texts, file };
}

/** Charge `<base>.TOT` et son fichier de langue depuis une source de fichiers (archive, dossier…). */
export function loadTot(
  source: { get(name: string): Uint8Array | undefined },
  base: string,
  language: Language = "fr",
): Tot | null {
  const file = source.get(`${base}.TOT`);
  if (!file) return null;
  return parseTot(file, source.get(localizedTextFile(base, language)));
}
