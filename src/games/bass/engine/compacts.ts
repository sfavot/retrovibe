/**
 * Magasin des compacts du moteur : données de `sky.cpt` modifiables en place, accès aux champs, alias, état de sauvegarde.
 *
 * Référence : ScummVM engines/sky/compact.cpp (`fetchCpt`, `fetchCptInfo`, `cptIsId`, `getSub`, `setSub`, `getGrafixPtr`, `getMegaSet`,
 * `getTurnTable`, `getCompactElem`), struc.h, control.cpp (`parseSaveData`, partie compacts) (GPL v3 ou ultérieure).
 *
 * Un compact est désigné par une **vue** `Uint16Array` qui commence à son premier mot et court jusqu'à la fin des données brutes : comme
 * le pointeur `Compact *` de ScummVM, un accès au-delà de la taille du compact lit le compact suivant (les compacts sont contigus dans
 * `_rawBuf`, dans l'ordre des listes, comme ici). Les champs sont des indices de mot (`CompactField`), les scripts les adressent par
 * décalage DOS (`getElem` / `setElem`). Tout est `u16` : une écriture s'enroule modulo 2¹⁶.
 *
 * Écarts volontaires : `fetch` lève `RangeError` hors des listes (assertion de ScummVM) ; un mode de script invalide, un `MegaSet` invalide ou
 * une table de rotation absente lèvent une erreur (`error()` de ScummVM) ; les données brutes sont une copie de celles de `SkyCpt` (le
 * lecteur reste partageable en lecture seule).
 */

import type { SkyCpt } from "../data/cpt";
import { CompactField, MegaSetField, compactElemLocation, megaSetBase, megaSetIndex } from "../data/compact-fields";

/** Vue sur un compact (premier mot = `logic` pour un compact de type `CptType.compact`). */
export type CompactView = Uint16Array;

const MAX_LISTS = 16;

export class Compacts {
  /** Données brutes, modifiées par le moteur. */
  readonly raw: Uint16Array;
  readonly saveIds: readonly number[];
  readonly listLengths: readonly number[];
  /** Mot de départ de chaque identifiant (alias résolus), -1 si vide ; indexé par l'identifiant. */
  private readonly bases: Int32Array;
  private readonly sizes: Uint16Array;
  private readonly types: Uint8Array;
  private readonly names: (string | undefined)[];
  private readonly views: (CompactView | undefined)[];

  constructor(private readonly cpt: SkyCpt) {
    this.raw = new Uint16Array(cpt.raw);
    this.saveIds = cpt.saveIds;
    this.listLengths = cpt.listLengths;
    const span = MAX_LISTS << 12;
    this.bases = new Int32Array(span).fill(-1);
    this.sizes = new Uint16Array(span);
    this.types = new Uint8Array(span);
    this.names = new Array<string | undefined>(span);
    this.views = new Array<CompactView | undefined>(span);
    for (let list = 0; list < cpt.listLengths.length; list++) {
      for (let index = 0; index < cpt.listLengths[list]!; index++) {
        const id = (list << 12) | index;
        const entry = cpt.get(id);
        if (!entry) continue;
        this.bases[id] = (entry.data.byteOffset - cpt.raw.byteOffset) / 2;
        this.sizes[id] = entry.size;
        this.types[id] = entry.type;
        this.names[id] = entry.name;
      }
    }
  }

  /** Vérifie l'identifiant comme l'assertion de `fetchCpt`. */
  private check(id: number): void {
    const list = id >> 12;
    if (!Number.isInteger(id) || id < 0 || list >= this.listLengths.length || (id & 0xfff) >= this.listLengths[list]!) {
      throw new RangeError(`compact ${id} hors des listes`);
    }
  }

  /** `fetchCpt` : vue sur le compact, `null` pour `0xFFFF` ou un emplacement vide (pointeur nul). */
  fetch(id: number): CompactView | null {
    if (id === 0xffff) return null;
    this.check(id);
    const base = this.bases[id]!;
    if (base < 0) return null;
    let view = this.views[id];
    if (!view) {
      view = this.raw.subarray(base);
      this.views[id] = view;
    }
    return view;
  }

  /** `fetch` qui exige un compact : déréférencer un pointeur nul planterait ScummVM, ici une erreur explicite. */
  require(id: number): CompactView {
    const view = this.fetch(id);
    if (!view) throw new Error(`compact ${id} absent (pointeur nul)`);
    return view;
  }

  has(id: number): boolean {
    return id !== 0xffff && this.fetch(id) !== null;
  }

  /** Taille (mots), type et nom d'un identifiant (`fetchCptInfo`) ; taille 0 si vide. */
  info(id: number): { size: number; type: number; name: string } {
    this.check(id);
    return { size: this.sizes[id]!, type: this.types[id]!, name: this.names[id] ?? "(null)" };
  }

  /** `cptIsId` : la vue désigne le même compact que `id` (alias compris). */
  isId(view: CompactView, id: number): boolean {
    const other = this.fetch(id);
    return other !== null && other.byteOffset === view.byteOffset;
  }

  /** Identifiant d'une vue (`findCptId(void *)`), 0 si inconnu (journal seulement). */
  idOf(view: CompactView): number {
    const base = (view.byteOffset - this.raw.byteOffset) / 2;
    for (let id = 0; id < this.bases.length; id++) if (this.bases[id] === base && this.cpt.resolve(id) === id) return id;
    return 0;
  }

  /** Type d'un identifiant (`CptType`). */
  typeOf(id: number): number {
    this.check(id);
    return this.types[id]!;
  }

  // --- Champs adressés par les scripts ---

  /** Tableau et indice du mot désigné par le décalage DOS `off` (`getCompactElem`). */
  private elem(cpt: CompactView, off: number): [Uint16Array, number] {
    const location = compactElemLocation(off);
    if (location.source === "compact") return [cpt, location.word];
    const base = megaSetBase(location.megaSet);
    if (location.source === "megaSet") return [cpt, base + location.word];
    const turnTable = this.fetch(cpt[base + MegaSetField.turnTableId]!);
    if (!turnTable) throw new Error(`table de rotation absente (MegaSet ${location.megaSet})`);
    return [turnTable, location.word];
  }

  /** Lit le mot désigné par le décalage DOS `off`. */
  getElem(cpt: CompactView, off: number): number {
    const [array, index] = this.elem(cpt, off);
    return array[index]!;
  }

  /** Écrit le mot désigné par le décalage DOS `off` (modulo 2¹⁶). */
  setElem(cpt: CompactView, off: number, value: number): void {
    const [array, index] = this.elem(cpt, off);
    array[index] = value;
  }

  // --- Niveaux de script ---

  /** `getSub` : `mode` est un décalage en octets (0 base, 2 base_off, 4 action… 14 extra_off). */
  getSub(cpt: CompactView, mode: number): number {
    return cpt[subField(mode)]!;
  }

  setSub(cpt: CompactView, mode: number, value: number): void {
    cpt[subField(mode)] = value;
  }

  // --- Animations, MegaSet, rotations ---

  /** Programme graphique courant (`getGrafixPtr`) : données et position, ou `null` si `grafixProgId` désigne un compact vide. */
  grafix(cpt: CompactView): { data: Uint16Array; pos: number } | null {
    const data = this.fetch(cpt[CompactField.grafixProgId]!);
    return data ? { data, pos: cpt[CompactField.grafixProgPos]! } : null;
  }

  /** Premier mot du `MegaSet` actif (`getMegaSet`) ; erreur si `megaSet` n'est pas 0, 144, 288 ou 432. */
  megaSetWordBase(cpt: CompactView): number {
    return megaSetBase(megaSetIndex(cpt[CompactField.megaSet]!));
  }

  /** Mot `field` (`MegaSetField`) du `MegaSet` actif. */
  megaSetWord(cpt: CompactView, field: number): number {
    return cpt[this.megaSetWordBase(cpt) + field]!;
  }

  /** `getTurnTable` : les cinq mots de la table de rotation de la direction `dir` (0 à 4), vue modifiable. */
  turnTable(cpt: CompactView, dir: number): Uint16Array {
    if (!Number.isInteger(dir) || dir < 0 || dir > 4) throw new Error(`pas de table de rotation ${dir} (MegaSet ${cpt[CompactField.megaSet]})`);
    const table = this.fetch(this.megaSetWord(cpt, MegaSetField.turnTableId));
    if (!table) throw new Error("table de rotation absente");
    return table.subarray(dir * 5, dir * 5 + 5);
  }

  // --- Sauvegarde ---

  /** Nombre de mots de l'état sauvegardé (somme des tailles des `saveIds`). */
  get saveWords(): number {
    let n = 0;
    for (const id of this.saveIds) n += this.info(id).size;
    return n;
  }

  /** Recopie l'état sauvegardé (`parseSaveData`, révision 6) depuis `words` à partir de `at` ; rend la position suivante. */
  loadSaveWords(words: Uint16Array, at: number): number {
    let pos = at;
    for (const id of this.saveIds) {
      const size = this.info(id).size;
      const view = this.fetch(id);
      if (!view) throw new Error(`compact à sauvegarder ${id} vide`);
      if (pos + size > words.length) throw new Error("données de compacts tronquées");
      view.set(words.subarray(pos, pos + size));
      pos += size;
    }
    return pos;
  }

  /** Copie de l'état sauvegardé (même ordre que `loadSaveWords`). */
  saveState(): Uint16Array {
    const out = new Uint16Array(this.saveWords);
    let pos = 0;
    for (const id of this.saveIds) {
      const size = this.info(id).size;
      out.set(this.require(id).subarray(0, size), pos);
      pos += size;
    }
    return out;
  }
}

/** Champ `xxxSub` / `xxxSub_off` d'un mode (`getSub`) ; erreur « Invalid Mode » sinon. */
function subField(mode: number): number {
  if (!Number.isInteger(mode) || mode < 0 || mode > 14 || mode & 1) throw new Error(`mode de script invalide (${mode})`);
  return CompactField.baseSub + mode / 2;
}
