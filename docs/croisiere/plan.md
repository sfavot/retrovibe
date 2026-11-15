# Croisière pour un cadavre : plan d'implémentation

Jeu : *Croisière pour un cadavre* (Delphine Software International, 1991, scénario et réalisation de Paul Cuisset), **version DOS VGA 256 couleurs, française, 5 disquettes**. Installeur Abandonware France `setup-00074-Croisiere_pour_un_cadavre-Dosbox.exe` (Inno Setup 5.4.2, non versionné). `D1` a le MD5 `e258865807ea31b2d523340e6f0a606b` (5 000 premiers octets), soit l'entrée « 256 colors / DOS / French » de la détection de ScummVM.
Aventure « pointer-et-cliquer » en 320 × 200, 256 couleurs : en 1927, l'inspecteur Raoul Dusentier enquête sur le meurtre de Niklos Karaboudjan à bord de son yacht ; le temps avance par actions-clés. Interface : **menus de verbes contextuels** au clic gauche sur un objet, **inventaire** au clic droit, **menu joueur** (les deux boutons ou F10). Personnages en **polygones vectoriels**, musique et bruitages **AdLib uniquement**, pas de voix.

Ce document est le brief commun aux sous-agents, sur le modèle de `docs/bass/plan.md` et `docs/lure/plan.md`. Les références font foi dans cet ordre : `formats.md` (formats, vérifiés sur les fichiers), `engine.md` (moteur de ScummVM, découpage), puis ce plan. S'ajouteront : `files.md` (généré par l'extraction), `graphics.md`, `audio.md`, `group-N.md`.
**La référence de comportement est le moteur `cruise` de ScummVM** (`engines/cruise/`, GPL v3 ou ultérieure, release 2026.4.0), lu pour comprendre et réécrit.

## Avancement

- **Étude faite** (vague 0, 14/11/2026) :
  - L'installeur a été extrait avec `innoextract` dans le scratchpad, sans rien exécuter. Les fichiers de DOSBox (DLL, `cruise.bat`, `stdout.txt`, icône) sont écartés.
  - Les 1 096 entrées des volumes ont été lues : 853 entrées compactées sont dépaquetées avec un CRC valide, et 243 sont brutes. Cela fait 14,1 Mo une fois dépaqueté, 3,4 Mo compacté.
  - Formats vérifiés par des rendus : fonds, sprites, modèles polygonaux, police, zones de marche, overlays, textes.
  - Moteur lu en entier : environ 17 000 lignes C++, dont environ 11 000 à porter.
  - Banc ScummVM `cruise` séparé, compilé et lancé : l'introduction et l'écran de protection sont atteints (voir P).
  - **Verdict : faisable, de taille comparable à Lure.** Il y a peu de données et pas de voix, mais le moteur est plus délicat : bytecode modifié en place, pointeurs bruts, rastériseur de polygones.
- **Implémentation faite (14–15/11/2026, non commitée)** : vagues P, X, U, D, V, C, F1–F4, E, R1, R2, A, interaction (menus, inventaire, menu joueur, pause), S, J, K.
  - **K** : partie complète jouée par de vraies entrées seulement (219 étapes, 224 148 tours) jusqu'au générique. Rejouée dans ScummVM (graine 1, temps virtuel), elle donne des traces `FR`, `VH` et `SC` identiques à chaque tour, image comprise.
  - **Reprises** : avec 104 sauvegardes et reprises en cours de partie, le résultat est le même.
  - **Composants comparés seuls** :
    - le rastériseur de polygones (R1) et le son (A) sont identiques au bit près au code de ScummVM compilé à part ;
    - le dépaqueteur est commun avec Les Voyageurs du temps (`src/engine/delphine/unpack.ts`).
  - **Écarts et rustines** : voir `engine.md` § 12 à 14. La rustine S26 reste inerte, comme dans ScummVM, et aucun blocage n'est apparu au bar. La rustine des crédits vise l'overlay `FIN01`.
- Banc ScummVM hors dépôt : `cruise-bench/` dans le scratchpad de la session d'étude (patchs `cruise-trace.patch`, `cruise-virtual-time.patch`, `cruise-replay.sh`, `cruise-checkpoints.py`).
- **Consignes de l'utilisatrice** : « mutualiser avec ce qu'on a déjà, sans pour autant trop dévoyer les jeux » ; décider le code commun Delphine avec la session *Les Voyageurs du temps* (moteur `cine`), sans éditer les mêmes fichiers en même temps.
- **D1 à D12 validées par l'utilisatrice le 14/11/2026**, telles que recommandées ci-dessous.
- **M2 abandonnée (14/11)** : Les Voyageurs du temps (CD) joue sa musique sur pistes FLAC et ses bruitages par `AdLibSoundDriverINS` (instrument à l'octet 257 des `.SPL`), pas par le pilote ADL ni le lecteur de modules de Croisière. Le pilote AdLib reste dans `src/games/croisiere/audio/` ; seul `src/engine/delphine/unpack.ts` est commun.

## Décisions

| N° | Question | Recommandation | Faits et conséquences |
| --- | --- | --- | --- |
| D1 | **Point légal : abandonware, pas freeware** | **Statut à valider par l'utilisatrice avant toute publication** (tâche X2, voir *Cas limites*). Recommandation : **même traitement que les autres abandonwares déjà publiés** (Zoombinis, SWIV 3D, Téléportaschtroumpf, Mathémagique, Armaeth). Concrètement : données dans `original/croisiere/` et phrase dans la section Licence du `README.md`, qui dit que les fichiers restent la propriété de leurs ayants droit, qu'**aucune licence de redistribution n'existe** et qu'ils seront retirés sur demande. L'aide du jeu porte la même mention. **Alternative prudente** : ne rien publier et laisser chacun fournir ses propres disquettes (lecture locale par `file-store.ts`). Elle demanderait un écran d'import, qu'aucun jeu n'a aujourd'hui. | « Abandonware » n'est pas une licence : Delphine Software International a fermé en 2004 et l'ayant droit actuel n'est pas établi ici (non vérifié). Contrairement à Lure, BASS, FOTAQ et Drascula (licences freeware jointes et versionnées), aucun texte n'autorise la redistribution ; le `Lisez-Moi.txt` d'Abandonware France décline seulement toute responsabilité. Le dépôt est publié sur GitHub Pages : publier, c'est redistribuer. ScummVM, lui, ne distribue pas ce jeu. |
| D2 | **Données versionnées** | **Les volumes d'origine tels quels** : `D1` à `D5` et `VOL.CNF`, plus `DELPHINE.LNG`, `SYSTEM.FNT` et `LISEZ.MOI`, soit **~3,5 Mo**. Le lecteur est celui de l'original : répertoires, dépaquetage, recherche par nom. | Pas de conversion, pas de doublon : 3,4 Mo compactés contre 14 Mo dépaquetés. Le dépaquetage (à peu près 1 ms par Ko) se fait au chargement d'un fichier, comme le jeu. `VOL.1`–`VOL.5`, `VOL.END`, `DELPHINE.CFG`, `DELPHINE.EXE`, `VGADRV.BIN`, `INSTALL.EXE` et `DISK1.EXE` ne sont pas lus par ScummVM : non versionnés. `Codes.pdf` (roue de codes) n'est pas versionné (D3). |
| D3 | **Protection de copie** | **Non portée.** On passe l'écran `XX2` comme si le bon code avait été donné. C'est le comportement des versions DOS anglaise et russe dans ScummVM, et le même choix que Lure (D2). Le mécanisme exact se tranche en vague I : saut de la procédure qui lance `XX2` dans `AUTO00`, ou réponse forcée par `Op_ProtectionFlag`, au plus près de ce que font les versions qui la sautent. **Le banc reçoit le même contournement** (patch), pour rester comparable. | Le banc montre que la version française l'affiche : roue « Entrez la combinaison », vérifiée dans le bytecode de `XX2.OVL` ; ScummVM n'offre aucun contournement (`Op_Protect` ne fait rien). Sans contournement, le jeu est injouable sans `Codes.pdf`. Optionnel à part : la porter (D3 bis), avec la roue en PDF. |
| D4 | **Interface** | **Menus dessinés par le jeu, gardés tels quels** : menu de verbes à l'endroit cliqué, inventaire, « Parler de », bandeau « Objet:Verbe ». Correspondances au toucher : **toucher = clic gauche, appui long = clic droit** (inventaire), comme dans `point-click-app.ts`. **Le bouton « Menu » de la barre tactile et F10 ouvrent le menu joueur du jeu.** Dans ce menu, « Sauvegarder » et « Charger » ouvrent les **dialogues communs** du site, « Recommencer » reste celui du jeu, et « Quitter » ramène à l'écran titre. Échap reste la touche du jeu ; P (pause) passe par la pause du site. | Aucun survol n'est nécessaire pour jouer : le curseur ne fait qu'informer. Les menus sont des listes de texte de 160 px placées à la souris, et ils restent lisibles au doigt en plein écran. Même choix que Lure (D4) et BASS (D5) : le dialogue de sauvegarde ScummVM n'existe pas dans l'original, qui n'a lui-même rien de mieux. Sur mobile, l'appui long est à éprouver en J (évolution M2 de Lure, si besoin). |
| D5 | **Sauvegardes** | **Comme Lure et BASS** : `SaveSlots` (préfixe `croisiere:`, 10 emplacements, JSON versionné). Le contenu est celui de `saveload.cpp` de ScummVM : variables de base dont `protectionCode`, palettes, fonds, base de fichiers, overlays (états et BSS), scripts, cellules, incrustations, acteurs, musique, personnages, zones de marche. On refuse quand le jeu refuse : intro, `userEnabled` à 0, après `DGF1.PI1`. La description est le nom du fond, plus la date. | Le format SVMCR de ScummVM n'est pas lu (optionnel). Le RNG n'est pas sauvegardé, ni remis à zéro par « Recommencer » : on garde ce comportement de ScummVM pour comparer au banc. Au chargement, **les overlays sont rechargés dans le même ordre d'index** (risque 4). |
| D6 | **Modèle de mémoire des scripts** | **Fidèle** : chaque overlay est un ensemble de blocs `Uint8Array` big-endian (code, BSS, données, chaînes), et les pointeurs de la pile sont des couples (bloc, offset). L'éditeur de liens réécrit le bytecode **en place**, comme ScummVM. | Les scripts écrivent par des pointeurs bruts dans les BSS (`Strcpy`, `Itoa` sans borne), et l'éditeur de liens modifie le code à chaque `Op_LoadOverlay`. Un modèle en objets typés imposerait une réinterprétation risquée et ferait perdre la comparaison octet pour octet avec le banc (`engine.md` § 10). |
| D7 | **Cadence et temps** | **Pas fixe de 10 ms côté hôte, comme l'attente active de ScummVM**, avec `FixedStepClock`. Le moteur lance un tour tous les 50 ms pendant l'intro et tous les 100 ms en jeu, selon `_gameSpeed`. **La musique tourne au tick OPL de 50 Hz, compté sur la même horloge** : `songPlayed` devient déterministe. Le banc reçoit un patch de **temps virtuel**, comme celui de BASS. | Seul point non déterministe de ScummVM : le fondu musical asynchrone, que les scripts lisent par `SongPlayed`. En temps virtuel, il tombe au même tour dans les deux moteurs. Au plus un changement de bouton est lu par tour : les entrées rejouées sont un **état souris par tour**, pas une file. |
| D8 | **Rustines et bogues de ScummVM** | **Rustines reprises, en écarts documentés** : `S26.CTP` (0x85 → 0x87) ; crédits de fin (pile forcée à 50, **repérée par nom d'overlay et offset**, pas par l'index 71) ; deux tours de scripts en plus sous `S06B.PI1` ; pas de sauvegarde après `DGF1.PI1` ; `userDelay` qui efface le clic. **Bogues de ScummVM reproduits** pour garder la comparaison (`setNodeColor`, lectures d'état à indice négatif modélisées sans sortir du tableau), chacun noté dans `engine.md`. | Sans les rustines, il y a des blocages connus (bar, S06B) et des crédits illisibles. Le choix « reproduire » pour `setNodeColor` se revoit en K si un blocage apparaît. |
| D9 | **Code commun Delphine (avec Les Voyageurs du temps)** | **`src/engine/delphine/`**, créé par la première des deux sessions qui implémente ; l'autre l'importe et y ajoute ses tests. Le contenu sûr est le **dépaqueteur** (`unpack.ts`) : même algorithme et même CRC dans `cine/unpack.cpp` et `cruise/delphine-unpack.cpp`, vérifié. **Pilote AdLib et lecteur de modules Delphine** : partagés **seulement si Voyageurs s'en sert**. Sa version CD joue la musique sur pistes FLAC, et ses bruitages restent à confirmer. Sinon, le pilote reste dans `src/games/croisiere/audio/` et sera promu au deuxième usage. **Rien d'autre** : police, menus, volumes (`VOL.CNF` contre `PART*`), palettes et fondus sont différents ou déjà couverts par l'existant. | Accord provisoire avec la session Voyageurs (notes partagées, 14/11). Les deux lecteurs de module viennent du même code : timer de 50 Hz ici et de 109 Hz dans `cine`, offset des motifs de 2 400 contre 600 ou 2 400, et formule de tempo propre à chacun. Un lecteur paramétré est réaliste, mais il n'apporte quelque chose que si les deux jeux l'utilisent. Aucun des deux dossiers n'est édité pendant que l'autre session y travaille : on se prévient dans les notes partagées. |
| D10 | **Tables écrites dans ScummVM (`staticres.cpp`)** | **Réécrites à la main** dans `src/games/croisiere/data/tables.ts`, avec la provenance en tête : mouvements des acteurs, curseurs, table de police française, menus, environ 365 lignes. Chaque table a un test de somme de contrôle. | Elles ne sont **pas retrouvées dans `DELPHINE.EXE`** (non vérifié : le format diffère peut-être). La table est petite et ne justifie pas un générateur comme celui de BASS (3 000 lignes). Le dépôt est sous GPL v3 : la reprise est permise. |
| D11 | **Textes** | **Français du jeu**, sans retouche (fichiers `.FR`, `DELPHINE.LNG`). La police du jeu n'a pas les majuscules accentuées (À, É, È, Ç) : elles restent absentes, comme sous DOS. La copy du site (titre, aide, contrôles) va dans `src/games/croisiere/copy.ts`, en français final. | L'encodage est Latin-1, avec la table de police « english » de ScummVM utilisée pour le français (`formats.md` § 5). Les textes de `DELPHINE.LNG` (menu joueur, « Pause », « Inventaire ») remplacent ceux de `staticres.cpp`. |
| D12 | **Identifiant et nom** | Dossiers **`croisiere`** (`src/games/croisiere/`, `original/croisiere/`, `docs/croisiere/`, `test/croisiere/`), préfixe de sauvegarde `croisiere:`, titre affiché « Croisière pour un cadavre ». | Même convention que les autres jeux (identifiant ASCII court). |

## Convention vis-à-vis de ScummVM (alignée sur Drascula, FOTAQ, Lure et BASS)

- Chaque module dont le comportement vient de ScummVM cite son fichier de référence en tête et note ses écarts volontaires. Exemples : `script.cpp`, `function.cpp`, `linker.cpp`, `overlay.cpp`, `cell.cpp`, `object.cpp`, `actor.cpp`, `perso.cpp`, `ctp.cpp`, `mainDraw.cpp`, `gfxModule.cpp`, `font.cpp`, `menu.cpp`, `cruise_main.cpp`, `backgroundIncrust.cpp`, `background.cpp`, `dataLoader.cpp`, `volume.cpp`, `delphine-unpack.cpp`, `sound.cpp`, `saveload.cpp`. On lit, puis on réécrit en TypeScript (noms du dépôt, séquences, nombres magiques nommés dans `ids.ts`).
- Aucune copie de fichier de ScummVM dans le dépôt. Le décompilateur (`decompiler.cpp`, `DUMP_SCRIPT`) sert de référence pour les tests du désassembleur, sans être porté.
- Le TTS de ScummVM et les versions autres que DOS VGA FR (16 couleurs, Amiga, Atari, autres langues) sont ignorés.
- `README.md` : ligne du tableau des jeux, section « Croisière pour un cadavre », phrase de la section Licence (D1, vague J).

## Ce qui est versionné dans `original/croisiere/` (si D1 le permet)

Source dans `archives/croisiere/` (non versionnée) : l'installeur, déplacé depuis la racine du dépôt.

| Fichiers | Source | Poids | Versionné |
| --- | --- | --- | --- |
| `D1`…`D5`, `VOL.CNF` | installeur, tels quels (D2) | 3,47 Mo | oui |
| `DELPHINE.LNG`, `SYSTEM.FNT` | installeur, tels quels | 7 Ko | oui |
| `LISEZ.MOI` | installeur, tel quel (CP850) | 4 Ko | oui (provenance) |
| `COVER.png` | `scripts/croisiere/cover.mts` (vague J), écran titre composé par le moteur | ~30 Ko | oui |
| `files.json` | `scripts/manifest.py` | ~1 Ko | oui |

**Total : ~3,6 Mo.** `original/` publié passe de ~732 Mo à ~736 Mo.

**Script d'extraction** `scripts/croisiere-extract.sh [installeur]`, sur le modèle de `scripts/bass-extract.sh` et `scripts/lib/extract-common.sh` :
- `ec_verifier_outils innoextract python3`, puis `innoextract` dans un dossier temporaire vide. **Jamais d'exécution de l'installeur.**
- Contrôle des tailles et des hachages des 9 fichiers gardés.
- Copie, `ec_conserver COVER.png`, inventaire `docs/croisiere/files.md` (liste des 1 096 entrées des volumes par `scripts/croisiere/list_volumes.py`, lancé en `python3 -I` avec les chemins en arguments), `ec_publier`.
- Idempotent.

## Architecture

`src/games/croisiere/` :
- `data/` : lecteurs purs (volumes, fonds PI1, SET/SEC, modèles polygonaux, FNT, CTP, OVL, FR, ADL et modules musicaux, LNG) et `tables.ts`.
- `engine/` : moteur sans tête.
  - `memory.ts` : blocs BE et pointeurs.
  - `overlays.ts` : chargement et éditeur de liens.
  - `vm.ts` : 12 types d'opcodes et ordonnanceur PROC/REL.
  - `functions/` : 121 fonctions natives, par thème.
  - `objects.ts`, `cells.ts`, `incrust.ts`, `actors.ts`, `walk.ts` (CTP, graphe et Bresenham).
  - `input.ts` : `processInput` et menus.
  - `main-loop.ts`, `save.ts`, `ids.ts`.
- `render/` : rastériseur de polygones, sprites et masques, police et messages, menus, composition de l'écran, palettes et fondus.
- `audio/` : pilote AdLib ADL et lecteur de modules (D9), bruitages.
- `ui/` : hôte du navigateur, `copy.ts`, aide, touches, préchargement, `app.ts`.

Tout ce qui touche au navigateur passe par `CroisiereHost` (`BaseHost`).

### Séquences

ScummVM bloque dans plusieurs boucles locales :
- le menu joueur (`processMenu`) ;
- la pause ;
- l'attente de fin de fondu musical dans `load()` ;
- `mainDraw(true)`, qui fige les animations pendant `userWait` et les menus.

Elles sont réécrites en **générateurs** (`src/engine/sequence.ts`), exécutés tick par tick. Le reste du moteur est déjà découpé en tours sans blocage : les scripts se gèlent eux-mêmes (`freeze` 9996–9999) et reprennent au tour suivant. Le tour reste donc une fonction simple, contrairement à BASS.

## Moteur : ce qui est données, ce qui est code

- **Données du jeu (tout le scénario)** : 82 overlays `.OVL` (bytecode, objets, relations verbe/objet, messages) et leurs textes `.FR`, fonds, sprites, modèles, zones de marche, musiques `CORPn` et instruments `.ADL`. Aucune énigme n'est écrite en C++.
- **Code (à porter)** :
  - la VM (12 types d'opcodes, 121 fonctions natives dont 14 vides ou presque) ;
  - l'ordonnancement ;
  - les cellules, le tri en Z et le hit-test ;
  - la marche ;
  - le rendu (polygones avec niveau de détail selon le zoom, masques, incrustations) ;
  - les menus et l'interaction ;
  - le son ;
  - la sauvegarde ;
  - les rustines de D8 ;
  - les tables de D10.

## Mutualisation (consigne : mutualiser sans trop dévoyer les jeux)

**Réutilisé tel quel** :
- `src/engine/` :
  - `sequence.ts` ;
  - `save-slots.ts` ;
  - `host.ts` (`BaseHost`) ;
  - `clock.ts` (`FixedStepClock`) ;
  - `storage.ts` ;
  - `rng.ts` (`scummvmRandom`) : le seul tirage est `Op_Random`, soit `getRandomNumber(n - 1)`, graine `--random-seed`.
- `src/ui/` :
  - `point-click-app.ts` : page, chargement, pause, barre tactile Menu / Passer / Pause, toucher = clic gauche, appui long = clic droit ;
  - `point-click-dialogs.ts`, `point-click-pages.ts`, `point-click-touch.ts`, `point-click.css` ;
  - `game-shell.ts`, `indexed-canvas.ts` (palettes 8 bits ; les fonds en mode 5 passent par une palette de 32 couleurs) ;
  - `file-store.ts`, `tick-scheduler.ts`, `pointer-queue.ts`, `files.ts`, `sound-prefs.ts`, `asset-viewer/`.
- `src/data/game-files.ts` et `reader.ts`.
- `src/audio/` : `opl2.ts`, `opl-stream.ts` (`OplSink`), `opl-worklet.ts`, `web-opl.ts` (`tickRate` 50 Hz par défaut, celui de Croisière).
- `scripts/` : `lib/extract-common.sh`, `manifest.py`, `png.mts`.
- `test/support/` : `original.ts`, `fake-host.ts`, `fake-audio-context.ts`.

**Promu ou créé en commun** :
- `src/engine/delphine/unpack.ts` (D9, avec Voyageurs) ;
- le pilote AdLib Delphine, si Voyageurs l'utilise (D9).

**Non utilisé** : `voice-bank.ts`, `sample-channel.ts`, `pcm.ts` (pas de voix ni d'échantillons), `smf.ts`, `track-player.ts`.

**Spécifique** :
- la VM et la mémoire des overlays ;
- le rastériseur de polygones ;
- la police FNT, les menus contextuels, la marche CTP ;
- `tables.ts`.

Pilote AdLib : FOTAQ, Lure et BASS ont chacun le leur. Il n'y a pas de pilote AdLib générique, et Croisière n'en crée pas un de plus en commun hors du cas Delphine (D9).

## Évolutions de modules communs proposées

| N° | Module | Changement | Raison | Risque | Vague |
| --- | --- | --- | --- | --- | --- |
| M1 | `src/engine/delphine/unpack.ts` (nouveau) | Dépaqueteur Delphine avec CRC, plus le complément à `extSize` (18 fichiers font `extSize - 1`). | Commun à `cine` et `cruise`, à l'octet près. | Nul pour les jeux existants. À coordonner avec Voyageurs. | U |
| M2 | `src/engine/delphine/adlib-*.ts` (conditionnel) | Pilote ADL et lecteur de modules paramétrés : fréquence du timer, offset des motifs, formule de tempo. | Seulement si Voyageurs joue des modules AdLib (D9). | Faible : deux jeux neufs. | A |
| M3 | `src/ui/point-click-app.ts` | Si besoin, à constater en J : touche ou bouton « menu joueur » distinct de « Menu » du site. | Le jeu ouvre son menu au double bouton, sans équivalent tactile. | Faible : à revérifier sur Drascula, FOTAQ, Lure et BASS. | J |

Le **banc ScummVM** reste hors dépôt, dans le scratchpad de cette session (`cruise-bench/`) : clone APFS de la source du banc commun, compilé avec `--enable-engine=cruise` seul, avec sa propre config `cfg/scummvm.ini`. Il ne touche ni au banc des autres sessions, ni à `~/Library`.

## Vagues

| Tâche | Contenu | Tests | Critère de fin | Dépend de |
| --- | --- | --- | --- | --- |
| **P** banc | Compilé, cible `cruise-fr`, `bench/run.sh`, `realmouse` (**fait**). À faire : patch de trace par tour (points d'accroche de `engine.md` § 11), temps virtuel (D7), entrées par tour (`CRUISE_INPUT`), contournement de la protection (D3), captures `.idx`/`.pal` par tour, CRC d'écran et de palette, journal des écritures OPL. | Deux lancements avec la même graine donnent la même trace. | Trace stable de l'intro jusqu'à la première pièce jouable. | — |
| **X** extraction | `scripts/croisiere-extract.sh`, `original/croisiere/`, `files.md`. **X2 : point légal (D1) tranché avant le premier commit des données.** | Hachages, idempotence. | Dossier publié de ~3,6 Mo, ou import local si D1 en décide ainsi. | D1 |
| **U** commun Delphine | M1 (et M2 si décidé), en accord avec la session Voyageurs. | 853 entrées dépaquetées, CRC à 0, identiques au port de l'étude. | Importé par Croisière (et Voyageurs). | — |
| **D** lecteurs | Tous les formats de `formats.md`. | Lecture de toutes les entrées des volumes sans reste ; rendus de référence (fonds, sets, modèles) en tests d'instantané. | 1 096 entrées lues. | U |
| **V** visionneuse | Entrée `asset-viewer` : fonds, SET, modèles polygonaux à plusieurs zooms, police. | Visuel. | Tout s'affiche. | D, R1 |
| **C** cœur | Mémoire BE, overlays et éditeur de liens, VM et ordonnanceur, objets, cellules, boucle principale sans rendu, entrées. | Trace par tour égale au banc (scripts, IP, gels, cellules, variables) sur l'intro. | Intro jusqu'à `XX2`, traces identiques. | D, P |
| **F** fonctions natives | Les 121 fonctions en 4 groupes parallèles : F1 objets et états, F2 acteurs, marche et CT, F3 graphismes, fonds et messages, F4 son, système et divers. | Trace des appels (n°, arguments, résultat) égale au banc. | Plus aucune fonction « non implémentée » en partie. | C |
| **E** marche | CTP, rastérisation des zones, graphe (≤ 20 nœuds, parcours exhaustif), Bresenham, acteurs, zoom. | Trajets identiques au banc, au pixel et au tour. | 30 trajets de référence. | C, F2 |
| **R** rendu | R1 rastériseur de polygones (`mainDraw.cpp`, environ 900 lignes) ; R2 sprites, masques, incrustations, tri Z, police, messages, menus, palettes et fondus. | CRC d'écran par tour égal au banc. | Intro et 10 pièces identiques image par image. | C (R1 seul : D) |
| **A** son | Pilote ADL, lecteur de modules (50 Hz), bruitages sur le canal 4, fondu et `songPlayed`, volume. | Écritures OPL identiques au banc (temps virtuel). | Les 14 musiques et les bruitages. | D, (M2) |
| **I** intro, protection, fin | Cadence de l'intro, contournement de `XX2` (D3), rustines D8, crédits. | Trace identique au banc patché ; fin jouée en test. | Intro passable, crédits lisibles. | C, F, R |
| **S** menu joueur et sauvegardes | `processMenu` en séquence, D5, refus. | Aller-retour de sauvegarde : trace identique après rechargement. | 10 emplacements, chargement dans toute pièce. | C, F |
| **J** intégration | `GameDefinition`, registre, `copy.ts`, aide, touches, barre tactile (D4, M3), préchargement, couverture, README (licence, D1). | Navigateur : souris, toucher, responsive, focus, états de chargement et d'erreur. | Jeu lancé depuis l'accueil. | R, A, S |
| **K** validation | Partie complète en test (`test/croisiere/full-game.test.ts`, solution jouée par un `Driver`, d'un trait puis avec reprises de sauvegarde, `CROISIERE_FULL_GAME=0` pour la sauter), comparée au banc tour par tour (hachage des variables). | Partie entière identique au banc. | Générique atteint. | tout |

**Parallélisme** : P, X et U d'abord, en parallèle ; D ensuite (R1 dès que les modèles sont lus). Puis C, et après C les groupes F1 à F4, E, R2 et A en parallèle, sur des fichiers distincts. I et S viennent ensuite, puis J et K. Jamais deux agents sur les mêmes fichiers. Rien dans `src/engine/delphine/` sans prévenir la session Voyageurs.

## Estimation

- **Taille** : ~13 000 lignes de TypeScript hors tests, plus ~5 000 de tests. C'est comparable à Lure, et plus petit que BASS en données et en son.
- **Répartition** :
  - VM et fonctions : ~4 500 ;
  - rendu : ~3 000 ;
  - marche et acteurs : ~1 800 ;
  - interface et boucle : ~1 500 ;
  - lecteurs : ~1 300 ;
  - son : ~900 ;
  - sauvegarde : ~600.
- **Charge relative** : P 1, X 0,5, U 0,5, D 1,5, V 0,5, C 3, F 3, E 2, R 3, A 1,5, I 1, S 1, J 1,5, K 3.
- **Incertitude** :
  - **haute** sur C et F : mémoire brute, éditeur de liens, bogues à reproduire ;
  - **haute** sur R1 : rastériseur à l'état global partagé avec le hit-test ;
  - **moyenne** sur K : la solution est à écrire, et aucun test de partie complète n'existe en dehors de nous.

## Requis, naturellement lié, optionnel

- **Requis** :
  - vagues P, X, U, D, C, F, E, R, A, I, S, J, K ;
  - D1 à D12 tranchées, **D1 en premier** ;
  - mention de la version modifiée dans l'aide (moteur réécrit, protection retirée).
- **Naturellement lié** :
  - V (visionneuse) ;
  - M2 si Voyageurs en a l'usage ;
  - M3 si l'appui long ne suffit pas ;
  - le contournement de la protection dans le banc.
- **Optionnel, à part** :
  - protection de copie jouable (D3 bis) ;
  - lecture des sauvegardes ScummVM (SVMCR) ;
  - version 16 couleurs ;
  - autres langues ;
  - narrateur vocal (TTS) ;
  - écran d'import des fichiers personnels, si D1 l'exige.

## Cas limites

- **Légal (D1)** : rien n'est commité dans `original/croisiere/`, ni publié, avant la décision de l'utilisatrice. L'installeur reste hors du dépôt (`*.exe` est ignoré par git ; à déplacer dans `archives/croisiere/`).
- **Volumes** :
  - 115 noms existent sur plusieurs disques : on prend le premier trouvé, en cherchant d'abord dans le volume courant, comme `findFileInDisks`. Les 14 variantes qui diffèrent sont sans effet visible.
  - 18 fichiers font `extSize - 1` : il faut compléter par un zéro.
  - Les noms des répertoires ont des octets parasites après le NUL.
- **Fonds** : deux modes de codage (8 bits et 5 plans de 32 couleurs). La palette du mode 5 est dupliquée 8 fois.
- **Interface** :
  - menus en plusieurs colonnes au-delà de (199 − 2h) / h entrées, 49 entrées au plus ;
  - menu ouvert près des bords, recentré dans l'écran ;
  - bandeau « Objet:Verbe » en haut ou en bas selon la souris ;
  - inventaire vide ;
  - clic droit pendant un verbe à deux objets ;
  - clic pendant la marche du narrateur (utilisateur désactivé) ;
  - menu joueur pendant l'intro (désactivé) et pendant un dialogue.
- **Entrées** : appui et relâchement dans le même tour, vus comme un bouton enfoncé pendant un tour ; double clic absorbé par `userDelay` ; les deux boutons à la fois au toucher (M3).
- **Textes** : `|` = saut de ligne ; majuscules accentuées sans glyphe ; messages placés près de l'objet et ramenés dans 320 × 198.
- **Son** : `Op_SongPlayed` pendant un fondu ; changement de musique pendant un fondu (attente dans `load()`) ; son coupé par la préférence du site, sans changer la logique.
- **Sauvegarde** :
  - pendant `userWait`, pendant la marche automatique ou dans un dialogue : on suit les refus du jeu ;
  - après `DGF1.PI1` : pas de sauvegarde ;
  - au chargement : ordre des overlays et tranches de `globalVars` identiques.
- **Recommencer** : le RNG n'est pas remis à zéro, comme dans ScummVM.
- **Mobile** : écran tactile en mode portrait, appui long contre défilement, plein écran.

## Risques

1. **Mémoire brute et éditeur de liens** : le bytecode est modifié en place, les pointeurs (bloc, offset) passent par la pile, et `Strcpy` écrit sans borne. Parade : D6, plus une trace des écritures en mémoire comparée au banc dès C.
2. **Logique dans le rendu** : l'animation automatique et le réveil des scripts se font dans `mainDraw`, figé pendant les menus. Parade : l'appel garde le même ordre dans la boucle, testé en C avant le rendu réel.
3. **Ordre des listes** : insertion par Z, `sortCells` et scripts ajoutés en queue décident du dessin, du hit-test et des réveils. Parade : trace des listes à chaque tour.
4. **Index d'overlay** : stables et croissants, avec un hack qui vise l'index 71. Parade : la rustine est repérée par nom et offset, et le chargement suit le même ordre (D5).
5. **Rastériseur de polygones** : état global partagé avec le hit-test et les zones de marche, débordements entre tampons (`bigPolyBuf`). Parade : CRC d'écran par tour et tests d'instantané par modèle et par zoom.
6. **Musique asynchrone** : parade par le temps virtuel des deux côtés (D7).
7. **Protection** : le contournement doit laisser le même état que la bonne réponse, avec `protectionCode` sauvegardé. Parade : le même patch dans le banc, et une comparaison de l'état après `XX2` avec une partie où l'on donne le bon code (essai par force brute des symboles dans le banc).
8. **Solution de la partie (K)** : elle est à écrire et le jeu est à heure. Parade : enregistrer les entrées depuis le portage (comme `bench-record` de BASS) et rejouer dans ScummVM.
9. **Concurrence** : sessions Voyageurs, Ween et TIM3 dans le même checkout. Parade : fichiers distincts, `src/engine/delphine/` coordonné, aucun commit sans demande.
10. **Légal** : voir D1.

## Validation

- `npm run typecheck`, `npm test` (plus `test/croisiere/`), `npm run build`, et les hooks du dépôt, à chaque vague.
- **Lecteurs** : toutes les entrées des volumes, et les rendus de référence.
- **Comparaison au banc**, avec la même graine et en temps virtuel :
  - traces par tour (C, F) ;
  - trajets (E) ;
  - CRC d'écran (R) ;
  - écritures OPL (A) ;
  - aller-retour de sauvegarde (S) ;
  - partie complète (K).
- **Navigateur (J)** : souris, toucher, appui long, menus, inventaire, menu joueur, sauvegarde et chargement, pause, son coupé, plein écran, responsive, focus clavier, états de chargement et d'erreur.

## Dette technique à surveiller

- Quatre pilotes AdLib par jeu dans le dépôt (FOTAQ, Lure, BASS, puis Croisière ou commun Delphine) : une promotion vers `src/audio/` reste à envisager à part.
- Palettes, fondus et polices réécrits pour chaque jeu.
- Le banc ScummVM est dupliqué par session (clones APFS) : à réunifier une fois les portages Delphine terminés.
- Les tables de `staticres.cpp`, introuvables dans l'exécutable, sont de provenance ScummVM seulement (D10).
