import type { PointClickEngine } from "../../../ui/point-click-app";
import type { VoyageursGame } from "../create";
import type { VoyageursEngine } from "../engine/game";
import { CURSOR_PALETTE, CURSOR_SIZE, CURSOR_TRANSPARENT, type CursorImage, cursorForCommand } from "../render/cursor";
import { PALETTE_COLORS } from "../render/palette";
import { SCREEN_HEIGHT, SCREEN_SIZE, SCREEN_WIDTH } from "../render/draw";

/** Indices du curseur dans la palette présentée : après les 16 couleurs du jeu (0 noir, 1 blanc de `CURSOR_PALETTE`). */
const CURSOR_BASE = PALETTE_COLORS;

export interface VoyageursLoopOptions {
  game: VoyageursGame;
  /** Peint une image indexée (`IndexedPresenter.present`) ; les tableaux ne valent que pendant l'appel. */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Position du pointeur (le curseur est dessiné là, sans attendre le moteur). */
  pointer(): { x: number; y: number };
  /** Le curseur de la souris est caché (dernier geste au doigt). */
  touchMode(): boolean;
}

/** Dessine un curseur 16 x 16 dans `page` (indices de la palette présentée), point chaud sur (x, y). */
export function drawCursor(page: Uint8Array, cursor: CursorImage, x: number, y: number): void {
  for (let row = 0; row < CURSOR_SIZE; row++) {
    const py = y - cursor.hotspotY + row;
    if (py < 0 || py >= SCREEN_HEIGHT) continue;
    for (let col = 0; col < CURSOR_SIZE; col++) {
      const px = x - cursor.hotspotX + col;
      if (px < 0 || px >= SCREEN_WIDTH) continue;
      const value = cursor.pixels[row * CURSOR_SIZE + col]!;
      if (value !== CURSOR_TRANSPARENT) page[py * SCREEN_WIDTH + px] = CURSOR_BASE + value;
    }
  }
}

/**
 * Boucle d'un pas de 10 ms (`STEP_MS`) : `tick` appelle `VoyageursEngine.step` (un tick de jeu dure 11 à 12 pas, plus les fondus et les
 * attentes de clic). `render` peint l'image du moment : la page du rendu et sa palette (16 couleurs 9 bits ramenées sur 8 bits), avec le
 * curseur de la souris par-dessus (le moteur ne le dessine pas), indices 16 et 17 de la palette présentée.
 */
export class VoyageursLoop implements PointClickEngine {
  private readonly scratch = new Uint8Array(SCREEN_SIZE);
  private readonly palette = new Uint8Array(768);

  constructor(private readonly options: VoyageursLoopOptions) {
    for (let i = 0; i < CURSOR_PALETTE.length; i++) this.palette.set(CURSOR_PALETTE[i]!, (CURSOR_BASE + i) * 3);
  }

  get engine(): VoyageursEngine {
    return this.options.game.engine;
  }

  tick(): void {
    this.options.game.engine.step();
  }

  /** La partie peut être sauvegardée maintenant (début de tick, ni menu ni message). */
  get canSave(): boolean {
    return this.options.game.engine.canSave();
  }

  /** Le menu du jeu (système) peut s'ouvrir : le bouton « Système » de la barre tactile a un effet. */
  get canSkip(): boolean {
    const { engine } = this.options.game;
    return !engine.inMenu && !engine.state.disableSystemMenu && !engine.quitRequested;
  }

  render(): void {
    const { engine, renderer } = this.options.game;
    this.scratch.set(renderer.backBuffer);
    this.palette.set(renderer.screenRgb());
    if (!this.options.touchMode() && !engine.quitRequested) {
      const { x, y } = this.options.pointer();
      drawCursor(this.scratch, cursorForCommand(engine.state.playerCommand), x, y);
    }
    this.options.present(this.scratch, this.palette);
  }
}
