/**
 * Sauvegarde et reprise d'une partie de *Croisière pour un cadavre* (vague S, plan.md D5) : le contenu de `saveload.cpp` de ScummVM,
 * rangé dans un objet JSON versionné pour les emplacements du site (`SaveSlots`, préfixe `croisiere:`).
 *
 * Référence : ScummVM `engines/cruise/saveload.cpp` (`DoSync` et ses `sync*`, `initVars`, `loadSavegameData`), `sound.cpp`
 * (`PCSoundFxPlayer::doSync`), `ctp.cpp` (`initCt` avec `loadCtFromSave`), `background.cpp` (`DGF1.PI1`), `cruise.cpp`
 * (`canSaveGameStateCurrently`), GPL v3 ou ultérieure, release 2026.4.0 ; lus puis réécrits.
 *
 * **Contenu** (celui de `DoSync`) : les variables de base (`syncBasicInfo`, `protectionCode` compris), la musique, les palettes, le nom du
 * CTP, la table des fonds, les `globalVars`, la base de fichiers (de quoi recharger chaque entrée), la table des overlays (noms, états,
 * gel, tranche de `globalVars`) avec, pour chaque overlay chargé, son BSS et ses variables d'objet, les listes de scripts complètes, les
 * cellules, les incrustations (rectangles sauvegardés compris), les acteurs, les zones de marche (couleurs, états) et les trajets.
 * La précharge (`preloadData`) n'est pas portée ; `var47`, `var48` et `scroll` n'existent pas dans le portage. Le RNG n'est pas sauvegardé
 * (D5, comme ScummVM).
 *
 * **Reprise** (`restoreSave`), dans l'ordre de `loadSavegameData` : `initVars`, arrêt de la musique, variables, puis **overlays rechargés
 * dans l'ordre de leurs index** (risque 4 : les index et les tranches de `globalVars` restent les mêmes), base de fichiers rechargée par
 * plages, `initCt` sans écraser couleurs, états et trajets, fonds rechargés.
 *
 * **Écarts volontaires** (ce que ScummVM ne garde pas, ou perd au chargement, et dont une reprise exacte a besoin ; la reprise est
 * alors identique, tour pour tour, à la partie ininterrompue) :
 * - le bytecode, les données initiales, les liens des relations et les états des overlays : écarts par rapport au fichier relu
 *   (`code`), soit les liens posés par l'éditeur de liens à chaque chargement d'overlay (y compris ceux, périmés, vers un overlay libéré)
 *   et toute écriture des scripts dans leurs propres données. ScummVM relit les fichiers et refait les liens (`updateAllScriptsImports`) ;
 * - les pixels des fonds : écarts par rapport au fichier du fond (`patch`), donc les incrustations et tout ce qui a été dessiné dedans,
 *   au lieu de `regenerateBackgroundIncrust` (qui ne refait pas une incrustation retirée sans être effacée, et peut charger une entrée
 *   dans la base de fichiers) ;
 * - la palette de travail et la palette affichée sont celles de la partie (ScummVM laisse celle du dernier fond rechargé) ;
 * - les polices et les sons de la base de fichiers (sans nom dans ScummVM, donc perdus au chargement) sont rechargés par leur fichier ;
 * - les entrées de la base de fichiers sont regroupées en vraies plages (ScummVM ne regroupe que les plages qui partent de l'entrée 0 du
 *   SET, sans effet sur le résultat) ;
 * - les pointeurs `prev` des cellules, parfois incohérents dans ScummVM (`sortCells`) et parcourus à l'envers par `findObject` ;
 * - l'état complet des zones de marche (tables du CTP, y compris les lignes laissées par un CTP précédent, que `initCt` n'efface pas) et
 *   les variables globales de la recherche de chemin (`actor.cpp`, `perso.cpp`) ;
 * - quelques variables globales hors de `syncBasicInfo` : `enableUser`, `xdial`, `op7BVar`, `selectDown`, `menuDown`, `buttonDown`,
 *   `flag_obstacle`, `saveOpcodeVar`, le dernier retour d'opcode (trace `SS`) ;
 * - les messages à l'écran (cellules de type 5) sont rendus de nouveau : ScummVM s'arrête sur `assert(0)` au chargement.
 * Ce qui n'est pas gardé, comme dans ScummVM : la relation en attente du second objet (bandeau « Objet:Verbe »), les menus, l'entrée
 * sélectionnée, l'état de la souris et la cadence (`gameSpeed` revient à 100 au tour suivant). La musique reprend à sa position mais
 * son compteur de tempo et ses timbres repartent de zéro (`doSync`). Limite connue : deux `LoadCt` de suite sans `freeCTP` mettent
 * bout à bout les zones rastérisées ; la reprise n'en refait qu'une (aucun cas dans les données vues).
 *
 * **Refus** (`canSave`) : comme `canSaveGameStateCurrently` (`playerMenuEnabled && userEnabled`), donc pendant l'intro ; après le
 * chargement de `DGF1.PI1` (fin du jeu) ; menu du jeu ouvert (menu d'objet, inventaire). Le temps virtuel n'est pas touché : le
 * tour suivant vient à l'échéance habituelle de la boucle.
 *
 * Module pur : il ne connaît pas le stockage.
 */
import { isPaletteOnly, parseBackground, SCREEN_PIXELS } from "../data/background";
import { loadOverlayFiles, type MsgRelHeader, type ScriptBlock } from "../data/overlay";
import { drawScreen, renderText } from "../render/draw";
import type { CroisiereSoundState } from "../audio/sound";
import type { Actor } from "./actors";
import type { Cell } from "./cells";
import { GLOBAL_VAR_COUNT, NBSCREENS, NUM_FILE_ENTRIES, ObjType, OVERLAY_TABLE_SIZE } from "./ids";
import { Cursor } from "./input";
import type { Incrust } from "./incrust";
import type { ObjectParams, OverlayData } from "./overlays";
import type { EngineState, ScriptInstance } from "./state";
import { loadCt, NUM_PERSONS } from "./walk";

/** Version du format JSON : une autre version est refusée par `parseSave`. */
export const SAVE_VERSION = 1;

/** Fond dont le chargement interdit la sauvegarde (WORKAROUND de `background.cpp`). */
export const NO_SAVE_BACKGROUND = "DGF1.PI1";

/** Plages d'octets différents d'une référence : `[début, octets en base64]`. */
export type ByteRuns = [number, string][];

/** Variables de base (`syncBasicInfo`) ; les booléens du portage valent 0 ou 1. */
const BASIC_KEYS = [
  "activeMouse", "userEnabled", "dialogueOvl", "dialogueObj", "userDelay", "sysKey", "sysX", "sysY", "automoveInc", "automoveMax",
  "displayOn", "isMessage", "automaticMode", "narratorOvl", "narratorIdx", "aniX", "aniY", "fontFileIndex", "currentActiveMenu",
  "autoOvl", "autoMsg", "var39", "var42", "var45", "var46", "flagCt", "var41", "playerMenuEnabled", "protectionCode",
] as const;
const BASIC_FLAGS = ["dialogueEnabled", "animationStart", "userWait", "autoTrack"] as const;
/** Variables globales hors de `syncBasicInfo` (écart volontaire, voir l'en-tête). */
const EXTRA_KEYS = ["enableUser", "xdial", "op7BVar", "selectDown", "menuDown", "buttonDown", "flagObstacle"] as const;
const DISPLAY_KEYS = ["masterScreen", "switchPal", "doFade", "fadeFlag", "cvtLoaded", "titleColor", "selectColor", "itemColor", "subColor"] as const;

type BasicKey = (typeof BASIC_KEYS)[number] | (typeof BASIC_FLAGS)[number];
type ExtraKey = (typeof EXTRA_KEYS)[number];
type DisplayKey = (typeof DISPLAY_KEYS)[number];

const CELL_KEYS = [
  "idx", "type", "overlay", "x", "fieldC", "spriteIdx", "color", "backgroundPlane", "freeze", "parent", "parentOverlay", "parentType",
  "followObjectOverlayIdx", "followObjectIdx", "animStart", "animEnd", "animWait", "animStep", "animChange", "animType", "animSignal",
  "animCounter", "animLoop",
] as const;
type CellKey = (typeof CELL_KEYS)[number];

const ACTOR_KEYS = [
  "overlayNumber", "idx", "type", "x", "y", "x_dest", "y_dest", "phase", "counter", "pathId", "startDirection", "nextDirection",
  "endDirection", "stepX", "stepY", "poly", "flag", "start", "freeze",
] as const satisfies readonly (keyof Actor)[];

const WALK_SCALARS = [
  "routeCoordCount", "numberOfWalkboxes", "numPoly", "incJo", "nclickNoeud", "flagAffChemin", "xMouse", "yMouse", "pointSelect", "X",
  "Y", "prem", "prem2", "distChemin", "idsol", "solmax", "D",
] as const;
const WALK_I16 = ["routeCoords", "routes", "walkboxTable", "walkboxColor", "walkboxState", "walkboxColorIndex", "walkboxZoom", "distanceTable", "selectNoeud"] as const;
const WALK_SMALL = ["tablePtselect", "solution", "fl", "sol"] as const;
type WalkScalar = (typeof WALK_SCALARS)[number];

export interface SavedScript {
  overlayNumber: number;
  scriptNumber: number;
  scriptOffset: number;
  /** BSS du processus (base64), `null` s'il n'en a pas. */
  data: string | null;
  freeze: number;
  sysKey: number;
  type: number;
  var18: number;
  var16: number;
  var1A: number;
  ccr: number;
}

/** Cellule : champs dans l'ordre de `CELL_KEYS`, puis liens (0 = tête, −1 = nul, k ≥ 1 = `cells.nodes[k − 1]`). */
export interface SavedCell {
  fields: number[];
  next: number;
  prev: number;
}

export interface SavedIncrust extends Omit<Incrust, "saved"> {
  saved: string | null;
}

export interface SavedFileEntry {
  slot: number;
  name: string;
  source: string | null;
  index: number;
  resType: number;
  resourceType: number;
  width: number;
  height: number;
  widthInColumn: number;
  transparency: number;
}

export interface SavedOverlayData {
  bss: string;
  /** Variables d'objet (`arrayObjVar`) : `[X, Y, Z, frame, scale, state]`. */
  objVars: number[][];
  /** Écarts du bytecode par rapport au fichier relu (procédures, relations), des données initiales, des liens et des états. */
  code: { procs: ByteRuns[]; rels: ByteRuns[]; initData: ByteRuns; msgRelHeaders: [number, MsgRelHeader][]; states: [number, number[]][] };
}

export interface SavedOverlay {
  name: string;
  loaded: boolean;
  executeScripts: number;
  state: number;
  data: SavedOverlayData | null;
}

export interface SavedBackground {
  /** Un écran existe à cet index (`backgroundScreens[i]` alloué). */
  present: boolean;
  name: string;
  changed: boolean;
  /** Écarts des pixels par rapport au fichier du fond (ou à un écran noir). */
  patch: ByteRuns;
}

export interface CroisiereSave {
  version: typeof SAVE_VERSION;
  /** Nom du fond de l'écran maître (description d'un emplacement). */
  background: string;
  basic: Record<BasicKey, number>;
  extra: Record<ExtraKey, number> & { saveOpcodeVar: number; lastRet: number };
  sound: CroisiereSoundState;
  display: Record<DisplayKey, number> & {
    pcFadeFlag: boolean;
    cvtPalette: number[];
    /** Palettes des écrans (base64, 768 octets chacune), de travail et affichée. */
    palScreen: string[];
    workpal: string;
    hardwarePalette: string;
    backgrounds: SavedBackground[];
  };
  /** `globalVars` (int16 petit-boutistes, base64), sans les zéros de queue. */
  globalVars: string;
  files: SavedFileEntry[];
  overlays: { numOfLoaded: number; stateID: number; entries: SavedOverlay[] };
  procs: SavedScript[];
  rels: SavedScript[];
  cells: { head: { next: number; prev: number }; nodes: SavedCell[] };
  incrusts: SavedIncrust[];
  actors: number[][];
  walk: {
    ctpName: string;
    polyStructs: "norm" | "exp" | null;
    scalars: Record<WalkScalar, number>;
    /** Tableaux int16 (base64). */
    tables: Record<(typeof WALK_I16)[number], string>;
    small: Record<(typeof WALK_SMALL)[number], number[]>;
    /** `persoTable` (int16 en base64, `null` = pas de trajet). */
    persos: (string | null)[];
  };
}

// --- base64 et plages ---

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function i16ToBase64(values: Int16Array): string {
  return toBase64(i16Bytes(values));
}

/** Relit des int16 petit-boutistes dans `into` (le reste de `into` ne change pas). */
function base64ToI16(text: string, into: Int16Array): void {
  const bytes = fromBase64(text);
  const view = new DataView(bytes.buffer);
  const n = Math.min(into.length, bytes.length >> 1);
  for (let i = 0; i < n; i++) into[i] = view.getInt16(i * 2, true);
}

function i16Bytes(values: Int16Array): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return out;
}

/** Plages où `current` diffère de `reference` (même longueur) ; deux plages séparées de moins de 8 octets sont fusionnées. */
export function diffRuns(reference: Uint8Array, current: Uint8Array): ByteRuns {
  if (reference.length !== current.length) throw new Error(`diffRuns : longueurs ${reference.length} et ${current.length}`);
  const runs: ByteRuns = [];
  let i = 0;
  while (i < current.length) {
    if (reference[i] === current[i]) {
      i++;
      continue;
    }
    const start = i;
    let end = i + 1;
    let j = end;
    while (j < current.length && j - end < 8) {
      if (reference[j] !== current[j]) end = j + 1;
      j++;
    }
    runs.push([start, toBase64(current.subarray(start, end))]);
    i = end;
  }
  return runs;
}

export function applyRuns(target: Uint8Array, runs: ByteRuns): void {
  for (const [start, data] of runs) {
    const bytes = fromBase64(data);
    if (start < 0 || start + bytes.length > target.length) throw new RangeError(`applyRuns : plage ${start}+${bytes.length} hors de ${target.length}`);
    target.set(bytes, start);
  }
}

const paramsArray = (p: ObjectParams): number[] => [p.X, p.Y, p.Z, p.frame, p.scale, p.state];
function setParams(p: ObjectParams, v: readonly number[]): void {
  [p.X, p.Y, p.Z, p.frame, p.scale, p.state] = v as [number, number, number, number, number, number];
}

// --- refus et description ---

/** Vrai si le jeu accepte une sauvegarde maintenant (voir l'en-tête : refus de ScummVM, plus `DGF1.PI1` et les menus ouverts). */
export function canSave(e: EngineState): boolean {
  if (!e.playerMenuEnabled || !e.userEnabled) return false;
  if (e.display.backgroundNames.includes(NO_SAVE_BACKGROUND)) return false;
  if (e.currentActiveMenu !== -1 || e.menuTable[0] || e.menuTable[1]) return false;
  return true;
}

/** Nom du fond affiché, sans extension (« S33 ») ; l'interface y ajoute la date. */
export function describeSave(e: EngineState): string {
  return backgroundLabel(e);
}

function backgroundLabel(e: EngineState): string {
  const name = e.display.backgroundNames[e.display.masterScreen] ?? "";
  const dot = name.indexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

// --- capture ---

function saveScript(s: ScriptInstance): SavedScript {
  return {
    overlayNumber: s.overlayNumber, scriptNumber: s.scriptNumber, scriptOffset: s.scriptOffset, data: s.data ? toBase64(s.data) : null,
    freeze: s.freeze, sysKey: s.sysKey, type: s.type, var18: s.var18, var16: s.var16, var1A: s.var1A, ccr: s.ccr,
  };
}

/** Graphe des cellules : la liste, plus les cellules hors liste encore pointées par un `prev` (ou leurs voisines). */
function saveCells(e: EngineState): CroisiereSave["cells"] {
  const head = e.cells.head;
  const ids = new Map<Cell, number>([[head, 0]]);
  const order: Cell[] = [];
  const visit = (c: Cell | null) => {
    if (c && !ids.has(c)) {
      ids.set(c, order.length + 1);
      order.push(c);
    }
  };
  for (const c of e.cells) visit(c);
  for (let k = 0; k <= order.length; k++) {
    const c = k === 0 ? head : order[k - 1]!;
    visit(c.prev);
    visit(c.next);
  }
  const ref = (c: Cell | null) => (c ? ids.get(c)! : -1);
  return {
    head: { next: ref(head.next), prev: ref(head.prev) },
    nodes: order.map((c) => ({ fields: CELL_KEYS.map((k) => c[k]), next: ref(c.next), prev: ref(c.prev) })),
  };
}

function saveOverlayData(e: EngineState, name: string, data: OverlayData): SavedOverlayData {
  const fresh = e.files.has(`${name}.OVL`) ? loadOverlayFiles(name, (file) => e.files.readFile(file)).data : null;
  const blockRuns = (blocks: ScriptBlock[], ref: ScriptBlock[] | undefined) =>
    blocks.map((b, i) => (ref?.[i] && ref[i]!.data.length === b.data.length ? diffRuns(ref[i]!.data, b.data) : diffRuns(new Uint8Array(b.data.length), b.data)));
  const msgRelHeaders: [number, MsgRelHeader][] = [];
  data.msgRelHeaders.forEach((h, i) => {
    const r = fresh?.msgRelHeaders[i];
    if (!r || (Object.keys(h) as (keyof MsgRelHeader)[]).some((k) => h[k] !== r[k])) msgRelHeaders.push([i, { ...h }]);
  });
  const states: [number, number[]][] = [];
  data.states.forEach((s, i) => {
    const r = fresh?.states[i];
    if (!r || paramsArray(s).some((v, k) => v !== paramsArray(r)[k])) states.push([i, paramsArray(s)]);
  });
  const initRef = fresh && fresh.initData.length === data.initData.length ? fresh.initData : new Uint8Array(data.initData.length);
  return {
    bss: toBase64(data.bss),
    objVars: data.objVars.map(paramsArray),
    code: { procs: blockRuns(data.procs, fresh?.procs), rels: blockRuns(data.rels, fresh?.rels), initData: diffRuns(initRef, data.initData), msgRelHeaders, states },
  };
}

/** Pixels d'un fond tel que la reprise le recharge : écran noir, puis l'image du fichier (un fichier palette seule n'en a pas). */
function pristineBackground(e: EngineState, name: string): Uint8Array {
  const pixels = new Uint8Array(SCREEN_PIXELS);
  const bytes = name ? e.readFile(name) : null;
  if (bytes && !isPaletteOnly(bytes)) pixels.set(parseBackground(bytes).pixels);
  return pixels;
}

/** Instantané de la partie (à prendre entre deux tours ; dans `onSaveRequest`, c'est l'état de ScummVM au même point). */
export function captureSave(e: EngineState): CroisiereSave {
  const d = e.display;
  const w = e.walk;
  const basic = {} as Record<BasicKey, number>;
  for (const k of BASIC_KEYS) basic[k] = e[k];
  for (const k of BASIC_FLAGS) basic[k] = e[k] ? 1 : 0;
  const extra = { saveOpcodeVar: e.vm.saveOpcodeVar, lastRet: e.vm.lastRet } as CroisiereSave["extra"];
  for (const k of EXTRA_KEYS) extra[k] = e[k];
  const display = {} as Record<DisplayKey, number>;
  for (const k of DISPLAY_KEYS) display[k] = d[k];

  let lastVar = GLOBAL_VAR_COUNT;
  while (lastVar > 0 && e.globalVars[lastVar - 1] === 0) lastVar--;

  const files: SavedFileEntry[] = [];
  e.filesDb.entries.forEach((f, slot) => {
    if (!f) return;
    files.push({
      slot, name: f.name, source: f.source ?? null, index: f.index, resType: f.resType, resourceType: f.resourceType, width: f.width,
      height: f.height, widthInColumn: f.widthInColumn, transparency: f.transparency,
    });
  });

  const ov = e.overlays;
  const entries: SavedOverlay[] = [];
  for (let i = 0; i < ov.numOfLoadedOverlay; i++) {
    const entry = ov.entries[i]!;
    entries.push({
      name: entry.name, loaded: entry.alreadyLoaded, executeScripts: entry.executeScripts, state: entry.state,
      data: entry.alreadyLoaded && entry.data ? saveOverlayData(e, entry.name, entry.data) : null,
    });
  }

  const tables = {} as Record<(typeof WALK_I16)[number], string>;
  for (const k of WALK_I16) tables[k] = i16ToBase64(w[k]);
  const small = {} as Record<(typeof WALK_SMALL)[number], number[]>;
  for (const k of WALK_SMALL) small[k] = Array.from(w[k]);
  const scalars = {} as Record<WalkScalar, number>;
  for (const k of WALK_SCALARS) scalars[k] = w[k];

  return {
    version: SAVE_VERSION,
    background: backgroundLabel(e),
    basic,
    extra,
    sound: { ...e.sound.saveState() },
    display: {
      ...display,
      pcFadeFlag: d.pcFadeFlag,
      cvtPalette: Array.from(d.cvtPalette),
      palScreen: d.palScreen.map(toBase64),
      workpal: toBase64(d.workpal),
      hardwarePalette: toBase64(d.hardwarePalette),
      backgrounds: Array.from({ length: NBSCREENS }, (_, i) => {
        const screen = d.backgroundScreens[i];
        const name = d.backgroundNames[i]!;
        return { present: !!screen, name, changed: d.backgroundChanged[i]!, patch: screen ? diffRuns(pristineBackground(e, name), screen) : [] };
      }),
    },
    globalVars: toBase64(i16Bytes(e.globalVars.subarray(0, lastVar))),
    files,
    overlays: { numOfLoaded: ov.numOfLoadedOverlay, stateID: ov.stateID, entries },
    procs: e.procs.map(saveScript),
    rels: e.rels.map(saveScript),
    cells: saveCells(e),
    incrusts: e.incrusts.map((inc) => ({ ...inc, saved: inc.saved ? toBase64(inc.saved) : null })),
    actors: e.actors.map((a) => ACTOR_KEYS.map((k) => a[k])),
    walk: {
      ctpName: e.currentCtpName,
      polyStructs: w.polyStructs === null ? null : w.polyStructs === w.polyStructExp ? "exp" : "norm",
      scalars,
      tables,
      small,
      persos: w.persoTable.map((p) => (p ? i16ToBase64(p) : null)),
    },
  };
}

// --- reprise ---

function loadScript(s: SavedScript): ScriptInstance {
  return {
    overlayNumber: s.overlayNumber, scriptNumber: s.scriptNumber, scriptOffset: s.scriptOffset, data: s.data === null ? null : fromBase64(s.data),
    freeze: s.freeze, sysKey: s.sysKey, type: s.type, var18: s.var18, var16: s.var16, var1A: s.var1A, ccr: s.ccr,
  };
}

function restoreOverlays(e: EngineState, saved: CroisiereSave["overlays"]): void {
  const ov = e.overlays;
  if (saved.numOfLoaded > OVERLAY_TABLE_SIZE || saved.entries.length !== saved.numOfLoaded) throw new Error("Sauvegarde : table des overlays invalide");
  ov.reset();
  saved.entries.forEach((s, i) => {
    const entry = ov.entries[i]!;
    entry.name = s.name;
    entry.executeScripts = s.executeScripts;
    entry.state = s.state;
  });
  ov.numOfLoadedOverlay = saved.numOfLoaded;
  ov.stateID = saved.stateID;
  // loadSavegameData : rechargement dans l'ordre des index ; `load` retrouve l'index par le nom et ne réserve pas de nouvelle tranche.
  for (let i = 1; i < saved.numOfLoaded; i++) {
    const s = saved.entries[i]!;
    if (!s.loaded) continue;
    const idx = ov.load(s.name);
    if (idx !== i) throw new Error(`Sauvegarde : l'overlay ${s.name} revient à l'index ${idx} au lieu de ${i}`);
    const data = ov.entries[i]!.data!;
    if (!s.data) continue;
    const bss = fromBase64(s.data.bss);
    if (bss.length !== data.bss.length) data.bss = new Uint8Array(bss.length);
    data.bss.set(bss);
    data.objVars = s.data.objVars.map((v) => {
      const p: ObjectParams = { X: 0, Y: 0, Z: 0, frame: 0, scale: 0, state: 0 };
      setParams(p, v);
      return p;
    });
    s.data.code.procs.forEach((runs, k) => data.procs[k] && applyRuns(data.procs[k]!.data, runs));
    s.data.code.rels.forEach((runs, k) => data.rels[k] && applyRuns(data.rels[k]!.data, runs));
    applyRuns(data.initData, s.data.code.initData);
    for (const [k, h] of s.data.code.msgRelHeaders) data.msgRelHeaders[k] = { ...h };
    for (const [k, v] of s.data.code.states) if (data.states[k]) setParams(data.states[k]!, v);
  }
}

/** Base de fichiers : rechargée par plages (même fichier, entrées consécutives), puis les champs logiques sauvegardés. */
function restoreFiles(e: EngineState, files: SavedFileEntry[]): void {
  const db = e.filesDb;
  for (let i = 0; i < files.length; ) {
    const f = files[i]!;
    let j = i + 1;
    if (f.source) {
      db.loadFullBundle(f.source, f.slot);
    } else if (f.name) {
      while (j < files.length && !files[j]!.source && files[j]!.name === f.name && files[j]!.slot === f.slot + (j - i) && files[j]!.index === f.index + (j - i)) j++;
      db.loadFileRange(f.name, f.index, f.slot, j - i);
    }
    i = j;
  }
  for (const f of files) {
    const entry = db.get(f.slot);
    if (!entry) throw new Error(`Sauvegarde : l'entrée de fichier ${f.slot} (${f.source ?? f.name}) n'a pas pu être rechargée`);
    entry.resType = f.resType;
    entry.resourceType = f.resourceType;
    entry.width = f.width;
    entry.height = f.height;
    entry.widthInColumn = f.widthInColumn;
    entry.transparency = f.transparency;
  }
}

function restoreCells(e: EngineState, saved: CroisiereSave["cells"]): void {
  const head = e.cells.head;
  const nodes: Cell[] = saved.nodes.map((n) => {
    const c = { next: null, prev: null, gfx: null } as unknown as Cell;
    CELL_KEYS.forEach((k: CellKey, i) => {
      c[k] = n.fields[i] ?? 0;
    });
    return c;
  });
  const at = (id: number): Cell | null => (id < 0 ? null : id === 0 ? head : (nodes[id - 1] ?? null));
  head.next = at(saved.head.next);
  head.prev = at(saved.head.prev);
  saved.nodes.forEach((n, i) => {
    nodes[i]!.next = at(n.next);
    nodes[i]!.prev = at(n.prev);
  });
  // Messages rendus de nouveau avec la police courante (createTextObject).
  for (const c of e.cells) {
    if (c.type !== ObjType.MESSAGE) continue;
    const text = e.getText(c.idx, c.overlay);
    if (text !== null) c.gfx = renderText(e, c.spriteIdx, text);
  }
}

function restoreWalk(e: EngineState, saved: CroisiereSave["walk"]): void {
  const w = e.walk;
  base64ToI16(saved.tables.walkboxColor, w.walkboxColor);
  base64ToI16(saved.tables.walkboxState, w.walkboxState);
  saved.persos.forEach((p, i) => {
    if (i >= NUM_PERSONS) return;
    if (p === null) w.persoTable[i] = null;
    else {
      const perso = new Int16Array(fromBase64(p).length >> 1);
      base64ToI16(p, perso);
      w.persoTable[i] = perso;
    }
  });
  if (saved.ctpName) {
    if (loadCt(e, saved.ctpName, true) !== 1) throw new Error(`Sauvegarde : zones de marche ${saved.ctpName} introuvables`);
  }
  for (const k of WALK_I16) base64ToI16(saved.tables[k], w[k]);
  for (const k of WALK_SMALL) w[k].set(saved.small[k].slice(0, w[k].length));
  for (const k of WALK_SCALARS) w[k] = saved.scalars[k];
  w.polyStructs = saved.polyStructs === null ? null : saved.polyStructs === "exp" ? w.polyStructExp : w.polyStructNorm;
}

/**
 * Reprend une sauvegarde dans `e` (partie en cours ou moteur neuf), comme `loadSavegameData`. À appeler entre deux tours ; appelé
 * dans `onLoadRequest`, la fin du tour en cours tourne sur l'état repris, comme dans ScummVM.
 */
export function restoreSave(e: EngineState, save: CroisiereSave): void {
  const d = e.display;
  e.initVars();
  e.sound.stopMusic();

  for (const k of BASIC_KEYS) e[k] = save.basic[k];
  for (const k of BASIC_FLAGS) e[k] = save.basic[k] !== 0;
  for (const k of EXTRA_KEYS) e[k] = save.extra[k];
  e.vm.saveOpcodeVar = save.extra.saveOpcodeVar;
  e.vm.lastRet = save.extra.lastRet;
  e.sound.restoreState(save.sound);

  e.globalVars.fill(0);
  base64ToI16(save.globalVars, e.globalVars);

  restoreOverlays(e, save.overlays);
  restoreFiles(e, save.files);

  e.procs = save.procs.map(loadScript);
  e.rels = save.rels.map(loadScript);
  restoreCells(e, save.cells);
  e.incrusts.length = 0;
  for (const inc of save.incrusts) e.incrusts.push({ ...inc, saved: inc.saved === null ? null : fromBase64(inc.saved) });
  e.actors.length = 0;
  for (const values of save.actors) {
    const a = {} as Actor;
    ACTOR_KEYS.forEach((k, i) => {
      a[k] = values[i] ?? 0;
    });
    e.actors.push(a);
  }
  restoreWalk(e, save.walk);

  // Fonds : écran noir, fichier, puis les écarts sauvegardés ; palettes de la partie en dernier.
  save.display.backgrounds.forEach((b, i) => {
    if (i >= NBSCREENS) return;
    if (!b.present) {
      d.backgroundScreens[i] = null;
    } else {
      d.backgroundScreens[i] = new Uint8Array(SCREEN_PIXELS);
      if (b.name) d.loadBackground(b.name, i, (n) => e.readFile(n), () => {});
      applyRuns(d.backgroundScreens[i]!, b.patch);
    }
    d.backgroundNames[i] = b.name;
    d.backgroundChanged[i] = b.changed;
  });
  for (const k of DISPLAY_KEYS) d[k] = save.display[k];
  d.pcFadeFlag = save.display.pcFadeFlag;
  d.cvtPalette.set(save.display.cvtPalette.slice(0, d.cvtPalette.length));
  save.display.palScreen.forEach((p, i) => d.palScreen[i]?.set(fromBase64(p)));
  d.workpal.set(fromBase64(save.display.workpal));
  d.hardwarePalette.set(fromBase64(save.display.hardwarePalette));

  // `changeCursor(CURSOR_NORMAL)` puis l'image : composée sans les effets de `mainDraw` / `flipScreen` (animations, fondu, palette).
  e.cursor = Cursor.NORMAL;
  drawScreen(e);
  [d.page00, d.page10] = [d.page10, d.page00];
  d.showPage();
  e.renderer.present?.(e);
}

/** Valide une valeur lue d'un emplacement (`SaveSlots.parse`) : la sauvegarde, ou `null` si ce n'est pas une sauvegarde de cette version. */
export function parseSave(value: unknown): CroisiereSave | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CroisiereSave>;
  if (v.version !== SAVE_VERSION || typeof v.background !== "string" || !v.basic || !v.extra || !v.sound || !v.display || !v.overlays) return null;
  if (typeof v.globalVars !== "string" || !Array.isArray(v.files) || !Array.isArray(v.procs) || !Array.isArray(v.rels) || !v.cells || !Array.isArray(v.incrusts) || !Array.isArray(v.actors) || !v.walk) return null;
  if (v.files.some((f) => !f || f.slot < 0 || f.slot >= NUM_FILE_ENTRIES)) return null;
  return v as CroisiereSave;
}
