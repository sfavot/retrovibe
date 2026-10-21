/** Un jeu proposé sur la page d'accueil. */
export interface GameDefinition {
  /** Identifiant stable, utilisé dans l'URL (`#/<id>`). */
  id: string;
  title: string;
  description: string;
  /** Monte le jeu dans `container` (chargement des données compris). */
  start(container: HTMLElement): Promise<void>;
}
