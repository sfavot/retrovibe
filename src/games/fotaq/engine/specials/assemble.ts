import type { Sequence } from "../../../../engine/sequence";
import type { RoomUpdate } from "../camera";
import type { FotaqEngine } from "../loop";
import type { GameScript, SpecialMove } from "../script";
import type { Direction } from "../state";

/** `Logic::handleSpecialArea` pour une pièce : rend la cinématique à enchaîner (`""` : aucune). */
export type SpecialAreaHandler = (g: FotaqEngine, facing: Direction, areaNum: number, walkDataNum: number) => Sequence<string>;

/** `LogicGame::changeToSpecialRoom` pour une pièce : rend vrai si elle a pris l'affichage de la pièce en charge. */
export type SpecialRoomHandler = (g: FotaqEngine) => Sequence<boolean>;

/**
 * Ce que fournit un groupe de pièces (`docs/fotaq/specials.md`). Tout est facultatif ; les clés sont des numéros de mouvement
 * spécial ou de pièce. Un groupe ne définit que ce qui est à lui (`ownership.ts`, vérifié par `assemble.test.ts`).
 */
export interface GroupScript {
  /** Mouvements spéciaux (`executeSpecialMove`). */
  specialMoves?: Partial<Record<number, SpecialMove>>;
  /** Pièces dont l'affichage est pris en charge (`changeToSpecialRoom` : pièces 7 et 95). */
  specialRooms?: Partial<Record<number, SpecialRoomHandler>>;
  /** Zones éteintes d'une pièce (`handleSpecialArea`, partie propre à la pièce). */
  specialAreas?: Partial<Record<number, SpecialAreaHandler>>;
  /** Animations de pièce appelées à chaque image (`Graphics::update` : voiture de la pièce 74, combat de la pièce 69). */
  roomUpdates?: Partial<Record<number, RoomUpdate>>;
}

/**
 * Assemblage des groupes en un seul `GameScript` pour le moteur (`FotaqEngineOptions.script`). Les tables sont fusionnées par
 * numéro ; **un numéro défini par deux groupes est une erreur** levée au chargement (mouvement, pièce spéciale, zones d'une pièce,
 * animation de pièce). Ce fichier est partagé : ne pas le modifier (`docs/fotaq/specials.md`).
 */
export function assembleSpecials(groups: Readonly<Record<number, GroupScript>>): GameScript {
  const specialMoves: Partial<Record<number, SpecialMove>> = {};
  const specialRooms: Partial<Record<number, SpecialRoomHandler>> = {};
  const specialAreas: Partial<Record<number, SpecialAreaHandler>> = {};
  const roomUpdates: Partial<Record<number, RoomUpdate>> = {};
  const owners = { moves: new Map<number, number>(), rooms: new Map<number, number>(), areas: new Map<number, number>(), updates: new Map<number, number>() };

  for (const [key, group] of Object.entries(groups)) {
    const n = Number(key);
    merge("mouvement spécial", specialMoves, group.specialMoves, owners.moves, n);
    merge("pièce spéciale", specialRooms, group.specialRooms, owners.rooms, n);
    merge("zones éteintes de la pièce", specialAreas, group.specialAreas, owners.areas, n);
    merge("animation de la pièce", roomUpdates, group.roomUpdates, owners.updates, n);
  }

  return {
    specialMoves,
    roomUpdates,
    changeToSpecialRoom: function* (g) {
      const handler = specialRooms[g.state.room];
      return handler ? yield* handler(g) : false;
    },
    handleSpecialArea: function* (g, facing, areaNum, walkDataNum) {
      const handler = specialAreas[g.state.room];
      return handler ? yield* handler(g, facing, areaNum, walkDataNum) : "";
    },
  };
}

function merge<V>(what: string, target: Partial<Record<number, V>>, source: Partial<Record<number, V>> | undefined, owners: Map<number, number>, group: number): void {
  for (const key of Object.keys(source ?? {}).map(Number)) {
    const previous = owners.get(key);
    if (previous !== undefined) throw new Error(`groupes ${previous} et ${group} : ${what} ${key} définie deux fois`);
    owners.set(key, group);
    target[key] = source![key];
  }
}
