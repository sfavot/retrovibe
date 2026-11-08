/**
 * File d'entrées d'un jeu à pointeur (souris, stylet, doigt) et clavier, pour un moteur qui les relève une fois par tick
 * (`pollInput`) : la souris est un état échantillonné (position, boutons), une touche un événement. Chaque jeu fixe la forme de ses
 * événements (`pointer`, `key`), la taille de son écran logique et le retard du tap tactile.
 *
 * Le retard du tap tactile règle un problème que la souris n'a pas : le doigt n'a pas de survol. Un moteur qui décide « le curseur est
 * sur tel objet / telle barre » à la fin de chaque image, d'après la position du curseur à cet instant, lirait l'ancienne position
 * d'un appui reçu juste après un saut de position (un doigt qui se pose, une souris téléportée, un pavé tactile qui tape). Une image
 * pleine entre le saut et l'appui lui laisse le temps de se mettre à jour, comme la souris qui bouge avant de cliquer ; une souris qui
 * bouge puis clique plus tard n'attend rien. Le retard est compté en ticks du moteur (`tapDelayTicks`, à choisir en images du jeu).
 *
 * Module pur : aucune dépendance au navigateur. Il reçoit des coordonnées logiques (voir `pointer.ts` pour la conversion).
 */

/** Masque de boutons du moteur pour un bouton du DOM : 1 gauche (0), 2 droit (2), 0 pour tout autre. */
export function buttonMask(button: number): number {
  return button === 0 ? 1 : button === 2 ? 2 : 0;
}

export interface PointerQueueOptions<E> {
  /** Taille de l'écran logique : les positions sont arrondies et ramenées dans `[0, width - 1] x [0, height - 1]`. */
  width: number;
  height: number;
  /** Ticks entre un saut de position et l'appui qui le suit (par exemple deux images de la boucle principale). */
  tapDelayTicks: number;
  /** Ticks pendant lesquels le bouton reste enfoncé lors d'un toucher (un tick suffit à le voir enfoncé puis relâché). */
  tapHoldTicks?: number;
  /** L'événement « état du pointeur » du moteur. */
  pointer(x: number, y: number, buttons: number): E;
  /** L'événement « touche » du moteur (`key` : nom de `KeyboardEvent.key`). */
  key(key: string): E;
}

interface Queued<E> {
  /** Tick (nombre d'appels de `drain`) à partir duquel l'événement est donné au moteur. */
  due: number;
  event: E;
}

/**
 * Les événements gardent leur ordre ; un appui qui suit de trop près un saut de position est retardé (`tapDelayTicks`), et tout ce
 * qui vient après avec lui. Les déplacements consécutifs sont fusionnés, un appui ou un relâchement jamais (un clic bref entre deux
 * ticks reste vu du moteur). `drain` est appelée une fois par tick du moteur.
 */
export class PointerQueue<E> {
  private x = 0;
  private y = 0;
  private buttons = 0;
  private clock = 0;
  /** Échéance du dernier événement mis en file (l'ordre est conservé). */
  private tail = 0;
  /** Échéance du dernier déplacement qui a changé la position. */
  private movedAt: number;
  private readonly queue: Queued<E>[] = [];
  /** Le dernier événement de `queue` est un simple déplacement : seul celui-là est remplacé par le suivant. */
  private lastIsMove = false;
  private readonly tapDelayTicks: number;
  private readonly tapHoldTicks: number;

  constructor(private readonly options: PointerQueueOptions<E>) {
    this.tapDelayTicks = options.tapDelayTicks;
    this.tapHoldTicks = options.tapHoldTicks ?? 1;
    this.movedAt = -this.tapDelayTicks;
  }

  private static clamp(value: number, max: number): number {
    return Math.min(Math.max(Math.round(value), 0), max);
  }

  private point(x: number, y: number): boolean {
    const nx = PointerQueue.clamp(x, this.options.width - 1);
    const ny = PointerQueue.clamp(y, this.options.height - 1);
    const changed = nx !== this.x || ny !== this.y;
    this.x = nx;
    this.y = ny;
    return changed;
  }

  private sample(): E {
    return this.options.pointer(this.x, this.y, this.buttons);
  }

  private enqueue(event: E, minDue = this.clock, move = false): number {
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

  /** Échéance d'un appui : au plus tôt `tapDelayTicks` après le dernier saut de position. */
  private pressDue(): number {
    return Math.max(this.clock, this.movedAt + this.tapDelayTicks);
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
   * `tapDelayTicks` ticks plus tard puis relâché (`tapHoldTicks` après).
   */
  tap(button: 0 | 2, x: number, y: number): void {
    this.down(button, x, y);
    const pressed = this.tail;
    this.point(x, y);
    this.buttons &= ~buttonMask(button);
    this.enqueue(this.sample(), pressed + this.tapHoldTicks);
  }

  /** Touche du clavier (nom de `KeyboardEvent.key`). */
  key(key: string): void {
    this.enqueue(this.options.key(key));
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
    this.movedAt = this.clock - this.tapDelayTicks;
    if (this.buttons === 0) return;
    this.buttons = 0;
    this.enqueue(this.sample());
  }

  /** Les événements arrivés à échéance depuis l'appel précédent (la file est vidée de ceux-là) ; avance d'un tick. */
  drain(): E[] {
    const out: E[] = [];
    while (this.queue.length > 0 && this.queue[0].due <= this.clock) out.push(this.queue.shift()!.event);
    this.lastIsMove = this.lastIsMove && this.queue.length > 0;
    this.clock++;
    return out;
  }
}
