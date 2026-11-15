import { MAX_HEALTH } from "../engine/game";

/** Couleurs du moniteur de santé d'origine (RVB pur). */
export const HEALTH_COLORS = {
  green: "rgb(0, 255, 0)",
  yellow: "rgb(255, 255, 0)",
  red: "rgb(255, 0, 0)",
  black: "rgb(0, 0, 0)",
} as const;

export interface HealthPie {
  /** Couleur du disque. */
  base: string;
  /** Couleur du secteur qui grandit par-dessus, dans le sens horaire à partir de 12 h. */
  cover: string;
  /** Ouverture du secteur en degrés (0 : disque uni, 360 : tout recouvert). */
  angle: number;
}

/** Les trois paliers : vert → jaune, jaune → rouge, rouge → noir (un tiers de la santé maximale chacun). */
const TIERS = [
  { base: HEALTH_COLORS.green, cover: HEALTH_COLORS.yellow },
  { base: HEALTH_COLORS.yellow, cover: HEALTH_COLORS.red },
  { base: HEALTH_COLORS.red, cover: HEALTH_COLORS.black },
] as const;

/** Santé pleine : disque vert. À chaque tiers perdu, une nouvelle couleur recouvre l'ancienne, de 12 h dans le sens horaire. */
export function healthPie(health: number, max = MAX_HEALTH): HealthPie {
  const lost = 3 * (1 - Math.max(0, Math.min(max, health)) / max);
  const tier = Math.min(TIERS.length - 1, Math.floor(lost));
  return { ...TIERS[tier], angle: Math.round((lost - tier) * 360 * 100) / 100 };
}

/** Fond CSS du disque pour un état de santé donné. */
export function healthGradient(pie: HealthPie): string {
  return `conic-gradient(${pie.cover} 0deg ${pie.angle}deg, ${pie.base} ${pie.angle}deg 360deg)`;
}
