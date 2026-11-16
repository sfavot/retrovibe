import { INFO_CLASS, NO_SUPERCLASS, OBJECT_MAGIC, ResourceType, SPECIES_INSTANCE, VOCAB_CLASS_TABLE, VOCAB_SELECTOR_NAMES } from "../../../src/games/gk1/data/ids";
import { ResourceIndex } from "../../../src/games/gk1/data/resource-map";
import { OPERAND_FORMATS, Operand } from "../../../src/games/gk1/engine/opcodes";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";

/**
 * Scripts SCI2 synthétiques pour les tests de la machine virtuelle : un petit assembleur et un éditeur de liens qui produisent
 * une paire script + heap au format de `data/script.ts`, puis un index de ressources qui les sert comme des patchs.
 */

/** Sélecteurs de l'en-tête de tout objet (`-objID-` … `-info-`). */
const HEADER_SELECTORS = [4096, 4097, 4098, 4099, 4100, 4101, 4102, 4103];

/** Sélecteurs des tests : l'indice est le numéro. `name`, `play` et `data` sont ceux que le moteur cherche par leur nom. */
export const SELECTORS = ["name", "play", "data", "x", "y", "doit", "get", "set", "sum", "cue", "kind", "twice"] as const;
export type SelectorName = (typeof SELECTORS)[number];
export function sel(name: SelectorName): number {
  return SELECTORS.indexOf(name);
}

function word(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/** Assemble une instruction ; `byteForm` : opérandes variables sur un octet (bit 0 de l'opcode). */
export function ins(op: number, operands: number[] = [], byteForm = false): number[] {
  const formats = OPERAND_FORMATS[op];
  if (formats.length !== operands.length) throw new Error(`opcode ${op.toString(16)} : ${formats.length} opérandes attendus`);
  const out = [(op << 1) | (byteForm ? 1 : 0)];
  operands.forEach((value, i) => {
    if (formats[i] === Operand.Word || !byteForm) out.push(...word(value));
    else out.push(value & 0xff);
  });
  return out;
}

/** Adresses connues au moment d'assembler le code : objets et chaînes du heap de ce script. */
export interface LinkContext {
  /** Offset dans le heap de l'objet de ce nom. */
  object(name: string): number;
  /** Offset dans le heap de cette chaîne (déclarée dans `strings` ou nom d'objet). */
  string(text: string): number;
}

export type Code = number[] | ((link: LinkContext) => number[]);

export interface ObjectSpec {
  name: string;
  /** Numéro de classe : en fait une classe. */
  species?: number;
  /** Numéro de la classe mère. */
  superClass?: number;
  /** Propriétés après `name`, dans l'ordre. Une classe les déclare ; une instance donne les valeurs de celles de sa classe. */
  properties?: [SelectorName, number][];
  /** Propriétés héritées de la classe mère (leurs sélecteurs), qu'une classe dérivée doit répéter avant les siennes. */
  inherited?: [SelectorName, number][];
  methods?: Partial<Record<SelectorName, Code>>;
}

export interface ScriptSpec {
  number: number;
  locals?: number[];
  objects?: ObjectSpec[];
  strings?: string[];
  /** Exports, dans l'ordre : nom d'un objet, ou code d'une procédure. */
  exports?: (string | Code)[];
}

export interface Built {
  script: Uint8Array;
  heap: Uint8Array;
  /** Offset dans le heap de chaque objet, par nom. */
  objects: Map<string, number>;
  /** Offset du code de chaque procédure exportée, par indice d'export. */
  procedures: Map<number, number>;
}

/** Produit la paire script + heap décrite par `spec`. */
export function buildScript(spec: ScriptSpec): Built {
  const objects = spec.objects ?? [];
  const locals = spec.locals ?? [];
  const exports = spec.exports ?? [];

  // Heap : en-tête, variables locales, objets, 0, chaînes.
  const propertiesOf = (o: ObjectSpec): [SelectorName, number][] => [...(o.inherited ?? []), ...(o.properties ?? [])];
  const sizeOf = (o: ObjectSpec): number => HEADER_SELECTORS.length + 1 + propertiesOf(o).length;
  const objectOffsets = new Map<string, number>();
  let at = 4 + 2 * locals.length;
  for (const o of objects) {
    objectOffsets.set(o.name, at);
    at += 2 * sizeOf(o);
  }
  at += 2;
  const stringOffsets = new Map<string, number>();
  const stringBytes: number[] = [];
  for (const text of [...objects.map((o) => o.name), ...(spec.strings ?? [])]) {
    if (stringOffsets.has(text)) continue;
    stringOffsets.set(text, at + stringBytes.length);
    stringBytes.push(...[...text].map((c) => c.charCodeAt(0)), 0);
  }
  const link: LinkContext = {
    object: (name) => objectOffsets.get(name) ?? fail(`objet inconnu : ${name}`),
    string: (text) => stringOffsets.get(text) ?? fail(`chaîne inconnue : ${text}`),
  };
  const assemble = (code: Code): number[] => (typeof code === "function" ? code(link) : code);

  // Script : en-tête, exports, dictionnaires de propriétés (classes), dictionnaires de méthodes, code.
  let scriptAt = 8 + 2 * exports.length;
  const propertyDicts = new Map<string, number>();
  for (const o of objects) {
    if (o.species === undefined) continue;
    propertyDicts.set(o.name, scriptAt);
    scriptAt += 2 * sizeOf(o);
  }
  const methodDicts = new Map<string, number>();
  for (const o of objects) {
    methodDicts.set(o.name, scriptAt);
    scriptAt += 2 + 4 * Object.keys(o.methods ?? {}).length;
  }
  const codeBytes: number[] = [];
  const codeStart = scriptAt;
  const place = (code: Code): number => {
    const offset = codeStart + codeBytes.length;
    codeBytes.push(...assemble(code));
    return offset;
  };
  const methodOffsets = new Map<string, [number, number][]>();
  for (const o of objects) {
    methodOffsets.set(
      o.name,
      Object.entries(o.methods ?? {}).map(([name, code]) => [sel(name as SelectorName), place(code as Code)]),
    );
  }
  const procedures = new Map<number, number>();
  const scriptRelocations: number[] = [];
  const exportWords = exports.map((entry, i) => {
    if (typeof entry === "string") {
      scriptRelocations.push(8 + 2 * i);
      return link.object(entry);
    }
    const offset = place(entry);
    procedures.set(i, offset);
    return offset;
  });

  const script: number[] = [...word(codeStart + codeBytes.length), 0, 0, 0, 0, ...word(exports.length), ...exportWords.flatMap(word)];
  for (const o of objects) {
    if (o.species === undefined) continue;
    script.push(...[...HEADER_SELECTORS, sel("name"), ...propertiesOf(o).map(([name]) => sel(name))].flatMap(word));
  }
  for (const o of objects) {
    const methods = methodOffsets.get(o.name)!;
    script.push(...word(methods.length), ...methods.flatMap(([selector, offset]) => [...word(selector), ...word(offset)]));
  }
  script.push(...codeBytes, ...word(scriptRelocations.length), ...scriptRelocations.flatMap(word));

  const heapRelocations: number[] = [];
  const heap: number[] = [0, 0, ...word(locals.length), ...locals.flatMap(word)];
  for (const o of objects) {
    const isClass = o.species !== undefined;
    heapRelocations.push(heap.length + 2 * HEADER_SELECTORS.length);
    heap.push(
      ...[
        OBJECT_MAGIC,
        sizeOf(o),
        isClass ? propertyDicts.get(o.name)! : 0,
        methodDicts.get(o.name)!,
        0,
        isClass ? o.species! : SPECIES_INSTANCE,
        o.superClass ?? NO_SUPERCLASS,
        isClass ? INFO_CLASS : 0,
        link.string(o.name),
        ...propertiesOf(o).map(([, value]) => value),
      ].flatMap(word),
    );
  }
  heap.push(0, 0, ...stringBytes);
  const heapEnd = heap.length;
  heap[0] = heapEnd & 0xff;
  heap[1] = heapEnd >> 8;
  heap.push(...word(heapRelocations.length), ...heapRelocations.flatMap(word));
  return { script: Uint8Array.from(script), heap: Uint8Array.from(heap), objects: objectOffsets, procedures };
}

function fail(message: string): never {
  throw new Error(message);
}

function patch(type: number, data: Uint8Array): Uint8Array {
  return Uint8Array.from([type, 0, ...data]);
}

function selectorVocab(): Uint8Array {
  const table = SELECTORS.length * 2 + 2;
  const out: number[] = [...word(SELECTORS.length - 1)];
  const strings: number[] = [];
  for (const name of SELECTORS) {
    out.push(...word(table + strings.length));
    strings.push(...word(name.length), ...[...name].map((c) => c.charCodeAt(0)));
  }
  return Uint8Array.from([...out, ...strings]);
}

export interface World {
  vm: Vm;
  built: Map<number, Built>;
}

/**
 * Machine virtuelle sur des scripts synthétiques. La table des classes attribue chaque numéro de classe au script qui la
 * définit ; `classScripts` force une entrée (classe définie deux fois).
 */
export function makeWorld(specs: ScriptSpec[], classScripts: Record<number, number> = {}): World {
  const index = new ResourceIndex();
  const built = new Map<number, Built>();
  const classTable: number[] = [];
  for (const spec of specs) {
    const pair = buildScript(spec);
    built.set(spec.number, pair);
    index.addPatch(`${spec.number}.SCR`, patch(ResourceType.Script, pair.script));
    index.addPatch(`${spec.number}.HEP`, patch(ResourceType.Heap, pair.heap));
    for (const o of spec.objects ?? []) if (o.species !== undefined) classTable[o.species] ??= spec.number;
  }
  for (const [species, script] of Object.entries(classScripts)) classTable[Number(species)] = script;
  const classBytes: number[] = [];
  for (let i = 0; i < classTable.length; i++) classBytes.push(0, 0, ...word(classTable[i] ?? 0xffff));
  index.addPatch(`${VOCAB_CLASS_TABLE}.VOC`, patch(ResourceType.Vocab, Uint8Array.from(classBytes)));
  index.addPatch(`${VOCAB_SELECTOR_NAMES}.VOC`, patch(ResourceType.Vocab, selectorVocab()));
  return { vm: new Vm(index), built };
}

/** Exécute jusqu'à la fin et renvoie l'accumulateur ; échoue si l'exécution se suspend ou ne finit pas. */
export function runToEnd(vm: Vm, slice = 10_000): number {
  const result = vm.run(slice);
  if (result.status !== RunStatus.Finished) throw new Error(`exécution non terminée : ${result.status}`);
  return vm.acc;
}

/** Charge le script 0 d'un monde fait d'une seule procédure (export 0) et l'exécute avec `args`. */
export function runCode(code: Code, options: { args?: number[]; locals?: number[]; strings?: string[]; extra?: ScriptSpec[] } = {}): { vm: Vm; acc: number } {
  const { vm, built } = makeWorld([{ number: 0, locals: options.locals ?? [0], strings: options.strings, exports: [code] }, ...(options.extra ?? [])]);
  const segment = vm.scripts.instantiate(0);
  vm.useGlobals(segment.localsSegment);
  vm.startProcedure(0, built.get(0)!.procedures.get(0)!, options.args ?? []);
  return { vm, acc: runToEnd(vm) };
}
