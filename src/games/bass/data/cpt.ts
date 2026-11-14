/**
 * `sky.cpt` : les « compacts » (objets, listes, tables du jeu), extraits de l'exécutable d'origine par ScummVM.
 *
 * Référence : ScummVM engines/sky/compact.cpp (`SkyCompact::SkyCompact`, `fetchCpt`, `fetchCptInfo`, `createResetData`,
 * `checkAndFixOfficerBluntError`), compact.h (`CptIds`, `CptTypeIds`) et skydefs.h (`ID_SC31_GUARD_TALK`, `ID_SC31_GUARD_TALK2`)
 * (GPL v3 ou ultérieure). Version visée : CD v0.0372.
 *
 * Disposition (petit-boutiste) : `u16` version (0), `u16` nombre de listes, une longueur `u16` par liste, `u32` taille des données brutes
 * (mots), `u32` taille source (mots) puis les entrées (`u16` taille ; si non nulle, `u16` type puis `taille` mots), `u32` taille des noms puis
 * les noms (chaînes C, un par compact non vide), `u16` nombre d'alias (« dlincs ») puis paires (alias, cible) suivies de leurs noms, `u16`
 * nombre de différences v0.0288 et `u16` taille puis mots, `u16` nombre d'identifiants à sauvegarder puis les identifiants, enfin les données
 * de remise à zéro jusqu'à la fin du fichier. Identifiant d'un compact = `(liste << 12) | rang`.
 *
 * Écarts volontaires :
 * - toutes les données brutes tiennent dans un seul `Uint16Array` (`raw`) ; un compact en est un sous-tableau (le moteur les modifie en place) ;
 * - un alias rend les données de sa cible ; son `type` et sa `size` sont ceux de la cible (ScummVM stocke 0 pour l'alias) ; un alias dont la cible est vide rend `undefined` ;
 * - `fetchCpt` de ScummVM s'arrête sur une assertion pour un identifiant hors des listes ; ici `get` lève `RangeError` ;
 * - les différences v0.0288 sont lues et exposées, jamais appliquées (seule la v0.0372 est visée).
 */

/** Taille imposée du fichier (`SKY_CPT_SIZE`). */
export const SKY_CPT_SIZE = 419427;
/** Valeur de `ID_SC31_GUARD_TALK` / `ID_SC31_GUARD_TALK2` (skydefs.h) et rang de l'entrée fautive de la table de parole (bogue 2687). */
export const ID_SC31_GUARD_TALK = 16607;
export const ID_SC31_GUARD_TALK2 = 16696;
export const OFFICER_BLUNT_TALK_INDEX = 158;
/** `CPT_TALK_TABLE_LIST` (compact.h). */
export const CPT_TALK_TABLE_LIST = 0xbc;

/** `CptTypeIds` (compact.h). */
export const CptType = {
  null: 0,
  compact: 1,
  turnTable: 2,
  animSeq: 3,
  miscBin: 4,
  getToTable: 5,
  routeBuf: 6,
  mainList: 7,
} as const;

export interface CptDiff288 {
  readonly id: number;
  /** Position (en mots) dans le compact. */
  readonly offset: number;
  readonly values: Uint16Array;
}

export interface CptEntry {
  /** Identifiant demandé. */
  readonly id: number;
  /** Mots du compact : vue sur `raw`, modifiable. Pour un alias, ceux de la cible. */
  readonly data: Uint16Array;
  /** Voir `CptType`. */
  readonly type: number;
  /** Nombre de mots. */
  readonly size: number;
  readonly name: string;
  /** Identifiant de la cible si `id` est un alias. */
  readonly aliasOf?: number;
}

export class SkyCpt {
  readonly raw: Uint16Array;
  /** Longueur de chaque liste. */
  readonly listLengths: readonly number[];
  /** Identifiants dont l'état est écrit dans une sauvegarde. */
  readonly saveIds: readonly number[];
  /** Paires (alias, cible) dans l'ordre du fichier. */
  readonly aliasPairs: ReadonlyArray<readonly [number, number]>;
  /** Différences propres à la v0.0288 (lues, non appliquées). */
  readonly diffs288: readonly CptDiff288[];
  /** Données de remise à zéro (v0.0288 + différences par version), telles que dans le fichier. */
  readonly resetData: Uint8Array;
  /** Vrai si la correction du bogue 2687 (Officer Blunt) a été appliquée au chargement. */
  readonly officerBluntFixed: boolean;

  private readonly sizes: Uint16Array[];
  private readonly types: Uint16Array[];
  private readonly offsets: Int32Array[];
  private readonly names: (string | null)[][];
  /** Cible des alias (identifiant), indexée comme les autres tables ; -1 si le compact n'est pas un alias. */
  private readonly aliases: Int32Array[];

  constructor(bytes: Uint8Array) {
    if (bytes.length !== SKY_CPT_SIZE) throw new Error(`sky.cpt invalide : ${bytes.length} octets, ${SKY_CPT_SIZE} attendus`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 0;
    const u16 = (): number => {
      if (pos + 2 > bytes.length) throw new Error("sky.cpt invalide : fin de fichier inattendue");
      const v = view.getUint16(pos, true);
      pos += 2;
      return v;
    };
    const u32 = (): number => {
      if (pos + 4 > bytes.length) throw new Error("sky.cpt invalide : fin de fichier inattendue");
      const v = view.getUint32(pos, true);
      pos += 4;
      return v;
    };

    if (u16() !== 0) throw new Error("sky.cpt invalide : version inconnue");
    const numLists = u16();
    const lengths: number[] = [];
    for (let i = 0; i < numLists; i++) lengths.push(u16());
    this.listLengths = lengths;

    const rawWords = u32();
    const srcWords = u32();
    const srcStart = pos;
    pos += srcWords * 2;
    const asciiSize = u32();
    const asciiStart = pos;
    pos += asciiSize;
    if (pos > bytes.length) throw new Error("sky.cpt invalide : tailles incohérentes");

    this.raw = new Uint16Array(rawWords);
    this.sizes = lengths.map((n) => new Uint16Array(n));
    this.types = lengths.map((n) => new Uint16Array(n));
    this.offsets = lengths.map((n) => new Int32Array(n).fill(-1));
    this.names = lengths.map((n) => new Array<string | null>(n).fill(null));
    this.aliases = lengths.map((n) => new Int32Array(n).fill(-1));

    const asciiEnd = asciiStart + asciiSize;
    let asciiPos = asciiStart;
    const nextName = (): string => {
      let end = asciiPos;
      while (end < asciiEnd && bytes[end] !== 0) end++;
      if (end >= asciiEnd) throw new Error("sky.cpt invalide : nom non terminé");
      let name = "";
      for (let i = asciiPos; i < end; i++) name += String.fromCharCode(bytes[i]!);
      asciiPos = end + 1;
      return name;
    };

    let src = srcStart;
    const srcEnd = srcStart + srcWords * 2;
    let rawPos = 0;
    for (let list = 0; list < numLists; list++) {
      for (let index = 0; index < lengths[list]!; index++) {
        if (src + 2 > srcEnd) throw new Error("sky.cpt invalide : liste de compacts tronquée");
        const size = view.getUint16(src, true);
        src += 2;
        this.sizes[list]![index] = size;
        if (size === 0) continue;
        if (src + 2 + size * 2 > srcEnd || rawPos + size > rawWords) throw new Error("sky.cpt invalide : compact hors des données");
        this.types[list]![index] = view.getUint16(src, true);
        src += 2;
        this.offsets[list]![index] = rawPos;
        this.names[list]![index] = nextName();
        for (let i = 0; i < size; i++, src += 2) this.raw[rawPos++] = view.getUint16(src, true);
      }
    }

    // Alias : ces compacts n'existent pas, ils désignent un autre compact.
    const aliasPairs: Array<readonly [number, number]> = [];
    const numDlincs = u16();
    const dlincStart = pos;
    pos += numDlincs * 4;
    if (pos > bytes.length) throw new Error("sky.cpt invalide : alias tronqués");
    for (let i = 0; i < numDlincs; i++) {
      const dlincId = view.getUint16(dlincStart + i * 4, true);
      const destId = view.getUint16(dlincStart + i * 4 + 2, true);
      const list = dlincId >> 12;
      const index = dlincId & 0xfff;
      if (list >= numLists || index >= lengths[list]! || this.offsets[list]![index]! >= 0 || this.aliases[list]![index]! >= 0) {
        throw new Error(`sky.cpt invalide : alias ${dlincId} incorrect`);
      }
      // La cible peut être vide (ScummVM copie alors un pointeur nul) : `get` rend alors `undefined`.
      if (this.slot(destId) === null) throw new Error(`sky.cpt invalide : l'alias ${dlincId} désigne ${destId}`);
      aliasPairs.push([dlincId, destId]);
      this.aliases[list]![index] = destId;
      this.names[list]![index] = nextName();
    }

    this.aliasPairs = aliasPairs;

    // Différences de la v0.0288 : lues pour valider la structure, non appliquées.
    const numDiffs = u16();
    const diffWords = u16();
    const diffEnd = pos + diffWords * 2;
    if (diffEnd > bytes.length) throw new Error("sky.cpt invalide : différences tronquées");
    const diffs: CptDiff288[] = [];
    for (let i = 0; i < numDiffs; i++) {
      if (pos + 6 > diffEnd) throw new Error("sky.cpt invalide : différence tronquée");
      const id = u16();
      const offset = u16();
      const length = u16();
      if (pos + length * 2 > diffEnd) throw new Error("sky.cpt invalide : différence tronquée");
      const values = new Uint16Array(length);
      for (let k = 0; k < length; k++) values[k] = u16();
      diffs.push({ id, offset, values });
    }
    if (pos !== diffEnd) throw new Error("sky.cpt invalide : taille des différences incohérente");
    this.diffs288 = diffs;

    const numSaveIds = u16();
    if (pos + numSaveIds * 2 > bytes.length) throw new Error("sky.cpt invalide : identifiants de sauvegarde tronqués");
    const saveIds: number[] = [];
    for (let i = 0; i < numSaveIds; i++) saveIds.push(u16());
    this.saveIds = saveIds;
    this.resetData = new Uint8Array(bytes.subarray(pos));

    // WORKAROUND du bogue 2687 : la première version de `sky.cpt` fait parler le garde au mauvais compact quand Foster est accroupi.
    const talkTable = this.get(CPT_TALK_TABLE_LIST)?.data;
    if (talkTable && talkTable[OFFICER_BLUNT_TALK_INDEX] === ID_SC31_GUARD_TALK) {
      talkTable[OFFICER_BLUNT_TALK_INDEX] = ID_SC31_GUARD_TALK2;
      this.officerBluntFixed = true;
    } else {
      this.officerBluntFixed = false;
    }
  }

  get listCount(): number {
    return this.listLengths.length;
  }

  /** Vérifie qu'un identifiant désigne un emplacement de liste ; `null` pour `0xFFFF` ; `RangeError` sinon. */
  private slot(id: number): { list: number; index: number } | null {
    if (id === 0xffff) return null;
    const list = id >> 12;
    const index = id & 0xfff;
    if (list >= this.listLengths.length || index >= this.listLengths[list]!) throw new RangeError(`compact ${id} hors des listes`);
    return { list, index };
  }

  /** Identifiant réel : l'identifiant lui-même, ou la cible d'un alias ; `undefined` si l'emplacement est vide. */
  resolve(id: number): number | undefined {
    const s = this.slot(id);
    if (!s) return undefined;
    const target = this.aliases[s.list]![s.index]!;
    if (target >= 0) {
      const t = this.slot(target)!;
      return this.offsets[t.list]![t.index]! >= 0 ? target : undefined;
    }
    return this.offsets[s.list]![s.index]! >= 0 ? id : undefined;
  }

  /** `fetchCptInfo` : données, type, taille et nom ; `undefined` pour `0xFFFF` ou un emplacement vide. */
  get(id: number): CptEntry | undefined {
    const target = this.resolve(id);
    if (target === undefined) return undefined;
    const real = this.slot(target)!;
    const offset = this.offsets[real.list]![real.index]!;
    const size = this.sizes[real.list]![real.index]!;
    const own = this.slot(id)!;
    const entry = {
      id,
      data: this.raw.subarray(offset, offset + size),
      type: this.types[real.list]![real.index]!,
      size,
      name: this.names[own.list]![own.index]!,
    };
    return target === id ? entry : { ...entry, aliasOf: target };
  }

  /** `findCptId` : identifiant d'après le nom (casse ignorée), `undefined` si absent. */
  findId(name: string): number | undefined {
    const wanted = name.toLowerCase();
    for (let list = 0; list < this.listLengths.length; list++) {
      for (let index = 0; index < this.listLengths[list]!; index++) {
        if (this.names[list]![index]?.toLowerCase() === wanted) return (list << 12) | index;
      }
    }
    return undefined;
  }

  /** Identifiants des compacts propres (hors alias), dans l'ordre des listes. */
  *realIds(): Generator<number> {
    for (let list = 0; list < this.listLengths.length; list++) {
      for (let index = 0; index < this.listLengths[list]!; index++) {
        if (this.offsets[list]![index]! >= 0) yield (list << 12) | index;
      }
    }
  }

  /** `createResetData` : état initial des compacts (mots) pour la version `gameVersion`, différences de cette version appliquées. */
  createResetData(gameVersion: number): Uint16Array {
    const view = new DataView(this.resetData.buffer, this.resetData.byteOffset, this.resetData.byteLength);
    let pos = 0;
    const u16 = (): number => {
      if (pos + 2 > this.resetData.length) throw new Error("données de remise à zéro tronquées");
      const v = view.getUint16(pos, true);
      pos += 2;
      return v;
    };
    const words = u16();
    const buf = new Uint16Array(words);
    for (let i = 0; i < words; i++) buf[i] = u16();
    const numDiffs = u16();
    for (let i = 0; i < numDiffs; i++) {
      const version = u16();
      const fields = u16();
      if (version === gameVersion) {
        for (let k = 0; k < fields; k++) {
          const at = u16();
          if (at >= words) throw new Error("données de remise à zéro : position hors tampon");
          buf[at] = u16();
        }
        return buf;
      }
      pos += fields * 4;
    }
    throw new Error(`pas de données de remise à zéro pour la version 0.0${gameVersion}`);
  }
}
