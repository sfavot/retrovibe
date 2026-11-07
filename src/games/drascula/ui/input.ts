import { FRAME_TICKS } from "../engine/cadence";
import type { DrasculaInput } from "../engine/host";

/** Écran logique du jeu. */
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

/** Masque de boutons du moteur : 1 gauche, 2 droit (`DrasculaInput`). */
export function buttonMask(button: number): number {
  return button === 0 ? 1 : button === 2 ? 2 : 0;
}

/**
 * Ticks entre un déplacement du curseur et l'appui qui le suit : deux images de la boucle principale. Le moteur décide « souris sur la
 * barre des verbes » (`menuBar`) à la fin de chaque image, d'après la position de la souris à cet instant : un appui reçu juste après un
 * saut de position (un doigt qui n'a pas de survol, une souris téléportée, un pavé tactile qui tape) lirait l'ancienne position et
 * choisirait un verbe en cliquant dans la pièce, ou l'inverse (`rooms.md` § 7). Une image pleine entre les deux le laisse se mettre
 * à jour, comme le fait la souris qui bouge avant de cliquer ; une souris qui bouge puis clique plus tard n'attend rien.
 */
export const TAP_DELAY_TICKS = 2 * FRAME_TICKS;
/** Ticks pendant lesquels le bouton reste enfoncé lors d'un toucher (un tick suffit à le voir enfoncé puis relâché). */
const TAP_HOLD_TICKS = 1;

interface Queued {
  /** Tick (nombre d'appels de `drain`) à partir duquel l'événement est donné au moteur. */
  due: number;
  event: DrasculaInput;
}

/**
 * File des entrées du moteur (`DrasculaHost.pollInput`) : la souris est un état échantillonné (position, boutons), une touche un
 * événement. Les événements gardent leur ordre ; un appui qui suit de trop près un saut de position est retardé (`TAP_DELAY_TICKS`),
 * et tout ce qui vient après avec lui. Les déplacements consécutifs sont fusionnés, un appui ou un relâchement jamais (un clic bref entre
 * deux ticks reste vu du moteur). `drain` est appelée une fois par tick du moteur.
 */
export class InputQueue {
  private x = 0;
  private y = 0;
  private buttons = 0;
  private clock = 0;
  /** Échéance du dernier événement mis en file (l'ordre est conservé). */
  private tail = 0;
  /** Échéance du dernier déplacement qui a changé la position. */
  private movedAt = -TAP_DELAY_TICKS;
  private readonly queue: Queued[] = [];
  /** Le dernier événement de `queue` est un simple déplacement : seul celui-là est remplacé par le suivant. */
  private lastIsMove = false;

  private static clamp(value: number, max: number): number {
    return Math.min(Math.max(Math.round(value), 0), max);
  }

  private point(x: number, y: number): boolean {
    const nx = InputQueue.clamp(x, SCREEN_WIDTH - 1);
    const ny = InputQueue.clamp(y, SCREEN_HEIGHT - 1);
    const changed = nx !== this.x || ny !== this.y;
    this.x = nx;
    this.y = ny;
    return changed;
  }

  private sample(): DrasculaInput {
    return { type: "pointer", x: this.x, y: this.y, buttons: this.buttons };
  }

  private enqueue(event: DrasculaInput, minDue = this.clock, move = false): number {
    const due = Math.max(minDue, this.tail);
    if (move && this.lastIsMove && this.queue.length > 0) this.queue[this.queue.length - 1] = { due, event };
    else this.queue.push({ due, event });
    this.lastIsMove = move;
    this.tail = due;
    return due;
  }

  /** Le pointeur est en (x, y). */
  move(x: number, y: number): void {
    const changed = this.point(x, y);
    const due = this.enqueue(this.sample(), this.clock, true);
    if (changed) this.movedAt = due;
  }

  /** Échéance d'un appui : au plus tôt `TAP_DELAY_TICKS` après le dernier saut de position. */
  private pressDue(): number {
    return Math.max(this.clock, this.movedAt + TAP_DELAY_TICKS);
  }

  /** Bouton du DOM (0 gauche, 2 droit) enfoncé en (x, y). */
  down(button: number, x: number, y: number): void {
    const changed = this.point(x, y);
    if (changed) this.movedAt = this.enqueue(this.sample(), this.clock, true);
    this.buttons |= buttonMask(button);
    this.enqueue(this.sample(), this.pressDue());
  }

  /** Bouton du DOM relâché en (x, y). */
  up(button: number, x: number, y: number): void {
    this.point(x, y);
    this.buttons &= ~buttonMask(button);
    this.enqueue(this.sample());
  }

  /**
   * Toucher du doigt (0 : clic gauche, 2 : appui long = clic droit) en (x, y) : le pointeur y va tout de suite, le bouton est enfoncé
   * `TAP_DELAY_TICKS` ticks plus tard puis relâché (`TAP_HOLD_TICKS` après).
   */
  tap(button: 0 | 2, x: number, y: number): void {
    this.down(button, x, y);
    const pressed = this.tail;
    this.point(x, y);
    this.buttons &= ~buttonMask(button);
    this.enqueue(this.sample(), pressed + TAP_HOLD_TICKS);
  }

  /** Touche du clavier (nom de `KeyboardEvent.key`). */
  key(key: string): void {
    this.enqueue({ type: "key", key });
  }

  /** Des événements attendent leur échéance (un appui retardé) : leur position et leurs boutons n'ont pas encore été donnés au moteur. */
  get tapPending(): boolean {
    return this.queue.some(({ due }) => due > this.clock);
  }

  /** Relâche tout (perte du focus, onglet masqué) et oublie les événements en attente. */
  releaseAll(): void {
    this.queue.length = 0;
    this.lastIsMove = false;
    this.tail = this.clock;
    this.movedAt = this.clock - TAP_DELAY_TICKS;
    if (this.buttons === 0) return;
    this.buttons = 0;
    this.enqueue(this.sample());
  }

  /** Les événements arrivés à échéance depuis l'appel précédent (la file est vidée de ceux-là) ; avance d'un tick. */
  drain(): DrasculaInput[] {
    const out: DrasculaInput[] = [];
    while (this.queue.length > 0 && this.queue[0].due <= this.clock) out.push(this.queue.shift()!.event);
    this.lastIsMove = this.lastIsMove && this.queue.length > 0;
    this.clock++;
    return out;
  }
}
