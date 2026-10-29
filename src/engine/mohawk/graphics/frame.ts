/**
 * Image prête à afficher, passée par le moteur à `Host.present`.
 *
 * Sa taille est celle de la zone de jeu de l'hôte (576×432 pour Mathémagique, 640×480 pour Zoombinis) ; seul le présentateur
 * du navigateur ajoute la bordure éventuelle et la mise à l'échelle.
 */

export interface Frame {
  /** Largeur de la zone de jeu, en pixels. */
  readonly width: number;
  /** Hauteur de la zone de jeu, en pixels. */
  readonly height: number;
  /** `width × height` indices de palette, ligne par ligne. Réutilisé d'une image à l'autre : le copier si on le garde. */
  readonly pixels: Uint8Array;
  /** 256 × RVB 8 bits, déjà prêt pour l'écran (éclaircissement, fondu et cycles appliqués). Réutilisé lui aussi. */
  readonly palette: Uint8Array;
}
