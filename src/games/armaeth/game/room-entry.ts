import { EventOp } from "../engine/events";
import type { BehaviorContext } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { NUM, ROOM, eventTarget, requireNum, setState } from "./helpers";
import { extinguishTorch, setDoor } from "./objects";

/**
 * Effets d'entrée dans une salle (`147f:000a`, fin de `gm_load_scene`, `engine.md` § 5.5). Les plans actifs et la lumière sont dans
 * `engine/room.ts` (`activePlanes`, `applyRoomLight`) ; ce module porte ce qui touche aux personnages : la salle de garde 305.
 */

/** Numéros des deux portes de la salle de garde (`DGROUP:0694`). */
const GUARD_ROOM_DOORS = [309, 329] as const;

/** Un soldat endormi : `Ego`, `Fig`, délai du réveil (tics de monde), événement différé, position `(X, Y, P)`. */
interface Sleeper {
  ego: number;
  fig: number;
  ticks: number;
  event: number;
  position: readonly [number, number, number];
}

/**
 * Les deux places endormies, dans l'ordre de `147f:016a..025a` (la boucle compte `SI` de 1 à 0) : `SI = 1` -> `Ego 8` (écroulé dans son
 * assiette), 120 tics, événement 4, `(0x44, 0x50, 0x48)` ; `SI = 0` -> `Ego 7` (dort sur sa chaise), 60 tics, événement 3,
 * `(0x24, 0x50, 0x3A)`. Le soldat est réveillé par `2a44:12fc` (événements 3 et 4, `npc-events.ts`).
 */
const SLEEPERS: readonly Sleeper[] = [
  { ego: 8, fig: 2, ticks: 120, event: 4, position: [0x44, 0x50, 0x48] },
  { ego: 7, fig: 1, ticks: 60, event: 3, position: [0x24, 0x50, 0x3a] },
];

/** `21e7:003c(liste A, 301, min, max)` : premier soldat de la salle dont l'`Ego` est dans `[min, max]`. */
function findSoldier(room: { listA: readonly GameObject[] }, ego: number): GameObject | undefined {
  return room.listA.find((o) => o.num === NUM.soldier && o.ego === ego);
}

/**
 * Salle 305 (`147f:016a`, certain pour la séquence et les constantes, relues dans le désassemblage) : les deux portes (309 et 329) sont
 * ramenées dans la salle chargée avec leur état courant (`20b5:0248(Num, -1)`), puis, pour chaque place endormie, s'il n'y a pas
 * déjà un soldat à cet `Ego` et avec une chance sur 2 (`gm_chance_one_in(2)`), le premier soldat `Ego 0` de la salle s'y endort
 * (`1a37:003a(Fig = SI + 1, Ego = SI + 7, Gst 7, Mob 1)`, mouvements remis à zéro `30d9:0114(7, 7)`, réveil différé `23a2:0002(3, ...)`).
 * La position imposée est écrite **après** le placement, sans nouveau placement.
 */
function enterGuardRoom(ctx: BehaviorContext, room: { listA: readonly GameObject[] }): void {
  for (const num of GUARD_ROOM_DOORS) {
    const leaf = ctx.state.findByNum(num);
    if (leaf) setDoor(ctx, leaf, leaf.ego);
  }
  for (const place of SLEEPERS) {
    if (findSoldier(room, place.ego)) continue;
    if (ctx.rng.mod(2) !== 0) continue;
    const soldier = findSoldier(room, 0);
    if (!soldier) continue;
    ctx.motion.reset(soldier);
    setState(ctx, soldier, { gst: 7, mob: 1, ego: place.ego, fig: place.fig });
    ctx.events.operate({ typ: soldier.typ, num: soldier.num, serial: soldier.serial }, place.event, 3, place.ticks, NUM.dwarfMiner);
    [soldier.x, soldier.y, soldier.p] = place.position;
    soldier.ground = 0;
    soldier.speedY = 1;
  }
}

/** Salle 208 (au bout de la rivière souterraine de la salle 207) : y entrer rapporte les points `(2, 5)` (`147f:0130`). */
const HIDDEN_CAVE = 208;
/** Salles de part et d'autre de la porte 111 (`DGROUP:0694` : salle A 105, salle B 104). */
const CELL_DOOR_ROOMS = [104, 105] as const;
const CELL_DOOR = 111;

/**
 * `147f:000a` : effets d'entrée propres aux personnages, appelés une fois la salle chargée et avant l'arrivée du héros.
 * - salles 104 et 105 (`147f:0043` -> `147f:00b2`) : la porte 111 est ramenée dans la salle chargée avec son état (`20b5:0248(111, -1)`),
 *   du côté de cette salle ; sans elle, on ne peut ni l'ouvrir depuis la salle 104 ni entrer dans l'antre de Prytwen ;
 * - salle 208 (`0xD0`, `147f:002e` -> `147f:0130..0136`) : `2255:00e8(2, 5)` à chaque chargement (les points ne comptent qu'une fois).
 */
export function onEnterRoom(ctx: BehaviorContext): void {
  const room = ctx.state.loadedRoom;
  if (!room) return;
  if (room.id === ROOM.soldiers) enterGuardRoom(ctx, room);
  else if ((CELL_DOOR_ROOMS as readonly number[]).includes(room.id)) {
    const leaf = ctx.state.findByNum(CELL_DOOR);
    if (leaf) setDoor(ctx, leaf, leaf.ego);
  } else if (room.id === HIDDEN_CAVE) ctx.score.award(2, 5);
}

// --- effets d'entrée propres à une salle (`147f:0352`) ------------------------------------------------------------------------

/** Musiques de la salle 110 (`147f:041e`, `147f:0465`) : `gm_sound_play(id, 'M', id)`. */
const TREASURY_MUSIC = { heroBehind: 108, prytwenBehind: 109 } as const;
/** Délai de l'événement 2 du héros en salle 304 (asphyxie, `2683:017a`) : 1000 tics. */
const GAS_DELAY = 1000;

/** Conteneur d'un objet : l'objet qui le porte, sinon sa salle (`+0x5C`, `21fb:011e`). */
const containerOf = (obj: GameObject): GameObject | GameObject["room"] => obj.holder ?? obj.room;

/**
 * Salle 110 (`147f:03a6`..`04e5`) : la musique dit de quel côté de la grille 103 se trouvent le héros et Prytwen.
 * - grille ouverte (`Ego 3`, `2846:04d6`) : la musique de la salle reprend (`2f33:04e0`, identifiant `+0x08`, classe `+0x05`, numéro
 *   `+0x06` de l'enregistrement de la salle, sans boucle) ;
 * - sinon, si le héros est dans la même salle que la grille et que `P` de la grille est plus petit que le sien (il est devant) : `M108` ;
 * - sinon, si Prytwen est avec la grille (`21fb:005a`, `Num 101`) et que son `P` est plus grand que celui de la grille : `M109`.
 * `1a7b:03b0(103, 0x89)` : `gm_abort(0x89)` si la grille n'existe pas.
 */
function enterTreasury(ctx: BehaviorContext, room: NonNullable<BehaviorContext["room"]>): void {
  const bars = requireNum(ctx, NUM.grille, 0x89);
  if (bars.ego === 3) {
    ctx.sound.play(room.musicId, String.fromCharCode(room.musicClass), room.musicNumber);
    return;
  }
  const hero = ctx.hero;
  if (hero && containerOf(hero) === containerOf(bars) && bars.p < hero.p) {
    ctx.sound.play(TREASURY_MUSIC.heroBehind, "M", TREASURY_MUSIC.heroBehind);
    return;
  }
  const siblings = bars.holder ? bars.holder.contents : (bars.room?.listA ?? []);
  const prytwen = siblings.find((o) => o.num === NUM.prytwen);
  if (prytwen && prytwen.p > bars.p) ctx.sound.play(TREASURY_MUSIC.prytwenBehind, "M", TREASURY_MUSIC.prytwenBehind);
}

/**
 * Salle 304 (`147f:0470`..`04e5`) : le héros (`Num 1`) reçoit l'événement différé 2 (asphyxie, procédure 1) de 1000 tics (`23a2:0002(héros,
 * 2, fixer, 1000)`), puis toutes les torches allumées de ses poches (`21e7:0022(héros, 12, Ego 0..3)`) sont éteintes (`2420:0398`) ; s'il y
 * en avait, `G373` s'affiche (`200c:0004`). Sans héros, rien.
 */
function enterGasRoom(ctx: BehaviorContext): void {
  const hero = ctx.hero;
  if (!hero) return;
  if (hero.num === NUM.hero) ctx.events.operate(eventTarget(hero), 2, EventOp.Set, GAS_DELAY, NUM.hero);
  let extinguished = false;
  for (const lamp of [...hero.contents]) {
    if (lamp.num !== NUM.torch || lamp.ego > 3) continue;
    extinguishTorch(ctx, lamp);
    extinguished = true;
  }
  if (extinguished) ctx.messages.say("G", 373);
}

/** `147f:0352` : effets d'entrée propres à la salle chargée, après son premier affichage (les introductions de niveau sont dans `engine/room.ts`). */
export function onEnterScene(ctx: BehaviorContext): void {
  const room = ctx.state.loadedRoom;
  if (!room) return;
  if (room.id === ROOM.treasury) enterTreasury(ctx, room);
  else if (room.id === ROOM.lava) enterGasRoom(ctx);
}
