/**
 * Modèle objet SCI2 : objets, classes, clones, recherche d'un sélecteur (propriété ou méthode, avec héritage), lecture et
 * écriture de propriétés (`docs/gk1/formats.md` § 8).
 *
 * Références : `engines/sci/engine/object.h` et `object.cpp` (`Object`, `locateVarSelector`, `funcSelectorPosition`,
 * `mustSetViewVisible`), `selector.cpp` (`lookupSelector`, `readSelector`, `writeSelector`) de ScummVM, GPL v3 ou ultérieure,
 * lus puis réécrits.
 *
 * Les huit premières propriétés de tout objet sont son en-tête (`data/script.ts`, `OBJECT_PROPERTY`). Après le chargement :
 * `-script-` garde la valeur du fichier (numéro de classe, 0xFFFF pour une instance ; l'adresse du modèle pour un clone) ; `-super-` est l'adresse de la
 * classe mère ; `-propDict-` est une valeur propre à chaque classe, recopiée dans ses instances (`isKindOf` et `isMemberOf`
 * la comparent) ; `-classScript-` est le numéro du script. Un clone copie les propriétés de son modèle et en partage les méthodes.
 *
 * Écarts volontaires : la **forme** (sélecteurs des propriétés) est un objet partagé par une classe, ses instances et leurs
 * clones, avec un index sélecteur → indice ; ScummVM garde un pointeur dans le script et le parcourt à chaque envoi.
 * `name` se cherche par son sélecteur (une classe racine du script 64943 n'en a pas), jamais par son indice.
 */
import { INFO_CLASS, INFO_CLONE } from "../data/ids";
import { OBJECT_PROPERTY } from "../data/script";
import { INFO_VIEW_VISIBLE, VIEW_PROPERTY_FIRST, VIEW_PROPERTY_LAST } from "./ids";
import { formatReg, NULL_REG, type Reg, SciError, type SegManager } from "./memory";

/** Sélecteurs des propriétés d'une classe, partagés par ses instances et leurs clones. */
export interface ObjectShape {
  /** Sélecteur de chaque propriété, dans l'ordre des mots de l'objet. */
  readonly selectors: Uint16Array;
  /** Sélecteur → indice de la propriété. */
  readonly index: ReadonlyMap<number, number>;
}

export function makeShape(selectors: Uint16Array): ObjectShape {
  const index = new Map<number, number>();
  // Un sélecteur répété garde son premier indice, comme la recherche linéaire de l'original.
  for (let i = 0; i < selectors.length; i++) if (!index.has(selectors[i])) index.set(selectors[i], i);
  return { selectors, index };
}

const EMPTY_SHAPE = makeShape(new Uint16Array(0));

export class SciObject {
  /** Clone libéré par `DisposeClone` : encore lisible, plus un objet valide. */
  freed = false;
  shape: ObjectShape = EMPTY_SHAPE;

  constructor(
    /** Adresse de l'objet du script dont celui-ci vient (lui-même, ou le modèle d'origine d'un clone). */
    readonly origin: Reg,
    /** Valeurs des propriétés, en-tête compris. */
    readonly vars: Uint32Array,
    /** Méthodes propres à l'objet : sélecteur → offset du code dans le script `codeSegment`. */
    readonly methods: ReadonlyMap<number, number>,
    /** Segment du script qui porte le code des méthodes. */
    readonly codeSegment: number,
  ) {}

  get info(): number {
    return this.vars[OBJECT_PROPERTY.Info];
  }

  get isClass(): boolean {
    return (this.info & INFO_CLASS) !== 0;
  }

  get isClone(): boolean {
    return (this.info & INFO_CLONE) !== 0;
  }

  get superClass(): Reg {
    return this.vars[OBJECT_PROPERTY.SuperClass];
  }

  /** Indice de la propriété de ce sélecteur, ou −1. */
  propertyIndex(selector: number): number {
    const index = this.shape.index.get(selector);
    return index !== undefined && index < this.vars.length ? index : -1;
  }

  /**
   * Écrit une propriété. Comme l'interpréteur d'origine, toucher à l'une des propriétés graphiques (indices 26 à 44 : `x` … `yStep` pour `View`)
   * marque l'objet « à redessiner » dans `-info-`.
   */
  setProperty(index: number, value: Reg): void {
    this.vars[index] = value;
    if (index >= VIEW_PROPERTY_FIRST && index <= VIEW_PROPERTY_LAST) this.vars[OBJECT_PROPERTY.Info] |= INFO_VIEW_VISIBLE;
  }

  /** Copie pour `Clone` : mêmes forme et méthodes, propriétés dupliquées. */
  cloneObject(): SciObject {
    const copy = new SciObject(this.origin, this.vars.slice(), this.methods, this.codeSegment);
    copy.shape = this.shape;
    return copy;
  }
}

export const SelectorKind = { None: 0, Variable: 1, Method: 2 } as const;
export type SelectorKind = (typeof SelectorKind)[keyof typeof SelectorKind];

/** Résultat de `lookupSelector` (objet réutilisable, pour ne rien allouer à chaque envoi). */
export interface SelectorLookup {
  kind: SelectorKind;
  /** Propriété : son indice. */
  index: number;
  /** Méthode : segment du script et offset du code. */
  codeSegment: number;
  codeOffset: number;
}

export function newLookup(): SelectorLookup {
  return { kind: SelectorKind.None, index: -1, codeSegment: 0, codeOffset: 0 };
}

/**
 * Cherche `selector` sur un objet : d'abord ses propriétés, puis ses méthodes et celles de ses classes mères.
 * Remplit `out` et renvoie le genre trouvé.
 */
export function lookupSelector(memory: SegManager, object: SciObject, selector: number, out: SelectorLookup): SelectorKind {
  const index = object.propertyIndex(selector);
  if (index >= 0) {
    out.index = index;
    return (out.kind = SelectorKind.Variable);
  }
  for (let o: SciObject | undefined = object; o; o = memory.getObject(o.superClass)) {
    const codeOffset = o.methods.get(selector);
    if (codeOffset !== undefined) {
      out.codeSegment = o.codeSegment;
      out.codeOffset = codeOffset;
      return (out.kind = SelectorKind.Method);
    }
  }
  return (out.kind = SelectorKind.None);
}

function requireObject(memory: SegManager, reg: Reg): SciObject {
  const object = memory.getObject(reg);
  if (!object) throw new SciError(`${formatReg(reg)} n'est pas un objet`);
  return object;
}

/** Valeur d'une propriété ; 0 si l'objet ne l'a pas (comme `readSelector`). */
export function readSelector(memory: SegManager, reg: Reg, selector: number): Reg {
  const object = requireObject(memory, reg);
  const index = object.propertyIndex(selector);
  return index < 0 ? NULL_REG : object.vars[index];
}

/** Écrit une propriété ; lève une erreur si l'objet ne l'a pas. */
export function writeSelector(memory: SegManager, reg: Reg, selector: number, value: Reg): void {
  const object = requireObject(memory, reg);
  const index = object.propertyIndex(selector);
  if (index < 0) throw new SciError(`l'objet ${formatReg(reg)} n'a pas la propriété ${selector}`);
  object.setProperty(index, value);
}

/** Noms des sélecteurs (vocabulaire 997) et recherche par nom. */
export class SelectorTable {
  private readonly ids = new Map<string, number>();

  constructor(readonly names: readonly string[]) {
    // Un nom répété garde son premier numéro.
    names.forEach((name, id) => {
      if (!this.ids.has(name)) this.ids.set(name, id);
    });
  }

  /** Numéro du sélecteur de ce nom ; lève une erreur s'il n'existe pas. */
  id(name: string): number {
    const id = this.ids.get(name);
    if (id === undefined) throw new SciError(`sélecteur inconnu : ${name}`);
    return id;
  }

  /** Numéro du sélecteur de ce nom, ou −1. */
  find(name: string): number {
    return this.ids.get(name) ?? -1;
  }

  name(id: number): string {
    return this.names[id] ?? `selector_${id}`;
  }
}

/** Nom d'un objet (propriété `name`, cherchée par son sélecteur) ; chaîne vide s'il n'en a pas. */
export function objectName(memory: SegManager, reg: Reg, nameSelector: number): string {
  const object = memory.getObject(reg);
  if (!object) return "";
  const index = object.propertyIndex(nameSelector);
  if (index < 0 || object.vars[index] === NULL_REG) return "";
  try {
    return memory.getString(object.vars[index]);
  } catch {
    return "";
  }
}
