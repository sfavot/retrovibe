/**
 * Désassembleur des scripts SCI2 (`docs/gk1/formats.md` § 8 et § 15, `docs/gk1/engine.md`) : outil des sous-agents et de la
 * visionneuse, sans effet sur le jeu. Décode le code des méthodes et des procédures, nomme sélecteurs, classes, propriétés et
 * fonctions du noyau, **attribue chaque octet d'un script** (en-tête, exports, dictionnaires, code atteint, code mort) et
 * relève les appels du noyau avec leur premier argument (sous-fonction).
 *
 * Références : `engines/sci/engine/vm.cpp` (`readPMachineInstruction`, table `opcode_formats` et ses retouches SCI2),
 * `scriptdebug.cpp` (`disassemble`) et `kernel.cpp` (`sci2_default_knames`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * Rappel du codage : octet d'opcode = `numéro << 1 | bit 0` ; bit 0 levé : opérandes « variables » sur 1 octet, sinon sur 2.
 * En SCI2 le nombre d'octets d'arguments de `call`, `callk`, `callb`, `calle`, `send`, `self` et `super` est toujours sur 2 octets.
 * `lofsa` / `lofss` portent un offset absolu dans le heap du script : ce sont les seuls opérandes de code de la table de relocation.
 *
 * Écarts volontaires : ScummVM désassemble à la demande, depuis une adresse ; ici tout le script est parcouru (flot de contrôle
 * depuis les méthodes, les exports et les cibles de `call`, puis balayage des trous) pour prouver qu'il ne reste aucun octet
 * inexpliqué. Les sélecteurs des `send` sont retrouvés par une simulation de la pile (absente de ScummVM).
 *
 * Numéros d'opcodes, tailles des opérandes et noms du noyau sont ceux de la machine virtuelle (`opcodes.ts`,
 * `kernel/names.ts`) ; ce module n'y ajoute que le **sens** de chaque opérande (`OperandKind`) et les noms des sous-fonctions
 * du noyau. Les noms des opcodes viennent du vocabulaire 998. Comme la machine virtuelle, il ne décode pas les opcodes de
 * débogage `file` et `line`, absents du CD.
 */
import { NO_SUPERCLASS, ResourceType, VOCAB_CLASS_TABLE, VOCAB_OPCODE_NAMES, VOCAB_SELECTOR_NAMES } from "../data/ids";
import type { ResourceIndex } from "../data/resource-map";
import { heapString, readScript, type Script, type ScriptObject } from "../data/script";
import { readClassTable, readOpcodeNames, readSelectorNames } from "../data/vocab";
import { KERNEL_DUMMY, KERNEL_NAMES } from "./kernel/names";
import { INVALID_OPCODES, Op, Operand, OPERAND_FORMATS, VAR_INDEXED, VAR_OPERATION_MASK, VAR_OPERATION_SHIFT, VAR_STACK, VAR_TYPE_MASK, VariableOperation } from "./opcodes";

// ---------------------------------------------------------------------------------------------------------------------------------
// Opcodes
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Sens d'un opérande (sa taille et son signe sont dans `OPERAND_FORMATS`). `u` / `s` : entier sans autre sens ;
 * `argBytes` : nombre d'octets d'arguments ; `relative` : saut relatif à l'instruction suivante ; `heapOffset` : offset
 * absolu dans le heap du script (relocalisé).
 */
export type OperandKind =
  | "u"
  | "s"
  | "relative"
  | "argBytes"
  | "kernel"
  | "export"
  | "script"
  | "class"
  | "property"
  | "heapOffset"
  | "global"
  | "local"
  | "temp"
  | "param";

const VARIABLE_KINDS: readonly OperandKind[] = ["global", "local", "temp", "param"];
const NO_OPERANDS: readonly OperandKind[] = [];

/** Sens des opérandes des opcodes 0x00 à 0x3F ; même nombre d'opérandes que `OPERAND_FORMATS` (vérifié par test). */
const OPERANDS: Readonly<Record<number, readonly OperandKind[]>> = {
  [Op.Bt]: ["relative"],
  [Op.Bnt]: ["relative"],
  [Op.Jmp]: ["relative"],
  [Op.Ldi]: ["s"],
  [Op.Pushi]: ["s"],
  [Op.Link]: ["u"],
  [Op.Call]: ["relative", "argBytes"],
  [Op.Callk]: ["kernel", "argBytes"],
  [Op.Callb]: ["export", "argBytes"],
  [Op.Calle]: ["script", "export", "argBytes"],
  [Op.Send]: ["argBytes"],
  [Op.Class]: ["class"],
  [Op.Self]: ["argBytes"],
  [Op.Super]: ["class", "argBytes"],
  [Op.Rest]: ["s"],
  [Op.Lea]: ["s", "u"],
  [Op.PToa]: ["property"],
  [Op.ATop]: ["property"],
  [Op.PTos]: ["property"],
  [Op.STop]: ["property"],
  [Op.IpToa]: ["property"],
  [Op.DpToa]: ["property"],
  [Op.IpTos]: ["property"],
  [Op.DpTos]: ["property"],
  [Op.Lofsa]: ["heapOffset"],
  [Op.Lofss]: ["heapOffset"],
};

/** Sens des opérandes d'un opcode (numéro 0 à 127). */
export function operandKinds(opcode: number): readonly OperandKind[] {
  if (opcode >= Op.FirstVariable) return [VARIABLE_KINDS[opcode & VAR_TYPE_MASK]];
  return OPERANDS[opcode] ?? NO_OPERANDS;
}

export interface Instruction {
  /** Offset de l'octet d'opcode dans le script. */
  readonly offset: number;
  /** Taille en octets, opérandes compris. */
  readonly size: number;
  /** Numéro d'opcode, 0 à 127. */
  readonly opcode: number;
  /** Bit 0 de l'octet d'opcode : opérandes variables sur un octet. */
  readonly byteOperands: boolean;
  readonly kinds: readonly OperandKind[];
  readonly operands: readonly number[];
  /** Offset de chaque opérande dans le script (pour le rapprocher de la table de relocation). */
  readonly operandOffsets: readonly number[];
  /** Cible absolue d'un `bt`, `bnt`, `jmp` ou `call`. */
  readonly target: number | undefined;
}

/**
 * Décode l'instruction à `offset` ; `limit` borne le code (début de la table de relocation). `byteArgBytes` : codage
 * d'avant SCI2, où le nombre d'octets d'arguments tient sur un octet (un seul script du CD, voir `ScriptDisassembly`).
 */
export function decodeInstruction(code: Uint8Array, offset: number, limit = code.length, byteArgBytes = false): Instruction {
  if (offset >= limit) throw new Error(`GK1 : instruction hors du code (${hex(offset)})`);
  const byte = code[offset];
  const opcode = byte >> 1;
  const byteOperands = (byte & 1) !== 0;
  if (INVALID_OPCODES.includes(opcode)) throw new Error(`GK1 : opcode ${hex(opcode, 2)} invalide à ${hex(offset)}`);
  let p = offset + 1;
  const kinds = operandKinds(opcode);
  const operands: number[] = [];
  const operandOffsets: number[] = [];
  let relative: number | undefined;
  const formats = OPERAND_FORMATS[opcode];
  kinds.forEach((kind, i) => {
    const format = formats[i];
    const wide = kind === "argBytes" ? !byteArgBytes : format === Operand.Word || !byteOperands;
    if (p + (wide ? 2 : 1) > limit) throw new Error(`GK1 : instruction tronquée à ${hex(offset)}`);
    let value = wide ? code[p] | (code[p + 1] << 8) : code[p];
    if (format === Operand.SignedVariable) value = wide ? (value << 16) >> 16 : (value << 24) >> 24;
    if (kind === "relative") relative = value;
    operands.push(value);
    operandOffsets.push(p);
    p += wide ? 2 : 1;
  });
  // Les sauts sont relatifs à l'instruction suivante ; l'adresse reste sur 16 bits.
  const target = relative === undefined ? undefined : (p + relative) & 0xffff;
  return { offset, size: p - offset, opcode, byteOperands, kinds, operands, operandOffsets, target };
}

/** L'exécution ne continue pas à l'instruction suivante. */
function endsFlow(opcode: number): boolean {
  return opcode === Op.Ret || opcode === Op.Jmp;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Noms : sélecteurs, opcodes, classes, noyau
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Sous-fonctions des noyaux qui en ont (choisies par le premier argument), limitées à SCI2. Noms des tables `k…_subops` de
 * `kernel_tables.h` et des fonctions `kMessage`, `kDoSync`, `kGetTime`, `kPlatform32`, `kCreateTextBitmap` de ScummVM.
 * `Message` : SCI2 décale les sous-fonctions 3 à 8 de SCI1.1 vers 4 à 9. `ShowMovie` : forme Windows seulement (sous DOS,
 * le premier argument est le nom du fichier `SEQ`). `DoAudio` 1 : nom de SCI1.1, ScummVM ne le connaît qu'à partir de SCI2.1.
 */
export const KERNEL_SUBFUNCTIONS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  DoSound: {
    0: "MasterVolume", 1: "Mute", 2: "Restore", 3: "GetPolyphony", 4: "GetAudioCapability", 5: "Suspend", 6: "Init", 7: "Dispose",
    8: "Play", 9: "Stop", 10: "Pause", 11: "Fade", 12: "SetHold", 13: "Dummy", 14: "SetVolume", 15: "SetPriority", 16: "SetLoop",
    17: "UpdateCues", 18: "SendMidi", 19: "GlobalReverb", 20: "Update",
  },
  DoAudio: {
    0: "Init", 1: "WaitPlay", 2: "Play", 3: "Stop", 4: "Pause", 5: "Resume", 6: "Position", 7: "Rate", 8: "Volume", 9: "GetCapability",
    10: "BitDepth", 11: "Distort", 12: "Mixing", 13: "SetBufferSize",
  },
  DoSync: { 0: "Start", 1: "Next", 2: "Stop" },
  Message: { 0: "Get", 1: "Next", 2: "Size", 4: "RefNoun", 5: "RefVerb", 6: "RefCond", 7: "Push", 8: "Pop", 9: "LastMessage" },
  FileIO: {
    0: "Open", 1: "Close", 2: "ReadRaw", 3: "WriteRaw", 4: "Unlink", 5: "ReadString", 6: "WriteString", 7: "Seek", 8: "FindFirst",
    9: "FindNext", 10: "Exists", 11: "Rename", 12: "Copy",
  },
  Palette: { 1: "SetFromResource", 2: "SetFade", 3: "FindColor", 4: "SetGamma" },
  PalVary: {
    0: "SetVary", 1: "SetPercent", 2: "GetPercent", 3: "Off", 4: "MergeTarget", 5: "SetTime", 6: "PauseResume", 7: "SetTarget",
    8: "SetStart", 9: "MergeStart",
  },
  PalCycle: { 0: "SetCycle", 1: "DoCycle", 2: "Pause", 3: "On", 4: "Off" },
  RemapColors: { 0: "Off", 1: "ByRange", 2: "ByPercent", 3: "ToGray", 4: "ToPercentGray", 5: "BlockRange" },
  Array: { 0: "New", 1: "GetSize", 2: "GetElement", 3: "SetElements", 4: "Free", 5: "Fill", 6: "Copy", 8: "Duplicate", 9: "GetData" },
  String: {
    0: "New", 1: "GetSize", 2: "GetChar", 3: "SetElements", 4: "Free", 5: "Fill", 6: "Copy", 7: "Compare", 8: "Duplicate", 9: "GetData",
    10: "Length", 11: "Format", 12: "FormatAt", 13: "ToInteger", 14: "Trim", 15: "ToUpperCase", 16: "ToLowerCase",
  },
  ShowMovie: { 0: "WinOpen", 1: "WinInit", 2: "WinPlay", 6: "WinClose" },
  GetTime: { 1: "Time12Hour", 2: "Time24Hour", 3: "Date" },
  CreateTextBitmap: { 0: "Sized", 1: "FromObject" },
};

export interface ClassInfo {
  /** Numéro de classe (indice du vocabulaire 996). */
  readonly species: number;
  /** Script qui la définit, d'après le vocabulaire 996. */
  readonly script: number;
  readonly name: string;
  readonly superClass: number;
  /** Sélecteur de chaque propriété, dans l'ordre des mots de l'objet. */
  readonly propertySelectors: Uint16Array;
}

/** Tout ce qu'il faut pour nommer ce que le code désigne par un numéro. */
export interface SciNames {
  /** Vocabulaire 997. */
  readonly selectors: readonly string[];
  /** Vocabulaire 998 (128 noms). */
  readonly opcodes: readonly string[];
  /** Classes par numéro ; trou si le script de la table ne définit pas la classe. */
  readonly classes: readonly (ClassInfo | undefined)[];
  readonly kernels: readonly string[];
}

export interface SciProgram {
  readonly names: SciNames;
  /** Scripts (paires script + heap) par numéro, triés. */
  readonly scripts: ReadonlyMap<number, Script>;
}

/** Lit les vocabulaires et les 213 paires script + heap d'un index de ressources. */
export function loadProgram(resources: ResourceIndex): SciProgram {
  const scripts = new Map<number, Script>();
  for (const number of resources.numbers(ResourceType.Script)) {
    scripts.set(number, readScript(resources.get(ResourceType.Script, number), resources.get(ResourceType.Heap, number)));
  }
  const classScripts = readClassTable(resources.get(ResourceType.Vocab, VOCAB_CLASS_TABLE));
  const names: SciNames = {
    selectors: readSelectorNames(resources.get(ResourceType.Vocab, VOCAB_SELECTOR_NAMES)),
    opcodes: readOpcodeNames(resources.get(ResourceType.Vocab, VOCAB_OPCODE_NAMES)).map((o) => o.name),
    classes: buildClassTable(classScripts, scripts),
    kernels: KERNEL_NAMES,
  };
  return { names, scripts };
}

/** Classes par numéro, chacune prise dans le script que désigne le vocabulaire 996 (la classe 133 existe aussi ailleurs). */
export function buildClassTable(classScripts: readonly number[], scripts: ReadonlyMap<number, Script>): (ClassInfo | undefined)[] {
  return classScripts.map((scriptNumber, species) => {
    const object = scripts.get(scriptNumber)?.objects.find((o) => o.isClass && o.species === species);
    if (!object?.propertySelectors) return undefined;
    return { species, script: scriptNumber, name: object.name, superClass: object.superClass, propertySelectors: object.propertySelectors };
  });
}

export function selectorName(names: SciNames, selector: number): string {
  return names.selectors[selector] ?? `sel_${selector}`;
}

export function className(names: SciNames, species: number): string {
  const name = names.classes[species]?.name;
  return name ? name : `class_${species}`;
}

export function kernelName(names: SciNames, index: number): string {
  const name = names.kernels[index];
  return name === undefined ? `kernel_${index}` : name === KERNEL_DUMMY ? `${KERNEL_DUMMY}${index}` : name;
}

/** Sélecteurs des propriétés d'un objet : les siens pour une classe, ceux de sa classe pour une instance. */
export function propertySelectorsOf(names: SciNames, object: ScriptObject): Uint16Array | undefined {
  if (object.propertySelectors) return object.propertySelectors;
  return object.superClass === NO_SUPERCLASS ? undefined : names.classes[object.superClass]?.propertySelectors;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Parcours d'un script
// ---------------------------------------------------------------------------------------------------------------------------------

/** À quoi sert un octet du script. */
export const Region = {
  Unattributed: 0,
  Header: 1,
  Exports: 2,
  PropertyDict: 3,
  MethodDict: 4,
  /** Instruction atteinte depuis une méthode, un export ou un `call`. */
  Code: 5,
  /** Instruction décodée par balayage, que rien n'atteint (le `ret` final après un `return`, par exemple). */
  DeadCode: 6,
  Relocations: 7,
} as const;
export type Region = (typeof Region)[keyof typeof Region];

const SCRIPT_HEADER_SIZE = 8;

export type RoutineLabel =
  | { readonly kind: "method"; readonly object: ScriptObject; readonly selector: number }
  | { readonly kind: "export"; readonly index: number }
  | { readonly kind: "local" };

export interface Routine {
  /** Offset de la première instruction. */
  readonly offset: number;
  /** Fin (exclue) : début de la routine suivante ou d'une zone qui n'est pas du code. */
  readonly end: number;
  /** Tout ce qui désigne ce code : une méthode (parfois plusieurs), un export, une cible de `call`. */
  readonly labels: readonly RoutineLabel[];
  readonly instructions: readonly Instruction[];
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

export interface ScriptDisassembly {
  readonly script: Script;
  readonly routines: readonly Routine[];
  /** Usage de chaque octet de la ressource script. */
  readonly regions: Uint8Array;
  /** Octets que rien n'explique (vide pour les 213 scripts de GK1). */
  readonly unattributed: readonly ByteRange[];
  /** Instructions de code mort (jamais atteintes), dans l'ordre. */
  readonly deadCode: readonly Instruction[];
  /** Anomalies : instruction qui chevauche un dictionnaire, saut hors du code, relocation hors d'un `lofsa`… */
  readonly problems: readonly string[];
  /**
   * Exports qui ne sont ni un objet ni une procédure : leur offset tombe au milieu d'une instruction (un seul dans GK1,
   * l'export 25 du script 241, jamais appelé).
   */
  readonly strayExports: readonly number[];
  /**
   * Vrai si le script est compilé à l'ancienne (SCI1.1 : nombre d'octets d'arguments sur un octet, numéros de noyau
   * d'une autre table). Un seul dans GK1 : le script 952 (`sysLogger`), reste de débogage que rien ne charge.
   */
  readonly legacyEncoding: boolean;
}

/**
 * Désassemble tout le code d'un script et attribue chacun de ses octets. Le codage SCI2 est essayé d'abord ; s'il laisse
 * des anomalies et que le codage d'avant SCI2 n'en laisse aucune, c'est ce dernier qui est rendu.
 */
export function disassembleScript(script: Script): ScriptDisassembly {
  const modern = disassembleWith(script, false);
  if (modern.problems.length === 0 && modern.unattributed.length === 0) return modern;
  const legacy = disassembleWith(script, true);
  return legacy.problems.length === 0 && legacy.unattributed.length === 0 ? legacy : modern;
}

function disassembleWith(script: Script, legacyEncoding: boolean): ScriptDisassembly {
  const code = script.script;
  const { codeEnd } = script;
  const regions = new Uint8Array(code.length);
  const problems: string[] = [];
  const claim = (start: number, end: number, region: Region): void => {
    for (let i = start; i < Math.min(end, code.length); i++) {
      if (regions[i] !== Region.Unattributed && regions[i] !== region) problems.push(`octet ${hex(i)} attribué deux fois (${regions[i]} puis ${region})`);
      regions[i] = region;
    }
  };

  const exportsEnd = SCRIPT_HEADER_SIZE + 2 * script.exports.length;
  claim(0, SCRIPT_HEADER_SIZE, Region.Header);
  claim(SCRIPT_HEADER_SIZE, exportsEnd, Region.Exports);
  claim(codeEnd, code.length, Region.Relocations);
  for (const object of script.objects) {
    // Une instance réutilise le dictionnaire de propriétés de sa classe : seul celui d'une classe est dans ce script.
    if (object.isClass) claim(object.propertyDictOffset, object.propertyDictOffset + 2 * object.values.length, Region.PropertyDict);
    claim(object.methodDictOffset, object.methodDictOffset + 2 + 4 * object.methods.length, Region.MethodDict);
  }

  const labels = new Map<number, RoutineLabel[]>();
  const addLabel = (offset: number, label: RoutineLabel): void => {
    const list = labels.get(offset);
    if (list) {
      if (label.kind !== "local" || !list.some((l) => l.kind === "local")) list.push(label);
    } else labels.set(offset, [label]);
  };
  for (const object of script.objects) {
    for (const method of object.methods) addLabel(method.codeOffset, { kind: "method", object, selector: method.selector });
  }
  const methodEntries = [...labels.keys()].sort((a, b) => a - b);

  const instructions = new Map<number, Instruction>();
  const isFree = (start: number, end: number): boolean => {
    for (let i = start; i < end; i++) if (regions[i] !== Region.Unattributed) return false;
    return true;
  };
  /** Suit le flot de contrôle depuis `entry` ; les cibles de `call` deviennent des routines. */
  const follow = (entry: number, region: Region): void => {
    const pending = [entry];
    while (pending.length > 0) {
      let at = pending.pop()!;
      for (;;) {
        if (instructions.has(at)) break;
        if (at < exportsEnd || at >= codeEnd) {
          problems.push(`le flot de contrôle sort du code à ${hex(at)}`);
          break;
        }
        let instruction: Instruction;
        try {
          instruction = decodeInstruction(code, at, codeEnd, legacyEncoding);
        } catch (error) {
          problems.push((error as Error).message);
          break;
        }
        if (!isFree(at, at + instruction.size)) {
          problems.push(`l'instruction à ${hex(at)} chevauche une zone déjà attribuée`);
          break;
        }
        instructions.set(at, instruction);
        claim(at, at + instruction.size, region);
        if (instruction.target !== undefined) {
          if (instruction.opcode === Op.Call) addLabel(instruction.target, { kind: "local" });
          pending.push(instruction.target);
        }
        if (endsFlow(instruction.opcode)) break;
        at += instruction.size;
      }
    }
  };
  for (const offset of methodEntries) follow(offset, Region.Code);
  // Les exports ensuite : un export qui tombe au milieu d'une instruction déjà décodée n'est pas une procédure.
  const strayExports: number[] = [];
  script.exports.forEach((e, index) => {
    if (e.isObject || e.offset === 0) return;
    if (regions[e.offset] === Region.Code && !instructions.has(e.offset)) {
      strayExports.push(index);
      return;
    }
    addLabel(e.offset, { kind: "export", index });
    follow(e.offset, Region.Code);
  });

  // Trous entre les zones attribuées : du code que rien n'atteint. Balayage linéaire, qui doit tomber juste sur la fin du trou.
  const deadCode: Instruction[] = [];
  for (let start = exportsEnd; start < codeEnd; start++) {
    if (regions[start] !== Region.Unattributed) continue;
    let end = start;
    while (end < codeEnd && regions[end] === Region.Unattributed) end++;
    const swept: Instruction[] = [];
    let at = start;
    try {
      while (at < end) {
        const instruction = decodeInstruction(code, at, end, legacyEncoding);
        swept.push(instruction);
        at += instruction.size;
      }
    } catch {
      at = -1;
    }
    if (at === end) {
      for (const instruction of swept) {
        instructions.set(instruction.offset, instruction);
        claim(instruction.offset, instruction.offset + instruction.size, Region.DeadCode);
        deadCode.push(instruction);
      }
    }
    start = end - 1;
  }

  // Relocations du script : exports d'objets, puis opérandes de `lofsa` / `lofss`, et rien d'autre.
  const pointerOperands = new Set<number>();
  for (const instruction of instructions.values()) {
    instruction.kinds.forEach((kind, i) => {
      if (kind !== "heapOffset") return;
      if (instruction.byteOperands) problems.push(`lofsa / lofss à opérande d'un octet à ${hex(instruction.offset)}`);
      pointerOperands.add(instruction.operandOffsets[i]);
    });
  }
  const relocated = new Set(script.scriptRelocations);
  for (const offset of relocated) {
    if (offset >= SCRIPT_HEADER_SIZE && offset < exportsEnd) continue;
    if (!pointerOperands.has(offset)) problems.push(`relocation à ${hex(offset)} hors d'un opérande de lofsa / lofss`);
  }
  for (const offset of pointerOperands) {
    if (!relocated.has(offset)) problems.push(`opérande de lofsa / lofss à ${hex(offset)} absent de la table de relocation`);
  }

  const unattributed: ByteRange[] = [];
  for (let i = 0; i < code.length; i++) {
    if (regions[i] !== Region.Unattributed) continue;
    let end = i;
    while (end < code.length && regions[end] === Region.Unattributed) end++;
    unattributed.push({ start: i, end });
    i = end - 1;
  }

  // Routines : le code est découpé aux offsets étiquetés ; le code mort qui précède la première étiquette d'une zone
  // forme une routine sans étiquette.
  const ordered = [...instructions.values()].sort((a, b) => a.offset - b.offset);
  const routines: Routine[] = [];
  let current: { offset: number; labels: RoutineLabel[]; instructions: Instruction[] } | undefined;
  let previousEnd = -1;
  const flush = (): void => {
    if (current) routines.push({ ...current, end: previousEnd });
    current = undefined;
  };
  for (const instruction of ordered) {
    const own = labels.get(instruction.offset);
    if (own || !current || instruction.offset !== previousEnd) {
      flush();
      current = { offset: instruction.offset, labels: own ?? [], instructions: [] };
    }
    current.instructions.push(instruction);
    previousEnd = instruction.offset + instruction.size;
  }
  flush();

  return { script, routines, regions, unattributed, deadCode, problems, strayExports, legacyEncoding };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Simulation de la pile : sélecteurs des envois, arguments des appels
// ---------------------------------------------------------------------------------------------------------------------------------

/** Valeur empilée : la constante si l'instruction en pousse une, sinon `undefined`. */
type StackItem = number | undefined;

export interface SendPart {
  readonly selector: number;
  /** Nombre d'arguments annoncé (0 pour une lecture de propriété ou un appel sans argument). */
  readonly argc: number;
  /** Valeur de chaque argument, quand c'est une constante poussée telle quelle. */
  readonly args: readonly (number | undefined)[];
}

export interface CallSite {
  readonly instruction: Instruction;
  /**
   * Pour `send`, `self`, `super` : les messages de l'envoi, dans l'ordre, ou `undefined` si la pile n'a pas pu être suivie
   * (sélecteur calculé).
   */
  readonly sends: readonly SendPart[] | undefined;
  /** Pour `callk`, `call`, `callb`, `calle` : nombre d'arguments annoncé (hors `&rest`). */
  readonly argc: number | undefined;
  /** Pour ces appels : valeur de chaque argument, quand c'est une constante poussée telle quelle. */
  readonly args: readonly StackItem[] | undefined;
}

/** Variation de la pile et valeur poussée par un opcode de variable. */
function variableStackEffect(opcode: number): number {
  const operation = (opcode >> VAR_OPERATION_SHIFT) & VAR_OPERATION_MASK;
  const onStack = (opcode & VAR_STACK) !== 0;
  if (operation === VariableOperation.Store) return onStack || (opcode & VAR_INDEXED) !== 0 ? -1 : 0;
  return onStack ? 1 : 0;
}

/**
 * Parcourt une routine en tenant la liste des valeurs empilées, pour retrouver ce que consomme chaque appel. Le code est
 * lu dans l'ordre ; après un `ret` ou un `jmp`, l'état repris est celui du saut qui vise l'instruction suivante (les deux
 * branches d'un `if` ou d'un `switch` laissent la pile dans le même état).
 */
export function analyzeCalls(routine: Routine): Map<number, CallSite> {
  const sites = new Map<number, CallSite>();
  const atTarget = new Map<number, StackItem[]>();
  let stack: StackItem[] = [];
  let reachable = true;
  const take = (count: number): StackItem[] | undefined => {
    if (count > stack.length) {
      stack = [];
      return undefined;
    }
    return stack.splice(stack.length - count, count);
  };
  for (const instruction of routine.instructions) {
    const saved = atTarget.get(instruction.offset);
    if (!reachable) stack = saved ? [...saved] : [];
    reachable = true;
    const { opcode, operands } = instruction;
    if (opcode >= Op.FirstVariable) {
      const effect = variableStackEffect(opcode);
      if (effect > 0) stack.push(undefined);
      else if (effect < 0) take(1);
      continue;
    }
    switch (opcode) {
      case Op.Pushi:
        stack.push(operands[0] & 0xffff);
        break;
      case Op.Push0:
      case Op.Push1:
      case Op.Push2:
        stack.push(opcode - Op.Push0);
        break;
      case Op.Dup:
        stack.push(stack[stack.length - 1]);
        break;
      case Op.Push:
      case Op.Pprev:
      case Op.PTos:
      case Op.IpTos:
      case Op.DpTos:
      case Op.Lofss:
      case Op.PushSelf:
        stack.push(undefined);
        break;
      case Op.Toss:
      case Op.STop:
        take(1);
        break;
      case Op.Send:
      case Op.Self:
      case Op.Super: {
        const items = take(operands[operands.length - 1] >> 1);
        sites.set(instruction.offset, { instruction, sends: items && parseSend(items), argc: undefined, args: undefined });
        break;
      }
      case Op.Call:
      case Op.Callk:
      case Op.Callb:
      case Op.Calle: {
        const items = take((operands[operands.length - 1] >> 1) + 1);
        sites.set(instruction.offset, { instruction, sends: undefined, argc: items?.[0], args: items?.slice(1) });
        break;
      }
      case Op.Bt:
      case Op.Bnt:
      case Op.Jmp:
        if (instruction.target !== undefined && instruction.target > instruction.offset && !atTarget.has(instruction.target)) {
          atTarget.set(instruction.target, [...stack]);
        }
        break;
      default:
        // Opérateurs binaires et comparaisons (0x01 à 0x0A, 0x0D à 0x16) : l'opérande gauche est dépilé.
        if ((opcode >= 0x01 && opcode <= 0x0a) || (opcode >= 0x0d && opcode <= 0x16)) take(1);
    }
    if (endsFlow(opcode)) reachable = false;
  }
  return sites;
}

/** Découpe les mots d'un envoi : `sélecteur, argc, arguments…` répété. `undefined` si un sélecteur ou un compte est calculé. */
function parseSend(items: readonly StackItem[]): SendPart[] | undefined {
  const parts: SendPart[] = [];
  for (let i = 0; i < items.length; ) {
    const selector = items[i];
    const argc = items[i + 1];
    if (selector === undefined || argc === undefined || i + 2 + argc > items.length) return undefined;
    parts.push({ selector, argc, args: items.slice(i + 2, i + 2 + argc) });
    i += 2 + argc;
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Relevé des appels du noyau
// ---------------------------------------------------------------------------------------------------------------------------------

/** Valeur portée dans `subfunctions` quand le premier argument n'est pas une constante (ou qu'il n'y a pas d'argument). */
export const NO_CONSTANT = -1;

export interface KernelUsage {
  readonly index: number;
  readonly name: string;
  calls: number;
  /** Scripts appelants → nombre d'appels. */
  readonly scripts: Map<number, number>;
  /** Nombre d'arguments annoncé → nombre d'appels. */
  readonly argCounts: Map<number, number>;
  /** Premier argument quand c'est une constante (`NO_CONSTANT` sinon) → nombre d'appels. */
  readonly subfunctions: Map<number, number>;
}

/** Tous les `callk` du programme (méthodes, procédures, code mort compris), par fonction du noyau. */
export function surveyKernelCalls(program: SciProgram, disassemblies?: ReadonlyMap<number, ScriptDisassembly>): Map<number, KernelUsage> {
  const usage = new Map<number, KernelUsage>();
  for (const [number, script] of program.scripts) {
    const disassembly = disassemblies?.get(number) ?? disassembleScript(script);
    // Un script d'avant SCI2 numérote le noyau autrement : il fausserait le relevé.
    if (disassembly.legacyEncoding) continue;
    for (const routine of disassembly.routines) {
      const sites = analyzeCalls(routine);
      for (const instruction of routine.instructions) {
        if (instruction.opcode !== Op.Callk) continue;
        const index = instruction.operands[0];
        let entry = usage.get(index);
        if (!entry) {
          entry = { index, name: kernelName(program.names, index), calls: 0, scripts: new Map(), argCounts: new Map(), subfunctions: new Map() };
          usage.set(index, entry);
        }
        const site = sites.get(instruction.offset);
        const argc = instruction.operands[1] >> 1;
        const first = argc > 0 ? (site?.args?.[0] ?? NO_CONSTANT) : NO_CONSTANT;
        entry.calls++;
        bump(entry.scripts, number);
        bump(entry.argCounts, argc);
        bump(entry.subfunctions, first);
      }
    }
  }
  return new Map([...usage].sort((a, b) => a[0] - b[0]));
}

function bump(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------------------------------------------------------------

function hex(value: number, width = 4): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

/** Nom d'une routine : `Objet::méthode`, `export 3`, `proc_01a4` ; plusieurs étiquettes sont jointes par « = ». */
export function routineName(routine: Routine, names: SciNames): string {
  if (routine.labels.length === 0) return `mort_${routine.offset.toString(16).padStart(4, "0")}`;
  return routine.labels
    .map((label) => {
      if (label.kind === "method") return `${label.object.name || `objet_${label.object.offset}`}::${selectorName(names, label.selector)}`;
      if (label.kind === "export") return `export ${label.index}`;
      return `proc_${routine.offset.toString(16).padStart(4, "0")}`;
    })
    .join(" = ");
}

/** Objet auquel appartient une routine (pour nommer ses propriétés), s'il n'y en a qu'un. */
function ownerOf(routine: Routine): ScriptObject | undefined {
  const owners = new Set(routine.labels.flatMap((l) => (l.kind === "method" ? [l.object] : [])));
  return owners.size === 1 ? [...owners][0] : undefined;
}

function quote(text: string): string {
  const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return `"${short.replace(/[\r\n]+/g, " ")}"`;
}

/** Ce que désigne un offset de heap : un objet, ou une chaîne. */
function describeHeapOffset(script: Script, offset: number): string {
  const object = script.objects.find((o) => o.offset === offset);
  if (object) return object.name || `objet_${offset}`;
  try {
    return quote(heapString(script.heap, offset, script.heap.length));
  } catch {
    return "?";
  }
}

export interface FormatContext {
  readonly names: SciNames;
  readonly script: Script;
  /** Objet de la méthode en cours : donne le nom des propriétés lues par offset. */
  readonly owner?: ScriptObject;
  /** Résultat de `analyzeCalls` pour la routine : sélecteurs des envois, sous-fonctions du noyau. */
  readonly sites?: ReadonlyMap<number, CallSite>;
  /** Script d'avant SCI2 (`ScriptDisassembly.legacyEncoding`) : ses numéros de noyau ne sont pas ceux de `KERNEL_NAMES`. */
  readonly legacyEncoding?: boolean;
}

/** Une ligne : `01a4  pushi    12`, suivie d'un commentaire quand un numéro a un nom. */
export function formatInstruction(instruction: Instruction, context: FormatContext): string {
  const { names, script, owner } = context;
  const { opcode, operands, kinds } = instruction;
  const name = names.opcodes[opcode] ?? `op_${opcode.toString(16)}`;
  const shown: string[] = [];
  const notes: string[] = [];
  kinds.forEach((kind, i) => {
    const value = operands[i];
    switch (kind) {
      case "relative":
        shown.push(hex(instruction.target ?? 0));
        break;
      case "kernel":
        shown.push(context.legacyEncoding ? `kernel_${value}` : kernelName(names, value));
        break;
      case "class":
        shown.push(className(names, value));
        break;
      case "property": {
        const selector = owner ? propertySelectorsOf(names, owner)?.[value >> 1] : undefined;
        shown.push(selector === undefined ? `prop_${value}` : selectorName(names, selector));
        break;
      }
      case "heapOffset":
        shown.push(hex(value));
        notes.push(describeHeapOffset(script, value));
        break;
      case "global":
      case "local":
      case "temp":
      case "param":
        shown.push(`${kind}${value}`);
        break;
      case "script":
        shown.push(`script ${value}`);
        break;
      case "export":
        shown.push(`export ${value}`);
        break;
      default:
        shown.push(String(value));
    }
  });
  const site = context.sites?.get(instruction.offset);
  if (site?.sends) notes.push(site.sends.map((part) => `${selectorName(names, part.selector)}(${part.argc})`).join(" "));
  else if (site && (opcode === Op.Send || opcode === Op.Self || opcode === Op.Super)) notes.push("sélecteur calculé");
  if (site?.args && site.args.length > 0) {
    const first = site.args[0];
    const sub = opcode === Op.Callk && !context.legacyEncoding && first !== undefined ? KERNEL_SUBFUNCTIONS[names.kernels[operands[0]] ?? ""]?.[first] : undefined;
    if (sub) notes.push(sub);
    notes.push(`args : ${site.args.map((a) => (a === undefined ? "?" : String(a))).join(", ")}`);
  }
  const line = `${instruction.offset.toString(16).padStart(4, "0")}  ${name.padEnd(8)} ${shown.join(", ")}`.trimEnd();
  return notes.length > 0 ? `${line.padEnd(40)} ; ${notes.join(" ; ")}` : line;
}

/** Texte d'une routine : une ligne de titre, puis ses instructions. */
export function formatRoutine(routine: Routine, disassembly: ScriptDisassembly, names: SciNames): string {
  const { script, legacyEncoding } = disassembly;
  const context: FormatContext = { names, script, owner: ownerOf(routine), sites: analyzeCalls(routine), legacyEncoding };
  return [`${routineName(routine, names)} :`, ...routine.instructions.map((i) => `  ${formatInstruction(i, context)}`)].join("\n");
}

/** Texte de tout le code d'un script. */
export function formatScript(disassembly: ScriptDisassembly, names: SciNames): string {
  return disassembly.routines.map((routine) => formatRoutine(routine, disassembly, names)).join("\n\n");
}
