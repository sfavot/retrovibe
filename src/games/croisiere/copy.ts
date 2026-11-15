/**
 * Textes de l'interface de *Croisière pour un cadavre* (hors textes du jeu, qui viennent des volumes et de `DELPHINE.LNG` : menus de
 * verbes, inventaire, « Parler de », menu joueur, dialogues, tous dessinés par le moteur). Règle du projet (`CLAUDE.md` du dépôt) :
 * texte final, en français, écrit ici directement. Les clés communes aux jeux de pointer-et-cliquer (`DialogCopy`, `TitleCopy` de
 * `src/ui/`) portent les mêmes noms que celles de Lure et de Beneath a Steel Sky.
 */
export const copy = {
  title: "Croisière pour un cadavre",
  description:
    "L'aventure en pointer-et-cliquer de Delphine Software (1991), en français : en 1927, l'inspecteur Raoul Dusentier enquête sur le meurtre de Niklos Karaboudjan à bord de son yacht, parmi les passagers et l'équipage.",
  coverAlt: "L'écran titre du jeu : « Croisière pour un cadavre » en lettres peintes, sur la silhouette d'un corps étendu, dessinée d'un trait bleu.",
  sound: "Son",

  // Écran de présentation.
  newGame: "Nouvelle partie",
  continueGame: "Continuer",
  continueNote: (description: string) => `Dernière sauvegarde : ${description}`,
  loadGame: "Charger une partie",
  help: "Aide et crédits",
  controlsTitle: "Commandes",
  controls: [
    "Souris : clic gauche pour marcher, ou sur un objet ou un personnage pour ouvrir la liste de ses actions, puis clic gauche sur l'une d'elles. Clic droit : l'inventaire.",
    "Écran tactile : toucher = clic gauche, appui long = clic droit (inventaire). Le bouton « Menu du jeu » ouvre le menu du jeu, « Passer » fait avancer l'introduction ou une scène, ou disparaître le texte affiché.",
    "Clavier : F10 ouvre le menu du jeu (sauvegarder, charger, recommencer, quitter), Espace fait disparaître le texte affiché. F1 ouvre le menu du site.",
    "P met le jeu en pause, et le reprend.",
  ],

  // Chargement et erreurs.
  loading: "Chargement…",
  loadingFiles: (percent: number) => `Chargement des fichiers du jeu : ${percent} %`,
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Croisière pour un cadavre",
  missingFiles: "Les fichiers du jeu sont introuvables : Croisière pour un cadavre ne peut pas démarrer. Vérifiez votre connexion puis rechargez la page.",
  retryHint: "Vérifiez votre connexion puis rechargez la page.",
  invalidSave: "Cette sauvegarde ne peut pas être reprise.",

  // Barre tactile et pied de page. Le bouton « Inventaire » de la page commune sert ici au menu du jeu (l'inventaire est à l'appui long).
  menu: "Menu",
  menuLabel: "Menu du site : sauvegarder, charger, volume, pause, aide, écran titre",
  inventory: "Menu du jeu",
  inventoryLabel: "Menu du jeu : sauvegarder, charger, recommencer, quitter (F10)",
  skip: "Passer",
  skipLabel: "Faire avancer l'introduction ou la scène, ou disparaître le texte affiché",
  pause: "Pause",
  pauseLabel: "Mettre le jeu en pause ou le reprendre (P)",
  resume: "Reprendre",
  paused: "Jeu en pause",
  pausedHint: "P pour reprendre",
  titleScreen: "Écran titre",
  titleScreenTitle: "Revenir à l'écran titre",
  leaveTitle: "Revenir à l'écran titre ?",
  leaveText: "La partie en cours sera perdue si vous ne l'avez pas sauvegardée.",
  save: "Sauvegarder",
  saveTitle: "Sauvegarder la partie",
  load: "Charger",
  loadTitle: "Charger une partie",
  volume: "Volume",
  volumeTitle: "Volume du son",
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

  // Page d'aide et crédits.
  helpTitle: "Aide et crédits de Croisière pour un cadavre",
  helpBack: "← Écran titre",
  helpHowTitle: "Comment jouer",
  helpHow: [
    "Paris, 1927 : l'inspecteur Raoul Dusentier est invité à bord du yacht de Niklos Karaboudjan, qui est assassiné peu après. Il faut trouver le coupable parmi les passagers et l'équipage. Le temps de l'enquête n'avance pas à la montre : il avance quand Raoul découvre un indice ou franchit une étape.",
    "Un clic gauche sur le décor fait marcher Raoul. Un clic gauche sur un objet ou un personnage ouvre la liste des actions possibles : un clic gauche sur l'une d'elles la lance. Certaines actions demandent un second objet : le jeu l'indique en haut ou en bas de l'écran, et l'on clique alors sur l'objet voulu.",
    "Un clic droit ouvre l'inventaire, avec les mêmes listes d'actions sur les objets que Raoul porte, et « Parler de » pour interroger un personnage sur un sujet. Au doigt, l'appui long fait le clic droit.",
    "Le menu du jeu (« Menu Joueur » : F10, les deux boutons de la souris ensemble, ou le bouton « Menu du jeu » au doigt) permet de sauvegarder, charger, recommencer ou quitter. Il n'est pas disponible pendant l'introduction.",
    "Pendant l'introduction, un clic (ou le bouton « Passer » au doigt) la fait avancer. Quand un texte reste affiché, un clic gauche, Espace ou « Passer » le fait disparaître.",
  ],
  helpKeysTitle: "Raccourcis clavier",
  helpKeys: [
    ["Clic gauche", "marcher, ouvrir la liste des actions d'un objet ou d'un personnage, choisir une action"],
    ["Clic droit (appui long au doigt)", "ouvrir l'inventaire"],
    ["F10 (ou les deux boutons ensemble)", "ouvrir le menu du jeu : sauvegarder, charger, recommencer, quitter"],
    ["Espace", "faire disparaître le texte affiché"],
    ["+ et −", "accélérer ou ralentir le jeu"],
    ["P", "pause ou reprise, à tout moment"],
    ["F1", "ouvrir le menu du site (sauvegarder, charger, volume, pause, aide)"],
  ] as readonly (readonly [string, string])[],
  helpSavesTitle: "Sauvegardes",
  helpSaves:
    "Dix emplacements, enregistrés dans le navigateur de cet appareil (sauvegarder est possible quand on a la main, pas pendant l'introduction ni une scène). Vider les données du site efface les sauvegardes. « Continuer » reprend la plus récente. Dans le jeu, « Sauvegarde » et « Chargement » du menu du jeu ouvrent les mêmes emplacements ; « Quitter » ramène à l'écran titre. Le bouton « Menu » (F1) réunit la sauvegarde, le chargement, le volume, la pause et le retour à l'écran titre.",
  helpAboutTitle: "À propos et licences",
  helpAbout: [
    "Croisière pour un cadavre est un jeu de Delphine Software International (1991), écrit et réalisé par Paul Cuisset. Les fichiers du jeu (images, musique, textes) restent la propriété de leurs ayants droit : le jeu est un abandonware, aucune licence n'en autorise la redistribution, et ces fichiers seront retirés sur simple demande.",
    "Cette version est une version modifiée du jeu : le moteur a été réécrit en TypeScript pour fonctionner dans le navigateur, d'après le moteur « cruise » de ScummVM (© l'équipe de ScummVM, licence GNU GPL version 3 ou ultérieure). Les données sont celles de la version française sur disquettes (DOS, VGA 256 couleurs) ; la musique AdLib est jouée par un émulateur OPL2.",
    "La protection de copie (la roue de codes demandée au démarrage) a été retirée : le jeu se lance directement.",
    "Le code de cette adaptation est publié sous licence GNU GPL version 3 ou ultérieure ; il est disponible dans le dépôt public du site.",
  ],
  helpScummvm: "ScummVM : www.scummvm.org",
  helpSource: "Code source de cette adaptation (GPL v3 ou ultérieure) : github.com/sfavot/retrovibe",
  sourceUrl: "https://github.com/sfavot/retrovibe",
} as const;
