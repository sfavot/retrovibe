/**
 * Textes du site pour Astérix (hors textes du jeu, qui viennent de ses fichiers de données et de ses images).
 * En français, écrits directement (règle du projet).
 */
export const copy = {
  title: "Astérix : le défi de César",
  description: "Le jeu de plateau et de mini-jeux d'Astérix (Infogrames Multimedia, 1995).",
  coverAlt: "Astérix : le défi de César.",
  play: "Jouer",
  // Bouton de l'écran de présentation quand une partie interrompue est sauvegardée (« Jouer » devient secondaire).
  resumeGame: "Continuer",
  resumeNote: "Une partie en cours est gardée dans ce navigateur : elle reprend au début du tour où elle s'est arrêtée.",
  controlsTitle: "Contrôles",
  controls: [
    "Souris ou doigt : cliquer ou toucher directement un bouton, une réponse, un objet, une case.",
    "Flèches : déplacer le curseur du jeu.",
    "Mini-jeux d'adresse : flèches, ou toucher l'écran du côté voulu (en haut pour sauter, en bas pour se baisser).",
    "Espace ou clic gauche : valider, lancer puis arrêter le dé.",
    "Échap ou un clic : passer une séquence.",
    "P : pause, depuis le menu du tour.",
    "F1 / F2 : baisser / monter le volume.",
  ],
  rulesTitle: "Le jeu",
  rules: [
    "De 1 à 4 joueurs font le tour d'un plateau de 54 cases pour rapporter un souvenir de chaque province, puis reviennent au village avant la fin du temps choisi.",
    "Les objets se gagnent en répondant au quiz des cases pays, ou s'achètent 3 sesterces chez le marchand Epidemaïs.",
    "Sur les cases repos, Panoramix propose parfois un jeu d'ambiance hors écran : les joueurs le font entre eux, puis désignent eux-mêmes le gagnant ou le perdant.",
    "La partie est sauvegardée au début de chaque tour.",
  ],
  loading: "Chargement…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Astérix : le défi de César",
  sound: "Son",
  missingFiles: "Les fichiers du jeu sont introuvables : Astérix : le défi de César ne peut pas démarrer.",
  // Écran provisoire qui remplace les mini-jeux tant qu'ils ne sont pas portés.
  placeholder: {
    title: "Mini-jeu à venir",
    question: "Quel résultat appliquer ?",
    won: "Gagné",
    lost: "Perdu",
  },
  // Page de développement.
  devTitle: "Astérix : le défi de César (recette)",
};
