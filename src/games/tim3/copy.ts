/**
 * Textes de l'interface de The Incredible Machine 3 (hors textes du jeu, lus dans ses fichiers : buts et indices de
 * `LEVELS.INF`, pièces de `INFO.RES`, infobulles de `DESCRIPT.RES`, musiques de `MUSIC.RES`, félicitations de `BINSOLVE.RES`).
 * Les phrases marquées « (jeu) » sont reprises telles quelles de `INTRFACE.RES` (FRENCH.DAT).
 */
export const copy = {
  title: "The Incredible Machine 3",
  description:
    "Les puzzles mécaniques de Dynamix (1995) : posez balles, cordes, poulies, moteurs et animaux, puis lancez la machine pour atteindre le but.",
  coverAlt: "Un puzzle de The Incredible Machine 3 : des balles, des murs de briques et des pentes sur un fond bleu ciel.",
  play: "Jouer",
  sound: "Son",
  loading: "Chargement…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  missingFiles: "Les fichiers du jeu sont introuvables : The Incredible Machine 3 ne peut pas démarrer.",
  canvasLabel: "Écran du jeu The Incredible Machine 3 : aire de jeu, bac à pièces à droite, but en bas",

  // Pied de page et barre tactile.
  mainMenu: "Menu principal" /* (jeu : menu Windows « Zones ») */,
  mainMenuLabel: "Revenir au menu principal du jeu",
  help: "Aide",

  // Parcours d'entrée : intro, crédits, menu principal.
  introSkip: "Présentation du jeu : touchez l'écran ou appuyez sur une touche pour la passer.",
  creditsTitle: "Crédits",

  // Choix du puzzle (DOSBOX, DOSBIN).
  chooserTitle: "Choisir un puzzle",
  binsTitle: "Catégories de puzzles",
  categories: [
    "Puzzles des Travaux Pratiques",
    "Puzzles Faciles",
    "Puzzles Moyennement Difficiles",
    "Puzzles Difficiles",
    "Puzzles Très Difficiles",
  ] /* (jeu) */,
  solvedMark: "résolu",

  // Guitare (MUSICBOX.ITF) : noms des contrôles pour les lecteurs d'écran ; réglage de la voix ajouté par le site.
  musicReplay: "Relancer la musique",
  musicSwitch: "Musique : marche/arrêt",
  musicPrevious: "Musique précédente",
  musicNext: "Musique suivante",
  effectReplay: "Relancer l'effet",
  effectsSwitch: "Effets sonores : marche/arrêt",
  effectPrevious: "Effet précédent",
  effectNext: "Effet suivant",
  voices: "Voix du professeur (en anglais) : marche/arrêt",

  // Labo.
  labTitle: "Labo du Professeur Tim",
  labGoal: "Labo : construisez la machine de votre choix, puis lancez-la.",

  // Machines du Labo (bouton disque) : « (jeu) » = INTRFACE.RES (FRENCH.DAT), le reste est écrit pour le site.
  machinesTitle: "Machines du Labo",
  machinesSaveTitle: "Sauvegarder une machine du Labo",
  machinesLoadTitle: "Charger une machine du Labo",
  machineName: "Nom de la machine",
  machineLoad: "Charger une machine",
  machineSave: "Sauvegarder la machine",
  machineSlot: (n: number) => `Emplacement ${n}`,
  machineEmpty: "vide",
  machineSaved: (name: string) => `« ${name} » est sauvegardée.`,
  machineLoaded: (name: string) => `« ${name} » est chargée.`,
  machineNoName: "Donnez un nom à votre machine.",
  machineNothing: "Vous n'avez aucun élément à sauvegarder." /* (jeu) */,
  machineOccupied: "Cet emplacement contient déjà une machine. Désirez-vous vraiment la remplacer?",
  machineFailed: "La machine n'a pas pu être sauvegardée : le stockage du navigateur est plein ou bloqué.",
  machineUnreadable: "Cet emplacement est vide ou sa machine est illisible.",
  machineLoadFailed: "Cette machine n'a pas pu être chargée.",

  // Messages du jeu (INTRFACE.RES).
  noHints: "Ce puzzle n'a pas d'indices." /* (jeu) */,
  notAvailable: "Cette caractéristique n'est pas disponible dans cette version de TIM." /* (jeu) */,
  clearConfirm: "Les modifications du puzzle seront effacées. Désirez-vous continuer?" /* (jeu) */,

  // Fenêtre « programmer » (les autres libellés viennent d'INTRFACE.RES).
  programPrevious: "Choix précédent",
  programNext: "Choix suivant",
  programChoice: (i: number, n: number) => `Choix ${i} sur ${n}`,
  programMore: "Augmenter",
  programLess: "Diminuer",
  programCounter: (n: number) => `Réglage : ${n}`,
  programBucket: "Fuite",
  programSliderLess: (setting: string) => `${setting} : moins`,
  programSliderMore: (setting: string) => `${setting} : plus`,

  // Fenêtres du jeu : noms des flèches et des réglettes pour les lecteurs d'écran.
  scrollUp: "Faire défiler vers le haut",
  scrollDown: "Faire défiler vers le bas",
  globeTitle: "Gravité, pression et décor",
  backgroundPrevious: "Couleur du décor précédente",
  backgroundNext: "Couleur du décor suivante",
  backgroundStatus: (n: number) => `Couleur du décor : ${n} sur 15`,
  musicboxTitle: "Musique et sons",
  binsolveTitle: "Catégorie terminée",
  hintTitle: "Indice du professeur",
  hintReplay: "Réécouter l'indice",
  hintsShown: (n: number) => (n > 1 ? `${n} indices sont montrés par des mains dans l'aire de jeu.` : "Un indice est montré par une main dans l'aire de jeu."),
  hintsHidden: "Les indices sont cachés.",
  voiceBand: "Voix du professeur",
  musicboxStatus: (music: string, sound: string, volume: number) => `Musique : ${music}. Son : ${sound}. Volume : ${volume} sur 15.`,

  // Infobulle d'une pièce.
  partInfoTitle: "Description de l'Élément." /* (jeu) */,

  // Écran titre et aide.
  helpTitle: "Aide de The Incredible Machine 3",
  helpBack: "← Écran titre",
  helpResume: "← Retour au jeu",
  controlsTitle: "Contrôles",
  controls: [
    "Glisser une pièce du bac (à droite) vers l'aire de jeu pour la poser ; un simple clic la prend en main, un second clic la pose. Une pièce ne se pose pas sur une autre.",
    "Glisser une pièce posée pour la déplacer ; la ramener sur le bac (ou Échap) la range.",
    "Autour d'une pièce : poubelle (en haut à gauche) pour la ranger, flèches rouges (en bas à gauche) pour la retourner, flèches bleues pour l'étirer, loupe (en bas à droite) pour sa description. Certaines pièces (minuteur, ballon, balle programmable, seau troué…) ont aussi une poignée pour les programmer.",
    "Clavier, sur la pièce en main ou survolée : X et Y la retournent, + et − changent sa taille, Suppr la range.",
    "Cordes et courroies : prendre la corde, toucher la première pièce, puis la seconde (les poulies se traversent en les touchant).",
    "Drapeau (en haut à droite) ou bouton vert du bac : démarrer ; un clic dans l'aire ou Échap arrête la machine, qui revient exactement comme avant.",
    "Votre construction est gardée : en quittant un puzzle ou le Labo, ou en fermant la page, vous la retrouvez à la prochaine ouverture. Rien n'est gardé en pleine marche : c'est l'état d'avant « Démarrer » qui l'est.",
    "Écran tactile : la pièce tenue est dessinée au-dessus du doigt ; toucher une pièce posée affiche ses poignées ; un appui long dans le bac donne la description d'une pièce.",
  ],
  helpGoalTitle: "Le but",
  helpGoal:
    "Chaque puzzle a un but, écrit en bas de l'écran. Placez les pièces du bac pour l'atteindre, puis démarrez la machine. Le professeur Tim donne des indices (bouton de la main) : il les dit en anglais et ils restent écrits en français.",
  helpCreditsTitle: "Crédits",
  copyright: "The Incredible Machine 3 © 1992-1995 Sierra On-Line / Dynamix. Tous droits réservés à leurs ayants droit.",
  abandonware:
    "Les fichiers du jeu (images, sons, musique, textes) restent la propriété de leurs ayants droit : le jeu est un abandonware, aucune licence n'en autorise la redistribution, et ces fichiers seront retirés sur simple demande d'un ayant droit. Cette version est une version modifiée : le moteur a été réécrit en TypeScript pour fonctionner dans le navigateur, les voix sont converties en MP3 et la musique est jouée par un synthétiseur General MIDI.",
  openTim:
    "Le moteur physique de ce portage a été écrit d'après le jeu lui-même et d'après OpenTIM (réimplémentation libre de The Incredible Machine, licence GPL-3.0), traduit avec attribution.",
  openTimLink: "https://github.com/marlyser/OpenTIM",
  toolbarTitle: "Barre d'outils",
  toolbarHelp: [
    "Pièce de puzzle : le mode Jeu, enfoncée tant que vous jouez un puzzle. Au Labo, elle rouvre votre dernier puzzle, après confirmation. Pour choisir un autre puzzle, utilisez la disquette.",
    "Clé : le Labo du Professeur Tim, après confirmation ; elle reste enfoncée tant que vous y êtes.",
    "Livre : le manuel, c'est-à-dire cette aide.",
    "Chat et Tim, chaussure, feuille et stylo : le mode à deux joueurs, la visite guidée du Labo et l'inscription des joueurs. Grisés, ils ne sont pas disponibles dans cette version.",
    "Disquette : en Jeu, la liste des puzzles de la catégorie (une ampoule allumée devant chaque puzzle résolu ; « Autres Puzzles » pour changer de catégorie) ; au Labo, les machines du Labo.",
    "Guitare : la musique, les sons, le volume et la voix du professeur.",
    "Globe : la gravité et la pression (réglables au Labo seulement) et la couleur du décor.",
    "Balayette : dégage l'aire de jeu ; au Labo, une confirmation est demandée avant d'effacer votre machine.",
    "Point d'interrogation : cette aide.",
    "Main : montre ou cache les indices du professeur, des mains posées dans l'aire de jeu ; cliquez sur une main pour lire l'indice et l'entendre. Grisée au Labo.",
    "Ampoule, une fois le puzzle résolu : pose la solution du professeur à la place de la vôtre, après confirmation.",
    "Au Labo, le cadenas (verrouiller les pièces) et le levier d'essai sont grisés : ils ne sont pas disponibles dans cette version.",
    "Drapeau : démarre la machine ; un clic dans l'aire de jeu ou Échap l'arrête.",
    "Survolez un bouton à la souris, ou gardez le doigt dessus, pour afficher son nom.",
    "« Menu principal », sous l'écran, ramène au menu du jeu : Jeu, Labo, manuel, options et Quitter.",
  ],
  toolbarUnavailable: (label: string) => `${label} (non disponible)`,
  solutionShown: "La solution du professeur est posée : démarrez la machine pour la voir fonctionner.",
  fieldCleared: "L'aire de jeu est dégagée.",
} as const;
