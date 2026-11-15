/**
 * Textes de l'interface de *Beneath a Steel Sky* qui ne viennent pas des données du jeu (les textes du panneau de contrôle d'origine sont
 * dans la section 7 de `sky.dsk`). Règle du projet (`CLAUDE.md` du dépôt) : texte final, en français, écrit ici directement.
 *
 * Vague S : questions du panneau et messages des sauvegardes. Vague J : le reste (écran titre, aide, chargement, fenêtres communes de
 * `src/ui/point-click-*.ts`, dont les clés portent les mêmes noms que celles de Lure of the Temptress et de Flight of the Amazon Queen).
 */

import type { SaveRefusal } from "./engine/save";

export const copy = {
  title: "Beneath a Steel Sky",
  description:
    "L'aventure de science-fiction en pointer-et-cliquer de Revolution Software (1994) : Robert Foster, un étranger innocent, se retrouve prisonnier d'Union City, où les opprimés travaillent dans des tours tandis que les riches vivent à l'abri sous terre. Seul avec Joey, une carte électronique de robot, il doit survivre et découvrir la vérité sur son passé. Textes en français, voix en anglais.",
  coverAlt: "Jaquette de Beneath a Steel Sky : le logo du jeu, une cité-tour stylisée, sur fond noir.",
  sound: "Son",

  // Écran de présentation.
  newGame: "Nouvelle partie",
  continueGame: "Continuer",
  continueNote: (description: string) => `Dernière sauvegarde : ${description}`,
  loadGame: "Charger une partie",
  help: "Aide et crédits",
  controlsTitle: "Commandes",
  controls: [
    "Souris : clic gauche pour marcher, regarder ou parler, clic droit pour utiliser un objet ou le prendre en main depuis l'inventaire. L'inventaire s'ouvre quand le curseur touche le haut de l'écran.",
    "Écran tactile : toucher = clic gauche, appui long = clic droit. Le bouton « Inventaire » ouvre l'inventaire (toucher le haut de l'écran aussi, sauf sur une sortie ou un objet), qui reste ouvert jusqu'au toucher suivant ailleurs. Le bouton « Passer » saute l'introduction ou la réplique en cours.",
    "Clavier : F5 ouvre le panneau de contrôle du jeu (volume, vitesse, texte et voix, sauvegarde, recommencer), Échap saute l'introduction ou ferme le panneau, le point saute la réplique en cours, P met le jeu en pause. F1 ouvre le menu du site, F10 règle le volume de la musique.",
    "Les répliques sont parlées en anglais et sous-titrées en français ; le panneau de contrôle propose aussi texte seul ou voix seule.",
    "Version modifiée du jeu : voix converties en MP3, données reconstruites sans les voix, moteur réécrit (détails dans « Aide et crédits »).",
  ],

  // Chargement et erreurs.
  loading: "Chargement…",
  loadingFiles: (percent: number) => `Chargement des fichiers du jeu : ${percent} %`,
  loadError: "Impossible de charger le jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Beneath a Steel Sky",
  missingFiles: "Les fichiers du jeu sont introuvables : Beneath a Steel Sky ne peut pas démarrer. Vérifiez votre connexion puis rechargez la page.",
  retryHint: "Vérifiez votre connexion puis rechargez la page.",
  invalidSave: "Cette sauvegarde ne peut pas être reprise.",

  // Barre tactile et pied de page.
  menu: "Menu",
  menuLabel: "Menu du site : sauvegarder, charger, volume, pause, aide, écran titre",
  skipLabel: "Passer l'introduction ou la réplique en cours (Échap ou point)",
  inventoryLabel: "Ouvrir la barre d'inventaire (comme un toucher en haut de l'écran)",
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
  saveTitle: "Sauvegarder la partie (aussi dans le panneau F5)",
  load: "Charger",
  loadTitle: "Restituer une partie (aussi dans le panneau F5)",
  volume: "Volume",
  volumeTitle: "Volume de la musique (F10)",
  // Le texte et la voix se règlent dans le panneau du jeu : ces libellés ne sont jamais montrés (le menu n'a pas l'entrée).
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
  saveBusy: "Impossible de sauvegarder maintenant : réessayez quand vous reprenez la main.",

  // Partie perdue (`fnRestoreGame`) : fenêtre à deux réponses, quand une sauvegarde existe.
  endTitle: "Fin de partie",
  endText: "La partie est perdue. Recommencer depuis le début, ou restituer une partie sauvegardée ?",
  endRestart: "Recommencer",
  endRestore: "Restituer une partie",

  // Questions du panneau de contrôle (ScummVM les écrit en anglais dans son code : « Restart? », « Quit to DOS? »). Police du jeu : ASCII seul.
  restartQuestion: "Recommencer ?",
  quitQuestion: "Quitter la partie ?",

  // Emplacements de sauvegarde (mêmes mots que Lure of the Temptress).
  saveSlot: (slot: number) => `Emplacement ${slot}`,
  saveEmpty: "Emplacement vide",
  saveDescription: (place: string, date: string) => `${place} – ${date}`,
  /** Le jeu ne nomme pas ses lieux : la section de l'histoire (variable `CUR_SECTION`, de 0 à 7). */
  sectionName: (section: number) => `Section ${section + 1}`,
  saveDone: "Partie sauvegardée.",
  saveFailed: "La sauvegarde a échoué : le stockage du navigateur est plein ou bloqué.",
  loadDone: "Partie chargée.",
  loadEmpty: "Cet emplacement est vide.",
  loadFailed: "Cette sauvegarde ne peut pas être chargée.",
  /** Refus de sauvegarder (`loadSaveAllowed` de ScummVM, qui se tait) : une phrase par cause. */
  saveRefused: {
    choosing: "Impossible de sauvegarder pendant un choix de réponse : choisissez d'abord, puis réessayez.",
    linc: "Impossible de sauvegarder dans un terminal LINC : quittez-le d'abord.",
    finalRooms: "Impossible de sauvegarder dans les dernières pièces du jeu.",
    busy: "Impossible de sauvegarder à cet instant : réessayez dans un moment.",
  } satisfies Record<SaveRefusal, string>,

  // Page d'aide et crédits.
  helpTitle: "Aide et crédits de Beneath a Steel Sky",
  helpBack: "← Écran titre",
  helpHowTitle: "Comment jouer",
  helpHow: [
    "Robert Foster, un étranger innocent, a été enlevé dans l'Outback et se retrouve prisonnier d'Union City. Seul avec Joey, une carte électronique de robot qu'il a lui-même construite, il doit s'échapper, survivre et comprendre ce qu'on lui veut. Le jeu se joue à la souris : l'écran montre la scène et le texte d'un objet apparaît quand le curseur le survole.",
    "Le clic gauche fait marcher Foster, regarder un objet ou parler à un personnage. Le clic droit utilise l'objet ou l'action habituelle. L'inventaire s'ouvre quand le curseur touche le haut de l'écran : un clic gauche sur une icône la regarde, un clic droit la prend en main, puis un clic droit sur un objet ou un personnage de la scène l'utilise. Au doigt, toucher le haut de l'écran ouvre l'inventaire, qui reste ouvert jusqu'au toucher suivant ailleurs ; un appui long vaut un clic droit.",
    "Les répliques sont parlées en anglais et sous-titrées en français. Une partie des répliques n'a pas de voix dans le jeu d'origine : leur texte s'affiche alors même en mode « voix seule ». Un clic ou la touche point passe la réplique en cours.",
    "Le panneau de contrôle du jeu (touche F5, ou bouton « Menu » puis ses entrées) règle le volume de la musique, la vitesse du jeu, les effets sonores et le mode texte et voix, et permet de sauvegarder, restituer, recommencer ou quitter. Ces réglages sont mémorisés dans le navigateur.",
    "L'introduction dure environ cinq minutes ; Échap, un clic ou le bouton « Passer » la saute.",
  ],
  helpKeysTitle: "Raccourcis clavier",
  helpKeys: [
    ["F5", "ouvrir ou fermer le panneau de contrôle du jeu"],
    ["Échap", "sauter l'introduction ; fermer le panneau de contrôle"],
    [".", "passer la réplique en cours"],
    ["P", "mettre le jeu en pause ; une touche quelconque le reprend"],
    ["F1", "ouvrir le menu du site (sauvegarder, charger, volume, pause, aide)"],
    ["F10", "volume de la musique"],
  ] as readonly (readonly [string, string])[],
  helpSavesTitle: "Sauvegardes",
  helpSaves:
    "Dix emplacements, enregistrés dans le navigateur de cet appareil (sauvegarder est possible quand on a la main, pas pendant un choix de réponse, dans un terminal LINC ni dans les dernières pièces du jeu). Vider les données du site efface les sauvegardes. « Continuer » reprend la plus récente. Dans le jeu, « Sauvegarder » et « Restituer » du panneau de contrôle (F5) ouvrent les mêmes emplacements ; quand Foster est perdu, le jeu propose de recommencer ou de restituer une partie.",
  helpAboutTitle: "À propos et licences",
  helpAbout: [
    "Beneath a Steel Sky est un jeu de Revolution Software (1994). Tout le contenu du jeu (images, musique, textes, voix) est © Revolution Software Ltd, qui l'a rendu libre de diffusion gratuite en 2003 avec l'aide de ScummVM. Les données sont celles de la version CD 1.2 (v0.0372) préparée alors par ScummVM.",
    "Version modifiée (article 4 de la licence de Revolution Software) : cette adaptation n'est pas le jeu d'origine. Les voix (anglaises) ont été converties en MP3, les données du jeu (sky.dsk et son index sky.dnr) ont été reconstruites sans les voix, avec le même contenu pour le reste, et le moteur a été réécrit en TypeScript pour fonctionner dans un navigateur.",
    "Le moteur est une réécriture du moteur « sky » de ScummVM (© l'équipe de ScummVM, licence GNU GPL version 3 ou ultérieure), lu pour comprendre puis réécrit ; la musique AdLib est jouée par un émulateur OPL2. Le fichier README-BASS.txt de Revolution Software, avec ses conditions de diffusion, est conservé intact avec les données.",
    "Les données du jeu se distribuent librement et gratuitement, sans pouvoir les vendre, avec le fichier de licence et les mentions de copyright conservés intacts ; toute version modifiée doit le signaler, ce que fait cette page.",
    "Le code de cette adaptation est publié sous licence GNU GPL version 3 ou ultérieure ; il est disponible dans le dépôt public du site.",
  ],
  helpLicenceLinks: [["README-BASS.txt", "Licence des données du jeu (README de Revolution Software, en anglais)"]] as readonly (readonly [string, string])[],
  helpScummvm: "ScummVM : www.scummvm.org",
  helpSource: "Code source de cette adaptation (GPL v3 ou ultérieure) : github.com/sfavot/retrovibe",
  sourceUrl: "https://github.com/sfavot/retrovibe",
} as const;
