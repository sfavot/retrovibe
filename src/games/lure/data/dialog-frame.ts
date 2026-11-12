/**
 * Cadres des boîtes de texte : ressources `0x3F03` (boîtes de dialogue, 336 octets) et `0x3F04` (bulles de conversation, 48 octets).
 *
 * Source : `Surface::vgaCreateDialog` et `TalkDialog::vgaTalkDialog` (engines/lure/surface.cpp, ScummVM, GPL v3+).
 * Chaque ressource est une petite image dont on répète une colonne et une ligne pour atteindre la taille voulue :
 * - `0x3F03` : haut (9 lignes de 7 + 1 + 9 octets : coin gauche, colonne répétée, coin droit), côté (une ligne de 9 + 1 + 9, répétée), bas
 *   (9 lignes de 9 + 1 + 8) : 334 octets lus ; **les 2 derniers octets valent 0 et ne sont pas lus** ;
 * - `0x3F04` : haut (3 lignes de 2 + 1 + 3), côté (3 + 1 + 3 répétée), bas (3 lignes de 3 + 1 + 2) pour une largeur fixe de 130 : 43 octets lus,
 *   **les 5 derniers valent 0 et ne sont pas lus**.
 *
 * Écarts volontaires : seule la variante VGA est portée ; le résultat est un tableau de pixels indexés (`largeur x hauteur`), la pose de
 * la boîte dans l'écran et le texte relèvent du rendu.
 */

import { Cursor, type Coverage } from "./cursor";

export const DIALOG_FRAME_EDGE = 9;
export const DIALOG_FRAME_SIZE = 0x150;
export const DIALOG_FRAME_USED = 334;
export const TALK_DIALOG_WIDTH = 130;
export const TALK_DIALOG_EDGE = 3;
export const TALK_DIALOG_FRAME_SIZE = 0x30;
export const TALK_DIALOG_FRAME_USED = 43;

/** `copyLine` : `left` octets, un octet répété `center` fois, `right` octets. */
function copyLine(c: Cursor, dest: Uint8Array, at: number, left: number, center: number, right: number): void {
  dest.set(c.slice(left), at);
  dest.fill(c.u8(), at + left, at + left + center);
  dest.set(c.slice(right), at + left + center);
}

/** Boîte de dialogue de `width x height` pixels (au moins 18 x 18). */
export function expandDialogFrame(frame: Uint8Array, width: number, height: number, coverage?: Coverage): Uint8Array {
  if (width < 2 * DIALOG_FRAME_EDGE || height < 2 * DIALOG_FRAME_EDGE) throw new RangeError("cadre de dialogue : taille trop petite");
  const c = new Cursor(frame, coverage);
  const out = new Uint8Array(width * height);
  const xCenter = width - DIALOG_FRAME_EDGE * 2;
  const yCenter = height - DIALOG_FRAME_EDGE * 2;
  let y = 0;
  for (let i = 0; i < DIALOG_FRAME_EDGE; i++) copyLine(c, out, y++ * width, DIALOG_FRAME_EDGE - 2, xCenter + 2, DIALOG_FRAME_EDGE);
  const side = c.pos;
  for (let i = 0; i < yCenter; i++) copyLine(c.seek(side), out, y++ * width, DIALOG_FRAME_EDGE, xCenter, DIALOG_FRAME_EDGE);
  c.seek(side + DIALOG_FRAME_EDGE * 2 + 1);
  for (let i = 0; i < DIALOG_FRAME_EDGE; i++) copyLine(c, out, y++ * width, DIALOG_FRAME_EDGE, xCenter + 1, DIALOG_FRAME_EDGE - 1);
  return out;
}

/** Bulle de conversation de `TALK_DIALOG_WIDTH x height` pixels (au moins 6 de haut). */
export function expandTalkDialogFrame(frame: Uint8Array, height: number, coverage?: Coverage): Uint8Array {
  if (height < 2 * TALK_DIALOG_EDGE) throw new RangeError("cadre de bulle : hauteur trop petite");
  const c = new Cursor(frame, coverage);
  const width = TALK_DIALOG_WIDTH;
  const out = new Uint8Array(width * height);
  const fill = width - TALK_DIALOG_EDGE - 2;
  let y = 0;
  for (let i = 0; i < TALK_DIALOG_EDGE; i++) copyLine(c, out, y++ * width, 2, fill, TALK_DIALOG_EDGE);
  const side = c.pos;
  for (let i = 0; i < height - TALK_DIALOG_EDGE * 2; i++) copyLine(c.seek(side), out, y++ * width, TALK_DIALOG_EDGE, width - TALK_DIALOG_EDGE * 2, TALK_DIALOG_EDGE);
  c.seek(side + TALK_DIALOG_EDGE * 2 + 1);
  for (let i = 0; i < TALK_DIALOG_EDGE; i++) copyLine(c, out, y++ * width, TALK_DIALOG_EDGE, fill, 2);
  return out;
}
