/**
 * Noyau, groupe « données » : `Array` et `String`, aiguillés par leur premier argument (sous-fonction).
 *
 * Références : `engines/sci/engine/karray.cpp` et `kstring.cpp` (`kArrayNew` … `kArrayGetData`, `kStringNew` …
 * `kStringToLowerCase`, `format`, `readPlaceholder`), `segment.h` (`SciArray`) et `kernel_tables.h` (`kArray_subops`,
 * `kString_subops`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Un tableau est typé (entiers, références, octets, chaîne) et **grandit tout seul** quand on écrit, remplit ou copie au-delà
 * de sa fin. Une chaîne est un tableau d'octets terminé par 0 ; les classes `Str` et `Array` des scripts gardent la référence
 * dans leur propriété `data`, et plusieurs sous-fonctions acceptent l'objet à la place de la référence. Une chaîne source peut
 * aussi être un texte du heap d'un script.
 *
 * Sous-fonctions : 0 `New`, 1 `Size`, 2 `At`, 3 `Put`, 4 `Free`, 5 `Fill`, 6 `Copy`, 7 `Cmp` (chaînes seulement), 8 `Dup`,
 * 9 `GetData` ; pour `String` : 10 `Len`, 11 `Format`, 12 `FormatAt`, 13 `ToInteger`, 14 `Trim`, 15 `ToUpper`, 16 `ToLower`,
 * 17 et 18 (remplacement de sous-chaînes) non portées.
 *
 * Écarts volontaires : lire une case au-delà de la fin rend 0 (ScummVM s'arrête pour un tableau, rend 0 pour une chaîne) ;
 * `Trim` au centre retire tous les blancs intérieurs sans reproduire le découpage en blocs de l'original ; les majuscules et
 * minuscules ne touchent que l'ASCII, comme la bibliothèque C d'origine ; `%c`, `%d`, `%i`, `%u`, `%x`, `%X`, `%o` et `%s`
 * sont les seuls formats (les autres sont recopiés tels quels).
 */
import { ArrayType, TRIM_CENTER, TRIM_LEFT, TRIM_RIGHT } from "../ids";
import { fromInt, formatReg, NULL_REG, type Reg, SciArray, SciError, toSint16 } from "../memory";
import { readSelector } from "../object";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
/** Dernier caractère tenu pour un blanc par `Trim`. */
const WHITESPACE_MAX = 32;

export const ArrayOp = { New: 0, Size: 1, At: 2, Put: 3, Free: 4, Fill: 5, Copy: 6, Compare: 7, Duplicate: 8, GetData: 9 } as const;
export const StringOp = { ...ArrayOp, Length: 10, Format: 11, FormatAt: 12, ToInteger: 13, Trim: 14, ToUpper: 15, ToLower: 16, Replace: 17, ReplaceExcept: 18 } as const;

/** Référence du tableau : celle qui est donnée, ou la propriété `data` si c'est un objet (`Str`, `Array`). */
function dataOf(vm: Vm, reg: Reg): Reg {
  return vm.memory.isObject(reg) ? readSelector(vm.memory, reg, vm.selectors.id("data")) : reg;
}

/** Tableau source d'une copie : un vrai tableau, ou une chaîne brute d'un script, recopiée dans un tableau provisoire. */
function sourceArray(vm: Vm, reg: Reg): SciArray {
  if (vm.memory.isArray(reg)) return vm.memory.array(reg);
  const copy = new SciArray(ArrayType.String);
  copy.setByteString(vm.memory.getString(reg));
  return copy;
}

function at(vm: Vm, argv: Uint32Array): Reg {
  const index = argv[2] & WORD_MASK;
  if (!vm.memory.isArray(argv[1])) {
    const text = vm.memory.getString(argv[1]);
    return index < text.length ? text.charCodeAt(index) : NULL_REG;
  }
  const array = vm.memory.array(argv[1]);
  return index < array.size ? array.get(index) : NULL_REG;
}

function put(vm: Vm, argv: Uint32Array): Reg {
  const array = vm.memory.array(argv[1]);
  const index = argv[2] & WORD_MASK;
  const count = argv.length - 3;
  array.resize(index + count);
  for (let i = 0; i < count; i++) array.set(index + i, argv[3 + i]);
  return argv[1];
}

function free(vm: Vm, argv: Uint32Array): Reg {
  if (argv[1] !== NULL_REG) {
    if (!vm.memory.isArray(argv[1])) vm.warn("Array / String Free d'une valeur qui n'est pas un tableau");
    vm.memory.arrays.release(argv[1]);
  }
  return vm.acc;
}

function copy(vm: Vm, argv: Uint32Array): Reg {
  const target = vm.memory.array(argv[1]);
  target.copyFrom(sourceArray(vm, argv[3]), argv[4] & WORD_MASK, argv[2] & WORD_MASK, argv[5] & WORD_MASK);
  return argv[1];
}

function duplicate(vm: Vm, argv: Uint32Array): Reg {
  return vm.memory.arrays.allocate(sourceArray(vm, argv[1]).clone());
}

/** Sous-fonctions communes à `Array` et `String` ; `undefined` si `op` n'en est pas une. */
function common(vm: Vm, op: number, argv: Uint32Array): Reg | undefined {
  switch (op) {
    case ArrayOp.Size:
      return vm.memory.array(argv[1]).size;
    case ArrayOp.At:
      return at(vm, argv);
    case ArrayOp.Put:
      return put(vm, argv);
    case ArrayOp.Free:
      return free(vm, argv);
    case ArrayOp.Fill:
      vm.memory.array(argv[1]).fill(argv[2] & WORD_MASK, argv[3] & WORD_MASK, argv[4]);
      return argv[1];
    case ArrayOp.Copy:
      return copy(vm, argv);
    case ArrayOp.Duplicate:
      return duplicate(vm, argv);
    case ArrayOp.GetData:
      return dataOf(vm, argv[1]);
    default:
      return undefined;
  }
}

function array(vm: Vm, argv: Uint32Array): Reg {
  const op = argv[0];
  if (op === ArrayOp.New) {
    const type = argv[2] as ArrayType;
    // Une chaîne a toujours la place de son 0 final.
    return vm.memory.arrays.allocate(new SciArray(type, (argv[1] & WORD_MASK) + (type === ArrayType.String ? 1 : 0)));
  }
  const result = common(vm, op, argv);
  if (result === undefined) throw new SciError(`Array : sous-fonction ${formatReg(op)} inconnue`);
  return result;
}

// --- Chaînes ---

const PLACEHOLDER = /^%([-+ 0#]*)(\d*)(?:\.(\d+))?[hjlLtz]*(.)/;

/** `printf` des scripts : chaque `%…` consomme un argument ; `%s` accepte un objet `Str` ou une référence de chaîne. */
export function formatString(vm: Vm, format: string, args: ArrayLike<Reg>): string {
  let out = "";
  let next = 0;
  for (let i = 0; i < format.length; ) {
    if (format[i] !== "%") {
      out += format[i++];
      continue;
    }
    if (format[i + 1] === "%") {
      out += "%";
      i += 2;
      continue;
    }
    const match = PLACEHOLDER.exec(format.slice(i));
    if (!match) {
      out += format.slice(i);
      break;
    }
    i += match[0].length;
    const [, flags, width, precision, type] = match;
    if (next >= args.length) throw new SciError(`format « ${format} » : argument manquant`);
    const arg = args[next++];
    let text: string;
    switch (type) {
      case "d":
      case "i":
        text = String(toSint16(arg));
        break;
      case "u":
        text = String(arg & WORD_MASK);
        break;
      case "x":
        text = (arg & WORD_MASK).toString(16);
        break;
      case "X":
        text = (arg & WORD_MASK).toString(16).toUpperCase();
        break;
      case "o":
        text = (arg & WORD_MASK).toString(8);
        break;
      case "c":
        text = String.fromCharCode(arg & 0xff);
        break;
      case "s":
        text = vm.memory.getString(dataOf(vm, arg));
        if (precision !== undefined) text = text.slice(0, Number(precision));
        break;
      default:
        text = match[0];
    }
    const isNumeric = "diuxXo".includes(type);
    if (isNumeric && precision !== undefined) {
      const negative = text.startsWith("-");
      text = (negative ? "-" : "") + text.slice(negative ? 1 : 0).padStart(Number(precision), "0");
    }
    if (isNumeric && flags.includes("+") && (type === "d" || type === "i") && !text.startsWith("-")) text = `+${text}`;
    const size = Number(width || 0);
    if (flags.includes("-")) text = text.padEnd(size, " ");
    else if (flags.includes("0") && isNumeric && precision === undefined) {
      const negative = text.startsWith("-") || text.startsWith("+");
      text = (negative ? text[0] : "") + text.slice(negative ? 1 : 0).padStart(size - (negative ? 1 : 0), "0");
    } else text = text.padStart(size, " ");
    out += text;
  }
  return out;
}

function isBlank(char: string, keep: number): boolean {
  const code = char.charCodeAt(0);
  return code <= WHITESPACE_MAX && code !== keep;
}

/** `Trim` : retire les blancs (caractères ≤ 32, sauf `keep`) à droite, à gauche ou à l'intérieur, selon `flags`. */
export function trimString(text: string, flags: number, keep: number): string {
  let start = 0;
  let end = text.length;
  if (flags & TRIM_RIGHT) while (end > 0 && isBlank(text[end - 1], keep)) end--;
  if (flags & TRIM_LEFT) while (start < end && isBlank(text[start], keep)) start++;
  let out = text.slice(start, end);
  if (flags & TRIM_CENTER) {
    const head = /^[\0-\x20]*/.exec(out)![0].length;
    const tail = out.length - /[\0-\x20]*$/.exec(out)![0].length;
    let middle = "";
    for (let i = head; i < tail; i++) if (!isBlank(out[i], keep)) middle += out[i];
    out = out.slice(0, head) + middle + out.slice(Math.max(tail, head));
  }
  return out;
}

function compare(vm: Vm, argv: Uint32Array): Reg {
  let a = vm.memory.getString(argv[1]);
  let b = vm.memory.getString(argv[2]);
  if (argv.length === 4) {
    a = a.slice(0, argv[3] & WORD_MASK);
    b = b.slice(0, argv[3] & WORD_MASK);
  }
  return fromInt(a < b ? -1 : a > b ? 1 : 0);
}

function transform(vm: Vm, reg: Reg, change: (text: string) => string): Reg {
  vm.memory.setString(reg, change(vm.memory.getString(reg)));
  return reg;
}

function string(vm: Vm, argv: Uint32Array): Reg {
  const op = argv[0];
  switch (op) {
    case StringOp.New:
      // Le second argument (un type) que passent les scripts est ignoré : une chaîne est toujours une chaîne.
      return vm.memory.arrays.allocate(new SciArray(ArrayType.String, argv[1] & WORD_MASK));
    case StringOp.Compare:
      return compare(vm, argv);
    case StringOp.Length:
      return vm.memory.getString(argv[1]).length;
    case StringOp.Format: {
      const text = formatString(vm, vm.memory.getString(dataOf(vm, argv[1])), argv.subarray(2));
      const result = new SciArray(ArrayType.String);
      result.setByteString(text);
      return vm.memory.arrays.allocate(result);
    }
    case StringOp.FormatAt: {
      const text = formatString(vm, vm.memory.getString(dataOf(vm, argv[2])), argv.subarray(3));
      vm.memory.array(dataOf(vm, argv[1])).setByteString(text);
      return argv[1];
    }
    case StringOp.ToInteger: {
      const digits = /^\s*([-+]?\d+)/.exec(vm.memory.getString(argv[1]));
      return digits ? fromInt(Number(digits[1])) : NULL_REG;
    }
    case StringOp.Trim:
      return transform(vm, argv[1], (text) => trimString(text, argv[2], argv.length > 3 ? argv[3] & 0xff : 0));
    case StringOp.ToUpper:
      return transform(vm, argv[1], (text) => text.replace(/[a-z]/g, (c) => c.toUpperCase()));
    case StringOp.ToLower:
      return transform(vm, argv[1], (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase()));
    case StringOp.Replace:
    case StringOp.ReplaceExcept:
      vm.warn(`String : sous-fonction ${op} (remplacement de sous-chaînes) non portée`);
      return argv[1];
    default: {
      const result = common(vm, op, argv);
      if (result === undefined) throw new SciError(`String : sous-fonction ${formatReg(op)} inconnue`);
      return result;
    }
  }
}

export function registerArrayKernel(kernel: Kernel): void {
  kernel.register("Array", array).register("String", string);
}
