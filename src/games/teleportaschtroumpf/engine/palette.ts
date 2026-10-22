import { PALETTE_BYTES } from "../data/mcg";

/** Pas par défaut d'un fondu (`1523:01fa(0x10)` / `1523:00ee(0x10)`) : n + 1 = 17 pas. */
export const FADE_STEPS = 16;
/** Un pas de fondu par balayage vertical VGA (≈ 70 Hz) ; l'horloge de jeu tourne à 60 Hz. */
const FADE_STEP_RATE = 70;
const TICK_RATE = 60;

/** 6 bits du DAC VGA → 8 bits d'écran : `(v >> 2) × 255 / 63` (arrondi). */
const DAC_TO_8_BITS = Array.from({ length: 256 }, (_, v) => Math.round(((v >> 2) * 255) / 63));

/**
 * Palette courante : 256 entrées RVB 8 bits (comme le tampon `DS:57C0`), plus le niveau de fondu courant.
 *
 * - l'entrée 0 est **toujours** affichée noire (`1523:0235` met les 3 premiers octets à zéro) ;
 * - `display()` donne la palette envoyée à l'écran : fondu appliqué, puis quantification du DAC (6 bits).
 */
export class Palette {
  readonly colors = new Uint8Array(PALETTE_BYTES);
  /** Fondu : pas courant `step` sur `steps` ; 0 = pleine luminosité, `steps` = noir. */
  private step = 0;
  private steps = FADE_STEPS;

  /** Copie des entrées `[start, start + count)` depuis `source` (768 octets pour une palette complète). */
  load(source: Uint8Array, start = 0, count = 256): void {
    const from = start * 3;
    this.colors.set(source.subarray(from, from + count * 3), from);
    this.colors[0] = this.colors[1] = this.colors[2] = 0;
  }

  setColor(index: number, r: number, g: number, b: number): void {
    this.colors[index * 3] = r;
    this.colors[index * 3 + 1] = g;
    this.colors[index * 3 + 2] = b;
  }

  /** Règle le fondu : `step` sur `steps` (0 = visible, `steps` = noir). */
  setFade(step: number, steps: number): void {
    this.steps = steps;
    this.step = Math.min(Math.max(step, 0), steps);
  }

  get fadeStep(): number {
    return this.step;
  }

  get fadeSteps(): number {
    return this.steps;
  }

  /** Vrai si l'écran est entièrement noir à cause d'un fondu. */
  get black(): boolean {
    return this.step >= this.steps;
  }

  /** Palette d'affichage (768 octets RVB 8 bits) ; `into` évite une allocation. */
  display(into: Uint8Array = new Uint8Array(PALETTE_BYTES)): Uint8Array {
    const { colors, step, steps } = this;
    for (let i = 0; i < PALETTE_BYTES; i++) {
      // pal[i] − floor(cur × pal[i] / n) : formule de `1523:0116` (division entière).
      const v = colors[i] - Math.floor((step * colors[i]) / steps);
      into[i] = DAC_TO_8_BITS[v];
    }
    into[0] = into[1] = into[2] = 0;
    return into;
  }
}

/**
 * Fondu de palette piloté par l'horloge de jeu : le moteur appelle `tick()` à chaque tick.
 * `out()` assombrit jusqu'au noir et y reste (comme l'original, qui efface l'écran) ; `in()` part du noir
 * et revient à la pleine luminosité. Un fondu de n dure n + 1 pas à ≈ 70 pas/s (≈ 0,24 s pour 16).
 */
export class Fade {
  private mode: "out" | "in" | null = null;
  private elapsed = 0;

  constructor(private readonly palette: Palette) {}

  /** Vrai tant qu'un fondu est en cours. */
  get active(): boolean {
    return this.mode !== null;
  }

  /** Assombrit jusqu'au noir. */
  out(steps = FADE_STEPS): void {
    this.begin("out", steps);
  }

  /** Part du noir et révèle la palette. */
  in(steps = FADE_STEPS): void {
    this.begin("in", steps);
  }

  /** Annule tout fondu : écran à pleine luminosité. */
  reset(): void {
    this.mode = null;
    this.palette.setFade(0, FADE_STEPS);
  }

  /** Annule tout fondu : écran noir (la palette reste chargée). */
  blackout(): void {
    this.mode = null;
    this.palette.setFade(FADE_STEPS, FADE_STEPS);
  }

  tick(): void {
    if (!this.mode) return;
    this.elapsed++;
    this.apply();
  }

  private begin(mode: "out" | "in", steps: number): void {
    this.mode = mode;
    this.elapsed = 0;
    this.palette.setFade(mode === "out" ? 0 : steps, steps);
  }

  private apply(): void {
    const { palette, mode } = this;
    const steps = palette.fadeSteps;
    const done = Math.min(steps, Math.floor((this.elapsed * FADE_STEP_RATE) / TICK_RATE));
    palette.setFade(mode === "out" ? done : steps - done, steps);
    if (done >= steps) this.mode = null;
  }
}
