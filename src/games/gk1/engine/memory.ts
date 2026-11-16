/**
 * Mémoire de la machine virtuelle SCI2 : valeurs (`Reg`), arithmétique 16 bits, segments (pile, clones, listes, nœuds, tableaux,
 * bitmaps, scripts et variables locales) et déréférencement (`docs/gk1/plan.md`, vague S1).
 *
 * Références : `engines/sci/engine/vm_types.h` et `vm_types.cpp` (`reg_t` et ses opérateurs), `seg_manager.cpp`
 * (`SegManager`, tables, `getString`, `strcpy`), `segment.h` (`Table`, `List`, `Node`, `SciArray`) de ScummVM, GPL v3 ou
 * ultérieure, lus puis réécrits.
 *
 * **Valeur** : un `Reg` est un entier non signé de 32 bits, `segment << 16 | offset`. Segment 0 : entier de 16 bits ; sinon
 * référence. Les valeurs tiennent donc dans des `Uint32Array` (structures plates, sérialisables) et se comparent par `===`.
 *
 * **Adresses** :
 * - script : l'offset est un **offset dans le heap** du script (objet ou chaîne) ;
 * - variables locales et pile : l'offset est `2 × indice` (les scripts comptent en octets, comme ScummVM) ;
 * - clones, listes, nœuds, tableaux : l'offset est l'indice dans la table.
 *
 * Écarts volontaires :
 * - ScummVM colle le heap après le script dans un seul tampon ; ici le code (lecture seule) et le heap (copié, modifiable)
 *   restent séparés, un pointeur de code n'est jamais une valeur (`pc` vit dans la trame d'exécution) ;
 * - un segment de script et son segment de variables locales gardent leur numéro quand le script est rechargé
 *   (ScummVM réalloue les variables locales) ;
 * - les opérations que ScummVM confie à ses « workarounds » (référence + référence, division par zéro…) lèvent `SciError`
 *   ou rendent 0 selon le cas : les correctifs propres au jeu viendront avec D12 ;
 * - pas de segments « hunk », « dynmem » ni de chaînes système : SCI2 ne s'en sert pas ; un bitmap (`SciBitmap`) est une image
 *   décodée, sans l'en-tête de 46 octets que ScummVM garde devant ses pixels.
 */
import type { Script } from "../data/script";
import { ArrayType, LIST_MAX_RECURSION, Segment, STACK_SIZE } from "./ids";
import type { SciObject } from "./object";

// ---------------------------------------------------------------------------------------------------------------------------------
// Valeurs
// ---------------------------------------------------------------------------------------------------------------------------------

/** Valeur de la machine virtuelle : `segment << 16 | offset`, non signé. */
export type Reg = number;

export const NULL_REG: Reg = 0;
/** −1 sur 16 bits : réponse « échec » ou « oui » de nombreuses fonctions du noyau. */
export const SIGNAL_REG: Reg = 0xffff;

const SEGMENT_FACTOR = 0x10000;
const WORD_MASK = 0xffff;
/** Octets par case de variable (les adresses de variables comptent en octets). */
const CELL_BYTES = 2;

/** Erreur d'exécution d'un script (adresse invalide, opération interdite). */
export class SciError extends Error {
  override name = "SciError";
}

export function makeReg(segment: number, offset: number): Reg {
  return segment * SEGMENT_FACTOR + (offset & WORD_MASK);
}

export function regSegment(reg: Reg): number {
  return reg >>> 16;
}

export function regOffset(reg: Reg): number {
  return reg & WORD_MASK;
}

export function isNumber(reg: Reg): boolean {
  return reg < SEGMENT_FACTOR;
}

export function isPointer(reg: Reg): boolean {
  return reg >= SEGMENT_FACTOR;
}

/** Entier signé de 16 bits porté par l'offset. */
export function toSint16(reg: Reg): number {
  return (reg << 16) >> 16;
}

/** Entier de 16 bits (les bits au-delà sont perdus). */
export function fromInt(value: number): Reg {
  return value & WORD_MASK;
}

/** `segment:offset` en hexadécimal pour une référence, décimal signé pour un entier (journaux, messages d'erreur). */
export function formatReg(reg: Reg): string {
  if (isNumber(reg)) return String(toSint16(reg));
  return `${regSegment(reg).toString(16).padStart(4, "0")}:${regOffset(reg).toString(16).padStart(4, "0")}`;
}

/** Addition : entier + entier sur 16 bits ; référence + entier déplace l'offset. */
export function regAdd(a: Reg, b: Reg): Reg {
  if (isNumber(a)) {
    if (isNumber(b)) return (a + b) & WORD_MASK;
    return makeReg(regSegment(b), regOffset(b) + a);
  }
  if (isNumber(b)) return makeReg(regSegment(a), regOffset(a) + b);
  throw new SciError(`addition de deux références (${formatReg(a)} + ${formatReg(b)})`);
}

/** Soustraction : référence − entier déplace l'offset ; deux références du même segment donnent leur écart. */
export function regSub(a: Reg, b: Reg): Reg {
  if (isNumber(b)) return isNumber(a) ? (a - b) & WORD_MASK : makeReg(regSegment(a), regOffset(a) - b);
  if (regSegment(a) === regSegment(b)) return (regOffset(a) - regOffset(b)) & WORD_MASK;
  throw new SciError(`soustraction de références sans rapport (${formatReg(a)} − ${formatReg(b)})`);
}

/**
 * Comparaison : négatif, nul ou positif. Deux valeurs du même segment se comparent par leur offset (signé pour des entiers,
 * sauf `unsigned`) ; une référence est plus grande qu'un entier (ScummVM ne l'admet que jusqu'à SCI1.1 et pour de petits entiers :
 * ici toujours, sans erreur) ; deux références de segments différents se comparent par segment.
 */
export function regCompare(a: Reg, b: Reg, unsigned: boolean): number {
  const sa = regSegment(a);
  const sb = regSegment(b);
  if (sa === sb) return unsigned || sa !== Segment.Number ? regOffset(a) - regOffset(b) : toSint16(a) - toSint16(b);
  return sa - sb;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------------------------------------------

/** Table d'un segment (clones, listes, nœuds, tableaux) : l'indice d'une entrée est l'offset de sa référence. */
export class Table<T> {
  private readonly entries: (T | undefined)[] = [];
  /** Indices libérés, réutilisés du dernier au premier (ordre déterministe). */
  private readonly free: number[] = [];
  private used = 0;

  constructor(
    readonly segment: number,
    private readonly what: string,
  ) {}

  /** Range `value` et renvoie sa référence. */
  allocate(value: T): Reg {
    const index = this.free.pop() ?? this.entries.length;
    if (index > WORD_MASK) throw new SciError(`table des ${this.what} pleine`);
    this.entries[index] = value;
    this.used++;
    return makeReg(this.segment, index);
  }

  /** Entrée à cette référence, ou `undefined` (autre segment, indice libre). */
  get(reg: Reg): T | undefined {
    return regSegment(reg) === this.segment ? this.entries[regOffset(reg)] : undefined;
  }

  release(reg: Reg): void {
    const index = regOffset(reg);
    if (regSegment(reg) !== this.segment || this.entries[index] === undefined) return;
    this.entries[index] = undefined;
    this.free.push(index);
    this.used--;
  }

  /** Nombre d'entrées occupées. */
  get size(): number {
    return this.used;
  }

  /** Contenu brut, pour la sauvegarde : les cases (libres comprises) et les indices libres dans l'ordre de leur réemploi. */
  dump(): { entries: readonly (T | undefined)[]; free: readonly number[] } {
    return { entries: this.entries, free: this.free };
  }

  /** Remplace tout le contenu (reprise d'une sauvegarde) : les prochaines allocations rendent les mêmes références qu'à l'origine. */
  load(entries: readonly (T | undefined)[], free: readonly number[]): void {
    this.entries.length = 0;
    this.free.length = 0;
    this.used = 0;
    entries.forEach((entry, index) => {
      this.entries[index] = entry;
      if (entry !== undefined) this.used++;
    });
    for (const index of free) this.free.push(index);
  }

  /** Entrées occupées, par indice croissant. */
  *[Symbol.iterator](): IterableIterator<[Reg, T]> {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry !== undefined) yield [makeReg(this.segment, i), entry];
    }
  }
}

export interface SciList {
  first: Reg;
  last: Reg;
  /** Itérations du noyau en cours sur cette liste (`ListEachElementDo` imbriqués). */
  recursions: number;
  /** Nœud suivant de chaque itération en cours : `DeleteKey` le corrige quand il retire ce nœud. */
  nextNodes: Reg[];
}

export interface SciNode {
  pred: Reg;
  succ: Reg;
  key: Reg;
  value: Reg;
}

/** Image créée par le noyau (`CreateTextBitmap`) : `width × height` indices de couleur, que les scripts montrent par la propriété `bitmap`. */
export interface SciBitmap {
  readonly width: number;
  readonly height: number;
  readonly skipColor: number;
  readonly pixels: Uint8Array;
}

export function newList(): SciList {
  return { first: NULL_REG, last: NULL_REG, recursions: 0, nextNodes: new Array<Reg>(LIST_MAX_RECURSION).fill(NULL_REG) };
}

/**
 * Tableau du noyau (`Array`, `String`). Les types entier et référence gardent des `Reg` entiers (les scripts rangent des
 * références dans des tableaux d'entiers, comme le note ScummVM) ; les types octet et chaîne gardent des octets.
 */
export class SciArray {
  private regs: Uint32Array | undefined;
  private bytes: Uint8Array | undefined;
  private length = 0;

  constructor(
    readonly type: ArrayType,
    size = 0,
  ) {
    if (type === ArrayType.Int16 || type === ArrayType.Id) this.regs = new Uint32Array(0);
    else if (type === ArrayType.Byte || type === ArrayType.String) this.bytes = new Uint8Array(0);
    else throw new SciError(`type de tableau inconnu : ${type}`);
    this.resize(size);
  }

  get size(): number {
    return this.length;
  }

  get isByteArray(): boolean {
    return this.bytes !== undefined;
  }

  /** Agrandit le tableau (les nouvelles cases valent 0) ; ne le réduit que si `force`. */
  resize(size: number, force = false): void {
    if (size > WORD_MASK) throw new SciError(`tableau trop grand (${size})`);
    if (size <= this.length && !force) return;
    if (this.regs) {
      if (size > this.regs.length) {
        const grown = new Uint32Array(Math.max(size, this.regs.length * 2));
        grown.set(this.regs);
        this.regs = grown;
      } else this.regs.fill(0, size);
    } else if (this.bytes) {
      if (size > this.bytes.length) {
        const grown = new Uint8Array(Math.max(size, this.bytes.length * 2));
        grown.set(this.bytes);
        this.bytes = grown;
      } else this.bytes.fill(0, size);
    }
    this.length = size;
  }

  get(index: number): Reg {
    if (index < 0 || index >= this.length) throw new SciError(`lecture hors du tableau (${index} sur ${this.length})`);
    return this.regs ? this.regs[index] : this.bytes![index];
  }

  /** Écrit une case existante (octet de poids faible pour un tableau d'octets). */
  set(index: number, value: Reg): void {
    if (index < 0 || index >= this.length) throw new SciError(`écriture hors du tableau (${index} sur ${this.length})`);
    if (this.regs) this.regs[index] = value;
    else this.bytes![index] = value & 0xff;
  }

  /** Remplit `count` cases depuis `index` ; `count` 0xFFFF : jusqu'à la fin. Le tableau grandit au besoin. */
  fill(index: number, count: number, value: Reg): void {
    if (count === WORD_MASK) count = Math.max(this.length - index, 0);
    if (count === 0) return;
    this.resize(index + count);
    if (this.regs) this.regs.fill(value, index, index + count);
    else this.bytes!.fill(value & 0xff, index, index + count);
  }

  /** Copie `count` cases de `source` (0xFFFF : jusqu'à sa fin) ; les deux tableaux grandissent au besoin et peuvent être le même. */
  copyFrom(source: SciArray, sourceIndex: number, index: number, count: number): void {
    if (count === WORD_MASK) count = Math.max(source.size - sourceIndex, 0);
    if (count === 0) return;
    this.resize(index + count);
    source.resize(sourceIndex + count);
    if (this.regs) {
      if (source.regs) this.regs.set(source.regs.slice(sourceIndex, sourceIndex + count), index);
      else this.regs.set(source.bytes!.slice(sourceIndex, sourceIndex + count), index);
    } else if (source.bytes) this.bytes!.set(source.bytes.slice(sourceIndex, sourceIndex + count), index);
    else for (let i = 0; i < count; i++) this.bytes![index + i] = source.regs![sourceIndex + i] & 0xff;
  }

  /** Copie indépendante. */
  clone(): SciArray {
    const copy = new SciArray(this.type, this.length);
    copy.copyFrom(this, 0, 0, this.length);
    return copy;
  }

  /** Octets jusqu'au premier 0 (ou la fin), un caractère par octet. */
  toByteString(): string {
    let out = "";
    for (let i = 0; i < this.length; i++) {
      const byte = this.regs ? this.regs[i] & 0xff : this.bytes![i];
      if (byte === 0) break;
      out += String.fromCharCode(byte);
    }
    return out;
  }

  /** Remplace le contenu par `text` (un caractère par octet) suivi d'un 0 ; la taille devient `longueur + 1`. */
  setByteString(text: string): void {
    this.resize(text.length + 1, true);
    for (let i = 0; i < text.length; i++) this.set(i, text.charCodeAt(i) & 0xff);
    this.set(text.length, 0);
  }

  /** Références contenues (ramasse-miettes, sauvegarde) ; vide pour un tableau d'octets. */
  references(): Uint32Array {
    return this.regs ? this.regs.subarray(0, this.length) : new Uint32Array(0);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Segments de scripts
// ---------------------------------------------------------------------------------------------------------------------------------

export const SegmentKind = { Script: 0, Locals: 1 } as const;

/** Script chargé : code en lecture seule, heap modifiable (chaînes), objets. */
export interface ScriptSegment {
  readonly kind: typeof SegmentKind.Script;
  readonly id: number;
  readonly number: number;
  /** Structures lues par `data/script.ts` ; `undefined` tant que le script n'a jamais été chargé. */
  source: Script | undefined;
  /** Code et dictionnaires (la ressource script, jamais modifiée). */
  code: Uint8Array;
  /** Copie modifiable de la ressource heap : les chaînes y sont lues et écrites. */
  heap: Uint8Array;
  /** Objets et classes, par offset dans le heap. */
  objects: Map<number, SciObject>;
  /** Segment des variables locales, 0 si le script n'en a pas. */
  localsSegment: number;
  /** Nombre de demandes de chargement non rendues (`ScriptID`, classes) ; `DisposeScript` le ramène à zéro. */
  lockers: number;
  /** Déchargé par `DisposeScript` : ses objets restent lisibles jusqu'au rechargement, mais ne sont plus des objets valides. */
  deleted: boolean;
}

export interface LocalsSegment {
  readonly kind: typeof SegmentKind.Locals;
  readonly id: number;
  readonly scriptNumber: number;
  values: Uint32Array;
}

type DynamicSegment = ScriptSegment | LocalsSegment;

// ---------------------------------------------------------------------------------------------------------------------------------
// Gestionnaire
// ---------------------------------------------------------------------------------------------------------------------------------

/** Toute la mémoire adressable par les scripts. */
export class SegManager {
  readonly stack = new Uint32Array(STACK_SIZE);
  readonly clones = new Table<SciObject>(Segment.Clones, "clones");
  readonly lists = new Table<SciList>(Segment.Lists, "listes");
  readonly nodes = new Table<SciNode>(Segment.Nodes, "nœuds");
  readonly arrays = new Table<SciArray>(Segment.Arrays, "tableaux");
  readonly bitmaps = new Table<SciBitmap>(Segment.Bitmaps, "bitmaps");
  private readonly dynamic: DynamicSegment[] = [];

  /** Crée le segment (vide) d'un script. */
  addScriptSegment(number: number): ScriptSegment {
    const segment: ScriptSegment = {
      kind: SegmentKind.Script,
      id: this.nextSegmentId(),
      number,
      source: undefined,
      code: new Uint8Array(0),
      heap: new Uint8Array(0),
      objects: new Map(),
      localsSegment: 0,
      lockers: 0,
      deleted: false,
    };
    this.dynamic.push(segment);
    return segment;
  }

  /** Crée le segment des variables locales d'un script. */
  addLocalsSegment(scriptNumber: number): LocalsSegment {
    const segment: LocalsSegment = { kind: SegmentKind.Locals, id: this.nextSegmentId(), scriptNumber, values: new Uint32Array(0) };
    this.dynamic.push(segment);
    return segment;
  }

  private nextSegmentId(): number {
    const id = Segment.FirstDynamic + this.dynamic.length;
    if (id >= Segment.Uninitialized) throw new SciError("plus de segment libre");
    return id;
  }

  private dynamicSegment(id: number): DynamicSegment | undefined {
    return id >= Segment.FirstDynamic ? this.dynamic[id - Segment.FirstDynamic] : undefined;
  }

  /** Segment de script de ce numéro de segment, ou `undefined`. */
  scriptSegment(id: number): ScriptSegment | undefined {
    const segment = this.dynamicSegment(id);
    return segment?.kind === SegmentKind.Script ? segment : undefined;
  }

  localsSegment(id: number): LocalsSegment | undefined {
    const segment = this.dynamicSegment(id);
    return segment?.kind === SegmentKind.Locals ? segment : undefined;
  }

  /** Tous les segments de scripts et de variables locales, dans l'ordre de leur numéro (le premier est `Segment.FirstDynamic`). */
  dynamicSegments(): readonly (ScriptSegment | LocalsSegment)[] {
    return this.dynamic;
  }

  /** Vide toute la mémoire (reprise d'une sauvegarde, redémarrage) : plus aucun segment, tables vides, pile à zéro. */
  reset(): void {
    this.stack.fill(0);
    for (const table of [this.clones, this.lists, this.nodes, this.arrays, this.bitmaps]) table.load([], []);
    this.dynamic.length = 0;
  }

  /** Tous les segments de scripts, par numéro de segment croissant. */
  scriptSegments(): ScriptSegment[] {
    return this.dynamic.filter((s): s is ScriptSegment => s.kind === SegmentKind.Script);
  }

  // --- Objets ---

  /** Objet, classe ou clone à cette adresse, même libéré ou d'un script déchargé ; `undefined` si ce n'en est pas un. */
  getObject(reg: Reg): SciObject | undefined {
    const segment = regSegment(reg);
    if (segment === Segment.Clones) return this.clones.get(reg);
    if (segment < Segment.FirstDynamic) return undefined;
    return this.scriptSegment(segment)?.objects.get(regOffset(reg));
  }

  /** Objet vivant : ni clone libéré, ni objet d'un script déchargé (`SegManager::isHeapObject`). */
  isObject(reg: Reg): boolean {
    const object = this.getObject(reg);
    if (!object || object.freed) return false;
    const segment = regSegment(reg);
    return segment === Segment.Clones || !this.scriptSegment(segment)!.deleted;
  }

  // --- Listes ---

  list(reg: Reg): SciList {
    const list = this.lists.get(reg);
    if (!list) throw new SciError(`${formatReg(reg)} n'est pas une liste`);
    return list;
  }

  /** Nœud à cette adresse ; `undefined` pour la référence nulle. */
  node(reg: Reg): SciNode | undefined {
    if (reg === NULL_REG) return undefined;
    const node = this.nodes.get(reg);
    if (!node) throw new SciError(`${formatReg(reg)} n'est pas un nœud de liste`);
    return node;
  }

  // --- Tableaux ---

  array(reg: Reg): SciArray {
    const array = this.arrays.get(reg);
    if (!array) throw new SciError(`${formatReg(reg)} n'est pas un tableau`);
    return array;
  }

  isArray(reg: Reg): boolean {
    return this.arrays.get(reg) !== undefined;
  }

  // --- Cases de variables (`lea`) ---

  /** Cases visées par une adresse de variable : le tableau et l'indice de départ. */
  private cells(reg: Reg): { values: Uint32Array; index: number } {
    const segment = regSegment(reg);
    const offset = regOffset(reg);
    const values = segment === Segment.Stack ? this.stack : this.localsSegment(segment)?.values;
    if (!values) throw new SciError(`${formatReg(reg)} n'est pas une adresse de variable`);
    if (offset % CELL_BYTES !== 0) throw new SciError(`adresse de variable impaire : ${formatReg(reg)}`);
    return { values, index: offset / CELL_BYTES };
  }

  /** Vrai pour l'adresse d'une variable (locale, globale, temporaire, paramètre). */
  isVariableAddress(reg: Reg): boolean {
    const segment = regSegment(reg);
    return segment === Segment.Stack || this.localsSegment(segment) !== undefined;
  }

  readCell(reg: Reg, index = 0): Reg {
    const cells = this.cells(reg);
    if (cells.index + index >= cells.values.length) throw new SciError(`lecture hors des variables (${formatReg(reg)} + ${index})`);
    return cells.values[cells.index + index];
  }

  writeCell(reg: Reg, index: number, value: Reg): void {
    const cells = this.cells(reg);
    if (cells.index + index >= cells.values.length) throw new SciError(`écriture hors des variables (${formatReg(reg)} + ${index})`);
    cells.values[cells.index + index] = value;
  }

  // --- Chaînes ---

  /**
   * Chaîne à cette adresse, **un caractère par octet** (CP850 non décodé : le noyau travaille sur les octets). Heap d'un
   * script : jusqu'au 0 ; tableau : son contenu ; variables : deux octets par case, poids faible d'abord. La référence nulle
   * donne la chaîne vide.
   */
  getString(reg: Reg): string {
    if (reg === NULL_REG) return "";
    const segment = regSegment(reg);
    if (segment === Segment.Arrays) return this.array(reg).toByteString();
    const script = this.scriptSegment(segment);
    let out = "";
    if (script) {
      for (let p = regOffset(reg); p < script.heap.length && script.heap[p] !== 0; p++) out += String.fromCharCode(script.heap[p]);
      return out;
    }
    if (this.isVariableAddress(reg)) {
      const { values, index } = this.cells(reg);
      for (let i = index; i < values.length; i++) {
        const low = values[i] & 0xff;
        if (low === 0) break;
        out += String.fromCharCode(low);
        const high = (values[i] >> 8) & 0xff;
        if (high === 0) break;
        out += String.fromCharCode(high);
      }
      return out;
    }
    throw new SciError(`${formatReg(reg)} n'est pas une chaîne`);
  }

  /** Écrit `text` (un caractère par octet) et son 0 final à cette adresse. Un tableau prend la taille du texte. */
  setString(reg: Reg, text: string): void {
    const segment = regSegment(reg);
    if (segment === Segment.Arrays) {
      this.array(reg).setByteString(text);
      return;
    }
    const script = this.scriptSegment(segment);
    if (script) {
      const start = regOffset(reg);
      if (start + text.length + 1 > script.heap.length) throw new SciError(`chaîne trop longue pour le heap du script ${script.number}`);
      for (let i = 0; i < text.length; i++) script.heap[start + i] = text.charCodeAt(i) & 0xff;
      script.heap[start + text.length] = 0;
      return;
    }
    if (this.isVariableAddress(reg)) {
      const { values, index } = this.cells(reg);
      const cellCount = (text.length >> 1) + 1;
      if (index + cellCount > values.length) throw new SciError(`chaîne trop longue pour les variables (${formatReg(reg)})`);
      for (let i = 0; i < cellCount; i++) values[index + i] = (text.charCodeAt(2 * i) & 0xff) | ((text.charCodeAt(2 * i + 1) & 0xff) << 8);
      return;
    }
    throw new SciError(`${formatReg(reg)} n'est pas une chaîne modifiable`);
  }
}
