/**
 * PMachine SCI2 : exécution du code des scripts (128 opcodes du vocabulaire 998), envois de messages avec héritage, appels de
 * procédures, `&rest`, variables, appels du noyau, suspension (`docs/gk1/plan.md`, vague S1).
 *
 * Références : `engines/sci/engine/vm.cpp` (`run_vm`, `send_selector`, `execute_method`, `callKernelFunc`, `read_var`,
 * `validate_property`), `state.cpp` (`EngineState`), `selector.cpp` (`invokeSelector`) et `engines/sci/sci.cpp`
 * (`initGame`, `initStackBaseWithSelector`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * **Pile d'exécution explicite, sans récursion JavaScript.** `run` exécute des instructions jusqu'à ce que le script rende
 * la main : fin de `play`, suspension demandée par une fonction du noyau (`FrameOut`…) ou plafond d'instructions de la
 * tranche. L'état entier (registres, trames, mémoire) reste en place : `run` reprend là où il s'est arrêté.
 *
 * **Trames** : `Call` (méthode ou procédure en cours), `Variable` (lecture ou écriture d'une propriété par un envoi, en
 * attente derrière une méthode du même envoi) et `Native` (fonction du noyau qui rappelle des scripts, voir plus bas).
 * Un envoi `(obj a: 1 b: 2)` empile une trame par sélecteur, la première au sommet ; les propriétés du sommet sont traitées
 * tout de suite, les autres quand la méthode qui les précède revient.
 *
 * Écarts volontaires :
 * - ScummVM relance `run_vm` récursivement quand le noyau appelle une méthode (`invokeSelector`) ; ici la fonction du noyau
 *   empile une trame `Native` nommée, dont la **continuation** est rappelée à chaque retour de méthode avec son état (une
 *   liste de nombres). Un `FrameOut` atteint depuis `ListEachElementDo` suspend donc proprement, et l'état reste sérialisable ;
 * - chaque méthode d'un même envoi démarre sa pile au sommet de l'envoi (ScummVM reporte le pointeur de pile de la méthode
 *   précédente) : sans effet, les variables temporaires ne sont jamais initialisées ;
 * - une variable temporaire lue avant d'être écrite vaut 0 et l'incident est compté dans `warnings` (ScummVM consulte sa
 *   table de « workarounds », puis rend 0 dans ses versions publiées) ; les correctifs propres au jeu viendront avec D12 ;
 * - la division et le modulo par zéro rendent 0 avec un avertissement (ScummVM s'arrête) ;
 * - les opcodes de débogage `file` et `line` sont refusés (absents des scripts du CD) ;
 * - le ramasse-miettes (`gc.ts`) passe tous les 32 768 appels du noyau, comme ScummVM, juste avant un appel ;
 * - pas de points d'arrêt ni de débogueur.
 */
import { VOCAB_SELECTOR_NAMES, ResourceType } from "../data/ids";
import { Lcg } from "../../../engine/rng";
import { readSelectorNames } from "../data/vocab";
import { collectGarbage } from "./gc";
import { CONFIG_LANGUAGE, GAME_OBJECT_EXPORT, GAME_SCRIPT, Segment, SEND_MAX_ARGC, STACK_SIZE } from "./ids";
import { registerKernel } from "./kernel/index";
import { Kernel } from "./kernel/kernel";
import {
  formatReg,
  fromInt,
  isPointer,
  makeReg,
  NULL_REG,
  type Reg,
  regAdd,
  regCompare,
  regSub,
  SciError,
  SegManager,
  toSint16,
} from "./memory";
import { lookupSelector, newLookup, objectName, type SciObject, SelectorKind, SelectorTable, writeSelector } from "./object";
import {
  LEA_INDEXED,
  LEA_TYPE_SHIFT,
  Op,
  Operand,
  OPERAND_FORMATS,
  VAR_INDEXED,
  VAR_OPERATION_MASK,
  VAR_OPERATION_SHIFT,
  VAR_STACK,
  VAR_TYPE_MASK,
  VariableOperation,
  VariableType,
} from "./opcodes";
import { type GameFixes, missingParamValue, ScriptPatcher, uninitializedValue, VariableKind } from "./patches";
import { ResourceManager } from "./resources";
import { ScriptManager } from "./scripts";
import type { ResourceIndex } from "../data/resource-map";
import { GK1_FIXES } from "../game/fixes";

const WORD_MASK = 0xffff;
/** Première valeur du segment « non initialisé » : toute case de pile au-dessus n'a jamais été écrite. */
const UNINITIALIZED = makeReg(Segment.Uninitialized, 0);
/** Marge gardée sous le sommet de la pile : un appel qui la dépasse lève une erreur plutôt que d'écrire hors du tableau. */
const STACK_MARGIN = 0x100;
/** Profondeur d'héritage explorée au plus pour reconnaître une lecture non initialisée connue. */
const MAX_CLASS_DEPTH = 32;
/** Octet de l'opcode de débogage `file` (numéro de `pushSelf` avec le bit 0). */
const OPCODE_BYTE_FILE = 0x7d;
/** Décalages de 16 bits et plus : le résultat est nul (un mot n'a que 16 bits). */
const WORD_BITS = 16;
/** Instructions exécutées par tranche si `run` n'en reçoit pas le nombre. */
export const DEFAULT_SLICE = 200_000;
/** Nombre d'appels du noyau entre deux passages du ramasse-miettes (`GC_INTERVAL` de ScummVM). */
export const GC_INTERVAL = 0x8000;
/** Messages distincts gardés dans `warnings`. */
const MAX_WARNINGS = 200;

export const FrameType = { Call: 0, Variable: 1, Native: 2 } as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

/** Trame de la pile d'exécution. Les champs sans objet pour un type valent 0. */
export interface Frame {
  type: FrameType;
  /** Objet courant (`self`). */
  objp: Reg;
  /** Objet auquel le message a été envoyé (la classe mère pour un `super`). */
  sendp: Reg;
  /** Segment du script dont le code s'exécute. */
  segment: number;
  /** Offset de la prochaine instruction dans le script. */
  pc: number;
  /** Sommet de la pile (première case libre) et base des variables temporaires. */
  sp: number;
  fp: number;
  /** Nombre d'arguments, et indice de pile de la case qui le porte (le paramètre 0). */
  argc: number;
  argp: number;
  /** Sélecteur de la méthode ou de la propriété, −1 pour une procédure. */
  selector: number;
  /** `Variable` : indice de la propriété. */
  varIndex: number;
  /** `Native` : nom de la continuation et son état. */
  native: string;
  state: number[];
}

/** Caches d'une trame `Call`, retrouvés depuis `segment` et `objp` (non sauvegardés). */
interface CodeContext {
  code: Uint8Array;
  locals: Uint32Array | undefined;
  self: SciObject | undefined;
}

export const RunStatus = { Finished: "finished", Suspended: "suspended", Slice: "slice" } as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export interface RunResult {
  /** `finished` : plus rien à exécuter ; `suspended` : une fonction du noyau rend la main ; `slice` : plafond d'instructions atteint. */
  readonly status: RunStatus;
  /** Motif de la suspension (nom de la fonction du noyau). */
  readonly reason?: string;
}

/**
 * Continuation d'une fonction du noyau qui appelle des méthodes : rappelée quand la méthode lancée par `invoke` est revenue
 * (son résultat est dans `vm.acc`). Renvoie vrai quand elle a fini (après avoir fixé `vm.acc`), faux si elle a relancé `invoke`.
 */
export type Continuation = (vm: Vm, state: number[]) => boolean;

/** Heure du système, pour `GetTime`. */
export interface WallClock {
  year: number;
  /** 1 à 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Registres, trames et compteurs de la machine virtuelle, tels qu'une sauvegarde les garde (`save.ts`) : du JSON simple. */
export interface VmState {
  acc: Reg;
  prev: Reg;
  rest: number;
  ticks: number;
  gameObject: Reg;
  /** État du générateur de `Random`. */
  rng: number;
  /** Appels du noyau restants avant le prochain passage du ramasse-miettes. */
  gcCountdown: number;
  instructionCount: number;
  frames: Frame[];
}

/** Date du CD (`VERSION`) : horloge par défaut, pour des exécutions reproductibles. */
const DEFAULT_WALL_CLOCK: WallClock = { year: 1994, month: 5, day: 3, hour: 12, minute: 0, second: 0 };

export class Vm {
  readonly memory = new SegManager();
  readonly resources: ResourceManager;
  readonly scripts: ScriptManager;
  readonly selectors: SelectorTable;
  readonly kernel = new Kernel();
  /** Générateur de `Random` ; la graine se fixe par `rng.seed`. */
  readonly rng = new Lcg(0);
  /** Horloge du jeu en soixantièmes de seconde, avancée par la boucle qui appelle `run`. */
  ticks = 0;
  wallClock: () => WallClock = () => DEFAULT_WALL_CLOCK;

  /** Accumulateur, valeur précédente (opérande gauche de la dernière comparaison), nombre de mots ajoutés par `&rest`. */
  acc: Reg = NULL_REG;
  prev: Reg = NULL_REG;
  rest = 0;
  readonly frames: Frame[] = [];
  /** Objet du jeu (export 0 du script 0), fixé par `boot`. */
  gameObject: Reg = NULL_REG;
  /** Incidents tolérés (lecture non initialisée, division par zéro…) : message → nombre. */
  readonly warnings = new Map<string, number>();
  /** Instructions exécutées depuis la création. */
  instructionCount = 0;
  /** Racines supplémentaires du ramasse-miettes : références gardées hors de la mémoire des scripts (plans, sons…). */
  readonly gcRoots: (() => Iterable<Reg>)[] = [];
  /** Nombre d'appels du noyau entre deux passages du ramasse-miettes. */
  gcInterval = GC_INTERVAL;
  private gcCountdown = GC_INTERVAL;

  private readonly stack: Uint32Array;
  private readonly contexts = new WeakMap<Frame, CodeContext>();
  private readonly lookup = newLookup();
  private globals: Uint32Array | undefined;
  private globalsSegment = 0;
  private suspendReason: string | undefined;
  /** Première case de pile libre au-dessus des arguments de la fonction du noyau en cours. */
  private kernelTop = 0;
  private readonly nameSelector: number;
  /** Correctifs posés sur les scripts à leur chargement ; `patcher.applied` les nomme. */
  readonly patcher: ScriptPatcher;

  /**
   * `fixes` : correctifs des scripts et contournements (`patches.ts`) ; par défaut ceux de *Gabriel Knight*
   * (`game/fixes.ts`), `NO_FIXES` pour exécuter les scripts tels quels.
   */
  constructor(
    index: ResourceIndex,
    readonly fixes: GameFixes = GK1_FIXES,
  ) {
    this.resources = new ResourceManager(index);
    this.selectors = new SelectorTable(readSelectorNames(this.resources.get(ResourceType.Vocab, VOCAB_SELECTOR_NAMES)));
    this.patcher = new ScriptPatcher(fixes.scriptPatches, (name) => this.selectors.find(name));
    this.scripts = new ScriptManager(this.memory, this.resources, this.patcher);
    this.stack = this.memory.stack;
    this.nameSelector = this.selectors.find("name");
    registerKernel(this.kernel);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Démarrage
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Charge le script 0 (ses variables locales sont les globales) et prépare l'envoi de `play` à l'objet du jeu. */
  boot(): void {
    const segment = this.scripts.instantiate(GAME_SCRIPT);
    this.useGlobals(segment.localsSegment);
    this.gameObject = this.scripts.exportedObject(segment, GAME_OBJECT_EXPORT);
    if (this.gameObject === NULL_REG) throw new SciError("le script 0 n'exporte pas l'objet du jeu");
    this.applyConfiguredLanguage();
    this.start(this.gameObject, this.selectors.id("play"), []);
  }

  /**
   * Range la langue de `RESOURCE.CFG` dans `printLang` de l'objet du jeu, comme l'interpréteur d'origine au démarrage
   * (`SciEngine::setSciLanguage` de ScummVM, appelé par `initGame`). Sans elle les scripts se croient en anglais.
   */
  private applyConfiguredLanguage(): void {
    const printLang = this.selectors.find("printLang");
    const game = this.memory.getObject(this.gameObject);
    if (printLang < 0 || !game || lookupSelector(this.memory, game, printLang, this.lookup) !== SelectorKind.Variable) return;
    writeSelector(this.memory, this.gameObject, printLang, fromInt(CONFIG_LANGUAGE));
  }

  /** Désigne le segment des variables globales (les variables locales du script 0). */
  useGlobals(localsSegment: number): void {
    const locals = this.memory.localsSegment(localsSegment);
    if (!locals) throw new SciError("le script 0 n'a pas de variables locales");
    this.globalsSegment = localsSegment;
    this.globals = locals.values;
  }

  /** Vide la pile d'exécution et prépare l'envoi de `selector` à `object` ; `run` l'exécute. */
  start(object: Reg, selector: number, args: ArrayLike<Reg>): void {
    this.frames.length = 0;
    this.acc = this.prev = NULL_REG;
    this.rest = 0;
    this.suspendReason = undefined;
    this.writeMessage(0, selector, args);
    this.send(object, object, 0, 2 + args.length, 2 + args.length);
  }

  /** Vide la pile d'exécution et prépare l'appel de la procédure à `codeOffset` du script chargé `scriptNumber`. */
  startProcedure(scriptNumber: number, codeOffset: number, args: ArrayLike<Reg>, self: Reg = NULL_REG): void {
    const segment = this.scripts.loaded(scriptNumber);
    if (!segment) throw new SciError(`script ${scriptNumber} non chargé`);
    this.frames.length = 0;
    this.acc = this.prev = NULL_REG;
    this.rest = 0;
    this.suspendReason = undefined;
    this.stack[0] = args.length;
    for (let i = 0; i < args.length; i++) this.stack[1 + i] = args[i];
    this.pushCall(self, self, segment.id, codeOffset, 1 + args.length, args.length, 0, -1);
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Sauvegarde
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Copie des registres, des trames et des compteurs. La mémoire (`memory`, `scripts`) se sauve à part (`save.ts`). */
  saveState(): VmState {
    return {
      acc: this.acc,
      prev: this.prev,
      rest: this.rest,
      ticks: this.ticks,
      gameObject: this.gameObject,
      rng: this.rng.state,
      gcCountdown: this.gcCountdown,
      instructionCount: this.instructionCount,
      frames: this.frames.map((frame) => ({ ...frame, state: [...frame.state] })),
    };
  }

  /**
   * Reprend l'état écrit par `saveState`, **une fois la mémoire reprise** : les variables globales sont retrouvées dans le
   * script 0. Peut être appelé depuis une fonction du noyau : `run` continue alors dans les trames reprises.
   */
  loadState(state: VmState): void {
    this.acc = state.acc;
    this.prev = state.prev;
    this.rest = state.rest;
    this.ticks = state.ticks;
    this.gameObject = state.gameObject;
    this.rng.seed(state.rng);
    this.gcCountdown = state.gcCountdown;
    this.instructionCount = state.instructionCount;
    this.frames.length = 0;
    for (const frame of state.frames) this.frames.push({ ...frame, state: [...frame.state] });
    this.suspendReason = undefined;
    this.kernelTop = 0;
    const globals = this.scripts.loaded(GAME_SCRIPT)?.localsSegment ?? 0;
    this.globalsSegment = globals;
    this.globals = this.memory.localsSegment(globals)?.values;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Services pour le noyau
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Demande à `run` de rendre la main dès la fin de la fonction du noyau en cours. */
  suspend(reason: string): void {
    this.suspendReason = reason;
  }

  /** Compte un incident toléré. */
  warn(message: string): void {
    const count = this.warnings.get(message);
    if (count !== undefined) this.warnings.set(message, count + 1);
    else if (this.warnings.size < MAX_WARNINGS) this.warnings.set(message, 1);
  }

  /**
   * Depuis une fonction du noyau : empile une trame `Native` et lance sa continuation une première fois. Renvoie la valeur
   * que la fonction du noyau doit rendre (l'accumulateur, que la continuation refixera si elle n'a pas fini).
   */
  beginNative(name: string, state: number[]): Reg {
    const continuation = this.kernel.continuations.get(name);
    if (!continuation) throw new Error(`GK1 : continuation inconnue : ${name}`);
    const frame = this.newFrame(FrameType.Native);
    frame.sp = frame.fp = this.kernelTop;
    frame.native = name;
    frame.state = state;
    this.frames.push(frame);
    if (continuation(this, state)) this.frames.pop();
    return this.acc;
  }

  /** Depuis une continuation : envoie `selector` à `object` ; la continuation sera rappelée au retour. */
  invoke(object: Reg, selector: number, args: ArrayLike<Reg>): void {
    const native = this.frames[this.frames.length - 1];
    if (native?.type !== FrameType.Native) throw new Error("GK1 : invoke hors d'une continuation du noyau");
    const base = native.sp;
    this.writeMessage(base, selector, args);
    this.send(object, object, base, 2 + args.length, base + 2 + args.length);
  }

  /** Segment du script dont le code est en cours d'exécution (0 hors de tout code). */
  currentCodeSegment(): number {
    for (let i = this.frames.length - 1; i >= 0; i--) if (this.frames[i].type === FrameType.Call) return this.frames[i].segment;
    return 0;
  }

  /** Nom d'un objet, pour les journaux et les messages d'erreur. */
  nameOf(object: Reg): string {
    return objectName(this.memory, object, this.nameSelector) || formatReg(object);
  }

  /** Pile d'exécution lisible, du sommet à la base. */
  backtrace(): string[] {
    const out: string[] = [];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const frame = this.frames[i];
      if (frame.type === FrameType.Native) out.push(`noyau ${frame.native}`);
      else {
        const script = this.memory.scriptSegment(frame.segment)?.number ?? "?";
        const what = frame.selector < 0 ? "procédure" : `${this.nameOf(frame.objp)}::${this.selectors.name(frame.selector)}`;
        out.push(frame.type === FrameType.Variable ? `propriété ${what}` : `${what} (script ${script}, pc ${frame.pc.toString(16)})`);
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Trames et envois
  // -------------------------------------------------------------------------------------------------------------------------------

  private newFrame(type: FrameType): Frame {
    return { type, objp: NULL_REG, sendp: NULL_REG, segment: 0, pc: 0, sp: 0, fp: 0, argc: 0, argp: 0, selector: -1, varIndex: 0, native: "", state: [] };
  }

  private context(frame: Frame): CodeContext {
    let context = this.contexts.get(frame);
    if (!context) {
      const segment = this.memory.scriptSegment(frame.segment);
      if (!segment) throw new SciError(`segment de code ${frame.segment} invalide`);
      context = {
        code: segment.code,
        locals: this.memory.localsSegment(segment.localsSegment)?.values,
        self: this.memory.getObject(frame.objp),
      };
      this.contexts.set(frame, context);
    }
    return context;
  }

  private pushCall(objp: Reg, sendp: Reg, segment: number, pc: number, top: number, argc: number, argp: number, selector: number): Frame {
    if (top > STACK_SIZE - STACK_MARGIN) throw new SciError("débordement de la pile");
    const frame = this.newFrame(FrameType.Call);
    frame.objp = objp;
    frame.sendp = sendp;
    frame.segment = segment;
    frame.pc = pc;
    frame.sp = frame.fp = top;
    frame.argc = argc;
    frame.argp = argp;
    frame.selector = selector;
    this.frames.push(frame);
    return frame;
  }

  private writeMessage(base: number, selector: number, args: ArrayLike<Reg>): void {
    if (base + 2 + args.length > STACK_SIZE - STACK_MARGIN) throw new SciError("débordement de la pile");
    this.stack[base] = selector;
    this.stack[base + 1] = args.length;
    for (let i = 0; i < args.length; i++) this.stack[base + 2 + i] = args[i];
  }

  /**
   * Traite le message de `words` mots écrit dans la pile à `base` : suite de `sélecteur, argc, arguments…`. `sendObj` reçoit
   * le message (c'est chez lui que l'on cherche), `workObj` est le `self` des méthodes (différent pour `super` seulement).
   * `top` : première case de pile libre pour les méthodes appelées.
   */
  private send(sendObj: Reg, workObj: Reg, base: number, words: number, top: number): void {
    const receiver = this.memory.getObject(sendObj);
    if (!receiver) throw new SciError(`envoi à ${formatReg(sendObj)}, qui n'est pas un objet`);
    const first = this.frames.length;
    let p = base;
    const end = base + words;
    while (p < end) {
      const selector = this.stack[p];
      const argc = this.stack[p + 1];
      if (isPointer(selector) || argc > SEND_MAX_ARGC) throw new SciError(`message mal formé pour ${this.nameOf(sendObj)}`);
      const kind = lookupSelector(this.memory, receiver, selector, this.lookup);
      if (kind === SelectorKind.Method) {
        this.pushCall(workObj, sendObj, this.lookup.codeSegment, this.lookup.codeOffset, top, argc, p + 1, selector);
      } else if (kind === SelectorKind.Variable) {
        const frame = this.newFrame(FrameType.Variable);
        frame.objp = workObj;
        frame.sendp = sendObj;
        frame.argc = argc;
        frame.argp = p + 1;
        frame.selector = selector;
        frame.varIndex = this.lookup.index;
        this.frames.push(frame);
      } else {
        throw new SciError(`l'objet « ${this.nameOf(sendObj)} » ne répond pas au sélecteur « ${this.selectors.name(selector)} » (${selector})`);
      }
      p += 2 + argc;
    }
    // Le premier sélecteur du message doit s'exécuter en premier : il va au sommet.
    if (this.frames.length - first > 1) {
      for (let i = first, j = this.frames.length - 1; i < j; i++, j--) {
        const swap = this.frames[i];
        this.frames[i] = this.frames[j];
        this.frames[j] = swap;
      }
    }
    this.settleVariableFrames();
  }

  /** Exécute et dépile les lectures et écritures de propriétés qui sont au sommet de la pile d'exécution. */
  private settleVariableFrames(): void {
    for (;;) {
      const frame = this.frames[this.frames.length - 1];
      if (frame?.type !== FrameType.Variable) return;
      const object = this.memory.getObject(frame.sendp)!;
      if (frame.argc === 0) this.acc = object.vars[frame.varIndex];
      else object.setProperty(frame.varIndex, this.stack[frame.argp + 1]);
      this.frames.pop();
    }
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Variables et propriétés
  // -------------------------------------------------------------------------------------------------------------------------------

  private variables(context: CodeContext, type: number): Uint32Array {
    if (type === VariableType.Global) {
      if (!this.globals) throw new SciError("variables globales absentes (script 0 non chargé)");
      return this.globals;
    }
    if (type === VariableType.Local) {
      if (!context.locals) throw new SciError("ce script n'a pas de variables locales");
      return context.locals;
    }
    return this.stack;
  }

  private variableIndex(frame: Frame, values: Uint32Array, type: number, index: number): number {
    const at = type === VariableType.Temp ? frame.fp + index : type === VariableType.Param ? frame.argp + index : index;
    if (index < 0 || at >= values.length) throw new SciError(`variable ${["globale", "locale", "temporaire", "paramètre"][type]} ${index} hors limites`);
    return at;
  }

  private readVariable(frame: Frame, context: CodeContext, type: number, index: number): Reg {
    const values = this.variables(context, type);
    const at = this.variableIndex(frame, values, type, index);
    if (type === VariableType.Param && index > frame.argc && this.fixes.missingParams.length > 0) {
      const known = this.knownFix(frame, (script, object, method) => missingParamValue(this.fixes, script, object, method, index));
      if (known !== undefined) return known;
    }
    const value = values[at];
    if (value >= UNINITIALIZED) {
      const known = this.knownUninitializedRead(frame, type, index);
      if (known === undefined) this.warn(`lecture d'une variable de pile non initialisée (${this.describeLocation(frame)})`);
      return (values[at] = known ?? NULL_REG);
    }
    return value;
  }

  /**
   * Valeur d'une lecture non initialisée que les correctifs du jeu connaissent (`fixes.uninitializedReads`), cherchée sous
   * le nom de l'objet puis de chacune de ses classes mères : une méthode héritée est corrigée pour tous ses héritiers.
   */
  private knownUninitializedRead(frame: Frame, type: number, index: number): Reg | undefined {
    if (type !== VariableType.Temp && type !== VariableType.Param) return undefined;
    const kind = type === VariableType.Temp ? VariableKind.Temp : VariableKind.Param;
    return this.knownFix(frame, (script, object, method) => uninitializedValue(this.fixes, script, object, method, kind, index));
  }

  /**
   * Cherche un correctif de lecture pour la méthode en cours, sous le nom de l'objet puis de chacune de ses classes mères
   * (`find` reçoit le script du code exécuté, un nom d'objet et le nom de la méthode).
   */
  private knownFix(frame: Frame, find: (script: number, object: string, method: string) => number | undefined): Reg | undefined {
    if (frame.selector < 0) return undefined;
    const script = this.memory.scriptSegment(frame.segment)?.number;
    if (script === undefined) return undefined;
    const method = this.selectors.name(frame.selector);
    for (let object = frame.objp, depth = 0; object !== NULL_REG && depth < MAX_CLASS_DEPTH; depth++) {
      const value = find(script, objectName(this.memory, object, this.nameSelector), method);
      if (value !== undefined) return value & WORD_MASK;
      object = this.memory.getObject(object)?.superClass ?? NULL_REG;
    }
    return undefined;
  }

  private writeVariable(frame: Frame, context: CodeContext, type: number, index: number, value: Reg): void {
    const values = this.variables(context, type);
    values[this.variableIndex(frame, values, type, index)] = value;
  }

  private self(frame: Frame, context: CodeContext): SciObject {
    if (!context.self) throw new SciError(`accès à une propriété sans objet courant (${formatReg(frame.objp)})`);
    return context.self;
  }

  /** Lit la propriété dont l'opérande donne l'offset en octets ; 0 hors de l'objet, comme l'original. */
  private readProperty(frame: Frame, context: CodeContext, byteOffset: number): Reg {
    const object = this.self(frame, context);
    const index = byteOffset >> 1;
    if (index >= object.vars.length) {
      this.warn(`lecture d'une propriété hors de l'objet (${this.describeLocation(frame)})`);
      return NULL_REG;
    }
    return object.vars[index];
  }

  private writeProperty(frame: Frame, context: CodeContext, byteOffset: number, value: Reg): void {
    const object = this.self(frame, context);
    const index = byteOffset >> 1;
    if (index >= object.vars.length) {
      this.warn(`écriture d'une propriété hors de l'objet (${this.describeLocation(frame)})`);
      return;
    }
    object.setProperty(index, value);
  }

  private describeLocation(frame: Frame): string {
    const script = this.memory.scriptSegment(frame.segment)?.number ?? "?";
    const what = frame.selector < 0 ? "procédure" : `${this.nameOf(frame.objp)}::${this.selectors.name(frame.selector)}`;
    return `script ${script}, ${what}`;
  }

  private number(value: Reg, operation: string): number {
    if (isPointer(value)) throw new SciError(`${operation} sur une référence (${formatReg(value)})`);
    return value;
  }

  // -------------------------------------------------------------------------------------------------------------------------------
  // Exécution
  // -------------------------------------------------------------------------------------------------------------------------------

  /** Exécute au plus `slice` instructions et dit pourquoi l'exécution s'arrête. */
  run(slice = DEFAULT_SLICE): RunResult {
    try {
      return this.execute(slice);
    } catch (error) {
      if (error instanceof SciError && !error.message.includes("\n")) {
        error.message = `GK1 : ${error.message}\n  ${this.backtrace().join("\n  ")}`;
      }
      throw error;
    }
  }

  private execute(slice: number): RunResult {
    const stack = this.stack;
    let remaining = slice;
    this.suspendReason = undefined;
    for (;;) {
      const frame = this.frames[this.frames.length - 1];
      if (!frame) return { status: RunStatus.Finished };
      if (frame.type === FrameType.Native) {
        const continuation = this.kernel.continuations.get(frame.native);
        if (!continuation) throw new Error(`GK1 : continuation inconnue : ${frame.native}`);
        if (continuation(this, frame.state)) {
          if (this.frames[this.frames.length - 1] !== frame) throw new Error(`GK1 : la continuation ${frame.native} a fini sans être au sommet`);
          this.frames.pop();
        }
        if (this.suspendReason !== undefined) return { status: RunStatus.Suspended, reason: this.suspendReason };
        continue;
      }
      if (remaining-- <= 0) return { status: RunStatus.Slice };
      this.instructionCount++;

      const context = this.context(frame);
      const code = context.code;
      let pc = frame.pc;
      if (pc >= code.length) throw new SciError("exécution hors du script");
      const byte = code[pc++];
      if (byte >= OPCODE_BYTE_FILE && byte < Op.FirstVariable << 1) throw new SciError(`opcode de débogage ${byte.toString(16)} non géré`);
      const op = byte >> 1;
      const byteOperands = (byte & 1) !== 0;
      const formats = OPERAND_FORMATS[op];
      let o0 = 0;
      let o1 = 0;
      let o2 = 0;
      for (let i = 0; i < formats.length; i++) {
        const format = formats[i];
        let value: number;
        if (format === Operand.Word || !byteOperands) {
          value = code[pc] | (code[pc + 1] << 8);
          pc += 2;
          if (format === Operand.SignedVariable) value = (value << 16) >> 16;
        } else {
          value = code[pc++];
          if (format === Operand.SignedVariable) value = (value << 24) >> 24;
        }
        if (i === 0) o0 = value;
        else if (i === 1) o1 = value;
        else o2 = value;
      }
      frame.pc = pc;

      switch (op) {
        case Op.Bnot:
          this.acc = this.number(this.acc, "bnot") ^ WORD_MASK;
          break;
        case Op.Add:
          this.acc = regAdd(stack[--frame.sp], this.acc);
          break;
        case Op.Sub:
          this.acc = regSub(stack[--frame.sp], this.acc);
          break;
        case Op.Mul:
          this.acc = (toSint16(this.number(stack[--frame.sp], "mul")) * toSint16(this.number(this.acc, "mul"))) & WORD_MASK;
          break;
        case Op.Div: {
          const left = toSint16(this.number(stack[--frame.sp], "div"));
          const right = toSint16(this.number(this.acc, "div"));
          if (right === 0) this.warn(`division par zéro (${this.describeLocation(frame)})`);
          this.acc = right === 0 ? NULL_REG : Math.trunc(left / right) & WORD_MASK;
          break;
        }
        case Op.Mod: {
          // Le modulo est celui de la valeur absolue du diviseur, et le résultat n'est jamais négatif.
          const left = toSint16(this.number(stack[--frame.sp], "mod"));
          const modulo = Math.abs(toSint16(this.number(this.acc, "mod")));
          if (modulo === 0) this.warn(`modulo par zéro (${this.describeLocation(frame)})`);
          const result = modulo === 0 ? 0 : left % modulo;
          this.acc = (result < 0 ? result + modulo : result) & WORD_MASK;
          break;
        }
        case Op.Shr: {
          const left = this.number(stack[--frame.sp], "shr");
          const count = this.number(this.acc, "shr");
          this.acc = count >= WORD_BITS ? 0 : left >>> count;
          break;
        }
        case Op.Shl: {
          const left = this.number(stack[--frame.sp], "shl");
          const count = this.number(this.acc, "shl");
          this.acc = count >= WORD_BITS ? 0 : (left << count) & WORD_MASK;
          break;
        }
        case Op.Xor:
          this.acc = this.number(stack[--frame.sp], "xor") ^ this.number(this.acc, "xor");
          break;
        case Op.And:
          this.acc = this.number(stack[--frame.sp], "and") & this.number(this.acc, "and");
          break;
        case Op.Or:
          this.acc = this.number(stack[--frame.sp], "or") | this.number(this.acc, "or");
          break;
        case Op.Neg:
          this.acc = -toSint16(this.number(this.acc, "neg")) & WORD_MASK;
          break;
        case Op.Not:
          this.acc = this.acc === NULL_REG ? 1 : 0;
          break;
        case Op.Eq:
          this.prev = this.acc;
          this.acc = stack[--frame.sp] === this.acc ? 1 : 0;
          break;
        case Op.Ne:
          this.prev = this.acc;
          this.acc = stack[--frame.sp] !== this.acc ? 1 : 0;
          break;
        case Op.Gt:
        case Op.Ugt:
          this.prev = this.acc;
          this.acc = regCompare(stack[--frame.sp], this.acc, op === Op.Ugt) > 0 ? 1 : 0;
          break;
        case Op.Ge:
        case Op.Uge:
          this.prev = this.acc;
          this.acc = regCompare(stack[--frame.sp], this.acc, op === Op.Uge) >= 0 ? 1 : 0;
          break;
        case Op.Lt:
        case Op.Ult:
          this.prev = this.acc;
          this.acc = regCompare(stack[--frame.sp], this.acc, op === Op.Ult) < 0 ? 1 : 0;
          break;
        case Op.Le:
        case Op.Ule:
          this.prev = this.acc;
          this.acc = regCompare(stack[--frame.sp], this.acc, op === Op.Ule) <= 0 ? 1 : 0;
          break;
        case Op.Bt:
          if (this.acc !== NULL_REG) frame.pc = (pc + o0) & WORD_MASK;
          break;
        case Op.Bnt:
          if (this.acc === NULL_REG) frame.pc = (pc + o0) & WORD_MASK;
          break;
        case Op.Jmp:
          frame.pc = (pc + o0) & WORD_MASK;
          break;
        case Op.Ldi:
          this.acc = o0 & WORD_MASK;
          break;
        case Op.Push:
          stack[frame.sp++] = this.acc;
          break;
        case Op.Pushi:
          stack[frame.sp++] = o0 & WORD_MASK;
          break;
        case Op.Toss:
          frame.sp--;
          break;
        case Op.Dup:
          stack[frame.sp] = stack[frame.sp - 1];
          frame.sp++;
          break;
        case Op.Link:
          if (frame.sp + o0 > STACK_SIZE - STACK_MARGIN) throw new SciError("débordement de la pile");
          stack.fill(UNINITIALIZED, frame.sp, frame.sp + o0);
          frame.sp += o0;
          break;
        case Op.Call: {
          // La pile porte argc puis les arguments ; `&rest` en a peut-être ajouté.
          const top = frame.sp;
          const base = top - ((o1 >> 1) + 1 + this.rest);
          const argc = (this.number(stack[base], "call") + this.rest) & WORD_MASK;
          stack[base] = argc;
          this.rest = 0;
          frame.sp = base;
          this.pushCall(frame.objp, frame.objp, frame.segment, (pc + o0) & WORD_MASK, top, argc, base, -1);
          break;
        }
        case Op.Callk: {
          // Avant de dépiler les arguments : tout ce qui vit est alors sous le sommet de la pile.
          if (--this.gcCountdown <= 0 || this.gcCountdown > this.gcInterval) {
            this.gcCountdown = this.gcInterval;
            collectGarbage(this);
          }
          const base = frame.sp - ((o1 >> 1) + 1 + this.rest);
          const argc = (this.number(stack[base], "callk") + this.rest) & WORD_MASK;
          this.rest = 0;
          frame.sp = base;
          this.kernelTop = base + 1 + argc;
          this.acc = this.kernel.call(this, o0, stack.subarray(base + 1, base + 1 + argc));
          if (this.suspendReason !== undefined) return { status: RunStatus.Suspended, reason: this.suspendReason };
          break;
        }
        case Op.Callb:
          this.callExport(frame, GAME_SCRIPT, o0, o1);
          break;
        case Op.Calle:
          this.callExport(frame, o0, o1, o2);
          break;
        case Op.Ret:
          this.frames.pop();
          this.settleVariableFrames();
          break;
        case Op.Send:
        case Op.Self:
        case Op.Super: {
          const argBytes = op === Op.Super ? o1 : o0;
          const words = (argBytes >> 1) + this.rest;
          const top = frame.sp;
          const base = top - words;
          frame.sp = base;
          if (this.rest > 0) {
            // `&rest` allonge les arguments du premier sélecteur du message.
            stack[base + 1] = (stack[base + 1] + this.rest) & WORD_MASK;
            this.rest = 0;
          }
          if (op === Op.Send) this.send(this.acc, this.acc, base, words, top);
          else if (op === Op.Self) this.send(frame.objp, frame.objp, base, words, top);
          else this.send(this.scripts.classAddress(o0, frame.segment), frame.objp, base, words, top);
          break;
        }
        case Op.Class:
          this.acc = this.scripts.classAddress(o0, frame.segment);
          break;
        case Op.Rest: {
          // Recopie les paramètres à partir du numéro `o0` (le paramètre 0 est argc).
          this.rest = Math.max(frame.argc - o0 + 1, 0);
          for (let i = o0; i <= frame.argc; i++) stack[frame.sp++] = stack[frame.argp + i];
          break;
        }
        case Op.Lea: {
          const descriptor = o0 >> LEA_TYPE_SHIFT;
          const type = descriptor & VAR_TYPE_MASK;
          const index = o1 + ((descriptor & LEA_INDEXED) !== 0 ? toSint16(this.number(this.acc, "lea")) : 0);
          let base: Reg;
          if (type === VariableType.Global) base = makeReg(this.globalsSegment, 0);
          else if (type === VariableType.Local) base = makeReg(this.memory.scriptSegment(frame.segment)!.localsSegment, 0);
          else base = makeReg(Segment.Stack, 2 * (type === VariableType.Temp ? frame.fp : frame.argp));
          if (base < makeReg(Segment.Stack, 0)) throw new SciError("lea sur un script sans variables");
          this.acc = regAdd(base, (2 * index) & WORD_MASK);
          break;
        }
        case Op.SelfId:
          this.acc = frame.objp;
          break;
        case Op.Pprev:
          stack[frame.sp++] = this.prev;
          break;
        case Op.PToa:
          this.acc = this.readProperty(frame, context, o0);
          break;
        case Op.ATop:
          this.writeProperty(frame, context, o0, this.acc);
          break;
        case Op.PTos:
          stack[frame.sp++] = this.readProperty(frame, context, o0);
          break;
        case Op.STop:
          this.writeProperty(frame, context, o0, stack[--frame.sp]);
          break;
        case Op.IpToa:
        case Op.DpToa:
        case Op.IpTos:
        case Op.DpTos: {
          const current = this.readProperty(frame, context, o0);
          const value = op === Op.IpToa || op === Op.IpTos ? regAdd(current, 1) : regSub(current, 1);
          this.writeProperty(frame, context, o0, value);
          if (op === Op.IpToa || op === Op.DpToa) this.acc = value;
          else stack[frame.sp++] = value;
          break;
        }
        case Op.Lofsa:
          this.acc = makeReg(frame.segment, o0);
          break;
        case Op.Lofss:
          stack[frame.sp++] = makeReg(frame.segment, o0);
          break;
        case Op.Push0:
          stack[frame.sp++] = 0;
          break;
        case Op.Push1:
          stack[frame.sp++] = 1;
          break;
        case Op.Push2:
          stack[frame.sp++] = 2;
          break;
        case Op.PushSelf:
          stack[frame.sp++] = frame.objp;
          break;
        default: {
          if (op < Op.FirstVariable) throw new SciError(`opcode ${op.toString(16)} invalide`);
          const type = op & VAR_TYPE_MASK;
          const onStack = (op & VAR_STACK) !== 0;
          const indexed = (op & VAR_INDEXED) !== 0;
          const index = indexed ? o0 + toSint16(this.number(this.acc, "indice de variable")) : o0;
          switch ((op >> VAR_OPERATION_SHIFT) & VAR_OPERATION_MASK) {
            case VariableOperation.Load: {
              const value = this.readVariable(frame, context, type, index);
              if (onStack) stack[frame.sp++] = value;
              else this.acc = value;
              break;
            }
            case VariableOperation.Store:
              if (onStack) this.writeVariable(frame, context, type, index, stack[--frame.sp]);
              else {
                // Indexé par l'accumulateur, celui-ci ne peut pas porter la valeur : elle vient de la pile et y reste.
                if (indexed) this.acc = stack[--frame.sp];
                this.writeVariable(frame, context, type, index, this.acc);
              }
              break;
            default: {
              const current = this.readVariable(frame, context, type, index);
              const value = ((op >> VAR_OPERATION_SHIFT) & VAR_OPERATION_MASK) === VariableOperation.Increment ? regAdd(current, 1) : regSub(current, 1);
              this.writeVariable(frame, context, type, index, value);
              if (onStack) stack[frame.sp++] = value;
              else this.acc = value;
            }
          }
        }
      }
    }
  }

  /** `callb` / `calle` : appelle la procédure exportée `index` du script `scriptNumber`, chargé au besoin. */
  private callExport(frame: Frame, scriptNumber: number, index: number, argBytes: number): void {
    const top = frame.sp;
    const base = top - ((argBytes >> 1) + 1 + this.rest);
    const argc = (this.number(this.stack[base], "appel") + this.rest) & WORD_MASK;
    this.stack[base] = argc;
    this.rest = 0;
    frame.sp = base;
    const segment = this.scripts.loaded(scriptNumber) ?? this.scripts.instantiate(scriptNumber);
    this.pushCall(frame.objp, frame.objp, segment.id, this.scripts.exportedProcedure(segment, index), top, argc, base, -1);
  }
}
