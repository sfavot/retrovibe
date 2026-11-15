/**
 * Machine virtuelle des scripts : pile, 12 types d'opcodes, exécution d'une tranche et ordonnancement des listes PROC / REL.
 *
 * Références (ScummVM `engines/cruise/`, GPL v3+, release 2026.4.0, lu puis réécrit) :
 * - `script.cpp` : `getByteFromScript` (octet signé), `getShortFromScript`, `opcodeType0`..`opcodeType11`, `executeScripts`,
 *   `manageScripts` ;
 * - `stack.cpp` : `pushVar` / `popVar` / `pushPtr` / `popPtr` (pile d'unions, pile vide = 0, assertion sur le type) ;
 * - `function.cpp::opcodeType8` : appel des fonctions natives.
 *
 * Bizarreries reproduites : ordre `pop1 op pop2` (le sommet est l'opérande gauche de `/ - %`) ; comparaison `var2 OP var1` ;
 * conditions de saut 3 = `ccr & 3` et 5 = `ccr & 5` ; un accès indexé à un mot ajoute l'index deux fois (`offset + index`, puis
 * `+ index`) ; un opcode qui renvoie un code négatif arrête la tranche, IP déjà avancé ; pile remise à zéro à chaque tranche ;
 * arithmétique `int16`, division tronquée vers 0.
 *
 * Rustines (plan.md D8) :
 * - `S26.CTP` (`opcodeType1`, sous-type 2) : la condition de ScummVM est reprise telle quelle ; elle est **inerte** (elle teste
 *   `!di` après avoir remplacé `di = 0` par l'overlay courant), donc la rustine ne s'applique jamais, comme dans ScummVM ;
 * - crédits de fin (`executeScripts`) : ScummVM vise l'overlay n° 71 à l'offset 1884 avec un élément sur la pile ; ici l'overlay
 *   est désigné par son nom, `FIN01` (seul overlay dont un script a une instruction à l'offset 1884 avec un seul élément empilé :
 *   `FIN01` procédure 12, `push 1000` puis `load`), pour ne pas dépendre de l'ordre de chargement (risque 4).
 *
 * Écart volontaire : les `assert(0)` et `error()` de ScummVM lèvent une `Error`.
 */
import { ScriptError, ScriptType, STACK_SIZE } from "./ids";
import { int16, readI16, readU8, writeI16, writeU8, type Ptr } from "./memory";
import { getSingleObjectParam, setObjectPosition } from "./objects";
import { NATIVES } from "./functions/index";
import type { EngineState, ScriptInstance } from "./state";

type StackEntry = { kind: "short"; value: number } | { kind: "ptr"; value: Ptr | null };

/** Overlay et offset de la rustine des crédits de fin (`script.cpp:601`). */
export const CREDITS_PATCH = { overlay: "FIN01", offset: 1884, stackDepth: 1, value: 50 } as const;

export class Vm {
  readonly stack: StackEntry[] = Array.from({ length: STACK_SIZE }, () => ({ kind: "short", value: 0 }) as StackEntry);
  positionInStack = 0;
  /** Index posé par STORE sous-type 4 (`saveOpcodeVar`), lu par les sous-types 5. */
  saveOpcodeVar = 0;
  /** Valeur de retour du dernier opcode exécuté (`Bench::lastRet`, trace `SS`). */
  lastRet = 0;
  private code: Uint8Array = new Uint8Array(0);
  private spaces: (Ptr | null)[] = [];
  private subType = 0;

  constructor(private readonly e: EngineState) {}

  resetStack(): void {
    this.positionInStack = 0;
  }

  pushVar(value: number): void {
    if (this.positionInStack < STACK_SIZE) this.stack[this.positionInStack++] = { kind: "short", value: int16(value) };
  }

  popVar(): number {
    if (this.positionInStack <= 0) return 0;
    const entry = this.stack[--this.positionInStack]!;
    if (entry.kind !== "short") throw new Error("popVar : pointeur sur la pile");
    return entry.value;
  }

  pushPtr(ptr: Ptr | null): void {
    if (this.positionInStack < STACK_SIZE) this.stack[this.positionInStack++] = { kind: "ptr", value: ptr };
  }

  popPtr(): Ptr | null {
    if (this.positionInStack <= 0) return null;
    const entry = this.stack[--this.positionInStack]!;
    if (entry.kind !== "ptr") throw new Error("popPtr : entier sur la pile");
    return entry.value;
  }

  private get script(): ScriptInstance {
    return this.e.currentScript!;
  }

  /** Octet signé (`int8`) à l'IP. */
  private byte(): number {
    const v = (readU8(this.code, this.script.scriptOffset) << 24) >> 24;
    this.script.scriptOffset++;
    return v;
  }

  private short(): number {
    const v = readI16(this.code, this.script.scriptOffset);
    this.script.scriptOffset += 2;
    return v;
  }

  private space(index: number): Ptr {
    const p = this.spaces[index];
    if (!p) throw new Error(`Espace mémoire ${index} absent (${this.describe()})`);
    return p;
  }

  private describe(): string {
    const s = this.e.currentScript;
    if (!s) return "hors script";
    return `${this.e.overlays.entries[s.overlayNumber]?.name}/${s.scriptNumber} ip=${s.scriptOffset}`;
  }

  /**
   * Adresse d'une variable d'un autre overlay (`ovl != 0`) : seul son BSS (espace 5) est accessible. Renvoie un code d'erreur
   * (−7, −4) ou le bloc.
   */
  private foreignBss(ovl: number, space: number): Ptr | number {
    const entry = this.e.overlays.entries[ovl];
    if (!entry || !entry.alreadyLoaded) return ScriptError.notLoaded;
    if (!entry.data) return ScriptError.noData;
    if (space !== 5) throw new Error(`Accès à l'espace ${space} de l'overlay ${ovl} (${this.describe()})`);
    return { block: entry.data.bss, offset: 0 };
  }

  /** LOAD (`opcodeType0`). */
  private op0(): number {
    const sub = this.subType;
    if (sub === 0) {
      this.pushVar(this.short());
      return 0;
    }
    if (sub === 1 || sub === 5) {
      const index = sub === 5 ? this.saveOpcodeVar : 0;
      const type = this.byte();
      const ovl = this.byte();
      const offset = int16(this.short() + index);
      const typ7 = type & 7;
      if (!typ7) return ScriptError.unresolved;
      let base: Ptr;
      if (!ovl) base = this.space(typ7);
      else {
        const r = this.foreignBss(ovl, typ7);
        if (typeof r === "number") return r;
        base = r;
      }
      const size = (type >> 3) & 3;
      const at = base.offset + offset;
      if (size === 1) {
        this.pushVar(readI16(base.block, at + index));
        return 0;
      }
      if (size === 2) {
        this.pushVar(readU8(base.block, at));
        return 0;
      }
      throw new Error(`opcodeType0 : taille ${size} non gérée (${this.describe()})`);
    }
    if (sub === 2) {
      const mode = this.byte();
      let ovl = this.byte();
      const obj = this.short();
      if (!ovl) ovl = this.script.overlayNumber;
      const value = getSingleObjectParam(this.e, ovl, obj, mode);
      if (value === null) return ScriptError.unresolved;
      this.pushVar(value);
      return 0;
    }
    throw new Error(`opcodeType0 : sous-type ${sub} non géré (${this.describe()})`);
  }

  /** STORE (`opcodeType1`). */
  private op1(): number {
    const value = this.popVar();
    const sub = this.subType;
    if (sub === 0) return 0; // « strange, but happens also in original interpreter »
    if (sub === 1 || sub === 5) {
      const offset = sub === 5 ? this.saveOpcodeVar : 0;
      const byte1 = this.byte();
      const byte2 = this.byte();
      const short1 = this.short();
      const space = byte1 & 7;
      if (!space) return ScriptError.unresolved;
      let base: Ptr;
      if (byte2) {
        const r = this.foreignBss(byte2, space);
        if (typeof r === "number") return r;
        base = r;
      } else base = this.space(space);
      const at = base.offset + short1;
      const type2 = (byte1 & 0x18) >> 3;
      if (type2 === 1) {
        writeI16(base.block, at + offset * 2, value);
        return 0;
      }
      if (type2 === 2) {
        writeU8(base.block, at + offset, value);
        return 0;
      }
      throw new Error(`opcodeType1 : taille ${type2} non gérée (${this.describe()})`);
    }
    if (sub === 2) {
      const mode = this.byte();
      let di = this.byte();
      const obj = this.short();
      if (!di) di = this.script.overlayNumber;
      let v = value;
      // Rustine « bar » de ScummVM : condition reprise telle quelle, jamais vraie (`di` vient d'être remplacé).
      if (v === 0x85 && this.e.currentCtpName === "S26.CTP" && !di && mode === 1) v = 0x87;
      setObjectPosition(this.e, di, obj, mode, v);
      return 0;
    }
    if (sub === 4) {
      this.saveOpcodeVar = value;
      return 0;
    }
    throw new Error(`opcodeType1 : sous-type ${sub} non géré (${this.describe()})`);
  }

  /** PUSH ADDRESS (`opcodeType2`). */
  private op2(): number {
    const sub = this.subType;
    if (sub !== 1 && sub !== 5) return 0;
    const index = sub === 5 ? this.saveOpcodeVar : 0;
    const type = this.byte();
    const ovl = this.byte();
    const offset = int16(this.short() + index);
    const typ7 = type & 7;
    if (!typ7) return ScriptError.unresolved;
    if (ovl) {
      const entry = this.e.overlays.entries[ovl];
      if (!entry || !entry.alreadyLoaded) return ScriptError.notLoaded;
      if (!entry.data) return ScriptError.noData;
      throw new Error(`opcodeType2 : adresse dans un autre overlay (${this.describe()})`);
    }
    const base = this.space(typ7);
    const size = (type >> 3) & 3;
    if (size === 1) this.pushPtr({ block: base.block, offset: base.offset + offset + index });
    else if (size === 2) this.pushPtr({ block: base.block, offset: base.offset + offset });
    return 0;
  }

  /** Arithmétique (`opcodeType3`). */
  private op3(): number {
    const pop1 = this.popVar();
    const pop2 = this.popVar();
    switch (this.subType) {
      case 0:
        this.pushVar(pop1 + pop2);
        break;
      case 1:
        if (pop2 === 0) throw new Error(`opcodeType3 : division par 0 (${this.describe()})`);
        this.pushVar(Math.trunc(pop1 / pop2));
        break;
      case 2:
        this.pushVar(pop1 - pop2);
        break;
      case 3:
        this.pushVar(Math.imul(pop1, pop2));
        break;
      case 4:
        if (pop2 === 0) throw new Error(`opcodeType3 : modulo par 0 (${this.describe()})`);
        this.pushVar(pop1 % pop2);
        break;
      case 5:
      case 7:
        this.pushVar(pop2 | pop1);
        break;
      case 6:
        this.pushVar(pop2 & pop1);
        break;
      default:
        break;
    }
    return 0;
  }

  /** Comparaison (`opcodeType4`) : `var2 OP var1`. */
  private op4(): number {
    const var1 = this.popVar();
    const var2 = this.popVar();
    let r = false;
    switch (this.subType) {
      case 0:
        r = var2 !== var1;
        break;
      case 1:
        r = var2 === var1;
        break;
      case 2:
        r = var2 < var1;
        break;
      case 3:
        r = var2 <= var1;
        break;
      case 4:
        r = var2 > var1;
        break;
      case 5:
        r = var2 >= var1;
        break;
      default:
        break;
    }
    this.pushVar(r ? 1 : 0);
    return 0;
  }

  /** Saut relatif conditionnel (`opcodeType5`), compté depuis l'adresse de l'opérande. */
  private op5(): number {
    const s = this.script;
    const origin = s.scriptOffset;
    const target = this.short() + origin;
    const ccr = s.ccr;
    const masks = [-1, 1, 2, 3, 4, 5];
    const sub = this.subType;
    let jump: boolean;
    if (sub === 0) jump = !(ccr & 1);
    else if (sub >= 1 && sub <= 5) jump = (ccr & masks[sub]!) !== 0;
    else jump = sub === 7;
    if (jump) s.scriptOffset = target;
    return 0;
  }

  /** Registre de condition (`opcodeType6`) : 1 nul, 2 positif, 4 négatif. */
  private op6(): number {
    const v = this.popVar();
    let ccr = 0;
    if (!v) ccr = 1;
    if (v < 0) ccr |= 4;
    if (v > 0) ccr |= 2;
    this.script.ccr = ccr;
    return 0;
  }

  /** Échange (`opcodeType7`). */
  private op7(): number {
    const var1 = this.popVar();
    const var2 = this.popVar();
    this.pushVar(var1);
    this.pushVar(var2);
    return 0;
  }

  /** Appel natif (`opcodeType8`). */
  private op8(): number {
    const opcode = this.byte();
    if (!opcode) return ScriptError.badNative;
    const native = opcode > 0 ? NATIVES[opcode] : undefined;
    if (!native) {
      this.e.warn(`Unsupported opcode ${opcode} in opcode type 8`);
      this.pushVar(0);
      return 0;
    }
    const trace = this.e.trace;
    const before = this.positionInStack;
    const strings = trace?.nativeBegin ? trace.nativeBegin(opcode, this.stack, before) : null;
    const result = int16(native.impl(this.e));
    trace?.nativeEnd?.(opcode, this.stack, before, this.positionInStack, result, strings);
    this.pushVar(result);
    return 0;
  }

  private op9(): number {
    this.script.scriptNumber = -1;
    return 1;
  }

  /**
   * `executeScripts` : exécute la tranche d'un processus jusqu'à un opcode qui rend autre chose que 0. Renvoie 0, ou −6 / −4 / −7
   * si le script ne peut pas tourner.
   */
  executeScripts(ptr: ScriptInstance): number {
    let block;
    if (ptr.type === ScriptType.PROC) block = this.e.overlays.proc(ptr.overlayNumber, ptr.scriptNumber);
    else if (ptr.type === ScriptType.REL) block = this.e.overlays.rel(ptr.overlayNumber, ptr.scriptNumber);
    else return ScriptError.badType;
    if (!block) return ScriptError.noData;
    const entry = this.e.overlays.entries[ptr.overlayNumber]!;
    if (!entry.alreadyLoaded) return ScriptError.notLoaded;
    const ovl = entry.data;
    if (!ovl) return ScriptError.noData;

    this.code = block.data;
    this.spaces = [];
    this.spaces[1] = ptr.data ? { block: ptr.data, offset: 0 } : null;
    this.spaces[2] = { block: block.data, offset: block.offsetToSubData3 };
    this.spaces[5] = ovl.bss.length ? { block: ovl.bss, offset: 0 } : null;
    this.spaces[6] = ovl.initData.length ? { block: ovl.initData, offset: 0 } : null;
    this.e.currentScript = ptr;
    this.positionInStack = 0;

    const creditsOverlay = entry.name === CREDITS_PATCH.overlay;
    for (;;) {
      if (creditsOverlay && ptr.scriptOffset === CREDITS_PATCH.offset && this.positionInStack === CREDITS_PATCH.stackDepth) {
        this.popVar();
        this.pushVar(CREDITS_PATCH.value);
      }
      this.e.trace?.opcode?.(ptr, readU8(this.code, ptr.scriptOffset));
      const opcode = readU8(this.code, ptr.scriptOffset);
      ptr.scriptOffset++;
      this.subType = opcode & 7;
      const ret = this.dispatch((opcode & 0xfb) >> 3);
      this.lastRet = ret;
      if (ret !== 0) break;
    }
    this.e.currentScript = null;
    return 0;
  }

  private dispatch(type: number): number {
    switch (type) {
      case 1:
        return this.op0();
      case 2:
        return this.op1();
      case 3:
        return this.op2();
      case 4:
        return this.op3();
      case 5:
        return this.op4();
      case 6:
        return this.op5();
      case 7:
        return this.op6();
      case 8:
        return this.op7();
      case 9:
        return this.op8();
      case 10:
        return this.op9();
      case 11:
        return 0;
      case 12:
        return 1;
      default:
        throw new Error(`Type d'opcode ${type} non géré (${this.describe()})`);
    }
  }

  /**
   * `manageScripts` : parcourt la liste du début à la fin ; un processus ajouté pendant le parcours (en queue) tourne dans la même
   * passe s'il a `sysKey != 0`. Les overlays gelés (`executeScripts != 0`) sont sautés.
   */
  manageScripts(list: ScriptInstance[], which: "P" | "R"): void {
    for (let i = 0; i < list.length; i++) {
      const ptr = list[i]!;
      if (this.e.overlays.entries[ptr.overlayNumber]?.executeScripts) continue;
      if (ptr.scriptNumber !== -1 && ptr.freeze === 0 && ptr.sysKey !== 0) {
        const ovl = ptr.overlayNumber;
        const scr = ptr.scriptNumber;
        const ip0 = ptr.scriptOffset;
        const rc = this.executeScripts(ptr);
        this.e.trace?.scriptSlice?.(which, ptr, ovl, scr, ip0, this.lastRet, rc, this.e);
      }
      if (ptr.sysKey === 0) ptr.sysKey = 1;
    }
  }
}
