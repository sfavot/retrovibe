/**
 * Les 26 ressources de `lure.dat` (`0x3F01` à `0x3F1A`) : tables du jeu extraites de `LURE.EXE` par `create_lure`.
 *
 * Sources (ScummVM, GPL v3+) : `Resources::reloadData` (engines/lure/res.cpp), structures de `res_struct.h` / `res_struct.cpp`
 * (`RoomData`, `HotspotData`, `HotspotAnimData`, `CharacterScheduleSet`, `RandomActionSet`, `TalkHeaderData`, `RoomExitCoordinates`, `StringList`…) et
 * `Surface`, `TalkDialog`, `AudioInitIcon` (surface.cpp) pour les cadres et l'icône ; disposition produite par
 * `devtools/create_lure/create_lure_dat.cpp` et `process_actions.cpp` (les tailles et le remplissage viennent de là).
 *
 * Structure : chaque `parse*` lit la ressource avec un `Cursor`, qui marque les octets lus dans une `Coverage` facultative ; `lureDatLayout`
 * (test) vérifie ainsi que ce qui reste est exactement le remplissage connu. Les ressources qui sont des **segments de mémoire** de
 * l'exécutable adressés par décalage (scripts `0x3F0C`, `0x3F0D`, combats `0x3F16`) sont rendues par `Segment`, sans interprétation : leur
 * décodage est le travail du moteur.
 *
 * Ce que `create_lure` laisse non initialisé et que ce lecteur ne lit donc jamais (le bloc livré par ScummVM y contient des `0xCD`, un
 * bloc régénéré autre chose : seuls ces octets diffèrent) :
 * - `0x3F06` : 18 octets entre la liste des offsets de séquences et la première séquence (la liste réserve 63 mots, 54 servent : 53 offsets et la marque `0xFFFF`) ;
 * - `0x3F10` : de l'octet 1 025 à la fin (le programme ne renseigne pas la taille, il reprend celle de la ressource précédente) ;
 * - `0x3F11` : les deux derniers octets (la taille compte un mot de trop) ;
 * - `0x3F12` : 12 octets entre la table des enregistrements et la première liste (deux emplacements d'enregistrement de 6 octets réservés
 *   pour les entrées en double, jamais remplis).
 * Autre remplissage mesuré (octets à zéro) : voir les constantes `*_PADDING` et `docs/lure/formats.md`.
 *
 * Écarts volontaires :
 * - les listes chaînées de ScummVM (`Common::List`) sont des tableaux ; les recherches (`getRoom`, `getHotspot`…) sont laissées au moteur ;
 * - une coordonnée reste telle que stockée (`create_lure` a déjà retranché `0x80` aux coordonnées de l'exécutable) ;
 * - la liste des textes de l'interface (`0x3F17`) corrige la coquille « Parle » (D9 du plan) : voir `parseUiStrings` ;
 * - aucune validation du jeu (existence des hotspots, des séquences) : c'est le travail du moteur.
 */

import { Cursor, type Coverage } from "./cursor";
import { SCHEDULE_ACTION_PARAMS } from "./ids";

const END = 0xffff;

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Segment de mémoire de l'exécutable, adressé par décalage en octets. */
export class Segment {
  constructor(readonly bytes: Uint8Array) {}

  get length(): number {
    return this.bytes.length;
  }

  u8(offset: number): number {
    this.check(offset, 1);
    return this.bytes[offset]!;
  }

  u16(offset: number): number {
    this.check(offset, 2);
    return this.bytes[offset]! | (this.bytes[offset + 1]! << 8);
  }

  i16(offset: number): number {
    return (this.u16(offset) << 16) >> 16;
  }

  slice(offset: number, length: number): Uint8Array {
    this.check(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }

  private check(offset: number, length: number): void {
    if (offset < 0 || offset + length > this.bytes.length) throw new RangeError(`lecture hors du segment (${offset}, ${length}, taille ${this.bytes.length})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pièces (0x3F05) et grilles de cheminement (0x3F13)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Rectangle `[xs, xe[ x [ys, ye[`. */
export interface Rect {
  xs: number;
  xe: number;
  ys: number;
  ye: number;
}

export type ExitDirection = "up" | "down" | "left" | "right" | "none";

export interface RoomExit extends Rect {
  /** Séquence de script à exécuter (`0xFFFF` : aucune, la sortie mène à `roomNumber`). */
  sequenceOffset: number;
  roomNumber: number;
  /** Direction de sortie (`0x80` haut, `0x40` bas, `0x20` gauche, `0x10` droite). */
  direction: ExitDirection;
  /** Position d'arrivée dans la pièce de destination. */
  x: number;
  y: number;
}

/** `ROOM_PATHS_WIDTH`, `ROOM_PATHS_HEIGHT` : une grille de cheminement fait 40 x 24 blocs de 8 pixels, 1 bit par bloc (5 octets par ligne). */
export const ROOM_PATHS_WIDTH = 40;
export const ROOM_PATHS_HEIGHT = 24;
export const ROOM_PATHS_SIZE = (ROOM_PATHS_WIDTH / 8) * ROOM_PATHS_HEIGHT;

export interface RoomData {
  roomNumber: number;
  hdrFlags: number;
  /** Masque d'actions possibles (28 bits bas du mot de 32 bits). */
  actions: number;
  /** Quatre bits hauts de l'octet de poids fort du mot d'actions (`flags`). */
  flags: number;
  descId: number;
  numLayers: number;
  /** Écrans de calques (ressources de disque). */
  layers: number[];
  sequenceOffset: number;
  clippingXStart: number;
  clippingXEnd: number;
  areaFlag: number;
  exitTime: number;
  /** Zone de marche aléatoire : `left`, `right`, `top`, `bottom`. */
  walkBounds: { left: number; right: number; top: number; bottom: number };
  exits: RoomExit[];
  /** Grille de cheminement (`ROOM_PATHS_SIZE` octets, vue de `0x3F13`). */
  paths: Uint8Array;
}

const DIRECTIONS: Record<number, ExitDirection> = { 0x80: "up", 0x40: "down", 0x20: "left", 0x10: "right" };

/** Nombre de grilles de `0x3F13` : une par numéro de pièce de 1 à 51 (`ROOM_NUM_ENTRIES` de `create_lure`). */
export const ROOM_PATHS_ENTRIES = 51;

/** `Resources::reloadData`, partie pièces. `pathData` est `0x3F13`. */
export function parseRooms(bytes: Uint8Array, pathData: Uint8Array, coverage?: Coverage, pathCoverage?: Coverage): RoomData[] {
  const table = new Cursor(bytes, coverage);
  const paths = new Cursor(pathData, pathCoverage);
  expect(pathData.length === ROOM_PATHS_ENTRIES * ROOM_PATHS_SIZE, "grilles de cheminement : taille inattendue");
  const rooms: RoomData[] = [];
  for (let offset = table.u16(); offset !== END; offset = table.u16()) {
    if (offset === 0) continue;
    const c = new Cursor(bytes, coverage).seek(offset);
    const roomNumber = c.u16();
    const hdrFlags = c.u8();
    c.u8(); // octet inutilisé
    const actionsWord = c.u32();
    const descId = c.u16();
    const numLayers = c.u16();
    const layers = [c.u16(), c.u16(), c.u16(), c.u16()];
    const sequenceOffset = c.u16();
    const clippingXStart = c.i16();
    const clippingXEnd = c.i16();
    const areaFlag = c.u8();
    const numExits = c.u8();
    const exitTime = c.u32();
    const walkBounds = { left: c.i16(), right: c.i16(), top: c.i16(), bottom: c.i16() };
    expect(roomNumber >= 1 && roomNumber <= ROOM_PATHS_ENTRIES, `pièce ${roomNumber} hors des grilles de cheminement`);
    const exits: RoomExit[] = [];
    for (let i = 0; i < numExits; i++) {
      const xs = c.i16();
      const xe = c.i16();
      const ys = c.i16();
      const ye = c.i16();
      const exitSequence = c.u16();
      const newRoom = c.u8();
      const direction = c.u8();
      exits.push({ xs, xe, ys, ye, sequenceOffset: exitSequence, roomNumber: newRoom, direction: DIRECTIONS[direction] ?? "none", x: c.i16(), y: c.i16() });
    }
    rooms.push({
      roomNumber,
      hdrFlags,
      actions: actionsWord & 0xfffffff,
      flags: (actionsWord >>> 24) & 0xf0,
      descId,
      numLayers,
      layers,
      sequenceOffset,
      clippingXStart,
      clippingXEnd,
      areaFlag,
      exitTime,
      walkBounds,
      exits,
      paths: paths.seek((roomNumber - 1) * ROOM_PATHS_SIZE).slice(ROOM_PATHS_SIZE),
    });
  }
  return rooms;
}

/** Largeur et hauteur de la grille décompressée (une colonne et une ligne de marge de chaque côté). */
export const DECODED_PATHS_WIDTH = 42;
export const DECODED_PATHS_HEIGHT = 26;

/**
 * `RoomPathsData::decompress` : grille de `DECODED_PATHS_WIDTH x DECODED_PATHS_HEIGHT` mots (0 libre, `0xFFFF` occupé), avec une marge vide autour de
 * l'écran ; une case occupée s'étend vers la gauche de `characterWidth / 8` blocs (largeur du personnage). Rangée de bas en haut, droite à gauche :
 * l'original écrit à rebours, ce qui est conservé pour que les indices soient ceux de ScummVM.
 */
export function decompressPaths(paths: Uint8Array, characterWidth: number): Uint16Array {
  const out = new Uint16Array(DECODED_PATHS_WIDTH * DECODED_PATHS_HEIGHT);
  let pIn = ROOM_PATHS_SIZE - 1;
  let pOut = out.length - 1;
  const charWidth = characterWidth >> 3;
  let charCtr = 0;
  let charState = false;

  for (let i = 0; i < DECODED_PATHS_WIDTH + 1; i++) out[pOut--] = 0;
  for (let y = 0; y < ROOM_PATHS_HEIGHT; y++) {
    charState = false;
    for (let x = 0; x < ROOM_PATHS_WIDTH / 8; x++) {
      let v = paths[pIn--]!;
      for (let bit = 0; bit < 8; bit++) {
        const isSet = (v & 1) !== 0;
        v >>= 1;
        if (charState) {
          if (isSet) charCtr = charWidth;
          out[pOut--] = 0xffff;
          charState = --charCtr !== 0;
        } else if (!isSet) {
          out[pOut--] = 0;
        } else {
          out[pOut--] = 0xffff;
          charCtr = charWidth - 1;
          charState = charCtr >= 0;
        }
      }
    }
    out[pOut--] = 0;
    out[pOut--] = 0;
    charState = false;
  }
  for (let i = 0; i < ROOM_PATHS_WIDTH + 1; i++) out[pOut--] = 0;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Hotspots (0x3F07), surcharges (0x3F08), sorties (0x3F09, 0x3F0A, 0x3F14, 0x3F15)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Taille d'un enregistrement de `0x3F07` (`kSizeOfHotspotResource`). */
export const HOTSPOT_RECORD_SIZE = 62;

/** Identifiants à partir de là : hotspots « non visuels » (`START_NONVISUAL_HOTSPOT_ID`). */
export const NONVISUAL_HOTSPOT_ID = 0x7530;

/**
 * Enregistrement de `0x3F07`, rendu tel que stocké. Pour un hotspot non visuel (`hotspotId >= NONVISUAL_HOTSPOT_ID`), les champs de position, de taille,
 * de marche et de parole (`startX` à `talkY`, jusqu'à `tickScriptOffset`) sont des restes de mémoire sans signification (x = 32 671, y = -128, hauteur 28 215…) :
 * le rectangle vient de la surcharge `0x3F08` (`parseHotspotOverrides`), la direction de `scriptLoadFlag` (`nonVisualDirection`) ; ScummVM ne les lit pas non plus.
 */
export interface HotspotRecord {
  hotspotId: number;
  nameId: number;
  descId: number;
  descId2: number;
  /** Masque d'actions (28 bits bas du mot de 32 bits). */
  actions: number;
  /** Quatre bits hauts de l'octet de poids fort du mot d'actions. */
  flags: number;
  actionsOffset: number;
  roomNumber: number;
  layer: number;
  scriptLoadFlag: number;
  loadOffset: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  widthCopy: number;
  heightCopy: number;
  yCorrection: number;
  walkX: number;
  walkY: number;
  talkX: number;
  talkY: number;
  colorOffset: number;
  animRecordId: number;
  hotspotScriptOffset: number;
  talkScriptOffset: number;
  tickProcId: number;
  tickTimeout: number;
  tickScriptOffset: number;
  /** Identifiant d'entrée d'emploi du temps : `(rang de l'ensemble, à partir de 1) << 10 | rang de l'instruction` (`CharacterScheduleList::getEntry`), 0 : aucun. */
  npcScheduleId: number;
  characterMode: number;
  delayCtr: number;
  flags2: number;
  headerFlags: number;
}

export function parseHotspots(bytes: Uint8Array, coverage?: Coverage): HotspotRecord[] {
  const c = new Cursor(bytes, coverage);
  const out: HotspotRecord[] = [];
  for (let hotspotId = c.u16(); hotspotId !== END; hotspotId = c.u16()) {
    const start = c.pos - 2;
    const nameId = c.u16();
    const descId = c.u16();
    const descId2 = c.u16();
    const actionsWord = c.u32();
    const actionsOffset = c.u16();
    const roomNumber = c.u16();
    const layer = c.u8();
    const scriptLoadFlag = c.u8();
    const loadOffset = c.u16();
    const startX = c.i16();
    const startY = c.i16();
    const width = c.u16();
    const height = c.u16();
    const widthCopy = c.u16();
    const heightCopy = c.u16();
    const yCorrection = c.u16();
    const walkX = c.i16();
    const walkY = c.u16();
    const talkX = c.i8();
    const talkY = c.i8();
    const colorOffset = c.u16();
    const animRecordId = c.u16();
    const hotspotScriptOffset = c.u16();
    const talkScriptOffset = c.u16();
    const tickProcId = c.u16();
    const tickTimeout = c.u16();
    const tickScriptOffset = c.u16();
    const npcScheduleId = c.u16();
    const characterMode = c.u16();
    const delayCtr = c.u16();
    const flags2 = c.u8();
    const headerFlags = c.u8();
    expect(c.pos - start === HOTSPOT_RECORD_SIZE, "hotspot : enregistrement de taille inattendue");
    out.push({
      hotspotId, nameId, descId, descId2, actions: actionsWord & 0xfffffff, flags: (actionsWord >>> 24) & 0xf0, actionsOffset, roomNumber, layer,
      scriptLoadFlag, loadOffset, startX, startY, width, height, widthCopy, heightCopy, yCorrection, walkX, walkY, talkX, talkY, colorOffset,
      animRecordId, hotspotScriptOffset, talkScriptOffset, tickProcId, tickTimeout, tickScriptOffset, npcScheduleId, characterMode, delayCtr, flags2, headerFlags,
    });
  }
  return out;
}

export interface HotspotOverride extends Rect {
  hotspotId: number;
}

export function parseHotspotOverrides(bytes: Uint8Array, coverage?: Coverage): HotspotOverride[] {
  const c = new Cursor(bytes, coverage);
  const out: HotspotOverride[] = [];
  for (let hotspotId = c.u16(); hotspotId !== END; hotspotId = c.u16()) out.push({ hotspotId, xs: c.i16(), xe: c.i16(), ys: c.i16(), ye: c.i16() });
  return out;
}

export interface RoomExitHotspot extends Rect {
  hotspotId: number;
  cursorNum: number;
  destRoomNumber: number;
}

/** `0x3F09` : table des offsets par numéro de pièce (0 : aucune sortie) puis listes de sorties-hotspots. */
export function parseRoomExitHotspots(bytes: Uint8Array, coverage?: Coverage): Map<number, RoomExitHotspot[]> {
  const table = new Cursor(bytes, coverage);
  const out = new Map<number, RoomExitHotspot[]>();
  for (let room = 0; ; room++) {
    const offset = table.u16();
    if (offset === END) break;
    if (offset === 0) continue;
    const c = new Cursor(bytes, coverage).seek(offset);
    const list: RoomExitHotspot[] = [];
    for (let hotspotId = c.u16(); hotspotId !== END; hotspotId = c.u16()) {
      list.push({ hotspotId, xs: c.i16(), xe: c.i16(), ys: c.i16(), ye: c.i16(), cursorNum: c.u16(), destRoomNumber: c.u16() });
    }
    out.set(room, list);
  }
  return out;
}

export interface ExitJoinSide {
  hotspotId: number;
  currentFrame: number;
  destFrame: number;
  openSound: number;
  closeSound: number;
}

export interface RoomExitJoin {
  hotspots: [ExitJoinSide, ExitJoinSide];
  blocked: number;
}

/** `0x3F0A` : enregistrements de 13 octets (`kSizeOfRoomExitJoinResource`) terminés par `0xFFFF`. */
export function parseRoomExitJoins(bytes: Uint8Array, coverage?: Coverage): RoomExitJoin[] {
  const c = new Cursor(bytes, coverage);
  const out: RoomExitJoin[] = [];
  for (let id1 = c.u16(); id1 !== END; id1 = c.u16()) {
    const first: ExitJoinSide = { hotspotId: id1, currentFrame: c.u8(), destFrame: c.u8(), openSound: c.u8(), closeSound: c.u8() };
    const second: ExitJoinSide = { hotspotId: c.u16(), currentFrame: c.u8(), destFrame: c.u8(), openSound: c.u8(), closeSound: c.u8() };
    out.push({ hotspots: [first, second], blocked: c.u8() });
  }
  return out;
}

export interface RoomExitCoordinate {
  x: number;
  /** 12 bits bas du mot `y`. */
  y: number;
  roomNumber: number;
  /** Quatre bits hauts du mot `y`, décalés de 4 (`hotspotIndexId`). */
  hotspotIndexId: number;
}

export interface RoomExitCoordinates {
  /** Pour chaque pièce de destination (1 à 52), numéro de l'entrée à suivre. */
  roomIndex: number[];
  entries: RoomExitCoordinate[];
}

export const ROOM_EXIT_COORDINATES_NUM_ROOMS = 52;
export const ROOM_EXIT_COORDINATES_NUM_ENTRIES = 6;

/** `0x3F14` : une entrée de 88 octets par pièce (49 pièces) terminée par `0xFFFF`. */
export function parseRoomExitCoordinates(bytes: Uint8Array, coverage?: Coverage): RoomExitCoordinates[] {
  const c = new Cursor(bytes, coverage);
  const out: RoomExitCoordinates[] = [];
  while (c.peekU16() !== END) {
    const roomIndex: number[] = [];
    for (let i = 0; i < ROOM_EXIT_COORDINATES_NUM_ROOMS; i++) roomIndex.push(c.u8());
    const entries: RoomExitCoordinate[] = [];
    for (let i = 0; i < ROOM_EXIT_COORDINATES_NUM_ENTRIES; i++) {
      const x = c.i16();
      const rawY = c.u16();
      entries.push({ x, y: rawY & 0xfff, roomNumber: c.u16(), hotspotIndexId: (rawY >> 12) << 4 });
    }
    out.push({ roomIndex, entries });
  }
  c.u16();
  return out;
}

export interface RoomExitIndexedHotspot {
  roomNumber: number;
  hotspotIndex: number;
  hotspotId: number;
}

/** `0x3F15` : enregistrements de 4 octets terminés par `0xFFFF`. */
export function parseExitHotspotIds(bytes: Uint8Array, coverage?: Coverage): RoomExitIndexedHotspot[] {
  const c = new Cursor(bytes, coverage);
  const out: RoomExitIndexedHotspot[] = [];
  while (c.peekU16() !== END) out.push({ roomNumber: c.u8(), hotspotIndex: c.u8(), hotspotId: c.u16() });
  c.u16();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Animations de hotspots (0x3F0B)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface Movement {
  frameNumber: number;
  xChange: number;
  yChange: number;
}

export interface HotspotAnimRecord {
  animRecordId: number;
  /** Ressource de disque de l'animation (`decodeAnimation`). */
  animId: number;
  flags: number;
  upFrame: number;
  downFrame: number;
  leftFrame: number;
  rightFrame: number;
  /** Images de marche par direction (vide si l'animation n'en a pas). */
  up: Movement[];
  down: Movement[];
  left: Movement[];
  right: Movement[];
}

const ANIM_RECORD_SIZE = 18;

export function parseAnimData(bytes: Uint8Array, coverage?: Coverage): HotspotAnimRecord[] {
  const c = new Cursor(bytes, coverage);
  const out: HotspotAnimRecord[] = [];
  const movements = (offset: number): Movement[] => {
    if (offset === 0) return [];
    const m = new Cursor(bytes, coverage).seek(offset);
    const list: Movement[] = [];
    for (let frameNumber = m.u16(); frameNumber !== END; frameNumber = m.u16()) list.push({ frameNumber, xChange: m.i16(), yChange: m.i16() });
    return list;
  };
  for (let animRecordId = c.u16(); animRecordId !== END; animRecordId = c.u16()) {
    const start = c.pos - 2;
    const animId = c.u16();
    const flags = c.u16();
    const upOffset = c.u16();
    const downOffset = c.u16();
    const leftOffset = c.u16();
    const rightOffset = c.u16();
    const upFrame = c.u8();
    const downFrame = c.u8();
    const leftFrame = c.u8();
    const rightFrame = c.u8();
    expect(c.pos - start === ANIM_RECORD_SIZE, "animation : enregistrement de taille inattendue");
    out.push({
      animRecordId, animId, flags, upFrame, downFrame, leftFrame, rightFrame,
      up: movements(upOffset), down: movements(downOffset), left: movements(leftOffset), right: movements(rightOffset),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Emplois du temps (0x3F06)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ScheduleEntry {
  action: number;
  params: number[];
}

export interface ScheduleSet {
  /** Rang à partir de 1 : le poids fort (`id << 10`) des identifiants d'entrée (hotspots, sauts, `charOffsets`). */
  id: number;
  /** Position de l'ensemble dans la ressource. */
  offset: number;
  entries: ScheduleEntry[];
}

export interface RandomActionSet {
  roomNumber: number;
  /** Une entrée par action : numéro d'emploi du temps (`0` : rien) et si elle peut se répéter. */
  actions: Array<{ id: number; repeatable: boolean }>;
}

export interface NpcSchedules {
  /** Index d'emplois du temps utilisés par les scripts (`numCharOffsets`). */
  charOffsets: number[];
  randomActions: RandomActionSet[];
  schedules: ScheduleSet[];
}

export function parseNpcSchedules(bytes: Uint8Array, coverage?: Coverage): NpcSchedules {
  const c = new Cursor(bytes, coverage);
  const charOffsets: number[] = [];
  for (let v = c.u16(); v !== END; v = c.u16()) charOffsets.push(v);

  const randomActions: RandomActionSet[] = [];
  while (c.peekU16() !== END) {
    const roomNumber = c.u16();
    const details = c.u16();
    const numActions = details & 0xff;
    expect(numActions <= 8, "actions aléatoires : plus de 8 actions");
    const actions: Array<{ id: number; repeatable: boolean }> = [];
    for (let i = 0; i < numActions; i++) actions.push({ id: c.u16(), repeatable: (details & (0x100 << i)) !== 0 });
    randomActions.push({ roomNumber, actions });
  }
  c.u16();

  const offsets: number[] = [];
  for (let v = c.u16(); v !== END; v = c.u16()) offsets.push(v);

  const schedules = offsets.map((offset, index): ScheduleSet => {
    const s = new Cursor(bytes, coverage).seek(offset);
    const entries: ScheduleEntry[] = [];
    for (let action = s.u16(); action !== 0; action = s.u16()) {
      expect(action <= 40, `emploi du temps : action ${action} inconnue`);
      const params: number[] = [];
      for (let i = 0; i < SCHEDULE_ACTION_PARAMS[action]!; i++) params.push(s.u16());
      entries.push({ action, params });
    }
    return { id: index + 1, offset, entries };
  });
  return { charOffsets, randomActions, schedules };
}

/** Octets d'un ensemble (action de 2 octets + paramètres, plus l'action nulle finale) : sert à vérifier que les ensembles se suivent. */
export function scheduleSetByteLength(set: ScheduleSet): number {
  return set.entries.reduce((sum, entry) => sum + 2 + entry.params.length * 2, 0) + 2;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Messages (0x3F0F), listes d'actions (0x3F10), scripts de hotspots (0x3F0E)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface MessageSet {
  characterId: number;
  /** Couples `(value, id)` : `Hotspot::showMessage` cherche `id` et en tire `value` (`0xFFFF` termine la liste). */
  entries: Array<{ value: number; id: number }>;
}

/** `0x3F0F` : couples `(personnage, offset)` jusqu'au premier offset, puis listes de couples `(valeur, id)` terminées par `0xFFFF`. */
export function parseMessages(bytes: Uint8Array, coverage?: Coverage): MessageSet[] {
  const c = new Cursor(bytes, coverage);
  const sets: MessageSet[] = [];
  const headerEnd = new Cursor(bytes).seek(2).u16();
  while (c.pos < headerEnd) {
    const characterId = c.u16();
    const offset = c.u16();
    const l = new Cursor(bytes, coverage).seek(offset);
    const entries: Array<{ value: number; id: number }> = [];
    for (let value = l.u16(); value !== END; value = l.u16()) entries.push({ value, id: l.u16() });
    sets.push({ characterId, entries });
  }
  return sets;
}

export interface HotspotAction {
  action: number;
  /** Séquence de script à exécuter (offset dans `0x3F0C`) ; `>= 0x8000` : message à montrer (`showMessage`, identifiant `& 0x7FFF`) ; 0 : rien. */
  sequenceOffset: number;
}

export interface HotspotActionList {
  recordId: number;
  actions: HotspotAction[];
}

export interface ActionLists {
  lists: HotspotActionList[];
  /** Octets que décrit la structure : le reste de la ressource est de la mémoire non initialisée (voir l'en-tête du module). */
  usedLength: number;
}

/** `0x3F10` : couples `(recordId, offset)` jusqu'à `0xFFFF`, puis par liste `u16` nombre d'actions et actions de 3 octets. */
export function parseActionLists(bytes: Uint8Array, coverage?: Coverage): ActionLists {
  const c = new Cursor(bytes, coverage);
  const lists: HotspotActionList[] = [];
  let usedLength = 0;
  for (let recordId = c.u16(); recordId !== END; recordId = c.u16()) {
    const offset = c.u16();
    const l = new Cursor(bytes, coverage).seek(offset);
    const count = l.u16();
    const actions: HotspotAction[] = [];
    for (let i = 0; i < count; i++) actions.push({ action: l.u8(), sequenceOffset: l.u16() });
    lists.push({ recordId, actions });
    usedLength = Math.max(usedLength, l.pos);
  }
  return { lists, usedLength };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dialogues (0x3F11, 0x3F12)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface TalkHeader {
  hotspotId: number;
  /** Numéros de dialogue (`recordId` de `0x3F12`) : un par indice de conversation du personnage. */
  entries: number[];
}

export interface TalkHeaders {
  headers: TalkHeader[];
  /** Fin de la dernière liste ; les 2 octets suivants sont non initialisés. */
  usedLength: number;
}

/** `0x3F11` : couples `(hotspotId, offset)` jusqu'à `0xFFFF`, puis listes de `u16` terminées par `0xFFFF`. */
export function parseTalkHeaders(bytes: Uint8Array, coverage?: Coverage): TalkHeaders {
  const c = new Cursor(bytes, coverage);
  const headers: TalkHeader[] = [];
  let usedLength = 0;
  for (let hotspotId = c.u16(); hotspotId !== END; hotspotId = c.u16()) {
    const offset = c.u16();
    const l = new Cursor(bytes, coverage).seek(offset);
    const entries: number[] = [];
    for (let v = l.u16(); v !== END; v = l.u16()) entries.push(v);
    headers.push({ hotspotId, entries });
    usedLength = Math.max(usedLength, l.pos);
  }
  return { headers, usedLength };
}

export interface TalkEntry {
  preSequenceId: number;
  /** Texte de l'option ou de la réponse (identifiant de texte). */
  descId: number;
  postSequenceId: number;
}

export interface TalkRecord {
  recordId: number;
  entries: TalkEntry[];
  responses: TalkEntry[];
}

export interface TalkData {
  /** Six identifiants de dialogue pour « Donne » (`NUM_GIVE_TALK_IDS`). */
  giveTalkIds: number[];
  records: TalkRecord[];
}

export const NUM_GIVE_TALK_IDS = 6;

/** `0x3F12` : six identifiants, puis couples `(recordId, entrées, réponses)` jusqu'à `0xFFFF`, listes de 6 octets terminées par `0xFFFF`. */
export function parseTalkData(bytes: Uint8Array, coverage?: Coverage): TalkData {
  const c = new Cursor(bytes, coverage);
  const giveTalkIds: number[] = [];
  for (let i = 0; i < NUM_GIVE_TALK_IDS; i++) giveTalkIds.push(c.u16());
  const base = c.pos;
  const readList = (offset: number): TalkEntry[] => {
    const l = new Cursor(bytes, coverage).seek(base + offset);
    const list: TalkEntry[] = [];
    for (let preSequenceId = l.u16(); preSequenceId !== END; preSequenceId = l.u16()) list.push({ preSequenceId, descId: l.u16(), postSequenceId: l.u16() });
    return list;
  };
  const records: TalkRecord[] = [];
  for (let recordId = c.u16(); recordId !== END; recordId = c.u16()) {
    const listOffset = c.u16();
    const responsesOffset = c.u16();
    records.push({ recordId, entries: readList(listOffset), responses: readList(responsesOffset) });
  }
  return { giveTalkIds, records };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Petites ressources : décalages de scripts de hotspots, sons, textes de l'interface, icône, palettes, cadres
// ---------------------------------------------------------------------------------------------------------------------------------

/** `0x3F0E` : 24 décalages de scripts de hotspots (`Resources::getHotspotScript`). */
export function parseHotspotScriptOffsets(bytes: Uint8Array, coverage?: Coverage): number[] {
  expect(bytes.length % 2 === 0, "scripts de hotspots : taille impaire");
  const c = new Cursor(bytes, coverage);
  const out: number[] = [];
  while (c.pos < bytes.length) out.push(c.u16());
  return out;
}

/** Description d'un son (`SoundDescResource`). */
export interface SoundDesc {
  soundNumber: number;
  channel: number;
  /** Bits 0-1 : voix Roland, 2-3 : AdLib, 4-5 : internes. */
  numChannels: number;
  /** `SF_IN_USE = 1`, `SF_RESTORE = 2`. */
  flags: number;
  volume: number;
}

export const SOUND_DESC_SIZE = 5;

/** `0x3F18` : enregistrements de 5 octets. */
export function parseSoundDescs(bytes: Uint8Array, coverage?: Coverage): SoundDesc[] {
  expect(bytes.length % SOUND_DESC_SIZE === 0, "descriptions de sons : taille inattendue");
  const c = new Cursor(bytes, coverage);
  const out: SoundDesc[] = [];
  while (c.pos < bytes.length) out.push({ soundNumber: c.u8(), channel: c.u8(), numChannels: c.u8(), flags: c.u8(), volume: c.u8() });
  return out;
}

/** Texte français corrigé de `UiString` 12 (verbe « Parle à ») : voir `parseUiStrings`. */
const TALK_TO_FIXED = "Parle \x81";

/** « Vous  êtes sûr (o/n)? » tel que `create_lure` l'écrit (deux espaces) et sa forme corrigée (un seul, comme le texte `0/380` du jeu). */
const CONFIRM_AS_STORED = "Vous  \x83tes s\x89r (o/n)?";
const CONFIRM_FIXED = "Vous \x83tes s\x89r (o/n)?";

/**
 * `0x3F17` : `u16` nombre de textes puis chaînes terminées par 0 ; indices : `action - 1` pour les verbes, puis `UiString`.
 * Les chaînes sont en codes du jeu (voir `charset.ts`).
 *
 * Écart (D9) : dans `create_lure`, `"Parle \0x81"` est coupée par `\0` et le verbe stocké est « Parle » ; le programme du jeu (`LURE.EXE`)
 * contient bien « Parle à » (`Parle \x81`). Quand le verbe `TALK_TO` vaut exactement « Parle », il est rendu « Parle à ».
 * Écart (D9) : la table écrite à la main de `create_lure` a « Vous  êtes sûr (o/n)? » avec deux espaces, le jeu n'en a qu'un (texte `0/380`) : un seul est rendu.
 */
export function parseUiStrings(bytes: Uint8Array, coverage?: Coverage): string[] {
  const c = new Cursor(bytes, coverage);
  const count = c.u16();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = "";
    for (let ch = c.u8(); ch !== 0; ch = c.u8()) s += String.fromCharCode(ch);
    out.push(s);
  }
  if (out[11] === "Parle ") out[11] = TALK_TO_FIXED;
  return out.map((text) => (text === CONFIRM_AS_STORED ? CONFIRM_FIXED : text));
}

/** Icône d'initialisation audio (`0x3F1A`) : 14 x 14 pixels indexés. */
export const AUDIO_ICON_SIZE = 14;

export function parseAudioInitIcon(bytes: Uint8Array, coverage?: Coverage): Uint8Array {
  expect(bytes.length === AUDIO_ICON_SIZE * AUDIO_ICON_SIZE, "icône audio : taille inattendue");
  return new Cursor(bytes, coverage).slice(bytes.length);
}
