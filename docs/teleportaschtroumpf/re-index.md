# SMURF.EXE : index de rétro-ingénierie

Décompilation de `original/teleportaschtroumpf/SMURF.EXE` (MZ DOS 16 bits real mode, Borland C++ 1991, modèle large, 191 130 octets) avec Ghidra en mode headless. Ce document est le point d'entrée des tâches qui étudient une scène : il dit quelles fonctions chargent les fichiers de chaque scène, et comment lire le corpus.

Les blocs entre `<!-- GEN:... -->` sont réécrits par `run.sh`. Le reste est écrit à la main.

## Régénérer

```bash
bash scripts/teleportaschtroumpf/re/run.sh
```

- Prérequis : `brew install ghidra`. La formule installe aussi un JDK (`openjdk@25` pour Ghidra 12.2 ; le script cherche `openjdk@21`, puis `openjdk@25`). Aucun autre outil.
- Durée : environ 30 s à froid. Le script est idempotent (`-overwrite`) et ne demande rien.
- Le paquet Homebrew de Ghidra ne contient pas le binaire du décompileur natif (`Ghidra/Features/Decompiler/os/<plateforme>/decompile`). `run.sh` le compile depuis les sources fournies (une fois, environ 15 s, avec `make` et un compilateur C++ : les outils de ligne de commande Xcode suffisent) et le copie dans l'installation de Ghidra.
- Les sorties sont dans `archives/teleportaschtroumpf/re/` (ignoré par git) :

| Fichier | Contenu |
|---|---|
| `decomp/<seg>_<off>_<nom>.c` | une décompilation C par fonction ; en-tête : taille, appelants, appelés, chaînes référencées |
| `functions.tsv` | adresse, nom, type (`func`, `lib`, `rtl`, `fragment`), taille, nb d'instructions, appelants, appelés, état de la décompilation, fichier |
| `strings.tsv` | adresse DGROUP, longueur, chaîne, fonctions référentes (`seg:off/type`) |
| `libfuncs.tsv` | fonctions de bibliothèque nommées, avec la preuve de l'identification |
| `disasm.txt` | listing désassemblé complet, avec noms de fonctions cibles et chaînes en commentaire |
| `project/` | projet Ghidra (`smurf`), ouvrable dans l'interface (`ghidraRun`) |
| `run.log` | journal complet de Ghidra |

Les scripts sont dans `scripts/teleportaschtroumpf/re/` : `SetDS.java` (avant l'analyse), `SeedFunctions.java`, `ExportStrings.java`, `IdentifyLibs.java`, `ExportDecompiled.java`, `ExportDisasm.java`, l'utilitaire `ReCommon.java` et `make_index.py` (met à jour ce document).

## Statistiques

<!-- GEN:stats -->
- Outils : ghidra 12.2 ; JDK : openjdk version "25.0.5" 2026-10-20.
- Durée de la dernière régénération : 18 s.
- Fonctions : 701 (code Ghidra), 151510 octets (96.6 % des 156768 octets de code avant DGROUP).
- Types : fragment 29, func 539, lib 33, rtl 100.
- Décompilation : 689 ok (98.3 %), 10 partielle (code illisible pour Ghidra par endroits), 2 en erreur.
- Fonctions de bibliothèque nommées avec certitude : 33 (+ 1 probable, non renommée). 100 fonctions du segment `1000` restent du code Borland non identifié (type `rtl`).
- Chaînes dans DGROUP : 713 ; référencées par au moins une fonction : 708. Références heuristiques par type : imm 749.
- Décompilation en erreur (utiliser `disasm.txt`) : `1fc6:0008`, `1fc6:0407`.
- Décompilation partielle : `26ee:027e`, `3559:00e8`, `28a3:0474`, `3134:021b`, `3134:0286`, `3134:0200`, `348d:000a`, `3134:0281`, `1000:1585`, `3134:027e`.
- Image : 191130 octets, en-tête 16896 octets, DGROUP = segment `3646`.
<!-- /GEN:stats -->

## Comment l'analyse a été faite (et ses limites)

Ghidra seul donne un mauvais résultat sur cet exécutable. Les scripts corrigent ce qui peut l'être :

- **DS = DGROUP.** Le startup Borland charge DS avec le segment de données (`3646`) et ne le change plus. `SetDS.java` le fixe sur toute la mémoire avant l'analyse.
- **Analyseurs désactivés.** « Non-Returning Functions - Discovered », « Decompiler Switch Analysis » et « x86 Constant Reference Analyzer » coupent le désassemblage, créent des références fausses et des « données » dans le code.
- **Fonctions non atteintes.** L'auto-analyse laissait plus de la moitié du code non désassemblée. `SeedFunctions.java` amorce des fonctions à partir des `CALL FAR`, des pointeurs de fonction et des prologues Borland (`push bp / mov bp,sp`, `enter`), et suit les flux après les appels.
- **Switch.** Le compilateur génère `CMP BX,n ; JA défaut ; SHL BX,1 ; JMP CS:[BX+table]`. Ghidra lit ces tables avec le mauvais segment. Le script les relit, pose les références et déclare la table au décompileur. Les fonctions `frag_*` sont des morceaux de code atteints seulement par une table (corps de `case`) ou une pile de blocs sans prologue. Leur fonction parente est en général la fonction précédente dans l'ordre des adresses.
- **Références aux chaînes.** Ghidra ne les voit pas (DS + offset immédiat). `ExportStrings.java` parcourt toutes les instructions et associe tout `PUSH`/`MOV`/`LEA` dont la constante 16 bits est l'offset d'une chaîne de DGROUP à la fonction qui le contient (type `imm`), ainsi que les accès mémoire absolus (`mem`) et les tables de pointeurs de chaînes (`table`). Ces références sont **heuristiques** : un offset inférieur à `0x200` n'est retenu que près d'un `PUSH DS`, pour éviter de confondre une constante avec une chaîne. Des chaînes mal découpées ou référencées autrement (calcul d'offset, pointeur construit à l'exécution) peuvent manquer.
- **Bibliothèque Borland.** Pas de signatures FLIRT pour ce compilateur. 33 fonctions (`lib_*`, voir `libfuncs.tsv`) sont identifiées à la main et renommées. Le segment `1000` contient le startup et la bibliothèque ; le reste de ce segment est de type `rtl` (Borland, non identifié). Le code du jeu est dans les segments `12d7` à `3637`.

## Fonctions clés

Adresses `segment:offset` (celles des noms de fichiers de `decomp/`). Les rôles viennent des chaînes et des appels, vérifiés dans la décompilation ; « probable » indique une déduction moins sûre.

| Adresse | Rôle |
|---|---|
| `1000:0000` `entry` | startup Borland : charge DS = `3646`, redimensionne le bloc DOS, appelle `main` |
| `305a:016c` | `main(argc, argv)` : détecte l'EMS (`12ec:0008`), exige 512 Ko d'EMS et 540 Ko de RAM (messages `SMURF : mémoire EMS minimum...`), lit `c:\smurf.cfg`, appelle l'init `154c:052e`, le chargeur `154c:000f` et la boucle `21ee:0006` ; message de fin `Merci d'avoir joué...` |
| `21ee:0006` | boucle principale (appelée par `main`) : tire une voix `s52m00%dm.voc`, charge `s07a001b.voc`, appelle le menu `21ee:0e8f` (renvoie un choix de 0 à 10) puis un `switch` vers les écrans : `21ee:1246`, `21ee:12c2`, le plateau `1a3c:002a`, le menu parents `21ee:13a1` (s04)... |
| `1a3c:002a` | plateau de jeu : affiche la carte (`1a3c:0225`, s02), tire le prochain mini-jeu (numéro de scène 22 à 51 dans une globale), appelle `28a3:04dc` (voix d'introduction `sNNa`) puis la fonction principale du mini-jeu par la table `CS:1a3c:01c7` : voir `scene_entries.tsv` et la table des scènes. Seules les scènes 22 à 36, 40 et 51 passent par là ; les autres (38, 39, 41, 42, 45, 46, 49...) sont lancées depuis d'autres appelants (`functions.tsv`, colonne appelants) |
| `134d:029b` | résolution des chemins : essaie `%c:\data\jeu_%c\%s`, puis `%c:\data\jeu_f\%s`, puis `d:\projet\smurf\data\jeu_%c\%s` ; `134d:03af` l'appelle pour tous les chargeurs |
| `134d:0822` | charge un fichier entier par son nom (40 appelants) ; erreur fatale `%s load error.` ; `134d:088b` fait la même chose en EMS (`EMM Error : %s`) |
| `134d:0529` | charge une image MCG fixe `?:\mdf\52\m52d4.mcg` (2 octets, palette de 0x300 octets, 64 000 octets de pixels) |
| `13fc:0084` | chargeur MCG : nom, tampon de palette (`3646:57c0`), tampon d'image ; lit 2 octets, 0x300 octets de palette puis l'image (20 appelants) |
| `13fc:0150` | affiche un MCG avec options (drapeaux : fondu avant/après via `1523:00ee` / `1523:01fa`) |
| `154c:000f` | charge `%s0.mcg` (préfixe de scène passé à `sprintf`), lit 2 + 0x300 + 64 000 octets, puis construit `%s.mux` et le passe à `179a:0673` |
| `179a:0673` | lecteur de fichier MUX (très probable) : ouvre le fichier, alloue deux tampons (0x5000 ou 0xf000), boucle de décodage par pointeurs de fonction ; le drapeau `0x8000` boucle la lecture |
| `154c:052e` | initialisation : alloue 64 000 octets, charge `s52d001d.mcg`, `s52d3.pfn`, `s52d2.pfn`, `s52dsphi.doc`, `s52m002m.voc` (`Mem Error.`) |
| `154c:0954` | enveloppe de `179a:0673` (lecture MUX), appelée 35 fois, parfois avec un préfixe de scène (`s40a`) |
| `154c:07c2` / `154c:097b` | lecture MUX avec options (drapeaux `0x4000`, `0x1000`...) ; `154c:097b` tire deux lettres au hasard (`lib_rand`) pour construire `s42%c.mux`, puis lance `154c:07c2` |
| `15f9:0db1` | fabrique le nom d'une voix numérotée `%s%dt.voc` (rembourre avec des zéros selon le nombre) |
| `15f9:089f` | `MyNoise()` : gestion des sons (sources DISK, MEM, EMM), 42 appelants, très utilisée dans les boucles d'attente ; `15f9:00ca` (`my_lseek error`) et `15f9:0755` (`MIX EMM(%d)`) sont dans le même module |
| `16f5:0003` | initialisation du CD-ROM et de la carte son (messages multilingues `Dysfonctionnement du CDROM.`, `(n)sound card problems`) |
| `23c9:0dbd` | chargeur de la mine : `%s.mut` (`Load .mut error !`) et `%s.prc` (`file.prc error`) ; appelé par `23c9:0004` |
| `336a:01a8` | pilote audio (module `336a` à `3559`) : messages `E02: Read or I/O`, `E03: Memory`, `E07: Signature`, `E09: Sound card function`, `E10: Sound card setup invalid` |
| `12ec:0008` ... | gestion de l'EMS (`EMMXXXX0`) ; `12ec:0230` / `12ec:02d1` / `12ec:0314` : accès aux pages EMS (probable) |
| `35f2:0004`, `35bc:0039`, `35bc:0199`, `35bc:0233` | ouvrir (INT 21h 3Dh), ouvrir/lire (3Fh) et fermer (3Eh) un fichier ; `35bc:0199(handle, tampon far, taille, ...)` est le lecteur de base |
| `35f5:000e`, `35f5:006b`, `35f5:0083` | allocation, libération et redimensionnement de mémoire DOS (INT 21h 48h, 49h, 4Ah) |
| `1764:000a` | erreur fatale : `vsprintf` du message, affichage `%s\n`, sortie avec le code `0xffff` (appelée avec `No EMS.`, `%s load error.`, `Mem Error.`) |
| `1000:2473` `lib_sprintf` | 42 appels avec un format ; à rechercher avec `grep lib_sprintf` pour voir les motifs de noms de fichiers |

Chargeurs par extension, repérés par leurs motifs de noms (`grep` dans `strings.tsv`) :

- MCG : `13fc:0084` / `13fc:0150` (générique), `154c:000f` (fond `%s0.mcg`), motifs `sNNa00%dd.mcg` dans le code propre à chaque scène.
- MUX : `179a:0673` (lecteur), `154c:097b` (`s42%c.mux`), `265b:000d` (`s39%s.mux`).
- VOC : nom construit par `15f9:0db1` ; lecture par le module son `15f9` et le pilote `336a`.
- HY8 : 36 noms `sNNaNNNs.hy8` référencés directement par le code de chaque scène (pas de chargeur générique repéré dans cette étude).
- MUT / PRC : `23c9:0dbd` (scène de la mine).
- PFN : `154c:052e` (`s52d3.pfn`, `s52d2.pfn`) ; `s52d001f.pfn` n'a pas de référence trouvée.

## Table scène → fonctions

Un nom de fichier `sNNxXXX.ext` est sur disque dans `DATA/SNN/SNNx/SNNXXX.EXT` (majuscules) : la 4e lettre donne le sous-dossier. Une scène est reliée à une fonction si celle-ci référence (heuristique, voir plus haut) une chaîne commençant par `sNN`. Les chaînes sans préfixe de scène (`%s0.mcg`, `%s.mux`, `%s%dt.voc`) sont dans des chargeurs génériques (voir plus haut) qui reçoivent le préfixe en paramètre.

<!-- GEN:scenes -->
Couverture : 46 scènes sur 46 ont au moins une fonction trouvée.

#### s01 : Plateau de Jeu

Segment(s) de code : `26ee` (11 fonction(s), 4517 o), `28a3` (11 fonction(s), 1969 o), `291e` (6 fonction(s), 5323 o), `305a` (8 fonction(s), 1087 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `26ee:006a` | 498 | ok | s01v |
| `28a3:00ad` | 967 | ok | s01b.mux, s01c.mux |
| `291e:000e` | 1011 | ok | s01a000s.hy8, s01a001s.hy8 |
| `291e:125c` | 406 | ok | s01a00%dd.mcg |
| `305a:0008` | 105 | ok | s01a001b.voc, s01a002b.voc |

Segment partagé avec s11, s16, s18, s20, s21, s22 (+19) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s02 : La Carte du Pays Schtroumpf

Segment(s) de code : `1a3c` (3 fonction(s), 3128 o), `1fc6` (12 fonction(s), 6043 o), `265b` (1 fonction(s), 968 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1a3c:0225` | 2676 | ok | s02a000s.hy8, s02a001d.mcg, s02a002d.mcg, s02a004d.mcg, s02a005d.mcg, s02a006d.mcg, s02a007d.mcg |
| `1fc6:085f` | 893 | ok | s02a000s.hy8, s02a004d.mcg, s02a005d.mcg, s02a006d.mcg |
| `265b:000d` | 968 | ok | s02a00%dd.mcg |

Segment partagé avec s03, s07, s13, s25, s38, s39 (+1) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s03 : Ecran Info

Segment(s) de code : `1e20` (2 fonction(s), 801 o), `1fc6` (12 fonction(s), 6043 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1e20:0007` | 629 | ok | s03a000s.hy8, s03a001d.mcg |
| `1fc6:0c20` | 2880 | ok | s03a000s.hy8 |

Segment partagé avec s02, s38, s45 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s04 : Menu Parents

Segment(s) de code : `21ee` (14 fonction(s), 7484 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `21ee:13a1` | 2289 | ok | s04a000s.hy8, s04a001d.mcg |

Segment partagé avec s05, s06, s07, s08, s09, s10 (+2) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s05 : Titre

Segment(s) de code : `21ee` (14 fonction(s), 7484 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `21ee:0191` | 65 | ok | s05a.mcg, s05asphi.mux |

Segment partagé avec s04, s06, s07, s08, s09, s10 (+2) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s06 : Introduction

Segment(s) de code : `21ee` (14 fonction(s), 7484 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `21ee:12c2` | 61 | ok | s06a.mux |

Segment partagé avec s04, s05, s07, s08, s09, s10 (+2) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s07 : Menu Principal

Segment(s) de code : `1823` (5 fonction(s), 5990 o), `1a3c` (3 fonction(s), 3128 o), `2143` (4 fonction(s), 2733 o), `21ee` (14 fonction(s), 7484 o), `269a` (1 fonction(s), 1321 o), `2daf` (2 fonction(s), 2933 o), `2ee8` (2 fonction(s), 2519 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1823:000c` | 1009 | ok | s07a001b.voc |
| `1823:0415` | 2423 | ok | s07a001b.voc |
| `1823:0da4` | 125 | ok | s07a001b.voc |
| `1a3c:0225` | 2676 | ok | s07a001b.voc |
| `2143:0009` | 452 | ok | s07a001b.voc |
| `21ee:0006` | 373 | ok | s07a001b.voc |
| `21ee:0e8f` | 907 | ok | s07a001d.mcg, s07v |
| `21ee:13a1` | 2289 | ok | s07a001b.voc |
| `269a:0007` | 1321 | ok | s07a001b.voc |
| `2daf:0006` | 2722 | ok | s07a001b.voc |
| `2ee8:000d` | 2401 | ok | s07a001b.voc |

Segment partagé avec s02, s04, s05, s06, s08, s09 (+10) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s08 : Menu Personnages et Niveaux

Segment(s) de code : `21ee` (14 fonction(s), 7484 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `21ee:0006` | 373 | ok | s08a000s.hy8 |
| `21ee:0435` | 2000 | ok | s08a001b.voc, s08a001d.mcg, s08a002b.voc, s08v |
| `21ee:0c19` | 630 | ok | s08v |

Segment partagé avec s04, s05, s06, s07, s09, s10 (+2) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s09 : Menu Temps et Mission

Segment(s) de code : `21ee` (14 fonction(s), 7484 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `21ee:01d2` | 611 | ok | s09a000s.hy8, s09a001d.mcg, s09v |

Segment partagé avec s04, s05, s06, s07, s08, s10 (+2) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s10 : Règles du Jeu

Segment(s) de code : `21ee` (14 fonction(s), 7484 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `21ee:1246` | 30 | ok | s10a.mux |

Segment partagé avec s04, s05, s06, s07, s08, s09 (+2) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s11 : Fin Gagnante

Segment(s) de code : `28a3` (11 fonction(s), 1969 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `28a3:0080` | 41 | ok | s11a.mux |

Segment partagé avec s01, s22, s23, s24, s25, s26 (+14) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s13 : Le Puits Aux Voeux

Segment(s) de code : `1a3c` (3 fonction(s), 3128 o), `2a78` (13 fonction(s), 5523 o), `2daf` (2 fonction(s), 2933 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1a3c:0225` | 2676 | ok | s13b |
| `2a78:0480` | 613 | ok | s13a.mux, s13b.mux |
| `2a78:0a59` | 762 | ok | s13c.mux, s13d.mux |
| `2a78:1244` | 381 | ok | s13e.mux, s13f.mux |
| `2daf:0006` | 2722 | ok | s13a, s13a000s.hy8, s13b, s13c, s13g.mux, s13g.pal |

Segment partagé avec s02, s07, s14, s15, s16, s17 (+4) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s14 : Le Puits

Segment(s) de code : `2a78` (13 fonction(s), 5523 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `2a78:015f` | 275 | ok | s14a, s14a.mux, s14b.mux |

Segment partagé avec s13, s15, s16, s17, s18, s20 (+1) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s15 : Les Pièges de Gargamel

Segment(s) de code : `2a78` (13 fonction(s), 5523 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `2a78:0480` | 613 | ok | s15a, s15a.mux, s15b.mux |
| `2a78:06e5` | 884 | ok | s15a, s15c.mux, s15d.mux, s15e.mux, s15f.mux |
| `2a78:0a59` | 762 | ok | s15a, s15g.mux, s15h.mux |
| `2a78:0f2f` | 789 | ok | s15a, s15i.mux, s15j.mux, s15k.mux, s15l.mux, s15m.mux, s15n.mux |

Segment partagé avec s13, s14, s16, s17, s18, s20 (+1) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s16 : Le Pont Branlant

Segment(s) de code : `291e` (6 fonction(s), 5323 o), `2a78` (13 fonction(s), 5523 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `291e:0401` | 3467 | ok | s16a001b.voc |
| `2a78:0d53` | 476 | ok | s16a, s16a.mux, s16b.mux |

Segment partagé avec s01, s13, s14, s15, s17, s18 (+4) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s17 : La Fusée du Cosmoschtroumpf

Segment(s) de code : `2a78` (13 fonction(s), 5523 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `2a78:0a59` | 762 | ok | s17a, s17a.mux |

Segment partagé avec s13, s14, s15, s16, s18, s20 (+1) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s18 : Le Lac Glacé

Segment(s) de code : `291e` (6 fonction(s), 5323 o), `2a78` (13 fonction(s), 5523 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `291e:0401` | 3467 | ok | s18a001b.voc |
| `2a78:0480` | 613 | ok | s18a, s18a.mux, s18b.mux |

Segment partagé avec s01, s13, s14, s15, s16, s17 (+4) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s19 : Voix Grand Schtroumpf Ingrédients

Segment(s) de code : `1e52` (11 fonction(s), 2007 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1e52:0324` | 743 | ok | s19v |

Segment partagé avec s42 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s20 : La Prison de Gargamel

Segment(s) de code : `26ee` (11 fonction(s), 4517 o), `2a78` (13 fonction(s), 5523 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `26ee:006a` | 498 | ok | s20v |
| `2a78:0272` | 526 | ok | s20a.mux, s20b.mux, s20c.mux |
| `2a78:06e5` | 884 | ok | s20d.mux, s20e.mux, s20f.mux |
| `2a78:0d53` | 476 | ok | s20g.mux, s20h.mux, s20i.mux |
| `2a78:0f2f` | 789 | ok | s20j.mux, s20k.mux, s20l.mux |
| `2a78:1244` | 381 | ok | s20m.mux, s20n.mux, s20o.mux |

Segment partagé avec s01, s13, s14, s15, s16, s17 (+3) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s21 : Le Turlusiphon

Segment(s) de code : `26ee` (11 fonction(s), 4517 o), `2a78` (13 fonction(s), 5523 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `26ee:006a` | 498 | ok | s21v |
| `2a78:0272` | 526 | ok | s21a.mux, s21b.mux, s21c.mux, s21d.mux, s21v |
| `2a78:06e5` | 884 | ok | s21e.mux, s21f.mux, s21g.mux, s21h.mux, s21v |
| `2a78:0a59` | 762 | ok | s21i.mux, s21j.mux, s21k.mux, s21l.mux, s21v |

Segment partagé avec s01, s13, s14, s15, s16, s17 (+3) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s22 : Le Dragon

Fonction principale : `1c78:0005` (appelée par le dispatcher du plateau `1a3c:002a`, scène 22).

Segment du module : `1c78` (1 fonction(s), 1847 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1c78:0005` | 1847 | ok | s22a000s.hy8, s22a001b.voc, s22a001d.mcg, s22a001s.hy8, s22a002b.voc, s22a003c.voc, s22a004c.voc, s22a005b.voc, s22c1.mux, s22c2.mux |
| `28a3:04dc` | 654 | ok | s22a |

#### s23 : Le Schtroumpf Musicien

Fonction principale : `24d0:000c` (appelée par le dispatcher du plateau `1a3c:002a`, scène 23).

Segment du module : `24d0` (1 fonction(s), 2510 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `24d0:000c` | 2510 | ok | s23a000s.hy8, s23a001b.voc, s23a001d.mcg, s23a002b.voc, s23a003e.voc, s23a004c.voc, s23a005b.voc, s23a006b.voc, s23a007d.voc, s23a008e.voc (+3) |
| `28a3:04dc` | 654 | ok | s23a |

#### s24 : Le Puzzle

Fonction principale : `2e6a:0001` (appelée par le dispatcher du plateau `1a3c:002a`, scène 24).

Segment du module : `2e6a` (1 fonction(s), 2028 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `28a3:04dc` | 654 | ok | s24a |
| `2e6a:0001` | 2028 | ok | s24a0%dd.mcg, s24a00%dd.mcg, s24a000s.hy8, s24a001b.voc, s24a002b.voc, s24b, s24c |

#### s25 : Observation

Fonction principale : `260f:000e` (appelée par le dispatcher du plateau `1a3c:002a`, scène 25).

Segment du module : `260f` (1 fonction(s), 1215 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `260f:000e` | 1215 | ok | s25a%c0%dd.mcg, s25a000s.hy8, s25a000s.pal, s25a001b.voc, s25a002b.voc, s25b, s25c |
| `265b:000d` | 968 | ok | s25a000s.hy8 |
| `28a3:04dc` | 654 | ok | s25a |

#### s26 : Jeu Sonore

Fonction principale : `1ed0:000b` (appelée par le dispatcher du plateau `1a3c:002a`, scène 26).

Segment du module : `1ed0` (1 fonction(s), 1582 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1ed0:000b` | 1582 | ok | s26a0%db.voc, s26a00%db.voc, s26a00%dd.mcg, s26a00%dd.pal, s26a000s.hy8, s26a000s.pal, s26a099b.voc, s26b, s26c |
| `28a3:04dc` | 654 | ok | s26a |

#### s27 : La Luge

Fonction principale : `1f84:000e` (appelée par le dispatcher du plateau `1a3c:002a`, scène 27).

Segment du module : `1f84` (1 fonction(s), 696 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1f84:000e` | 696 | ok | s27a000s.hy8, s27a002b.voc, s27a003b.voc, s27b.mux, s27c1.mux, s27c2.mux, s27e.mux, s27f.mux, s27h.mux, s27i.mux (+2) |
| `28a3:04dc` | 654 | ok | s27a |

#### s28 : Les Schtroumpfs Noirs

Fonction principale : `2573:000f` (appelée par le dispatcher du plateau `1a3c:002a`, scène 28).

Segment du module : `2573` (4 fonction(s), 2478 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `2573:000f` | 1001 | ok | s28a000s.hy8, s28a001d.mcg, s28a001s.hy8, s28a002b.voc, s28a003b.voc, s28b.mux, s28c1.mux, s28c2.mux |
| `28a3:04dc` | 654 | ok | s28a |

Autres fonctions du même segment (même module, taille en octets) : `2573:03f8` (731), `2573:06e3` (715), `2573:09ae` (31)

#### s29 : L'Anniversaire

Fonction principale : `1da0:0009` (appelée par le dispatcher du plateau `1a3c:002a`, scène 29).

Segment du module : `1da0` (2 fonction(s), 2046 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `19a8:0006` | 2365 | ok | s29a002b.voc |
| `1da0:0009` | 2004 | ok | s29a000s.hy8, s29a001b.voc, s29a001d.mcg, s29a002b.voc, s29a003b.voc, s29b.mux, s29c.mux |
| `28a3:04dc` | 654 | ok | s29a |

Autres fonctions du même segment (même module, taille en octets) : `1da0:07dd` (42)

#### s30 : Le Pont de la Rivière Schtroumpfs

Fonction principale : `2d6b:0008` (appelée par le dispatcher du plateau `1a3c:002a`, scène 30).

Segment du module : `2d6b` (2 fonction(s), 1050 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `28a3:04dc` | 654 | ok | s30a |
| `2d6b:0008` | 745 | ok | s30a.mux, s30b, s30c001d.mcg, s30c001s.hy8, s30c001t.voc, s30c002t.voc, s30c003t.voc, s30z.mux |

Autres fonctions du même segment (même module, taille en octets) : `2d6b:02f1` (305)

#### s31 : Les Tortues

Fonction principale : `2f87:0008` (appelée par le dispatcher du plateau `1a3c:002a`, scène 31).

Segment du module : `2f87` (3 fonction(s), 3366 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `28a3:04dc` | 654 | ok | s31a |
| `2f87:0008` | 1614 | ok | s31a000s.hy8, s31a001d.mcg, s31a001s.hy8, s31a002b.voc, s31a002d.mcg, s31a003b.voc, s31a003d.mcg, s31b.mux, s31c1.mux, s31c2.mux |

Autres fonctions du même segment (même module, taille en octets) : `2f87:0656` (752), `2f87:0950` (1000)

#### s32 : Chez Gargamel

Fonction principale : `199e:000a` (appelée par le dispatcher du plateau `1a3c:002a`, scène 32).

Segment du module : `199e` (1 fonction(s), 156 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `199e:000a` | 156 | ok | s32b.mux, s32cd1.mux, s32cd2.mux |
| `28a3:04dc` | 654 | ok | s32a |

#### s33 : La Formule Magique

Fonction principale : `1ceb:000c` (appelée par le dispatcher du plateau `1a3c:002a`, scène 33).

Segment du module : `1ceb` (1 fonction(s), 2885 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1ceb:000c` | 2885 | ok | s33a, s33a000s.hy8, s33a001b.voc, s33a001d.mcg, s33a001s.hy8, s33a003b.voc, s33a004b.voc, s33b.mux, s33c1.mux, s33c2.mux |
| `28a3:04dc` | 654 | ok | s33a |

#### s34 : La Cigogne

Fonction principale : `1b05:000b` (appelée par le dispatcher du plateau `1a3c:002a`, scène 34).

Segment du module : `1b05` (6 fonction(s), 3406 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1b05:000b` | 1359 | ok | s34a.mux, s34a.pal, s34a001b.voc, s34a001s.hy8, s34a004b.voc, s34b.mux, s34c1.mux, s34c2.mux |
| `28a3:04dc` | 654 | ok | s34a |

Autres fonctions du même segment (même module, taille en octets) : `1b05:055a` (109), `1b05:05c7` (866), `1b05:0929` (621), `1b05:0b96` (324), `1b05:0cda` (127)

#### s35 : Le Coloriage

Fonction principale : `1bda:0021` (appelée par le dispatcher du plateau `1a3c:002a`, scène 35).

Segment du module : `1bda` (2 fonction(s), 2476 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1bda:0021` | 2452 | ok | s35a000d, s35a000s.hy8, s35a001b.voc, s35a001d, s35a002b.voc, s35a002d, s35a003d, s35a004d, s35a005d, s35a006d (+19) |
| `28a3:04dc` | 654 | ok | s35a |

Autres fonctions du même segment (même module, taille en octets) : `1bda:0009` (24)

#### s36 : La Mine Désaffectée

Fonction principale : `23c9:0004` (appelée par le dispatcher du plateau `1a3c:002a`, scène 36).

Segment du module : `23c9` (4 fonction(s), 4208 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `23c9:0004` | 3505 | ok | s36a000s.hy8, s36a001b.voc, s36a001s.hy8, s36a002b.voc, s36a003b.voc, s36b.mux, s36c1.mux, s36c2.mux, s36e, s36f (+6) |
| `28a3:04dc` | 654 | ok | s36a |

Autres fonctions du même segment (même module, taille en octets) : `23c9:0dbd` (515), `23c9:0fc0` (126), `23c9:103e` (62)

#### s38 : Le Schtroumpf à Lunettes

Segment(s) de code : `1fc6` (12 fonction(s), 6043 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1fc6:085f` | 893 | ok | s38a, s38a.mux, s38a0%d%dd.pal, s38a00%dd.mcg, s38b.mux |
| `1fc6:0c20` | 2880 | ok | s38c, s38c.mux, s38d, s38e, s38e.mux |

Segment partagé avec s02, s03 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s39 : L'Oiseau

Segment(s) de code : `265b` (1 fonction(s), 968 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `265b:000d` | 968 | ok | s39%s.mux, s39v |

Segment partagé avec s02, s25 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s40 : Le Quizz

Fonction principale : `2ee8:000d` (appelée par le dispatcher du plateau `1a3c:002a`, scène 40).

Segment du module : `2ee8` (2 fonction(s), 2519 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `154c:0954` | 39 | ok | s40a |
| `28a3:04dc` | 654 | ok | s40a |
| `2ee8:000d` | 2401 | ok | s40a, s40a.dat, s40a001d.mcg, s40b, s40c |

Segment partagé avec s07, s52 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s41 : Le Magicien

Segment(s) de code : `2143` (4 fonction(s), 2733 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `2143:0009` | 452 | ok | s41a.pal, s41a1.mux, s41a160a.mcg, s41a2.mux, s41b.mux, s41c.mux, s41e.mux, s41f.mux |
| `2143:01cd` | 1343 | ok | s41a, s41a000s.hy8, s41v |
| `2143:070c` | 405 | ok | s41b035a.mcg |
| `2143:08a1` | 533 | ok | s41a1.mux, s41b003d.mcg, s41d.mux |

Segment partagé avec s07, s49 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s42 : Le Grand Schtroumpf

Segment(s) de code : `154c` (14 fonction(s), 2764 o), `1e52` (11 fonction(s), 2007 o), `26ee` (11 fonction(s), 4517 o), `28a3` (11 fonction(s), 1969 o), `291e` (6 fonction(s), 5323 o), `336a` (19 fonction(s), 2677 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `154c:097b` | 323 | ok | s42%c.mux, s42g.mux |
| `1e52:00ad` | 440 | ok | s42v |
| `26ee:006a` | 498 | ok | s42v |
| `28a3:00ad` | 967 | ok | s42a0%d.mux |
| `291e:0401` | 3467 | ok | s42%c.mux, s42a%d.mux, s42a0%d.mux, s42v |
| `336a:01a8` | 523 | ok | s42g.mux |

Segment partagé avec s01, s11, s16, s18, s19, s20 (+20) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s45 : Aide

Segment(s) de code : `1a3c` (3 fonction(s), 3128 o), `1e20` (2 fonction(s), 801 o), `291e` (6 fonction(s), 5323 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1a3c:0225` | 2676 | ok | s45v |
| `1e20:027c` | 172 | ok | s45a |
| `291e:0401` | 3467 | ok | s45v |

Segment partagé avec s01, s02, s03, s07, s13, s16 (+2) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s46 : Abandon

Segment(s) de code : `1823` (5 fonction(s), 5990 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1823:0415` | 2423 | ok | s46a, s46a000s.hy8, s46a001d.mcg |
| `1823:0e21` frag_1823_0e21 | 2257 | ok | s46a, s46a000s.hy8, s46a001d.mcg |

Segment partagé avec s07, s49 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s48 : Pause

Segment(s) de code : `269a` (1 fonction(s), 1321 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `269a:0007` | 1321 | ok | s48a, s48a000s.hy8, s48a001d.mcg, s48v |

Segment partagé avec s07 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s49 : Confirmation

Segment(s) de code : `1823` (5 fonction(s), 5990 o), `2143` (4 fonction(s), 2733 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `1823:000c` | 1009 | ok | S49_01T, S49_02T, S49_03T, S49_04T, S49_05T, S49_06T, S49_07T, S49_08T, S49_09T, S49_10T (+4) |
| `1823:170a` | 176 | ok | s49a.dat |
| `2143:08a1` | 533 | ok | s49v |

Segment partagé avec s07, s41, s46 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s51 : Les Cadeaux

Fonction principale : `19a8:0006` (appelée par le dispatcher du plateau `1a3c:002a`, scène 51).

Segment du module : `19a8` (1 fonction(s), 2365 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `19a8:0006` | 2365 | ok | s51a00%dd.mcg, s51a000s.hy8, s51a001b.voc, s51b, s51b.mux, s51c |
| `28a3:04dc` | 654 | ok | s51a |

Segment partagé avec s29 : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

#### s52 : Divers (Polices, Musiques, ...)

Segment(s) de code : `154c` (14 fonction(s), 2764 o), `21ee` (14 fonction(s), 7484 o), `28a3` (11 fonction(s), 1969 o), `2ee8` (2 fonction(s), 2519 o), `305a` (8 fonction(s), 1087 o)

| Fonction | Octets | Décomp. | Fichiers / motifs référencés |
|---|---:|---|---|
| `154c:052e` | 660 | ok | s52d001d.mcg, s52d2.pfn, s52d3.pfn, s52dsphi.doc, s52m002m.voc |
| `21ee:0006` | 373 | ok | s52m00%dm.voc |
| `28a3:0007` | 43 | ok | s52m00%dm.voc |
| `2ee8:000d` | 2401 | ok | s52d001f.pfn |
| `305a:0008` | 105 | ok | s52d001b.voc, s52d001f.pfn |
| `305a:016c` | 610 | ok | s52d0 |

Segment partagé avec s01, s04, s05, s06, s07, s08 (+22) : module commun à plusieurs scènes, la liste ci-dessus est plus fiable que « tout le segment ».

<!-- /GEN:scenes -->

## Conseils pour étudier une scène

1. Repérer ses fonctions dans la table ci-dessus. Les « Autres fonctions du même segment » sont les fonctions voisines du même module : la logique du mini-jeu y est le plus souvent (un segment de code correspond à un module source, donc souvent à une scène).
2. Lire `archives/teleportaschtroumpf/re/decomp/<seg>_<off>_*.c`. L'en-tête donne les appelants, les appelés et les chaînes référencées ; remonter à `main` (`305a:016c`) par les appelants.
3. Chercher dans le corpus :
   - `grep -rn 's23a001' archives/teleportaschtroumpf/re/decomp` : les fonctions qui utilisent un fichier ;
   - `grep -n 'sNN' archives/teleportaschtroumpf/re/strings.tsv` : toutes les chaînes d'une scène et leurs fonctions ;
   - `grep -n 'seg:off' archives/teleportaschtroumpf/re/disasm.txt` : le listing d'une fonction (en-tête `; ===== seg:off`).
4. Quand la décompilation est douteuse (types `undefined`, arguments manquants, fonctions `partielle`), lire `disasm.txt` : c'est la référence.

Pièges de la décompilation 16 bits :

- **Pointeurs far.** Un pointeur far est passé en deux mots : `f(0x4a86, 0x3646, ...)` est le pointeur `3646:4a86`. Un second argument `0x3646` signale donc un pointeur vers DGROUP ; le premier est l'offset. Pour une chaîne, chercher `3646:<offset>` dans `strings.tsv`. Les annotations `/* "..." */` ne sont ajoutées que pour une constante 16 bits qui est l'offset d'une chaîne.
- **Variables globales.** `uRam0003c5db` est l'adresse linéaire `0x3c5db` : l'offset DGROUP est `0x3c5db - 0x36460 = 0x617b` (donc `3646:617b`). Les petits offsets du startup apparaissent bruts (`*(int *)0x7d`).
- **Fonctions variadiques.** `lib_sprintf(buf, fmt, ...)` apparaît avec ses arguments tronqués ou mal groupés, car Ghidra ne connaît pas le prototype. Le format de `sprintf` est dans l'en-tête « chaînes référencées » ; les arguments suivants sont à lire dans `disasm.txt`.
- **Conventions.** Appels `CALLF` (far) pour tout le jeu et pour la bibliothèque, `CALL` (near) entre fonctions d'un même module ; arguments empilés de droite à gauche, retour dans AX ou DX:AX ; `long` et pointeurs far = 2 mots. Le nombre de paramètres déduit par Ghidra peut être faux.
- **Registres 386 en mode réel.** Le code utilise des instructions 32 bits (préfixe `66`). Ghidra les décode, mais deux fonctions échouent en décompilation (voir statistiques) et d'autres sont marquées partielles.
- **Pointeurs de fonction.** Les appels indirects (`(*pcRam0003a200)(...)`) vont vers des routines installées à l'exécution (pilote audio, vidéo) : trouver où le pointeur est écrit avec `grep` sur le nom de la globale.
- **Switch.** Les `JMP CS:[BX+table]` sont déclarés au décompileur. Si un `switch` paraît étrange, vérifier la table dans `disasm.txt` (références `COMPUTED_JUMP` non affichées : lire les mots de la table dans le segment de code).
- **Adresses affichées par Ghidra.** Une même adresse peut s'afficher `1000:6c11` ou `15f9:0c81` (adresse linéaire `0x16c11` écrite avec deux segments). `functions.tsv`, `decomp/` et les commentaires de `disasm.txt` utilisent le segment du bloc de code, celui qu'un `CALLF` emploie.
