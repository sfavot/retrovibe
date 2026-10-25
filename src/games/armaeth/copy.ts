/**
 * Textes de l'interface (hors textes du jeu, qui viennent des fichiers de données).
 * Les textes de l'aide viennent des fichiers du jeu (`A1FSOS.SYS`, `MSGUTL` 57 à 61) ; ici, seulement l'habillage.
 */
export const copy = {
  title: "Armaeth",
  description:
    "L'aventure en vue de côté de Grandslam (1994) : on se déplace à la souris et au clavier, et on tape ses commandes en français. Jouable, en cours de validation.",
  coverAlt: "Écran titre d'Armaeth : un paysage de montagnes au coucher du soleil, encadré de quatre portraits (Killian, Armaeth, Minas et Prytwen).",
  play: "Jouer",
  sound: "Son",
  // Écran de présentation.
  help: "Aide : les indices",
  helpNote: "Les indices de l'aide d'origine, un par un. Ils dévoilent des solutions.",
  controlsTitle: "Contrôles",
  controls: [
    "Souris : cliquer une icône pour choisir l'outil, puis la scène ou un objet. Clic droit : autre sens de l'outil.",
    "Marcher : flèches, Début, Fin, Pg. préc. et Pg. suiv. (8 directions) ; rappuyer sur la même direction arrête. Touche - : monter, touche + : descendre.",
    "Taper une phrase (« regarder », « prendre la clef ») puis Entrée. Inser rappelle la dernière, Échap annule.",
    "F1 : aide du jeu. F2 : sauvegarder. F3 : restaurer. F4 : continuer. F5 : recommencer. F6 : score. F10 : inventaire.",
    "Alt + A / Alt + Z : jeu plus lent / plus rapide. Alt + P / Alt + N : pas à pas / vitesse normale.",
    "Écran tactile : toucher = clic, appui long = clic droit.",
  ],
  loading: "Chargement…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Armaeth",
  missingFiles: "Les fichiers du jeu sont introuvables : Armaeth ne peut pas démarrer.",
  // Lien d'aide du pied de page, pendant le jeu.
  helpLink: "Aide",
  helpResume: "← Retour au jeu",
  // Page d'aide.
  helpTitle: "Aide d'Armaeth",
  helpBack: "← Écran titre",
  helpUp: "← Retour",
  helpSpoiler: "Attention : ces indices dévoilent des solutions du jeu.",
  helpLoading: "Chargement de l'aide…",
  helpLoadError: "Impossible de charger l'aide :",
  helpPath: "Chemin",
};
