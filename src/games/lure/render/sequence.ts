/**
 * Rendu des séquences plein écran (introduction, chute, tonneau, capture, fin) : l'image et la palette que la séquence écrit dans
 * `SequenceScreen` (`engine/sequences/screen.ts`), précédées, pour les séquences jouées en cours de partie, du fondu au noir de la
 * dernière image de la pièce.
 *
 * Réécriture de la partie « écran » de `AnimationSequence`, `Introduction::showScreen`, `Game::displayChuteAnimation`,
 * `displayBarrelAnimation` et de `Screen::paletteFadeOut` (engines/lure, ScummVM, GPL v3+).
 *
 * Écarts volontaires : les fondus entrants et sortants **dans** une séquence sont écrits par la séquence (par pas de 20 ms sur l'horloge du
 * moteur, quatre par image de logique) ; seul le fondu de la pièce qui précède (`holdRoom`) est animé ici, par pas de 20 ms comme
 * `LureRenderer` le fait pour un changement de pièce, `fading` disant à l'hôte de suspendre `engine.tick()` (ScummVM y est bloqué). Il porte sur
 * les 220 premières entrées (`paletteFadeOut()` sans argument), pas sur 255 comme celui d'un changement de pièce.
 */

import type { SequenceScreen } from "../engine/sequences/screen";
import { RES_PALETTE_ENTRIES } from "../data/palette";
import { fadeOutStep, FADE_STEP_MS } from "./palette";

/** Dernière image présentée de la pièce (celle qui s'éteint avant une séquence de partie). */
export interface PreviousImage {
  readonly image: Uint8Array;
  readonly palette: Uint8Array;
  readonly valid: boolean;
}

export class SequenceView {
  private holding = false;
  private fadingRoom = false;
  private carryMs = 0;

  /** La pièce précédente s'éteint : l'hôte suspend les ticks du moteur. */
  get fading(): boolean {
    return this.fadingRoom;
  }

  /** La séquence est finie ou arrêtée : le prochain fondu de la pièce repartira de zéro. */
  reset(): void {
    this.holding = false;
    this.fadingRoom = false;
    this.carryMs = 0;
  }

  /**
   * Compose l'image de la séquence dans `image` et `palette` (320 x 200 indices, 768 octets). Rend vrai si c'est un écran de la séquence
   * elle-même (que le rendu garde alors pour le fondu de la pièce suivante), faux pendant le fondu de la pièce précédente.
   */
  render(screen: SequenceScreen, previous: PreviousImage, image: Uint8Array, palette: Uint8Array, elapsedMs: number): boolean {
    if (screen.holdRoom) {
      if (!this.holding) {
        this.holding = true;
        this.carryMs = 0;
        this.fadingRoom = previous.valid;
        palette.set(previous.palette);
      }
      this.carryMs += elapsedMs;
      while (this.fadingRoom && this.carryMs >= FADE_STEP_MS) {
        this.carryMs -= FADE_STEP_MS;
        if (!fadeOutStep(palette, RES_PALETTE_ENTRIES)) this.fadingRoom = false;
      }
      image.set(previous.valid ? previous.image : screen.pixels);
      return false;
    }
    this.holding = false;
    this.fadingRoom = false;
    image.set(screen.pixels);
    palette.set(screen.palette);
    return true;
  }
}
