/**
 * Mise en JSON de l'état du moteur pour les sauvegardes (`docs/gk1/plan.md`, vague S2 ; `save.ts` s'en sert).
 *
 * Deux outils :
 * - **octets et mots compactés** (`packBytes`, `packWords`) : les tableaux typés passent en base64 après un codage par plages
 *   (octets répétés), les mots étant d'abord rangés par plans d'octets (tous les octets de poids faible, puis les suivants) :
 *   une table de valeurs de la machine virtuelle a ses octets hauts presque tous nuls ;
 * - **état d'une instance** (`declareState`, `saveInstance`, `loadInstance`) : les champs d'une classe déclarée sont écrits tels
 *   quels (nombres, chaînes, tableaux, `Map`, `Set`, tableaux typés, objets simples, instances d'autres classes déclarées) et
 *   relus **dans l'instance en place** : un tableau typé `readonly` garde son identité, ce que d'autres modules en ont gardé
 *   reste valable. Un objet atteint par plusieurs chemins n'est écrit qu'une fois (les listes du gestionnaire de sons se
 *   partagent leurs emplacements).
 *
 * Ce qui n'est pas de l'état se déclare par `skip` (services, caches relus des ressources) ; les champs qui portent une
 * fonction sont ignorés d'office. Une instance d'une classe non déclarée, ou un cycle, lève une erreur : rien n'est écrit à
 * moitié en silence.
 *
 * Format propre au port : ScummVM écrit un flux binaire (`engines/sci/engine/savegame.cpp`, `Common::Serializer`), GPL v3 ou
 * ultérieure, lu pour la liste de ce qu'il sauve, pas pour le format.
 */

// -------------------------------------------------------------------------------------------------------------------------------
// Octets et mots
// -------------------------------------------------------------------------------------------------------------------------------

/** Plus longue plage codée d'un coup. */
const RUN_MAX = 128;
/** Répétitions à partir desquelles une plage vaut mieux que des octets recopiés. */
const RUN_MIN = 3;
const BASE64_CHUNK = 0x8000;

/** Codage par plages : `n − 1` (0 à 127) puis `n` octets recopiés, ou `257 − n` (129 à 255) puis l'octet répété `n` fois. */
function runLengthEncode(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let literalStart = 0;
  const flush = (end: number): void => {
    for (let start = literalStart; start < end; start += RUN_MAX) {
      const count = Math.min(RUN_MAX, end - start);
      out.push(count - 1);
      for (let i = 0; i < count; i++) out.push(bytes[start + i]);
    }
  };
  let i = 0;
  while (i < bytes.length) {
    let run = 1;
    while (i + run < bytes.length && run < RUN_MAX && bytes[i + run] === bytes[i]) run++;
    if (run >= RUN_MIN) {
      flush(i);
      out.push(257 - run, bytes[i]);
      i += run;
      literalStart = i;
    } else i += run;
  }
  flush(bytes.length);
  return Uint8Array.from(out);
}

/** Octets décodés au plus : plafond de la mémoire qu'une longueur annoncée par une sauvegarde peut faire allouer. */
const UNPACK_MAX = 128 * 1024 * 1024;

function runLengthDecode(data: Uint8Array, length: number): Uint8Array {
  // Une plage de `RUN_MAX` octets tient en deux octets codés : une longueur annoncée au-delà est forcément fausse, et se refuse
  // avant toute allocation.
  if (length > UNPACK_MAX || length > data.length * (RUN_MAX / 2)) throw new Error("GK1 : sauvegarde illisible (longueur d'un bloc)");
  const out = new Uint8Array(length);
  let at = 0;
  let i = 0;
  while (i < data.length) {
    const control = data[i++];
    if (control < RUN_MAX) {
      const count = control + 1;
      if (i + count > data.length || at + count > length) throw new Error("GK1 : sauvegarde illisible (plage d'octets)");
      out.set(data.subarray(i, i + count), at);
      i += count;
      at += count;
    } else {
      const count = 257 - control;
      if (i >= data.length || at + count > length) throw new Error("GK1 : sauvegarde illisible (plage d'octets)");
      out.fill(data[i++], at, at + count);
      at += count;
    }
  }
  if (at !== length) throw new Error("GK1 : sauvegarde illisible (longueur d'un bloc)");
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) text += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Octets en texte : `longueur:base64` du codage par plages. */
export function packBytes(bytes: Uint8Array): string {
  return `${bytes.length}:${toBase64(runLengthEncode(bytes))}`;
}

export function unpackBytes(text: string): Uint8Array {
  const colon = text.indexOf(":");
  const length = Number(text.slice(0, colon));
  if (colon < 0 || !Number.isSafeInteger(length) || length < 0) throw new Error("GK1 : sauvegarde illisible (bloc d'octets)");
  return runLengthDecode(fromBase64(text.slice(colon + 1)), length);
}

/** Tableau typé de mots de `width` octets → plans d'octets (tous les octets 0, puis tous les octets 1…), compactés. */
function packPlanes(view: Uint8Array, width: number): string {
  const count = view.length / width;
  const planes = new Uint8Array(view.length);
  for (let plane = 0; plane < width; plane++) for (let i = 0; i < count; i++) planes[plane * count + i] = view[i * width + plane];
  return packBytes(planes);
}

function unpackPlanes(text: string, width: number): Uint8Array {
  const planes = unpackBytes(text);
  if (planes.length % width !== 0) throw new Error("GK1 : sauvegarde illisible (bloc de mots)");
  const count = planes.length / width;
  const bytes = new Uint8Array(planes.length);
  for (let plane = 0; plane < width; plane++) for (let i = 0; i < count; i++) bytes[i * width + plane] = planes[plane * count + i];
  return bytes;
}

/** Valeurs de la machine virtuelle (ou tout `Uint32Array`) en texte. */
export function packWords(values: Uint32Array): string {
  return packPlanes(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), Uint32Array.BYTES_PER_ELEMENT);
}

export function unpackWords(text: string): Uint32Array {
  const bytes = unpackPlanes(text, Uint32Array.BYTES_PER_ELEMENT);
  return new Uint32Array(bytes.buffer, 0, bytes.length / Uint32Array.BYTES_PER_ELEMENT);
}

// -------------------------------------------------------------------------------------------------------------------------------
// État d'une instance
// -------------------------------------------------------------------------------------------------------------------------------

/** Valeur JSON. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type AnyConstructor = abstract new (...args: never[]) => object;

export interface StateOptions<T> {
  /** Nom de la classe dans la sauvegarde : ne pas le changer sans changer la version du format. */
  name: string;
  /** Champs qui ne sont pas de l'état (services, caches). Les champs portant une fonction sont ignorés d'office. */
  skip?: readonly string[];
  /** Crée une instance à partir de ses champs relus ; sans elle, la classe ne se relit que dans une instance déjà en place. */
  create?: (fields: Record<string, unknown>) => T;
  /** Appelée une fois les champs relus (état dérivé à refaire). */
  loaded?: (instance: T) => void;
}

interface StateClass {
  name: string;
  ctor: AnyConstructor;
  skip: ReadonlySet<string>;
  create: ((fields: Record<string, unknown>) => object) | undefined;
  loaded: ((instance: object) => void) | undefined;
}

const classesByConstructor = new Map<unknown, StateClass>();
const classesByName = new Map<string, StateClass>();

/** Déclare une classe dont les instances font partie de l'état sauvegardé. */
export function declareState<T extends object>(ctor: abstract new (...args: never[]) => T, options: StateOptions<T>): void {
  const known = classesByName.get(options.name);
  if (known && known.ctor !== ctor) throw new Error(`GK1 : deux classes d'état nommées ${options.name}`);
  const entry: StateClass = {
    name: options.name,
    ctor,
    skip: new Set(options.skip ?? []),
    create: options.create,
    loaded: options.loaded as ((instance: object) => void) | undefined,
  };
  classesByConstructor.set(ctor, entry);
  classesByName.set(options.name, entry);
}

const TYPED_ARRAYS = {
  u8: Uint8Array,
  i8: Int8Array,
  u16: Uint16Array,
  i16: Int16Array,
  u32: Uint32Array,
  i32: Int32Array,
  f32: Float32Array,
  f64: Float64Array,
} as const;
type TypedArrayKind = keyof typeof TYPED_ARRAYS;
type TypedArray = InstanceType<(typeof TYPED_ARRAYS)[TypedArrayKind]>;

/** Noms qui ne sont jamais un champ d'état : écrits sur un objet, ils en changeraient le prototype. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

function checkKey(key: string): string {
  if (FORBIDDEN_KEYS.has(key)) throw corrupt(`champ « ${key} »`);
  return key;
}

/** Clé réservée des nœuds qui ne sont pas des objets simples. */
const TAG = "$";
/** Lignes à partir desquelles une liste d'instances s'écrit en tableau. */
const TABLE_MIN_ROWS = 2;

function typedArrayKind(value: object): TypedArrayKind | undefined {
  for (const kind of Object.keys(TYPED_ARRAYS) as TypedArrayKind[]) if (value.constructor === TYPED_ARRAYS[kind]) return kind;
  return undefined;
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stateClassOf(value: object): StateClass {
  const entry = classesByConstructor.get(value.constructor);
  if (!entry) throw new Error(`GK1 : l'état contient une instance de ${value.constructor.name}, classe non déclarée (declareState)`);
  return entry;
}

/** Champs d'une instance qui font partie de son état. */
function stateFields(value: object, entry: StateClass): [string, unknown][] {
  return Object.entries(value).filter(([key, field]) => !entry.skip.has(key) && typeof field !== "function");
}

/** Enfants d'un nœud, dans l'ordre d'écriture. */
function children(value: object): unknown[] {
  if (typedArrayKind(value)) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.entries()].flat();
  if (value instanceof Set) return [...value];
  if (isPlainObject(value)) return Object.values(value).filter((field) => typeof field !== "function");
  return stateFields(value, stateClassOf(value)).map(([, field]) => field);
}

class Encoder {
  private readonly shared = new Set<object>();
  private readonly ids = new Map<object, number>();

  constructor(root: object) {
    const seen = new Set<object>();
    const open = new Set<object>();
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (open.has(value)) throw new Error("GK1 : l'état à sauvegarder contient un cycle");
      if (seen.has(value)) {
        this.shared.add(value);
        return;
      }
      seen.add(value);
      open.add(value);
      for (const child of children(value)) visit(child);
      open.delete(value);
    };
    visit(root);
  }

  encode(value: unknown): Json {
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : { [TAG]: "x", v: String(value) };
    if (value === undefined) return { [TAG]: "u" };
    if (typeof value !== "object") throw new Error(`GK1 : valeur de type ${typeof value} dans l'état à sauvegarder`);
    const known = this.ids.get(value);
    if (known !== undefined) return { [TAG]: "r", i: known };
    if (!this.shared.has(value)) return this.encodeObject(value);
    const id = this.ids.size;
    this.ids.set(value, id);
    return { [TAG]: "d", i: id, v: this.encodeObject(value) };
  }

  private encodeFields(fields: [string, unknown][]): { [key: string]: Json } {
    const out: { [key: string]: Json } = {};
    for (const [key, field] of fields) {
      if (key === TAG) throw new Error("GK1 : champ « $ » dans l'état à sauvegarder");
      out[key] = this.encode(field);
    }
    return out;
  }

  /**
   * Liste d'instances d'une même classe, chacune atteinte par ce seul chemin : un tableau, les noms des champs une fois puis
   * une ligne de valeurs par instance (les éléments d'écran d'une pièce se comptent par dizaines).
   */
  private encodeTable(items: readonly unknown[]): Json | undefined {
    if (items.length < TABLE_MIN_ROWS) return undefined;
    const first = items[0];
    if (first === null || typeof first !== "object" || !classesByConstructor.has(first.constructor)) return undefined;
    const entry = stateClassOf(first);
    const keys = stateFields(first, entry).map(([key]) => key);
    const rows: Json[][] = [];
    for (const item of items) {
      if (item === null || typeof item !== "object" || item.constructor !== first.constructor || this.shared.has(item)) return undefined;
      const fields = stateFields(item, entry);
      if (fields.length !== keys.length || fields.some(([key], at) => key !== keys[at])) return undefined;
      rows.push(fields.map(([, field]) => this.encode(field)));
    }
    return { [TAG]: "l", n: entry.name, k: keys, r: rows };
  }

  private encodeObject(value: object): Json {
    const kind = typedArrayKind(value);
    if (kind) {
      const array = value as TypedArray;
      return { [TAG]: "t", k: kind, d: packPlanes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), array.BYTES_PER_ELEMENT) };
    }
    if (Array.isArray(value)) return this.encodeTable(value) ?? value.map((item) => this.encode(item));
    if (value instanceof Map) return { [TAG]: "m", e: [...value.entries()].map(([key, item]) => [this.encode(key), this.encode(item)]) };
    if (value instanceof Set) return { [TAG]: "s", v: [...value].map((item) => this.encode(item)) };
    if (isPlainObject(value)) return this.encodeFields(Object.entries(value).filter(([, field]) => typeof field !== "function"));
    const entry = stateClassOf(value);
    return { [TAG]: "c", n: entry.name, f: this.encodeFields(stateFields(value, entry)) };
  }
}

function corrupt(what: string): Error {
  return new Error(`GK1 : sauvegarde illisible (${what})`);
}

class Decoder {
  private readonly objects = new Map<number, unknown>();

  /** Relit `node` ; `current` est ce qui se trouve à cet endroit dans l'instance en place, repris quand il a la même nature. */
  decode(node: Json, current: unknown): unknown {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      const hints = Array.isArray(current) ? [...(current as unknown[])] : [];
      const items = node.map((item, index) => this.decode(item, hints[index]));
      if (!Array.isArray(current)) return items;
      current.length = 0;
      for (const item of items) current.push(item);
      return current;
    }
    const tag = node[TAG];
    if (tag === undefined) {
      const hints = current !== null && typeof current === "object" && isPlainObject(current) ? (current as Record<string, unknown>) : {};
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(node)) out[checkKey(key)] = this.decode(field, hints[key]);
      return out;
    }
    switch (tag) {
      case "u":
        return undefined;
      case "x":
        return Number(node.v);
      case "r": {
        if (!this.objects.has(node.i as number)) throw corrupt("référence inconnue");
        return this.objects.get(node.i as number);
      }
      case "d": {
        const value = this.decode(node.v, current);
        this.objects.set(node.i as number, value);
        return value;
      }
      case "t": {
        const constructor = typeof node.k === "string" && Object.hasOwn(TYPED_ARRAYS, node.k) ? TYPED_ARRAYS[node.k as TypedArrayKind] : undefined;
        if (!constructor || typeof node.d !== "string") throw corrupt("tableau typé");
        const bytes = unpackPlanes(node.d, constructor.BYTES_PER_ELEMENT);
        const array = new constructor(bytes.buffer as ArrayBuffer, 0, bytes.length / constructor.BYTES_PER_ELEMENT);
        if (current instanceof constructor && current.length === array.length) {
          (current as Uint8Array).set(array as unknown as Uint8Array);
          return current;
        }
        return array;
      }
      case "m": {
        if (!Array.isArray(node.e)) throw corrupt("table");
        const previous = current instanceof Map ? new Map(current as Map<unknown, unknown>) : new Map<unknown, unknown>();
        const entries = node.e.map((pair) => {
          if (!Array.isArray(pair) || pair.length !== 2) throw corrupt("table");
          const key = this.decode(pair[0], undefined);
          return [key, this.decode(pair[1], previous.get(key))] as const;
        });
        const map = current instanceof Map ? (current as Map<unknown, unknown>) : new Map<unknown, unknown>();
        map.clear();
        for (const [key, value] of entries) map.set(key, value);
        return map;
      }
      case "s": {
        if (!Array.isArray(node.v)) throw corrupt("ensemble");
        const items = node.v.map((item) => this.decode(item, undefined));
        const set = current instanceof Set ? (current as Set<unknown>) : new Set<unknown>();
        set.clear();
        for (const item of items) set.add(item);
        return set;
      }
      case "l": {
        const entry = classesByName.get(node.n as string);
        const keys = node.k;
        if (!entry || !Array.isArray(keys) || !Array.isArray(node.r)) throw corrupt(`tableau de ${String(node.n)}`);
        const hints = Array.isArray(current) ? [...(current as unknown[])] : [];
        const items = node.r.map((row, index) => {
          if (!Array.isArray(row) || row.length !== keys.length) throw corrupt(`ligne de ${entry.name}`);
          return this.decodeInstance(entry, Object.fromEntries(keys.map((key, at) => [checkKey(String(key)), row[at]])), hints[index]);
        });
        if (!Array.isArray(current)) return items;
        current.length = 0;
        for (const item of items) current.push(item);
        return current;
      }
      case "c": {
        const entry = classesByName.get(node.n as string);
        const fields = node.f;
        if (!entry || fields === null || typeof fields !== "object" || Array.isArray(fields)) throw corrupt(`classe ${String(node.n)}`);
        return this.decodeInstance(entry, fields, current);
      }
      default:
        throw corrupt(`nœud ${String(tag)}`);
    }
  }

  private decodeInstance(entry: StateClass, fields: { [key: string]: Json }, current: unknown): object {
    for (const key of Object.keys(fields)) checkKey(key);
    let target: Record<string, unknown>;
    if (current instanceof entry.ctor) {
      target = current as Record<string, unknown>;
      for (const [key, field] of Object.entries(fields)) target[key] = this.decode(field, target[key]);
    } else {
      if (!entry.create) throw new Error(`GK1 : la classe ${entry.name} ne se relit que dans une instance en place`);
      const values: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) values[key] = this.decode(field, undefined);
      target = entry.create(values) as Record<string, unknown>;
      for (const [key, value] of Object.entries(values)) target[key] = value;
    }
    entry.loaded?.(target);
    return target;
  }
}

/** État d'une instance d'une classe déclarée, en JSON. */
export function saveInstance(instance: object): Json {
  stateClassOf(instance);
  return new Encoder(instance).encode(instance);
}

/** Relit dans `instance` l'état écrit par `saveInstance`. */
export function loadInstance(instance: object, state: Json): void {
  if (new Decoder().decode(state, instance) !== instance) throw corrupt(`état de ${instance.constructor.name}`);
}

/** Copie d'une valeur simple (nombres, tableaux, `Map`, tableaux typés, objets simples) en JSON, et retour. */
export function saveValue(value: object): Json {
  return new Encoder(value).encode(value);
}

export function loadValue(state: Json): unknown {
  return new Decoder().decode(state, undefined);
}
