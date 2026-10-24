# MATH : index de rétro-ingénierie

Décompilation de `archives/mathemagique/cd/MATH` (NE Windows 3.x 16 bits, 390 656 octets, copie dans `original/mathemagique/MATH`) et des modules Broderbund du CD (`BRODFONT.DLL`, `BRODMIDI.DLL`, `BRODPGI.DLL`, `BRODUTIL.DLL`, `BROEMIDI`) avec Ghidra en mode headless. Ce document est le point d'entrée des tâches qui étudient la logique du jeu : il dit comment lire le corpus et par où entrer (les fonctions qui chargent les archives Mohawk `.DAT`).

Les blocs entre `<!-- GEN:... -->` sont réécrits par `run.sh`. Le reste est écrit à la main : les faits citent des adresses vérifiées dans la décompilation, et « hypothèse » marque une déduction non vérifiée.

## Régénérer

```bash
bash scripts/mathemagique/re/run.sh
```

- Prérequis : `brew install ghidra` (la formule installe aussi un JDK ; le script cherche `openjdk@21`, puis `openjdk@25`), `python3`. Aucun autre outil.
- Durée : environ 1 min 20 à froid (6 programmes). Le script est idempotent (`-overwrite`, `decomp/` recréé) et ne demande rien. Il échoue si un script Ghidra signale une erreur, si une sortie manque ou si `MATH/tags.tsv` est vide.
- Le paquet Homebrew de Ghidra ne contient pas le binaire du décompileur natif (`Ghidra/Features/Decompiler/os/<plateforme>/decompile`). `run.sh` le compile depuis les sources fournies (une fois, environ 15 s, avec `make` et un compilateur C++) et le copie dans l'installation de Ghidra.
- Les fichiers du CD sont des données non fiables : ils sont seulement lus (Ghidra, `ne_dump.py` avec `python3 -I`), jamais exécutés.
- Les sorties sont dans `archives/mathemagique/re/` (ignoré par git), un dossier par programme (`MATH`, `BRODFONT`, `BRODMIDI`, `BRODPGI`, `BRODUTIL`, `BROEMIDI`) :

| Fichier | Contenu |
|---|---|
| `<programme>/decomp/<sel>_<off>_<nom>.c` | une décompilation C par fonction ; en-tête : taille, appelants, appelés (les imports s'écrivent `MODULE::NOM`), chaînes référencées |
| `<programme>/functions.tsv` | adresse, nom, type (`func`, `export` = point d'entrée du NE, `thunk`), taille, nb d'instructions, appelants, appelés, état de la décompilation, fichier |
| `<programme>/strings.tsv` | adresse, longueur, chaîne, fonctions référentes (`sel:off/type`) |
| `<programme>/imports.tsv` | module, ordinal, nom, source du nom (`ghidra`, `dll`, `-`), nombre d'appelants, appelants |
| `<programme>/tags.tsv` | fonction, nom, nature (`tag`, `data`, `dat`), valeur, détail : les références aux types de ressources Mohawk et aux noms de `.DAT` |
| `<programme>/disasm.txt` | listing désassemblé complet, avec noms des cibles d'appel (imports compris) et chaînes en commentaire |
| `<programme>/resources.tsv` | ressources NE : type, id/nom, offset dans le fichier, taille |
| `<programme>/resources/` | tables de chaînes, dialogues et menus en texte (seulement les programmes qui en ont) |
| `exports/<MODULE>.tsv` | `ordinal<TAB>nom` des tables de noms (résidente et non résidente) de chaque module analysé |
| `project/` | projet Ghidra (`mathemagique`), ouvrable dans l'interface (`ghidraRun`) |
| `run.log` | journal complet de Ghidra |

Les scripts sont dans `scripts/mathemagique/re/` : `ne_dump.py` + `ne.py` (exports et ressources, Python), `ExportStrings.java`, `ExportImports.java`, `ExportTags.java`, `ExportDecompiled.java`, `SeedFunctions.java` (amorçage des fonctions, lancé avant les exports), `ExportDisasm.java`, l'utilitaire `ReCommon.java` et `make_index.py` (met à jour ce document). Ils reprennent la structure de `scripts/teleportaschtroumpf/re/`, sans `SetDS` ni `IdentifyLibs` (propres au DOS : le loader NE gère les segments et les relocations). `SeedFunctions.java` est repris dans son principe mais réécrit : voir « Amorçage des fonctions ».

## Statistiques

<!-- GEN:stats -->
- Outils : ghidra 12.2 ; JDK : openjdk version "25.0.5" 2026-10-20.
- Durée de la dernière régénération (6 programmes) : 79 s.

| Programme | Octets | Fonctions | Octets de code | Décomp. ok | Partielle | Erreur | Taux ok | Chaînes (référencées) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `MATH` | 390656 | 1570 | 270154 | 1550 | 20 | 0 | 98.7 % | 257 (186) |
| `BRODFONT.DLL` | 21793 | 89 | 8704 | 86 | 3 | 0 | 96.6 % | 60 (55) |
| `BRODMIDI.DLL` | 11878 | 66 | 5285 | 65 | 1 | 0 | 98.5 % | 6 (5) |
| `BRODPGI.DLL` | 14130 | 84 | 9974 | 83 | 1 | 0 | 98.8 % | 71 (70) |
| `BRODUTIL.DLL` | 10854 | 83 | 7489 | 80 | 3 | 0 | 96.4 % | 13 (12) |
| `BROEMIDI` | 115712 | 528 | 71684 | 514 | 14 | 0 | 97.3 % | 88 (32) |
| **Total** | | 2420 | | 2378 | 42 | 0 | 98.3 % | |

- `MATH` : fonctions créées par `SeedFunctions` : 47 (table des scènes 13, pointeurs lointains des données 34 ; 48 handlers de scène nommés, 1 cibles ignorées) ; la ré-analyse en ajoute 8 par appels directs.
- `MATH` : types de fonctions export 1, func 1565, thunk 4.
- `MATH` : décompilation partielle (20) : `1000:412f`, `10d0:3304`, `1000:5a73`, `10d8:8e7a`, `1000:4e66`, `10d8:268b`, `1028:28e0`, `10d0:0ead`, `10d8:45d1`, `10b8:391d`, `10d8:1579`, `1000:1c1f` ….
- `BRODFONT` : décompilation partielle (3) : `1000:19cf`, `1000:196f`, `1000:215a`.
- `BRODMIDI` : décompilation partielle (1) : `1000:117c`.
- `BRODPGI` : décompilation partielle (1) : `1000:23f0`.
- `BRODUTIL` : décompilation partielle (3) : `1000:15bf`, `1000:155f`, `1000:1c80`.
- `BROEMIDI` : décompilation partielle (14) : `1000:0163`, `1000:60e1`, `1000:0e9a`, `1008:0000`, `1020:38dd`, `1000:43a8`, `1008:0213`, `1020:1ceb`, `1008:0674`, `1000:58ec`, `1000:7e04`, `1000:7e08` ….
<!-- /GEN:stats -->

## Comment l'analyse a été faite (et ses limites)

- **Loader NE de Ghidra.** Il crée un bloc par segment du fichier avec un sélecteur par segment (mode protégé 16 bits : `1000`, `1008`, `1010`... pour les segments 1, 2, 3... de `MATH` ; les segments de données suivent : `1108` est le segment de données automatique de `MATH`, `Data34`). Les adresses de ce document sont des `sélecteur:offset` de Ghidra, pas des adresses réelles : le sélecteur n = 0x1000 + 8 × (n - 1). Les appels aux imports passent par un thunk du bloc `EXTERNAL` (`1120:xxxx` pour `MATH`), qui porte le nom `MODULE::NOM`.
- **Un seul script de correction.** Contrairement à la version DOS, l'auto-analyse par défaut suffit presque : elle crée 1515 fonctions pour `MATH`, et `SeedFunctions.java` ajoute celles que seuls des pointeurs de données atteignent (voir ci-dessous). Taux de décompilation dans les statistiques. Les « partielles » contiennent du code que Ghidra n'a pas su lire (`Bad instruction`, table de saut non reconstruite) : lire alors `disasm.txt`.
- **Références aux chaînes.** Le code passe les chaînes par `PUSH DS ; PUSH offset` ; Ghidra ne les relie pas toujours. `ExportStrings.java` associe tout `PUSH`/`MOV`/`LEA` dont la constante 16 bits est l'offset d'une chaîne du segment de données à la fonction qui le contient (type `imm`), plus les opérandes mémoire absolus (`mem`) et les références posées par Ghidra (`ref`). Les types `imm` et `mem` sont **heuristiques** : un offset inférieur à `0x200` n'est retenu que près d'un `PUSH DS`/`PUSH SS`. Des chaînes mal découpées ou référencées par calcul d'offset peuvent manquer.
- **Tags Mohawk.** `ExportTags.java` cherche chaque type de ressource (`'SCR '`, `'\0SND'`, `'SHAP'`, `'SHPL'`, `'SNDL'`, `'STRL'`, `'PUZZ'`, `'PTRN'`, `'PLST'`, `'TARG'`, `'UNIT'`, `'CURS'`, `'SYSX'`, `'RSFL'`, `'tBMP'`, `'tPAL'`, `'tWAV'`) comme constante 32 bits (dans les deux ordres d'octets) ou comme deux moitiés de 16 bits dans une fenêtre de 8 instructions, et en clair dans les segments de données. Seul l'ordre « gros-boutiste » (`'CURS'` = `0x43555253`) a donné des résultats ; les moitiés 16 bits et les tags en clair n'ont rien donné dans `MATH`. Tags absents du code de `MATH` : `'SCR '`, `'SYSX'`, `'RSFL'`, `'tBMP'`, `'tPAL'` (hypothèse : lus par des tables ou des fonctions génériques qui reçoivent le tag en paramètre, ou par `MPC/PVG.MHK` hors de `MATH`). Les autres sont dans la table plus bas.
- **Imports.** Voir « Imports et DLL » plus bas pour la couverture des noms.
- **Fonctions sans appelant.** Beaucoup de fonctions de l'interface (par exemple `1028:0f99`, `1010:306c`) n'ont aucun appelant direct : elles sont atteintes par des pointeurs de fonction (table de dispatch, messages Windows). Leur appelant n'est donc pas visible dans `functions.tsv`.

## Amorçage des fonctions

`SeedFunctions.java` s'exécute après l'auto-analyse et avant les exports (premier `-postScript` de `run.sh`). Sans lui, treize fonctions de scène n'existaient pas : elles ne sont appelées que par pointeur lointain (`CALLF [BX]` dans `1038:0000`), plusieurs commencent à l'offset 0 de leur segment, et l'auto-analyse ne suit pas ces pointeurs. Les noms `bowling.dat`, `hidden.dat`, `patterns.dat`, `stickler.dat`, `PatFill.DAT`, `Nim.DAT`, `credits.dat` et `trophy.dat` n'avaient donc aucune référence ; ils ont maintenant leur `Enter` (voir la table `dats` plus haut).

**Résolution des pointeurs.** Le loader NE de Ghidra **applique les relocations à l'import** : la mémoire de `1108:1b22` contient déjà des paires (offset, sélecteur) résolues (`0c0e 1108`, `031a 1108`, ...), et les pointeurs lointains des descripteurs contiennent des sélecteurs de code Ghidra (`1010`, `1020`...). Il suffit donc de lire deux mots à l'adresse (`SegmentedAddressSpace.getAddress(sélecteur, offset)`), sans passer par la table de relocation NE. Celle-ci (`Program.getRelocationTable()`, type 3 = pointeur lointain, posée sur le mot offset et couvrant 4 octets) sert uniquement à **certifier** qu'un mot de données est un vrai sélecteur lors du balayage.

**Sources d'amorces.**

1. La table des scènes (`1108:1b22`, 11 pointeurs vers des descripteurs ; adresse et nombre repris de `engine.md` §1.4, ce sont les seules constantes en dur). Pour chaque descripteur, les cinq pointeurs `+0x00` Enter, `+0x04` Leave, `+0x08` Tick, `+0x0c` Exit, `+0x10` Key sont lus en mémoire ; un pointeur nul est ignoré. Les adresses des fonctions ne sont pas en dur.
2. Tous les couples (offset, sélecteur) des blocs de données (`Data*`) dont le sélecteur désigne un bloc de code **et** qui portent une relocation de pointeur lointain : pointeurs de fonction et vtables lointaines. Les vtables à pointeurs proches (offset seul, dans le segment de code) ne sont pas balayées.

**Conditions.** Une cible devient une fonction si elle est dans un bloc de code initialisé, n'est ni au milieu d'une instruction ni dans le corps d'une fonction existante, se désassemble, et (hors table des scènes) ne commence ni par des octets nuls, ni par un `RET`, ni par une instruction invalide dans les six premières. Le script ré-analyse (`analyzeAll`), refait un passage (les nouvelles fonctions peuvent en révéler d'autres) et renomme les handlers de scène `scene_<scène>_<handler>` ; les autres gardent le nom `FUN_<sel>_<off>`. Le résumé est écrit dans `MATH/seed.tsv` (lu par `make_index.py`) et le détail des cibles ignorées dans `run.log` (`[re] cible ignorée`).

**Chiffres (`MATH`).** 1515 → 1570 fonctions : 13 créées par la table des scènes (les 13 de `engine.md` §1.4, vérifiées une à une), 34 par le balayage des pointeurs lointains de données (491 pointeurs distincts relogés vers du code, dont 260 cibles déjà des fonctions), 8 de plus par la ré-analyse (appels directs depuis les nouvelles fonctions). 48 handlers de scène lus et nommés. Une seule cible ignorée : `10a0:10d8`, au milieu d'une fonction existante (pointée 14 fois). Dans `BROEMIDI`, 5 fonctions créées ; aucune dans les quatre autres modules.

### Les 11 scènes et leurs handlers

Table à `1108:1b22` ; l'index est la valeur de `1108:1b20`. Nom de fonction = `scene_<scène>_<handler>`. `-` : pointeur nul.

| # | Scène (`.DAT`) | Descripteur | `enter` | `leave` | `tick` | `exit` | `key` |
|---|---|---|---|---|---|---|---|
| 0 | `hub` (`mainscrn.dat`) | `1108:0c0e` | `1020:0000` | `1020:0584` | `1020:06f6` | - | `1020:11b0` |
| 1 | `bowling` (`bowling.dat`) | `1108:031a` | `1010:0000` | `1010:03a3` | `1010:05d1` | - | `1010:2b64` |
| 2 | `rhythm` (`RHYTHM.DAT`) | `1108:151a` | `1028:0f99` | `1028:13f7` | `1028:15cd` | `1028:173a` | `1028:2de2` |
| 3 | `patwin` (`PatFill.DAT`) | `1108:2134` | `1060:06f4` | `1060:0a8e` | `1060:0bb0` | `1060:0d22` | `1060:1786` |
| 4 | `hidden` (`hidden.dat`) | `1108:197c` | `1030:0000` | `1030:0142` | `1030:02ab` | `1030:0364` | `1030:1ef2` |
| 5 | `patterns` (`patterns.dat`) | `1108:1c04` | `1040:0000` | `1040:012f` | `1040:0298` | `1040:0422` | `1040:1678` |
| 6 | `sticklers` (`stickler.dat`) | `1108:1d50` | `1048:0000` | `1048:0155` | `1048:02be` | `1048:0422` | `1048:1914` |
| 7 | `rockets` (`Nim.DAT`) | `1108:2838` | `1070:0a37` | `1070:0e7d` | `1070:102d` | `1070:1131` | `1070:2045` |
| 8 | `title` (`title.dat`) | `1108:26a0` | `1068:0364` | `1068:0505` | `1068:05af` | - | - |
| 9 | `credits` (`credits.dat`) | `1108:2b8a` | `1078:00e4` | `1078:01eb` | `1078:024a` | - | - |
| 10 | `trophy` (`trophy.dat`) | `1108:2c24` | `1078:0523` | `1078:0635` | `1078:06a8` | `1078:06d9` | - |

Ces adresses sont celles que lit le script (48 handlers non nuls) ; elles coïncident avec `engine.md` §1.4. Les fonctions sont dans `MATH/functions.tsv` et `MATH/decomp/<sel>_<off>_scene_<scène>_<handler>.c`.

## Point d'entrée, `WinMain` et boucle principale

Adresses `sélecteur:offset` (celles des noms de fichiers de `decomp/`), vérifiées dans la décompilation.

| Adresse | Rôle |
|---|---|
| `1000:0000` `entry` | point d'entrée du NE : `INITTASK`, `WAITEVENT`, `INITAPP`, mémorise `hInstance`/`hPrevInstance`/ligne de commande dans les globales `1108:0016` à `1108:001e`, efface le BSS, `GETWINFLAGS`, appelle `1000:00de` (exécute une table d'initialiseurs C par priorité), puis `1008:0000`, puis `1000:5666` (sortie) avec sa valeur de retour |
| `1008:0000` (hypothèse : `WinMain`) | initialisation complète puis boucle principale : voir ci-dessous. Quitte tout de suite si son 3e paramètre est non nul (hypothèse : instance précédente) ; exige le mode étendu 386 (message `Program requires Windows to run in enhanced mode.`) |
| `1000:17bb` | gestionnaire d'OS Mohawk (`MOHAWK OS Manager`) : classe de fenêtre, timer (`SETTIMER` en `1000:1677`/`1000:1eaa`), hook (`SETWINDOWSHOOKEX`) ; message `unable to initialize OS manager` |
| `1000:32e9` | initialisation du tas (`unable to initialize heap`) ; `1000:2d5c` mesure la mémoire libre (seuil `0x189c40`, `Not enough free memory`) |
| `10b8:1738` | gestionnaire de fichiers (`unable to initialize file manager`) |
| `10c0:3116` | gestionnaire de ressources (`unable to initialize resource manager`) |
| `10c8:073e` | gestionnaire de configuration : lit `MOHAWK.WIN` et `MOHAWK.INI` (`unable to initialize configuration file manager`) |
| `10d0:03e3` | son : énumère les périphériques `MIDIOUT*`/`WAVEOUT*`, lit la section `Audio` de `MOHAWK.INI` (`DefaultWaveDevice`, `DefaultMidiDevice`, `fCacheDefaultMidiDevice`) ; `10d0:1a78` charge `MIDIMAP.DAT` ; message `unable to initialize sound` |
| `1078:0019` | lit `math.cfg` (clés `INSTALL`, `INSTALLFROMDIR`) ; message `Math Workshop CD must be inserted in drive %c` ; référence `milkyway.dat` |
| `1098:006e` | enregistre la classe de fenêtre, charge l'icône `AppIcon`, crée et affiche la fenêtre principale (appelée par `10a8:0b1d`) |
| `1008:053a` | une itération de la boucle principale (voir ci-dessous) |

Séquence de `1008:0000` après les gestionnaires : charge les polices `NCSclB10` et `NCSclB12` (`10a8:0a87`), ouvre `milkyway.dat` (`10a8:0936`), charge deux curseurs (`'CURS'` ids 1 et 2 : `watch cursor`, `question mark cursor`) et le son `transition music` (`'\0SND'` id 65000) par `10a8:0430`, puis boucle : `while (1008:053a() != 0) 1088:105b();`.

Boucle principale (message pump) :

- `1008:053a` : une itération. Appelle `1038:0000` (hypothèse : tâches différées, pilotée par `1108:1b20`), lit l'état de l'entrée (`1098:039b`), puis `1098:02f3` : `PEEKMESSAGE` / `TRANSLATEMESSAGE` / `DISPATCHMESSAGE` (renvoie 1 pour une touche, 2 pour un clic souris, 0 sinon) ; en l'absence de message elle passe la main à `10a0:001b` (hypothèse : gestionnaire d'événements de haut niveau du jeu) et sinon à `1098:048a`.
- `1088:105b` : « laisser respirer Windows », appelée par 20 fonctions dont les chargeurs de ressources (`10a8:0430`) : appelle `1098:08dc` (vide la file avec `PEEKMESSAGE`, traite un message, puis un `WM_PAINT` (filtre `0xf`) avec `GETMESSAGE`) puis un rappel optionnel `1108:3352`.
- Un second pump existe dans `10d8:38e8` (boîte de dialogue d'impression : `CREATEDIALOGINDIRECT`, `ISDIALOGMESSAGE`, message `Print Error`), sans appelant direct.

Organisation des segments de code (hypothèse, d'après les imports et les messages d'erreur) : `1000` runtime C + OS manager ; `1088`–`1098` messages, fenêtre, fichiers WMF (`bkg.wmf`, `rib1.wmf`...) ; `10a0`, `10a8` API de ressources « e2 » (`e2OpenMap`, `e2GetRsrc`, `e2GetBackPort`, `e2SaveRect`, `e2ClipRect`, `e2SetupAnim`) ; `10b8` gestionnaire de fichiers ; `10c0` gestionnaire de ressources (index des archives) ; `10c8` fichiers INI ; `10d0` audio (MMSYSTEM) ; `10d8` graphique (GDI, palettes, DIB, `WING.DLL`, impression). Les segments `1010` à `1080` contiennent la logique de l'application (écrans, jeux).

## Accès aux archives Mohawk

Fonctions génériques (vérifiées dans la décompilation) :

| Adresse | Rôle |
|---|---|
| `10a8:0936(nom_dat, &handle)` | ouvre une archive : copie le nom, appelle `10b8:2e62` (objet fichier) puis `10c0:0c68` ; erreurs `e2OpenMap error: %s - resFile already in use` et `unable to open %s` |
| `10a8:0000(handle)` | fixe l'archive courante (15 octets ; 24 appelants : appelée avant chaque série de chargements) |
| `10a8:0430(nom, ?, id, tag, &handle)` | charge une ressource par `(tag 32 bits, id 16 bits)` : appelle `10c0:086e` puis `10c0:0aac` ; erreur `e2GetRsrc error` (hypothèse : `e2GetRsrc`) ; 9 appelants directs |
| `10c0:086e(archive, id, tag)` | recherche dichotomique à deux niveaux : d'abord le tag (table de paires tag/décalage, 8 octets par entrée), puis l'id dans la table des ressources de ce type ; renvoie un handle (hypothèse : table des ressources du format Mohawk) |
| `10a8:006a(handle)` | lit le pointeur de la ressource (enveloppe de `10c0:0aac`) ; 20 appelants |
| `10a8:0a87(?, nom_police, ...)` | charge une police par nom (`Font already in use: %s %d`, `unable to load %s %d`) |

Le tag de `'CURS'` est passé en `0x43555253` et celui de `'\0SND'` en `0x534e44` : ces constantes sont les entrées de `10a8:0430`. Les fonctions qui référencent des tags ou des noms de `.DAT` :

<!-- GEN:dats -->
Tags Mohawk trouvés comme constantes dans le code de `MATH` (fonctions distinctes) :

| Tag | Fonctions | Liste |
|---|---:|---|
| `\0SND` | 97 | `1008:0000`, `1008:0522`, `1010:0000`, `1010:03a3`, `1010:0959`, `1010:09a4`, `1010:0a70`, `1010:0b5d`, `1010:0e23`, `1010:28b9`, `1010:2a83`, `1010:3bfc` … |
| `STRL` | 4 | `1010:306c`, `1018:0518`, `1028:0f99`, `1060:06f4` |
| `SHAP` | 3 | `1018:0ac2`, `1088:1a35`, `10a8:0379` |
| `PUZZ` | 3 | `1030:18eb`, `1040:0543`, `1048:0556` |
| `PTRN` | 2 | `1060:06f4`, `1060:1735` |
| `tWAV` | 2 | `1088:1972`, `1088:1a0f` |
| `CURS` | 1 | `1008:0000` |
| `TARG` | 1 | `1010:306c` |
| `UNIT` | 1 | `1010:306c` |
| `PLST` | 1 | `1058:0000` |
| `SHPL` | 1 | `10a8:0640` |
| `SNDL` | 1 | `10a8:078a` |

Fonctions qui référencent un nom de fichier `.DAT` (chaîne passée en immédiat) :

| Fonction | Octets | DAT | Tags dans la même fonction |
|---|---:|---|---|
| `1008:0000` | 730 | milkyway.dat | `CURS`, `\0SND` |
| `1010:0000` | 931 | bowling.dat | `\0SND` |
| `1010:3adc` | 288 | milkyway.dat | - |
| `1010:4363` | 202 | polly.dat | - |
| `1010:44ef` | 139 | gus.dat | - |
| `1010:457a` | 161 | gus.dat | - |
| `1028:0000` | 1471 | milkyway.dat, RSHELP.DAT | `\0SND` |
| `1028:0f99` | 1118 | MidiMPC.DAT, RHYTHM.DAT, RSHELP.DAT | `STRL`, `\0SND` |
| `1030:0000` | 322 | hidden.dat | `\0SND` |
| `1030:1f86` | 241 | polly.dat | - |
| `1040:0000` | 303 | patterns.dat | `\0SND` |
| `1040:1692` | 183 | milkyway.dat | `\0SND` |
| `1040:17c7` | 241 | polly.dat | - |
| `1048:0000` | 341 | stickler.dat | `\0SND` |
| `1048:192e` | 143 | milkyway.dat | `\0SND` |
| `1048:19f4` | 241 | polly.dat | - |
| `1060:06f4` | 884 | PatFill.DAT | `PTRN`, `STRL`, `\0SND` |
| `1068:0364` | 417 | title.dat | `\0SND` |
| `1070:0a37` | 1062 | Nim.DAT | `\0SND` |
| `1070:1778` | 463 | milkyway.dat | `\0SND` |
| `1070:1d25` | 424 | milkyway.dat | - |
| `1078:0019` | 203 | milkyway.dat | - |
| `1078:00e4` | 263 | credits.dat | - |
| `1078:0523` | 274 | trophy.dat | - |
| `1090:0094` | 910 | milkyway.dat | `\0SND` |
| `10d0:1a78` | 204 | MIDIMAP.DAT | - |
| `10d8:38e8` | 438 | mainscrn.dat | - |
| `10d8:6d22` | 123 | mainscrn.dat | - |
| `10d8:6db9` | 1154 | mainscrn.dat | - |
| `10d8:7d03` | 662 | mainscrn.dat | - |

Noms de fichiers `.DAT` présents dans le segment de données sans aucune référence immédiate trouvée : aucun.

Fonctions référençant un tag sans nom de DAT dans la même fonction : 92 sur 106 fonctions à tags (voir `MATH/tags.tsv`).
<!-- /GEN:dats -->

Lecture de cette table :

- `1008:0000` ouvre `milkyway.dat` et charge les curseurs et le son de transition ; `1078:0019` vérifie la présence de `milkyway.dat` sur le CD.
- `milkyway.dat` est ouvert par plusieurs écrans (`1010:3adc`, `1040:1692`, `1048:192e`, `1070:1778`, `1070:1d25`, `1090:0094`), `polly.dat` par `1010:4363`, `1030:1f86`, `1040:17c7`, `1048:19f4`, `gus.dat` par `1010:44ef` et `1010:457a`, `title.dat` par `1068:0364`, `mainscrn.dat` par `10d8:38e8`/`10d8:6d22`/`10d8:6db9` (hypothèse : bitmaps de l'écran principal et de l'impression).
- `1028:0f99` (1118 octets, sans appelant direct) ouvre `MidiMPC.DAT`, `RHYTHM.DAT` et `RSHELP.DAT` et charge des `'STRL'` : c'est l'écran de choix du périphérique/rythme MIDI (hypothèse).
- Plusieurs noms de `.DAT` du segment de données n'ont aucune référence immédiate dans le code (`bowling.dat`, `hidden.dat`, `patterns.dat`, `stickler.dat`, `PatFill.DAT`, `Nim.DAT`, `credits.dat`, `trophy.dat`, un second `RSHELP.DAT`) : ils sont probablement atteints par une table ou un calcul d'offset que l'heuristique ne voit pas (hypothèse). Piste pour les tâches suivantes : chercher les fonctions qui appellent `10a8:0936` avec un pointeur calculé, ou passer par le tag `'STRL'` (`1010:306c`, `1018:0518`, `1028:0f99` chargent des listes de chaînes).
- Les tags `'\0SND'` (sons) dominent : ils sont chargés partout où un écran joue un son (`10a8:0430` avec `0x534e44`).

## Imports et DLL

<!-- GEN:imports -->
| Programme | Modules importés | Imports | Nommés par Ghidra | Nommés via une DLL | Sans nom | Appels (références) |
|---|---|---:|---:|---:|---:|---:|
| `MATH` | KERNEL (52), USER (60), GDI (78), WIN87EM (1), MMSYSTEM (30), COMMDLG (2) | 223 | 223 | 0 | 0 | 549 |
| `BRODFONT.DLL` | KERNEL (24), USER (1), GDI (3) | 28 | 28 | 0 | 0 | 45 |
| `BRODMIDI.DLL` | KERNEL (11), USER (1), MMSYSTEM (2) | 14 | 14 | 0 | 0 | 18 |
| `BRODPGI.DLL` | KERNEL (19), USER (1), DDEML (11) | 31 | 20 | 0 | 11 | 41 |
| `BRODUTIL.DLL` | KERNEL (17), USER (5) | 22 | 22 | 0 | 0 | 27 |
| `BROEMIDI` | KERNEL (49), USER (39), GDI (1), WIN87EM (1), MMSYSTEM (30) | 120 | 120 | 0 | 0 | 162 |

Imports restés sans nom (le loader NE de Ghidra ne connaît pas la table d'ordinaux du module et aucune DLL analysée ne l'exporte) : `BRODPGI` : module DDEML, ordinaux 2, 3, 7, 8, 11, 14, 17, 18, 19, 21, 22.

Imports de `MATH` vers les DLL `BROD*` : aucun (la table des modules importés de `MATH` ne contient pas de `BROD*`).

Imports de `MATH` les plus appelés (nombre de fonctions appelantes) :

| Import | Appelantes | Exemples d'appelantes |
|---|---:|---|
| `GDI::DELETEOBJECT` | 28 | `10b0:0ed4`, `10d8:02f3`, `10d8:084e`, `10d8:092e` |
| `GDI::DELETEDC` | 15 | `10d8:02f3`, `10d8:265a`, `10d8:268b`, `10d8:3f99` |
| `GDI::SELECTOBJECT` | 14 | `10d8:02f3`, `10d8:0c79`, `10d8:0ee3`, `10d8:1000` |
| `USER::SELECTPALETTE` | 11 | `10d8:02f3`, `10d8:092e`, `10d8:0c79`, `10d8:0d8b` |
| `GDI::LPTODP` | 11 | `10d8:02f3`, `10d8:0b20`, `10d8:1fb2`, `10d8:20e7` |
| `GDI::CREATERECTRGN` | 10 | `10b0:0ed4`, `10d8:084e`, `10d8:092e`, `10d8:0b20` |
| `GDI::GETSTOCKOBJECT` | 10 | `1098:006e`, `1098:0966`, `10d8:0c79`, `10d8:1fb2` |
| `KERNEL::GLOBALLOCK` | 9 | `1000:8425`, `1000:857a`, `1088:05b5`, `1098:026b` |
| `KERNEL::GLOBALUNLOCK` | 9 | `1000:0b93`, `1000:8455`, `1000:857a`, `1088:05b5` |
| `KERNEL::GLOBALFREE` | 7 | `1000:0444`, `1000:3598`, `1000:8455`, `1098:026b` |
| `GDI::SETBKMODE` | 7 | `10d8:02f3`, `10d8:092e`, `10d8:268b`, `10d8:60ae` |
| `GDI::SETMAPMODE` | 7 | `1088:03ed`, `10d8:02f3`, `10d8:0799`, `10d8:60ae` |
| `GDI::GETDEVICECAPS` | 7 | `1088:03ed`, `10d8:02f3`, `10d8:092e`, `10d8:6849` |
| `KERNEL::GLOBALALLOC` | 6 | `1000:0163`, `1000:32e9`, `1000:8425`, `1088:05b5` |
| `KERNEL::FREELIBRARY` | 6 | `1000:04b6`, `10d8:3c9f`, `10d8:8dad`, `10d8:8e7a` |
| `USER::RELEASEDC` | 6 | `10d8:6d22`, `10d8:6db9`, `10d8:7530`, `10d8:95b2` |
| `USER::PEEKMESSAGE` | 6 | `1098:02f3`, `1098:0437`, `1098:048a`, `1098:04d9` |
| `USER::REALIZEPALETTE` | 6 | `10d8:0d8b`, `10d8:4ca0`, `10d8:55ec`, `10d8:6db9` |
| `KERNEL::GLOBALREALLOC` | 5 | `1000:0ad0`, `1000:0e8b`, `1000:17bb`, `1000:2f84` |
| `KERNEL::LOADLIBRARY` | 5 | `1000:09c1`, `10d8:3f44`, `10d8:89d0`, `10d8:8e7a` |
| `USER::GETDC` | 5 | `10d8:6d22`, `10d8:6db9`, `10d8:7530`, `10d8:95b2` |
| `GDI::SETBKCOLOR` | 5 | `10d8:02f3`, `10d8:0e29`, `10d8:268b`, `10d8:6db9` |
| `GDI::SETWINDOWORG` | 5 | `1088:03ed`, `10d8:0799`, `10d8:60ae`, `10d8:636f` |
| `GDI::INTERSECTCLIPRECT` | 5 | `10d8:084e`, `10d8:0e7f`, `10d8:1b8a`, `10d8:60ae` |
| `GDI::BITBLT` | 5 | `10d8:02f3`, `10d8:268b`, `10d8:60ae`, `10d8:636f` |
<!-- /GEN:imports -->

Faits notables :

- **`MATH` n'importe aucune des DLL `BROD*`.** Sa table des modules importés est `KERNEL`, `USER`, `GDI`, `WIN87EM`, `MMSYSTEM`, `COMMDLG`. Les DLL du CD sont des aides d'installation et de configuration (hypothèse, d'après leurs exports) : `BRODFONT` (`INSTALLFONTS`, `DEINSTALLFONTS`), `BRODUTIL` (`BROADCAST`, `SPRINGBOARD`, `DELETEDIRECTORY`, `DEINSTALLFILES`, `SETPARENTWINDOW`), `BRODPGI` (`PGINSTALL`, `PGUNINSTALL`, `GETNETPGSIZE` : installation de groupes de programmes par DDEML), `BRODMIDI` (`SELECTMIDIDEVICE`, `GETDRIVERCOUNT`). `BROEMIDI` est un exécutable (dialogue de réglage du pilote MIDI, trois dialogues d'aide en anglais, point d'entrée `WNDPROC`, `MIDIDLGPROC`, `HELPDLGPROC`, `WHATSGOINGDLGPROC`). Le nommage des imports par les exports des DLL (`source = dll`) est implémenté mais n'a eu aucun import à nommer ici : aucun programme analysé n'importe une des DLL analysées.
- **Imports sans nom.** Ghidra ne connaît pas la table d'ordinaux de `DDEML` : 11 des 31 imports de `BRODPGI.DLL` restent `Ordinal_N` (voir ci-dessus). Pour `MATH`, les 223 imports sont nommés par le loader (aucun n'est resté `Ordinal_N`), y compris `MMSYSTEM`, `COMMDLG` et `WIN87EM`.
- **Chargements dynamiques dans `MATH`.** `LOADLIBRARY`/`GETPROCADDRESS` sont appelés par `10d8:3f44` (charge `DIB.DRV`), `10d8:89d0` et `10d8:8e7a` (pilotes `.DRV`, impression : `COMMDLG::PRINTDLG`) et `10d8:ab41` (charge `WING.DLL`, la bibliothèque graphique WinG). Ces appels sont par nom de fichier du CD, pas par la table des imports.
- **Son.** `MMSYSTEM` n'est utilisé que par le segment `10d0` (`WAVEOUT*`, `MIDIOUT*` : `10d0:3a51` ouvre le périphérique wave, `10d0:3bd9` écrit les tampons, `10d0:1be5` ouvre le MIDI) et `1000:4614`/`1000:4673`/`1000:412f` (`MIDIOUTSHORTMSG`/`LONGMSG`) ; `TIMESETEVENT` en `1000:2a2a`.

## Ressources NE

<!-- GEN:resources -->
| Programme | Ressources NE | Détail |
|---|---:|---|
| `MATH` | 2 | GROUP_ICON 1, ICON 1 |
| `BRODFONT.DLL` | 0 | aucune |
| `BRODMIDI.DLL` | 0 | aucune |
| `BRODPGI.DLL` | 0 | aucune |
| `BRODUTIL.DLL` | 0 | aucune |
| `BROEMIDI` | 6 | NAMETABLE 1, ICON 1, DIALOG 3, GROUP_ICON 1 |
<!-- /GEN:resources -->

`MATH` ne contient que l'icône de l'application (`APPICON`, une seule icône) : aucune boîte de dialogue, menu ni table de chaînes. Tous les textes visibles (menus, bulles, erreurs) sont donc dans les archives `.DAT` (types `'STRL'`, `'SYSX'`...) ou dans le segment de données de `MATH`. Seul `BROEMIDI` a des dialogues, dumpés dans `BROEMIDI/resources/`.
