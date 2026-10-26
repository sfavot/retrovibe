/**
 * Pilotes et réglages enregistrés (docs/swiv3d/screens.md §4.2 et §7). L'original garde des fiches dans `swiv.cfg` ; le port met un objet
 * JSON par pilote dans `localStorage` (via `prefixedStorage(…, "swiv3d:")`) : `pilot:<n>` pour chaque pilote (n de 0 à 9) et `global`.
 */
import { decodeCp437, encodeCp437 } from "../../../data/cp437";
import type { HostStorage } from "../../../engine/storage";
import { parseProfile, type ControllerProfile } from "./controllers";

/** Pilotes au plus (numéros 0 à 9). */
export const PILOT_LIMIT = 10;
/** Caractères au plus dans un nom. */
export const NAME_MAX = 15;
/** Valeur de « meilleure mission » d'une aventure terminée (`0xb4c69`). */
export const ADVENTURE_COMPLETED = 0xb4c69;

/** Langue du jeu : indice du groupe de chaînes de `GLOBAL.BD` (0 anglais, 1 français). */
export type Language = 0 | 1;
export const LANGUAGES: readonly Language[] = [1, 0];
export const DEFAULT_LANGUAGE: Language = 1;

/**
 * État d'arrivée dans une mission (fiche `(0x14, pilote, 1000 + n)`, `screens.md` §7) : les 20 munitions, le score (`+0x34`), le véhicule
 * (`+0x38`), l'énergie (`+0x3c`) et le niveau du canon (`+0x40`). « Rejouer la mission n » repart de cet état.
 */
export interface MissionState {
  ammo: number[];
  score: number;
  form: number;
  energy: number;
  cannonPower: number;
}

/** Niveaux de correction gamma (`6/10`..`6/13`). */
export const GAMMA_LEVELS = 4;

/** Nombre d'armes spéciales (munitions de l'état de mission). */
export const AMMO_SLOTS = 20;

export interface Pilot {
  /** Numéro de la case, 0 à 9. */
  slot: number;
  name: string;
  language: Language;
  /** Meilleure mission atteinte (`fiche +0x20`) : celle qui a été *démarrée* ; `ADVENTURE_COMPLETED` = terminée. */
  bestMission: number;
  /** Préférence musicale : 0 SWIV, 1 Classique, 2 Divers (`fiche +0x24`). */
  music: 0 | 1 | 2;
  /** Temps de jeu total en secondes (`fiche +0x2c`). */
  playSeconds: number;
  /** Correction gamma, 0 (aucune) à 3 (haute) (`fiche +0x30`). */
  gamma: number;
  /** Mode test débloqué par le nom `SWIV!AndLetDie` (`fiche +0x28 > 0`) : « Entrez le mode test niveau », menu Tricher. */
  testMode: boolean;
  /** Profil de contrôleur (fiche `(0x14, pilote, 2)`) ; `null` = type 0, non configuré : le menu de choix du type s'ouvre. */
  controller: ControllerProfile | null;
  /** États d'arrivée par mission (fiches `1000 + n`), écrits au passage d'une mission accomplie à la suivante. */
  states: Record<number, MissionState>;
}

export interface Volumes {
  master: number;
  /** « Volume du CD » : la musique. */
  music: number;
  effects: number;
}

export interface GlobalSettings {
  /** Langue des nouveaux pilotes et du premier écran. */
  language: Language;
  volumes: Volumes;
  /** Dernier pilote choisi, sélectionné d'office dans la liste. */
  lastPilot: number | null;
}

export const DEFAULT_VOLUMES: Volumes = { master: 255, music: 255, effects: 255 };

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;

/** Un caractère de nom : imprimable de la page de code 437 (lettres accentuées comprises), pas de contrôle. */
export function isNameChar(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = encodeCp437(ch)[0]!;
  if (code === 0x3f && ch !== "?") return false;
  if (code < 0x20 || code === 0x7f) return false;
  // Un octet haut n'est accepté que s'il redonne le même caractère et que c'est une lettre.
  if (code >= 0x80) return decodeCp437(Uint8Array.of(code)) === ch && /\p{L}/u.test(ch);
  return true;
}

/** Nom propre : espaces de bord retirés, caractères invalides ôtés, 15 caractères au plus. Chaîne vide si rien ne reste. */
export function cleanName(name: string): string {
  return [...name].filter(isNameChar).join("").trim().slice(0, NAME_MAX);
}

function parseState(raw: unknown): MissionState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const ammo = Array.isArray(o.ammo) ? o.ammo : [];
  return {
    ammo: Array.from({ length: AMMO_SLOTS }, (_, k) => clamp(ammo[k], 0, 65535, 0)),
    score: clamp(o.score, 0, 1e9, 0),
    form: clamp(o.form, 0, 5, 0),
    energy: clamp(o.energy, 1, 992, 496),
    cannonPower: clamp(o.cannonPower, 0, 19, 0),
  };
}

function parseStates(raw: unknown): Record<number, MissionState> {
  const states: Record<number, MissionState> = {};
  if (typeof raw !== "object" || raw === null) return states;
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(key);
    const state = parseState(value);
    if (Number.isInteger(n) && n >= 0 && n < 1000 && state) states[n] = state;
  }
  return states;
}

function parsePilot(slot: number, raw: string | null): Pilot | null {
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof o.name === "string" ? cleanName(o.name) : "";
    if (name === "") return null;
    return {
      slot,
      name,
      language: o.language === 0 ? 0 : 1,
      bestMission: clamp(o.bestMission, 0, ADVENTURE_COMPLETED, 0),
      music: clamp(o.music, 0, 2, 0) as 0 | 1 | 2,
      playSeconds: clamp(o.playSeconds, 0, 1e9, 0),
      gamma: clamp(o.gamma, 0, GAMMA_LEVELS - 1, 0),
      testMode: o.testMode === true,
      controller: parseProfile(o.controller),
      states: parseStates(o.states),
    };
  } catch {
    return null;
  }
}

export class PilotStore {
  constructor(private readonly storage: HostStorage) {}

  private key = (slot: number): string => `pilot:${slot}`;

  /** Les pilotes existants, par numéro de case. */
  list(): Pilot[] {
    const pilots: Pilot[] = [];
    for (let slot = 0; slot < PILOT_LIMIT; slot++) {
      const pilot = parsePilot(slot, this.storage.get(this.key(slot)));
      if (pilot) pilots.push(pilot);
    }
    return pilots;
  }

  get(slot: number): Pilot | null {
    return slot >= 0 && slot < PILOT_LIMIT ? parsePilot(slot, this.storage.get(this.key(slot))) : null;
  }

  /**
   * Crée un pilote dans la première case libre ; `null` si le nom est vide ou si les 10 cases sont prises. `testMode` : la fiche a reçu
   * `+0x28 = 1` par le code `SWIV!AndLetDie` avant la saisie du nom. Le contrôleur n'est pas configuré (fiche 2 neuve, type 0).
   */
  create(name: string, language: Language, music: 0 | 1 | 2 = 0, testMode = false): Pilot | null {
    const clean = cleanName(name);
    if (clean === "") return null;
    for (let slot = 0; slot < PILOT_LIMIT; slot++) {
      if (this.get(slot)) continue;
      const pilot: Pilot = { slot, name: clean, language, bestMission: 0, music, playSeconds: 0, gamma: 0, testMode, controller: null, states: {} };
      return this.save(pilot) ? pilot : null;
    }
    return null;
  }

  /** Enregistre la fiche (au changement de mission, de réglage, de commandes, à la fin d'un niveau). Faux si l'écriture échoue. */
  save(pilot: Pilot): boolean {
    const { name, language, bestMission, music, playSeconds, gamma, testMode, controller, states } = pilot;
    return this.storage.set(this.key(pilot.slot), JSON.stringify({ name, language, bestMission, music, playSeconds, gamma, testMode, controller, states }));
  }

  remove(slot: number): void {
    this.storage.remove(this.key(slot));
  }

  loadGlobal(): GlobalSettings {
    const settings: GlobalSettings = { language: DEFAULT_LANGUAGE, volumes: { ...DEFAULT_VOLUMES }, lastPilot: null };
    try {
      const raw = this.storage.get("global");
      if (raw === null) return settings;
      const o = JSON.parse(raw) as Record<string, any>;
      settings.language = o.language === 0 ? 0 : 1;
      const v = (o.volumes ?? {}) as Record<string, unknown>;
      settings.volumes = {
        master: clamp(v.master, 0, 255, 255),
        music: clamp(v.music, 0, 255, 255),
        effects: clamp(v.effects, 0, 255, 255),
      };
      settings.lastPilot = typeof o.lastPilot === "number" && o.lastPilot >= 0 && o.lastPilot < PILOT_LIMIT ? o.lastPilot : null;
    } catch {
      // fiche illisible : valeurs par défaut
    }
    return settings;
  }

  saveGlobal(settings: GlobalSettings): boolean {
    return this.storage.set("global", JSON.stringify(settings));
  }
}
