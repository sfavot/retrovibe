import type { Scene } from "../data/scene";
import type { Point } from "../render/compositor";
import { EventOp } from "./events";
import { type SpriteSource, loadObjectSprite, randomizeDecorPhase } from "./animation";
import { RAW_OFFSET, type GameObject, type GameRoom, type WorldState, rawU8, setRawU8 } from "./state";

/**
 * Entrée et sortie de salle (`docs/armaeth/engine.md` § 4, § 5.2, § 5.4, § 5.5, `characters.md` § 11). Fonctions pures :
 * elles modifient l'état et rendent des requêtes (scène à charger, musique) que l'appelant exécute.
 *
 * Séquence de l'appelant quand `state.wantedRoom !== state.loadedRoom` : `planRoomLoad` -> exécuter les requêtes (lire la
 * scène) -> `loadRoom` -> `enterRoom` (réessayer si `retry`) -> afficher la première image -> `onFirstDisplay`.
 */

export interface MusicKey {
  soundClass: string;
  id: number;
  number: number;
}

export type RoomRequest =
  | { type: "stopMusic" }
  | { type: "loadScene"; sceneId: number }
  | { type: "playMusic"; soundClass: string; id: number; number: number; loop: true };

/** Musique de la salle (+0x05 classe, +0x06 identifiant, +0x08 numéro), ou `null` si l'identifiant et le numéro sont nuls. */
export function roomMusic(room: GameRoom): MusicKey | null {
  if (room.musicId === 0 && room.musicNumber === 0) return null;
  return { soundClass: String.fromCharCode(room.musicClass), id: room.musicId, number: room.musicNumber };
}

/**
 * Requêtes du chargement de la salle voulue (`gm_load_scene`, `1cc3:000e`) : musique arrêtée si la salle n'en a pas ou si
 * elle ne joue pas déjà (`playing`), scène à lire, puis musique lancée en boucle en fin de chargement.
 * hypothèse (engine.md §5.2) : « +0x06/+0x08 nuls » veut dire les deux nuls.
 */
export function planRoomLoad(state: WorldState, playing: MusicKey | null): RoomRequest[] {
  const room = state.wantedRoom;
  if (!room) throw new Error("Aucune salle voulue");
  const music = roomMusic(room);
  const already = music !== null && playing !== null && playing.soundClass === music.soundClass && playing.id === music.id && playing.number === music.number;
  const requests: RoomRequest[] = [];
  if (!already) requests.push({ type: "stopMusic" });
  requests.push({ type: "loadScene", sceneId: room.id });
  if (music && !already) requests.push({ type: "playMusic", ...music, loop: true });
  return requests;
}

export interface LoadRoomDeps {
  sprites: SpriteSource;
  /** `rand()` du jeu (15 bits) : phase d'animation des décors. */
  rand: () => number;
  /** `gm_reset_object_motion` : annule les trajets des objets de l'ancienne salle. */
  resetMotion?: (obj: GameObject) => void;
}

export interface LoadedRoom {
  room: GameRoom;
  /** Coin de la fenêtre de la scène : décalage des sprites des listes de salle. */
  origin: Point;
}

/** Octet signé. */
const s8 = (v: number) => (v << 24) >> 24;

/**
 * Chargement de la salle voulue (`gm_load_scene`, fin de la lecture de la scène) : anciens décors détruits, trajets de l'ancienne
 * salle annulés, `loadedRoom` = salle voulue, décors de la scène créés (`engine.md` § 5.3 : `Xyp = 2`, `Hor` 0 devient 1, phase
 * aléatoire), ressources des objets de la salle, du héros, de l'inventaire, de la sélection et de l'interface mises en place.
 */
export function loadRoom(state: WorldState, scene: Scene, deps: LoadRoomDeps): LoadedRoom {
  const room = state.wantedRoom;
  if (!room) throw new Error("Aucune salle voulue");
  const old = state.loadedRoom;
  if (old && deps.resetMotion) for (const obj of [...old.listA]) deps.resetMotion(obj);
  for (const decor of [...state.decors]) state.deleteObject(decor);
  state.loadedRoom = room;
  state.currentRoom = room.id;
  for (const d of scene.decors) {
    const hor = s8(d.hor);
    const obj = state.createObject({
      typ: 1,
      num: d.num,
      gst: d.gst,
      mob: d.mob,
      dep: d.dep,
      txt: d.txt,
      ego: d.ego,
      fig: d.fig,
      light: d.light,
      speedX: hor === 0 ? 1 : hor,
      x: d.x,
      y: d.y,
      p: d.p,
      plane: d.plane,
      ground: d.ground,
    });
    state.moveToRoom(obj, room);
    obj.presence = 2;
    randomizeDecorPhase(obj, deps.sprites, deps.rand);
  }
  const resident = [
    ...room.listA,
    ...(state.hero ? [state.hero, ...state.hero.contents] : []),
    ...(state.selected?.contents ?? []),
    ...state.interfaceObjects,
  ];
  for (const obj of new Set(resident)) loadObjectSprite(obj, deps.sprites);
  return { room, origin: { x: scene.header.x, y: scene.header.y } };
}

export interface RoomEntryHooks {
  /** `186d:0128` : range le héros dans la salle voulue. Défaut : `completeHeroTransit`. Faux = échec. */
  placeHero?: (state: WorldState) => boolean;
  /** `gm_object_behavior_main` (`1aba:000e`) : place l'objet dans la salle (mode 2 ou 5). */
  place: (obj: GameObject, mode: number) => unknown;
  /** `1793:0006` : réinitialise les mouvements des objets mobiles de la salle (`true` si le héros vient d'arriver). */
  resetMotions: (heroAbsent: boolean) => void;
}

export type RoomEntryResult =
  /** Salle prête : afficher la première image (palette à recalculer, `onFirstDisplay` après le premier affichage). */
  | { status: "ready"; heroAbsent: boolean }
  /** Le héros n'a pas pu entrer : la salle voulue est redevenue l'ancienne, recharger. */
  | { status: "retry" };

/**
 * Nombre de plans actifs de la salle (`DGROUP:4ae0`), tel que `147f:000a` le règle à l'entrée et à chaque changement d'état d'un
 * mécanisme (`docs/armaeth/movement.md` § 1.1) : le mouvement, le placement et les trajets l'utilisent à la place du compte du
 * fichier. Salle 5 : 3 plans stèle fermée, 2 ouverte (`Num 16`, `Ego 4`) ; salle 108 : 3 plans, 2 dalle ouverte (`Num 104`,
 * `Ego 3`) ; salle 202 : 2 plans avant le chapitre 3, sinon 3 ; salle 205 : 1 plan dès que le sous-niveau est >= 3 (`4b4e % 100`) ;
 * salle 212 : 2 plans tant que `Fig` du `Num 215` est 0, sinon 1 ; salle 312 : 2 plans passerelle (`Num 318`) intacte, sinon 1.
 * Les autres salles gardent le compte du fichier. Non porté : la suppression du `Num 217` à l'entrée de la salle 205.
 */
export function activePlanes(state: WorldState, roomId: number, filePlanes: number): number {
  const level = state.chapterLevel;
  const object = (num: number) => state.findByNum(num);
  switch (roomId) {
    case 5:
      return object(16)?.ego === 4 ? 2 : 3;
    case 108:
      return object(104)?.ego === 3 ? 2 : 3;
    case 202:
      return Math.trunc(level / 100) < 3 ? 2 : 3;
    case 205:
      return level % 100 < 3 ? filePlanes : 1;
    case 212: {
      const parchment = object(215);
      return parchment ? (parchment.fig === 0 ? 2 : 1) : filePlanes;
    }
    case 312: {
      const bridge = object(318);
      return bridge ? (bridge.ego === 0 ? 2 : 1) : filePlanes;
    }
    default:
      return filePlanes;
  }
}

/** Code d'arrêt quand la salle voulue est la salle chargée mais que le héros n'y entre pas (`abort(0x101)`). */
export const ABORT_HERO_PLACEMENT = 0x101;

/**
 * Entrée dans la salle chargée (`NOUVELLE_SALLE`, `engine.md` § 4) : héros rangé s'il vient d'ailleurs, objets sans procédure
 * (`Gst == 0`) placés (mode 2 s'ils sont déjà `Xyp 2`, sinon 5), mouvements réinitialisés, `Err` du héros à `0x11`, première
 * image armée.
 */
export function enterRoom(state: WorldState, hooks: RoomEntryHooks): RoomEntryResult {
  const room = state.loadedRoom;
  if (!room) throw new Error("Aucune salle chargée");
  const hero = state.hero;
  const heroAbsent = hero !== null && hero.room !== room;
  if (heroAbsent) {
    const placed = (hooks.placeHero ?? ((s: WorldState) => completeHeroTransit(s)))(state);
    if (!placed) {
      if (state.wantedRoom === room) throw new Error(`Arrêt du moteur 0x${ABORT_HERO_PLACEMENT.toString(16)} : le héros n'entre pas dans la salle`);
      return { status: "retry" };
    }
  }
  for (const obj of [...room.listA]) if (obj.gst === 0) hooks.place(obj, obj.presence === 2 ? 2 : 5);
  hooks.resetMotions(heroAbsent);
  if (state.hero) {
    const err = rawU8(state.hero, RAW_OFFSET.err);
    if (err === 0 || err === 0x11) setRawU8(state.hero, RAW_OFFSET.err, 0x11);
  }
  state.firstFrame = true;
  return { status: "ready", heroAbsent };
}

// --- sorties ---------------------------------------------------------------------------------------------------------

/** `Err` écrits par le franchissement d'une sortie (`engine.md` § 5.4). */
const ERR_EXIT_BLOCKED = 0x0f;
const ERR_TRANSIT = 0x12;
/** Marque de transit ajoutée au numéro de série du héros. */
export const TRANSIT_SERIAL = 10000;

export type ExitResult = "blocked" | "none" | "transit" | "moved";

/**
 * Franchissement d'une sortie (`186d:000c`, `Err 0x0B`, emplacement dans `Inf`) : si le barrage de l'emplacement répond
 * « bloqué » (`isBlocked`), `Err = 0x0F`. Héros : salle voulue = voisine, `Err = 0x12`, `Ser += 10000` (la boucle recharge).
 * Autre objet : rangé directement dans la voisine. `none` : pas de voisine.
 */
export function exitRoom(state: WorldState, obj: GameObject, isBlocked: (obj: GameObject, code: number) => boolean = () => false): ExitResult {
  const room = obj.room;
  if (!room) return "none";
  const slot = rawU8(obj, RAW_OFFSET.inf);
  const dest = state.neighbour(room, slot);
  if (!dest) return "none";
  const code = state.barrier(room, slot);
  if (code !== 0 && isBlocked(obj, code)) {
    setRawU8(obj, RAW_OFFSET.err, ERR_EXIT_BLOCKED);
    return "blocked";
  }
  if (obj === state.hero) {
    state.wantedRoom = dest;
    setRawU8(obj, RAW_OFFSET.err, ERR_TRANSIT);
    state.setSerial(obj, obj.serial + TRANSIT_SERIAL);
    return "transit";
  }
  state.moveToRoom(obj, dest);
  return "moved";
}

/**
 * Rangement du héros dans la salle voulue (`186d:0128`) : `Ser %= 10000`, voisine recalculée depuis la salle d'origine et
 * `Inf`, héros déplacé (`19dc:0000`). `arrive` : placement d'arrivée (`1aba:0310`), faux = échec. En cas d'échec la salle voulue
 * redevient l'ancienne.
 */
export function completeHeroTransit(state: WorldState, arrive?: (hero: GameObject, slot: number) => boolean): boolean {
  const hero = state.hero;
  const old = hero?.room;
  if (!hero || !old) return false;
  const slot = rawU8(hero, RAW_OFFSET.inf);
  state.setSerial(hero, hero.serial % TRANSIT_SERIAL);
  const dest = state.neighbour(old, slot);
  if (!dest) {
    state.wantedRoom = old;
    return false;
  }
  state.moveToRoom(hero, dest);
  if (arrive && !arrive(hero, slot)) {
    state.moveToRoom(hero, old);
    state.wantedRoom = old;
    return false;
  }
  return true;
}

// --- introductions de niveau -------------------------------------------------------------------------------------------

/** Salles dont l'entrée arme l'introduction de niveau : identifiant de salle -> niveau (`characters.md` § 11). */
export const LEVEL_INTRO_ROOMS: ReadonlyMap<number, number> = new Map([
  [1, 0],
  [101, 1],
  [202, 2],
  [305, 3],
]);
/** Procédure différée `21cc:008e` et délai en tics. */
export const LEVEL_INTRO_PROC = 2000;
export const LEVEL_INTRO_DELAY = 60;
/** Octet de l'en-tête du monde du drapeau du niveau 0 (`DGROUP:4b73` - `4b46`) ; les niveaux suivants le suivent. */
const LEVEL_FLAG_BASE = 0x4b73 - 0x4b46;

function levelFlagWord(level: number): { word: number; high: boolean } {
  const byte = LEVEL_FLAG_BASE + level;
  return { word: byte >> 1, high: (byte & 1) === 1 };
}

export function levelIntroShown(state: WorldState, level: number): boolean {
  const { word, high } = levelFlagWord(level);
  return ((state.headerWords[word] >> (high ? 8 : 0)) & 0xff) !== 0;
}

/**
 * `21cc:000e` : si le drapeau du niveau est nul et `skipIntro` (`4b44`) aussi, le pose et arme l'événement différé `100 + niveau`
 * (60 tics, procédure 2000). Rend vrai si l'introduction a été armée.
 * hypothèse (characters.md §11) : l'événement est porté par l'objet nul (`Typ`, `Num`, `Ser` = 0). La file de `CFG` a une capacité
 * 0 (table allouée plus tard par le moteur) : si l'événement ne peut pas être créé, rien n'est armé et le drapeau reste nul.
 */
export function armLevelIntro(state: WorldState, level: number): boolean {
  if (levelIntroShown(state, level) || state.skipIntro !== 0) return false;
  if (state.events.operate({ typ: 0, num: 0, serial: 0 }, 100 + level, EventOp.Set, LEVEL_INTRO_DELAY, LEVEL_INTRO_PROC) === undefined) return false;
  const { word, high } = levelFlagWord(level);
  const shift = high ? 8 : 0;
  state.headerWords[word] = (state.headerWords[word] & ~(0xff << shift) & 0xffff) | (7 << shift);
  return true;
}

/** Effets d'entrée après le premier affichage de la salle (`147f:0352`, partie générique) : introduction de niveau. Rend le niveau armé. */
export function onFirstDisplay(state: WorldState): number | null {
  const room = state.loadedRoom;
  const level = room ? LEVEL_INTRO_ROOMS.get(room.id) : undefined;
  return level !== undefined && armLevelIntro(state, level) ? level : null;
}
