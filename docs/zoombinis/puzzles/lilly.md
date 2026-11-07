# Les têtards tatoués (`LILLY.MHK`, écran 11) : étude de rétro-ingénierie

Tâche T7. Épreuve 5 du parcours de L'Odyssée des Zoombinis (`ZOOMBINI.EXE`, NE 16 bits, version 1.0FR), 2e épreuve de l'étape 2 « le marais quajeux » (écran 10 le bac, **11 les têtards tatoués**, 12 la fosse). Document d'étude seul (aucun code applicatif). Cadre moteur : [../engine.md](../engine.md) (table des écrans §2.1, `SCRB` §3, `REGS` §4.3, `tBMP` §5, sons §6, aléatoire §8) ; parcours et tampon de partie : [../screens.md](../screens.md) (§1.6 niveaux, §3.4 perdus et marques de réussite). Corpus Ghidra : `archives/zoombinis/re/ZOOMBINI/` (`decomp/10f8_*.c` et `decomp/10f0_*.c`, `disasm.txt`).

Confiance : **sûr** = lu dans le code ou vérifié sur les données (ou par simulation, voir §2.3 et §2.4) ; **probable** = déduit de plusieurs indices concordants ; **hypothèse** = non vérifié. Les adresses sont des `sélecteur:offset` de code ; `DS:xxxx` est le segment de données du jeu (`1530`) ; **`DS2:xxxx` est le second segment de données (`1440`, 9 806 octets, données initialisées de l'épreuve)**. Piège de lecture : Ghidra confond souvent une constante entière avec l'adresse d'une chaîne voisine (`s_unable_to_initialize_timer_1530_274f + 6` est en réalité l'entier 10 069, `0x274f` = 10 063, etc.) et affiche `DAT_1440_xxxx` pour `DS2:xxxx`. Tous les ids cités ci-dessous ont été remis en entiers.

**Relecture H5r.** L'étude d'origine (sous-agent) a été relue ligne à ligne sur `decomp/*.c` et `disasm.txt`, les tables `DS` / `DS2` lues dans le segment de données de `ZOOMBINI._EX` (segments NE 137 = `DS2` et 167 = `DS`), et les gabarits `REGS` 15000 à 15002 sur `LILLY.MHK`. Les règles sont portées dans `src/games/zoombinis/game/puzzles/lilly.ts` (tests : `test/zoombinis/puzzles/lilly.test.ts`). Principales corrections : ordre des tirages (§2.3), échanges fixes aux niveaux 2 à 4 (§2.3), explorateur du crapaud (compteurs = heure de dernier passage, §2.4), champ `+0x106` (§2.5), grenouilles (§2.7, entièrement revu). **Relecture H5 (écran) : un crapaud ne fait que deux traversées** (§2.5 et §7 point 1 tranchés, désassemblage de `10f8:3b23` et `10f8:3614` depuis l'exécutable ; l'écran est `src/games/zoombinis/scenes/puzzles/lilly.ts`, voir `engine-ts.md`, « Têtards (tâche H5) »). Plages de code que Ghidra n'a pas décompilées (rappels atteints seulement par des pointeurs stockés) : `10f8:24e4-267a` (événements des grenouilles, `10f8:2509`), `2b85-30b9`, `3600-373d` (sortie du crapaud, `10f8:3614`), `3b0f-3c02`, `4005-41bd`, `46dd-47e7`, `10f0:0ab9-0c4e` ; celles qui comptent ont été désassemblées depuis les octets de l'exécutable (`10f8:2509`, `10f8:3614`).

## 0. Résumé

- **Décor** : une rivière, deux berges. Sur la berge gauche, **12 crapauds (« têtards tatoués »)**, chacun portant un **tatouage** parmi 12 ; sur la rivière, un **étang de 12 × 12 nénuphars**. Chaque nénuphar a **3 caractéristiques** : A (3 valeurs), B (4 valeurs, la forme du nénuphar), C (5 valeurs) ; les 12 tatouages sont les 12 valeurs possibles (3 + 4 + 5) (**sûr** pour les nombres, **probable** pour le rendu : B = forme du nénuphar, A × C = motif de la décoration du nénuphar).
- **Règle** (**sûr**) : un crapaud tatoué `(caractéristique k, valeur v)` ne saute que sur des nénuphars dont la caractéristique `k` vaut `v`, de proche en proche (4 voisins : haut, droite, bas, gauche). Le joueur **dépose un crapaud sur un nénuphar libre de la première colonne dont la caractéristique correspond à son tatouage** ; un Zoombini (le suivant de la file) monte dessus, et le crapaud cherche seul un chemin de nénuphars compatibles jusqu'à la **colonne 11** (berge droite). Il y parvient si et seulement si la **composante connexe** de nénuphars compatibles qui contient sa case de départ touche la colonne 11 (**sûr** : l'explorateur du jeu est un parcours « le moins récemment visité d'abord » qui couvre toute la composante, vérifié sur 21 600 dépôts simulés sans aucun écart, §2.4). Sinon il **erre indéfiniment** dans l'impasse (aucun état d'échec, aucune mort) et son Zoombini est perdu si le joueur quitte l'écran.
- **Niveaux** (§3) : 1 = pas de fée ; une partie des chemins est coupée (au moins `⌊(N+1)/2⌋` des 12 tatouages passent, N = Zoombinis du groupe) ; 2 = les chemins sont coupés en ≈ 2 endroits chacun (en moyenne 2 tatouages sur 12 passent encore, parfois aucun), deux échanges fixes brouillent encore l'étang, et une **fée** permet d'**échanger deux nénuphars libres** (6 crans de ⌈(coupures + 5) / 6⌉ échanges, au plus 30) ; 3 et 4 = comme 2, plus des **grenouilles** qui descendent l'étang du haut vers le bas sur un chemin vertical (2 puis 3 points d'entrée) et occupent des nénuphars (elles ne bougent qu'après un échange de la fée qui touche leur valeur, §2.7).
- **Réussite d'un Zoombini** : son crapaud atteint la berge droite (événement 30 du script d'arrivée). **Pas de limite d'erreurs** (le nombre de Zoombinis perdus est libre). Le joueur quitte quand il le décide (bouton « suite », actif dès la première arrivée). Les Zoombinis dont l'octet `+0x127` est nul sont perdus et renvoyés à l'arrêt de l'étape (screens.md §3.4).

## 1. Identification

### 1.1 Écran et handlers (**sûr**)

Écran **11**, descripteur `1530:142a`, archive `LILLY.MHK`. Handlers de la table des écrans (engine.md §2.1) :

| Rôle | Adresse | Taille | Note |
|---|---|---:|---|
| **Enter** (+0) | `10f8:0000` | 2 529 | initialisation, 12 crapauds, génération de l'étang, fée |
| **Exit** (+4) | `10f8:0b0f` | 200 | libère tout ; `1168:3e5f(1)` rend les Zoombinis visibles |
| **Tick** (+8) | `10f8:0bd7` | 3 931 | un tour de boucle : files d'objets, pas des crapauds et des grenouilles, sortie |
| **Key** (+0x10) | `10f8:41be` | 46 | ne traite qu'une touche (code `0x016f`, voir §4.5) |

Routines de l'épreuve (module `10f8`, plus `10f0` : second segment de code du même écran) :

| Adresse | Rôle |
|---|---|
| `10f8:1b3a` | rappel des zones cliquables (3 régions : 1 = carte, 2 = suite, 3 = terrain), `param_1` = numéro de région |
| `10f8:6cdf` | boucle modale de **glisser-déposer** (crapaud ou fée) |
| `10f8:5f02` | **génération de l'étang** (tables `REGS` 15000-15002, tatouages, coupures) |
| `10f8:5c1e` | attribution des 12 « chemins » aux valeurs des caractéristiques |
| `10f8:484e` | création des **12 crapauds** et tirage de leurs tatouages |
| `10f8:47e8` | paramètres de niveau (reçoit niveau + 1) |
| `10f8:41ec` | **un pas d'un crapaud** (choix de la case suivante, code du script de saut) |
| `10f0:0000` / `051a` / `086f` | pré-calcul du chemin d'un crapaud (compteurs de visites) |
| `10f8:20bc`, `10f8:267b`, `10f8:3c03`, `10f8:3f4f`, `10f8:30ba` | rappels d'événements des scripts (saut, arrivée, file des animations) |
| `10f8:4a84`, `10f0:1207`, `10f0:14cb`, `10f0:00e5` | **grenouilles** (niveaux 3 et 4) : création, pas, champ de distance |
| `10f8:5831` | **échange de deux nénuphars** (fée) |
| `10f8:5743`, `10f8:56a3`, `10f8:54b9`, `10f8:7614`, `10f8:76b6` | halos et animation de la fée sur les nénuphars choisis |
| `10f8:4f53`, `10f8:4d54` | dessin de tous les nénuphars / d'un nénuphar |
| `10f8:7866` | commentaire parlé de fin quand il manque des Zoombinis |
| `10f8:09e1`, `10f8:0aac` | dessin et rafraîchissement des deux boutons |
| `10f8:68a6`, `10f8:692f`, `10f8:69f5`, `10f8:6b7d` | chargement des `REGS`, rotation et symétrie des gabarits |

`10f8:4bf9` (chargeur de `SCRB` 10000 + i) n'est référencée par aucune route d'appel : code mort (**sûr**).

### 1.2 Ressources de `LILLY.MHK` (**sûr**, relu sur l'archive)

| Tag | Ids | Emploi |
|---|---|---|
| `tBMP` 5000 | 640 × 480, RLE (`0x0012`) | fond : la rivière entre deux berges (voir `SHPL` 5000) |
| `SHPL` 5000 | 1 forme, entrées 10 à 237 (228) | palette du fond, éclaircie (engine.md §5.3) |
| `tBMP` 7000 | planche de 6 images 38 × 36 | boutons (§4.4) |
| `tBMP` 10000 | planche de **291** images | **groupe 2** : crapauds, tatouages, grenouilles, jetons de Zoombinis (têtards minuscules), nénuphars lumineux ; 12 images de tatouage aux indices 272 à 283 (le tatouage `t` est l'image `272 + t`) |
| `tBMP` 11000 | planche de 70 images (31 × 32 à 121 × 116) | **groupe 0** : la **fée** et sa baguette |
| `tBMP` 13000 | planche de 37 images | nénuphars (images 1 à 4 : formes B = 0 à 3), motifs (5 à 19), nénuphars lumineux (20 à 35), 36 et 37 |
| `tBMP` 14000 | planche de 5 images | **groupe 1** : avant-plans fixes (feuillages des berges) |
| `SCRB` 10000 à 10169 | 170 scripts | animations (§5) ; seuls 10000 à 10166 sont chargés (groupe 2) ; 10167 à 10169 jamais |
| `SCRB` 11000 | 1 script de 70 images | animation de la fée |
| `SCRB` 14000 à 14004 | 5 scripts d'une image | décor fixe |
| `SCRB` 13000 à 13010 | 11 scripts | **non chargés** : sans appelant (reliquat d'outil) ; la planche 13000 elle-même est utilisée directement par le code |
| `REGS` 100, 101 | 13 mots | **origine des 12 rangées** de l'étang : x et y (tableaux `DS:7bee`, `7bf2`) |
| `REGS` 200, 201 | 38 mots | ancres x, y des 37 images de `tBMP` 13000 (`DS:7bf6`, `7bfa`) ; `REGS` 202 : jamais lu |
| `REGS` 10000, 10001 | 292 mots | ancres x, y des 291 images de `tBMP` 10000 (`DS:7bfe`, `7c02`) ; `REGS` 10002 : jamais lu |
| `REGS` 15000, 15001, 15002 | 144 mots chacun | **gabarits** 12 × 12 des chemins (§2.3) |
| `\0SND` 10000 à 10011, 11000, 11001, 12000 à 12003 | 18 sons | voir §5.3 |
| `NODE` 1000, `PATH` 1000 | | **non utilisés** par cet écran (`1168:2a5c` n'est pas appelée) |

Pas de musique (aucun id ≥ 30 000). Pas de texte à l'écran (tout passe par des voix).

### 1.3 Chargement (Enter `10f8:0000`, **sûr**)

Ordre : ouverture de `LILLY.MHK` ; `tBMP` 7000 (boutons) ; fond 5000 + `SHPL` 5000 (`11a8:1475`) ; **groupes** 0 = `tBMP` 11000, 1 = 14000, 2 = 10000 (`11a0:0000`, sans `REGS` : le code recale lui-même les parties avec `REGS` 10000/10001) ; scripts : `SCRB` 11000 (groupe 0), 14000 à 14004 (groupe 1), 10000 à 10166 (groupe 2) ; `tBMP` 13000 (nénuphars) ; `REGS` 100/101, 10000/10001, 200/201, 15000/15001/15002 (chargés par `10f8:692f` ; les mots sont lus big-endian) ; `10f8:47e8` (paramètres de niveau) ; objet « dessin de l'étang » (`10f8:4f53`) ; génération de l'étang (`10f8:5f02`), puis les jetons de Zoombinis, puis les 12 crapauds (`10f8:484e`) ; objets de curseur et de halo ; décor fixe ; zones cliquables (`1038:0000`) ; prélecture des sons (`11a8:313a` : 996-997, 11000-11001, 12000-12004, 10000-10011, ids 20000 à 29999 en flux). Au niveau 1, le jingle 997 est joué à l'entrée.

## 2. Règles exactes

### 2.1 Objets de jeu (**sûr** sauf mention)

- **L'étang** : 12 rangées (indice `r`, 0 à 11, de haut en bas) × 12 colonnes (indice `c`, 0 à 11, de gauche à droite). Une 13e colonne (`c = 12`) sert de **case d'abordage** de la berge droite (une par rangée, voir §2.5).
- **Un nénuphar** : enregistrement de 13 octets à `DS2:062c + 0xA9 × r + 13 × c` (13 cases par rangée, soit 0xA9 = 169 octets par rangée) :

| Offset | Taille | Contenu |
|---:|---:|---|
| +0 | u16 | x de l'ancre (voir ci-dessous) |
| +2 | u16 | y de l'ancre |
| +4 | u16 | x + 0x24 (36) |
| +6 | u16 | y + 0x1E (30) |
| +8 | octet | **occupé** (0 libre, 1 un crapaud ou une grenouille est dessus) |
| +9 | octet | caractéristique **A**, 0 à 2 (kind 1) |
| +10 | octet | caractéristique **B**, 0 à 3 (kind 2) : forme du nénuphar, image `B + 1` de `tBMP` 13000 |
| +11 | octet | caractéristique **C**, 0 à 4 (kind 3) |
| +12 | octet | image du motif = `{5, 8, 11, 14, 17}[C] + A` (images 5 à 19 de `tBMP` 13000) |

Position : `x = REGS100[r + 1] + 35 × c`, `y = REGS101[r + 1] + {2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12}[c]` (table `DS:145a` : la rangée penche vers le bas de 2 pixels toutes les deux colonnes). `REGS 100` (x de la rangée 0 à 11) = 150, 147, 145, 143, 140, 133, 129, 125, 116, 109, 107, 104 ; `REGS 101` (y) = 79, 108, 137, 166, 195, 224, 253, 282, 311, 340, 369, 398 (pas de 29). L'image est dessinée à `(x - ancreX, y - ancreY)` avec `REGS` 200/201 ; le rectangle de test à la souris est `(x + 4, y + 4, x + 32, y + 26)`, comparé à la souris décalée de `(+27, +22)` (point chaud de la baguette, §2.6).
- **Le tatouage** : couple `(kind k ∈ {1, 2, 3}, valeur v)` ; 12 tatouages numérotés `t = 0 à 11` : `t = 0..2` → `(1, 0..2)`, `t = 3..6` → `(2, 0..3)`, `t = 7..11` → `(3, 0..4)` (tables `DS:14b6` et `14ce`). Image du tatouage = `tBMP` 10000, image `272 + t`.
- **Un crapaud** (12, un par rangée de départ) : objet du moteur créé par `10f8:484e`, script de repos `SCRB 10043 + i` (rangée `i`), position de repos `DS2:23e8 + 4 i` = (66, 118), (60, 147), (46, 177), (58, 205), (44, 232), (52, 262), (39, 289), (18, 313), (47, 327), (17, 345), (43, 363), (53, 393). **Les tatouages sont tirés sans remise : les 12 crapauds portent les 12 tatouages, dans un ordre aléatoire** (`rand(0..11 − i)` sur un sac de 12, `10a8:04e8`) ; chaque crapaud tire aussi un paramètre d'animation `rand(3..6)` juste après (4 ticks par image en moyenne, sans effet sur les règles mais il compte dans l'ordre des tirages). Champs utiles de l'objet (offsets du descripteur de feature, `+0x30` + offset de donnée) : `+0x10e` kind, `+0x10f` valeur, `+0x110` numéro de tatouage `t`, `+0xf3` colonne courante, `+0xf4` rangée courante, `+0xd5` cap (0 haut, 1 droite, 2 bas, 3 gauche), `+0x106` colonne la plus à droite atteinte par le pré-calcul du chemin (11 = un chemin existe ; **pas un état**, voir §2.4 et §2.5), `+0x10b` étape de sortie (0 en jeu, 1 puis 2 aux deux sorties), `+0xf2` de l'objet (`+0xc2` de la donnée, la donnée commence à `objet + 0x30` : Ghidra montre l'un ou l'autre) sur l'étang (posé au dépôt `10f8:1b3a` ; remis à 0 par l'événement 49 de `SCRB 10058`, rappel `10f8:3b23`, voir §2.5), `+0x111` id du jeton du Zoombini embarqué, `+0xc0` orientation de l'explorateur (0 crapaud : progression en colonne ; 1 grenouille : progression en rangée), `+0xc7` / `+0xc8` case la plus à gauche du pré-calcul, `+0xd7` dernier numéro de passage du pré-calcul.
- **Les Zoombinis** : le groupe courant (au plus 16, `N = DS:8076`, relu par `1168:365d`). Un **jeton** par Zoombini (`SCRB 10109 + i`, i = 0 à 19, 20 emplacements de file en haut à gauche, positions de (94, 31) à (54, 7)) ; les objets « Zoombini » du moteur ne sont montrés qu'en fin d'épreuve. Les jetons sont consommés **dans l'ordre** : `DS:807a` = nombre déjà lancés.
- **La fée** (niveaux 2 à 4) : objet `SCRB 11000`, position de repos (38, 415) (`0x26`, `0x19f`) ; jauge de baguette `SCRB 10078 + g` (g = 0 à 6, `DS:7bd0`).

### 2.2 Ce que fait le joueur (**sûr** pour la mécanique, voir §4 pour les détails)

1. **Choisir un crapaud** et le **glisser** jusqu'à un nénuphar de la **colonne 0** (12 zones de dépôt, une par rangée, `DS2:241c`). Le dépôt n'est accepté que si ce nénuphar est **libre** (`+8 = 0`) **et** que sa caractéristique `k` vaut `v` (`+8 + k` = octet du kind du tatouage) : alors la zone s'éclaire (halo, `10f8:51c3`) pendant le survol ; sinon le crapaud retourne à sa place (`DS2:23e8`). Le joueur choisit donc **à la fois le crapaud (tatouage) et la rangée de départ**.
2. Au dépôt valide : le jeton suivant (`DS:807a`) se met en marche vers la rangée (`SCRB 10019 + r`, animation de 7 à 36 images, longueur croissante avec la rangée), le Zoombini monte sur le crapaud, le nénuphar de départ devient occupé, `10f0:0000` pré-calcule le chemin, et le crapaud **se met à sauter seul** (§2.4). Le joueur peut en lancer d'autres pendant que les premiers sautent.
3. **Niveaux 2 à 4** : prendre la **fée** et **échanger deux nénuphars libres** (§2.6) pour réparer les chemins coupés.
4. Quitter : bouton « carte » (abandon) ou bouton « suite » (voir §4.4).

### 2.3 Génération de l'étang (`10f8:5f02`, `5c1e`, `484e` ; **sûr**, relu sur le décompilé et validé par simulation)

Les gabarits `REGS 15000`, `15001`, `15002` sont trois grilles 12 × 12 de mots (rangée par rangée, 12 mots par rangée) : table 0 = identifiants `1` à `3` (caractéristique A), table 1 = `4` à `7` (B), table 2 = `8` à `12` (C), `0` = case libre. **Chaque identifiant dessine un chemin** : vérifié sur les 12 identifiants (test `lilly.test.ts`), chacun a une composante connexe (4 voisins) de 13 à 23 cases qui joint la colonne 0 à la colonne 11, au sein de 21 à 36 cases au total (le reste sont des cases leurres). Les tables sont denses : presque toutes les cases ont un identifiant dans chacune des trois tables.

Algorithme, **dans l'ordre des tirages de l'original** (l'étude d'origine l'avait dans un autre ordre) :

1. **Niveaux 3 et 4** (internes 2 et 3) : le gabarit à tourner (`DS:82ce` = 3, 4 ou 5) : `rand(3..5)` (niveau 3) ou `rand(4..5)` (niveau 4) quand `⌊(N + 1) / 2⌋ < 8` (N ≤ 14), sinon le gabarit B sans tirage. Il subit aussitôt une **rotation de 90°** (`10f8:69f5` mode 0 : `nouveau[j][11 − i] = ancien[i][j]`) : ses chemins vont désormais de **haut en bas**.
2. **Symétrie** `rand(0..2)` (une fois pour les trois gabarits) : 0 -> chacun tourne de 180° (`69f5` mode 1) ; 1 -> chacun est retourné (`10f8:6b7d`), avec un tirage `rand(0..1)` par gabarit dans l'ordre A, B, C : 0 inverse les colonnes, 1 les rangées ; 2 -> rien.
3. **Identifiants coupables** (`DS2:2616`) : `K` tirages sans remise dans 1..12 (`rand(1..m)` sur la liste restante, `m` de 12 à 13 − K) ; `K = 12 − ⌊(N + 1) / 2⌋` au niveau 1 (`DS2:25bc`), 12 aux autres niveaux.
4. **Attribution des tatouages** (`10f8:5c1e`) : pour les identifiants 1 à 12 dans l'ordre, un tirage `rand(0..taille − 1)` dans le sac (permutation sans remise) de leur kind (3, 4 ou 5 tatouages). On obtient `id -> (kind, valeur, tatouage)`.
5. **Case par case**, rangée par rangée (`row`), colonne par colonne (`col`), pour chacun des 3 gabarits (A, B, C) : soit `a` l'identifiant du gabarit (0 = libre) et `a'` le suivant dans le même kind avec bouclage (3 -> 1, 7 -> 4, 12 -> 8 ; `a' = a` pour le gabarit tourné). **Coupure** quand, dans cet ordre d'évaluation, `a ≠ 0`, `row ≥ 2`, `col ≥ 2` (`DS2:25e6` = 0, 0, 2, 3 … : les deux premières rangées et colonnes ne sont jamais touchées), `a` est coupable, `a` a eu moins de 2 coupures (`DS2:25fe`) et (`rand(0..100) > 75` **ou** (`row = 11` et aucune coupure encore pour `a`)) : le compteur de coupures de `a` et le total `c` montent d'un (même pour le gabarit tourné, qui n'est donc jamais changé) et la case prend `a'`. Puis la caractéristique de l'identifiant retenu est posée sur la case. Aux niveaux 3 et 4, les premières cases de la **rangée 0** (par colonne croissante) dont l'identifiant appartient au gabarit tourné deviennent les points d'entrée des grenouilles (2 au niveau 3, 3 au niveau 4 ; jamais touchées par une coupure car `row < 2`). Après les trois gabarits, chaque caractéristique que personne n'a fixée est tirée : A `rand(0..2)`, puis B `rand(0..3)`, puis C `rand(0..4)`.
6. Coordonnées et motif (§2.1, `motif = DS2:25a8[C] + A`), occupation à 0.
7. **Niveaux 2 à 4 : deux échanges fixes** (`10f8:5831` appelé deux fois avec les coordonnées de `DS2:2484` à `2494`) : `(col 4, rangée 4)` <-> `(col 3, rangée 6)`, puis `(col 8, rangée 3)` <-> `(col 10, rangée 5)`. (L'étude d'origine ne les voyait pas.)
8. **Budget de la fée** `DS:7bd2 = ⌈(c + 5) / 6⌉` (§2.6). Ensuite, `10f8:0000` crée les jetons puis les 12 crapauds (`10f8:484e` : §2.1).

**Vérification par simulation** (port TypeScript de ce qui précède, `lilly.ts`, 200 graines par cas) : niveau 1 -> N = 16 : 8 à 12 tatouages sur 12 ont un chemin intact (minimum 8 = `⌊(16 + 1) / 2⌋`), N = 8 : minimum 4, N = 3 : minimum 2, N = 1 : minimum 1 ; niveau 2 -> 0 à 7 chemins intacts (moyenne 2,1), 23,6 coupures en moyenne ; niveau 3 : 0 à 4 (1,4) ; niveau 4 : 0 à 5 (1,5) ; les tatouages du kind tourné ne passent jamais (0 sur 300 graines). Le nombre garanti de chemins intacts au niveau 1 est `DS2:25bc[N]` = `⌊(N + 1) / 2⌋` (table 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, …, 10, 10 pour N = 0 à 20) : plus le groupe est petit, plus il y a de coupures (**sûr**).

### 2.4 Déplacement d'un crapaud (`10f8:41ec`, `10f0:0000`, `051a`, `086f` ; **sûr**, relu et vérifié par simulation)

État du crapaud : position `(col, row)`, cap `h` (0 haut, 1 droite, 2 bas, 3 gauche ; 1 au départ et après chaque arrivée), matrice de **compteurs** 12 × 12 (à l'offset `+0xf2` de la donnée, 0 = jamais visité), tatouage `(k, v)`.

**Un pas** (`41ec`, appelé 30 ticks après le début du saut précédent) :

1. Si le compteur `n` de la case courante est ≥ 10 000, toute la matrice est remise à 0 puis la case courante vaut 1 ; s'il vaut 0, il devient 1.
2. On examine **les 4 sens dans l'ordre `h`, `h + 1`, `h + 2`, `h + 3`** (modulo 4) depuis la case courante. Un voisin est **candidat** s'il est dans l'étang (**haut, bas et gauche sont des murs**), **libre** (`+8 = 0`), de la bonne caractéristique, et si son compteur est **strictement inférieur** au meilleur trouvé jusque-là (départ : `n`). À égalité, **le premier** reste. Le candidat retenu reçoit le compteur `n + 1` (même s'il était plus petit), est marqué occupé, et le cap devient la direction du saut. Scripts de saut : `SCRB 10001` (haut), `10002` (droite), `10003` (bas), `10004` (gauche) ; les variantes `10005` à `10016` ne sont jamais choisies.
3. **Sortie** : le sens « droite » depuis la colonne 11 ne désigne pas un voisin : il fait sortir le crapaud, et **abandonne les candidats déjà trouvés dans ce pas** (l'étude d'origine disait « si le cap est droite »). Si la case d'abordage de la rangée (`+8` de la 13e colonne) est libre, il la prend (renvoie `0x272f` = 10 031 ; l'arrivée est `SCRB 10031 + row`), sinon il **attend**. Depuis la colonne 11, la sortie est toujours examinée au plus tard au 4e sens.
4. Aucun candidat : le pas renvoie 0, le crapaud ne bouge pas et réessaie au tour suivant.

**Conséquence (élucidé, point ouvert 1 de l'étude d'origine)** : comme le nouveau compteur est toujours `n + 1`, les compteurs sont des **heures de dernier passage** (+ 1 par pas) ; la règle « voisin libre au compteur strictement plus petit, le premier en cas d'égalité » est le parcours « le moins récemment visité d'abord » (*vertex ant walk*), qui couvre toute composante connexe finie. Les cases jamais visitées (0) passent donc avant les autres, puis le retour se fait par la case la moins récemment visitée. L'étude d'origine disait déjà « les cases jamais visitées d'abord, sinon la moins visitée » : la nuance est que le compteur est un temps, pas un nombre de visites. Après un échange ou une grenouille qui bloque, le crapaud repart de ses compteurs.

**Pré-calcul `10f0:0000`** (au dépôt, et après un échange qui touche une case de son tatouage), lu en entier : il efface la matrice, pose `+0xd6 = 11` (cible : colonne 11), `+0xd7 = 1` et la case la plus à gauche `(+0xc7, +0xc8)` = la case de départ ; puis deux marches `051a` et une passe `086f`, puis le compteur de la case de départ vaut `+0xd7`.

- `051a(cible)` (orientation 0) : simule jusqu'à 200 pas du même parcours, **sans tenir compte de l'occupation**, en partant de la case courante (première marche) puis de la case la plus à gauche (marches suivantes si la cible n'est plus 11). Elle mémorise la colonne la plus à droite atteinte (le sens « droite » depuis la colonne 11 la porte à 11) et s'arrête quand elle atteint la cible. À la fin, `+0xd6` = colonne la plus à droite atteinte, `+0xd7` = dernier compteur.
- `086f(cible)` : remonte depuis la case de départ en suivant les compteurs **croissants** (le plus grand voisin supérieur au dernier choisi) et **efface** la piste (compteurs à 0), de sorte que le crapaud préfère ensuite cette piste aux impasses explorées, qui gardent leur compteur.
- Effet vérifié : `+0xd6 == 11` **si et seulement si** un chemin existe (0 écart sur 21 600 dépôts), et la traversée prend en moyenne 17 tours pour un plus court chemin d'environ 12 cases.

Cadence : après l'événement 10 du saut (début), le prochain pas est planifié **30 ticks** (0x1e, 510 ms) plus tard (`10f8:20bc` cas 10). L'événement 11 met à jour la position, l'événement 12 libère la case quittée. Les pas des crapauds ne sont traités qu'un tour de Tick sur deux (parité `DS:852e`) et pas du tout pendant un échange de la fée (`DS:82ec = 1`).

**Pas d'état d'échec** : un crapaud qui n'a pas de chemin parcourt sans fin son impasse (remise à 0 à 10 000). `10f8:7866` ne s'exécute qu'une fois la fée épuisée et tous les jetons lancés (§2.5).

### 2.5 Réussite d'un Zoombini (**sûr**)

Événement 30 (octet `0x1f`) du script `SCRB 10031 + r` (arrivée à la berge droite, 21 à 25 images, sons 10003, 10006, 10005, événement 204 en cours de route) → `10f8:3c03` :

- compteur d'arrivées `DS:7bca += 1` ; à la **première** (`7bca == 1`), `DS:82f4 = 1` : le bouton « suite » devient actif ;
- le pré-calcul du crapaud est annulé (`+0x106 = 0`), son étape de sortie monte (`+0x10b += 1`) et **la case où il se trouve (colonne 11) est libérée** ; le crapaud est mis en file pour jouer sa sortie. **Sorties et réutilisation (H5, lu sur `10f8:3c03`, `0bd7`, `2f64`, `3b23`, `3614`, tranché)** : `+0x10b` compte les arrivées du crapaud et n'est jamais remis à 0. À la **première** arrivée (`+0x10b == 1`) l'objet est mis en file `DS2:03e4` : `10f8:0bd7` lui fait jouer **`SCRB 10057`** (sortie par le haut de la berge droite, 10 images ; événement 44 sur la dernière : case d'abordage libérée par `10f8:2f64`, objet mis en file `DS2:0462`) puis une **scène de berge** `10060 + 2 × rand(0..2)` (kind C : `+ 1`, 37 à 56 images) et enfin **`SCRB 10058`** (retour le long de la berge gauche, 10 images, rappel `10f8:3b23`) ; l'événement 49 de `10058` (dernière image) met **`+0xc2` (drapeau « sur l'étang ») à 0**, replace le crapaud à sa position de repos `DS2:23e8` et relance `SCRB 10043 + i` : **le crapaud peut être redéposé**. À la **deuxième** arrivée (`+0x10b == 2`) l'objet est mis en file `DS2:040e` et joue **`SCRB 10059`** ; son événement 54 (dernière image, rappel `10f8:3614`) libère la case d'abordage, **retire le crapaud de la liste `DS:7cf2`** et la Tick suivante appelle `11a8:20e8` (destruction de l'objet) : **il disparaît**. Chaque crapaud fait donc **deux traversées au plus** : 12 crapauds = 24 traversées, pour 16 Zoombinis au plus (un seul crapaud ne suffit pas pour tout le groupe). Les files de sortie sont séquentielles : `DS:7c6e` (première traversée) et `DS:7c70` (deuxième) tiennent l'objet qui joue sa sortie. Les événements sont comptés « octet bas du terminateur − 1 » : 10057 : image 9 = octet 45 = événement 44 ; 10058 : octet 50 = événement 49 ; 10059 : octet 55 = événement 54 (et non l'image 1, dont l'octet 54 donne l'événement 53, sans rappel). Le module `lilly.ts` : `Toad.retired`, `arrive` ; le robot en tient compte (`planLilly` simule la partie sur une copie et reprend un crapaud au plus deux fois) ;
- l'**octet de survie `+0x127` de l'objet Zoombini correspondant est mis à 1** ; `DS:8078 += 1` (réussites) ;
- le Zoombini est montré sur la berge droite par `SCRB 10129 + r` (marche vers sa place, 5 à 29 images selon la rangée), puis une animation d'attente tirée parmi `10141` à `10165` ;
- quand `DS:8078 == DS:8076` (tous passés), une voix est tirée dans les ids `20055` à `20063` (`0x4e57`..`0x4e5f`).

La case d'abordage libre (`+8` de la colonne 12) est remise à 0 par l'événement 59 (`0x3b`+1, `10f8:30ba`) quand le Zoombini a quitté la berge : **un seul Zoombini à la fois par rangée de berge droite**.

**Échec** : tout Zoombini dont le crapaud n'est pas arrivé à la sortie de l'écran garde `+0x127 = 0` (remis à 0 à l'entrée par `1168:3dd0(0, 0)`) : il est **perdu** (screens.md §3.4). Il n'y a **aucun décompte d'erreurs** : on peut en perdre autant qu'on veut, et même tous sauf un (le bouton « suite » exige une seule arrivée). **Zoombinis renvoyés au camp** : les perdus partent à l'arrêt de l'étape (étape 2 : réserve du camp 1).

Cas spécial `10f8:7866` : appelée quand la fée est épuisée (`7bd0 == 6`) et que tous les jetons sont lancés (ou quand le dernier jeton est lancé alors que la fée est épuisée) : parcourt les crapauds de la liste `DS:7cf2` encore sur l'étang (`+0xf2 ≠ 0`) dont le pré-calcul atteint la colonne 11 (`+0x106 == 11`, donc **pas encore arrivés** : l'étude d'origine lisait `+0x106` comme un état « arrivé ») et marque leur Zoombini sauvé (`+0x127 = 1`) sans attendre leur arrivée ; si le total reste `< N`, tire `rand(0..4)` et, si `niveau - 1 < tirage` **ou** si le compteur de visites de l'épreuve (`S+0x34 & 0xfff`) est `< 4`, joue une voix `rand(0x4e4d..0x4e50)` = ids 20045 à 20048.

### 2.6 La fée : échange de deux nénuphars (niveaux 2 à 4 ; `10f8:6cdf`, `5831` ; **sûr**)

- **Prendre la fée** : la cliquer (objet de type 2) ; elle suit la souris. Le jeu est **figé** (`82ec = 1`, plus aucun saut) dès que le premier nénuphar est choisi.
- **Choisir** : cliquer deux nénuphars **libres** (`+8 = 0`) de l'étang. 1er choix → `82e4` passe de 4 à 5, halo (`SCRB`/objet `DS:82ca`), son `12000 + (compteur mod 4)` (`DS:14f2`) ; 2e choix → `82e4 = 6`, halo (`82cc`), même son. La zone valide est le **trapèze de l'étang** (rectangle `DS2:2498` = (83, 62)-(556, 430), avec deux bords obliques : `|y - 430| < (x - 509) × 0,54` côté droit, `y - 62 < |123 - x| × 0,54` côté gauche) ; cliquer hors zone **annule** (la fée revient en (38, 415), `82ec = 0`).
- **Échange** (`10f8:5831`, appelé aussi deux fois à la génération, §2.3) : les 4 octets `A, B, C, motif` des deux nénuphars sont **permutés** ; les compteurs de visites des deux cases sont remis à 0 chez les crapauds de la liste `DS:7cf2` encore sur l'étang, et tout crapaud de cette liste dont un des deux nénuphars **correspond maintenant à son tatouage** est **re-calculé** (`10f0:0000`) ; de même pour chaque grenouille vivante : si un des deux nénuphars correspond à sa valeur, le champ de distance de cette valeur est recalculé (`10f0:00e5`, §2.7). Même nénuphar deux fois : rien ne change et rien n'est compté. La baguette doit être prête (`DS:7bd0 < 6`, condition du choix).
- **Budget d'échanges** : `DS:7bd2 = q + (6q < c + 5 ? 1 : 0)` avec `q = ⌊(c + 5) / 6⌋`, soit `⌈(c + 5) / 6⌉`, où **`c` est le nombre total de coupures** de la génération (23,6 en moyenne aux niveaux 2 à 4, au plus 24). La jauge `DS:7bd0` (0 à 6) monte d'un cran à chaque `7bd2` échanges **entre deux nénuphars différents** (`DS:7bd4` les compte, au deuxième choix, avant l'échange lui-même) ; à 6, la fée est **épuisée** (plus de choix possible) et, si tous les jetons sont lancés, `10f8:7866` s'exécute **avant** que ce dernier échange ne soit appliqué. Budget total `6 × 7bd2 ≥ c + 5`, au plus 30. Jauge : script `SCRB 10078 + g` (10078 plein à 10084 vide, 7 états).
- La fée se pose à son départ (`SCRB 11000`, 70 images, sons 11000 puis 11001, 6,8 s et 0,3 s).

### 2.7 Grenouilles (niveaux 3 et 4 ; `10f8:4a84`, `10f8:0bd7`, `10f0:1207`, `10f0:14cb`, `10f0:00e5`, `10f0:0321`, `10f8:2509` ; **sûr** sur le code, une particularité à confirmer en jeu)

Étude d'origine entièrement revue (points ouverts 4 et 1 sur les grenouilles).

- **Gabarit tourné et points d'entrée** : voir §2.3 (étapes 1 et 5). La **caractéristique des grenouilles** (kind) est celle du gabarit tourné (`DS:7c76`, kind du premier point d'entrée), A, B ou C selon `DS:82ce` = 3, 4 ou 5. Une grenouille n'a donc de tatouage que de ce kind : la **valeur** est celle du nénuphar où elle naît (ou où elle se pose, voir la variante), numéro de tatouage = base du kind + valeur. Les crapauds de ce kind n'ont aucun chemin gauche-droite (0 sur 300 graines) ; les deux autres kinds restent horizontaux.
- **Cadence et création** (`10f8:0bd7`, un tour de Tick sur deux, niveaux 3 et 4, `DS:9702 < 1`) : `DS:808a` vaut « entrée + 600 ticks » (10,2 s) puis « création + 480 ticks » (8,2 s). À l'échéance, si moins de 20 grenouilles **vivantes** (`DS:8074`, décrémenté à leur sortie par l'événement 80, `10f8:2509`), on prend le point d'entrée courant `DS:8072` ; **dans tous les cas** le point suivant devient courant (bouclage sur 2 ou 3 points) :
  - case d'entrée **libre** : **grenouille ordinaire** (`+0x62 = 0`, orientation 1) : la case devient occupée, `DS:21e6[col] = 1` (« une grenouille est déjà venue ici »), la valeur est celle du nénuphar, son pré-calcul `10f0:0000` ne sert pas aux grenouilles ;
  - case d'entrée **occupée**, par quoi que ce soit, **et** `DS:21e6[col] = 1` : **variante** (`+0x62 = 1`, objet superposé à l'autre) ;
  - sinon rien, et `DS:808a` n'est pas avancé.
  `DS:9702` est remis à 1 au dernier jeton lancé et décrémenté (plancher 0) par chaque événement 1 de la jauge de la baguette (`10078+`) : **hypothèse** qu'après le dernier jeton, un cran de la jauge réarme les grenouilles (le module `lilly.ts` ne les crée plus quand tous les jetons sont lancés).
- **Pas d'une grenouille ordinaire** (`10f0:1207`, toutes les 35 ticks) : sens **fixes** haut, droite, bas, gauche (pas de cap) ; elle va sur le **premier** voisin libre, de sa valeur, dont le **champ de distance** est strictement plus petit que celui de sa case ; depuis la rangée 11, le sens « bas » la fait **sortir** (script `10069`, case libérée à l'événement 80). La case quittée est libérée au milieu du saut (`10f8:267b` cas 6, événement 12).
- **Champ de distance** (`10f0:00e5`, `0321`, tables `DS2:0xe18` + 0x3f6 × valeur) : de la rangée 11 à la rangée 0, chaque nénuphar de la valeur pas encore atteint reçoit la distance 1, puis un parcours en largeur à 4 voisins étend le champ (distance + 1) ; chaque composante est donc mesurée depuis **sa propre rangée la plus basse**. **Particularité (lue sur le code, à confirmer en jeu)** : la seule instruction qui appelle `00e5` est dans `10f8:5831` (échange de la fée), pour une valeur de grenouille vivante dont un des deux nénuphars échangés correspond ; les tables sont à 0 à l'initialisation (`DS2` lu dans l'exécutable). **Tant qu'aucun échange n'a touché la valeur d'une grenouille, son champ est nul partout et elle ne bouge pas** (hors sortie depuis la rangée 11). Les grenouilles sont donc immobiles tant que le joueur n'a pas utilisé la fée sur leur valeur, et seules les variantes (ci-dessous) descendent d'elles-mêmes.
- **Variante** (`10f0:14cb`, `+0x62 = 1`) : descend d'**une rangée par pas, tout droit, même sur un nénuphar occupé** ; si la case du dessous est libre elle **adopte** sa valeur (`+0x64 = 1`) ; au pas suivant elle devient une grenouille ordinaire (`+0x62 = 0`). Elle ne libère pas la case qu'elle quitte tant qu'elle est variante (`10f8:267b` cas 6 : `+0x62 = 0` requis). Elle sort par le bas comme l'ordinaire.
- **Effet sur le jeu** : une grenouille **occupe** (`+8 = 1`) les nénuphars où elle se trouve : un crapaud ne peut pas y sauter (il attend). Elle ne tue pas et n'enlève rien : aucun test de collision avec un jeton ou un Zoombini dans `10f8:0bd7`, `1207`, `14cb` ni dans le rappel d'événements `10f8:2509` (**sûr**). Les nénuphars occupés ne peuvent pas être échangés.

## 3. Les 4 niveaux (`DS:1396` = niveau interne + 1, `1168:515d` ; **sûr**)

Le niveau est celui de l'étape 2 (`S+0xC4`) en aventure, 1 à 4 en entraînement (screens.md §1.6).

| | Niveau 1 | Niveau 2 | Niveau 3 | Niveau 4 |
|---|---|---|---|---|
| `DS:1396` | 1 | 2 | 3 | 4 |
| `47e8` : `DS:7bce` / `DS:8086` | 0 / 0 | 4 / 0 | 5 / 2 | 6 / 3 |
| Fée | **non** (`DS:82e4 = 0`) | oui | oui | oui |
| Identifiants coupables (`K`) | `12 - ⌊(N + 1) / 2⌋` | 12 (tous) | 12 | 12 |
| Gabarit tourné à 90° (`DS:82ce`) | aucun (0) | aucun | tirage dans {3, 4, 5} (A, B ou C) si N ≤ 14, sinon 4 (B) | tirage dans {4, 5} (B ou C) si N ≤ 14, sinon 4 (B) |
| Points d'entrée de grenouilles | 0 | 0 | 2 | 3 |
| Échanges fixes à la génération | non | oui (2) | oui (2) | oui (2) |
| Voix d'accueil (`DS:a2c4`) | 20075 (`0x4e6b`) | tirage 20075 à 20077 | idem | idem |
| Jingle d'entrée | 997 à l'entrée | non | non | non |
| Zoombinis lancés | tous les jetons, même règle | idem | idem | idem |

(`DS:7bce` et `DS:7bcc` sont écrites mais jamais relues : **sûr**.)

Détails : (1) la voix d'accueil dépend de `1168:5c57(S+0x34)` : 5 en entraînement ; en aventure, 1 au niveau 1 ; au niveau 2, 2 la première fois (drapeau `0x1000` de `S+0x34`), 12 la deuxième (drapeau `0x2000`), 0 ensuite. `Enter` tire la voix dans 20076-20077 si le code vaut 2, sinon prend 20075 au niveau 1 ou tire dans 20075-20077 aux niveaux 2 à 4. (2) **Ouverture (point ouvert 3 de l'étude d'origine, élucidé)** : dans la boucle de création des jetons, les deux derniers (indices `N - 2` et `N - 1`) reçoivent `DS:9702 = N - i` (donc 1 à la fin) et, **au niveau 1 seulement**, un script d'entrée en file (`SCRB 10089` à `10108`, voir §5.1) dont l'événement 1 décrémente `DS:9702` (`10f8:3f4f`) ; aux niveaux 2 à 4 c'est l'animation initiale de la jauge de la baguette (`10078`, événement 1) qui le fait. `DS:9702 ≥ 1` ne laisse alors passer que la fée (`10f8:1b3a`) : c'est un **verrou de mise en scène** tant que l'introduction joue, sans effet sur les règles (`lilly.ts` ne le modélise pas ; la scène doit l'attendre avant d'accepter un dépôt). (3) Les valeurs `rand(0, 100) > 75`, 2 coupures par identifiant, `r ≥ 2` et `c ≥ 2` sont les mêmes à tous les niveaux.

**Sur le « difficile »** : au niveau 1 on **sélectionne** le crapaud qui passe ; aux niveaux 2 à 4 peu de tatouages passent (en moyenne 2 sur 12, parfois aucun), il faut **repérer la coupure** et **échanger** deux nénuphars (budget limité) ; aux niveaux 3-4 il faut en plus tenir compte des grenouilles qui occupent des cases.

## 4. Déroulé et état

### 4.1 Variables de l'écran (DS, **sûr** sauf mention)

| DS | Nom | Rôle |
|---|---|---|
| `1396` | niveau | niveau + 1 (1 à 4) |
| `8076` | `N` | Zoombinis du groupe |
| `8090` | | nombre de crapauds, 12 |
| `807a` | lancés | jetons déjà utilisés (indice du prochain) |
| `8078` | réussites | Zoombinis passés (événement 30) |
| `7bca` | arrivées | compte les arrivées ; le 1er pose `82f4` |
| `82f4` | suite | 1 = bouton « suite » actif |
| `9702` | occupé | 0 : crapauds déplaçables ; ≥ 1 : seule la fée (voir ci-dessous) ; **hypothèse** pour le sens précis |
| `9704` | abandon | 1 = quitter par le bouton « carte » |
| `8556` | écran suivant | 0 = rester ; 1 = carte ; 12 = fosse de monte-pierre (`SLIDES`) |
| `82e4` | fée | 0 = pas de fée (niveau 1) ; 4 = prête ; 5 = 1er nénuphar choisi ; 6 = 2e choisi |
| `82ec` | échange | 1 = échange en cours (**tous les sauts gelés**) |
| `82d4`, `82d6` / `82d8`, `82da` | 1er / 2e nénuphar | (colonne, rangée) |
| `7bd0`, `7bd2`, `7bd4` | jauge, budget par cran, échanges du cran | §2.6 |
| `82d0`, `82d2` | survol | colonne (0) et rangée survolée du dépôt, −1 = aucune |
| `82e6` | rangée de dépôt | résultat du glisser (−1 : rien) |
| `8546` | glisser | 1 = crapaud tenu, 4 = fée tenue, 2/3 = relâché (voir ci-dessous) |
| `82ce` | gabarit tourné | 0, 3, 4 ou 5 |
| `8086`, `8072`, `8074`, `808a` | grenouilles | nombre de points d'entrée, prochain point, nombre créées, prochaine échéance (tick) |
| `852e` | parité | alterne à chaque tour : pas des crapauds / pas des grenouilles |
| `a2c4` | voix d'accueil | rejouable par la touche (§4.5) |

`DS:9702` : vaut 1 après l'entrée (N ≥ 2), mis à 1 quand le dernier jeton est lancé, décrémenté (plancher 0) par l'événement 1 de certains scripts (fin des animations d'introduction `10089` à `10108`, jauge de baguette `10078` à `10084`) ; tant qu'il est ≥ 1, `10f8:1b3a` n'accepte que la fée ; les grenouilles ne se créent que s'il est 0.

### 4.2 Tick (`10f8:0bd7`, **sûr** pour la structure)

Garde de réentrance `DS:1472` ; sort immédiatement si l'écran n'est pas initialisé. Si une sortie est demandée (`8556 ≠ 0`) : attend la fin du jingle de sortie (`1028:0d9e(0x4e44, 0x53, 0x3e4)` ≠ 0 → on reste), puis, si la boîte du menu n'est pas ouverte (`a2de` = 0 ou 3, éventuellement après `1168:3dd0(0, 0)` si `a2de == 3`) et que (`a406 ≠ 0` ou `9702 == 0` ou `9704 > 0`), copie `8554 = 8556`, `8556 = 0`, ferme l'archive par `11b8:0011` et appelle Exit. Sinon, chaque tour :

1. `11a8:04b9` (avance les animations, déclenche les rappels d'événements) ;
2. dépile les **files d'événements** remplies par les rappels (tableaux `DS2:03e4`, `0438`, `0462`, `040e`, `04b6`, `04e0`, `0390`/`03ba`, `002a`/`026e`, `050a`) : lance les scripts suivants des crapauds (départ de saut, sortie, retour à la berge), les jetons, les décors ;
3. si l'échange n'est pas en cours (`82ec == 0`), un tour sur deux (`852e`) : **pas des crapauds** (`41ec`) ; l'autre tour : **grenouilles** (niveaux 3 et 4 : création toutes les 480 ticks, puis pas) ;
4. `1108:035b` (menu, aide du moteur).

### 4.3 Machine à états

- **Crapaud** : à la berge (script `10043 + i`, `+0xf2 = 0`) → **déposé** (`+0xf2 = 1`, pré-calcul, jeton monté) → **saute** (cases successives, cap `+0xd5`) → **abordé** (case d'abordage prise, script `10031 + r`) → événement 30 : **arrivé** (`10f8:3c03`) → **sortie** (`10057`, `10059`, `+0x10b` = 1 puis 2 ; événement 54 : sortie de la liste `DS:7cf2`) → script de retour `10043 + i`. Un crapaud sans chemin reste dans l'état « saute » et erre. (`+0x106` n'est pas un état : c'est la colonne cible du pré-calcul, 11 si un chemin existe, 0 après l'arrivée. Dans `lilly.ts` : `Toad.active`, `landed`, `target`.)
- **Glisser** (`6cdf`, `8546`) : 1/4 = tenu ; la boucle lit la souris (`GetCursorPos`) et le bouton ; bouton relâché → état 2 ou 3 : évaluation du dépôt (`bVar3`) ; la boucle ne rend la main qu'au relâchement. **Détail du protocole clic-clic / glisser (`1168:58c7`, `DS:2398`) non relevé.**
- **Fée** : 4 (repos) → 5 (1er nénuphar) → 6 (2e nénuphar, animation de halo `5743` sur 5 images puis échange) → 4.
- **Écran** : jeu → (bouton « suite » ou « carte ») → attente du jingle → Exit.

### 4.4 Interactions et zones cliquables (**sûr**)

Régions déclarées par `1038:0000` (callback `10f8:1b3a(n)`) :

| n | Région | Effet |
|---|---|---|
| 1 | **bouton « carte »** (600, 403)-(639, 440), image 5 de `tBMP` 7000 (pressé : 6) | joue 999, `8556 = 1`, `9704 = 1`, abandon (`11a0:16da` : confirmation générale) |
| 2 | **bouton « suite »** (600, 441)-(639, 478), image 2 (pressé : 3 ; **inactif : image 1, tant que `82f4 = 0`**) | joue 996, `8556 = 12`, `9702 = 0`, `82ec = 0` ; **sans effet** si aucun Zoombini n'est arrivé |
| 3 | tout le **terrain** | clic sur un objet : crapaud (type 0) ou fée (type 2) → `6cdf` ; hors-sujet sinon |

Le clic n'est accepté que si `82ec == 0`, si l'objet n'est pas déjà actif (`+0xf2 == 0`) et si `(9702 < 1)` ou si l'objet est la fée. Dépôt : voir §2.2 ; zones de dépôt `DS2:241c` (12 rectangles de 34 × 28 autour du départ de chaque rangée) = (134, 65, 168, 93), (131, 94, 165, 122), (129, 122, 163, 150), (127, 152, 161, 180), (124, 181, 158, 209), (117, 210, 151, 238), (113, 239, 147, 267), (109, 268, 143, 296), (100, 297, 134, 331), (93, 326, 127, 354), (91, 355, 125, 383), (88, 384, 120, **532**) (le dernier a un bas à 532, 120 pixels trop bas : **probable** erreur de donnée, sans effet visible car au-delà de l'étang). Curseur de jeu : le glisser masque le curseur (`11e8:8d20`) si `DS:a43d` le permet.

### 4.5 Clavier

`10f8:41be(touche)` ne traite que le code `0x016f` : il appelle `11a0:155e` (rejoue la voix d'accueil `DS:a2c4`, ou l'interrompt si elle joue). Autres touches : raccourcis généraux (engine.md §7.2). Quelle touche produit `0x016f` n'est pas établi (§7).

## 5. Animations et sons

### 5.1 Scripts `SCRB` (groupe 2 sauf mention) (**sûr** pour les ids et le nombre d'images, **probable** pour les rôles)

| Ids | Images | Rôle |
|---|---|---|
| 10000 | 3 | crapaud sur la berge tendu (son 10008) |
| 10001 à 10004 | 8 | **saut** d'un crapaud : haut, droite, bas, gauche (événements 10 à 14, sons 10003 et 10007) |
| 10005 à 10016 | 4 | sauts avec virage, jamais choisis par `41ec` (événement 15) |
| 10017, 10018 | 4 | décor tournant |
| 10019 à 10030 | 7 à 36 | **jeton qui marche jusqu'au crapaud de la rangée** `r = id - 10019` (`+r` : le nombre d'images croît avec la rangée ; événements 25 à 27) |
| 10031 à 10042 | 21 à 25 | **arrivée** à la berge droite de la rangée `id - 10031` (sons 10003, 10006, 10005 ; événements 204 puis 30) |
| 10043 à 10054 | 2 | crapaud **au repos** sur la berge gauche, rangée `id - 10043` |
| 10055, 10056 | 2, 1 | décor |
| 10057, 10058, 10059 | 10 | sortie de crapaud (3 variantes ; événements 43-53, sons 10004, 10006, 10011) |
| 10060 à 10065 | 37 à 56 | grandes scènes de berge à droite (événement 60 : `30ba`, sons 10002, 10004, 10009 à 10011) |
| 10066 à 10077 | 2 à 10 | **grenouilles** : repos (10066, 10068, 10070, 10072, 10074, 10076), arrivée 10067, sortie 10069, sauts 10071 / 10073 / 10075 / 10077 (événements 71 à 74, son 10001) |
| 10078 à 10084 | 2 | **jauge** de la baguette (7 états) |
| 10085 à 10088 | 7 | clignotements des 4 jetons de tête |
| 10089 à 10108 | 29 à 42 | **jetons qui entrent** en file (un par place, événement 1 à la fin) |
| 10109 à 10128 | 6 | **jetons de la file**, 20 places (événement 2) |
| 10129 à 10140 | 5 à 29 | Zoombini **qui débarque** à droite par rangée (événement 3) |
| 10141 à 10165 | 5 à 9 | attente à droite (événements 4, 5) |
| 10166 à 10168 | 1 à 2 | décor (10169 : script de 8 images mal terminé, non chargé) |
| `SCRB 11000` (groupe 0) | 70 | **fée** (sons 11000 puis 11001) |
| `SCRB 14000` à `14004` (groupe 1) | 1 | avant-plans des berges |

Délai entre images (paramètre de l'objet, `11a8:0ad6`) : 6 ticks (decor, curseur), 7 ticks (crapauds), 8 ticks (grenouilles) (**probable**).

### 5.2 Événements (numéro = octet bas du terminateur − 1 ; engine.md §3.2)

| Événement | Source | Effet (rappel `10f8:20bc`, `267b`, `3c03`, `3f4f`, `30ba`) |
|---|---|---|
| 10 | 10001-10004 | début de saut : cible = case suivante, `+0x24 = tick + 30`, mise en file du pas suivant |
| 11 | idem | fin de saut : la case précédente est libérée (`+8 = 0`) ; le cap met à jour la case `(c, r)` |
| 12 | idem | recale la position intermédiaire du saut |
| 13, 14 | idem | pose finale sur la case |
| 15 | 10005-10016 | planifie le pas suivant |
| 1 | 10078-10084, 10089-10108 | `3f4f` : `DS:82dc = 5`, `9702 -= 1` (min 0) |
| 2 | 10109-10128 | `3f4f` : jeton prêt (file `DS2:04b6`) |
| 3 | 10129-10140 | `3f4f` : file `DS2:04e0` |
| 25, 26 | 10019-10030 | arrivée du jeton au crapaud : mise en file de saut |
| 30 | 10031-10042 | **arrivée** : réussite du Zoombini (§2.5) |
| 35 | 10043-10054 | retour du crapaud à la berge |
| 60 | 10060-10065 | libère la case d'abordage (`30ba`) |
| 70 à 74, 80 | grenouilles | création, sauts, sortie |

### 5.3 Sons

`\0SND` de `LILLY.MHK` (PCM 8 bits, 11 025 Hz ; durées arrondies) : 10000 (1,25 s ; crapaud tendu, grenouille à l'arrivée), 10001 (0,37 s ; saut de grenouille), 10002 (0,20 s), 10003 (0,24 s ; saut de crapaud, arrivée), 10004 (0,46 s), 10005 (0,07 s ; arrivée), 10006 (0,10 s ; arrivée), 10007 (0,53 s ; saut), 10008 (0,52 s ; crapaud tendu), 10009 (1,31 s), 10010 (0,83 s), 10011 (1,20 s ; sorties) ; 11000 (6,8 s) et 11001 (0,28 s) : **fée** ; 12000 à 12003 (≈ 1 s) : **choix d'un nénuphar par la fée** (cycle `DS:14f2` mod 4). Aucun son n'est joué directement hors des scripts, sauf :

- `ZOOMBINI.MHK` : 997 (jingle d'entrée niveau 1), 996 (sortie par « suite »), 999 (sortie par « carte ») ; voix d'accueil 20075 à 20077 ; voix de réussite complète 20055 à 20063 ; voix de commentaire 20045 à 20048.

## 6. Tampon de partie

L'épreuve n'écrit **que** :
- `S+0x34` (compteur de visites, `1168:5c57`) : incrémenté à chaque entrée hors entraînement, plafonné à `0xfff` (12 bits bas) ; bits `0x1000` / `0x2000` : premières entrées à l'étape de niveau interne 1 ;
- l'octet **`+0x127` de chaque objet Zoombini** du groupe (hors tampon : champ de l'objet) : 1 pour chaque passé, 0 pour les autres.

À la sortie, le code générique (`11a8:021c` → `1168:36e1`, screens.md §3.4) fait le reste : bit `1 << niveau` dans l'octet `S+0x56 + (11 - 7) = S+0x5A` (réussite à ce niveau) ; bit `0x10 << niveau` si **aucun** Zoombini n'est perdu ; Zoombinis perdus (`+0x127 == 0`) rendus à la réserve du camp 1 (`S-0x5B9E`, `S+0x4A += perdus`). L'épreuve n'est **pas** la dernière de l'étape (c'est la fosse, écran 12) : ni monument, ni changement de niveau d'étape ici.

## 7. Points ouverts

Résolus par la relecture H5r : l'ancien point 1 (explorateur et pré-calcul `10f0:0000` / `051a` / `086f`, §2.4), l'ancien point 3 (ouverture du niveau 1, §3) et l'ancien point 4 (grenouilles : kind, valeur, collision, §2.7).

1. **Réutilisation d'un crapaud (tranché en H5, §2.5)** : `+0xf2` est posé au dépôt (`10f8:1b3a`) et exigé nul pour reprendre le crapaud (`10f8:1b3a`, `10f8:6cdf`) ; aucune instruction lue (décompilé, plages désassemblées `10f8:24e4`, `2b85`, `3600`, `3b0f`, `4005`, `46dd`) ne le remet à 0 pour un crapaud. L'événement 54 retire en outre le crapaud de la liste `DS:7cf2`. **Tranché en H5** : voir §2.5 (« Sorties et réutilisation ») : le drapeau est remis à 0 par l'événement 49 de `SCRB 10058` (`10f8:3b23`, plage `3b0f-3c02` que Ghidra n'avait pas décompilée) ; un crapaud ne fait que deux traversées (destruction à l'événement 54 de `10059`).
2. **Grenouilles immobiles avant l'échange** (§2.7) : champ de distance calculé seulement par `10f8:5831`. Lu sans ambiguïté (un seul appelant de `10f0:00e5`, tables nulles à l'initialisation) mais le comportement attendu est surprenant ; à confirmer en jeu. `lilly.ts` le reproduit.
3. **`DS:9702`** : sens exact après l'introduction (verrou d'entrée ; réarmé à 0 par la jauge de la baguette, donc les grenouilles pourraient repartir après le dernier jeton, voir §2.7) ; protocole du clic-clic / glisser de `1168:58c7` et rôle de `DS:2398`, `a1de`, `a43c`, `a43e`.
4. **`DS:7bce` et `DS:7bcc`** : écrites, jamais lues.
5. **Touche `0x016f`** : quelle entrée clavier la produit (probablement une touche de fonction du moteur) ; `1198:05b3`.
6. **Types d'objets `+0xf0`** (0 crapaud, 1 ?, 2 fée) : le type 1 n'est pas identifié (peut-être la fée épuisée).
7. **Rectangle de dépôt de la rangée 11** : `y2 = 532` (anormal).
8. **Sauts avec virage `10005`-`10016`** : tables `DS:1474`…`148c` lues par `41ec` seulement sur la diagonale ; les autres entrées sont atteintes ailleurs ou jamais.
9. **Exit** : `10f8:0b0f` appelle `11a8:021c` (appel générique de sortie d'épreuve) ; l'ordre exact avec l'écriture des marques de réussite est dans screens.md §3.4, non revu ici.
10. **Cadence** : délais d'images (6/7/8 ticks) lus à travers des arguments de `11a8:0ad6` que Ghidra a mal ordonnés ; à confirmer en jeu.
11. **Tirages du moteur entre `10f8:5f02` et `10f8:484e`** : la création des jetons passe par `11a8:0ad6` ; **probable** que ce constructeur ne tire rien (sinon l'ordre des tirages des crapauds serait décalé ; sans effet sur les propriétés).

## 8. Écran du port (tâche H5) : points tranchés et écarts

Écran : `src/games/zoombinis/scenes/puzzles/lilly.ts` (`createLillyScene`), tests `test/zoombinis/puzzles/lilly-scene.test.ts`. Ce qui suit complète les §2 à §5 (**sûr** : lu dans le code ou les données ; **probable** : lecture la plus défendable ; **écart** : choix du port).

**Tranché**
- **Deux traversées par crapaud** (§2.5) : la sortie, la scène de berge et le retour sont portés (10057, 10060 à 10065, 10058), puis 10059 et la disparition.
- **Cadence des sauts** : l'événement 10 est sur la **dernière** image (vide) de `10001` à `10004` ; il arme `+0x24 = maintenant + 30` ; le pas suivant a lieu au plus tôt 30 ticks **après la fin de l'animation du saut** (7 images de `rand(3..6)` ticks, soit 51 à 72 ticks par saut), et non 30 ticks après son début (§2.4 disait « après le début »). Les pas des crapauds et ceux des grenouilles alternent un tour sur deux (port : parité d'un compteur de ticks de l'écran).
- **Image vide** : une image sans case (dernières images des sauts, du jeton) laisse la précédente à l'écran (`Features`), donc le crapaud reste posé sur sa case après son saut.
- **Tatouage et passager d'un crapaud** (`10f0:0ac1`, rappel d'image) : la deuxième case est `67 / 79 / 91 / 103 + t` (haut, droite, bas, gauche ; `t` = numéro du tatouage) ; la troisième est le Zoombini porté, `120 / 125 / 130 / 175 / 180 + (cheveux − 1)` (octet `+0xe3` posé au dépôt par `10f8:1b3a` d'après le champ `+0x44` du jeton = `+0xbc` du Zoombini − 1). Les jetons (`10f8:3ea3`) ajoutent la même variante à leur première case. Grenouilles (`10f0:0c4f`) : la case 272 devient `272 + t` ; une variante n'a que sa première case. Toutes les cases passent par les ancres `REGS 10000` / `10001`.
- **Jeton et crapaud** (`10f0:1134`) : le jeton joue `10019 + rangée` (événement 26 sur la dernière image) ; le crapaud joue alors `SCRB 10000` (se tend, événement 20 : il entre dans la file des pas). `10f8:0bd7` ne relance le jeton (`10019 + rangée`) qu'à l'événement 2 de son animation de file (`10109 + i` : fin de la file). Les jetons restent à leur place de file jusqu'au dépôt (le port ne rejoue pas l'animation de file avant le départ).
- **Fée** : l'objet saisissable est la baguette-jauge `SCRB 10078 + g` (image 284 + g de la planche 10000, 31 × 32), de repos (38, 415) ; la fée de la berge est `SCRB 11000` (70 images, jouée à l'entrée, qui se pose en (39, 416)). Choisir un nénuphar : relâcher la baguette dessus (souris non aimantée) ou cliquer (aimantée) ; le choix suivant demande toujours un clic ; hors de l'étang le clic ramène la baguette. Halo d'un nénuphar : image `20 + 2 B + {0, 0, 1, 1}[cycle]` (`DS2:24b2`, `24c4`), cycle toutes les 10 ticks (le port ; l'original : `DS:14e6` toutes les `+0x28` du halo).
- **Verrou `DS:9702`** : posé à l'entrée ; niveau 1 : levé par l'événement 1 de la première animation d'entrée des deux derniers jetons (`10089 + i`) ; niveaux 2 à 4 : par l'événement 1 de `10078` (juste après l'entrée) ; remis à 0 par « suite ». Tant qu'il est posé : on ne prend pas de crapaud (la baguette si), les grenouilles ne naissent pas.

**Écarts du port (sans effet sur les règles)**
- Les scènes `10060` à `10065` sont jouées telles quelles sur le crapaud ; leurs événements (60 : `10f8:30ba`, sons) ne sont pas traités (la case d'abordage est libérée à l'événement 44 de `10057`, comme l'original ; la libération « événement 59 » de §2.5 n'est donc pas rejouée).
- Les animations d'attente à droite (`10141` à `10165`, événements 4, 5) et les clignotements des jetons de tête (`10085` à `10088`) ne sont pas portés : le Zoombini arrivé reste sur la dernière image de `10129 + rangée`.
- Pas de gestion des plans de profondeur par rangée avec les avant-plans `7cb0[rangée]` (`SCRB 14000`) : les crapauds ont une profondeur `0,3 + rangée / 100`, les avant-plans des berges sont devant tout (sauf l'objet tenu).
- Le Zoombini qui marche sur la berge droite (`10129 + rangée`) est une feature créée à l'arrivée (l'original réutilise l'objet jeton).
- L'animation de l'échange (`10f8:5743`) est rendue en 5 battements de 6 ticks (halo qui bat) puis l'échange ; le compte de la jauge se fait à cet instant (l'original : au second choix, avant l'animation).
- Les grenouilles : voir §2.7 (immobiles avant un échange, **à confirmer en jeu**) ; l'animation de saut utilise `10071` (haut), `10077` (droite), `10073` (bas), `10075` (gauche) à la position de la case quittée décalée de (+2, −17).
- Voix d'accueil : `dialogChoice` sur la mémoire de dialogue de l'écran (le mot `S+0x34`) ; regret (`10f8:7866`) : `niveau − 1 < rand(0..4)` ou moins de 4 visites.
