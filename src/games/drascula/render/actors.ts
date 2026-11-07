import type { GameState } from "../engine/state";
import type { DrasculaRenderer } from "./renderer";

/**
 * Personnages secondaires dessinés par le moteur : Igor, Drascula et Von Braun (`placeIgor`, `placeDrascula`, `moveVonBraun`,
 * engines/drascula/actors.cpp, ScummVM). Les répliques (`heads.ts`) et les cinématiques (`cinematics/`) les dessinent ; les
 * pièces (vague P) les appelleront de leurs accroches `painters` (`update_N`).
 *
 * Les feuilles sont celles de ScummVM : Igor est dans `front` (`auxigor.alg`, `auxig2.alg`), Drascula dans `back` (`auxdr.alg`) et,
 * au chapitre 6, dans `draw2`. Chaque fonction dessine dans `dest` (par défaut l'image en cours de composition, `gfx.screen`).
 *
 * Écart : `moveVonBraun` fait avancer l'image de marche à chaque dessin ; ici l'image de marche est dans l'état
 * (`vonBraun.frame`) et avance à chaque pas de `placeVonBraun` (`engine/talkers.ts`), l'image étant recomposée à la demande de l'hôte.
 */

/** `placeIgor` : Igor, de profil (colonne 1, rangée 76 à droite, 0 à gauche) ou de face (rangée 138) ; toujours de face au chapitre 4. */
export function placeIgor(gfx: DrasculaRenderer, state: GameState, dest = gfx.screen): void {
  const { igor, chapter } = state;
  const row = chapter === 4 || igor.track === 3 ? 138 : igor.track === 1 ? 76 : 0;
  dest.copyRect(gfx.front, 1, row, igor.x, igor.y, 54, 61);
}

/** `placeDrascula` : 47 à droite, 1 à gauche, 93 de face (chapitre 1 seulement), sinon 0 ; la feuille est `draw2` au chapitre 6. */
export function placeDrascula(gfx: DrasculaRenderer, state: GameState, dest = gfx.screen): void {
  const { drascula, chapter } = state;
  const column = drascula.track === 1 ? 47 : drascula.track === 0 ? 1 : drascula.track === 3 && chapter === 1 ? 93 : 0;
  dest.copyRect(chapter === 6 ? gfx.draw2 : gfx.back, column, 122, drascula.x, drascula.y, 45, 77);
}

/** Dernière colonne de l'image de marche de Von Braun avant le retour à la première (`actorFrames` > 146 -> 1). */
const VON_BRAUN_LAST_FRAME = 146;
/** Pas de colonne entre deux images de marche de Von Braun. */
export const VON_BRAUN_FRAME_STEP = 29;

/** Colonne suivante de l'image de marche de Von Braun (`moveVonBraun`). */
export function nextVonBraunFrame(frame: number): number {
  const next = frame + VON_BRAUN_FRAME_STEP;
  return next > VON_BRAUN_LAST_FRAME ? 1 : next;
}

/**
 * `moveVonBraun` (partie dessin) : Von Braun à l'ordonnée 66, dans `front`. Immobile : une image fixe (colonne 256, ou 222 / 188 selon
 * l'orientation, rangée 129, 33 x 69) ; en marche : l'image de marche `frame` (rangée 62 à gauche, 131 à droite, 28 x 68).
 */
export function drawVonBraun(gfx: DrasculaRenderer, state: GameState, dest = gfx.screen): void {
  const { vonBraun } = state;
  if (!vonBraun.moving) {
    const column = vonBraun.track === 0 ? 222 : vonBraun.track === 1 ? 188 : 256;
    dest.copyRect(gfx.front, column, 129, vonBraun.x, 66, 33, 69);
  } else {
    dest.copyRect(gfx.front, vonBraun.frame, vonBraun.track === 0 ? 62 : 131, vonBraun.x, 66, 28, 68);
  }
}
