/**
 * État du moteur des *Voyageurs du temps* : objets, variables globales, zones, calques (`overlay`), incrustations, emplacements de sprites,
 * noms des fichiers courants et drapeaux de l'interface. Tout ce qu'une sauvegarde doit retrouver (vague S) est ici, en données simples.
 *
 * Référence : ScummVM engines/cine/cine.h (`CineEngine`), object.cpp (`addOverlay`, `removeOverlay`, `setupObject`, `modifyObjectParam`,
 * `getObjectParam`, `compareObjectParam`), bg_list.cpp (`createBgIncrustListElement`), anim.cpp (`AnimData`, `emptyAnimSpace`,
 * `freeAnimDataRange`), various.cpp (variables globales de l'interface) (GPL v3 ou ultérieure).
 *
 * Arithmétique : les champs signés sont ramenés sur 16 bits signés (`toI16`), le masque (priorité) et la partie sur 16 bits non signés,
 * comme les types de `ObjectStruct`.
 *
 * Écarts volontaires : la table des objets a 256 entrées au lieu de 255 (un script qui désigne l'objet 255 lirait hors de la table dans
 * ScummVM : ici c'est un objet nul ordinaire) ; `getObjectParam` d'un paramètre hors de 1 à 6 rend 0 au lieu d'un `assert`.
 */

import type { RawObjectScript, RawScript, ScriptInstance } from "./script/vm";

export const NUM_MAX_OBJECT = 255;
export const NUM_MAX_VAR = 255;
export const NUM_MAX_ANIMDATA = 255;
export const NUM_MAX_ZONE = 16;
/** Globales spéciales (`cine.h`). */
export const VAR_MOUSE_X_MODE = 253;
export const VAR_MOUSE_X_POS = 249;
export const VAR_MOUSE_Y_MODE = 251;
export const VAR_MOUSE_Y_POS = 250;
/** Variable de contrôle de la protection anti-copie (D7). */
export const VAR_COPY_PROTECTION = 255;
/** Position par défaut de la ligne de commande et couleur de fond des messages (`gfx.h`). */
export const DEFAULT_CMD_Y = 185;
export const DEFAULT_MESSAGE_BG = 1;

export function toI16(value: number): number {
  return (value << 16) >> 16;
}

export function toU16(value: number): number {
  return value & 0xffff;
}

/** `ObjectStruct`. `costume` -2 = objet porté (inventaire). */
export interface GameObject {
  x: number;
  y: number;
  /** Priorité d'affichage (u16) : ordre des calques. */
  mask: number;
  frame: number;
  costume: number;
  /** Nom affiché (vide : objet non cliquable). */
  name: string;
  /** u16 : couleur transparente, hauteur… selon l'usage. */
  part: number;
}

/** Types de calque (`overlay.type`). */
export const OverlayType = { Sprite: 0, ClickMask: 1, Message: 2, Failure: 3, FilledMask: 4, Occluder: 5 } as const;

/** `overlay`. Pour un message (type 2) : `objIdx` = n° du message, x, y, largeur, couleur ; pour un échec (type 3) : `objIdx` = verbe. */
export interface Overlay {
  objIdx: number;
  type: number;
  x: number;
  y: number;
  width: number;
  color: number;
  /** Type 3 : index du message d'échec tiré au dessin (`objIdx × 4 + hasard`), posé par le moteur avant le rendu. */
  failure?: number;
}

/** `BGIncrust` : sprite (param 0) ou masque rempli (param 1) incrusté dans le fond. */
export interface BgIncrust {
  objIdx: number;
  param: number;
  x: number;
  y: number;
  frame: number;
  part: number;
  bgIdx: number;
}

/** Nature d'un emplacement de `_animDataTable` (`ANIM_RAW`, `ANIM_MASK`, `ANIM_MASKSPRITE`). */
export type AnimKind = "raw" | "mask" | "sprite";

/** `AnimData` chargé. Les dimensions suivent ScummVM (`_width`, `_var1`, `_realWidth`) : le test de clic et le dessin en dépendent. */
export interface AnimSlot {
  kind: AnimKind;
  /** Fichier de la ressource (`L001.ANI`) : rechargement par nom à la reprise d'une sauvegarde. */
  resource: string;
  /** Bundle courant au chargement (`_name` de ScummVM). */
  part: string;
  /** Index dans le bundle (`_fileIdx`) et frame dans le fichier (`_frameIdx`). */
  fileIdx: number;
  frameIdx: number;
  width: number;
  height: number;
  var1: number;
  realWidth: number;
  bpp: number;
  /** Pixels (indices de couleur), masque 1 bit déplié (MSK : 0 = masquant) ou octets bruts (SPL). */
  data: Uint8Array;
  /** Sprite : 1 là où le pixel est transparent. */
  mask: Uint8Array | null;
  transparentColor: number;
}

/** Noms des fichiers courants et chargements différés (`currentPrcName`… `newMsgName`). */
export interface FileNames {
  prc: string;
  rel: string;
  obj: string;
  msg: string;
  ct: string;
  part: string;
  dat: string;
  bg: string;
}

export interface PendingLoads {
  prc: string;
  rel: string;
  obj: string;
  msg: string;
}

export function emptyObject(): GameObject {
  return { x: 0, y: 0, mask: 0, frame: 0, costume: 0, name: "", part: 0 };
}

export interface EngineState {
  objects: GameObject[];
  /** 256 globales (la 256e est la variable 255 de la protection, absente de la trace du banc). */
  globals: Int16Array;
  zoneData: Int16Array;
  overlays: Overlay[];
  incrusts: BgIncrust[];
  anims: (AnimSlot | null)[];
  /** Page de collision 320 × 200 (numéros de zone 0 à 15). */
  collision: Uint8Array;
  names: FileNames;
  pending: PendingLoads;
  /** Messages du MSG courant (octets bruts, pour la police). */
  messages: Uint8Array[];
  /** Scripts du PRC courant (`_scriptTable`) et du REL courant (`_relTable`). */
  scriptTable: RawScript[];
  relTable: RawObjectScript[];
  /** Instances en cours (`_globalScripts`, `_objectScripts`), dans l'ordre d'exécution. */
  globalScripts: ScriptInstance[];
  objectScripts: ScriptInstance[];
  // Interface (various.cpp).
  allowPlayerInput: number;
  disableSystemMenu: number;
  checkForPendingDataLoadSwitch: number;
  waitForPlayerClick: number;
  isDrawCommandEnabled: number;
  playerCommand: number;
  commandVar1: number;
  commandVar2: number;
  commandVar3: number[];
  commandBuffer: string;
  /** Texte de la ligne de commande affichée (`renderer->_cmd`). */
  commandLine: string;
  musicIsPlaying: number;
  bgVar0: number;
  currentDisk: number;
  // Rendu (FWRenderer) : état logique seulement.
  cmdY: number;
  messageBg: number;
  fadeInRequested: number;
  fadeOutCompleted: number;
}

export function createState(): EngineState {
  return {
    objects: Array.from({ length: NUM_MAX_OBJECT + 1 }, emptyObject),
    globals: new Int16Array(NUM_MAX_VAR + 1),
    zoneData: new Int16Array(NUM_MAX_ZONE),
    overlays: [],
    incrusts: [],
    anims: new Array<AnimSlot | null>(NUM_MAX_ANIMDATA).fill(null),
    collision: new Uint8Array(320 * 200),
    names: { prc: "", rel: "", obj: "", msg: "", ct: "", part: "", dat: "", bg: "" },
    pending: { prc: "", rel: "", obj: "", msg: "" },
    messages: [],
    scriptTable: [],
    relTable: [],
    globalScripts: [],
    objectScripts: [],
    allowPlayerInput: 0,
    disableSystemMenu: 0,
    checkForPendingDataLoadSwitch: 0,
    waitForPlayerClick: 0,
    isDrawCommandEnabled: 0,
    playerCommand: -1,
    commandVar1: 0,
    commandVar2: 0,
    commandVar3: [0, 0, 0, 0],
    commandBuffer: "",
    commandLine: "",
    musicIsPlaying: 0,
    bgVar0: 0,
    currentDisk: 1,
    cmdY: DEFAULT_CMD_Y,
    messageBg: DEFAULT_MESSAGE_BG,
    fadeInRequested: 0,
    fadeOutCompleted: 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Objets (object.cpp)

function object(state: EngineState, objIdx: number): GameObject {
  const obj = state.objects[objIdx & 0xff];
  if (!obj) throw new RangeError(`objet ${objIdx} hors de la table`);
  return obj;
}

/** `getObjectParam` : 1 x, 2 y, 3 masque, 4 frame, 5 costume, 6 partie (valeur 16 bits signée). */
export function getObjectParam(state: EngineState, objIdx: number, paramIdx: number): number {
  const obj = object(state, objIdx);
  switch (paramIdx) {
    case 1:
      return obj.x;
    case 2:
      return obj.y;
    case 3:
      return toI16(obj.mask);
    case 4:
      return obj.frame;
    case 5:
      return obj.costume;
    case 6:
      return toI16(obj.part);
    default:
      return 0;
  }
}

/** `modifyObjectParam` (FW) : changer le masque ré-insère le calque sprite ; costume -1 copie la globale 0. */
export function modifyObjectParam(state: EngineState, objIdx: number, paramIdx: number, value: number): void {
  const obj = object(state, objIdx);
  switch (paramIdx) {
    case 1:
      obj.x = toI16(value);
      break;
    case 2:
      obj.y = toI16(value);
      break;
    case 3:
      obj.mask = toU16(value);
      if (removeOverlay(state, objIdx, OverlayType.Sprite)) addOverlay(state, objIdx, OverlayType.Sprite);
      break;
    case 4:
      obj.frame = toI16(value);
      break;
    case 5:
      obj.costume = toI16(value) === -1 ? state.globals[0]! : toI16(value);
      break;
    case 6:
      obj.part = toU16(value);
      break;
    default:
      break;
  }
}

export function addObjectParam(state: EngineState, objIdx: number, paramIdx: number, value: number): void {
  modifyObjectParam(state, objIdx, paramIdx, getObjectParam(state, objIdx, paramIdx) + toI16(value));
}

export function subObjectParam(state: EngineState, objIdx: number, paramIdx: number, value: number): void {
  addObjectParam(state, objIdx, paramIdx, -toI16(value));
}

/** `setupObject` : x, y, masque, frame ; un calque sprite existant est ré-inséré à sa nouvelle priorité. */
export function setupObject(state: EngineState, objIdx: number, x: number, y: number, mask: number, frame: number): void {
  const obj = object(state, objIdx);
  obj.x = toI16(x);
  obj.y = toI16(y);
  obj.mask = toU16(mask);
  obj.frame = toI16(frame);
  if (removeOverlay(state, objIdx, OverlayType.Sprite)) addOverlay(state, objIdx, OverlayType.Sprite);
}

/** Registre de comparaison (`cine.h`). */
export const Cmp = { EQ: 1, GT: 2, LT: 4 } as const;

export function compareValues(a: number, b: number): number {
  const x = toI16(a);
  const y = toI16(b);
  return x === y ? Cmp.EQ : x > y ? Cmp.GT : Cmp.LT;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Calques (object.cpp, various.cpp)

/** `addOverlay` : insertion avant le premier calque dont l'objet a une priorité ≥ (liste triée par priorité croissante). */
export function addOverlay(state: EngineState, objIdx: number, type: number): void {
  const mask = object(state, objIdx).mask;
  let at = state.overlays.findIndex((o) => object(state, o.objIdx).mask >= mask);
  if (at < 0) at = state.overlays.length;
  state.overlays.splice(at, 0, { objIdx, type, x: 0, y: 0, width: 0, color: 0 });
}

/** `removeOverlay` : retire le premier calque (objet, type) ; vrai s'il existait. */
export function removeOverlay(state: EngineState, objIdx: number, type: number): boolean {
  const at = state.overlays.findIndex((o) => o.objIdx === objIdx && o.type === type);
  if (at < 0) return false;
  state.overlays.splice(at, 1);
  return true;
}

/** `addMessage` : message de script (type 2) en fin de liste. */
export function addMessage(state: EngineState, msgIdx: number, x: number, y: number, width: number, color: number): void {
  state.overlays.push({ objIdx: msgIdx, type: OverlayType.Message, x: toI16(x), y: toI16(y), width: toI16(width), color: toI16(color) });
}

/** `addPlayerCommandMessage` : message d'échec du verbe `cmd` (type 3) en fin de liste. */
export function addPlayerCommandMessage(state: EngineState, cmd: number): void {
  state.overlays.push({ objIdx: cmd, type: OverlayType.Failure, x: 0, y: 0, width: 0, color: 0 });
}

/** `removeMessages` (FW) : les messages (types 2 et 3) ne vivent qu'un dessin. */
export function removeMessages(state: EngineState): void {
  state.overlays = state.overlays.filter((o) => o.type !== OverlayType.Message && o.type !== OverlayType.Failure);
}

/** `createBgIncrustListElement` : l'incrustation mémorise l'état de l'objet (mais le dessin relit l'objet, `engine.md` § 3). */
export function addBgIncrust(state: EngineState, objIdx: number, param: number): BgIncrust {
  const obj = object(state, objIdx);
  const incrust = { objIdx, param, x: obj.x, y: obj.y, frame: obj.frame, part: obj.part & 0x0f, bgIdx: 0 };
  state.incrusts.push(incrust);
  return incrust;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Emplacements de sprites (anim.cpp)

/** `emptyAnimSpace` : premier emplacement libre à partir de `start`, ou -1. */
export function emptyAnimSpace(state: EngineState, start = 0): number {
  for (let i = start; i < NUM_MAX_ANIMDATA; i++) if (!state.anims[i]) return i;
  return -1;
}

/** `freeAnimDataRange` (bornes ramenées dans la table comme ScummVM). */
export function freeAnimDataRange(state: EngineState, start: number, count: number): void {
  if (count <= 0) return;
  let first = start;
  let n = count;
  if (first >= NUM_MAX_ANIMDATA) first = NUM_MAX_ANIMDATA - 1;
  if (first + n > NUM_MAX_ANIMDATA) n = NUM_MAX_ANIMDATA - first;
  for (let i = 0; i < n; i++) state.anims[first + i] = null;
}

/** `buildObjectListCommand` : objets nommés de costume `costume` (inventaire : -2), dans l'ordre de la table (au plus 20 affichés). */
export function objectsWithCostume(state: EngineState, costume: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < NUM_MAX_OBJECT; i++) {
    const obj = state.objects[i]!;
    if (obj.name && obj.costume === costume) out.push(i);
  }
  return out;
}
