import { Clock } from "./clock";
import type { Frame } from "./graphics/frame";
import type { CursorKind, Host } from "./host";
import type { KeyEvent } from "./input";
import { Resources } from "./resources";
import { MsvcRandom } from "./rng";
import { RosterState, RosterStore } from "./roster";
import { SceneId, SceneManager, Services, type SceneContext, type SceneFactory } from "./scene";

/** Source de l'image à présenter : fournie par la couche graphique (F2) via `Engine.setFrameSource`. */
export type FrameSource = () => Frame;

/** Appelé à chaque tick, avant le `tick` de la scène (gadgets, lecteur de scripts, séquenceur…). */
export type TickHook = (ctx: SceneContext) => void;

/** Gestionnaire de touche ; renvoie vrai si la touche est consommée. */
export type KeyHandler = (event: KeyEvent, ctx: SceneContext) => boolean;

export interface EngineOptions {
  /** Graine du hasard ; défaut : l'horloge murale (`host.unixMillis()`, 32 bits bas). */
  seed?: number;
  /** Appelé quand une scène n'a pas pu être chargée. */
  onError?: (error: unknown, sceneId: SceneId) => void;
}

/**
 * Moteur : assemble l'horloge, les entrées, le hasard, le roster, les ressources et le gestionnaire de scènes autour d'un
 * `Host`. L'hôte appelle `frame(now)` à chaque image affichée (`requestAnimationFrame`, ou la boucle de l'hôte de test) ; tout
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
export class Engine {
  readonly ctx: SceneContext;
  readonly scenes: SceneManager;
  readonly services = new Services();
  private readonly clock = new Clock();
  private readonly tickHooks: TickHook[] = [];
  private readonly keyHandlers = { before: [] as KeyHandler[], after: [] as KeyHandler[] };
  private frameSource: FrameSource | null = null;
  private dirty = false;
  private paused = false;
  private wantedCursor: CursorKind = "arrow";
  private shownCursor: CursorKind | null = null;
  private failure: { error: unknown; sceneId: SceneId } | null = null;

  constructor(
    private readonly host: Host,
    options: EngineOptions = {},
  ) {
    const rosterStore = new RosterStore(host.storage);
    this.scenes = new SceneManager(() => this.ctx);
    this.ctx = {
      host,
      clock: this.clock,
      rng: new MsvcRandom(options.seed ?? host.unixMillis() >>> 0),
      resources: new Resources(host),
      roster: new RosterState(rosterStore),
      input: host.input,
      scenes: this.scenes,
      services: this.services,
      requestPresent: () => this.requestPresent(),
      setCursor: (cursor) => {
        this.wantedCursor = cursor;
      },
    };
    this.scenes.onEntered = () => this.requestPresent();
    this.scenes.onLoadError = (id, error) => {
      this.failure = { error, sceneId: id };
      options.onError?.(error, id);
    };
  }

  /** Associe une fabrique de scène à un identifiant. */
  register(id: SceneId, factory: SceneFactory): void {
    this.scenes.register(id, factory);
  }

  /** Lance la première scène (l'écran titre par défaut, comme `1108:1b20 = 8`) ; effective au premier tick. */
  start(id: SceneId = SceneId.title): void {
    this.scenes.request(id);
  }

  /** Couche graphique : d'où vient l'image à présenter. Sans source, rien n'est présenté. */
  setFrameSource(source: FrameSource | null): void {
    this.frameSource = source;
  }

  addTickHook(hook: TickHook): void {
    this.tickHooks.push(hook);
  }

  /** `before` : avant la scène (gadgets, `10a0:098e`) ; `after` : touches non consommées (historique des séquences secrètes `1018:03fd`). */
  addKeyHandler(stage: "before" | "after", handler: KeyHandler): void {
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
   * ne tourne plus. Sinon l'ancienne scène continue et l'erreur reste consultable ici.
   */
  get error(): { error: unknown; sceneId: SceneId } | null {
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
    // Global (engine.md §5.3) : Ctrl+Q quitte. Ctrl+V (boîte « À propos ») viendra avec les services d'affichage.
    if (event.ctrl && !event.alt && event.code === "KeyQ") this.host.exit();
  }

  private syncCursor(): void {
    const cursor = this.scenes.isLoading ? "busy" : this.wantedCursor;
    if (cursor !== this.shownCursor) {
      this.shownCursor = cursor;
      this.host.setCursor(cursor);
    }
  }
}
