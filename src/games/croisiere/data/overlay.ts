/**
 * Overlays `.OVL` et textes `.FR` de Croisière pour un cadavre (docs/croisiere/formats.md § 3.6 et 3.7).
 *
 * Référence : `engines/cruise/overlay.cpp::loadOverlay` (lecture du fichier), `overlay.h` (structures), `various.cpp::getText`
 * et `object.cpp::getObjectName` (textes), `linker.cpp::updateScriptImport` (usage des imports) de ScummVM (GPL v3+, release 2026.4.0).
 *
 * Tout est grand-boutiste (u16 BE). Le fichier dépacké se découpe ainsi : 60 octets de pointeurs (ignorés), en-tête de 16 mots,
 * exports (+ noms), imports (+ noms), liens message/verbe, procédures, relations, données initiales, objets, états, ids de messages.
 * Les variables d'objet (`numObjVars`) et le BSS (`bssSize`) ne sont pas dans le fichier : l'appelant les alloue à zéro.
 *
 * Écarts volontaires, pour la liaison en place de la VM (plan.md D6) :
 * - Le bytecode et les tables d'import de chaque script restent des octets bruts grand-boutistes (`ScriptBlock.data`, une copie
 *   modifiable par bloc) ; ScummVM, lui, retourne les mots en ordre hôte (`flipGen`) pour lire les imports comme des structures.
 *   `scriptImports` / `scriptSubData2` relisent ces tables en grand-boutiste.
 * - Les champs gardent les noms de ScummVM (`offsetToSubData3`, `var12`...) pour que les références de `engine.md` restent valables ;
 *   `nameExportSize` (ScummVM) s'appelle ici `importNamesSize`, car il mesure les noms des imports.
 * - Les parties de table sont lues avec un contrôle de bornes et l'analyse échoue si des octets restent (ScummVM les ignore).
 */

/** En-tête de 16 mots, dans l'ordre du fichier (noms de ScummVM entre parenthèses quand ils diffèrent). */
export interface OvlHeader {
  numProc: number;
  numRel: number;
  /** Nombre d'exports (`numSymbGlob`). */
  numSymbGlob: number;
  /** Nombre d'imports (`numRelocGlob`). */
  numRelocGlob: number;
  /** Nombre de liens message/verbe (`numMsgRelHeader`). */
  numMsgRelHeader: number;
  numObj: number;
  numStrings: number;
  /** Nombre d'états (`size8`). */
  numStates: number;
  /** Nombre de variables d'objet, allouées à zéro (`size9`). */
  numObjVars: number;
  /** Taille des noms d'import (`nameExportSize` de ScummVM, malgré son nom). */
  importNamesSize: number;
  exportNamesSize: number;
  /** Taille des noms d'objets du `.FR` (`specialString2Length`). */
  specialString2Length: number;
  /** Taille du BSS de l'overlay, alloué à zéro (`sizeOfData4`). */
  bssSize: number;
  /** Taille des données initiales (`size12`). */
  initDataSize: number;
  /** Taille des noms de verbes du `.FR` (`specialString1Length`). */
  specialString1Length: number;
  scriptNumber: number;
}

/** Entrée d'export (`exportEntryStruct`) : `var4` est le type (20 = procédure, 30 = relation, 0..3 = variable...). */
export interface ExportEntry {
  var0: number;
  var2: number;
  var4: number;
  idx: number;
  offsetToName: number;
  /** Nom (Latin-1, jusqu'au NUL) lu dans le bloc de noms d'export. */
  name: string;
}

/** Entrée d'import de l'overlay (`importDataStruct`) : sert à relier un verbe ou un objet d'un lien message/verbe. */
export interface ImportEntry {
  var0: number;
  var1: number;
  /** 0 = verbe, 1 = objet 1, 2 = objet 2 (`linkDataStruct`). */
  linkType: number;
  linkIdx: number;
  nameOffset: number;
  /** Nom (`OVL.SYMBOLE`, `:` = sous-fonction) lu dans le bloc de noms d'import. */
  name: string;
}

/** Lien message/verbe (`linkDataStruct`, 34 octets). Les valeurs sont signées (i16), comme dans ScummVM. */
export interface MsgRelHeader {
  type: number;
  id: number;
  offsetVerbeName: number;
  verbOverlay: number;
  verbNumber: number;
  obj1Overlay: number;
  obj1Number: number;
  obj2Overlay: number;
  obj2Number: number;
  trackX: number;
  trackY: number;
  obj1NewState: number;
  obj2NewState: number;
  obj1OldState: number;
  obj2OldState: number;
  trackDirection: number;
  dialog: number;
}

/** Entrée de table d'import d'un script (`importScriptStruct`, 10 octets BE dans `ScriptBlock.data`). */
export interface ScriptImport {
  var0: number;
  var1: number;
  /** 20, 30, 40, 50 = double empilement de procédure/relation ; 70 = ignoré ; autre = variable. */
  type: number;
  /** Position dans `data` de l'instruction à réécrire. */
  offset: number;
  offsetToName: number;
}

/**
 * Procédure ou relation (`ovlData3Struct`) : en-tête de 12 mots plus `sizeOfData` octets de bloc.
 * Le bloc contient dans cet ordre habituel le bytecode, les chaînes (`offsetToSubData3`), les imports (`offsetToImportData`),
 * `subData2`, les noms d'import (`offsetToImportName`) et `subData5`.
 */
export interface ScriptBlock {
  sizeOfData: number;
  /** Chaînes du script (espace mémoire 2 de la VM). */
  offsetToSubData3: number;
  offsetToImportData: number;
  offsetToSubData2: number;
  offsetToImportName: number;
  offsetToSubData5: number;
  /** Taille du BSS local du script (`sysKey`). */
  sysKey: number;
  var12: number;
  numRelocGlob: number;
  subData2Size: number;
  var18: number;
  var1A: number;
  /** Octets du bloc, grand-boutistes, copiés du fichier : la VM les modifie en place. */
  data: Uint8Array;
}

/** Objet (`objDataStruct`). `class` : 0 MULTIPLE, 1 VARIABLE, 2 UNIQUE, 3 THEME. */
export interface OvlObject {
  type: number;
  class: number;
  nameOffset: number;
  numStates: number;
  varTableIdx: number;
  firstStateIdx: number;
  stateTableIdx: number;
}

/** État initial d'un objet (`objectParams`, 12 octets). */
export interface OvlState {
  X: number;
  Y: number;
  Z: number;
  frame: number;
  scale: number;
  state: number;
}

export interface OverlayData {
  header: OvlHeader;
  exports: ExportEntry[];
  /** Bloc de noms d'export tel que dans le fichier. */
  exportNames: Uint8Array;
  imports: ImportEntry[];
  importNames: Uint8Array;
  msgRelHeaders: MsgRelHeader[];
  procs: ScriptBlock[];
  /** « Relocations » du fichier : scripts de relation objet/verbe. */
  rels: ScriptBlock[];
  /** Données initiales (`ptr8`, espace mémoire 6 de la VM) : copie modifiable. */
  initData: Uint8Array;
  objects: OvlObject[];
  states: OvlState[];
  /** Un identifiant par message (`stringTable[i].idx`). */
  messageIds: number[];
}

const PREFIX_SIZE = 60;
const HEADER_WORDS = 16;

class Reader {
  pos = 0;
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array, readonly what: string) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new RangeError(`${this.what} tronqué à l'offset ${this.pos} (${n} octets attendus)`);
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos);
    this.pos += 2;
    return v;
  }

  /** Copie de `n` octets (modifiable sans toucher au fichier). */
  copy(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/** Chaîne Latin-1 jusqu'au premier NUL (ou la fin) à partir de `offset`. */
export function latin1String(bytes: Uint8Array, offset = 0): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  let out = "";
  for (let i = offset; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * `index`-ième chaîne d'un bloc de chaînes NUL concaténées (`getObjectName`). Lève une erreur si l'index dépasse le bloc
 * (ScummVM lirait au-delà).
 */
export function nthString(blob: Uint8Array, index: number): string {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    const nul = blob.indexOf(0, pos);
    if (nul < 0) throw new RangeError(`chaîne ${index} absente du bloc`);
    pos = nul + 1;
  }
  if (pos >= blob.length) throw new RangeError(`chaîne ${index} absente du bloc`);
  return latin1String(blob, pos);
}

/** Toutes les chaînes d'un bloc de chaînes NUL concaténées (la dernière doit être terminée par un NUL). */
export function splitNulStrings(blob: Uint8Array): string[] {
  const out: string[] = [];
  let pos = 0;
  while (pos < blob.length) {
    const nul = blob.indexOf(0, pos);
    const end = nul < 0 ? blob.length : nul;
    out.push(latin1String(blob.subarray(pos, end)));
    pos = end + 1;
  }
  return out;
}

function readScriptHeaders(r: Reader, count: number): Array<Omit<ScriptBlock, "data">> {
  const headers: Array<Omit<ScriptBlock, "data">> = [];
  for (let i = 0; i < count; i++) {
    r.skip(4); // pointeur mémoire
    headers.push({
      sizeOfData: r.i16(),
      offsetToSubData3: r.i16(),
      offsetToImportData: r.i16(),
      offsetToSubData2: r.i16(),
      offsetToImportName: r.i16(),
      offsetToSubData5: r.i16(),
      sysKey: r.i16(),
      var12: r.i16(),
      numRelocGlob: r.i16(),
      subData2Size: r.i16(),
      var18: r.i16(),
      var1A: r.i16(),
    });
  }
  return headers;
}

function readScripts(r: Reader, count: number): ScriptBlock[] {
  const headers = readScriptHeaders(r, count);
  return headers.map((h) => {
    if (h.sizeOfData < 0) throw new RangeError("script de taille négative");
    return { ...h, data: r.copy(h.sizeOfData) };
  });
}

/** Analyse un `.OVL` dépacké. Lève une erreur si le fichier est tronqué ou s'il reste des octets non expliqués. */
export function parseOverlay(file: Uint8Array): OverlayData {
  const r = new Reader(file, "OVL");
  r.skip(PREFIX_SIZE);
  const w: number[] = [];
  for (let i = 0; i < HEADER_WORDS; i++) w.push(r.u16());
  const header: OvlHeader = {
    numProc: w[0]!,
    numRel: w[1]!,
    numSymbGlob: w[2]!,
    numRelocGlob: w[3]!,
    numMsgRelHeader: w[4]!,
    numObj: w[5]!,
    numStrings: w[6]!,
    numStates: w[7]!,
    numObjVars: w[8]!,
    importNamesSize: w[9]!,
    exportNamesSize: w[10]!,
    specialString2Length: w[11]!,
    bssSize: w[12]!,
    initDataSize: w[13]!,
    specialString1Length: w[14]!,
    scriptNumber: w[15]!,
  };

  const exportRows: Array<Omit<ExportEntry, "name">> = [];
  for (let i = 0; i < header.numSymbGlob; i++) {
    exportRows.push({ var0: r.u16(), var2: r.u16(), var4: r.u16(), idx: r.u16(), offsetToName: r.u16() });
  }
  const exportNames = r.copy(header.exportNamesSize);
  const exports = exportRows.map((e) => ({ ...e, name: latin1String(exportNames, e.offsetToName) }));

  const importRows: Array<Omit<ImportEntry, "name">> = [];
  for (let i = 0; i < header.numRelocGlob; i++) {
    importRows.push({ var0: r.u16(), var1: r.u16(), linkType: r.u16(), linkIdx: r.u16(), nameOffset: r.u16() });
  }
  const importNames = r.copy(header.importNamesSize);
  const imports = importRows.map((e) => ({ ...e, name: latin1String(importNames, e.nameOffset) }));

  const msgRelHeaders: MsgRelHeader[] = [];
  for (let i = 0; i < header.numMsgRelHeader; i++) {
    msgRelHeaders.push({
      type: r.i16(),
      id: r.i16(),
      offsetVerbeName: r.i16(),
      verbOverlay: r.i16(),
      verbNumber: r.i16(),
      obj1Overlay: r.i16(),
      obj1Number: r.i16(),
      obj2Overlay: r.i16(),
      obj2Number: r.i16(),
      trackX: r.i16(),
      trackY: r.i16(),
      obj1NewState: r.i16(),
      obj2NewState: r.i16(),
      obj1OldState: r.i16(),
      obj2OldState: r.i16(),
      trackDirection: r.i16(),
      dialog: r.i16(),
    });
  }

  // Chaque famille de scripts : d'abord tous les en-têtes, puis tous les blocs.
  const procs = readScripts(r, header.numProc);
  const rels = readScripts(r, header.numRel);
  const initData = r.copy(header.initDataSize);

  const objects: OvlObject[] = [];
  for (let i = 0; i < header.numObj; i++) {
    objects.push({
      type: r.i16(),
      class: r.u16(),
      nameOffset: r.i16(),
      numStates: r.i16(),
      varTableIdx: r.i16(),
      firstStateIdx: r.i16(),
      stateTableIdx: r.i16(),
    });
  }

  const states: OvlState[] = [];
  for (let i = 0; i < header.numStates; i++) {
    states.push({ X: r.i16(), Y: r.i16(), Z: r.i16(), frame: r.i16(), scale: r.i16(), state: r.i16() });
  }

  const messageIds: number[] = [];
  for (let i = 0; i < header.numStrings; i++) messageIds.push(r.i16());

  // Le moteur alloue `extSize + 2` octets : au plus le padding d'un octet de la taille impaire peut rester.
  const leftover = file.length - r.pos;
  if (leftover > 1 || (leftover === 1 && file[r.pos] !== 0)) {
    throw new RangeError(`OVL : ${leftover} octets non expliqués après l'offset ${r.pos}`);
  }

  return { header, exports, exportNames, imports, importNames, msgRelHeaders, procs, rels, initData, objects, states, messageIds };
}

/** Table d'import d'un script : `numRelocGlob` entrées de 10 octets BE à `offsetToImportData`. */
export function scriptImports(block: ScriptBlock): ScriptImport[] {
  if (!block.offsetToImportData || block.numRelocGlob <= 0) return [];
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const out: ScriptImport[] = [];
  for (let i = 0; i < block.numRelocGlob; i++) {
    const at = block.offsetToImportData + i * 10;
    out.push({
      var0: view.getUint16(at),
      var1: view.getUint16(at + 2),
      type: view.getUint16(at + 4),
      offset: view.getUint16(at + 6),
      offsetToName: view.getUint16(at + 8),
    });
  }
  return out;
}

/** Nom d'un import de script : chaîne à `offsetToImportName + entry.offsetToName` dans le bloc. */
export function scriptImportName(block: ScriptBlock, entry: ScriptImport): string {
  return latin1String(block.data, block.offsetToImportName + entry.offsetToName);
}

/** `subData2` d'un script : `subData2Size` entrées de 5 mots BE (sémantique non exploitée par ScummVM, hors liaison). */
export function scriptSubData2(block: ScriptBlock): number[][] {
  if (!block.offsetToSubData2 || block.subData2Size <= 0) return [];
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength);
  const out: number[][] = [];
  for (let i = 0; i < block.subData2Size; i++) {
    const at = block.offsetToSubData2 + i * 10;
    out.push([0, 2, 4, 6, 8].map((k) => view.getUint16(at + k)));
  }
  return out;
}

/** Textes d'un overlay (fichier `<NOM>.FR`). */
export interface OverlayTexts {
  /** Bloc des noms de verbes (chaînes NUL concaténées), tel que dans le fichier. */
  verbNames: Uint8Array;
  /** Bloc des noms d'objets (idem). */
  objectNames: Uint8Array;
  /**
   * Messages : `numStrings` chaînes Latin-1 sans leur NUL final ; `|` = saut de ligne. Un message de longueur 0 est `""`
   * (ScummVM y met un pointeur nul).
   */
  messages: string[];
}

/** Analyse un `.FR` dépacké ; `numStrings` vient de l'en-tête de l'OVL correspondant. Les octets restants (padding) sont ignorés s'ils sont nuls. */
export function parseOverlayTexts(file: Uint8Array, numStrings: number): OverlayTexts {
  const r = new Reader(file, "FR");
  const verbNames = r.copy(r.u16());
  const objectNames = r.copy(r.u16());
  const messages: string[] = [];
  for (let i = 0; i < numStrings; i++) {
    const length = r.u16();
    const raw = r.copy(length);
    messages.push(latin1String(raw));
  }
  const leftover = file.length - r.pos;
  if (leftover > 1 || (leftover === 1 && file[r.pos] !== 0)) {
    throw new RangeError(`FR : ${leftover} octets non expliqués après l'offset ${r.pos}`);
  }
  return { verbNames, objectNames, messages };
}

/** Un overlay et ses textes, lus dans les volumes (`NOM.OVL`, `NOM.FR` si l'overlay a des chaînes ou des noms de verbes). */
export interface LoadedOverlay {
  data: OverlayData;
  texts: OverlayTexts | null;
}

/** `readFile(nom)` : contenu dépacké d'un fichier des volumes (`CruiseVolumes.readFile`). */
export function loadOverlayFiles(name: string, readFile: (file: string) => Uint8Array): LoadedOverlay {
  const data = parseOverlay(readFile(`${name}.OVL`));
  const needsTexts = data.header.numStrings > 0 || data.header.specialString1Length > 0;
  return { data, texts: needsTexts ? parseOverlayTexts(readFile(`${name}.FR`), data.header.numStrings) : null };
}
