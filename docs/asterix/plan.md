# Astérix : le défi de César : plan d'implémentation

Jeu : *Astérix : le défi de César* (Infogrames Multimedia, réalisation Bertrand Brocard ; adaptation PC IKOS S.A. ; Philips et Pathé, 1995), **version CD DOS française, voix françaises** (`ASTERIX.EXE` « Version 2.5 », « May 30 1995 », MD5 `0b826e68e191b7c25d4416d2d824681d`), identifiant `asterix`. Source : `archives/asterix/` (non versionnée ; le 7z et l'installeur Inno Setup contiennent les mêmes 1 163 fichiers, octet pour octet).
Jeu de plateau de 50 cases dans l'esprit du jeu de l'oie : César défie les Gaulois de rapporter un souvenir de chaque province. Six personnages (Astérix, Obélix, Bonemine, Agecanonix, Falbala, Goudurix), réglages de durée (30 à 120) et de nombre d'objets (3 à 9), difficulté par joueur sur deux axes (réflexion, action). Les cases mènent à une quinzaine de mini-jeux d'action, des jeux d'observation, un jeu de pari, un quiz par pays et des jeux d'ambiance hors écran annoncés par Panoramix.

Ce document est le brief commun aux sous-agents. Les références font foi dans cet ordre : `formats.md`, `engine.md` (à écrire en vague B), puis ce plan. **Il n'existe aucune implémentation de référence** : la référence de comportement est le désassemblage de `ASTERIX.EXE` (décision de l'utilisatrice du 17/11/2026 : « désassemblage exact »), vérifié au besoin contre l'original sous DOSBox-X.

## Avancement

- **Étude faite** (vague 0, 17/11/2026), hors dépôt, rien exécuté :
  - inventaire des fichiers et des formats (notes : `scratchpad/asterix/inventaire.md`, à reverser dans `formats.md` en vague A) ;
  - comparaison avec `SMURF.EXE` (*Le Téléportaschtroumpf*, déjà porté dans `src/games/teleportaschtroumpf/`) : **même moteur**, Astérix en est l'ancêtre direct (notes : `scratchpad/asterix/comparaison.md`, Ghidra headless dans `scratchpad/asterix/re/`).
- **Verdict : portage moyen-gros, environ deux tiers de l'effort des Schtroumpfs.** Le socle est déjà écrit ; le poste dominant est le désassemblage d'environ 65 Ko de code de jeu propre à Astérix.
- **Décisions prises par l'utilisatrice** : portage par désassemblage exact (17/11/2026) ; **D1 à D10 validées le 17/11/2026**, telles que recommandées.
- Vague A (formats et extraction) et premier temps de la vague B (déplacement pur du moteur commun) lancés en parallèle le 17/11/2026.

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

## Vagues

| Vague | Contenu | Livre | Validation |
|---|---|---|---|
| **0** (faite) | Étude, comparaison avec `SMURF.EXE` | ce plan | — |
| **A** | Extraction et formats | `scripts/asterix-extract.sh` (+ `scripts/asterix/`), `original/asterix/`, `docs/asterix/formats.md`, `files.md` ; lecteurs MCC, MUK, quiz, générique ; conteneur vidéo et décodeur LZMA (D2) | tous les fichiers lus jusqu'au dernier octet ; hachages de pixels sur un échantillon ; visionneuse de dev (images, sprites, vidéos, sons) inspectée à l'œil |
| **B** | Mutualisation (D1) puis place (D3) | `src/engine/infogrames/`, Schtroumpfs rebranchés, VOC des Schtroumpfs en MP3 | tests des Schtroumpfs inchangés et verts à chaque temps ; recette navigateur des Schtroumpfs |
| **C** | Désassemblage du socle d'Astérix | Ghidra headless adapté (`scripts/asterix/re/`, sorties dans `archives/asterix/re/`), `docs/asterix/engine.md`, `re-index.md` : `main`, boucle, table des modules, menus, réglages, plateau, règles (dés, cases, objets, durée, fin) | chaque règle citée par son adresse ; niveau de confiance (sûr, probable, hypothèse) |
| **D** | Jeu jouable sans mini-jeux | titre, réglages, choix des joueurs, plateau, déplacements, cases spéciales, quiz, fin de partie, carte et score ; mini-jeux remplacés par un écran provisoire | parcours sans tête d'une partie complète ; recette navigateur |
| **E** | Mini-jeux, un par un | un module par mini-jeu (`scenes/minigames/mNN/`), avec ses tables et ses trois difficultés | test par mini-jeu (victoire, défaite, chaque difficulté) ; comparaison DOSBox-X pour les vitesses |
| **F** | Publication | entrée dans `src/games/registry.ts`, `README.md`, jaquette, aide | `npm test`, `typecheck`, `build`, poids de `dist/` sous la limite ; recette navigateur complète, téléphone compris |

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
