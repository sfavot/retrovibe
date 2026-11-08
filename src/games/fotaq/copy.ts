/**
 * Textes de l'interface de *Flight of the Amazon Queen* (hors textes du jeu, qui viennent de `QUEEN2.JAS`, des `.DOG` et des `.CUT`).
 * Règle du projet (`CLAUDE.md` du dépôt) : texte final, en français, écrit ici directement. Les clés communes aux jeux de
 * pointer-et-cliquer (`DialogCopy`, `TitleCopy` de `src/ui/`) portent les mêmes noms que celles de Drascula.
 */
export const copy = {
  title: "Flight of the Amazon Queen",
  description:
    "L'aventure en pointer-et-cliquer de John Passfield et Steven Stamatiadis (1995), en français et parlée : Joe King, pilote, s'enfonce dans la jungle d'Amazonie pour sauver une princesse.",
  coverAlt: "Dans l'avion de l'aventure : deux personnages entre des caisses, avec le panneau de verbes et l'inventaire du jeu.",
  sound: "Son",

  // Écran de présentation.
  newGame: "Nouvelle partie",
  continueGame: "Continuer",
  continueNote: (description: string) => `Dernière sauvegarde : ${description}`,
  loadGame: "Charger une partie",
  help: "Aide et crédits",
  controlsTitle: "Commandes",
  controls: [
    "Souris : cliquer un verbe du panneau du bas, puis un objet ou un personnage de l'écran ou de l'inventaire. Le clic droit exécute l'action habituelle de l'objet sous le curseur.",
    "Écran tactile : toucher = clic gauche, appui long = clic droit. Le bouton « Passer » saute une scène.",
    "Clavier : O, F, D, N, E, P, A, U choisissent un verbe (ouvrir, fermer, déplacer, donner, examiner, prendre, parler, utiliser), 1 à 4 les objets de l'inventaire, virgule et point le font défiler. F10 sauvegarde, F7 charge, F9 règle le volume, F1 (ou F5) ouvre le menu.",
    "Échap coupe la réplique en cours ou saute la plupart des scènes, Entrée passe une réplique. Espace met le jeu en pause, et le reprend.",
  ],

  // Chargement et erreurs.
  loading: "Chargement…",
  loadingFiles: (percent: number) => `Chargement des fichiers du jeu : ${percent} %`,
  loadingRoom: "Chargement du décor…",
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Flight of the Amazon Queen",
  missingFiles: "Les fichiers du jeu sont introuvables : Flight of the Amazon Queen ne peut pas démarrer. Vérifiez votre connexion puis rechargez la page.",
  retryHint: "Vérifiez votre connexion puis rechargez la page.",
  invalidSave: "Cette sauvegarde ne peut pas être reprise.",

  // Barre tactile et pied de page.
  menu: "Menu",
  menuLabel: "Menu du jeu : sauvegarder, charger, volume, pause, aide, écran titre",
  skip: "Passer",
  skipLabel: "Passer la scène (Échap)",
  pause: "Pause",
  pauseLabel: "Mettre le jeu en pause ou le reprendre (Espace)",
  resume: "Reprendre",
  paused: "Jeu en pause",
  pausedHint: "Espace pour reprendre",
  titleScreen: "Écran titre",
  titleScreenTitle: "Revenir à l'écran titre",
  leaveTitle: "Revenir à l'écran titre ?",
  leaveText: "La partie en cours sera perdue si vous ne l'avez pas sauvegardée.",
  save: "Sauvegarder",
  saveTitle: "Sauvegarder la partie (F10)",
  load: "Charger",
  loadTitle: "Charger une partie (F7)",
  volume: "Volume",
  volumeTitle: "Volume de la musique (F9)",
  // Le jeu n'a pas de réglage des sous-titres (toujours affichés) : ces libellés ne sont jamais montrés (le menu n'a pas l'entrée).
  subtitles: "Sous-titres",
  subtitlesTitle: "Afficher ou masquer les sous-titres",
  helpLink: "Aide",
  helpResume: "← Retour au jeu",

  // Fenêtres de sauvegarde, de chargement et de volume.
  saveDialogTitle: "Sauvegarder la partie",
  loadDialogTitle: "Charger une partie",
  slotsLabel: "Emplacements de sauvegarde",
  close: "Fermer",
  overwrite: "Remplacer",
  cancel: "Annuler",
  volumeDialogTitle: "Volume de la musique",
  volumeLabel: "Volume de la musique",

  // Sauvegardes : emplacements et messages (`ui/saves.ts`).
  saveSlot: (slot: number) => `Emplacement ${slot}`,
  saveEmpty: "Emplacement vide",
  saveDescription: (place: string, date: string) => `${place} – ${date}`,
  saveDone: "Partie sauvegardée.",
  saveBusy: "Impossible de sauvegarder pendant une scène : réessayez quand vous reprenez la main.",
  saveFailed: "La sauvegarde a échoué : le stockage du navigateur est plein ou bloqué.",
  loadDone: "Partie chargée.",
  loadEmpty: "Cet emplacement est vide.",
  loadFailed: "Cette sauvegarde ne peut pas être chargée.",
  saveOverwrite: (slot: number) => `Remplacer la sauvegarde de l'emplacement ${slot} ?`,

  /**
   * Lieux, pour la description des sauvegardes : les noms de pièces de `QUEEN2.JAS` sont des noms de fichiers de décors (`C1`, `N9`,
   * `T18`), pas des noms de lieux ; la description donne donc la zone du jeu (les groupes de pièces de `specials/ownership.ts`,
   * sauf le début de la partie : voir `START_ROOMS` dans `ui/saves.ts`).
   */
  zoneNames: {
    1: "L'avion, la jungle et les Amazones",
    2: "Le camp de la Flöda",
    3: "Le temple et le labyrinthe",
    4: "La vallée et le lancement de la fusée",
    5: "La fin de l'aventure",
    6: "Le début de l'aventure",
  } as Readonly<Record<number, string>>,
  /**
   * Pièces qui n'appartiennent à aucune zone : écrans d'objets et de cinématiques (pièces 76 à 96 de `QUEEN2.JAS`, sans panneau de
   * commande). Nommées d'après leurs objets ; les plus nombreuses n'ont que des objets muets (« dummy ») et partagent un nom général.
   */
  roomNames: {
    77: "Sparky",
    78: "Le morceau de papier",
    79: "Le masque mortuaire",
    80: "Le gros dinosaure",
    81: "La tablette",
    82: "Un écran de l'aventure",
    83: "Un écran de l'aventure",
    84: "Un écran de l'aventure",
    85: "Un écran de l'aventure",
    86: "Un écran de l'aventure",
    87: "Un écran de l'aventure",
    88: "Un écran de l'aventure",
    89: "Un écran de l'aventure",
    90: "L'horloge ancienne",
    91: "Rita et Joe",
    92: "Hugh et les gardes de la Flöda",
    93: "Rita et le pistolet à rayon",
    94: "Rita, Sparky et la sortie de secours",
    96: "L'avion",
  } as Readonly<Record<number, string>>,
  unknownPlace: (room: number) => `Pièce ${room}`,

  // Page d'aide et crédits.
  helpTitle: "Aide et crédits de Flight of the Amazon Queen",
  helpBack: "← Écran titre",
  helpHowTitle: "Comment jouer",
  helpHow: [
    "Joe King, pilote, doit sauver une princesse enlevée dans la jungle. Une commande se compose d'un verbe et d'un ou deux objets : cliquez un verbe dans le panneau du bas, puis l'objet ou le personnage visé, à l'écran ou dans l'inventaire. La ligne de commande, à l'écran, montre la commande en cours avec le nom de ce que le curseur survole.",
    "Sans verbe choisi, un clic gauche fait marcher Joe ou franchir une porte, et un clic droit lance l'action habituelle de l'objet visé (ouvrir une porte, prendre un objet, parler à un personnage). Pour utiliser un objet sur un autre, cliquez « utiliser », l'objet, puis la cible.",
    "L'inventaire montre quatre objets à la fois : les flèches du panneau le font défiler. Une conversation propose des phrases à choisir ; les répliques sont parlées et sous-titrées.",
    "Échap coupe la réplique en cours ou saute la plupart des scènes, Entrée passe une réplique (au doigt, toucher l'écran pendant une réplique parlée), Espace met le jeu en pause à tout moment, et le reprend.",
  ],
  helpVerbsTitle: "Les huit verbes et leurs touches",
  helpVerbs: [
    ["O", "ouvrir"],
    ["F", "fermer"],
    ["D", "déplacer"],
    ["N", "donner"],
    ["E", "examiner"],
    ["P", "prendre"],
    ["A", "parler à"],
    ["U", "utiliser"],
  ] as readonly (readonly [string, string])[],
  helpKeysTitle: "Raccourcis clavier",
  helpKeys: [
    ["1 à 4", "choisir l'objet de l'inventaire correspondant"],
    ["virgule, point", "faire défiler l'inventaire"],
    ["Entrée", "passer la réplique en cours"],
    ["Échap", "couper la réplique en cours ou sauter la plupart des scènes"],
    ["F1, F5", "ouvrir le menu du jeu"],
    ["F10", "sauvegarder la partie"],
    ["F7", "charger une partie"],
    ["F9", "volume de la musique"],
    ["Espace", "pause ou reprise, à tout moment"],
  ] as readonly (readonly [string, string])[],
  helpSavesTitle: "Sauvegardes",
  helpSaves:
    "Dix emplacements, enregistrés dans le navigateur de cet appareil (sauvegarder ou charger est possible quand on a la main, pas pendant une scène ou un dialogue). Vider les données du site efface les sauvegardes. « Continuer » reprend la plus récente. Le menu du jeu (bouton « Menu », F1) réunit la sauvegarde, le chargement, le volume, la pause et le retour à l'écran titre.",
  helpAboutTitle: "À propos et licences",
  helpAbout: [
    "Flight of the Amazon Queen est un jeu de John Passfield et Steven Stamatiadis (Interactive Binary Illusions, 1995). Tout le contenu du jeu (images, voix, musique, textes) est © John Passfield et Steven Stamatiadis, qui l'ont mis gratuitement à disposition.",
    "Cette version est une version modifiée du jeu : le moteur a été réécrit en TypeScript pour fonctionner dans le navigateur, d'après le moteur « queen » de ScummVM (© l'équipe de ScummVM, licence GNU GPL version 3 ou ultérieure). Les données sont celles de la version française parlante distribuée par ScummVM : elles ont été extraites du fichier queen.1c et servies fichier par fichier, et les voix ont été converties en MP3.",
    "Les données du jeu se distribuent librement et gratuitement, sans pouvoir les vendre, avec le fichier de licence et les mentions de copyright conservés intacts ; toute version modifiée doit le signaler, ce que fait cette page.",
    "Le code de cette adaptation est publié sous licence GNU GPL version 3 ou ultérieure ; il est disponible dans le dépôt public du site.",
  ],
  helpLicenceLinks: [["README-FOTAQ.txt", "Licence des données du jeu (readme d'origine)"]] as readonly (readonly [string, string])[],
  helpScummvm: "ScummVM : www.scummvm.org",
  helpSource: "Code source de cette adaptation (GPL v3 ou ultérieure) : github.com/sfavot/retrovibe",
  sourceUrl: "https://github.com/sfavot/retrovibe",
} as const;
