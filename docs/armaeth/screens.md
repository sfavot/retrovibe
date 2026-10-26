# Armaeth : écrans et enchaînement de l'interface

Tâche T8c. Référence pour une réimplémentation : tous les écrans de `AM1.EXE` (Grandslam 1994, version CD de Rob Northen Computing), dans l'ordre où le joueur les rencontre, avec ce qui est dessiné, les entrées, les temporisations et les déclencheurs. Sources : la rétro-ingénierie (`re-index.md`, corpus `archives/armaeth/re/`, adresses `segment:offset` Ghidra) et les données (`formats.md`, `graphics.md`, `audio.md`). Le moteur de salles / d'objets est dans `engine.md`, l'analyseur de commandes tapées dans `parser.md` (deux documents écrits en parallèle par d'autres tâches : on les cite sans les redire).

Confiance : **certain** = lu dans le code et, quand c'est dit, recoupé par un calcul sur les fichiers ; **probable** = déduit des appelants, des arguments ou des données ; **hypothèse** = lecture plausible non vérifiée. Aucun texte n'est reproduit : les textes affichés sont des messages des données (`A1FMSG.SYS`, `MSGINT`, `A1FCM2.SYS`), cités par leur identifiant. Le jeu n'a **aucun menu principal** : tout passe par l'écran de jeu, des fenêtres de message superposées, une ligne de saisie et une barre d'icônes.

## Corrections au cahier des charges

- `ARMAETH.BAT` contient `vga`, `sc0`, `am1 * a1f` (21 octets) et **pas** `sos.exe`. L'aide (`SOS.EXE`) est lancée à part par `AIDE.BAT`, `HELP.BAT` ou `HILFE.BAT` (`sos.exe * a1f`, `a1a`, `a1d`), depuis DOS, jamais depuis le jeu (confirmé, fichiers `.BAT` de `archives/armaeth/cd/`).
- `A1FINT.VGA` ne contient pas de sprites d'intro : ce sont les **icônes de l'interface** (30 ressources, `INT`), voir « Barre d'icônes ».
- Les quatre portraits de `A1F00E.VGA` (scène 20) ne sont pas des personnages à choisir : c'est la **présentation de la distribution** pendant le récit d'introduction. Le héros est unique (« KILLIAN », texte de `CM2`), il n'y a **aucun écran de sélection** de personnage.
- `MSGUTL` n'est pas lu par `AM1.EXE` mais par les utilitaires : `SOS.EXE` et `SC0.EXE` contiennent les chaînes `msghrd`, `msgutl`, `msgint` (confirmé, recherche de chaînes dans les exécutables) ; voir « Utilitaires ».

## Vue d'ensemble

| # | Écran | Quoi | Déclencheur | Sortie | Confiance |
|---|---|---|---|---|---|
| E0 | DOS | `START.BAT` → `CDPATCH`, `ARMINS`, `ARMAETH.BAT` : `vga`, `sc0`, `am1 * a1f` | joueur | fin de `AM1` | certain (fichiers) |
| E1 | Contrôle de protection (`SC0.EXE`, `SC1.EXE`) | « tableau numérique » : ligne, colonne, nombre (`MSGUTL` 2-15) | `ARMAETH.BAT` | `am1` | probable (messages + chaînes), non exécuté |
| E2 | Erreurs de démarrage | messages `MSGINT` / `MSGHRD`, `* Err nnn *`, `* SYS nnn *` | échec d'un contrôle | retour DOS | certain |
| E3 | Initialisation silencieuse | `CM1` : écran noir, aucun dessin | `gm_init_engine` | `CM2` | certain |
| E4 | Titre | scène 21 (`A1F00E.VGA`), musique `M1` | `CM2` (`lir 21`) | 80 ticks | certain |
| E5 | Distribution | scène 20 (quatre portraits) | `CM2` (`lir 20`) | 60 ticks, puis le récit | certain |
| E6 | Récit d'introduction | 10 fenêtres de texte sur la scène 20 | `CM2` (`tta` ×10) | clic / Entrée / Échap à chaque fenêtre, puis 40 ticks | certain |
| E7 | Jeu | cadre, salle, icônes, inventaire, curseur | `rsv -1` puis `gm_main_loop` | fin de partie, `Terminer` | certain |
| E8 | Ligne de saisie | boîte de 40 caractères au bas de la salle | une touche imprimable | Entrée, Échap | certain |
| E9 | Fenêtres de message | cadre à 5 anneaux, pagination | `gm_show_message_id`, `aff`, `tta`… | clic / Entrée / Échap ou délai | certain |
| E10 | Aide (F1), score (F6), inventaire (F10) | fenêtres de message | touches ou icônes | idem | certain |
| E11 | Pause / pas à pas / vitesse | Alt-P, Alt-N, Alt-A, Alt-Z, icônes | clavier, souris | — | certain |
| E12 | Sauvegarde / restauration / recommencer | boîte à 4 saisies, ou rechargement silencieux | F2, F3, F5 | retour au jeu | certain |
| E13 | Mort et résurrection | pas d'écran dédié ; héros absent | monstres, pièges | F4 / « continuer » | probable |
| E14 | Fins | couronnement, passages secrets, abandon, sortie | comportements de salles, `Terminer` | `gm_quit` | certain (abandon), probable (couronnement) |
| E15 | Aide hors jeu (`SOS.EXE`) | arbre de menus d'indices | `AIDE.BAT` | retour DOS | probable (lecteur non exécuté) |

## Principes communs

### Géométrie, palette, cadence

- **Mode vidéo** : VGA 320×200 (mode 13h) 256 couleurs, **seul le VGA est présent** dans les données (`*.VGA`) ; le moteur sait choisir `ega` / `vga` (`34eb:000c`) mais le CD ne contient aucun `.EGA` (certain). Un VGA est exigé par `VGA.EXE` (`vga_detect_adapter`, `re-index.md`).
- **Une seule palette** de 256 entrées (`graphics.md`). **Pas de fondu** nulle part : les scènes se remplacent d'un coup (`lir` = chargement + `vga_undo_all` + `vga_present`, `137b:0178`), les fenêtres s'affichent d'un coup. Le seul mécanisme de « fondu » est un **décalage de palette** `vga_set_palette(pal, dR, dG, dB)` (entrée `+0x4a`, valeurs -63..63 ajoutées aux entrées **0 à 215** ; les entrées 216 à 255, donc le cadre et les fenêtres, ne bougent jamais). Il sert à l'éclairage (ci-dessous), au jeton `rvb r v b` (`1250:0008`, appel direct) et aux effets `sl1`-`sl3` (`1611:0164`, compteurs R/V/B incrémentés). Certain.
- **Éclairage jour / nuit** (`197e:0008`, certain) : le décalage appliqué aux trois composantes est égal à `-63 + lumière`, avec `lumière` = (salle extérieure : courbe horaire interpolée par les minutes) + somme des champs `Lum` (`+0x0A`) des objets de la salle, du héros et de son contenu, borné à -63..63. Courbe horaire (`DGROUP:0E68`, 25 mots, certain) : `15 15 15 15 15 22 29 36 43 50 57 63 63 63 63 63 63 56 49 42 35 28 21 15 15` pour les heures 0 à 24 : nuit = -48 (sombre), 11 h à 16 h = 0 (pleine lumière). La palette est renvoyée au pilote à chaque changement de salle et **toutes les 10 minutes de jeu** (`18a9:0008`). Le jeton `lum a b` force le décalage (`a` non nul) ou le plafonne (`b`). L'horloge de jeu (`DGROUP:4B54..4B56`, heures:minutes:centièmes) avance d'un centième par tick de jeu ; `heu h m c` la règle (défaut 23:59:99).
- **Cadence** : la boucle principale (`18a9:0008`) attend le retour vertical à chaque tour (`vga_wait_vsync_present`, 70 Hz). Un « tick de jeu » = un tour de boucle, sauf ralentissement (`DGROUP:4B51` = n : un tick sur n + 1, 0 à 250). Les attentes de scripts (`wat n`) et les délais de fenêtres comptent en **tics BIOS à 18,2 Hz** (`gm_delay_ticks`, `35a4:0008`). Une journée de jeu = 24 × 60 × 100 = 144 000 ticks, soit environ 34 minutes à 70 ticks par seconde (probable, calcul).

### Composition de l'image (probable pour l'ensemble, certain pour chaque pièce)

Ordre, du fond vers le dessus : (1) **cadre** = scène 0 (couche A, 320×200) ; sa couche B, décodée dans le plan de profondeur, vaut 200 ou 216 sur le cadre et 0 dans la fenêtre de jeu ; (2) **image de la salle** (scène du joueur, rectangle `x, y, largeur, hauteur` de son en-tête) : `gm_decode_scene_image` n'écrit un pixel que si la valeur déjà présente dans le plan de profondeur est **inférieure à 200** (le cadre est donc intouchable), et remplit le reste de la fenêtre de jeu avec la couleur 0xDD (221, presque noire) marquée 199 ; (3) **objets** (sprites) via `vga_draw_sprite` avec test de priorité (un pixel opaque n'est écrit que si la priorité mémorisée est ≤ celle de l'objet) : la couche B de la salle fournit la profondeur du décor ; (4) **icônes et inventaire**, objets avec une priorité de 208 (inventaire, `1652:0006`) ; (5) **curseur** (priorité 250 = 0xFA, `1539:0084`, > 216 donc il passe sur le cadre ; 240 n'est qu'une valeur transitoire entre `1539:011c` et `1539:0084` au chargement, `interface.md` § 3.1) ; (6) **fenêtres de texte**, écrites **directement dans `A000`** (`FUN_32e1_0008` / `00a2`), effacées en recopiant le rectangle sale depuis le tampon d'arrière-plan (page 2) vers l'écran (`327a:05e2` : `vga_copy_rect`). Pour le port : calque de fenêtres au-dessus de l'image composée, vidé à la fermeture.
- **Coordonnées des objets de salle** : relatives au coin `(x, y)` du rectangle de la scène (le pilote ajoute le décalage `+0x1E/+0x20` quand les drapeaux de l'appel sont non nuls ; `gm_load_scene` renseigne `+0x1A..+0x20` depuis l'en-tête, `1cc3:00ed..`). Exemples (`graphics.md`) : salles en plein cadre `(0, 10, 320×180)`, intérieurs plus petits centrés (`(56, 50, 208×100)`, `(128, 60, 64×80)`…). Probable.

### Entrées

Tous les événements passent par `FUN_3588_0118` (`3588:0118`) qui classe le clavier BIOS en quatre types, d'après une table de 133 entrées dans le segment `3588` (lue dans l'exécutable, certain) :

| Type | Touche | Code renvoyé |
|---|---|---|
| 1 | caractère ASCII | le caractère |
| 2 | F1 à F10 | 1 à 10 ; Maj-F1..F10 = 11 à 20 ; Ctrl-F = 21 à 30 ; Alt-F = 31 à 40 |
| 3 | Alt-lettre (`Q W E…M`), Alt-chiffre `1…0`, Alt-`-`, Alt-`=` | la lettre majuscule ou le caractère |
| 4 | Début 1, Fin 2, Haut 3, Bas 4, Gauche 5, Droite 6, PgPrec 7, PgSuiv 8, Inser 10, Suppr 11 ; Maj-Tab 9 ; Ctrl-Début 12, Ctrl-Fin 13, Ctrl-Gauche 14, Ctrl-Droite 15, Ctrl-PgPrec 16, Ctrl-PgSuiv 17, Alt-Pause/0 18, Ctrl-ImprÉcr 19 | le code |

**Souris** : détectée au chargement du monde (`gm_mouse_reset`, `DGROUP:4CAC` = présente) ; plages `x 4..316`, `y 10..194` (`192e:0467..0499`, certain). Sans souris tout se fait au clavier. Le curseur est un **objet logiciel** (dessiné par le moteur, pas le curseur matériel) ; son apparence change selon l'outil choisi (voir « Barre d'icônes »).

### Mode de saisie « script en cours »

Quand un script `CM` tourne (`DGROUP:4B34` ≠ 0), la touche d'un caractère est ignorée, **F1** affiche l'aide, **F8** positionne `4B38 = 7` et relance le script (saut jusqu'au prochain `fin`, voir « Introduction » ; **probable**), les autres touches de fonction émettent un bip (`3574:0072`). Les attentes de fenêtre (`1db5:003e`) n'acceptent que clic gauche ou droit, Entrée (0x0D) et Échap (0x1B) ; toute autre touche fait un bip. Le bouton enfoncé à l'ouverture doit d'abord être relâché (`1db5:01aa`) : le clic qui a déclenché une fenêtre ne la ferme pas. Certain.

### Police

Une seule police en jeu : **`A1FGPH.SYS`**, proportionnelle, cellule 5×7, hauteur de ligne 7 px (`DGROUP:4DDE/4DE0`, `gm_load_gph` ; `graphics.md`/`formats.md`). L'interligne des fenêtres est la hauteur de cellule (7 px) ; l'espacement entre caractères vaut 1 pour les messages (registre `AX = 1` de `327a:0004`). Les titres (scène 21) et les génériques (scène 22) sont des **images**, pas du texte. Accents : CP437 (`formats.md`).

## E0. Lancement DOS

`START.BAT [E|F|D] [lecteur:]` : `cd` dans `ARMAETH.ENG/FRE/DEU`, `CDPATCH %2` (adaptation du CD, Rob Northen), `ARMINS` (6,5 Ko compressé, rôle non établi : hypothèse = contrôle / préparation de l'installation), `CALL ARMAETH`, `CDPATCH X`. `ARMAETH.BAT` : `vga` (pilote résident, **installe le mode 13h et efface l'écran**, silencieux sauf `* SYS 00n *`), `sc0` (voir E1), `am1 * a1f`. `INSTALL.BAT` lance `HDINST` (installation sur disque, hors périmètre). Certain pour les `.BAT`.

**Options de `AM1`** (`34eb:000c`, certain pour la structure, probable pour le sens de `!`) :

| Argument | Rôle |
|---|---|
| 1 | `*` ou `!` : données dans le répertoire courant (version CD, `DGROUP:0EBC` ← 7 par `dsk 7` de `CM1`) ; autre : spécification de lecteur / répertoire, vérifiée par une ouverture ; `A1FINS.SYS` (octet 0 = type d'installation, lecteur « C », `\ARMAETH`) sert aux installations disque |
| 2 | **préfixe de langue**, 3 lettres : `a1f`, `a1a`, `a1d` ; entre dans tous les noms de fichiers (`A1F00A.VGA`, `A1FMSG.SYS`…) |
| 3 (facultatif) | `vga` ou `ega` : force le type vidéo |

Moins de deux arguments ou une valeur inconnue : retour au mode texte, affichage du nom du programme et des arguments (`lib_puts`), `exit(1)`. **Aucun argument ne choisit un mode de jeu** (pas de mode démo, de triche, de niveau) ; le jeton `/svg nv1 nv2` de l'interpréteur de débogage fixe le niveau (voir « Interpréteur `/` »).

## E1. Contrôle de protection (`SC0.EXE`, `SC1.EXE`) — probable

`SC0.EXE` (50 Ko) contient `sc1.exe`, `COMSPEC`, `msghrd`, `msgutl`, `msgint` et la même table de touches que `AM1`/`SOS` ; il lance `SC1.EXE` (8 Ko). Les messages `MSGUTL` 1 à 15 décrivent exactement ce programme : disquette `INSTAL-1`, **« Contrôle du tableau numérique (voir documentation) »**, saisies *Ligne*, *Colonne*, *Nombre ?*, « réponse non valable, seconde tentative » puis « abandon », « disquette clef non acceptable », « contrôle numérique non acceptable », « déverrouillage non effectué », « violation de protection », et deux messages de pilote vidéo (« non disponible », « non accessible »). Conclusion : **protection par code de tableau** (deux essais), probablement affichée entre le pilote vidéo et le jeu. Non exécutée ni désassemblée (exécutables à segments MZ lisibles mais non analysés) ; la version CD (`CDPATCH`) l'a peut-être neutralisée. **Recommandation : ne pas la reproduire.**

## E2. Erreurs de démarrage et erreurs fatales

Chaîne de démarrage de `gm_main` (`1000:0000`, certain) : `348a:000a` installe le gestionnaire INT 24h et charge `MSGHRD` → `2065:000a` charge `MSGINT` → `1e68:0008` lit `A1FINS.SYS` → `34eb:000c` analyse la ligne de commande → `1005:000a` initialise (pilote vidéo, GPH, MIX, TMS, DIC, ANI, `CM1`, `CM2`) → `gm_main_loop` → `gm_quit`.

- **Erreur avec message** (`gm_fatal_error` `2065:003c` → `gm_error_exit` `1d83:000c`) : message `MSGINT` n° `DX`. Si le pilote vidéo n'est pas trouvé, texte brut (`lib_puts`) + attente d'une touche ; sinon fenêtre de message du jeu. Puis `gm_quit(0,0)` sauf appel avec `AX ≠ 0` (cas du mot de dictionnaire de longueur invalide, qui ne quitte pas). Les numéros utilisés : 1 mémoire insuffisante, 2 gestion vidéo non disponible (`1005:0053`), 3 mémoire vidéo, 4 jeu non identifié, 5 fichier introuvable (`1e68:0211`), 6-8 messages / dictionnaire inutilisables, 9 longueur de mot invalide (commande `dictionnaire`), 25-26 objet / salle inutilisable, 29 mode vidéo incompatible. 11-24 sont les textes de la boîte de sauvegarde. 27 « pause », 28 « restauration abandonnée » : **aucune référence trouvée** dans le code (probablement inutilisés). Certain pour le mécanisme, probable pour la liste (lecture des appelants).
- **Erreur sans message** (`gm_abort` `1ee6:0058`, plus de 100 appelants) : arrêt du son, affichage **`* Err nnn *`** (`34b4:0064`), `exit(0)`. `gm_fatal_sys_code` : **`* SYS nnn *`** (`34b4:006e`), aussi utilisé par `VGA.EXE`.
- **Erreurs disque / matériel** (`MSGHRD`, `356b`, gestionnaire INT 24h `348a:022c`) : disque à insérer (« Mettre le disque … dans le lecteur », messages 4-5, uniquement pour les installations sur disquettes), puis 6 à 19 pour les erreurs DOS. Sans objet pour la version CD (`*`).
- **Sortie normale** (`gm_quit` `1ee6:0008`) : mode texte 3 (`35a7:003a`), arrêt du son, message facultatif, `exit(0)`. Aucun écran de sortie.

## E3. Initialisation silencieuse (`A1FCM1.SYS`)

`gm_init_engine` appelle `gm_cm_script_step` avec l'état 0 (`1005:005a`) : lit `CM1` (6 enregistrements). Il n'y a **rien à l'écran** (noir). Contenu : `cnt 7`, `dgs 99`, `dsk 7`, `lum 0`, `dgs 0`, `sys 3`. Sens (certain pour les gestionnaires, `139a:0006`, `137b:0006`, `1250:0008`) : `cnt n` fixe `DGROUP:4B36` (n ≠ 0 : enchaîner les enregistrements sans rendre la main) ; `dgs n` écrit `DGROUP:05EA` (F7 et F8 de débogage inactifs tant que ≤ 10, voir « Raccourcis ») ; `dsk 7` : indicateur de lecteur `0EBC` ; `lum 0` : réglage d'éclairage (`4AE2 = 0`, `4AE4 = -1`) ; `sys 3` : état 3 du lecteur de scripts = fermeture.

Table des états de `gm_cm_script_step` (`1346:0004`, table `CS:032B`, **certain**, lue dans l'exécutable) : 0 ouvrir `CM1` (fichier 7) ; 1 lire / exécuter l'enregistrement suivant ; 2 suite après exécution ; 3 fermer (`4B34 = 4B42 = 4B38 = 0`, `4B50 = 7` : le contrôle du héros est réactivé) ; 4 ouvrir `CM2` (fichier 9) ; 5 ouvrir `CM3` (fichier 2) ; 6 et 7 ouvrir `CM3` (7 positionne l'indicateur `339C`) ; 8 fin de `CM3` : si l'indicateur est posé, `1503:0000` lance `CM4` ; 9 ouvrir `CM4` (fichier 19). Le jeton `fin` (groupe 0) met `4B38` à 0 : c'est un **repère de saut** (voir F8), pas une fin de script ; `xit` quitte le jeu.

## E4. Titre (scène 21)

Pour `CM2` (état 4, `1005:01e0`, certain) : `cnt 7`, `dgs 99`, `sec` (réinitialise le bloc de liaison du pilote vidéo, `139a:00fa`, probable), `pil 2048` (alloue la pile de sauvegarde des sprites, `203f:0004`), puis :

| Enregistrement | Effet | Confiance |
|---|---|---|
| `lir 21` | dessine la **scène 21** de `A1F00E.VGA` en plein écran 320×200 (`gm_load_scene(21)` avec `AX ≠ 0` : charge sans changer de salle, `1cc3:0071`), puis `vga_undo_all` et `vga_present` | certain |
| `mus 1 77 1 7 1 7 0 0` | musique **`M1`** (clé 12001) en boucle, arrêt en fondu de la précédente (`audio.md`, `mus id classe numéro boucle drapeaux force`) | certain |
| `wat 80` | attente de 80 tics BIOS, soit **4,4 s** | certain |

Contenu de la scène 21 (rendu vérifié) : logo « Real World Soft », titre « ARMAETH » en grandes lettres dorées, sous-titre « Le royaume perdu », sur un fond vert dégradé, avec un liseré rouge. Sa couche B (profondeur) est ignorée (aucun objet). **Aucune entrée n'est lue** pendant ces 4,4 s (`gm_delay_ticks` : attente active sur le compteur BIOS).

## E5. Distribution (scène 20)

`lir 20`, puis `wat 60` (3,3 s), puis `pil -1` (libère la pile). La scène 20 est dans `A1F00E.VGA` comme les scènes 21 et 22 ; elle montre un paysage de montagne au lever du soleil, avec **quatre portraits aux quatre coins**, chacun dans un cadre de bois, et un nom sous ou sur chaque portrait : **Killian** (haut gauche, le héros), **Armaëth** (haut droite, le roi des nains), **Minas** (bas gauche, Minas Thyl, la sorcière), **Prytwen** (bas droite, l'ennemi, « le malfaisant »). Boîtes approximatives lues sur le rendu (±3 px) : portraits `(0,0)-(58,60)`, `(258,0)-(319,60)`, `(0,140)-(58,199)`, `(258,140)-(319,199)` ; noms haut `y≈62-72`, noms bas `y≈124-134`. Ils font partie de l'image (aucun objet, aucun sprite) : rien n'est interactif. L'identification des personnages vient des messages (récit de `CM2`, dictionnaire classe 13 : `armaeth`, `tinhuel`, `erin`, `tehrehanan`, `ezhrimanoth`, `sillerynn`, `formats.md`) et de `S103`-`S105`/`S303` ; **hypothèse** pour l'attribution exacte des noms aux visages (lecture du rendu).

## E6. Récit d'introduction

Même `CM2`, suite : `ecr 237 238 234` (couleurs de fenêtre, voir « Fenêtres de message »), `ttl 62 66 196 120` (rectangle de la fenêtre **x = 62, y = 66, largeur 196, hauteur 120**, centré à l'écran, entre les portraits), puis **dix enregistrements `tta`** (`105e:0004`, jeton 11 du groupe 4 : « texte long, pagination automatique ») qui portent chacun un paragraphe (le royaume des nains et des elfes, Ménankar, la guerre, la retraite à Dol Armaëth, le temps des hommes, « Vous êtes KILLIAN », la gloire ou le butin, les rumeurs, le départ seul ; `■` = saut de ligne). Chaque `tta` dessine la fenêtre **par-dessus la scène 20** (le paysage reste visible autour), puis attend (`4B66 = 0`, valeur initiale) : **un clic gauche ou droit, Entrée ou Échap** (`1db5:003e`), puis efface la fenêtre (`327a:05e2`). Un paragraphe trop long est coupé en plusieurs fenêtres successives (pagination de `gm_draw_text`). Après le dernier : `wat 40` (2,2 s sur la scène 20 seule), `fin`.

**Fin de `CM2`** (certain) : `cnt 7`, `rsv -1` (rechargement du monde initial depuis `A1FCFG.SYS`, `2052:000c(-1)` : voir E12), `cle 0 7` à `cle 3 7` (active les comportements des quatre familles de numéros 0xx à 3xx, `137b:0006` + `1ec8:000a`), `lum 0`, `dgs 0`, `sys 3` (fermeture, `4B50 = 7` : le héros devient commandable).

Pas de saut global de l'introduction : seuls les clics, Entrée et Échap font avancer les paragraphes ; les attentes `wat` ne lisent aucune touche et **F8 n'est jamais lu pendant `CM2`** (le script s'exécute en bloc, `cnt 7`, dans `gm_init_engine`, avant la première lecture clavier de `18a9:0008`). Certain (lecture du code) ; l'existence d'un saut caché n'est pas exclue (voir « Questions ouvertes »).

## E7. L'écran de jeu

Après `rsv -1`, `gm_main_loop` charge la salle courante du monde initial (identifiant **1**, `formats.md` ; scène 1 de `A1F00A.VGA`, rectangle `(0,10,320×180)`, héros en `(219,146)`) avec le cadre autour, puis boucle à 70 Hz. Rendu de référence vérifié (cadre + salle 1 + masque de profondeur).

### Rectangles de l'écran (320×200)

```
 x:  0        8                                  311  320
 y=0  ┌────────────────────────────────────────────────┐
      │ [5 icônes] ( emblème ) [5 icônes]              │  barre d'icônes, y 2..17
 y=20 │ ┌────────────────────────────────────────────┐ │
      │ │                                            │ │  fenêtre de jeu 304×160
      │ │   salle (image clippée), objets, héros     │ │  x 8..311, y 20..179
      │ │   ┌───────── ligne de saisie ──────────┐   │ │  (38,168)-(281,178), sur demande
      │ └─└────────────────────────────────────────┘─┘ │
y=182 │ [12 emplacements d'inventaire]                 │  y 182..197
y=199 └────────────────────────────────────────────────┘
```

| Zone | Rectangle (px, inclusifs) | Détail | Preuve |
|---|---|---|---|
| Cadre | `(0,0)-(319,199)` | scène 0 de `A1F00A.VGA` ; plan de profondeur 200 / 216 sur le cadre, 0 dans la fenêtre | rendu, `graphics.md` ; certain |
| **Fenêtre de jeu** | `x 8..311`, `y 20..179` (304×160) ; coins arrondis (le masque rentre de 1 à 3 px aux quatre coins, lignes 20-22 et 177-179) | seules zones où l'image de la salle est écrite ; fond hors image = couleur 221 | masque de la couche B de la scène 0 ; certain |
| Icônes du haut, gauche | 5 cases de 20×16 : `x0 = 25, 49, 73, 97, 121`, `y 2..17` (bord clair 249 à gauche et en haut, sombre 221 à droite et en bas, fond 250) | centres d'icône `x = 35, 59, 83, 107, 131` | pixels du cadre ; certain |
| Icônes du haut, droite | 5 cases de 20×16 : `x0 = 178, 202, 226, 250, 274`, `y 2..17` | centres `x = 188, 212, 236, 260, 284` | idem ; certain |
| Emblème central | environ `x 145..175`, `y 0..25` | objets `INT 1` (curseur/visage, mobile) et `INT 4` en `(160,17)` : `INT 4` est l'**indicateur de l'outil actif** (copie de l'image du curseur) et le bouton « outil par défaut », pas une simple zone 1×1 (`interface.md` § 3) | cadre + `world` ; certain pour le rôle |
| Figures latérales | `INT 2` (11×24) en `(8,22)`, `INT 3` (11×28) en `(312,22)` (centre / bas du sprite) | une elfe bleue à gauche, un magicien à droite ; `INT 2` est le bouton « salle » (clic gauche = verbe 5 `regarder` la salle, clic droit = verbe 42 `o`), `INT 3` **change de page d'icônes** (voir ci-dessous) | objets `A1FCFG.SYS`, `1564:0004` ; certain pour `INT 2` et `INT 3` |
| **Inventaire** | 12 cases de 20×16 (bord sombre 221 en haut, clair 249 en bas) : `x0 = 18 + 24 k` (k = 0..11), `y 182..197` | objets portés par le héros : centre `x = 28 + 24 k`, bas du sprite `y = 195`, priorité 208 ; maximum affiché 12 (`DGROUP:4CB0 = 12`) | `1652:0006` + pixels du cadre ; certain |
| Ligne de saisie | `(38,168)-(281,178)` (244×11) | voir E8 | `1e22:0008` ; certain |
| Fenêtres de message | par défaut `y = 21`, centrées, largeur utile 309 px, hauteur max 20 lignes (154 px) → bas ≤ 175 | voir E9 | `327a:0004`/`0044` ; certain pour les constantes, probable pour le calcul |

Il n'y a **pas de zone de texte permanente, de panneau de statut ni de portraits en jeu** : le texte apparaît en fenêtres superposées, l'état (score, objets) en fenêtres à la demande (F6, F10) ou dans la rangée d'inventaire.

### Barre d'icônes (A1FINT.VGA) — trois pages

Les icônes sont des objets `INT` de la salle 0 (`A1FCFG.SYS` : numéros 101-113, 198, 199, 201-210, positions du tableau ci-dessus). Une **page** est une liste de 10 numéros (`DGROUP:0B86`, 3 × 10 mots, certain) ; seule la page courante est visible (`15f8:000e` règle les objets hors page à l'état « caché » `+0x2E = 2`) :

| Page | Icônes (numéros `INT`) | Contenu |
|---|---|---|
| 0 | 101, 102, 103, 104, 111, 109, 106, 107, 198, 199 | outils de jeu |
| 1 | 101, 102, 103, 105, 108, 112, 113, 110, 198, 199 | variantes d'outils (104 → 105, 111 → 108, 109 → 112, 106 → 113, 107 → 110) |
| 2 | 201, 202, 203, 204, 205, 206, 207, 208, 209, 210 | **commandes système** |

La page change par clic sur l'objet `INT 3` (côté droit) : clic gauche **+1**, clic droit **-1**, modulo 3 (`1564:0470..0479` → `15f8:000e`), l'index étant stocké dans le champ `+0x2D` d'un objet de la page ; page 0 au chargement du monde (`192e:049e`). Certain.

**Page 2, commandes système** (table `1564:0650`, certain) : 201 = sauvegarder (`23a2:0474`), 202 = restaurer (`23e9:000e`), 203 = « EXIT » = terminer (`2404:0002`), 204 = continuer (`23ee:000a`), 205 = recommencer (`23e9:0016`), 206 = volume (`2fec:0000`), 207 = score (`23f0:0010`), 208 = musique marche / arrêt (`2fe0:0026`), 209 = vitesse (clic gauche : plus vite, clic droit : plus lent, `4B51`), 210 = pause (bascule `4B53`). Les images des icônes (planche vérifiée) : 201-202 deux boîtes noires (disquettes), 203 panneau « EXIT », 204 personnage, 205 visage souriant, 206 deux notes, 207 tas d'or ou de braises, 208 une note, 209 une plume (ou un outil), 210 sablier à deux images.
**Pages 0-1, outils de jeu** (probable, d'après les images ; la table des actions de `FUN_1553_0004` n'est pas étudiée ici) : noms et verbes des 15 outils : `interface.md` § 2.1 (101 regarder / lire, 102 prendre / mettre, 103 ouvrir / fermer, 104 allumer / éteindre, 105 manger / boire, 106 attaquer / tuer, 107 embrasser, 108 donner, 109 parler, 110 **nettoyer** (brosse ou éponge, pas « feu »), 111 pousser / tirer, 112 briser, 113 porter, 198 **bottes = marcher** (pas « échelle »)) ; 199 **échelle** : clic gauche = monter (`Ver = -1`), clic droit = descendre (+1), un second clic arrête (`1564:0600`), c'est l'équivalent des touches `-` et `+`. Chaque icône a **deux images** : l'image 0 correspond au bouton gauche, l'image 1 au bouton droit (`bVar13 = bouton gauche relâché`, `1564:05eb`).

**Principe d'usage** (probable) : cliquer une icône copie son image sur le curseur (`1539:000e`) et mémorise son numéro et la variante ; cliquer ensuite un objet de la scène applique cet outil (`1553:0004`, `interface.md` § 5.3). `INT 2` (elfe) : voir ci-dessus. `INT 5` est la rangée de **12 joyaux** (9×9, créés par `1611:01de`) liés à `sl1`-`sl3` ; ces jetons sont absents des scripts `CM`, donc les joyaux ne sont jamais atteints en jeu normal (`interface.md` § 3.4).

### Déplacement du héros (certain)

- **Clavier** (aucun script en cours et `4B50 ≠ 0`, `1023:0016`) : les touches de curseur et Début / Fin / PgPrec / PgSuiv donnent la direction horizontale et la profondeur (`Hor +0x60`, `Prf +0x62` de l'objet héros, valeurs -1/0/1 : Gauche -1,0 ; Droite +1,0 ; Haut 0,-1 ; Bas 0,+1 ; Début -1,-1 ; Fin -1,+1 ; PgPrec +1,-1 ; PgSuiv +1,+1) ; `-` ou `_` : déplacement vertical vers le haut (`Ver +0x61 = -1`), `+` ou `=` : vers le bas (+1). Rappuyer sur la même direction arrête le mouvement. Dans la scène, « vertical » = grimper / descendre (échelles, escaliers).
- **Souris** : déplacer le curseur met à jour les champs `X`/`Y` de l'objet curseur ; un clic dans la scène ne fait marcher le héros **qu'avec l'outil bottes (198)** (recherche de chemin `3187:0000`, `engine.md` § 8.2) ; avec l'outil par défaut il ne se passe rien (refus animé, `interface.md` § 5.6).

## E8. Ligne de saisie

Toute touche **imprimable** qui n'est ni `+`, `-`, `=` ni `_` ouvre la boîte (`1023:0016` → `1e22:0008`), quand aucun script ne tourne ; la touche est insérée comme premier caractère (certain : l'appel passe `AX = caractère`, `DX = 2`). **Boîte** (`1e22:0008`, certain) : largeur `(cellule 5 × 40 + 44) = 244`, centrée → `x 38..281` ; `y 168..178` (hauteur cellule + 4 = 11) ; cadre extérieur couleur **238** (0xEE), cadre intérieur 221 (0xDD), fond **250** (0xFA) ; texte en 221 avec l'ombre 238 ; **40 caractères au plus** ; curseur de saisie clignotant (`_` en alternance fond / 238, pas de 3000 tours de boucle d'attente). À la fermeture, le rectangle est restauré depuis la page 2 (`vga_copy_rect`).

| Touche | Effet |
|---|---|
| caractère | ajoute (au-delà de 40 : bip `3574:0072`) |
| Retour arrière (0x08) | efface le dernier |
| **Entrée** (0x0D) | recopie la ligne dans l'historique (`4E5E`) et appelle **`gm_parse_command`** (`1d89:0002`, `parser.md`), qui exécute et affiche la réponse en fenêtres ; ferme la boîte si l'exécution rend 0 |
| **Échap** (0x1B) | ferme sans exécuter |
| **Inser** | rappelle la **dernière phrase** (une seule, pas de pile) |
| **Suppr** | efface la ligne |
| (autre) | ignoré |

Une ligne commençant par `/` va à l'**interpréteur de jetons** (`109a:0002`, `/jeton arguments`, `re-index.md`) : outil de développement resté dans l'exécutable (`/svg nv1 nv2`, `/xit`, `/lir`, `/trf`…), accessible à tout joueur. Le texte tapé pendant un script est ignoré.

**Commandes système** reconnues par l'analyseur (mots de classe 24, `formats.md`/`parser.md`, table de gestionnaires `DGROUP:0B06`, certain) : `sauvegarder` (24001), `restaurer` (24002), `quitter` / `terminer` (24003), `information` (24004), `dictionnaire` n (24006, nombre de lettres significatives, 4 à 20), `continuer` (24007), `recommencer` (24008), `score` (24009), `musique` (24011), `volume` (24012). Correspondance avec les touches : voir « Raccourcis ». Les actions de jeu (verbes de classe 22 : `inventaire` = 22017, etc.) relèvent de `parser.md`.

## E9. Fenêtres de message

Toute réponse du jeu passe par `gm_draw_text` (`327a:0044`), appelée par `gm_show_message_id` (`200c:0004` : id de message → `gm_get_message` → `gm_show_text` → `gm_print_text_default` `327a:0004`), par les jetons `aff` / `dsp` / `msg` / `tta` / `cmd` (`105e:0004`) et par les écrans de score, d'aide, de sauvegarde. Un message de la classe `S` (lettre `S` = classe 19, id = `19000 + n`) est un message système.

**Dessin** (certain, `327a:0044`, `32e1:0008/00a2`) :

- Paramètres : `p4` = couleur de fond, `p3` = couleur du texte et des anneaux A, `p2` = ombre du texte et anneaux B. Cadre : **5 anneaux** concentriques d'un pixel, de l'extérieur vers l'intérieur : A (avec remplissage `p4`), B, *(anneau 2 sauté)*, A, B ; le remplissage intérieur est donc visible entre les anneaux 1 et 3. Texte : couleur `p3`, avec l'ombre `p2` un pixel à droite.
- Géométrie : largeur = `2 × (5 + espacement) + largeur de la plus longue ligne` ; hauteur = **7 × (lignes + 2)** (une ligne de marge en haut et en bas) ; texte à `x + 5 + espacement`, première ligne à `y + 7`. Largeur de ligne maximale = largeur d'écran − 2 × 5 − espacement (309 px pour les messages ordinaires). Césure sur les espaces ; **`■` (0xFE) = saut de ligne** ; `·` (0xFA) traité comme espace. Un texte plus long que la hauteur maximale est **paginé** : une fenêtre par page, même rectangle, attente entre les pages.
- **Messages ordinaires** (`327a:0004`) : centrés horizontalement, `y = 21`, hauteur plafonnée à 160 px (donc 20 lignes au plus, bas ≤ 175 : dans la fenêtre de jeu), espacement 1, couleurs du pilote `+0x0C/+0x0E/+0x10` = **236 (fond), 237 (texte et anneaux A), 234 (ombre et anneaux B)** par défaut (`DGROUP:5818` = 236, 237, 234 ; or / brun sur fond brun doré), modifiables par `ecr a b c` (stocke `4B3A/3C/3E`, utilisées par `aff`/`dsp`/`tta`).
- **Attente** (`1db5:0004`) : si `DGROUP:4B66 = 0` (défaut, jeton `aut 0`) attente d'un clic gauche / droit, d'Entrée ou d'Échap ; sinon attente de `4B66` tics BIOS (`aut n` ; `dsp` règle temporairement ce délai à `1,33 × nombre de caractères`, plafonné à 255, soit environ 0,073 s par caractère).
- **Styles connus** (`p2` / `p3` / `p4`) :

| Usage | Ombre `p2` | Texte `p3` | Fond `p4` | Adresse |
|---|---|---|---|---|
| message courant | 234 | 237 | 236 | `327a:0004` |
| récit d'intro (`ecr 237 238 234`) | 234 | 238 | 237 | `CM2` |
| conseils de sortie (`ecr 250 238 221`) | 221 | 238 | 250 | `CM4` |
| F1 aide | 233 | 245 | 239 | `2401:0002` |
| score F6 (`14cf:000c`) | 236 | 249 | 237 | `14cf:000c` |
| sauvegarde (`1f29:0006`, mode 1) | 228 | 232 | 229 | `1f29:0006` |
| restauration (mode 0) | 234 | 238 | 248 | `1f29:0006` |

(Le texte du récit : fenêtre fixée par `ttl` à `(62,66)`, 196×120 ; la fenêtre de F1 a `y = 0` et une hauteur plafonnée à 198 : plein écran en hauteur ; **probable**.)

## E10. Aide (F1), score (F6), inventaire (F10)

- **F1** (`2401:0002`) : message système `S21` (`19021`) en fenêtre grise : touches de déplacement (curseur + Début / Fin / PgPrec / PgSuiv ; `-` haut, `+` bas), Inser (répète la phrase), Suppr ou Échap (efface la phrase), Alt-P / Alt-N / Alt-A / Alt-Z, la liste F1-F6 et F10, la commande `dictionnaire nn`. Fonctionne aussi pendant un script. Certain. **C'est la seule « aide » dans le jeu** : `SOS.EXE` n'y est pas relié.
- **F6** et `score` : `14cf:000c(AX = n)` affiche une suite de fenêtres de messages `S` : en-tête (`S42` pour F6, `S41` après la découverte d'un secret majeur, `S43` pour l'abandon, `S50` pour le couronnement), score actuel et maximal (`S27`-`S29`, avec les nombres formatés par `FUN_3938_0886`), fortune en ducats (`S30`-`S33`, en cours de partie seulement), trésors restants (`S34`/`S35`), puis un verdict selon la progression (`S36`-`S39`, ou `S51`-`S54` si la partie est terminée). Chaque fenêtre attend un clic. Certain pour la structure, probable pour la sélection exacte des verdicts.
- **F10** (`3312:000a` → `21ad:000a(0x20, liste du héros)`) : liste textuelle du contenu du héros ; équivalent du verbe `inventaire`. Probable.

## E11. Pause, pas à pas, vitesse

Alt-P : mode **pas à pas** (`4B53 = 7`) : le monde n'avance que d'un tick à chaque événement clavier (`18a9:0008` : un événement fait passer le drapeau de tick à 7 même quand `4B53 ≠ 0`). Alt-N : mode normal. Alt-A ou Alt-`-` : ralentit (`4B51` + 1, plafond 250). Alt-Z ou Alt-`=` : accélère (`4B51` - 1). Icône 210 = bascule le pas à pas ; icône 209 = vitesse (gauche : plus vite). Certain (`1023:027c`, `1564:0004`). Il n'y a **pas d'écran « Pause »** (le message `MSGINT` 27 « Pause » n'est référencé nulle part).

## E12. Sauvegarde, restauration, recommencer

`gm_savegame_slot(mode)` (`2052:000c`, certain) : mode **1** = sauvegarder (F2, icône 201, commande `sauvegarder`), **0** = restaurer (F3, icône 202, `restaurer`), **-1** = recommencer (F5, icône 205, `recommencer`, aussi `rsv -1` de `CM2`).

- **-1** : recharge `A1FCFG.SYS` (état initial) **sans aucune boîte** ; si le chargement réussit, retour immédiat. (`gm_load_world` rend 0 en cas de succès.)
- **0 / 1** : boîte à **quatre saisies successives** (`1f29:0006`) : lecteur (1 lettre), répertoire (20 lettres), nom de la sauvegarde (3 lettres), numéro ; les invites sont les messages `MSGINT` 14, 16, 18, 20, le titre le message 11 (« Restauration ») ou 12 (« Sauvegarde »), les libellés des champs le message 13 (quatre lignes). Fenêtres à `x = 34`, largeur 252 (`(5+1) × 42`), titre à `y = 54`, libellés à `y = 79`, saisie à `y = 125` ; couleurs : voir E9. Le fichier est `"svg" + 3 chiffres` (`DGROUP:51F4`, numéro `0EDA`). Échap abandonne et rend la main au jeu. Erreurs : 15 disque invalide, 17 répertoire inexistant, 19 sauvegarde non identifiée, 21 numéro inconnu, 22 fichier inaccessible (puis nouvelle saisie), 23 erreur de fichier, 24 incompatible. Après une restauration réussie, la salle est rechargée par la boucle principale. Si une restauration échoue après un chargement raté, le jeu recharge l'état initial. Les sauvegardes utilisent le format du monde (`formats.md`, 21 868 octets), **pas de capture d'écran**.
- **Recommandation** : en navigateur, un sélecteur d'emplacements (nom libre, date, miniature facultative) au lieu des quatre champs ; les messages 11 à 24 restent la source des textes.

## E13. Mort et résurrection

Pas d'écran de fin de partie : la mort **supprime ou remplace l'objet héros** (`4BFE` nul) selon **4 variantes** (`characters.md` § 6) : destruction sans reste, contenu laissé dans la salle, **dépouille** (`Num 2`, qui garde l'inventaire) ou disparition (`Err 0x0E`) ; la résurrection F4 recrée le héros sans toucher aux dépouilles. Tant qu'il est absent, toute commande tapée ou tout clic nécessitant le héros affiche le message `S16` (`22fc:0002`, `1564:091c`). **F4 / `continuer` / icône 204** (`23ee:000a` → `2594:043a`, certain) : s'il n'est pas mort, `S46` (déjà dans la salle) ou `S47` (le jeu rejoint la salle du héros) ; sinon recrée le héros (`gm_create_object`), au centre de la fenêtre (`DGROUP:4ACA/4AD6` ÷ 2), avec `S24`. Si la partie est terminée (drapeau `DGROUP:4B67 ≠ 0`, voir E14), F4 affiche `S49` (choix entre quitter, recommencer, restaurer). Les messages de mort eux-mêmes (classe 7, `7001`…) sont catalogués au `characters.md` § 6.2 et § 6.3 ; un jingle `E4` accompagne chaque mort (`audio.md`). Probable pour l'ensemble.

**Écart du portage** : si le héros était entré dans la salle en grimpant (`Ego 2`), il est recréé au centre de la salle d'où il était monté. Le centre de la cime de l'arbre (salle 10, où l'on ne fait que grimper) tombe sur un bout de branche : recréé à pied, le héros tombait au premier pas et mourait en boucle (`continueGame`, `game/hero.ts`).

## E14. Fins

- **Couronnement** (`2caf:000e`, comportement de la salle 108 ; probable) : déclenché par la couronne (`Num 328`, verbe 39, `characters.md` § 10.1), le héros est remplacé par un acteur `Num 333` ; animation sur le trône, puis `14cf:000c(0x32)` (en-tête `S50`, verdict `S51`-`S54` selon le secret du niveau et le trésor total porté : `characters.md` § 10.3), `S55` (`2caf:0232..023a`, désassemblage relu ; implémenté, joué par le robot du parcours), `4B67 = 4B6B = 7` et suppression du héros. **`S56`** (« Bientôt ARMAETH II ») : **aucun appelant** dans `AM1.EXE` (ni `MOV AX,0x53 ; MOV DX,0x38`, ni mot `19056` en données, ni calcul `0x37 + 1`) ni dans les autres programmes du CD (`ARMAETH.BAT` : `vga`, `sc0`, `am1`) : message orphelin, jamais affiché (test `passages.test.ts`). La partie **ne se ferme pas** toute seule : le joueur doit quitter (`terminer`), recommencer (F5) ou restaurer (F3) ; F4 rappelle ce choix par `S49`.
- **Passages secrets / épisodes suivants** (`2500:0008`, `27ed:000a`, `29fd:0000`, certain, désassemblage relu) : à la fin du mouvement, message d'état dans la salle voisine (`V72`/`V73` stèle vue de la salle 101 ; `G113`/`G114` dalle salle 108 ; `G115`/`G116` dalle salle 202 ; `G224`/`G225` herse salle 202 ; `G226`/`G227` herse salle 305), puis, selon le niveau `4b4e` : stèle `4b4e == 0` hors salle 101 : ouverture `S71`, `S70`, `CM3` (état 6), fermeture verdict `S41` si `4b68 == 0` ; stèle chapitre >= 1 en salle 101 : `S72`, `S70`, `CM3` ; dalle niveau `< 2` hors 202 : `S73` ; chapitre 2 en 202 : `S74` ; herse niveau `< 3` hors 305 : `S75` ; chapitre 3 en 305 : `S76` (chaque fois suivi de `S70` et `CM3`). Drapeaux `4b68`, `4b69`, `4b6a` posés APRÈS. Avec `CFG` (`4b4e = 3`) seuls les messages d'état s'affichent. Implémenté (`passageSteps`, `game/helpers.ts`) ; `CM3` attend un `runEpisodeEnd` du moteur (`BehaviorContext`, non branché : inactif avec `CFG`).
- **Abandon** (`terminer` / `quitter` / icône 203, `2404:0002`, certain) : `14cf:000c(0x2b)` (`S43` puis le score), puis `1503:0000` = **`CM4`** : fenêtre `ecr 250 238 221`, `ttl 0 0 0 0`, **`tta`** d'un texte « conseils de jeu » (une page ; `A1FCM4.SYS`, 1 079 octets), puis `fin` et **`xit`** = `gm_quit` (retour DOS, mode texte). C'est le seul « écran de fin » : conseils de jeu à lire, clic pour quitter.
- **Introduction de chapitre** (`S101`-`S105`, `S201`-`S204`, `S301`-`S304`, et `S13`/`S14` à l'arrivée) : messages du narrateur ; déclencheur établi : `21cc:008e` (événement différé 2000, 60 tics après l'entrée dans les salles 1, 101, 202, 305, `characters.md` § 11).
- La scène **22** (génériques : conception, illustrations, musiques) n'est appelée par aucun script `CM1`-`CM4` ; son déclencheur n'a pas été trouvé (voir « Questions ouvertes »). Le rendu actuel de cette scène (`A1F00E.VGA` id 22) montre un doublage décalé des lignes de texte : à contrôler (passes du codec B ?).

## E15. Aide hors jeu : `SOS.EXE` et `A1FSOS.SYS`

**Accès** : `AIDE.BAT`, `HELP.BAT`, `HILFE.BAT` (racine du CD) : `cd armaeth.xxx`, `sos.exe * a1X`, `cd ..` ; `ARMAETH.FRE\AIDE.BAT` : `sos.exe * a1f`. Programme DOS à part, **sans lien** avec `AM1` (même bibliothèque d'entrées / de fenêtres et de messages : chaînes `msghrd`, `msgutl`, `msgint`, `vga` dans le binaire, mêmes tables de touches). Confirmé (fichiers et chaînes), non exécuté.

**Messages utilisés** (`MSGUTL` 57 à 61, certain pour le rôle) : titre « programme d'aide et de recherche de solutions par menus hiérarchisés », bas d'écran « choisir avec ↑ ↓, sélectionner avec Entrée, retour avec Échap », étiquette **« Aide n° »**, « aide non disponible », erreur « menu de plus de 20 options » ; 21 et 22 : paramètre de jeu manquant, fichier de configuration inaccessible.

**Structure de `A1FSOS.SYS`** (déduite du fichier, **confirmée par une exploration complète de l'arbre** : 606 nœuds atteints sur 606, profondeur maximale 9, 11 options au plus) : `u16 n` (607), puis `n` enregistrements `{lien, enfant, longueur, 0}`, puis le texte NOT 0xFF concaténé. Le texte de l'enregistrement `i` est la tranche de longueur `longueur` à la somme des longueurs précédentes. Le **nœud 0** est le titre de la racine (« point d'entrée du système d'aide pour ARMAETH I ») ; `enfant` = indice de la **première option** d'un sous-menu, `lien` = **option suivante** du même menu (0 = dernière) ; `enfant = 0` = **feuille**, dont le texte est la page affichée. Racine : `* Information *` (touches, Entrer, Échap, deux types de menus) puis **Niveaux de jeu 0 à 3**, chacun listant les éléments du niveau (l'ours, la pie, le feu, les torches, l'entrée secrète ; Prytwen, le coffre ; les nains, le bouclier, la herse, Ségomir ; les gardiens, Minas Thyl, les Sarhuls, l'épée d'orichalque, la baguette, le grimoire, le talisman, l'invisibilité), puis par élément des **questions** (« à quoi sert… », « comment éviter… », « où est… »). Deux types de menus : **menu d'interrogation** = liste d'options titrées (les questions), **menu d'aide** = liste d'options **à titre vide** (250 enregistrements sur 607 ont une longueur nulle ou très courte) : chaque option vide est un **indice** numéroté « Aide n° 1, 2, 3… » (étiquette `MSGUTL` 59), son enfant est la page d'indice, de plus en plus explicite. Lecteur : `parseHelp` (`src/games/armaeth/data/tables.ts`).

**Recommandation pour le port (non décidée)** : l'aide est une **extension de style « solution »**, pas une partie du jeu. Option A (fidèle) : ne pas l'intégrer au jeu, mais fournir une page séparée « Aide » (menu à flèches / Entrée / Échap comme l'original, indices dévoilés un par un, retour au menu précédent). Option B : lien depuis le panneau F1 (le seul endroit d'aide en jeu), ouvert par action explicite du joueur, jamais automatiquement (spoilers). Dans les deux cas : arbre en mémoire, niveaux 0 à 3 (les niveaux correspondent aux chapitres), un indice affiché à la fois dans une fenêtre du même style que les messages, **aucun texte nouveau** (étiquettes de `MSGUTL`). À valider avec l'utilisatrice.

## Utilitaires : `MSGUTL` et options

- `MSGUTL` (62 messages, texte clair CP437 comme `MSGINT`) est le fichier de messages des **utilitaires** : 1-15 la protection (E1), 16-20 vides, 21-22 paramètres, 23-56 l'installation sur disque dur (`HDINST`, `ARMINS` : choix du mode, disque, espace libre, copie, erreurs de fichiers, disquette vierge), 57-61 `SOS` (confirmé par la présence de `msgutl` dans `SOS.EXE` et `SC0.EXE` ; non chargé par `AM1.EXE`). Rien n'est à porter hors 57-61 si l'on reprend l'aide.
- Options : voir E0. Pas de mode de configuration interne (les périphériques sonores sont détectés par `gm_sound_init`, `audio.md` ; le jeton `buz` / `adl` / `rol` force un choix en script).

## Raccourcis et commandes (récapitulatif)

| Entrée | Effet | Pendant un script | Preuve |
|---|---|---|---|
| F1 | aide `S21` | oui | `1023:0230`, `1023:0256` |
| F2 | sauvegarder (mode 1) | non (bip) | `23a2:0474` |
| F3 | restaurer (mode 0) | non | `23e9:000e` |
| F4 | continuer (résurrection) ou `S49` | non | `23ee:000a` |
| F5 | recommencer (mode -1) | non | `23e9:0016` |
| F6 | score (`14cf:000c(0x2a)`) | non | `23f0:0010` |
| F7 | `23fa:0006` : décalage de l'adresse d'écran (CRTC `0Ch/0Dh` = 0), **seulement si `dgs` > 10** (débogage) | non (bip) | `23fa:0006` |
| F8 | hors script : `23fa:003c` (idem, décalage 0x40, `dgs` > 10) ; pendant un script : saute jusqu'au prochain `fin` (`4B38 = 7`) | oui | `1023:0256`, `23fa:003c` |
| F9 | rien | — | table |
| F10 | inventaire (`3312:000a`) | non | `23f0:0008` |
| Alt-P, Alt-N | pas à pas / normal | — | `1023:027c` |
| Alt-A (ou Alt-`-`), Alt-Z (ou Alt-`=`) | ralentit / accélère | — | idem |
| curseurs, Début, Fin, PgPrec, PgSuiv, `+`, `-` | déplacer le héros | non | `1023:0016` |
| Inser, Suppr, Échap, Entrée, Retour arrière | édition de la ligne (E8) | — | `1e22:02c2` |

Ordre vérifié de la table hors script (`1023:0216`) : F1 `2401:0002`, F2 `23a2:0474`, F3 `23e9:000e`, F4 `23ee:000a`, F5 `23e9:0016`, F6 `23f0:0010`, F7 `23fa:0006`, F8 `23fa:003c`, F9 ignoré, F10 `23f0:0008` ; le texte de F1 (`S21`) confirme F1 à F6 et F10.

## Sons par écran

(Détail des banques et du pilote : `audio.md`.)

| Écran | Son | Preuve | Confiance |
|---|---|---|---|
| Titre (E4) | `M1` (clé 12001), boucle, 54,2 s par passage (904 pas à tempo 3) | `mus 1 77 1 7 1 7 0 0` | certain |
| Distribution et récit (E5, E6) | la musique `M1` continue | aucune commande son dans `CM2` après `mus` | certain |
| Salle | musique de la salle (en-tête de scène : id, classe, numéro) en boucle, arrêt de l'ancienne à l'entrée (`gm_sound_play(…, 7, 0, 7)`, `1cc3:082a`) | `audio.md` | certain pour le chemin |
| Passages secrets (E14) | effets de classe `B` (`B7`, `B2`) | `2500:003d`, `27ed:0040`, `29fd:0029` | certain |
| Couronnement (E14) | `gm_sound_play(7, 1, 7)` à l'entrée du trône (`2caf`) ; jingles `E4`, `E305`, `E306` ailleurs | `2caf:000e`, `audio.md` | probable |
| Clics, fenêtres, dialogues | aucun son dédié repéré | — | probable |
| Icônes 206 / 208 | volume maître (`2fec`) ; musique marche / arrêt (`2fe0:0026`) | `1564:0650` | certain |
| Commandes `musique`, `volume` | idem, en saisie | `DGROUP:0B06` (11, 12) | probable |
| Jetons `msl n` / `mst n` | son activé / initialiser ou arrêter le pilote | `111f:0006` | certain |
| Sortie (`gm_quit`) | arrêt du son avant le retour DOS | `1ee6:0008` | certain |

## Pour la réimplémentation (recommandations, sans décision)

1. **Cadre** : charger la scène 0 une fois, garder sa couche B (valeurs 200 / 216) comme masque immuable ; ne dessiner une salle que là où le masque est < 200 ; remplir le reste de la fenêtre de jeu avec la couleur 221. Utiliser les rectangles du tableau de l'écran de jeu.
2. **Icônes et inventaire** : objets `INT` de la salle 0 (`parseWorld`), trois pages de 10 icônes (`DGROUP:0B86`), 12 cases d'inventaire (centre `28 + 24 k`, bas 195). Le comportement des icônes est décrit au `interface.md` § 1 et § 5.
3. **Fenêtres de message** : un composant unique (5 anneaux, police GPH 5×7, pagination, attente clic / Entrée / Échap, délai `aut`), paramétré par trois couleurs ; les textes viennent des messages (`A1FMSG.SYS`, `MSGINT`, `CM2`, `CM4`).
4. **Entrées** : clavier = table de 4 types ci-dessus ; la ligne de saisie s'ouvre à la première touche imprimable ; Inser rappelle la dernière phrase.
5. **Fondus** : inutiles ; l'éclairage jour / nuit est un décalage de palette recalculé toutes les 10 minutes de jeu et à chaque changement de salle (courbe `DGROUP:0E68`).
6. **Introduction** : scène 21 (4,4 s) → scène 20 (3,3 s) → fenêtre 62,66,196×120 avec dix paragraphes → monde initial ; un « passer l'introduction » serait un ajout (l'original n'en a pas).
7. **Aide `SOS`** : voir E15 (à valider).
8. **Protection `SC0`** et installation (`HDINST`, `ARMINS`) : non portées.

## Questions ouvertes

1. **`SC0.EXE` / `SC1.EXE`** : comportement exact (protection par « tableau numérique » d'après `MSGUTL`), affichage, données de contrôle ; neutralisé ou non par `CDPATCH` dans la version CD. Non exécuté ni désassemblé.
2. **`ARMINS.EXE`** (6,5 Ko, code compressé) : rôle exact, lancé avant chaque partie par `START.BAT`.
3. **Scène 22 (génériques)** : déclencheur inconnu (aucun script `CM`, aucun jeton `lir 22`) ; le rendu actuel montre des lignes dédoublées, à comparer au codec B (`graphics.md`, passes).
4. **Messages d'introduction de chapitre et d'arrivée** : **résolu** (`21cc:008e`, `characters.md` § 11).
5. **(Résolu : `interface.md` § 1, § 2.1, § 5.)** Actions des icônes d'outil (101-113, 198, 199, `INT 2`, `INT 5`) : libellés et effets exacts, lecture de `FUN_1553_0004`, `FUN_1504_0002`, `FUN_1539_*` et de la table de gestionnaires par type (`1ec8:000a`) ; sens du curseur : `INT 1` (une icône blanche + quatre visages rouges) est-il le curseur, l'emblème de santé, ou les deux ?
6. **(Résolu : `interface.md` § 3.3, § 5.6.)** Bouton droit sur la scène et **clic sur l'emblème central** (`INT 4`, `1539:0084`) : rôle (réinitialisation du curseur ?).
7. **(Résolu : `interface.md` § 3.4.)** Rôle des 12 joyaux `INT 5` et de `sl1`-`sl3` (`1611:0256`).
8. **Intro** : confirmer l'absence de saut (F8 ne peut pas être lu pendant `CM2`, voir E6) ; comportement de `sec` dans `CM2`.
9. **Premier caractère de la ligne de saisie** : transmis (`AX = caractère`, `DX = 2`), résolu.
10. **Géométrie des fenêtres hors `ttl`** : les registres `AX / BX / DX` d'appel de `gm_draw_text` (espacement, plafonds de largeur et de hauteur) ne sont établis que pour `327a:0004` (1, 0, 160) et F1 (1, 0, 0) ; les autres appelants (`14cf`, `1f29`, `tta`) sont déduits.
11. **Fenêtre de dialogue de sauvegarde** : rectangles des champs de saisie (`1f29:0454`) non relevés.
12. **Mort** : résolu (`characters.md` § 6).
13. **Saut F8** : utilisable hors introduction ? (les `CM1`-`CM4` ne s'exécutent qu'en mode bloquant `cnt 7`.)
14. **`dgs`** (`DGROUP:05EA`) : sens exact (« degré de débogage » ?) ; les valeurs 99 / 0 / 9 dans `CM1`-`CM4`.
15. **Hauteur / position exacte des fenêtres avec le plafond de lignes** (`4A844`) : règle de repli de `y` à 0 quand `200 - hauteur < y` (`327a:00ab..`) non vérifiée sur un cas réel.
