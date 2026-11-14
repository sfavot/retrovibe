/**
 * Moteur de *Beneath a Steel Sky* sans navigateur : initialisation, départ après l'introduction, « Recommencer », boucle de jeu et cadence.
 * C'est aussi le fournisseur des dépendances de la logique (`LogicDeps`).
 *
 * Référence : ScummVM engines/sky/sky.cpp (`SkyEngine::init`, `go`, `handleKey`, `delay`, `initItemList`, `loadFixedItems`), control.cpp
 * (`Control::restartGame`, `parseSaveData`), logic.cpp (`Logic::Logic`, `parseSaveData`) (GPL v3 ou ultérieure).
 *
 * **Cadence** : l'hôte appelle `tick()` toutes les 20 ms (`TICK_MS`) ; un tour de jeu part quand l'horloge du moteur atteint l'échéance
 * calculée comme `go` (`delayCount += gameSpeed`, remise à l'heure si le tour a pris du retard, par exemple après un fondu). Un tour est un
 * générateur (`cycle`) exécuté par `SequenceRunner` : il s'achève dans le tick s'il ne demande aucun effet bloquant, sinon il avance d'un
 * pas d'effet par tick (fondus de 32 pas de 20 ms…) et la logique reprend au compact suivant (`engine.md` § 13).
 *
 * Ordre d'un tour (`go`) : file des effets sonores, entrées reçues (`SkyEngine::delay` les transmettait à la fin du tour précédent),
 * `mouseEngine`, touches, `Logic::engine`, `processSequence`, part logique de `recreate` / `spriteEngine` (`Logic.spriteEngineStatus`).
 * `compose` (`recreate`, `spriteEngine`, `flip`) est le dessin de l'écran (`BassScreen`) et clôt le tour.
 *
 * **Entrées** : `pointerMove`, `pointerDown`, `pointerUp` et `key` (ou `BassHost.pollInput`) ; voir `docs/bass/engine.md` § 17.
 *
 * Écarts volontaires : l'introduction n'est pas jouée (vague I) : `startAfterIntro` est le départ de ScummVM quand on la passe (Échap :
 * `restartGame`) ; le panneau de contrôle, la pause (`p`) et les sauvegardes sont à `GameControl` (vague S) ; les modes rapides de débogage ne sont pas portés.
 */

import { ScummvmRandom } from "../../../engine/rng";
import { SequenceRunner } from "../../../engine/sequence";
import type { Sequence } from "../../../engine/sequence";
import type { SkyCpt } from "../data/cpt";
import type { SkyDisk } from "../data/disk";
import { Compacts } from "./compacts";
import { ItemCache } from "./files";
import { type BassAction, type BassHost, type BassInput, MouseButton } from "./host";
import { F_MODULE_0, FIXED_ITEMS, FULL_SCREEN_HEIGHT, FULL_SCREEN_WIDTH, GAME_VERSION, SF } from "./ids";
import { Logic, type LogicDeps, type SystemVars } from "./logic";
import { Mouse } from "./mouse";
import { AutoRoute } from "./route/autoroute";
import { Grid } from "./route/grid";
import { applySaveWords } from "./save";
import { copy } from "../copy";
import { GameControl } from "./control/control";
import { BassTextManager } from "./text";
import {
  type BassScreen,
  type BassSound,
  type BassText,
  NullScreen,
  type Router,
  SilentSound,
  StubRouter,
  type WalkGrid,
} from "./services";
import type { EngineTrace } from "./trace";
import { createScriptVars } from "./vars";

/** Bouton du pointeur donné par l'hôte (`EVENT_LBUTTONDOWN` = gauche, `EVENT_RBUTTONDOWN` = droit). */
export type PointerButton = "left" | "right";

/**
 * Touches que le moteur lit (`metaengine.cpp` : Échap = `kSkyActionSkip`, « . » = `kSkyActionSkipLine`, « p » = `kSkyActionPause`) ; F5, le
 * panneau de contrôle, appartient à la vague S.
 */
const KEY_ACTIONS: Readonly<Record<string, BassAction>> = { Escape: "skip", ".": "skipLine", p: "pause", P: "pause", F5: "panel" };

/** Pas de l'hôte (ms) : celui des fondus et des attentes de ScummVM. */
export const TICK_MS = 20;
/** Durée d'un tour de jeu par défaut (`gameSpeed`). */
export const DEFAULT_GAME_SPEED = 80;
/** Lignes de journal gardées. */
const JOURNAL_SIZE = 200;

/** Fichiers du jeu : `sky.dsk` (`SkyDisk` ou équivalent) et `sky.cpt` lu. */
export interface BassData {
  readonly disk: Pick<SkyDisk, "has" | "load">;
  readonly cpt: SkyCpt;
}

export interface BassEngineOptions {
  data: BassData;
  host: BassHost;
  /** Graine du hasard (`--random-seed` du banc) ; 1 par défaut. */
  seed?: number;
  /** Écran : `NullScreen` par défaut (logique seule) ; une fabrique reçoit le moteur (déjà muni de ses compacts, variables et fichiers). */
  screen?: BassScreen | ((engine: BassEngine) => BassScreen);
  sound?: BassSound;
  /** Textes : `BassTextManager` par défaut (français) ; `NullText` pour des tests sans données de texte ; une fabrique reçoit le moteur. */
  text?: BassText | ((engine: BassEngine) => BassText);
  grid?: WalkGrid;
  router?: Router;
  trace?: EngineTrace;
  /** Drapeaux de texte et de voix (`SF_ALLOW_TEXT`, `SF_ALLOW_SPEECH`) : les deux par défaut (D4, « texte + voix »). */
  subtitles?: boolean;
  speech?: boolean;
  /** Questions oui / non du panneau (`copy.ts` par défaut ; le banc de ScummVM les pose en anglais). */
  questions?: { restart: string; quit: string };
}

/** Service donné tel quel, fabriqué à partir du moteur, ou par défaut. */
function resolveService<T extends object>(option: T | ((engine: BassEngine) => T) | undefined, engine: BassEngine, byDefault: () => T): T {
  if (option === undefined) return byDefault();
  return typeof option === "function" ? option(engine) : option;
}

export class BassEngine {
  readonly host: BassHost;
  readonly vars = createScriptVars();
  readonly compacts: Compacts;
  readonly items: ItemCache;
  readonly mouse: Mouse;
  readonly logic: Logic;
  readonly rng: ScummvmRandom;
  readonly system: SystemVars;
  readonly screen: BassScreen;
  readonly sound: BassSound;
  readonly text: BassText;
  readonly grid: WalkGrid;
  readonly router: Router;
  /** Panneau de contrôle, pause, sauvegardes et restitutions (vague S, `engine.md` § 19). */
  readonly control: GameControl;
  readonly journal: string[] = [];
  /** Tours de jeu commencés (le `n` des lignes `CY` du banc). */
  cycleCount = 0;
  /** Tours de jeu terminés. */
  completedCycles = 0;
  /** Horloge du moteur (ms), avancée de `TICK_MS` par `tick`. */
  timeMs = 0;
  /** Curseur rendu par la dernière restitution (`Control::_savedMouse`). */
  savedMouse = 6;

  private readonly disk: BassData["disk"];
  private readonly cpt: SkyCpt;
  private readonly trace?: EngineTrace;
  private readonly runner: SequenceRunner;
  private input: BassInput[] = [];
  private skipLine = false;
  private delayCount = 0;
  private nextCycleAt = 0;

  constructor(options: BassEngineOptions) {
    this.host = options.host;
    this.disk = options.data.disk;
    this.cpt = options.data.cpt;
    this.trace = options.trace;
    this.rng = new ScummvmRandom(options.seed ?? 1);
    this.sound = options.sound ?? new SilentSound();

    // `SkyEngine::init` : version CD, AdLib, sous-titres et voix selon la configuration, 80 ms par tour.
    let flags = SF.SBLASTER | SF.PLAY_VOCS;
    if (options.subtitles ?? true) flags |= SF.ALLOW_TEXT;
    if (options.speech ?? true) flags |= SF.ALLOW_SPEECH;
    this.system = { systemFlags: flags, gameVersion: GAME_VERSION, gameSpeed: DEFAULT_GAME_SPEED, currentPalette: 0, currentMusic: 0, pastIntro: false };

    this.compacts = new Compacts(this.cpt);
    // Marche (vague E) : grilles et cheminement de ScummVM, sauf service injecté (tests).
    const grid = new Grid({ disk: { has: (id) => this.disk.has(id), load: (id) => this.disk.load(id) }, vars: this.vars, compacts: this.compacts });
    this.grid = options.grid ?? grid;
    this.router = options.router ?? (options.grid ? new StubRouter() : new AutoRoute(grid, this.compacts));
    this.items = new ItemCache({ load: (id) => (this.disk.has(id) ? this.disk.load(id) : null) }, (m) => this.log(m));
    this.items.loadFixedItems(FIXED_ITEMS);
    // Services qui lisent le moteur : construits une fois ses compacts, ses variables et ses fichiers prêts.
    this.screen = resolveService(options.screen, this, () => new NullScreen());
    this.text = resolveService(
      options.text,
      this,
      () => new BassTextManager({ disk: this.disk, compacts: this.compacts, items: this.items, vars: this.vars, log: (m) => this.log(m) }),
    );
    const engine = this;
    this.mouse = new Mouse({
      vars: this.vars,
      compacts: this.compacts,
      get systemFlags() {
        return engine.system.systemFlags;
      },
      set systemFlags(v: number) {
        engine.system.systemFlags = v;
      },
      mouseScript: (scr, item) => this.logic.mouseScript(scr, item),
      script: (no, off) => this.logic.script(no, off),
    });
    this.control = new GameControl({
      host: this.host,
      vars: this.vars,
      compacts: this.compacts,
      items: this.items,
      mouse: this.mouse,
      system: this.system,
      screen: this.screen,
      sound: this.sound,
      text: this.text,
      rng: this.rng,
      logic: () => this.logic,
      loadFile: (id) => this.disk.load(id),
      pristine: this.cpt.raw,
      restart: () => this.restartGame(),
      savedMouse: () => this.savedMouse,
      isBlocked: () => this.runner.active,
      restartQuestion: options.questions?.restart ?? copy.restartQuestion,
      quitQuestion: options.questions?.quit ?? copy.quitQuestion,
    });
    const deps: LogicDeps = {
      vars: this.vars,
      compacts: this.compacts,
      items: this.items,
      mouse: this.mouse,
      system: this.system,
      rng: this.rng,
      screen: this.screen,
      sound: this.sound,
      text: this.text,
      grid: this.grid,
      router: this.router,
      control: this.control,
      loadModule: (n) => this.disk.load(F_MODULE_0 + n),
      nowMs: () => this.timeMs,
      takeSkip: () => this.drainInputForSkip(),
      log: (m) => this.log(m),
      trace: this.trace,
    };
    this.logic = new Logic(deps);
    this.runner = new SequenceRunner({ now: () => Math.floor(this.timeMs / TICK_MS), takeSkip: () => false, interrupted: () => false });
  }

  // --- Entrées de l'hôte (`SkyEngine::delay`) ---
  //
  // Les entrées sont mises en file et lues au début du tour suivant ; un hôte peut aussi les passer par `BassHost.pollInput()`. Les
  // coordonnées sont celles de l'écran de 320 x 200 (comme les événements de ScummVM, avant `TOP_LEFT_X/Y`).

  /** Position du pointeur de la machine (celle que dessine le curseur) et boutons enfoncés : voir `Mouse`. */
  get pointer(): { readonly x: number; readonly y: number } {
    return { x: this.mouse.pointerX, y: this.mouse.pointerY };
  }

  /** `EVENT_MOUSEMOVE` : le jeu ne suit le pointeur que si la souris n'est pas verrouillée, le curseur dessiné le suit toujours. */
  pointerMove(x: number, y: number): void {
    this.receive({ type: "move", x, y });
  }

  /** `EVENT_LBUTTONDOWN` / `EVENT_RBUTTONDOWN` à la position courante du pointeur (gauche : bouton 2 du jeu, droit : bouton 1). */
  pointerDown(button: PointerButton): void {
    this.mouse.held |= button === "left" ? MouseButton.Left : MouseButton.Right;
    this.receive({ type: "click", x: this.mouse.pointerX, y: this.mouse.pointerY, button: button === "left" ? MouseButton.Left : MouseButton.Right });
  }

  /** `EVENT_LBUTTONUP` / `EVENT_RBUTTONUP` : le jeu ne lit que l'état « enfoncé » (`waitMouseNotPressed`). */
  pointerUp(button: PointerButton): void {
    this.mouse.held &= ~(button === "left" ? MouseButton.Left : MouseButton.Right);
  }

  /** Touche (`KeyboardEvent.key`) : Échap passe l'introduction, « . » la réplique, « p » la pause. Vrai si le moteur la prend. */
  key(key: string): boolean {
    const action = KEY_ACTIONS[key] ?? (this.control.paused ? "key" : undefined);
    if (!action) return false;
    this.receive({ type: "action", action });
    return true;
  }

  /** Une entrée reçue : le pointeur de la machine la suit tout de suite, le jeu la lira au prochain tour. */
  private receive(event: BassInput): void {
    this.input.push(event.type === "action" ? event : this.trackPointer(event));
  }

  /** Le pointeur de la machine suit l'entrée (coordonnées bornées à l'écran). */
  private trackPointer<E extends Exclude<BassInput, { type: "action" }>>(event: E): E {
    this.mouse.pointerX = Math.max(0, Math.min(FULL_SCREEN_WIDTH - 1, Math.round(event.x)));
    this.mouse.pointerY = Math.max(0, Math.min(FULL_SCREEN_HEIGHT - 1, Math.round(event.y)));
    return { ...event, x: this.mouse.pointerX, y: this.mouse.pointerY };
  }

  log(message: string): void {
    this.journal.push(message);
    if (this.journal.length > JOURNAL_SIZE) this.journal.shift();
    this.host.log?.(message);
  }

  /**
   * Départ après l'introduction passée (Échap) : `go` appelle `Control::restartGame`, qui charge les données de remise à zéro de
   * `sky.cpt` comme une sauvegarde. Foster est sur la passerelle de l'usine (écran 0), sans l'animation d'ouverture.
   */
  startAfterIntro(): void {
    this.restartGame();
    this.delayCount = this.timeMs;
    this.nextCycleAt = this.timeMs;
  }

  /** `Control::restartGame` : remise à zéro par les données de `sky.cpt`. */
  restartGame(): void {
    const reset = this.cpt.createResetData(GAME_VERSION);
    this.parseSaveData(reset);
    this.system.pastIntro = true;
    this.screen.reset();
    this.screen.setPalette(this.system.currentPalette);
    this.mouse.sprite(this.savedMouse, 0, 0);
  }

  /** `Control::parseSaveData` (`applySaveWords`, `save.ts`) : l'état du moteur devient celui de `words`. */
  private parseSaveData(words: Uint16Array): void {
    this.savedMouse = applySaveWords(this.control, words).mouseType;
  }

  // --- Boucle ---

  /** Un pas de 20 ms : reprend le tour en cours (effet bloquant) ou lance le tour suivant à son échéance. */
  tick(): void {
    const polled = this.host.pollInput();
    const rest = this.control.tick(polled);
    if (rest === null) {
      // Panneau, pause ou dialogue : le jeu est figé (ni horloge ni tour), le pointeur de la machine suit quand même.
      for (const event of polled) if (event.type !== "action") this.trackPointer(event);
      return;
    }
    for (const event of rest) this.receive(event);
    if (this.runner.active) {
      this.runner.step();
      if (!this.runner.active) this.endCycle();
    }
    if (!this.runner.active && this.timeMs >= this.nextCycleAt) this.startCycle();
    this.timeMs += TICK_MS;
  }

  /** Vrai pendant un effet bloquant (le tour de logique est suspendu). */
  get blocked(): boolean {
    return this.runner.active;
  }

  /** Avance tick par tick jusqu'à ce que `n` tours soient terminés (tests). */
  runCycles(n: number, maxTicks = n * 1000): void {
    const target = this.completedCycles + n;
    for (let t = 0; this.completedCycles < target; t++) {
      if (t >= maxTicks) throw new Error(`runCycles : ${n} tours non atteints en ${maxTicks} ticks`);
      this.tick();
    }
  }

  private startCycle(): void {
    this.runner.start(this.cycle());
    if (!this.runner.active) this.endCycle();
  }

  /** Échéance du tour suivant (`go` : `delayCount += gameSpeed`, remise à l'heure en cas de retard). */
  private endCycle(): void {
    this.completedCycles++;
    const speed = this.system.gameSpeed;
    this.delayCount += speed;
    let need = this.delayCount - this.timeMs;
    if (need < 0 || need > speed) {
      need = 0;
      this.delayCount = this.timeMs;
    }
    this.nextCycleAt = this.timeMs + need;
  }

  /** Un tour de `SkyEngine::go`. */
  private *cycle(): Sequence {
    this.sound.checkFxQueue();
    this.applyInput();
    this.mouse.engine();
    yield* this.logic.effects.flush();
    this.handleKey();
    this.cycleCount++;
    this.trace?.cycle?.(this.cycleCount, this.vars, this.compacts);
    yield* this.logic.engine();
    this.screen.processSequence(this.timeMs);
    this.logic.spriteEngineStatus();
    this.screen.compose(); // `recreate`, `spriteEngine`, `flip`
  }

  /** Entrées reçues : `SkyEngine::delay` (pointeur ignoré s'il est verrouillé, clic gauche = 2, droit = 1). */
  private applyInput(): void {
    const locked = (): boolean => (this.system.systemFlags & SF.MOUSE_LOCKED) !== 0;
    for (const event of this.input) {
      this.trace?.input?.(this.cycleCount + 1, event);
      switch (event.type) {
        case "move":
          if (!locked()) this.mouse.moved(event.x, event.y);
          break;
        case "click":
          if (!locked()) this.mouse.moved(event.x, event.y);
          this.mouse.pressed(event.button);
          break;
        case "action":
          if (event.action === "skipLine") this.skipLine = true;
          else if (event.action === "skip" && !this.system.pastIntro) this.restartGame();
          break;
      }
    }
    this.input = [];
  }

  /** `handleKey` : « . » passe la réplique (`logicClick`). */
  private handleKey(): void {
    if (this.skipLine) this.mouse.logicClick = true;
    this.skipLine = false;
  }

  /** Pendant une attente qui lit les événements (`waitMouseNotPressed`, `waitForSequence`) : entrées jetées ; vrai si Échap en faisait partie. */
  private drainInputForSkip(): boolean {
    for (const event of this.host.pollInput()) this.receive(event);
    const skip = this.input.some((e) => e.type === "action" && e.action === "skip");
    this.input = [];
    return skip;
  }
}
