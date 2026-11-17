# ASTERIX.EXE : index de rétro-ingénierie

Décompilation de `original/asterix/ASTERIX.EXE` (MZ DOS 16 bits mode réel, Borland C++ 1991, modèle large, 153 328 octets, « Version 2.5 », « May 30 1995 », MD5 `0b826e68e191b7c25d4416d2d824681d`) avec Ghidra en mode headless. Ce document est le point d'entrée des tâches qui étudient un module : il donne, pour chaque fonction hors bibliothèque, son adresse, son rôle, son équivalent dans `SMURF.EXE` (*Le Téléportaschtroumpf*, même moteur) et son état de lecture, puis la liste des mini-jeux à lire en vague E. Le fonctionnement du jeu est décrit dans `engine.md`.

Les blocs entre `<!-- GEN:... -->` sont réécrits par `run.sh`. Le reste est écrit à la main.

## Régénérer

```bash
bash scripts/asterix/re/run.sh
```

- Prérequis : `brew install ghidra` (qui installe un JDK). Aucun autre outil. L'exécutable n'est jamais lancé.
- Durée : environ 2 minutes. Le script est idempotent (`-overwrite`) et ne demande rien.
- Les sorties sont dans `archives/asterix/re/` (ignoré par git) :

| Fichier | Contenu |
|---|---|
| `decomp/<seg>_<off>_<nom>.c` | une décompilation C par fonction ; en-tête : taille, appelants, appelés, chaînes référencées |
| `functions.tsv` | adresse, nom, type (`func`, `lib`, `rtl`, `fragment`), taille, nb d'instructions, appelants, appelés, état de la décompilation, fichier |
| `strings.tsv` | adresse DGROUP, longueur, chaîne, fonctions référentes (`seg:off/type`) |
| `libfuncs.tsv` | fonctions de la bibliothèque Borland nommées, avec la preuve de l'identification |
| `keyfuncs.tsv` | fonctions du moteur et du jeu nommées : groupe, confiance, rôle, statut de lecture, équivalent `SMURF.EXE` |
| `module_entries.tsv` | les 15 mini-jeux : case, indice d'annonce, fonction d'entrée, argument, tailles (lu dans la table `20fa:146d`) |
| `disasm.txt` | listing désassemblé complet, avec noms de fonctions cibles et chaînes en commentaire |
| `project/` | projet Ghidra (`asterix`), ouvrable dans l'interface (`ghidraRun`) |
| `run.log` | journal complet de Ghidra |

Les scripts sont dans `scripts/asterix/re/` ; l'outillage commun (`ReCommon.java`, `ExportStrings.java`, `ExportDecompiled.java`, `ExportDisasm.java`, `run-lib.sh`, `make_index_lib.py`) est dans `scripts/re/`.

| Fichier | Rôle |
|---|---|
| `run.sh` | enchaîne tout et contrôle les sorties |
| `SetDS.java` | avant l'analyse : fixe DS à DGROUP (`2de2`, détecté dans le startup Borland) et désactive trois analyseurs nuisibles |
| `SeedFunctions.java` | amorce les fonctions que l'auto-analyse n'atteint pas (appels lointains, pointeurs de fonction, prologues, tables de switch) |
| `IdentifyLibs.java` + `libs.def.tsv` | nomme les fonctions de la bibliothèque Borland ; l'identification est héritée de `SMURF.EXE` par appariement des deux exécutables |
| `NameGameFuncs.java` + `keyfuncs.def.tsv` | nomme les fonctions du moteur et du jeu ; **c'est `keyfuncs.def.tsv` qu'on complète** quand une fonction est lue (nom, rôle, statut, confiance) |
| `ExportModuleEntries.java` | lit la table des mini-jeux du dispatch `20fa:135a` |
| `make_index.py` | réécrit les blocs générés de ce document |

`SetDS.java` et `SeedFunctions.java` sont des copies de ceux de `scripts/teleportaschtroumpf/re/` (même compilateur, mêmes besoins ; seule la catégorie Ghidra change). Dette technique : ces deux scripts, déjà copiés pour Armaeth, pourraient remonter dans `scripts/re/`.

## Statistiques

<!-- GEN:stats -->
- Outils : ghidra 12.2 ; JDK : openjdk version "25.0.5" 2026-10-20.
- Durée de la dernière régénération : 108 s.
- Fonctions : 659 (code Ghidra), 119791 octets (97.9 % des 122400 octets de code avant DGROUP).
- Types : fragment 24, func 482, lib 32, rtl 121.
- Décompilation : 646 ok (98.0 %), 10 partielle (code illisible pour Ghidra par endroits), 3 en erreur.
- Fonctions de bibliothèque nommées avec certitude : 32 (+ 1 probable, non renommée). 121 fonctions du segment `1000` restent du code Borland non identifié (type `rtl`).
- Chaînes dans DGROUP : 586 ; référencées par au moins une fonction : 533. Références heuristiques par type : imm 544, mem 2, table 45.
- Décompilation en erreur (utiliser `disasm.txt`) : `135a:0258`, `20fa:146d`, `2de2:204c`.
- Décompilation partielle : `1000:1c6c`, `2af4:00e4`, `1902:0213`, `1902:027e`, `1902:0200`, `2a28:0001`, `2a28:000a`, `1902:0279`, `1000:1913`, `1902:0276`.
- Image : 153328 octets, en-tête 13312 octets, DGROUP = segment `2de2`.
<!-- /GEN:stats -->

## Comment l'analyse a été faite (et ses limites)

La méthode est celle de `SMURF.EXE` (voir `docs/teleportaschtroumpf/re-index.md` et `docs/teleportaschtroumpf/engine-ts.md`, section sur la lecture de la décompilation) : DS fixé à DGROUP, amorçage des fonctions, relecture des tables de switch, références aux chaînes par heuristique. Points propres à Astérix :

- **Parenté avec `SMURF.EXE`.** Environ 40 Ko du code hors bibliothèque sont identiques ou proches du socle des Schtroumpfs (lecteur et décodeur MUX, sprites HY8, police, MCG, fondus, son, EMS, fichiers). L'appariement fonction par fonction (instructions normalisées) donne la colonne « Équivalent SMURF.EXE » de l'index, avec le taux de ressemblance. Ces fonctions sont marquées « survolée » : leur rôle est repris de la documentation des Schtroumpfs et n'a été relu que là où le code diffère.
- **Code du jeu.** Les segments `19e2` à `288f` n'ont aucun équivalent dans `SMURF.EXE`. Le cœur (`19e2`, `1a93`, `1abf`, `1d24`, `20fa`, `25f1`, `288f`) a été lu en entier, arguments des appels repris dans le désassemblage. Les 14 segments de mini-jeux ne sont pas lus (vague E).
- **Faux positifs de Ghidra.** `20fa:1198` et `20fa:146d` sont des tables de sauts (pièges et mini-jeux), pas du code : leur décompilation est sans valeur. `20fa:000d`, `000e`, `05d9` et quelques autres petites fonctions sans appelant sont des rappels passés au lecteur MUX par pointeur.
- **Arguments perdus.** Ghidra perd souvent les arguments des appels lointains et colle deux mots de 16 bits en une constante (`0x800004` = les mots 4 et 0x80). En cas de doute, le désassemblage fait foi.
- **Rien n'a été exécuté.** Tout est statique. Les points qui demandent une mesure sous DOSBox-X ou une écoute sont listés à la fin de `engine.md`.

## Répartition du code et état de lecture

Octets de code par groupe de segments, hors bibliothèque Borland (segment `1000`). « Lu » : fonction lue en entier ; « survolé » : rôle repris de l'équivalent `SMURF.EXE` ou établi par un survol ; « non lu » : à faire.

<!-- GEN:segments -->
| Groupe | Segments | Fonctions | Octets | Lu | Survolé | Non lu |
|---|---|---:|---:|---:|---:|---:|
| Animations HY8 | `1345` | 5 | 336 | 336 | 0 | 0 |
| Images MCC et voix K | `135a` | 4 | 818 | 574 | 244 | 0 |
| Mémoire EMS | `138e` | 18 | 1396 | 328 | 986 | 82 |
| Divers moteur | `13e5` | 6 | 151 | 151 | 0 | 0 |
| Fichiers et chemins | `13ef` | 9 | 2336 | 2336 | 0 | 0 |
| Images et tampons | `1481` | 21 | 2989 | 2752 | 237 | 0 |
| Entrées | `153c` | 18 | 1853 | 1853 | 0 | 0 |
| Palette et fondus | `15b0` | 5 | 627 | 627 | 0 | 0 |
| Vidéos, introduction, générique, règle | `15d7` | 16 | 3866 | 3866 | 0 | 0 |
| Son | `16cb` | 18 | 3522 | 2076 | 1446 | 0 |
| CD-ROM et carte son | `17a8`, `17c1` | 8 | 2152 | 705 | 1447 | 0 |
| Horloge et erreurs | `1831` | 13 | 940 | 940 | 0 | 0 |
| Assembleur divers (copies, MSCDEX, mélange) | `186c`, `1884`, `18a1` | 25 | 1799 | 388 | 1410 | 1 |
| Clavier et manette | `1902` | 18 | 787 | 780 | 7 | 0 |
| Lecteur MUX | `1948` | 8 | 1806 | 1806 | 0 | 0 |
| Lecteur MUK | `19b9` | 2 | 652 | 652 | 0 | 0 |
| Démarrage et menu principal | `19e2` | 6 | 2826 | 2826 | 0 | 0 |
| Utilitaires de jeu (aléatoire, attentes, chronomètres) | `1a93` | 15 | 693 | 693 | 0 | 0 |
| Partie : réglages, tour, dé, fin | `1abf` | 18 | 9657 | 9657 | 0 | 0 |
| Plateau, marbre, carte, score | `1d24` | 19 | 7601 | 7601 | 0 | 0 |
| Mini-jeu MDF/25 | `1f01` | 1 | 770 | 0 | 0 | 770 |
| Mini-jeu MDF/26 | `1f31` | 5 | 1325 | 0 | 0 | 1325 |
| Mini-jeu MDF/36 | `1f84` | 5 | 1573 | 0 | 0 | 1573 |
| Mini-jeu MDF/35 | `1fe6` | 2 | 2376 | 0 | 0 | 2376 |
| Mini-jeu MDF/24 | `207c` | 1 | 2017 | 0 | 0 | 2017 |
| Cases du plateau | `20fa` | 22 | 9571 | 9571 | 0 | 0 |
| Mini-jeu MDF/33 | `2353` | 1 | 2023 | 0 | 0 | 2023 |
| Mini-jeu MDF/34 | `23d1` | 7 | 3329 | 0 | 0 | 3329 |
| Mini-jeu MDF/30 | `24a1` | 5 | 1045 | 0 | 0 | 1045 |
| Mini-jeu MDF/28-29 | `24e3` | 3 | 2501 | 0 | 0 | 2501 |
| Mini-jeu MDF/22 | `2580` | 4 | 1798 | 0 | 0 | 1798 |
| Quiz des pays | `25f1` | 5 | 2905 | 2905 | 0 | 0 |
| Mini-jeu MDF/32 | `26a6` | 5 | 2834 | 0 | 0 | 2834 |
| Mini-jeu MDF/23 | `275a` | 2 | 1514 | 0 | 0 | 1514 |
| Mini-jeu MDF/31 | `27ba` | 4 | 2135 | 0 | 0 | 2135 |
| Mini-jeu MDF/27 | `2840` | 3 | 1158 | 0 | 0 | 1158 |
| Tullius Détritus | `288f` | 1 | 1849 | 1849 | 0 | 0 |
| Pilote Sound Blaster et mélange | `2904`, `29ad`, `29d5`, `2a28` | 60 | 7538 | 617 | 6897 | 24 |
| Bas niveau (vidéo, sprites, police, DOS) | `2ae2`, `2af4`, `2b17`, `2b57`, `2ba7`, `2bac`, `2bb1`, `2bdb`, `2c66`, `2c71`, `2c7d`, `2c8b`, `2c90`, `2cd0`, `2cee`, `2d10`, `2d46`, `2d7b`, `2d97`, `2d9b`, `2da7`, `2daa`, `2dd2` | 116 | 10058 | 1313 | 8736 | 9 |
| **Total hors bibliothèque** | | 504 | 105126 | 57202 | 21410 | 26514 |
<!-- /GEN:segments -->

## Enchaînement des modules

Il n'y a pas de table générale de scènes comme dans `SMURF.EXE` : `main` (`19e2:030c`) contient le menu principal et appelle directement chaque écran. Le numéro `NN` d'un dossier `MDF/NN` n'apparaît que dans les noms de fichiers (`MNN...`) écrits en dur dans chaque fonction ; le chargeur (`13ef:011b`) en tire le dossier (deux chiffres après la première lettre).

| Dossier | Contenu | Fonction qui le joue |
|---|---|---|
| `MDF/52` | polices, logos `m52a/b/c/f` | `19e2:0114`, `15d7:0a80`, `15d7:0369` |
| `MDF/06` | introduction | `15d7:0a80`, rappel `15d7:093b` |
| `MDF/07` | menu principal | `19e2:030c` |
| `MDF/08` | choix des joueurs et des niveaux | `1abf:1532` |
| `MDF/09` | réglages (durée, objets) | `1abf:1f3e` |
| `MDF/01` | plateau (écran à 9 cases) | `1d24:0618` |
| `MDF/02` | carte générale | `1d24:0e08` |
| `MDF/03` | écran de score, marbre de route | `1d24:112b`, `1d24:161b` |
| `MDF/43` | pions, dé, portraits, bruitages du plateau | `19e2:0008`, `1abf:2431`, `1d24:1c6e` |
| `MDF/48` | pause | `1abf:07f4` |
| `MDF/49` | confirmation oui/non | `1d24:0006` |
| `MDF/11`, `MDF/12`, `MDF/42` | fins de partie, commentaires de temps et de score | `1abf:0da3`, `1d24:112b` |
| `MDF/13` | espion Zérozérosix | `20fa:0b83` |
| `MDF/14` à `MDF/19` | pièges | `20fa:0f38` |
| `MDF/20` | prison | `20fa:00d2`, `20fa:02c1` |
| `MDF/21` | repos et jeux d'ambiance hors écran | `20fa:05e9` |
| `MDF/37` | potion | `20fa:1223` |
| `MDF/38` | Tullius Détritus | `288f:000f` |
| `MDF/39` | devin | `20fa:192e` |
| `MDF/40` | quiz des pays | `25f1:042d` |
| `MDF/41` | Epidemaïs | `20fa:14a9` |
| `MDF/44` | règle du jeu | `15d7:0e8b` |
| `MDF/47` | générique | `15d7:0369` |
| `MDF/05`, `45`, `46`, `51`, `60` à `63` | voix seules (`KNNTEnn.VOC`), choisies par la clé de `135a:00fb` | `135a:02ac` |
| `MDF/22` à `MDF/36` | mini-jeux | voir ci-dessous |

Types de cases et gestionnaires (table `1abf:13cf`, indexée par le type lu dans `DS:1d81`) : 0 repos `20fa:05e9`, 1 prison `20fa:00d2`, 2 espion `20fa:0b83`, 3 piège `20fa:0f38`, 4 Détritus `288f:000f`, 5 potion `20fa:1223`, 6 jeu `20fa:135a`, 7 pays `25f1:042d`, 8 Epidemaïs `20fa:14a9`, 9 devin `20fa:192e`, 10 surprise `20fa:231b`.

## Mini-jeux (vague E)

La case « jeu » appelle `20fa:135a`, qui cherche la position du joueur dans la table `20fa:146d` (15 positions, puis 15 adresses de blocs). Chaque bloc appelle `20fa:130f(indice)` (annonce vocale `K60TE{3 × indice + 1..3}`, dossier `MDF/60`) puis la fonction d'entrée du mini-jeu. Le tableau est lu dans l'exe par `ExportModuleEntries.java` ; le nom vient du manuel, le dossier des noms de fichiers référencés.

<!-- GEN:modules -->
| Case | Jeu (nom du manuel) | Genre | Dossier | Fonction d'entrée | Argument | Annonce K60TE | Octets (entrée) | Segment : fonctions, octets | Fichiers référencés par l'entrée |
|---:|---|---|---|---|---|---|---:|---|---|
| 2 | Des poissons pas très frais | action | `MDF/22` | `2580:03b3` | - | 1 à 3 | 864 | `2580` : 4, 1798 | m22b0000.voc, m22b0001.voc, m22b0002.voc, m22b0003.voc, m22b0004.voc, M22DA000.mcc, m22da001.mcc, m22m.voc (+2) |
| 3 | Non, tu ne chanteras pas !! | réflexion | `MDF/23` | `275a:0052` | - | 4 à 6 | 1442 | `275a` : 2, 1514 | b23-11a.voc, b23-12a.voc, b23-13a.voc, b23-14a.voc, b23-99a.voc, M23AA.mux, M23AB.mux, M23AC.mux (+1) |
| 4 | Des détails à la loupe... | réflexion | `MDF/24` | `207c:000c` | - | 7 à 9 | 2017 | `207c` : 1, 2017 | b24-01a.voc, b24-03a.voc, M24DA00%d.mcg, m24m.voc |
| 8 | Le brouillard | réflexion | `MDF/26` | `1f31:0294` | - | 13 à 15 | 675 | `1f31` : 5, 1325 | b26-01a.voc, b26-02a.voc, b26-03a.voc, b26-04a.voc, b26-06a.voc, b26-07a.voc, b26-08a.voc, b26-09a.voc (+28) |
| 11 | Tempête en mer du Nord | action | `MDF/27` | `2840:023a` | - | 16 à 18 | 709 | `2840` : 3, 1158 | M27AA.MUX, M27AG.MUX, M27AH.MUX, m27b0000.voc, m27b0001.voc, m27b0002.voc, m27s.pal, m27sr.hy8 |
| 20 | Les sangliers | action | `MDF/28` | `24e3:0406` | 0 | 19 à 21 | 1495 | `24e3` : 3, 2501 | b01-05a.voc, b29-01a.voc, b29-04a.voc, M28AC.MUX, m28b0000.voc, m28b0001.voc, m28b0003.voc, m28b0004.voc (+18) |
| 23 | Le ciel sur la tête | action | `MDF/36` | `1f84:040a` | - | 43 à 45 | 546 | `1f84` : 5, 1573 | M36A.mux, m36b0001.voc, m36b0004.voc, m36b0005.voc, M36SA000.hy8, M36SA001.hy8 |
| 27 | Coloriages | réflexion | `MDF/35` | `1fe6:0043` | - | 40 à 42 | 2321 | `1fe6` : 2, 2376 | b24-03a.voc, b35-01b.voc, m35b0000.voc, M35DA000.MCC, M35DA001.MCC, M35DA002.MCC, M35DA003.MCC, M35DA004.MCC (+8) |
| 33 | Les jeux olympiques | action | `MDF/30` | `24a1:027a` | - | 25 à 27 | 426 | `24a1` : 5, 1045 | m30a.mux, m30b0000.voc, m30b0001.voc, m30da001.mcc, m30da002.mcc, m30s.hy8 |
| 36 | Le fakir | action | `MDF/31` | `27ba:0561` | - | 28 à 30 | 778 | `27ba` : 4, 2135 | M31AA.MUX, M31AB.MUX, m31b0000.voc, m31b0001.voc, m31b0002.voc, M31DA000.mcc, M31DA001.mcc, M31DA002.mcc (+2) |
| 40 | Anachronismes | réflexion | `MDF/25` | `1f01:0008` | - | 10 à 12 | 770 | `1f01` : 1, 770 | b24-01a.voc, b24-03a.voc, M25DA0%d.mcg, M25DA00%d.mcg, m25m.voc |
| 42 | Bagarre avec les Romains | action | `MDF/32` | `26a6:0804` | - | 31 à 33 | 830 | `26a6` : 5, 2834 | b32-01a.voc, b32-02a.voc, M32AA.MUX, M32AB.mux, M32AC.mux, M32AD.mux, M32AE.mux, M32AF.mux (+7) |
| 44 | Les hiéroglyphes de Cléopâtre | réflexion | `MDF/33` | `2353:0005` | - | 34 à 36 | 2023 | `2353` : 1, 2023 | b33-01a.voc, b33-02a.voc, b33-03a.voc, b33-05a.voc, b33-10a.voc, m33ab.mux, m33da000.mcc, m33m.voc (+1) |
| 47 | Idéfix dans la pyramide | action | `MDF/34` | `23d1:09c1` | 1 | 37 à 39 | 844 | `23d1` : 7, 3329 | m34ag.muk, m34ag1.voc, m34ag2.voc, m34b0000.voc, m34b0001.voc, m34b0002.voc, m34da000.mcc, m34sa000.hy8 (+2) |
| 52 | Pirates à bâbord ! | action | `MDF/29` | `24e3:0406` (code partagé avec la case 20) | 1 | 22 à 24 | 1495 | `24e3` : 3, 2501 | b01-05a.voc, b29-01a.voc, b29-04a.voc, M28AC.MUX, m28b0000.voc, m28b0001.voc, m28b0003.voc, m28b0004.voc (+18) |

Total des 14 segments de mini-jeux : 26398 octets de code (48 fonctions), tous à lire en vague E.
<!-- /GEN:modules -->

À savoir pour découper la vague E :

- Un mini-jeu = un segment de code, sauf `24e3` qui sert deux jeux (Les sangliers avec l'argument 0, Pirates à bâbord avec l'argument 1 : dossiers `MDF/28` et `MDF/29`). 15 jeux, 14 segments, donc 14 lots.
- `23d1:09c1` (Idéfix dans la pyramide) est aussi lancé depuis le menu principal avec l'argument 0 (jeu pour les plus jeunes, hors partie) ; l'argument 1 est la version du plateau.
- La taille de la fonction d'entrée ne dit pas tout : compter la taille du segment. Les plus gros lots sont `23d1` (Idéfix, 3,3 Ko), `26a6` (Bagarre, 2,8 Ko) et `24e3` (Sangliers et Pirates, 2,5 Ko).
- Chaque mini-jeu lit le niveau « action » (`+4`) ou « réflexion » (`+2`) du joueur courant (`DS:64b3 + 25 × DS:648d`), rend la main au tour (`1abf:0f99`) et crédite les sesterces par `1d24:0912`. Le détail (gains, temps, vitesses, marqueurs `08` des vidéos) reste à établir jeu par jeu.
- Fonctions communes déjà documentées dont les mini-jeux se servent : attentes et chronomètres `1a93`, aléatoire `1a93:00cb`, voix `135a:02ac`, lecteur MUX `1948:04cc` et ses enveloppes `15d7`, MUK `19b9` (Le brouillard, Idéfix), animations HY8 `1345`, confirmation `1d24:0006`, compteur de sesterces `1d24:0912`.

## Index des fonctions (hors bibliothèque)

Toutes les fonctions hors segment `1000`, par segment. Nom vide : pas de nom proposé (la fonction garde son nom Ghidra `FUN_<seg>_<off>`). Statut : lue, survolée, non lue. La confiance porte sur le rôle indiqué.

<!-- GEN:funcs -->
#### `1345` : Animations HY8 (5 fonctions, 336 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1345:0007` | `anim_select` | 123 | anim_select(obj, n) : choisit l'animation n d'un HY8 | `12d7:0008 (1.00)` | lue | sûr |
| `1345:0082` | `anim_init` | 62 | anim_init(obj, hy8) | `12d7:0083 (1.00)` | lue | sûr |
| `1345:00c0` | `anim_step` | 131 | anim_step(obj) : avance d'un pas, boucle | `12d7:00c1 (1.00)` | lue | sûr |
| `1345:0143` |  | 19 | alias de 1345:0007 | `12d7:0144 (1.00)` | lue | sûr |
| `1345:0156` |  | 1 | RETF seul (cible de Ctrl+Alt+Suppr) |  | lue | sûr |

#### `135a` : Images MCC et voix K (4 fonctions, 818 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `135a:0007` |  | 244 | construit le chemin d'une voix md%c\NN\KNNTEnn.voc |  | survolée | sûr |
| `135a:00fb` | `chemin_voix` | 333 | clé → dossier, md{langue}\NN\KNNTE{n+1}.voc puis repli mdf\ |  | lue | sûr |
| `135a:0258` | `frag_135a_0258` | 83 | pas du code : table de switch de 135a:00fb (25 clés en CS:0248 + 25 cibles) |  | lue | sûr |
| `135a:02ac` |  | 158 | joue une voix et attend sa fin (clic gauche = coupe si n ≥ 0, hors démo) |  | lue | sûr |

#### `138e` : Mémoire EMS (18 fonctions, 1396 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `138e:000a` | `EMS` | 125 | EMS : détection du pilote EMMXXXX0 | `12ec:0008 (0.98)` | survolée | probable |
| `138e:0087` | `EMS_138e_0087` | 56 | EMS : version | `12ec:0085 (1.00)` | survolée | probable |
| `138e:00bf` | `EMS_138e_00bf` | 53 | EMS : mémoire libre en octets | `12ec:00bd (1.00)` | survolée | probable |
| `138e:00f4` | `EMS_138e_00f4` | 53 | EMS : mémoire totale (probable) | `12ec:00f2 (1.00)` | survolée | hypothèse |
| `138e:0129` | `EMS_138e_0129` | 40 | EMS : adresse du cadre de pages | `12ec:0127 (1.00)` | survolée | probable |
| `138e:0151` | `EMS_138e_0151` | 41 | EMS : primitive INT 67h | `12ec:014f (1.00)` | non lue | hypothèse |
| `138e:017a` | `EMS_138e_017a` | 41 | EMS : primitive INT 67h | `12ec:0178 (1.00)` | non lue | hypothèse |
| `138e:01a3` | `EMS_138e_01a3` | 71 | EMS : mappe une page (handle, page physique, page logique) | `12ec:01a1 (1.00)` | lue | sûr |
| `138e:01ea` | `EMS_138e_01ea` | 72 | EMS : alloue des pages pour une taille en octets | `12ec:01e8 (1.00)` | survolée | probable |
| `138e:0232` | `EMS_138e_0232` | 32 | EMS : alloue un bloc et l'inscrit dans la table DS:457c | `12ec:0230 (0.92)` | lue | sûr |
| `138e:0252` | `EMS_138e_0252` | 53 | EMS : libère un handle (INT 67h AH=45h) | `12ec:0250 (1.00)` | survolée | probable |
| `138e:0287` | `EMS_138e_0287` | 76 | EMS : libère un bloc de la table | `12ec:0285 (0.91)` | lue | sûr |
| `138e:02d3` | `EMS_138e_02d3` | 67 | EMS : mappe les 4 pages d'un bloc dans le cadre | `12ec:02d1 (1.00)` | survolée | sûr |
| `138e:0316` |  | 52 | copie 64 000 o tampon → bloc EMS (+ pompe son) | `12ec:0314 (1.00)` | survolée | sûr |
| `138e:034a` |  | 52 | copie 64 000 o bloc EMS → tampon (+ pompe son) | `12ec:0348 (1.00)` | survolée | sûr |
| `138e:037e` |  | 214 | copie bloc EMS → bloc EMS (src, dst) (+ pompe son) | `12ec:037c (1.00)` | survolée | sûr |
| `138e:0454` |  | 149 | copie tampon → EMS, taille quelconque | `12ec:0452 (1.00)` | lue | probable |
| `138e:04e9` |  | 149 | copie EMS → tampon, taille quelconque | `12ec:04e7 (1.00)` | survolée | probable |

#### `13e5` : Divers moteur (6 fonctions, 151 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `13e5:000e` |  | 19 | fondu d'entrée de (k+1)×16 pas | `1343:000c (1.00)` | lue | sûr |
| `13e5:0021` |  | 19 | fondu au noir de (k+1)×16 pas | `1343:000c (1.00)` | lue | sûr |
| `13e5:0034` |  | 5 | vide | `1343:0032 (1.00)` | lue | sûr |
| `13e5:0039` |  | 50 | fondu sonore : volume DS:027a → 1, 20 cs par pas (argument ignoré) | `1343:0037 (1.00)` | lue | sûr |
| `13e5:006b` |  | 5 | vide | `1343:0032 (1.00)` | lue | sûr |
| `13e5:0070` |  | 53 | fondu sonore 15 pas (sans appelant) | `1343:006e (0.96)` | lue | sûr |

#### `13ef` : Fichiers et chemins (9 fonctions, 2336 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `13ef:0005` |  | 127 | sépare un chemin en dossier et fichier | `134d:0000 (0.98)` | lue | sûr |
| `13ef:0084` |  | 151 | essaie nom seul, chemin relatif, puis lecteur CD | `134d:007f (0.86)` | lue | sûr |
| `13ef:011b` |  | 467 | résolution de chemin md?\NN\nom (langue, puis f, tiret → souligné) | `134d:00f0 (0.83)` | lue | sûr |
| `13ef:02ee` |  | 296 | fond de la boîte d'erreur (m52d4.mcg) | `134d:0529 (0.89)` | lue | sûr |
| `13ef:0416` |  | 557 | boîte d'erreur de lecture A/R/I ; abandon = générique puis sortie | `134d:0621 (0.91)` | lue | sûr |
| `13ef:0643` |  | 176 | lit un fichier entier dans un bloc DOS |  | lue | sûr |
| `13ef:06f3` |  | 125 | charge un fichier en mémoire (4 essais, taille en DS:4ad4) | `134d:0822 (0.73)` | lue | sûr |
| `13ef:0772` |  | 346 | charge un fichier en EMS, rend le handle |  | lue | sûr |
| `13ef:08cc` |  | 91 | retire l'extension d'un nom | `134d:0a97 (1.00)` | lue | sûr |

#### `1481` : Images et tampons (21 fonctions, 2989 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1481:0007` |  | 130 | décale la palette de 128 couleurs et les pixels de ±0x80 | `13fc:0002 (1.00)` | lue | sûr |
| `1481:0089` |  | 204 | charge un MCG (2 + 0x300 + 64 000) | `13fc:0084 (1.00)` | lue | sûr |
| `1481:0155` |  | 170 | affiche un MCG avec drapeaux (fondus, palette, copie en B) | `13fc:0150 (1.00)` | lue | sûr |
| `1481:01ff` |  | 126 | charge un MCC (palette + séries couleur/longueur) | `13fc:01fa (1.00)` | lue | sûr |
| `1481:027d` |  | 182 | affiche un MCC avec drapeaux | `13fc:0278 (0.83)` | lue | sûr |
| `1481:0333` |  | 253 | cadre de boîte de dialogue (couleurs 0x74..0x78) | `13fc:02fc (1.00)` | lue | sûr |
| `1481:0430` |  | 24 | présente : tampon arrière → VRAM + pompe son | `13fc:03f9 (1.00)` | lue | sûr |
| `1481:0448` |  | 22 | restaure le fond : EMS B → A + pompe son | `13fc:0411 (1.00)` | lue | sûr |
| `1481:045e` |  | 111 | copie un rectangle entre deux tampons | `13fc:0427 (1.00)` | lue | sûr |
| `1481:04cd` |  | 279 | copie une tranche de rectangle entre blocs EMS | `13fc:0496 (1.00)` | lue | probable |
| `1481:05e4` |  | 208 | découpe un rectangle en tranches de 50 lignes (EMS) | `13fc:05ad (1.00)` | lue | probable |
| `1481:06b4` |  | 87 | copie un rectangle bloc EMS → bloc EMS | `13fc:067d (1.00)` | lue | sûr |
| `1481:070b` |  | 141 | ordonne et borne un rectangle | `13fc:06d4 (1.00)` | lue | sûr |
| `1481:0798` |  | 43 | restaure un rectangle du fond si la cible est le tampon arrière | `13fc:0761 (1.00)` | lue | sûr |
| `1481:07c3` |  | 299 | restaure n rectangles du fond | `13fc:078c (1.00)` | lue | probable |
| `1481:08ee` |  | 103 | composition masquée B/A, lignes 0..99 | `13fc:08b7 (1.00)` | lue | probable |
| `1481:0955` |  | 114 | composition masquée B/A, lignes 100..149 | `13fc:091e (1.00)` | lue | probable |
| `1481:09c7` |  | 114 | composition masquée B/A, lignes 150..199 | `13fc:0990 (1.00)` | survolée | probable |
| `1481:0a39` |  | 151 | composition masquée B/A d'un rectangle (186c:0089) | `13fc:0a02 (1.00)` | lue | probable |
| `1481:0ad0` |  | 123 | distance entre deux couleurs | `13fc:0a99 (1.00)` | survolée | hypothèse |
| `1481:0b4b` |  | 105 | couleur de palette la plus proche (sans appelant) | `13fc:0b14 (1.00)` | lue | probable |

#### `153c` : Entrées (18 fonctions, 1853 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `153c:0004` |  | 44 | vide les entrées (2 × 3 cs) et recentre le pointeur | `14b3:000d (1.00)` | lue | sûr |
| `153c:0030` |  | 19 | recentre le pointeur (160, 100) | `14b3:0039 (1.00)` | lue | sûr |
| `153c:0043` |  | 66 | lecture des entrées + navigation par les bords (seuils 10 / 310 / 10 / 190) | `14b3:004c (0.86)` | lue | sûr |
| `153c:0085` |  | 147 | calibrage des manettes | `14b3:008e (1.00)` | lue | probable |
| `153c:0118` |  | 113 | lecture des manettes, boutons en bits 0x40 / 0x80 | `14b3:0121 (1.00)` | lue | probable |
| `153c:0189` |  | 54 | init des manettes (si DS:0145) | `14b3:0192 (1.00)` | lue | sûr |
| `153c:01bf` |  | 1 | RETF seul |  | lue | sûr |
| `153c:01c0` |  | 221 | lecture des entrées → DS:4b6b, DS:4b69 ; mode démo (clic simulé après 100 lectures) |  | lue | sûr |
| `153c:029d` |  | 205 | par tick : position du pointeur → DS:4b67 (x), DS:4b65 (y) ; manette ±2 px | `14b3:0247 (1.00)` | lue | sûr |
| `153c:036a` |  | 344 | décodage clavier → DS:0142, Ctrl/Alt/Suppr | `14b3:0314 (0.84)` | lue | sûr |
| `153c:04c4` |  | 111 | sauve le fond sous le curseur 9×15 | `14b3:046e (1.00)` | lue | sûr |
| `153c:0533` |  | 129 | restaure le fond sous le curseur | `14b3:04dd (1.00)` | lue | sûr |
| `153c:05b4` |  | 186 | dessine le curseur flèche 9×15 (couleurs 0 et 255) | `14b3:055e (1.00)` | lue | sûr |
| `153c:066e` |  | 35 | redessine le curseur dans le tampon puis à l'écran | `14b3:0618 (1.00)` | lue | sûr |
| `153c:0691` | `active` | 40 | active (0) ou désactive le curseur (DS:0146) | `14b3:063b (1.00)` | lue | sûr |
| `153c:06b9` |  | 46 | fixe la couleur 255 (r, g, b) et renvoie la palette | `14b3:0663 (1.00)` | lue | sûr |
| `153c:06e7` |  | 54 | ouvre un fichier, compteur DS:014c (sans appelant) | `14b3:06af (1.00)` | lue | sûr |
| `153c:071d` |  | 38 | ferme un fichier, compteur DS:014c (sans appelant) | `14b3:06e5 (1.00)` | lue | sûr |

#### `15b0` : Palette et fondus (5 fonctions, 627 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `15b0:0003` |  | 227 | un pas de fondu d'entrée | `1523:000b (0.90)` | lue | sûr |
| `15b0:00e6` |  | 43 | fondu d'entrée en n pas | `1523:00ee (0.94)` | lue | sûr |
| `15b0:0111` |  | 228 | un pas de fondu au noir | `1523:0116 (0.90)` | lue | sûr |
| `15b0:01f5` |  | 62 | fondu au noir en n pas puis efface la VRAM | `1523:01fa (0.95)` | lue | sûr |
| `15b0:0233` |  | 67 | envoie une palette (début, nombre) et tient le fantôme DS:4b6e | `1523:025d (0.95)` | lue | sûr |

#### `15d7` : Vidéos, introduction, générique, règle (16 fonctions, 3866 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `15d7:0006` | `logo` | 174 | logo : %s0.mcc, %s.mux, %s1.mcc, fondu 8 |  | lue | sûr |
| `15d7:00b4` | `thunk_FUN_15d7_00bf` | 2 | saut vers 15d7:00bf |  | lue | sûr |
| `15d7:00bf` |  | 72 | générique : avance le pointeur de texte d'une ligne | `154c:014c (1.00)` | lue | sûr |
| `15d7:00fe` |  | 59 | générique : largeur d'une ligne lettre par lettre | `154c:018b (1.00)` | lue | sûr |
| `15d7:0139` |  | 78 | générique : dessine une ligne lettre par lettre | `154c:01c6 (1.00)` | lue | sûr |
| `15d7:0187` |  | 194 | générique : ligne centrée, ombre 0x7E puis texte 0x7D, police selon @1 |  | lue | sûr |
| `15d7:0249` |  | 134 | générique : dessine une page de 15 lignes, balises @1/@2/@3 | `154c:03e8 (1.00)` | lue | sûr |
| `15d7:02cf` |  | 154 | générique : défile d'une ligne (12 pas d'un pixel, fenêtre y 20..179) | `154c:046e (0.85)` | lue | sûr |
| `15d7:0369` |  | 898 | générique de fin (m47da000.mcg, m47.dat, m47m.voc) | `154c:052e (0.78)` | lue | sûr |
| `15d7:06eb` |  | 268 | joue M{nn}A{A+c}.MUX, interruptible, options 0x4000 / 0x1000 / rappel | `154c:07c2 (0.78)` | lue | sûr |
| `15d7:07f7` |  | 242 | idem non interruptible | `154c:07c2 (0.84)` | lue | sûr |
| `15d7:08e9` |  | 53 | joue un MUX plein écran interruptible (0x22D08) | `154c:0954 (0.73)` | lue | sûr |
| `15d7:091e` |  | 29 | joue un MUX plein écran non interruptible (sans appelant) | `154c:0abe (1.00)` | lue | sûr |
| `15d7:093b` |  | 285 | rappel de M06AC : marqueur → palette + fond, pose le calque |  | lue | sûr |
| `15d7:0a80` |  | 1035 | démarrage : logos m52a/b/c puis introduction M06 |  | lue | sûr |
| `15d7:0e8b` |  | 189 | choix 2 du menu : vidéos M44AB, AC, AD |  | lue | sûr |

#### `16cb` : Son (18 fonctions, 3522 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `16cb:0008` |  | 191 | mélange le bruitage dans un tampon du flux principal | `15f9:000b (0.98)` | lue | sûr |
| `16cb:00c7` |  | 189 | lseek du flux (my_lseek) | `15f9:00ca (1.00)` | survolée | probable |
| `16cb:0184` |  | 265 | lit l'en-tête VOC du flux | `15f9:0187 (1.00)` | survolée | probable |
| `16cb:028d` |  | 29 | ferme le fichier du flux | `15f9:0290 (1.00)` | lue | sûr |
| `16cb:02aa` |  | 71 | ouvre la source du flux (mémoire, fichier, EMS) | `15f9:02ad (1.00)` | lue | sûr |
| `16cb:02f1` |  | 31 | libère les 6 tampons de l'anneau | `15f9:02f4 (0.92)` | lue | sûr |
| `16cb:0310` |  | 84 | arrête le flux | `15f9:0313 (1.00)` | lue | sûr |
| `16cb:0364` |  | 577 | démarre le flux (anneau de 6 tampons) | `15f9:0367 (0.92)` | survolée | probable |
| `16cb:05a5` | `pompe` | 415 | pompe : remplit les tampons, appelle le mélange | `15f9:05b6 (0.96)` | survolée | probable |
| `16cb:0744` |  | 389 | pompe générale + affichage de mise au point (DS:19d9) | `15f9:0755 (0.92)` | lue | sûr |
| `16cb:08c9` | `MyNoise` | 387 | MyNoise : voie voix/musique (jouer, boucle, arrêt, test) | `15f9:089f (1.00)` | lue | sûr |
| `16cb:0a4f` |  | 75 | canal de bruitage mélangé (jouer, boucle, arrêt, test) |  | lue | sûr |
| `16cb:0a9a` | `thunk_FUN_16cb_0b99` | 3 | saut vers 16cb:0b99 |  | lue | sûr |
| `16cb:0a9d` | `frag_16cb_0a9d` | 252 | suite de 16cb:0a4f (arrêt, jouer) | `15f9:0a25 (0.84)` | lue | sûr |
| `16cb:0b99` |  | 4 | fin commune de 16cb:0a4f : rend 0 |  | lue | sûr |
| `16cb:0b9d` |  | 118 | version du DSP | `15f9:0b73 (1.00)` | lue | sûr |
| `16cb:0c13` |  | 368 | init de la carte son ; erreur → message et son coupé | `15f9:0be9 (1.00)` | lue | sûr |
| `16cb:0d91` |  | 74 | restaure le volume du mélangeur à la sortie | `15f9:0d67 (1.00)` | lue | sûr |

#### `17a8` : CD-ROM et carte son (5 fonctions, 401 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `17a8:000b` |  | 24 | rappel de tick : DS:6104 += 1, DS:60fc −= 1, pointeur | `16dc:0002 (1.00)` | lue | sûr |
| `17a8:0023` |  | 240 | alloue EMS A/B/C, mode 13h, INT 8 | `16dc:001a (1.00)` | lue | sûr |
| `17a8:0113` |  | 62 | arrêt : INT 8, mode vidéo, libère l'EMS | `16dc:010a (1.00)` | lue | sûr |
| `17a8:0151` |  | 34 | init du socle (vecteur 97h, vidéo, clavier, souris, tick) | `16dc:0148 (0.90)` | lue | sûr |
| `17a8:0173` |  | 41 | arrêt du socle | `16dc:016a (0.92)` | lue | sûr |

#### `17c1` : CD-ROM et carte son (3 fonctions, 1751 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `17c1:000c` | `langue` | 1447 | langue : DS:6163 et tables de messages / touches A, R, I | `16f5:0003 (1.00)` | survolée | sûr |
| `17c1:05d3` |  | 197 | dessine un texte (x ou centré, y) | `16f5:05ca (0.99)` | lue | sûr |
| `17c1:0698` |  | 107 | message encadré (sans appelant) | `16f5:068f (1.00)` | lue | sûr |

#### `1831` : Horloge et erreurs (13 fonctions, 940 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1831:0003` |  | 73 | erreur fatale : nettoyage, message, exit(-1) | `1764:000a (1.00)` | lue | sûr |
| `1831:004c` |  | 96 | affichage de mise au point (sans appelant) | `1764:0053 (0.79)` | lue | sûr |
| `1831:00ac` |  | 112 | volume F1 / F2 | `1764:00f4 (1.00)` | lue | sûr |
| `1831:011c` | `pompe_1831_011c` | 49 | pompe : son, entrées (si drapeau), recalibrage, volume | `1764:0164 (0.90)` | lue | sûr |
| `1831:014d` |  | 14 | enveloppe de 1831:011c | `1764:018a (0.80)` | lue | sûr |
| `1831:015b` |  | 44 | addition sur pointeur huge | `1764:0193 (1.00)` | lue | sûr |
| `1831:0187` |  | 44 | soustraction sur pointeur huge (sans appelant) | `1764:0193 (1.00)` | lue | sûr |
| `1831:01b3` |  | 286 | boîte de message ; touche O = sortie | `1764:01eb (0.97)` | lue | sûr |
| `1831:02d1` |  | 44 | horloge en centièmes : (ticks − DS:184e) × 100 / 60 | `1764:0300 (1.00)` | lue | sûr |
| `1831:02fd` |  | 13 | référence d'image : DS:6250 = ticks | `1764:032c (1.00)` | lue | sûr |
| `1831:030a` |  | 44 | attend ticks ≥ DS:6250 + n, avec rappel | `1764:0339 (0.94)` | lue | sûr |
| `1831:0336` |  | 98 | allocation DOS (sans appelant) | `305a:03ce (1.00)` | lue | probable |
| `1831:0398` |  | 23 | libération DOS (sans appelant) | `305a:0430 (1.00)` | lue | probable |

#### `186c` : Assembleur divers (copies, MSCDEX, mélange) (9 fonctions, 388 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `186c:0000` |  | 26 | copie de n doubles mots | `30bb:000a (1.00)` | lue | sûr |
| `186c:001a` |  | 26 | copie 16 000 doubles mots (tampon → écran) | `30bb:0024 (1.00)` | lue | sûr |
| `186c:0034` |  | 14 | INT 10h (mode texte) | `30bb:003e (1.00)` | lue | probable |
| `186c:0042` | `MSCDEX` | 26 | MSCDEX : premier lecteur CD | `30bb:004c (1.00)` | lue | sûr |
| `186c:005c` |  | 24 | normalise un pointeur huge | `30bb:0066 (1.00)` | lue | probable |
| `186c:0074` |  | 21 | normalise un pointeur huge | `30bb:007e (1.00)` | lue | probable |
| `186c:0089` |  | 95 | composition masquée : pixels ≥ 0x80 de A ← pixel de B | `30bb:0093 (1.00)` | lue | probable |
| `186c:00e8` |  | 86 | variante de composition (sans appelant) | `30bb:00f2 (1.00)` | lue | probable |
| `186c:013e` |  | 70 | mélange saturé de deux sons 8 bits | `30bb:0148 (1.00)` | lue | sûr |

#### `1884` : Assembleur divers (copies, MSCDEX, mélange) (3 fonctions, 410 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1884:003c` | `manettes` | 131 | manettes (port 201h) (rôle de l'équivalent) | `309e:003a (1.00)` | survolée | hypothèse |
| `1884:00bf` | `manettes_1884_00bf` | 193 | manettes (port 201h) (rôle de l'équivalent) | `309e:00bd (1.00)` | survolée | hypothèse |
| `1884:0185` | `manettes_1884_0185` | 86 | manettes (port 201h) (rôle de l'équivalent) | `309e:0183 (1.00)` | survolée | hypothèse |

#### `18a1` : Assembleur divers (copies, MSCDEX, mélange) (13 fonctions, 1001 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `18a1:0227` |  | 59 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:021f (1.00)` | survolée | hypothèse |
| `18a1:0262` |  | 88 | curseur 16×16 de bibliothèque : montre (0) ou retire (0x400000) le curseur, forme DS:11d4 | `30d4:025a (1.00)` | lue | sûr |
| `18a1:02ba` |  | 59 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:02b2 (1.00)` | survolée | hypothèse |
| `18a1:02f5` |  | 19 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:02ed (1.00)` | survolée | hypothèse |
| `18a1:0308` |  | 60 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:0300 (1.00)` | survolée | hypothèse |
| `18a1:0344` |  | 52 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:033c (1.00)` | survolée | hypothèse |
| `18a1:0379` |  | 121 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:0371 (1.00)` | survolée | hypothèse |
| `18a1:03f2` |  | 31 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:03ea (1.00)` | survolée | hypothèse |
| `18a1:0413` |  | 57 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:040b (0.95)` | survolée | hypothèse |
| `18a1:044c` |  | 93 | curseur graphique 16×16 de bibliothèque (rôle de l'équivalent) | `30d4:0444 (0.97)` | survolée | hypothèse |
| `18a1:04a9` |  | 1 | curseur graphique 16×16 de bibliothèque (fragment ou saut de 1 o) |  | non lue | hypothèse |
| `18a1:04aa` |  | 175 | curseur 16×16 de bibliothèque : rappel d'horloge, efface et redessine le curseur à l'écran | `30d4:04a2 (1.00)` | lue | sûr |
| `18a1:0559` |  | 186 | curseur 16×16 de bibliothèque : dessin de la forme DS:11d4 (segments par ligne, couleurs 0 et 255) | `30d4:0551 (1.00)` | lue | sûr |

#### `1902` : Clavier et manette (18 fonctions, 787 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1902:0050` | `frag_1902_0050` | 186 | pas du code : tables du clavier (traduction, échange AZERTY, cibles) | `3134:0080 (0.87)` | lue | sûr |
| `1902:0200` | `frag_1902_0200` | 18 | fragment de l'ISR clavier INT 9 |  | lue | probable |
| `1902:0213` | `frag_1902_0213` | 96 | ISR clavier : traduction du scancode, DS:4040 | `3134:021b (0.97)` | lue | probable |
| `1902:0276` | `thunk_FUN_1902_027e` | 2 | fragment de l'ISR clavier |  | survolée | probable |
| `1902:0279` | `frag_1902_0279` | 5 | fragment de l'ISR clavier |  | survolée | probable |
| `1902:027e` |  | 43 | fin de l'ISR clavier (acquittement ou chaînage) | `3134:0286 (1.00)` | lue | probable |
| `1902:02a9` | `frag_1902_02a9` | 1 | gestionnaire de touche : rien |  | lue | sûr |
| `1902:02aa` | `frag_1902_02aa` | 21 | gestionnaire : bits de DS:4052 | `3134:02b2 (1.00)` | lue | sûr |
| `1902:02bf` | `frag_1902_02bf` | 20 | gestionnaire : boutons (Espace, Entrée) → DS:4046 | `3134:02c7 (1.00)` | lue | sûr |
| `1902:02da` | `frag_1902_02da` | 56 | gestionnaire : directions → DS:403c / DS:403e |  | lue | sûr |
| `1902:0312` |  | 42 | remplace des entrées de la table de touches (sans appelant) | `3134:031a (1.00)` | lue | sûr |
| `1902:0342` |  | 49 | détourne INT 9 et enregistre 1902:03b3 | `3134:034a (1.00)` | lue | sûr |
| `1902:0373` |  | 49 | init clavier + souris (INT 33h AX=0), enregistre 1902:0434 | `3134:037b (1.00)` | lue | sûr |
| `1902:03a4` |  | 15 | restaure INT 9 | `3134:03ac (1.00)` | lue | sûr |
| `1902:03b3` | `rappel` | 13 | rappel : pointeur au clavier | `3134:03bb (1.00)` | lue | sûr |
| `1902:03c0` |  | 57 | déplace le pointeur selon les drapeaux (si DS:0144) | `3134:03c8 (1.00)` | lue | sûr |
| `1902:03f9` |  | 59 | borne le pointeur à l'écran | `3134:0401 (1.00)` | lue | sûr |
| `1902:0434` | `rappel_1902_0434` | 55 | rappel : souris (boutons, mickeys) | `3134:043c (0.89)` | lue | sûr |

#### `1948` : Lecteur MUX (8 fonctions, 1806 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1948:000b` |  | 97 | gestionnaire d'erreur du pilote MUX |  | lue | probable |
| `1948:006f` | `frag_1948_006f` | 240 | fragment de 1948:000b (boîte d'erreur) | `179a:0002 (0.71)` | lue | probable |
| `1948:015f` | `frag_1948_015f` | 47 | fragment de 1948:000b (sortie « Exit Mux ») |  | lue | probable |
| `1948:018e` |  | 469 | rappel de bloc MUX : 05, 08 (atoi → DS:6425), 6F, 70 | `179a:016e (0.79)` | lue | sûr |
| `1948:0363` |  | 16 | pas du code : table des 4 types de blocs et de leurs cibles |  | lue | sûr |
| `1948:0373` |  | 317 | rappel de pas d'image MUX : interruption, décodage, surimpression, cb_image | `179a:0421 (0.70)` | lue | sûr |
| `1948:04b0` |  | 28 | rappel d'horloge pendant un MUX : DS:184e += 1 un tick sur deux |  | lue | sûr |
| `1948:04cc` |  | 592 | lecteur MUX (nom, options, cb_image, cb_bloc) → 1 si interrompu | `179a:0673 (0.87)` | lue | sûr |

#### `19b9` : Lecteur MUK (2 fonctions, 652 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `19b9:000c` |  | 403 | lit un enregistrement MUK (0 valeur, 1 palette, 2 image) |  | lue | sûr |
| `19b9:019f` |  | 249 | joue un MUK entier |  | lue | sûr |

#### `19e2` : Démarrage et menu principal (6 fonctions, 2826 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `19e2:0008` |  | 268 | précharge m43sa.hy8, M02S.HY8 et 11 bruitages en EMS |  | lue | sûr |
| `19e2:0114` |  | 135 | init générale puis introduction |  | lue | sûr |
| `19e2:019b` |  | 262 | nettoyage final (sons, polices, entrées, vidéo) |  | lue | sûr |
| `19e2:02a1` |  | 13 | lecteur CD → DS:6549 |  | lue | sûr |
| `19e2:02ae` |  | 94 | chdir vers le dossier de l'exe | `305a:010e (0.81)` | lue | sûr |
| `19e2:030c` | `main_menu_principal` | 2054 | init, menu M07, dispatch des 5 choix, démo |  | lue | sûr |

#### `1a93` : Utilitaires de jeu (aléatoire, attentes, chronomètres) (15 fonctions, 693 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1a93:000e` |  | 44 | nettoyage entre modules (police, couleurs, relâchement, fond) | `1f33:0009 (1.00)` | lue | sûr |
| `1a93:003a` |  | 23 | EMS A → VRAM | `1f33:0035 (1.00)` | lue | sûr |
| `1a93:0051` |  | 57 | A → B, A → VRAM, palette | `1f33:004c (1.00)` | lue | sûr |
| `1a93:008a` |  | 65 | graine du hasard | `1f33:0085 (1.00)` | lue | sûr |
| `1a93:00cb` | `rnd` | 54 | rnd() | `1f33:00c6 (1.00)` | lue | sûr |
| `1a93:0101` |  | 60 | attend n cs (avec curseur) | `1f33:00fc (0.95)` | lue | sûr |
| `1a93:013d` |  | 48 | attend n cs | `1f33:0154 (0.94)` | lue | sûr |
| `1a93:016d` |  | 25 | démarre le chrono k | `1f33:0181 (0.91)` | lue | sûr |
| `1a93:0186` |  | 37 | secondes du chrono k | `1f33:019a (0.93)` | lue | sûr |
| `1a93:01ab` |  | 23 | horloge cs & masque | `1f33:025c (1.00)` | lue | sûr |
| `1a93:01c2` |  | 1 | RETF seul |  | lue | sûr |
| `1a93:01c3` |  | 82 | attend n s ou clic gauche | `1f33:0279 (0.91)` | lue | sûr |
| `1a93:0215` |  | 89 | attend n s, bouton ou Échap | `1f33:02c0 (0.85)` | lue | sûr |
| `1a93:026e` |  | 55 | attend le relâchement des boutons (5 s max) | `1f33:030e (0.88)` | lue | sûr |
| `1a93:02a5` |  | 30 | vrai si clic gauche ou n s écoulées (chrono 0) | `1f33:0500 (1.00)` | lue | sûr |

#### `1abf` : Partie : réglages, tour, dé, fin (18 fonctions, 9657 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1abf:0003` | `rappel_clic_de` | 19 | mémorise un clic pendant l'attente du dé |  | lue | sûr |
| `1abf:0016` | `lancer_de` | 227 | défilement des faces, arrêt au clic ou à 10 s |  | lue | sûr |
| `1abf:00f9` | `deplacer_pion` | 187 | avance case par case modulo 54 |  | lue | sûr |
| `1abf:01b4` | `annoncer_joueur` | 230 | voix d'annonce + clignotement du pion |  | lue | sûr |
| `1abf:029a` | `sequence_secrete` | 98 | détecte droite, gauche, haut, bas, droite, gauche |  | lue | sûr |
| `1abf:02fc` | `rappel_pause` | 22 | arrête le MUX de pause si séquence faite |  | lue | sûr |
| `1abf:0312` | `ligne_menu_cache` | 110 | texte ombré d'une ligne |  | lue | sûr |
| `1abf:0380` | `menu_de_debogage` | 1024 | CheatMode, langue, joystick, code clavier |  | lue | sûr |
| `1abf:07f4` | `pause_M48` | 240 | écran de pause, décompte du temps, accès au menu caché |  | lue | sûr |
| `1abf:08e4` | `menu_du_tour` | 1018 | dé / marbre / carte, délai 15 s, pause, triche |  | lue | sûr |
| `1abf:0cde` | `test_victoire` | 62 | objets suffisants et case 1 à 3 |  | lue | sûr |
| `1abf:0d1c` | `incruster_portrait` | 135 | image 128 couleurs incrustée sur l'écran |  | lue | sûr |
| `1abf:0da3` | `ecran_de_fin` | 502 | victoire (M03DB + M11) ou César (M42, M12) |  | lue | sûr |
| `1abf:0f99` | `tour_d_un_joueur` | 1078 | annonce, prison, menu, dé, déplacement, cases |  | lue | sûr |
| `1abf:13e5` | `init_partie` | 333 | remise à zéro, rejouer, défauts du solo |  | lue | sûr |
| `1abf:1532` | `choix_des_joueurs` | 2572 | écran M08 + niveaux |  | lue | sûr |
| `1abf:1f3e` | `reglages` | 1251 | écran M09 durée / objets |  | lue | sûr |
| `1abf:2431` | `boucle_de_partie` | 549 | manches, temps, fin |  | lue | sûr |

#### `1d24` : Plateau, marbre, carte, score (19 fonctions, 7601 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1d24:0006` | `confirmer_oui_non` | 602 | question NON / OUI sur M49DA00n.mcc, 60 s, renvoie 0 / 1 |  | lue | sûr |
| `1d24:0260` | `secousse_ecran` | 301 | tremblement de l'écran (piège) | `1f33:03ee` | lue | probable |
| `1d24:038d` | `defilement_plateau` | 651 | défilement vertical du plateau (1 ou 2 rangées) |  | lue | probable |
| `1d24:0618` | `afficher_plateau` | 762 | charge l'image des 9 cases, portrait, dé, porte de prison, debug |  | lue | sûr |
| `1d24:0912` | `ajouter_sesterces` | 167 | ajoute / retire des sesterces bornés 0..99 avec tintements |  | lue | sûr |
| `1d24:09b9` | `case_visible` | 73 | la position est-elle dans les 3 rangées affichées |  | lue | sûr |
| `1d24:0a02` | `rang_a_l_ecran` | 66 | rangée d'écran 0..2 d'une position, −1 sinon |  | lue | sûr |
| `1d24:0a44` | `choisir_joueur` | 421 | choix d'un joueur sur l'écran de score, 20 s, départ aléatoire |  | lue | sûr |
| `1d24:0be9` | `retirer_joueur_courant` | 199 | supprime le joueur courant (abandon) |  | lue | sûr |
| `1d24:0cb0` | `encadrer_cases_visibles` | 113 | cadres rouges des 9 cases sur la carte |  | lue | sûr |
| `1d24:0d21` | `dessiner_pions_carte` | 223 | mini-pions des joueurs sur la carte, clignotement du courant |  | lue | sûr |
| `1d24:0e08` | `carte_generale` | 395 | écran CARTE, 60 s |  | lue | sûr |
| `1d24:0f93` | `score_dessiner_bandeaux` | 95 | bandeaux des personnages (m03sb.hy8) |  | lue | sûr |
| `1d24:0ff2` | `score_dessiner_compteurs` | 313 | temps, gourdes, sesterces, objets de chaque joueur |  | lue | sûr |
| `1d24:112b` | `ecran_score_et_commentaire` | 994 | écran SCORE + commentaire de Panoramix (voix K63 ou MUX M42) |  | lue | sûr |
| `1d24:150d` | `table` | 13 | durées 1800..7200 + sauts de 112b |  | lue | sûr |
| `1d24:151d` | `marbre_dessiner_compteurs` | 254 | compteurs et croix des objets du marbre |  | lue | sûr |
| `1d24:161b` | `marbre_de_route` | 1597 | menu RETOUR / CARTE / SCORE / ABANDON / FIN + triche debug |  | lue | sûr |
| `1d24:1c6e` | `plateau_dessiner_pion` | 362 | recadre le plateau, dessine le pion courant et le dé |  | lue | sûr |

#### `1f01` : Mini-jeu MDF/25 (1 fonctions, 770 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1f01:0008` | `mg25_anachronismes` | 770 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `1f31` : Mini-jeu MDF/26 (5 fonctions, 1325 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1f31:000a` |  | 231 |  |  | non lue |  |
| `1f31:00f1` |  | 212 |  |  | non lue |  |
| `1f31:01c5` |  | 176 |  |  | non lue |  |
| `1f31:0275` |  | 31 |  |  | non lue |  |
| `1f31:0294` | `mg26_brouillard` | 675 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `1f84` : Mini-jeu MDF/36 (5 fonctions, 1573 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1f84:0007` |  | 388 |  |  | non lue |  |
| `1f84:018b` |  | 207 |  |  | non lue |  |
| `1f84:025a` |  | 302 |  |  | non lue |  |
| `1f84:0388` |  | 130 |  |  | non lue |  |
| `1f84:040a` | `mg36_ciel` | 546 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `1fe6` : Mini-jeu MDF/35 (2 fonctions, 2376 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `1fe6:000c` |  | 55 |  |  | non lue |  |
| `1fe6:0043` | `mg35_coloriages` | 2321 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `207c` : Mini-jeu MDF/24 (1 fonctions, 2017 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `207c:000c` | `mg24_loupe` | 2017 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `20fa` : Cases du plateau (22 fonctions, 9571 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `20fa:000d` | `cb_prison_cellule` | 1 | callback MUX prison : recopie l'animation dans la vignette du pion (table 00c0) |  | lue | probable |
| `20fa:000e` | `frag_20fa_000e` | 1 | RETF isolé (fin du rappel 20fa:000d) |  | lue | probable |
| `20fa:0010` | `frag_20fa_0010` | 176 | corps du rappel MUX de la prison (suite de 20fa:000d) : recopie l'animation dans la vignette du pion |  | lue | probable |
| `20fa:00d2` | `case_prison` | 64 | pose le drapeau prison, M20AA |  | lue | sûr |
| `20fa:0112` | `cb_prison_sortie` | 98 | callback de M20AM |  | lue | probable |
| `20fa:0174` | `anim_sortie_libre` | 333 | M20AM + redessin du pion |  | lue | sûr |
| `20fa:02c1` | `prison_debut_de_tour` | 634 | gourde ou tour perdu ; solo gratuit |  | lue | sûr |
| `20fa:053e` | `cb_repos` | 155 | callback des M21AA/AD/AG/AJ |  | lue | probable |
| `20fa:05d9` | `table_20fa_05d9` | 16 | 4 positions + 4 sauts de 053e |  | lue | sûr |
| `20fa:05e9` | `case_repos` | 990 | halte, brigands, 2 jeux d'ambiance |  | lue | sûr |
| `20fa:09c7` | `espion_deplacement` | 444 | curseur sur la carte, cases interdites |  | lue | sûr |
| `20fa:0b83` | `case_espion` | 768 | choix libre d'une case, 30 s |  | lue | sûr |
| `20fa:0e83` | `cb_piege` | 169 | callback des M14..M19AA (table 0f2c) |  | lue | probable |
| `20fa:0f38` | `case_piege` | 608 | renvoi vers une autre case |  | lue | sûr |
| `20fa:1198` | `table____11b0_cb_potion` | 139 | 6 positions + 6 sauts de 0f38 ; callback de M37AA |  | lue | sûr |
| `20fa:1223` | `case_potion` | 236 | +1 gourde, maximum 5 |  | lue | sûr |
| `20fa:130f` | `annonce_jeu` | 75 | voix K60TE, variante tournante DS:2aa6 |  | lue | sûr |
| `20fa:135a` | `case_jeu` | 275 | dispatch des 15 mini-jeux (table 146d) |  | lue | sûr |
| `20fa:146d` | `table_20fa_146d` | 59 | 15 positions + 15 sauts |  | lue | sûr |
| `20fa:14a9` | `case_marchand` | 1155 | Epidemaïs : achat d'un objet pour 3 sesterces |  | lue | sûr |
| `20fa:192e` | `case_devin` | 2541 | solde du pari précédent, nouveau pari 0..5 |  | lue | sûr |
| `20fa:231b` | `case_surprise` | 634 | oui/non puis Détritus, gourde, sesterces ou espion |  | lue | sûr |

#### `2353` : Mini-jeu MDF/33 (1 fonctions, 2023 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2353:0005` | `mg33_hieroglyphes` | 2023 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `23d1` : Mini-jeu MDF/34 (7 fonctions, 3329 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `23d1:000c` |  | 413 |  |  | non lue |  |
| `23d1:01a9` |  | 96 |  |  | non lue |  |
| `23d1:0209` |  | 693 |  |  | non lue |  |
| `23d1:04be` |  | 317 |  |  | non lue |  |
| `23d1:05fb` |  | 266 |  |  | non lue |  |
| `23d1:0705` |  | 700 |  |  | non lue |  |
| `23d1:09c1` | `mg34_idefix` | 844 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `24a1` : Mini-jeu MDF/30 (5 fonctions, 1045 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `24a1:000d` |  | 403 |  |  | non lue |  |
| `24a1:01a0` |  | 89 |  |  | non lue |  |
| `24a1:01f9` |  | 89 |  |  | non lue |  |
| `24a1:0254` |  | 38 |  |  | non lue |  |
| `24a1:027a` | `mg30_olympiques` | 426 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `24e3` : Mini-jeu MDF/28-29 (3 fonctions, 2501 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `24e3:0004` |  | 514 |  |  | non lue |  |
| `24e3:0210` |  | 492 |  |  | non lue |  |
| `24e3:0406` | `mg28_29_sangliers_pirates` | 1495 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `2580` : Mini-jeu MDF/22 (4 fonctions, 1798 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2580:000d` |  | 296 |  |  | non lue |  |
| `2580:0135` |  | 271 |  |  | non lue |  |
| `2580:0244` |  | 367 |  |  | non lue |  |
| `2580:03b3` | `mg22_poissons` | 864 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `25f1` : Quiz des pays (5 fonctions, 2905 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `25f1:0003` | `copie_ligne_question` | 67 | copie bornée jusqu'à ?\r |  | lue | sûr |
| `25f1:0046` | `tire_et_charge_question` | 785 | tirage, lecture du TXT, mise en lignes, réponses |  | lue | sûr |
| `25f1:0357` | `affiche_question` | 47 | 5 lignes en (20, 30 + 18i) |  | lue | sûr |
| `25f1:0386` | `affiche_reponses` | 167 | 3 réponses en (20, 118 + 18i), surlignage |  | lue | sûr |
| `25f1:042d` | `case_pays` | 1839 | quiz complet, rattrapage, gain de l'objet, debug |  | lue | sûr |

#### `26a6` : Mini-jeu MDF/32 (5 fonctions, 2834 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `26a6:000c` |  | 63 |  |  | non lue |  |
| `26a6:004b` |  | 1001 |  |  | non lue |  |
| `26a6:0454` |  | 819 |  |  | non lue |  |
| `26a6:078b` |  | 121 |  |  | non lue |  |
| `26a6:0804` | `mg32_bagarre` | 830 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `275a` : Mini-jeu MDF/23 (2 fonctions, 1514 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `275a:000a` |  | 72 |  |  | non lue |  |
| `275a:0052` | `mg23_barde` | 1442 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `27ba` : Mini-jeu MDF/31 (4 fonctions, 2135 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `27ba:0009` |  | 214 |  |  | non lue |  |
| `27ba:00df` |  | 433 |  |  | non lue |  |
| `27ba:0290` |  | 710 |  |  | non lue |  |
| `27ba:0561` | `mg31_fakir` | 778 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `2840` : Mini-jeu MDF/27 (3 fonctions, 1158 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2840:000b` |  | 321 |  |  | non lue |  |
| `2840:014c` |  | 128 |  |  | non lue |  |
| `2840:023a` | `mg27_tempete` | 709 | point d'entrée du mini-jeu (appelé par le dispatch 20fa:135a) |  | non lue | sûr |

#### `288f` : Tullius Détritus (1 fonctions, 1849 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `288f:000f` | `detritus` | 1849 | 4 tours sur soi ou 4 tours sur une victime |  | lue | sûr |

#### `2904` : Pilote Sound Blaster et mélange (19 fonctions, 2677 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2904:0018` |  | 252 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:000c (1.00)` | survolée | hypothèse |
| `2904:0114` |  | 48 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:0108 (1.00)` | survolée | hypothèse |
| `2904:0144` |  | 90 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:0138 (1.00)` | survolée | hypothèse |
| `2904:01a0` |  | 20 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:0194 (1.00)` | survolée | hypothèse |
| `2904:01b4` |  | 523 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:01a8 (1.00)` | survolée | hypothèse |
| `2904:03bf` |  | 72 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:03b3 (1.00)` | survolée | hypothèse |
| `2904:0407` |  | 231 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:03fb (1.00)` | survolée | hypothèse |
| `2904:04ee` |  | 60 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:04e2 (1.00)` | survolée | hypothèse |
| `2904:052a` |  | 36 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:051e (1.00)` | survolée | hypothèse |
| `2904:054e` |  | 154 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:0542 (1.00)` | survolée | hypothèse |
| `2904:05e8` |  | 279 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:05dc (1.00)` | survolée | hypothèse |
| `2904:06ff` |  | 93 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:06f3 (1.00)` | survolée | hypothèse |
| `2904:075c` |  | 495 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:0750 (1.00)` | survolée | hypothèse |
| `2904:094d` |  | 5 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (fragment ou saut de 5 o) |  | non lue | hypothèse |
| `2904:0952` | `thunk_FUN_2904_0954` | 2 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (fragment ou saut de 2 o) |  | non lue | hypothèse |
| `2904:0954` |  | 107 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:0948 (1.00)` | survolée | hypothèse |
| `2904:09bf` | `thunk_FUN_2904_09c1` | 2 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (fragment ou saut de 2 o) |  | non lue | hypothèse |
| `2904:09c1` |  | 62 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:09b5 (1.00)` | survolée | hypothèse |
| `2904:09ff` |  | 146 | pilote MUX : ouverture, en-tête, lecture des blocs, fermeture (rôle de l'équivalent) | `336a:09f3 (1.00)` | survolée | hypothèse |

#### `29ad` : Pilote Sound Blaster et mélange (2 fonctions, 617 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `29ad:0001` |  | 494 | décodeur MUX : traite les blocs jusqu'à la fin d'image | `3412:0005 (1.00)` | lue | probable |
| `29ad:0205` |  | 123 | pas du décodeur asservi au son (jusqu'à 32 images) | `3412:0209 (1.00)` | lue | probable |

#### `29d5` : Pilote Sound Blaster et mélange (9 fonctions, 1329 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `29d5:0000` |  | 104 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:0004 (0.95)` | survolée | hypothèse |
| `29d5:0068` |  | 36 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:006c (1.00)` | survolée | hypothèse |
| `29d5:008c` |  | 447 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:0090 (0.99)` | survolée | hypothèse |
| `29d5:024b` |  | 156 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:024f (1.00)` | survolée | hypothèse |
| `29d5:02e7` |  | 48 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:02eb (1.00)` | survolée | hypothèse |
| `29d5:0317` |  | 425 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:031b (0.99)` | survolée | hypothèse |
| `29d5:04c0` |  | 25 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:04c4 (1.00)` | survolée | hypothèse |
| `29d5:04d9` |  | 66 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:04dd (1.00)` | survolée | hypothèse |
| `29d5:051b` |  | 22 | son du MUX (tampons DMA) (rôle de l'équivalent) | `343a:051f (0.80)` | survolée | probable |

#### `2a28` : Pilote Sound Blaster et mélange (30 fonctions, 2915 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2a28:0001` |  | 8 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (fragment ou saut de 8 o) |  | non lue | hypothèse |
| `2a28:000a` | `frag_2a28_000a` | 7 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (fragment ou saut de 7 o) |  | non lue | hypothèse |
| `2a28:0048` | `frag_2a28_0048` | 256 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0048 (0.92)` | survolée | probable |
| `2a28:0149` | `frag_2a28_0149` | 16 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0149 (0.78)` | survolée | probable |
| `2a28:0159` |  | 135 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:015d (0.96)` | survolée | hypothèse |
| `2a28:01e0` |  | 36 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:01e4 (0.96)` | survolée | hypothèse |
| `2a28:0205` | `frag_2a28_0205` | 17 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0205 (0.76)` | survolée | probable |
| `2a28:0216` |  | 140 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:021a (0.98)` | survolée | hypothèse |
| `2a28:02a2` |  | 55 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:02a6 (0.97)` | survolée | hypothèse |
| `2a28:02d9` |  | 48 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:02dd (1.00)` | survolée | hypothèse |
| `2a28:0309` |  | 161 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:030d (0.98)` | survolée | hypothèse |
| `2a28:03aa` |  | 79 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:03ae (1.00)` | survolée | hypothèse |
| `2a28:03f9` |  | 164 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:03fd (0.99)` | survolée | hypothèse |
| `2a28:049d` |  | 189 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:04a1 (1.00)` | survolée | hypothèse |
| `2a28:055a` |  | 118 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:055e (0.88)` | survolée | probable |
| `2a28:05d0` |  | 20 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:05d4 (1.00)` | survolée | hypothèse |
| `2a28:05e4` |  | 29 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:05e8 (1.00)` | survolée | hypothèse |
| `2a28:0601` |  | 18 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0605 (1.00)` | survolée | hypothèse |
| `2a28:0613` |  | 11 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0617 (1.00)` | survolée | hypothèse |
| `2a28:061e` |  | 15 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0622 (1.00)` | survolée | hypothèse |
| `2a28:062d` |  | 84 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0631 (1.00)` | survolée | hypothèse |
| `2a28:0681` |  | 54 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0685 (1.00)` | survolée | hypothèse |
| `2a28:06b7` |  | 120 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:06bb (0.98)` | survolée | hypothèse |
| `2a28:072f` |  | 122 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0733 (1.00)` | survolée | hypothèse |
| `2a28:07aa` |  | 61 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:07ae (1.00)` | survolée | hypothèse |
| `2a28:07e7` |  | 223 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:07eb (0.99)` | survolée | hypothèse |
| `2a28:08c6` |  | 63 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:08ca (0.97)` | survolée | hypothèse |
| `2a28:0905` |  | 114 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0909 (1.00)` | survolée | hypothèse |
| `2a28:0977` |  | 451 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:097b (1.00)` | survolée | hypothèse |
| `2a28:0b3e` |  | 101 | pilote Sound Blaster (DSP, DMA, mélangeur, variable BLASTER) (rôle de l'équivalent) | `348d:0b42 (1.00)` | survolée | hypothèse |

#### `2ae2` : Bas niveau (vidéo, sprites, police, DOS) (3 fonctions, 160 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2ae2:008a` |  | 82 | gestionnaire d'erreur critique DOS (INT 24h) du pilote (rôle de l'équivalent) | `3547:008e (0.97)` | survolée | hypothèse |
| `2ae2:00dc` |  | 49 | gestionnaire d'erreur critique DOS (INT 24h) du pilote (rôle de l'équivalent) | `3547:00e0 (1.00)` | survolée | hypothèse |
| `2ae2:010d` |  | 29 | gestionnaire d'erreur critique DOS (INT 24h) du pilote (rôle de l'équivalent) | `3547:0111 (1.00)` | survolée | hypothèse |

#### `2af4` : Bas niveau (vidéo, sprites, police, DOS) (10 fonctions, 521 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2af4:002d` |  | 69 | programme le PIT avec DS:38dc | `3559:0031 (1.00)` | lue | sûr |
| `2af4:0072` |  | 113 | détourne INT 8 | `3559:0076 (0.98)` | lue | sûr |
| `2af4:00e4` |  | 122 | ISR INT 8 : rappels, chaînage | `3559:00e8 (0.98)` | survolée | sûr |
| `2af4:015e` |  | 23 | enregistre un rappel d'horloge | `3559:0162 (1.00)` | survolée | sûr |
| `2af4:0175` |  | 23 | enregistre un rappel d'horloge | `3559:0162 (1.00)` | survolée | sûr |
| `2af4:018c` |  | 36 | PIT / INT 8 (rôle de l'équivalent) | `3559:0190 (0.94)` | survolée | probable |
| `2af4:01b0` |  | 21 | retire un rappel d'horloge | `3559:01b4 (1.00)` | survolée | sûr |
| `2af4:01c5` |  | 21 | retire un rappel d'horloge | `3559:01b4 (1.00)` | survolée | sûr |
| `2af4:01da` |  | 44 | PIT / INT 8 (rôle de l'équivalent) | `3559:01de (0.95)` | survolée | hypothèse |
| `2af4:0206` |  | 49 | restaure INT 8 et le PIT | `3559:020a (1.00)` | survolée | sûr |

#### `2b17` : Bas niveau (vidéo, sprites, police, DOS) (3 fonctions, 1024 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2b17:0009` |  | 188 | décodeur de bloc vidéo MUX (rôle de l'équivalent) | `357c:000d (1.00)` | survolée | hypothèse |
| `2b17:00c5` |  | 84 | décodeur de bloc vidéo MUX (rôle de l'équivalent) | `357c:00c9 (1.00)` | survolée | hypothèse |
| `2b17:0119` |  | 752 | décodeur de bloc vidéo MUX (rôle de l'équivalent) | `357c:011d (1.00)` | survolée | hypothèse |

#### `2b57` : Bas niveau (vidéo, sprites, police, DOS) (3 fonctions, 861 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2b57:01ac` |  | 19 | blitter HY8 (clip, variantes miroir) (rôle de l'équivalent) | `317b:01a6 (1.00)` | survolée | hypothèse |
| `2b57:01bf` |  | 19 | blitter HY8 (clip, variantes miroir) (rôle de l'équivalent) | `317b:01a6 (1.00)` | survolée | hypothèse |
| `2b57:01d2` |  | 823 | blitter HY8 (clip, variantes miroir) (rôle de l'équivalent) | `317b:01cc (1.00)` | survolée | hypothèse |

#### `2ba7` : Bas niveau (vidéo, sprites, police, DOS) (2 fonctions, 73 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2ba7:000a` |  | 24 | copie 64 000 octets (src, dst) | `31cb:0004 (1.00)` | lue | sûr |
| `2ba7:0022` |  | 49 | copies plein écran (rôle de l'équivalent) | `31cb:001c (1.00)` | survolée | hypothèse |

#### `2bac` : Bas niveau (vidéo, sprites, police, DOS) (1 fonctions, 82 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2bac:0004` |  | 82 | copie de rectangle | `31cf:000e (1.00)` | survolée | sûr |

#### `2bb1` : Bas niveau (vidéo, sprites, police, DOS) (2 fonctions, 666 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2bb1:0006` |  | 561 | tracé de ligne (rôle de l'équivalent) | `31d5:0000 (1.00)` | survolée | hypothèse |
| `2bb1:023a` |  | 105 | tracé de ligne (rôle de l'équivalent) | `31d5:0234 (1.00)` | survolée | hypothèse |

#### `2bdb` : Bas niveau (vidéo, sprites, police, DOS) (14 fonctions, 1198 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2bdb:0407` |  | 56 | sprites HY8 composés (rôle de l'équivalent) | `31fe:0411 (1.00)` | survolée | hypothèse |
| `2bdb:043f` |  | 56 | sprites HY8 composés (rôle de l'équivalent) | `31fe:0411 (1.00)` | survolée | hypothèse |
| `2bdb:0477` |  | 136 | sprites HY8 composés (rôle de l'équivalent) | `31fe:0481 (1.00)` | survolée | hypothèse |
| `2bdb:04ff` |  | 148 | sprites HY8 composés (rôle de l'équivalent) | `31fe:0509 (1.00)` | survolée | hypothèse |
| `2bdb:0593` |  | 270 | sprites HY8 composés (rôle de l'équivalent) | `31fe:059d (0.98)` | survolée | hypothèse |
| `2bdb:06a1` |  | 147 | sprites HY8 composés (rôle de l'équivalent) | `31fe:06ab (1.00)` | survolée | hypothèse |
| `2bdb:0734` |  | 64 | sprites HY8 composés (rôle de l'équivalent) | `31fe:073e (1.00)` | survolée | hypothèse |
| `2bdb:0774` | `frag_2bdb_0774` | 52 | sprites HY8 composés (rôle de l'équivalent) | `31fe:077e (1.00)` | survolée | hypothèse |
| `2bdb:07a8` |  | 16 | sprites HY8 composés (rôle de l'équivalent) | `31fe:07b2 (1.00)` | survolée | hypothèse |
| `2bdb:07b8` |  | 43 | sprites HY8 composés (rôle de l'équivalent) | `31fe:07c2 (1.00)` | survolée | hypothèse |
| `2bdb:07e3` | `frag_2bdb_07e3` | 42 | sprites HY8 composés (rôle de l'équivalent) | `31fe:07ed (1.00)` | survolée | hypothèse |
| `2bdb:080d` | `frag_2bdb_080d` | 61 | sprites HY8 composés (rôle de l'équivalent) | `31fe:0817 (1.00)` | survolée | hypothèse |
| `2bdb:084a` | `frag_2bdb_084a` | 94 | sprites HY8 composés (rôle de l'équivalent) | `31fe:0854 (1.00)` | survolée | hypothèse |
| `2bdb:08a8` | `frag_2bdb_08a8` | 13 | sprites HY8 composés (rôle de l'équivalent) | `31fe:08b2 (1.00)` | survolée | hypothèse |

#### `2c66` : Bas niveau (vidéo, sprites, police, DOS) (2 fonctions, 176 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2c66:0008` |  | 31 | rectangle plein (rôle de l'équivalent) | `328a:0002 (1.00)` | survolée | hypothèse |
| `2c66:0028` |  | 145 | rectangle plein (rôle de l'équivalent) | `328a:0022 (1.00)` | survolée | hypothèse |

#### `2c71` : Bas niveau (vidéo, sprites, police, DOS) (4 fonctions, 193 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2c71:000b` |  | 70 | accès aux images HY8 (probable) (rôle de l'équivalent) | `3295:0005 (1.00)` | survolée | hypothèse |
| `2c71:0051` |  | 69 | accès aux images HY8 (probable) (rôle de l'équivalent) | `3295:004b (1.00)` | survolée | hypothèse |
| `2c71:0096` |  | 42 | accès aux images HY8 (probable) (rôle de l'équivalent) | `3295:0090 (1.00)` | survolée | hypothèse |
| `2c71:00c0` |  | 12 | accès aux images HY8 (probable) (rôle de l'équivalent) | `3295:00ba (1.00)` | survolée | hypothèse |

#### `2c7d` : Bas niveau (vidéo, sprites, police, DOS) (3 fonctions, 223 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2c7d:000c` |  | 72 | dimensions d'une image HY8 (rôle de l'équivalent) | `32a1:0006 (1.00)` | survolée | hypothèse |
| `2c7d:0054` |  | 65 | dimensions d'une image HY8 (rôle de l'équivalent) | `32a1:004e (1.00)` | survolée | hypothèse |
| `2c7d:0095` |  | 86 | dimensions d'une image HY8 (rôle de l'équivalent) | `32a1:008f (1.00)` | survolée | hypothèse |

#### `2c8b` : Bas niveau (vidéo, sprites, police, DOS) (1 fonctions, 70 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2c8b:000c` |  | 70 | utilitaire graphique (rôle de l'équivalent) | `32af:0006 (1.00)` | survolée | hypothèse |

#### `2c90` : Bas niveau (vidéo, sprites, police, DOS) (5 fonctions, 1035 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2c90:0002` |  | 559 | utilitaire graphique (non identifié) (rôle de l'équivalent) | `32b3:000c (1.00)` | survolée | hypothèse |
| `2c90:0232` |  | 124 | utilitaire graphique (non identifié) (rôle de l'équivalent) | `32b3:023c (1.00)` | survolée | hypothèse |
| `2c90:02ae` |  | 124 | utilitaire graphique (non identifié) (rôle de l'équivalent) | `32b3:02b8 (1.00)` | survolée | hypothèse |
| `2c90:032a` |  | 114 | utilitaire graphique (non identifié) (rôle de l'équivalent) | `32b3:0334 (1.00)` | survolée | hypothèse |
| `2c90:039c` |  | 114 | utilitaire graphique (non identifié) (rôle de l'équivalent) | `32b3:03a6 (1.00)` | survolée | hypothèse |

#### `2cd0` : Bas niveau (vidéo, sprites, police, DOS) (6 fonctions, 456 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2cd0:000e` |  | 16 | police PFN (sélection, dessin, largeur) (rôle de l'équivalent) | `32f4:0008 (1.00)` | survolée | hypothèse |
| `2cd0:001e` |  | 196 | police PFN (sélection, dessin, largeur) (rôle de l'équivalent) | `32f4:0018 (0.99)` | survolée | hypothèse |
| `2cd0:00e9` |  | 64 | police PFN (sélection, dessin, largeur) (rôle de l'équivalent) | `32f4:00e3 (1.00)` | survolée | hypothèse |
| `2cd0:0129` |  | 92 | sélectionne une police PFN et sa couleur | `32f4:0123 (1.00)` | lue | sûr |
| `2cd0:0185` |  | 19 | police PFN (sélection, dessin, largeur) (rôle de l'équivalent) | `32f4:017f (1.00)` | survolée | hypothèse |
| `2cd0:0198` |  | 69 | police PFN (sélection, dessin, largeur) (rôle de l'équivalent) | `32f4:0192 (1.00)` | survolée | hypothèse |

#### `2cee` : Bas niveau (vidéo, sprites, police, DOS) (11 fonctions, 557 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2cee:0000` |  | 177 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:000a (1.00)` | survolée | hypothèse |
| `2cee:00b1` |  | 24 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:00bb (1.00)` | survolée | hypothèse |
| `2cee:00c9` |  | 17 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:00d3 (1.00)` | survolée | hypothèse |
| `2cee:00da` |  | 25 | attend le retour vertical | `3311:00e4 (1.00)` | survolée | sûr |
| `2cee:00f3` |  | 16 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:00fd (1.00)` | survolée | hypothèse |
| `2cee:0103` |  | 50 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:010d (1.00)` | survolée | hypothèse |
| `2cee:0135` |  | 75 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:013f (1.00)` | survolée | hypothèse |
| `2cee:0180` |  | 39 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:018a (1.00)` | survolée | hypothèse |
| `2cee:01a7` |  | 45 | envoie une palette au DAC (8 → 6 bits) | `3311:01b1 (1.00)` | survolée | sûr |
| `2cee:01d4` |  | 27 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:01de (1.00)` | survolée | hypothèse |
| `2cee:01ef` |  | 62 | mode 13h, palette DAC, retour vertical (rôle de l'équivalent) | `3311:01f9 (1.00)` | survolée | hypothèse |

#### `2d10` : Bas niveau (vidéo, sprites, police, DOS) (13 fonctions, 524 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2d10:001d` |  | 65 | texte formaté à l'écran (rôle de l'équivalent) | `3334:0017 (1.00)` | survolée | hypothèse |
| `2d10:005e` |  | 8 | texte formaté à l'écran (fragment ou saut de 8 o) |  | non lue | hypothèse |
| `2d10:006e` |  | 19 | texte formaté à l'écran (rôle de l'équivalent) | `3334:0068 (1.00)` | survolée | hypothèse |
| `2d10:0081` |  | 30 | texte formaté à l'écran (rôle de l'équivalent) | `3334:007b (1.00)` | survolée | hypothèse |
| `2d10:009f` |  | 99 | texte formaté à l'écran (rôle de l'équivalent) | `3334:0099 (1.00)` | survolée | hypothèse |
| `2d10:0102` |  | 84 | texte formaté à l'écran (rôle de l'équivalent) | `3334:00fc (1.00)` | survolée | hypothèse |
| `2d10:0156` |  | 50 | texte formaté à l'écran (rôle de l'équivalent) | `3334:0150 (1.00)` | survolée | hypothèse |
| `2d10:0188` |  | 47 | texte formaté à l'écran (rôle de l'équivalent) | `3334:0182 (1.00)` | survolée | hypothèse |
| `2d10:01b7` |  | 1 | texte formaté à l'écran (fragment ou saut de 1 o) |  | non lue | hypothèse |
| `2d10:01b8` |  | 22 | texte formaté à l'écran (rôle de l'équivalent) | `3334:01b2 (1.00)` | survolée | hypothèse |
| `2d10:01ce` |  | 22 | texte formaté à l'écran (rôle de l'équivalent) | `3334:01b2 (1.00)` | survolée | hypothèse |
| `2d10:01e4` |  | 50 | texte formaté à l'écran (rôle de l'équivalent) | `3334:01de (1.00)` | survolée | hypothèse |
| `2d10:034d` |  | 27 | texte formaté à l'écran (rôle de l'équivalent) | `3334:0347 (1.00)` | survolée | hypothèse |

#### `2d46` : Bas niveau (vidéo, sprites, police, DOS) (12 fonctions, 850 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2d46:0008` |  | 43 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:000e (1.00)` | survolée | hypothèse |
| `2d46:0033` |  | 223 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:0039 (1.00)` | survolée | hypothèse |
| `2d46:0116` |  | 125 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:011c (1.00)` | survolée | hypothèse |
| `2d46:0193` |  | 123 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:0199 (1.00)` | survolée | hypothèse |
| `2d46:020e` |  | 11 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:0214 (1.00)` | survolée | hypothèse |
| `2d46:0219` |  | 20 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:021f (1.00)` | survolée | hypothèse |
| `2d46:022d` |  | 26 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:0233 (1.00)` | survolée | hypothèse |
| `2d46:0247` |  | 51 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:024d (1.00)` | survolée | hypothèse |
| `2d46:027a` |  | 53 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:0280 (1.00)` | survolée | hypothèse |
| `2d46:02af` |  | 73 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:02b5 (1.00)` | survolée | hypothèse |
| `2d46:02f8` |  | 77 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:02fe (1.00)` | survolée | hypothèse |
| `2d46:0345` |  | 25 | fichiers DOS (ouvrir, lire, écrire, fermer) (rôle de l'équivalent) | `35bc:034b (1.00)` | survolée | hypothèse |

#### `2d7b` : Bas niveau (vidéo, sprites, police, DOS) (8 fonctions, 432 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2d7b:0013` |  | 46 | INT F0h : commande (mort) |  | lue | sûr |
| `2d7b:0041` |  | 46 | INT F0h : commande (mort) |  | lue | sûr |
| `2d7b:006f` |  | 82 | INT F0h : commande par canal (mort) |  | lue | sûr |
| `2d7b:00c1` |  | 85 | INT F0h : détection IFGM et init (sans appelant) |  | lue | sûr |
| `2d7b:011f` |  | 37 | INT F0h : arrêt (sans effet, pilote jamais initialisé) |  | lue | sûr |
| `2d7b:0144` |  | 58 | INT F0h : charge un morceau (mort) |  | lue | sûr |
| `2d7b:017e` |  | 42 | INT F0h : commande (mort) |  | lue | sûr |
| `2d7b:01a8` |  | 36 | INT F0h : commande (mort) |  | lue | sûr |

#### `2d97` : Bas niveau (vidéo, sprites, police, DOS) (1 fonctions, 58 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2d97:000c` |  | 58 | taille d'un fichier (rôle de l'équivalent) | `35f2:0004 (1.00)` | survolée | hypothèse |

#### `2d9b` : Bas niveau (vidéo, sprites, police, DOS) (3 fonctions, 185 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2d9b:0006` |  | 93 | mémoire DOS (allouer, libérer, redimensionner) (rôle de l'équivalent) | `35f5:000e (1.00)` | survolée | hypothèse |
| `2d9b:0063` |  | 24 | mémoire DOS (allouer, libérer, redimensionner) (rôle de l'équivalent) | `35f5:006b (1.00)` | survolée | hypothèse |
| `2d9b:007b` |  | 68 | mémoire DOS (allouer, libérer, redimensionner) (rôle de l'équivalent) | `35f5:0083 (1.00)` | survolée | hypothèse |

#### `2da7` : Bas niveau (vidéo, sprites, police, DOS) (2 fonctions, 53 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2da7:0000` |  | 30 | publie DS:3fee sous INT 97h | `3601:0008 (1.00)` | lue | sûr |
| `2da7:001e` |  | 23 | lance le calibrage texte (sans appelant) | `3601:0026 (1.00)` | lue | sûr |

#### `2daa` : Bas niveau (vidéo, sprites, police, DOS) (4 fonctions, 433 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2daa:00dc` |  | 17 | lit les boutons de manette (port 201h) | `360e:00e2 (1.00)` | lue | sûr |
| `2daa:00ed` |  | 131 | lit les axes de manette | `309e:003a (1.00)` | survolée | probable |
| `2daa:0170` |  | 57 | attend un bouton de manette et lit la position | `360e:0176 (1.00)` | lue | probable |
| `2daa:01a9` |  | 228 | calibrage interactif en mode texte (mort) | `360e:01af (1.00)` | lue | probable |

#### `2dd2` : Bas niveau (vidéo, sprites, police, DOS) (3 fonctions, 228 octets)

| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |
|---|---|---:|---|---|---|---|
| `2dd2:000e` |  | 78 | entier 16 bits → texte | `3637:0004 (1.00)` | lue | sûr |
| `2dd2:005c` |  | 129 | entier 32 bits → texte | `3637:0052 (1.00)` | lue | sûr |
| `2dd2:00dd` |  | 21 | un chiffre de la conversion | `3637:00d3 (1.00)` | lue | sûr |
<!-- /GEN:funcs -->

## Bibliothèque Borland identifiée

<!-- GEN:libfuncs -->
| Adresse | Nom | Octets | Appelants | Confiance | Preuve |
|---|---|---:|---:|---|---|
| `1000:016b` | `lib__exit` | 18 | 1 | certain | INT 21h AH=4Ch (terminaison), appelée par le code de sortie du startup [= SMURF.EXE 1000:016b, 1.00] |
| `1000:017d` | `lib___SaveVectors` | 67 | 1 | certain | INT 21h AH=35h sur les vecteurs 0, 4, 5, 6 puis 25h (sauvegarde/installation, Borland startup) [= SMURF.EXE 1000:017d, 1.00] |
| `1000:01c0` | `lib___RestoreVectors` | 45 | 1 | certain | INT 21h AH=25h pour les vecteurs 0, 4, 5, 6 (restauration à la sortie) [= SMURF.EXE 1000:01c0, 1.00] |
| `1000:03b6` | `lib_N_SCOPY` | 28 | 10 | certain | copie de CX octets (rep movsw puis movsb), convention SCOPY@ de Borland [= SMURF.EXE 1000:03b6, 1.00] |
| `1000:060f` | `lib___IOerror` | 57 | 17 | certain | traduit un code d'erreur DOS en errno via une table , renvoie -1 [= SMURF.EXE 1000:060f, 0.96] |
| `1000:070d` | `lib_lseek` | 41 | 13 | certain | efface le bit 0x200 de _openfd[fd] puis INT 21h AH=42h [= SMURF.EXE 1000:0735, 0.94] |
| `1000:0736` | `lib_N_LXMUL` | 23 | 3 | certain | multiplication 32 bits DX:AX x CX:BX (aide du compilateur LXMUL@) [= SMURF.EXE 1000:075e, 1.00] |
| `1000:077f` | `lib_rand` | 38 | 1 | certain | seed = seed * LXMUL + 1, renvoie les 15 bits de poids fort [= SMURF.EXE 1000:07a7, 1.00] |
| `1000:07a5` | `lib_dos_read` | 47 | 1 | certain | INT 21h AH=3Fh [= SMURF.EXE 1000:07cd, 0.95] |
| `1000:0988` | `lib___vprinter_thunk` | 26 | 4 | certain | point d'entrée commun de sprintf / printf [= SMURF.EXE 1000:09b0, 1.00] |
| `1000:09ec` | `lib___vprinter` | 1071 | 1 | certain | moteur de printf : parse '%', drapeaux, largeur, précision, "(null)" [= SMURF.EXE 1000:0a14, 1.00] |
| `1000:184d` | `lib_dos_ioctl` | 41 | 1 | certain | INT 21h AH=44h [= SMURF.EXE 1000:155c, 1.00] |
| `1000:1d97` | `lib_dos_setblock` | 28 | 1 | certain | INT 21h AH=4Ah [= SMURF.EXE 1000:16b4, 1.00] |
| `1000:1ebd` | `lib_dos_chmod` | 29 | 1 | certain | INT 21h AH=43h [= SMURF.EXE 1000:17ae, 1.00] |
| `1000:1f02` | `lib_dos_close` | 30 | 2 | certain | INT 21h AH=3Eh [= SMURF.EXE 1000:17f3, 0.93] |
| `1000:22a9` | `lib_memcpy` | 36 | 18 | certain | copie rep movsw/movsb, renvoie la destination [= SMURF.EXE 1000:1b9a, 1.00] |
| `1000:22cd` | `lib___memset_fill` | 36 | 1 | certain | remplit avec un octet (aligne, rep stosw) [= SMURF.EXE 1000:1bbe, 1.00] |
| `1000:22f1` | `lib_memset` | 31 | 17 | certain | enveloppe de 1bbe (dest, octet, taille), renvoie dest [= SMURF.EXE 1000:1be2, 1.00] |
| `1000:2310` | `lib___memmove_impl` | 82 | 1 | certain | copie avec détection du recouvrement (sens de copie),  [= SMURF.EXE 1000:1c01, 1.00] |
| `1000:2362` | `lib_memmove` | 33 | 7 | certain | enveloppe de 1c01 [= SMURF.EXE 1000:1c53, 1.00] |
| `1000:2383` | `lib_dos_creat` | 27 | 1 | certain | INT 21h AH=3Ch [= SMURF.EXE 1000:1c74, 1.00] |
| `1000:239e` | `lib_dos_write` | 18 | 1 | certain | INT 21h AH=40h [= SMURF.EXE 1000:1c8f, 1.00] |
| `1000:23b0` | `lib_open` | 367 | 1 | certain | open(chemin, oflag, pmode) : drapeaux O_CREAT 0x100 / O_EXCL 0x400, appelle chmod, creat, open DOS, close, ioctl [= SMURF.EXE 1000:1ca1, 0.99] |
| `1000:251f` | `lib_dos_open` | 79 | 1 | certain | INT 21h AH=3Dh, remplit _openfd[fd] [= SMURF.EXE 1000:1e10, 0.97] |
| `1000:256e` | `lib_printf` | 27 | 4 | probable | appelle le moteur printf avec le FILE en DGROUP (stdout probable) [= SMURF.EXE 1000:1e5f, 1.00] |
| `1000:25a5` | `lib_fputc` | 399 | 3 | certain | écriture d'un caractère dans un FILE (tampon, drapeaux 8 = ligne, 0x100), appelle fflush/lseek/write [= SMURF.EXE 1000:1e96, 0.99] |
| `1000:2b82` | `lib_sprintf` | 34 | 27 | certain | met *buf = 0 puis appelle le moteur printf avec la fonction de sortie 2433 [= SMURF.EXE 1000:2473, 1.00] |
| `1000:2ba4` | `lib_vsprintf` | 33 | 2 | certain | même chose avec une va_list (4e paramètre) [= SMURF.EXE 1000:2495, 1.00] |
| `1000:2bc5` | `lib_strcat` | 63 | 2 | certain | strlen de la destination, strlen de la source, copie [= SMURF.EXE 1000:24b6, 1.00] |
| `1000:2c04` | `lib_strcpy` | 41 | 16 | certain | strlen de la source puis copie avec le NUL [= SMURF.EXE 1000:2525, 1.00] |
| `1000:2c2d` | `lib_strlen` | 31 | 8 | certain | repne scasb ; renvoie 0 si le pointeur est NULL [= SMURF.EXE 1000:254e, 1.00] |
| `1000:2c4c` | `lib_strncpy` | 49 | 1 | certain | copie au plus n octets puis complète par des zéros [= SMURF.EXE 1000:256d, 1.00] |
| `1000:33e3` | `lib_dos_write2` | 60 | 3 | certain | INT 21h AH=40h (variante avec contrôle de la longueur) [= SMURF.EXE 1000:2d04, 0.93] |
<!-- /GEN:libfuncs -->
