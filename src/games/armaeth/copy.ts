/**
 * Textes de l'interface (hors textes du jeu, qui viennent des fichiers de données).
 * Les textes de l'aide viennent des fichiers du jeu (`A1FSOS.SYS`, `MSGUTL` 57 à 61) ; ici, seulement l'habillage.
 */
export const copy = {
  title: "Armaeth",
  description:
    "L'aventure en vue de côté de Grandslam (1994) : on se déplace à la souris, au clavier ou au doigt, et on tape ses commandes en français.",
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
    "Option « Flèches tenues » (sous l'écran) : le héros marche tant qu'on tient la flèche et s'arrête quand on la lâche.",
    "Taper une phrase (« regarder », « prendre la clef ») puis Entrée. Inser rappelle la dernière, Échap annule.",
    "F1 : aide du jeu. F2 : sauvegarder. F3 : restaurer. F4 : continuer. F5 : recommencer. F6 : score. F10 : inventaire.",
    "Alt + A / Alt + Z : jeu plus lent / plus rapide. Alt + P / Alt + N : pas à pas / vitesse normale.",
    "Écran tactile : toucher = clic, appui long = clic droit. Clavier : taper une phrase. Tenir : prendre un objet de l'inventaire (Ctrl + clic).",
  ],
  loading: "Chargement…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Armaeth",
  missingFiles: "Les fichiers du jeu sont introuvables : Armaeth ne peut pas démarrer.",
  // Barre tactile.
  keyboard: "Clavier",
  keyboardLabel: "Clavier : taper une commande, par exemple « regarder »",
  confirm: "Entrée",
  confirmLabel: "Valider la commande (Entrée)",
  cancel: "Échap",
  cancelLabel: "Annuler la commande (Échap)",
  hold: "Tenir",
  holdLabel: "Tenir un objet : activer, puis toucher l'objet de l'inventaire (Ctrl + clic)",
  // Option du pied de page, pendant le jeu (clavier).
  holdArrows: "Flèches tenues",
  holdArrowsTitle: "Marcher tant qu'on tient la flèche. Désactivé (comme le jeu d'origine) : appuyer pour partir, rappuyer pour s'arrêter.",
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
