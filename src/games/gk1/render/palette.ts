/**
 * Palette courante du jeu : fusion des palettes des ressources dessinées, variation vers une autre palette (`PalVary`),
 * cycles de couleurs (`PalCycle`), fondu par plage de couleurs, recherche de la couleur la plus proche, palette envoyée à
 * l'écran (`docs/gk1/formats.md` § 6).
 *
 * Référence : `engines/sci/graphics/palette32.cpp` de ScummVM (`GfxPalette32::submit`, `mergePalette`, `setFade`,
 * `applyAll`, `applyVary`, `applyCycles`, `applyFade`, `setVary`, `setVaryTime`, `varyOff`, `setCycle`, `doCycle`,
 * `cycleOff`, `matchColor`, `updateHardware`, `loadPalette`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * - **Fusion** : seules les couleurs marquées « utilisée » dans la palette soumise remplacent celles de la palette source ;
 *   les autres restent. La couleur 255 se fusionne comme les autres mais l'écran la montre toujours blanche.
 * - **Ordre à chaque image** (`update`) : variation, puis cycles, puis fondu.
 * - **Variation** : chaque composante vaut `source + (cible − source) × pourcentage / 100` (division tronquée) pour les
 *   couleurs de la plage ; la source est la palette de départ (`SetStart`) si elle existe, sinon la palette du jeu. Le
 *   pourcentage avance de 1 tous les `durée / écart` ticks. À 0 % ou sans cible, la palette de départ remplace la plage.
 * - **Cycle** : les couleurs `première … dernière − 1` tournent d'un cran tous les `délai` ticks (SCI2 exclut la dernière
 *   couleur donnée ; les versions suivantes l'incluent).
 * - **Fondu** (`Palette SetFade`, transitions) : pourcentage par couleur, plage bornes comprises ; à l'écran chaque
 *   composante vaut `min(255, composante × pourcentage / 100)`. 100 % : sans effet.
 * - **Couleur la plus proche** (`Palette FindColor`) : plus petite distance `dR² + dV² + dB²` dans la palette de l'écran,
 *   parmi les couleurs 0 à 235 (les couleurs de remplacement sont exclues) ; à égalité, le plus petit indice.
 * - La palette 999 est chargée au démarrage si elle existe.
 *
 * Écarts volontaires : ScummVM ne refusionne une palette de ressource que si la palette du jeu a changé depuis sa dernière
 * fusion (numéro de version écrit dans la ressource) ; ici les palettes des cels visibles sont refusionnées à chaque image,
 * dans l'ordre du dessin (`frameout.ts`) : même résultat tant que deux cels visibles ne se disputent pas une couleur.
 * L'horloge est celle du jeu (`now`, en ticks), pas celle de la machine. La carte des couleurs en cycle couvre exactement
 * les couleurs de chaque cycle (celle de ScummVM borne mal ses boucles et n'en marque souvent aucune) ; deux cycles qui se
 * chevauchent donnent un avertissement au lieu d'un arrêt. Pas de pause de variation ni de cycle (jamais appelées).
 */
import { PALETTE_COLORS, type Palette } from "../data/palette";
import { FADE_NONE, PAL_CYCLERS, PALETTE_LAST_COLOR, PALETTE_WHITE, REMAP_START_COLOR, VARY_FULL } from "./ids";
import { declareState } from "../engine/save-codec";

const CHANNELS = 3;
const CHANNEL_MAX = 255;
/** Distance de départ de la recherche : rien de plus loin n'est retenu. */
const MATCH_WORST = 0xfffff;

interface Cycler {
  fromColor: number;
  count: number;
  current: number;
  backward: boolean;
  delay: number;
  lastUpdateTick: number;
}

export class GamePalette {
  /** Palette source : ce que les ressources ont fixé, avant fondu. `used` : couleur déjà fixée par une ressource. */
  readonly used = new Uint8Array(PALETTE_COLORS);
  readonly rgb = new Uint8Array(PALETTE_COLORS * CHANNELS);
  /** Palette de l'écran : 256 × `R, V, B`, à jour après `update`. */
  readonly screen = new Uint8Array(PALETTE_COLORS * CHANNELS);
  /** Couleurs prises par un cycle : `RemapColors` ne les choisit pas. */
  readonly cycleMap = new Uint8Array(PALETTE_COLORS);
  /** Avertissements (cycles qui se chevauchent). */
  onWarning: (message: string) => void = () => {};
  private readonly fades = new Uint16Array(PALETTE_COLORS).fill(FADE_NONE);
  private readonly next = new Uint8Array(PALETTE_COLORS * CHANNELS);
  private readonly scratch = new Uint8Array(PALETTE_COLORS * CHANNELS);

  private varyTarget: Uint8Array | undefined;
  private varyStart: Uint8Array | undefined;
  private varyFromColor = 0;
  private varyToColor = PALETTE_COLORS - 1;
  private varyLastTick = 0;
  private varyTime = 0;
  private varyDirection = 0;
  private varyCurrent = 0;
  private varyTargetPercent = 0;
  private readonly cyclers: (Cycler | undefined)[] = new Array<Cycler | undefined>(PAL_CYCLERS).fill(undefined);

  /** `now` : horloge du jeu en ticks de 1/60 s. */
  constructor(private readonly now: () => number = () => 0) {
    this.update();
  }

  /** Fusionne les couleurs « utilisées » de `palette` dans la palette source. */
  submit(palette: Palette): void {
    for (let i = 0; i < PALETTE_COLORS; i++) {
      if (!palette.used[i]) continue;
      this.used[i] = palette.used[i];
      this.rgb[CHANNELS * i] = palette.rgb[CHANNELS * i];
      this.rgb[CHANNELS * i + 1] = palette.rgb[CHANNELS * i + 1];
      this.rgb[CHANNELS * i + 2] = palette.rgb[CHANNELS * i + 2];
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Variation (`PalVary`)
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `SetVary` : varie vers `target` jusqu'à `percent` en `ticks` ; `fromColor` et `toColor` négatifs laissent la plage. */
  setVary(target: Palette, percent: number, ticks: number, fromColor = -1, toColor = -1): void {
    this.setVaryTarget(target);
    this.setVaryTime(percent, ticks);
    if (fromColor >= 0) this.varyFromColor = fromColor;
    if (toColor >= 0) this.varyToColor = Math.min(toColor, PALETTE_COLORS - 1);
  }

  /** `SetPercent` : change le pourcentage visé (sans effet s'il n'y a pas de palette cible). */
  setVaryPercent(percent: number, ticks: number): void {
    if (this.varyTarget) this.setVaryTime(percent, ticks);
  }

  /** `SetTime` : change la durée restante vers le pourcentage visé. */
  setVaryDuration(ticks: number): void {
    if (this.varyTarget) this.setVaryTime(this.varyTargetPercent, ticks);
  }

  get varyPercent(): number {
    return this.varyCurrent;
  }

  /** `Off` : plus de variation ; les palettes cible et de départ sont oubliées. */
  varyOff(): void {
    this.varyCurrent = this.varyTargetPercent = 0;
    this.varyFromColor = 0;
    this.varyToColor = PALETTE_COLORS - 1;
    this.varyDirection = 0;
    this.varyTarget = this.varyStart = undefined;
  }

  setVaryTarget(palette: Palette): void {
    this.varyTarget = palette.rgb.slice();
  }

  setVaryStart(palette: Palette): void {
    this.varyStart = palette.rgb.slice();
  }

  /** `MergeTarget` : fusionne dans la palette cible, ou la crée. */
  mergeVaryTarget(palette: Palette): void {
    this.varyTarget = mergeInto(this.varyTarget, palette);
  }

  mergeVaryStart(palette: Palette): void {
    this.varyStart = mergeInto(this.varyStart, palette);
  }

  private setVaryTime(percent: number, ticks: number): void {
    this.varyLastTick = this.now();
    if (ticks === 0 || this.varyCurrent === percent) {
      this.varyDirection = 0;
      this.varyTargetPercent = this.varyCurrent = percent;
      return;
    }
    const step = Math.trunc(ticks / (percent - this.varyCurrent));
    this.varyTargetPercent = percent;
    this.varyTime = Math.abs(step);
    this.varyDirection = Math.sign(step);
    if (step === 0) this.varyCurrent = percent;
  }

  private applyVary(): void {
    const now = this.now();
    while (this.varyDirection !== 0 && now - this.varyLastTick > this.varyTime) {
      this.varyLastTick += this.varyTime;
      if (this.varyCurrent === this.varyTargetPercent) this.varyDirection = 0;
      this.varyCurrent += this.varyDirection;
    }
    this.next.set(this.rgb);
    const start = this.varyStart;
    const target = this.varyCurrent === 0 ? undefined : this.varyTarget;
    if (!start && !target) return;
    for (let c = CHANNELS * this.varyFromColor; c < CHANNELS * (this.varyToColor + 1); c++) {
      const source = start ? start[c] : this.rgb[c];
      this.next[c] = target ? Math.trunc(((target[c] - source) * this.varyCurrent) / VARY_FULL) + source : source;
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Cycles (`PalCycle`)
  // -------------------------------------------------------------------------------------------------------------------------------

  /** `SetCycle` : fait tourner les couleurs `fromColor … toColor − 1`, d'un cran tous les `delay` ticks. */
  setCycle(fromColor: number, toColor: number, direction: number, delay: number): void {
    if (fromColor >= toColor) return;
    const now = this.now();
    let slot = this.cyclers.findIndex((cycler) => cycler?.fromColor === fromColor);
    if (slot < 0) slot = this.cyclers.indexOf(undefined);
    if (slot < 0) {
      // Plus de place : comme l'original, c'est le cycle mis à jour le plus récemment qui cède la sienne.
      slot = 0;
      for (let i = 1; i < PAL_CYCLERS; i++) if (now - this.cyclers[i]!.lastUpdateTick < now - this.cyclers[slot]!.lastUpdateTick) slot = i;
    }
    const previous = this.cyclers[slot];
    if (previous) this.cycleMap.fill(0, previous.fromColor, previous.fromColor + previous.count);
    const count = Math.min(toColor, PALETTE_COLORS) - fromColor;
    if (this.cycleMap.subarray(fromColor, fromColor + count).some((taken) => taken !== 0)) this.onWarning(`PalCycle : le cycle ${fromColor} à ${toColor} en chevauche un autre`);
    this.cycleMap.fill(1, fromColor, fromColor + count);
    this.cyclers[slot] = { fromColor, count, current: fromColor % count, backward: direction < 0, delay, lastUpdateTick: now };
  }

  /** `DoCycle` : avance tout de suite le cycle de `fromColor` de `speed` crans. */
  doCycle(fromColor: number, speed = 1): void {
    const cycler = this.cyclers.find((candidate) => candidate?.fromColor === fromColor);
    if (!cycler) return;
    cycler.lastUpdateTick = this.now();
    advance(cycler, speed);
  }

  /** `Off` : arrête le cycle qui commence à `fromColor`, ou tous. */
  cycleOff(fromColor?: number): void {
    this.cyclers.forEach((cycler, slot) => {
      if (!cycler || (fromColor !== undefined && cycler.fromColor !== fromColor)) return;
      this.cycleMap.fill(0, cycler.fromColor, cycler.fromColor + cycler.count);
      this.cyclers[slot] = undefined;
    });
  }

  private applyCycles(): void {
    if (!this.cyclers.some(Boolean)) return;
    const now = this.now();
    this.scratch.set(this.next);
    for (const cycler of this.cyclers) {
      if (!cycler) continue;
      if (cycler.delay !== 0) {
        while (cycler.delay + cycler.lastUpdateTick < now) {
          advance(cycler, 1);
          cycler.lastUpdateTick += cycler.delay;
        }
      }
      for (let j = 0; j < cycler.count; j++) {
        const from = CHANNELS * (cycler.fromColor + ((cycler.current + j) % cycler.count));
        this.next.set(this.scratch.subarray(from, from + CHANNELS), CHANNELS * (cycler.fromColor + j));
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Fondu, recherche, écran
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Fixe le pourcentage de fondu des couleurs `from` à `to` compris. */
  setFade(percent: number, from: number, to: number): void {
    if (from > to) return;
    this.fades.fill(percent, Math.max(from, 0), Math.min(to, PALETTE_COLORS - 1) + 1);
  }

  fadeOff(): void {
    this.setFade(FADE_NONE, 0, PALETTE_COLORS - 1);
  }

  /** Indice de la couleur de l'écran la plus proche de (`r`, `g`, `b`), hors couleurs de remplacement. */
  findColor(r: number, g: number, b: number): number {
    let best = 0;
    let bestDistance = MATCH_WORST;
    for (let i = 0; i < REMAP_START_COLOR; i++) {
      const dr = this.screen[CHANNELS * i] - r;
      const dg = this.screen[CHANNELS * i + 1] - g;
      const db = this.screen[CHANNELS * i + 2] - b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /** Recalcule la palette de l'écran (source, variation, cycles, fondu ; 255 blanche) ; dit si elle a changé. */
  update(): boolean {
    this.applyVary();
    this.applyCycles();
    let changed = false;
    for (let i = 0; i <= PALETTE_LAST_COLOR; i++) {
      const fade = this.fades[i];
      for (let c = CHANNELS * i; c < CHANNELS * (i + 1); c++) {
        const value = fade === FADE_NONE ? this.next[c] : Math.min(CHANNEL_MAX, Math.trunc((this.next[c] * fade) / 100));
        if (this.screen[c] !== value) {
          this.screen[c] = value;
          changed = true;
        }
      }
    }
    for (let c = CHANNELS * PALETTE_WHITE; c < CHANNELS * (PALETTE_WHITE + 1); c++) {
      if (this.screen[c] !== CHANNEL_MAX) changed = true;
      this.screen[c] = CHANNEL_MAX;
    }
    return changed;
  }
}

function advance(cycler: Cycler, speed: number): void {
  const current = cycler.backward ? cycler.current - (speed % cycler.count) + cycler.count : cycler.current + speed;
  cycler.current = current % cycler.count;
}

function mergeInto(existing: Uint8Array | undefined, palette: Palette): Uint8Array {
  if (!existing) return palette.rgb.slice();
  for (let i = 0; i < PALETTE_COLORS; i++) if (palette.used[i]) existing.set(palette.rgb.subarray(CHANNELS * i, CHANNELS * (i + 1)), CHANNELS * i);
  return existing;
}

// État sauvegardé (`engine/save.ts`) : tout, sauf le tampon de travail.
declareState(GamePalette, { name: "GamePalette", skip: ["scratch"] });
