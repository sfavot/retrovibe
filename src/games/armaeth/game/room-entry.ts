import type { BehaviorContext } from "../engine/handlers";
import type { GameObject } from "../engine/state";
import { NUM, ROOM, setState } from "./helpers";
import { setDoor } from "./objects";

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

/** `147f:000a` : effets d'entrée propres aux personnages, appelés une fois la salle chargée et avant l'arrivée du héros. */
export function onEnterRoom(ctx: BehaviorContext): void {
  const room = ctx.state.loadedRoom;
  if (!room) return;
  if (room.id === ROOM.soldiers) enterGuardRoom(ctx, room);
}
