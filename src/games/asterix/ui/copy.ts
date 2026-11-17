/**
 * Textes du site pour Astérix (hors textes du jeu, qui viennent de ses fichiers de données et de ses images).
 * En français, écrits directement (règle du projet).
 */
export const copy = {
  title: "Astérix : le défi de César",
  description:
    "Le jeu de plateau et de mini-jeux d'Astérix (Infogrames Multimedia, 1995), en français : César met les Gaulois au défi de rapporter un souvenir de chaque province de l'Empire. De 1 à 4 joueurs.",
  // Écran de présentation et carte de l'accueil.
  coverAlt: "Jaquette d'Astérix : le défi de César : Astérix, un sac sur l'épaule, marche sur une carte de l'Europe avec Obélix et Idéfix, sous l'ombre de César.",
  play: "Jouer",
  // Bouton de l'écran de présentation quand une partie interrompue est sauvegardée (« Jouer » devient secondaire).
  resumeGame: "Continuer",
  resumeNote: "Une partie en cours est gardée dans ce navigateur : elle reprend au début du tour où elle s'est arrêtée.",
  help: "Aide et crédits",
  manual: "Manuel d'origine",
  manualNote: "Manuel de l'édition Macintosh, en français (PDF, dans un nouvel onglet).",
  // Page d'aide et de crédits.
  helpTitle: "Aide et crédits d'Astérix : le défi de César",
  helpBack: "← Écran titre",
  helpRulesTitle: "Le jeu",
  helpRules: [
    "De 1 à 4 joueurs choisissent leur personnage (Astérix, Obélix, Bonemine, Agecanonix, Falbala ou Goudurix), leur niveau de réflexion et d'action, puis la durée de la partie et le nombre de souvenirs à rapporter.",
    "Chacun à son tour lance le dé et avance sur un plateau de 54 cases. Il faut rapporter un souvenir de chaque province, puis revenir au village avant la fin du temps choisi.",
    "Les souvenirs se gagnent en répondant au quiz des cases pays, ou s'achètent 3 sesterces chez le marchand Epidemaïs. Les sesterces se gagnent dans les mini-jeux d'adresse et d'observation.",
    "Sur les cases repos, Panoramix propose parfois un jeu d'ambiance hors écran : les joueurs le font entre eux, puis désignent eux-mêmes le gagnant ou le perdant.",
    "Au menu principal, sans rien toucher pendant une minute, le jeu lance une démonstration ; un clic ou une touche ramène au menu.",
  ],
  helpPointerTitle: "À la souris et au toucher",
  helpPointer: [
    "À la souris : cliquer directement sur un bouton, une pancarte, une réponse, un objet ou une case. Un clic lance puis arrête le dé, et passe une séquence.",
    "Au toucher : un appui du doigt vaut un clic. Dans les mini-jeux d'adresse, toucher l'écran du côté où aller (en haut pour sauter, en bas pour se baisser).",
    "Le jeu d'origine, sous DOS, se pilotait aux flèches : le clic et le toucher directs sont un ajout de cette adaptation.",
  ],
  helpKeysTitle: "Au clavier",
  helpKeys: [
    ["Flèches", "Déplacer le curseur du jeu, diriger le personnage dans les mini-jeux"],
    ["Espace", "Valider ; lancer puis arrêter le dé"],
    ["Échap", "Passer une séquence"],
    ["P", "Pause, depuis le menu du tour"],
    ["F1 / F2", "Baisser / monter le volume"],
  ] as readonly (readonly [string, string])[],
  helpSavesTitle: "Sauvegarde",
  helpSaves:
    "La partie est sauvegardée d'elle-même au début de chaque tour, dans le navigateur de cet appareil. À l'écran titre, « Continuer » la reprend au début du tour où elle s'est arrêtée ; « Jouer » commence une nouvelle partie, qui la remplace. Elle ne suit pas d'un appareil à l'autre, et effacer les données du site l'efface. La version DOS d'origine n'avait pas de sauvegarde.",
  helpAboutTitle: "À propos et droits",
  helpAbout: [
    "Astérix : le défi de César est un jeu d'Infogrames Multimedia (1995), réalisé par Bertrand Brocard d'après la bande dessinée de René Goscinny et Albert Uderzo, avec Philips et Pathé Interactive ; l'adaptation pour PC est d'IKOS. Astérix et ses personnages sont © Les Éditions Albert René / Goscinny-Uderzo. Les données du jeu restent la propriété de leurs ayants droit : aucune licence de redistribution n'existe, et elles seront retirées sur demande d'un ayant droit.",
    "Cette version est une réécriture du jeu pour le navigateur : sa logique, écrite en dur dans le programme du CD pour DOS (ASTERIX.EXE, version française), a été reconstituée d'après son désassemblage. Les images, les voix, les musiques, les vidéos et les questions du quiz sont celles du CD ; les sons et les vidéos ont été convertis pour alléger le site.",
  ],
  helpDocumentLinks: [
    ["MANUEL.pdf", "Manuel du jeu, édition Macintosh, en français (PDF)"],
    ["CARTE.pdf", "Carte du jeu : le plan du plateau (PDF)"],
  ] as readonly (readonly [string, string])[],
  helpSource: "Code source de cette adaptation : github.com/sfavot/retrovibe",
  sourceUrl: "https://github.com/sfavot/retrovibe",
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
