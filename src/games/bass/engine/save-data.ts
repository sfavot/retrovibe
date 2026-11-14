/**
 * Données de sauvegarde au format de ScummVM (révision 6) : lecture de l'en-tête, des variables, des fichiers chargés et des compacts.
 * Sert à « Recommencer » et au départ après l'introduction (données de remise à zéro de `sky.cpt`, qui ont ce format) et, en écriture
 * (`writeSaveWords`, `Control::prepareSaveData`), aux sauvegardes du site (`save.ts`, D6).
 *
 * Référence : ScummVM engines/sky/control.cpp (`Control::parseSaveData`, `restartGame`), control.h (`SAVE_FILE_REVISION`) et
 * logic.cpp (`Logic::parseSaveData`) (GPL v3 ou ultérieure).
 *
 * Disposition (mots `u16` petit-boutistes, `u32` sur deux mots) : `u32` taille en octets, `u32` révision, `u32` version du jeu, deux `u16`
 * effets en cours, `u32` musique, `u32` police, `u32` curseur, `u32` palette, 838 `u32` variables, 60 `u32` fichiers chargés, puis les mots
 * des compacts de `saveIds` (taille de chacun dans `sky.cpt`).
 *
 * Écart volontaire : les révisions anciennes (5, `importOldCompact`) ne sont pas lues (erreur).
 */

import { FILE_LIST_SIZE } from "./files";
import { NUM_SCRIPT_VARS } from "./ids";

export const SAVE_FILE_REVISION = 6;
/** Mots de l'en-tête (taille, révision, version, 2 effets, musique, police, curseur, palette). */
const HEADER_WORDS = 16;

export interface SaveHeader {
  readonly size: number;
  readonly revision: number;
  readonly gameVersion: number;
  readonly sounds: readonly [number, number];
  readonly music: number;
  readonly charSet: number;
  readonly mouseType: number;
  readonly palette: number;
}

export interface SaveData {
  readonly header: SaveHeader;
  readonly vars: Uint32Array;
  /** `reloadList` (60 entrées, terminée par 0). */
  readonly reloadList: Uint32Array;
  /** Mots des compacts, dans l'ordre de `saveIds`. */
  readonly compactWords: Uint16Array;
}

/** Ce qu'une sauvegarde contient (`Control::prepareSaveData`) ; `compactWords` : les compacts de `saveIds`, dans l'ordre. */
export interface SaveContent extends Omit<SaveHeader, "size" | "revision"> {
  readonly vars: ArrayLike<number>;
  readonly reloadList: ArrayLike<number>;
  readonly compactWords: Uint16Array;
}

/** `Control::prepareSaveData` : les mots de la sauvegarde, révision 6 (`u32` taille en octets d'abord). */
export function writeSaveWords(content: SaveContent): Uint16Array {
  const words = new Uint16Array(HEADER_WORDS + (NUM_SCRIPT_VARS + FILE_LIST_SIZE) * 2 + content.compactWords.length);
  let pos = 0;
  const u32 = (v: number): void => {
    words[pos++] = v & 0xffff;
    words[pos++] = (v >>> 16) & 0xffff;
  };
  u32(words.length * 2);
  u32(SAVE_FILE_REVISION);
  u32(content.gameVersion);
  words[pos++] = content.sounds[0] & 0xffff;
  words[pos++] = content.sounds[1] & 0xffff;
  u32(content.music);
  u32(content.charSet);
  u32(content.mouseType);
  u32(content.palette);
  for (let i = 0; i < NUM_SCRIPT_VARS; i++) u32(content.vars[i]! >>> 0);
  for (let i = 0; i < FILE_LIST_SIZE; i++) u32((content.reloadList[i] ?? 0) >>> 0);
  words.set(content.compactWords, pos);
  return words;
}

/** Découpe des données de sauvegarde ; `compactWords` doit faire exactement `expectedCompactWords` mots. */
export function parseSaveWords(words: Uint16Array, expectedCompactWords: number): SaveData {
  const u32 = (i: number): number => (words[i]! | (words[i + 1]! << 16)) >>> 0;
  if (words.length < HEADER_WORDS) throw new Error("sauvegarde tronquée");
  const header: SaveHeader = {
    size: u32(0),
    revision: u32(2),
    gameVersion: u32(4),
    sounds: [words[6]!, words[7]!],
    music: u32(8),
    charSet: u32(10),
    mouseType: u32(12),
    palette: u32(14),
  };
  if (header.revision !== SAVE_FILE_REVISION) throw new Error(`révision de sauvegarde ${header.revision} non lue (${SAVE_FILE_REVISION} attendue)`);
  let pos = HEADER_WORDS;
  const vars = new Uint32Array(NUM_SCRIPT_VARS);
  for (let i = 0; i < NUM_SCRIPT_VARS; i++, pos += 2) vars[i] = u32(pos);
  const reloadList = new Uint32Array(FILE_LIST_SIZE);
  for (let i = 0; i < FILE_LIST_SIZE; i++, pos += 2) reloadList[i] = u32(pos);
  const compactWords = words.subarray(pos, pos + expectedCompactWords);
  pos += expectedCompactWords;
  if (compactWords.length !== expectedCompactWords || pos * 2 !== header.size) {
    throw new Error(`Restore failed! Savegame data = ${pos * 2} bytes. Expected size: ${header.size}`);
  }
  return { header, vars, reloadList, compactWords };
}
