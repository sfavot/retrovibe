/** Un jeu proposé sur la page d'accueil. */
export interface GameDefinition {
  /** Identifiant stable, utilisé dans l'URL (`#/<id>`). */
  id: string;
  title: string;
  description: string;
  /** URL de l'image affichée sur la carte d'accueil (jaquette, écran titre…), de n'importe quel format. */
  cover?: string;
  /** Dimensions réelles de l'image, `[largeur, hauteur]`. */
  coverSize?: [number, number];
  /** Image en pixel art : à agrandir sans lissage. */
  coverPixelated?: boolean;
  /** Texte alternatif de la jaquette. */
  coverAlt?: string;
  /** Monte le jeu dans `container` (chargement des données compris). */
  start(container: HTMLElement): Promise<void>;
}
