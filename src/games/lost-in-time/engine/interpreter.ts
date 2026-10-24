import type { Game } from "./game";
import type { HotspotBlock, HotspotContext, HotspotDef, SceneryLoadArgs } from "./host";
import { MOUSE_BOTH, MOUSE_NONE, WaitingForInput } from "./host";
import {
  decodeBlock2,
  decodeInstr,
  type Args,
  type ExprRef,
  type Instr,
  type SceneryDecoded,
  type VarRef,
} from "./opcodes";
import {
  Expression,
  OP_STOP,
  TYPE_ARRAY_INT16,
  TYPE_ARRAY_INT32,
  TYPE_ARRAY_INT8,
  TYPE_ARRAY_STR,
  TYPE_IMM_INT16,
  TYPE_VAR_INT16,
  TYPE_VAR_INT32,
  TYPE_VAR_INT32_AS_INT16,
  TYPE_VAR_INT8,
  TYPE_VAR_STR,
  type ExprEnv,
  type Script,
} from "./script";
import { isPartStateFile, partOfItk, partOfVariables } from "./parts";
import { Variables, bytesToString, stringToBytes } from "./variables";

/** Levée quand le moteur dépasse le nombre d'instructions autorisé (garde-fou des tests). */
export class StepBudgetExceeded extends Error {
  constructor(readonly steps: number) {
    super(`budget de ${steps} instructions dépassé`);
    this.name = "StepBudgetExceeded";
  }
}

/** Paramètres du bloc de commandes en cours (OpFuncParams). */
export interface BlockParams {
  retFlag: number;
  cmdCount: number;
  counter: number;
  doReturn: boolean;
}

/** Variables de contrôle propres à chaque appel de playTot. */
export interface ControlFrame {
  nestLevel: number;
  breakFromLevel: number;
  captureCounter: number;
}

type Handler = (it: Interpreter, a: Args, ins: Instr, p: BlockParams) => void | Promise<void>;

/** Commandes qui positionnent elles-mêmes le curseur du script. */
const FLOW_OPS = new Set(["o1_callSub", "o1_switch", "o1_repeatUntil", "o1_whileDo", "o1_if", "o1_return", "o1_returnTo"]);

const KEY_CODES: Record<number, number> = {
  0x4800: 0x0b, // haut
  0x5000: 0x0a, // bas
  0x4d00: 0x09, // droite
  0x4b00: 0x08, // gauche
  0x011b: 0x1b, // échap
  0x0e08: 0x19, // retour arrière
  0x5300: 0x1a, // suppr
};

const i16 = (v: number): number => (v << 16) >> 16;
const atoi = (s: string): number => {
  const m = /^\s*([+-]?\d+)/.exec(s);
  return m ? Number(m[1]) | 0 : 0;
};

interface StackItem {
  isInt: boolean;
  value: number;
  data: Uint8Array | null;
}

/**
 * Interpréteur de scripts (Inter_v3 = v1 < v2 < v3). Les commandes sont décodées une fois
 * (opcodes.ts) puis exécutées ici ; ce qui relève du dessin, du son, etc. est confié aux
 * sous-systèmes avec des arguments déjà décodés. Asynchrone : les attentes passent par l'hôte.
 */
export class Interpreter implements ExprEnv {
  variables: Variables | null = null;
  terminate = 0;
  brk = false;
  frame: ControlFrame = { nestLevel: 0, breakFromLevel: -1, captureCounter: 0 };

  readonly expr: Expression;
  readonly animPalLow = new Int16Array(8);
  readonly animPalHigh = new Int16Array(8);
  readonly animPalDir = new Int16Array(8);
  soundEndTimeKey = 0;
  soundStopVal = 0;
  lastBusyWait = 0;
  noBusyWait = false;
  ignoreSpeakerOff = false;
  steps = 0;
  maxSteps = Infinity;
  /** Budget de calcul synchrone : au-delà, funcBlock rend la main à l'hôte (voir yieldIfBusy). */
  syncBudgetMs = 12;
  syncBudgetSteps = 20_000;
  private syncStartMs = 0;
  private syncStartSteps = 0;
  private loopTicks = 0;
  private syncStartTicks = 0;
  /** Seuil du chien de garde (ms) : une série synchrone plus longue est signalée. */
  watchdogMs = import.meta.env?.DEV ? 200 : Infinity;
  onWatchdog: ((info: { ms: number; tot: string; pos: number }) => void) | null = (i) =>
    console.warn(`[watchdog] ${i.ms.toFixed(0)} ms synchrones dans ${i.tot} @${i.pos}`);
  /** Nombre d'appels de keyFunc : sert à repérer les attentes d'entrée. */
  keyFuncCalls = 0;
  /** Au-delà, keyFunc lève WaitingForInput (exécution à blanc). */
  keyFuncLimit = Infinity;
  private readonly varStack: StackItem[] = [];

  constructor(readonly game: Game) {
    this.expr = new Expression(this);
    // Toute attente d'une image, d'où qu'elle vienne, repart d'une série synchrone neuve.
    const host = game.host;
    const next = host.nextFrame.bind(host);
    host.nextFrame = async () => {
      await next();
      this.resetSync();
    };
  }

  // --- ExprEnv ---
  get script(): Script {
    return this.game.script;
  }

  get vars(): Variables {
    if (!this.variables) throw new Error("variables non allouées");
    return this.variables;
  }

  get animDataSize(): number {
    return this.game.animDataSize;
  }

  random(max: number): number {
    return max <= 0 ? 0 : this.game.host.random(max);
  }

  /** Niveau de terminaison (relu après les attentes, que TypeScript ne voit pas). */
  terminateLevel(): number {
    return this.terminate;
  }

  // --- état de contrôle ---

  initControlVars(full: number): void {
    this.frame.nestLevel = 0;
    this.frame.breakFromLevel = -1;
    this.frame.captureCounter = 0;
    this.brk = false;
    this.terminate = 0;
    if (full === 1) {
      this.animPalDir.fill(0);
      this.soundEndTimeKey = 0;
    }
  }

  allocateVars(count: number): void {
    this.variables = new Variables(count);
  }

  delocateVars(): void {
    this.game.variablesDeleted(this.variables);
    this.variables = null;
  }

  renewTimeInVars(): void {
    const t = this.game.host.date();
    const v = this.vars;
    v.writeVar32(5, t.getFullYear());
    v.writeVar32(6, t.getMonth() + 1);
    v.writeVar32(7, ((t.getDay() + 6) % 7) + 1);
    v.writeVar32(8, t.getDate());
    v.writeVar32(9, t.getHours());
    v.writeVar32(10, t.getMinutes());
    v.writeVar32(11, t.getSeconds());
  }

  // --- évaluations aux offsets décodés ---

  /** readValExpr : entier sur 16 bits signés. */
  val(at: ExprRef): number {
    const s = this.script;
    this.expr.script = s;
    s.pos = at;
    return this.expr.parseValExpr();
  }

  /** evalExpr(&res) : valeur entière (0 pour une chaîne) ; le type est dans `lastType`. */
  lastType = 0;
  int(at: ExprRef): number {
    const s = this.script;
    this.expr.script = s;
    s.pos = at;
    this.lastType = this.expr.evalExpr();
    return this.expr.evalRes;
  }

  /** evalExpr : type du résultat (la valeur est dans `expr.evalRes` / `expr.resultInt`). */
  evalType(at: ExprRef): number {
    const s = this.script;
    this.expr.script = s;
    s.pos = at;
    return this.expr.evalExpr();
  }

  /** evalInt : resultInt de la dernière expression. */
  evalInt(at: ExprRef): number {
    const s = this.script;
    this.expr.script = s;
    s.pos = at;
    return this.expr.evalInt();
  }

  str(at: ExprRef): string {
    const s = this.script;
    this.expr.script = s;
    s.pos = at;
    return this.expr.evalString();
  }

  bool(at: ExprRef): boolean {
    const s = this.script;
    this.expr.script = s;
    s.pos = at;
    return this.expr.evalBool();
  }

  /** call(offset) ; `count` x readValExpr ; pop : coordonnées de zones à recalculer. */
  evalCoords(offset: number, count: number): number[] {
    const s = this.script;
    this.expr.script = s;
    s.call(offset);
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(i16(this.expr.parseValExpr()));
    s.pop();
    return out;
  }

  /** Décalage de la variable désignée (readVarIndex). */
  off(ref: VarRef): number {
    const s = this.script;
    this.expr.script = s;
    s.pos = ref.pos;
    return this.expr.parseVarIndex();
  }

  // --- entrées ---

  storeMouse(): void {
    const g = this.game;
    const [x, y] = g.sys.draw.adjustCoords(1, g.mouseX, g.mouseY);
    const v = this.vars;
    v.writeVar32(2, x);
    v.writeVar32(3, y);
    v.writeVar32(4, g.mouseButtons);
  }

  storeKey(key: number): void {
    const g = this.game;
    const v = this.vars;
    v.writeVar32(12, (g.host.now() - g.startTimeKey) >>> 0);
    this.storeMouse();
    v.writeVar32(1, g.sys.sound.isPlaying() ? 1 : 0);
    if (key in KEY_CODES) key = KEY_CODES[key];
    else if ((key & 0xff) !== 0) key &= 0xff;
    v.writeVar32(0, key);
    if (key !== 0) g.host.input.clearKeys();
  }

  /** Game::checkKeys : met à jour la souris, les animations et retourne la touche. */
  checkKeys(handleMouse: number, sync = true): number {
    const g = this.game;
    g.sys.mult.checkKeysTick(handleMouse);
    if (this.soundEndTimeKey !== 0 && g.host.now() >= this.soundEndTimeKey) {
      g.sys.sound.stop(this.soundStopVal);
      this.soundEndTimeKey = 0;
    }
    const input = g.host.input;
    if (sync) {
      g.mouseX = input.mouseX;
      g.mouseY = input.mouseY;
      // une seule lecture : lire les boutons consomme un clic bref (voir GameInput)
      const buttons = input.mouseButtons;
      g.mouseButtons = buttons === MOUSE_BOTH ? MOUSE_NONE : buttons;
    }
    return input.popKey();
  }

  forceMouseUp(onlyWhenSynced = false): void {
    const g = this.game;
    const input = g.host.input;
    // simple comparaison : lire les boutons consommerait un clic bref
    if (onlyWhenSynced && g.mouseButtons !== input.peekButtons()) return;
    g.mouseButtons = MOUSE_NONE;
    input.mouseButtons = MOUSE_NONE;
  }

  // --- temps ---

  /** Pause d'au moins `ms` millisecondes (au moins une image). */
  async sleep(ms: number): Promise<void> {
    const host = this.game.host;
    const end = host.now() + ms;
    do {
      await host.nextFrame();
    } while (host.now() < end && !this.game.quit);
    this.resetSync();
  }

  async handleBusyWait(): Promise<void> {
    const now = this.game.host.now();
    if (!this.noBusyWait && now - this.lastBusyWait <= 20) await this.sleep(1);
    this.lastBusyWait = now;
    this.noBusyWait = false;
  }

  /** Repart d'une série synchrone neuve (après toute attente de l'hôte). */
  private resetSync(): void {
    this.syncStartMs = this.game.host.now();
    this.syncStartSteps = this.steps;
    this.syncStartTicks = this.loopTicks;
  }

  /**
   * Garantit la progression : une boucle de script qui n'attend jamais (sondage d'une position
   * CD, d'une variable…) bloquerait le fil principal, car le temps de la page ne passe pas entre
   * deux tours. Après un budget de temps ou d'instructions, on rend la main à l'hôte.
   */
  private async yieldIfBusy(): Promise<void> {
    if ((this.steps & 255) !== 0) return;
    const host = this.game.host;
    const ms = host.now() - this.syncStartMs;
    if (ms > this.watchdogMs) this.onWatchdog?.({ ms, tot: this.script.name, pos: this.script.pos });
    if (ms < this.syncBudgetMs && this.steps - this.syncStartSteps < this.syncBudgetSteps) return;
    await host.nextFrame();
    this.resetSync();
  }

  /**
   * Tour de boucle de script (repeat / while) : filet de sécurité indépendant du nombre
   * d'instructions exécutées, au cas où un corps de boucle ne ferait rien (aucune attente).
   */
  async loopBack(): Promise<void> {
    if ((++this.loopTicks & 255) !== 0) return;
    const host = this.game.host;
    if (host.now() - this.syncStartMs < this.syncBudgetMs && this.loopTicks - this.syncStartTicks < this.syncBudgetSteps) return;
    await host.nextFrame();
  }

  animPalette(): void {
    const pal = this.game.sys.palette;
    let any = false;
    for (let j = 0; j < 8; j++) {
      if (this.animPalDir[j] === 0) continue;
      pal.animate(this.animPalLow[j], this.animPalHigh[j], this.animPalDir[j] as 1 | -1);
      any = true;
    }
    if (any) pal.commitAnimation();
  }

  // --- blocs ---

  async funcBlock(retFlag: number): Promise<void> {
    const s = this.script;
    const params: BlockParams = { retFlag, cmdCount: 0, counter: 0, doReturn: false };
    if (s.finished) return;

    this.brk = false;
    s.skip(1);
    params.cmdCount = s.readU8();
    s.skip(2);

    if (params.cmdCount === 0) {
      s.finished = true;
      return;
    }

    do {
      if (this.terminate) break;
      if (++this.steps > this.maxSteps) throw new StepBudgetExceeded(this.maxSteps);

      const sc = this.script;
      const ins = decodeInstr(sc, this.game.resources, sc.pos);
      params.counter++;
      params.doReturn = false;
      const flow = FLOW_OPS.has(ins.name);
      sc.pos = ins.next;

      const handler = HANDLERS[ins.name];
      if (!handler) sc.fail(`commande non implémentée : ${ins.name}`, ins.at);
      const r = handler(this, ins.args, ins, params);
      if (r) await r;
      // Les commandes ordinaires laissent le curseur où l'évaluation des opérandes l'a mis :
      // on le replace après l'instruction. Le flux de contrôle gère lui-même sa position.
      if (!flow) this.script.pos = ins.next;

      await this.yieldIfBusy();

      if (params.doReturn) return;
      if (this.game.quit) break;

      if (this.brk) {
        if (params.retFlag !== 2) break;
        if (this.frame.breakFromLevel === -1) this.brk = false;
        break;
      }
    } while (params.counter !== params.cmdCount);

    this.script.finished = true;
  }

  async callSub(retFlag: number): Promise<void> {
    for (;;) {
      const s = this.script;
      if (this.game.quit || s.finished || s.pos === 0) break;
      const block = s.peekU8();
      if (block === 1) await this.funcBlock(retFlag);
      else if (block === 2) await this.hotspotBlock();
      else s.fail(`type de bloc inconnu ${block}`);
    }
    const s = this.script;
    if (!s.finished && s.pos === 0) this.terminate = 1;
  }

  /** script.call(offset) ; funcBlock(0) ; script.pop() */
  async runFunction(offset: number, before?: () => void): Promise<void> {
    const s = this.script;
    s.call(offset);
    before?.();
    await this.funcBlock(0);
    s.pop();
  }

  // --- zones de la souris (bloc de type 2) ---

  private async hotspotBlock(): Promise<void> {
    const g = this.game;
    const s = this.script;
    const decoded = decodeBlock2(s, g.resources, s.pos);
    const hs = g.sys.hotspots;
    hs.push(0, false);

    const hotspots: HotspotDef[] = decoded.hotspots.map((d) => {
      let left: number, top: number, width: number, height: number;
      if ("exprs" in d.coords) {
        [left, top, width, height] = d.coords.exprs.map((e) => this.val(e) & 0xffff);
      } else {
        [left, top, width, height] = d.coords.values;
      }
      const input = d.input ? { ...d.input, keyVar: this.off(d.input.keyVar) } : null;
      if (input) g.host.input.clearKeys();
      return {
        index: d.index, type: d.type, windowNum: d.windowNum, left, top, width, height,
        funcPos: d.funcPos, key: d.key & 0xffff, id: d.id, flags: d.flags & 0xffff,
        funcEnter: d.funcEnter, funcLeave: d.funcLeave, input, enable: d.enable,
      };
    });
    s.pos = decoded.next;
    s.finished = false;

    g.handleMouse = decoded.handleMouse;
    const block: HotspotBlock = {
      handleMouse: decoded.handleMouse,
      duration: decoded.duration,
      leaveWindowIndex: decoded.leaveWindowIndex,
      hotspotIndex1: decoded.hotspotIndex1,
      hotspotIndex2: decoded.hotspotIndex2,
      needRecalc: decoded.needRecalc,
      hotspots,
    };
    const ctx: HotspotContext = {
      call: (offset) => this.runFunction(offset),
      storeMouse: () => this.storeMouse(),
      isTerminated: () => this.terminate !== 0 || g.quit,
      vars: this.vars,
    };
    const leave = await hs.evaluate(block, ctx);
    if (this.terminate === 0 && leave !== null) this.script.seek(leave);
    else this.script.finished = true;
  }

  // --- pile de variables (pushVars / popVars) ---

  pushInt(value: number): void {
    this.varStack.push({ isInt: true, value, data: null });
  }

  pushData(offset: number, size: number): void {
    this.varStack.push({ isInt: false, value: 0, data: this.vars.copyTo(offset, size) });
  }

  popVar(offset: number): void {
    const item = this.varStack.pop();
    if (!item) throw new Error("popVars sur une pile vide");
    if (item.isInt) this.vars.writeOff32(offset, item.value);
    else if (item.data) this.vars.copyFrom(offset, item.data);
  }

  // --- aides ---

  sceneryArgs(d: SceneryDecoded, search: boolean): SceneryLoadArgs {
    return { index: this.int(d.index), backs: d.backs, picsCount: d.picsCount, resId: d.resId, pics: d.pics, search };
  }

  /** Valeur d'une variable selon son type (pour l'affichage de texte). */
  private formatVar(ref: VarRef): string {
    const off = this.off(ref);
    const v = this.vars;
    switch (ref.first) {
      case TYPE_VAR_INT8:
      case TYPE_ARRAY_INT8:
        return String((v.readOff8(off) << 24) >> 24);
      case TYPE_VAR_INT16:
      case TYPE_VAR_INT32_AS_INT16:
      case TYPE_ARRAY_INT16:
        return String(i16(v.readOff16(off)));
      case TYPE_VAR_INT32:
      case TYPE_ARRAY_INT32:
        return String(v.readOff32(off) | 0);
      case TYPE_VAR_STR:
      case TYPE_ARRAY_STR:
        return v.readString(off);
      default:
        return "";
    }
  }

  formatPrintText(a: Args): string[] {
    return a.chunks.map((c: { text: Uint8Array; variable: VarRef | null }) => {
      let text = bytesToString(c.text);
      if (c.variable) text += this.formatVar(c.variable);
      return text.slice(0, 59);
    });
  }

  /** Port de o2_getTotTextItemPart : extrait un fragment d'un texte du TOT dans une variable chaîne. */
  getTotTextItemPart(a: Args): void {
    const g = this.game;
    const v = this.vars;
    const stringStart = this.off(a.stringVar);
    const part = this.val(a.part);
    let sv = stringStart;

    if (part === -1) {
      g.sys.draw.setHotspotText(v.readString(sv));
      return;
    }
    v.writeOff8(sv, 0);
    const data = g.resources?.getTextItem(a.item);
    if (!data) return;
    const res = g.resources!;
    const itemBase = res.textData ? data.byteOffset - res.textData.byteOffset : 0;

    const b = (o: number): number => {
      if (o < 0 || o >= data.length) this.script.fail(`texte ${a.item} : lecture hors limites (${o})`);
      return data[o];
    };
    const u16 = (o: number): number => b(o) | (b(o + 1) << 8);
    let p = 0;
    let offX = 0;
    let offY = 0;
    let collId = 0;
    let curPart = 0;

    while (i16(u16(p)) !== -1) p += 9;
    p += 2;

    while (b(p) !== 1) {
      switch (b(p)) {
        case 2:
        case 5:
          p++;
          offX = u16(p);
          offY = u16(p + 2);
          p += 4;
          break;
        case 3:
        case 4:
          p += 2;
          break;
        case 6: {
          p++;
          const collCmd = b(p++);
          if (collCmd & 0x80) {
            collId = i16(u16(p));
            p += 2;
          }
          if (collCmd & 0x40) p += 8;
          if (collCmd & 0x8f && -collId - 1 === part) {
            let n = 0;
            for (;;) {
              if (b(p) < 1 || b(p) > 7) {
                if (b(p) >= 32) {
                  v.writeOff8(sv++, b(p++));
                  n++;
                } else p++;
                continue;
              }
              if (n !== 0 || b(p) === 1 || b(p) === 6 || b(p) === 7) {
                v.writeOff8(sv, 0);
                return;
              }
              switch (b(p)) {
                case 2:
                case 5:
                  p += 5;
                  break;
                case 3:
                case 4:
                  p += 2;
                  break;
                default:
                  break;
              }
            }
          }
          break;
        }
        case 7:
        case 8:
        case 9:
          p++;
          break;
        case 10: {
          if (curPart === part) {
            v.writeOff8(sv++, 0xff);
            v.writeOff16(sv, offX);
            v.writeOff16(sv + 2, offY);
            v.writeOff16(sv + 4, itemBase + p);
            v.writeOff8(sv + 6, 0);
            return;
          }
          let end = false;
          while (!end) {
            switch (b(p)) {
              case 2:
              case 5:
                if (Math.abs(offY - u16(p + 3)) > 1) end = true;
                else p += 5;
                break;
              case 3:
                p += 2;
                break;
              case 10:
                p += b(p + 1) * 2 + 2;
                break;
              default:
                if (b(p) < 32) end = true;
                while (b(p) >= 32) p++;
                break;
            }
          }
          if (part >= 0) curPart++;
          break;
        }
        default:
          for (;;) {
            while (b(p) >= 32) v.writeOff8(sv++, b(p++));
            v.writeOff8(sv, 0);
            if ((b(p) !== 2 && b(p) !== 5) || Math.abs(offY - u16(p + 3)) > 1) {
              if (curPart === part) return;
              sv = stringStart;
              v.writeOff8(sv, 0);
              while (b(p) >= 32) p++;
              if (part >= 0) curPart++;
              break;
            }
            p += 5;
          }
          break;
      }
    }
  }
}

// --- Exécution des commandes ---------------------------------------------------------------

/** Pour o1_if / o1_switch : branche en dernière commande d'un bloc de retour (appel terminal). */
const isTail = (p: BlockParams): boolean => p.counter === p.cmdCount && p.retFlag === 2;

const exprList = (it: Interpreter, refs: ExprRef[]): number[] => refs.map((r) => it.val(r));

const HANDLERS: Record<string, Handler> = {
  // flux de contrôle
  async o1_callSub(it, a, _ins, p) {
    const s = it.script;
    if (a.offset < 128) return;
    s.call(a.offset);
    if (isTail(p)) {
      s.pop(false);
      p.doReturn = true;
      return;
    }
    await it.callSub(2);
    it.script.pop();
  },

  async o1_switch(it, a, ins, p) {
    const s = it.script;
    const v = it.vars;
    const off = it.off(a.value);
    let value: number;
    switch (a.value.first) {
      case TYPE_VAR_INT8:
      case TYPE_ARRAY_INT8:
        value = (v.readOff8(off) << 24) >> 24;
        break;
      case TYPE_VAR_INT32:
      case TYPE_ARRAY_INT32:
        value = v.readOff32(off) | 0;
        break;
      default:
        value = i16(v.readOff16(off));
        break;
    }
    let target = 0;
    let found = false;
    for (const c of a.cases) {
      for (const e of c.exprs) {
        if (found) break;
        if (e.kind === "expr") {
          it.int(e.pos);
          if (it.expr.resultInt === value) found = true;
        } else if (e.value === value) found = true;
      }
      if (found && target === 0) target = c.blockPos;
    }
    if (target === 0) target = a.defaultPos;

    s.pos = ins.next;
    s.call(target);
    if (target === 0) s.finished = true;
    if (isTail(p)) {
      s.pop(false);
      p.doReturn = true;
      return;
    }
    await it.funcBlock(0);
    it.script.pop();
  },

  async o1_repeatUntil(it, a, ins) {
    const s = it.script;
    it.frame.nestLevel++;
    let flag: boolean;
    do {
      s.seek(a.blockPos);
      await it.funcBlock(1);
      flag = it.bool(a.condPos);
      await it.loopBack();
    } while (!flag && !it.brk && !it.terminate && !it.game.quit);
    // seek (comme ScummVM) : la fin du corps a levé `finished`, que l'appelant (callSub) relirait à tort
    s.pos = ins.next;
    s.finished = false;
    it.frame.nestLevel--;
    if (it.frame.breakFromLevel > -1) {
      it.brk = false;
      it.frame.breakFromLevel = -1;
    }
  },

  async o1_whileDo(it, a, ins) {
    const s = it.script;
    it.frame.nestLevel++;
    let flag: boolean;
    do {
      flag = it.bool(a.condPos);
      if (it.terminate) {
        s.pos = ins.next;
        return;
      }
      // seek (et non pos) : relance l'exécution, car la fin du tour précédent a levé `finished`
      // et funcBlock rendrait la main aussitôt (boucle infinie sans aucune attente).
      s.seek(a.blockPos);
      if (flag) {
        await it.funcBlock(1);
      }
      s.pos = a.blockPos + a.size;
      if (it.brk || it.terminate || it.game.quit) break;
      await it.loopBack();
    } while (flag);
    s.pos = a.blockPos + a.size;
    s.finished = false;
    it.frame.nestLevel--;
    if (it.frame.breakFromLevel > -1) {
      it.brk = false;
      it.frame.breakFromLevel = -1;
    }
  },

  async o1_if(it, a, ins, p) {
    const s = it.script;
    if (it.bool(a.cond)) {
      if (isTail(p)) {
        s.pos = a.thenPos;
        p.doReturn = true;
        return;
      }
      s.pos = a.thenPos;
      s.push();
      await it.funcBlock(0);
      it.script.pop();
    } else if (a.elsePos) {
      if (isTail(p)) {
        s.pos = a.elsePos;
        p.doReturn = true;
        return;
      }
      s.pos = a.elsePos;
      s.push();
      await it.funcBlock(0);
      it.script.pop();
    }
    it.script.pos = ins.next;
  },

  o2_assign(it, a) {
    const v = it.vars;
    const dest = it.off(a.dest) | 0;
    const destType: number = a.dest.first;
    for (let i = 0; i < a.loop; i++) {
      const srcType = it.evalType(a.srcs[i]);
      const result = it.expr.evalRes;
      const resultInt = it.expr.resultInt;
      switch (destType) {
        case TYPE_VAR_INT8:
        case TYPE_ARRAY_INT8:
          v.writeOff8(dest + i, resultInt);
          break;
        case TYPE_VAR_INT16:
        case TYPE_ARRAY_INT16:
          v.writeOff16(dest + i * 2, resultInt);
          break;
        case TYPE_VAR_INT32:
        case TYPE_ARRAY_INT32:
          v.writeOff32(dest + i * 4, resultInt);
          break;
        case TYPE_VAR_INT32_AS_INT16:
          v.writeOff16(dest + i * 4, resultInt);
          break;
        case TYPE_VAR_STR:
        case TYPE_ARRAY_STR:
          if (srcType === TYPE_IMM_INT16) v.writeOff8(dest, result);
          else v.writeBytesString(dest, it.expr.getResultStr().slice());
          break;
        default:
          break;
      }
    }
  },

  o1_return(it, _a, _ins, p) {
    if (p.retFlag !== 2) it.brk = true;
    it.script.finished = true;
    p.doReturn = true;
  },

  o1_returnTo(it, _a, _ins, p) {
    if (p.retFlag === 1) {
      it.brk = true;
      it.script.finished = true;
      p.doReturn = true;
      return;
    }
    if (it.frame.nestLevel === 0) return;
    it.frame.breakFromLevel = it.frame.nestLevel;
    it.brk = true;
    it.script.finished = true;
    p.doReturn = true;
  },

  o1_setcmdCount(_it, a, _ins, p) {
    p.cmdCount = a.count;
    p.counter = 0;
  },

  // texte et affichage
  o1_printTotText: (it, a) => it.game.sys.draw.printTotText(a.id),
  o1_loadCursor: (it, a) => it.game.sys.cursor.load(a.id, a.index),

  o1_loadSpriteToPos(it, a) {
    const x = it.val(a.x);
    const y = it.val(a.y);
    let dest = (a.flags >> 1) - 1;
    if (dest < 0) dest = 101;
    it.game.sys.draw.loadSprite(a.spriteLeft, dest, a.flags & 1, x, y);
  },

  o2_printText(it, a) {
    const [x, y, back, front, font] = exprList(it, [a.x, a.y, a.back, a.front, a.font]);
    const texts = it.formatPrintText(a);
    for (const text of texts) {
      it.game.sys.draw.printText({
        x, y, backColor: back === 16 ? 0 : back, frontColor: front, fontIndex: font, text, transparent: back === 16,
      });
    }
  },

  o1_loadTot(it, a) {
    const name = a.name ?? it.str(a.expr);
    it.game.totToLoad = `${name}.tot`;
    if (it.terminate !== 2) it.terminate = 1;
  },

  o1_palLoad(it, a) {
    return it.game.sys.palette.load({ cmd: a.cmd, applyNow: a.applyNow, data: a.data });
  },

  async o1_keyFunc(it, a) {
    const g = it.game;
    if (++it.keyFuncCalls > it.keyFuncLimit) throw new WaitingForInput(`keyFunc(${a.cmd}) interrogé ${it.keyFuncLimit} fois`);
    it.animPalette();
    g.sys.draw.blitInvalidated();
    await it.handleBusyWait();
    switch (a.cmd) {
      case 0: {
        g.sys.cursor.hideAnim();
        await it.sleep(1);
        const key = await g.sys.hotspots.check(0, 0);
        it.storeKey(key);
        g.host.input.clearKeys();
        break;
      }
      case -1:
        break;
      case 1:
        it.forceMouseUp(true);
        it.storeKey(it.checkKeys(0));
        break;
      case 2: {
        const key = g.host.input.popKey();
        it.vars.writeVar32(0, key);
        g.host.input.clearKeys();
        break;
      }
      default:
        if (a.cmd < 20) {
          await it.sleep(a.cmd);
          it.noBusyWait = true;
        } else await it.sleep(a.cmd);
        break;
    }
  },

  o1_capturePush(it, a) {
    const [l, t, w, h] = exprList(it, a.e);
    if (w <= 0 || h <= 0) return;
    it.game.sys.draw.capturePush(l, t, w, h);
    it.frame.captureCounter++;
  },

  o1_capturePop(it) {
    if (it.frame.captureCounter !== 0) {
      it.frame.captureCounter--;
      it.game.sys.draw.capturePop(true);
    }
  },

  o2_animPalInit(it, a) {
    let index: number = a.index;
    const [low, high] = exprList(it, a.e);
    if (index > 0) {
      index--;
      it.animPalLow[index] = low;
      it.animPalHigh[index] = high;
      it.animPalDir[index] = 1;
    } else if (index === 0) {
      it.animPalDir.fill(0);
    } else {
      index = -index - 1;
      it.animPalLow[index] = low;
      it.animPalHigh[index] = high;
      it.animPalDir[index] = -1;
    }
  },

  o2_addHotspot(it, a) {
    const id = it.val(a.id);
    let left = it.val(a.left);
    let top = it.val(a.top);
    let width = it.val(a.width) & 0xffff;
    let height = it.val(a.height) & 0xffff;
    const flags = it.val(a.flags) & 0xffff;
    let key: number = a.key & 0xffff;
    if (key === 0) key = Math.abs(id) + 41960;
    const draw = it.game.sys.draw;
    [left, top] = draw.adjustCoords(0, left, top);
    [width, height] = draw.adjustCoords(2, width, height);
    if (left < 0) {
      width += left;
      left = 0;
    }
    if (top < 0) {
      height += top;
      top = 0;
    }
    const hs = it.game.sys.hotspots;
    if (id < 0) {
      hs.add({
        id: (0xd000 - id) & 0xffff, left: left & 0xfffc, top: top & 0xfffc, right: left + width + 3, bottom: top + height + 3,
        flags, key, funcEnter: 0, funcLeave: 0, funcPos: a.funcPos,
      });
    } else {
      hs.add({
        id: (0xe000 + id) & 0xffff, left, top, right: left + width - 1, bottom: top + height - 1,
        flags, key, funcEnter: 0, funcLeave: 0, funcPos: a.funcPos,
      });
    }
  },

  o2_removeHotspot(it, a) {
    const id = it.val(a.a);
    const hs = it.game.sys.hotspots;
    if (id === -2) hs.removeState(0xc | 1);
    else if (id === -1) hs.removeState(0xc | 2);
    else hs.remove(((0xc | 2) << 12) + id);
  },

  o3_getTotTextItemPart: (it, a) => it.getTotTextItemPart(a),

  o1_renewTimeInVars: (it) => it.renewTimeInVars(),

  o1_speakerOn(it, a) {
    const freq = it.val(a.a);
    let length = -1;
    it.ignoreSpeakerOff = false;
    if (freq === 50) {
      length = 5;
      it.ignoreSpeakerOff = true;
    }
    it.game.sys.sound.speakerOn(freq, length);
  },

  o1_speakerOff(it) {
    if (!it.ignoreSpeakerOff) it.game.sys.sound.speakerOff();
    it.ignoreSpeakerOff = false;
  },

  o1_putPixel(it, a) {
    const [x, y, c] = exprList(it, a.e);
    it.game.sys.draw.putPixel(a.surface, x, y, c);
  },

  async o2_goblinFunc(it, a) {
    const g = it.game;
    switch (a.sub) {
      case null:
        break;
      case "o2_loadInfogramesIns":
        g.sys.sound.infogramesLoadInstruments(`${it.vars.readString(a.subArgs.varName * 4, 15)}.INS`);
        break;
      case "o2_startInfogrames":
        g.sys.sound.infogramesPlay();
        break;
      case "o2_stopInfogrames":
        g.sys.sound.infogramesStop();
        break;
      case "o2_playInfogrames":
        g.sys.sound.infogramesLoadSong(`${it.vars.readString(a.subArgs.varName * 4, 15)}.DUM`);
        g.sys.sound.infogramesPlay();
        break;
      case "o3_wobble":
        await g.sys.draw.wobble();
        break;
      default:
        it.script.fail(`opcode gob non implémenté : ${a.sub}`);
    }
  },

  o2_createSprite(it, a) {
    const v: number[] = a.lit ? a.v : exprList(it, a.v);
    const draw = it.game.sys.draw;
    const [width, height] = draw.adjustCoords(0, v[1], v[2]);
    if (width === 0 || height === 0) return;
    draw.createSprite(v[0], width, height, a.flag);
  },

  o1_freeSprite: (it, a) => it.game.sys.draw.freeSprite(a.index),

  o1_loadSpriteContent(it, a) {
    it.game.sys.draw.loadSprite(a.spriteLeft, a.destSurface, a.transparency, 0, 0);
  },

  o3_copySprite(it, a) {
    const src = a.src.isExpr ? it.val(a.src.value) : a.src.value;
    const dest = a.dest.isExpr ? it.val(a.dest.value) : a.dest.value;
    const [left, top, right, bottom, x, y] = exprList(it, a.e);
    const ok = (n: number) => n === 100 || n === 101 || (n >= 0 && n < 50);
    if (!ok(src) || !ok(dest)) return;
    it.game.sys.draw.copySprite(src, dest, left, top, right, bottom, x, y, a.transparency);
  },

  o1_fillRect(it, a) {
    let [x, y, right, bottom, color] = exprList(it, a.e);
    if (right < 0) {
      x += right - 1;
      right = -right + 2;
    }
    if (bottom < 0) {
      y += bottom - 1;
      bottom = -bottom + 2;
    }
    it.game.sys.draw.fillRect(a.surface, x, y, right, bottom, color);
  },

  o1_drawLine(it, a) {
    const [x1, y1, x2, y2, c] = exprList(it, a.e);
    it.game.sys.draw.drawLine(a.surface, x1, y1, x2, y2, c);
  },

  o1_strToLong(it, a) {
    const v = it.vars;
    const s = v.readString(it.off(a.str), 19);
    v.writeOff32(it.off(a.dest), atoi(s));
  },

  o1_invalidate(it, a) {
    const [x, y, right, c] = exprList(it, a.e);
    it.game.sys.draw.invalidate(a.surface, x, y, right, c);
  },

  o1_setBackDelta(it, a) {
    it.game.sys.draw.setBackDelta(it.val(a.a), it.val(a.b));
  },

  o1_playSound(it, a) {
    const [slot, rep, freq] = exprList(it, a.e);
    it.soundEndTimeKey = 0;
    const r = it.game.sys.sound.play(slot, rep, freq);
    if (r && rep < 0) {
      it.soundEndTimeKey = it.game.host.now() + r.endMs;
      it.soundStopVal = r.fadeOut;
    }
  },

  o2_stopSound(it, a) {
    const slot = it.val(a.a);
    if (slot < 0) it.game.sys.sound.stopAdlib();
    else it.game.sys.sound.stop(slot);
    it.soundEndTimeKey = 0;
  },

  o2_loadSound(it, a) {
    let slot = it.val(a.slot);
    const adlib = slot < 0;
    if (adlib) slot = -slot;
    it.game.sys.sound.load({ slot, adlib, id: a.id, name: a.name });
  },

  o1_freeSoundSlot: (it, a) => it.game.sys.sound.freeSlot(it.val(a.a)),
  o1_waitEndPlay: (it) => it.game.sys.sound.waitEndPlay(),

  async o1_playComposition(it, a) {
    const v = it.vars;
    const dataVar = it.off(a.dataVar);
    const freq = it.val(a.freq);
    const max = Math.min(50, Math.trunc((v.size - dataVar) / 4));
    const composition: number[] = [];
    for (let i = 0; i < 50; i++) composition.push(i < max ? i16(v.readOff32(dataVar + i * 4)) : -1);
    await it.game.sys.sound.playComposition(composition, freq);
  },

  o2_getFreeMem(it, a) {
    const v = it.vars;
    v.writeOff32(it.off(a.free), 1000000);
    v.writeOff32(it.off(a.maxFree), 1000000);
    v.writeVar32(16, it.script.variablesCount * 4);
  },

  async o2_checkData(it, a) {
    const file = it.str(a.file);
    const dest = it.off(a.dest);
    const g = it.game;
    const mode = g.sys.saves.getSaveMode(file);
    let size = -1;
    if (mode === "none") size = partOfItk(file) < g.partFloor ? -1 : await g.files.sizeOf(file);
    else if (mode === "save") size = g.sys.saves.getSize(file);
    else if (mode === "exists") size = 23;
    it.vars.writeOff32(dest, size === -1 ? -1 : 50);
    it.vars.writeVar32(16, size);
  },

  o1_cleanupStr(it, a) {
    // La table de transcription des accents du jeu n'est pas portée : le script ne s'en sert pas
    // dans Lost in Time. On ne fait que la mise en forme des espaces.
    const off = it.off(a.str);
    const text = it.vars.readString(off).replace(/ +/g, " ").trim();
    it.vars.writeString(off, text);
  },

  o1_insertStr(it, a) {
    const off = it.off(a.str);
    it.int(a.text);
    const ins = it.expr.getResultStr().slice();
    const pos = it.val(a.pos);
    const cur = it.vars.cstr(off).slice();
    const from = Math.min(pos, cur.length);
    const out = new Uint8Array(cur.length + ins.length);
    out.set(cur.subarray(0, from), 0);
    out.set(ins, from);
    out.set(cur.subarray(from), from + ins.length);
    it.vars.writeBytesString(off, out);
  },

  o1_cutStr(it, a) {
    const off = it.off(a.str);
    const from = it.val(a.pos);
    const cut = it.val(a.size);
    const cur = it.vars.cstr(off).slice();
    if (from >= cur.length) return;
    if (from + cut > cur.length) {
      it.vars.writeOff8(off + from, 0);
      return;
    }
    const out = new Uint8Array(cur.length - cut);
    out.set(cur.subarray(0, from), 0);
    out.set(cur.subarray(from + cut), from);
    it.vars.writeBytesString(off, out);
  },

  o1_strstr(it, a) {
    const off = it.off(a.str);
    it.int(a.needle);
    const needle = it.expr.getResultString();
    const res = it.off(a.res);
    it.vars.writeOff32(res, it.vars.readString(off).indexOf(needle));
  },

  o1_istrlen(it, a) {
    const len = it.vars.cstr(it.off(a.str)).length;
    it.vars.writeOff32(it.off(a.dest), len);
  },

  o1_setMousePos(it, a) {
    const g = it.game;
    const [x, y] = g.sys.draw.adjustCoords(0, it.val(a.a), it.val(a.b));
    g.mouseX = x;
    g.mouseY = y;
    g.host.input.setMousePos(x, y);
  },

  o1_setFrameRate: (it, a) => it.game.timer.setFrameRate(it.val(a.a)),

  async o1_animatePalette(it) {
    const g = it.game;
    g.sys.draw.blitInvalidated();
    await g.timer.waitEndFrame();
    it.animPalette();
    it.storeKey(it.checkKeys(0));
  },

  o1_animateCursor: (it) => it.game.sys.cursor.animate(1),
  o1_blitCursor: (it) => it.game.sys.cursor.blit(),

  o1_loadFont(it, a) {
    const file = it.str(a.file);
    it.game.sys.cursor.animate(4);
    it.game.sys.draw.loadFont(a.index, file);
  },

  o1_freeFont: (it, a) => it.game.sys.draw.freeFont(a.index),

  async o2_readData(it, a) {
    const g = it.game;
    const v = it.vars;
    const file = it.str(a.file);
    let dataVar = it.off(a.dataVar);
    let size = it.val(a.size);
    const offset = it.evalInt(a.offset);

    const mode = g.sys.saves.getSaveMode(file);
    if (mode === "save") {
      v.writeVar32(1, 1);
      if (await g.sys.saves.load(file, dataVar, size, offset)) {
        v.writeVar32(1, 0);
        // sauvegarde chargée en entier : l'image des variables est celle de sa partie
        if (size === 0) g.sessionPart = partOfVariables(v);
      }
      return;
    }
    if (mode === "ignore") return;
    if (size < 0) return;
    if (size === 0) {
      dataVar = 0;
      size = it.script.variablesCount * 4;
    }
    if (file === "") {
      v.writeVar32(1, size);
      return;
    }
    v.writeVar32(1, 1);
    const data = await g.files.fetch(file);
    if (!data) return;
    g.sys.cursor.animate(4);
    const start = offset < 0 ? data.length + offset + 1 : offset;
    let retSize = 0;
    if (dataVar >> 2 === 59 && size === 4) {
      v.writeVar32(59, new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(start, true));
    } else {
      const chunk = data.subarray(start, start + size);
      v.copyFrom(dataVar, chunk);
      retSize = chunk.length;
    }
    if (retSize === size) v.writeVar32(1, 0);
    // état initial d'une partie lu par MENU.TOT : mémorisé pour détecter un enchaînement sur une autre partie
    if (retSize > 0 && dataVar === 0 && isPartStateFile(file)) g.sessionPart = partOfVariables(v);
  },

  async o2_writeData(it, a) {
    const g = it.game;
    const file = it.str(a.file);
    const dataVar = it.off(a.dataVar);
    const size = it.val(a.size);
    const offset = it.evalInt(a.offset);
    it.vars.writeVar32(1, 1);
    const mode = g.sys.saves.getSaveMode(file);
    if (mode === "save") {
      if (await g.sys.saves.save(file, dataVar, size, offset)) it.vars.writeVar32(1, 0);
    }
  },

  async o1_manageDataFile(it, a) {
    const g = it.game;
    const file = it.str(a.a);
    if (file !== "") await g.files.openArchive(file.replace(/\\/g, "/"), true);
    else {
      g.files.closeArchive(true);
      g.sys.video.reopenAll();
    }
  },

  // dessin (opcodes 0x1E)
  async o2_loadMult(it, a) {
    const g = it.game;
    g.sys.mult.loadMult({
      index: a.index,
      resId: a.resId,
      statics: a.statics.map((s: SceneryDecoded) => it.sceneryArgs(s, true)),
      anims: a.anims.map((s: SceneryDecoded) => it.sceneryArgs(s, true)),
      soundKeys: a.soundKeys,
      imds: a.imds,
    });
  },

  o2_playMult(it, a) {
    return it.game.sys.mult.playMult(a.checkEscape >> 1, i16(it.vars.readVar32(57)), (a.checkEscape & 1) !== 0);
  },

  o2_freeMultKeys: (it, a) => it.game.sys.mult.freeMultKeys(a.index),

  o1_initCursor(it, a) {
    const g = it.game;
    g.cursorHotspotXVar = Math.trunc(it.off(a.hx) / 4);
    g.cursorHotspotYVar = Math.trunc(it.off(a.hy) / 4);
    let width = Math.max(a.width, 16);
    let height = Math.max(a.height, 16);
    [width, height] = g.sys.draw.adjustCoords(0, width, height);
    g.sys.cursor.initCursor({ width, height, count: Math.max(a.count, 2) });
  },

  o1_initCursorAnim(it, a) {
    it.game.sys.cursor.initAnim(it.val(a.index), a.low, a.high, a.delay);
  },

  o1_clearCursorAnim: (it, a) => it.game.sys.cursor.clearAnim(it.val(a.a)),
  o2_setRenderFlags: (it, a) => it.game.sys.draw.setRenderFlags(it.val(a.a)),

  o1_loadAnim(it, a) {
    it.game.sys.mult.loadAnim(it.sceneryArgs(a, false));
  },

  o1_loadStatic(it, a) {
    it.game.sys.mult.loadStatic(it.sceneryArgs(a, false));
  },

  o1_freeAnim: (it, a) => it.game.sys.mult.freeAnim(it.int(a.a)),
  o1_freeStatic: (it, a) => it.game.sys.mult.freeStatic(it.int(a.a)),

  o1_updateAnim(it, a) {
    const [dx, dy, anim, layer, frame] = (a.e as ExprRef[]).map((e) => it.int(e));
    it.game.sys.mult.updateAnim(layer, frame, anim, a.flags, dx, dy);
  },

  o2_multSub: (it, a) => it.game.sys.mult.multSub(exprList(it, a.e)),

  o2_initMult(it, a) {
    it.game.sys.mult.initMult({
      left: a.left, top: a.top, width: a.width, height: a.height, objCount: a.objCount,
      posXVar: it.off(a.posX), posYVar: it.off(a.posY), animDataVar: it.off(a.animData),
    });
  },

  o1_freeMult: (it) => it.game.sys.mult.freeMult(),
  o1_animate: (it) => it.game.sys.mult.animate(),

  o2_loadMultObject(it, a) {
    const objIndex = it.val(a.obj) & 0xffff;
    const x = it.val(a.x);
    const y = it.val(a.y);
    const data = (a.data as (ExprRef | null)[]).map((e) => (e === null ? null : it.val(e) & 0xff));
    it.game.sys.mult.loadMultObject({ objIndex, x, y, data });
  },

  o1_getAnimLayerInfo(it, a) {
    const anim = it.int(a.anim);
    const layer = it.int(a.layer);
    const [v0, v1, v2, v3] = (a.v as VarRef[]).map((r) => it.off(r));
    it.game.sys.mult.getAnimLayerInfo(anim, layer, v0, v1, v2, v3);
  },

  o1_getObjAnimSize(it, a) {
    const obj = it.int(a.obj);
    const [v0, v1, v2, v3] = (a.v as VarRef[]).map((r) => it.off(r));
    it.game.sys.mult.getObjAnimSize(obj, v0, v1, v2, v3);
  },

  o2_renderStatic: (it, a) => it.game.sys.mult.renderStatic(it.val(a.a), it.val(a.b)),
  o2_loadCurLayer: (it, a) => it.game.sys.mult.loadCurLayer(it.val(a.a), it.val(a.b)),

  o2_playCDTrack(it, a) {
    it.game.sys.draw.blitInvalidated(true);
    it.game.sys.cd.play(it.str(a.a));
  },

  async o2_waitCDTrackEnd(it) {
    while (it.game.sys.cd.getTrackPos() >= 0 && !it.game.quit) await it.sleep(1);
  },

  o2_stopCD: (it) => it.game.sys.cd.stop(),
  o2_readLIC: (it, a) => it.game.sys.cd.loadLic(`${it.str(a.a)}.LIC`),
  o2_freeLIC: (it) => it.game.sys.cd.unloadLic(),

  async o2_getCDTrackPos(it, a) {
    await it.sleep(1);
    const v = it.vars;
    const pos = it.off(a.pos);
    const name = it.off(a.name);
    v.writeOff32(pos, it.game.sys.cd.getTrackPos(v.readString(name)));
    v.writeString(name, it.game.sys.cd.getCurrentTrack());
  },

  o2_loadFontToSprite(it, a) {
    it.game.sys.draw.loadFontToSprite(a.index, a.sprite, a.base, a.width, a.height);
  },

  o1_freeFontToSprite: (it, a) => it.game.sys.draw.freeFontToSprite(a.index),

  async o2_totSub(it, a) {
    if ((a.length & 0x7f) > 13) it.script.fail(`o2_totSub : longueur ${a.length} > 13`);
    const name = a.name ?? it.str(a.nameExpr);
    if (name.toLowerCase() !== "edit") it.forceMouseUp();
    await it.game.totSub(a.flags, name);
  },

  o2_switchTotSub: (it, a) => it.game.switchTotSub(a.index, a.func),

  o2_pushVars(it, a) {
    for (const item of a.items) {
      if (item.v) it.pushData(it.off(item.v), it.animDataSize * 4);
      else {
        const value = it.int(item.e);
        it.pushInt(it.lastType === TYPE_IMM_INT16 ? value : 0);
      }
    }
  },

  o2_popVars(it, a) {
    for (const ref of a.vars) it.popVar(it.off(ref));
  },

  o2_loadMapObjects(it, a) {
    it.game.sys.goblin.loadMapObjects(it.off(a.v), a.id, a.sounds);
  },

  o2_freeGoblins: (it) => it.game.sys.goblin.freeObjects(),
  o2_moveGoblin(it, a) {
    const [x, y, i] = exprList(it, a.e);
    it.game.sys.goblin.moveGoblin(x, y, i);
  },
  o2_writeGoblinPos(it, a) {
    it.game.sys.goblin.writeGoblinPos(it.off(a.x), it.off(a.y), it.val(a.index));
  },
  o2_stopGoblin: (it, a) => it.game.sys.goblin.stopGoblin(it.val(a.a)),
  o2_setGoblinState(it, a) {
    const [i, s, t] = exprList(it, a.e);
    it.game.sys.goblin.setGoblinState(i, s, t);
  },
  o2_placeGoblin(it, a) {
    const [index, x, y, state] = exprList(it, a.e);
    it.game.sys.goblin.placeGoblin({ index, x, y, state });
  },

  o2_initScreen(it, a) {
    const videoMode = a.mode & 0xff;
    const offY = (a.mode >> 8) & 0xff;
    it.game.sys.draw.initScreen(videoMode, offY, it.val(a.width), it.val(a.height));
  },

  o2_scroll(it, a) {
    const [sx, sy, ex, ey, stx, sty] = exprList(it, a.e);
    return it.game.sys.draw.scroll(sx, sy, ex, ey, stx, sty);
  },

  o2_setScrollOffset(it, a) {
    it.game.sys.draw.setScrollOffset(it.val(a.a), it.val(a.b));
    it.noBusyWait = true;
  },

  async o2_playImd(it, a) {
    const g = it.game;
    let name = it.str(a.name);
    if (name.length > 8) name = name.slice(0, 8);
    const [x, y, startFrame, lastFrame, breakKey, flags, palStart, palEnd] = exprList(it, a.e);
    const args = { name, x, y, startFrame, lastFrame, breakKey, flags, palStart, palEnd, palCmd: 1 << (flags & 0x3f) };
    let slot = 0;
    if (name !== "") {
      slot = await g.sys.video.open(name, args);
      if (slot < 0) {
        it.vars.writeVar32(11, -1);
        return;
      }
    }
    const props = { startFrame, lastFrame, noBlock: false };
    const close = props.lastFrame === -1;
    let closeAfter = close;
    if (props.startFrame === -2) {
      props.startFrame = 0;
      props.lastFrame = 0;
      closeAfter = false;
    }
    if (props.startFrame >= 0) await g.sys.video.play(slot, props, args);
    if (closeAfter) g.sys.video.close(slot);
  },

  async o2_getImdInfo(it, a) {
    const name = it.str(a.name);
    const [x, y, frames, w, h] = (a.v as VarRef[]).map((r) => it.off(r));
    await it.game.sys.video.writeInfo(name, x, y, frames, w, h);
  },

  async o2_openItk(it, a) {
    let file = it.str(a.a);
    if (!file.includes(".")) file += ".ITK";
    await it.game.files.openArchive(file, false);
  },

  o2_closeItk(it) {
    it.game.files.closeArchive(false);
    it.game.sys.video.reopenAll();
  },

  o2_setImdFrontSurf() {},
  o2_resetImdFrontSurf() {},
};

export { OP_STOP, stringToBytes };
