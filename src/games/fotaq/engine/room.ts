/**
 * Objets d'une pièce (`docs/fotaq/engine.md`, § 5) : plage d'objets, meubles, personnes, points de sortie, copie d'objets et remise
 * en ordre des images à la sortie d'une pièce. Réécriture des parties « données » de `Logic` (engines/queen/logic.cpp :
 * `currentRoomData`, `findPersonNumber`, `objectForPerson`, `walkOffPointForObject`, `eraseRoom`, `setupRoom`, `objectCopy`,
 * ScummVM). Le chargement graphique d'une pièce (décor, bobs, palette) est celui des vagues G2 et R (`Stage`).
 *
 * Numéros : les objets de la pièce `r` sont `roomFirstObject[r] + 1` à `roomFirstObject[r + 1]` ; un « numéro dans la pièce »
 * (zone, `noun` de ScummVM) s'ajoute à `roomFirstObject[r]`.
 */

import type { JasObject } from "../data/jas";
import { roomImageFile, roomLightFile, roomMaskFile } from "../data/files";
import type { GameData, GameState, World } from "./state";

/** Image d'un objet (`ObjectData::image`) : personne tournée à gauche ou à droite. */
export const PERSON_LEFT = -3;
export const PERSON_RIGHT = -4;
/** Images au-delà : bob « collé » dans le décor (`paste down`). */
export const PASTE_DOWN = 5000;
/** Images éteintes : `-(image + 10)` (de -10 à -4000, `eraseRoom`). */
export const IMAGE_OFF = -10;
const IMAGE_OFF_LIMIT = -4000;
/** Images remises à la sortie d'une pièce : bob fixe éteint, bob animé éteint. */
export const STATIC_OFF = -1;
export const ANIMATED_OFF = -2;

export function isPerson(image: number): boolean {
  return image === PERSON_LEFT || image === PERSON_RIGHT;
}

/** Plage des objets de la pièce : premier objet moins un (`_roomData[r]`) et nombre d'objets. */
export function roomObjects(data: GameData, room: number): { first: number; count: number } {
  const first = data.jas.roomFirstObject[room];
  return { first, count: data.jas.roomFirstObject[room + 1] - first };
}

/** Nom de la pièce (`roomName`), qui est aussi celui de son décor (`B1` -> `B1.PCX`). */
export function roomName(data: GameData, room: number): string {
  const name = data.texts.roomNames[room];
  if (!name) throw new Error(`pièce ${room} inconnue`);
  return name;
}

export function roomBackdrop(data: GameData, room: number): string {
  return roomImageFile(roomName(data, room));
}

/** Fichiers du décor de la pièce : l'image, et le masque et la table de lumière si la pièce a de la lumière dynamique (`exists`). */
export function roomFiles(data: GameData, room: number, exists: (name: string) => boolean): string[] {
  const name = roomName(data, room);
  const files = [roomImageFile(name)];
  const mask = roomMaskFile(name);
  const light = roomLightFile(name);
  if (exists(mask) && exists(light)) files.push(mask, light);
  return files;
}

/** Meubles de la pièce (`setupRoom` : `_furnitureData` dont la pièce est `room`), numéros d'objets ou d'images collées. */
export function roomFurniture(data: GameData, room: number): number[] {
  return data.jas.furniture.slice(1).filter((f) => f.room === room).map((f) => f.object);
}

/** Point de sortie d'un objet de sortie (`walkOffPointForObject`). */
export function walkOffPoint(state: GameState, object: number): { x: number; y: number } | null {
  for (let i = 1; i < state.walkOffs.length; i++) {
    const walkOff = state.walkOffs[i];
    if (walkOff.entryObject === object) return walkOff;
  }
  return null;
}

/** Rang (à partir de 1) de la personne `object` parmi les personnes de sa pièce (`findPersonNumber`). */
export function personNumber(world: World, object: number, room: number): number {
  let n = 0;
  for (let i = world.data.jas.roomFirstObject[room] + 1; i <= object; i++) if (isPerson(world.state.objects[i].image)) n++;
  return n;
}

/** Objet de la `bobNum`-ième personne de la pièce courante ; 0 s'il n'y en a pas (`objectForPerson`). */
export function objectForPerson(world: World, bobNum: number): number {
  const room = world.state.room;
  const { first, count } = roomObjects(world.data, room);
  let n = 0;
  for (let object = first + 1; object <= first + count; object++) {
    if (isPerson(world.state.objects[object].image)) n++;
    if (n === bobNum) return object;
  }
  return 0;
}

/**
 * Remet en ordre les images des objets de la pièce quittée (`eraseRoom`) : un objet supprimé perd son image, un bob éteint
 * (`-(image + 10)`) redevient « bob fixe éteint » (-1) ou « bob animé éteint » (-2) selon son graphique.
 */
export function resetRoomImages(world: World, room: number): void {
  const { graphics } = world.data.jas;
  const { first, count } = roomObjects(world.data, room);
  for (let object = first + 1; object <= first + count; object++) {
    const data = world.state.objects[object];
    if (data.name === 0) {
      data.image = 0;
    } else if (data.image > IMAGE_OFF_LIMIT && data.image <= IMAGE_OFF) {
      data.image = graphics[Math.abs(data.image + 10)].lastFrame === 0 ? STATIC_OFF : ANIMATED_OFF;
    }
  }
}

/** Nombre d'images de l'animation d'un objet allumé (1 pour un bob fixe), pour `objectCopy`. */
function frameCount(world: World, image: number): number {
  const graphic = image > PASTE_DOWN ? image - PASTE_DOWN : image;
  const data = world.data.jas.graphics[graphic];
  return data && data.lastFrame > 0 ? data.lastFrame - data.firstFrame + 1 : 1;
}

/**
 * Copie l'objet « modèle » `dummy` dans l'objet réel `real` et le rend visible (`objectCopy`). Si l'animation du modèle a plus
 * d'images que celle de l'objet réel, les deux objets sont échangés (l'ancien objet réel prend la place du modèle). Le modèle
 * reste caché s'il l'était. Le point de sortie du modèle devient celui de l'objet réel.
 */
export function objectCopy(world: World, dummy: number, real: number): void {
  const { objects, walkOffs } = world.state;
  const dummyObject = objects[dummy];
  const realObject = objects[real];
  const hidden = dummyObject.name < 0;
  let realFrames = 1;
  let dummyFrames = 1;
  if (realObject.image > 0) {
    realFrames = frameCount(world, realObject.image);
    if (dummyObject.image > 0) dummyFrames = frameCount(world, dummyObject.image);
  }
  const previous: JasObject = { ...realObject };
  Object.assign(realObject, dummyObject);
  if (dummyFrames > realFrames) Object.assign(dummyObject, previous);
  realObject.name = Math.abs(realObject.name);
  if (hidden) dummyObject.name = -Math.abs(dummyObject.name);
  for (let i = 1; i < walkOffs.length; i++) {
    if (walkOffs[i].entryObject === dummy) {
      walkOffs[i].entryObject = real;
      break;
    }
  }
}
