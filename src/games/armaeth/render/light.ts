import { PALETTE_BYTES } from "../../../ui/indexed-canvas";

/** Courbe de lumière du jour par heure (25 mots de `DGROUP:0E68`, heures 0 à 24 ; `197e:0008`). */
export const DAYLIGHT_CURVE = [
  15, 15, 15, 15, 15, 22, 29, 36, 43, 50, 57, 63, 63, 63, 63, 63, 63, 56, 49,
  42, 35, 28, 21, 15, 15,
] as const;

/** Nombre de couleurs que le décalage de lumière touche : les 216 premières ; les 40 dernières (cadre, fenêtres) ne bougent jamais. */
export const SHIFTED_COLORS = 216;

/** Niveau en dessous duquel le héros ne voit plus rien (`197e:0272` : palette du pilote `< -0x28`). */
export const DARK_LEVEL = -40;

const LEVEL_LIMIT = 63;

export interface LightRoom {
  /** `outdoor` de la salle (`+4`) : non nul = extérieur, reçoit la lumière du jour. */
  outdoor: boolean;
  /** Décalage de lumière de la salle (`+2`, 0 sauf salle 7 : -32). */
  lightOffset: number;
}

export interface LightInput {
  /** Salle affichée, ou `null` hors salle de jeu (niveau 0 avant surcharges). */
  room: LightRoom | null;
  /** Heure et minute de jeu (`DGROUP:4B54`, `4B55`). */
  hour: number;
  minute: number;
  /** Somme des `Lum` (+0x0A) des objets de premier niveau des listes B et A de la salle et du contenu du héros. */
  lamps: number;
  /** Jetons `lum` / `ral` / `rvb` : `override` (`4AE2`, non nul = niveau imposé) et `cap` (`4AE4`, plafond). `cap` vaut 63 par défaut (hypothèse : valeur initiale sans effet). */
  override?: number;
  cap?: number;
}

/** Division entière qui tronque vers zéro, comme le C. */
function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Lumière du jour interpolée entre les heures `h` et `h + 1` par les minutes (arithmétique entière de `197e:0008`). */
export function daylight(hour: number, minute: number): number {
  const from = DAYLIGHT_CURVE[hour];
  const to = DAYLIGHT_CURVE[hour + 1];
  if (from === undefined || to === undefined)
    throw new RangeError(`heure ${hour} hors de 0..23`);
  const fraction = div((minute * 1000) & 0xffff, 60);
  return from + div((to - from) * fraction, 1000);
}

/**
 * Niveau de lumière `L` (-63..63) que le moteur passe au pilote comme décalage commun de R, V, B (`197e:0008`,
 * `engine.md` § 7.5). À l'extérieur, une salle sans décalage plafonne les lampes pour que lampes + jour <= 31 (ou les
 * annule en plein jour) ; une salle avec décalage l'ajoute au jour (minimum 0).
 */
export function lightLevel(input: LightInput): number {
  let level = 0;
  const { room } = input;
  if (room) {
    let day = room.outdoor ? daylight(input.hour, input.minute) : 0;
    let lamps = input.lamps;
    let offset = room.lightOffset;
    if (room.outdoor) {
      if (offset === 0) {
        if (day < 32) {
          if (lamps + day > 31) lamps = 31 - day;
        } else if (lamps > 0) {
          lamps = 0;
        }
      } else {
        day = Math.max(0, day + offset);
        offset = 0;
      }
    }
    level = Math.max(
      -LEVEL_LIMIT,
      Math.min(LEVEL_LIMIT, lamps + day + offset - LEVEL_LIMIT),
    );
  }
  if (input.override) return input.override;
  return Math.min(level, input.cap ?? LEVEL_LIMIT);
}

/** Vrai si le niveau est trop sombre pour agir (`L < -40`). */
export function isTooDark(level: number): boolean {
  return level < DARK_LEVEL;
}

/**
 * Palette envoyée au DAC par `vga_set_palette` (`+0x4a`) : chaque composante des 216 premières couleurs reçoit son décalage
 * (borné à -63..63), puis le résultat est borné à 0..63 ; les 40 dernières couleurs sont copiées telles quelles.
 * `palette6` : 768 valeurs de 0 à 63 ; rend 768 valeurs de 0 à 63.
 */
export function applyPaletteOffsets(
  palette6: Uint8Array,
  dr: number,
  dg: number,
  db: number,
): Uint8Array {
  if (palette6.length !== PALETTE_BYTES)
    throw new RangeError(`palette de ${palette6.length} octets au lieu de ${PALETTE_BYTES}`);
  const offsets = [dr, dg, db].map((d) =>
    Math.max(-LEVEL_LIMIT, Math.min(LEVEL_LIMIT, d)),
  );
  const out = new Uint8Array(PALETTE_BYTES);
  out.set(palette6);
  for (let i = 0; i < SHIFTED_COLORS * 3; i++)
    out[i] = Math.max(0, Math.min(63, palette6[i] + offsets[i % 3]));
  return out;
}

/** Palette éclairée au niveau `level` : le même décalage sur R, V et B. */
export function applyLight(palette6: Uint8Array, level: number): Uint8Array {
  return applyPaletteOffsets(palette6, level, level, level);
}
