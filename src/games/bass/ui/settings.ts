import type { BassSettings } from "../engine/host";
import type { TextVoiceMode } from "../engine/text";

/**
 * Réglages du panneau de contrôle mémorisés dans le stockage du site (`BassHost.settingsChanged`, remis par `GameControl.applySettings`
 * au démarrage) : volume de la musique, vitesse du jeu, effets, mode texte et voix. Valeur absente, illisible ou hors bornes : ignorée,
 * champ par champ (le moteur garde alors son réglage d'origine : texte + voix, vitesse 80).
 */
export const SETTINGS_KEY = "retrovibe:bass:settings";

export interface SettingsStore {
  get(key: string): string | null;
  set(key: string, value: string): unknown;
}

const TEXT_MODES: readonly TextVoiceMode[] = ["text", "voice", "both"];

const integerIn = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Les champs lisibles d'une valeur stockée ; `null` si rien n'est exploitable. */
export function parseSettings(raw: string | null): Partial<BassSettings> | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const settings: Partial<BassSettings> = {};
  if (integerIn(record.musicVolume, 0, 127)) settings.musicVolume = record.musicVolume;
  if (integerIn(record.gameSpeed, 2, 134)) settings.gameSpeed = record.gameSpeed;
  if (typeof record.fxOff === "boolean") settings.fxOff = record.fxOff;
  if (TEXT_MODES.includes(record.textMode as TextVoiceMode)) settings.textMode = record.textMode as TextVoiceMode;
  return Object.keys(settings).length > 0 ? settings : null;
}

export function readSettings(store: SettingsStore): Partial<BassSettings> | null {
  try {
    return parseSettings(store.get(SETTINGS_KEY));
  } catch {
    return null;
  }
}

/** Mémorise les réglages ; un stockage plein ou bloqué n'empêche pas de jouer. */
export function writeSettings(store: SettingsStore, settings: BassSettings): void {
  try {
    store.set(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // stockage indisponible : les réglages ne survivront pas au rechargement
  }
}
