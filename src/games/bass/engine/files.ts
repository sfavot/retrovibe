/**
 * Fichiers chargés par le jeu (sprites, décors, séquences) : `SkyEngine::_itemList` et les listes de `Disk`.
 *
 * Référence : ScummVM engines/sky/disk.cpp (`fnCacheChip`, `fnCacheFast`, `fnCacheFiles`, `refreshFilesList`, `fnMiniLoad`,
 * `fnFlushBuffers`) et sky.cpp (`_itemList[300]`, `loadFixedItems`, `fetchItem`) (GPL v3 ou ultérieure).
 *
 * Un fichier est rangé à l'emplacement `numéro & 2047` de la table des objets (`fetchItem`). `loaded` est la liste des fichiers chargés
 * par le jeu (`_loadedFilesList`, 60 entrées, terminée par 0) : la sauvegarde l'enregistre, `refreshFilesList` la recharge. `build`
 * (`_buildList`) reçoit les listes de `fnCacheFast` puis `fnCacheChip`, qui charge ce qui manque et décharge ce qui n'est plus demandé.
 *
 * La logique ne lit les fichiers que par le moteur de sprites (`spriteEngine` met à 0 le `status` d'un compact dont le fichier manque) et
 * `stdSpeak` (taille du sprite qui parle) : l'état de ces listes fait donc partie de la fidélité.
 *
 * Écarts volontaires : un fichier absent de `sky.dsk` donne `null` et une ligne de journal (avertissement de ScummVM) ; les tableaux de 60
 * entrées ne débordent pas en silence (erreur).
 */

/** Taille de `_itemList`. */
export const ITEM_LIST_SIZE = 300;
/** Taille de `_loadedFilesList` et `_buildList`. */
export const FILE_LIST_SIZE = 60;

export interface FileSource {
  /** Contenu du fichier `id` (décompressé), ou `null` s'il n'existe pas. */
  load(id: number): Uint8Array | null;
}

export class ItemCache {
  /** `_itemList` : fichier par emplacement (`numéro & 2047`). */
  readonly items: (Uint8Array | null)[] = new Array<Uint8Array | null>(ITEM_LIST_SIZE).fill(null);
  /** `_loadedFilesList`, terminée par 0. */
  readonly loaded = new Uint32Array(FILE_LIST_SIZE);
  /** `_buildList`, terminée par 0. */
  readonly build = new Uint16Array(FILE_LIST_SIZE);

  constructor(
    private readonly source: FileSource,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** `fetchItem`. */
  fetch(num: number): Uint8Array | null {
    return this.items[num] ?? null;
  }

  private load(id: number): Uint8Array | null {
    const data = this.source.load(id);
    if (!data) this.log(`fnCacheFiles: Disk::loadFile() returned NULL for file ${id}`);
    return data;
  }

  private setItem(slot: number, data: Uint8Array | null): void {
    if (slot >= ITEM_LIST_SIZE) throw new RangeError(`emplacement d'objet ${slot} hors de _itemList`);
    this.items[slot] = data;
  }

  /** `loadFixedItems` (version complète). */
  loadFixedItems(ids: readonly number[]): void {
    for (const id of ids) this.setItem(id, this.load(id));
  }

  /** `fnCacheFast` : prépare la liste (terminée par 0) ; `null` ne change rien. */
  cacheFast(list: Uint16Array | null): void {
    if (!list) return;
    let cnt = 0;
    do {
      this.build[cnt] = list[cnt]! & 0x7fff;
      cnt = (cnt + 1) & 0xff;
    } while (list[(cnt - 1) & 0xff]);
  }

  /** `fnCacheChip` : ajoute la liste à la suite de celle de `fnCacheFast`, puis charge (`fnCacheFiles`). */
  cacheChip(list: Uint16Array): void {
    let cnt = 0;
    while (this.build[cnt]) cnt++;
    let f = 0;
    do {
      if (cnt + f >= FILE_LIST_SIZE) throw new RangeError("fnCacheChip : _buildList pleine");
      this.build[cnt + f] = list[f]! & 0x7fff;
      f++;
    } while (list[f - 1]);
    this.cacheFiles();
  }

  /** `fnCacheFiles`. */
  private cacheFiles(): void {
    let target = 0;
    for (let l = 0; this.loaded[l]; l++) {
      let found = false;
      for (let b = 0; this.build[b] && !found; b++) if ((this.build[b]! & 0x7fff) === this.loaded[l]) found = true;
      if (found) this.loaded[target++] = this.loaded[l]!;
      else this.setItem(this.loaded[l]! & 2047, null);
    }
    this.loaded[target] = 0;
    for (let b = 0; this.build[b]; b++) {
      const entry = this.build[b]!;
      if ((entry & 0x7ff) === 0x7ff) continue; // fichiers factices de la version Amiga
      let found = false;
      for (let l = 0; this.loaded[l] && !found; l++) if (this.loaded[l] === (entry & 0x7fff)) found = true;
      if (found) continue;
      if (target + 1 >= FILE_LIST_SIZE) throw new RangeError("fnCacheFiles : _loadedFilesList pleine");
      this.loaded[target++] = entry & 0x7fff;
      this.loaded[target] = 0;
      this.setItem(entry & 2047, this.load(entry & 0x7fff));
    }
    this.build[0] = 0;
  }

  /** `refreshFilesList` : décharge tout puis charge `list` (terminée par 0) ; restitution d'une partie. */
  refreshFilesList(list: ArrayLike<number>): void {
    for (let i = 0; this.loaded[i]; i++) this.setItem(this.loaded[i]! & 2047, null);
    let cnt = 0;
    while (list[cnt]) {
      if (cnt + 1 >= FILE_LIST_SIZE) throw new RangeError("refreshFilesList : liste trop longue");
      this.loaded[cnt] = list[cnt]!;
      this.setItem(this.loaded[cnt]! & 2047, this.load(this.loaded[cnt]! & 0x7fff));
      cnt++;
    }
    this.loaded[cnt] = 0;
  }

  /** `fnMiniLoad`. */
  miniLoad(fileNum: number): void {
    let cnt = 0;
    while (this.loaded[cnt]) {
      if (this.loaded[cnt] === fileNum) return;
      cnt++;
    }
    if (cnt + 1 >= FILE_LIST_SIZE) throw new RangeError("fnMiniLoad : _loadedFilesList pleine");
    this.loaded[cnt] = fileNum & 0x7fff;
    this.loaded[cnt + 1] = 0;
    this.setItem(fileNum & 2047, this.load(fileNum));
  }

  /** `fnFlushBuffers`. */
  flushBuffers(): void {
    for (let l = 0; this.loaded[l]; l++) this.setItem(this.loaded[l]! & 2047, null);
    this.loaded[0] = 0;
  }

  /** Liste des fichiers chargés, sans le 0 final (sauvegarde : 60 mots). */
  loadedList(): number[] {
    const out: number[] = [];
    for (let i = 0; this.loaded[i]; i++) out.push(this.loaded[i]!);
    return out;
  }
}
