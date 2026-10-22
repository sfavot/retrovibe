import { storage } from "./storage";

/** Durée d'un tick du jeu (ms), comme l'intervalle du SetTimer de l'original (DESKADV.INI : GameSpeed). */
export const GAME_SPEED = { min: 95, default: 140, max: 185 } as const;

/** Les trois crans proposés : Rapide ≈ 96 ms, Normale = 140 ms, Lente = 185 ms. */
export const SPEED_PRESETS = [96, 140, 185] as const;

const KEY = "indy-desktop-speed";

/** Ramène une valeur quelconque dans [95, 185] ; une valeur invalide donne la vitesse par défaut. */
export function clampSpeed(ms: number): number {
  if (!Number.isFinite(ms)) return GAME_SPEED.default;
  return Math.min(GAME_SPEED.max, Math.max(GAME_SPEED.min, Math.round(ms)));
}

/** Cran proposé le plus proche d'une durée de tick (borne comprise). */
export function nearestPreset(ms: number): number {
  const value = clampSpeed(ms);
  return SPEED_PRESETS.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best));
}

/** Cran suivant (Rapide → Normale → Lente → Rapide), pour le bouton de la barre latérale. */
export function nextPreset(ms: number): number {
  const i = SPEED_PRESETS.indexOf(nearestPreset(ms) as (typeof SPEED_PRESETS)[number]);
  return SPEED_PRESETS[(i + 1) % SPEED_PRESETS.length];
}

/** Réglage mémorisé localement. Le stockage peut être indisponible : on échoue sans bruit. */
export const speedSetting = {
  read(): number {
    const raw = storage.get(KEY);
    return raw === null ? GAME_SPEED.default : nearestPreset(Number(raw));
  },
  write(ms: number): void {
    // stockage plein ou bloqué : le réglage vaut pour la session seulement
    storage.set(KEY, String(nearestPreset(ms)));
  },
};
