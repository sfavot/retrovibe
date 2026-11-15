/**
 * Palettes du rendu : palette de secours (`_backupPal`, celle du fond chargé), palette active (`_activePal`) et palette affichée (celle
 * que `setPalette` a transmise au système), en 9 bits (16 couleurs, composantes 0 à 7) ; fondus au noir et depuis le noir, rotation,
 * transformation saturée.
 *
 * Référence : ScummVM engines/cine/pal.cpp (`Palette::rotateRight`, `rotateLeft`, `fillWithBlack`, `saturatedAddColor`,
 * `saturatedAddNormalizedGray`, `save`) et gfx.cpp (`FWRenderer::setBlackPalette`, `setPalette`, `rotatePalette`, `transformPalette`,
 * `fadeToBlack`, `fadeFromBlack`, `drawFrame` pour `_changePal`) (GPL v3 ou ultérieure). docs/voyageurs/engine.md § 3.
 *
 * Règles reprises :
 * - un pas de fondu ajoute `7 × k / 7` (division entière C) à chaque composante, saturé de 0 à 7 : au noir, k = -1 à partir de la palette
 *   active (8 pas cumulés) ; depuis le noir, k = -i (i de 7 à 0) à partir de la palette de secours ;
 * - `transformPalette` : active[first..last] = secours + (r, g, b), saturé, appliqué à l'écran au prochain `drawFrame` (`_changePal`) ;
 * - `rotatePalette` : mode 1 à droite, 2 à gauche, sinon retour à la palette de secours ; appliqué tout de suite ;
 * - le chargement d'un fond ne change que la palette de secours.
 *
 * Écarts volontaires : des indices de couleur hors de 0 à 15 (assertion ou lecture hors tableau dans ScummVM) sont ramenés dans la palette ;
 * la cadence des pas (42 ms) et la règle anti double fondu relèvent du moteur (`game.ts`).
 */

import { component9To8, ST_COMPONENT_MAX, ST_PALETTE_COLORS, type StPalette } from "../data/palette";

export const PALETTE_COLORS = ST_PALETTE_COLORS;
/** Nombre de pas d'un fondu. */
export const FADE_STEPS = 8;

function clampIndex(index: number): number {
  return Math.min(Math.max(index | 0, 0), PALETTE_COLORS - 1);
}

/** Division entière de C (troncature vers 0). */
function cdiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** `Palette::saturatedAddColor` : out[first..last] = source + (r, g, b), chaque composante saturée de 0 à 7. */
export function saturatedAdd(source: StPalette, out: StPalette, first: number, last: number, r: number, g: number, b: number): void {
  const delta = [r, g, b];
  for (let i = clampIndex(first); i <= clampIndex(last); i++) {
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(Math.max(source[i * 3 + c]! + delta[c]!, 0), ST_COMPONENT_MAX);
  }
}

/** `Palette::saturatedAddNormalizedGray` sur toute la palette : `7 × dividend / denominator` ajouté à chaque composante. */
export function saturatedAddGray(source: StPalette, out: StPalette, dividend: number, denominator: number): void {
  const gray = cdiv(ST_COMPONENT_MAX * dividend, denominator);
  saturatedAdd(source, out, 0, PALETTE_COLORS - 1, gray, gray, gray);
}

/** `Palette::rotateRight` : la dernière couleur passe en tête. */
export function rotateRight(palette: StPalette, first: number, last: number): void {
  const a = clampIndex(first);
  const z = clampIndex(last);
  const saved = palette.slice(z * 3, z * 3 + 3);
  for (let i = z; i > a; i--) palette.copyWithin(i * 3, (i - 1) * 3, i * 3);
  palette.set(saved, a * 3);
}

/** `Palette::rotateLeft` : la première couleur passe en queue. */
export function rotateLeft(palette: StPalette, first: number, last: number): void {
  const a = clampIndex(first);
  const z = clampIndex(last);
  const saved = palette.slice(a * 3, a * 3 + 3);
  for (let i = a; i < z; i++) palette.copyWithin(i * 3, (i + 1) * 3, (i + 2) * 3);
  palette.set(saved, z * 3);
}

/** Palette 9 bits vers RVB 8 bits (`Palette::save` au format du système : `c × 255 / 7`). */
export function paletteToRgb(palette: StPalette): Uint8Array {
  const rgb = new Uint8Array(PALETTE_COLORS * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = component9To8(palette[i]!);
  return rgb;
}

/** Les trois palettes de `FWRenderer` et le drapeau `_changePal`. */
export class PaletteState {
  /** `_backupPal` : palette du fond chargé (source des fondus depuis le noir). */
  readonly backup: StPalette = new Uint8Array(PALETTE_COLORS * 3);
  /** `_activePal`. */
  readonly active: StPalette = new Uint8Array(PALETTE_COLORS * 3);
  /** Palette du système (dernier `setPalette`) : celle de l'écran. */
  readonly screen: StPalette = new Uint8Array(PALETTE_COLORS * 3);
  /** `_changePal` : recopier l'active à l'écran au prochain `drawFrame`. */
  changePal = 0;

  /** `clear` + `setBlackPalette(true)` (début de `mainLoop`). */
  reset(): void {
    this.backup.fill(0);
    this.active.fill(0);
    this.changePal = 1;
  }

  /** `loadBg16` : nouvelle palette de secours. */
  loadBackup(palette: StPalette): void {
    this.backup.set(palette.subarray(0, PALETTE_COLORS * 3));
  }

  /** `setPalette`. */
  apply(): void {
    this.screen.set(this.active);
  }

  /** Rustine anti-flash de `o1_blitAndFade` : `setBlackPalette(false)` puis `setPalette`. */
  blackNow(): void {
    this.active.fill(0);
    this.apply();
  }

  transform(first: number, last: number, r: number, g: number, b: number): void {
    saturatedAdd(this.backup, this.active, first, last, r, g, b);
    this.changePal = 1;
  }

  rotate(first: number, last: number, mode: number): void {
    if (mode === 1) rotateRight(this.active, first, last);
    else if (mode === 2) rotateLeft(this.active, first, last);
    else this.active.set(this.backup);
    this.apply();
  }

  /** Un pas de `fadeToBlack`. */
  fadeOutStep(): void {
    saturatedAddGray(this.active, this.active, -1, ST_COMPONENT_MAX);
    this.apply();
  }

  /** Pas `step` (7 à 0) de `fadeFromBlack`. */
  fadeInStep(step: number): void {
    saturatedAddGray(this.backup, this.active, -step, ST_COMPONENT_MAX);
    this.apply();
  }

  /** Partie palette de `drawFrame`. */
  flip(): void {
    if (this.changePal) {
      this.apply();
      this.changePal = 0;
    }
  }
}
