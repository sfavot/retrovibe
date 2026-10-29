import { type HostStorage, prefixedStorage } from "../../../engine/storage";
import {
  type Attrs,
  type GameOptions,
  type GameState,
  type GroupBuffer,
  type Monument,
  type Reserve,
  type Session,
  type Zoombini,
  DIALOG_SCREENS,
  GROUP_CAPACITY,
  MONUMENT_SLOTS,
  PUZZLES,
  SLOT_BYTES,
  STAGES,
  STATE_BYTES,
  ZOOMBINI_TYPES,
  emptyReserve,
  isOccupied,
  newGame,
} from "./state";

/**
 * Liste des parties et parties sauvegardées (`docs/zoombinis/screens.md` §1.5, §6.1, §6.3), sur `HostStorage` en JSON versionné.
 *
 *  - Liste (rôle de `ZOOMBINI.WHO`) : au plus 50 parties, compteur de fichiers (`ZOOM%04d`), nom de 18 caractères au plus pris dans le jeu de `STRL` 1100.
 *  - Partie (rôle de `ZOOMnnnn.txt`) : tout `GameState` ; la partie anonyme est `ZBUser`. L'import des fichiers de l'original est hors périmètre ; l'entraînement n'écrit rien (`ZBtemp.txt` n'existe pas ici).
 *
 * Clés : `retrovibe:zoombinis:who` et `retrovibe:zoombinis:game:<fichier>`. Aucun texte destiné au joueur : les erreurs désignent les messages de `TEXTSTR.MHK` (`SAVE_ERROR_STRL`).
 */

export const SAVE_VERSION = 1;
export const STORAGE_PREFIX = "retrovibe:zoombinis:";
/** Parties enregistrées au plus (50 entrées de 32 octets dans le `.WHO`). */
export const MAX_SAVES = 50;
/** Longueur maximale d'un nom (`11a0:316d` : `longueur + 4 < 22` à chaque caractère ajouté). */
export const NAME_MAX_LENGTH = 18;
/** Nom de fichier de la partie anonyme (`ZBUser.txt`). */
export const ANONYMOUS_FILE = "ZBUser";

export type SaveErrorKind =
  /** Liste ou partie introuvable ou illisible à l'ouverture (`STRL` 1020). */
  | "open"
  /** Écriture refusée par le stockage, plein ou bloqué (`STRL` 1022). */
  | "write"
  /** Réservé : positionnement dans le fichier (`STRL` 1024, sans objet ici). */
  | "seek"
  /** Lecture impossible (`STRL` 1026). */
  | "read"
  /** Signature ou contenu invalide (`STRL` 1028, complété par 1030 pour la liste). */
  | "invalid"
  /** 50 parties déjà enregistrées (`STRL` 2018, indice 37). */
  | "full"
  /** Nom vide, trop long ou hors du jeu de caractères. */
  | "badName";

/** Message de `TEXTSTR.MHK` correspondant à chaque erreur : `[liste, indice]` (indice 0 pour les listes d'une chaîne). Le texte vient du jeu. Rapprochement 1020 à 1026 : **probable** (lecture des quatre libellés). */
export const SAVE_ERROR_STRL: Readonly<Record<SaveErrorKind, readonly (readonly [number, number])[]>> = {
  open: [[1020, 0]],
  write: [[1022, 0]],
  seek: [[1024, 0]],
  read: [[1026, 0]],
  invalid: [
    [1028, 0],
    [1030, 0],
  ],
  full: [[2018, 37]],
  badName: [],
};

export class SaveError extends Error {
  constructor(
    readonly kind: SaveErrorKind,
    detail = "",
  ) {
    super(`Zoombinis : sauvegarde (${kind})${detail ? ` : ${detail}` : ""}`);
    this.name = "SaveError";
  }

  /** Messages de `TEXTSTR.MHK` à afficher, dans l'ordre. */
  get strl(): readonly (readonly [number, number])[] {
    return SAVE_ERROR_STRL[this.kind];
  }
}

// --- Noms ---

/**
 * Nom saisi → nom retenu : espaces de tête et de fin retirés, 1 à 18 caractères, tous dans le jeu `charset` (chaîne de `STRL` 1100, qui contient l'espace).
 * Renvoie null sinon.
 */
export function normalizeName(raw: string, charset: string): string | null {
  const name = raw.replace(/^ +| +$/g, "");
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return null;
  for (const c of name) if (!charset.includes(c)) return null;
  return name;
}

/** Peut-on ajouter `c` au nom en cours de saisie ? (caractère du jeu, longueur < 18 avant l'ajout). */
export function canTypeChar(current: string, c: string, charset: string): boolean {
  return c.length === 1 && charset.includes(c) && current.length < NAME_MAX_LENGTH;
}

/** Nom de fichier de la partie n° `n` (`10d0:0607` : `ZOOM` + `%04d`). */
export function gameFileName(n: number): string {
  return `ZOOM${String(n).padStart(4, "0")}`;
}

// --- Sérialisation d'une partie ---

interface Raw {
  [key: string]: unknown;
}

const bad = (what: string): never => {
  throw new SaveError("invalid", what);
};

function obj(v: unknown, what: string): Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Raw) : bad(what);
}

function list(v: unknown, what: string, len?: number): unknown[] {
  if (!Array.isArray(v) || (len !== undefined && v.length !== len)) return bad(what);
  return v;
}

function int(v: unknown, what: string, lo: number, hi: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : bad(what);
}

function bool(v: unknown, what: string): boolean {
  return typeof v === "boolean" ? v : bad(what);
}

function bytes(v: unknown, what: string, len: number): Uint8Array {
  const a = list(v, what, len);
  return Uint8Array.from(a.map((n) => int(n, what, 0, 255)));
}

function attrs(v: unknown, what: string, zeroAllowed: boolean): Attrs {
  const a = list(v, what, 4).map((n) => int(n, what, zeroAllowed ? 0 : 1, 5));
  return [a[0]!, a[1]!, a[2]!, a[3]!];
}

function readReserve(v: unknown, what: string): Reserve {
  const r = obj(v, what);
  const out = emptyReserve();
  out.scroll = int(r.scroll, what, 0, 0xffff);
  out.count = int(r.count, what, 0, ZOOMBINI_TYPES);
  for (const item of list(r.entries, what)) {
    const pair = list(item, what, 2);
    const index = int(pair[0], what, 0, ZOOMBINI_TYPES - 1);
    const e = obj(pair[1], what);
    out.entries[index] = { attrs: attrs(e.attrs, what, true), slot: bytes(e.slot, what, SLOT_BYTES), state: bytes(e.state, what, STATE_BYTES) };
  }
  return out;
}

function writeReserve(r: Reserve): unknown {
  const entries: [number, unknown][] = [];
  r.entries.forEach((e, i) => {
    if (isOccupied(e)) entries.push([i, { attrs: e.attrs, slot: [...e.slot], state: [...e.state] }]);
  });
  return { scroll: r.scroll, count: r.count, entries };
}

function readGroup(v: unknown, what: string): GroupBuffer {
  const g = obj(v, what);
  const members = list(g.members, what);
  if (members.length > GROUP_CAPACITY) bad(what);
  return {
    flagA: bool(g.flagA, what),
    flagB: bool(g.flagB, what),
    members: members.map((m): Zoombini => {
      const z = obj(m, what);
      return {
        attrs: attrs(z.attrs, what, false),
        id: int(z.id, what, 0, 0xffffffff),
        present: bool(z.present, what),
        state: bytes(z.state, what, STATE_BYTES),
      };
    }),
  };
}

function writeGroup(g: GroupBuffer): unknown {
  return { flagA: g.flagA, flagB: g.flagB, members: g.members.map((m) => ({ attrs: m.attrs, id: m.id, present: m.present, state: [...m.state] })) };
}

function readOptions(v: unknown): GameOptions {
  const o = obj(v, "options");
  return {
    effects: bool(o.effects, "options"),
    music: bool(o.music, "options"),
    magneticMouse: bool(o.magneticMouse, "options"),
    hideCursorWhileCarrying: bool(o.hideCursorWhileCarrying, "options"),
    testMode: bool(o.testMode, "options"),
    autoMagnet: bool(o.autoMagnet, "options"),
    transitionsOff: bool(o.transitionsOff, "options"),
    lessAction: bool(o.lessAction, "options"),
  };
}

/** Partie → JSON versionné (`{ v, game }`). */
export function serializeGame(game: GameState): string {
  return JSON.stringify({
    v: SAVE_VERSION,
    game: {
      unknown02: game.unknown02,
      options: game.options,
      fleensRule: game.fleensRule,
      campDecor: game.campDecor,
      townScroll: game.townScroll,
      mascots: game.mascots,
      dialogMemory: game.dialogMemory,
      counters: game.counters,
      masks: game.masks,
      stageUnbroken: game.stageUnbroken,
      successes: game.successes,
      monuments: game.monuments,
      levels: game.levels,
      previousScreen: game.previousScreen,
      resumeScreen: game.resumeScreen,
      camp1: writeReserve(game.camp1),
      camp2: writeReserve(game.camp2),
      population: writeReserve(game.population),
      pickerGroup: writeGroup(game.pickerGroup),
      camp1Group: writeGroup(game.camp1Group),
      camp2Group: writeGroup(game.camp2Group),
      group: writeGroup(game.group),
      typeCounts: [...game.typeCounts],
    },
  });
}

/** JSON → partie, avec contrôle de la version, des types et des bornes ; lève `SaveError("invalid")` sinon. */
export function parseGame(text: string): GameState {
  let root: Raw;
  try {
    root = obj(JSON.parse(text), "racine");
  } catch (e) {
    if (e instanceof SaveError) throw e;
    return bad("JSON illisible");
  }
  if (root.v !== SAVE_VERSION) bad(`version ${String(root.v)}`);
  const g = obj(root.game, "game");
  const out = newGame();
  out.unknown02 = int(g.unknown02, "unknown02", 0, 0xffff);
  out.options = readOptions(g.options);
  // Absente des parties enregistrées avant la vague H : règle non tirée.
  if (g.fleensRule !== undefined) out.fleensRule = list(g.fleensRule, "fleensRule", 8).map((n) => int(n, "fleensRule", 0, 0xff));
  out.campDecor = list(g.campDecor, "campDecor", 5).map((n) => int(n, "campDecor", 0, 0xffff));
  out.townScroll = int(g.townScroll, "townScroll", 0, 5);
  out.mascots = int(g.mascots, "mascots", 0, 3);
  out.dialogMemory = list(g.dialogMemory, "dialogMemory", DIALOG_SCREENS.length).map((n) => int(n, "dialogMemory", 0, 0xffff));
  const c = obj(g.counters, "counters");
  out.counters = {
    created: int(c.created, "created", 0, ZOOMBINI_TYPES),
    camp1: int(c.camp1, "camp1", 0, ZOOMBINI_TYPES),
    camp2: int(c.camp2, "camp2", 0, ZOOMBINI_TYPES),
    town: int(c.town, "town", 0, 0xffff),
  };
  const m = obj(g.masks, "masks");
  out.masks = {
    stage1: int(m.stage1, "masks", 0, 15),
    stage2: int(m.stage2, "masks", 0, 15),
    stage3: int(m.stage3, "masks", 0, 15),
    stage4: int(m.stage4, "masks", 0, 15),
  };
  out.stageUnbroken = bool(g.stageUnbroken, "stageUnbroken");
  out.successes = list(g.successes, "successes", PUZZLES).map((n) => int(n, "successes", 0, 255));
  out.monuments = list(g.monuments, "monuments", MONUMENT_SLOTS).map((item): Monument | null => {
    if (item === null) return null;
    const mo = obj(item, "monuments");
    return {
      stage: int(mo.stage, "monuments", 1, STAGES),
      level: int(mo.level, "monuments", 1, 4),
      year: int(mo.year, "monuments", 0, 0xffff),
      month: int(mo.month, "monuments", 0, 255),
      day: int(mo.day, "monuments", 0, 255),
    };
  });
  out.levels = list(g.levels, "levels", STAGES).map((n) => int(n, "levels", 0, 3));
  out.previousScreen = int(g.previousScreen, "previousScreen", -1, 22);
  out.resumeScreen = int(g.resumeScreen, "resumeScreen", -1, 22);
  out.camp1 = readReserve(g.camp1, "camp1");
  out.camp2 = readReserve(g.camp2, "camp2");
  out.population = readReserve(g.population, "population");
  out.pickerGroup = readGroup(g.pickerGroup, "pickerGroup");
  out.camp1Group = readGroup(g.camp1Group, "camp1Group");
  out.camp2Group = readGroup(g.camp2Group, "camp2Group");
  out.group = readGroup(g.group, "group");
  out.typeCounts = bytes(g.typeCounts, "typeCounts", ZOOMBINI_TYPES);
  if (out.typeCounts.some((n) => n > 2)) bad("typeCounts");
  return out;
}

// --- Liste et parties ---

export interface SaveEntry {
  /** Nom saisi par le joueur. */
  name: string;
  /** Fichier de la partie (`ZOOM0000`). */
  file: string;
}

interface WhoRecord {
  v: number;
  /** Prochain numéro de fichier (`.WHO` +2). */
  next: number;
  games: SaveEntry[];
}

const WHO_KEY = "who";
const gameKey = (file: string): string => `game:${file}`;

export interface SaveResult {
  entry: SaveEntry;
  /** Une partie de même nom a été remplacée (l'interface demande confirmation avant : `STRL` 2018, indice 27). */
  replaced: boolean;
}

export class SaveStore {
  private readonly storage: HostStorage;

  /** @param charset jeu de caractères admis, chaîne de `STRL` 1100 (lue dans `TEXTSTR.MHK`) */
  constructor(
    storage: HostStorage,
    readonly charset: string,
  ) {
    this.storage = prefixedStorage(storage, STORAGE_PREFIX);
  }

  private readWho(): WhoRecord {
    const text = this.storage.get(WHO_KEY);
    if (text === null) return { v: SAVE_VERSION, next: 0, games: [] };
    let root: Raw;
    try {
      root = obj(JSON.parse(text), "liste");
    } catch (e) {
      if (e instanceof SaveError) throw e;
      return bad("liste illisible");
    }
    if (root.v !== SAVE_VERSION) bad("liste : version");
    const games = list(root.games, "liste", undefined).map((item): SaveEntry => {
      const e = obj(item, "liste");
      if (typeof e.name !== "string" || typeof e.file !== "string" || !/^ZOOM\d{4}$/.test(e.file)) return bad("liste : entrée");
      return { name: e.name, file: e.file };
    });
    if (games.length > MAX_SAVES) bad("liste : plus de 50 parties");
    return { v: SAVE_VERSION, next: int(root.next, "liste : compteur", 0, 9999), games };
  }

  private writeWho(who: WhoRecord): void {
    if (!this.storage.set(WHO_KEY, JSON.stringify(who))) throw new SaveError("write", "liste");
  }

  /** Parties enregistrées, dans l'ordre d'enregistrement (liste vide si aucune : « Aucune partie enregistrée »). */
  list(): SaveEntry[] {
    return this.readWho().games.map((e) => ({ ...e }));
  }

  /** Entrée de ce nom (comparaison exacte, `1000:0fc4`), ou null. */
  find(name: string): SaveEntry | null {
    return this.readWho().games.find((e) => e.name === name) ?? null;
  }

  /**
   * Enregistre `game` sous `rawName` (normalisé par `normalizeName`). Une partie de même nom est remplacée (même fichier) ; sinon une entrée est ajoutée avec le prochain
   * numéro de fichier, jusqu'à 50 (`SaveError("full")`). La partie est écrite avant la liste : un échec ne laisse pas d'entrée sans fichier.
   */
  save(rawName: string, game: GameState): SaveResult {
    const name = normalizeName(rawName, this.charset);
    if (name === null) throw new SaveError("badName", rawName);
    const who = this.readWho();
    const existing = who.games.find((e) => e.name === name);
    if (existing) {
      this.writeGame(existing.file, game);
      return { entry: { ...existing }, replaced: true };
    }
    if (who.games.length >= MAX_SAVES) throw new SaveError("full");
    const entry: SaveEntry = { name, file: gameFileName(who.next) };
    this.writeGame(entry.file, game);
    who.games.push(entry);
    who.next += 1;
    try {
      this.writeWho(who);
    } catch (e) {
      this.storage.remove(gameKey(entry.file));
      throw e;
    }
    return { entry: { ...entry }, replaced: false };
  }

  /** Charge la partie enregistrée sous ce nom (`SaveError("open")` si le nom n'est pas dans la liste, `"read"` si le fichier manque, `"invalid"` s'il est corrompu). */
  load(name: string): GameState {
    const entry = this.find(name);
    if (!entry) throw new SaveError("open", name);
    return this.readGame(entry.file);
  }

  /** Écrit la partie anonyme (`ZBUser`). */
  saveAnonymous(game: GameState): void {
    this.writeGame(ANONYMOUS_FILE, game);
  }

  /** Lit la partie anonyme ; null s'il n'y en a pas. */
  loadAnonymous(): GameState | null {
    return this.storage.get(gameKey(ANONYMOUS_FILE)) === null ? null : this.readGame(ANONYMOUS_FILE);
  }

  /**
   * Écriture automatique au changement d'écran (`11a0:141e` → `10d0:06ad`) : seulement si la partie est nommée (`session.name`) et pas en entraînement.
   * Renvoie vrai si elle a été écrite. Un nom qui n'est plus dans la liste (partie supprimée ailleurs) n'écrit rien.
   */
  autoSave(game: GameState, session: Session): boolean {
    if (session.name === null || session.training !== 0) return false;
    const entry = this.find(session.name);
    if (!entry) return false;
    this.writeGame(entry.file, game);
    return true;
  }

  private writeGame(file: string, game: GameState): void {
    if (!this.storage.set(gameKey(file), serializeGame(game))) throw new SaveError("write", file);
  }

  private readGame(file: string): GameState {
    const text = this.storage.get(gameKey(file));
    if (text === null) throw new SaveError("read", file);
    return parseGame(text);
  }
}
