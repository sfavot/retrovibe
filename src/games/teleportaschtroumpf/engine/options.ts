import type { HostStorage } from "./host";

/**
 * Options parents (S04, engine.md §6.3 et §9.10), qui remplacent `c:\smurf.cfg` : durée de la partie,
 * pause avant de pouvoir rejouer, message de fin, et date de la fin de la dernière partie.
 */
export interface ParentOptions {
  /** 0 à 3 : durée de la partie = `(index + 1) × 1800` s (30, 60, 90, 120 min). */
  durationIndex: number;
  /** 0 à 4 : pause avant de pouvoir rejouer = `index × 30` min. */
  pauseIndex: number;
  /** 0 à 8 : message de fin parmi 9 (vidéos `s42a041..076`). */
  messageIndex: number;
  /** Fin de la dernière partie, en minutes Unix (`time(NULL) / 60`) ; 0 si jamais. */
  lastGameMinutes: number;
}

export const STORAGE_KEY = "retrovibe:teleportaschtroumpf:options";

const MAX = { durationIndex: 3, pauseIndex: 4, messageIndex: 8 } as const;

export const DEFAULT_OPTIONS: Readonly<ParentOptions> = { durationIndex: 0, pauseIndex: 0, messageIndex: 0, lastGameMinutes: 0 };

function clampIndex(value: unknown, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.trunc(value))) : 0;
}

/** Durée de la partie en secondes (`DS:6EA4`). */
export function gameSeconds(options: ParentOptions): number {
  return (options.durationIndex + 1) * 1800;
}

/** Pause obligatoire entre deux parties, en minutes (`d300 × 30`). */
export function pauseMinutes(options: ParentOptions): number {
  return options.pauseIndex * 30;
}

/**
 * Verrou parental (`21ee:1d6b`) : vrai si la pause n'est pas écoulée depuis la fin de la dernière partie.
 * Jamais verrouillé avec une pause de 0 ou sans partie jouée.
 */
export function isLocked(options: ParentOptions, nowMinutes: number): boolean {
  return nowMinutes - options.lastGameMinutes < pauseMinutes(options);
}

/** Lit les options (valeurs bornées ; tout vaut 0 à défaut de données valides) depuis le stockage de l'hôte. */
export function loadOptions(storage: HostStorage): ParentOptions {
  const raw = storage.get(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_OPTIONS };
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof ParentOptions, unknown>>;
    const last = data.lastGameMinutes;
    return {
      durationIndex: clampIndex(data.durationIndex, MAX.durationIndex),
      pauseIndex: clampIndex(data.pauseIndex, MAX.pauseIndex),
      messageIndex: clampIndex(data.messageIndex, MAX.messageIndex),
      lastGameMinutes: typeof last === "number" && Number.isFinite(last) && last > 0 ? Math.trunc(last) : 0,
    };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

/** Écrit les options ; renvoie faux si le stockage refuse. */
export function saveOptions(storage: HostStorage, options: ParentOptions): boolean {
  return storage.set(STORAGE_KEY, JSON.stringify(options));
}
