/**
 * Textes de l'interface de *Lure of the Temptress* (hors textes du jeu, qui viennent de `LURE-FR.DAT` et des disques : noms de lieux,
 * dialogues, barre de menus et menus surgissants dessinés par le moteur). Règle du projet (`CLAUDE.md` du dépôt) : texte final, en
 * français, écrit ici directement. Les clés communes aux jeux de pointer-et-cliquer (`DialogCopy`, `TitleCopy` de `src/ui/`) portent
 * les mêmes noms que celles de Drascula et de Flight of the Amazon Queen.
 */
export const copy = {
  title: "Lure of the Temptress",
  description:
    "L'aventure en pointer-et-cliquer de Revolution Software (1992), en français : Diermot, un héros malgré lui, réchappe du massacre des cavaliers du Roi par les Skorls, des monstres mercenaires, près de Turnvale, où l'apprentie sorcière Séléna a fomenté une révolte.",
  coverAlt: "Une rue du village de Turnvale, devant une maison à colombages, avec des villageois.",
  sound: "Son",

  // Écran de présentation.
  newGame: "Nouvelle partie",
  continueGame: "Continuer",
  continueNote: (description: string) => `Dernière sauvegarde : ${description}`,
  loadGame: "Charger une partie",
  help: "Aide et crédits",
  controlsTitle: "Commandes",
  controls: [
    "Souris : clic gauche pour marcher ou franchir une sortie, clic droit sur un objet ou un personnage pour ouvrir la liste de ses actions, puis clic gauche sur l'une d'elles. La barre de menus du jeu s'ouvre quand le curseur touche le haut de l'écran.",
    "Écran tactile : toucher = clic gauche, appui long = clic droit. Le bouton « Passer » saute l'introduction et les scènes.",
    "Clavier (touches de ScummVM) : F5 sauvegarde, F7 restitue, F9 recommence, Échap saute l'introduction ou demande à quitter, O et N répondent aux questions, flèches haut et bas puis Entrée choisissent dans un menu. F1 ouvre le menu du site, F10 règle le volume. Combats : flèches gauche et droite, pavé numérique 7, 4, 1, 9, 6, 3.",
    "Espace met le jeu en pause, et le reprend.",
  ],

  // Chargement et erreurs.
  loading: "Chargement…",
  loadingFiles: (percent: number) => `Chargement des fichiers du jeu : ${percent} %`,
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Lure of the Temptress",
  missingFiles: "Les fichiers du jeu sont introuvables : Lure of the Temptress ne peut pas démarrer. Vérifiez votre connexion puis rechargez la page.",
  retryHint: "Vérifiez votre connexion puis rechargez la page.",
  invalidSave: "Cette sauvegarde ne peut pas être reprise.",

  // Barre tactile et pied de page.
  menu: "Menu",
  menuLabel: "Menu du site : sauvegarder, charger, volume, pause, aide, écran titre",
  skip: "Passer",
  skipLabel: "Passer l'introduction ou la scène (Échap)",
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
  saveTitle: "Sauvegarder la partie (F5)",
  load: "Charger",
  loadTitle: "Restituer une partie (F7)",
  volume: "Volume",
  volumeTitle: "Volume du son (F10)",
  // Le jeu n'a pas de sous-titres réglables (les répliques sont toujours écrites) : ces libellés ne sont jamais montrés.
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
  volumeDialogTitle: "Volume du son",
  volumeLabel: "Volume de la musique et des bruitages",

  // Fin de partie (le joueur est mort ou pris) : fenêtre à deux réponses, quand une sauvegarde existe.
  endTitle: "Fin de partie",
  endText: "La partie est perdue. Recommencer depuis le début, ou restituer une partie sauvegardée ?",
  endRestart: "Recommencer",
  endRestore: "Restituer une partie",

  // Sauvegardes : emplacements et messages (`ui/saves.ts`).
  saveSlot: (slot: number) => `Emplacement ${slot}`,
  saveEmpty: "Emplacement vide",
  saveDescription: (place: string, date: string) => `${place} – ${date}`,
  saveDone: "Partie sauvegardée.",
  saveBusy: "Impossible de sauvegarder maintenant : réessayez quand vous reprenez la main.",
  saveFailed: "La sauvegarde a échoué : le stockage du navigateur est plein ou bloqué.",
  loadDone: "Partie chargée.",
  loadEmpty: "Cet emplacement est vide.",
  loadFailed: "Cette sauvegarde ne peut pas être chargée.",
  saveOverwrite: (slot: number) => `Remplacer la sauvegarde de l'emplacement ${slot} ?`,
  /**
   * Lieux sans titre dans leur description (le jeu écrit en capitales le titre des autres : `LA CELLULE.`) : les ruelles du village et
   * les cavernes.
   */
  roomNames: {
    5: "La caverne",
    6: "La caverne",
    8: "Une ruelle",
    11: "Une ruelle",
    21: "Une ruelle",
    22: "Une ruelle",
    23: "Une ruelle",
    24: "Une ruelle",
    25: "Une ruelle",
    27: "Une ruelle",
    38: "La caverne",
    39: "La caverne",
    40: "La caverne",
    41: "La caverne",
  } as Readonly<Record<number, string>>,
  unknownPlace: (room: number) => `Pièce ${room}`,

  // Page d'aide et crédits.
  helpTitle: "Aide et crédits de Lure of the Temptress",
  helpBack: "← Écran titre",
  helpHowTitle: "Comment jouer",
  helpHow: [
    "Diermot, un héros malgré lui, a réchappé du massacre des cavaliers du Roi par les Skorls, des monstres mercenaires alliés à la révolte de l'apprentie sorcière Séléna, près de Turnvale. Il se réveille enfermé dans une cellule : à lui de s'évader et de comprendre ce qui se trame. Le jeu se joue entièrement à la souris : l'écran montre la pièce, la ligne d'état en bas décrit ce que le curseur survole.",
    "Un clic gauche fait marcher Diermot vers l'endroit visé ou lui fait franchir une sortie. Un clic droit sur un objet ou un personnage ouvre la liste des actions possibles (regarder, prendre, ouvrir, parler, donner…) : un clic gauche sur l'une d'elles la lance. Les objets de l'inventaire se choisissent de la même façon.",
    "La barre de menus du jeu apparaît quand le curseur touche le haut de l'écran (au doigt, en touchant le haut de l'écran) : sauvegarder, restituer, recommencer, quitter, vitesse du texte, son et crédits. Une question « Vous êtes sûr (o/n) ? » se règle d'un clic gauche (oui) ou d'un clic droit (non), ou avec les touches O et N.",
    "Pendant un combat, la position du curseur par rapport à Diermot choisit le coup ; le clic gauche frappe fort, le clic droit plus légèrement. Au clavier : flèches gauche et droite pour avancer ou reculer, et le pavé numérique pour les coups (7, 4, 1 : haut, milieu, bas, curseur à gauche ; 9, 6, 3 : haut, milieu, bas, curseur à droite).",
    "L'introduction dure environ quatre minutes ; Échap (ou le bouton « Passer » au doigt) la saute. Le manuel d'origine, en français, détaille les actions, les lieux et les personnages.",
  ],
  helpKeysTitle: "Raccourcis clavier",
  helpKeys: [
    ["Échap", "sauter l'introduction ou une scène ; sinon, demander à quitter le jeu"],
    ["O, N", "répondre oui ou non à une question du jeu (Y n'est pas utilisée)"],
    ["Flèches haut et bas (ou pavé 8 et 2), Entrée (ou pavé 3)", "choisir dans un menu, une liste d'actions ou une réponse de dialogue"],
    ["Molette", "parcourir une liste d'actions"],
    ["Flèches gauche et droite", "combats : avancer ou reculer"],
    ["Pavé numérique 7, 4, 1, 9, 6, 3", "combats : les six coups (le 3 valide aussi dans un menu)"],
    ["F5", "sauvegarder la partie"],
    ["F7", "restituer (charger) une partie"],
    ["F9", "recommencer la partie (le jeu demande confirmation)"],
    ["F1", "ouvrir le menu du site (sauvegarder, charger, volume, pause, aide)"],
    ["F10", "volume du son (F9 est « recommencer » dans le jeu)"],
    ["Espace", "pause ou reprise, à tout moment"],
  ] as readonly (readonly [string, string])[],
  helpSavesTitle: "Sauvegardes",
  helpSaves:
    "Dix emplacements, enregistrés dans le navigateur de cet appareil (sauvegarder est possible quand on a la main, pas pendant une scène, un dialogue ou un combat). Vider les données du site efface les sauvegardes. « Continuer » reprend la plus récente. Dans le jeu, « Sauvegarder » et « Restituer » de la barre de menus (ou F5 et F7) ouvrent les mêmes emplacements ; quand Diermot est perdu, le jeu propose de recommencer ou de restituer une partie ; le bouton « Menu » (F1) réunit la sauvegarde, le chargement, le volume, la pause et le retour à l'écran titre.",
  helpAboutTitle: "À propos et licences",
  helpAbout: [
    "Lure of the Temptress est un jeu de Revolution Software (1992). Tout le contenu du jeu (images, musique, textes) est © Revolution Software Ltd, qui permet de le distribuer gratuitement.",
    "Cette version est une version modifiée du jeu : le moteur a été réécrit en TypeScript pour fonctionner dans le navigateur, d'après le moteur « lure » de ScummVM (© l'équipe de ScummVM, licence GNU GPL version 3 ou ultérieure). Les données sont celles de la version française sur disquettes (VGA) préparée par ScummVM ; la musique AdLib est jouée par un émulateur OPL2.",
    "Les tables du jeu (LURE-FR.DAT) sont le bloc français du fichier lure.dat, distribué par ScummVM (version 1.32) et généré par son outil create_lure à partir de l'exécutable du jeu (LURE.EXE). Ces données sont celles du jeu : elles relèvent de la licence de Revolution Software ci-dessus.",
    "Les données du jeu se distribuent librement et gratuitement, sans pouvoir les vendre, avec le fichier de licence et les mentions de copyright conservés intacts ; toute version modifiée doit le signaler, ce que fait cette page.",
    "Le code de cette adaptation est publié sous licence GNU GPL version 3 ou ultérieure ; il est disponible dans le dépôt public du site.",
  ],
  helpLicenceLinks: [
    ["LICENSE-LURE.txt", "Licence des données du jeu (Revolution Software)"],
    ["MANUEL.pdf", "Manuel du jeu, en français (PDF, 42 pages)"],
  ] as readonly (readonly [string, string])[],
  helpScummvm: "ScummVM : www.scummvm.org",
  helpSource: "Code source de cette adaptation (GPL v3 ou ultérieure) : github.com/sfavot/retrovibe",
  sourceUrl: "https://github.com/sfavot/retrovibe",
} as const;
