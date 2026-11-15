/**
 * Textes de l'interface de *Ween: The Prophecy* qui ne viennent pas des données du jeu (les textes du jeu sont dans `INTRO.STK`).
 * Règle du projet (`CLAUDE.md` du dépôt) : texte final, en français, écrit ici directement.
 */
export const copy = {
  title: "Ween: The Prophecy",
  description:
    "L'aventure en pointer-et-cliquer de Coktel Vision (1992) : Ween, petit-fils du sorcier Ohkram, doit réunir trois grains de sable et les déposer dans le Revuss avant la Grande Éclipse pour vaincre Kraal.",
  coverAlt: "Une scène du début de Ween: The Prophecy, en pixel art.",
  loading: "Chargement du jeu…",
  missingFiles: "Les fichiers du jeu sont introuvables : Ween ne peut pas démarrer. Vérifiez votre connexion puis rechargez la page.",
  loadError: "Impossible de lire les données du jeu :",
  runtimeError: "Le jeu s'est arrêté sur une erreur :",
  canvasLabel: "Écran du jeu Ween: The Prophecy",
  ended: "La partie est terminée.",
  replay: "Rejouer",
  play: "Jouer",
  sound: "Son",
  help: "Aide et crédits",

  // Barre tactile sous l'écran (écrans tactiles seulement).
  menu: "Menu",
  menuLabel: "Menu : afficher la barre du haut (disquette : sauver, charger, quitter)",
  skip: "Passer",
  skipLabel: "Passer l'introduction ou la vidéo en cours (Échap)",
  keyboard: "Clavier",
  confirm: "Valider",

  loadHint:
    "Pour reprendre une partie sauvegardée : en jeu, cliquez sur la disquette de la barre du haut (sur écran tactile : bouton Menu), puis choisissez CHARGER.",
  controlsTitle: "Commandes",
  controls: [
    "Survol : le curseur change sur ce qui réagit au clic",
    "Clic gauche : examiner, prendre ou utiliser",
    "Échap : passer l'introduction ou une vidéo",
    "Disquette de la barre du haut : sauver, charger ou quitter",
    "Écran tactile : toucher vaut un clic gauche, un appui long un clic droit ; Passer remplace Échap, Menu affiche la barre du haut, Clavier et Valider servent à écrire",
  ],

  // Page d'aide et crédits.
  helpTitle: "Aide et crédits de Ween: The Prophecy",
  helpBack: "← Écran titre",
  helpHowTitle: "Comment jouer",
  helpHow: [
    "Ween, petit-fils du sorcier Ohkram, a trois jours pour retrouver trois grains de sable et les déposer dans le Revuss avant la Grande Éclipse : c'est la seule façon de vaincre Kraal. Le jeu se joue à la souris : un clic gauche examine, prend ou utilise ce qui est sous le curseur ; les objets ramassés vont dans l'inventaire, en bas de l'écran, d'où on les prend pour s'en servir dans la scène.",
    "La barre du haut de l'écran donne accès à la disquette (sauver, charger, quitter) et au bloc-notes, où l'on peut écrire ses propres notes au clavier. Les notes sont conservées d'une partie à l'autre.",
    "L'introduction se passe avec Échap, ou le bouton « Passer » sur écran tactile.",
    "Sur écran tactile, toucher vaut un clic gauche et un appui long un clic droit. Le bouton « Menu » place le curseur en haut de l'écran pour afficher la barre ; pendant la saisie d'un nom de sauvegarde ou d'une note, « Clavier » ouvre le clavier de l'appareil et « Valider » vaut la touche Entrée.",
  ],
  helpKeysTitle: "Clavier",
  helpKeys: [
    ["Échap", "passer l'introduction ou une vidéo ; annuler"],
    ["Entrée", "valider un nom de sauvegarde ou une note"],
    ["Lettres et chiffres", "écrire un nom de sauvegarde ou une note du bloc-notes"],
  ] as readonly (readonly [string, string])[],
  helpSavesTitle: "Sauvegardes",
  helpSaves:
    "Le menu de la disquette propose quinze emplacements nommés, enregistrés dans le navigateur de cet appareil, comme le bloc-notes. Vider les données du site les efface. Pour reprendre une partie, lancez le jeu, cliquez sur la disquette puis sur CHARGER.",
  helpAboutTitle: "À propos",
  helpAbout: [
    "Ween: The Prophecy est un jeu de Coktel Vision et MDO (1992). Cette adaptation joue la version DOS française d'origine sur disquettes (VGA, AdLib).",
    "Le jeu n'est plus vendu et a été abandonné par ses éditeurs ; ses données restent la propriété de leurs ayants droit. Elles seront retirées sur simple demande d'un ayant droit.",
    "Version modifiée : le moteur a été réécrit en TypeScript d'après le moteur « gob » de ScummVM (© l'équipe de ScummVM, licence GNU GPL version 3 ou ultérieure), lu pour comprendre puis réécrit, pour fonctionner dans un navigateur ; la protection de copie (grille de couleurs) a été retirée. La musique AdLib est jouée par un émulateur OPL2.",
    "Le code de cette adaptation est publié sous licence GNU GPL version 3 ou ultérieure ; il est disponible dans le dépôt public du site.",
  ],
  helpScummvm: "ScummVM : www.scummvm.org",
  helpSource: "Code source de cette adaptation (GPL v3 ou ultérieure) : github.com/sfavot/retrovibe",
  sourceUrl: "https://github.com/sfavot/retrovibe",
};
