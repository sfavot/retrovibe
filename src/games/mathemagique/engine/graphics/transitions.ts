/**
 * Transitions de l'original, sous forme de machines pures : à chaque tick, elles disent **quelles zones sont nouvellement révélées**
 * (le moteur les recopie du port de travail vers l'écran avec `revealRects`). Aucun temps réel, aucune surface ici.
 *
 * Le mécanisme est le même pour les deux (`1018:01fd` et `1018:0811`) : vitesse en virgule fixe 16.16 `total × 65536 / ticks`
 * (division tronquée `1000:115a`), accumulateur initialisé à **une** vitesse, +1 vitesse par tick écoulé ; progression = partie entière
 * de l'accumulateur, plafonnée au total. La progression est lue sur l'horloge (`DAT_8722`, ticks) : ici un `step()` = un tick.
 *
 * - **Balayage 4 directions** (`1018:0162` initialise, `01fd` avance, `0275` dessine) : paramètres `(direction 0–3, ticks, rectangle)`.
 *   Direction 0 : le contenu apparaît de haut en bas ; 1 : de bas en haut ; 2 : de gauche à droite ; 3 : de droite à gauche
 *   (`0275`, `switch(4f1a)` : cas 0 = lignes `[haut + précédent, haut + nouveau)`, cas 1 = `[bas - nouveau, bas - précédent)`, cas 2/3 = colonnes).
 *   Les crédits l'appellent avec 30 ticks, direction `7eb8` qui tourne `(+1) & 3` (`1078:04ef`).
 * - **Stores vénitiens** (`1018:0722` → `0785` initialise, `0811` avance, `0889` dessine) : le rectangle est découpé en bandes de
 *   `hauteurBande` lignes (`⌈hauteur / hauteurBande⌉` bandes) ; dans **chaque** bande, les lignes apparaissent de haut en bas :
 *   après progression `p` (0 à `hauteurBande`), les lignes `[i × bande + précédent, i × bande + p)` de la bande `i` sont copiées
 *   (arrêt à la hauteur du rectangle). Appels du jeu : bandes de 10 lignes, 15 ticks (menus et choix de puzzle) ou 30 ticks (niveau, mélange).
 *   `finish()` = ce que fait l'original quand le joueur clique pendant la transition : `0889` termine d'un coup (restaure le port de travail).
 */
import type { Rect, Surface } from "./surface";

/** 0 : de haut en bas ; 1 : de bas en haut ; 2 : de gauche à droite ; 3 : de droite à gauche. */
export type WipeDirection = 0 | 1 | 2 | 3;

/** Progression linéaire en virgule fixe 16.16, commune aux deux transitions. */
class LinearProgress {
  private readonly rate: number;
  private accumulator: number;
  /** Progression déjà dessinée (0 à `total`). */
  shown = 0;

  constructor(
    readonly total: number,
    ticks: number,
  ) {
    this.rate = Math.floor((total * 65536) / Math.max(1, ticks));
    this.accumulator = this.rate;
  }

  get done(): boolean {
    return this.shown >= this.total;
  }

  /** Un tick écoulé : renvoie `[de, à[` à dessiner, ou `null` si rien ne change. */
  tick(): [number, number] | null {
    if (this.done) return null;
    this.accumulator += this.rate;
    const next = Math.min(this.total, Math.floor(this.accumulator / 65536));
    return this.advanceTo(next);
  }

  /** Va directement à `next` (au plus `total`). */
  advanceTo(next: number): [number, number] | null {
    if (next === this.shown) return null;
    const range: [number, number] = [this.shown, next];
    this.shown = next;
    return range;
  }
}

export interface Transition {
  /** Terminée : toute la zone a été révélée. */
  readonly done: boolean;
  /** Avance d'un tick ; renvoie les rectangles nouvellement révélés (peut être vide). */
  step(): Rect[];
  /** Révèle tout ce qui reste d'un coup (clic du joueur pendant la transition). */
  finish(): Rect[];
}

export class Wipe implements Transition {
  private readonly progress: LinearProgress;

  constructor(
    private readonly rect: Rect,
    private readonly direction: WipeDirection,
    ticks: number,
  ) {
    this.progress = new LinearProgress(direction < 2 ? rect.h : rect.w, ticks);
  }

  get done(): boolean {
    return this.progress.done;
  }

  step(): Rect[] {
    return this.band(this.progress.tick());
  }

  finish(): Rect[] {
    return this.band(this.progress.advanceTo(this.progress.total));
  }

  private band(range: [number, number] | null): Rect[] {
    if (!range) return [];
    const [from, to] = range;
    const { x, y, w, h } = this.rect;
    switch (this.direction) {
      case 0:
        return [{ x, y: y + from, w, h: to - from }];
      case 1:
        return [{ x, y: y + h - to, w, h: to - from }];
      case 2:
        return [{ x: x + from, y, w: to - from, h }];
      case 3:
        return [{ x: x + w - to, y, w: to - from, h }];
    }
  }
}

export class Blinds implements Transition {
  private readonly progress: LinearProgress;
  private readonly strips: number;

  constructor(
    private readonly rect: Rect,
    ticks: number,
    private readonly stripHeight = 10,
  ) {
    this.progress = new LinearProgress(stripHeight, ticks);
    this.strips = Math.floor((rect.h - 1) / stripHeight) + 1;
  }

  get done(): boolean {
    return this.progress.done;
  }

  step(): Rect[] {
    return this.bands(this.progress.tick());
  }

  finish(): Rect[] {
    return this.bands(this.progress.advanceTo(this.progress.total));
  }

  private bands(range: [number, number] | null): Rect[] {
    if (!range) return [];
    const rects: Rect[] = [];
    for (let i = 0; i < this.strips; i++) {
      const from = i * this.stripHeight + range[0];
      const to = Math.min(i * this.stripHeight + range[1], this.rect.h);
      if (to > from) rects.push({ x: this.rect.x, y: this.rect.y + from, w: this.rect.w, h: to - from });
    }
    return rects;
  }
}

/** Itère une transition tick par tick (un élément par tick, éventuellement vide) jusqu'à sa fin. */
export function* transitionFrames(transition: Transition): Generator<Rect[]> {
  while (!transition.done) yield transition.step();
}

/** Recopie `rects` de `src` (port de travail) vers `dst` (écran), à la même position. */
export function revealRects(dst: Surface, src: Surface, rects: readonly Rect[]): void {
  for (const rect of rects) dst.copyFrom(src, rect);
}
