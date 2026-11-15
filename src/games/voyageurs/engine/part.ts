/**
 * Chargement des ressources par le moteur : bundle courant, PRC, REL, OBJ, MSG, fond, page de collision, sprites et sons dans les
 * emplacements de `_animDataTable`, et chargements différés de fin de tick.
 *
 * Référence : ScummVM engines/cine/part.cpp (`loadPart`, `findFileInBundle`, `readBundleFile`, `readFile`), prc.cpp (`loadPrc`),
 * rel.cpp (`loadRel`), object.cpp (`loadObject`), msg.cpp (`loadMsg`), bg.cpp (`loadBg`, `loadCtFW`), anim.cpp (`loadResource`,
 * `loadAni`, `loadMsk`, `loadSpl`, `AnimData::load`, `fixAnimDataTableEndFrame`), various.cpp (`checkForPendingDataLoad`) (GPL v3 ou
 * ultérieure). Lecteurs de formats : `../data/*`.
 *
 * Règles reprises : un PRC vide les scripts globaux, un REL les scripts objets, un OBJ les calques ; `loadObject` garde les objets de
 * costume -2 (inventaire) et force le costume des dix premiers objets de `INTRO.OBJ` à 0 ; un sprite va dans le **premier emplacement
 * libre**, puis ses frames suivantes dans les emplacements **consécutifs** (occupés ou non), comme `loadAni`.
 *
 * Écarts volontaires : `loadPal` (fichiers `.PAL`, jamais relus) n'est pas reproduit (D2) ; un fichier absent du bundle est signalé au
 * journal et ignoré là où ScummVM lirait l'index -1 (PRC, REL) ; `.SET`, `.SEQ`, `.H32`, `.HP`, `.ADL`, `.AMI` (Opération Stealth ou autres
 * plates-formes) sont refusés ; un nom contenant `ECHEC` quitte le jeu (protection) via `quit`.
 */

import { readAni, readMsk } from "../data/anim";
import { BOOT_PRC_NAME, decodeBootPrc } from "../data/boot";
import { Bundle } from "../data/bundle";
import { readMsg } from "../data/msg";
import { readNeoCollision } from "../data/neo";
import { INTRO_OBJ_NAME, readObj } from "../data/obj";
import { COPY_PROT_FAIL_PRC_NAME, readPrc } from "../data/prc";
import { readRel } from "../data/rel";
import type { ArgTable } from "./script/vm";
import { RawObjectScript, RawScript, ScriptInstance } from "./script/vm";
import { type AnimSlot, type EngineState, emptyAnimSpace, NUM_MAX_ANIMDATA, NUM_MAX_OBJECT } from "./state";

/** Fichiers du jeu hors bundle : `PART01` … `PART04B`, `AUTO00.PRC`. */
export interface VoyageursFiles {
  read(name: string): Uint8Array | null;
}

export interface PartContext {
  readonly state: EngineState;
  readonly files: VoyageursFiles;
  readonly table: ArgTable;
  /** Nouveau fond (rendu). */
  background(name: string, data: Uint8Array): void;
  /** Ressource `ECHEC*` (protection) ou PRC `L201.ANI` : fin de partie. */
  quit(): void;
  warn(message: string): void;
}

/** Bundle ouvert (`_partBuffer` + `_partFileHandle`). */
export class PartFiles {
  private bundle: Bundle | null = null;
  private readonly cache = new Map<string, Bundle>();

  constructor(private readonly files: VoyageursFiles) {}

  get current(): Bundle | null {
    return this.bundle;
  }

  /** `loadPart` : ouvre le bundle (une erreur s'il manque, comme `error` de ScummVM). */
  open(name: string): void {
    const key = name.toUpperCase();
    let bundle = this.cache.get(key);
    if (!bundle) {
      const data = this.files.read(name) ?? this.files.read(key);
      if (!data) throw new Error(`loadPart : fichier ${name} introuvable`);
      bundle = new Bundle(data);
      this.cache.set(key, bundle);
    }
    this.bundle = bundle;
  }

  /** `findFileInBundle` (bundle courant seulement). */
  find(name: string): number {
    return this.bundle ? this.bundle.indexOf(name) : -1;
  }

  read(index: number): Uint8Array {
    if (!this.bundle) throw new Error("aucun bundle ouvert");
    return this.bundle.read(index);
  }
}

export function loadPart(ctx: PartContext, parts: PartFiles, name: string): void {
  parts.open(name);
  ctx.state.names.part = name;
}

/** `loadPrc` : vide les scripts globaux et la table ; `AUTO00.PRC` est lu hors bundle et déchiffré. Faux si rien n'est chargé. */
export function loadPrc(ctx: PartContext, parts: PartFiles, name: string): boolean {
  const { state } = ctx;
  state.globalScripts = [];
  state.scriptTable = [];
  if (name.toUpperCase() === COPY_PROT_FAIL_PRC_NAME) {
    ctx.quit();
    return false;
  }
  let data: Uint8Array | null;
  if (name.toUpperCase() === BOOT_PRC_NAME) {
    const raw = ctx.files.read(BOOT_PRC_NAME);
    data = raw ? decodeBootPrc(raw) : null;
  } else {
    const index = parts.find(name);
    data = index >= 0 ? parts.read(index) : null;
  }
  if (!data) {
    ctx.warn(`loadPrc : ${name} introuvable`);
    return false;
  }
  state.scriptTable = readPrc(data).scripts.map((bytes) => new RawScript(bytes, ctx.table));
  return true;
}

/** `loadRel` : vide les scripts objets et la table des relations. */
export function loadRel(ctx: PartContext, parts: PartFiles, name: string): void {
  const { state } = ctx;
  state.objectScripts = [];
  state.relTable = [];
  const index = parts.find(name);
  if (index < 0) {
    ctx.warn(`loadRel : ${name} introuvable`);
    return;
  }
  state.relTable = readRel(parts.read(index)).map((e) => new RawObjectScript(e.script, ctx.table, e.p1, e.p2, e.p3));
}

/** `loadObject` : les objets portés (costume -2) sont gardés ; `INTRO.OBJ` remet à 0 le costume des objets 0 à 9. */
export function loadObj(ctx: PartContext, parts: PartFiles, name: string): void {
  const index = parts.find(name);
  if (index < 0) {
    ctx.warn(`loadObject : ${name} introuvable`);
    return;
  }
  const entries = readObj(parts.read(index));
  const objects = ctx.state.objects;
  entries.forEach((entry, i) => {
    const obj = objects[i]!;
    if (obj.costume !== -2) Object.assign(obj, entry);
  });
  if (name === INTRO_OBJ_NAME) for (let i = 0; i < 10 && i < NUM_MAX_OBJECT; i++) objects[i]!.costume = 0;
}

/** `loadMsg`. */
export function loadMsg(ctx: PartContext, parts: PartFiles, name: string): void {
  ctx.state.messages = [];
  const index = parts.find(name);
  if (index < 0) {
    ctx.warn(`loadMsg : ${name} introuvable`);
    return;
  }
  ctx.state.messages = readMsg(parts.read(index)).map((m) => m.raw);
}

/** `loadBg` : fond et palette du décor (sans effet si le fichier manque). */
export function loadBg(ctx: PartContext, parts: PartFiles, name: string): void {
  const index = parts.find(name);
  if (index < 0) {
    ctx.warn(`loadBg : ${name} introuvable`);
    return;
  }
  ctx.state.names.bg = name;
  ctx.background(name, parts.read(index));
}

/** `loadCtFW` : page de collision. */
export function loadCt(ctx: PartContext, parts: PartFiles, name: string): void {
  const index = parts.find(name);
  if (index < 0) {
    ctx.warn(`loadCtFW : ${name} introuvable`);
    return;
  }
  ctx.state.names.ct = name;
  ctx.state.collision = readNeoCollision(parts.read(index));
}

/** `fixAnimDataTableEndFrame` : les frames qui déborderaient de la table sont abandonnées. */
function fixEndFrame(entry: number, start: number, end: number): number {
  if (entry < 0) throw new Error("plus d'emplacement de sprite libre");
  if (end > start && entry + (end - start - 1) >= NUM_MAX_ANIMDATA) return NUM_MAX_ANIMDATA - entry + start;
  return end;
}

/**
 * `loadResource(nom, idx, frame)` : `idx` < 0 = premier emplacement libre ; `frame` < 0 = toutes les frames. Rend l'emplacement qui suit
 * la ressource chargée, ou -1.
 */
export function loadResource(ctx: PartContext, parts: PartFiles, name: string, idx = -1, frameIndex = -1): number {
  const upper = name.toUpperCase();
  const { state } = ctx;
  const kind = upper.includes(".SPL") ? "spl" : upper.includes(".MSK") ? "msk" : upper.includes(".ANI") || upper.includes(".ANM") ? "ani" : null;
  if (!kind) {
    if (upper.includes("ECHEC")) ctx.quit();
    else ctx.warn(`loadResource : type inconnu pour ${name}`);
    return -1;
  }
  const fileIdx = parts.find(name);
  if (fileIdx < 0) return -1;
  const data = parts.read(fileIdx);
  const part = state.names.part;
  if (kind === "spl") {
    const entry = idx < 0 ? emptyAnimSpace(state) : idx;
    fixEndFrame(entry, 0, 1);
    const width = data.length;
    state.anims[entry] = {
      kind: "raw", resource: name, part, fileIdx, frameIdx: 0, width, height: 1, var1: width >> 3, realWidth: width, bpp: 4,
      data, mask: null, transparentColor: 0,
    };
    return entry + 1;
  }
  const file = kind === "msk" ? readMsk(data, frameIndex) : readAni(name, data, frameIndex);
  const { frameWidth: w, frameHeight: h } = file.header;
  const start = file.firstFrame;
  let entry = idx < 0 ? emptyAnimSpace(state) : idx;
  const end = fixEndFrame(entry, start, start + file.frames.length);
  for (let i = start; i < end; i++, entry++) {
    const frame = file.frames[i - start]!;
    let slot: AnimSlot;
    if (kind === "msk") {
      const mask = frame as { data: Uint8Array };
      slot = {
        kind: "mask", resource: name, part, fileIdx, frameIdx: i, width: w * 2, height: h, var1: (w * 2) >> 3, realWidth: w * 8, bpp: 1,
        data: mask.data, mask: null, transparentColor: 0,
      };
    } else {
      // `AnimData::load(ANIM_MASKSPRITE)` : tampon de w × h × 2 octets, rempli par `gfxConvertSpriteToRaw` (lignes de (w / 8) × 16
      // pixels), puis masque généré sur tout le tampon.
      const sprite = frame as { pixels: Uint8Array; transparentColor: number };
      const size = w * h * 2;
      const pixels = new Uint8Array(size);
      pixels.set(sprite.pixels.subarray(0, size));
      const mask = new Uint8Array(size);
      for (let p = 0; p < size; p++) mask[p] = pixels[p] === sprite.transparentColor ? 1 : 0;
      slot = {
        kind: "sprite", resource: name, part, fileIdx, frameIdx: i, width: w * 2, height: h, var1: (w * 2) >> 3, realWidth: w * 2, bpp: 4,
        data: pixels, mask, transparentColor: sprite.transparentColor,
      };
    }
    state.anims[entry] = slot;
  }
  return entry;
}

/** `checkForPendingDataLoad` : PRC (puis son script 1), REL, OBJ (vide les calques), MSG. */
export function checkForPendingDataLoad(ctx: PartContext, parts: PartFiles): void {
  const { state } = ctx;
  const pending = state.pending;
  if (pending.prc) {
    const name = pending.prc;
    const ok = loadPrc(ctx, parts, name);
    state.names.prc = name;
    pending.prc = "";
    if (ok) addGlobalScript(state, 1);
  }
  if (pending.rel) {
    loadRel(ctx, parts, pending.rel);
    state.names.rel = pending.rel;
    pending.rel = "";
  }
  if (pending.obj) {
    state.overlays = [];
    loadObj(ctx, parts, pending.obj);
    state.names.obj = pending.obj;
    pending.obj = "";
  }
  if (pending.msg) {
    loadMsg(ctx, parts, pending.msg);
    state.names.msg = pending.msg;
    pending.msg = "";
  }
}

/** `addScriptToGlobalScripts` : nouvelle instance en fin de liste (elle s'exécute dans le tick en cours). */
export function addGlobalScript(state: EngineState, index: number): void {
  const raw = state.scriptTable[index];
  if (!raw) throw new Error(`script global ${index} absent du PRC ${state.names.prc}`);
  state.globalScripts.push(new ScriptInstance(raw, index));
}

/** `runObjectScript` : nouvelle instance de l'entrée REL (locale 0 = exécutions précédentes). */
export function addObjectScript(state: EngineState, entry: number): void {
  const raw = state.relTable[entry];
  if (!raw) throw new Error(`entrée REL ${entry} absente de ${state.names.rel}`);
  state.objectScripts.push(new ScriptInstance(raw, entry));
}
