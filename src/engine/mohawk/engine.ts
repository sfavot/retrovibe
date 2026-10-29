import { Clock } from "./clock";
import type { Frame } from "./graphics/frame";
import type { MohawkHost } from "./host";
import type { KeyEvent } from "./input";
import { Resources, type ResourcesOptions } from "./resources";
import { MsvcRandom } from "./rng";
import { SceneManager, Services, type BaseSceneContext, type SceneFactory } from "./scene";

/** Source de l'image à présenter : fournie par la couche graphique via `Engine.setFrameSource`. */
export type FrameSource = () => Frame;

/** Contexte complet d'un jeu : le contexte commun plus les champs ajoutés par `extend`. */
export type EngineContext<Id extends number, Ext extends object, Cursor extends string> = BaseSceneContext<Id, Cursor> & Ext;

/** Appelé à chaque tick, avant le `tick` de la scène (gadgets, lecteur de scripts, séquenceur…). */
export type TickHook<Ctx> = (ctx: Ctx) => void;

/** Gestionnaire de touche ; renvoie vrai si la touche est consommée. */
export type KeyHandler<Ctx> = (event: KeyEvent, ctx: Ctx) => boolean;

export interface EngineOptions<Id extends number, Ext extends object, Cursor extends string> {
  /** Graine du hasard ; défaut : l'horloge murale (`host.unixMillis()`, 32 bits bas). */
  seed?: number;
  /** Appelé quand une scène n'a pas pu être chargée. */
  onError?: (error: unknown, sceneId: Id) => void;
  /** Première scène, lancée par `start()` sans argument. */
  start: Id;
  /** Champs que le jeu ajoute au contexte commun (par exemple les joueurs), construits à partir du contexte de base. */
  extend: (base: BaseSceneContext<Id, Cursor>) => Ext;
  /** Ctrl+Q non consommé par une scène quitte le jeu (`host.exit()`) ; vrai par défaut. */
  quitOnCtrlQ?: boolean;
  /** Curseur imposé pendant un chargement de scène. */
  busyCursor: Cursor;
  /** Curseur voulu tant qu'aucune scène n'en demande un autre. */
  defaultCursor: Cursor;
  /** Nom lisible d'un identifiant d'écran, pour les messages d'erreur. */
  sceneName?: (id: Id) => string;
  /** Options de `Resources` (encodage des `STRL`). */
  resources?: ResourcesOptions;
}

/**
 * Moteur des jeux Mohawk : assemble l'horloge, les entrées, le hasard, les ressources et le gestionnaire de scènes autour d'un
 * `MohawkHost` ; le jeu ajoute ses champs au contexte par `options.extend` (Mathémagique : le roster). L'hôte appelle `frame(now)` à chaque image affichée (`requestAnimationFrame`, ou la boucle de l'hôte de test) ; tout
 * le reste — ticks de 17 ms, bascule de scène, présentation — se déroule à l'intérieur. Aucune boucle bloquante.
 *
 * Ordre d'un tick :
 *  1. `scenes.step()` : bascule différée de scène (leave / enter) ou avancement du chargement ;
 *  2. `input.beginTick()` : les événements reçus depuis le tick précédent deviennent lisibles ;
 *  3. touches : gestionnaires `before` (gadgets), `Scene.key`, gestionnaires `after`, puis Ctrl+Q (sortie) ;
 *  4. crochets de tick des services ;
 *  5. `Scene.tick`.
 * Ensuite, à la fin de l'image : si une scène a demandé une présentation, `host.present(frameSource())`.
 */
export class Engine<Id extends number, Ext extends object, Cursor extends string> {
  readonly ctx: EngineContext<Id, Ext, Cursor>;
  readonly scenes: SceneManager<Id, EngineContext<Id, Ext, Cursor>>;
  readonly services = new Services();
  private readonly clock = new Clock();
  private readonly tickHooks: TickHook<EngineContext<Id, Ext, Cursor>>[] = [];
  private readonly keyHandlers = {
    before: [] as KeyHandler<EngineContext<Id, Ext, Cursor>>[],
    after: [] as KeyHandler<EngineContext<Id, Ext, Cursor>>[],
  };
  private frameSource: FrameSource | null = null;
  private dirty = false;
  private paused = false;
  private wantedCursor: Cursor;
  private shownCursor: Cursor | null = null;
  private failure: { error: unknown; sceneId: Id } | null = null;

  constructor(
    private readonly host: MohawkHost<Cursor>,
    private readonly options: EngineOptions<Id, Ext, Cursor>,
  ) {
    this.wantedCursor = options.defaultCursor;
    this.scenes = new SceneManager(() => this.ctx);
    if (options.sceneName) this.scenes.describe = options.sceneName;
    const base: BaseSceneContext<Id, Cursor> = {
      host,
      clock: this.clock,
      rng: new MsvcRandom(options.seed ?? host.unixMillis() >>> 0),
      resources: new Resources(host, options.resources),
      input: host.input,
      scenes: this.scenes,
      services: this.services,
      requestPresent: () => this.requestPresent(),
      setCursor: (cursor) => {
        this.wantedCursor = cursor;
      },
    };
    this.ctx = Object.assign(base, options.extend(base));
    this.scenes.onEntered = () => this.requestPresent();
    this.scenes.onLoadError = (id, error) => {
      this.failure = { error, sceneId: id };
      options.onError?.(error, id);
    };
  }

  /** Associe une fabrique de scène à un identifiant. */
  register(id: Id, factory: SceneFactory<EngineContext<Id, Ext, Cursor>>): void {
    this.scenes.register(id, factory);
  }

  /** Lance la première scène (`options.start` par défaut) ; effective au premier tick. */
  start(id: Id = this.options.start): void {
    this.scenes.request(id);
  }

  /** Couche graphique : d'où vient l'image à présenter. Sans source, rien n'est présenté. */
  setFrameSource(source: FrameSource | null): void {
    this.frameSource = source;
  }

  addTickHook(hook: TickHook<EngineContext<Id, Ext, Cursor>>): void {
    this.tickHooks.push(hook);
  }

  /** `before` : avant la scène (gadgets, `10a0:098e`) ; `after` : touches non consommées (historique des séquences secrètes `1018:03fd`). */
  addKeyHandler(stage: "before" | "after", handler: KeyHandler<EngineContext<Id, Ext, Cursor>>): void {
    this.keyHandlers[stage].push(handler);
  }

  /** Marque l'image comme modifiée. */
  requestPresent(): void {
    this.dirty = true;
  }

  /** Vrai pendant le chargement d'une scène (curseur occupé). */
  get loading(): boolean {
    return this.scenes.isLoading;
  }

  /** Promesse du chargement en cours, `null` sinon (utile pour un hôte de test). */
  get whenLoaded(): Promise<void> | null {
    return this.scenes.whenLoaded;
  }

  /**
   * Dernière erreur de chargement. Si la toute première scène échoue, il n'y a rien à afficher : `failed` devient vrai et le moteur
   * ne tourne plus. Sinon l'ancienne scène continue, mais l'hôte (`ui/app.ts`) doit tester `error` et arrêter la boucle : une scène figée sous un fondu tenu ne montrerait rien.
   */
  get error(): { error: unknown; sceneId: Id } | null {
    return this.failure;
  }

  get failed(): boolean {
    return this.failure !== null && this.scenes.current === undefined;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause de l'hôte (onglet masqué) : plus aucun tick, l'audio est suspendu ; à la reprise l'absence n'est pas rattrapée.
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) this.host.audio.suspend();
    else {
      this.clock.resync();
      this.host.audio.resume();
    }
  }

  /** Demande de sortie (fermeture, bouton Quitter) à la scène courante. */
  requestExit(): boolean {
    return this.scenes.requestExit();
  }

  /** Une image affichée : joue les ticks dus, puis présente l'image si une scène l'a demandé. */
  frame(nowMs: number): void {
    if (this.paused || this.failed) return;
    this.clock.update(nowMs);
    while (this.clock.consume()) this.tick();
    this.syncCursor();
    if (this.dirty && this.frameSource) {
      this.dirty = false;
      this.host.present(this.frameSource());
    }
  }

  private tick(): void {
    this.scenes.step();
    const { input } = this.ctx;
    input.beginTick();
    for (const event of input.keyEvents) this.dispatchKey(event);
    for (const hook of this.tickHooks) hook(this.ctx);
    this.scenes.tickScene();
  }

  private dispatchKey(event: KeyEvent): void {
    const ctx = this.ctx;
    for (const handler of this.keyHandlers.before) if (handler(event, ctx)) return;
    if (this.scenes.keyScene(event)) return;
    for (const handler of this.keyHandlers.after) if (handler(event, ctx)) return;
    // Global (Mathémagique engine.md §5.3) : Ctrl+Q quitte, sauf si le jeu l'a désactivé (`quitOnCtrlQ`).
    if (this.options.quitOnCtrlQ !== false && event.ctrl && !event.alt && event.code === "KeyQ") this.host.exit();
  }

  private syncCursor(): void {
    const cursor = this.scenes.isLoading ? this.options.busyCursor : this.wantedCursor;
    if (cursor !== this.shownCursor) {
      this.shownCursor = cursor;
      this.host.setCursor(cursor);
    }
  }
}
