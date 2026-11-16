/**
 * Opcodes de la PMachine SCI2 : numéros, formats d'opérandes, bits des opcodes de variables. Table partagée par la machine
 * virtuelle (`vm.ts`) et, s'il le souhaite, par le désassembleur (`disasm.ts`). Les noms viennent du vocabulaire 998
 * (`data/vocab.ts`), pas d'ici.
 *
 * Référence : `engines/sci/engine/vm.cpp` (table `opcode_format`, `SciEngine::adjustOpcodeFormats`, `readPMachineInstruction`)
 * et `vm.h` (`enum sci_opcodes`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Codage : octet d'opcode = `numéro << 1 | bit 0`. Bit 0 levé : les opérandes « variables » tiennent sur 1 octet, sinon sur 2.
 * En SCI2 le nombre d'octets d'arguments de `call`, `callk`, `callb`, `calle`, `send`, `self` et `super` est toujours un mot,
 * comme l'offset de `lofsa` / `lofss` (absolu, dans le heap du script).
 *
 * Écart volontaire : les opcodes de débogage `file` (octet 0x7D) et `line` (0x7E) ne sont pas décodés, aucun script du CD
 * ne les contient (`formats.md` § 8) ; la machine virtuelle les refuse.
 */

/** Numéro d'opcode (octet de code >> 1). */
export const Op = {
  Bnot: 0x00,
  Add: 0x01,
  Sub: 0x02,
  Mul: 0x03,
  Div: 0x04,
  Mod: 0x05,
  Shr: 0x06,
  Shl: 0x07,
  Xor: 0x08,
  And: 0x09,
  Or: 0x0a,
  Neg: 0x0b,
  Not: 0x0c,
  Eq: 0x0d,
  Ne: 0x0e,
  Gt: 0x0f,
  Ge: 0x10,
  Lt: 0x11,
  Le: 0x12,
  Ugt: 0x13,
  Uge: 0x14,
  Ult: 0x15,
  Ule: 0x16,
  Bt: 0x17,
  Bnt: 0x18,
  Jmp: 0x19,
  Ldi: 0x1a,
  Push: 0x1b,
  Pushi: 0x1c,
  Toss: 0x1d,
  Dup: 0x1e,
  Link: 0x1f,
  Call: 0x20,
  Callk: 0x21,
  Callb: 0x22,
  Calle: 0x23,
  Ret: 0x24,
  Send: 0x25,
  Class: 0x28,
  Self: 0x2a,
  Super: 0x2b,
  Rest: 0x2c,
  Lea: 0x2d,
  SelfId: 0x2e,
  Pprev: 0x30,
  PToa: 0x31,
  ATop: 0x32,
  PTos: 0x33,
  STop: 0x34,
  IpToa: 0x35,
  DpToa: 0x36,
  IpTos: 0x37,
  DpTos: 0x38,
  Lofsa: 0x39,
  Lofss: 0x3a,
  Push0: 0x3b,
  Push1: 0x3c,
  Push2: 0x3d,
  PushSelf: 0x3e,
  /** Premier des 64 opcodes de variables (`lag` … `-spi`). */
  FirstVariable: 0x40,
} as const;

export const OPCODE_COUNT = 128;

/** Taille et signe d'un opérande. */
export const Operand = {
  /** Non signé, 1 ou 2 octets selon le bit 0 de l'opcode. */
  Variable: 1,
  /** Signé, 1 ou 2 octets selon le bit 0 de l'opcode. */
  SignedVariable: 2,
  /** Toujours 2 octets, non signé (nombre d'octets d'arguments, offset de heap). */
  Word: 3,
} as const;
export type Operand = (typeof Operand)[keyof typeof Operand];

const NONE: readonly Operand[] = [];
const VARIABLE: readonly Operand[] = [Operand.Variable];
const SIGNED: readonly Operand[] = [Operand.SignedVariable];
const WORD: readonly Operand[] = [Operand.Word];

/** Opcodes de 0x00 à 0x3F sans instruction en SCI2 (0x26, 0x27 : SCI3 ; 0x29, 0x2F : jamais attribués ; 0x3F : débogage). */
export const INVALID_OPCODES: readonly number[] = [0x26, 0x27, 0x29, 0x2f, 0x3f];

const FORMATS: (readonly Operand[])[] = [];
for (let op = 0; op < OPCODE_COUNT; op++) FORMATS.push(op >= Op.FirstVariable ? VARIABLE : NONE);
FORMATS[Op.Bt] = SIGNED;
FORMATS[Op.Bnt] = SIGNED;
FORMATS[Op.Jmp] = SIGNED;
FORMATS[Op.Ldi] = SIGNED;
FORMATS[Op.Pushi] = SIGNED;
FORMATS[Op.Link] = VARIABLE;
FORMATS[Op.Call] = [Operand.SignedVariable, Operand.Word];
FORMATS[Op.Callk] = [Operand.Variable, Operand.Word];
FORMATS[Op.Callb] = [Operand.Variable, Operand.Word];
FORMATS[Op.Calle] = [Operand.Variable, Operand.Variable, Operand.Word];
FORMATS[Op.Send] = WORD;
FORMATS[Op.Class] = VARIABLE;
FORMATS[Op.Self] = WORD;
FORMATS[Op.Super] = [Operand.Variable, Operand.Word];
FORMATS[Op.Rest] = SIGNED;
FORMATS[Op.Lea] = [Operand.SignedVariable, Operand.Variable];
for (let op = Op.PToa; op <= Op.DpTos; op++) FORMATS[op] = VARIABLE;
FORMATS[Op.Lofsa] = WORD;
FORMATS[Op.Lofss] = WORD;

/** Formats des opérandes de chaque opcode, indexés par numéro. */
export const OPERAND_FORMATS: readonly (readonly Operand[])[] = FORMATS;

/** Type de variable : bits 0 et 1 d'un opcode de variable, et du premier opérande de `lea` (après décalage d'un bit). */
export const VariableType = { Global: 0, Local: 1, Temp: 2, Param: 3 } as const;
export const VAR_TYPE_MASK = 0x03;
/** Opcode de variable : la valeur va sur la pile ou en vient (sinon : accumulateur). */
export const VAR_STACK = 0x04;
/** Opcode de variable : l'accumulateur (signé) s'ajoute à l'indice. */
export const VAR_INDEXED = 0x08;
/** Opcode de variable : opération, bits 4 et 5. */
export const VAR_OPERATION_SHIFT = 4;
export const VAR_OPERATION_MASK = 0x03;
export const VariableOperation = { Load: 0, Store: 1, Increment: 2, Decrement: 3 } as const;

/** `lea` : le premier opérande, décalé d'un bit à droite, donne le type de variable et ce bit quand l'accumulateur s'ajoute à l'indice. */
export const LEA_TYPE_SHIFT = 1;
export const LEA_INDEXED = 0x08;
