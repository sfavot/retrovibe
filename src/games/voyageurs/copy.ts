/**
 * Textes de l'interface des *Voyageurs du temps* qui ne viennent pas des données du jeu (les textes du jeu, ses verbes, ses messages et
 * son menu système sont ceux du jeu d'origine : `data/msg.ts`, `engine/texts.ts`). Règle du projet (`CLAUDE.md` du dépôt) : texte final, en
 * français, écrit ici directement. Les clés des fenêtres communes (`src/ui/point-click-*.ts`) portent les mêmes noms que pour BASS, Lure et
 * Flight of the Amazon Queen.
 */

/** Place d'un décor (`L12.PI1`) dans la description d'un emplacement : le jeu ne nomme pas ses lieux, on donne le numéro du décor. */
function backgroundName(background: string): string {
  const number = /^L(\d+)/i.exec(background)?.[1];
  return number ? `Décor ${Number(number)}` : "Décor";
}

export const copy = {
  title: "Les Voyageurs du temps",
  description:
    "L'aventure en pointer-et-cliquer de Delphine Software (1989), aussi sortie sous le titre Future Wars : un laveur de vitres de gratte-ciel tombe sur une machine à voyager dans le temps et se retrouve projeté du Moyen Âge jusqu'au futur. Textes en français (traduction de fans), musique de la version CD.",
  coverAlt: "Au début du jeu, le laveur de vitres sur son échafaudage, devant la façade vitrée d'un gratte-ciel et la ville.",
  sound: "Son",

  // Écran de présentation.
  newGame: "Nouvelle partie",
  continueGame: "Continuer",
  continueNote: (description: string) => `Dernière sauvegarde : ${description}`,
  loadGame: "Charger une partie",
  help: "Aide et crédits",
  controlsTitle: "Commandes",
  controls: [
    "Souris : clic gauche pour marcher et pour valider, clic droit pour ouvrir le menu des verbes (Examiner, Prendre, Inventaire, Utiliser, Actionner, Parler), puis clic gauche sur un verbe et sur l'objet visé. Le bouton du milieu (ou F10) ouvre le menu du jeu (Pause, Nouvelle partie, Quitter, Charger, Sauver). Quand un message s'affiche, cliquez pour continuer.",
    "Écran tactile : toucher = clic gauche, appui long = clic droit. Le bouton « Système » ouvre le menu du jeu, le bouton « Menu » celui du site.",
    "Clavier : F1 à F6 choisissent un verbe (Examiner, Prendre, Inventaire, Utiliser, Actionner, Parler), F9 ouvre le menu des verbes, F10 le menu du jeu, Entrée (ou 5 du pavé numérique) vaut un clic gauche, Échap un clic droit. Dans un menu, les flèches haut et bas changent la ligne choisie. Comme dans le jeu d'origine, les autres touches du pavé numérique arrêtent le héros au lieu de le faire marcher.",
    "Dix emplacements de sauvegarde, dans le navigateur de cet appareil ; la musique est celle du CD.",
    "Version modifiée du jeu : traduction française de fans, musique convertie en MP3, moteur réécrit (détails dans « Aide et crédits »).",
  ],

  // Chargement et erreurs.
  loading: "Chargement…",
  loadingFiles: (percent: number) => `Chargement des fichiers du jeu : ${percent} %`,
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Les Voyageurs du temps",
  missingFiles: "Les fichiers du jeu sont introuvables : Les Voyageurs du temps ne peut pas démarrer. Vérifiez votre connexion puis rechargez la page.",
  retryHint: "Vérifiez votre connexion puis rechargez la page.",
  invalidSave: "Cette sauvegarde ne peut pas être reprise.",

  // Barre tactile et pied de page.
  menu: "Menu",
  menuLabel: "Menu du site : sauvegarder, charger, volume, pause, aide, écran titre",
  skip: "Système",
  skipLabel: "Ouvrir le menu du jeu : Pause, Nouvelle partie, Quitter, Charger, Sauver (F10, ou le bouton du milieu de la souris)",
  pause: "Pause",
  pauseLabel: "Mettre le jeu en pause ou le reprendre",
  resume: "Reprendre",
  paused: "Jeu en pause",
  pausedHint: "Appuyez sur Reprendre pour continuer",
  titleScreen: "Écran titre",
  titleScreenTitle: "Revenir à l'écran titre",
  leaveTitle: "Revenir à l'écran titre ?",
  leaveText: "La partie en cours sera perdue si vous ne l'avez pas sauvegardée.",
  save: "Sauvegarder",
  saveTitle: "Sauvegarder la partie (aussi dans le menu du jeu)",
  load: "Charger",
  loadTitle: "Charger une partie (aussi dans le menu du jeu)",
  volume: "Volume",
  volumeTitle: "Volume de la musique",
  // Le jeu n'a pas de sous-titres à régler : ces libellés ne sont jamais montrés (le menu n'a pas l'entrée).
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
  saveOverwrite: (slot: number) => `Remplacer la sauvegarde de l'emplacement ${slot} ?`,
  volumeDialogTitle: "Volume de la musique",
  volumeLabel: "Volume de la musique",
  saveBusy: "Impossible de sauvegarder maintenant : fermez les menus et messages, puis réessayez.",

  // Emplacements de sauvegarde (mêmes mots que BASS et Lure of the Temptress).
  saveSlot: (slot: number) => `Emplacement ${slot}`,
  saveEmpty: "Emplacement vide",
  saveDescription: (place: string, date: string) => `${place} – ${date}`,
  backgroundName,
  saveDone: "Partie sauvegardée.",
  saveFailed: "La sauvegarde a échoué : le stockage du navigateur est plein ou bloqué.",
  loadDone: "Partie chargée.",
  loadEmpty: "Cet emplacement est vide.",
  loadFailed: "Cette sauvegarde ne peut pas être chargée.",

  // Page d'aide et crédits.
  helpTitle: "Aide et crédits des Voyageurs du temps",
  helpBack: "← Écran titre",
  helpHowTitle: "Comment jouer",
  helpHow: [
    "Un laveur de vitres de gratte-ciel découvre une machine à voyager dans le temps et part à travers les époques, du Moyen Âge jusqu'au futur. Le jeu se joue à la souris : l'écran montre la scène, et la ligne du haut décrit l'action en cours.",
    "Le clic gauche fait marcher le héros. Le clic droit (ou un appui long au doigt) ouvre le menu des six verbes : Examiner, Prendre, Inventaire, Utiliser, Actionner, Parler. Choisissez un verbe d'un clic gauche, puis cliquez sur l'objet, le personnage ou la partie du décor visés. Avec Utiliser, la phrase se complète par un second objet (« Utiliser clé sur porte »). Inventaire liste les objets portés : un clic sur l'un d'eux ouvre ses actions.",
    "Le bouton du milieu de la souris, F10 ou le bouton « Système » ouvrent le menu du jeu : Pause, Nouvelle partie, Quitter, Charger une partie et Sauver la partie (ces deux dernières ouvrent les emplacements du site). Le jeu n'accepte pas de sauvegarde pendant un message ou un menu, ni quand le héros ne peut plus agir.",
    "Quand un message s'affiche, cliquez pour continuer. Le jeu n'a pas de voix : la musique est celle du CD, les bruitages sont ceux de la carte AdLib.",
  ],
  helpKeysTitle: "Raccourcis clavier",
  helpKeys: [
    ["F1 à F6", "Examiner, Prendre, Inventaire, Utiliser, Actionner, Parler"],
    ["F9", "ouvrir le menu des verbes"],
    ["F10", "ouvrir le menu du jeu (Pause, Nouvelle partie, Quitter, Charger, Sauver)"],
    ["Entrée, 5 du pavé numérique", "clic gauche à la position du curseur"],
    ["Échap", "clic droit à la position du curseur"],
    ["Flèches haut et bas, molette", "changer la ligne choisie d'un menu"],
    ["Pavé numérique (sauf 5)", "arrêter le héros en marche"],
  ] as readonly (readonly [string, string])[],
  helpSavesTitle: "Sauvegardes",
  helpSaves:
    "Dix emplacements, enregistrés dans le navigateur de cet appareil. Vider les données du site efface les sauvegardes. « Continuer » (écran titre) reprend la plus récente. Dans le jeu, « Charger une partie » et « Sauver la partie » du menu du jeu ouvrent les mêmes emplacements que le bouton « Menu » du site.",
  helpAboutTitle: "À propos et licences",
  helpAbout: [
    "Les Voyageurs du temps (Future Wars: Adventures in Time) est un jeu de Delphine Software, sorti en 1989 : le premier de la série des jeux « Cinématique ». Les données utilisées ici sont celles de l'édition CD de Sony (version américaine), avec la traduction française faite par des fans.",
    "Ces données restent la propriété de leurs ayants droit : Delphine Software, l'éditeur de l'édition CD et les auteurs de la traduction. Le jeu n'est plus commercialisé, mais il s'agit d'abandonware : il n'est pas libre de droits, et aucune licence de redistribution n'a été donnée. Il est diffusé ici avec tolérance, et sera retiré sans délai à la demande d'un ayant droit.",
    "Version modifiée : la musique du CD a été convertie en MP3 ; les données sont celles du jeu, sans autre changement ; le moteur a été réécrit en TypeScript pour fonctionner dans un navigateur, d'après le moteur « cine » de ScummVM (© l'équipe de ScummVM, licence GNU GPL version 3 ou ultérieure), lu pour comprendre puis réécrit. Les bruitages AdLib sont joués par un émulateur OPL2.",
    "Le code de cette adaptation est publié sous licence GNU GPL version 3 ou ultérieure ; il est disponible dans le dépôt public du site.",
  ],
  helpLicenceLinks: [] as readonly (readonly [string, string])[],
  helpScummvm: "ScummVM : www.scummvm.org",
  helpSource: "Code source de cette adaptation (GPL v3 ou ultérieure) : github.com/sfavot/retrovibe",
  sourceUrl: "https://github.com/sfavot/retrovibe",
} as const;
