import type { HostStorage } from "./host";

/**
 * Fichier `MWRoster` de l'original (engine.md §7.1, screens/common.md §3.4 à §3.6), en mémoire et en pur TypeScript :
 * 41 enregistrements de 5424 octets.
 *
 *  - enregistrement 0 : en-tête (gros-boutiste, sauf le masque de chaque joueur qui est natif petit-boutiste) puis 40 entrées de joueur ;
 *  - enregistrements 1 à 40 : variables de scènes du joueur d'identifiant 1 à 40, gros-boutistes.
 *
 * `Roster` garde les 222 384 octets tels quels (rien n'est perdu à l'aller-retour, y compris les octets non documentés) et
 * expose une API typée par-dessus. La persistance est l'affaire de l'hôte : `encode` / `decode` pour les octets, `RosterStore` pour `HostStorage`.
 * Aucun texte destiné au joueur ici.
 */

export const ROSTER_RECORD_SIZE = 5424;
export const ROSTER_RECORDS = 41;
export const ROSTER_SIZE = ROSTER_RECORD_SIZE * ROSTER_RECORDS;
/** Version attendue (`DS:1e8c`) ; toute autre valeur est fatale dans l'original (« Old Roster File must be deleted! »). */
export const ROSTER_VERSION = 0x20;
export const MAX_PLAYERS = 40;
/** Timer du Bowling par défaut, en ticks (`10800` = 180 s à 60 ticks/s, valeur du descripteur du Bowling `+0x18`). */
export const DEFAULT_BOWLING_TICKS = 10800;
/** Le moniteur compte le timer en secondes, à 60 ticks par seconde (`0332 = secondes × 60`), de 1 à 999 s. */
export const BOWLING_TICKS_PER_SECOND = 60;
export const MIN_BOWLING_SECONDS = 1;
export const MAX_BOWLING_SECONDS = 999;

// En-tête (enregistrement 0).
const H_VERSION = 0;
const H_PLAYER_COUNT = 2;
const H_BOWLING_TICKS = 4;
const H_CLICK_AND_STICK = 8;
const H_AMBIENT = 10;
const H_ENTRIES = 12;
const ENTRY_SIZE = 37;
const E_USED = 0;
const E_NAME = 1;
const E_MASK = 33;
const NAME_FIELD_SIZE = 32;

/** Opérations du Bowling dans l'ordre des colonnes et des certificats : + − × ÷ = ≈. */
export const OPERATION_COUNT = 6;
/** Niveaux 0 à 3 (LEVEL 1 à 4) puis 4 = BONUS ROUND. */
export const LEVELS_PER_OPERATION = 5;
export const BONUS_LEVEL = 4;

/** Variable de scène : décalage dans l'enregistrement du joueur, type et nombre d'éléments (engine.md §7.1). */
export interface RosterField {
  readonly offset: number;
  readonly kind: "u8" | "u16";
  readonly count: number;
}

const u16 = (offset: number, count = 1): RosterField => ({ offset, kind: "u16", count });
const u8 = (offset: number, count = 1): RosterField => ({ offset, kind: "u8", count });

/**
 * Variables de scènes d'un joueur. Sauf le Bowling (progression), le Rhythm Shop et Pattern Windows (réglages et peinture),
 * ce sont des drapeaux « Poly a déjà présenté le jeu ». Valeur par défaut : 0 (enregistrement vide du modèle livré ; l'original
 * appelle des rappels de remise à zéro à la création d'un joueur, `1050:0635`).
 */
export const ROSTER_FIELDS = {
  /** hub `DS:4fa4` : introduction longue de Poly déjà jouée. */
  hubPolyIntroSeen: u16(0),
  /** bowling `DS:4cb8` : index plat du sous-type de problème, par opération. */
  bowlingSubtype: u16(2, 6),
  /** bowling `DS:4cc4` : niveau courant (0 à 4) par opération. */
  bowlingLevel: u16(14, 6),
  /** bowling `DS:4cd0` : strikes (0 à 9) de la case `5 × opération + niveau`. */
  bowlingStrikes: u16(26, 30),
  /** bowling `DS:4d30` : Poly a déjà présenté le jeu. */
  bowlingPolyIntroSeen: u16(86),
  /** rhythm `DS:7798` : compteur de variante (0 à 3) de chacun des 45 morceaux. */
  rhythmVariant: u8(88, 45),
  /** rhythm `DS:76e2` : niveau courant (0 à 2). */
  rhythmLevel: u16(133),
  /** rhythm `DS:4ff4` : première explication générale déjà vue. */
  rhythmHelpSeen: u16(135),
  /** patfill `DS:7040` : motif courant (0 à 9). */
  patfillPattern: u16(137),
  /** patfill `DS:7044` : version courante (0 à 2) de chaque motif. */
  patfillVersion: u8(139, 10),
  /** patfill `DS:5bb2` : le vitrail, 3 versions × 10 motifs, 2 cellules par octet. */
  patfillStainedGlass: u8(149, 5262),
  /** patfill `DS:704e` : couleur courante (0 à 14). */
  patfillColor: u8(5411),
  /** patfill `DS:746b` : grande présentation de Poly déjà vue. */
  patfillPolyIntroSeen: u16(5412),
  /** hidden `DS:50d8`. */
  hiddenPolyIntroSeen: u16(5414),
  /** patterns `DS:57d6`. */
  patternsPolyIntroSeen: u16(5416),
  /** sticklers `DS:5946`. */
  sticklersPolyIntroSeen: u16(5418),
  /** nim (Rockets) `DS:7c02` : introduction d'aide complète déjà jouée. */
  rocketsHelpIntroSeen: u16(5420),
} as const satisfies Record<string, RosterField>;

export type RosterFieldName = keyof typeof ROSTER_FIELDS;

// --- Noms de joueur (screens/common.md §3.4) ---

/** Longueur maximale d'un nom (`SI < 0x1c`). */
export const NAME_MAX_LENGTH = 28;

/**
 * Lettres admises dans un nom. L'original n'accepte que `A–Z a–z` (`ASCII_NAME_RULES`, défaut partout) ; la vague H autorise aussi les lettres
 * accentuées du Latin-1 (`LATIN1_NAME_RULES`, décision de `plan.md`). Le stockage reste d'un octet par caractère (Windows-1252 = Latin-1 sur
 * ces lettres) : `isLetter` ne doit jamais accepter un caractère au-delà de U+00FF (`isNameChar` le refuse de toute façon). Une couche
 * d'affichage plus étroite (police sans certains glyphes) peut fournir ses propres règles, sous-ensemble du Latin-1.
 */
export interface NameRules {
  isLetter(c: string): boolean;
}

const isAsciiLetter = (c: string): boolean => /^[A-Za-z]$/.test(c);
const isDigit = (c: string): boolean => /^[0-9]$/.test(c);
/** Lettres Latin-1 : `À`–`ÿ` sauf `×` (U+00D7) et `÷` (U+00F7). */
const isLatin1Letter = (c: string): boolean => c.length === 1 && c >= "\u00c0" && c <= "\u00ff" && c !== "\u00d7" && c !== "\u00f7";

export const ASCII_NAME_RULES: NameRules = { isLetter: isAsciiLetter };
export const LATIN1_NAME_RULES: NameRules = { isLetter: (c) => isAsciiLetter(c) || isLatin1Letter(c) };

/** Caractère accepté en cours de saisie (`1080:05a1`–`05e8`) : lettre selon `rules`, chiffre, espace, point ; jamais au-delà de U+00FF. */
export function isNameChar(c: string, rules: NameRules = ASCII_NAME_RULES): boolean {
  if (c.length !== 1 || c.charCodeAt(0) > 0xff) return false;
  return rules.isLetter(c) || isDigit(c) || c === " " || c === ".";
}

/**
 * Peut-on ajouter `c` à `current` ? Règles : caractère permis, premier caractère lettre ou chiffre, 28 caractères au plus et,
 * si `fitsWidth` est fourni, largeur du texte résultant < 110 px en police `NCSclB10` (mesure fournie par la couche graphique,
 * le roster n'en connaît pas).
 */
export function canAppendNameChar(current: string, c: string, fitsWidth?: (text: string) => boolean, rules: NameRules = ASCII_NAME_RULES): boolean {
  if (!isNameChar(c, rules)) return false;
  if (current.length === 0 && !(rules.isLetter(c) || isDigit(c))) return false;
  if (current.length >= NAME_MAX_LENGTH) return false;
  return fitsWidth ? fitsWidth(current + c) : true;
}

/** Majuscule d'une lettre, si elle reste un caractère d'un octet (`ÿ` → `Ÿ` sort du Latin-1, `ß` → `SS` : inchangés). */
function upperLetter(c: string, rules: NameRules): string {
  const up = c.toUpperCase();
  return up.length === 1 && up.charCodeAt(0) <= 0xff && rules.isLetter(up) ? up : c;
}

/** Mise en forme à la validation (`1c31`) : 1re lettre et lettre après une espace en majuscule ; pas de rognage des espaces. */
export function formatPlayerName(raw: string, rules: NameRules = ASCII_NAME_RULES): string {
  let out = "";
  let upper = true;
  for (const c of raw) {
    out += upper && rules.isLetter(c) ? upperLetter(c, rules) : c;
    upper = c === " ";
  }
  return out;
}

/** Nom conforme aux règles de saisie (longueur 1 à 28, caractères permis, 1er caractère lettre ou chiffre). */
export function isValidPlayerName(name: string, rules: NameRules = ASCII_NAME_RULES): boolean {
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) return false;
  if (!(rules.isLetter(name[0]!) || isDigit(name[0]!))) return false;
  return [...name].every((c) => isNameChar(c, rules));
}

// --- Masque de réussites et grade (common.md §3.6, engine.md §7.1) ---

/** Numéro de bit de la réussite `opération` (0 à 5) × `niveau` (0 à 4, 4 = bonus) : `5 × opération + niveau`. */
export function achievementBit(operation: number, level: number): number {
  if (!Number.isInteger(operation) || operation < 0 || operation >= OPERATION_COUNT) throw new RangeError(`opération ${operation} hors de 0 à 5`);
  if (!Number.isInteger(level) || level < 0 || level >= LEVELS_PER_OPERATION) throw new RangeError(`niveau ${level} hors de 0 à 4`);
  return LEVELS_PER_OPERATION * operation + level;
}

export function maskHas(mask: number, operation: number, level: number): boolean {
  return ((mask >>> achievementBit(operation, level)) & 1) !== 0;
}

export function maskWith(mask: number, operation: number, level: number): number {
  return (mask | (1 << achievementBit(operation, level))) >>> 0;
}

/** Rang du joueur (`1018:0518`) : `1 + nombre de bits de niveau 0 à 3` positionnés sur les 6 opérations (bonus exclu), de 1 à 25. */
export function gradeOfMask(mask: number): number {
  let grade = 1;
  for (let op = 0; op < OPERATION_COUNT; op++) {
    for (let level = 0; level < BONUS_LEVEL; level++) if (maskHas(mask, op, level)) grade++;
  }
  return grade;
}

// --- Roster ---

export interface PlayerInfo {
  /** Identifiant 1 à 40 (emplacement de l'entrée, indice 1-based de l'enregistrement de variables). */
  id: number;
  name: string;
  /** Masque de réussites du Bowling. */
  mask: number;
}

export type AddPlayerResult = { ok: true; id: number; name: string } | { ok: false; reason: "empty" | "invalid" | "duplicate" | "full" };
export type RenamePlayerResult = { ok: true; name: string } | { ok: false; reason: "unknown" | "empty" | "invalid" | "duplicate" };

export class RosterFormatError extends Error {
  constructor(
    readonly reason: "size" | "version",
    message: string,
  ) {
    super(message);
    this.name = "RosterFormatError";
  }
}

/** Ordre des noms à l'écran : langue fixe (le résultat ne dépend pas du navigateur), accents et casse ignorés. */
const NAME_COLLATOR = new Intl.Collator("fr", { sensitivity: "base" });

/** Compare deux noms pour l'affichage : alphabétique sans tenir compte des accents ni de la casse, puis ordre exact, puis numéro. */
function compareNames(a: PlayerInfo, b: PlayerInfo): number {
  return NAME_COLLATOR.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id);
}

export class Roster {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Roster neuf, comme le modèle livré : version 0x20, aucun joueur, timer 10800, cliquer-poser et sons d'ambiance activés. */
  static createEmpty(): Roster {
    const roster = new Roster(new Uint8Array(ROSTER_SIZE));
    roster.view.setUint16(H_VERSION, ROSTER_VERSION);
    roster.view.setUint32(H_BOWLING_TICKS, DEFAULT_BOWLING_TICKS);
    roster.view.setUint16(H_CLICK_AND_STICK, 1);
    roster.view.setUint16(H_AMBIENT, 1);
    return roster;
  }

  /** Lit un fichier `MWRoster` (copie les octets). Lève `RosterFormatError` si la taille ou la version est mauvaise. */
  static decode(bytes: Uint8Array): Roster {
    if (bytes.length !== ROSTER_SIZE) throw new RosterFormatError("size", `roster : ${bytes.length} octets au lieu de ${ROSTER_SIZE}`);
    const roster = new Roster(bytes.slice());
    const version = roster.view.getUint16(H_VERSION);
    if (version !== ROSTER_VERSION) throw new RosterFormatError("version", `roster : version 0x${version.toString(16)} au lieu de 0x${ROSTER_VERSION.toString(16)}`);
    return roster;
  }

  /** Les 222 384 octets du fichier `MWRoster` (copie). */
  encode(): Uint8Array {
    return this.bytes.slice();
  }

  clone(): Roster {
    return new Roster(this.bytes.slice());
  }

  // --- En-tête ---

  /** Nombre de joueurs tel que le tient l'en-tête (`DS:1e8e`). */
  get playerCount(): number {
    return this.view.getUint16(H_PLAYER_COUNT);
  }

  /** Durée de la partie de Bowling, en ticks (`DS:0332`). */
  get bowlingTicks(): number {
    return this.view.getUint32(H_BOWLING_TICKS);
  }

  set bowlingTicks(ticks: number) {
    this.view.setUint32(H_BOWLING_TICKS, ticks >>> 0);
  }

  /** Durée de la partie de Bowling en secondes (champ du moniteur). */
  get bowlingSeconds(): number {
    return Math.round(this.bowlingTicks / BOWLING_TICKS_PER_SECOND);
  }

  /** Fixe le timer en secondes ; l'original n'accepte que 1 à 999 et ignore le reste. Renvoie vrai si la valeur a été prise. */
  setBowlingSeconds(seconds: number): boolean {
    if (!Number.isInteger(seconds) || seconds < MIN_BOWLING_SECONDS || seconds > MAX_BOWLING_SECONDS) return false;
    this.bowlingTicks = seconds * BOWLING_TICKS_PER_SECOND;
    return true;
  }

  /** Cliquer-poser (vrai) ou glisser (faux), `DS:02b8`. */
  get clickAndStick(): boolean {
    return this.view.getUint16(H_CLICK_AND_STICK) !== 0;
  }

  set clickAndStick(value: boolean) {
    this.view.setUint16(H_CLICK_AND_STICK, value ? 1 : 0);
  }

  /** Sons d'ambiance et musique des activités, `DS:2d64`. */
  get ambient(): boolean {
    return this.view.getUint16(H_AMBIENT) !== 0;
  }

  set ambient(value: boolean) {
    this.view.setUint16(H_AMBIENT, value ? 1 : 0);
  }

  // --- Joueurs ---

  private entryOffset(id: number): number {
    if (!Number.isInteger(id) || id < 1 || id > MAX_PLAYERS) throw new RangeError(`joueur ${id} hors de 1 à ${MAX_PLAYERS}`);
    return H_ENTRIES + ENTRY_SIZE * (id - 1);
  }

  private recordOffset(id: number): number {
    this.entryOffset(id);
    return ROSTER_RECORD_SIZE * id;
  }

  isUsed(id: number): boolean {
    return this.bytes[this.entryOffset(id) + E_USED] !== 0;
  }

  private readName(id: number): string {
    const start = this.entryOffset(id) + E_NAME;
    const field = this.bytes.subarray(start, start + NAME_FIELD_SIZE);
    const end = field.indexOf(0);
    // Un octet par caractère : ASCII, ou lettre Latin-1 (identique à Windows-1252 sur ces lettres) de `LATIN1_NAME_RULES`.
    return String.fromCharCode(...(end === -1 ? field : field.subarray(0, end)));
  }

  private writeName(id: number, name: string): void {
    const start = this.entryOffset(id) + E_NAME;
    this.bytes.fill(0, start, start + NAME_FIELD_SIZE);
    for (let i = 0; i < name.length; i++) this.bytes[start + i] = name.charCodeAt(i) & 0xff;
  }

  getPlayer(id: number): PlayerInfo | undefined {
    return this.isUsed(id) ? { id, name: this.readName(id), mask: this.getMask(id) } : undefined;
  }

  /** Joueurs en ordre alphabétique (l'ordre d'affichage de la liste de connexion). */
  players(): PlayerInfo[] {
    const list: PlayerInfo[] = [];
    for (let id = 1; id <= MAX_PLAYERS; id++) {
      const player = this.getPlayer(id);
      if (player) list.push(player);
    }
    return list.sort(compareNames);
  }

  private findByName(name: string, except = 0): number {
    for (let id = 1; id <= MAX_PLAYERS; id++) if (id !== except && this.isUsed(id) && this.readName(id) === name) return id;
    return 0;
  }

  /**
   * Crée un joueur (`1c31`) : mise en forme du nom, refus du nom vide, invalide, déjà pris (`strcmp` exact, donc sensible à la casse,
   * sur le nom mis en forme) ou de la 41e entrée. Premier emplacement libre, masque et variables de scènes remis à zéro.
   */
  addPlayer(raw: string, rules: NameRules = ASCII_NAME_RULES): AddPlayerResult {
    if (raw.length === 0) return { ok: false, reason: "empty" };
    const name = formatPlayerName(raw, rules);
    if (!isValidPlayerName(name, rules)) return { ok: false, reason: "invalid" };
    if (this.findByName(name)) return { ok: false, reason: "duplicate" };
    let id = 1;
    while (id <= MAX_PLAYERS && this.isUsed(id)) id++;
    if (id > MAX_PLAYERS) return { ok: false, reason: "full" };
    this.bytes[this.entryOffset(id) + E_USED] = 1;
    this.writeName(id, name);
    this.view.setUint32(this.entryOffset(id) + E_MASK, 0, true);
    this.clearRecord(id);
    this.view.setUint16(H_PLAYER_COUNT, this.playerCount + 1);
    return { ok: true, id, name };
  }

  /**
   * Supprime un joueur (`1080:152f`). Écart assumé : l'original ne vide que l'octet « utilisé » et laisse nom, masque et variables
   * (écrasés à la création suivante) ; on les efface tout de suite, sans effet observable pour le jeu. Renvoie faux si inconnu.
   */
  removePlayer(id: number): boolean {
    if (!this.isUsed(id)) return false;
    const entry = this.entryOffset(id);
    this.bytes.fill(0, entry, entry + ENTRY_SIZE);
    this.clearRecord(id);
    this.view.setUint16(H_PLAYER_COUNT, Math.max(0, this.playerCount - 1));
    return true;
  }

  /** Renomme un joueur avec les mêmes règles que la création (le nom actuel n'est pas un doublon de lui-même). */
  renamePlayer(id: number, raw: string, rules: NameRules = ASCII_NAME_RULES): RenamePlayerResult {
    if (!this.isUsed(id)) return { ok: false, reason: "unknown" };
    if (raw.length === 0) return { ok: false, reason: "empty" };
    const name = formatPlayerName(raw, rules);
    if (!isValidPlayerName(name, rules)) return { ok: false, reason: "invalid" };
    if (this.findByName(name, id)) return { ok: false, reason: "duplicate" };
    this.writeName(id, name);
    return { ok: true, name };
  }

  // --- Masque de réussites ---

  getMask(id: number): number {
    return this.view.getUint32(this.entryOffset(id) + E_MASK, true);
  }

  setMask(id: number, mask: number): void {
    this.view.setUint32(this.entryOffset(id) + E_MASK, mask >>> 0, true);
  }

  hasAchievement(id: number, operation: number, level: number): boolean {
    return maskHas(this.getMask(id), operation, level);
  }

  setAchievement(id: number, operation: number, level: number): void {
    this.setMask(id, maskWith(this.getMask(id), operation, level));
  }

  /** Rang 1 à 25 du joueur (indexe la `STRL` 5000). */
  grade(id: number): number {
    return gradeOfMask(this.getMask(id));
  }

  // --- Variables de scènes ---

  private clearRecord(id: number): void {
    const start = this.recordOffset(id);
    this.bytes.fill(0, start, start + ROSTER_RECORD_SIZE);
  }

  private fieldOffset(id: number, field: RosterField, index: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= field.count) throw new RangeError(`indice ${index} hors de 0 à ${field.count - 1}`);
    return this.recordOffset(id) + field.offset + index * (field.kind === "u16" ? 2 : 1);
  }

  /** Lit un élément d'une variable de scène du joueur `id` (u16 gros-boutiste ou octet). */
  getVar(id: number, name: RosterFieldName, index = 0): number {
    const field: RosterField = ROSTER_FIELDS[name];
    const at = this.fieldOffset(id, field, index);
    return field.kind === "u16" ? this.view.getUint16(at) : this.bytes[at]!;
  }

  setVar(id: number, name: RosterFieldName, value: number, index = 0): void {
    const field: RosterField = ROSTER_FIELDS[name];
    const at = this.fieldOffset(id, field, index);
    if (field.kind === "u16") this.view.setUint16(at, value & 0xffff);
    else this.bytes[at] = value & 0xff;
  }

  /** Vue modifiable sur les octets d'un tableau `u8` (vitrail de Pattern Windows, compteurs de variantes). */
  bytesOf(id: number, name: RosterFieldName): Uint8Array {
    const field: RosterField = ROSTER_FIELDS[name];
    if (field.kind !== "u8") throw new TypeError(`${name} n'est pas un tableau d'octets`);
    const start = this.recordOffset(id) + field.offset;
    return this.bytes.subarray(start, start + field.count);
  }

  /** Tableau d'entiers d'une variable de scène, en lecture seule (copie). */
  getVarArray(id: number, name: RosterFieldName): number[] {
    return Array.from({ length: ROSTER_FIELDS[name].count }, (_, i) => this.getVar(id, name, i));
  }

  /** Remet à zéro les variables de scènes d'un joueur (nouveau départ). */
  resetVars(id: number): void {
    this.clearRecord(id);
  }
}

// --- Persistance ---

/** Clé de `HostStorage` ; la valeur est le fichier `MWRoster` entier en base64. */
export const ROSTER_STORAGE_KEY = "retrovibe:mathemagique:roster";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `missing` : rien en stockage ; `invalid` : contenu illisible (base64, taille ou version) — le stockage n'est pas touché tant qu'on n'appelle pas `save` (qui en garde alors une copie de secours). */
export type RosterLoadStatus = "ok" | "missing" | "invalid";

export interface RosterLoad {
  roster: Roster;
  status: RosterLoadStatus;
}

/** Copie du contenu illisible, gardée avant le premier écrasement (une seule fois : jamais remplacée). */
export const ROSTER_BACKUP_KEY = "retrovibe:mathemagique:roster.bak";

function isReadable(text: string): boolean {
  try {
    Roster.decode(fromBase64(text));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lit et écrit le roster dans le stockage de l'hôte.
 *
 * Sécurité des données : un contenu illisible (`invalid`) est copié sous `ROSTER_BACKUP_KEY` (si aucune copie n'existe) avant le premier
 * écrasement, avec un avertissement en console. Entre deux onglets, `save` relit le stockage : si le contenu n'est plus celui vu au
 * dernier `load` / `save`, l'autre écriture est écrasée (pas de fusion : limite connue, dernière écriture gagnante) avec un avertissement.
 */
export class RosterStore {
  /** Contenu brut vu au dernier `load` / `save` réussi ; `null` = rien en stockage. */
  private lastRaw: string | null = null;
  /** Le dernier `load` a rendu un contenu illisible, pas encore sauvegardé. */
  private unreadablePending = false;

  constructor(private readonly storage: HostStorage) {}

  /** Roster enregistré ; roster neuf (non enregistré) si `missing` ou `invalid`. */
  load(): RosterLoad {
    const text = this.storage.get(ROSTER_STORAGE_KEY);
    this.lastRaw = text;
    this.unreadablePending = false;
    if (text === null) return { roster: Roster.createEmpty(), status: "missing" };
    try {
      return { roster: Roster.decode(fromBase64(text)), status: "ok" };
    } catch {
      this.unreadablePending = true;
      return { roster: Roster.createEmpty(), status: "invalid" };
    }
  }

  /** Renvoie faux si l'écriture a échoué (quota, mode privé). */
  save(roster: Roster): boolean {
    const current = this.storage.get(ROSTER_STORAGE_KEY);
    if (current !== null && (this.unreadablePending || current !== this.lastRaw)) {
      if (current !== this.lastRaw) console.warn("Math Workshop : les joueurs ont été modifiés dans un autre onglet ; cette écriture les remplace (pas de fusion).");
      if (!isReadable(current)) this.backUp(current);
    }
    const text = toBase64(roster.encode());
    const ok = this.storage.set(ROSTER_STORAGE_KEY, text);
    if (ok) {
      this.lastRaw = text;
      this.unreadablePending = false;
    }
    return ok;
  }

  private backUp(raw: string): void {
    if (this.storage.get(ROSTER_BACKUP_KEY) !== null) {
      console.warn("Math Workshop : les joueurs enregistrés sont illisibles ; une copie existe déjà, elle est conservée.");
      return;
    }
    if (this.storage.set(ROSTER_BACKUP_KEY, raw)) console.warn(`Math Workshop : les joueurs enregistrés sont illisibles ; copie gardée sous « ${ROSTER_BACKUP_KEY} » avant écrasement.`);
    else console.warn("Math Workshop : les joueurs enregistrés sont illisibles et la copie de secours a échoué (stockage plein ou indisponible) ; ils vont être écrasés.");
  }

  clear(): void {
    this.storage.remove(ROSTER_STORAGE_KEY);
  }
}

/**
 * Roster de la session : le fichier chargé, le joueur courant (`DS:1e90`, 1-based, 0 = personne) et l'enregistrement.
 * Les scènes modifient `roster` puis appellent `save()` aux moments où l'original écrit (fermeture du moniteur, niveau réussi,
 * sortie d'activité).
 */
export class RosterState {
  readonly roster: Roster;
  /** Identifiant du joueur connecté ; 0 = personne. */
  currentPlayerId = 0;
  /** Faux si le dernier `save` a échoué. */
  saved = true;
  /** Contenu du stockage illisible au chargement : l'hôte peut le signaler avant d'écraser. */
  readonly loadStatus: RosterLoadStatus;
  private warnedUnsaved = false;

  constructor(private readonly store: RosterStore) {
    const { roster, status } = store.load();
    this.roster = roster;
    this.loadStatus = status;
  }

  get currentPlayer(): PlayerInfo | undefined {
    return this.currentPlayerId ? this.roster.getPlayer(this.currentPlayerId) : undefined;
  }

  save(): boolean {
    this.saved = this.store.save(this.roster);
    if (!this.saved && !this.warnedUnsaved) {
      this.warnedUnsaved = true;
      console.warn("Math Workshop : les joueurs n'ont pas pu être enregistrés (stockage plein ou indisponible).");
    }
    return this.saved;
  }
}
