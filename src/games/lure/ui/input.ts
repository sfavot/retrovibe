import { PointerQueue } from "../../../ui/pointer-queue";
import type { LureAction, LureInput } from "../engine/host";

/** Écran logique du jeu. */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/**
 * Ticks entre un déplacement du curseur et l'appui qui le suit : une image du jeu (un tick = 80 ms). Le moteur retrouve le hotspot
 * sous le curseur une fois par image (`checkCursor`) : un appui reçu juste après un saut de position (un doigt, une souris téléportée)
 * agirait sur l'ancien hotspot. Une image pleine entre les deux le laisse se mettre à jour ; une souris qui bouge puis clique plus tard
 * n'attend rien (voir `ui/pointer-queue.ts`).
 */
export const TAP_DELAY_TICKS = 1;

/** Actions des combats : tenues enfoncées jusqu'à `actionEnd` (relâchement de la touche). */
export function isFightAction(action: LureAction): boolean {
  return action.startsWith("fight");
}

// La file commune ne connaît que des touches (`key(texte)`) : la molette, les actions et leur fin y passent sous la forme d'un texte.
const ACTION = "action:";
const END = "end:";
const WHEEL = "wheel:";

function decode(key: string): LureInput {
  if (key.startsWith(ACTION)) return { type: "action", action: key.slice(ACTION.length) as LureAction };
  if (key.startsWith(END)) return { type: "actionEnd", action: key.slice(END.length) as LureAction };
  return { type: "wheel", delta: key.slice(WHEEL.length) === "-1" ? -1 : 1 };
}

/**
 * File des entrées du moteur (`LureHost.pollInput`) : la file commune des jeux à pointeur (`ui/pointer-queue.ts`), réglée sur l'écran
 * de 320 x 200 et sur `TAP_DELAY_TICKS`, avec la molette et les actions du clavier. Une action de combat est tenue jusqu'à son
 * relâchement (`actionEnd`) ; quand on relâche tout (perte du focus, pause), les touches de combat tenues sont relâchées aussi, sinon
 * le combattant continuerait de marcher.
 */
export class InputQueue extends PointerQueue<LureInput> {
  private readonly held = new Set<LureAction>();

  constructor() {
    super({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      tapDelayTicks: TAP_DELAY_TICKS,
      pointer: (x, y, buttons) => ({ type: "pointer", x, y, buttons }),
      key: decode,
    });
  }

  /** Action du moteur (touche déjà traduite). */
  action(action: LureAction): void {
    if (isFightAction(action)) this.held.add(action);
    this.key(`${ACTION}${action}`);
  }

  /** Fin de l'appui d'une touche d'action : ne compte que pour les combats. */
  actionEnd(action: LureAction): void {
    if (!this.held.delete(action)) return;
    this.key(`${END}${action}`);
  }

  /** Cran de molette : -1 vers le haut, 1 vers le bas. */
  wheel(delta: -1 | 1): void {
    this.key(`${WHEEL}${delta}`);
  }

  override releaseAll(): void {
    super.releaseAll();
    for (const action of this.held) this.key(`${END}${action}`);
    this.held.clear();
  }
}
