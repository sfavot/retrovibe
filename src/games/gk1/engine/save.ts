/**
 * Sauvegardes de Gabriel Knight : image complète de la machine virtuelle et de ce qui l'entoure, en JSON versionné
 * (`docs/gk1/plan.md`, D10 et vague S2).
 *
 * Référence : `engines/sci/engine/savegame.cpp` de ScummVM (`gamestate_save`, `gamestate_restore`, `SegManager`,
 * `EngineState::saveLoadWithSerializer`, `syncWithScripts`), GPL v3 ou ultérieure, lu pour la liste de ce qui compose l'état
 * d'une partie ; le format et la reprise sont propres au port.
 *
 * **Ce qu'une image contient** :
 * - la mémoire des scripts : pile entière, clones, listes, nœuds, tableaux, bitmaps (avec l'ordre de réemploi des cases
 *   libres : les allocations suivantes rendent les mêmes références), segments de scripts dans leur ordre (propriétés des
 *   objets, variables locales, compteurs de demandes, heap seulement s'il diffère de la ressource, en différence), table des
 *   classes ;
 * - la machine virtuelle : registres, **pile d'exécution** (trames et état des continuations du noyau), horloge, générateur
 *   aléatoire, décompte du ramasse-miettes ;
 * - le graphisme : plans, éléments d'écran, palette (variation, cycles, fondus), remaps, transitions, curseur ;
 * - le son : emplacements et canaux du gestionnaire de sons, pilote General MIDI, canaux numériques, synchronisation labiale ;
 * - le curseur de lecture des messages, le drapeau de redémarrage, le tableau du dossier des sauvegardes.
 *
 * **Reprise à l'identique.** L'image est prise *pendant* `SaveGame` (accumulateur mis à 1, comme au retour de la fonction) ou
 * entre deux images (`saveToSlot`), et la reprise remplace l'état **en place** : `RestoreGame` peut la faire depuis les
 * scripts, `run` continue dans les trames reprises. Les images qui suivent une reprise sont celles d'une exécution qui n'aurait
 * pas été interrompue (`test/gk1/engine/save.test.ts`). Rien n'est rejoué : pas de `replay` ni de `GameIsRestarting`, la
 * partie reprend à l'instruction qui suit `SaveGame`, dans la fenêtre de sauvegarde du jeu, qui se referme.
 *
 * **Pas dans l'image** (voir `engine.md` § 7) : une cinématique `SEQ` en cours (toile et image décodée : la sauvegarde est
 * refusée, comme dans l'original où la fenêtre ne s'ouvre pas) ; l'image composée (refaite au `FrameOut` suivant) ; la file
 * d'évènements et les boutons tenus (vidés) ; les fichiers ouverts par `FileIO` (fermés) ; les notes qui sonnaient (non
 * rejouées, comme ScummVM) et la voix d'une réplique en cours (elle finit en silence) ; les réglages de la page (son coupé,
 * sorties audio, sources de fichiers, horloge du système).
 *
 * **Taille** : environ 100 000 caractères dans la librairie. Les propriétés des objets sont écrites en différence avec la
 * ressource (ou, pour un clone, avec l'objet dont il vient), les valeurs par plans d'octets puis par plages, et le
 * ramasse-miettes passe avant la sauvegarde (`collectBeforeSave`).
 *
 * **Emplacements** : `SaveSlots` du site, 20 emplacements comme la fenêtre du jeu (`SAVE_SLOT_COUNT`) ; la sauvegarde numéro
 * `n` du jeu (à partir de 0) est l'emplacement `n + 1`. Sans stockage fourni par la page (`useSaveStorage`), un stockage en
 * mémoire : la fenêtre du jeu marche aussi sans tête.
 */
import { SaveSlots, type StoredSave } from "../../../engine/save-slots";
import { type HostStorage, MemoryStorage } from "../../../engine/storage";
import { digitalAudioOf } from "../audio/digital";
import { seqPlayerOf } from "../render/seq-player";
import { frameoutOf } from "../render/frameout";
import { eventsOf } from "./events";
import { collectGarbage } from "./gc";
import { ArrayType, LIST_MAX_RECURSION } from "./ids";
import { lipSyncOf } from "./kernel/audio";
import { soundDriverOf, soundManagerOf } from "./kernel/sound";
import { currentRoom } from "./loop";
import { type LocalsSegment, NULL_REG, type Reg, SciArray, type SciBitmap, SciError, type SciList, type SciNode, type ScriptSegment, SegmentKind, type Table, TABLE_CAPACITY } from "./memory";
import { messagesOf } from "./message";
import { SciObject } from "./object";
import { loadInstance, packBytes, packWords, saveInstance, unpackBytes, unpackWords } from "./save-codec";
import { type LocalsImage, type MemoryImage, parseSaveImage, SAVE_FORMAT, SAVE_NAME_LENGTH, SAVE_SLOT_COUNT, SAVE_VERSION, type SaveImage, type ScriptImage, type TableImage } from "./save-image";
import type { SavedSegment } from "./scripts";
import { textEntryOf } from "./text-entry";
// Import de valeur malgré le cycle (`vm.ts` charge le noyau, qui charge ce module) : `Vm` ne sert qu'à l'exécution, dans `restartGame`.
import { Vm } from "./vm";

/** Mots d'une liste dans l'image : premier nœud, dernier, itérations en cours, puis le nœud suivant de chacune. */
const LIST_HEADER_WORDS = 3;
const LIST_WORDS = LIST_HEADER_WORDS + LIST_MAX_RECURSION;
const NODE_WORDS = 4;

export { parseSaveImage, SAVE_FORMAT, SAVE_NAME_LENGTH, SAVE_SLOT_COUNT, SAVE_VERSION, type SaveImage } from "./save-image";

// -------------------------------------------------------------------------------------------------------------------------------
// Stockage
// -------------------------------------------------------------------------------------------------------------------------------

/** Ce que les fonctions du noyau partagent autour des sauvegardes d'une machine virtuelle. */
export interface SaveStore {
  /** Stockage du jeu, déjà préfixé (`gk1:`) : les emplacements, et les fichiers écrits par `FileIO` (`file:NOM`). */
  storage: HostStorage;
  slots: SaveSlots<SaveImage>;
  /** Date d'écriture d'une sauvegarde (millisecondes depuis 1970). */
  now: () => number;
  /** Valeur de `GameIsRestarting` : 1 après `RestartGame`, jusqu'à ce que les scripts la remettent à zéro. */
  restarting: number;
  /** Tableau de caractères rendu par `GetSaveDir` (nul avant le premier appel). */
  saveDir: Reg;
  /** Rappelés après chaque reprise ou redémarrage : ce qui tient un état hors de l'image s'y remet à zéro. */
  readonly restored: (() => void)[];
}

function newSlots(storage: HostStorage): SaveSlots<SaveImage> {
  return new SaveSlots<SaveImage>(storage, { count: SAVE_SLOT_COUNT, parse: parseSaveImage, name: "Gabriel Knight" });
}

const stores = new WeakMap<Vm, SaveStore>();

/** Le stockage des sauvegardes de cette machine virtuelle (en mémoire tant que la page n'a pas appelé `useSaveStorage`). */
export function saveStoreOf(vm: Vm): SaveStore {
  let store = stores.get(vm);
  if (!store) {
    const storage = new MemoryStorage();
    const created: SaveStore = { storage, slots: newSlots(storage), now: () => Date.now(), restarting: 0, saveDir: NULL_REG, restored: [] };
    stores.set(vm, (store = created));
    vm.gcRoots.push(() => [created.saveDir]);
  }
  return store;
}

/** La page branche le stockage du site : `storage` est déjà préfixé (`prefixedStorage(store, "gk1:")`). */
export function useSaveStorage(vm: Vm, storage: HostStorage, now: () => number = () => Date.now()): void {
  const store = saveStoreOf(vm);
  store.storage = storage;
  store.slots = newSlots(storage);
  store.now = now;
}

// -------------------------------------------------------------------------------------------------------------------------------
// Prise d'une image
// -------------------------------------------------------------------------------------------------------------------------------

/** Faux pendant une cinématique `SEQ` : son état (toile, image décodée) n'est pas dans l'image. */
export function canSaveGame(vm: Vm): boolean {
  return vm.frames.length > 0 && !seqPlayerOf(vm).playing;
}

function tableImage<T>(table: Table<T>): { image: TableImage; entries: T[] } {
  const { entries, free } = table.dump();
  const index: number[] = [];
  const kept: T[] = [];
  entries.forEach((entry, at) => {
    if (entry === undefined) return;
    index.push(at);
    kept.push(entry);
  });
  return { image: { index, free: [...free], length: entries.length }, entries: kept };
}

function concatWords(parts: readonly ArrayLike<number>[]): Uint32Array {
  const out = new Uint32Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function arrayContent(array: SciArray): Uint8Array | Uint32Array {
  const out = array.isByteArray ? new Uint8Array(array.size) : new Uint32Array(array.size);
  for (let i = 0; i < array.size; i++) out[i] = array.get(i);
  return out;
}

function segmentImage(segment: ScriptSegment | LocalsSegment): ScriptImage | LocalsImage {
  if (segment.kind === SegmentKind.Locals) return { k: SegmentKind.Locals, n: segment.scriptNumber, values: packWords(segment.values) };
  const source = segment.source;
  const image: ScriptImage = {
    k: SegmentKind.Script,
    n: segment.number,
    loaded: source !== undefined,
    lockers: segment.lockers,
    deleted: segment.deleted,
    locals: segment.localsSegment,
    vars: packWords(concatWords(source ? source.objects.map((data) => segment.objects.get(data.offset)!.vars.map((value, at) => value ^ data.values[at])) : [])),
  };
  if (source && segment.heap.some((byte, at) => byte !== source.heap[at])) image.heap = packBytes(segment.heap.map((byte, at) => byte ^ source.heap[at]));
  return image;
}

/**
 * Propriétés d'un clone en OU exclusif avec celles, actuelles, de l'objet de script dont il vient : un clone garde la plupart
 * des valeurs de sa classe. L'opération est sa propre inverse (les objets des scripts sont repris avant les clones).
 */
function differenceFromOrigin(vm: Vm, origin: Reg, vars: Uint32Array): Uint32Array {
  const model = vm.memory.getObject(origin)?.vars;
  if (!model) throw new SciError("sauvegarde : clone d'un objet inconnu");
  return vars.map((value, at) => value ^ (model[at] ?? 0));
}

function memoryImage(vm: Vm): MemoryImage {
  const memory = vm.memory;
  const clones = tableImage(memory.clones);
  const lists = tableImage(memory.lists);
  const nodes = tableImage(memory.nodes);
  const arrays = tableImage(memory.arrays);
  const bitmaps = tableImage(memory.bitmaps);
  const contents = arrays.entries.map(arrayContent);
  return {
    stack: packWords(memory.stack),
    clones: {
      ...clones.image,
      origin: packWords(Uint32Array.from(clones.entries, (clone) => clone.origin)),
      freed: clones.entries.flatMap((clone, at) => (clone.freed ? [at] : [])),
      sizes: clones.entries.map((clone) => clone.vars.length),
      vars: packWords(concatWords(clones.entries.map((clone) => differenceFromOrigin(vm, clone.origin, clone.vars)))),
    },
    lists: { ...lists.image, data: packWords(concatWords(lists.entries.map((list) => [list.first, list.last, list.recursions, ...list.nextNodes]))) },
    nodes: { ...nodes.image, data: packWords(concatWords(nodes.entries.map((node) => [node.pred, node.succ, node.key, node.value]))) },
    arrays: {
      ...arrays.image,
      types: arrays.entries.map((array) => array.type),
      sizes: arrays.entries.map((array) => array.size),
      bytes: packBytes(concatBytes(contents.filter((content): content is Uint8Array => content instanceof Uint8Array))),
      words: packWords(concatWords(contents.filter((content): content is Uint32Array => content instanceof Uint32Array))),
    },
    bitmaps: {
      ...bitmaps.image,
      widths: bitmaps.entries.map((bitmap) => bitmap.width),
      heights: bitmaps.entries.map((bitmap) => bitmap.height),
      skips: bitmaps.entries.map((bitmap) => bitmap.skipColor),
      pixels: packBytes(concatBytes(bitmaps.entries.map((bitmap) => bitmap.pixels))),
    },
    segments: memory.dynamicSegments().map(segmentImage),
    classes: packWords(Uint32Array.from(vm.scripts.classAddresses())),
  };
}

/**
 * Passe le ramasse-miettes avant une sauvegarde : les clones libérés par les scripts (plus de mille dans la librairie) et
 * leurs listes n'ont pas à être écrits. `roots` : références que l'appelant tient hors de la pile (les arguments d'une
 * fonction du noyau, déjà dépilés). La partie qui continue et celle qui sera reprise partent du même état, nettoyé.
 */
export function collectBeforeSave(vm: Vm, roots: ArrayLike<Reg> = []): void {
  const extra = (): Iterable<Reg> => Array.from(roots);
  vm.gcRoots.push(extra);
  try {
    collectGarbage(vm);
  } finally {
    vm.gcRoots.splice(vm.gcRoots.indexOf(extra), 1);
  }
}

/**
 * Prend l'image de la partie. À appeler entre deux images, ou depuis une fonction du noyau (la pile d'exécution est alors
 * celle du retour de cette fonction : à l'appelant de fixer `image.vm.acc`). Lève une erreur si `canSaveGame` est faux.
 */
export function captureGame(vm: Vm, name = "", gameVersion = ""): SaveImage {
  if (!canSaveGame(vm)) throw new SciError("sauvegarde impossible maintenant (cinématique en cours, ou jeu pas démarré)");
  const store = saveStoreOf(vm);
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    name: name.slice(0, SAVE_NAME_LENGTH),
    gameVersion,
    room: currentRoom(vm),
    vm: vm.saveState(),
    memory: memoryImage(vm),
    frameout: saveInstance(frameoutOf(vm)),
    sound: { driver: saveInstance(soundDriverOf(vm)), manager: saveInstance(soundManagerOf(vm)) },
    digital: digitalAudioOf(vm).saveState(),
    lipSync: saveInstance(lipSyncOf(vm)),
    messages: saveInstance(messagesOf(vm)),
    kernel: { restarting: store.restarting, saveDir: store.saveDir },
  };
}

// -------------------------------------------------------------------------------------------------------------------------------
// Reprise
// -------------------------------------------------------------------------------------------------------------------------------

const isCount = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const isCountList = (value: unknown, max: number): value is number[] => Array.isArray(value) && value.every((item) => isCount(item, max));

/**
 * Vérifie les nombres de l'image qui servent de tailles ou d'indices, avant toute allocation : une image forgée ou abîmée est
 * refusée ici (`SciError`, comme les autres images incohérentes) au lieu de réserver une mémoire démesurée ou de boucler longtemps.
 */
function checkMemoryImage(image: MemoryImage): void {
  const bad = (what: string): never => {
    throw new SciError(`sauvegarde : ${what} invalide`);
  };
  const table = (what: string, t: TableImage): void => {
    if (!t || !isCount(t.length, TABLE_CAPACITY) || !isCountList(t.index, t.length - 1) || !isCountList(t.free, t.length - 1)) bad(`table des ${what}`);
  };
  table("clones", image.clones);
  table("listes", image.lists);
  table("nœuds", image.nodes);
  table("tableaux", image.arrays);
  table("bitmaps", image.bitmaps);
  const { clones, arrays, bitmaps } = image;
  if (!isCountList(clones.freed, TABLE_CAPACITY) || !isCountList(clones.sizes, 0xffff) || clones.sizes.length !== clones.index.length) bad("clones");
  if (!isCountList(arrays.types, 0xff) || !isCountList(arrays.sizes, 0xffff) || arrays.types.length !== arrays.index.length || arrays.sizes.length !== arrays.index.length) bad("tableaux");
  const dimensions = [bitmaps.widths, bitmaps.heights, bitmaps.skips];
  if (!dimensions.every((list) => Array.isArray(list) && list.length === bitmaps.index.length) || !isCountList(bitmaps.widths, 0xffff) || !isCountList(bitmaps.heights, 0xffff)) bad("bitmaps");
  const strings = [image.stack, image.classes, clones.origin, clones.vars, image.lists.data, image.nodes.data, arrays.bytes, arrays.words, bitmaps.pixels];
  if (strings.some((text) => typeof text !== "string")) bad("bloc de valeurs");
}

function loadTable<T>(table: Table<T>, image: TableImage, entries: readonly T[]): void {
  if (entries.length !== image.index.length) throw new SciError("sauvegarde : table tronquée");
  const cells = new Array<T | undefined>(image.length).fill(undefined);
  image.index.forEach((at, i) => (cells[at] = entries[i]));
  table.load(cells, image.free);
}

/** Découpe `words` en tranches des tailles données. */
function slices(words: Uint32Array, sizes: readonly number[]): Uint32Array[] {
  let at = 0;
  const out = sizes.map((size) => words.slice(at, (at += size)));
  if (at !== words.length) throw new SciError("sauvegarde : bloc de valeurs d'une autre taille");
  return out;
}

function savedSegment(image: ScriptImage | LocalsImage): SavedSegment {
  if (image.k === SegmentKind.Locals) return { kind: SegmentKind.Locals, scriptNumber: image.n, values: unpackWords(image.values) };
  return {
    kind: SegmentKind.Script,
    number: image.n,
    loaded: image.loaded,
    lockers: image.lockers,
    deleted: image.deleted,
    localsSegment: image.locals,
    heapDelta: image.heap === undefined ? undefined : unpackBytes(image.heap),
    vars: unpackWords(image.vars),
  };
}

function loadMemory(vm: Vm, image: MemoryImage): void {
  const memory = vm.memory;
  checkMemoryImage(image);
  memory.reset();
  const stack = unpackWords(image.stack);
  if (stack.length !== memory.stack.length) throw new SciError("sauvegarde : pile d'une autre taille");
  memory.stack.set(stack);
  vm.scripts.restore(
    image.segments.map(savedSegment),
    Array.from(unpackWords(image.classes)),
  );

  const origins = unpackWords(image.clones.origin);
  const freed = new Set(image.clones.freed);
  loadTable(
    memory.clones,
    image.clones,
    slices(unpackWords(image.clones.vars), image.clones.sizes).map((vars, at) => {
      const origin = memory.getObject(origins[at]);
      if (!origin) throw new SciError("sauvegarde : clone d'un objet inconnu");
      const clone = new SciObject(origins[at], differenceFromOrigin(vm, origins[at], vars), origin.methods, origin.codeSegment);
      clone.shape = origin.shape;
      clone.freed = freed.has(at);
      return clone;
    }),
  );

  const listWords = unpackWords(image.lists.data);
  loadTable<SciList>(
    memory.lists,
    image.lists,
    image.lists.index.map((_, at) => {
      const words = listWords.subarray(at * LIST_WORDS, (at + 1) * LIST_WORDS);
      return { first: words[0], last: words[1], recursions: words[2], nextNodes: Array.from(words.subarray(LIST_HEADER_WORDS)) };
    }),
  );
  const nodeWords = unpackWords(image.nodes.data);
  loadTable<SciNode>(
    memory.nodes,
    image.nodes,
    image.nodes.index.map((_, at) => ({ pred: nodeWords[at * NODE_WORDS], succ: nodeWords[at * NODE_WORDS + 1], key: nodeWords[at * NODE_WORDS + 2], value: nodeWords[at * NODE_WORDS + 3] })),
  );

  const bytes = unpackBytes(image.arrays.bytes);
  const words = unpackWords(image.arrays.words);
  // Les tailles annoncées doivent correspondre exactement aux octets et mots fournis (aucune boucle sur une taille non couverte).
  let byteTotal = 0;
  let wordTotal = 0;
  image.arrays.types.forEach((type, at) => {
    if (type === ArrayType.Byte || type === ArrayType.String) byteTotal += image.arrays.sizes[at];
    else wordTotal += image.arrays.sizes[at];
  });
  if (byteTotal !== bytes.length || wordTotal !== words.length) throw new SciError("sauvegarde : tableaux d'une autre taille");
  let byteAt = 0;
  let wordAt = 0;
  loadTable(
    memory.arrays,
    image.arrays,
    image.arrays.types.map((type, at) => {
      const size = image.arrays.sizes[at];
      const array = new SciArray(type as ArrayType, size);
      const isBytes = type === ArrayType.Byte || type === ArrayType.String;
      for (let i = 0; i < size; i++) array.set(i, isBytes ? bytes[byteAt++] : words[wordAt++]);
      return array;
    }),
  );
  if (byteAt !== bytes.length || wordAt !== words.length) throw new SciError("sauvegarde : tableaux d'une autre taille");

  const pixels = unpackBytes(image.bitmaps.pixels);
  let pixelAt = 0;
  loadTable<SciBitmap>(
    memory.bitmaps,
    image.bitmaps,
    image.bitmaps.widths.map((width, at) => {
      const height = image.bitmaps.heights[at];
      return { width, height, skipColor: image.bitmaps.skips[at], pixels: pixels.slice(pixelAt, (pixelAt += width * height)) };
    }),
  );
  if (pixelAt !== pixels.length) throw new SciError("sauvegarde : bitmaps d'une autre taille");
}

function applyImage(vm: Vm, image: SaveImage): void {
  const store = saveStoreOf(vm);
  soundManagerOf(vm).silence();
  seqPlayerOf(vm).cancel();
  loadMemory(vm, image.memory);
  vm.loadState(image.vm);
  loadInstance(frameoutOf(vm), image.frameout);
  loadInstance(soundDriverOf(vm), image.sound.driver);
  loadInstance(soundManagerOf(vm), image.sound.manager);
  soundDriverOf(vm).resync();
  soundManagerOf(vm).resync();
  digitalAudioOf(vm).loadState(image.digital);
  loadInstance(lipSyncOf(vm), image.lipSync);
  loadInstance(messagesOf(vm), image.messages);
  store.restarting = image.kernel.restarting;
  store.saveDir = image.kernel.saveDir;
  eventsOf(vm).clear();
  textEntryOf(vm).close();
  for (const restored of store.restored) restored();
}

/**
 * Remplace l'état de `vm` par celui de l'image, en place. Utilisable sur une machine virtuelle neuve (à la place de `boot`),
 * entre deux images, ou depuis une fonction du noyau. Une image incohérente lève une erreur **et l'état d'avant est rétabli**
 * (quand il pouvait être sauvé : hors cinématique).
 */
export function restoreGame(vm: Vm, image: SaveImage): void {
  const backup = canSaveGame(vm) ? captureGame(vm) : undefined;
  try {
    applyImage(vm, image);
  } catch (error) {
    if (backup) applyImage(vm, backup);
    throw error;
  }
}

/**
 * Redémarre le jeu (`RestartGame`) : tout l'état revient à celui d'une machine virtuelle neuve, puis `play` est relancé ;
 * `GameIsRestarting` répond 1 jusqu'à ce que les scripts le remettent à zéro.
 */
export function restartGame(vm: Vm): void {
  const blank = new Vm(vm.resources.index, vm.fixes);
  // Une machine neuve n'a pas de trame : son image se prend sans passer par `canSaveGame`.
  const image: SaveImage = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    name: "",
    gameVersion: "",
    room: 0,
    vm: { ...blank.saveState(), ticks: vm.ticks, rng: vm.rng.state },
    memory: memoryImage(blank),
    frameout: saveInstance(frameoutOf(blank)),
    sound: { driver: saveInstance(soundDriverOf(blank)), manager: saveInstance(soundManagerOf(blank)) },
    digital: digitalAudioOf(blank).saveState(),
    lipSync: saveInstance(lipSyncOf(blank)),
    messages: saveInstance(messagesOf(blank)),
    kernel: { restarting: 1, saveDir: NULL_REG },
  };
  applyImage(vm, image);
  vm.boot();
}

// -------------------------------------------------------------------------------------------------------------------------------
// Emplacements
// -------------------------------------------------------------------------------------------------------------------------------

/**
 * Sauve la partie dans l'emplacement `slot` (1 à `SAVE_SLOT_COUNT`) sous le nom `name` (CP850) : pour le menu de la page,
 * entre deux images. Faux si la sauvegarde est impossible maintenant ou si le stockage refuse.
 */
export function saveToSlot(vm: Vm, slot: number, name: string, gameVersion = ""): boolean {
  if (!canSaveGame(vm)) return false;
  const store = saveStoreOf(vm);
  collectBeforeSave(vm);
  return store.slots.write(slot, captureGame(vm, name, gameVersion), store.now());
}

function restoreStored(vm: Vm, stored: StoredSave<SaveImage> | null): boolean {
  if (!stored) return false;
  try {
    restoreGame(vm, stored.save);
    return true;
  } catch (error) {
    vm.warn(`sauvegarde illisible : ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Reprend la partie de l'emplacement `slot` : « Charger » de la page, sur une machine virtuelle neuve (à la place de `boot`)
 * ou en cours de jeu, entre deux images. Faux si l'emplacement est vide, illisible ou d'une autre version : rien n'a changé.
 */
export function loadFromSlot(vm: Vm, slot: number): boolean {
  return restoreStored(vm, saveStoreOf(vm).slots.read(slot));
}

/** Reprend la sauvegarde la plus récente : « Continuer » de la page. Faux s'il n'y en a aucune de lisible. */
export function loadLatestSave(vm: Vm): boolean {
  return restoreStored(vm, saveStoreOf(vm).slots.latest());
}
