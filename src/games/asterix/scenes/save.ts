import type { HostStorage } from "../../../engine/infogrames/host";
import { OBJECT_COUNT, SQUARE_COUNT } from "../data/exe";
import type { GameState, SavedSetup } from "../game/state";

/**
 * Sauvegarde de la partie en cours (décision D6 : adaptation web, l'original n'en a pas). Elle est écrite au début de
 * chaque tour, jamais au milieu d'une case ou d'un mini-jeu, et effacée en fin de partie et au lancement d'une nouvelle.
 * Une partie interrompue se reprend au début du tour où elle s'est arrêtée (« Continuer » sur l'écran de présentation).
 * Les mémoires de séance (décision D13) n'y sont pas : elles repartent de zéro au rechargement de la page.
 */

/** Clé du stockage du navigateur (préfixe `asterix:` du jeu sous celui du site). */
export const SAVE_KEY = "retrovibe:asterix:game";
/** Version du format ; toute autre valeur est ignorée et effacée. À incrémenter si le format change. */
export const SAVE_VERSION = 1;

export interface GameSave {
  version: typeof SAVE_VERSION;
  /** État de la partie au début du tour du joueur `state.current`. */
  state: GameState;
  /** État du générateur aléatoire au même instant : la reprise refait les mêmes tirages. */
  rng: number;
  /** Temps de partie écoulé (chrono 1), en centièmes de seconde. */
  elapsed: number;
  /** Configuration de départ, pour que REJOUER fonctionne après une reprise. */
  setup: SavedSetup;
}

export function writeSave(storage: HostStorage, save: GameSave): void {
  // Stockage plein ou bloqué : la partie continue sans sauvegarde.
  storage.set(SAVE_KEY, JSON.stringify(save));
}

export function clearSave(storage: HostStorage): void {
  storage.remove(SAVE_KEY);
}

/** Sauvegarde valide, ou `null`. Une sauvegarde illisible, d'une autre version ou incohérente est effacée. */
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
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function validPlayer(p: unknown): boolean {
  return (
    isObject(p) &&
    isInt(p.character, 0, 5) &&
    isInt(p.reflexion, 0, 2) &&
    isInt(p.action, 0, 2) &&
    isInt(p.pos, 0, SQUARE_COUNT - 1) &&
    isInt(p.objectCount, 0, OBJECT_COUNT) &&
    Array.isArray(p.objects) &&
    p.objects.length === OBJECT_COUNT &&
    p.objects.every(isBool) &&
    isInt(p.sesterces, 0, 99) &&
    // Le vol de potion de Détritus ne revérifie pas les bornes : −1 et 6 existent dans l'original.
    Number.isInteger(p.gourds) &&
    isBool(p.inPrison)
  );
}

function validSetup(s: unknown): s is SavedSetup {
  return (
    isObject(s) &&
    Array.isArray(s.players) &&
    s.players.length >= 1 &&
    s.players.length <= 4 &&
    s.players.every((p) => isObject(p) && isInt(p.character, 0, 5) && isInt(p.reflexion, 0, 2) && isInt(p.action, 0, 2)) &&
    isInt(s.duration, 1) &&
    isInt(s.objectsRequired, 1, OBJECT_COUNT)
  );
}

function validState(s: unknown): s is GameState {
  if (!isObject(s) || !Array.isArray(s.players)) return false;
  const count = s.players.length;
  return (
    count >= 1 &&
    count <= 4 &&
    s.players.every(validPlayer) &&
    isInt(s.current, 0, count - 1) &&
    isInt(s.round, 1) &&
    isInt(s.duration, 1) &&
    isInt(s.objectsRequired, 1, OBJECT_COUNT) &&
    isInt(s.die, 1, 6) &&
    isInt(s.elapsedRead) &&
    isInt(s.topRow, 0, 17) &&
    isInt(s.bettor, -1, count - 1) &&
    isInt(s.bet, 0, 5) &&
    isInt(s.winner, 0, 3) &&
    s.quit === false &&
    s.victory === false &&
    s.over === false &&
    isBool(s.abandoned) &&
    isBool(s.lastRound) &&
    isBool(s.beforeFirstRound) &&
    isBool(s.replay) &&
    isBool(s.intro)
  );
}

/** Vérifie la forme d'une sauvegarde lue ; `null` si elle n'est pas reprenable. */
export function parseSave(value: unknown): GameSave | null {
  if (!isObject(value) || value.version !== SAVE_VERSION) return null;
  if (!validState(value.state) || !isInt(value.rng, 0, 0xffffffff) || !isInt(value.elapsed) || !validSetup(value.setup)) return null;
  return value as unknown as GameSave;
}
