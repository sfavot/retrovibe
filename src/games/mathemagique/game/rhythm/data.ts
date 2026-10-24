/**
 * Données du Rhythm Shop (rhythm.md §2) : `STLV` (couples morceau MIDI ↔ `PLST`), `PLST` (motif cible, variantes, outils) et liste des 45 morceaux
 * (noms de `STRL` 30001). Pur : les parseurs prennent des octets, les chargeurs un `RawArchive` (l'`Archive` du moteur convient).
 */
import { parseStrl } from "../../data/strl";
import { MEASURE, SLOT_COUNT, TOOL_BUTTONS, type Tool } from "./pieces";

export const TAG_STLV = "STLV";
export const TAG_PLST = "PLST";
export const TAG_STRL = "STRL";

/** Id de la ressource `STLV` et de la `STRL` des noms dans `RHYTHM.DAT`. */
export const STLV_ID = 30000;
export const SONG_NAMES_ID = 30001;
/** Id de la `PLST` du morceau global `k` : `30000 + k`. */
export const PLST_BASE_ID = 30000;

export const LEVEL_COUNT = 3;
export const SONGS_PER_LEVEL = 15;
export const SONG_COUNT = LEVEL_COUNT * SONGS_PER_LEVEL;

/** Octets d'une `PLST` : `50 + 84 N` avec `N = 4` variantes. */
export const PLST_SIZE = 386;

/** Accès aux octets d'une ressource (`Archive.raw` de `engine/resources`). */
export interface RawArchive {
  raw(tag: string, id: number): Uint8Array;
}

// --- STLV ---

export interface StlvEntry {
  /** Id du `\0SND` MIDI dans `MIDIMPC.DAT` (101-115, 201-215, 301-315). */
  midiId: number;
  /** Id de la `PLST` (30000 + indice global). */
  plstId: number;
}

/** 45 enregistrements de 4 octets big-endian : `u16 idMIDI`, `u16 idPLST` (ordre de sélection : niveau 1, 2 puis 3). */
export function parseStlv(bytes: Uint8Array): StlvEntry[] {
  const count = SONG_COUNT;
  if (bytes.length < count * 4) throw new Error(`STLV : ${bytes.length} octets, ${count * 4} attendus`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: count }, (_, i) => ({ midiId: view.getUint16(4 * i, false), plstId: view.getUint16(4 * i + 2, false) }));
}

// --- PLST ---

/** Couple brut `(kind, param)` d'un outil : `kind` 0 = vide, 2 = Cutter (`param` = n), 3 = Gluer (`param < 2`, taille `-param`) ou Melder (`param` = cible). */
export interface RawTool {
  kind: number;
  param: number;
}

export interface PlstVariant {
  /** Pièces du Parts Bin au départ (toujours `[144]` dans les 45 ressources). */
  parts: number[];
  /** 9 couples dans l'ordre de la liste (pas celui des boutons : voir `variantTools`). */
  tools: RawTool[];
}

export interface Plst {
  /** Motif cible : tailles des pièces dans l'ordre des emplacements `a`, `b`, `c`… (somme 144), sans les zéros de remplissage. */
  pattern: number[];
  variantCount: number;
  variants: PlstVariant[];
}

/** `PLST` (386 octets big-endian) : motif cible (24 mots), nombre de variantes, puis par variante 24 mots de pièces et 9 couples d'outils (42 mots). */
export function parsePlst(bytes: Uint8Array): Plst {
  if (bytes.length < 50) throw new Error(`PLST : ${bytes.length} octets, au moins 50 attendus`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = (word: number) => view.getUint16(2 * word, false);
  const s = (word: number) => view.getInt16(2 * word, false);
  const variantCount = u(SLOT_COUNT);
  if (bytes.length < 50 + 84 * variantCount) throw new Error(`PLST : ${bytes.length} octets pour ${variantCount} variantes (${50 + 84 * variantCount} attendus)`);
  const pattern: number[] = [];
  for (let i = 0; i < SLOT_COUNT && u(i) !== 0; i++) pattern.push(u(i));
  const total = pattern.reduce((sum, size) => sum + size, 0);
  if (total !== MEASURE) throw new Error(`PLST : le motif fait ${total} unités au lieu de ${MEASURE}`);
  const variants: PlstVariant[] = [];
  for (let j = 0; j < variantCount; j++) {
    const base = 25 + 42 * j;
    const parts: number[] = [];
    for (let i = 0; i < SLOT_COUNT && u(base + i) !== 0; i++) parts.push(u(base + i));
    const tools: RawTool[] = [];
    for (let m = 0; m < TOOL_BUTTONS; m++) tools.push({ kind: u(base + SLOT_COUNT + 2 * m), param: s(base + SLOT_COUNT + 2 * m + 1) });
    variants.push({ parts, tools });
  }
  return { pattern, variantCount, variants };
}

/** Outil d'un couple brut, `null` s'il est vide ou inconnu. Gluer : `param < 2` (taille `-param`) ; Melder : `param ≥ 2`. */
export function toolOf(raw: RawTool): Tool | null {
  if (raw.kind === 2) return raw.param >= 2 ? { kind: "cut", n: raw.param } : null;
  if (raw.kind === 3) return raw.param < 2 ? (raw.param < 0 ? { kind: "glue", size: -raw.param } : null) : { kind: "meld", target: raw.param };
  return null;
}

/**
 * Range les outils d'une variante sur les 9 boutons (`1058:0000`) : chaque famille a 3 emplacements (Cutter 0-2, Gluer 3-5, Melder 6-8),
 * remplis dans l'ordre de la liste ; les autres restent `null` (bouton grisé). Au-delà de 3 outils d'une famille, les suivants sont ignorés.
 */
export function variantTools(variant: PlstVariant): (Tool | null)[] {
  const buttons: (Tool | null)[] = Array.from({ length: TOOL_BUTTONS }, () => null);
  const base = { cut: 0, glue: 3, meld: 6 } as const;
  for (const raw of variant.tools) {
    const tool = toolOf(raw);
    if (!tool) continue;
    const first = base[tool.kind];
    const slot = buttons.slice(first, first + 3).indexOf(null);
    if (slot >= 0) buttons[first + slot] = tool;
  }
  return buttons;
}

// --- Liste des morceaux ---

export interface SongInfo {
  /** Indice global 0-44 (= niveau × 15 + emplacement). */
  index: number;
  /** Niveau 0-2 (les « Level Brothers »). */
  level: number;
  /** Rang 0-14 dans le niveau. */
  slot: number;
  /** Nom (`STRL` 30001), affiché par le Teletune. */
  name: string;
  midiId: number;
  plstId: number;
}

export function songIndex(level: number, slot: number): number {
  if (!Number.isInteger(level) || level < 0 || level >= LEVEL_COUNT) throw new RangeError(`Niveau ${level} hors de 0 à ${LEVEL_COUNT - 1}`);
  if (!Number.isInteger(slot) || slot < 0 || slot >= SONGS_PER_LEVEL) throw new RangeError(`Morceau ${slot} hors de 0 à ${SONGS_PER_LEVEL - 1}`);
  return level * SONGS_PER_LEVEL + slot;
}

/** Indice du compteur de variante dans `roster.rhythmVariant` (45 octets) : le même que l'indice global du morceau. */
export const variantCounterIndex = songIndex;

export function buildSongList(stlv: readonly StlvEntry[], names: readonly string[]): SongInfo[] {
  if (names.length < SONG_COUNT) throw new Error(`STRL ${SONG_NAMES_ID} : ${names.length} noms, ${SONG_COUNT} attendus`);
  return stlv.map((entry, index) => ({
    index,
    level: Math.floor(index / SONGS_PER_LEVEL),
    slot: index % SONGS_PER_LEVEL,
    name: names[index]!,
    midiId: entry.midiId,
    plstId: entry.plstId,
  }));
}

/** Les 45 morceaux de `RHYTHM.DAT` (`STLV` 30000 + `STRL` 30001). */
export function loadSongList(archive: RawArchive): SongInfo[] {
  return buildSongList(parseStlv(archive.raw(TAG_STLV, STLV_ID)), parseStrl(archive.raw(TAG_STRL, SONG_NAMES_ID)));
}

export function loadPlst(archive: RawArchive, plstId: number): Plst {
  return parsePlst(archive.raw(TAG_PLST, plstId));
}
