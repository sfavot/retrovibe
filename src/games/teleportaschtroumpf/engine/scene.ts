import type { VoiceChannel } from "../audio/voice";
import type { Clock } from "./clock";
import type { Host } from "./host";
import type { Input } from "./input";
import type { ParentOptions } from "./options";
import type { Fade, Palette } from "./palette";
import type { Resources } from "./resources";
import type { BorlandRandom } from "./rng";
import type { Surface } from "./surface";

/** Pas par défaut d'une scène, en ticks de 1/60 s : 12 images/s (la plupart des mini-jeux). Plateau : 4, carte : 3. */
export const DEFAULT_STEP = 5;

/** Tout ce qu'une scène peut utiliser. Passé à chaque méthode de `Scene`. */
export interface SceneContext {
  readonly host: Host;
  readonly clock: Clock;
  readonly rng: BorlandRandom;
  readonly surface: Surface;
  readonly palette: Palette;
  readonly fade: Fade;
  readonly input: Input;
  readonly voice: VoiceChannel;
  readonly resources: Resources;
  /** Options parents, chargées au démarrage ; les modifier puis `saveOptions(ctx.host.storage, ctx.options)`. */
  readonly options: ParentOptions;
  readonly scenes: SceneManager;
}

/**
 * Une scène est une machine à états, jamais une boucle bloquante : le moteur appelle `update` tous les `step` ticks,
 * puis `render` si quelque chose a pu changer.
 *
 * Cycle de vie : `load` (async, avant l'entrée) → `enter` → { `update` / `render` }* → `exit`.
 * Une scène empilée par `push` garde son état ; quand la scène du dessus est retirée par `pop`, `resume` est appelé.
 */
export interface Scene {
  /** Ticks entre deux `update` (défaut `DEFAULT_STEP`). */
  readonly step?: number;
  /** Charge les ressources de la scène ; la boucle continue pendant ce temps (`SceneManager.loading`). */
  load?(ctx: SceneContext): Promise<void>;
  /** Initialise l'état et dessine le premier écran (palette, fond). Les ressources sont chargées. */
  enter(ctx: SceneContext): void;
  /** Un pas de la logique (lire `ctx.input`, avancer l'état, lancer un changement de scène). */
  update(ctx: SceneContext): void;
  /** Dessine l'état courant dans `ctx.surface` (le tampon A est conservé d'un appel à l'autre). */
  render(ctx: SceneContext): void;
  /** La scène du dessus a été retirée : redevient la scène courante. */
  resume?(ctx: SceneContext): void;
  /** Quitte la scène (remplacée ou retirée). */
  exit?(ctx: SceneContext): void;
}

export interface TransitionOptions {
  /** Fondu au noir avant la transition (pendant que les ressources se chargent), fondu d'entrée après. */
  fade?: boolean;
}

interface StackEntry {
  scene: Scene;
  /** Ticks depuis le dernier `update`. */
  ticks: number;
}

interface Pending {
  kind: "replace" | "push" | "pop";
  scene?: Scene;
  fade: boolean;
  /** `fadeOut` : on attend la fin du fondu ; `loading` : on attend les ressources. */
  stage: "fadeOut" | "loading";
  loaded: boolean;
  failure?: { error: unknown };
  promise: Promise<void>;
}

/**
 * Gestionnaire de scènes : pile de scènes (la dernière est la scène courante), remplacement, empilement
 * (pause, aide, confirmation) et retrait, avec fondu optionnel et chargement asynchrone avant l'entrée.
 * Pendant une transition, la scène courante n'est plus mise à jour.
 */
export class SceneManager {
  private readonly stack: StackEntry[] = [];
  private pending: Pending | null = null;
  private dirty = false;

  constructor(private readonly context: () => SceneContext) {}

  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1]?.scene;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Vrai pendant le chargement des ressources d'une scène à venir. */
  get loading(): boolean {
    return this.pending !== null && !this.pending.loaded;
  }

  /** Vrai pendant toute transition (fondu et chargement compris). */
  get transitioning(): boolean {
    return this.pending !== null;
  }

  /** Promesse du chargement en cours (pour attendre dans un test ou un hôte) ; `null` s'il n'y en a pas. */
  get whenLoaded(): Promise<void> | null {
    return this.pending && !this.pending.loaded ? this.pending.promise : null;
  }

  /** Remplace la scène courante (`exit` de l'ancienne, `enter` de la nouvelle). */
  replace(scene: Scene, options: TransitionOptions = {}): void {
    this.begin("replace", scene, options);
  }

  /** Empile une scène au-dessus de la courante, qui reste en mémoire et reprendra par `resume`. */
  push(scene: Scene, options: TransitionOptions = {}): void {
    this.begin("push", scene, options);
  }

  /** Retire la scène courante ; celle d'en dessous reçoit `resume`. */
  pop(options: TransitionOptions = {}): void {
    if (this.stack.length < 2) throw new Error("SceneManager : rien à dépiler");
    this.begin("pop", undefined, options);
  }

  /** Un tick : avance la transition en cours, sinon compte les ticks de la scène et appelle `update` au bon moment. */
  tick(): void {
    if (this.pending) {
      this.advance(this.pending);
      return;
    }
    const entry = this.stack[this.stack.length - 1];
    if (!entry) return;
    entry.ticks++;
    if (entry.ticks >= (entry.scene.step ?? DEFAULT_STEP)) {
      entry.ticks = 0;
      const ctx = this.context();
      entry.scene.update(ctx);
      ctx.input.endUpdate();
      this.dirty = true;
    }
  }

  /** Dessine la scène courante si son état a pu changer depuis le dernier appel ; renvoie vrai si elle a été dessinée. */
  render(): boolean {
    const top = this.top;
    if (!top || !this.dirty) return false;
    this.dirty = false;
    top.render(this.context());
    return true;
  }

  private begin(kind: Pending["kind"], scene: Scene | undefined, options: TransitionOptions): void {
    if (this.pending) throw new Error("SceneManager : une transition est déjà en cours");
    const ctx = this.context();
    const fade = options.fade === true;
    const stage = fade && this.stack.length > 0 ? "fadeOut" : "loading";
    if (stage === "fadeOut") ctx.fade.out();
    const pending: Pending = { kind, scene, fade, stage, loaded: false, promise: Promise.resolve() };
    pending.promise = Promise.resolve(scene?.load?.(ctx)).then(
      () => {
        pending.loaded = true;
      },
      (error: unknown) => {
        pending.loaded = true;
        pending.failure = { error };
      },
    );
    this.pending = pending;
  }

  private advance(pending: Pending): void {
    const ctx = this.context();
    if (pending.stage === "fadeOut") {
      if (ctx.fade.active) return;
      pending.stage = "loading";
    }
    if (!pending.loaded) return;
    this.pending = null;
    if (pending.failure) throw pending.failure.error;

    const { kind, scene } = pending;
    if (kind === "pop") {
      this.stack.pop()?.scene.exit?.(ctx);
      this.top?.resume?.(ctx);
    } else {
      if (kind === "replace") this.stack.pop()?.scene.exit?.(ctx);
      this.stack.push({ scene: scene!, ticks: scene!.step ?? DEFAULT_STEP });
      scene!.enter(ctx);
    }
    // Les appuis faits avant le changement (pendant la scène précédente, le fondu ou le chargement) ne doivent pas
    // agir sur la scène qui arrive : on les oublie tous, pas seulement le premier.
    ctx.input.discardPresses();
    this.dirty = true;
    if (pending.fade) ctx.fade.in();
  }
}
