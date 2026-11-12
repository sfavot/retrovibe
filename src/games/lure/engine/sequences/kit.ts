/**
 * Outils des séquences plein écran : horloge, attentes interruptibles, fondus de palette, musique.
 *
 * Source (ScummVM, GPL v3+) : `Introduction::interruptableDelay`, `Events::interruptableDelay` (events.cpp), `AnimationSequence::delay`
 * (animseq.cpp), `Screen::paletteFadeIn`, `paletteFadeOut`, `setPaletteEmpty`, `setPalette` (screen.cpp), `SoundManager::fadeOut`
 * (sound.cpp).
 *
 * Écarts volontaires :
 * - ScummVM attend avec `getMillis()` ; ici l'horloge est celle du moteur (images de 80 ms) et chaque attente part de l'échéance de la
 *   précédente (`deadline`), pas de l'instant où elle commence : les images d'une animation à 140 ms tombent à 0, 140, 280 ms... arrondis
 *   à l'image de logique suivante, sans dérive. Une attente interrompue (clic, touche) repart de l'instant présent (`sync`) ;
 * - les événements reçus pendant un fondu sont perdus, comme dans ScummVM (`while (events.pollEvent());`) ;
 * - une action du clavier est une touche (l'hôte traduit les touches en actions, `LureAction`) : Échap est `kActionEscape`.
 */

import { type Sequence, waitUntil } from "../../../../engine/sequence";
import type { Palette } from "../../data/palette";
import { GAME_COLORS, RES_PALETTE_ENTRIES } from "../../data/palette";
import { emptyPalette, FADE_STEP_MS, fadeInStep, fadeOutStep, rgb768 } from "../../render/palette";
import type { LureContext } from "../context";
import type { SequencePort } from "./port";
import type { SequenceScreen } from "./screen";

/** Ce qui a interrompu une attente : Échap (`kActionEscape`), une autre action du clavier, un clic gauche, rien. */
export type Interrupt = "none" | "escape" | "key" | "click";

/** Durée du fondu de la musique (`startFade(3000, 0)`). */
export const MUSIC_FADE_MS = 3000;

export class SequenceKit {
  /** Échéance de la prochaine attente (ms du moteur). */
  deadline: number;

  constructor(
    readonly ctx: LureContext,
    readonly port: SequencePort,
  ) {
    this.deadline = port.nowMs();
  }

  get screen(): SequenceScreen {
    return this.port.screen;
  }

  /** Repart de l'instant présent (après une attente interrompue ou qui dépend d'un événement). */
  sync(): void {
    this.deadline = this.port.nowMs();
  }

  /** Attente non interruptible (`delayMillis` des fondus) : les événements reçus pendant ce temps sont perdus (le moteur les vide à chaque tick). */
  *sleep(ms: number): Sequence {
    this.deadline += ms;
    yield* waitUntil(() => this.port.nowMs() >= this.deadline);
  }

  /**
   * `Events::interruptableDelay` : attend `ms` ; rend ce qui l'a interrompue (une touche, un clic gauche ; le reste des événements est
   * ignoré). Le premier événement décide.
   */
  *interruptableDelay(ms: number): Sequence<Interrupt> {
    this.deadline += ms;
    let hit: Interrupt = "none";
    yield* waitUntil(() => {
      for (const event of this.port.takeEvents()) {
        if (event.type === "action") hit = event.action === "escape" ? "escape" : "key";
        else if (event.type === "lbuttondown") hit = "click";
        if (hit !== "none") break;
      }
      return hit !== "none" || this.port.nowMs() >= this.deadline;
    });
    if (hit !== "none") this.sync();
    return hit;
  }

  /** `Introduction::interruptableDelay` : vrai si Échap est pressée (abandon de l'introduction) ; un clic ou une autre touche termine l'attente. */
  *introDelay(ms: number): Sequence<boolean> {
    return (yield* this.interruptableDelay(ms)) === "escape";
  }

  /** Attend une touche ou un clic (`while (!interruptableDelay(20))`). */
  *waitForKey(): Sequence {
    yield* waitUntil(() => this.port.takeEvents().some((e) => e.type === "action" || e.type === "lbuttondown"));
    this.sync();
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Palette
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** `Screen::setPaletteEmpty(numEntries)`. */
  emptyPalette(numEntries = RES_PALETTE_ENTRIES): void {
    emptyPalette(this.screen.palette, numEntries);
  }

  /** `Screen::setPalette(p)` ou `setPalette(p, 0, p.numEntries)` : sans fondu ; seules les entrées de `p` changent. */
  setPalette(palette: Palette): void {
    this.screen.palette.set(palette.rgb.subarray(0, palette.numEntries * 3));
  }

  /** `Screen::paletteFadeIn(p)` : pas de 4 par composante toutes les 20 ms, jusqu'à la palette. */
  *fadeIn(palette: Palette): Sequence {
    const target = rgb768(palette);
    while (fadeInStep(this.screen.palette, target, palette.numEntries)) yield* this.sleep(FADE_STEP_MS);
  }

  /** `Screen::paletteFadeOut(numEntries)` : défaut 220 entrées (`RES_PALETTE_ENTRIES`). */
  *fadeOut(numEntries = RES_PALETTE_ENTRIES): Sequence {
    while (fadeOutStep(this.screen.palette, Math.min(numEntries, GAME_COLORS))) yield* this.sleep(FADE_STEP_MS);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Musique
  // ---------------------------------------------------------------------------------------------------------------------------------

  /**
   * `SoundManager::fadeOut` : fondu de 3 s de tous les sons ; rend vrai si Échap l'interrompt. Un clic ou une autre touche interrompt le
   * fondu (qui va à son terme au plus vite) mais pas l'introduction.
   */
  *fadeOutMusic(): Sequence<boolean> {
    const sound = this.ctx.sound;
    sound.startFadeOut?.();
    const start = this.port.nowMs();
    let aborted = false;
    let escape = false;
    this.sync();
    // Un test sans son (`SilentSound`) attend les 3 s de ScummVM ; avec le son, on suit son fondu, borné à 3 s et demie.
    yield* waitUntil(() => {
      for (const event of this.port.takeEvents()) {
        if (event.type === "action" || event.type === "lbuttondown") {
          aborted = true;
          escape = event.type === "action" && event.action === "escape";
          break;
        }
      }
      if (aborted) return true;
      const elapsed = this.port.nowMs() - start;
      if (elapsed >= MUSIC_FADE_MS + FADE_SLACK_MS) return true;
      return sound.fading === undefined ? elapsed >= MUSIC_FADE_MS : sound.fading === false;
    });
    if (sound.finishFadeOut) sound.finishFadeOut(aborted);
    else sound.killSounds();
    this.sync();
    return escape;
  }
}

/** Marge laissée au fondu de la musique avant de le tenir pour fini (l'horloge sonore peut retarder). */
const FADE_SLACK_MS = 500;
