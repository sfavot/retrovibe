/**
 * Écran des séquences plein écran : ce que `LureRenderer` montre tant qu'une séquence (introduction, chute, tonneau, capture, fin) est en
 * cours, à la place de la pièce. C'est l'écran système de ScummVM (`Screen::screen()` et sa palette) vu des séquences : une image
 * 320 x 200 d'indices et une palette RVB de 8 bits (768 octets), que les séquences écrivent et que le rendu lit.
 *
 * Source (ScummVM, GPL v3+) : `Screen` (engines/lure/screen.cpp). La palette part de celle du jeu (`Screen::Screen` charge `0x3F01`) : les
 * entrées que les séquences ne touchent pas (`setPaletteEmpty` et les palettes d'animation ne couvrent que les 220 premières) gardent
 * ces couleurs, comme dans ScummVM.
 *
 * Écarts volontaires : ScummVM bloque pendant les fondus (pas de 20 ms) ; ici les fondus des séquences sont écrits par la séquence, par
 * pas de 20 ms comptés sur l'horloge du moteur (4 pas par image de logique, donc un changement visible par image de 80 ms). Seul le
 * fondu de la **pièce** qui précède une séquence est fait par le rendu, qui a seul l'image de la pièce : voir `holdRoom`.
 */

import type { Palette } from "../../data/palette";
import { GAME_COLORS } from "../../data/palette";
import { SCREEN_SIZE } from "../../data/picture";

export class SequenceScreen {
  /** Image : 320 x 200 indices. */
  readonly pixels = new Uint8Array(SCREEN_SIZE);
  /** Palette : 256 entrées RVB de 8 bits. */
  readonly palette = new Uint8Array(GAME_COLORS * 3);
  /**
   * Séquence jouée en cours de partie (chute, tonneau, capture, fin) : tant que `holdRoom` est vrai, le rendu garde la dernière image de la
   * pièce et la fond au noir (`paletteFadeOut` de ScummVM), l'hôte suspendant les ticks (`LureRenderer.fading`) ; la séquence passe
   * ensuite `holdRoom` à faux et dessine. Sans rendu (tests), rien n'attend.
   */
  holdRoom = false;
  /** La sortie de la séquence mène à un changement de pièce avec fondu (en jeu), au lieu d'un premier affichage sans fondu (introduction). */
  fadeIntoRoom = false;
  /** Curseur dessiné par-dessus : seule l'introduction le montre (`Mouse::cursorOff` ailleurs). */
  showCursor = false;

  constructor(gamePalette: Palette) {
    this.palette.set(gamePalette.rgb.subarray(0, GAME_COLORS * 3));
  }
}
