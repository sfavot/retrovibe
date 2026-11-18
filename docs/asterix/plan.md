# Astérix : le défi de César : plan d'implémentation

Jeu : *Astérix : le défi de César* (Infogrames Multimedia, réalisation Bertrand Brocard ; adaptation PC IKOS S.A. ; Philips et Pathé, 1995), **version CD DOS française, voix françaises** (`ASTERIX.EXE` « Version 2.5 », « May 30 1995 », MD5 `0b826e68e191b7c25d4416d2d824681d`), identifiant `asterix`. Source : `archives/asterix/` (non versionnée ; le 7z et l'installeur Inno Setup contiennent les mêmes 1 163 fichiers, octet pour octet).
Jeu de plateau de 54 cases dans l'esprit du jeu de l'oie : César défie les Gaulois de rapporter un souvenir de chaque province. Six personnages (Astérix, Obélix, Bonemine, Agecanonix, Falbala, Goudurix), réglages de durée (30 à 120) et de nombre d'objets (3 à 9), difficulté par joueur sur deux axes (réflexion, action). Les cases mènent à une quinzaine de mini-jeux d'action, des jeux d'observation, un jeu de pari, un quiz par pays et des jeux d'ambiance hors écran annoncés par Panoramix.

Ce document est le brief commun aux sous-agents. Les références font foi dans cet ordre : `formats.md`, `engine.md` (à écrire en vague B), puis ce plan. **Il n'existe aucune implémentation de référence** : la référence de comportement est le désassemblage de `ASTERIX.EXE` (décision de l'utilisatrice du 17/11/2026 : « désassemblage exact »), vérifié au besoin contre l'original sous DOSBox-X.

## Avancement

- **Étude faite** (vague 0, 17/11/2026), hors dépôt, rien exécuté :
  - inventaire des fichiers et des formats (notes : `scratchpad/asterix/inventaire.md`, à reverser dans `formats.md` en vague A) ;
  - comparaison avec `SMURF.EXE` (*Le Téléportaschtroumpf*, déjà porté dans `src/games/teleportaschtroumpf/`) : **même moteur**, Astérix en est l'ancêtre direct (notes : `scratchpad/asterix/comparaison.md`, Ghidra headless dans `scratchpad/asterix/re/`).
- **Verdict : portage moyen-gros, environ deux tiers de l'effort des Schtroumpfs.** Le socle est déjà écrit ; le poste dominant est le désassemblage d'environ 65 Ko de code de jeu propre à Astérix.
- **Décisions prises par l'utilisatrice** : portage par désassemblage exact (17/11/2026) ; **D1 à D13 validées le 17/11/2026**, telles que recommandées.
- **Vague A faite** (17/11/2026) : `scripts/asterix-extract.sh`, `original/asterix/` (56 Mo : sons en MP3 + `audio.json`, vidéos MUX et MUK en conteneur `.vid` sans perte, LZMA), lecteurs `src/games/asterix/data/`, `src/data/lzma.ts`, `docs/asterix/formats.md`, `files.md`, tests `test/asterix/`.
- **Vague B, temps 1 et 2 faits** (D1) : moteur commun `src/engine/infogrames/`, Schtroumpfs rebranchés (résolveur de chemins injecté dans l'hôte, `GameConfig` pour les bips, options parents sorties du contexte). **D3 faite** : sons des Schtroumpfs en MP3 + `audio.json` (−66 Mo), API commune « son = MP3 + durée exacte » (`audio/sound.ts`, `data/audio-index.ts`). Commit `61d6df5c`.
- **Vague B, temps 3 fait** (D1) : ajouts d'Astérix au moteur commun. Conteneur `.vid` et MCC déplacés dans `src/engine/infogrames/data/` ; `video.ts` lit MUX et `.vid` par une même interface (`VideoSource`), son MP3 à part, marqueur `08`, trois compositions ; HY8 type 5 (rectangle plein) ; blocs `05` vides ignorés ; résolveur de chemins `src/games/asterix/engine/paths.ts` ; visionneuse `src/games/asterix/ui/asset-viewer.html` sur des panneaux communs (`src/engine/infogrames/ui/panels.ts`).
- **Vague C faite** (17/11/2026) : `scripts/asterix/re/` (Ghidra headless), `docs/asterix/engine.md` (règles du plateau, tour, cases, quiz, moteur), `re-index.md` (504 fonctions, table des 15 mini-jeux). Les 14 segments de mini-jeux ne sont pas lus (vague E).
- **Vague D faite** (17/11/2026) : jeu jouable sans mini-jeux, hors `src/games/registry.ts` (page de recette `src/games/asterix/ui/dev.html` ; `?direct&intro=0&seed=n&resume` pour la recette). Tables lues dans `ASTERIX.EXE` (`data/exe.ts`, D4), règles pures `game/` (`state.ts`, `rules.ts`), écrans portés en scripts séquentiels sur le moteur commun (`scenes/runtime.ts` : un générateur par fonction d'origine, un `yield` par tick) : logos et introduction, menu M07, joueurs M08 et réglages M09, REJOUER, plateau, tour complet, toutes les cases, quiz, carte, score et commentaires, marbre de route, abandon, pause, fins de partie, générique. Mini-jeux : écran provisoire « Gagné / Perdu » (`scenes/minigame.ts`, `registerMinigame(module, script)` est le point d'entrée de la vague E, table `20fa:146d`). D6 (sauvegarde `retrovibe:asterix:game` au début de chaque tour, « Continuer »), D11 (zones cliquables), D12, D13 faites. Tests : `test/asterix/rules.test.ts`, `game-flow.test.ts`, `playthrough.test.ts` (4 parties complètes par un robot, ~15 s). Écarts et hypothèses : voir « Écarts de la vague D ».

- **Vague E faite** (17/11/2026) : les quinze mini-jeux sont portés (M22 à M36 ; M28 et M29 partagent le segment `24e3`), chacun avec sa fiche `docs/asterix/minigames/mNN.md`, son robot et ses tests (`test/asterix/minigames/`). Mise en commun faite après coup : pointeur libre, curseurs `153c:05b4` et `18a1`, lecteur MUK, attente qui retient un clic et fondu sonore dans `scenes/minigames/common.ts` ; rappels vidéo par image (`cb_bloc`, `cb_image`), vidéo nommée `15d7:08e9` et image gardée à l'écran après un nettoyage dans `scenes/runtime.ts` ; tables des mini-jeux lues dans l'exécutable par `data/exe.ts` (D4) ; mémoires `DS:2a00`, `DS:245a`, `DS:6ad8` dans `Session` (D13). Menu principal : jeu d'Idéfix hors partie (`23d1:09c1(0)`) et démonstration automatique (60 s sans clic : Idéfix, règle du jeu, partie de démonstration), tests `test/asterix/demo.test.ts` et scénario « Idéfix au menu » du parcours. Écarts : voir « Écarts de la vague E ».
- Détail du début de la vague E : mini-jeu pilote **M22, les Poissons** (`scenes/minigames/m22.ts`, `docs/asterix/minigames/m22.md`) et gabarit de portage des 14 autres (`docs/asterix/minigames/README.md`) : outils communs `scenes/minigames/common.ts`, inscription `scenes/minigames/index.ts`, banc et robots `test/asterix/minigames/`, lancement direct `dev.html?direct&minigame=NN`. Gain réel de M22 : 1 sesterce, aucune perte.
- **Relecture indépendante du plateau et de la partie** (18/11/2026) : `game/` et `scenes/` (tour, cases, quiz, réglages, score, marbre, abandon, fins de partie) confrontés au désassemblage (`decomp/`, `disasm.txt`), valeurs initiales des mémoires de séance relues dans l'image de l'exécutable. Les règles sont conformes ; deux défauts de l'adaptation web corrigés (sauvegarde effacée par une partie annulée, REJOUER après une reprise : voir « Écarts de la vague D »), tests dans `test/asterix/game-flow.test.ts`. Comportement étrange mais fidèle documenté : `engine.md` §9.10 (l'abandon du premier joueur compte un tour de table).
- **Vague F préparée, jeu non publié** (18/11/2026) : tout est prêt sauf l'inscription dans `src/games/registry.ts`, qui attend la décision de publication de l'utilisatrice. Détail : « Vague F : publication ».

## Écarts de la vague D

- **Non portés** : la navigation par les bords de l'écran à la souris (remplacée par le clic direct, D11), le menu caché et la triche (D9).
- **Écran provisoire des mini-jeux** : il ne sert plus (tous les mini-jeux sont portés) ; `scenes/minigame.ts` le garde pour un module qui ne serait pas inscrit.
- **Entrées** : un appui n'agit qu'une fois, et un appui bref sur une direction tombé entre deux lectures de l'écran est rendu à la lecture suivante (l'original le perdait).
- **Temps de partie** : temps réel, sans l'accélération de l'horloge pendant les vidéos (`engine.md` §2.3).
- **Sauvegarde (D6), précisions de la relecture du 18/11/2026** : la sauvegarde précédente n'est remplacée qu'au premier tour de la nouvelle partie (JOUER puis ANNULER à l'écran des joueurs la laisse reprenable) ; une partie reprise compte comme une vraie partie dès la reprise (`DS:1a02` baissé), pour que REJOUER reprenne sa configuration même si elle s'arrête avant le tour de table suivant. Conséquence assumée : une partie lancée par REJOUER sans partie préalable, rechargée avant la fin de son tout premier tour, est présentée par la voix de REJOUER et non par la vidéo de durée. Le temps passé dans le tour interrompu est rendu (on reprend au temps du début du tour).
- **Hypothèses non tranchées** : image de la question « quitter » du menu (l'original ne passe pas l'argument : celle d'Astérix est prise) ; rectangle de couleur `0x7e` tracé dans le fond après une sortie de prison (`20fa:0227`, non reproduit) ; durée des 4 images de chute du pion après un piège (aucune attente dans le code : 1 tick par image ici) ; drapeaux des images dont l'appel n'a pas été relu (`M41DB`, `M40DB`, marbre de la surprise) ; couleur 0 des images forcée à noir par le moteur commun (sans effet sur les images vérifiées).

## Écarts de la vague E

Chaque fiche `minigames/mNN.md` détaille les écarts de son mini-jeu. Ceux qui valent pour plusieurs :

- **Pointeur sous une vraie souris** : le navigateur ne peut pas déplacer le pointeur. Le recentrage (`153c:0030`, fait aussi par `153c:0004`) et la **dérive du pointeur de M28 et M29** (`DS:404e`, 2 pixels par tick d'un bord à l'autre) n'ont donc lieu qu'au clavier et au toucher ; à la souris, la flèche reste sous le pointeur.
- **Clics lus à l'enfoncement** : l'original lit le bouton tenu à chaque image du jeu ; le portage lit l'appui, à chaque tick, et le retient jusqu'à l'image suivante (un clic bref n'est pas perdu, un bouton tenu ne tire pas en rafale).
- **Clic et toucher directs** (D11) dans tous les mini-jeux : zones cliquables pour les jeux à choix, moitiés d'écran pour les jeux aux flèches.
- **Tables lues dans l'exe** (D4) : `DS:114c`, `11d4` (curseurs), `22a2` (M25), `2498`, `2524` (M26), `3182` (M28, M29), `310e` (M30), `2ec4`, `306a`, `306f` (M34), par `data/exe.ts`. Aucune n'est recopiée dans le code.
- **Fondu sonore `13e5:0039`** : 20 cs par cran quel que soit l'argument empilé (3 s au volume maximal) (m22, m24, m25, m28 et m33 passaient 1, m35 passait 20).
- **MUK** (M26, M34) : l'original les déroule au rythme du lecteur de CD ; ici 11 images par seconde (M26) ou la cadence du jeu (M34). **Mesuré** sur l'original (`engine.md` §2.5) : 10 à 11,6 images par seconde pour M26 sur un 486 DX2-66 à lecteur double vitesse ; la valeur du portage est gardée.
- **Bruitage en boucle** (`16cb:0a4f`, option `0x200000`) : relancé dès qu'il se tait, un tick de silence au plus entre deux tours.
- **Nettoyage `1a93:000e`** : l'original restaure le fond dans le tampon A sans le présenter ; le portage, qui présente A, garde à l'écran l'image d'avant le nettoyage tant que rien n'est redessiné (`Runtime.cleanup`, tous les écrans).
- **Démo** : le clic simulé part à la lecture d'entrées qui suit la centième sans entrée réelle, et chacune de ces cent lectures consomme un tirage `rnd()`, comme l'original (`153c:0252`, `0272` ; `Runtime.demoRead`, compté par `dirs` et par `click`). **Cadence corrigée après mesure sur l'original** (18/11/2026, `engine.md` §2.5) : dans une boucle cadencée (`beginPlay`, `waitFrame`, rappel d'image d'une vidéo), une lecture est comptée par image et le clic revient toutes les 100 images ; sur un écran sans cadence (menu du tour, joueurs, réglages, quiz, oui/non, attentes, dé, et les mini-jeux M23, M24, M25, M33, M35), où l'original fait 390 à 5 400 lectures par tick, la première lecture de chaque tick vaut un tour complet du compteur : 100 tirages, puis le clic. Écarts restants : le nombre de tirages par tick d'une machine donnée n'est pas reproduit (la suite des tirages d'une démo n'est pas celle de l'original) ; les boucles lourdes sans cadence, où le clic dépendait de la machine (M24 : toutes les 6 à 59 ticks), le reçoivent à chaque tick ; à l'entrée d'une boucle cadencée le compteur repart de zéro (phase quelconque dans l'original). La démo n'écrit ni la sauvegarde du navigateur (D6), ni la configuration de REJOUER, ni `DS:1a02`. Après une démo, un REJOUER sans partie préalable reprend la durée et les objets réglés par la démo, comme l'original.
- **Menu** : un clic sur une pancarte ou sur Idéfix lu entre deux images du menu choisit bien l'élément cliqué (il validait le choix courant).
- **Dette relevée, non traitée** : les compteurs du bloc `GEN:stats` de `re-index.md` ne seront à jour qu'à la prochaine régénération (quatre lignes du tableau corrigées à la main, comme `keyfuncs.def.tsv`). Corrigé en vague F : l'animation de départ d'Idéfix au menu et son animation 4 avancent tous les 2 ticks (`19e2:09ac`, `19e2:0885`).

## Vague F : publication

**Prêt** (18/11/2026) :

- **Jaquette** `original/asterix/COVER.webp` (280 × 275) : la pochette du CD, prise en couverture du manuel (`npx vite-node scripts/asterix/cover.mts`) ; l'extraction la conserve.
- **Manuel et carte du jeu** : `MANUEL.pdf` (4,9 Mo, édition Macintosh, partie française ; le scan porte le filigrane de son site d'origine) et `CARTE.pdf` (0,25 Mo, le plan du plateau), copiés tels quels de `archives/asterix/man-00700-asterix_le_defi_de_cesar-nt.rar` par `scripts/asterix-extract.sh` (taille et SHA-256 contrôlés, outil `unar`). Poids des fichiers suivis de `original/` : 895,8 Mio avant, 900,7 Mio après (limite du site : ~1 Go).
- **Écran de présentation** (`ui/title.ts`) : jaquette, titre, description, « Continuer » et « Jouer », « Aide et crédits », « Manuel d'origine ». **Aide et crédits** (`ui/help.ts`, page commune `renderHelpPage`) : le jeu, souris et toucher, clavier, sauvegarde, à propos et droits (Infogrames Multimedia, Bertrand Brocard, IKOS, Philips, Pathé Interactive ; Les Éditions Albert René / Goscinny-Uderzo), liens vers le manuel, la carte et le code source. Textes dans `ui/copy.ts`.
- **`GameDefinition`** complète (`src/games/asterix/index.ts` : identifiant, titre, description, jaquette et ses dimensions, texte alternatif, `start`).
- **Section du README** : ligne du tableau des jeux et section après celle du Téléportaschtroumpf.
- **Corrections** : cadence des animations d'Idéfix au menu, lecture des entrées de la démo (« Écarts de la vague E »).

**Publié le 18/11/2026** sur décision de l'utilisatrice (licence comprise : même situation que les Schtroumpfs) : entrée `asterix` dans `src/games/registry.ts` (accueil, adresse `#/asterix`) et section du `README.md`.

## Ce que l'étude a établi

**Parenté avec les Schtroumpfs (vérifié).** `SMURF.EXE` contient encore un chemin d'Astérix (`?:\mdf\52\m52d4.mcg`) ; 205 chaînes communes (messages système en 7 langues, erreurs `E02`-`E10`, `InitMcga`, `MIX DISK/MEM/EMM`). Sur ~105 Ko de code hors bibliothèque Borland : 30,7 Ko identiques à 95 % ou plus (décodeur MUX, sprites HY8, police PFN, chargeur MCG, pilote Sound Blaster, CD, fichiers, mémoire, erreur fatale), 9 Ko proches (lecteur MUX, fondus, EMS, mélange des bruitages), **~65 Ko sans équivalent** : `main`, boucle principale, menus, plateau, tous les mini-jeux (segments `1abf` à `288f`). Propres à Astérix : chargeur MCC (`135a`), lecteur MUK (`19b9`), segment `2d7b` non identifié.

**Lecteurs des Schtroumpfs sur les fichiers d'Astérix (vérifié, test jetable).**

| Format | Nb | Résultat | Reste à faire |
|---|---|---|---|
| VOC | 736 | 736/736 | rien |
| MCG | 106 | 106/106 | rien |
| PAL, PFN | 1, 4 | tous | rien |
| MUX | 117 | 116/117 | `07/M07A.MUX` finit par des blocs `05` vides au lieu d'un `04` : tolérance |
| HY8 | 30 | 29/30 | partie de type 5 (`32/M32SA000.HY8`), code identique dans `SMURF.EXE` `31fe:0481` |
| MUK | 31 | 31/31 avec un lecteur d'essai | lecteur à écrire (enregistrements `u8` type : 0 = u16, 1 = palette, 2 = bloc vidéo MUX) ; second `u32` et type 0 inconnus |
| MCC | 80 | décodé par l'inventaire | lecteur à écrire (palette + paires couleur, longueur) |
| Quiz `M40*.TXT`, générique `M47.DAT` | 10 | lus | lecteurs à écrire (format différent du quiz des Schtroumpfs) |

**Poids.** Les fichiers d'origine pèsent 184 Mo (MUX 103, VOC 66, MUK 10, MCG 7). `dist/` pèse déjà **954 Mio**, au plafond de GitHub Pages (1 Go annoncé). Astérix converti pèse 50 à 65 Mo (mesuré) : **il faut libérer de la place avant de le publier** (D3).

## Décisions (validées le 17/11/2026)

| N° | Question | Recommandation | Faits et conséquences |
|---|---|---|---|
| D1 | **Mutualisation avec les Schtroumpfs** | **Extraire le moteur générique vers `src/engine/infogrames/` avant tout code d'Astérix**, en trois temps : (1) déplacement pur ; (2) injection de ce qui est propre au jeu (résolveur de chemins à la place de `engine/paths.ts`, `BEEP_FILES`, `ParentOptions` sorti de `SceneContext`) ; (3) ajouts d'Astérix (MCC, MUK, HY8 type 5, fin de MUX tolérante). | ~3 000 lignes génériques (`data/` mux, hy8, mcg, voc, font ; `engine/` surface, sprites, palette, clock, rng, video, picture, resources, scene, input, effect-wait, host, engine ; `audio/` ; `ui/` browser-host, render, prefs). Précédents : `src/engine/coktel/`, `delphine/`, `mohawk/`. **Touche les Schtroumpfs** : chaque temps se termine par leurs tests inchangés (~2 800 lignes sur le moteur et les formats, hachages de pixels MUX compris, plus le parcours complet). Le rendu et le son réels dans le navigateur ne sont pas couverts par ces tests : recette navigateur des Schtroumpfs après le temps 2. Alternatives écartées : Astérix qui importe `src/games/teleportaschtroumpf/` (dépendance entre jeux) ; copie (deux moteurs à maintenir). |
| D2 | **Médias versionnés** | **Convertis**, pas tels quels : voix, musiques et bruitages VOC en MP3 32 kb/s (via `ec_encoder_voix`, déjà utilisé par FOTAQ et GK1) ; images MCG et MCC gardées telles quelles (8,6 Mo) ; **vidéos MUX et MUK réencodées sans perte** dans un conteneur maison (images indexées en différence avec la précédente, compressées en LZMA, palette et transparence magenta intactes), avec leur son en MP3 à part, calé sur l'horloge de la vidéo ; HY8, PFN, TXT, DAT tels quels. | Les fichiers d'origine (184 Mo) ne tiennent pas. Poids mesuré : son ~21 Mo, vidéo ~20 Mo (LZMA) + MUK 5-10 Mo, images et reste ~10 Mo : **~55 à 60 Mo**. La vidéo avec perte (H.264, VP9) est écartée : plus lourde (21 à 28 Mo) et elle casse la couleur de transparence des calques. **Décodeur LZMA écrit en TypeScript** (~400 lignes, format public), pas de nouvelle dépendance ; variante plus simple mais plus lourde : `DecompressionStream("deflate")` natif (~49 Mo de vidéo, ~85 Mo au total : ne tient pas). Conséquence : `engine/video.ts` tire aujourd'hui le son des blocs MUX ; il lira aussi le conteneur (les Schtroumpfs gardent leurs MUX). |
| D3 | **Place sur le site** | **Convertir les VOC des Schtroumpfs en MP3** (82 Mo → ~20 Mo), avant de publier Astérix. | Seul levier qui libère assez de place sans toucher à la qualité visible (~60 Mo). Il faut un index des durées exactes des sons (le moteur attend la fin d'un VOC). **Touche les Schtroumpfs** : même filet que D1, plus une écoute. Autres leviers possibles plus tard : voix de GK1 (24 kb/s déjà), vidéos d'autres jeux. |
| D4 | **Données versionnées** | `original/asterix/` : `ASTERIX.EXE` (153 Ko, lu pour ses tables, jamais exécuté, comme `TIMWIN.EXE` pour TIM3), les médias convertis de D2 rangés par module (`MDF/NN/…`), le quiz, le générique, les polices, `COVER.webp`, `files.json`. Écartés : `OUTLINE/` (installeur d'un émulateur Minitel sans rapport), `LISEZMOI.EXE`, DOSBox et ses fichiers, `Lisez-Moi.txt` d'Abandonware France. | Les tables de l'exe (noms de fichiers, positions, vitesses, probabilités) sont lues à l'exécution plutôt que recopiées, quand c'est possible. |
| D5 | **Interface** | **Celle des Schtroumpfs**, mise en commun avec le moteur (D1) : jeu en 320 × 200 agrandi, souris, toucher, clavier. Le joystick n'est pas porté (souris et clavier suffisent ; à revoir si un mini-jeu en dépend). | Les libellés de l'interface sont dessinés dans les images d'origine : rien à traduire. Les textes du site (titre, aide, contrôles) vont dans `copy.ts`, en français, sans validation préalable (règle du projet). |
| D6 | **Reprise de partie** | **Sauvegarde automatique au début de chaque tour**, dans le stockage du navigateur, avec « Continuer » sur l'écran titre ; écart documenté à l'original, qui n'a pas de sauvegarde. | Même adaptation que les Schtroumpfs (sauvegarde au début de chaque tour). Une partie dure de 30 à 120 minutes. |
| D7 | **Nombre de joueurs et règles** | Établis par le désassemblage, puis recoupés avec le manuel. | Les sources se contredisent (1 à 4 ou jusqu'à 6 joueurs). Le manuel (`man-…rar`, RAR solide) demande `unar` (`brew install unar`, outil local hors projet) : **à installer avec ton accord**. |
| D8 | **Jeux d'ambiance hors écran** | Portés tels quels : le jeu annonce l'épreuve et les joueurs désignent eux-mêmes le gagnant. | Fidèle à l'original ; l'aide du site explique le principe. |
| D9 | **Menu de débogage, triche, langues** | Non portés : le menu `FRANCAIS/ALLEMAND/…`, `CheatMode`, `JOYSTICK` est caché dans l'original et seules les données françaises existent. La langue est fixée au français. | Documenté dans `engine.md`. |
| D10 | **Banc de comparaison** | **DOSBox-X** (déjà installé) avec un dossier de jeu dans le scratchpad : captures et mesures pour les cas ambigus (vitesses, probabilités, difficulté des mini-jeux). | Comme pour l'enveloppe de GK1 : sondes ciblées, jamais de modification du dépôt. |
| D11 | **Clic et toucher directs** | **Ajoutés**, comme pour les Schtroumpfs : un clic ou un toucher sur un élément (bouton, case de réglage, réponse du quiz, dé) équivaut à y aller aux flèches puis à valider. Écart documenté. | L'exe DOS ne teste aucune position : tout passe par les directions et la validation (`engine.md`). Le manuel Mac décrit le clic direct. Sans lui, le jeu est injouable au doigt. |
| D12 | **Aide au clic droit** | **Muette, comme l'original** : les 24 voix de `MDF/45` restent inutilisées. | Le code existe mais sort en mode 2 (`135a:02ac`) : l'aide n'a jamais été audible dans cette version. |
| D13 | **Mémoires gardées entre deux parties** | **Conservées tant que la page reste ouverte**, comme l'original le fait entre deux parties d'une même séance (`DS:7592`, `7182`, `2aa6`…) ; remises à zéro au rechargement. | Fidèle, sans effet visible à documenter de plus. |

## Vagues

| Vague | Contenu | Livre | Validation |
|---|---|---|---|
| **0** (faite) | Étude, comparaison avec `SMURF.EXE` | ce plan | — |
| **A** | Extraction et formats | `scripts/asterix-extract.sh` (+ `scripts/asterix/`), `original/asterix/`, `docs/asterix/formats.md`, `files.md` ; lecteurs MCC, MUK, quiz, générique ; conteneur vidéo et décodeur LZMA (D2) | tous les fichiers lus jusqu'au dernier octet ; hachages de pixels sur un échantillon ; visionneuse de dev (images, sprites, vidéos, sons) inspectée à l'œil |
| **B** | Mutualisation (D1) puis place (D3) | `src/engine/infogrames/`, Schtroumpfs rebranchés, VOC des Schtroumpfs en MP3 | tests des Schtroumpfs inchangés et verts à chaque temps ; recette navigateur des Schtroumpfs |
| **C** | Désassemblage du socle d'Astérix | Ghidra headless adapté (`scripts/asterix/re/`, sorties dans `archives/asterix/re/`), `docs/asterix/engine.md`, `re-index.md` : `main`, boucle, table des modules, menus, réglages, plateau, règles (dés, cases, objets, durée, fin) | chaque règle citée par son adresse ; niveau de confiance (sûr, probable, hypothèse) |
| **D** | Jeu jouable sans mini-jeux | titre, réglages, choix des joueurs, plateau, déplacements, cases spéciales, quiz, fin de partie, carte et score ; mini-jeux remplacés par un écran provisoire | parcours sans tête d'une partie complète ; recette navigateur |
| **E** (faite) | Mini-jeux, un par un, selon le gabarit `minigames/README.md` | un module par mini-jeu (`scenes/minigames/mNN.ts`), avec ses tables et ses trois difficultés ; sa fiche `minigames/mNN.md` | test par mini-jeu (victoire, défaite, chaque difficulté) ; parcours du robot ; comparaison DOSBox-X pour les vitesses ambiguës |
| **F** (faite) | Publication | jaquette, manuel et carte du jeu, écran de présentation, aide et crédits, section du README, inscription dans `src/games/registry.ts` (publié le 18/11/2026) | `npm test`, `typecheck`, `build`, poids de `dist/` sous la limite ; recette navigateur complète, téléphone compris |

Les mini-jeux de la vague E sont indépendants les uns des autres : un sous-agent par mini-jeu, jamais deux sur les mêmes fichiers.

## Requis, naturellement lié, optionnel

- **Requis** : vagues A à F ; D3 (sans place libérée, Astérix ne peut pas être publié).
- **Naturellement lié** : la mutualisation D1, qui évite un second moteur à maintenir ; la mise à jour de `docs/teleportaschtroumpf/` pour pointer vers le moteur commun.
- **Optionnel, à part** : le joystick ; la lecture du manuel si le désassemblage suffit ; réutiliser les outils de `scenes/minigames/common.ts` des Schtroumpfs (au cas par cas, une fois les mini-jeux d'Astérix désassemblés).

## Cas limites

- `07/M07A.MUX` sans bloc de fin ; `M49DA005.MCC` qui déborde de 14 pixels ; MCC de 1 280 octets (aplats).
- Calques MUX à fond magenta ou noir composés sur un décor : la couleur de transparence doit survivre à la conversion (d'où le sans-perte).
- Marqueurs MUX de type `08` (202 occurrences, rôle supposé : repères de boucle ou d'attente pour le code) : à établir en vague C avant de les ignorer.
- Fréquences audio variées (5 800 à 19 230 Hz dans les MUX ; 11 111 à 19 231 Hz dans les VOC) : durées exactes conservées dans l'index (le moteur attend la fin des sons).
- Partie à 1 joueur et au nombre maximal de joueurs ; abandon en cours de partie ; reprise après rechargement de la page au milieu d'un mini-jeu (on reprend au début du tour).
- Quiz : caractères CP850 accentués ; plusieurs réponses justes possibles (`réponse1,réponse2,réponse3/bonne`).

## Risques

1. **Désassemblage 16 bits Borland sans symboles** (~65 Ko) : décompilation Ghidra bruitée (segments, pointeurs far). Atténuation : la méthode et les outils des Schtroumpfs (`docs/teleportaschtroumpf/engine-ts.md` § lecture de la décompilation), les ~40 Ko du socle déjà compris par transfert.
2. **Régression des Schtroumpfs** (D1, D3) : un jeu publié et complet. Atténuation : déplacement d'abord sans changement de comportement, tests inchangés à chaque temps, recette navigateur.
3. **Poids** : marge nulle aujourd'hui. Si D3 ne suffit pas, il faudra un autre levier avant la vague F.
4. **Synchronisation son-image** une fois le son des MUX sorti du conteneur (D2) : caler sur l'horloge audio, tester sur les vidéos parlées (Panoramix).
5. **Licence** : Astérix (Éditions Albert René) est une licence encore exploitée, comme les Schtroumpfs déjà publiés. À considérer avant publication (vague F).

## Estimation

~65 Ko de code de jeu neuf, soit **10 000 à 12 000 lignes de TypeScript** (repère des Schtroumpfs : ~170 lignes par Ko de code désassemblé), plus ~1 000 lignes pour les lecteurs, le conteneur vidéo et le décodeur LZMA, plus la mutualisation. Ordre de grandeur : deux tiers de l'effort des Schtroumpfs (22/10 au 14/11/2026).

## Validation (à chaque vague)

`npm run typecheck`, `npm test`, `npm run build` (sorties redirigées et filtrées) ; tests propres à la vague ; pour toute vague visible, recette dans le navigateur (`preview_start`) ; ce qui n'a pas pu être vérifié est dit.
