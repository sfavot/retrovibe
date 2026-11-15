/**
 * Table des overlays chargés et éditeur de liens (bytecode réécrit en place).
 *
 * Références (ScummVM `engines/cruise/`, GPL v3+, release 2026.4.0, lu puis réécrit) :
 * - `overlay.cpp` : `initOverlayTable`, `loadOverlay` (index stables et croissants, tranche de `globalVars` au premier chargement),
 *   `freeOverlay`, `findOverlayByName` / `findOverlayByName2` ;
 * - `linker.cpp` : `parseExport`, `updateScriptImport`, `updateAllScriptsImports` ;
 * - `cruise_main.cpp` : `getOvlData3Entry`, `scriptFunc1Sub2`, `getNumObjectsByClass`, `getProcParam`.
 *
 * Les blocs de script restent les `Uint8Array` grand-boutistes du lecteur (`data/overlay.ts`) : l'éditeur de liens y écrit en place à
 * chaque `Op_LoadOverlay`, pour tous les overlays chargés, comme ScummVM. Un overlay libéré garde son nom et son index : les liens
 * patchés dans les autres overlays restent valables s'il est rechargé au même index.
 *
 * Écarts volontaires : le fichier est lu par `data/overlay.ts`, qui refuse un fichier incohérent (ScummVM lirait au-delà). Les messages
 * de longueur nulle sont des chaînes vides (ScummVM : pointeur nul).
 */
import {
  loadOverlayFiles,
  scriptImportName,
  scriptImports,
  type ExportEntry,
  type MsgRelHeader,
  type OvlHeader,
  type OvlObject,
  type ScriptBlock,
} from "../data/overlay";
import { ObjClass, OVERLAY_TABLE_SIZE, ScriptError } from "./ids";
import { int16, strToUpper, writeI16 } from "./memory";

/** Accès aux fichiers des volumes (`CruiseVolumes` le satisfait). */
export interface GameFiles {
  has(name: string): boolean;
  readFile(name: string): Uint8Array;
}

/** Paramètres d'un état ou d'une variable d'objet (`objectParams`, six `int16` mutables). */
export interface ObjectParams {
  X: number;
  Y: number;
  Z: number;
  frame: number;
  scale: number;
  state: number;
}

export function emptyParams(): ObjectParams {
  return { X: 0, Y: 0, Z: 0, frame: 0, scale: 0, state: 0 };
}

/** Données d'un overlay en mémoire (`ovlDataStruct`). */
export interface OverlayData {
  header: OvlHeader;
  exports: ExportEntry[];
  /** Imports de l'overlay (`arrayRelocGlob`) : liens des verbes et objets des relations. */
  imports: { linkType: number; linkIdx: number; name: string }[];
  /** Liens message/verbe (`arrayMsgRelHeader`) : l'éditeur de liens réécrit les champs verbe/obj1/obj2. */
  msgRelHeaders: MsgRelHeader[];
  procs: ScriptBlock[];
  rels: ScriptBlock[];
  /** Données initiales (`ptr8`, espace mémoire 6). */
  initData: Uint8Array;
  objects: OvlObject[];
  /** États (`arrayStates`), copiés du fichier. */
  states: ObjectParams[];
  /** Variables d'objet (`arrayObjVar`), allouées à zéro. */
  objVars: ObjectParams[];
  /** BSS de l'overlay (`data4Ptr`, espace mémoire 5), alloué à zéro. */
  bss: Uint8Array;
  /** Noms de verbes et d'objets (blocs de chaînes NUL concaténées du `.FR`). */
  verbNames: Uint8Array;
  objectNames: Uint8Array;
  messages: string[];
  messageIds: number[];
}

/** Entrée de `overlayTable`. */
export interface OverlayEntry {
  name: string;
  alreadyLoaded: boolean;
  /** Non nul : les scripts de l'overlay sont gelés (`Op_FreezeOverlay`). */
  executeScripts: number;
  /** Début de la tranche de `globalVars` des objets MULTIPLE et THEME. */
  state: number;
  data: OverlayData | null;
}

const EMPTY_HEADER: OvlHeader = {
  numProc: 0, numRel: 0, numSymbGlob: 0, numRelocGlob: 0, numMsgRelHeader: 0, numObj: 0, numStrings: 0, numStates: 0,
  numObjVars: 0, importNamesSize: 0, exportNamesSize: 0, specialString2Length: 0, bssSize: 0, initDataSize: 0,
  specialString1Length: 0, scriptNumber: 0,
};

/** Overlay vide (`mallocAndZero(sizeof(ovlDataStruct))`) : ce qui reste quand le fichier est introuvable. */
function emptyOverlayData(): OverlayData {
  return {
    header: { ...EMPTY_HEADER }, exports: [], imports: [], msgRelHeaders: [], procs: [], rels: [], initData: new Uint8Array(0),
    objects: [], states: [], objVars: [], bss: new Uint8Array(0), verbNames: new Uint8Array(0), objectNames: new Uint8Array(0),
    messages: [], messageIds: [],
  };
}

export class OverlayTable {
  readonly entries: OverlayEntry[] = [];
  /** Premier index libre (`numOfLoadedOverlay`), ne fait que croître. */
  numOfLoadedOverlay = 1;
  /** Prochaine tranche libre de `globalVars` (`stateID`). */
  stateID = 0;

  constructor(private readonly files: GameFiles) {
    this.reset();
  }

  /** `initOverlayTable`. */
  reset(): void {
    this.entries.length = 0;
    for (let i = 0; i < OVERLAY_TABLE_SIZE; i++) this.entries.push({ name: "", alreadyLoaded: false, executeScripts: 0, state: 0, data: null });
    this.numOfLoadedOverlay = 1;
  }

  entry(idx: number): OverlayEntry {
    const e = this.entries[idx];
    if (!e) throw new RangeError(`index d'overlay ${idx} hors de la table`);
    return e;
  }

  /** `findOverlayByName` (même code que `findOverlayByName2`) : nom exact, -4 si absent. */
  findByName(name: string): number {
    for (let i = 1; i < this.numOfLoadedOverlay; i++) if (this.entries[i]!.name === name) return i;
    return ScriptError.noData;
  }

  /** `isOverlayLoaded` (`Op_FindOverlay`) : index si chargé, sinon 0. */
  findLoaded(name: string): number {
    for (let i = 1; i < this.numOfLoadedOverlay; i++) {
      const e = this.entries[i]!;
      if (e.name === name && e.alreadyLoaded) return i;
    }
    return 0;
  }

  /** `getOvlData3Entry` : procédure `param` de l'overlay, ou `null`. */
  proc(ovl: number, param: number): ScriptBlock | null {
    const d = this.entries[ovl]?.data;
    if (!d || param < 0 || param >= d.procs.length) return null;
    return d.procs[param]!;
  }

  /** `scriptFunc1Sub2` : script de relation `param`, ou `null`. */
  rel(ovl: number, param: number): ScriptBlock | null {
    const d = this.entries[ovl]?.data;
    if (!d || param < 0 || param >= d.rels.length) return null;
    return d.rels[param]!;
  }

  /** `getNumObjectsByClass`. */
  countObjectsByClass(ovl: number, cls: number): number {
    const d = this.entries[ovl]?.data;
    if (!d) return 0;
    return d.objects.filter((o) => o.class === cls).length;
  }

  /**
   * `loadOverlay` : index de l'overlay (déjà chargé ou chargé maintenant), -18 si le fichier manque. Un nom inconnu prend l'index
   * `numOfLoadedOverlay` ; un nom déjà vu reprend son index. La tranche de `globalVars` n'est allouée qu'au premier chargement.
   */
  load(name: string): number {
    let idx = this.findByName(name);
    let newNumber = this.numOfLoadedOverlay;
    let notLoadedBefore = false;
    if (idx === ScriptError.noData) {
      idx = this.numOfLoadedOverlay;
      newNumber++;
      notLoadedBefore = true;
    }
    const entry = this.entry(idx);
    if (entry.alreadyLoaded) return idx;

    entry.data = emptyOverlayData();
    entry.name = name;
    entry.alreadyLoaded = true;
    this.numOfLoadedOverlay = newNumber;

    if (!this.files.has(`${name}.OVL`)) return ScriptError.fileNotFound;
    // Le `.FR` est présent pour les 82 overlays qui en ont besoin (formats.md § 3.6) : son absence est une erreur.
    const loaded = loadOverlayFiles(name, (file) => this.files.readFile(file));
    const ovl = loaded.data;
    const data: OverlayData = {
      header: ovl.header,
      exports: ovl.exports,
      imports: ovl.imports.map((i) => ({ linkType: i.linkType, linkIdx: i.linkIdx, name: i.name })),
      msgRelHeaders: ovl.msgRelHeaders.map((h) => ({ ...h })),
      procs: ovl.procs,
      rels: ovl.rels,
      initData: ovl.initData,
      objects: ovl.objects,
      states: ovl.states.map((s) => ({ ...s })),
      objVars: Array.from({ length: ovl.header.numObjVars }, emptyParams),
      bss: new Uint8Array(ovl.header.bssSize),
      verbNames: loaded.texts?.verbNames ?? new Uint8Array(0),
      objectNames: loaded.texts?.objectNames ?? new Uint8Array(0),
      messages: loaded.texts?.messages ?? [],
      messageIds: ovl.messageIds,
    };
    entry.data = data;
    if (data.objects.length && notLoadedBefore) {
      entry.state = this.stateID;
      this.stateID += this.countObjectsByClass(idx, ObjClass.MULTIPLE) + this.countObjectsByClass(idx, ObjClass.THEME);
    }
    return idx;
  }

  /**
   * `parseExport` : symbole `OVL.NOM` (ou `OVL.NOM:s` pour une sous-fonction) cherché dans les exports d'un overlay chargé.
   * Renvoie l'export, l'index de son overlay et le drapeau « sous-fonction », ou `null`.
   */
  parseExport(symbol: string): { entry: ExportEntry; ovl: number; sub: boolean } | null {
    const dot = symbol.indexOf(".");
    let overlayName = "";
    let functionName = symbol;
    if (dot >= 0) {
      overlayName = symbol.slice(0, dot);
      functionName = symbol.slice(dot + 1);
    }
    let sub = false;
    const colon = functionName.indexOf(":");
    if (colon >= 0) {
      functionName = functionName.slice(0, colon);
      sub = true;
    }
    overlayName = strToUpper(overlayName);
    functionName = strToUpper(functionName);
    if (!overlayName) return null;
    const idx = this.findByName(overlayName);
    if (idx < 0) return null;
    const e = this.entries[idx]!;
    if (!e.alreadyLoaded || !e.data) return null;
    for (const exp of e.data.exports) {
      if (strToUpper(exp.name) === functionName) return { entry: exp, ovl: idx, sub };
    }
    return null;
  }

  /** `updateScriptImport` : réécrit les opérandes importés des scripts de l'overlay `ovlIdx`, puis ses liens de relations. */
  updateScriptImport(ovlIdx: number): number {
    const data = this.entries[ovlIdx]?.data;
    if (!data) return ScriptError.noData;
    for (const block of [...data.procs, ...data.rels]) {
      if (block.numRelocGlob <= 0) continue;
      for (const imp of scriptImports(block)) {
        if (imp.type === 70) continue;
        const found = this.parseExport(scriptImportName(block, imp));
        if (!found || !found.ovl) continue;
        const code = block.data;
        const at = imp.offset;
        if (found.sub) {
          code[at + 1] = found.ovl & 0xff;
          writeI16(code, at + 2, found.entry.idx);
        } else if (imp.type === 20 || imp.type === 30 || imp.type === 40 || imp.type === 50) {
          // double empilement : overlay puis numéro
          code[at + 1] = 0;
          code[at + 2] = found.ovl & 0xff;
          writeI16(code, at + 4, found.entry.idx);
        } else {
          const var4 = int16(found.entry.var4);
          let type = var4 & 1 ? 8 : 16;
          type |= var4 >= 0 && var4 <= 3 ? 5 : 6;
          code[at] = type;
          code[at + 1] = found.ovl & 0xff;
          writeI16(code, at + 2, found.entry.idx);
        }
      }
    }
    for (const imp of data.imports) {
      const found = this.parseExport(imp.name);
      if (!found || !found.ovl) continue;
      const header = data.msgRelHeaders[imp.linkIdx];
      if (!header) continue;
      switch (imp.linkType) {
        case 0:
          header.verbOverlay = found.ovl;
          header.verbNumber = found.entry.idx;
          break;
        case 1:
          header.obj1Overlay = found.ovl;
          header.obj1Number = found.entry.idx;
          break;
        case 2:
          header.obj2Overlay = found.ovl;
          header.obj2Number = found.entry.idx;
          break;
        default:
          break;
      }
    }
    return 0;
  }

  /** `updateAllScriptsImports` : après chaque chargement, pour tous les overlays chargés. */
  updateAllScriptsImports(): void {
    for (let i = 0; i < OVERLAY_TABLE_SIZE; i++) {
      const e = this.entries[i]!;
      if (e.data && e.alreadyLoaded) this.updateScriptImport(i);
    }
  }

  /**
   * `freeOverlay` sans la purge des scripts (faite par l'appelant, `removeScript(idx, -1)` sur les deux listes) : -4 si l'overlay
   * n'est pas chargé. Le nom et l'index restent réservés.
   */
  free(idx: number): number {
    const e = this.entries[idx];
    if (!e || !e.alreadyLoaded) return ScriptError.noData;
    e.alreadyLoaded = false;
    if (!e.data) return ScriptError.noData;
    e.data = null;
    return 0;
  }

  /** `getProcParam` : index de l'export de type `type` (20 procédure, 40 objet...) nommé exactement `name`, sinon 0. */
  procParam(ovl: number, type: number, name: string): number {
    const e = this.entries[ovl];
    if (!e || !e.alreadyLoaded || !e.data) return 0;
    for (const exp of e.data.exports) {
      if (int16(exp.var4) === type && exp.name.slice(0, 79) === name) return exp.idx;
    }
    return 0;
  }
}
