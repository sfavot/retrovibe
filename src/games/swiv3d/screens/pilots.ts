/**
 * Pilotes et réglages enregistrés (docs/swiv3d/screens.md §4.2 et §7). L'original garde des fiches dans `swiv.cfg` ; le port met un objet
 * JSON par pilote dans `localStorage` (via `prefixedStorage(…, "swiv3d:")`) : `pilot:<n>` pour chaque pilote (n de 0 à 9) et `global`.
 */
import { decodeCp437, encodeCp437 } from "../../../data/cp437";
import type { HostStorage } from "../../../engine/storage";

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

  /** Crée un pilote dans la première case libre ; `null` si le nom est vide ou si les 10 cases sont prises. */
  create(name: string, language: Language, music: 0 | 1 | 2 = 0): Pilot | null {
    const clean = cleanName(name);
    if (clean === "") return null;
    for (let slot = 0; slot < PILOT_LIMIT; slot++) {
      if (this.get(slot)) continue;
      const pilot: Pilot = { slot, name: clean, language, bestMission: 0, music, playSeconds: 0 };
      return this.save(pilot) ? pilot : null;
    }
    return null;
  }

  /** Enregistre la fiche (au changement de mission, de langue, de musique, à la fin d'un niveau). Faux si l'écriture échoue. */
  save(pilot: Pilot): boolean {
    const { name, language, bestMission, music, playSeconds } = pilot;
    return this.storage.set(this.key(pilot.slot), JSON.stringify({ name, language, bestMission, music, playSeconds }));
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
