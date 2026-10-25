import type { BehaviorContext, HandlerContext, HandlerTarget } from "../engine/handlers";
import type { EventTarget } from "../engine/events";
import { type GameObject, type GameRoom, rawU8, rawU16, setRawU16, setRawU8 } from "../engine/state";

/**
 * Source unique des fonctions communes aux modules de jeu d'*Armaeth* (`docs/armaeth/objects.md` § 2 et `characters.md` § 1) :
 * numéros de ressource, messages, états, recherche, création et déplacement d'objets, mise en cible et errance des personnages,
 * tables de clés / serrures / portes de `DGROUP:0676`.
 *
 * Tout ce que le moteur fournit passe par le contexte (`ctx.react`, `ctx.die`, `ctx.playAnimation`, `ctx.messages.listObjects`,
 * `ctx.refreshObject`, `ctx.sound.stopEffect`) ; sans service (moteur nu des tests), `die` et `playAnim` se replient sur le seul
 * message.
 */

// --- constantes ----------------------------------------------------------------------------------------------------------

/** Classe des messages de réponse (`V`). */
export const V = "V";

/** Numéros de verbes (`parser.md` § 3, dictionnaire). */
export const VERB = {
  light: 1,
  extinguish: 2,
  open: 3,
  close: 4,
  look: 5,
  take: 6,
  search: 7,
  tear: 8,
  climb: 9,
  smash: 10,
  eat: 11,
  feed: 12,
  up: 13,
  down: 14,
  put: 15,
  drop: 16,
  inventory: 17,
  revive: 18,
  push: 19,
  read: 20,
  attack: 21,
  kill: 22,
  whip: 23,
  talk: 24,
  pull: 25,
  clean: 26,
  use: 31,
  give: 32,
  drink: 34,
  kiss: 37,
  help: 38,
  wear: 39,
  remove: 40,
  zwygks: 41,
  objects: 42,
} as const;

/** Prépositions (`4cbc`). */
export const PREP = { in: 1, out: 2, on: 3, under: 4, front: 5, behind: 6, with: 7, to: 8 } as const;

/** Classes de mots d'un code de nom (`code / 1000`). */
export const WORD_CLASS = { decor: 4, room: 6, decorAlt: 9, properName: 13, object: 15 } as const;

/** Valeur « vrai » des drapeaux du jeu et retour de succès. */
export const TRUE = 7;
export const OK = 7;
export const HANDLED = 1;

/** `Err` d'un déplacement/placement réussi (`19dc:0000`, `1aba:000e`). */
const PLACE_OK = 0;
const PLACE_TYPE_CHANGED = 0x11;

/** Cases (`Sol`) de la salle 8 et des échelles : voir les gestionnaires qui les citent. */
export const LADDER_GROUND: readonly (readonly [number, number])[] = [
  [7, 10],
  [23, 26],
  [40, 43],
];

/** Numéros (`Num`) d'objets cités par plusieurs modules (`characters.md` § 2, `objects.md` § 4). */
export const NUM = {
  hero: 1,
  remains: 2,
  magpie: 3,
  bear: 4,
  fur: 5,
  goldKey: 6,
  diadem: 8,
  whip: 10,
  torch: 12,
  carcass: 15,
  stele: 16,
  wood: 17,
  fire: 18,
  nest: 19,
  brambles: 20,
  oakChest: 21,
  splash: 23,
  bees: 24,
  bucket: 25,
  prytwen: 101,
  grille: 103,
  slab: 104,
  keyring: 108,
  bronzeKey: 109,
  treasureChest: 110,
  dwarfMiner: 201,
  dwarfMiner2: 202,
  dwarfWarrior: 203,
  dwarfWarrior2: 204,
  shield: 205,
  axe: 206,
  portcullis: 207,
  soldier: 301,
  sarhul: 302,
  minas: 303,
  vial: 304,
  grimoire: 305,
  cauldron: 306,
  plank: 308,
  ham: 311,
  emerald: 313,
  sword: 314,
  crystal: 315,
  ornateGrille: 316,
  doubleGrille: 317,
  wand: 320,
  talisman: 321,
  toad: 327,
  crown: 328,
  bottle: 332,
  king: 333,
} as const;

/** Identifiants de salle (`GameRoom.id`) cités par `characters.md`. */
export const ROOM = {
  cave: 7,
  lair: 105,
  treasury: 110,
  gate202: 202,
  soldiers: 305,
  minasLair: 301,
  sarhulHall: 309,
  throne: 108,
} as const;

/** Décalages de l'enregistrement que `characters.md` nomme sans champ dans `GameObject`. */
export const OFF = {
  /** `Mc1` +0x20 : compteur de duels de Prytwen. */
  counter: 0x20,
  /** +0x24 : état sauvegardé avant une métamorphose (`2d52:06b0`). */
  savedEgo: 0x24,
  /** +0x28 : compteur / mémoire propre à chaque personnage (`Num` mémorisé, réveil du nain, formule `tinhuel`, `Num` d'origine du crapaud). */
  memo: 0x28,
  /** `Set` +0x2C : initialisation faite. */
  init: 0x2c,
  /** `Rep` +0x34 : compteur de 100 tics (feu, torche). */
  rep: 0x34,
  /** +0x38 : salle de destination (téléportation) ou `Num` du dernier interlocuteur. */
  aux: 0x38,
  /** `Ctl` +0x40 : non nul = piloté par le joueur. */
  control: 0x40,
  /** `Ser` de l'objet suivi par le trajet (+0x7A). */
  followed: 0x7a,
} as const;

// --- tables en dur de DGROUP:0676 ----------------------------------------------------------------------------------------

/** Décalage de `DGROUP` dans `AM1.EXE` (`data/palette.ts`, `re-index.md`). */
export const DGROUP_OFFSET = 224624;
/** Offset de la première table de clés dans `DGROUP` (`217d:0002`). */
export const KEY_TABLE_OFFSET = 0x676;

/** `217d:0002` : numéros de clés (clef en or, vieille clef rouillée, clef de bronze, trousseau, clef ouvragée). */
export const KEYS: readonly number[] = [6, 22, 109, 108, 331];

/** `217d:0036` : clé de chaque contenant (coffret, gros coffre de chêne, gros coffre de bronze, coffre de fer). */
export const LOCKS: ReadonlyMap<number, number> = new Map([
  [9, 6],
  [21, 22],
  [110, 109],
  [319, 108],
]);

/** Une porte à serrure (`217d:0088`). */
export interface DoorRow {
  door: number;
  guardian: number;
  key: number;
  /** Colonne « mot » (2 / 1 / 1) : sens inconnu (hypothèse, objects.md § 11.6). */
  word: number;
  roomA: number;
  roomB: number;
}

export const DOORS: readonly DoorRow[] = [
  { door: 111, guardian: 101, key: 109, word: 2, roomA: 105, roomB: 104 },
  { door: 309, guardian: 301, key: 331, word: 1, roomA: 305, roomB: 0 },
  { door: 329, guardian: 301, key: 331, word: 1, roomA: 305, roomB: 309 },
];

/** `(X, Y, P)` du battant par porte : côté A fermé, A ouvert, B fermé, B ouvert (`217d:0126`). */
export const DOOR_POSITIONS: ReadonlyMap<number, readonly (readonly [number, number, number])[]> = new Map([
  [111, [[112, 52, 24], [96, 52, 24], [88, 48, 16], [95, 48, 16]]],
  [309, [[133, 74, 44], [114, 74, 44], [0, 0, 0], [0, 0, 0]]],
  [329, [[72, 54, 8], [62, 54, 8], [40, 119, 151], [31, 119, 151]]],
]);

/** Les mots de la zone `DGROUP:0676..` tels que les lit le jeu, dans l'ordre (pour comparer avec l'EXE). */
export function keyTableWords(): number[] {
  const words: number[] = [KEYS.length, ...KEYS, LOCKS.size, ...LOCKS.keys(), ...LOCKS.values(), DOORS.length];
  for (const field of ["door", "guardian", "key", "word", "roomA", "roomB"] as const) for (const row of DOORS) words.push(row[field]);
  for (const row of DOORS) for (const slot of DOOR_POSITIONS.get(row.door)!) words.push(...slot);
  return words;
}

/** `217d:0002` : est-ce une clé ? */
export function isKey(num: number): boolean {
  return KEYS.includes(num);
}

/** `217d:0036` : la clé du contenant. `gm_abort(0x6a)` s'il est inconnu. */
export function lockKey(container: number): number {
  const key = LOCKS.get(container);
  if (key === undefined) throw new Error(`Contenant sans serrure : ${container} (gm_abort 0x6a)`);
  return key;
}

/** `217d:0088` : la ligne de la porte. `gm_abort(0xa5)` si l'objet n'en est pas une. */
export function doorRow(num: number): DoorRow {
  const row = DOORS.find((r) => r.door === num);
  if (!row) throw new Error(`Objet sans ligne de porte : ${num} (gm_abort 0xa5)`);
  return row;
}

/** `217d:0126(n, côté, état)` : position du battant (côté 0 = A, 1 = B ; `open` = porte ouverte). */
export function doorPosition(num: number, side: 0 | 1, open: boolean): readonly [number, number, number] {
  return DOOR_POSITIONS.get(num)![side * 2 + (open ? 1 : 0)];
}

// --- services du moteur --------------------------------------------------------------------------------------------------

/** Un message `(classe, numéro)`. */
export interface MessageRef {
  cls: string | number;
  number: number;
}

/** Appel de `16f5:0132` (`playAnim`). */
export interface AnimRequest {
  /** Numéro d'animation `ANM`. */
  animation: number;
  obj: GameObject;
  partner?: GameObject | null;
  /** `Ego` imposé à l'objet pendant l'animation (défaut : celui du service). */
  ego?: number;
  /** Message affiché au premier pas. */
  message?: MessageRef;
}

/**
 * `2594:0004(victime, cause, message)` : séquence de mort / défaite (animation `cause` du héros). Sans service `ctx.die`, seul le
 * message est affiché.
 */
export function die(ctx: BehaviorContext, victim: GameObject, cause: number, message?: MessageRef): void {
  if (ctx.die) ctx.die(victim, cause, message?.cls, message?.number);
  else if (message) ctx.messages.say(message.cls, message.number);
}

/**
 * `16f5:0132` : lance une animation `ANM` sur l'objet (avec un partenaire pour un combat). Sans service `ctx.playAnimation`,
 * l'objet prend l'animation et l'`Ego` demandés et seul le message est affiché.
 */
export function playAnim(ctx: BehaviorContext, { animation, obj, partner, ego, message }: AnimRequest): void {
  if (ctx.playAnimation) ctx.playAnimation(obj, animation, partner, message?.cls, message?.number, ego);
  else {
    obj.animId = animation;
    if (ego !== undefined) obj.ego = ego;
    if (message) ctx.messages.say(message.cls, message.number);
  }
}

/**
 * `21ad:000a` : en-tête puis nom (`O<Num>`) de chaque objet, ou le message « vide ». `separator` 7 : un nom par ligne.
 */
export function listObjects(ctx: BehaviorContext, empty: number, header: number, separator: number, objects: readonly GameObject[]): void {
  ctx.messages.listObjects(objects, empty, header, separator === 7);
}

/** `13e9:021c(héros, objet)` : le héros lâche l'objet tenu à ses pieds. */
export function dropHeld(ctx: BehaviorContext, hero: GameObject, obj: GameObject): void {
  moveObject(ctx, hero.room ?? ctx.room!, obj);
}

/**
 * `1469:0002(objet)` : pose l'objet sur un support de la salle ; vrai s'il y arrive. hypothèse (objects.md § 2.3) : aucun support
 * n'est modélisé (le sol de la salle est le seul), l'appelant retombe alors sur le dépôt au sol.
 */
export function putOnSupport(_ctx: BehaviorContext, _obj: GameObject): boolean {
  return false;
}

/** `219b:006c(objet, drapeau)` : invisibilité du héros. */
export function setInvisible(hero: GameObject, invisible: boolean): void {
  hero.hidden = invisible ? TRUE : 0;
}

// --- messages ------------------------------------------------------------------------------------------------------------

/** `enq(p, n)` : message `V` en file à priorité. */
export function enq(ctx: BehaviorContext, priority: number, number: number): void {
  ctx.messages.enqueue(priority, V, number);
}

/** `say(n)` : message `V` immédiat. */
export function say(ctx: BehaviorContext, number: number): void {
  ctx.messages.say(V, number);
}

/** `V015` (« c'est fait ») : seulement si la phrase a été tapée (`TALK`). */
export function sayDone(ctx: HandlerContext): void {
  if (ctx.talk) say(ctx, 15);
}

/** Refus : `22fc:065b` (le verbe n'est pas exécuté) puis `enq`, retour 0. Motif le plus fréquent. */
export function refuse(ctx: HandlerContext, priority: number, number: number): 0 {
  ctx.disableVerb();
  enq(ctx, priority, number);
  return 0;
}

/** Refus qui ne désactive pas le verbe (`enq` seul, retour 0). */
export function queue(ctx: HandlerContext, priority: number, number: number): 0 {
  enq(ctx, priority, number);
  return 0;
}

/**
 * « Trop loin » : réaction (`2363:000c`) sur la cible puis refus (`V008` par défaut), verbe désactivé.
 */
export function tooFar(ctx: HandlerContext, target: GameObject | null, priority: number, number = 8): 0 {
  ctx.react(target);
  return refuse(ctx, priority, number);
}

/**
 * `209c:0092` : affiche le message tout de suite si l'objet est dans la salle du héros (héros de `Num 1`) ou dans la salle chargée
 * pendant un script (`characters.md` § 1).
 */
export function sayNear(ctx: BehaviorContext, obj: GameObject | undefined, cls: string | number, number: number): void {
  if (!obj || number <= 0) return;
  const hero = ctx.hero;
  const room = roomOf(obj);
  const here = hero !== null && hero.num === NUM.hero && room !== null && room === roomOf(hero);
  const scripted = ctx.state.scriptRunning && room !== null && room === ctx.room;
  if (here || scripted) ctx.messages.say(cls, number);
}

/** `209c:000c` : comme `sayNear`, et aussi si le héros contient l'objet ou est contenu par lui. */
export function sayHere(ctx: BehaviorContext, obj: GameObject | undefined, cls: string | number, number: number): void {
  if (!obj) return;
  const hero = ctx.hero;
  if (hero && (obj.holder === hero || hero.holder === obj || obj === hero)) {
    if (number > 0) ctx.messages.say(cls, number);
    return;
  }
  sayNear(ctx, obj, cls, number);
}

// --- lecture de la phrase ----------------------------------------------------------------------------------------------------

/** Classe du mot d'un code de nom (`code / 1000`). */
export function wordClass(code: number): number {
  return Math.floor(code / 1000);
}

export function hasName(target: HandlerTarget): boolean {
  return target.code !== 0;
}

/** Salle qui contient l'objet (directement ou par ses conteneurs). */
export function roomOf(obj: GameObject): GameRoom | null {
  let at: GameObject = obj;
  while (at.holder) at = at.holder;
  return at.room;
}

/** Le héros contrôlé est Killian (`Num 1`). */
export function isKillian(ctx: BehaviorContext): boolean {
  return ctx.hero?.num === 1;
}

// --- état et recherche -----------------------------------------------------------------------------------------------------

export interface StateChange {
  ego?: number;
  fig?: number;
  gst?: number;
  mob?: number;
  dep?: number;
  txt?: number;
}

/** Mode de `placer` des appels de `1a37:003a/007f` : la présence (0 et 8 sont gardés), sinon 5 ; 6 pour une icône. */
function placeMode(obj: GameObject): number {
  if (obj.typ === 0) return 6;
  return obj.presence === 0 || obj.presence === 8 ? obj.presence : 5;
}

/** L'objet est posé dans la salle chargée (le terrain n'existe que pour elle). */
export function inLoadedRoom(ctx: BehaviorContext, obj: GameObject): boolean {
  return obj.room !== null && obj.holder === null && obj.room === ctx.room;
}

/**
 * `setState` (`1a37:0002/003a/007f`) : écrit `Gst`, `Mob`, `Dep`, `Txt`, `Ego`, `Fig` (les champs absents sont gardés), recharge le
 * dessin si `Fig` change, puis ré-applique `placer` (`mode` 0xFF : déduit de `Pre`, hypothèse objects.md § 2.3). Le placement n'a
 * lieu que dans la salle chargée ; un échec de `placer` reste dans `Err` de l'objet.
 */
export function setState(ctx: BehaviorContext, obj: GameObject, change: StateChange, mode = 0xff): void {
  const figChanged = change.fig !== undefined && change.fig !== obj.fig;
  if (change.gst !== undefined) obj.gst = change.gst;
  if (change.mob !== undefined) obj.mob = change.mob;
  if (change.dep !== undefined) obj.dep = change.dep;
  if (change.txt !== undefined) obj.txt = change.txt;
  if (change.ego !== undefined) obj.ego = change.ego;
  if (change.fig !== undefined) obj.fig = change.fig;
  if (figChanged) ctx.refreshObject(obj);
  if (inLoadedRoom(ctx, obj)) {
    const result = ctx.motion.place(obj, mode === 0xff ? placeMode(obj) : mode);
    if (result !== PLACE_OK && result !== PLACE_TYPE_CHANGED) obj.err = result;
  }
}

/** Écrit seulement `Ego` (armoire : `ES:[+0x2D]`), sans changer le dessin ni replacer. */
export function setEgo(obj: GameObject, ego: number): void {
  obj.ego = ego;
}

/** Octet libre de l'enregistrement (`+0x20`, `+0x28`, `+0x42`...). Décalages nommés : `OFF`. */
export function flag(obj: GameObject, offset: number): number {
  return rawU8(obj, offset);
}

export function setFlag(obj: GameObject, offset: number, value: number): void {
  setRawU8(obj, offset, value);
}

/** Mot libre de l'enregistrement (`Rep` +0x34...). */
export function word(obj: GameObject, offset: number): number {
  return rawU16(obj, offset);
}

export function setWord(obj: GameObject, offset: number, value: number): void {
  setRawU16(obj, offset, value);
}

/** Réécrit la préposition de la phrase (`prendre X au nain` devient `prendre X dans le nain`). */
export function setPreposition(ctx: HandlerContext, preposition: number): void {
  ctx.preposition = preposition;
}

/** La préposition de la phrase est l'une de celles-ci. */
export const inPrep = (ctx: HandlerContext, ...prepositions: number[]): boolean => prepositions.includes(ctx.preposition);

/** Octet `+0x28` : compteur / mémoire propre à chaque personnage (réveil du nain, formule `tinhuel`, créature du crapaud). */
export const scratch = (obj: GameObject): number => flag(obj, OFF.memo);
export const setScratch = (obj: GameObject, value: number): void => setFlag(obj, OFF.memo, value);

/** `21e7:0006(Num)` : premier objet de ce `Num` dans le contenu du héros. */
export function heldNum(ctx: BehaviorContext, num: number): GameObject | undefined {
  return ctx.hero?.contents.find((o) => o.num === num);
}

/** `21e7:0022(obj, Num)` : premier objet de ce `Num` dans le contenu direct de `obj`. */
export function inside(obj: GameObject | null | undefined, num: number): GameObject | undefined {
  return obj?.contents.find((o) => o.num === num);
}

/** `21fb:0002(Num)` : premier objet de ce `Num` parmi les frères du héros (même conteneur). */
export function siblingNum(ctx: BehaviorContext, num: number): GameObject | undefined {
  const hero = ctx.hero;
  if (!hero) return undefined;
  const list = hero.holder ? hero.holder.contents : (hero.room?.listA ?? []);
  return list.find((o) => o.num === num && o !== hero);
}

/** `1a7b:03b0(Num)` : premier objet de type 2 de ce `Num` de la liste globale. */
export function globalNum(ctx: BehaviorContext, num: number): GameObject | undefined {
  return ctx.state.findByNum(num, 2);
}

/** `1a7b:03b0(Num, code)` avec erreur : `gm_abort(code)` si l'objet est absent. */
export function requireNum(ctx: BehaviorContext, num: number, abortCode: number): GameObject {
  const obj = globalNum(ctx, num);
  if (!obj) throw new Error(`Objet ${num} absent (gm_abort 0x${abortCode.toString(16)})`);
  return obj;
}

/** `20ac:0008` : poids du contenu d'un objet (récursif, le coffret `Num 9` compte pour son seul poids). */
export function contentWeight(obj: GameObject): number {
  let total = 0;
  for (const child of obj.contents) {
    total += child.weight;
    if (child.num !== 9) total += contentWeight(child);
  }
  return total;
}

/** `20ac:0060(cont, obj)` : `obj` (et son contenu) tient dans la capacité restante de `cont`. */
export function canCarry(cont: GameObject, obj: GameObject): boolean {
  return contentWeight(cont) + obj.weight + (obj.num !== 9 ? contentWeight(obj) : 0) <= cont.capacity;
}

/** `2241:003a` : écarts en X, Y, P (-1 = pas de test sur cet axe). */
export function near(a: GameObject, b: GameObject, tolX: number, tolY: number, tolP: number): boolean {
  return (tolX < 0 || Math.abs(a.x - b.x) <= tolX) && (tolY < 0 || Math.abs(a.y - b.y) <= tolY) && (tolP < 0 || Math.abs(a.p - b.p) <= tolP);
}

/** Cible `Typ/Num/Ser` d'une entrée de la file d'événements. */
export function eventTarget(obj: GameObject): EventTarget {
  return { typ: obj.typ, num: obj.num, serial: obj.serial };
}

/** `2255:00e8(chapitre, indice)`. */
export function award(ctx: BehaviorContext, chapter: number, index: number): void {
  ctx.score.award(chapter, index);
}

// --- création, déplacement, destruction ------------------------------------------------------------------------------------

/**
 * `19dc:0000(dest, obj, Cod)` : déplace `obj` dans `dest` (salle ou objet) et le replace. Rend l'`Err` de `placer` : 0 ou 0x11
 * si l'objet est bien placé, autre valeur = refus (l'objet reste alors où il était, comme le rétablit le moteur).
 * hypothèse (objects.md §2.2) : le contenant reçoit `placer` en mode 8 (icône d'inventaire) s'il s'agit du héros, 2 sinon ; une
 * salle reçoit la position de l'objet d'après celle du héros si l'objet venait d'un conteneur.
 */
export function moveObject(ctx: BehaviorContext, dest: GameObject | GameRoom, obj: GameObject): number {
  const state = ctx.state;
  const fromHolder = obj.holder !== null;
  const wasSelected = state.selected === obj;
  if ("contents" in dest) {
    state.moveToContainer(obj, dest);
    obj.presence = dest === ctx.hero ? 8 : 2;
    if (wasSelected && dest !== ctx.hero) state.selected = null;
    return PLACE_OK;
  }
  state.moveToRoom(obj, dest);
  const hero = ctx.hero;
  if (fromHolder && hero) {
    obj.x = hero.x;
    obj.y = hero.y;
    obj.p = hero.p;
    obj.plane = hero.plane;
    obj.presence = 1;
  }
  const result = ctx.motion.place(obj, 1);
  return result === PLACE_OK || result === PLACE_TYPE_CHANGED ? PLACE_OK : result;
}

/** Vrai si `moveObject` a réussi. */
export function placed(code: number): boolean {
  return code === PLACE_OK || code === PLACE_TYPE_CHANGED;
}

/** Champs d'un objet neuf que l'appelant impose au modèle. */
export type SpawnFields = Partial<Pick<GameObject, "gst" | "mob" | "dep" | "txt" | "ego" | "fig" | "weight" | "capacity" | "value" | "light" | "pickable" | "canContain">>;

/**
 * `gm_create_object(Num, conteneur)` : un objet neuf, sur le modèle d'un objet existant de même `Num` (poids, valeur, capacité...)
 * ou, à défaut, de l'enregistrement `A1FDEF.SYS` (`Mob`, `Dep`, `Txt`, `Lum`) ; `fields` complète ou remplace. hypothèse
 * (objects.md §2.2) : les autres champs de la table `A1FDEF` ne sont pas lus.
 */
export function spawn(ctx: BehaviorContext, num: number, dest: GameObject | GameRoom, fields: SpawnFields = {}): GameObject {
  const state = ctx.state;
  const model = state.findByNum(num, 2);
  const def = model ? undefined : ctx.sprites.defRecord({ family: "OBJ", id: num });
  const obj = state.createObject({
    typ: 2,
    num,
    ...(model
      ? { gst: model.gst, mob: model.mob, dep: model.dep, txt: model.txt, light: model.light, value: model.value, weight: model.weight, capacity: model.capacity, pickable: model.pickable, canContain: model.canContain, ego: model.ego, fig: model.fig }
      : { pickable: TRUE, ...(def ? { mob: def.bytes[2], dep: def.bytes[3], txt: def.bytes[4], light: (def.bytes[0x18 - 2] << 24) >> 24 } : {}) }),
    ...fields,
  });
  if ("contents" in dest) {
    state.moveToContainer(obj, dest);
    obj.presence = dest === ctx.hero ? 8 : 2;
  } else {
    state.moveToRoom(obj, dest);
    obj.presence = 2;
  }
  return obj;
}

/** Copie la position de `from` (`+0x52..+0x5F`) dans `to` : présence, plan, X, Y, P, sol. */
export function copyPosition(from: GameObject, to: GameObject): void {
  to.presence = from.presence;
  to.plane = from.plane;
  to.x = from.x;
  to.y = from.y;
  to.p = from.p;
  to.ground = from.ground;
}

/**
 * Objet neuf au même endroit que `like` (même conteneur ou salle, même position). `Gst` et `Mob` suivent `like`, `Ego` et `Fig`
 * valent 0, sauf si `fields` en décide autrement.
 */
export function spawnLike(ctx: BehaviorContext, like: GameObject, num: number, fields: SpawnFields = {}): GameObject {
  const dest = like.holder ?? like.room;
  if (!dest) throw new Error("Objet sans conteneur");
  const obj = spawn(ctx, num, dest, { gst: like.gst, mob: like.mob, ego: 0, fig: 0, ...fields });
  copyPosition(like, obj);
  return obj;
}

/**
 * `19a6:01a5` : détruit l'objet. `keepContents` : le contenu est déposé dans la salle, à sa place (sinon détruit avec lui).
 */
export function destroy(ctx: BehaviorContext, obj: GameObject, keepContents = false): void {
  const state = ctx.state;
  if (keepContents) {
    const room = roomOf(obj);
    for (const child of [...obj.contents]) {
      if (room) {
        state.moveToRoom(child, room);
        child.x = obj.x;
        child.y = obj.y;
        child.p = obj.p;
        child.plane = obj.plane;
        child.presence = obj === ctx.hero || obj.presence === 0 ? 1 : obj.presence;
      } else state.deleteObject(child);
    }
  }
  state.deleteObject(obj);
}

/**
 * `1a6b:0006(ancien, Num)` : remplace l'objet par un neuf de ce `Num`, dans le même conteneur et à la même position ; le contenu
 * suit le nouvel objet et le héros remplacé reste le héros contrôlé.
 * hypothèse (objects.md §2.2) : le contenu suit le nouvel objet (l'original ne le précise pas).
 */
export function replaceObject(ctx: BehaviorContext, old: GameObject, num: number, fields: SpawnFields = {}): GameObject {
  const state = ctx.state;
  const wasHero = state.hero === old;
  const neu = spawnLike(ctx, old, num, fields);
  for (const child of [...old.contents]) state.moveToContainer(child, neu);
  destroy(ctx, old);
  if (wasHero) state.setHero(neu);
  ctx.refreshObject(neu);
  return neu;
}

/** Objet d'un `HandlerTarget` qui existe (le gestionnaire n'est appelé que s'il y en a un). */
export function objectOf(target: HandlerTarget): GameObject {
  if (!target.object) throw new Error("Objet résolu attendu");
  return target.object;
}

/**
 * `2120:0075(a, b)` : `a` est à portée de `b` (même conteneur, écart de profondeur < 9, recouvrement horizontal à 4 pixels près).
 * Même règle que `ArmaethEngine.inReach` (probable).
 */
export function inReachOf(a: GameObject, b: GameObject): boolean {
  if (a === b || a.holder === b || b.holder === a) return true;
  if (!a.room || a.room !== b.room || Math.abs(a.p - b.p) >= 9) return false;
  return Math.abs(a.x - b.x) <= ((a.width + b.width) >> 1) + 4;
}

/** `22b7:0000(hero, Num)` : premier frère de ce `Num` à portée du héros. */
export function reachableNum(ctx: BehaviorContext, num: number): GameObject | undefined {
  const hero = ctx.hero;
  if (!hero) return undefined;
  return (hero.room?.listA ?? []).find((o) => o.num === num && o !== hero && inReachOf(o, hero));
}

// --- déplacements des personnages ------------------------------------------------------------------------------------------

/**
 * `22ef:0000(cible, poursuivant ; follow)` : copie la position de la cible, calcule le trajet si la salle est chargée (sinon
 * `Def = 7` d'office). Rend `Def`. `follow` : le personnage poursuit la cible (sa `Ser` est mémorisée en `OFF.followed`).
 */
export function approach(ctx: BehaviorContext, chaser: GameObject, target: GameObject, follow = false): boolean {
  setWord(chaser, OFF.followed, follow ? target.serial : 0);
  if (inLoadedRoom(ctx, chaser)) return ctx.motion.pathTo(chaser, target.x, target.y, target.p, target.plane);
  chaser.path.target = { x: target.x, y: target.y, p: target.p, plane: target.plane };
  chaser.path.defined = true;
  return true;
}

/**
 * `2151:0006` / `2151:02a0` : cible aléatoire dans la salle. `override` : valeurs imposées ; sinon fenêtre de tirage type d'une salle
 * (hypothèse, `movement.md` § 1 : X 0..319, P 8..159). Les volants (`Dep 1`) tirent aussi Y.
 */
export function wander(ctx: BehaviorContext, obj: GameObject, override?: { x?: number; y?: number; p?: number }): boolean {
  const range = (min: number, max: number) => ctx.rng.mod(max - min + 40) + min - 20;
  const x = override?.x ?? range(0, 319);
  const p = override?.p ?? range(8, 159);
  let y = 0;
  if (override?.y !== undefined) y = override.y;
  else if (obj.dep === 1) {
    y = range(0, 179);
    if (y < obj.height) y = 30;
  }
  setWord(obj, OFF.followed, 0);
  if (inLoadedRoom(ctx, obj)) return ctx.motion.pathTo(obj, x, y, p, 0);
  obj.path.target = { x, y, p, plane: 0 };
  obj.path.defined = true;
  return true;
}

/** `2a44:135a(héros, nain)` : réveille le nain (`Ego` ≥ 7 devient 0) et l'envoie vers le héros ; refuse (0) si le héros est invisible. */
export function wakeAndChase(ctx: BehaviorContext, hero: GameObject, dwarf: GameObject): number {
  if (hero.hidden !== 0) return 0;
  approach(ctx, dwarf, hero);
  setScratch(dwarf, 1);
  dwarf.ego = 0;
  dwarf.err = 0;
  return OK;
}

// --- décors nommés ----------------------------------------------------------------------------------------------------------

/**
 * `1e08:0014(code)` puis texte du décor nommé (`objects.md` § 3.2, point 5 ; `parser.md` § 6.2) : `D<nnn>` pour un nom de classe 4,
 * `I<nnn>` pour la classe 9 (le code d'un décor est aussi l'identifiant de son message). `undefined` : le décor n'est pas dans la
 * salle chargée ; `null` : il y est mais son message est vide ou absent de la table.
 */
export function decorText(ctx: BehaviorContext, code: number): MessageRef | null | undefined {
  if (ctx.scene.decorIndex(code) < 0) return undefined;
  const cls = wordClass(code) === WORD_CLASS.decor ? "D" : "I";
  const number = code % 1000;
  return ctx.scene.hasMessage(cls, number) ? { cls, number } : null;
}
