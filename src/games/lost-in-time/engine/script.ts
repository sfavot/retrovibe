import type { TotHeader } from "../data/tot";
import { bytesToString, type Variables } from "./variables";

/** Erreur de lecture ou de décodage du script, avec le nom du TOT et le décalage. */
export class ScriptError extends Error {
  constructor(
    readonly tot: string,
    readonly offset: number,
    message: string,
  ) {
    super(`${tot} @${offset} : ${message}`);
    this.name = "ScriptError";
  }
}

interface CallEntry {
  pos: number;
  finished: boolean;
}

/**
 * Octets du script d'un TOT (en-tête de 128 octets compris : les offsets du script s'y rapportent)
 * avec la position courante, l'indicateur « terminé » et la pile d'appels.
 */
const EMPTY_HEADER: TotHeader = {
  version: "0.0",
  variablesCount: 0,
  textsOffset: 0xffffffff,
  resourcesOffset: 0xffffffff,
  animDataSize: 0,
  imFileNumber: 0,
  exFileNumber: 0,
  communHandling: 0,
  functions: [],
  scriptEnd: 0,
  textsSize: 0,
  resourcesSize: 0,
};

export class Script {
  pos = 0;
  /** Vrai tant que le script n'est pas chargé ou quand il a fini de s'exécuter. */
  finished = true;
  /** Cache du décodage des instructions, par offset (le script est immuable une fois chargé). */
  decoded = new Map<number, unknown>();
  private readonly stack: CallEntry[] = [];
  private view: DataView;
  /** Vrai une fois un TOT chargé ; sans cela push / pop / call ne font rien. */
  loaded = false;

  constructor(
    public name = "",
    public data: Uint8Array = new Uint8Array(0),
    public header: TotHeader = EMPTY_HEADER,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.loaded = data.length > 0;
    this.finished = !this.loaded;
  }

  /** Charge un TOT (en place, comme le Script de ScummVM). */
  load(name: string, data: Uint8Array, header: TotHeader): void {
    this.unload();
    this.name = name;
    this.data = data;
    this.header = header;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.decoded = new Map();
    this.loaded = true;
    this.finished = false;
    this.pos = 0;
  }

  unload(): void {
    this.stack.length = 0;
    this.data = new Uint8Array(0);
    this.view = new DataView(this.data.buffer);
    this.decoded = new Map();
    this.loaded = false;
    this.finished = true;
    this.pos = 0;
  }

  get size(): number {
    return this.data.length;
  }

  get animDataSize(): number {
    return this.header.animDataSize;
  }

  get versionMinor(): number {
    return Number(this.header.version.charAt(2)) || 0;
  }

  get variablesCount(): number {
    return this.header.variablesCount;
  }

  /** Offset d'une des 14 fonctions d'entrée (0 = début, 13 = centrage du texte). */
  functionOffset(index: number): number {
    return this.header.functions[index] ?? 0;
  }

  fail(message: string, offset = this.pos): never {
    throw new ScriptError(this.name, offset, message);
  }

  private need(count: number): void {
    if (this.pos < 0 || this.pos + count > this.data.length) {
      this.fail(`lecture de ${count} octet(s) hors du script (taille ${this.data.length})`);
    }
  }

  readU8(): number {
    this.need(1);
    return this.data[this.pos++];
  }

  readI8(): number {
    this.need(1);
    return (this.data[this.pos++] << 24) >> 24;
  }

  readU16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readI16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readI32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Octets bruts (vue sur le script) ; avance de `length` octets. */
  readBytes(length: number): Uint8Array {
    this.need(length);
    const v = this.data.subarray(this.pos, this.pos + length);
    this.pos += length;
    return v;
  }

  /** Chaîne terminée par un zéro (zéro consommé, non retourné). */
  readCString(): Uint8Array {
    let end = this.pos;
    while (end < this.data.length && this.data[end] !== 0) end++;
    if (end >= this.data.length) this.fail("chaîne non terminée");
    const v = this.data.subarray(this.pos, end);
    this.pos = end + 1;
    return v;
  }

  /** Comme ScummVM : 0 pour tout octet situé hors du script. */
  peekU8(offset = 0): number {
    const at = this.pos + offset;
    if (at < 1 || at >= this.data.length) return 0;
    return this.data[at];
  }

  peekU16(offset = 0): number {
    return this.peekU8(offset) | (this.peekU8(offset + 1) << 8);
  }

  peekI16(offset = 0): number {
    return (this.peekU16(offset) << 16) >> 16;
  }

  peekI8(offset = 0): number {
    return (this.peekU8(offset) << 24) >> 24;
  }

  peekI32(offset = 0): number {
    return this.peekU16(offset) | (this.peekU16(offset + 2) << 16);
  }

  /**
   * Se positionne à `offset`. Un saut réussi relance l'exécution (`finished` repasse à faux) ;
   * un saut dans l'en-tête termine le script. Retourne faux si le saut est refusé.
   */
  seek(offset: number): boolean {
    if (offset < 0 || offset >= this.data.length) return false;
    if (offset < 128) {
      this.finished = true;
      return false;
    }
    this.finished = false;
    this.pos = offset;
    return true;
  }

  skip(count: number): boolean {
    return this.seek(this.pos + count);
  }

  /** Saute le bloc courant : sa taille est le u16 en position +2, hors ces deux octets. */
  skipBlock(): boolean {
    return this.skip(this.peekU16(2) + 2);
  }

  push(): void {
    if (!this.loaded) return;
    this.stack.push({ pos: this.pos, finished: this.finished });
  }

  pop(restore = true): void {
    if (!this.loaded) return;
    const entry = this.stack.pop();
    if (!entry) this.fail("dépilage d'un appel sans empilage");
    if (restore) {
      this.pos = entry.pos;
      this.finished = entry.finished;
    }
  }

  call(offset: number): void {
    if (!this.loaded) return;
    this.push();
    this.seek(offset);
  }

  get callDepth(): number {
    return this.stack.length;
  }
}

// --- Expressions -----------------------------------------------------------------------------

export const OP_NEG = 1;
export const OP_ADD = 2;
export const OP_SUB = 3;
export const OP_BITOR = 4;
export const OP_MUL = 5;
export const OP_DIV = 6;
export const OP_MOD = 7;
export const OP_BITAND = 8;
export const OP_BEGIN_EXPR = 9;
export const OP_END_EXPR = 10;
export const OP_NOT = 11;
/** Fin d'un indice de tableau ou d'un indice de chaîne. */
export const OP_END_MARKER = 12;

export const OP_ARRAY_INT8 = 16;
export const OP_LOAD_VAR_INT16 = 17;
export const OP_LOAD_VAR_INT8 = 18;
export const OP_LOAD_IMM_INT32 = 19;
export const OP_LOAD_IMM_INT16 = 20;
export const OP_LOAD_IMM_INT8 = 21;
export const OP_LOAD_IMM_STR = 22;
export const OP_LOAD_VAR_INT32 = 23;
export const OP_LOAD_VAR_INT32_AS_INT16 = 24;
export const OP_LOAD_VAR_STR = 25;
export const OP_ARRAY_INT32 = 26;
export const OP_ARRAY_INT16 = 27;
export const OP_ARRAY_STR = 28;
export const OP_FUNC = 29;

export const OP_OR = 30;
export const OP_AND = 31;
export const OP_LESS = 32;
export const OP_LEQ = 33;
export const OP_GREATER = 34;
export const OP_GEQ = 35;
export const OP_EQ = 36;
export const OP_NEQ = 37;

/** Fin d'une expression complète. */
export const OP_STOP = 99;

export const FUNC_SQRT1 = 0;
export const FUNC_SQRT2 = 1;
export const FUNC_SQRT3 = 6;
export const FUNC_SQR = 5;
export const FUNC_ABS = 7;
export const FUNC_RAND = 10;

export const TYPE_IMM_INT8 = OP_LOAD_IMM_INT8;
export const TYPE_IMM_INT32 = OP_LOAD_IMM_INT32;
export const TYPE_IMM_INT16 = OP_LOAD_IMM_INT16;
export const TYPE_IMM_STR = OP_LOAD_IMM_STR;
export const TYPE_VAR_INT8 = OP_LOAD_VAR_INT8;
export const TYPE_VAR_INT16 = OP_LOAD_VAR_INT16;
export const TYPE_VAR_INT32 = OP_LOAD_VAR_INT32;
export const TYPE_VAR_STR = OP_LOAD_VAR_STR;
export const TYPE_ARRAY_INT8 = OP_ARRAY_INT8;
export const TYPE_ARRAY_INT16 = OP_ARRAY_INT16;
export const TYPE_ARRAY_INT32 = OP_ARRAY_INT32;
export const TYPE_ARRAY_STR = OP_ARRAY_STR;
export const TYPE_VAR_INT32_AS_INT16 = OP_LOAD_VAR_INT32_AS_INT16;

/** Les deux valeurs booléennes se glissent parmi les opérateurs, comme dans le jeu. */
export const GOB_TRUE = 24;
export const GOB_FALSE = 23;

const PTR_EXEC = 0;
const PTR_VAR = 1;
const PTR_RESULT = 2;

const STACK_PAD = 4;
const STACK_SIZE = 256;
const RESULT_STR_SIZE = 200;

/** Ce dont l'évaluateur d'expressions a besoin : script courant, variables, tirage aléatoire. */
export interface ExprEnv {
  readonly script: Script;
  readonly vars: Variables;
  readonly animDataSize: number;
  /** Entier dans [0, max[ ; 0 si max vaut 0. */
  random(max: number): number;
}

const i16 = (v: number): number => (v << 16) >> 16;

/**
 * Évaluateur d'expressions du script (port de expression.cpp).
 * Pile de (opérateur, valeur) ; les chaînes sont des « pointeurs » codés (type << 28 | décalage)
 * vers le script, les variables ou le tampon de résultat.
 *
 * En mode `skip`, les mêmes routines ne font que parcourir la structure (sans variables) :
 * c'est ce qu'utilise le décodage statique des instructions.
 */
export class Expression {
  resultInt = 0;
  readonly resultStr = new Uint8Array(RESULT_STR_SIZE);
  /** Valeur « pRes » de la dernière évaluation par evalExpr(). */
  evalRes = 0;
  /** Taille et type retournés par la dernière lecture d'un indice de variable. */
  varSize = 0;
  varType = 0;

  private varBase = 0;
  script!: Script;
  private env: ExprEnv | null;

  constructor(env: ExprEnv | null = null) {
    this.env = env;
    if (env) this.attach();
  }

  /** (Re)lit le script courant de l'environnement. */
  attach(): void {
    if (this.env) this.script = this.env.script;
  }

  private get vars(): Variables {
    return this.env!.vars;
  }

  // --- parcours sans évaluation ---

  skipExpr(stopToken: number): void {
    const s = this.script;
    let num = 0;
    for (;;) {
      const operation = s.readU8();

      if (operation >= 14 && operation <= OP_FUNC) {
        switch (operation) {
          case 14:
            s.skip(4);
            if (s.peekU8() === 97) s.skip(1);
            break;
          case OP_LOAD_VAR_INT16:
          case OP_LOAD_VAR_INT8:
          case OP_LOAD_IMM_INT16:
          case OP_LOAD_VAR_INT32:
          case OP_LOAD_VAR_INT32_AS_INT16:
            s.skip(2);
            break;
          case OP_LOAD_IMM_INT32:
            s.skip(4);
            break;
          case OP_LOAD_IMM_INT8:
            s.skip(1);
            break;
          case OP_LOAD_IMM_STR:
            s.readCString();
            break;
          case OP_LOAD_VAR_STR:
            s.skip(2);
            if (s.peekU8() === 13) {
              s.skip(1);
              this.skipExpr(OP_END_MARKER);
            }
            break;
          case 15:
          case OP_ARRAY_INT8:
          case OP_ARRAY_INT32:
          case OP_ARRAY_INT16:
          case OP_ARRAY_STR: {
            if (operation === 15) s.skip(2);
            const dimCount = s.peekU8(2);
            s.skip(3 + dimCount);
            for (let dim = 0; dim < dimCount; dim++) this.skipExpr(OP_END_MARKER);
            if (operation === OP_ARRAY_STR && s.peekU8() === 13) {
              s.skip(1);
              this.skipExpr(OP_END_MARKER);
            }
            break;
          }
          case OP_FUNC:
            s.skip(1);
            this.skipExpr(OP_END_EXPR);
            break;
          default:
            break;
        }
        continue;
      }

      if (operation === OP_BEGIN_EXPR) {
        num++;
        continue;
      }
      if (operation === OP_NOT || (operation >= OP_NEG && operation <= 8)) continue;
      if (operation >= OP_OR && operation <= OP_NEQ) continue;
      if (operation === OP_END_EXPR) num--;
      if (operation !== stopToken) continue;
      if (stopToken !== OP_END_EXPR || num < 0) return;
    }
  }

  // --- indices de variables ---

  /**
   * Préfixes de décalage (opérations 14 et 15). Retourne vrai si l'indice est complet
   * (`mindStop`) ; le décalage cumulé est dans `varBase`.
   */
  private getVarBase(mindStop: boolean, skip: boolean): boolean {
    const s = this.script;
    this.varBase = 0;
    let operation = s.peekU8();
    while (operation === 14 || operation === 15) {
      s.skip(1);
      if (operation === 14) {
        this.varBase += s.readI16() * 4;
        this.varSize = s.peekU16();
        this.varType = 14;
        s.skip(2);
        if (s.peekU8() !== 97) {
          if (mindStop) return true;
        } else {
          s.skip(1);
        }
      } else {
        this.varBase += s.readI16() * 4;
        const offset1 = s.readU16();
        this.varSize = offset1;
        this.varType = 15;
        const dimCount = s.readU8();
        const dimStart = s.pos;
        s.skip(dimCount);
        let offset2 = 0;
        for (let i = 0; i < dimCount; i++) {
          const dimSize = s.data[dimStart + i];
          let dim = 0;
          if (skip) this.skipExpr(OP_END_MARKER);
          else dim = Math.min(Math.max(this.parseValExpr(OP_END_MARKER), 0), dimSize - 1);
          offset2 = (offset2 * dimSize + dim) & 0xffff;
        }
        this.varBase += offset2 * offset1 * 4;
        if (s.peekU8() !== 97) {
          if (mindStop) return true;
        } else {
          s.skip(1);
        }
      }
      operation = s.peekU8();
    }
    return false;
  }

  /**
   * Décalage (en octets, sur 16 bits) de la variable désignée par l'indice courant ;
   * `varType` reçoit l'opération (type de la variable), `varSize` la taille d'élément.
   */
  parseVarIndex(skip = false): number {
    const s = this.script;
    if (this.getVarBase(true, skip)) return this.varBase & 0xffff;
    const varBase = this.varBase;

    const operation = s.readU8();
    this.varSize = 0;
    this.varType = operation;

    switch (operation) {
      case OP_ARRAY_INT8:
      case OP_ARRAY_INT32:
      case OP_ARRAY_INT16:
      case OP_ARRAY_STR: {
        let temp = s.readI16();
        const dimCount = s.readU8();
        const dimStart = s.pos;
        s.skip(dimCount);
        let offset = 0;
        for (let dim = 0; dim < dimCount; dim++) {
          const dimSize = s.data[dimStart + dim];
          let temp2 = 0;
          if (skip) this.skipExpr(OP_END_MARKER);
          else temp2 = Math.min(Math.max(this.parseValExpr(OP_END_MARKER), 0), dimSize - 1);
          offset = i16(dimSize * offset + temp2);
        }
        if (operation === OP_ARRAY_INT8) return (varBase + temp + offset) & 0xffff;
        if (operation === OP_ARRAY_INT32) return (varBase + (temp + offset) * 4) & 0xffff;
        if (operation === OP_ARRAY_INT16) return (varBase + (temp + offset) * 2) & 0xffff;
        temp = i16(temp * 4);
        offset = i16(offset * 4);
        if (s.peekU8() === 13) {
          s.skip(1);
          if (skip) this.skipExpr(OP_END_MARKER);
          else temp = i16(temp + this.parseValExpr(OP_END_MARKER));
        }
        const animDataSize = skip ? 0 : this.env!.animDataSize;
        return (varBase + offset * animDataSize + temp) & 0xffff;
      }
      case OP_LOAD_VAR_INT16:
        return (varBase + s.readU16() * 2) & 0xffff;
      case OP_LOAD_VAR_INT8:
        return (varBase + s.readU16()) & 0xffff;
      case OP_LOAD_VAR_INT32:
      case OP_LOAD_VAR_INT32_AS_INT16:
      case OP_LOAD_VAR_STR: {
        let temp = (s.readU16() * 4) & 0xffff;
        if (operation === OP_LOAD_VAR_STR && s.peekU8() === 13) {
          s.skip(1);
          if (skip) this.skipExpr(OP_END_MARKER);
          else temp = i16(temp + this.parseValExpr(OP_END_MARKER));
        }
        return (varBase + temp) & 0xffff;
      }
      default:
        return 0;
    }
  }

  // --- chaînes ---

  private decodePtr(n: number): { buf: Uint8Array; off: number } {
    const off = n & 0x0fffffff;
    switch (n >>> 28) {
      case PTR_EXEC:
        return { buf: this.script.data, off };
      case PTR_VAR:
        return { buf: this.vars.bytes, off };
      case PTR_RESULT:
        return { buf: this.resultStr, off };
      default:
        return this.script.fail("pointeur d'expression inconnu");
    }
  }

  private isResultStr(n: number): boolean {
    return n >>> 28 === PTR_RESULT && (n & 0x0fffffff) === 0;
  }

  /** Octets de la chaîne désignée, sans le zéro final. */
  private cstr(n: number): Uint8Array {
    const { buf, off } = this.decodePtr(n);
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.subarray(off, end);
  }

  private resultStrLength(): number {
    let n = 0;
    while (n < RESULT_STR_SIZE && this.resultStr[n] !== 0) n++;
    return n;
  }

  /** strlcpy(resultStr, src, 200) */
  private setResultStr(src: Uint8Array): void {
    const copy = Math.min(src.length, RESULT_STR_SIZE - 1);
    // `src` peut être une vue sur resultStr elle-même : on copie via un tampon.
    const tmp = src.slice(0, copy);
    this.resultStr.set(tmp, 0);
    this.resultStr[copy] = 0;
  }

  /** strlcat(resultStr, src, 200) */
  private appendResultStr(src: Uint8Array): void {
    const len = this.resultStrLength();
    const copy = Math.max(0, Math.min(src.length, RESULT_STR_SIZE - 1 - len));
    const tmp = src.slice(0, copy);
    this.resultStr.set(tmp, len);
    this.resultStr[len + copy] = 0;
  }

  private encodeResultStr(): number {
    return (PTR_RESULT << 28) | 0;
  }

  getResultStr(): Uint8Array {
    return this.resultStr.subarray(0, this.resultStrLength());
  }

  getResultString(): string {
    return bytesToString(this.getResultStr());
  }

  // --- évaluation ---

  /** Évalue une expression et retourne sa valeur sur 16 bits signés (readValExpr). */
  parseValExpr(stopToken = OP_STOP): number {
    this.parseExpr(stopToken, false);
    return i16(this.resultInt);
  }

  private loadValue(
    operation: number,
    varBase: number,
    opers: Uint8Array,
    values: Int32Array,
    at: number,
  ): void {
    const s = this.script;
    const vars = this.vars;
    switch (operation) {
      case OP_ARRAY_INT8:
      case OP_ARRAY_INT32:
      case OP_ARRAY_INT16:
      case OP_ARRAY_STR: {
        opers[at] = operation === OP_ARRAY_STR ? OP_LOAD_IMM_STR : OP_LOAD_IMM_INT16;
        const temp = s.readI16() & 0xffff;
        const dimCount = s.readU8();
        const dimStart = s.pos;
        s.skip(dimCount);
        let offset = 0;
        for (let dim = 0; dim < dimCount; dim++) {
          const dimSize = s.data[dimStart + dim];
          const temp2 = Math.min(Math.max(this.parseValExpr(OP_END_MARKER), 0), dimSize - 1);
          offset = i16(offset * dimSize + temp2);
        }
        if (operation === OP_ARRAY_INT8) {
          values[at] = (vars.readOff8(varBase + temp + offset) << 24) >> 24;
        } else if (operation === OP_ARRAY_INT32) {
          values[at] = vars.readOff32(varBase + temp * 4 + offset * 4) | 0;
        } else if (operation === OP_ARRAY_INT16) {
          values[at] = i16(vars.readOff16(varBase + temp * 2 + offset * 2));
        } else {
          const animDataSize = this.env!.animDataSize;
          values[at] = (PTR_VAR << 28) | (varBase + temp * 4 + offset * animDataSize * 4);
          if (s.peekU8() === 13) {
            s.skip(1);
            const temp3 = this.parseValExpr(OP_END_MARKER);
            opers[at] = OP_LOAD_IMM_INT16;
            values[at] = vars.readOff8(varBase + temp * 4 + offset * 4 * animDataSize + temp3);
          }
        }
        break;
      }
      case OP_LOAD_VAR_INT16:
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = i16(vars.readOff16(varBase + s.readU16() * 2));
        break;
      case OP_LOAD_VAR_INT8:
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = (vars.readOff8(varBase + s.readU16()) << 24) >> 24;
        break;
      case OP_LOAD_IMM_INT32:
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = s.readI32();
        break;
      case OP_LOAD_IMM_INT16:
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = s.readI16();
        break;
      case OP_LOAD_IMM_INT8:
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = s.readI8();
        break;
      case OP_LOAD_IMM_STR: {
        opers[at] = OP_LOAD_IMM_STR;
        const start = s.pos;
        s.readCString();
        values[at] = (PTR_EXEC << 28) | start;
        break;
      }
      case OP_LOAD_VAR_INT32:
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = vars.readOff32(varBase + s.readU16() * 4) | 0;
        break;
      case OP_LOAD_VAR_INT32_AS_INT16:
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = i16(vars.readOff16(varBase + s.readU16() * 4));
        break;
      case OP_LOAD_VAR_STR: {
        opers[at] = OP_LOAD_IMM_STR;
        let temp = (s.readU16() * 4) & 0xffff;
        values[at] = (PTR_VAR << 28) | (varBase + temp);
        if (s.peekU8() === 13) {
          s.skip(1);
          temp = i16(temp + this.parseValExpr(OP_END_MARKER));
          opers[at] = OP_LOAD_IMM_INT16;
          values[at] = vars.readOff8(varBase + temp);
        }
        break;
      }
      case OP_FUNC: {
        const func = s.readU8();
        this.parseExpr(OP_END_EXPR, false);
        switch (func) {
          case FUNC_SQRT1:
          case FUNC_SQRT2:
          case FUNC_SQRT3: {
            let curVal = 1;
            let prevVal = 1;
            let prevPrevVal: number;
            do {
              prevPrevVal = prevVal;
              prevVal = curVal;
              curVal = curVal === 0 ? 0 : ((curVal + Math.trunc(this.resultInt / curVal)) / 2) | 0;
            } while (curVal !== prevVal && curVal !== prevPrevVal);
            this.resultInt = curVal;
            break;
          }
          case FUNC_SQR:
            this.resultInt = Math.imul(this.resultInt, this.resultInt);
            break;
          case FUNC_ABS:
            if (this.resultInt < 0) this.resultInt = -this.resultInt | 0;
            break;
          case FUNC_RAND:
            this.resultInt = this.env!.random(i16(this.resultInt));
            break;
          default:
            break;
        }
        opers[at] = OP_LOAD_IMM_INT16;
        values[at] = this.resultInt;
        break;
      }
      default:
        break;
    }
  }

  private getResult(operation: number, value: number): number {
    let type = operation;
    switch (operation) {
      case OP_NOT:
        type ^= 1;
        break;
      case OP_LOAD_IMM_INT16:
        this.resultInt = value;
        break;
      case OP_LOAD_IMM_STR:
        if (!this.isResultStr(value)) this.setResultStr(this.cstr(value));
        break;
      case OP_LOAD_VAR_INT32:
      case OP_LOAD_VAR_INT32_AS_INT16:
        break;
      default:
        this.resultInt = 0;
        type = OP_LOAD_IMM_INT16;
        break;
    }
    return type;
  }

  /**
   * Évalue jusqu'au jeton `stopToken`. Retourne le type du résultat ; l'entier est dans
   * `resultInt`, la chaîne dans `resultStr`.
   */
  parseExpr(stopToken: number, _wantType = true): number {
    const opers = new Uint8Array(STACK_SIZE);
    const values = new Int32Array(STACK_SIZE);
    const B = STACK_PAD;
    const s = this.script;
    let pos = -1;

    const cmpHelper = (): number => {
      const type = opers[B + pos - 3];
      let cmp = 0;
      if (type === OP_LOAD_IMM_INT16) {
        cmp = values[B + pos - 3] - values[B + pos - 1];
      } else if (type === OP_LOAD_IMM_STR) {
        if (!this.isResultStr(values[B + pos - 3])) {
          this.setResultStr(this.cstr(values[B + pos - 3]));
          values[B + pos - 3] = this.encodeResultStr();
        }
        cmp = compareBytes(this.getResultStr(), this.cstr(values[B + pos - 1]));
      }
      return cmp;
    };

    const simpleArithmetic1 = (): void => {
      switch (opers[B + pos - 1]) {
        case OP_ADD:
          if (opers[B + pos - 2] === OP_LOAD_IMM_STR) {
            if (!this.isResultStr(values[B + pos - 2])) {
              this.setResultStr(this.cstr(values[B + pos - 2]));
              values[B + pos - 2] = this.encodeResultStr();
            }
            this.appendResultStr(this.cstr(values[B + pos]));
            pos -= 2;
          }
          break;
        case OP_MUL:
          values[B + pos - 2] = Math.imul(values[B + pos - 2], values[B + pos]);
          pos -= 2;
          break;
        case OP_DIV:
          values[B + pos - 2] = idiv(values[B + pos - 2], values[B + pos]);
          pos -= 2;
          break;
        case OP_MOD:
          values[B + pos - 2] = imod(values[B + pos - 2], values[B + pos]);
          pos -= 2;
          break;
        case OP_BITAND:
          values[B + pos - 2] &= values[B + pos];
          pos -= 2;
          break;
        default:
          break;
      }
    };

    const simpleArithmetic2 = (): void => {
      if (pos > 1) {
        if (opers[B + pos - 2] === OP_NEG) {
          opers[B + pos - 2] = OP_LOAD_IMM_INT16;
          values[B + pos - 2] = -values[B + pos - 1] | 0;
          pos--;
        } else if (opers[B + pos - 2] === OP_NOT) {
          opers[B + pos - 2] = opers[B + pos - 1] === GOB_FALSE ? GOB_TRUE : GOB_FALSE;
          pos--;
        }
      }
      if (pos > 2) {
        switch (opers[B + pos - 2]) {
          case OP_MUL:
            values[B + pos - 3] = Math.imul(values[B + pos - 3], values[B + pos - 1]);
            pos -= 2;
            break;
          case OP_DIV:
            values[B + pos - 3] = idiv(values[B + pos - 3], values[B + pos - 1]);
            pos -= 2;
            break;
          case OP_MOD:
            values[B + pos - 3] = imod(values[B + pos - 3], values[B + pos - 1]);
            pos -= 2;
            break;
          case OP_BITAND:
            values[B + pos - 3] &= values[B + pos - 1];
            pos -= 2;
            break;
          default:
            break;
        }
      }
    };

    /** Retourne vrai quand aucun opérateur ne s'applique (fin de la réduction). */
    const complexArithmetic = (brackStart: number): boolean => {
      const bs = B + brackStart;
      switch (opers[B + pos - 2]) {
        case OP_ADD:
          if (opers[bs] === OP_LOAD_IMM_INT16) {
            values[bs] = (values[bs] + values[B + pos - 1]) | 0;
          } else if (opers[bs] === OP_LOAD_IMM_STR) {
            if (!this.isResultStr(values[bs])) {
              this.setResultStr(this.cstr(values[bs]));
              values[bs] = this.encodeResultStr();
            }
            this.appendResultStr(this.cstr(values[B + pos - 1]));
          }
          pos -= 2;
          break;
        case OP_SUB:
          values[bs] = (values[bs] - values[B + pos - 1]) | 0;
          pos -= 2;
          break;
        case OP_BITOR:
          values[bs] |= values[B + pos - 1];
          pos -= 2;
          break;
        case OP_MUL:
          values[B + pos - 3] = Math.imul(values[B + pos - 3], values[B + pos - 1]);
          pos -= 2;
          break;
        case OP_DIV:
          values[B + pos - 3] = idiv(values[B + pos - 3], values[B + pos - 1]);
          pos -= 2;
          break;
        case OP_MOD:
          values[B + pos - 3] = imod(values[B + pos - 3], values[B + pos - 1]);
          pos -= 2;
          break;
        case OP_BITAND:
          values[B + pos - 3] &= values[B + pos - 1];
          pos -= 2;
          break;
        case OP_OR:
          // (x OU faux) == x ; (x OU vrai) == vrai
          if (opers[B + pos - 3] === GOB_FALSE) opers[B + pos - 3] = opers[B + pos - 1];
          pos -= 2;
          break;
        case OP_AND:
          // (x ET faux) == faux ; (x ET vrai) == x
          if (opers[B + pos - 3] === GOB_TRUE) opers[B + pos - 3] = opers[B + pos - 1];
          pos -= 2;
          break;
        case OP_LESS:
          opers[B + pos - 3] = cmpHelper() < 0 ? GOB_TRUE : GOB_FALSE;
          pos -= 2;
          break;
        case OP_LEQ:
          opers[B + pos - 3] = cmpHelper() <= 0 ? GOB_TRUE : GOB_FALSE;
          pos -= 2;
          break;
        case OP_GREATER:
          opers[B + pos - 3] = cmpHelper() > 0 ? GOB_TRUE : GOB_FALSE;
          pos -= 2;
          break;
        case OP_GEQ:
          opers[B + pos - 3] = cmpHelper() >= 0 ? GOB_TRUE : GOB_FALSE;
          pos -= 2;
          break;
        case OP_EQ:
          opers[B + pos - 3] = cmpHelper() === 0 ? GOB_TRUE : GOB_FALSE;
          pos -= 2;
          break;
        case OP_NEQ:
          opers[B + pos - 3] = cmpHelper() !== 0 ? GOB_TRUE : GOB_FALSE;
          pos -= 2;
          break;
        default:
          return true;
      }
      return false;
    };

    for (;;) {
      this.getVarBase(false, false);
      const varBase = this.varBase;

      pos++;
      let operation = s.readU8();
      if (operation >= OP_ARRAY_INT8 && operation <= OP_FUNC) {
        this.loadValue(operation, varBase, opers, values, B + pos);

        if (pos > 0 && (opers[B + pos - 1] === OP_NEG || opers[B + pos - 1] === OP_NOT)) {
          pos--;
          if (opers[B + pos] === OP_NEG) {
            opers[B + pos] = OP_LOAD_IMM_INT16;
            values[B + pos] = -values[B + pos + 1] | 0;
          } else {
            opers[B + pos] = opers[B + pos + 1] === GOB_FALSE ? GOB_TRUE : GOB_FALSE;
          }
        }

        if (pos <= 0) continue;
        simpleArithmetic1();
        continue;
      }

      if (operation === stopToken || operation === OP_OR || operation === OP_AND || operation === OP_END_EXPR) {
        while (pos >= 2) {
          if (opers[B + pos - 2] === OP_BEGIN_EXPR && (operation === OP_END_EXPR || operation === stopToken)) {
            opers[B + pos - 2] = opers[B + pos - 1];
            if (opers[B + pos - 2] === OP_LOAD_IMM_INT16 || opers[B + pos - 2] === OP_LOAD_IMM_STR) {
              values[B + pos - 2] = values[B + pos - 1];
            }
            pos--;
            simpleArithmetic2();
            if (operation !== stopToken) break;
          }

          let brackStart = pos - 2;
          while (brackStart > 0 && opers[B + brackStart] < OP_OR && opers[B + brackStart] !== OP_BEGIN_EXPR) brackStart--;
          if (opers[B + brackStart] >= OP_OR || opers[B + brackStart] === OP_BEGIN_EXPR) brackStart++;

          if (complexArithmetic(brackStart)) break;
        }

        if (operation === OP_OR || operation === OP_AND) {
          if (opers[B + pos - 1] === OP_LOAD_IMM_INT16) {
            opers[B + pos - 1] = values[B + pos - 1] !== 0 ? GOB_TRUE : GOB_FALSE;
          }

          if (
            (operation === OP_OR && opers[B + pos - 1] === GOB_TRUE) ||
            (operation === OP_AND && opers[B + pos - 1] === GOB_FALSE)
          ) {
            if (pos > 1 && opers[B + pos - 2] === OP_BEGIN_EXPR) {
              this.skipExpr(OP_END_EXPR);
              opers[B + pos - 2] = opers[B + pos - 1];
              pos -= 2;
            } else {
              this.skipExpr(stopToken);
            }
            operation = s.peekU8(-1);
            if (pos > 0 && opers[B + pos - 1] === OP_NOT) {
              opers[B + pos - 1] = opers[B + pos] === GOB_FALSE ? GOB_TRUE : GOB_FALSE;
              pos--;
            }
          } else {
            opers[B + pos] = operation;
          }
        } else {
          pos--;
        }

        if (operation !== stopToken) continue;

        return this.getResult(opers[B], values[B]);
      }

      if (operation < OP_NEG || operation > OP_NOT) {
        if (operation < OP_LESS || operation > OP_NEQ) continue;

        if (pos > 2) {
          if (opers[B + pos - 2] === OP_ADD) {
            if (opers[B + pos - 3] === OP_LOAD_IMM_INT16) {
              values[B + pos - 3] = (values[B + pos - 3] + values[B + pos - 1]) | 0;
            } else if (opers[B + pos - 3] === OP_LOAD_IMM_STR) {
              if (!this.isResultStr(values[B + pos - 3])) {
                this.setResultStr(this.cstr(values[B + pos - 3]));
                values[B + pos - 3] = this.encodeResultStr();
              }
              this.appendResultStr(this.cstr(values[B + pos - 1]));
            }
            pos -= 2;
          } else if (opers[B + pos - 2] === OP_SUB) {
            values[B + pos - 3] = (values[B + pos - 3] - values[B + pos - 1]) | 0;
            pos -= 2;
          } else if (opers[B + pos - 2] === OP_BITOR) {
            values[B + pos - 3] |= values[B + pos - 1];
            pos -= 2;
          }
        }
      }
      opers[B + pos] = operation;
    }
  }

  // --- évaluations de haut niveau (script.cpp) ---

  /** evalExpr : retourne le type ; `evalRes` reçoit la valeur entière (0 pour une chaîne, 1 pour vrai). */
  evalExpr(): number {
    const type = this.parseExpr(OP_STOP);
    switch (type) {
      case TYPE_IMM_INT16:
        this.evalRes = this.resultInt;
        break;
      case TYPE_IMM_STR:
      case GOB_FALSE:
        this.evalRes = 0;
        break;
      case GOB_TRUE:
        this.evalRes = 1;
        break;
      default:
        break;
    }
    return type;
  }

  evalBool(): boolean {
    const type = this.parseExpr(OP_STOP);
    return type === GOB_TRUE || (type === TYPE_IMM_INT16 && this.resultInt !== 0);
  }

  evalInt(): number {
    this.parseExpr(OP_STOP);
    return this.resultInt;
  }

  evalString(): string {
    this.parseExpr(OP_STOP);
    return this.getResultString();
  }
}

function idiv(a: number, b: number): number {
  return b === 0 ? 0 : Math.trunc(a / b) | 0;
}

function imod(a: number, b: number): number {
  return b === 0 ? 0 : (a % b) | 0;
}

/** strcmp sur des octets. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
