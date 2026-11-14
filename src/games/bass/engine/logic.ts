/**
 * Logique de *Beneath a Steel Sky* : les 16 types de logique, le tour de logique (`Logic::engine`), les scripts des compacts et le
 * contexte partagé des mcodes.
 *
 * Référence : ScummVM engines/sky/logic.cpp (`Logic::Logic`, `engine`, `checkProtection`, `logicScript`, `autoRoute`, `arAnim`, `mainAnim`,
 * `arTurn`, `alt`, `anim`, `turn`, `cursor`, `talk`, `listen`, `stopped`, `choose`, `frames`, `pause`, `waitSync`, `simpleAnim`,
 * `isCollision`, `runGetOff`, `stopAndWait`, `checkModuleLoaded`, `mouseScript`, `stdSpeak`, `fnExec`), logic.h, sky.h (`SystemVars`)
 * (GPL v3 ou ultérieure).
 *
 * **Tour reprenable** (`engine.md` § 13) : `engine()` est un générateur. Il parcourt la liste de logique comme ScummVM ; quand un mcode a
 * demandé un effet bloquant (fondu, défilement, attente de `fnLookAt`, fin d'une séquence), le générateur joue ces effets après le
 * compact en cours (`yield*`, ticks de 20 ms) puis reprend au compact suivant, sans relire la liste. La boucle de jeu (`game.ts`) exécute ce
 * générateur par `SequenceRunner` : pendant l'effet, aucune autre logique ne tourne, comme dans ScummVM.
 *
 * Écarts volontaires :
 * - le reste du script du compact qui a demandé l'effet s'exécute avant l'effet (dans ScummVM, après) ; ce que ces effets montrent n'est
 *   lu par aucun script (palette, image, temps), l'état logique est donc le même ;
 * - grilles, cheminement, textes, son et image passent par les services de `services.ts` (souches en vague C) ;
 * - une incohérence des données (compact absent là où ScummVM déréférence un pointeur nul) lève une erreur au lieu de planter.
 */

import type { Sequence } from "../../../engine/sequence";
import type { ScummvmRandom } from "../../../engine/rng";
import { parseDataFileHeader } from "../data/header";
import { CompactField as F, C_ACTION_MODE, C_ANIM_UP, MegaSetField, NEXT_MEGA_SET } from "../data/compact-fields";
import type { Compacts, CompactView } from "./compacts";
import { EffectQueue } from "./effects";
import type { ItemCache } from "./files";
import {
  CLICK_TABLE,
  Cpt,
  Dir,
  FIXED_TEXT_WIDTH,
  FULL_SCREEN_WIDTH,
  L,
  LF_START_FX,
  MODULE_COUNT,
  S_AR_X,
  S_AR_Y,
  S_COUNT,
  S_FRAME,
  S_LENGTH,
  SEND_SYNC,
  SF,
  ST,
  ST_COLLISION_BIT,
  Script,
  TOP_LEFT_X,
  TOP_LEFT_Y,
  Var,
} from "./ids";
import { MCODES, type McodeEntry } from "./mcodes/index";
import type { Mouse } from "./mouse";
import { Interpreter, type ScriptHost } from "./script";
import type { BassControl, BassScreen, BassSound, BassText, Router, WalkGrid } from "./services";
import type { ScriptVars } from "./vars";

/** `SkyEngine::_systemVars` : ce que la logique en lit ou y écrit. */
export interface SystemVars {
  systemFlags: number;
  gameVersion: number;
  /** Ms par tour de jeu (80). */
  gameSpeed: number;
  currentPalette: number;
  currentMusic: number;
  pastIntro: boolean;
}

/** Trace au format du banc (`patch/sky-trace.patch`) : appelée seulement si elle est fournie. */
export interface LogicTrace {
  logic?(curId: number, logic: number): void;
  opcode?(curId: number, command: number, module: Uint16Array, pos: number): void;
  mcode?(curId: number, num: number, a: number, b: number, c: number): void;
}

/** Services et état fournis par le moteur (`BassEngine`). */
export interface LogicDeps {
  readonly vars: ScriptVars;
  readonly compacts: Compacts;
  readonly items: ItemCache;
  readonly mouse: Mouse;
  readonly system: SystemVars;
  readonly rng: ScummvmRandom;
  readonly screen: BassScreen;
  readonly sound: BassSound;
  readonly text: BassText;
  readonly grid: WalkGrid;
  readonly router: Router;
  readonly control: BassControl;
  /** Module de scripts `F_MODULE_0 + n`, décompressé (`loadScriptFile`). */
  loadModule(n: number): Uint8Array;
  /** Horloge du moteur, en ms. */
  nowMs(): number;
  /** Vrai si Échap a été demandé (abrège `fnLookAt`). */
  takeSkip(): boolean;
  log(message: string): void;
  trace?: LogicTrace;
}

export class Logic implements ScriptHost {
  readonly vars: ScriptVars;
  readonly compacts: Compacts;
  readonly interpreter: Interpreter;
  readonly effects = new EffectQueue();
  /** Compact courant (`_compact`). */
  compact: CompactView;
  /** Section chargée (`_currentSection`) : 0xFF force le chargement. */
  currentSection = 0xff;
  /** `_objectList` (menu d'objets). */
  readonly objectList = new Uint32Array(30);
  private readonly modules: (Uint16Array | null)[] = new Array<Uint16Array | null>(MODULE_COUNT).fill(null);
  private readonly mcodes: readonly McodeEntry[] = MCODES;

  constructor(readonly deps: LogicDeps) {
    this.vars = deps.vars;
    this.compacts = deps.compacts;
    this.interpreter = new Interpreter(this);
    this.compact = deps.compacts.require(Cpt.FOSTER);
  }

  // --- ScriptHost ---

  /** `checkModuleLoaded` / chargement à la demande de `Logic::script`. */
  module(n: number): Uint16Array {
    let mod = this.modules[n];
    if (!mod) {
      const bytes = this.deps.loadModule(n);
      mod = new Uint16Array(bytes.length >> 1);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < mod.length; i++) mod[i] = view.getUint16(i * 2, true);
      this.modules[n] = mod;
    }
    return mod;
  }

  /** `fnExec` / `call_mcode`. */
  mcode(num: number, a: number, b: number, c: number): boolean {
    const entry = this.mcodes[num];
    if (!entry) throw new Error(`mcode ${num} inconnu`);
    this.deps.trace?.mcode?.(this.vars[Var.CUR_ID]!, num, a, b, c);
    return entry.fn(this, a, b, c);
  }

  traceOpcode(command: number, module: Uint16Array, pos: number): void {
    this.deps.trace?.opcode?.(this.vars[Var.CUR_ID]!, command, module, pos);
  }

  /** `Logic::script`. */
  script(scriptNo: number, offset: number): number {
    return this.interpreter.run(scriptNo & 0xffff, offset & 0xffff);
  }

  /** Les modules déjà chargés sont jetés (changement de version des données, tests). */
  flushModules(): void {
    this.modules.fill(null);
  }

  // --- Tour de logique ---

  /** `Logic::engine`, reprenable : rend la main (ticks) pendant les effets demandés par les mcodes, puis reprend au compact suivant. */
  *engine(): Sequence {
    const { vars, compacts } = this;
    do {
      let list = compacts.require(vars[Var.LOGIC_LIST_NO]!);
      let pos = 0;
      for (;;) {
        const id = list[pos++]!;
        if (!id) break; // fin de liste
        if (id === 0xffff) {
          list = compacts.require(list[pos]!); // changement de liste
          pos = 0;
          continue;
        }
        vars[Var.CUR_ID] = id;
        const cpt = compacts.require(id);
        this.compact = cpt;
        if (!(cpt[F.status]! & ST.LOGIC)) continue;
        if (cpt[F.status]! & ST.GRID_PLOT) this.deps.grid.removeObjectFromWalk(cpt);
        this.deps.trace?.logic?.(id, cpt[F.logic]!);
        this.runLogic(cpt[F.logic]!);
        if (cpt[F.status]! & ST.GRID_PLOT) this.deps.grid.objectToWalk(cpt);
        // Un `sync` reçu ne vaut que pour un tour : ce tour du compact vient de finir.
        cpt[F.sync] = 0;
        if (this.effects.pending) yield* this.effects.flush();
      }
    } while (this.checkProtection());
  }

  /** `checkProtection` : la saisie du code (protection ou réacteur) est sautée ; le tour est alors refait. */
  checkProtection(): boolean {
    const vars = this.vars;
    if (!vars[Var.ENTER_DIGITS]) return false;
    vars[Var.FS_COMMAND] = vars[Var.CONSOLE_TYPE] === 5 ? 240 : 337;
    vars[Var.ENTER_DIGITS] = 0;
    return true;
  }

  /** `_logicTable[logic]`. */
  runLogic(logic: number): void {
    switch (logic) {
      case L.NOP:
        return;
      case L.SCRIPT:
        return this.logicScript();
      case L.AR:
        return this.autoRoute();
      case L.AR_ANIM:
        return this.arAnim();
      case L.AR_TURNING:
        return this.arTurn();
      case L.ALT:
        return this.alt();
      case L.MOD_ANIMATE:
        return this.anim();
      case L.TURNING:
        return this.turn();
      case L.CURSOR:
        return this.deps.text.logicCursor(this.compact, this.deps.mouse.x, this.deps.mouse.y);
      case L.TALK:
        return this.talk();
      case L.LISTEN:
        return this.listen();
      case L.STOPPED:
        return this.stopped();
      case L.CHOOSE:
        return this.choose();
      case L.FRAMES:
        return this.frames();
      case L.PAUSE:
        return this.pause();
      case L.WAIT_SYNC:
        return this.waitSync();
      case L.SIMPLE_MOD:
        return this.simpleAnim();
      default:
        throw new Error(`logique ${logic} inconnue`);
    }
  }

  /** `logicScript` : exécute le script du niveau courant ; un script fini fait redescendre d'un niveau. */
  logicScript(): void {
    const cpt = this.compact;
    const compacts = this.compacts;
    for (;;) {
      const mode = cpt[F.mode]!;
      const scriptNo = compacts.getSub(cpt, mode);
      let offset = compacts.getSub(cpt, mode + 2);
      offset = this.script(scriptNo, offset);
      compacts.setSub(cpt, mode + 2, offset);
      if (!offset) cpt[F.mode] = cpt[F.mode]! - 4;
      else if (cpt[F.mode] === mode) return;
    }
  }

  /** `L_AR` : calcul de la route (vague E), puis retour au script. */
  private autoRoute(): void {
    const cpt = this.compact;
    cpt[F.downFlag] = this.deps.router.autoRoute(cpt);
    // WORKAROUND du bogue 1823 (ScummVM) : Joey à la sortie de l'ascenseur.
    if (cpt[F.downFlag] === 2 && this.compacts.isId(cpt, Cpt.JOEY) && cpt[F.mode] === 0 && cpt[F.baseSub] === Script.JOEY_OUT_OF_LIFT) {
      cpt[F.downFlag] = 0;
    }
    if (cpt[F.downFlag] !== 1) {
      cpt[F.grafixProgId] = cpt[F.animScratchId]!;
      cpt[F.grafixProgPos] = 0;
    }
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_AR_ANIM` : suit la route ; collisions aux frontières de 8 pixels. */
  private arAnim(): void {
    const cpt = this.compact;
    const { vars, compacts } = this;
    if (cpt[F.xcood]! & 7 || cpt[F.ycood]! & 7) return this.mainAnim();
    if (cpt[F.waitingFor] === 0xffff) return this.mainAnim(); // premier tour d'une nouvelle route
    if (cpt[F.waitingFor]) {
      if (this.isCollision(compacts.require(cpt[F.waitingFor]!))) return this.stopAndWait();
      cpt[F.waitingFor] = 0;
    }

    let list = compacts.require(vars[Var.LOGIC_LIST_NO]!);
    let pos = 0;
    for (;;) {
      const id = list[pos++]!;
      if (!id) break;
      if (id === 0xffff) {
        list = compacts.require(list[pos]!);
        pos = 0;
        continue;
      }
      if (id === (vars[Var.CUR_ID]! & 0xffff)) continue;
      vars[Var.HIT_ID] = id;
      const other = compacts.require(id);
      if (!(other[F.status]! & (1 << ST_COLLISION_BIT))) continue;
      if (other[F.screen] !== cpt[F.screen]) continue;
      if (this.isCollision(other)) {
        if (other[F.logic] !== L.AR_ANIM) {
          // L'autre ne marche pas : il nous attendra ; on relance notre script de déplacement.
          cpt[F.waitingFor] = 0xffff;
          other[F.waitingFor] = vars[Var.CUR_ID]! & 0xffff;
          compacts.setSub(cpt, cpt[F.mode]! + 2, 0);
          cpt[F.logic] = L.SCRIPT;
          this.logicScript();
          return;
        }
        this.script(cpt[F.miniBump]!, 0);
        return;
      }
    }

    if (cpt[F.request]) {
      cpt[F.mode] = C_ACTION_MODE;
      cpt[F.actionSub] = cpt[F.request]!;
      cpt[F.actionSub_off] = 0;
      cpt[F.request] = 0;
      cpt[F.logic] = L.SCRIPT;
      this.logicScript();
      return;
    }

    if (!cpt[F.atWatch]) return this.mainAnim();
    if (cpt[F.atWas] === vars[cpt[F.atWatch]! >> 2]) return this.mainAnim();
    compacts.setSub(cpt, cpt[F.mode]! + 2, 0);
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `mainAnim` : un pas de la route compactée (distance, direction) ; rotation si la direction change. */
  private mainAnim(): void {
    const cpt = this.compact;
    const compacts = this.compacts;
    cpt[F.waitingFor] = 0;
    const g = compacts.grafix(cpt);
    if (!g) throw new Error("mainAnim : pas de programme graphique");
    const seq = g.data;
    let p = g.pos;
    if (!seq[p]) {
      p += 2;
      cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 2;
      if (!seq[p]) {
        // Fin de la route.
        cpt[F.arAnimIndex] = 0;
        cpt[F.downFlag] = 0;
        cpt[F.logic] = L.SCRIPT;
        this.logicScript();
        return;
      }
      cpt[F.arAnimIndex] = 0;
    }

    let dir: number;
    while ((dir = cpt[F.dir]!) !== seq[p + 1]) {
      cpt[F.dir] = seq[p + 1]!;
      const tt = compacts.turnTable(cpt, dir);
      if (tt[cpt[F.dir]!]) {
        cpt[F.turnProgId] = tt[cpt[F.dir]!]!;
        cpt[F.turnProgPos] = 0;
        cpt[F.logic] = L.AR_TURNING;
        this.arTurn();
        return;
      }
    }

    const animList = compacts.require(compacts.getElem(cpt, C_ANIM_UP + cpt[F.megaSet]! + dir * 4));
    let index = cpt[F.arAnimIndex]!;
    if (!animList[index >> 1]) {
      index = 0;
      cpt[F.arAnimIndex] = 0;
    }
    cpt[F.arAnimIndex] = cpt[F.arAnimIndex]! + S_LENGTH;
    seq[p] = seq[p]! - animList[(S_COUNT + index) >> 1]!;
    cpt[F.frame] = animList[(S_FRAME + index) >> 1]!;
    cpt[F.xcood] = cpt[F.xcood]! + animList[(S_AR_X + index) >> 1]!;
    cpt[F.ycood] = cpt[F.ycood]! + animList[(S_AR_Y + index) >> 1]!;
  }

  /** `L_AR_TURNING`. */
  private arTurn(): void {
    const cpt = this.compact;
    const turn = this.compacts.require(cpt[F.turnProgId]!);
    const p = cpt[F.turnProgPos]!;
    cpt[F.frame] = turn[p]!;
    cpt[F.turnProgPos] = p + 1;
    if (!turn[p + 1]) {
      cpt[F.arAnimIndex] = 0;
      cpt[F.logic] = L.AR_ANIM;
    }
  }

  /** `L_ALT` : change de script au niveau courant. */
  private alt(): void {
    const cpt = this.compact;
    cpt[F.logic] = L.SCRIPT;
    this.compacts.setSub(cpt, cpt[F.mode]!, cpt[F.alt]!);
    this.compacts.setSub(cpt, cpt[F.mode]! + 2, 0);
    this.logicScript();
  }

  /** `L_MOD_ANIMATE` : programme d'animation (coordonnées, image, effets, synchronisations). */
  private anim(): void {
    const cpt = this.compact;
    const g = this.compacts.grafix(cpt);
    if (!g) throw new Error("anim : pas de programme graphique");
    const prog = g.data;
    let p = g.pos;
    while (prog[p]) {
      cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 3; // trois mots par commande
      if (prog[p] === LF_START_FX) {
        p++;
        const sound = prog[p++]!;
        p++; // volume, ignoré (`fnStartFx` n'en tient pas compte)
        this.deps.sound.startFx(sound, 0);
      } else if (prog[p]! >= LF_START_FX) {
        p++;
        const target = this.compacts.require(prog[p++]!);
        target[F.sync] = prog[p++]!;
      } else {
        cpt[F.xcood] = prog[p++]!;
        cpt[F.ycood] = prog[p++]!;
        cpt[F.frame] = prog[p++]! | cpt[F.offset]!;
        return;
      }
    }
    cpt[F.downFlag] = 0;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_TURNING`. */
  private turn(): void {
    const cpt = this.compact;
    const turn = this.compacts.require(cpt[F.turnProgId]!);
    const p = cpt[F.turnProgPos]!;
    if (turn[p]) {
      cpt[F.frame] = turn[p]!;
      cpt[F.turnProgPos] = p + 1;
      return;
    }
    cpt[F.arAnimIndex] = 0;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_TALK` : décompte de la réplique, animation de la parole, interruption d'un clic. */
  private talk(): void {
    const cpt = this.compact;
    const { compacts, vars } = this;
    const { sound, mouse, system } = this.deps;

    if (mouse.wasClicked() && CLICK_TABLE.includes(vars[Var.CUR_ID]! & 0xffff)) {
      if (system.systemFlags & SF.ALLOW_SPEECH && !sound.speechFinished()) sound.stopSpeech();
      if (cpt[F.spTextId]! > 0 && cpt[F.spTextId]! < 0xffff) compacts.require(cpt[F.spTextId]!)[F.status] = 0;
      if (compacts.grafix(cpt)) {
        cpt[F.frame] = cpt[F.getToFlag]!; // debout
        cpt[F.grafixProgId] = 0;
      }
      cpt[F.logic] = L.SCRIPT;
      this.logicScript();
      return;
    }

    if (cpt[F.spTextId] === 0xffff && sound.speechFinished()) {
      cpt[F.logic] = L.SCRIPT;
      if (compacts.grafix(cpt)) {
        cpt[F.frame] = cpt[F.getToFlag]!;
        cpt[F.grafixProgId] = 0;
      }
      this.logicScript();
      return;
    }

    const g = compacts.grafix(cpt);
    if (g) {
      if (g.data[g.pos] && (cpt[F.spTime] !== 3 || !sound.speechFinished())) {
        // L'animation s'arrête trois tours avant la fin de la voix.
        cpt[F.frame] = g.data[g.pos + 2]! + cpt[F.offset]!;
        cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 3;
      } else {
        cpt[F.frame] = cpt[F.getToFlag]!;
        cpt[F.grafixProgId] = 0;
      }
    }

    if (sound.speechFinished()) cpt[F.spTime] = cpt[F.spTime]! - 1;

    if (cpt[F.spTime] === 0) {
      if (cpt[F.spTextId]) compacts.require(cpt[F.spTextId]!)[F.status] = 0; // efface le texte
      cpt[F.logic] = L.SCRIPT;
      this.logicScript();
    }
  }

  /** `L_LISTEN` : attend que le compact de `flag` quitte `L_TALK`. */
  private listen(): void {
    const cpt = this.compact;
    if (this.compacts.require(cpt[F.flag]!)[F.logic] === L.TALK) return;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_STOPPED` : attend que l'autre personnage s'écarte, puis relance le script du niveau inférieur. */
  private stopped(): void {
    const cpt = this.compact;
    const other = this.compacts.fetch(cpt[F.waitingFor]!);
    if (other && !other[F.mood] && this.isCollision(other)) return;
    this.compacts.setSub(cpt, cpt[F.mode]! - 2, 0);
    cpt[F.waitingFor] = 0xffff;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_CHOOSE` : attend un choix de dialogue (`THE_CHOSEN_ONE`). */
  private choose(): void {
    if (!this.vars[Var.THE_CHOSEN_ONE]) return;
    this.fnNoHuman();
    this.deps.system.systemFlags &= ~SF.CHOOSING;
    this.compact[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_FRAMES`. */
  private frames(): void {
    const cpt = this.compact;
    if (!cpt[F.sync]) return this.simpleAnim();
    cpt[F.downFlag] = 0;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_PAUSE` : décompte de `flag`. */
  private pause(): void {
    const cpt = this.compact;
    cpt[F.flag] = cpt[F.flag]! - 1;
    if (cpt[F.flag]) return;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_WAIT_SYNC`. */
  private waitSync(): void {
    const cpt = this.compact;
    if (!cpt[F.sync]) return;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `L_SIMPLE_MOD` (aussi appelée par `fnSetToStand`, `fnSimpleMod`, `fnRunFrames`) : images sans coordonnées. */
  simpleAnim(): void {
    const cpt = this.compact;
    const g = this.compacts.grafix(cpt);
    if (!g) throw new Error("simpleAnim : pas de programme graphique");
    const prog = g.data;
    let p = g.pos;
    while (prog[p]) {
      cpt[F.grafixProgPos] = cpt[F.grafixProgPos]! + 3;
      if (prog[p] !== SEND_SYNC) {
        p += 2; // coordonnées ignorées
        cpt[F.frame] = prog[p]! >= 64 ? prog[p]! : prog[p]! + cpt[F.offset]!;
        return;
      }
      p++;
      const target = this.compacts.require(prog[p++]!);
      target[F.sync] = prog[p++]!;
    }
    cpt[F.downFlag] = 0;
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** Lance `anim` depuis un mcode (`fnRunAnimMod`). */
  runAnim(): void {
    this.anim();
  }

  /** Lance `turn` depuis un mcode (`fnTurnTo`). */
  runTurn(): void {
    this.turn();
  }

  /** `isCollision` : le compact courant touche-t-il `other` (frontières de 8 pixels, largeurs des `MegaSet`) ? */
  isCollision(other: CompactView): boolean {
    const cpt = this.compact;
    const compacts = this.compacts;
    const thisBase = compacts.megaSetWordBase(cpt);
    const otherBase = compacts.megaSetWordBase(other);
    const thisColOffset = cpt[thisBase + MegaSetField.colOffset]!;
    const thisColWidth = cpt[thisBase + MegaSetField.colWidth]!;
    const thisLastChr = cpt[thisBase + MegaSetField.lastChr]!;
    const otherColOffset = other[otherBase + MegaSetField.colOffset]!;
    const otherColWidth = other[otherBase + MegaSetField.colWidth]!;
    const otherLastChr = other[otherBase + MegaSetField.lastChr]!;

    let otherX = other[F.xcood]! & ~7 & 0xffff;
    const otherY = other[F.ycood]! & ~7 & 0xffff;
    const dir = cpt[F.dir]!;
    const x = cpt[F.xcood]!;
    const y = cpt[F.ycood]!;
    if (dir === Dir.UP || dir === Dir.DOWN) {
      otherX = (otherX - thisColOffset) & 0xffff;
      otherX = (otherX + otherColOffset) & 0xffff;
      if (otherX + otherColWidth < x) return false;
      if (otherX - thisColWidth >= x) return false;
      if (dir === Dir.UP) return otherY + 8 === y || otherY + 16 === y;
      return otherY - 8 === y || otherY - 16 === y;
    }
    if (otherY !== y) return false;
    if (dir === Dir.LEFT) return otherX + otherLastChr === x || otherX + otherLastChr - 8 === x;
    return otherX - thisLastChr === x || otherX - thisLastChr - 8 === x;
  }

  /** `runGetOff` : script de sortie de la zone survolée (`GET_OFF`). */
  runGetOff(): void {
    const getOff = this.vars[Var.GET_OFF]!;
    this.vars[Var.GET_OFF] = 0;
    if (getOff) this.script(getOff & 0xffff, getOff >>> 16);
  }

  /** `stopAndWait` : monte d'un niveau dans le script d'arrêt (`stopScript`). */
  stopAndWait(): void {
    const cpt = this.compact;
    cpt[F.mode] = cpt[F.mode]! + 4;
    this.compacts.setSub(cpt, cpt[F.mode]!, cpt[F.stopScript]!);
    this.compacts.setSub(cpt, cpt[F.mode]! + 2, 0);
    cpt[F.logic] = L.SCRIPT;
    this.logicScript();
  }

  /** `mouseScript` : script d'une zone de souris, la zone comme compact courant ; rustine 8627 (curseur après un clic d'inventaire). */
  mouseScript(scrNum: number, itemId: number): number {
    const saved = this.compact;
    this.compact = this.compacts.require(itemId);
    const ret = this.script(scrNum & 0xffff, scrNum >>> 16);
    this.compact = saved;
    if (scrNum === Script.MENU_SELECT || (scrNum >= Script.LINC_MENU_SELECT && scrNum <= Script.DOC_MENU_SELECT)) this.fnCrossMouse();
    return ret;
  }

  /** `fnNoHuman` (aussi appelé par `L_CHOOSE` et `fnLookAt`). */
  fnNoHuman(): boolean {
    const vars = this.vars;
    if (!vars[Var.MOUSE_STOP]) {
      vars[Var.MOUSE_STATUS] = vars[Var.MOUSE_STATUS]! & 1;
      this.runGetOff();
      this.deps.mouse.sprite(6, 0, 0); // MOUSE_BLANK
    }
    return true;
  }

  /** `fnCrossMouse`. */
  fnCrossMouse(): boolean {
    if (this.vars[Var.OBJECT_HELD]) this.deps.mouse.openCloseHand(false);
    else this.deps.mouse.sprite(7, 4, 4); // MOUSE_CROSS
    return true;
  }

  /** `stdSpeak` : réplique de `target` (voix, texte, animation de parole), passe `target` en `L_TALK`. */
  stdSpeak(target: CompactView, textNum: number, animNum: number, _base: number): void {
    const { compacts, vars } = this;
    const { sound, text, system, screen, items } = this.deps;
    animNum = (animNum + Math.floor(target[F.megaSet]! / NEXT_MEGA_SET)) & 0xff;
    const talkTable = compacts.require(Cpt.TALK_TABLE_LIST);
    target[F.grafixProgId] = talkTable[animNum]!;
    target[F.grafixProgPos] = 0;
    const g = compacts.grafix(target);
    if (g) {
      target[F.offset] = g.data[g.pos]!;
      target[F.getToFlag] = g.data[g.pos + 1]!;
      target[F.grafixProgPos] = target[F.grafixProgPos]! + 2;
    } else {
      target[F.grafixProgId] = 0;
    }

    const speechFileFound = sound.startSpeech(textNum & 0xffff);
    screen.setFocus?.(target[F.xcood]! - TOP_LEFT_X, target[F.ycood]! - TOP_LEFT_Y);

    if (system.systemFlags & SF.ALLOW_TEXT || !speechFileFound) {
      const info = text.lowTextManager(textNum, FIXED_TEXT_WIDTH, 0, target[F.spColor]! & 0xff, true);
      if (!info) {
        // Souche (vague C) : pas de texte formé, la réplique dure 10 tours.
        this.deps.log(`stdSpeak : texte ${textNum} non formé (textes non portés)`);
        target[F.spTextId] = 0;
        target[F.spTime] = 10;
      } else {
        const textCompact = compacts.require(info.compactNum);
        target[F.spTextId] = info.compactNum;
        textCompact[F.screen] = target[F.screen]!;
        if (vars[Var.SCREEN] === target[F.screen]) {
          // Texte centré au-dessus du personnage, dans l'écran.
          const sprite = items.fetch(target[F.frame]! >> 6);
          if (!sprite) throw new Error(`stdSpeak : sprite ${target[F.frame]! >> 6} non chargé`);
          const header = parseDataFileHeader(sprite);
          let xPos = (target[F.xcood]! + header.offsetX) & 0xffff;
          let width = header.width >> 1;
          xPos = (xPos + width - FIXED_TEXT_WIDTH / 2) & 0xffff;
          if (xPos < TOP_LEFT_X) xPos = TOP_LEFT_X;
          width = (xPos + FIXED_TEXT_WIDTH) & 0xffff;
          if (TOP_LEFT_X + FULL_SCREEN_WIDTH <= width) xPos = TOP_LEFT_X + FULL_SCREEN_WIDTH - FIXED_TEXT_WIDTH;
          textCompact[F.xcood] = xPos;
          let yPos = (target[F.ycood]! + header.offsetY - 6 - info.height) & 0xffff;
          if (yPos < TOP_LEFT_Y) yPos = TOP_LEFT_Y;
          textCompact[F.ycood] = yPos;
        } else {
          target[F.spTextId] = 0; // hors de l'écran : pas de texte
          textCompact[F.status] = 0;
        }
        target[F.spTime] = speechFileFound ? 10 : info.numLetters + 5;
      }
    } else {
      target[F.spTime] = 10;
      target[F.spTextId] = 0;
    }
    target[F.logic] = L.TALK;
  }

  /**
   * Part logique de `Screen::spriteEngine` (`doSprites(BACK)`, `sortSprites`, `doSprites(FORE)`) : un compact affiché sur l'écran courant
   * dont le fichier de sprite n'est pas chargé est désactivé (`status = 0`). Le dessin lui-même est la vague R.
   */
  spriteEngineStatus(): void {
    this.doSpritesStatus(0);
    this.doSpritesStatus(2, true);
    this.doSpritesStatus(1);
  }

  /** `doSprites(layer)` (bit `1 << layer`) ou, avec `sort`, `sortSprites` (bit 4). */
  private doSpritesStatus(layer: number, sort = false): void {
    const { vars, compacts } = this;
    const items = this.deps.items;
    const bit = sort ? ST.SORT : 1 << layer;
    for (let n = Var.DRAW_LIST_NO; vars[n]; n++) {
      let list = compacts.require(vars[n]!);
      let p = 0;
      while (list[p]) {
        while (list[p] !== 0 && list[p] !== 0xffff) {
          const sprite = compacts.require(list[p]!);
          p++;
          if (sprite[F.status]! & bit && sprite[F.screen] === vars[Var.SCREEN] && !items.fetch(sprite[F.frame]! >> 6)) sprite[F.status] = 0;
        }
        while (list[p] === 0xffff) {
          list = compacts.require(list[p + 1]!);
          p = 0;
        }
      }
    }
  }

  /** Effet bloquant demandé par un mcode : joué après le compact en cours. */
  block(effect: Sequence): void {
    this.effects.block(effect);
  }
}
