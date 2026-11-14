/**
 * Sauvegarde et restitution d'une partie de *Beneath a Steel Sky* (vague S, D6) : le contenu de la sauvegarde de ScummVM (révision 6),
 * rangé dans un objet JSON versionné pour les emplacements du site (`ui/saves.ts`, `SaveSlots`).
 *
 * Référence : ScummVM engines/sky/control.cpp (`Control::prepareSaveData`, `parseSaveData`, `loadSaveAllowed`, `restartGame`) et logic.cpp
 * (`Logic::parseSaveData`), GPL v3 ou ultérieure, lus puis réécrits.
 *
 * **Contenu** (identique à celui de ScummVM, `data`) : version du jeu, les deux effets en cours (`_saveSounds`), la musique, la police, le
 * curseur et la palette, les 838 variables, la liste des 60 fichiers chargés, puis les mots bruts des compacts de `saveIds`. `data` est
 * ce bloc de mots (`u16` petit-boutistes, `u32` sur deux mots, `save-data.ts`) en base64 : la comparaison au banc reste simple et le
 * lecteur est celui de « Recommencer ».
 *
 * **Reprise** (`restoreSave`) : comme ScummVM, `fnLeaveSection` puis les variables puis `fnEnterSection` (musique, effets et grilles de
 * la section rechargés, effets sauvegardés remis dans la file), les compacts, les compacts de texte remis à zéro, la liste des fichiers
 * rechargée, la musique relancée, le curseur et la police remis.
 *
 * **Écarts volontaires** (ce que ScummVM ne garde pas et dont une reprise exacte a besoin, `extra`) : l'état du générateur de hasard
 * (`fnRandom` : sans lui, la suite des tirages dépend de ce qui a précédé), la position et l'aspect du curseur (objet tenu compris), le
 * verrou du pointeur (`SF_MOUSE_LOCKED`, un drapeau système que les scripts posent) et les mots des compacts **hors de `saveIds`** qui
 * diffèrent de `sky.cpt` (`unsaved` : une soixantaine de mots, les animations de décor). ScummVM les laisse tels qu'ils sont dans la partie en
 * cours, si bien qu'une reprise dans une partie neuve n'a pas la même phase d'animation ; ici la reprise est exacte (tous les mots hors
 * `saveIds` reviennent d'abord à ceux de `sky.cpt`). Les textes à l'écran ne sont pas gardés (comme dans ScummVM : ils sont effacés), ni la voix
 * en cours.
 *
 * **Refus** (`saveRefusal`, `loadSaveAllowed`) : pendant un choix de dialogue (`SF_CHOOSING`, « les textes se perdraient »), dans LINC
 * (`SCREEN >= 101`) et dans les dernières pièces (82 à 89 sauf 85). Un tour de jeu interrompu par un effet (fondu, défilement) ne se
 * sauvegarde pas non plus : l'appelant attend la fin du tour (`GameControl`).
 *
 * Module pur : il ne connaît pas le stockage.
 */

import { CompactField as F } from "../data/compact-fields";
import type { Compacts } from "./compacts";
import type { ItemCache } from "./files";
import { Cpt, SF, Var } from "./ids";
import type { Logic, SystemVars } from "./logic";
import { enterSection, fnLeaveSection } from "./mcodes/game";
import type { Mouse } from "./mouse";
import { parseSaveWords, writeSaveWords } from "./save-data";
import type { BassSound, BassText } from "./services";
import type { ScriptVars } from "./vars";

/** Version du format JSON. Une autre version est refusée (`parseSave` rend `null`) : l'emplacement compte alors comme vide. */
export const SAVE_VERSION = 1;

/** `_saveSounds` vide (`0xFFFF`) : aucun effet à relancer. */
export const NO_SAVED_SOUND = 0xffff;

/** Ce que ScummVM ne sauvegarde pas (voir l'en-tête). */
export interface SaveExtra {
  /** `ScummvmRandom.state`. */
  rng: number;
  mouse: { x: number; y: number; cursor: number; hotspot: [number, number]; objectCursor: number };
  mouseLocked: boolean;
  /** Paires (position, valeur) des mots hors de `saveIds` qui diffèrent de `sky.cpt`. */
  unsaved: number[];
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** Section de la partie (`CUR_SECTION`, de 0 à 7) : description d'un emplacement. */
  section: number;
  /** Sauvegarde de ScummVM, révision 6 : mots `u16` petit-boutistes, en base64. */
  data: string;
  extra: SaveExtra;
}

/** Pourquoi la partie ne peut pas être sauvegardée maintenant. */
export type SaveRefusal = "choosing" | "linc" | "finalRooms" | "busy";

/** Ce que la sauvegarde lit et change du moteur (satisfait par `GameControl`, qui reçoit les services du moteur). */
export interface SaveSource {
  readonly vars: ScriptVars;
  readonly compacts: Compacts;
  readonly items: ItemCache;
  readonly mouse: Mouse;
  readonly system: SystemVars;
  readonly sound: BassSound;
  readonly text: BassText;
  readonly rng: { readonly state: number; seed(state: number): void };
  readonly logic: Logic;
  /** Mots des compacts tels que `sky.cpt` les donne (`SkyCpt.raw`). */
  readonly pristine: Uint16Array;
}

/** Aspect du curseur du jeu : numéro (`_currentCursor`), point chaud et objet tenu. */
export interface CursorState {
  cursor: number;
  hotspot: readonly [number, number];
  objectCursor: number;
}

/**
 * Curseur et police du jeu, que le panneau de contrôle remplace pendant qu'il est ouvert (`_savedMouse`, `_savedCharSet`) : à la
 * sauvegarde ce sont ceux d'avant l'ouverture, à la restitution ceux à remettre en sortant. Écart : ScummVM ne garde que le numéro du
 * curseur (`spriteMouse(_savedMouse, 0, 0)`) ; ici le point chaud et l'objet tenu reviennent aussi.
 */
export interface SaveContext {
  mouseType: number;
  charSet: number;
  cursor: CursorState;
}

/** Curseur courant de la souris. */
export function cursorOf(mouse: Mouse): CursorState {
  return { cursor: mouse.cursor, hotspot: [mouse.cursorHotspot[0], mouse.cursorHotspot[1]], objectCursor: mouse.objectCursor };
}

/** Effets sonores sauvegardés : `BassAudio.sfx` (les services sans effets, `SilentSound`, n'en ont pas). */
interface SfxSaving {
  readonly savedSounds: readonly [number, number];
  restoreState(saved: readonly [number, number]): void;
}

function sfxOf(sound: BassSound): SfxSaving | null {
  const sfx = (sound as unknown as { sfx?: SfxSaving }).sfx;
  return sfx && typeof sfx.restoreState === "function" ? sfx : null;
}

/** Police en cours du service de texte (`BassTextManager.font`), 0 sans service. */
export function currentFont(text: BassText): number {
  return (text as unknown as { font?: number }).font ?? 0;
}

/** `Control::loadSaveAllowed` : pourquoi on ne peut pas sauvegarder ni restituer maintenant, ou `null`. */
export function saveRefusal(source: Pick<SaveSource, "vars" | "system">): SaveRefusal | null {
  if (source.system.systemFlags & SF.CHOOSING) return "choosing";
  const screen = source.vars[Var.SCREEN]!;
  if (screen >= 101) return "linc";
  if (screen >= 82 && screen !== 85 && screen < 90) return "finalRooms";
  return null;
}

// --- Compacts hors de `saveIds` ---

const savedMasks = new WeakMap<Compacts, Uint8Array>();

/** Mots de `raw` que `saveIds` couvre (1) ou non (0). */
function savedMask(compacts: Compacts): Uint8Array {
  let mask = savedMasks.get(compacts);
  if (!mask) {
    mask = new Uint8Array(compacts.raw.length);
    for (const id of compacts.saveIds) {
      const view = compacts.require(id);
      const start = (view.byteOffset - compacts.raw.byteOffset) / 2;
      mask.fill(1, start, start + compacts.info(id).size);
    }
    savedMasks.set(compacts, mask);
  }
  return mask;
}

/** Les mots hors de `saveIds` qui ne sont plus ceux de `sky.cpt` : paires (position, valeur). */
export function unsavedDelta(compacts: Compacts, pristine: Uint16Array): number[] {
  const mask = savedMask(compacts);
  const out: number[] = [];
  for (let i = 0; i < compacts.raw.length; i++) if (!mask[i] && compacts.raw[i] !== pristine[i]) out.push(i, compacts.raw[i]!);
  return out;
}

/** Remet tous les mots hors de `saveIds` à ceux de `sky.cpt`, puis y applique `delta` : aucun état résiduel d'une partie précédente. */
export function resetUnsaved(compacts: Compacts, pristine: Uint16Array, delta: readonly number[] = []): void {
  const mask = savedMask(compacts);
  for (let i = 0; i < compacts.raw.length; i++) if (!mask[i]) compacts.raw[i] = pristine[i]!;
  for (let i = 0; i + 1 < delta.length; i += 2) compacts.raw[delta[i]!] = delta[i + 1]!;
}

// --- base64 ---

function toBase64(words: Uint16Array): string {
  const bytes = new Uint8Array(words.length * 2);
  for (let i = 0; i < words.length; i++) {
    bytes[i * 2] = words[i]! & 0xff;
    bytes[i * 2 + 1] = words[i]! >> 8;
  }
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Les mots de `data`, ou `null` si la valeur n'est pas du base64 d'un nombre pair d'octets. */
function fromBase64(text: string): Uint16Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  if (binary.length % 2) return null;
  const words = new Uint16Array(binary.length / 2);
  for (let i = 0; i < words.length; i++) words[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
  return words;
}

// --- Capture ---

/** `Control::prepareSaveData` : l'état de la partie, sans vérifier qu'on peut la sauvegarder (`saveRefusal`, `GameControl.capture`). */
export function captureSave(source: SaveSource, context: SaveContext): SaveData {
  const sfx = sfxOf(source.sound);
  const mouse = source.mouse;
  const words = writeSaveWords({
    gameVersion: source.system.gameVersion,
    sounds: sfx?.savedSounds ?? [NO_SAVED_SOUND, NO_SAVED_SOUND],
    music: source.system.currentMusic,
    charSet: context.charSet,
    mouseType: context.mouseType,
    palette: source.system.currentPalette,
    vars: source.vars,
    reloadList: source.items.loadedList(),
    compactWords: source.compacts.saveState(),
  });
  return {
    version: SAVE_VERSION,
    section: source.vars[Var.CUR_SECTION]!,
    data: toBase64(words),
    extra: {
      rng: source.rng.state,
      mouse: { x: mouse.x, y: mouse.y, cursor: context.cursor.cursor, hotspot: [context.cursor.hotspot[0], context.cursor.hotspot[1]], objectCursor: context.cursor.objectCursor },
      mouseLocked: (source.system.systemFlags & SF.MOUSE_LOCKED) !== 0,
      unsaved: unsavedDelta(source.compacts, source.pristine),
    },
  };
}

// --- Lecture (validation) ---

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/**
 * Valide la valeur lue dans un emplacement (`SaveSlots.parse`) : la sauvegarde, ou `null` si elle est illisible ou d'une autre version.
 * La taille des compacts ne se vérifie qu'à la restitution (`restoreSave`, avant toute modification du moteur).
 */
export function parseSave(value: unknown): SaveData | null {
  if (value === null || typeof value !== "object") return null;
  const save = value as Partial<SaveData>;
  if (save.version !== SAVE_VERSION || !isInt(save.section) || typeof save.data !== "string") return null;
  const extra = save.extra;
  if (!extra || !isInt(extra.rng) || typeof extra.mouseLocked !== "boolean") return null;
  if (!Array.isArray(extra.unsaved) || extra.unsaved.length % 2 || !extra.unsaved.every(isInt)) return null;
  const mouse = extra.mouse;
  if (!mouse || !isInt(mouse.x) || !isInt(mouse.y) || !isInt(mouse.cursor) || !isInt(mouse.objectCursor)) return null;
  if (!Array.isArray(mouse.hotspot) || mouse.hotspot.length !== 2 || !mouse.hotspot.every(isInt)) return null;
  const words = fromBase64(save.data);
  if (!words || words.length < 4) return null;
  return value as SaveData;
}

// --- Restitution ---

/**
 * `Control::parseSaveData` + `Logic::parseSaveData` sur des données déjà lues : l'état du moteur devient celui de `data`. Sert à
 * « Recommencer » (données de remise à zéro de `sky.cpt`, sans `extra`) comme aux restitutions.
 * Rend le curseur et la police à remettre en sortant du panneau (`_savedMouse`, `_savedCharSet`).
 */
export function applySaveWords(source: SaveSource, words: Uint16Array): SaveContext {
  const data = parseSaveWords(words, source.compacts.saveWords);
  source.system.systemFlags |= SF.GAME_RESTORED;
  sfxOf(source.sound)?.restoreState(data.header.sounds); // `restoreSfx` avant le changement de section
  fnLeaveSection(source.logic, source.vars[Var.CUR_SECTION]!, 0, 0);
  source.vars.set(data.vars);
  enterSection(source.logic, source.vars[Var.CUR_SECTION]!);
  source.compacts.loadSaveWords(data.compactWords, 0);
  for (let id = Cpt.TEXT_1; id <= Cpt.TEXT_11; id++) source.compacts.require(id)[F.status] = 0;
  source.items.refreshFilesList(data.reloadList);
  source.system.currentMusic = data.header.music & 0xffff;
  if (!(source.system.systemFlags & SF.MUS_OFF)) source.sound.startMusic(data.header.music & 0xffff);
  source.system.currentPalette = data.header.palette;
  source.system.pastIntro = true;
  const mouseType = data.header.mouseType & 0xffff;
  return { mouseType, charSet: data.header.charSet, cursor: { cursor: mouseType, hotspot: [0, 0], objectCursor: -1 } };
}

/** Les mots de la sauvegarde si elle est lisible pour ce jeu (révision, tailles), sans rien modifier ; sinon `null`. */
export function validateSave(compacts: Pick<Compacts, "saveWords">, save: SaveData): Uint16Array | null {
  const words = fromBase64(save.data);
  if (!words) return null;
  try {
    parseSaveWords(words, compacts.saveWords);
  } catch {
    return null;
  }
  return words;
}

/**
 * Restitue une sauvegarde du site. `null` (sans rien changer) si les données ne sont pas lisibles pour ce jeu ; sinon le curseur et la
 * police à remettre, ce que fait `GameControl` (palette, curseur, police) en sortant du panneau.
 */
export function restoreSave(source: SaveSource, save: SaveData): SaveContext | null {
  const words = validateSave(source.compacts, save);
  if (!words) return null;
  const { rng, mouse, mouseLocked, unsaved } = save.extra;
  for (let i = 0; i < unsaved.length; i += 2) if (unsaved[i]! < 0 || unsaved[i]! >= source.compacts.raw.length) return null;
  resetUnsaved(source.compacts, source.pristine, unsaved);
  const context = applySaveWords(source, words);
  source.rng.seed(rng);
  source.mouse.moved(mouse.x, mouse.y);
  context.cursor = { cursor: mouse.cursor, hotspot: [mouse.hotspot[0], mouse.hotspot[1]], objectCursor: mouse.objectCursor };
  if (mouseLocked) source.system.systemFlags |= SF.MOUSE_LOCKED;
  else source.system.systemFlags &= ~SF.MOUSE_LOCKED;
  return context;
}
