/**
 * Sauvegarde et reprise d'une partie des *Voyageurs du temps* (vague S, D10) : le contenu de `makeSaveFW`, rangé dans un objet JSON
 * versionné pour les emplacements du site (`SaveSlots`, préfixe `voyageurs:`, 10 emplacements).
 *
 * Référence : ScummVM engines/cine/saveload.cpp (`CineEngine::makeSaveFW`, `loadPlainSaveFW`, `saveObjectTable`, `saveAnimDataTable`,
 * `loadResourcesFromSave`, `saveGlobalScripts`, `saveObjectScripts`, `saveOverlayList`, `saveBgIncrustList`), script_fw.cpp
 * (`FWScript::save`), metaengine.cpp (`canSaveGameStateCurrently`), GPL v3 ou ultérieure, lus puis réécrits.
 *
 * **Contenu** (celui de `makeSaveFW`) : disque, noms du bundle, du module de musique, du PRC, du REL, du MSG, du fond et de la page de
 * collision ; état de la musique ; table des 256 objets ; 255 globales (+ la 256e, variable de protection) ; données de zones ; variables
 * de la ligne de commande, tampon de commande, `cmdY`, `bgVar0`, `allowPlayerInput`, `playerCommand`, `commandVar1`, `commandVar2`,
 * `isDrawCommandEnabled`, `messageBg` ; table des sprites **par nom** (ressource, bundle, frame) ; scripts globaux et d'objets (index,
 * position, labels, locales, registre de comparaison) ; liste des calques ; liste des incrustations dans le fond.
 *
 * **Reprise** (`restoreSave`) : comme `loadPlainSaveFW`, les fichiers sont rechargés d'abord (bundle, PRC, REL, fond avec sa musique
 * d'ambiance, collision), puis l'état est restauré, les sprites rechargés dans **les mêmes emplacements**, les incrustations redessinées
 * dans l'ordre, le MSG rechargé, la musique relancée.
 *
 * **Écarts volontaires** (ce que ScummVM ne garde pas et dont une reprise exacte a besoin, ou ce que le port ne tient pas) :
 * - hasard (`ScummvmRandom.state`), nombre de ticks (numérotation du banc), position de la souris et ancienneté du dernier fondu au noir
 *   (rustine anti double fondu) sont sauvés ; les boutons de la souris, la file d'entrées, la marche au clavier et les menus ne le sont pas
 *   (la partie reprend au début d'un tick, sans menu) ;
 * - `disableSystemMenu` est sauvé (ScummVM le lit et l'ignore) : une partie ne se sauvegarde qu'avec lui à 0, donc sans effet ;
 * - les scripts sont rattachés à leur entrée de PRC / REL par **position dans la table**, ce qui garde aussi les instances arrêtées
 *   (`index` < 0, retirées au prochain passage) que la trace du banc compte encore ; le compteur d'exécutions de chaque entrée REL
 *   (`runCount`, locale 0 des instances) est sauvé, ScummVM le remet à 0 ;
 * - le MSG est rechargé par son nom comme dans ScummVM, la table des objets est celle de la sauvegarde (pas de rechargement de l'OBJ) ;
 * - **palettes** (`_activePal`, `_backupPal`, 9 bits) : lues et rendues par le port de rendu (`getPalettes`, `setPalettes`), restaurées
 *   après le rechargement du fond et des incrustations ; la palette active est affichée au premier dessin (comme `_changePal`) ;
 * - pas de miniature ni de temps de jeu (en-tête étendu de ScummVM) : la description est le fond et la date (`describeSave`) ;
 * - le chargement lève une erreur si un fichier de la sauvegarde manque (ScummVM lit alors l'index -1).
 *
 * **Refus** (`saveRefusal`) : entrées bloquées (`allowPlayerInput` à 0), menu système désactivé, menu ou message ouvert, scripts en cours
 * d'exécution dans le tick. La sauvegarde ne se fait donc qu'au début d'un tick, pendant l'attente d'une entrée.
 *
 * Module pur : il ne connaît pas le stockage ; `voyageursSaveSlots` y branche `SaveSlots`.
 */

import type { ScummvmRandom } from "../../../engine/rng";
import { SaveSlots } from "../../../engine/save-slots";
import type { HostStorage } from "../../../engine/storage";
import { loadCt, loadMsg, loadPart, loadPrc, loadRel, loadResource, type PartContext, type PartFiles } from "./part";
import { RawObjectScript, ScriptInstance } from "./script/vm";
import type { PaletteSnapshot, VoyageursAudio, VoyageursRenderer } from "./services";
import {
  type BgIncrust,
  type EngineState,
  type FileNames,
  type GameObject,
  NUM_MAX_ANIMDATA,
  NUM_MAX_OBJECT,
  NUM_MAX_VAR,
  NUM_MAX_ZONE,
  type Overlay,
  OverlayType,
  type PendingLoads,
} from "./state";

export const SAVE_VERSION = 1;
/** Emplacements du site : 10, clés `slot01`… sous le préfixe `voyageurs:` (posé par l'hôte). */
export const SAVE_SLOT_COUNT = 10;

export interface SavedScript {
  /** Index annoncé (`index` < 0 : instance arrêtée, retirée au prochain passage). */
  index: number;
  /** Position de l'entrée dans `scriptTable` (globaux) ou `relTable` (objets). */
  raw: number;
  pos: number;
  line: number;
  compare: number;
  labels: number[];
  locals: number[];
}

export interface SavedAnim {
  slot: number;
  resource: string;
  /** Bundle courant au chargement. */
  part: string;
  frameIdx: number;
}

/** Objet : [x, y, masque, frame, costume, nom, partie]. */
export type SavedObject = [number, number, number, number, number, string, number];

export interface VoyageursSave {
  version: typeof SAVE_VERSION;
  names: FileNames;
  pending: PendingLoads;
  currentDisk: number;
  /** Musique : module courant (`names.dat`) et lecture en cours ; le fond donne la musique d'ambiance (`atoi(bg + 1)`). */
  music: { dat: string; playing: number };
  objects: SavedObject[];
  /** 256 valeurs : globales 0 à 254 et la variable de protection (255). */
  globals: number[];
  zoneData: number[];
  command: {
    var1: number;
    var2: number;
    var3: number[];
    buffer: string;
    line: string;
    player: number;
    cmdY: number;
    messageBg: number;
    isDrawEnabled: number;
  };
  ui: {
    bgVar0: number;
    allowPlayerInput: number;
    disableSystemMenu: number;
    waitForPlayerClick: number;
    checkForPendingDataLoadSwitch: number;
    fadeInRequested: number;
    fadeOutCompleted: number;
  };
  anims: SavedAnim[];
  globalScripts: SavedScript[];
  objectScripts: SavedScript[];
  /** `runCount` de chaque entrée REL. */
  relRunCounts: number[];
  overlays: Overlay[];
  incrusts: BgIncrust[];
  /** Palettes active et de secours (`transformPalette`, `rotatePalette` comprises). */
  palettes: PaletteSnapshot;
  engine: {
    ticks: number;
    /** `ScummvmRandom.state`. */
    rng: number;
    mouse: { x: number; y: number };
    /** Millisecondes depuis le dernier fondu au noir (`null` : aucun). */
    fadeToBlackAgoMs: number | null;
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Refus

export type SaveRefusal = "input" | "systemMenu" | "menu" | "message" | "busy" | "quit";

/** Ce que `saveRefusal` lit du moteur. */
export interface SaveView {
  readonly state: EngineState;
  readonly menus: readonly unknown[];
  readonly inMenu: boolean;
  /** Attente modale en cours (message, menu). */
  readonly modal: number | null;
  readonly banner: string | null;
  readonly quitRequested: boolean;
  readonly restartRequested: boolean;
  /** Le tick en cours a passé l'attente des entrées (scripts, dessin, attente de clic). */
  readonly scriptsStarted: boolean;
  /**
   * Le fond courant est dans le bundle courant. Faux entre le `loadPart` d'une nouvelle partie et le premier `loadBg` de celle-ci (fin de
   * PART01 : décor L5 avec PART02 ouvert) : la reprise rechargerait le fond depuis le mauvais bundle (`loadPlainSaveFW` échouerait aussi).
   */
  readonly backgroundInPart: boolean;
}

/** Pourquoi la partie ne peut pas être sauvegardée maintenant, ou `null`. */
export function saveRefusal(view: SaveView): SaveRefusal | null {
  const { state } = view;
  if (view.quitRequested || view.restartRequested) return "quit";
  if (!state.allowPlayerInput) return "input";
  if (state.disableSystemMenu) return "systemMenu";
  if (view.inMenu || view.menus.length > 0) return "menu";
  if (view.modal !== null || view.banner !== null || state.waitForPlayerClick) return "message";
  if (state.overlays.some((o) => o.type === OverlayType.Message || o.type === OverlayType.Failure)) return "message";
  if (view.scriptsStarted || !view.backgroundInPart) return "busy";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sauvegarde

/** Le moteur vu par `makeSave`. */
export interface SaveSource {
  readonly state: EngineState;
  readonly ticks: number;
  readonly rng: Pick<ScummvmRandom, "state">;
  readonly mouse: { readonly x: number; readonly y: number };
  readonly fadeToBlackAgoMs: number | null;
  readonly palettes: PaletteSnapshot;
}

function saveScripts(list: readonly ScriptInstance[], table: readonly object[]): SavedScript[] {
  return list.map((s) => {
    const raw = table.indexOf(s.raw);
    if (raw < 0) throw new Error(`script ${s.index} absent de la table courante : sauvegarde impossible`);
    return { index: s.index, raw, pos: s.pos, line: s.line, compare: s.compare, labels: [...s.labels], locals: [...s.locals] };
  });
}

/** `makeSaveFW` : copie profonde de l'état, sans rien modifier. */
export function makeSave(source: SaveSource): VoyageursSave {
  const { state } = source;
  const anims: SavedAnim[] = [];
  state.anims.forEach((slot, i) => {
    if (slot) anims.push({ slot: i, resource: slot.resource, part: slot.part, frameIdx: slot.frameIdx });
  });
  return {
    version: SAVE_VERSION,
    names: { ...state.names },
    pending: { ...state.pending },
    currentDisk: state.currentDisk,
    music: { dat: state.names.dat, playing: state.musicIsPlaying },
    objects: state.objects.map((o) => [o.x, o.y, o.mask, o.frame, o.costume, o.name, o.part]),
    globals: [...state.globals],
    zoneData: [...state.zoneData],
    command: {
      var1: state.commandVar1,
      var2: state.commandVar2,
      var3: [...state.commandVar3],
      buffer: state.commandBuffer,
      line: state.commandLine,
      player: state.playerCommand,
      cmdY: state.cmdY,
      messageBg: state.messageBg,
      isDrawEnabled: state.isDrawCommandEnabled,
    },
    ui: {
      bgVar0: state.bgVar0,
      allowPlayerInput: state.allowPlayerInput,
      disableSystemMenu: state.disableSystemMenu,
      waitForPlayerClick: state.waitForPlayerClick,
      checkForPendingDataLoadSwitch: state.checkForPendingDataLoadSwitch,
      fadeInRequested: state.fadeInRequested,
      fadeOutCompleted: state.fadeOutCompleted,
    },
    anims,
    globalScripts: saveScripts(state.globalScripts, state.scriptTable),
    objectScripts: saveScripts(state.objectScripts, state.relTable),
    relRunCounts: state.relTable.map((e) => e.runCount),
    overlays: state.overlays.map((o) => ({ ...o })),
    incrusts: state.incrusts.map((i) => ({ ...i })),
    palettes: { active: [...source.palettes.active], backup: [...source.palettes.backup] },
    engine: {
      ticks: source.ticks,
      rng: source.rng.state,
      mouse: { x: source.mouse.x, y: source.mouse.y },
      fadeToBlackAgoMs: source.fadeToBlackAgoMs,
    },
  };
}

/** Description d'un emplacement (la date est ajoutée par l'interface) : décor et bundle. */
export function describeSave(save: Pick<VoyageursSave, "names">): { bg: string; part: string } {
  return { bg: save.names.bg, part: save.names.part };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reprise

/** Ce que `restoreSave` attend du moteur : un état neuf et les services. */
export interface RestoreEnv {
  /** `state` est l'état neuf à remplir (le même que `ctx.state`). */
  readonly state: EngineState;
  readonly ctx: PartContext;
  readonly parts: PartFiles;
  readonly audio: VoyageursAudio;
  readonly renderer: VoyageursRenderer;
  /** `o1_loadBg` du moteur (musique d'ambiance, fond, incrustations vidées). */
  loadBg(name: string): void;
}

function scriptsFromSave(saved: readonly SavedScript[], table: readonly { size: number }[], make: (raw: never, index: number) => ScriptInstance): ScriptInstance[] {
  return saved.map((s) => {
    const raw = table[s.raw];
    if (!raw) throw new Error(`sauvegarde : entrée de script ${s.raw} absente`);
    const script = make(raw as never, s.index);
    script.pos = s.pos;
    script.line = s.line;
    script.compare = s.compare;
    script.labels.set(s.labels);
    script.locals.set(s.locals);
    return script;
  });
}

/** `loadPlainSaveFW` : recharge les fichiers, puis restaure l'état dans `env.state` (neuf). Lève une erreur si un fichier manque. */
export function restoreSave(save: VoyageursSave, env: RestoreEnv): void {
  const { state, ctx, parts } = env;
  const { names } = save;
  env.audio.stopMusic();
  if (names.part) loadPart(ctx, parts, names.part);
  if (names.prc) {
    if (!loadPrc(ctx, parts, names.prc)) throw new Error(`sauvegarde : PRC ${names.prc} introuvable`);
    state.names.prc = names.prc;
  }
  if (names.rel) {
    loadRel(ctx, parts, names.rel);
    if (state.relTable.length === 0 && save.objectScripts.length > 0) throw new Error(`sauvegarde : REL ${names.rel} introuvable`);
    state.names.rel = names.rel;
  }
  if (names.bg) {
    env.loadBg(names.bg);
    if (state.names.bg !== names.bg) throw new Error(`sauvegarde : fond ${names.bg} introuvable`);
  }
  if (names.ct) {
    loadCt(ctx, parts, names.ct);
    if (state.names.ct !== names.ct) throw new Error(`sauvegarde : collision ${names.ct} introuvable`);
  }
  Object.assign(state.names, names);

  state.currentDisk = save.currentDisk;
  state.musicIsPlaying = save.music.playing;
  save.objects.forEach(([x, y, mask, frame, costume, name, part], i) => {
    state.objects[i] = { x, y, mask, frame, costume, name, part } satisfies GameObject;
  });
  state.globals.set(save.globals);
  state.zoneData.set(save.zoneData);
  const c = save.command;
  state.commandVar1 = c.var1;
  state.commandVar2 = c.var2;
  state.commandVar3 = [...c.var3];
  state.commandBuffer = c.buffer;
  state.commandLine = c.line;
  state.playerCommand = c.player;
  state.cmdY = c.cmdY;
  state.messageBg = c.messageBg;
  state.isDrawCommandEnabled = c.isDrawEnabled;
  Object.assign(state, save.ui);
  Object.assign(state.pending, save.pending);

  // `loadResourcesFromSave` : chaque sprite dans son emplacement, depuis le bundle qui le contenait.
  for (const anim of save.anims) {
    if (anim.part) parts.open(anim.part);
    state.names.part = anim.part;
    if (loadResource(ctx, parts, anim.resource, anim.slot, anim.frameIdx) < 0 || !state.anims[anim.slot]) {
      throw new Error(`sauvegarde : ressource ${anim.resource} introuvable`);
    }
  }
  if (names.part) parts.open(names.part);
  state.names.part = names.part;

  state.globalScripts = scriptsFromSave(save.globalScripts, state.scriptTable, (raw, index) => new ScriptInstance(raw, index));
  state.objectScripts = scriptsFromSave(save.objectScripts, state.relTable, (raw, index) => new ScriptInstance(raw, index));
  // Les constructeurs d'instances d'objet ont incrémenté `runCount` : on le remet à la valeur sauvée.
  state.relTable.forEach((entry: RawObjectScript, i) => {
    entry.runCount = save.relRunCounts[i] ?? 0;
  });
  state.overlays = save.overlays.map((o) => ({ ...o }));
  // `loadBgIncrustFromSave` : liste, puis redessin dans l'ordre (le fond vient d'être rechargé sans incrustation).
  state.incrusts = save.incrusts.map((i) => ({ ...i }));
  for (const incrust of state.incrusts) {
    const obj = state.objects[incrust.objIdx & 0xff]!;
    env.renderer.incrust(incrust, obj, obj.frame >= 0 ? (state.anims[obj.frame] ?? null) : null);
  }
  // Palettes de la sauvegarde, par-dessus celle du fond rechargé.
  env.renderer.setPalettes({ active: [...save.palettes.active], backup: [...save.palettes.backup] });
  if (names.msg) {
    loadMsg(ctx, parts, names.msg);
    state.names.msg = names.msg;
  }
  if (names.dat) {
    env.audio.loadMusic(names.dat);
    if (save.music.playing) env.audio.playMusic();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Lecture d'une valeur inconnue (`SaveSlots.parse`)

class Invalid extends Error {}

function fail(what: string): never {
  throw new Invalid(what);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function rec(v: unknown, what: string): Record<string, unknown> {
  return isRecord(v) ? v : fail(what);
}

function int(v: unknown, what: string): number {
  return typeof v === "number" && Number.isInteger(v) ? v : fail(what);
}

function str(v: unknown, what: string): string {
  return typeof v === "string" ? v : fail(what);
}

function list(v: unknown, what: string, length?: number): unknown[] {
  return Array.isArray(v) && (length === undefined || v.length === length) ? v : fail(what);
}

function ints(v: unknown, what: string, length?: number): number[] {
  return list(v, what, length).map((n) => int(n, what));
}

function strings<T extends string>(v: unknown, keys: readonly T[], what: string): Record<T, string> {
  const r = rec(v, what);
  const out = {} as Record<T, string>;
  for (const k of keys) out[k] = str(r[k], `${what}.${k}`);
  return out;
}

function numbers<T extends string>(v: unknown, keys: readonly T[], what: string): Record<T, number> {
  const r = rec(v, what);
  const out = {} as Record<T, number>;
  for (const k of keys) out[k] = int(r[k], `${what}.${k}`);
  return out;
}

function parseScripts(v: unknown, what: string): SavedScript[] {
  return list(v, what).map((item) => {
    const r = rec(item, what);
    return {
      ...numbers(r, ["index", "raw", "pos", "line", "compare"], what),
      labels: ints(r.labels, `${what}.labels`, 50),
      locals: ints(r.locals, `${what}.locals`, 50),
    };
  });
}

/** 16 couleurs × 3 composantes de 0 à 7. */
function parsePalettes(v: unknown): PaletteSnapshot {
  const r = rec(v, "palettes");
  const one = (w: unknown, what: string) => ints(w, what, 48).map((c) => (c >= 0 && c <= 7 ? c : fail(what)));
  return { active: one(r.active, "palettes.active"), backup: one(r.backup, "palettes.backup") };
}

const NAME_KEYS = ["prc", "rel", "obj", "msg", "ct", "part", "dat", "bg"] as const;
const PENDING_KEYS = ["prc", "rel", "obj", "msg"] as const;
const UI_KEYS = ["bgVar0", "allowPlayerInput", "disableSystemMenu", "waitForPlayerClick", "checkForPendingDataLoadSwitch", "fadeInRequested", "fadeOutCompleted"] as const;

function parseSaveStrict(value: unknown): VoyageursSave {
  const r = rec(value, "sauvegarde");
  if (r.version !== SAVE_VERSION) fail("version");
  const command = rec(r.command, "command");
  const music = rec(r.music, "music");
  const engine = rec(r.engine, "engine");
  const mouse = rec(engine.mouse, "engine.mouse");
  const fade = engine.fadeToBlackAgoMs;
  return {
    version: SAVE_VERSION,
    names: strings(r.names, NAME_KEYS, "names"),
    pending: strings(r.pending, PENDING_KEYS, "pending"),
    currentDisk: int(r.currentDisk, "currentDisk"),
    music: { dat: str(music.dat, "music.dat"), playing: int(music.playing, "music.playing") },
    objects: list(r.objects, "objects", NUM_MAX_OBJECT + 1).map((o): SavedObject => {
      const a = list(o, "objet", 7);
      return [int(a[0], "x"), int(a[1], "y"), int(a[2], "mask"), int(a[3], "frame"), int(a[4], "costume"), str(a[5], "name"), int(a[6], "part")];
    }),
    globals: ints(r.globals, "globals", NUM_MAX_VAR + 1),
    zoneData: ints(r.zoneData, "zoneData", NUM_MAX_ZONE),
    command: {
      ...numbers(command, ["var1", "var2", "player", "cmdY", "messageBg", "isDrawEnabled"], "command"),
      var3: ints(command.var3, "command.var3", 4),
      buffer: str(command.buffer, "command.buffer"),
      line: str(command.line, "command.line"),
    },
    ui: numbers(r.ui, UI_KEYS, "ui"),
    anims: list(r.anims, "anims").map((a) => {
      const s = rec(a, "anim");
      const slot = int(s.slot, "anim.slot");
      if (slot < 0 || slot >= NUM_MAX_ANIMDATA) fail("anim.slot");
      return { slot, resource: str(s.resource, "anim.resource"), part: str(s.part, "anim.part"), frameIdx: int(s.frameIdx, "anim.frameIdx") };
    }),
    globalScripts: parseScripts(r.globalScripts, "globalScripts"),
    objectScripts: parseScripts(r.objectScripts, "objectScripts"),
    relRunCounts: ints(r.relRunCounts, "relRunCounts"),
    overlays: list(r.overlays, "overlays").map((o) => {
      const s = rec(o, "overlay");
      const base = numbers(s, ["objIdx", "type", "x", "y", "width", "color"], "overlay");
      return s.failure === undefined ? base : { ...base, failure: int(s.failure, "overlay.failure") };
    }),
    incrusts: list(r.incrusts, "incrusts").map((i) => {
      const s = numbers(rec(i, "incrust"), ["objIdx", "param", "x", "y", "frame", "part", "bgIdx"], "incrust");
      if (s.objIdx < 0 || s.objIdx > NUM_MAX_OBJECT) fail("incrust.objIdx");
      return s;
    }),
    palettes: parsePalettes(r.palettes),
    engine: {
      ticks: int(engine.ticks, "engine.ticks"),
      rng: int(engine.rng, "engine.rng"),
      mouse: { x: int(mouse.x, "mouse.x"), y: int(mouse.y, "mouse.y") },
      fadeToBlackAgoMs: fade === null ? null : int(fade, "engine.fadeToBlackAgoMs"),
    },
  };
}

/** Valide une valeur lue du stockage : la sauvegarde, ou `null` si elle est illisible ou d'une autre version. */
export function parseSave(value: unknown): VoyageursSave | null {
  try {
    return parseSaveStrict(value);
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}

/** Emplacements du site, à passer `prefixedStorage(store, "voyageurs:")`. */
export function voyageursSaveSlots(store: HostStorage): SaveSlots<VoyageursSave> {
  return new SaveSlots(store, { count: SAVE_SLOT_COUNT, parse: parseSave, name: "Les Voyageurs du temps" });
}
