import type { Clock } from "./clock";
import type { CursorKind, Host } from "./host";
import type { Input, KeyEvent } from "./input";
import type { Resources } from "./resources";
import type { MsvcRandom } from "./rng";
import type { RosterState } from "./roster";

/**
 * Les 11 scènes de `MATH` (engine.md §1.4, table `1108:1b22`). Les identifiants sont ceux de la variable de scène demandée
 * `1108:1b20` ; le titre (8) est la première scène.
 */
export const SceneId = {
  hub: 0,
  bowling: 1,
  rhythm: 2,
  patternWindows: 3,
  hidden: 4,
  patterns: 5,
  sticklers: 6,
  rockets: 7,
  title: 8,
  credits: 9,
  trophy: 10,
} as const;

export type SceneName = keyof typeof SceneId;
export type SceneId = (typeof SceneId)[SceneName];

/** Noms par identifiant (`SCENE_NAMES[8] === "title"`). */
export const SCENE_NAMES: readonly SceneName[] = Object.entries(SceneId)
  .sort(([, a], [, b]) => a - b)
  .map(([name]) => name as SceneName);

// --- Services ---

/** Clé typée d'un service (`defineService<T>("graphics")`). */
export interface ServiceKey<T> {
  readonly name: string;
  /** Marque de type, jamais lue. */
  readonly type?: T;
}

export function defineService<T>(name: string): ServiceKey<T> {
  return { name };
}

/**
 * Point d'extension du contexte : chaque vague de services (graphismes F2, son F3, lecteur de scripts et gadgets G1, aide de Poly G3…)
 * définit sa clé dans son propre module, l'enregistre au démarrage (`services.provide`) et les scènes la lisent par
 * `ctx.services.get(KEY)`. Le contexte lui-même ne change donc pas quand un service arrive.
 */
export class Services {
  private readonly values = new Map<string, unknown>();

  provide<T>(key: ServiceKey<T>, value: T): void {
    this.values.set(key.name, value);
  }

  has<T>(key: ServiceKey<T>): boolean {
    return this.values.has(key.name);
  }

  /** Lève si le service n'a pas été enregistré (oubli au démarrage : erreur de programmation). */
  get<T>(key: ServiceKey<T>): T {
    if (!this.values.has(key.name)) throw new Error(`Service « ${key.name} » non enregistré`);
    return this.values.get(key.name) as T;
  }

  tryGet<T>(key: ServiceKey<T>): T | undefined {
    return this.values.get(key.name) as T | undefined;
  }
}

/** Tout ce qu'une scène peut utiliser. Passé à chaque méthode de `Scene`. */
export interface SceneContext {
  readonly host: Host;
  readonly clock: Clock;
  readonly rng: MsvcRandom;
  readonly resources: Resources;
  /** Joueurs, préférences et joueur courant. */
  readonly roster: RosterState;
  readonly input: Input;
  readonly scenes: SceneManager;
  /** Services ajoutés par les autres couches (graphismes, son, lecteur de scripts, gadgets…). */
  readonly services: Services;
  /** Signale que l'image a changé : l'hôte la recevra à la fin de l'image affichée en cours. */
  requestPresent(): void;
  /** Curseur voulu par la scène ; le moteur impose `busy` pendant un chargement et le rétablit ensuite. */
  setCursor(cursor: CursorKind): void;
}

/**
 * Une scène est une machine à états, jamais une boucle bloquante : les attentes de l'original deviennent des états
 * (échéances en ticks, `clock.deadline`), jamais un `await` dans `tick`.
 *
 * Cycle de vie : `load` (async, la scène précédente est gelée) → `leave` de la précédente → `enter` → { `tick` / `key` }* → `leave`.
 * `exit` n'est pas une étape du cycle : c'est la demande de sortie (bouton Quitter, fermeture) que la scène traite comme elle veut,
 * en général en demandant le hub (`ctx.scenes.request(SceneId.hub)`).
 */
export interface Scene {
  /** Ouvre les archives et décode ce qui doit l'être (`ctx.resources.open`). Facultatif. */
  load?(ctx: SceneContext): Promise<void>;
  /** Construit l'écran : état initial, premier dessin. Les ressources sont prêtes. */
  enter(ctx: SceneContext): void;
  /** Libère ce qui n'est pas dans `Resources` (sons en cours, minuteries…). Appelé avant l'`enter` de la suivante. */
  leave(ctx: SceneContext): void;
  /** Un tick (17 ms), équivalent du `Tick` du descripteur (`+0x08`) : animations, minuteries, IA. */
  tick(ctx: SceneContext): void;
  /** Demande de sortie ; absent = la scène l'ignore (titre, crédits, hub, bowling n'ont pas d'`Exit`). */
  exit?(ctx: SceneContext): void;
  /** Touche ; renvoie vrai si elle est consommée (équivalent du `Key` du descripteur, `+0x10`). */
  key?(event: KeyEvent, ctx: SceneContext): boolean;
}

export type SceneFactory = () => Scene;

interface Loading {
  id: SceneId;
  scene: Scene;
  /** Vrai quand la promesse de `load` est réglée. */
  settled: boolean;
  failure?: { error: unknown };
  promise: Promise<void>;
}

/**
 * Gestionnaire de scènes à changement **différé** (engine.md §1.4) : `request(id)` note la scène voulue (`1108:1b20`), la
 * bascule a lieu au début du tick suivant (`step`), jamais au milieu d'un tick ni pendant un `enter`/`leave`.
 *
 * Bascule : `load` de la nouvelle scène pendant que l'ancienne est gelée (plus de `tick`, son dernier écran reste affiché), puis dans
 * le même tick `leave` de l'ancienne, libération de ses archives, `enter` de la nouvelle. Si `load` échoue, l'ancienne scène
 * reprend et `onLoadError` est appelé. Une demande reçue pendant un chargement est gardée pour après (la dernière l'emporte), sauf si elle vise la scène déjà en chargement ou déjà demandée (ignorée).
 */
export class SceneManager {
  private readonly factories = new Map<SceneId, SceneFactory>();
  private active: { id: SceneId; scene: Scene } | null = null;
  private requested: SceneId | null = null;
  private loading: Loading | null = null;

  /** Appelé quand le chargement d'une scène a échoué (la scène précédente, s'il y en a une, continue). */
  onLoadError: ((id: SceneId, error: unknown) => void) | null = null;
  /** Appelé après chaque `enter` (le moteur y demande une présentation). */
  onEntered: (() => void) | null = null;

  constructor(private readonly context: () => SceneContext) {}

  register(id: SceneId, factory: SceneFactory): void {
    this.factories.set(id, factory);
  }

  /** Scène courante (`undefined` avant la première, ou si son chargement a échoué). */
  get current(): Scene | undefined {
    return this.active?.scene;
  }

  get currentId(): SceneId | undefined {
    return this.active?.id;
  }

  /** Scène demandée et pas encore entamée. */
  get pending(): SceneId | null {
    return this.requested;
  }

  /** Vrai pendant le `load` d'une scène. */
  get isLoading(): boolean {
    return this.loading !== null;
  }

  /** Promesse du chargement en cours (pour qu'un hôte de test attende) ; `null` s'il n'y en a pas. */
  get whenLoaded(): Promise<void> | null {
    return this.loading && !this.loading.settled ? this.loading.promise : null;
  }

  /** Demande une scène ; effective au début du prochain tick. */
  request(id: SceneId): void {
    // Idempotent : un second clic sur la même sortie ne doit pas rejouer la scène après la bascule.
    if (this.loading?.id === id || this.requested === id) return;
    this.requested = id;
  }

  /** Début de tick : poursuit ou lance une bascule. À appeler avant tout le reste du tick. */
  step(): void {
    const loading = this.loading;
    if (loading) {
      if (!loading.settled) return;
      this.loading = null;
      const ctx = this.context();
      if (loading.failure) {
        ctx.resources.abortSceneLoad();
        this.onLoadError?.(loading.id, loading.failure.error);
      } else {
        this.switchTo(loading.id, loading.scene, ctx);
      }
      // Une demande faite pendant `enter` ou pendant le chargement attend le tick suivant.
      return;
    }
    if (this.requested !== null && !this.loading) {
      const id = this.requested;
      this.requested = null;
      this.begin(id);
    }
  }

  /** Tick de la scène courante (rien pendant un chargement ou sans scène). */
  tickScene(): void {
    if (this.active && !this.loading) this.active.scene.tick(this.context());
  }

  /** Touche pour la scène courante ; faux si aucune scène ou si elle ne la consomme pas. */
  keyScene(event: KeyEvent): boolean {
    if (!this.active || this.loading) return false;
    return this.active.scene.key?.(event, this.context()) === true;
  }

  /** Demande de sortie à la scène courante ; renvoie faux si elle n'a pas d'`exit`. */
  requestExit(): boolean {
    const scene = this.active?.scene;
    if (!scene?.exit || this.loading) return false;
    scene.exit(this.context());
    return true;
  }

  private begin(id: SceneId): void {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`SceneManager : scène ${id} (${SCENE_NAMES[id]}) non enregistrée`);
    const scene = factory();
    const ctx = this.context();
    if (!scene.load) {
      this.switchTo(id, scene, ctx);
      return;
    }
    ctx.resources.beginSceneLoad();
    const loading: Loading = { id, scene, settled: false, promise: Promise.resolve() };
    loading.promise = Promise.resolve()
      .then(() => scene.load!(ctx))
      .then(
        () => {
          loading.settled = true;
        },
        (error: unknown) => {
          loading.settled = true;
          loading.failure = { error };
        },
      );
    this.loading = loading;
  }

  private switchTo(id: SceneId, scene: Scene, ctx: SceneContext): void {
    const previous = this.active;
    this.active = null;
    previous?.scene.leave(ctx);
    ctx.resources.commitScene();
    // Les clics et touches arrivés pendant l'ancienne scène ou le chargement ne doivent pas agir sur la nouvelle.
    ctx.input.flush();
    this.active = { id, scene };
    scene.enter(ctx);
    this.onEntered?.();
  }
}
