import type { BorlandRandom } from "../engine/rng";
import type { HostStorage } from "../engine/host";
import type { Game } from "../game/rules";
import type { GameState } from "../game/state";
import type { CommentarySnapshot } from "./grand-schtroumpf/commentary";

/**
 * Sauvegarde de la partie en cours (adaptation web : l'original n'en a pas). Une partie interrompue (onglet fermé, retour à
 * l'accueil) se reprend au début du tour où elle s'est arrêtée. Un seul emplacement, dans le stockage local ; il est écrit
 * au début de chaque tour (`scenes/game.ts`, jamais au milieu d'un mini-jeu ou d'un événement) et effacé en fin de partie et au
 * lancement d'une nouvelle.
 */

/** Clé du stockage local. */
export const SAVE_KEY = "retrovibe:teleportaschtroumpf:game";
/** Version du format ; toute autre valeur est ignorée (et la sauvegarde effacée). À incrémenter si le format change. */
export const SAVE_VERSION = 1;

/** Tout ce qu'il faut pour reprendre au début d'un tour : JSON pur. */
export interface GameSave {
  version: typeof SAVE_VERSION;
  /** État de `Game` au début du tour du joueur `state.current` (temps de partie compris : `state.elapsed`). */
  state: GameState;
  /** État du générateur aléatoire (`BorlandRandom.current`) au même instant. */
  rng: number;
  /** Mémoire des répliques du Grand Schtroumpf. */
  commentary: CommentarySnapshot;
  /** Les ingrédients (S19) ont déjà été dits. */
  introShown: boolean;
  /** Avertissement de temps annoncé pour ce tour (numéro de vidéo), `null` sinon. */
  warning: number | null;
}

/** Ce que la scène de partie fournit en plus de `Game` et du générateur. */
export type SaveExtras = Pick<GameSave, "commentary" | "introShown" | "warning">;

/** Capture la partie. L'état est copié : la sauvegarde ne bouge plus quand la partie continue. */
export function captureSave(game: Game, rng: BorlandRandom, extras: SaveExtras): GameSave {
  const state = structuredClone(game.state);
  // Le gel du chrono du tour est celui de l'annonce de début de tour, que la reprise rejoue.
  state.paused = false;
  return { version: SAVE_VERSION, state, rng: rng.current, ...extras };
}

export function writeSave(storage: HostStorage, save: GameSave): void {
  // Stockage plein ou bloqué : la partie continue sans sauvegarde.
  storage.set(SAVE_KEY, JSON.stringify(save));
}

/** Efface la sauvegarde. */
export function clearSave(storage: HostStorage): void {
  storage.remove(SAVE_KEY);
}

/**
 * Sauvegarde valide, ou `null` s'il n'y en a pas. Une sauvegarde illisible, d'une autre version ou incohérente est
 * ignorée et effacée.
 */
export function readSave(storage: HostStorage): GameSave | null {
  const raw = storage.get(SAVE_KEY);
  if (!raw) return null;
  let save: GameSave | null = null;
  try {
    save = parseSave(JSON.parse(raw));
  } catch {
    // JSON illisible
  }
  if (!save) clearSave(storage);
  return save;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validPlayer(p: unknown): boolean {
  return (
    isObject(p) &&
    isInt(p.character, 0, 5) &&
    isInt(p.level, 0, 2) &&
    isInt(p.x, 0, 0x13f) &&
    (p.row === "top" || p.row === "bottom") &&
    isInt(p.screen, 1, 9) &&
    isInt(p.ingredients, 0, 0xff) &&
    isInt(p.ingredientCount, 0, 8) &&
    isInt(p.points, 0, 60) &&
    isInt(p.status, 0, 6) &&
    typeof p.facingRight === "boolean"
  );
}

function validState(s: unknown): s is GameState {
  if (!isObject(s) || !Array.isArray(s.players)) return false;
  const { players } = s;
  return (
    players.length >= 1 &&
    players.length <= 4 &&
    players.every(validPlayer) &&
    isInt(s.durationSeconds, 1) &&
    isInt(s.messageIndex, 0, 8) &&
    isInt(s.current, 0, players.length - 1) &&
    isInt(s.round, 1) &&
    isNumber(s.elapsed) &&
    s.elapsed >= 0 &&
    s.elapsed < (s.durationSeconds as number) &&
    isObject(s.goal) &&
    isInt(s.goal.ingredients, 0, 0xff) &&
    isInt(s.goal.points, 1) &&
    s.phase === "turn" &&
    isObject(s.turn) &&
    Array.isArray(s.turn.inside) &&
    isNumber(s.turn.elapsed) &&
    s.pending === null &&
    s.result === null &&
    isInt(s.bonusTag, 0) &&
    isInt(s.iceCrossings, 0) &&
    isInt(s.bridgeCrossings, 0) &&
    typeof s.warned10 === "boolean" &&
    typeof s.warned5 === "boolean"
  );
}

function validCommentary(c: unknown): c is CommentarySnapshot {
  return isObject(c) && Array.isArray(c.said) && c.said.every((n) => isInt(n)) && isInt(c.lastProgressRound) && isInt(c.lastCommentRound);
}

/** Vérifie la forme d'une sauvegarde lue ; `null` si elle n'est pas reprenable. */
export function parseSave(value: unknown): GameSave | null {
  if (!isObject(value) || value.version !== SAVE_VERSION) return null;
  if (!validState(value.state) || !isInt(value.rng, 0, 0xffffffff) || !validCommentary(value.commentary)) return null;
  if (typeof value.introShown !== "boolean" || !(value.warning === null || isInt(value.warning))) return null;
  return value as unknown as GameSave;
}
