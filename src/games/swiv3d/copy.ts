/**
 * Textes de l'interface (hors textes du jeu, qui viennent de `GLOBAL.BD`). Le ton reste celui des autres jeux du site :
 * court, à la deuxième personne, sans jargon.
 */
export const copy = {
  title: "SWIV 3D",
  description:
    "Le shoot'em up en 3D de SCi (1997) : un hélicoptère de combat et les quatre missions de la version « Temperate Zone ».",
  coverAlt: "Écran titre de SWIV 3D : le logo chromé du jeu, au-dessus des logos d'Interplay et de SCi.",
  play: "Jouer",
  manual: "Manuel d'origine",
  manualNote: "Le manuel français du CD : scénario, commandes, véhicules.",
  manualTitle: "Manuel de SWIV 3D",
  manualOriginal: "Texte du manuel d'origine, en français. Il décrit la version complète du jeu : certaines options et missions n'existent pas ici.",
  manualContents: "Sommaire du manuel",
  manualBack: "← Écran titre",
  manualLoading: "Chargement du manuel…",
  manualLoadError: "Impossible de charger le manuel :",
  controlsTitle: "Commandes",
  controls: [
    "Flèches ou ZQSD (WASD en QWERTY) : avancer, reculer, tourner. Virgule et point (ou Q et E) : se déplacer sur le côté.",
    "Espace : tirer. M ou X : arme spéciale. Page préc. et Page suiv. (ou [ et ]) : changer d'arme, ou touches 1 à 0.",
    "Ctrl gauche ou Maj gauche : déplacement latéral avec les flèches. P : pause. Les touches se changent dans le menu du jeu.",
    "Manette : stick ou croix pour piloter, boutons de tir pour tirer. Écran tactile (en paysage) : manche virtuel à gauche, boutons de tir à droite.",
  ],
  canvasLabel: "Écran du jeu SWIV 3D",
  sound: "Son",
  loading: "Chargement du niveau…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  missingFiles: "Les fichiers du jeu sont introuvables : SWIV 3D ne peut pas démarrer.",
  unknownLevel: "Niveau inconnu :",
  // Démarrage : le navigateur n'autorise le son qu'après un geste.
  startPrompt: "Clique pour lancer le jeu",
  startButton: "Jouer",
  // Noms des langues du menu (la table du jeu écrit « Francais »).
  languageNames: { 1: "Français", 0: "English" } as Record<number, string>,
  // Noms de touches de l'écran des commandes (le reste vient de la table 1000 du jeu).
  keys: {
    space: { 1: "Espace", 0: "Space" },
    control: { 1: "Ctrl gauche", 0: "Left Ctrl" },
    shift: { 1: "Maj gauche", 0: "Left Shift" },
    pageUp: { 1: "Page préc.", 0: "Page Up" },
    pageDown: { 1: "Page suiv.", 0: "Page Down" },
  } as Record<string, Record<number, string>>,
  // Saisie du nom sur écran tactile (pas de clavier à l'écran dans le canvas).
  namePrompt: "Nom du pilote (15 caractères au plus) :",
  // Commandes tactiles (le libellé du bouton est aussi son nom pour les lecteurs d'écran).
  stickLabel: "Manche : pencher pour tourner et avancer",
  fire: "Tir",
  special: "Spécial",
  weaponNext: "Arme",
  brake: "Latéral",
};
