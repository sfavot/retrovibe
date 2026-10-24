/**
 * Palette de l'écran : 256 entrées RVB 8 bits, avec fondus et cycles (`docs/mathemagique/engine.md` §4.4, `shap.md` « Palette »).
 *
 * - `colors` = table logique (`DS:8bda`), remplie par les `SHPL` (avec éclaircissement `v + 31 - ⌊v/8⌋`, `1098:0857`) ou par un `tPAL` (brut) ;
 * - `output()` = ce qui est réellement affiché : table logique, fondu éventuel appliqué (`1088:1cee`) ;
 * - le temps est compté en **ticks** de 60 Hz (17 ms, `timeSetEvent`) : `tick()` avance fondu et cycles d'un tick.
 *
 * Couleurs système : index 0 noir et 255 blanc (hypothèse `SYSPAL_NOSTATIC`, voir `data/palette.ts`), les autres à 0 tant qu'un SHPL ne les définit pas.
 */
import { applyShpl, createPalette, PALETTE_SIZE } from "../../data/palette";
import type { ShapeList } from "../../data/shpl";

export const PALETTE_BYTES = PALETTE_SIZE * 3;

/** Plage de palette animable par défaut dans l'original : entrées 10 à 245 (les 20 couleurs système sont conservées). */
export const ANIMATED_FIRST = 10;
export const ANIMATED_COUNT = 236;

/** Niveau maximal d'un fondu (`1088:1cee` : 0 = départ, 256 = cible). */
export const FADE_MAX = 256;

/**
 * Fondu entre deux palettes sur une plage `[first, first + count)` (`1088:1b25` / `1b9b` / `1cee`).
 *
 * Niveau `t` (0 à 256) : composante = `départ + ((cible - départ) × t >> 8)`. Le niveau croît linéairement et atteint 256 après
 * `duration` ticks : le paramètre `30` des scènes vaut 30 ticks, soit 500 ms. Preuve : `1b9b` calcule la vitesse comme
 * `0xf5c29 / durée` en 16.16 par **milliseconde** (`1000:28b8` = `timeGetTime`) ; `0xf5c29` = 256 × 65536 / 16,67 ms. Durée 0 : instantané
 * (`1b9b` : vitesse `0x1000000`). `quantized` = mode 0 de l'original : le niveau avance par paliers de 4.
 */
export class Fade {
  elapsed = 0;

  constructor(
    /** Palette de départ (768 octets, copiée). */
    readonly from: Uint8Array,
    /** Palette cible (768 octets) ou `null` pour « la table logique courante » (suit les chargements pendant le fondu). */
    readonly to: Uint8Array | null,
    readonly first: number,
    readonly count: number,
    readonly duration: number,
    readonly quantized = false,
  ) {}

  get level(): number {
    const raw = this.duration <= 0 ? FADE_MAX : Math.min(FADE_MAX, Math.floor((FADE_MAX * this.elapsed) / this.duration));
    return this.quantized ? raw & ~3 : raw;
  }

  get done(): boolean {
    return this.level >= FADE_MAX;
  }

  tick(): void {
    if (!this.done) this.elapsed++;
  }

  /** Écrit dans `out` la palette fondue : `live` (table logique) hors de la plage, interpolation dedans. */
  mix(out: Uint8Array, live: Uint8Array): void {
    const target = this.to ?? live;
    const t = this.level;
    for (let i = this.first * 3; i < (this.first + this.count) * 3; i++) {
      out[i] = (this.from[i]! + (((target[i]! - this.from[i]!) * t) >> 8)) & 0xff;
    }
  }
}

export interface CyclerOptions {
  /** Premier index de la plage tournante. */
  first: number;
  /** Nombre d'entrées de la plage. */
  count: number;
  /** Ticks entre deux rotations d'un cran. */
  period: number;
  /** Durée totale en ticks (défaut : jusqu'à `stop()`). */
  duration?: number;
  /** +1 : l'entrée `i` prend la couleur de `i + 1` (hypothèse : sens non établi par le code étudié) ; -1 : sens inverse. */
  direction?: 1 | -1;
  /** À la fin (durée écoulée ou `stop()`), remet les couleurs d'origine (Pattern Windows : restauration de la palette d'entrée). */
  restore?: boolean;
}

/**
 * Rotation d'une plage de palette d'un cran toutes les `period` ticks (kaléidoscope de Pattern Windows `1060:1627` : 15 entrées 180–194,
 * 8 ticks, 300 ticks ; fanfare du Bowling `1010:42a2` : 8 entrées ; victoire de Puzzle Patterns ; Sticklers : 4 entrées en 156, 7 ticks).
 * Plusieurs cycleurs peuvent coexister (plages disjointes).
 */
export class PaletteCycler {
  private elapsed = 0;
  private readonly original: Uint8Array;
  private running = true;

  constructor(
    private readonly palette: Palette,
    readonly options: CyclerOptions,
  ) {
    this.original = palette.colors.slice(options.first * 3, (options.first + options.count) * 3);
  }

  get active(): boolean {
    return this.running;
  }

  tick(): void {
    if (!this.running) return;
    this.elapsed++;
    if (this.elapsed % this.options.period === 0) this.palette.rotate(this.options.first, this.options.count, this.options.direction ?? 1);
    if (this.options.duration !== undefined && this.elapsed >= this.options.duration) this.stop();
  }

  /** Arrête le cycle ; les couleurs d'origine reviennent si `options.restore` (ou `restore` explicite). */
  stop(restore = this.options.restore ?? false): void {
    if (!this.running) return;
    this.running = false;
    if (restore) this.palette.colors.set(this.original, this.options.first * 3);
  }
}

export class Palette {
  /** Table logique : 256 × RVB. */
  readonly colors: Uint8Array = createPalette();
  private fadeState: Fade | null = null;
  private readonly cyclers: PaletteCycler[] = [];

  /** Écrase les entrées d'un `SHPL` avec l'éclaircissement du jeu (`10a8:0640` puis `1098:0857`). */
  loadShpl(shpl: ShapeList): void {
    applyShpl(this.colors, shpl, true);
  }

  /** Écrase les entrées d'un `SHPL` ou `tPAL` sans éclaircissement (valeurs brutes de `tPAL`, `MPC/PVG.MHK`). */
  loadRaw(shpl: ShapeList): void {
    applyShpl(this.colors, shpl, false);
  }

  setColor(index: number, r: number, g: number, b: number): void {
    this.colors.set([r, g, b], index * 3);
  }

  /** Copie de `count` entrées dès `first` (768 octets pour la palette entière) : sauvegarde pour restaurer après un cycle (`10a8:0d9c`). */
  snapshot(first = 0, count = PALETTE_SIZE): Uint8Array {
    return this.colors.slice(first * 3, (first + count) * 3);
  }

  /** Recopie un instantané pris par `snapshot` (`10a8:0e86`). */
  restore(snapshot: Uint8Array, first = 0): void {
    this.colors.set(snapshot, first * 3);
  }

  /** Rotation d'un cran de la plage : `direction` +1 = chaque entrée prend la couleur suivante, -1 = la précédente. */
  rotate(first: number, count: number, direction: 1 | -1 = 1): void {
    if (count < 2) return;
    const range = this.colors.slice(first * 3, (first + count) * 3);
    for (let i = 0; i < count; i++) {
      const source = (i + direction + count) % count;
      this.colors.set(range.subarray(source * 3, source * 3 + 3), (first + i) * 3);
    }
  }

  // ---- fondus -------------------------------------------------------------------------------------------------------------

  get fade(): Fade | null {
    return this.fadeState;
  }

  /** Fondu de l'affichage actuel vers le noir. Le noir reste affiché (fondu « tenu ») jusqu'à `clearFade()` ou un autre fondu. */
  fadeToBlack(duration: number, first = ANIMATED_FIRST, count = ANIMATED_COUNT, quantized = false): Fade {
    return this.startFade(this.output(), new Uint8Array(PALETTE_BYTES), first, count, duration, quantized);
  }

  /** Fondu du noir vers la table logique courante (les chargements faits pendant le fondu sont pris en compte). Le fondu disparaît en fin de course. */
  fadeFromBlack(duration: number, first = ANIMATED_FIRST, count = ANIMATED_COUNT, quantized = false): Fade {
    return this.startFade(new Uint8Array(PALETTE_BYTES), null, first, count, duration, quantized);
  }

  /** Fondu de l'affichage actuel vers `target` (768 octets), tenu en fin de course. */
  fadeTo(target: Uint8Array, duration: number, first = ANIMATED_FIRST, count = ANIMATED_COUNT, quantized = false): Fade {
    return this.startFade(this.output(), target.slice(), first, count, duration, quantized);
  }

  /** Supprime le fondu (tenu ou en cours) : l'affichage revient à la table logique. */
  clearFade(): void {
    this.fadeState = null;
  }

  private startFade(from: Uint8Array, to: Uint8Array | null, first: number, count: number, duration: number, quantized: boolean): Fade {
    this.fadeState = new Fade(from, to, first, count, duration, quantized);
    return this.fadeState;
  }

  // ---- cycles -------------------------------------------------------------------------------------------------------------

  startCycle(options: CyclerOptions): PaletteCycler {
    const cycler = new PaletteCycler(this, options);
    this.cyclers.push(cycler);
    return cycler;
  }

  stopCycles(restore = false): void {
    for (const cycler of this.cyclers) cycler.stop(restore);
    this.cyclers.length = 0;
  }

  /** Avance d'un tick (60 Hz) le fondu et tous les cycles ; les cycles terminés sont retirés. */
  tick(): void {
    this.fadeState?.tick();
    if (this.fadeState?.to === null && this.fadeState.done) this.fadeState = null;
    for (const cycler of this.cyclers) cycler.tick();
    for (let i = this.cyclers.length - 1; i >= 0; i--) if (!this.cyclers[i]!.active) this.cyclers.splice(i, 1);
  }

  /** Palette à afficher (768 octets RVB) : table logique avec le fondu appliqué. `out` est réutilisé s'il est fourni. */
  output(out: Uint8Array = new Uint8Array(PALETTE_BYTES)): Uint8Array {
    out.set(this.colors);
    this.fadeState?.mix(out, this.colors);
    return out;
  }
}
