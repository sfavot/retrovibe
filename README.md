# retrovibe

Le but : vibecoder à l'arrache, dans le navigateur, des jeux des années 90 que j'ai aimés dans mon enfance.

Chaque jeu est une réimplémentation de son moteur en TypeScript, qui lit les fichiers du jeu original.
Ces fichiers sont versionnés dans `original/<jeu>/` et servis tels quels, ce qui permet de tout déployer sur GitHub Pages.

| Jeu | État |
| --- | --- |
| Indiana Jones and his Desktop Adventures | jouable |
| Lost in Time (Coktel Vision, 1993) | jouable (en cours de validation) |
| Le Téléportaschtroumpf (Infogrames Multimedia, 1995) | jouable (en cours de validation) |
| Math Workshop / Mathémagique (Broderbund, 1994) | jouable (en cours de validation) |
| Armaeth (Grandslam Video, 1994) | jouable (en cours de validation) |

## Déploiement

Chaque push sur `main` lance [le workflow GitHub Actions](.github/workflows/deploy.yml) (tests, build, publication sur Pages).
Prérequis : dans les réglages du dépôt, Pages > Source = « GitHub Actions ». Les chemins sont relatifs (`base: "./"`)
et le routage se fait par hash, donc le site marche sous n'importe quel sous-dossier.

## Lancer en local

1. `npm install`
2. `npm run dev` puis ouvrir http://localhost:5173

`original/indy/` contient `DESKTOP.DAW`, `DESKADV.EXE` (pour la palette), `DESKADV.HLP` (le manuel d'origine, affiché depuis l'écran titre), `COVER.png` (l'image de l'écran titre, générée à partir des données du jeu avec `npx vite-node scripts/indy-cover.mts`) et, pour le son, les `.WAV` / `.MID`.

En développement, `?seed=1234` démarre directement une partie avec cette graine et `__indy.game` est exposé dans la console.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement |
| `npm run build` | vérification des types + build de production (`dist/`) |
| `npm run typecheck` | vérification des types |
| `npm test` | tests (ceux qui lisent les données sont ignorés si `original/` est vide) |

Les tests d'Indy sont dans `test/indy/`. Le test de robustesse (`test/indy/fuzz.test.ts`) parcourt les 366 zones ; il est long et ne tourne qu'avec `FUZZ=1 npm test`.
Les variables `FUZZ_FROM` / `FUZZ_TO` permettent de n'en traiter qu'une plage.

`PLAY=1 npm test` lance un robot qui joue des parties générées en suivant la solution du solveur et
affiche jusqu'où il va. Il ne sait pas résoudre les énigmes internes des zones (blocs à tirer, PNJ
à aborder…) : il s'aide alors en se plaçant à côté de la cible, et le rapport liste ces aides.

## Indy Desktop Adventures

Réimplémentation du moteur d'*Indiana Jones and his Desktop Adventures* (LucasArts, 1996). Le code ne contient aucune donnée du jeu : il lit les fichiers de `original/indy/` au démarrage.

### Architecture

- `src/games/indy/data/` — lecture de `DESKTOP.DAW` (tuiles, zones, scripts, puzzles, personnages) et, dans l'exécutable, de la palette et des ressources (curseurs, son intégré).
- `src/games/indy/engine/` — moteur : état des zones, scripts (`script.ts`), monstres, héros, combats, sauvegarde (`game.ts`).
- `src/games/indy/engine/generation/` — génération du monde : disposition de la carte (algorithme d'origine, porté depuis WebFun),
  affectation des zones et de la chaîne de puzzles, et un solveur qui rejette toute partie impossible à terminer.
- `src/games/indy/render/` — composition de la vue 9×9 en image indexée, convertie avec la palette animée.
- `src/games/indy/audio/` — effets WAV d'origine (Web Audio) et petit synthétiseur pour les musiques MIDI.
- `src/games/` — un dossier par jeu (`src/games/<id>/`, point d'entrée `index.ts` exportant une `GameDefinition`),
  référencé dans `registry.ts`. Les routes sont `#/` (accueil) et `#/<id>` (jeu). Indy est dans `src/games/indy/`.
- `src/games/indy/ui/` — interface d'Indy (écran titre, vue de jeu, bulles, inventaire, carte). Ses textes sont dans `copy.ts`.
- `src/ui/` — éléments communs : page d'accueil, helper DOM, styles, textes de l'accueil.

## Lost in Time

Réimplémentation du moteur de *Lost in Time* (Coktel Vision, 1993), d'après le moteur `gob` de ScummVM : une machine virtuelle qui exécute les scripts `.TOT` du jeu. Comme pour Indy, le code ne contient aucune donnée : il lit les fichiers de `original/lost-in-time/`.

### Fichiers de données

`INTRO.STK` (archive de départ, lancée sur `INTRO.TOT`), `*.ITK` et `*.LTK` (données et textes de chaque partie), `LOST.LIC` (plages du CD), `CAT2.INF` à `CAT4.INF` (lus par le jeu), `MUSIC.mp3` (la piste audio du CD) et `COVER.png` (la jaquette du jeu).
Les fichiers sont chargés à la demande. Les sauvegardes (`CAT.INF`, `IMA.INF`, `BLOC.INF`) sont dans le `localStorage`, sous le préfixe `lost-in-time:`.

### Architecture

- `src/games/lost-in-time/data/` — lecteurs : archives STK / ITK (LZSS), TOT, polices, sprites, palettes, IMD (vidéo), SND, LIC.
- `src/games/lost-in-time/engine/` — machine virtuelle : interpréteur et opcodes, expressions, ressources, cycle de vie des TOT (`game.ts`), zones de la souris (`hotspots.ts`), entrées (`input.ts`), sauvegardes (`saves.ts`).
  `host.ts` définit la frontière avec l'extérieur (fichiers, horloge, entrées, sous-systèmes) et `system.ts` assemble les vrais sous-systèmes.
- `src/games/lost-in-time/engine/graphics/`, `mult/`, `video/`, `audio/` — affichage et palette, animations, vidéos IMD, sons (Web Audio) et piste CD (`<audio>`).
- `src/games/lost-in-time/render/` — présentation de l'image indexée sur le canvas.
- `src/games/lost-in-time/ui/` — hôte du navigateur (fichiers, images, entrées), page du jeu (canvas 4:3) et styles. Ses textes sont dans `copy.ts`.

### Scripts

- `scripts/lost-in-time-music.sh <track01.flac>` — convertit la piste audio du CD en `original/lost-in-time/MUSIC.mp3`.
- `scripts/lost-in-time-degob-fixture.mjs <dossier degob>` — régénère `test/lost-in-time/fixtures/degob-ops.json` (opcodes par script, pour les tests).

En développement, `__lit` (jeu, sous-systèmes, hôte) est exposé dans la console. Les tests sont dans `test/lost-in-time/`.

## Le Téléportaschtroumpf

Réimplémentation du jeu de plateau et de mini-jeux *Le Téléportaschtroumpf* (Infogrames Multimedia, 1995, CD pour DOS). Sa logique est écrite en dur dans `SMURF.EXE` : elle a été reconstituée par rétro-ingénierie du désassemblage.

### Fichiers de données

Ils viennent du CD : `scripts/teleportaschtroumpf-extract.sh [archive.rar]` lit l'archive placée dans `archives/` (non versionnée), en extrait la piste de données et ne garde que les fichiers utiles dans `original/teleportaschtroumpf/`. Ce dossier contient `SMURF.EXE`, `DATA/` (images MCG, sprites HY8, vidéos et sons MUX, voix et effets VOC, polices PFN), `files.json` (liste des fichiers, pour la résolution des noms sans tenir compte de la casse) `COVER.webp` (la jaquette du jeu, conservée par le script d'extraction) et `MANUEL.pdf` (la notice d'Infogrames, `Lisez moi.doc` sur le CD, convertie par le script avec `textutil` et Chrome ; lien « Manuel d'origine » de l'écran de présentation). Le script régénère aussi l'inventaire `docs/teleportaschtroumpf/files.md`.

### Architecture

- `src/games/teleportaschtroumpf/data/` — lecteurs des formats du jeu (MCG, HY8, MUX, VOC, PFN…).
- `src/games/teleportaschtroumpf/engine/` — moteur : boucle, tampons d'image et palette, entrées, pile de scènes.
- `src/games/teleportaschtroumpf/audio/` — voix, effets et musiques (Web Audio).
- `src/games/teleportaschtroumpf/game/` — règles : plateau, joueurs, objectif et gains.
- `src/games/teleportaschtroumpf/scenes/` — les écrans (menus, préparation de partie, plateau, carte, événements, Grand Schtroumpf).
- `src/games/teleportaschtroumpf/scenes/minigames/` — les mini-jeux.
- `src/games/teleportaschtroumpf/ui/` — page du jeu (canvas), hôte du navigateur et pages de développement.

### Pages de développement

Avec `npm run dev` : `src/games/teleportaschtroumpf/ui/asset-viewer.html` est une visionneuse des ressources (images, sprites, sons) et `src/games/teleportaschtroumpf/ui/dev.html` lance le jeu seul, sans la page d'accueil.

### Documentation

`docs/teleportaschtroumpf/` : plan (`plan.md`), formats de fichiers, rétro-ingénierie (`re-index.md`, `engine.md`), règles (`rules.md`), écrans (`screens-*.md`) et mini-jeux (`minigames/`).

## Math Workshop (Mathémagique)

*Math Workshop* (Broderbund, 1994, CD pour Windows 3.x ; *Mathémagique* en français). Le moteur (« Mohawk » de Broderbund) et ses activités sont compilés dans l'exécutable 16 bits `MATH` : ils sont reconstitués par rétro-ingénierie avec Ghidra. Les lecteurs de données et les activités sont faits : le jeu est jouable, en cours de validation.

**Commandes** (aussi listées sur l'écran de présentation) : souris ou toucher pour tout ; Bowling, touches 1 à 4 ; Espace pour faire tourner la pièce (Hidden, Patterns, Sticklers) ; 1 à 9 ou Tab pour changer d'outil (Rhythm Shop) ; X couleur suivante, Z couleur précédente (Pattern Windows) ; Ctrl + clic sur Sign-in pour les préférences (appui long sur écran tactile) ; Ctrl + Q pour quitter. **Manuel** : `original/mathemagique/MANUEL.html`, lié depuis l'écran de présentation.

### Fichiers de données

Ils viennent de l'image ISO du CD : `scripts/mathemagique-extract.sh [archive.zip]` lit l'archive placée dans `archives/` (non versionnée), extrait le CD complet dans `archives/mathemagique/cd/` (pour la rétro-ingénierie) et ne garde que les fichiers utiles dans `original/mathemagique/`. Ce dossier contient `MATH` (l'exécutable du jeu), les archives Mohawk `*.DAT` (sauf `MIDIMAC.DAT`, le jeu MIDI pour Mac) et `MPC/PVG.MHK`, les images `*.WMF`, les polices `*.TTF` et `*.FON` et `files.json` (liste des fichiers). Le script régénère aussi l'inventaire `docs/mathemagique/files.md`.

### Son (soundfont)

Le MIDI est joué par `spessasynth_lib` avec la soundfont General MIDI *GeneralUser GS* (non versionnée dans `archives/mathemagique/soundfont/`), réduite aux timbres des 66 MIDI du jeu : `npx vite-node scripts/mathemagique/soundfont.mts` produit `original/mathemagique/mathemagique-gm.sf2` (environ 18 Mo) et copie sa licence à côté (`mathemagique-gm-LICENSE.txt`). Le script d'extraction du CD conserve ces deux fichiers. Détails : `docs/mathemagique/audio.md`.

### Jaquette

`npx vite-node scripts/mathemagique/cover.mts` génère `original/mathemagique/COVER.png` (576×432, l'écran titre de `TITLE.DAT` avec sa palette) et régénère `files.json`. Le script d'extraction du CD conserve ce fichier.

### Pages de développement

Avec `npm run dev` : `src/games/mathemagique/ui/dev.html` lance le jeu seul, sans la page d'accueil (`__mw` expose `engine`, `host` et `services` dans la console), et `src/games/mathemagique/ui/asset-viewer.html` est une visionneuse des ressources des archives Mohawk (images `SHAP` et `tBMP`, palettes, animations `\0SCR` avec leurs sons, `WAVE`, MIDI à télécharger, listes de chaînes).

### Robot de partie

`PLAY=1 npx vitest run test/mathemagique/playthrough` joue tout le jeu sans affichage (titre, hub, les 7 activités, Hall of Fame, préférences) et vérifie des invariants à chaque tick (`PLAY_SEEDS`, `PLAY_FROM`, `PLAY_ONLY`, `PLAY_DEBUG=1` ; voir `docs/mathemagique/playthrough.md`).

### Documentation

`docs/mathemagique/` : inventaire (`files.md`), formats (`formats.md`, `shap.md`, `scr.md`), rétro-ingénierie (`re-index.md`, régénérée par `scripts/mathemagique/re/run.sh` ; `engine.md`), écrans et activités (`screens/`) et transcription du manuel de la version de 1997 (`manual-en.md`).

## Armaeth

*Armaeth* (Grandslam Video, 1994, CD pour DOS adapté par Rob Northen Computing) : jeu d'action et d'aventure en vue de côté, où l'on tape aussi des commandes. Le moteur `AM1.EXE` (Microsoft C, mode réel) et son pilote vidéo résident `VGA.EXE` sont reconstitués par rétro-ingénierie avec Ghidra. Le moteur est réécrit en TypeScript et le jeu est jouable dans le navigateur (en cours de validation) : musique AdLib (OPL2), souris, clavier et écran tactile, sauvegarde dans le navigateur (F2 / F3), et une page d'aide (les indices de `SOS.EXE`, dévoilés un par un) depuis l'écran de présentation.

### Lancer le jeu

Avec `npm run dev`, le jeu est sur la page d'accueil (carte *Armaeth*) ; `src/games/armaeth/ui/dev.html` le lance seul, sans la page d'accueil, et expose `window.__armaeth` (`engine`, `host`) pour la console.

### Fichiers de données

Ils viennent de l'image ISO du CD : `scripts/armaeth-extract.sh [archive.7z]` lit l'archive placée dans `archives/armaeth/` (non versionnée), extrait le CD complet (versions anglaise, française et allemande) dans `archives/armaeth/cd/` et ne garde que la version française dans `original/armaeth/` : les archives d'images `A1F*.VGA`, les données `A1F*.SYS`, l'état de départ (`SVG001.STD`, `A1FTMP.*`), les messages `MSG*`, `AM1.EXE` (pour la palette et les tables du pilote son) et `files.json`. Le script régénère aussi l'inventaire `docs/armaeth/files.md`.

### Architecture

- `src/games/armaeth/data/` — lecteurs : archives VGA, sprites, scènes (décor et masque de profondeur), palette, textes et dictionnaire, scripts de commandes, police, monde (salles et objets), tables, son (`A1FMIX.SYS`).
- `src/games/armaeth/engine/` — le moteur (`ArmaethEngine`, un `tick()` par image à 50 Hz) et sa frontière avec l'environnement (`host.ts`) ; `audio/` — pilote et séquenceur OPL2, `web-opl.ts` pour le navigateur.
- `src/games/armaeth/ui/` — l'hôte du navigateur (`browser-host.ts` : fichiers préchargés, clavier DOS, souris et doigt, sauvegardes en base64), la page du jeu (`app.ts`), l'écran de présentation (`title.ts`) et la page d'aide (`help.ts`).
- `src/games/armaeth/ui/asset-viewer.html` — visionneuse des ressources (avec `npm run dev`).

### Documentation

`docs/armaeth/` : inventaire (`files.md`), formats (`formats.md`, `graphics.md`, `audio.md`), rétro-ingénierie (`re-index.md`, régénérée par `scripts/armaeth/re/run.sh`), moteur (`engine.md`), analyseur de commandes (`parser.md`), écrans (`screens.md`) et plan (`plan.md`).

## Code commun aux jeux

- `src/data/` — lecture binaire (`reader.ts`), page de code 437, liste des fichiers d'un jeu (`game-files.ts`), fichiers RIFF WAVE (`riff-wave.ts`), vidéos Smacker (`smacker.ts`).
- `src/audio/` — conversion PCM et création des `AudioBuffer` (`pcm.ts`), lecture en flux des pistes de musique (`track-player.ts`).
- `src/ui/` — page d'accueil, écran titre, chargement des fichiers (`files.ts`), images indexées et palettes VGA (`indexed-canvas.ts`), coquille des visionneuses de ressources (`asset-viewer/`).
- `scripts/lib/` — extraction des CD (images BIN/CUE et pistes audio, lecture ISO 9660, inventaire `files.md`, remplacement atomique de `original/<jeu>/`) et encodeur PNG ; `scripts/manifest.py` écrit `files.json`.
- `scripts/re/` — socle Ghidra headless (recherche de Ghidra et du JDK, exports, génération des index) ; chaque jeu garde ses scripts dans `scripts/<jeu>/re/`.
- `test/support/original.ts` — accès aux fichiers d'origine dans les tests, ignorés quand ils sont absents.

## Ce qui a été reconstitué

- **Opcodes de script** : Indy n'utilise pas la même table que Yoda Stories. La table de `script.ts` a été déduite
  de l'usage de chaque opcode dans les 2 825 actions du fichier de données, puis vérifiée dans le désassemblage
  de `DESKADV.EXE` (voir les commentaires).
- **Génération du monde** : la disposition suit l'algorithme original ; l'affectation des zones est une reconstitution
  (WebFun ne gère pas les puzzles d'Indy). Comme dans l'original, Marcus remet le premier objet de la chaîne.
- **Comportements lus dans le désassemblage de `DESKADV.EXE`** : déplacement du héros (seule la case visée compte,
  pas de glissement), soins des objets comestibles, sons et musiques appelés en dur (`EERIE.MID`, `EEP.WAV`),
  formule de l'Indy Quotient, historique des objectifs et « Replay Story », vitesse de jeu. Les adresses sont citées en
  commentaire ; la formule de l'Indy Quotient reste à confirmer.
- **Valeurs non présentes dans les données** : objet posé sur les emplacements « bonus », comportements des types de
  déplacement ennemis.

Référence : [WebFun](https://codeberg.org/cyco/WebFun) (MIT), réimplémentation de *Yoda Stories*.

## Licence

Le code est sous [GPL v3 ou ultérieure](LICENSE) : le moteur de Lost in Time est porté de [ScummVM](https://www.scummvm.org/) (GPL v3+),
y compris l'émulateur OPL (MAME) utilisé pour la musique AdLib. Les fichiers des jeux de `original/` ne sont pas couverts
par cette licence : ils restent la propriété de leurs ayants droit.
