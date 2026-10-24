/**
 * Pont vers le clavier des téléphones : le nom du joueur est saisi dans le canvas (rendu d'origine), mais un canvas ne fait pas
 * apparaître le clavier virtuel. L'hôte navigateur fournit un champ HTML invisible derrière ce port (implémentation dans `ui/`, hors de
 * ce module : le moteur ne touche pas au DOM). Aucun texte destiné au joueur ici.
 *
 * Contrat :
 *  - `focus()` est appelé quand le moniteur attend du texte (saisie du nom, champ du timer), de préférence depuis le geste du joueur
 *    (clic sur New Player / Add) pour que le navigateur accepte d'ouvrir le clavier ; `blur()` quand la saisie se termine ;
 *  - `onText(cb)` : `cb` reçoit le texte saisi, un ou plusieurs caractères ; `"\b"` signifie retour arrière, `"\n"` valide (Entrée).
 *    Renvoie la fonction de désabonnement ;
 *  - le port ne doit relayer **que** ce qui n'arrive pas déjà par les événements de touche du moteur (`Input.keyDown`, lus par
 *    `MonitorOverlay.key`) : sur un clavier physique la frappe passe par la touche, sur un clavier virtuel (touches « Unidentified » ou
 *    composition) par ce port. Sinon un caractère serait saisi deux fois.
 */
export interface TextInputPort {
  focus(): void;
  blur(): void;
  onText(callback: (text: string) => void): () => void;
}

/** Port inerte (hôtes sans clavier virtuel) : la saisie ne passe que par les événements de touche. */
export const NULL_TEXT_INPUT: TextInputPort = {
  focus() {},
  blur() {},
  onText: () => () => {},
};
