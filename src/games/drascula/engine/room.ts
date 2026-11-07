import type { AldRect, AldRoom } from "../data/ald";
import { buildFactors, factorAt, scaledSize } from "./perspective";
import { CHARACTER_HEIGHT, CHARACTER_WIDTH, FEET_HEIGHT, type Hero, type RoomObject, type RoomState, STEP_X, STEP_Y } from "./state";

/**
 * Pièce chargée depuis sa fiche `.ALD` : la partie « données » d'`enterRoom` (engines/drascula/rooms.cpp, ScummVM) ; le
 * déroulement (musique, gestionnaires, séquences) est dans `loop.ts`. Les objets sont copiés : le jeu change leur visibilité
 * et leur état de porte pendant la partie, la fiche mise en cache reste intacte.
 */

/** `Common::Rect::contains` : bords gauche et haut inclus, droit et bas exclus. */
export function rectContains(rect: AldRect, x: number, y: number): boolean {
  return x >= rect.x1 && x < rect.x2 && y >= rect.y1 && y < rect.y2;
}

export function createRoomState(ald: AldRoom, chapter: number): RoomState {
  const objects: RoomObject[] = ald.objects.map((object) => ({
    id: object.id,
    name: object.name,
    rect: { ...object.rect },
    approach: { ...object.approach },
    track: object.track,
    visible: object.visible,
    isDoor: object.door !== null,
    door: object.door ? { ...object.door } : null,
  }));
  const factors = chapter !== 2 && ald.limits ? buildFactors(ald.walk, ald.limits, ald.number, chapter) : null;
  return {
    number: ald.number,
    music: ald.music,
    disk: ald.disk,
    paletteLevel: ald.paletteLevel,
    objects,
    walk: { ...ald.walk },
    hero: ald.hero,
    factors,
  };
}

/** Index de l'objet de numéro `id` dans la pièce, -1 s'il n'y est pas. */
export function objectIndex(room: RoomState, id: number): number {
  return room.objects.findIndex((object) => object.id === id);
}

/**
 * Chapitre 2 : taille et pas du héros de la pièce (en-tête de la fiche) ou valeurs par défaut. ScummVM charge aussi les
 * quatre images du héros (vague R). Les pas lus sont écrasés par le premier `startWalking`, qui remet 8 et 3 : ils sont sans effet.
 */
export function applyChapter2Hero(hero: Hero, room: RoomState): void {
  const size = room.hero;
  hero.width = size?.width ?? CHARACTER_WIDTH;
  hero.height = size?.height ?? CHARACTER_HEIGHT;
  hero.feetHeight = size?.feetHeight ?? FEET_HEIGHT;
  hero.stepX = size?.stepX ?? STEP_X;
  hero.stepY = size?.stepY ?? STEP_Y;
}

/**
 * Place le héros à l'arrivée dans la pièce (`enterRoom`). Si `hero.x` vaut -1, il apparaît au point de porte de l'objet
 * `objExit` (les pieds au point) ; sinon il garde sa position. Hors chapitre 2, sa taille suit la perspective du point.
 *
 * Fidélité : quand la position est gardée, ScummVM lit le facteur à `curY` (le haut du héros) et non aux pieds ; reproduit.
 * Écart : si aucun objet ne porte le numéro `objExit` (une seule porte du jeu : `19:173 -> 20/174`), ScummVM prend le point de
 * porte du premier objet, et une valeur restée d'une pièce précédente si ce n'est pas une porte ; on prend son point d'approche.
 */
export function placeHero(hero: Hero, room: RoomState, objExit: number, chapter: number): void {
  const index = Math.max(objectIndex(room, objExit), 0);
  const object = room.objects[index];
  const arrival = object?.door ?? object?.approach ?? { x: 0, y: 0 };
  if (chapter === 2) {
    if (hero.x === -1) {
      hero.x = arrival.x;
      hero.y = arrival.y - hero.height;
    }
  } else if (room.factors) {
    if (hero.x === -1) {
      hero.x = arrival.x;
      hero.y = arrival.y;
      const size = scaledSize(factorAt(room.factors, hero.y));
      hero.height = size.height;
      hero.width = size.width;
      hero.y -= hero.height;
    } else {
      const size = scaledSize(factorAt(room.factors, hero.y));
      hero.height = size.height;
      hero.width = size.width;
    }
  }
  hero.moving = false;
}
