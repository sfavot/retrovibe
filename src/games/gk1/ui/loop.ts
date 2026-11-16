import type { PointClickEngine } from "../../../ui/point-click-app";
import { soundManagerOf } from "../engine/kernel/sound";
import { TICKS_PER_SECOND } from "../engine/ids";
import { runFrame } from "../engine/loop";
import { canSaveGame } from "../engine/save";
import { RunStatus, type Vm } from "../engine/vm";
import { frameoutOf } from "../render/frameout";
import { seqPlayerOf } from "../render/seq-player";

/** Durée d'une image du jeu (ms) : 60 par seconde (`docs/gk1/plan.md`, D13). */
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Images rattrapées au plus par image d'écran : un onglet ralenti ne fait pas défiler le jeu en accéléré. */
export const MAX_CATCH_UP_TICKS = 4;

export interface Gk1LoopOptions {
  vm: Vm;
  /** Reçoit chaque image, curseur du jeu compris (`IndexedPresenter.present`). */
  present(pixels: Uint8Array, palette: Uint8Array): void;
  /** Prévenu avant chaque image du jeu : la sortie de la musique y recale son horloge (`audio/web-music.ts`). */
  beforeFrame?(): void;
}

/**
 * Ce que la page des jeux de pointer-et-cliquer (`ui/point-click-app.ts`) fait avancer : la machine virtuelle et son image.
 *
 * - **Un tick de la page = une image du jeu** (`engine/loop.ts` : un tick d'horloge, puis les scripts jusqu'au `FrameOut`),
 *   puis le gestionnaire de sons avance jusqu'à l'horloge du jeu (elle a pu avancer de plusieurs ticks).
 * - **« Passer »** : seulement pendant une cinématique `SEQ`, qu'un appui ou Échap interrompt (`engine/events.ts`).
 * - **Sauvegarder** : à tout moment, sauf pendant une cinématique (`canSaveGame`).
 * - `finished` : `play` est revenu (« Quitter » du jeu) ; la page retourne à l'écran titre.
 */
export class Gk1Loop implements PointClickEngine {
  private done = false;
  private count = 0;

  constructor(private readonly options: Gk1LoopOptions) {}

  tick(): void {
    if (this.done) return;
    const { vm } = this.options;
    this.options.beforeFrame?.();
    if (runFrame(vm).status === RunStatus.Finished) this.done = true;
    else this.count++;
    soundManagerOf(vm).advanceTo(vm.ticks);
  }

  render(): void {
    const frameout = frameoutOf(this.options.vm);
    this.options.present(frameout.present(), frameout.palette.screen);
  }

  /** Images du jeu jouées. */
  get frames(): number {
    return this.count;
  }

  get finished(): boolean {
    return this.done;
  }

  get canSave(): boolean {
    return !this.done && canSaveGame(this.options.vm);
  }

  get canSkip(): boolean {
    return seqPlayerOf(this.options.vm).playing;
  }

  /** Avance de `frames` images à la main et repeint : console de la page, vérifications. */
  step(frames = 1): void {
    for (let i = 0; i < frames; i++) this.tick();
    this.render();
  }
}
