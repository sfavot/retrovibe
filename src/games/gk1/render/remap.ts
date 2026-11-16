/**
 * Couleurs de remplacement (`RemapColors`) : un pixel d'une des 19 couleurs 236 à 254 ne se dessine pas lui-même, il
 * **transforme la couleur déjà à l'écran** (ombres, vitres, éclairages) selon la table de sa couleur.
 *
 * Référence : `engines/sci/graphics/remap32.cpp` et `remap32.h` de ScummVM (`GfxRemap32`, `SingleRemap::reset`, `update`,
 * `updateRange`, `updateBrightness`, `apply`, `matchColor`), GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - **Par plage** (`ByRange`) : une couleur de `from` à `to` devient `couleur + delta` ; les autres ne changent pas.
 * - **Par pourcentage** (`ByPercent`) : chaque couleur vise elle-même à `percent` % de luminosité (composantes bornées à
 *   255), et prend la couleur la plus proche de cet idéal parmi les couleurs 0 à 235 de la palette de l'écran, hors
 *   couleurs en cycle. La couleur 0 ne change jamais.
 * - Les tables sont recalculées au `FrameOut`, après la palette et avant le dessin, quand un remplacement ou la palette a
 *   changé. Le calcul est **incrémental, comme l'original** : une couleur ne cherche une nouvelle correspondance que si
 *   son idéal ou la couleur qu'elle avait choisie a changé, et garde son choix tant qu'il reste aussi proche qu'avant. Le
 *   résultat dépend donc de l'histoire de la palette, pas seulement de son état.
 *
 * Écarts volontaires : seuls les types appelés par le jeu existent (`ToGray`, `ToPercentGray` et `BlockRange` sont de
 * SCI2.1) ; un `Off` répété ne fait pas descendre le compte des remplacements actifs sous zéro.
 */
import { REMAP_END_COLOR, REMAP_START_COLOR, RemapType } from "./ids";
import type { GamePalette } from "./palette";
import { declareState } from "../engine/save-codec";

const CHANNELS = 3;
const CHANNEL_MAX = 255;
const MATCH_WORST = 0xfffff;
/** Sous cette distance mémorisée, un choix encore aussi proche de son idéal est gardé sans nouvelle recherche. */
const MATCH_KEEP_LIMIT = 100;
const NO_MATCH = -1;

class SingleRemap {
  type: RemapType = RemapType.None;
  from = 0;
  to = 0;
  delta = 0;
  percent = 100;
  /** Couleur que devient chaque couleur 0 à 235 de l'écran sous un pixel de cette couleur de remplacement. */
  readonly colors = new Uint8Array(REMAP_START_COLOR);
  private lastPercent = 100;
  private readonly original = new Uint8Array(REMAP_START_COLOR * CHANNELS);
  private readonly originalChanged = new Uint8Array(REMAP_START_COLOR);
  private readonly ideal = new Uint8Array(REMAP_START_COLOR * CHANNELS);
  private readonly idealChanged = new Uint8Array(REMAP_START_COLOR);
  private readonly distances = new Int32Array(REMAP_START_COLOR);

  /** Table identité, sur la palette de l'écran du moment. */
  reset(palette: GamePalette): void {
    this.lastPercent = 100;
    for (let i = 0; i < REMAP_START_COLOR; i++) this.colors[i] = i;
    this.original.set(palette.screen.subarray(0, REMAP_START_COLOR * CHANNELS));
    this.ideal.set(this.original);
    this.originalChanged.fill(1);
    this.idealChanged.fill(0);
    this.distances.fill(0);
  }

  /** Recalcule la table ; dit si elle a changé. */
  update(palette: GamePalette): boolean {
    if (this.type === RemapType.ByRange) return this.updateRange();
    if (this.type === RemapType.ByPercent) return this.updateBrightness(palette);
    return false;
  }

  private updateRange(): boolean {
    let updated = false;
    for (let i = 0; i < REMAP_START_COLOR; i++) {
      const target = i >= this.from && i <= this.to ? (i + this.delta) & 0xff : i;
      if (this.colors[i] !== target) {
        updated = true;
        this.colors[i] = target;
      }
      this.originalChanged[i] = 1;
    }
    return updated;
  }

  private updateBrightness(palette: GamePalette): boolean {
    const next = palette.screen;
    for (let i = 1; i < REMAP_START_COLOR; i++) {
      const at = CHANNELS * i;
      if (!sameColor(this.original, at, next, at)) {
        this.originalChanged[i] = 1;
        this.original.set(next.subarray(at, at + CHANNELS), at);
      }
      if (this.percent === this.lastPercent && !this.originalChanged[i]) continue;
      for (let c = at; c < at + CHANNELS; c++) {
        const value = Math.min(CHANNEL_MAX, Math.trunc((next[c] * this.percent) / 100));
        if (this.ideal[c] !== value) {
          this.idealChanged[i] = 1;
          this.ideal[c] = value;
        }
      }
    }
    const updated = this.apply(palette);
    this.originalChanged.fill(0);
    this.idealChanged.fill(0);
    this.lastPercent = this.percent;
    return updated;
  }

  private apply(palette: GamePalette): boolean {
    let updated = false;
    for (let i = 1; i < REMAP_START_COLOR; i++) {
      const chosen = this.colors[i];
      const chosenChanged = chosen < REMAP_START_COLOR && this.originalChanged[chosen] !== 0;
      if (!this.idealChanged[i] && !chosenChanged) continue;
      if (this.idealChanged[i] && chosenChanged && this.distances[i] < MATCH_KEEP_LIMIT && distance(this.ideal, CHANNELS * i, this.original, CHANNELS * chosen) <= this.distances[i]) continue;
      const match = matchColor(palette, this.ideal, CHANNELS * i, this.distances[i]);
      if (match.color !== NO_MATCH && this.colors[i] !== match.color) {
        updated = true;
        this.colors[i] = match.color;
        this.distances[i] = match.distance;
      }
    }
    return updated;
  }
}

function sameColor(a: Uint8Array, at: number, b: Uint8Array, bt: number): boolean {
  return a[at] === b[bt] && a[at + 1] === b[bt + 1] && a[at + 2] === b[bt + 2];
}

function distance(a: Uint8Array, at: number, b: Uint8Array, bt: number): number {
  const dr = a[at] - b[bt];
  const dg = a[at + 1] - b[bt + 1];
  const db = a[at + 2] - b[bt + 2];
  return dr * dr + dg * dg + db * db;
}

/**
 * Couleur de l'écran (0 à 235, hors cycles) la plus proche de l'idéal. La distance rendue est la dernière calculée, pas
 * forcément celle du choix (une couleur écartée en cours de calcul la remplace) : c'est le comportement de l'original.
 */
function matchColor(palette: GamePalette, ideal: Uint8Array, at: number, minimum: number): { color: number; distance: number } {
  let best = NO_MATCH;
  let bestDistance = MATCH_WORST;
  let last = minimum;
  const screen = palette.screen;
  for (let i = 0; i < REMAP_START_COLOR; i++) {
    if (palette.cycleMap[i]) continue;
    last = (screen[CHANNELS * i] - ideal[at]) ** 2;
    if (bestDistance <= last) continue;
    last += (screen[CHANNELS * i + 1] - ideal[at + 1]) ** 2;
    if (bestDistance <= last) continue;
    last += (screen[CHANNELS * i + 2] - ideal[at + 2]) ** 2;
    if (bestDistance <= last) continue;
    bestDistance = last;
    best = i;
  }
  return { color: best, distance: last };
}

export class Remap {
  /** Une table par couleur de remplacement, de 254 (indice 0) à 236. */
  private readonly remaps = Array.from({ length: REMAP_END_COLOR - REMAP_START_COLOR + 1 }, () => new SingleRemap());
  private needsUpdate = false;
  private active = 0;

  constructor(
    private readonly palette: GamePalette,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  /** Nombre de couleurs de remplacement actives. */
  get count(): number {
    return this.active;
  }

  /** `Off` : arrête le remplacement de `color`, ou tous si `color` vaut 0. */
  off(color = 0): void {
    if (color === 0) {
      for (const remap of this.remaps) remap.type = RemapType.None;
      this.active = 0;
    } else {
      const remap = this.slot(color, "Off");
      if (!remap) return;
      if (remap.type !== RemapType.None) this.active--;
      remap.type = RemapType.None;
    }
    this.needsUpdate = true;
  }

  /** `ByRange` : sous `color`, les couleurs `from` à `to` deviennent `couleur + delta`. */
  byRange(color: number, from: number, to: number, delta: number): void {
    if (from < 0 || to >= REMAP_START_COLOR) {
      this.warn(`RemapColors : plage ${from} à ${to} refusée`);
      return;
    }
    const remap = this.activate(color, "ByRange", RemapType.ByRange);
    if (!remap) return;
    remap.from = from;
    remap.to = to;
    remap.delta = delta;
  }

  /** `ByPercent` : sous `color`, chaque couleur prend la plus proche d'elle-même à `percent` % de luminosité. */
  byPercent(color: number, percent: number): void {
    const remap = this.activate(color, "ByPercent", RemapType.ByPercent);
    if (remap) remap.percent = percent;
  }

  /** Au `FrameOut`, une fois la palette de l'écran à jour : recalcule les tables si besoin ; dit si l'une a changé. */
  update(paletteChanged: boolean): boolean {
    if (!this.needsUpdate && !paletteChanged) return false;
    let updated = false;
    for (const remap of this.remaps) if (remap.type !== RemapType.None && remap.update(this.palette)) updated = true;
    this.needsUpdate = false;
    return updated;
  }

  /** Le pixel `pixel` d'un cel est-il une couleur de remplacement active ? */
  enabled(pixel: number): boolean {
    return pixel >= REMAP_START_COLOR && pixel <= REMAP_END_COLOR && this.remaps[REMAP_END_COLOR - pixel].type !== RemapType.None;
  }

  /** Couleur que devient `target`, déjà à l'écran, sous le pixel de remplacement `pixel` (supposé actif). */
  apply(pixel: number, target: number): number {
    return target < REMAP_START_COLOR ? this.remaps[REMAP_END_COLOR - pixel].colors[target] : target;
  }

  private slot(color: number, caller: string): SingleRemap | undefined {
    if (color < REMAP_START_COLOR || color > REMAP_END_COLOR) {
      this.warn(`RemapColors ${caller} : ${color} n'est pas une couleur de remplacement`);
      return undefined;
    }
    return this.remaps[REMAP_END_COLOR - color];
  }

  private activate(color: number, caller: string, type: RemapType): SingleRemap | undefined {
    const remap = this.slot(color, caller);
    if (!remap) return undefined;
    if (remap.type === RemapType.None) {
      this.active++;
      remap.reset(this.palette);
    }
    remap.type = type;
    this.needsUpdate = true;
    return remap;
  }
}

// État sauvegardé (`engine/save.ts`).
declareState(SingleRemap, { name: "SingleRemap" });
declareState(Remap, { name: "Remap", skip: ["palette"] });
