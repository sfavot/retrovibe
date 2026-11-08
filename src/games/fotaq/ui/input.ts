import { PointerQueue } from "../../../ui/pointer-queue";
import type { FotaqAction, FotaqInput } from "../engine/host";

/** Écran logique du jeu. */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/**
 * Ticks entre un déplacement du curseur et l'appui qui le suit : une image du jeu (un tick = 100 ms). Le moteur retrouve l'objet sous
 * le curseur une fois par image (`Command::update`, nom de l'objet dans la ligne de commande) : un appui reçu juste après un saut de
 * position (un doigt qui n'a pas de survol, une souris téléportée, un pavé tactile qui tape) agirait sur l'ancien objet. Une image
 * pleine entre les deux le laisse se mettre à jour ; une souris qui bouge puis clique plus tard n'attend rien.
 */
export const TAP_DELAY_TICKS = 1;

/**
 * File des entrées du moteur (`FotaqHost.pollInput`) : la file commune des jeux à pointeur (`ui/pointer-queue.ts`), réglée sur l'écran
 * de 320 x 200 et sur `TAP_DELAY_TICKS`. Les touches sont des actions nommées du moteur (`FotaqAction`, `keys.ts`) : `key(action)`.
 */
export class InputQueue extends PointerQueue<FotaqInput> {
  constructor() {
    super({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      tapDelayTicks: TAP_DELAY_TICKS,
      pointer: (x, y, buttons) => ({ type: "pointer", x, y, buttons }),
      key: (action) => ({ type: "action", action: action as FotaqAction }),
    });
  }

  /** Action du moteur (touche déjà traduite). */
  action(action: FotaqAction): void {
    this.key(action);
  }
}
