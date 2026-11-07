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
 * Lecture : comme l'original, qui ne contrôle que la signature (`0x6B`, `10d0:0734`), seul un texte qui n'est pas une partie de ce format est refusé
 * (`SaveError("invalid")`) ; un champ abîmé est réparé (`readGame`, `Reader`), et une entrée abîmée de la liste est écartée.
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

/**
 * Lecture tolérante d'une partie (bug 19). L'original ne refuse un fichier que sur sa signature (`0x6B` en tête, `10d0:0734`) et relit le reste
 * octet par octet, sans contrôle de bornes. Le port refusait toute la partie pour une seule valeur hors bornes ou d'un mauvais type, ce qui rendait
 * illisible une partie valable par ailleurs. Seuls la racine (JSON, objet, version) et l'objet `game` restent exigés ; chaque champ abîmé est
 * ramené à une valeur sûre (bornée, arrondie, ou valeur d'une partie neuve) et noté dans `repairs`.
 */
class Reader {
  readonly repairs: string[] = [];

  private note(what: string): void {
    if (!this.repairs.includes(what)) this.repairs.push(what);
  }

  obj(v: unknown, what: string): Raw {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Raw;
    this.note(what);
    return {};
  }

  /** Entier de `lo` à `hi` : un nombre est arrondi et borné ; autre chose donne `fallback`. */
  int(v: unknown, what: string, lo: number, hi: number, fallback = lo): number {
    if (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi) return v;
    this.note(what);
    if (typeof v === "number" && Number.isFinite(v)) return Math.min(hi, Math.max(lo, Math.round(v)));
    return fallback;
  }

  bool(v: unknown, what: string, fallback: boolean): boolean {
    if (typeof v === "boolean") return v;
    this.note(what);
    return typeof v === "number" ? v !== 0 : fallback;
  }

  /** Tableau de `len` éléments (s'il est donné) : complété par `fill(i)` ou tronqué. */
  list(v: unknown, what: string, len?: number, fill?: (i: number) => unknown): unknown[] {
    let a: unknown[];
    if (Array.isArray(v)) a = v;
    else if (v instanceof Object && len !== undefined) {
      // Tableau typé passé par `JSON.stringify` : `{ "0": …, "1": … }`.
      this.note(what);
      a = Array.from({ length: len }, (_, i) => (v as Raw)[String(i)]);
    } else {
      this.note(what);
      a = [];
    }
    if (len === undefined || a.length === len) return a;
    this.note(what);
    return Array.from({ length: len }, (_, i) => (i < a.length ? a[i] : fill?.(i)));
  }

  ints(v: unknown, what: string, len: number, lo: number, hi: number, fallback: readonly number[]): number[] {
    return this.list(v, what, len, (i) => fallback[i]).map((n, i) => this.int(n, what, lo, hi, fallback[i] ?? lo));
  }

  bytes(v: unknown, what: string, len: number): Uint8Array {
    return Uint8Array.from(this.list(v, what, len, () => 0).map((n) => this.int(n, what, 0, 255, 0)));
  }

  /** Attributs de 1 à 5 (0 admis dans une réserve) ; null s'ils sont inutilisables (le Zoombini est alors écarté). */
  attrs(v: unknown, what: string, zeroAllowed: boolean): Attrs | null {
    const lo = zeroAllowed ? 0 : 1;
    if (!Array.isArray(v) || v.length !== 4 || v.some((n) => typeof n !== "number" || !Number.isInteger(n) || n < lo || n > 5)) {
      this.note(what);
      return null;
    }
    return [v[0], v[1], v[2], v[3]] as Attrs;
  }

  reserve(v: unknown, what: string): Reserve {
    const r = this.obj(v, what);
    const out = emptyReserve();
    out.scroll = this.int(r.scroll, what, 0, 0xffff);
    for (const item of this.list(r.entries, what)) {
      const pair = Array.isArray(item) && item.length === 2 ? item : null;
      const index = pair && typeof pair[0] === "number" && Number.isInteger(pair[0]) && pair[0] >= 0 && pair[0] < ZOOMBINI_TYPES ? pair[0] : -1;
      const e = pair && typeof pair[1] === "object" && pair[1] !== null ? (pair[1] as Raw) : null;
      const a = e ? this.attrs(e.attrs, what, true) : null;
      if (index < 0 || !e || !a) {
        this.note(what);
        continue;
      }
      out.entries[index] = { attrs: a, slot: this.bytes(e.slot, what, SLOT_BYTES), state: this.bytes(e.state, what, STATE_BYTES) };
    }
    // Le nombre d'occupés est un invariant (`team.ts`) : recompté plutôt que relu.
    const occupied = out.entries.filter((e) => isOccupied(e)).length;
    if (r.count !== occupied) this.note(what);
    out.count = occupied;
    return out;
  }

  group(v: unknown, what: string): GroupBuffer {
    const g = this.obj(v, what);
    const members: Zoombini[] = [];
    for (const m of this.list(g.members, what)) {
      const z = this.obj(m, what);
      const a = this.attrs(z.attrs, what, false);
      if (!a) continue;
      if (members.length >= GROUP_CAPACITY) {
        this.note(what);
        break;
      }
      members.push({ attrs: a, id: this.int(z.id, what, 0, 0xffffffff, 0), present: this.bool(z.present, what, true), state: this.bytes(z.state, what, STATE_BYTES) });
    }
    return { flagA: this.bool(g.flagA, what, false), flagB: this.bool(g.flagB, what, false), members };
  }

  options(v: unknown): GameOptions {
    const o = this.obj(v, "options");
    const d = newGame().options;
    return {
      effects: this.bool(o.effects, "options", d.effects),
      music: this.bool(o.music, "options", d.music),
      magneticMouse: this.bool(o.magneticMouse, "options", d.magneticMouse),
      hideCursorWhileCarrying: this.bool(o.hideCursorWhileCarrying, "options", d.hideCursorWhileCarrying),
      testMode: this.bool(o.testMode, "options", d.testMode),
      autoMagnet: this.bool(o.autoMagnet, "options", d.autoMagnet),
      transitionsOff: this.bool(o.transitionsOff, "options", d.transitionsOff),
      lessAction: this.bool(o.lessAction, "options", d.lessAction),
    };
  }
}

function writeReserve(r: Reserve): unknown {
  const entries: [number, unknown][] = [];
  r.entries.forEach((e, i) => {
    if (isOccupied(e)) entries.push([i, { attrs: e.attrs, slot: [...e.slot], state: [...e.state] }]);
  });
  return { scroll: r.scroll, count: r.count, entries };
}

function writeGroup(g: GroupBuffer): unknown {
  return { flagA: g.flagA, flagB: g.flagB, members: g.members.map((m) => ({ attrs: m.attrs, id: m.id, present: m.present, state: [...m.state] })) };
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
      shootingHighScore: game.shootingHighScore,
      asteroidsHighScore: game.asteroidsHighScore,
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

/** Partie lue et champs réparés (`Reader`). */
export interface ParsedGame {
  game: GameState;
  /** Champs abîmés ramenés à une valeur sûre (vide pour une partie intacte). */
  repairs: string[];
}

/**
 * JSON → partie. Lève `SaveError("invalid")` seulement si le texte n'est pas une partie de ce format (JSON illisible, racine, version, `game`
 * absent) : l'équivalent de la signature `0x6B` de l'original. Le reste est lu avec réparation (`Reader`).
 */
export function readGame(text: string): ParsedGame {
  let root: Raw;
  try {
    root = obj(JSON.parse(text), "racine");
  } catch (e) {
    if (e instanceof SaveError) throw e;
    return bad("JSON illisible");
  }
  if (root.v !== SAVE_VERSION) bad(`version ${String(root.v)}`);
  const g = obj(root.game, "game");
  const r = new Reader();
  const out = newGame();
  out.unknown02 = r.int(g.unknown02, "unknown02", 0, 0xffff);
  out.options = r.options(g.options);
  // Absente des parties enregistrées avant la vague H : règle non tirée.
  if (g.fleensRule !== undefined) out.fleensRule = r.ints(g.fleensRule, "fleensRule", 8, 0, 0xff, out.fleensRule);
  out.campDecor = r.ints(g.campDecor, "campDecor", 5, 0, 0xffff, out.campDecor);
  out.townScroll = r.int(g.townScroll, "townScroll", 0, 5);
  // `S+0x22` / `S+0x24` : meilleurs scores des écrans cachés 19 et 20 ; absents des parties enregistrées avant leur portage (0, comme une partie neuve).
  if (g.shootingHighScore !== undefined) out.shootingHighScore = r.int(g.shootingHighScore, "shootingHighScore", 0, 99);
  if (g.asteroidsHighScore !== undefined) out.asteroidsHighScore = r.int(g.asteroidsHighScore, "asteroidsHighScore", 0, 999);
  out.mascots = r.int(g.mascots, "mascots", 0, 3);
  out.dialogMemory = r.ints(g.dialogMemory, "dialogMemory", DIALOG_SCREENS.length, 0, 0xffff, out.dialogMemory);
  const c = r.obj(g.counters, "counters");
  out.counters = {
    created: r.int(c.created, "created", 0, ZOOMBINI_TYPES),
    camp1: r.int(c.camp1, "camp1", 0, ZOOMBINI_TYPES),
    camp2: r.int(c.camp2, "camp2", 0, ZOOMBINI_TYPES),
    town: r.int(c.town, "town", 0, 0xffff),
  };
  const m = r.obj(g.masks, "masks");
  out.masks = {
    stage1: r.int(m.stage1, "masks", 0, 15),
    stage2: r.int(m.stage2, "masks", 0, 15),
    stage3: r.int(m.stage3, "masks", 0, 15),
    stage4: r.int(m.stage4, "masks", 0, 15),
  };
  out.stageUnbroken = r.bool(g.stageUnbroken, "stageUnbroken", out.stageUnbroken);
  out.successes = r.ints(g.successes, "successes", PUZZLES, 0, 255, out.successes);
  out.monuments = r.list(g.monuments, "monuments", MONUMENT_SLOTS, () => null).map((item): Monument | null => {
    if (item === null || item === undefined) return null;
    if (typeof item !== "object") {
      r.obj(item, "monuments");
      return null;
    }
    const mo = item as Raw;
    return {
      stage: r.int(mo.stage, "monuments", 1, STAGES),
      level: r.int(mo.level, "monuments", 1, 4),
      year: r.int(mo.year, "monuments", 0, 0xffff),
      month: r.int(mo.month, "monuments", 0, 255),
      day: r.int(mo.day, "monuments", 0, 255),
    };
  });
  out.levels = r.ints(g.levels, "levels", STAGES, 0, 3, out.levels);
  out.previousScreen = r.int(g.previousScreen, "previousScreen", -1, 22, out.previousScreen);
  out.resumeScreen = r.int(g.resumeScreen, "resumeScreen", -1, 22, out.resumeScreen);
  out.camp1 = r.reserve(g.camp1, "camp1");
  out.camp2 = r.reserve(g.camp2, "camp2");
  out.population = r.reserve(g.population, "population");
  out.pickerGroup = r.group(g.pickerGroup, "pickerGroup");
  out.camp1Group = r.group(g.camp1Group, "camp1Group");
  out.camp2Group = r.group(g.camp2Group, "camp2Group");
  out.group = r.group(g.group, "group");
  out.typeCounts = Uint8Array.from(r.list(g.typeCounts, "typeCounts", ZOOMBINI_TYPES, () => 0).map((n) => r.int(n, "typeCounts", 0, 2, 0)));
  return { game: out, repairs: r.repairs };
}

/** JSON → partie (`readGame` sans la liste des réparations). */
export function parseGame(text: string): GameState {
  return readGame(text).game;
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
    // Comme pour une partie (`Reader`), seule la racine est exigée : une entrée abîmée est écartée, le compteur ramené au-delà des fichiers listés.
    const games: SaveEntry[] = [];
    for (const item of Array.isArray(root.games) ? root.games : []) {
      const e = typeof item === "object" && item !== null ? (item as Raw) : {};
      if (typeof e.name !== "string" || typeof e.file !== "string" || !/^ZOOM\d{4}$/.test(e.file)) continue;
      if (games.length < MAX_SAVES && !games.some((g) => g.name === e.name)) games.push({ name: e.name, file: e.file });
    }
    const used = games.reduce((n, g) => Math.max(n, Number(g.file.slice(4)) + 1), 0);
    const next = typeof root.next === "number" && Number.isInteger(root.next) && root.next >= used && root.next <= 9999 ? root.next : Math.min(9999, used);
    return { v: SAVE_VERSION, next, games };
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
    const { game, repairs } = readGame(text);
    this.lastRepairs = repairs;
    // Diagnostic (console du navigateur) : quels champs étaient abîmés.
    if (repairs.length > 0) console.warn(`Zoombinis : partie ${file} relue avec réparation de : ${repairs.join(", ")}`);
    return game;
  }

  /** Champs réparés à la dernière lecture d'une partie (`readGame`), pour le diagnostic. */
  lastRepairs: readonly string[] = [];
}
