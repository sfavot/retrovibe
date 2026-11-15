/**
 * Pages de collision `.NEO` (`*_MK.NEO`, NEOchrome Atari ST).
 *
 * Référence : ScummVM engines/cine/bg.cpp (`loadCtFW`) (GPL v3 ou ultérieure). L'en-tête NEOchrome de 128 octets est sauté, puis 32 000
 * octets planaires (même codage que le PI1). La valeur de chaque pixel (0 à 15) est un numéro de zone : marche, points sensibles.
 *
 * Écarts volontaires : l'en-tête (palette, nom, animation de couleurs) est ignoré ; `loadRelatedPalette(ctName)` n'est pas reproduit
 * (la palette ainsi chargée n'est lue nulle part dans ScummVM).
 */
import { planarToIndexed } from "./planar";
import { SCREEN_HEIGHT, SCREEN_ROW_BYTES } from "./pi1";

export const NEO_HEADER_SIZE = 0x80;

/** `loadCtFW` : 320 x 200 numéros de zone (la `collisionPage` de ScummVM). */
export function readNeoCollision(data: Uint8Array): Uint8Array {
  return planarToIndexed(data, NEO_HEADER_SIZE, SCREEN_ROW_BYTES, SCREEN_HEIGHT);
}
