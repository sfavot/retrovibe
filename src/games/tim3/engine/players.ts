/**
 * Registre des joueurs (« Inscription », `SIGNIN.ITF`), lu dans TIMWIN.EXE.
 *
 * **Ce que fait le jeu.** Un joueur est un fichier de partie : `TIM.SAV` pour l'invité, dont le nom est la ligne 3 de `SYSTEM.RES`
 * (« Hôte », en anglais « Guest »), puis `tim01.sav` à `tim100.sav` pour les joueurs inscrits (42d0b8 : premier nom libre de 1 à 100,
 * soit 100 joueurs nommés au plus). Chaque fichier (lu par 42c6d0, écrit par 42c8cb) garde : le nom (20 octets), le puzzle en cours
 * (`[0x481600]`), le puzzle en cours de chaque catégorie (7 mots, 0, 40, 66, 96, 127, 156, 206 au départ, 42c664), les puzzles résolus
 * (un octet par puzzle, bit 0), trois octets de son (+0x50 volume 0 à 15, lu par 411674(1001, −1) et rendu par 411674(1001 / 3001, v) ;
 * +0x51 musique, 4115e6(1000, ·) ; +0x52 interrupteur général du son, 4115e6(10000, ·), la case « Effets Sonores » de `USERPREF.ITF`),
 * le mode avancé de `SOLVE.ITF` (+0x150, 42a082 / 42a075) et les préférences d'affichage (+0x154, `[0x481034]`). L'interrupteur des
 * effets de la guitare (4115e6(3001, ·)) n'y est pas : il vaut pour toute la séance. Partie neuve (42cf85) : volume 15, musique et son.
 * `SIGNIN.RES` n'est qu'une liste des noms refaite à chaque ouverture de l'écran (42668d), effacée en quittant (43b90d).
 * **Au lancement**, le jeu charge toujours l'invité (43b5cc : 42c6d0(0) → `TIM.SAV`) : le dernier joueur n'est pas retenu.
 * L'écran ne sait pas effacer un joueur.
 *
 * **Dans le port.** Le registre est la clé `players` (sous `tim3:`) ; l'invité a l'identifiant 0, les joueurs inscrits 1 à 100. Ce qui
 * appartient à un joueur est rangé sous `p<identifiant>:` : puzzles résolus (`solved`), dernier puzzle (`last`), puzzles maison
 * résolus (`homeSolved`), aires gardées (`edit:<puzzle>`, `edit:lab`), réglages de son du fichier (`music`, `volume` : `PlayerSound`) et
 * préférences du fichier (`PlayerPrefs` : `display` pour +0x154, `soundOn` pour +0x52, `solveAdvanced` pour +0x150).
 * Les machines du Labo (`slot01` … `slot10`) restent communes, comme les fichiers de puzzles du jeu ; l'interrupteur des effets de la
 * guitare et les voix du professeur (ajout du site) restent des préférences communes, comme le bouton « Son » du site.
 *
 * **Migrations** : sans registre, la progression rangée directement sous `tim3:` (avant l'inscription) devient celle de l'invité,
 * chargé au lancement (`migratePlayers`) ; la musique et le volume communs d'avant les réglages par joueur (`tim3:music`,
 * `tim3:volume`) deviennent ceux de chaque joueur qui n'a pas encore les siens, invité compris (`migratePlayerSound`). Copie d'abord,
 * registre ensuite, anciennes clés effacées en dernier ; une migration interrompue reprend à l'ouverture suivante sans rien perdre.
 * Les préférences du fichier n'existaient pas avant (le mode avancé de `SOLVE.ITF` ne durait que la séance) : un joueur qui n'en a pas
 * encore lit celles d'une partie neuve (`DEFAULT_PLAYER_PREFS`), sans rien écrire ni toucher à ses autres clés.
 */
import type { HostStorage } from "../../../engine/storage";
import { prefixedStorage } from "../../../engine/storage";
import { DEFAULT_DISPLAY } from "./display";
import { puzzleList } from "./session";

/** Identifiant de l'invité (`TIM.SAV`). */
export const GUEST_ID = 0;
/** Joueurs inscrits au plus (`tim01.sav` à `tim100.sav`, 42d10b). */
export const MAX_PLAYERS = 100;
/** Longueur d'un nom (426496 : EDIT de 0x13 caractères). */
export const PLAYER_NAME_MAX = 19;
/** Clé du registre sous `tim3:`. */
export const PLAYERS_KEY = "players";
const REGISTRY_VERSION = 1;

/** Clés propres à un joueur (hors aires gardées). */
const PROGRESS_KEYS = ["solved", "last", "homeSolved"] as const;
/** Réglages de son d'un joueur (octets +0x51 et +0x50 de son fichier). */
const SOUND_KEYS = ["music", "volume"] as const;
/** Préférences d'un joueur (+0x154, +0x52, +0x150 de son fichier). */
const PREF_KEYS = ["display", "soundOn", "solveAdvanced"] as const;

/** Son d'un joueur : musique (4115e6(1000, ·)) et volume de la guitare, 0 à 15 (`[0x47796c]`, musique et effets). */
export interface PlayerSound {
  music: boolean;
  volume: number;
}

/** Partie neuve (42cf85) : volume 15, musique en marche. */
export const DEFAULT_PLAYER_SOUND: Readonly<PlayerSound> = { music: true, volume: 15 };

/** Réglages de son rangés dans un stockage (celui d'un joueur) ; valeur absente ou illisible : celle d'une partie neuve. */
export function readPlayerSound(storage: HostStorage): PlayerSound {
  const volume = Number(storage.get("volume") ?? Number.NaN);
  return {
    music: storage.get("music") !== "0",
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(15, Math.round(volume))) : DEFAULT_PLAYER_SOUND.volume,
  };
}

/** Écrit les réglages donnés ; faux si une écriture a échoué. */
export function writePlayerSound(storage: HostStorage, sound: Partial<PlayerSound>): boolean {
  let ok = true;
  if (sound.music !== undefined) ok = storage.set("music", sound.music ? "1" : "0") && ok;
  if (sound.volume !== undefined) ok = storage.set("volume", String(Math.max(0, Math.min(15, Math.round(sound.volume))))) && ok;
  return ok;
}

export { DEFAULT_DISPLAY, DISPLAY } from "./display";

/** Préférences du fichier de partie d'un joueur. */
export interface PlayerPrefs {
  /** Préférences d'affichage (`DISPLAY`, mot de +0x154). */
  display: number;
  /** Interrupteur général du son (+0x52, 4115e6(10000, ·), case « Effets Sonores On » de `USERPREF.ITF`). */
  soundOn: boolean;
  /** Mode avancé de `SOLVE.ITF` (+0x150, `[0x472f98]`). */
  solveAdvanced: boolean;
}

/** Partie neuve (42cf85) : affichage 7, son en marche, `SOLVE.ITF` en mode normal. */
export const DEFAULT_PLAYER_PREFS: Readonly<PlayerPrefs> = { display: DEFAULT_DISPLAY, soundOn: true, solveAdvanced: false };

/** Préférences rangées dans un stockage (celui d'un joueur) ; valeur absente ou illisible : celle d'une partie neuve. */
export function readPlayerPrefs(storage: HostStorage): PlayerPrefs {
  const raw = storage.get("display");
  const display = raw !== null && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return {
    display: Number.isInteger(display) && display <= 0xffff ? display : DEFAULT_PLAYER_PREFS.display,
    soundOn: storage.get("soundOn") !== "0",
    solveAdvanced: storage.get("solveAdvanced") === "1",
  };
}

/** Écrit les préférences données ; faux si une écriture a échoué. */
export function writePlayerPrefs(storage: HostStorage, prefs: Partial<PlayerPrefs>): boolean {
  let ok = true;
  if (prefs.display !== undefined) ok = storage.set("display", String(prefs.display & 0xffff)) && ok;
  if (prefs.soundOn !== undefined) ok = storage.set("soundOn", prefs.soundOn ? "1" : "0") && ok;
  if (prefs.solveAdvanced !== undefined) ok = storage.set("solveAdvanced", prefs.solveAdvanced ? "1" : "0") && ok;
  return ok;
}

export interface Player {
  id: number;
  /** `null` pour l'invité : son nom vient de `SYSTEM.RES`. */
  name: string | null;
}

/** Clés d'un joueur (migration d'avant l'inscription, partie neuve) : progression, son, préférences, aires gardées des puzzles et du Labo. */
export function playerKeys(): string[] {
  return [...PROGRESS_KEYS, ...SOUND_KEYS, ...PREF_KEYS, ...puzzleList().map((p) => `edit:${p.name}`), "edit:lab"];
}

/** Préfixe des clés d'un joueur. */
export function playerPrefix(id: number): string {
  return `p${id}:`;
}

/** Nom saisi : espaces de tête et de fin ôtés (426577 … 4265ba), 19 caractères au plus ; `null` s'il est vide. */
export function cleanPlayerName(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, PLAYER_NAME_MAX).trim();
  return clean === "" ? null : clean;
}

/** Comparaison des noms : sans tenir compte de la casse (452a04, comme les noms de fichiers). */
export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, "fr", { sensitivity: "accent" }) === 0;
}

function parseRegistry(text: string | null): Player[] | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || (value as { version?: unknown }).version !== REGISTRY_VERSION) return null;
    const list = (value as { players?: unknown }).players;
    if (!Array.isArray(list)) return null;
    const out: Player[] = [];
    const seen = new Set<number>();
    for (const p of list) {
      if (typeof p !== "object" || p === null) continue;
      const { id, name } = p as { id?: unknown; name?: unknown };
      if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > MAX_PLAYERS || seen.has(id) || typeof name !== "string") continue;
      const clean = cleanPlayerName(name);
      if (clean === null) continue;
      seen.add(id);
      out.push({ id, name: clean });
    }
    return out.sort((a, b) => a.id - b.id);
  } catch {
    return null;
  }
}

/**
 * Migration (une fois) : sans registre, les clés d'un joueur rangées directement sous `tim3:` deviennent celles de l'invité. Rend
 * vrai si elle a eu lieu. Une valeur déjà présente chez l'invité n'est pas écrasée (migration reprise après une interruption).
 */
export function migratePlayers(store: HostStorage): boolean {
  if (store.get(PLAYERS_KEY) !== null) return false;
  const guest = prefixedStorage(store, playerPrefix(GUEST_ID));
  const moved: string[] = [];
  for (const key of playerKeys()) {
    const value = store.get(key);
    if (value === null) continue;
    if (guest.get(key) === null && !guest.set(key, value)) return false;
    moved.push(key);
  }
  if (!store.set(PLAYERS_KEY, JSON.stringify({ version: REGISTRY_VERSION, players: [] }))) return false;
  for (const key of moved) store.remove(key);
  return true;
}

/**
 * Migration (une fois) des réglages de son communs (`tim3:music`, `tim3:volume`, d'avant les réglages par joueur) : chaque joueur du
 * registre, invité compris, qui n'a pas encore les siens les reçoit (ils s'appliquaient à tous) ; puis les clés communes sont effacées.
 * Rend vrai si elle a eu lieu. Interrompue (écriture refusée), elle n'efface rien et reprend à l'ouverture suivante.
 */
export function migratePlayerSound(store: HostStorage, ids: readonly number[]): boolean {
  const found = SOUND_KEYS.filter((key) => store.get(key) !== null);
  if (found.length === 0) return false;
  for (const id of [GUEST_ID, ...ids.filter((i) => i !== GUEST_ID)]) {
    const player = prefixedStorage(store, playerPrefix(id));
    for (const key of found) if (player.get(key) === null && !player.set(key, store.get(key)!)) return false;
  }
  for (const key of found) store.remove(key);
  return true;
}

export type CreateOutcome = { status: "created"; player: Player } | { status: "exists"; player: Player } | { status: "invalid" } | { status: "full" } | { status: "failed" };

/** Le registre des joueurs, sur un stockage préfixé `tim3:`. Le joueur courant n'est pas gardé : l'invité au lancement. */
export class PlayerRegistry {
  private players: Player[];
  /** Joueur courant (l'invité au lancement, 43b5cc). */
  current = GUEST_ID;
  /** Vrai si la progression d'avant l'inscription vient d'être rendue à l'invité. */
  readonly migrated: boolean;

  constructor(
    private readonly store: HostStorage,
    /** Nom de l'invité (`SYSTEM.RES`, ligne 3 : « Hôte »). */
    readonly guestName: string,
  ) {
    this.migrated = migratePlayers(store);
    this.players = parseRegistry(store.get(PLAYERS_KEY)) ?? [];
    migratePlayerSound(store, this.players.map((p) => p.id));
  }

  /** L'invité, puis les joueurs inscrits dans l'ordre de leur inscription (fichiers `TIM.SAV`, `tim01.sav`…). */
  list(): Player[] {
    return [{ id: GUEST_ID, name: null }, ...this.players];
  }

  /** Nom affiché d'un joueur. */
  nameOf(player: Player): string {
    return player.name ?? this.guestName;
  }

  /** Joueur de ce nom (casse ignorée), invité compris. */
  find(name: string): Player | null {
    const clean = cleanPlayerName(name);
    if (clean === null) return null;
    return this.list().find((p) => sameName(this.nameOf(p), clean)) ?? null;
  }

  byId(id: number): Player | null {
    return this.list().find((p) => p.id === id) ?? null;
  }

  /** Inscrit un nouveau joueur (42d0b8 : premier numéro libre) ; un nom déjà connu rend ce joueur. */
  create(name: string): CreateOutcome {
    const clean = cleanPlayerName(name);
    if (clean === null) return { status: "invalid" };
    const known = this.find(clean);
    if (known) return { status: "exists", player: known };
    let id = 1;
    while (id <= MAX_PLAYERS && this.players.some((p) => p.id === id)) id++;
    if (id > MAX_PLAYERS) return { status: "full" };
    const player: Player = { id, name: clean };
    const next = [...this.players, player].sort((a, b) => a.id - b.id);
    // Une partie neuve (42c608) : rien de l'ancien occupant du numéro ne doit rester.
    const storage = this.storage(id);
    for (const key of playerKeys()) storage.remove(key);
    if (!this.store.set(PLAYERS_KEY, JSON.stringify({ version: REGISTRY_VERSION, players: next }))) return { status: "failed" };
    this.players = next;
    return { status: "created", player };
  }

  /** Change de joueur ; faux si l'identifiant est inconnu. */
  select(id: number): boolean {
    if (!this.byId(id)) return false;
    this.current = id;
    return true;
  }

  /** Stockage du joueur `id` (courant par défaut). */
  storage(id = this.current): HostStorage {
    return prefixedStorage(this.store, playerPrefix(id));
  }

  /** Réglages de son du joueur `id` (courant par défaut), appliqués à son chargement (42c6d0 → 4115e6, 411674). */
  sound(id = this.current): PlayerSound {
    return readPlayerSound(this.storage(id));
  }

  /** Garde un réglage de son du joueur courant (le jeu l'écrit dans son fichier, 42c8cb) ; faux si l'écriture a échoué. */
  setSound(sound: Partial<PlayerSound>): boolean {
    return writePlayerSound(this.storage(), sound);
  }

  /** Préférences du joueur `id` (courant par défaut), appliquées à son chargement (42c6d0 : 4115e6(10000, ·), `[0x481034]`, 42a075). */
  prefs(id = this.current): PlayerPrefs {
    return readPlayerPrefs(this.storage(id));
  }

  /** Garde une préférence du joueur courant (42c8cb) ; faux si l'écriture a échoué. */
  setPrefs(prefs: Partial<PlayerPrefs>): boolean {
    return writePlayerPrefs(this.storage(), prefs);
  }
}

/** Ce que fait « Terminé » de l'écran d'inscription (4267b0 → 426877). */
export type SignInDecision =
  /** Le joueur choisi ou nommé. */
  | { kind: "select"; player: Player }
  /** Nom inconnu : 31174 « Ce nom ne correspond pas… nouveau joueur? » (Oui : l'inscrire). */
  | { kind: "ask"; name: string }
  /** Ni nom ni rangée : 31175 « Vous devez choisir un nom… ». */
  | { kind: "noName" };

/**
 * 426877 : un nom écrit désigne le joueur de ce nom (casse ignorée), sinon on demande s'il est nouveau ; sans nom, la rangée choisie ;
 * sans rien, 31175.
 */
export function signInDecision(registry: PlayerRegistry, typed: string, selected: number | null): SignInDecision {
  const clean = cleanPlayerName(typed);
  if (clean !== null) {
    const found = registry.find(clean);
    return found ? { kind: "select", player: found } : { kind: "ask", name: clean };
  }
  const row = selected === null ? null : (registry.list()[selected] ?? null);
  return row ? { kind: "select", player: row } : { kind: "noName" };
}
