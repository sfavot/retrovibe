/**
 * Image prête à afficher, passée par le moteur à `Host.present`.
 *
 * La zone de jeu de l'original fait 576×432, centrée dans un écran noir de 640×480 (engine.md §4) : seul le
 * présentateur du navigateur ajoute la bordure et la mise à l'échelle.
 */

export const PLAY_WIDTH = 576;
export const PLAY_HEIGHT = 432;

export interface Frame {
  /** `PLAY_WIDTH × PLAY_HEIGHT` indices de palette, ligne par ligne. Réutilisé d'une image à l'autre : le copier si on le garde. */
  readonly pixels: Uint8Array;
  /** 256 × RVB 8 bits, déjà prêt pour l'écran (éclaircissement, fondu et cycles appliqués). Réutilisé lui aussi. */
  readonly palette: Uint8Array;
}
