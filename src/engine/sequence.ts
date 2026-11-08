/**
 * Séquences des moteurs de jeu (utilisées par *Drascula*, `docs/drascula/engine.md`, « Séquences ») : le remplaçant des attentes
 * bloquantes de ScummVM (`delay`, `pause`, `walkToPoint`, `talk`, `finishSound`, `animation_*`…), qui bouclent sur le fil
 * principal jusqu'à la fin d'un temps, d'un son ou d'un déplacement. Ici, une séquence est un **générateur** qui `yield` une
 * condition d'attente ; le `SequenceRunner` la reprend, tick après tick, quand la condition est remplie. Le code des
 * gestionnaires de pièces et des cinématiques reste linéaire, comme dans ScummVM :
 *
 * ```ts
 * function* room3(g: Game, fl: number): Sequence<boolean> {
 *   if (g.picked === Verb.Talk && fl === 129) {
 *     yield* g.talk(23);
 *     yield* pause(6);
 *     ...
 * ```
 *
 * Composition : une séquence en appelle une autre par `yield*` (et récupère sa valeur de retour). Il n'y a qu'une séquence
 * racine à la fois (ScummVM n'a qu'un fil) : pendant qu'elle s'exécute, la boucle principale (clics, verbes) est suspendue.
 *
 * Trois cas limites sont réglés ici, une fois pour toutes :
 * - **saut** (Échap, `kActionSkip`) : seule une partie enveloppée par `skippable()` se saute. Le saut abandonne cette partie
 *   (ses blocs `finally` s'exécutent) et la séquence englobante **continue** après elle, comme le `break` des boucles
 *   `while (term_int == 0)` des cinématiques de ScummVM, après lesquelles l'état du jeu est mis à jour. Parties imbriquées :
 *   c'est la plus intérieure qui se saute. Écart : ScummVM ne teste la touche qu'à des points précis ; ici le saut prend effet
 *   à l'attente en cours ;
 * - **attente protégée** : `unskippable(...)` rend les attentes d'une partie insensibles au saut (une réplique : la touche reste pour
 *   `isTalkFinished`, Échap ne coupe que la réplique) ;
 * - **abandon** (changement de chapitre, chargement d'une partie : `_loadedDifferentChapter` de ScummVM) : `abort()` termine
 *   toute la séquence (blocs `finally` compris), sans exécuter la suite. Le moteur le demande au prochain `yield` par
 *   `interrupted()` : une séquence ne s'abandonne jamais pendant qu'elle s'exécute ;
 * - **séquence sans attente** : une boucle qui ne cède jamais la main lève une erreur au lieu de geler l'onglet.
 *
 * Module pur : aucune dépendance au navigateur ni à un jeu. Les attentes exprimées dans les unités d'un jeu (`pause`, `delay` de ScummVM
 * en ticks) sont définies par ce jeu au-dessus de `wait`.
 */

/** Valeur rendue par `yield` à la reprise : `skip` quand la partie sautable en cours est abandonnée. */
export type Resume = "ok" | "skip";

/** Condition d'attente. `skipDepth` (posé par `skippable`) : nombre de parties sautables qui englobent l'attente. */
export type Wait =
  | { kind: "ticks"; count: number; skipDepth?: number; noSkip?: boolean }
  | { kind: "until"; done: () => boolean; skipDepth?: number; noSkip?: boolean };

/** Séquence : générateur d'attentes ; `T` est la valeur rendue au `yield*` appelant. */
export type Sequence<T = void> = Generator<Wait, T, Resume>;

/**
 * Rend une séquence insensible au saut : ses attentes ne sont jamais interrompues par Échap, qui reste dans le tampon de
 * touches pour la séquence elle-même. C'est le cas d'une réplique (`isTalkFinished` de ScummVM consomme la touche : elle ne coupe
 * que la réplique, jamais la cinématique qui la contient).
 */
export function* unskippable<T>(inner: Sequence<T>): Sequence<T> {
  let finished = false;
  try {
    let resume: Resume = "ok";
    for (;;) {
      const step = inner.next(resume);
      if (step.done) {
        finished = true;
        return step.value;
      }
      resume = yield { ...step.value, noSkip: true };
    }
  } finally {
    if (!finished) inner.return(undefined as T);
  }
}

/** Attend `count` ticks (0 : aucune attente). */
export function* wait(count: number): Sequence {
  if (count > 0) yield { kind: "ticks", count };
}

/** Attend que `done()` soit vrai ; la condition est testée tout de suite, puis à chaque tick. */
export function* waitUntil(done: () => boolean): Sequence {
  if (!done()) yield { kind: "until", done };
}

/**
 * Partie sautable : Échap (`kActionSkip`) abandonne `inner` et rend `undefined` ; sinon rend sa valeur. La séquence englobante
 * reprend juste après. Les blocs `finally` de `inner` s'exécutent dans tous les cas (saut, abandon, fin normale).
 */
export function* skippable<T>(inner: Sequence<T>): Sequence<T | undefined> {
  let finished = false;
  try {
    let resume: Resume = "ok";
    for (;;) {
      const step = inner.next(resume);
      if (step.done) {
        finished = true;
        return step.value;
      }
      const depth = step.value.skipDepth ?? 0;
      resume = yield { ...step.value, skipDepth: step.value.noSkip ? 0 : depth + 1 };
      // Le saut est pour cette partie quand l'attente ne vient pas d'une partie sautable intérieure.
      if (resume === "skip" && depth === 0) return undefined;
    }
  } finally {
    if (!finished) inner.return(undefined as T);
  }
}

/** Ce que le runner lit dans le moteur. */
export interface SequenceHost {
  /** Ticks écoulés (horloge du moteur). */
  now(): number;
  /** Consomme une demande de saut (Échap) si elle existe ; n'est appelé que dans une partie sautable. */
  takeSkip(): boolean;
  /** Vrai si la séquence doit être abandonnée (changement de chapitre demandé) : testé à chaque `yield`. */
  interrupted(): boolean;
}

/** Reprises au plus dans un même tick : au-delà, la séquence boucle sans attendre. */
const MAX_RESUMES_PER_TICK = 10_000;

type Pending = { kind: "ticks"; until: number; skipDepth: number } | { kind: "until"; done: () => boolean; skipDepth: number };

/**
 * Exécuteur de la séquence racine. `start` la lance et l'avance jusqu'à sa première attente non remplie ; `step`, appelé une
 * fois par tick, la reprend tant que ses attentes sont remplies.
 */
export class SequenceRunner {
  private root: Sequence<unknown> | null = null;
  private pending: Pending | null = null;
  private onEnd: (() => void) | null = null;

  constructor(private readonly host: SequenceHost) {}

  /** Une séquence est en cours (la boucle principale est suspendue). */
  get active(): boolean {
    return this.root !== null;
  }

  /** L'attente en cours est dans une partie sautable : un appui sur Échap l'abandonnerait (lecture seule). */
  get skippable(): boolean {
    return (this.pending?.skipDepth ?? 0) > 0;
  }

  /** Lance une séquence racine (une seule à la fois) ; `onEnd` est appelé à sa fin normale, pas à l'abandon. */
  start(sequence: Sequence<unknown>, onEnd?: () => void): void {
    if (this.root) throw new Error("séquence : une séquence est déjà en cours");
    this.root = sequence;
    this.pending = null;
    this.onEnd = onEnd ?? null;
    this.step();
  }

  /** Reprend la séquence tant que ses attentes sont remplies. */
  step(): void {
    let budget = MAX_RESUMES_PER_TICK;
    while (this.root) {
      let resume: Resume = "ok";
      const pending = this.pending;
      if (pending && !this.satisfied(pending)) {
        if (pending.skipDepth > 0 && this.host.takeSkip()) resume = "skip";
        else return;
      }
      if (--budget < 0) {
        this.abort();
        throw new Error("séquence : boucle sans attente");
      }
      const root = this.root;
      let result: IteratorResult<Wait, unknown>;
      try {
        result = root.next(resume);
      } catch (error) {
        this.clear();
        throw error;
      }
      if (this.root !== root) return; // abandonnée ou remplacée pendant la reprise
      if (result.done) {
        const onEnd = this.onEnd;
        this.clear();
        onEnd?.();
        return;
      }
      this.pending = this.toPending(result.value);
      if (this.host.interrupted()) {
        this.abort();
        return;
      }
    }
  }

  /** Abandonne la séquence en cours (ses blocs `finally` s'exécutent) ; sans effet s'il n'y en a pas. */
  abort(): void {
    const root = this.root;
    this.clear();
    root?.return(undefined);
  }

  private clear(): void {
    this.root = null;
    this.pending = null;
    this.onEnd = null;
  }

  private toPending(wait: Wait): Pending {
    const skipDepth = wait.skipDepth ?? 0;
    return wait.kind === "ticks" ? { kind: "ticks", until: this.host.now() + wait.count, skipDepth } : { kind: "until", done: wait.done, skipDepth };
  }

  private satisfied(pending: Pending): boolean {
    return pending.kind === "ticks" ? this.host.now() >= pending.until : pending.done();
  }
}
