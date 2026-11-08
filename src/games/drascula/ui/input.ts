import { PointerQueue } from "../../../ui/pointer-queue";
import { FRAME_TICKS } from "../engine/cadence";
import type { DrasculaInput } from "../engine/host";

/** Écran logique du jeu. */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/**
 * Ticks entre un déplacement du curseur et l'appui qui le suit : deux images de la boucle principale. Le moteur décide « souris sur la
 * barre des verbes » (`menuBar`) à la fin de chaque image, d'après la position de la souris à cet instant : un appui reçu juste après un
 * saut de position (un doigt qui n'a pas de survol, une souris téléportée, un pavé tactile qui tape) lirait l'ancienne position et
 * choisirait un verbe en cliquant dans la pièce, ou l'inverse (`rooms.md` § 7). Une image pleine entre les deux le laisse se mettre
 * à jour, comme le fait la souris qui bouge avant de cliquer ; une souris qui bouge puis clique plus tard n'attend rien.
 */
export const TAP_DELAY_TICKS = 2 * FRAME_TICKS;

/**
 * File des entrées du moteur (`DrasculaHost.pollInput`) : la file commune des jeux à pointeur (`ui/pointer-queue.ts`), réglée sur
 * l'écran de 320 x 200 et sur `TAP_DELAY_TICKS`, qui produit les événements `DrasculaInput`.
 */
export class InputQueue extends PointerQueue<DrasculaInput> {
  constructor() {
    super({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      tapDelayTicks: TAP_DELAY_TICKS,
      pointer: (x, y, buttons) => ({ type: "pointer", x, y, buttons }),
      key: (key) => ({ type: "key", key }),
    });
  }
}
