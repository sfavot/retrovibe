import type { BassGame } from "../create";
import type { BassEngine } from "../engine/game";
import { SF } from "../engine/ids";
import { startGameAfterIntro } from "../engine/sequences/intro";
import type { PointClickEngine } from "../../../ui/point-click-app";
import { MouseCursor, type CursorOverlay, drawCursor } from "../render/cursor";
import { SCREEN_SIZE } from "../render/frame-buffer";

export interface BassLoopOptions {
  game: BassGame;
  /** Curseur de la souris, dessiné par-dessus l'écran (`CursorOverlay`). */
  overlay: CursorOverlay;
  /** Peint une image indexée (`IndexedPresenter.present`) ; les tableaux ne valent que pendant l'appel. */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Le curseur de la souris est caché (dernier geste au doigt), sauf objet tenu. */
  touchMode(): boolean;
  /** L'introduction est finie (jouée ou passée) et le jeu vient de commencer : réglages mémorisés à remettre. */
  onGameStart?(): void;
}

/**
 * Boucle d'un tick de 20 ms (`TICK_MS`) : l'introduction du CD d'abord (`BassIntro`, avant le moteur), puis le moteur (`BassEngine.tick`).
 * `render` peint l'écran du moment, avec le curseur de la souris par-dessus pendant le jeu (le moteur ne le met jamais dans `frame`) : la
 * copie de l'image reçoit le curseur en indices (`drawCursor`) puis passe par la palette de l'écran, comme `toRgbaWithCursor`.
 */
export class BassLoop implements PointClickEngine {
  private readonly game: BassGame;
  private readonly scratch = new Uint8Array(SCREEN_SIZE);
  private introOver: boolean;

  constructor(private readonly options: BassLoopOptions) {
    this.game = options.game;
    this.introOver = this.game.intro === null;
    this.game.intro?.start();
  }

  get engine(): BassEngine {
    return this.game.engine;
  }

  /** L'introduction tourne encore. */
  get introRunning(): boolean {
    return !this.introOver;
  }

  tick(): void {
    const intro = this.game.intro;
    if (!this.introOver && intro) {
      intro.tick();
      if (!intro.running) this.endIntro();
      return;
    }
    this.game.engine.tick();
  }

  /**
   * Saute ce qui reste de l'introduction et démarre le jeu (un chargement de partie pendant l'introduction, « Passer » appelé avant
   * qu'elle ait commencé). Sans effet une fois le jeu commencé.
   */
  endIntro(): void {
    const intro = this.game.intro;
    if (this.introOver || !intro) return;
    for (let guard = 0; intro.running && guard < 8; guard++) {
      intro.skip();
      intro.tick();
    }
    this.introOver = true;
    startGameAfterIntro(this.game.engine, intro.outcome ?? "skipped");
    this.options.onGameStart?.();
  }

  /** Vrai si la sauvegarde est possible : le jeu a commencé et aucun effet bloquant ne tient le tour de logique. */
  get canSave(): boolean {
    return this.introOver && !this.game.engine.blocked;
  }

  /** « Passer » a un effet : introduction en cours, ou jeu qui tourne (réplique à passer). */
  get canSkip(): boolean {
    const { control } = this.game.engine;
    return !this.introOver || !control.frozen;
  }

  /** Un choix de dialogue est affiché (`SF_CHOOSING`) : la première ligne est tout en haut de l'écran. */
  get choosing(): boolean {
    return (this.game.engine.system.systemFlags & SF.CHOOSING) !== 0;
  }

  render(): void {
    const { engine, renderer } = this.game;
    if (!this.introOver && this.game.intro?.canvas) {
      const { frame } = this.game.intro.canvas;
      this.options.present(frame.pixels, frame.palette);
      return;
    }
    if (!renderer) return;
    this.scratch.set(renderer.frame.pixels);
    const mouse = engine.mouse;
    // Au doigt, pas de curseur flottant : seulement l'objet tenu (`engine.md` § 17).
    if (!this.options.touchMode() || (mouse.cursor === MouseCursor.heldObject && mouse.objectCursor >= 0)) {
      const image = this.options.overlay.image(mouse);
      if (image) drawCursor(this.scratch, image, mouse.pointerX, mouse.pointerY);
    }
    this.options.present(this.scratch, renderer.frame.palette);
  }
}
