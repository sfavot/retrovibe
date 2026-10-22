import { parseExtTable, readExtResource, type ExtItem } from "../data/ext";
import { getTotResource, localizedTextFile, parseTot, parseTotHeader, type Language, type Tot } from "../data/tot";

/** Source de fichiers synchrone : les archives ouvertes (voir `DataFiles` dans game.ts). */
export interface FileSource {
  get(name: string): Uint8Array | undefined;
  has(name: string): boolean;
}

export interface Resource {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Ordre de repli des langues quand celle demandée n'a pas de fichier de textes. */
const LANGUAGE_FALLBACK: Language[] = ["fr", "de", "gb", "es", "it", "us"];

const EXT_BASE = 30000;

/**
 * Ressources d'un TOT : table de ressources interne, fichier .EXT, COMMUN.IM<n> / COMMUN.EX<n> partagés
 * et table de textes (intégrée au TOT ou dans le fichier de langue).
 */
export class Resources {
  private readonly extFile: Uint8Array | null;
  private readonly extItems: ExtItem[] | null;

  constructor(
    readonly tot: Tot,
    readonly totName: string,
    ext: Uint8Array | null,
    private readonly im: Uint8Array | null,
    private readonly commun: Uint8Array | null,
    /** Octets de la table de textes (pour retrouver les offsets absolus dans la table). */
    readonly textData: Uint8Array | null,
  ) {
    this.extFile = ext;
    this.extItems = ext && ext.length >= 3 ? parseExtTable(ext) : null;
  }

  /** Ressource par numéro : >= 30000 dans l'EXT, sinon dans le TOT (ou COMMUN.IM). */
  getResource(id: number): Resource | null {
    id &= 0xffff;
    if (id >= EXT_BASE) return this.getExt(id - EXT_BASE);
    return getTotResource(this.tot, id, this.im ?? undefined);
  }

  private getExt(index: number): Resource | null {
    const item = this.extItems?.[index];
    if (!item || !this.extFile) return null;
    if (item.inCommun && !this.commun) return null;
    const end = item.offset + item.size;
    const source = item.inCommun ? this.commun! : this.extFile;
    if (end > source.length) return null;
    return readExtResource(this.extFile, item, this.commun ?? undefined);
  }

  /** Octets d'un texte (null s'il est absent). */
  getTextItem(id: number): Uint8Array | null {
    return this.tot.texts?.get(id & 0xffff) ?? null;
  }

  get textCount(): number {
    return this.tot.texts?.count ?? 0;
  }
}

/** Fichier de langue d'un TOT : la langue demandée, sinon la première qui existe. */
function findLanguageFile(files: FileSource, base: string, wanted: Language): Uint8Array | undefined {
  for (const language of [wanted, ...LANGUAGE_FALLBACK]) {
    const data = files.get(localizedTextFile(base, language));
    if (data) return data;
  }
  return undefined;
}

/** Charge `<name>.TOT` avec ses textes et ressources ; null si le TOT est introuvable. */
export function loadResources(files: FileSource, name: string, language: Language): Resources | null {
  const base = name.replace(/\.[^.]*$/, "");
  const totFile = files.get(`${base}.TOT`);
  if (!totFile) return null;

  const localized = parseTotHeader(totFile).textsOffset === 0 ? findLanguageFile(files, base, language) : undefined;
  const tot = parseTot(totFile, localized);

  const { header } = tot;
  let im: Uint8Array | null = null;
  if (tot.resources && !(header.communHandling !== 0 && header.imFileNumber === 0)) {
    const n = header.imFileNumber === 0 ? 1 : header.imFileNumber;
    im = files.get(`COMMUN.IM${n}`) ?? null;
  }
  const ext = files.get(`${base}.EXT`) ?? null;
  const commun = ext ? (files.get(`COMMUN.EX${header.exFileNumber}`) ?? null) : null;

  let textData: Uint8Array | null = null;
  if (header.textsOffset === 0) textData = localized ?? null;
  else if (header.textsOffset !== 0xffffffff) textData = totFile.subarray(header.textsOffset, header.textsOffset + header.textsSize);

  return new Resources(tot, name, ext, im, commun, textData);
}
