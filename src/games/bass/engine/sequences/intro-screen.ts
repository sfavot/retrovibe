/**
 * Écran de l'introduction : ce que `Intro` demande à `Screen` (images fixes, fondus de palette, séquences « flirt », effacement du bas).
 *
 * Référence : ScummVM engines/sky/screen.cpp (`Screen::showScreen(fileNum, fullscreen)`, `renderFinalFrame`, `paletteFadeUp`, `fnFadeDown`,
 * `palette_fadedown_helper`, `startSequence`, `processSequence`, `stopSequence`, `clearScreen`) et intro.cpp (`CLEARBOTTOM`), GPL v3 ou
 * ultérieure ; lu puis réécrit. Les calculs sont ceux de `render/` (`showFullImage`, `fadeDownStep`, `fadeUpStep`) et de
 * `data/sequence.ts` ; ce module ne fait que tenir l'état, comme `BassScreenRenderer` pour le jeu.
 *
 * L'introduction a son propre écran : le moteur de jeu n'existe pas encore (ses compacts, ses variables) quand elle tourne. L'hôte
 * affiche `frame` (`frame.toRgba()`, 320 x 200) et redessine quand `presented` change, comme avec `BassScreenRenderer`.
 *
 * Écarts volontaires :
 * - ScummVM 2.x n'envoie à la machine que 192 lignes (`renderFinalFrame` ignore `fullscreen`, régression notée dans `graphics.md`) : les
 *   images « plein écran » (`FULLSCREEN`) sont ici présentées sur leurs 200 lignes, comme l'original ; les autres en présentent 192 et
 *   laissent les 8 dernières lignes de la machine telles quelles (`CLEARBOTTOM` les efface) ;
 * - pas d'attente de deux ticks dans `stopSequence` (`waitForTick` x 2 ne sert qu'à laisser la machine finir l'image).
 */

import { SEQUENCE_FRAME_MS, SequenceDecoder } from "../../data/sequence";
import { GAME_COLORS, PALETTE_BYTES, vgaPaletteToRgb } from "../../data/palette";
import { showFullImage } from "../../render/draw";
import { FrameBuffer, GAME_SCREEN_SIZE, SCREEN_SIZE, SCREEN_WIDTH, initialPalette } from "../../render/frame-buffer";
import { fadeDownStep, fadeUpStep } from "../../render/palette-fade";

/** Ce que la séquence d'introduction demande à l'écran. */
export interface IntroScreen {
  /** `setPalette(fichier)` : palette VGA 6 bits appliquée tout de suite (`initVirgin`). */
  setPalette(vgaPalette: Uint8Array): void;
  /** `showScreen(fichier, plein écran)` : image de 64 000 octets, montrée telle quelle. */
  showScreen(image: Uint8Array, fullscreen: boolean): void;
  /** Cible d'un fondu en entrée (`paletteFadeUp` : fichier de palette VGA 6 bits) ; les pas suivent par `fadeUpStep`. */
  beginFadeUp(vgaPalette: Uint8Array): void;
  /** Pas `step` (1 à 32) du fondu en entrée en cours. */
  fadeUpStep(step: number): void;
  /** Un pas du fondu au noir (`fnFadeDown(0)` en compte 32). */
  fadeDownStep(): void;
  /** `startSequence` : images lues dans `data`, la première à `now + 60` ms. */
  startSequence(data: Uint8Array, now: number): void;
  sequenceRunning(): boolean;
  /** `seqFramesLeft` : images qu'il reste à jouer. */
  sequenceFramesLeft(): number;
  /** `processSequence` : une image toutes les 60 ms. */
  processSequence(now: number): void;
  stopSequence(): void;
  /** `CLEARBOTTOM` : les 8 dernières lignes à 0, écran de travail et machine. */
  clearBottom(): void;
  /** `clearScreen` : écran de travail à 0, présenté. */
  clear(): void;
}

export interface IntroCanvasOptions {
  /**
   * Reproduit `renderFinalFrame` de ScummVM 2.x, qui n'envoie que 192 lignes même pour une image `FULLSCREEN` : les 8 dernières lignes
   * de la machine restent noires. Faux par défaut (200 lignes, comme l'original) ; les tests de comparaison au banc le posent.
   */
  scummvmBottomLines?: boolean;
}

export class IntroCanvas implements IntroScreen {
  /** Écran de la machine et sa palette (240 couleurs de jeu + 16 couleurs d'interface). */
  readonly frame = new FrameBuffer();
  /** Compte les présentations : l'hôte redessine quand il change. */
  presented = 0;

  /** `_currentScreen`. */
  private readonly current = new Uint8Array(SCREEN_SIZE);
  /** `_palette`. */
  private readonly work = initialPalette();
  private fadeTarget: Uint8Array = new Uint8Array(PALETTE_BYTES);
  private decoder: SequenceDecoder | null = null;
  private nextFrame = 0;

  constructor(private readonly options: IntroCanvasOptions = {}) {}

  /** Écran de travail (`giveCurrent`), pour les tests. */
  get workScreen(): Uint8Array {
    return this.current;
  }

  /** Palette de travail (`_palette`), pour les tests. */
  get workPalette(): Uint8Array {
    return this.work;
  }

  setPalette(vgaPalette: Uint8Array): void {
    this.work.set(vgaPaletteToRgb(vgaPalette));
    this.setMachinePalette();
  }

  showScreen(image: Uint8Array, fullscreen: boolean): void {
    showFullImage(this.current, image, fullscreen);
    this.present(fullscreen && !this.options.scummvmBottomLines ? SCREEN_SIZE : GAME_SCREEN_SIZE);
  }

  beginFadeUp(vgaPalette: Uint8Array): void {
    this.fadeTarget = vgaPaletteToRgb(vgaPalette);
  }

  fadeUpStep(step: number): void {
    fadeUpStep(this.fadeTarget, step, this.work);
    this.setMachinePalette();
  }

  fadeDownStep(): void {
    fadeDownStep(this.work);
    this.setMachinePalette();
  }

  startSequence(data: Uint8Array, now: number): void {
    if (!data.length) throw new Error("séquence invalide : fichier vide");
    // `framesLeft = seqData[0]` : toutes les images (la variante d'un compact en a une de moins, `startSequenceItem`).
    this.decoder = new SequenceDecoder(data, data[0]!);
    this.nextFrame = now + SEQUENCE_FRAME_MS;
  }

  sequenceRunning(): boolean {
    return this.decoder !== null;
  }

  sequenceFramesLeft(): number {
    return this.decoder?.framesLeft ?? 0;
  }

  processSequence(now: number): void {
    const decoder = this.decoder;
    if (!decoder || now < this.nextFrame) return;
    this.nextFrame += SEQUENCE_FRAME_MS;
    const dirty = decoder.next(this.current);
    if (dirty) {
      // `renderRect` des blocs de 16 x 16 modifiés.
      for (let by = 0; by < 12; by++) {
        for (let bx = 0; bx < 20; bx++) {
          if (!dirty[by * 20 + bx]) continue;
          for (let line = 0; line < 16; line++) {
            const pos = (by * 16 + line) * SCREEN_WIDTH + bx * 16;
            this.frame.pixels.set(this.current.subarray(pos, pos + 16), pos);
          }
        }
      }
      this.presented++;
    }
    if (!decoder.running) this.decoder = null;
  }

  stopSequence(): void {
    this.decoder = null;
    this.nextFrame = 0;
  }

  clearBottom(): void {
    this.current.fill(0, GAME_SCREEN_SIZE, SCREEN_SIZE);
    this.frame.pixels.fill(0, GAME_SCREEN_SIZE, SCREEN_SIZE);
    this.presented++;
  }

  clear(): void {
    this.current.fill(0);
    this.present(GAME_SCREEN_SIZE);
  }

  /** `copyRectToScreen` des `size` premiers octets de l'écran de travail. */
  private present(size: number): void {
    this.frame.pixels.set(this.current.subarray(0, size));
    this.presented++;
  }

  private setMachinePalette(): void {
    this.frame.setRgbPalette(this.work.subarray(0, GAME_COLORS * 3));
    this.presented++;
  }
}
