/**
 * Moteur des *Voyageurs du temps* sans navigateur : initialisation, boucle principale (un tick ≈ 110 ms), exécution des scripts,
 * attentes bloquantes (fondus, clic sur un message, menus), chargements différés, hasard. C'est aussi le `VmContext` des opcodes et
 * l'`InputEngine` des entrées.
 *
 * Référence : ScummVM engines/cine/cine.cpp (`initialize`, `run`, `getTimerDelay`), main_loop.cpp (`mainLoop`, `manageEvents`,
 * `processEvent`, `getMouseData`), script_fw.cpp (`executeObjectScripts`, `executeGlobalScripts`, `o1_loadBg`), gfx.cpp (`drawFrame`,
 * `renderOverlay` pour les messages, `fadeToBlack`, `fadeFromBlack`), bg_list.cpp (`addToBGList`) (GPL v3 ou ultérieure).
 * docs/voyageurs/engine.md § 1.2.
 *
 * **Cadence** : l'hôte appelle `step()` toutes les 10 ms (`STEP_MS`, le pas de `manageEvents`). Un tick est une séquence (`cycle`)
 * exécutée par `SequenceRunner` : entrées (attente de `getTimerDelay()` = 109 ms en lisant la souris) → scripts objets → scripts globaux →
 * dessin → retrait des messages → fin du tick (trace) → attente d'un clic si un message est affiché → chargements différés. Les fondus
 * (8 pas de 42 ms) et les menus suspendent le tick en cours. Le nombre de ticks (`ticks`) est celui du banc (`Trace::beginTick`).
 *
 * **Hasard** : `ScummvmRandom` (graine injectable) : `loadVar` de type 5 et choix du message d'échec au dessin.
 *
 * Écarts volontaires : pas d'écran Sony (D11) ; la vitesse du jeu n'est pas réglable (+/- de ScummVM) ; le délai de 109 ms est compté en
 * pas de 10 ms (comme ScummVM en temps virtuel : 12 tours de 10 ms) ; les touches de déplacement suivent `moveUsingKeyboard` sans
 * `menuVar` (jamais alimenté dans ScummVM) ; la saisie « quit » (code mort) n'est pas reprise.
 */

import { ScummvmRandom } from "../../../engine/rng";
import { type Sequence, SequenceRunner, wait } from "../../../engine/sequence";
import { readPi1 } from "../data/pi1";
import type { VoyageursAction, VoyageursHost, VoyageursInput } from "./host";
import {
  EventSource,
  EventTarget,
  executePlayerInput,
  type InputEngine,
  type KeyboardWalk,
  type MenuState,
  playerCommandHover,
  processAction,
  type Rect,
  rectContains,
  setKeyboardWalk,
} from "./input";
import {
  addGlobalScript,
  checkForPendingDataLoad,
  loadBg,
  loadCt,
  loadPart,
  loadPrc,
  loadResource,
  type PartContext,
  PartFiles,
} from "./part";
import { FW_OPCODES, type VmContext } from "./script/opcodes";
import { type OpTracer, runScript, type ScriptInstance, type VmEffect } from "./script/vm";
import { NullRenderer, SilentAudio, type VoyageursAudio, type VoyageursRenderer } from "./services";
import { addBgIncrust, createState, type EngineState, OverlayType, removeMessages, VAR_MOUSE_X_POS, VAR_MOUSE_Y_POS } from "./state";
import { makeSave, restoreSave, saveRefusal, type SaveRefusal, type VoyageursSave } from "./save";
import { opLine, tickLine } from "./trace";
import { BOOT_PRC_NAME, BOOT_SCRIPT_INDEX } from "../data/boot";

/** Pas de l'hôte (ms) : celui de `manageEvents`. */
export const STEP_MS = 10;
/** `getTimerDelay()` à la vitesse normale : 10 923 000 × 12 / 1 193 180, division entière. */
export const TIMER_DELAY_MS = 109;
/** Pas d'un fondu (`fadeDelayMs`) et seuil de la rustine anti double fondu (`fadeToBlackMinMs`). */
export const FADE_STEP_MS = 42;
export const FADE_TO_BLACK_MIN_MS = 1000;
/** Lignes de journal gardées. */
const JOURNAL_SIZE = 200;

export interface VoyageursEngineOptions {
  host: VoyageursHost;
  /** Graine du hasard (`--random-seed` du banc) ; 1 par défaut. */
  seed?: number;
  renderer?: VoyageursRenderer;
  /** Lignes `TK` (fin de tick) et, si `traceOps`, `OP` : comparaison au banc. */
  trace?: (line: string) => void;
  traceOps?: boolean;
  /** Appelé au début de chaque tour d'une attente modale (message, menu) : le banc y livre les entrées (`Trace::modalPoll`). */
  onModalPoll?: (source: number) => void;
}

export class VoyageursEngine implements VmContext, InputEngine {
  state: EngineState = createState();
  readonly rng: ScummvmRandom;
  readonly audio: VoyageursAudio;
  readonly renderer: VoyageursRenderer;
  /** Ticks de jeu achevés (numérotation du banc). */
  ticks = 0;
  /** Temps virtuel du moteur (ms). */
  ms = 0;
  readonly mouse = { x: 0, y: 0, left: 0, right: 0 };
  readonly mouseData = { left: 0, right: 0 };
  menus: MenuState[] = [];
  inMenu = false;
  banner: string | null = null;
  actionList: VoyageursAction[] = [];
  /** Attente modale en cours (`EventSource`), ou `null`. */
  modal: number | null = null;
  quitRequested = false;
  restartRequested = false;
  /** Fond chargé (`renderer->ready()`). */
  private hasBackground = false;
  private readonly walk: KeyboardWalk = { xMove: 0, yMove: 0, moved: false };
  private readonly parts: PartFiles;
  private readonly runner: SequenceRunner;
  private readonly queue: VoyageursInput[] = [];
  private fadeToBlackLastMs: number | null = null;
  private readonly journal: string[] = [];
  private readonly tracer: OpTracer | undefined;
  private scriptKind: "g" | "o" = "g";
  /** Le tick en cours a passé l'attente des entrées (scripts, dessin, attente de clic) : pas de sauvegarde (`save.ts`). */
  private scriptsStarted = false;

  constructor(private readonly options: VoyageursEngineOptions) {
    const { host } = options;
    this.rng = new ScummvmRandom(options.seed ?? 1);
    this.audio = host.audio ?? new SilentAudio();
    this.renderer = options.renderer ?? new NullRenderer();
    this.parts = new PartFiles(host.files);
    this.runner = new SequenceRunner({ now: () => this.ms, takeSkip: () => false, interrupted: () => false });
    if (options.trace && options.traceOps) {
      const trace = options.trace;
      this.tracer = (script, opcode, args) => trace(opLine(this.ticks + 1, this.scriptKind, script, opcode, args));
    }
    this.initialize();
  }

  /** `initialize` + début de `mainLoop` (sans sauvegarde à reprendre). */
  private initialize(): void {
    this.state = createState();
    this.hasBackground = false;
    this.menus = [];
    this.inMenu = false;
    this.banner = null;
    this.restartRequested = false;
    this.renderer.reset();
    const ctx = this.partContext();
    loadPrc(ctx, this.parts, BOOT_PRC_NAME);
    this.state.names.prc = BOOT_PRC_NAME;
    addGlobalScript(this.state, BOOT_SCRIPT_INDEX);
    this.state.globals[VAR_MOUSE_X_POS] = 0;
    this.state.globals[VAR_MOUSE_Y_POS] = 0;
    this.audio.stopMusic();
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Sauvegarde (vague S, `save.ts`)

  /** Pourquoi la partie ne peut pas être sauvegardée maintenant, ou `null`. */
  saveRefusal(): SaveRefusal | null {
    return saveRefusal({
      state: this.state,
      menus: this.menus,
      inMenu: this.inMenu,
      modal: this.modal,
      banner: this.banner,
      quitRequested: this.quitRequested,
      restartRequested: this.restartRequested,
      scriptsStarted: this.scriptsStarted,
      backgroundInPart: !this.state.names.bg || (this.parts.current?.has(this.state.names.bg) ?? false),
    });
  }

  canSave(): boolean {
    return this.saveRefusal() === null;
  }

  /** Décor et bundle courants : la description d'un emplacement (la date est ajoutée par l'interface). */
  describe(): { bg: string; part: string } {
    return { bg: this.state.names.bg, part: this.state.names.part };
  }

  /** `makeSaveFW` ; `null` si la partie ne peut pas être sauvegardée (`saveRefusal`). Ne modifie rien. */
  save(): VoyageursSave | null {
    if (!this.canSave()) return null;
    return makeSave({
      state: this.state,
      ticks: this.ticks,
      rng: this.rng,
      mouse: this.mouse,
      fadeToBlackAgoMs: this.fadeToBlackLastMs === null ? null : this.ms - this.fadeToBlackLastMs,
      palettes: this.renderer.getPalettes(),
    });
  }

  /**
   * `loadPlainSaveFW` : abandonne le tick en cours, recharge les fichiers de la sauvegarde puis restaure l'état. La partie reprend au
   * début d'un tick, sans entrée en attente ni menu. Lève une erreur si un fichier manque (le moteur est alors à relancer).
   */
  load(save: VoyageursSave): void {
    this.runner.abort();
    this.scriptsStarted = false;
    this.queue.length = 0;
    this.walk.xMove = 0;
    this.walk.yMove = 0;
    this.walk.moved = false;
    this.mouse.left = 0;
    this.mouse.right = 0;
    this.mouseData.left = 0;
    this.mouseData.right = 0;
    this.menus = [];
    this.inMenu = false;
    this.banner = null;
    this.actionList = [];
    this.modal = null;
    this.restartRequested = false;
    this.hasBackground = false;
    this.state = createState();
    restoreSave(save, {
      state: this.state,
      ctx: this.partContext(),
      parts: this.parts,
      audio: this.audio,
      renderer: this.renderer,
      loadBg: (name) => this.loadBg(name),
    });
    this.ticks = save.engine.ticks;
    this.rng.seed(save.engine.rng);
    this.mouse.x = save.engine.mouse.x;
    this.mouse.y = save.engine.mouse.y;
    this.fadeToBlackLastMs = save.engine.fadeToBlackAgoMs === null ? null : this.ms - save.engine.fadeToBlackAgoMs;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Hôte

  /** Un pas de 10 ms : lit les entrées de l'hôte, puis avance le tick en cours (ou en commence un). */
  step(): void {
    if (this.quitRequested) return;
    this.queue.push(...this.options.host.pollInput());
    this.ms += STEP_MS;
    if (this.runner.active) this.runner.step();
    else this.runner.start(this.cycle(), () => this.endCycle());
  }

  /** Vrai entre deux ticks (aucun tick commencé) : le banc livre là les entrées du tick suivant. */
  get betweenTicks(): boolean {
    return !this.runner.active;
  }

  /**
   * Numéro du tick en cours au sens du banc (`Trace::tick`) : un tick commence avant l'attente des entrées et compte dès lors, alors que
   * `ticks` n'avance qu'après le dessin. Une attente de menu (pendant les entrées du tick n) et l'attente d'un clic sur un message (après
   * la ligne `TK n`) portent donc toutes deux le numéro n.
   */
  get benchTick(): number {
    return this.scriptsStarted ? this.ticks : this.ticks + 1;
  }

  /** Ajoute des entrées comme si l'hôte les avait reçues (tests, rejeu). */
  input(...inputs: VoyageursInput[]): void {
    this.queue.push(...inputs);
  }

  /**
   * Avance jusqu'à la fin du tick en cours (ou du suivant). Rend faux si le moteur reste bloqué dans une attente modale sans entrée
   * (`maxSteps` pas sans fin de tick) ou s'il a quitté.
   */
  runTick(maxSteps = 10_000): boolean {
    const target = this.ticks + 1;
    for (let i = 0; i < maxSteps && !this.quitRequested; i++) {
      this.step();
      if (this.ticks >= target && this.betweenTicks) return true;
    }
    return false;
  }

  get lastLines(): readonly string[] {
    return this.journal;
  }

  private log(message: string): void {
    this.journal.push(message);
    if (this.journal.length > JOURNAL_SIZE) this.journal.shift();
    this.options.host.log?.(message);
  }

  private endCycle(): void {
    if (this.quitRequested) {
      this.options.host.exit();
      return;
    }
    if (this.restartRequested) {
      this.audio.stopMusic();
      this.initialize();
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Boucle principale

  /** Un tour de `mainLoop`. */
  private *cycle(): Sequence {
    yield* executePlayerInput(this, this.walk);
    if (this.quitRequested) return;
    this.scriptsStarted = true;
    yield* this.executeScripts("o");
    yield* this.executeScripts("g");
    const { state } = this;
    if (state.fadeInRequested) state.fadeOutCompleted = 0;
    if (this.hasBackground) {
      this.render();
      if (state.fadeInRequested) {
        yield* this.fadeFromBlack();
        state.fadeInRequested = 0;
      }
    }
    removeMessages(state);
    this.ticks++;
    this.options.trace?.(tickLine(this.ticks, state));
    if (state.waitForPlayerClick) {
      yield* this.manageEvents(EventSource.MainLoopWaitForPlayerClick, EventTarget.UntilMouseButtonUpDownUp);
      state.waitForPlayerClick = 0;
    }
    if (state.checkForPendingDataLoadSwitch) {
      checkForPendingDataLoad(this.partContext(), this.parts);
      state.checkForPendingDataLoadSwitch = 0;
    }
    this.scriptsStarted = false;
  }

  /** `executeObjectScripts` / `executeGlobalScripts` : liste parcourue dans l'ordre, ajouts du tick compris. */
  private *executeScripts(kind: "g" | "o"): Sequence {
    this.scriptKind = kind;
    const list = (): ScriptInstance[] => (kind === "g" ? this.state.globalScripts : this.state.objectScripts);
    for (let i = 0; i < list().length; ) {
      const script = list()[i]!;
      if (script.index < 0) {
        list().splice(i, 1);
        continue;
      }
      let result = runScript(script, FW_OPCODES, this, this.tracer);
      while (typeof result === "object") {
        yield* this.playEffect(result);
        this.scriptKind = kind;
        result = runScript(script, FW_OPCODES, this, this.tracer);
      }
      if (result === "end") {
        const at = list().indexOf(script);
        if (at >= 0) list().splice(at, 1);
        i = at >= 0 ? at : i;
      } else {
        i++;
      }
    }
  }

  private *playEffect(effect: VmEffect): Sequence {
    if (effect.kind === "fadeToBlack") yield* this.fadeToBlack();
  }

  /** `fadeToBlack` (8 pas) ; rustine de ScummVM : un fondu moins d'une seconde après le précédent n'en joue que le dernier pas. */
  private *fadeToBlack(): Sequence {
    let skip = false;
    if (this.fadeToBlackLastMs !== null && this.ms - this.fadeToBlackLastMs < FADE_TO_BLACK_MIN_MS) skip = true;
    else this.fadeToBlackLastMs = this.ms;
    for (let i = skip ? 7 : 0; i < 8; i++) {
      this.renderer.fadeOutStep(i);
      yield* wait(FADE_STEP_MS);
    }
    this.renderer.fadeOutDone();
    this.state.fadeOutCompleted = 1;
  }

  private *fadeFromBlack(): Sequence {
    for (let i = 7; i >= 0; i--) {
      this.renderer.fadeInStep(i);
      yield* wait(FADE_STEP_MS);
    }
    this.state.fadeOutCompleted = 0;
  }

  /** `drawFrame` : messages à afficher (attente de clic), message d'échec tiré au hasard, puis dessin. */
  render(): void {
    const { state } = this;
    for (const overlay of state.overlays) {
      if (overlay.type === OverlayType.Message) {
        if (overlay.objIdx < state.messages.length) state.waitForPlayerClick = 1;
      } else if (overlay.type === OverlayType.Failure) {
        overlay.failure = overlay.objIdx * 4 + this.rng.number(3);
        state.waitForPlayerClick = 1;
      }
    }
    this.renderer.drawFrame({ state, menus: this.menus, banner: this.banner });
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Événements (`manageEvents`, `processEvent`)

  /** Traite une entrée (`processEvent`) ; une action du clavier peut ouvrir un menu (sous-séquence). */
  private *processEvent(input: VoyageursInput): Sequence {
    const m = this.mouse;
    switch (input.type) {
      case "move":
        m.x = input.x;
        m.y = input.y;
        break;
      case "down":
      case "up": {
        if (input.x !== undefined && input.y !== undefined) {
          m.x = input.x;
          m.y = input.y;
        }
        const value = input.type === "down" ? 1 : 0;
        if (input.button !== "right") m.left = value;
        if (input.button !== "left") m.right = value;
        break;
      }
      case "action":
        yield* processAction(this, input.action);
        break;
      case "walk":
        setKeyboardWalk(this.walk, input.dx, input.dy);
        break;
    }
  }

  /** `manageEvents` : tours de 10 ms jusqu'à la condition `target` (mêmes transitions et même horloge que ScummVM). */
  *manageEvents(source: number, target0: number, useMax = false, rects: Rect[] = []): Sequence {
    let target = target0;
    const start = this.ms;
    const waitEnd = start + TIMER_DELAY_MS;
    let frameEnd = start + 20;
    let found = false;
    let frameEnded = false;
    let waitEnded = false;
    let checkWaitEnd = target === EventTarget.UntilWaitEnded;
    let maxLeft = this.mouse.left;
    let maxRight = this.mouse.right;
    let first = true;
    const modal = source !== EventSource.ExecutePlayerInput;
    const previousModal = this.modal;
    if (modal) {
      this.modal = source;
      this.options.trace?.(`MW ${this.benchTick} src=${source} tgt=${target}`);
    }
    try {
      do {
        if (modal) this.options.onModalPoll?.(source);
        let processed = 0;
        while (!found && !frameEnded && (this.queue.length > 0 || first)) {
          first = false;
          const input = this.queue.shift();
          if (input) yield* this.processEvent(input);
          processed++;
          maxLeft = Math.max(maxLeft, this.mouse.left);
          maxRight = Math.max(maxRight, this.mouse.right);
          const down = this.mouse.left !== 0 || this.mouse.right !== 0;
          switch (target) {
            case EventTarget.UntilMouseButtonUpDownUp:
            case EventTarget.UntilMouseButtonUpDown:
            case EventTarget.UntilMouseButtonUp:
            case EventTarget.UntilMouseButtonUpAndWaitEnded:
              found = !down;
              break;
            case EventTarget.UntilMouseButtonDownUp:
            case EventTarget.UntilMouseButtonDown:
              found = down;
              break;
            case EventTarget.UntilMouseButtonDownOrKeyUpOrDownOrInRects: {
              found = down;
              const last = this.actionList[this.actionList.length - 1];
              if (last === "menuUp" || last === "menuDown") found = true;
              if (rects.some((r) => rectContains(r, this.mouse.x, this.mouse.y))) found = true;
              break;
            }
            case EventTarget.UntilMouseButtonDownOrKeyInput:
              found = down || (input?.type === "action");
              break;
            default:
              break;
          }
          frameEnded = this.ms >= frameEnd;
          waitEnded = this.ms >= waitEnd;
          if (found) {
            if (target === EventTarget.UntilMouseButtonUpDownUp) {
              target = EventTarget.UntilMouseButtonDownUp;
              found = false;
            } else if (target === EventTarget.UntilMouseButtonUpDown) {
              target = EventTarget.UntilMouseButtonDown;
              found = false;
            } else if (target === EventTarget.UntilMouseButtonDownUp) {
              target = EventTarget.UntilMouseButtonUp;
              found = false;
            } else if (target === EventTarget.UntilMouseButtonUpAndWaitEnded) {
              target = EventTarget.UntilWaitEnded;
              checkWaitEnd = true;
              found = false;
            }
          }
          if (checkWaitEnd && waitEnded) found = true;
        }
        const queueEmpty = processed === 0;
        if (queueEmpty) {
          frameEnded = this.ms >= frameEnd;
          waitEnded = this.ms >= waitEnd;
        }
        if (target === EventTarget.UntilWaitEnded) found = waitEnded;
        if (target === EventTarget.EmptyEventQueue) found = queueEmpty;
        if (checkWaitEnd && waitEnded) found = true;
        if ((found || frameEnded) && source === EventSource.ExecutePlayerInput) {
          // Ligne de commande « VERBE objet » mise à jour au survol pendant l'attente du tick.
          const s = this.state;
          if (s.allowPlayerInput && s.playerCommand !== -1 && !this.mouse.left && !this.mouse.right) playerCommandHover(this, this.mouse.x, this.mouse.y);
        }
        if (frameEnded) frameEnd += 20;
        if (found || this.quitRequested) break;
        yield* wait(STEP_MS);
      } while (!found && !this.quitRequested);
    } finally {
      this.modal = previousModal;
    }
    this.mouseData.left = useMax ? maxLeft : this.mouse.left;
    this.mouseData.right = useMax ? maxRight : this.mouse.right;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // InputEngine

  requestQuit(): void {
    this.quitRequested = true;
  }

  requestRestart(): void {
    this.restartRequested = true;
  }

  requestSave(): void {
    this.options.host.requestSave?.();
  }

  requestLoad(): void {
    this.options.host.requestLoad?.();
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // VmContext

  mousePosition(): { x: number; y: number } {
    return { x: this.mouse.x, y: this.mouse.y };
  }

  random(max: number): number {
    return this.rng.number(max);
  }

  partEntrySize(index: number, packed: boolean): number {
    const entry = this.parts.current?.entries[index];
    if (!entry) return 0;
    return (packed ? entry.packedSize : entry.unpackedSize) << 16 >> 16;
  }

  startGlobalScript(index: number): void {
    addGlobalScript(this.state, index);
  }

  endGlobalScript(index: number): void {
    for (const script of this.state.globalScripts) if (script.index === index) script.index = -1;
  }

  loadResource(name: string): void {
    loadResource(this.partContext(), this.parts, name);
  }

  /** `o1_loadBg` (CD : musique du décor `atoi(nom + 1)` d'abord), puis vide les incrustations. */
  loadBg(name: string): void {
    const base = name.split(".")[0] ?? "";
    this.audio.setBgMusic(atoi(base.slice(1)));
    loadBg(this.partContext(), this.parts, name);
    this.state.incrusts = [];
    this.state.bgVar0 = 0;
  }

  loadCt(name: string): void {
    loadCt(this.partContext(), this.parts, name);
  }

  loadPart(name: string): void {
    loadPart(this.partContext(), this.parts, name);
  }

  addToBgList(objIdx: number, filled: boolean): void {
    const incrust = addBgIncrust(this.state, objIdx, filled ? 1 : 0);
    const obj = this.state.objects[objIdx]!;
    this.renderer.incrust(incrust, obj, obj.frame >= 0 ? (this.state.anims[obj.frame] ?? null) : null);
  }

  setBlackPalette(): void {
    this.renderer.setBlackPalette();
  }

  transformPalette(first: number, last: number, r: number, g: number, b: number): void {
    this.renderer.transformPalette(first, last, r, g, b);
  }

  rotatePalette(a: number, b: number, c: number): void {
    this.renderer.rotatePalette(a, b, c);
  }

  loadMusic(name: string): void {
    this.audio.loadMusic(name);
  }

  playMusic(): void {
    this.audio.playMusic();
  }

  fadeOutMusic(): void {
    this.audio.fadeOut();
  }

  stopMusic(): void {
    this.audio.stopMusic();
  }

  playSample(anim: number, channel: number, volume: number, play: boolean): void {
    const slot = this.state.anims[anim];
    if (!slot) return;
    if (play) this.audio.playSample(channel, slot.data, volume);
    else this.audio.stopSample(channel);
  }

  private partContext(): PartContext {
    return {
      state: this.state,
      files: this.options.host.files,
      table: FW_OPCODES,
      background: (name, data) => {
        this.renderer.loadBackground(name, readPi1(data));
        this.hasBackground = true;
      },
      quit: () => this.requestQuit(),
      warn: (message) => this.log(message),
    };
  }
}

/** `atoi` : entier décimal en tête de chaîne (0 sinon). */
function atoi(text: string): number {
  const match = /^\s*[+-]?\d+/.exec(text);
  return match ? Number.parseInt(match[0], 10) : 0;
}
