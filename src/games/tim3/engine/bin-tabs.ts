/**
 * Onglets du bac au Labo (TIMWIN.EXE, fenêtre du bac de la version Windows) :
 *
 * - 4184e0 / 4186c5 : en mode Labo (`[0x477988]` = 1), la barre de titre du bac porte 14 onglets de 30 px (fond 0x1D choisi,
 *   0x1E sinon, icône 2 × onglet + 0 (choisi) ou + 1 de `WPARTBIN.BMP`), suivis du nom de l'onglet (`INTRFACE.RES` 2376 + onglet).
 *   417e40 : un clic dans la barre, à x − 31 (30 px par onglet), choisit l'onglet (4187b5, `[0x471f90]`).
 * - 4187b5 : l'onglet 1 (décors) pose `[0x47794c]` = 1 et l'option « décors affichés » (`[0x481034]` |= 2) ; les autres le remettent à 0.
 * - 417264 (modes 1 et 6) : tout l'ordre du bac (table 0x47201c, jusqu'à −1, types 0 à 280) passe par le filtre de l'onglet ; un type
 *   sans icône n'a pas de case. Filtres (descripteur du type : +0x2C = `flags10`, +0x30 = `flags14`) :
 *   2 rotations (`flags10` & 1, sauf la courroie 8) ; 3 cordes (10, 76, 77, 37, ou `flags10` & 4) ; 4 balles (liste) ; 5 murs (liste) ;
 *   6 électricité (`flags14` & 3) ; 7 feu (liste, ou `flags14` & 4) ; 8 lasers (148, 91 à 96) ; 9 programmables (`flags14` & 0x400) ;
 *   10 tuyaux, 11 pentes, 12 bestioles, 13 divers (listes) ; 0 et 1 : sans décor / décors seulement (`flags14` & 0x1000), et dans les
 *   décors, ceux de `flags14` & 0x80 seulement si l'option « fond » (`[0x481034]` & 4) est active.
 * - Puis, tous onglets : les pièces des fêtes 32, 33, 34 et 65 ne sont proposées que le jour de leur fête (43b06c : 31 octobre, 14 février,
 *   25 décembre, 17 mars), ou toujours avec une option de mise au point (`[0x4815a8]`, 4168ec).
 *
 * Le port ne lit pas les préférences du joueur (`USERPREF.ITF`, non porté) : l'option « fond » est supposée active.
 */
import { BIN_ORDER } from "../data/tables/bin-order";
import type { TypeTable } from "./types";

/** Nombre d'onglets (4184e0 : 13 … 0). */
export const LAB_TAB_COUNT = 14;
/** Onglet des décors (4187b5). */
export const SCENERY_TAB = 1;
/** `INTRFACE.RES` : nom de l'onglet `t` = 31376 + t (« Éléments n'appartenant pas au décor »… « Éléments divers »). */
export const TAB_TEXT = 31376;

const BALLS = new Set([0, 9, 0x44, 0x2b, 0x3b, 0x3f, 0x57, 0x1c, 0x2c]);
const WALLS = new Set([1, 0x7d, 0x53, 0x54, 0x30, 0x55, 0x38, 0x3c, 0x2e, 0x2f, 0x52]);
const FIRE = new Set([0x4b, 0x4a, 0x16, 0x4e, 0x1e, 0x1d, 0x19]);
const PIPES = new Set([0x2e, 0x2f, 0x61, 0x62, 0x39, 0x58]);
const INCLINES = new Set([0x66, 0x7e, 0x65, 2, 0x64, 0x63]);
const CRITTERS = new Set([0x42, 0x34, 0x2a, 0x0c, 0x0f, 0x3d, 0x36, 0x3a, 0x1f, 6]);
const MISC = new Set([0x6a, 0x69, 0x68, 0x67, 0x76, 0x77, 0x75, 0x49, 0x35, 0x6d, 0x45, 0x27, 0x40, 0x74, 0x23, 0x47, 0x20, 0x21, 0x22, 0x41, 0x10, 0x3e]);

/** 43b06c : pièce de fête → jour (mois de 1 à 12, jour) où le Labo la propose. */
export const HOLIDAY_TYPES: ReadonlyMap<number, { month: number; day: number }> = new Map([
  [0x20, { month: 10, day: 31 }],
  [0x21, { month: 2, day: 14 }],
  [0x22, { month: 12, day: 25 }],
  [0x41, { month: 3, day: 17 }],
]);

export interface LabTabOptions {
  /** Date du jour (pièces des fêtes) ; `null` : aucune pièce de fête. */
  date?: Date | null;
  /** Option « fond » (`[0x481034]` & 4) : décors de `flags14` & 0x80 (supposée active, voir l'en-tête). */
  background?: boolean;
}

/** Le type `t` passe-t-il le filtre de l'onglet `tab` (417264) ? */
export function inLabTab(types: TypeTable, t: number, tab: number, options: LabTabOptions = {}): boolean {
  const d = types.get(t);
  const holiday = HOLIDAY_TYPES.get(t);
  if (holiday) {
    const date = options.date;
    if (!date || date.getMonth() + 1 !== holiday.month || date.getDate() !== holiday.day) return false;
  }
  switch (tab) {
    case 2:
      return t !== 8 && (d.flags10 & 1) !== 0;
    case 3:
      return t === 10 || t === 0x4c || t === 0x4d || t === 0x25 || (d.flags10 & 4) !== 0;
    case 4:
      return BALLS.has(t);
    case 5:
      return WALLS.has(t);
    case 6:
      return (d.flags14 & 3) !== 0;
    case 7:
      return FIRE.has(t) || (d.flags14 & 4) !== 0;
    case 8:
      return t === 0x94 || (t >= 0x5b && t <= 0x60);
    case 9:
      return (d.flags14 & 0x400) !== 0;
    case 10:
      return PIPES.has(t);
    case 11:
      return INCLINES.has(t);
    case 12:
      return CRITTERS.has(t);
    case 13:
      return MISC.has(t);
    default: {
      const scenery = (d.flags14 & 0x1000) !== 0;
      if (tab === SCENERY_TAB) return scenery && ((options.background ?? true) || !(d.flags14 & 0x80));
      return !scenery;
    }
  }
}

/** Types de l'onglet, dans l'ordre du bac, sans doublon (l'ordre en a deux : 203 et 205, 271 et 280). */
export function labTabTypes(types: TypeTable, tab: number, options: LabTabOptions = {}): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of BIN_ORDER) {
    if (t < 0 || seen.has(t)) continue;
    seen.add(t);
    if (inLabTab(types, t, tab, options)) out.push(t);
  }
  return out;
}
