import { EXIT_SLOTS, OBJECT_BYTES } from "../data/world";
import type { ScoreEntry, World, WorldObject, WorldRoom } from "../data/world";
import { type Cadence, type GameClock, createCadence, createClock } from "./clock";
import { DeferredEventQueue } from "./events";
import type { PathState, PathStep, PathTarget } from "./paths";

/**
 * État mutable du monde d'Armaeth, construit depuis `parseWorld` (`docs/armaeth/engine.md` § 5, § 6, § 9.3, § 10).
 * Module pur : aucun accès au navigateur. Les noms de champs sont ceux de `data/world.ts`.
 *
 * Les listes du moteur (§ 6.2) sont des tableaux dans l'**ordre de parcours** du moteur : l'insertion se fait **en tête**
 * (`unshift`), donc le parcours est l'inverse de l'ordre de création.
 */

/**
 * État d'animation d'un objet (octets +0x44 à +0x4D de l'enregistrement, `engine.md` § 6.1 et § 6.3). Ces octets ne sont pas
 * relus d'une sauvegarde (le chargeur ne copie que 0x00-0x43 et 0x52-0x7B) : ils sont reconstruits à la mise en place de l'objet.
 */
export interface AnimState {
  /** `Dir` +0x48 : direction de la séquence courante (0 droite, 1 gauche, 2 vers l'avant, 3 vers le fond) ; 0xFF = aucune (à relancer). */
  dir: number;
  /** `Tot` +0x49 : nombre de pas de la séquence courante. */
  total: number;
  /** `Ind` +0x4A : indice du pas courant (1..`total`). */
  index: number;
  /** `Rep` +0x4B : durée restante du pas, en tics. */
  remaining: number;
  /** +0x44 : miroir horizontal du dessin (0 ou 1). */
  mirror: number;
  /** `dpX`, `dpY`, `dpP` +0x45..+0x47 : pas de déplacement par tic. */
  dpX: number;
  dpY: number;
  dpP: number;
  /** Numéro de l'image courante dans la ressource (le moteur garde un pointeur `Des` +0x4E) ; -1 = pas encore choisie. */
  frame: number;
  /** `Hau`, `Lar` +0x4C, +0x4D : dimensions de l'image courante. */
  height: number;
  width: number;
}

/** Procédure de comportement `Fct` (+0x8C) : appelée à chaque mise à jour, rend 0 (recommencer la liste) ou 7. */
export type BehaviorProc = (obj: GameObject) => number;

/** Décalages des champs de l'enregistrement qui n'ont pas de champ nommé (lus et écrits dans `raw`, donc sauvegardés). */
export const RAW_OFFSET = { tim: 0x32, nbr: 0x36, bag: 0x3a, col: 0x3c, err: 0x3e, inf: 0x3f } as const;

/** Suivi de trajet (`engine.md` § 6.1, +0x63..+0x78) : `Mod`, `Inv`/`Dir`, `Nbc`, `Def`, `Nc`, `Xc`, `Yc`, `Pc`, `X1`, `X2`, `Cib`. */
const PATH_OFFSET = { mode: 0x63, lateral: 0x64, memo: 0x65, remaining: 0x6c, defined: 0x6e, plane: 0x6f, x: 0x70, y: 0x72, p: 0x74, x1: 0x76, x2: 0x77, follow: 0x78 } as const;

/** Objet du monde : l'enregistrement de 144 octets plus les liens que le moteur tient par pointeurs. */
export interface GameObject extends WorldObject {
  /** Salle qui le contient quand `location` vaut 1, 3 ou 4 (les objets d'interface de type 0 sont rattachés à la salle d'indice 0). */
  room: GameRoom | null;
  /** Objet qui le contient quand `location` vaut 2. */
  holder: GameObject | null;
  /** Contenu (liste `Pos` +0x7C, chaînée par `Lis`), en ordre de parcours. */
  contents: GameObject[];
  /** Animation courante (non sauvegardée). */
  anim: AnimState;
  /** `Fct` +0x8C : procédure résolue paresseusement (`1ec8:000a`) à la première mise à jour ; `null` = à résoudre. */
  behavior: BehaviorProc | null;
  /**
   * Accesseurs de l'enregistrement que le déplacement, le placement et les trajets lisent et écrivent (`MoverBody`, `PlaceBody`,
   * `PathBody`) : hauteur et largeur de l'image courante (+0x4C, +0x4D), pas par tic (+0x45..+0x47), `Err` (+0x3E), `Inf`
   * (+0x3F), `Col` (+0x3C) et `Tim` (+0x32). Propriétés énumérables : `{ ...objet }` en copie les valeurs.
   */
  height: number;
  width: number;
  stepX: number;
  stepY: number;
  stepP: number;
  err: number;
  info: number;
  col: number;
  tim: number;
  /** Trajet en cours : les champs scalaires vivent dans `raw` (+0x63..+0x78, donc sauvegardés), les nœuds (`Chm`) sont recalculés. */
  path: PathState;
}

/** Salle : l'enregistrement de 42 octets plus ses deux listes d'objets. */
export interface GameRoom extends WorldRoom {
  /** Indice dans la table des salles (les sorties désignent des indices). */
  index: number;
  /** Liste A (+0x22) : objets de type 2 posés dans la salle. */
  listA: GameObject[];
  /** Liste B (+0x26) : décors (type 1). */
  listB: GameObject[];
}

/** Résultat de `addScore` (`2255:00e8`). */
export interface ScoreAward {
  entry: ScoreEntry;
  /** Points ajoutés au score (0 si déjà attribués ou inconnus). */
  points: number;
  /** Jingle à jouer (0 = aucun). */
  sound: number;
  /** Vrai si c'est un rejeu du jingle d'une entrée déjà attribuée (le compteur de répétitions a baissé). */
  replay: boolean;
}

/** Champs d'un objet à la création ; le reste est à zéro. */
export type ObjectInit = Partial<Omit<WorldObject, "serial" | "raw">> & { typ: number };

export function createAnimState(): AnimState {
  return { dir: 0, total: 0, index: 0, remaining: 0, mirror: 0, dpX: 0, dpY: 0, dpP: 0, frame: -1, height: 0, width: 0 };
}

/** `PathState` posé sur l'enregistrement de l'objet : chaque champ scalaire est lu et écrit dans `raw`. */
function createPathView(obj: { raw: Uint8Array }): PathState {
  const u8 = (at: number) => obj.raw[at];
  const setU8 = (at: number, v: number) => void (obj.raw[at] = v & 0xff);
  const s8 = (at: number) => (obj.raw[at] << 24) >> 24;
  const s16 = (at: number) => ((obj.raw[at] | (obj.raw[at + 1] << 8)) << 16) >> 16;
  const setU16 = (at: number, v: number) => {
    obj.raw[at] = v & 0xff;
    obj.raw[at + 1] = (v >> 8) & 0xff;
  };
  let nodes: PathStep[] = [];
  let here: PathStep | null = null;
  return {
    get defined() {
      return u8(PATH_OFFSET.defined) !== 0;
    },
    set defined(v: boolean) {
      setU8(PATH_OFFSET.defined, v ? 1 : 0);
    },
    get nodes() {
      return nodes;
    },
    set nodes(v: PathStep[]) {
      nodes = v;
    },
    get remaining() {
      return s16(PATH_OFFSET.remaining);
    },
    set remaining(v: number) {
      setU16(PATH_OFFSET.remaining, v);
    },
    get mode() {
      return u8(PATH_OFFSET.mode);
    },
    set mode(v: number) {
      setU8(PATH_OFFSET.mode, v);
    },
    get lateral() {
      return s8(PATH_OFFSET.lateral);
    },
    set lateral(v: number) {
      setU8(PATH_OFFSET.lateral, v);
    },
    get memo() {
      return s8(PATH_OFFSET.memo);
    },
    set memo(v: number) {
      setU8(PATH_OFFSET.memo, v);
    },
    get x1() {
      return u8(PATH_OFFSET.x1);
    },
    set x1(v: number) {
      setU8(PATH_OFFSET.x1, v);
    },
    get x2() {
      return u8(PATH_OFFSET.x2);
    },
    set x2(v: number) {
      setU8(PATH_OFFSET.x2, v);
    },
    get here() {
      return here;
    },
    set here(v: PathStep | null) {
      here = v;
    },
    /** `Cib` (+0x78) non nul : la destination `Xc, Yc, Pc, Nc` est valide. */
    get target(): PathTarget | null {
      if (obj.raw[PATH_OFFSET.follow] === 0 && obj.raw[PATH_OFFSET.follow + 1] === 0) return null;
      return { x: s16(PATH_OFFSET.x), y: s16(PATH_OFFSET.y), p: s16(PATH_OFFSET.p), plane: u8(PATH_OFFSET.plane) };
    },
    set target(v: PathTarget | null) {
      if (!v) {
        setU16(PATH_OFFSET.follow, 0);
        return;
      }
      setU16(PATH_OFFSET.x, v.x);
      setU16(PATH_OFFSET.y, v.y);
      setU16(PATH_OFFSET.p, v.p);
      setU8(PATH_OFFSET.plane, v.plane);
      setU16(PATH_OFFSET.follow, 7);
    },
  };
}

const rawField = (offset: number, size: 1 | 2): PropertyDescriptor => ({
  enumerable: true,
  get(this: GameObject) {
    return size === 1 ? rawU8(this, offset) : rawU16(this, offset);
  },
  set(this: GameObject, v: number) {
    if (size === 1) setRawU8(this, offset, v);
    else setRawU16(this, offset, v);
  },
});

const animField = (key: keyof AnimState): PropertyDescriptor => ({
  enumerable: true,
  get(this: GameObject) {
    return this.anim[key];
  },
  set(this: GameObject, v: number) {
    (this.anim as unknown as Record<string, number>)[key] = v;
  },
});

/** Accesseurs communs à tous les objets (voir `GameObject`). */
const OBJECT_ACCESSORS: PropertyDescriptorMap = {
  height: animField("height"),
  width: animField("width"),
  stepX: animField("dpX"),
  stepY: animField("dpY"),
  stepP: animField("dpP"),
  err: rawField(RAW_OFFSET.err, 1),
  info: rawField(RAW_OFFSET.inf, 1),
  col: rawField(RAW_OFFSET.col, 2),
  tim: rawField(RAW_OFFSET.tim, 2),
};

function linkObject(raw: WorldObject): GameObject {
  const base = { ...raw, raw: new Uint8Array(raw.raw), room: null, holder: null, contents: [], anim: createAnimState(), behavior: null };
  const obj = Object.defineProperties(base, OBJECT_ACCESSORS) as unknown as GameObject;
  obj.path = createPathView(obj);
  return obj;
}

/** Lecture / écriture d'un octet ou d'un mot (little-endian) de l'enregistrement brut, aux décalages de `RAW_OFFSET`. */
export function rawU8(obj: GameObject, offset: number): number {
  return obj.raw[offset];
}

export function setRawU8(obj: GameObject, offset: number, value: number): void {
  obj.raw[offset] = value & 0xff;
}

export function rawU16(obj: GameObject, offset: number): number {
  return obj.raw[offset] | (obj.raw[offset + 1] << 8);
}

export function setRawU16(obj: GameObject, offset: number, value: number): void {
  obj.raw[offset] = value & 0xff;
  obj.raw[offset + 1] = (value >> 8) & 0xff;
}

function detach(list: GameObject[], obj: GameObject): void {
  const i = list.indexOf(obj);
  if (i >= 0) list.splice(i, 1);
}

interface FieldSpec {
  size: 1 | 2;
  signed?: boolean;
  get(obj: GameObject): number;
  set(obj: GameObject, value: number): void;
}

const named = <K extends keyof WorldObject>(key: K, size: 1 | 2, signed = false): FieldSpec => ({
  size,
  signed,
  get: (obj) => obj[key] as number,
  set: (obj, value) => {
    (obj as unknown as Record<string, number>)[key] = value;
  },
});

/** Champs de l'enregistrement qui ont une copie nommée (ou animée) dans l'objet : écrits des deux côtés par `writeObjectField`. */
const FIELDS: Record<number, FieldSpec> = {
  0x04: named("typ", 1),
  0x05: named("gst", 1),
  0x06: named("mob", 1),
  0x07: named("dep", 1),
  0x08: named("txt", 1),
  0x0a: named("light", 2, true),
  0x18: named("value", 2, true),
  0x1a: named("weight", 2, true),
  0x1c: named("capacity", 2, true),
  0x1e: named("pickable", 1),
  0x1f: named("canContain", 1),
  0x2d: named("ego", 1),
  0x2e: named("fig", 1),
  0x2f: named("hidden", 1),
  0x30: named("animId", 2),
  0x52: named("presence", 1),
  0x53: named("plane", 1),
  0x54: named("x", 2, true),
  0x56: named("y", 2, true),
  0x58: named("p", 2, true),
  0x5a: named("ground", 1),
  0x5b: named("location", 1),
  0x60: named("speedX", 1, true),
  0x61: named("speedY", 1, true),
  0x62: named("speedP", 1, true),
  0x44: { size: 1, get: (o) => o.anim.mirror, set: (o, v) => void (o.anim.mirror = v) },
  0x45: { size: 1, get: (o) => o.anim.dpX, set: (o, v) => void (o.anim.dpX = v) },
  0x46: { size: 1, get: (o) => o.anim.dpY, set: (o, v) => void (o.anim.dpY = v) },
  0x47: { size: 1, get: (o) => o.anim.dpP, set: (o, v) => void (o.anim.dpP = v) },
  0x48: { size: 1, get: (o) => o.anim.dir, set: (o, v) => void (o.anim.dir = v) },
  0x49: { size: 1, get: (o) => o.anim.total, set: (o, v) => void (o.anim.total = v) },
  0x4a: { size: 1, get: (o) => o.anim.index, set: (o, v) => void (o.anim.index = v) },
  0x4b: { size: 1, get: (o) => o.anim.remaining, set: (o, v) => void (o.anim.remaining = v) },
  0x4c: { size: 1, get: (o) => o.anim.height, set: (o, v) => void (o.anim.height = v) },
  0x4d: { size: 1, get: (o) => o.anim.width, set: (o, v) => void (o.anim.width = v) },
};

/** Lit un octet (`size` 1) ou un mot (`size` 2) de l'enregistrement de 144 octets ; signé pour les champs signés connus. */
export function readObjectField(obj: GameObject, offset: number, size: 1 | 2 = 1): number {
  const spec = FIELDS[offset];
  if (spec && spec.size === size) return spec.get(obj);
  if (offset === 0x00 && size === 2) return obj.num;
  if (offset === 0x02 && size === 2) return obj.serial;
  return size === 1 ? rawU8(obj, offset) : rawU16(obj, offset);
}

/**
 * Écrit un octet ou un mot de l'enregistrement en gardant `raw` et les champs nommés (ou d'animation) d'accord. Un champ de
 * `Ser` passe par `state.setSerial` pour garder les index à jour.
 */
export function writeObjectField(obj: GameObject, offset: number, size: 1 | 2, value: number, state?: WorldState): void {
  const masked = size === 1 ? value & 0xff : value & 0xffff;
  if (size === 1) setRawU8(obj, offset, masked);
  else setRawU16(obj, offset, masked);
  const spec = FIELDS[offset];
  if (spec && spec.size === size) {
    const bits = size * 8;
    spec.set(obj, spec.signed ? (masked << (32 - bits)) >> (32 - bits) : masked);
  } else if (offset === 0x00 && size === 2) obj.num = masked;
  else if (offset === 0x02 && size === 2) {
    if (state) state.setSerial(obj, masked);
    else obj.serial = masked;
  }
}

export class WorldState {
  /** Les 27 mots de l'en-tête tels que lus : seuls les champs nommés ci-dessous les remplacent à l'écriture. */
  readonly headerWords: number[];
  /** Dernier numéro de série attribué (`DGROUP:4b4a`). */
  lastSerial: number;
  /** Lettres significatives du dictionnaire (octet bas du mot 3). */
  dictionaryLetters: number;
  /** Chapitre * 100 + niveau. */
  chapterLevel: number;
  score: number;
  /** Identifiant de la salle courante (mot 12) ; 0 = aucune. */
  currentRoom: number;
  readonly scoreTable: ScoreEntry[];
  readonly events: DeferredEventQueue;
  readonly cadence: Cadence;
  readonly clock: GameClock;
  readonly rooms: GameRoom[];
  /** Listes globales (`Nxt`) : interface (`4c0e`, type 0), décors (`4c06`, type 1), objets (`4c0a`, type 2). */
  readonly interfaceObjects: GameObject[] = [];
  readonly decors: GameObject[] = [];
  readonly objects: GameObject[] = [];
  hero: GameObject | null = null;
  /** Salle **chargée** (`DGROUP:4b84`) : celle dont les objets sont mis à jour et dessinés ; `null` tant qu'aucune n'est chargée. */
  loadedRoom: GameRoom | null = null;
  /** Salle **voulue** (`DGROUP:4b80`) : quand elle diffère de `loadedRoom`, la boucle principale recharge (`room.ts`). */
  wantedRoom: GameRoom | null = null;
  /** Objet sélectionné (`DGROUP:4c12`) dont le contenu s'affiche dans le volet d'objet ; non sauvegardé. */
  selected: GameObject | null = null;
  /** Première image d'une salle (`DGROUP:0e58`) : les objets de type 2 et l'horloge n'avancent pas. */
  firstFrame = false;
  /** `DGROUP:4b44` (jeton `skp`) : non nul = pas d'introduction de niveau (`characters.md` § 11) ; non sauvegardé. */
  skipIntro = 0;
  /** Un script est ouvert (`DGROUP:4b34`) ; non sauvegardé. */
  scriptRunning = false;
  /** Pièce trop sombre pour agir (`197e:0272`, niveau de lumière < -40) ; recalculé par la lumière. */
  darkRoom = false;
  /** Niveau de débogage du jeton `dgs` ; non sauvegardé. */
  debugLevel = 0;

  private readonly bySerial = new Map<number, GameObject>();
  private readonly roomsById = new Map<number, GameRoom>();

  constructor(world: World) {
    const h = world.header;
    this.headerWords = [...h.words];
    this.lastSerial = h.lastSerial;
    this.dictionaryLetters = h.dictionaryLetters;
    this.chapterLevel = h.chapterLevel;
    this.score = h.score;
    this.currentRoom = h.currentRoom;
    this.scoreTable = world.scoreTable.map((e) => ({ ...e }));
    this.events = new DeferredEventQueue(world.deferredEvents.capacity, world.deferredEvents.events);
    const w = h.words;
    // Octets de l'en-tête (engine.md § 10.4) : mot 5 = {course 4b50, délai 4b51}, mot 6 = {compteur 4b52, pause 4b53}, mot 7 = {heure, minute}.
    this.cadence = { ...createCadence(w[5] >> 8), counter: w[6] & 0xff, pause: w[6] >> 8 };
    this.clock = createClock(w[7] & 0xff, w[7] >> 8, w[8]);
    this.rooms = world.rooms.map((room, index) => ({ ...room, exits: [...room.exits], barriers: [...room.barriers], words: [...room.words], index, listA: [], listB: [] }));
    for (const room of this.rooms) if (!this.roomsById.has(room.id)) this.roomsById.set(room.id, room);

    // Création dans l'ordre du fichier (192e:0008) ; l'insertion en tête inverse les listes.
    for (const record of world.objects) {
      const obj = this.register(linkObject(record));
      const location = obj.location;
      switch (obj.location) {
        case 1: {
          const room = this.roomsById.get(obj.container);
          if (!room) throw new Error(`Monde invalide : salle ${obj.container} introuvable pour l'objet ${obj.serial}`);
          this.attachToRoom(obj, room);
          break;
        }
        case 2: {
          const holder = this.bySerial.get(obj.container);
          if (!holder) throw new Error(`Monde invalide : conteneur ${obj.container} introuvable pour l'objet ${obj.serial}`);
          this.attachToHolder(obj, holder);
          break;
        }
        case 3:
        case 4: {
          // Rangés dans la salle d'indice 0 (192e:0008) ; la nature d'origine est conservée.
          this.attachToRoom(obj, this.rooms[0]);
          obj.location = location;
          break;
        }
        default:
          throw new Error(`Monde invalide : nature de conteneur ${obj.location} (objet ${obj.serial})`);
      }
      if (obj.typ === 0) this.makeInterface(obj, location);
    }
    this.hero = h.heroSerial ? (this.bySerial.get(h.heroSerial) ?? null) : null;
    this.wantedRoom = this.resolveCurrentRoom() ?? null;
  }

  /** Alias de lisibilité : construit l'état depuis la sortie de `parseWorld`. */
  static fromWorld(world: World): WorldState {
    return new WorldState(world);
  }

  // --- recherche -----------------------------------------------------------------------------------------------------

  roomByIndex(index: number): GameRoom | undefined {
    return this.rooms[index];
  }

  /** Salle par identifiant de scène (`gm_find_scene`). */
  roomById(id: number): GameRoom | undefined {
    return this.roomsById.get(id);
  }

  /** Voisin par emplacement de sortie 0..5 (indice dans la table ; 0 = pas de sortie). */
  neighbour(room: GameRoom, slot: number): GameRoom | undefined {
    if (slot < 0 || slot >= EXIT_SLOTS) return undefined;
    const dest = room.exits[slot];
    return dest === 0 ? undefined : this.rooms[dest];
  }

  /** Code de barrage d'un emplacement (0 = libre). */
  barrier(room: GameRoom, slot: number): number {
    return room.barriers[slot] ?? 0;
  }

  findBySerial(serial: number): GameObject | undefined {
    return this.bySerial.get(serial);
  }

  /** Premier objet de cette ressource dans l'ordre de parcours de la liste globale de son type. */
  findByNum(num: number, typ = 2): GameObject | undefined {
    return this.listOf(typ).find((o) => o.num === num);
  }

  findAllByNum(num: number, typ = 2): GameObject[] {
    return this.listOf(typ).filter((o) => o.num === num);
  }

  /**
   * Salle visée au chargement (192e:0008) : salle de l'identifiant courant, sinon conteneur du héros, sinon salle d'indice 1.
   * hypothèse (engine.md §10) : le « conteneur du héros » est la salle qui le contient directement.
   */
  resolveCurrentRoom(): GameRoom | undefined {
    if (this.currentRoom === 0) return this.hero?.room ?? this.rooms[1];
    return this.roomsById.get(this.currentRoom);
  }

  // --- création, suppression, déplacement ----------------------------------------------------------------------------

  /**
   * `gm_create_object` : numéro de série suivant (`++lastSerial`, 0 pour les décors), enregistrement à zéro, insertion en tête de
   * la liste globale du type. L'objet n'est dans aucune salle (`location` 0) tant qu'on ne l'a pas rangé ; ceux de type 0
   * sont rattachés à la salle d'indice 0 (`location` 3).
   */
  createObject(init: ObjectInit): GameObject {
    const { typ, ...fields } = init;
    const base = new Uint8Array(OBJECT_BYTES);
    const obj = linkObject({
      num: 0, serial: 0, typ, gst: 0, mob: 0, dep: 0, txt: 0, light: 0, value: 0, weight: 0, capacity: 0, pickable: 0, canContain: 0,
      ego: 0, fig: 0, hidden: 0, animId: 0, presence: 0, plane: 0, x: 0, y: 0, p: 0, ground: 0, location: 0, container: 0,
      speedX: 0, speedY: 0, speedP: 0, raw: base,
      ...fields,
    });
    if (typ !== 1) obj.serial = ++this.lastSerial;
    this.register(obj);
    if (typ === 0) this.makeInterface(obj, 3);
    return obj;
  }

  /** Détruit l'objet et, récursivement, son contenu. Le héros détruit n'existe plus (`hero` = null). */
  deleteObject(obj: GameObject): void {
    for (const child of [...obj.contents]) this.deleteObject(child);
    this.detachFromPlace(obj);
    detach(this.listOf(obj.typ), obj);
    if (obj.serial !== 0 && this.bySerial.get(obj.serial) === obj) this.bySerial.delete(obj.serial);
    if (this.hero === obj) this.hero = null;
    if (this.selected === obj) this.selected = null;
  }

  /** Pose l'objet dans une salle (en tête de sa liste A, ou B pour un décor). Les objets d'interface n'en changent pas. */
  moveToRoom(obj: GameObject, room: GameRoom): void {
    if (obj.typ === 0) throw new Error("Un objet d'interface reste rattaché à la salle d'indice 0");
    this.detachFromPlace(obj);
    this.attachToRoom(obj, room);
  }

  /** Range l'objet dans un conteneur (en tête de son contenu). Refuse un cycle. */
  moveToContainer(obj: GameObject, holder: GameObject): void {
    for (let up: GameObject | null = holder; up; up = up.holder) if (up === obj) throw new Error("Cycle de conteneurs");
    if (obj.typ === 0) throw new Error("Un objet d'interface reste rattaché à la salle d'indice 0");
    this.detachFromPlace(obj);
    this.attachToHolder(obj, holder);
  }

  /** Change le numéro de série (transit de salle : `+10000`, engine.md § 12.6). */
  setSerial(obj: GameObject, serial: number): void {
    if (this.bySerial.get(obj.serial) === obj) this.bySerial.delete(obj.serial);
    obj.serial = serial;
    if (serial !== 0) this.bySerial.set(serial, obj);
    for (const child of obj.contents) child.container = serial;
  }

  setHero(obj: GameObject | null): void {
    this.hero = obj;
  }

  /**
   * Objet désigné par un numéro de ressource dans un jeton (`engine.md` § 6.2) : `num < 1` = le héros ; sinon le premier de
   * la salle chargée (voulue à défaut ; liste A puis décors), puis des listes globales (objets, décors, interface).
   * hypothèse (engine.md §6.2) : ordre salle puis listes globales, dans l'ordre de parcours de chaque liste.
   */
  resolveObject(num: number): GameObject | undefined {
    if (num < 1) return this.hero ?? undefined;
    const room = this.loadedRoom ?? this.wantedRoom;
    return (
      room?.listA.find((o) => o.num === num) ??
      room?.listB.find((o) => o.num === num) ??
      this.objects.find((o) => o.num === num) ??
      this.decors.find((o) => o.num === num) ??
      this.interfaceObjects.find((o) => o.num === num)
    );
  }

  /** Écrit un champ de l'enregistrement de l'objet (voir `writeObjectField`). */
  writeField(obj: GameObject, offset: number, size: 1 | 2, value: number): void {
    writeObjectField(obj, offset, size, value, this);
  }

  /** Page d'icônes (`Ego` +0x2D de l'objet d'interface `INT 3`, sauvegardé avec le monde) ; 0 si l'objet n'existe pas. */
  get iconPage(): number {
    return this.interfaceObjects.find((o) => o.num === 3)?.ego ?? 0;
  }

  set iconPage(page: number) {
    const holder = this.interfaceObjects.find((o) => o.num === 3);
    if (holder) writeObjectField(holder, 0x2d, 1, page);
  }

  /** `4b50` (octet bas du mot 5) : le joueur a la main (7) ou non (0). */
  get moveEnabled(): boolean {
    return (this.headerWords[5] & 0xff) !== 0;
  }

  set moveEnabled(on: boolean) {
    this.headerWords[5] = (this.headerWords[5] & 0xff00) | (on ? 7 : 0);
  }

  /** `4b67` (octet haut du mot 16) : fin de partie / héros mort (S16, S49). */
  get gameOver(): boolean {
    return (this.headerWords[16] >> 8) !== 0;
  }

  set gameOver(on: boolean) {
    this.headerWords[16] = (this.headerWords[16] & 0x00ff) | (on ? 7 << 8 : 0);
  }

  /**
   * Drapeau de niveau `4b68 + niveau` (octet de l'en-tête, sauvegardé) : secret du niveau découvert (`14cf:000c`, `2500:0008`).
   * L'octet d'adresse `a` est l'octet bas (a pair) ou haut du mot `(a - 0x4b46) / 2` de l'en-tête.
   */
  levelFlag(level: number): number {
    const at = 0x4b68 + level - 0x4b46;
    const word = this.headerWords[at >> 1] ?? 0;
    return (at & 1) === 0 ? word & 0xff : word >> 8;
  }

  setLevelFlag(level: number, value: number): void {
    const at = 0x4b68 + level - 0x4b46;
    const w = at >> 1;
    const word = this.headerWords[w] ?? 0;
    this.headerWords[w] = (at & 1) === 0 ? (word & 0xff00) | (value & 0xff) : (word & 0x00ff) | ((value & 0xff) << 8);
  }

  setChapter(chapter: number): void {
    this.chapterLevel = chapter * 100 + this.level;
  }

  setLevel(level: number): void {
    this.chapterLevel = this.chapter * 100 + level;
  }

  // --- score et progression ------------------------------------------------------------------------------------------

  get chapter(): number {
    return Math.floor(this.chapterLevel / 100);
  }

  get level(): number {
    return this.chapterLevel % 100;
  }

  /** Score maximal : somme des valeurs absolues de la table (725 dans `CFG`). */
  get maxScore(): number {
    return this.scoreTable.reduce((sum, e) => sum + Math.abs(e.points), 0);
  }

  /**
   * `2255:00e8` : cherche l'entrée `id` (chapitre * 100 + indice). Points positifs : ajoutés au score, entrée marquée attribuée
   * (points négatifs), jingle. Points nuls ou négatifs : rejoue le jingle tant que le compteur de répétitions n'est pas nul.
   * Entrée inconnue : `null`.
   */
  addScore(entryId: number): ScoreAward | null {
    const entry = this.scoreTable.find((e) => e.id === entryId);
    if (!entry) return null;
    if (entry.points > 0) {
      const points = entry.points;
      this.score += points;
      entry.points = -points;
      return { entry, points, sound: Math.max(0, entry.sound), replay: false };
    }
    if (entry.repeats !== 0) {
      entry.repeats--;
      return { entry, points: 0, sound: Math.max(0, entry.sound), replay: entry.sound > 0 };
    }
    return { entry, points: 0, sound: 0, replay: false };
  }

  // --- interne -------------------------------------------------------------------------------------------------------

  listOf(typ: number): GameObject[] {
    return typ === 0 ? this.interfaceObjects : typ === 1 ? this.decors : this.objects;
  }

  private register(obj: GameObject): GameObject {
    this.listOf(obj.typ).unshift(obj);
    if (obj.serial !== 0) this.bySerial.set(obj.serial, obj);
    return obj;
  }

  /**
   * Les objets d'interface sont rattachés à la salle d'indice 0 sans figurer dans sa liste. En mémoire ils ont `Cod = 3` ; on
   * conserve la valeur lue (1 dans `CFG`, écrit avant tout chargement, 3 dans les instantanés) pour que l'écriture redonne le fichier.
   */
  private makeInterface(obj: GameObject, location: number): void {
    const root = this.rooms[0];
    if (obj.room) detach(obj.room.listA, obj);
    obj.room = root ?? null;
    obj.holder = null;
    obj.location = location;
    obj.container = root?.id ?? 0;
  }

  private attachToRoom(obj: GameObject, room: GameRoom): void {
    (obj.typ === 1 ? room.listB : room.listA).unshift(obj);
    obj.room = room;
    obj.holder = null;
    obj.location = 1;
    obj.container = room.id;
  }

  private attachToHolder(obj: GameObject, holder: GameObject): void {
    holder.contents.unshift(obj);
    obj.holder = holder;
    obj.room = null;
    obj.location = 2;
    obj.container = holder.serial;
  }

  private detachFromPlace(obj: GameObject): void {
    if (obj.holder) detach(obj.holder.contents, obj);
    else if (obj.room) {
      detach(obj.room.listA, obj);
      detach(obj.room.listB, obj);
    }
    obj.holder = null;
    obj.room = null;
    obj.location = 0;
    obj.container = 0;
  }
}
