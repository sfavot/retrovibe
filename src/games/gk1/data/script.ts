/**
 * Scripts et heaps SCI2 (`docs/gk1/formats.md` § 8) : exports, variables locales, objets et classes, chaînes, relocations.
 * Structures de données seulement : ni machine virtuelle ni désassembleur (`engine/`).
 *
 * Références : `engines/sci/engine/script.cpp` (`Script::load`, `relocateSci0Sci21`, `validateExportFunc`), `object.cpp`
 * (`Object::init`, `initBaseObject`) et `kscripts.cpp` (`kScriptID`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * ```
 * Script : u16 @0 offset de la table de relocation | u32 @2 0 | u16 @6 nb exports | u16 exports[] @8
 *          dictionnaires et code | relocation : u16 n, u16 offset[n] (jusqu'à la fin)
 * Heap   : u16 @0 offset de la table de relocation | u16 @2 nb variables locales | u16 locales[]
 *          objets | u16 0 | chaînes terminées par 0 | relocation (idem)
 * Objet  : u16 0x1234 | u16 nb de propriétés (ces mots compris) | u16 dictionnaire de propriétés (script) | u16 dictionnaire de méthodes (script)
 *          u16 0 | u16 espèce (numéro de classe ; 0xFFFF pour une instance) | u16 classe mère | u16 -info- (0x8000 = classe) | u16 nom (heap) | …
 *          (le neuvième mot est la propriété `name` de tous les objets sauf une classe racine du script 64943, qui n'en a pas)
 * Dictionnaire de méthodes   : u16 n | { u16 sélecteur ; u16 offset du code } × n
 * Dictionnaire de propriétés : un u16 sélecteur par propriété (classes seulement ; une instance prend celui de sa classe)
 * ```
 * **Relocations** : chaque table liste les mots de sa ressource qui contiennent un **offset de heap** (à convertir en
 * référence au chargement). Dans un heap : des variables locales et des propriétés d'objets. Dans un script : des entrées
 * de la table d'exports et les opérandes de `lofsa` / `lofss`. **Un export relocalisé désigne un objet du heap, les autres
 * sont des offsets de code** (procédures) : c'est ce qui les distingue.
 *
 * Écarts volontaires : ScummVM colle le heap à la suite du script dans un seul tampon et ajoute la taille du script aux
 * offsets de heap ; ici les deux ressources restent séparées et chaque valeur porte un indicateur « référence au heap »
 * (`plan.md` : références et entiers distingués). ScummVM ne lit pas la table de relocation du script (il distingue les
 * exports par l'usage : `ScriptID` ou `calle`).
 */
import { decodeCp850 } from "../../../data/cp850";
import { BinaryReader } from "../../../data/reader";
import { INFO_CLASS, OBJECT_MAGIC } from "./ids";

const SCRIPT_EXPORTS_OFFSET = 6;
const HEAP_LOCALS_OFFSET = 2;
const METHOD_ENTRY_SIZE = 4;

/** Indices des propriétés communes à tous les objets (sélecteurs 4096 à 4103), puis de `name` (absente d'une seule classe). */
export const OBJECT_PROPERTY = {
  Magic: 0,
  Size: 1,
  PropertyDict: 2,
  MethodDict: 3,
  ClassScript: 4,
  Species: 5,
  SuperClass: 6,
  Info: 7,
  Name: 8,
} as const;
/** Nombre de propriétés que tout objet possède (`name` non comprise). */
export const OBJECT_HEADER_PROPERTIES = 8;

export interface ScriptExport {
  /** Offset de code dans le script (procédure), ou offset dans le heap (objet) si `isObject`. */
  readonly offset: number;
  readonly isObject: boolean;
}

export interface ScriptMethod {
  readonly selector: number;
  /** Offset du code dans le script. */
  readonly codeOffset: number;
}

export interface ScriptObject {
  /** Offset de l'objet (de son mot 0x1234) dans le heap : c'est l'adresse que portent les références. */
  readonly offset: number;
  readonly isClass: boolean;
  /** Numéro de classe (indice du vocabulaire 996) pour une classe, `SPECIES_INSTANCE` pour une instance. */
  readonly species: number;
  /** Numéro de la classe mère, `NO_SUPERCLASS` pour une classe racine. */
  readonly superClass: number;
  readonly info: number;
  /** Nom de l'objet ; vide pour les trois classes sans nom (propriété `name` nulle ou absente). */
  readonly name: string;
  /** Valeurs initiales des propriétés (les huit communes comprises). */
  readonly values: Uint16Array;
  /** Par propriété : la valeur est-elle un offset de heap (chaîne, objet, variable) ? */
  readonly isPointer: readonly boolean[];
  /** Sélecteur de chaque propriété ; `undefined` pour une instance (prendre ceux de sa classe). */
  readonly propertySelectors: Uint16Array | undefined;
  readonly propertyDictOffset: number;
  readonly methodDictOffset: number;
  readonly methods: readonly ScriptMethod[];
}

export interface ScriptString {
  /** Offset dans le heap. */
  readonly offset: number;
  readonly text: string;
}

export interface Script {
  readonly exports: readonly ScriptExport[];
  /** Valeurs initiales des variables locales. */
  readonly locals: Uint16Array;
  readonly localIsPointer: readonly boolean[];
  readonly objects: readonly ScriptObject[];
  /** Chaînes du heap (noms d'objets, textes), dans l'ordre. */
  readonly strings: readonly ScriptString[];
  /** Offsets, dans le script, des mots à relocaliser (exports d'objets, opérandes de `lofsa` / `lofss`). */
  readonly scriptRelocations: Uint16Array;
  /** Offsets, dans le heap, des mots à relocaliser (variables locales, propriétés). */
  readonly heapRelocations: Uint16Array;
  /** Fin du code et des dictionnaires : début de la table de relocation du script. */
  readonly codeEnd: number;
  readonly script: Uint8Array;
  readonly heap: Uint8Array;
}

/** Lit une paire script + heap de même numéro. */
export function readScript(script: Uint8Array, heap: Uint8Array): Script {
  const scriptRelocations = readRelocations(script, "script");
  const heapRelocations = readRelocations(heap, "heap");
  const scriptPointers = new Set(scriptRelocations);
  const heapPointers = new Set(heapRelocations);
  const s = new BinaryReader(script);
  const h = new BinaryReader(heap);
  const codeEnd = s.u16();
  const heapEnd = h.u16();

  s.offset = SCRIPT_EXPORTS_OFFSET;
  const exportCount = s.u16();
  if (s.offset + 2 * exportCount > codeEnd) throw new Error("GK1 : table d'exports hors du script");
  const exports: ScriptExport[] = [];
  for (let i = 0; i < exportCount; i++) {
    const isObject = scriptPointers.has(s.offset);
    exports.push({ offset: s.u16(), isObject });
  }

  h.offset = HEAP_LOCALS_OFFSET;
  const localCount = h.u16();
  if (h.offset + 2 * localCount > heapEnd) throw new Error("GK1 : variables locales hors du heap");
  const locals = new Uint16Array(localCount);
  const localIsPointer: boolean[] = [];
  for (let i = 0; i < localCount; i++) {
    localIsPointer.push(heapPointers.has(h.offset));
    locals[i] = h.u16();
  }

  const objects: ScriptObject[] = [];
  for (;;) {
    if (h.offset + 2 > heapEnd) throw new Error("GK1 : liste d'objets du heap sans fin");
    const offset = h.offset;
    const magic = h.u16();
    if (magic === 0) break;
    if (magic !== OBJECT_MAGIC) throw new Error(`GK1 : objet sans signature 0x1234 à l'offset ${offset} du heap`);
    const size = h.u16();
    if (size < OBJECT_HEADER_PROPERTIES || offset + 2 * size > heapEnd) throw new Error("GK1 : objet de taille invalide");
    const values = new Uint16Array(size);
    const isPointer: boolean[] = [];
    h.offset = offset;
    for (let i = 0; i < size; i++) {
      isPointer.push(heapPointers.has(h.offset));
      values[i] = h.u16();
    }
    const info = values[OBJECT_PROPERTY.Info];
    const isClass = (info & INFO_CLASS) !== 0;
    const propertyDictOffset = values[OBJECT_PROPERTY.PropertyDict];
    const methodDictOffset = values[OBJECT_PROPERTY.MethodDict];

    let propertySelectors: Uint16Array | undefined;
    if (isClass) {
      if (propertyDictOffset + 2 * size > codeEnd) throw new Error("GK1 : dictionnaire de propriétés hors du script");
      propertySelectors = new Uint16Array(size);
      s.offset = propertyDictOffset;
      for (let i = 0; i < size; i++) propertySelectors[i] = s.u16();
    }

    if (methodDictOffset + 2 > codeEnd) throw new Error("GK1 : dictionnaire de méthodes hors du script");
    s.offset = methodDictOffset;
    const methodCount = s.u16();
    if (s.offset + METHOD_ENTRY_SIZE * methodCount > codeEnd) throw new Error("GK1 : dictionnaire de méthodes tronqué");
    const methods: ScriptMethod[] = [];
    for (let i = 0; i < methodCount; i++) methods.push({ selector: s.u16(), codeOffset: s.u16() });

    objects.push({
      offset,
      isClass,
      species: values[OBJECT_PROPERTY.Species],
      superClass: values[OBJECT_PROPERTY.SuperClass],
      info,
      name: isPointer[OBJECT_PROPERTY.Name] ? heapString(heap, values[OBJECT_PROPERTY.Name], heapEnd) : "",
      values,
      isPointer,
      propertySelectors,
      propertyDictOffset,
      methodDictOffset,
      methods,
    });
  }

  const strings: ScriptString[] = [];
  let p = h.offset;
  while (p < heapEnd) {
    const end = heap.indexOf(0, p);
    if (end === -1 || end >= heapEnd) break;
    strings.push({ offset: p, text: decodeCp850(heap.subarray(p, end)) });
    p = end + 1;
  }

  return { exports, locals, localIsPointer, objects, strings, scriptRelocations, heapRelocations, codeEnd, script, heap };
}

/** Chaîne du heap qui commence à `offset` (CP850, terminée par 0). */
export function heapString(heap: Uint8Array, offset: number, limit = heap.length): string {
  const end = heap.indexOf(0, offset);
  if (offset >= limit || end === -1 || end >= limit) throw new Error(`GK1 : chaîne hors du heap (${offset})`);
  return decodeCp850(heap.subarray(offset, end));
}

/** Objet du heap à cet offset (cible d'une référence ou d'un export), ou `undefined`. */
export function objectAt(script: Script, heapOffset: number): ScriptObject | undefined {
  return script.objects.find((o) => o.offset === heapOffset);
}

function readRelocations(resource: Uint8Array, what: string): Uint16Array {
  if (resource.length < 2) throw new Error(`GK1 : ${what} tronqué`);
  const r = new BinaryReader(resource);
  const offset = r.u16();
  if (offset + 2 > resource.length) throw new Error(`GK1 : table de relocation hors du ${what}`);
  r.offset = offset;
  const count = r.u16();
  if (r.offset + 2 * count !== resource.length) throw new Error(`GK1 : la table de relocation ne finit pas à la fin du ${what}`);
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = r.u16();
  return out;
}
