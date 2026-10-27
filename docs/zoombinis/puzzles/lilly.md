# Les têtards tatoués (`LILLY.MHK`, écran 11) : étude de rétro-ingénierie

Tâche T7. Épreuve 5 du parcours de L'Odyssée des Zoombinis (`ZOOMBINI.EXE`, NE 16 bits, version 1.0FR), 2e épreuve de l'étape 2 « le marais quajeux » (écran 10 le bac, **11 les têtards tatoués**, 12 la fosse). Document d'étude seul (aucun code applicatif). Cadre moteur : [../engine.md](../engine.md) (table des écrans §2.1, `SCRB` §3, `REGS` §4.3, `tBMP` §5, sons §6, aléatoire §8) ; parcours et tampon de partie : [../screens.md](../screens.md) (§1.6 niveaux, §3.4 perdus et marques de réussite). Corpus Ghidra : `archives/zoombinis/re/ZOOMBINI/` (`decomp/10f8_*.c` et `decomp/10f0_*.c`, `disasm.txt`).

Confiance : **sûr** = lu dans le code ou vérifié sur les données (ou par simulation, voir §2.3) ; **probable** = déduit de plusieurs indices concordants ; **hypothèse** = non vérifié. Les adresses sont des `sélecteur:offset` de code ; `DS:xxxx` est le segment de données du jeu (`1530`) ; **`DS2:xxxx` est le second segment de données (`1440`, 9 806 octets, données initialisées de l'épreuve)**. Piège de lecture : Ghidra confond souvent une constante entière avec l'adresse d'une chaîne voisine (`s_unable_to_initialize_timer_1530_274f + 6` est en réalité l'entier 10 069, `0x274f` = 10 063, etc.) et affiche `DAT_1440_xxxx` pour `DS2:xxxx`. Tous les ids cités ci-dessous ont été remis en entiers.

## 0. Résumé

- **Décor** : une rivière, deux berges. Sur la berge gauche, **12 crapauds (« têtards tatoués »)**, chacun portant un **tatouage** parmi 12 ; sur la rivière, un **étang de 12 × 12 nénuphars**. Chaque nénuphar a **3 caractéristiques** : A (3 valeurs), B (4 valeurs, la forme du nénuphar), C (5 valeurs) ; les 12 tatouages sont les 12 valeurs possibles (3 + 4 + 5) (**sûr** pour les nombres, **probable** pour le rendu : B = forme du nénuphar, A × C = motif de la décoration du nénuphar).
- **Règle** (**sûr**) : un crapaud tatoué `(caractéristique k, valeur v)` ne saute que sur des nénuphars dont la caractéristique `k` vaut `v`, de proche en proche (4 voisins : haut, droite, bas, gauche). Le joueur **dépose un crapaud sur un nénuphar libre de la première colonne dont la caractéristique correspond à son tatouage** ; un Zoombini (le suivant de la file) monte dessus, et le crapaud cherche seul un chemin de nénuphars compatibles jusqu'à la **colonne 11** (berge droite). Il y parvient si et seulement si la **composante connexe** de nénuphars compatibles qui contient sa case de départ touche la colonne 11 (**sûr** pour la règle, **probable** pour « si et seulement si » : l'explorateur du jeu est un parcours à compteurs de visites, voir §2.4). Sinon il **erre indéfiniment** dans l'impasse (aucun état d'échec, aucune mort) et son Zoombini est perdu si le joueur quitte l'écran.
- **Niveaux** (§3) : 1 = pas de fée ; une partie des chemins est coupée (au moins `⌊(N+1)/2⌋` des 12 tatouages passent, N = Zoombinis du groupe) ; 2 = tous les chemins sont coupés en ≈ 2 endroits, une **fée** permet d'**échanger deux nénuphars** (≈ 30 échanges) ; 3 et 4 = comme 2, plus des **grenouilles** qui descendent la rivière du haut vers le bas sur un chemin vertical (2 puis 3 points d'entrée) et occupent des nénuphars.
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

Ordre : ouverture de `LILLY.MHK` ; `tBMP` 7000 (boutons) ; fond 5000 + `SHPL` 5000 (`11a8:1475`) ; **groupes** 0 = `tBMP` 11000, 1 = 14000, 2 = 10000 (`11a0:0000`, sans `REGS` : le code recale lui-même les parties avec `REGS` 10000/10001) ; scripts : `SCRB` 11000 (groupe 0), 14000 à 14004 (groupe 1), 10000 à 10166 (groupe 2) ; `tBMP` 13000 (nénuphars) ; `REGS` 100/101, 10000/10001, 200/201, 15000/15001/15002 ; objet « dessin de l'étang » (`10f8:4f53`) ; 12 crapauds (`10f8:484e`) ; génération de l'étang (`10f8:5f02`) ; objets de curseur et de halo ; décor fixe ; zones cliquables (`1038:0000`) ; prélecture des sons (`11a8:313a` : 996-997, 11000-11001, 12000-12004, 10000-10011, ids 20000 à 29999 en flux). Au niveau 1, le jingle 997 est joué à l'entrée.

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
- **Un crapaud** (12, un par rangée de départ) : objet du moteur créé par `10f8:484e`, script de repos `SCRB 10043 + i` (rangée `i`), position de repos `DS2:23e8 + 4 i` = (66, 118), (60, 147), (46, 177), (58, 205), (44, 232), (52, 262), (39, 289), (18, 313), (47, 327), (17, 345), (43, 363), (53, 393). **Les tatouages sont tirés sans remise : les 12 crapauds portent les 12 tatouages, dans un ordre aléatoire** (`rand(0, DAT_8530)` sur un sac de 12, `10a8:04e8`). Champs utiles de l'objet (offsets du descripteur de feature, `+0x30` + offset de donnée) : `+0x10e` kind, `+0x10f` valeur, `+0x110` numéro de tatouage `t`, `+0xf3` colonne courante, `+0xf4` rangée courante, `+0xd5` cap (0 haut, 1 droite, 2 bas, 3 gauche), `+0x106` état, `+0x10b` étape de retour (0 en jeu, 1 Zoombini débarqué, 2 crapaud rentré), `+0xf2` actif (sur l'étang), `+0x111` id du jeton du Zoombini embarqué.
- **Les Zoombinis** : le groupe courant (au plus 16, `N = DS:8076`, relu par `1168:365d`). Un **jeton** par Zoombini (`SCRB 10109 + i`, i = 0 à 19, 20 emplacements de file en haut à gauche, positions de (94, 31) à (54, 7)) ; les objets « Zoombini » du moteur ne sont montrés qu'en fin d'épreuve. Les jetons sont consommés **dans l'ordre** : `DS:807a` = nombre déjà lancés.
- **La fée** (niveaux 2 à 4) : objet `SCRB 11000`, position de repos (38, 415) (`0x26`, `0x19f`) ; jauge de baguette `SCRB 10078 + g` (g = 0 à 6, `DS:7bd0`).

### 2.2 Ce que fait le joueur (**sûr** pour la mécanique, voir §4 pour les détails)

1. **Choisir un crapaud** et le **glisser** jusqu'à un nénuphar de la **colonne 0** (12 zones de dépôt, une par rangée, `DS2:241c`). Le dépôt n'est accepté que si ce nénuphar est **libre** (`+8 = 0`) **et** que sa caractéristique `k` vaut `v` (`+8 + k` = octet du kind du tatouage) : alors la zone s'éclaire (halo, `10f8:51c3`) pendant le survol ; sinon le crapaud retourne à sa place (`DS2:23e8`). Le joueur choisit donc **à la fois le crapaud (tatouage) et la rangée de départ**.
2. Au dépôt valide : le jeton suivant (`DS:807a`) se met en marche vers la rangée (`SCRB 10019 + r`, animation de 7 à 36 images, longueur croissante avec la rangée), le Zoombini monte sur le crapaud, le nénuphar de départ devient occupé, `10f0:0000` pré-calcule le chemin, et le crapaud **se met à sauter seul** (§2.4). Le joueur peut en lancer d'autres pendant que les premiers sautent.
3. **Niveaux 2 à 4** : prendre la **fée** et **échanger deux nénuphars libres** (§2.6) pour réparer les chemins coupés.
4. Quitter : bouton « carte » (abandon) ou bouton « suite » (voir §4.4).

### 2.3 Génération de l'étang (`10f8:5f02`, `5c1e`, `484e` ; **sûr**, validé par simulation)

Les gabarits `REGS 15000`, `15001`, `15002` sont trois grilles 12 × 12 de mots (rangée par rangée, 12 mots par rangée) : table 0 = identifiants `1` à `3` (caractéristique A), table 1 = `4` à `7` (B), table 2 = `8` à `12` (C), `0` = case libre. **Chaque identifiant dessine un chemin** : sur les 12 identifiants, l'ensemble de ses cases contient une composante connexe (4 voisins) qui joint la colonne 0 à la colonne 11 (vérifié sur les 12 identifiants, de 13 à 23 cases), plus des cases isolées leurres. Exemple (table 0, rangées 1 et 2) : l'identifiant 1 occupe la rangée 2 entre les colonnes 0 et 8, puis monte en rangée 1 de la colonne 8 à 11.

Algorithme (dans l'ordre) :

1. **Attribution des identifiants** (`5c1e`) : pour chaque kind, les identifiants reçoivent les valeurs de ce kind par **permutation aléatoire** (tirage sans remise dans un sac de 3, 4 ou 5 valeurs). On obtient `id → (k, v, t)`, où `t` est le numéro de tatouage.
2. **Paramètres du niveau** (`47e8` et début de `5f02`, §3) : nombre `K` d'identifiants « coupables » (leur chemin sera coupé), éventuelle rotation d'un gabarit pour les grenouilles.
3. **Symétrie aléatoire** (`rand(0..2)`, une fois pour les trois gabarits) : 0 → les trois gabarits subissent une **rotation de 180°** (`69f5(1, …)`) ; 1 → chacun subit une **symétrie** tirée au hasard, horizontale (colonne `c` → `11 - c`) ou verticale (rangée `r` → `11 - r`) (`6b7d`) ; 2 → rien. (Un chemin reste un chemin de gauche à droite après ces symétries ; l'ordre de ces opérations est : rotation du gabarit des grenouilles aux niveaux 3-4, puis cette symétrie.)
4. **Sac des identifiants coupables** : `K` identifiants tirés sans remise parmi 1 à 12 (`DS2:2616[id] = 0` les marque).
5. Pour chaque case `(r, c)` et pour chacune des 3 tables, soit `a` l'identifiant du gabarit (0 = libre) et `a'` = l'identifiant suivant **dans le même kind avec bouclage** (3 → 1, 7 → 4, 12 → 8) :
   - **coupure** : si `a ≠ 0`, si `r ≥ 2` et `c ≥ 2` (`DS2:25e6` = 0, 0, 2, 3 … : les deux premières rangées et colonnes ne sont jamais touchées), si `a` est coupable, s'il a eu moins de 2 coupures (`DS2:25fe`) et si `rand(0, 100) > 75` **ou** (`r = 11` et aucune coupure encore) : la case prend l'identifiant `a'` à la place de `a` (compteur de coupures `+1` ; le total des coupures, `local_20`, sert au nombre d'échanges de la fée, §2.6) ;
   - la case reçoit alors, pour le kind de l'identifiant retenu, la valeur `v` de cet identifiant ;
   - toute caractéristique non fixée par un gabarit est tirée au hasard (A dans 0..2, B dans 0..3, C dans 0..4).
6. Pose des coordonnées et du motif (§2.1), occupation à 0.

La rotation du gabarit des grenouilles (niveaux 3-4) n'est jamais « coupée » (son identifiant est recopié tel quel).

**Vérification par simulation** (script jetable, 300 tirages par cas) : niveau 1, N = 16 → 8 à 12 tatouages sur 12 ont un chemin intact (minimum 8 = `⌊(16 + 1) / 2⌋`) ; N = 8 → minimum 4 ; N = 3 → minimum 2 ; niveau 2, N = 16 → 0 à 6 chemins intacts (moyenne 2,1), 23,6 coupures en moyenne.

Le nombre garanti de chemins intacts au niveau 1 est donc `DS2:25bc[N]` = `⌊(N + 1) / 2⌋` (table 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, …, 10, 10 pour N = 0 à 20) : plus le groupe est petit, plus il y a de coupures (**sûr**).

### 2.4 Déplacement d'un crapaud (`10f8:41ec`, `10f0:*` ; **sûr** pour les règles locales, **probable** pour l'équivalence avec un plus court chemin)

État du crapaud : position `(c, r)`, cap `h` (0 haut, 1 droite, 2 bas, 3 gauche), matrice de **compteurs de visites** 12 × 12 (à l'offset `+0xf2` de la donnée de l'objet, 0 = jamais visité), tatouage `(k, v)`.

À chaque pas :

1. Si le compteur de la case courante est ≥ 10 000, toute la matrice est remise à 0 puis la case courante vaut 1 ; s'il vaut 0, il devient 1. Soit `n` ce compteur.
2. On examine **les 4 voisins dans l'ordre `h`, `h + 1`, `h + 2`, `h + 3`** (modulo 4, soit le sens horaire à partir du cap). Un voisin est **candidat** s'il est dans l'étang (colonne ≥ 0, rangée 0 à 11 ; **les bords haut, bas et gauche sont des murs**), s'il est **libre** (`+8 = 0`), si sa caractéristique `k` vaut `v`, et si son compteur est **strictement inférieur** au meilleur trouvé jusque-là (départ : `n`). Le dernier candidat meilleur gagne : en pratique, **les cases jamais visitées d'abord (dans l'ordre horaire), sinon la moins visitée** (retour en arrière).
3. Le voisin choisi reçoit le compteur `n + 1` et est marqué occupé ; l'ancienne case est libérée au saut (événement 11, §5.2). Le cap devient la direction du saut. Script du saut : `SCRB 10001` (haut), `10002` (droite), `10003` (bas), `10004` (gauche) ; les variantes `10005` à `10016` sont dans les tables `DS:1474`, `147c`, `1484`, `148c` (4 mots chacune) mais ne sont jamais choisies par `41ec` (**hypothèse** : sauts avec virage d'un ancien cap, inutilisés).
4. **Sortie à droite** : si le cap est « droite » et que le crapaud est colonne 11, il ne vérifie plus de voisin : il aborde la berge si la **case d'abordage de sa rangée** (`+8` de la colonne 12) est libre (la marque et joue `SCRB 10031 + r`, code `0x272f` = 10 031 renvoyé), sinon il **attend** (aucun mouvement ce tour-ci).
5. Si aucun candidat : le pas renvoie 0, le crapaud ne bouge pas et réessaie au tour suivant.

Cadence : après l'événement 10 du saut (début), le prochain pas est planifié **30 ticks** (0x1e, 510 ms) plus tard (`10f8:20bc`, cas 10). Les pas des crapauds ne sont traités que un tour de Tick sur deux (parité `DS:852e`) et pas du tout pendant qu'un échange de la fée est en cours (`DS:82ec = 1`).

Pré-calcul `10f0:0000` (au dépôt et après chaque échange touchant le crapaud) : efface la matrice, pose la cible `+0xd6 = 11` (colonne 11), puis deux passes `10f0:051a` et une passe `10f0:086f` qui amorcent des compteurs le long du plus court chemin vers la colonne 11 (même règle de voisinage, avec la contrainte « libre » ignorée) ; son effet observable est que le crapaud suit le chemin s'il existe ; **le détail exact des compteurs amorcés n'est pas élucidé** (voir §7). Conséquence pratique pour une réécriture : un plus court chemin (BFS) dans la composante compatible donne le même résultat gagnant/perdant ; seul le détail de l'errance dans une impasse diffère.

**Pas d'état d'échec** : un crapaud qui n'a pas de chemin parcourt sans fin son impasse (compteurs croissants, remise à 0 à 10 000). `10f8:7866` ne s'exécute qu'une fois la fée épuisée et tous les jetons lancés (§2.7).

### 2.5 Réussite d'un Zoombini (**sûr**)

Événement 30 (octet `0x1f`) du script `SCRB 10031 + r` (arrivée à la berge droite, 21 à 25 images, sons 10003, 10006, 10005, événement 204 en cours de route) → `10f8:3c03` :

- compteur d'arrivées `DS:7bca += 1` ; à la **première** (`7bca == 1`), `DS:82f4 = 1` : le bouton « suite » devient actif ;
- étape de retour du crapaud `+0x10b += 1` ; la case de départ du crapaud est libérée ; le crapaud est mis en file pour jouer sa sortie (scripts `10057` à `10059`, à `+0x10b` = 1, puis, à `= 2`, le script de retour `10043 + i` qui le replace sur la berge gauche, **prêt à servir de nouveau**) ;
- l'**octet de survie `+0x127` de l'objet Zoombini correspondant est mis à 1** ; `DS:8078 += 1` (réussites) ;
- le Zoombini est montré sur la berge droite par `SCRB 10129 + r` (marche vers sa place, 5 à 29 images selon la rangée), puis une animation d'attente tirée parmi `10141` à `10165` ;
- quand `DS:8078 == DS:8076` (tous passés), une voix est tirée dans les ids `20055` à `20063` (`0x4e57`..`0x4e5f`).

La case d'abordage libre (`+8` de la colonne 12) est remise à 0 par l'événement 59 (`0x3b`+1, `10f8:30ba`) quand le Zoombini a quitté la berge : **un seul Zoombini à la fois par rangée de berge droite**.

**Échec** : tout Zoombini dont le crapaud n'est pas arrivé à la sortie de l'écran garde `+0x127 = 0` (remis à 0 à l'entrée par `1168:3dd0(0, 0)`) : il est **perdu** (screens.md §3.4). Il n'y a **aucun décompte d'erreurs** : on peut en perdre autant qu'on veut, et même tous sauf un (le bouton « suite » exige une seule arrivée). **Zoombinis renvoyés au camp** : les perdus partent à l'arrêt de l'étape (étape 2 : réserve du camp 1) ; `10f8:7866` ne fait que parler.

Cas spécial `10f8:7866` : appelée quand la fée est épuisée (`7bd0 == 6`) et que tous les jetons sont lancés (ou quand le dernier jeton est lancé alors que la fée est épuisée) : parcourt les crapauds encore actifs dont l'état `+0x106 == 11` (arrivé) pour marquer leur Zoombini (`+0x127 = 1`) ; si le total reste `< N`, tire `rand(0..4)` et, si `niveau - 1 < tirage` **ou** si le compteur de visites de l'épreuve (`S+0x34 & 0xfff`) est `< 4`, joue une voix `rand(0x4e4d..0x4e50)` = ids 20045 à 20048.

### 2.6 La fée : échange de deux nénuphars (niveaux 2 à 4 ; `10f8:6cdf`, `5831` ; **sûr**)

- **Prendre la fée** : la cliquer (objet de type 2) ; elle suit la souris. Le jeu est **figé** (`82ec = 1`, plus aucun saut) dès que le premier nénuphar est choisi.
- **Choisir** : cliquer deux nénuphars **libres** (`+8 = 0`) de l'étang. 1er choix → `82e4` passe de 4 à 5, halo (`SCRB`/objet `DS:82ca`), son `12000 + (compteur mod 4)` (`DS:14f2`) ; 2e choix → `82e4 = 6`, halo (`82cc`), même son. La zone valide est le **trapèze de l'étang** (rectangle `DS2:2498` = (83, 62)-(556, 430), avec deux bords obliques : `|y - 430| < (x - 509) × 0,54` côté droit, `y - 62 < |123 - x| × 0,54` côté gauche) ; cliquer hors zone **annule** (la fée revient en (38, 415), `82ec = 0`).
- **Échange** (`10f8:5831`) : les 4 octets `A, B, C, motif` des deux nénuphars sont **permutés** ; les compteurs de visites des deux cases sont remis à 0 dans tous les crapauds actifs, et tout crapaud actif dont un des deux nénuphars **correspond maintenant à son tatouage** est **re-calculé** (`10f0:0000`) ; puis, pour chaque tatouage de grenouille en jeu, le champ de distance est recalculé (`10f0:00e5`). Même nénuphar deux fois : rien (et rien n'est compté).
- **Budget d'échanges** : `DS:7bd2 = ⌈(c + 5) / 6⌉ + [ (c + 5) mod 6 ≠ 0 ]` environ (calcul exact : `q = ⌊(c + 5) / 6⌋`, `7bd2 = q + (6q < c + 5 ? 1 : 0)`), où **`c` est le nombre total de coupures** de la génération (23,6 en moyenne au niveau 2). La jauge `DS:7bd0` (0 à 6) monte d'un cran à chaque `7bd2` échanges effectués (`DS:7bd4` les compte) ; à 6, la fée est **épuisée** (plus de choix possible). Budget total ≈ `6 × 7bd2` (≈ 30 pour `c = 23` ou 24). Jauge : script `SCRB 10078 + g` (10078 plein à 10084 vide, 7 états).
- La fée se pose à son départ (`SCRB 11000`, 70 images, sons 11000 puis 11001, 6,8 s et 0,3 s).

### 2.7 Grenouilles (niveaux 3 et 4 ; `10f8:4a84`, `10f0:1207`, `10f0:14cb`, `10f0:00e5` ; **probable**)

- Au niveau 3 ou 4, **un des trois gabarits** (celui de `DS:82ce`, valeurs 3, 4 ou 5 = table 0, 1 ou 2) subit une **rotation de 90°** (`10f8:69f5(0, …)` : `nouveau[j][11 - i] = ancien[i][j]`) : ses chemins vont désormais de **haut en bas** (rangée 0 → rangée 11). Les crapauds de ce kind ne peuvent donc plus traverser de gauche à droite (chemin vertical) ; les deux autres kinds restent horizontaux.
- Les **points d'entrée** sont les premières cases de la **rangée 0** appartenant au gabarit tourné (identifiants du kind) : jusqu'à 2 (niveau 3) ou 3 (niveau 4) cases, relues de gauche à droite après les symétries ; chacune enregistre `(colonne, kind, valeur, numéro de tatouage)` (`DS:7c74`, 8 octets chacune).
- **Cadence** (`DS:808a`) : première grenouille 600 ticks (10,2 s) après l'entrée, puis une toutes les 480 ticks (8,2 s), en tournant sur les points d'entrée (`DS:8072`, `8086` points), **tant que tous les jetons ne sont pas lancés** (`DS:9702 < 1`) et pour **20 grenouilles au plus** au total (`DS:8074 < 0x14`). Si la case d'entrée est occupée, aucune grenouille ce tour (réessai au tour suivant) ; une variante (`+0x62 = 1`, `10f0:14cb`) descend tout droit.
- Une grenouille est un objet de type 2 (`SCRB 10067` à l'arrivée, sauts 10071 haut / 10077 droite / 10073 bas / 10075 gauche, sortie 10069) qui suit, **de case en case, un plus court chemin de nénuphars compatibles vers le bas** : ordre des voisins haut, droite, bas, gauche ; elle avance vers une case libre compatible dont le **champ de distance** (BFS de `10f0:00e5` depuis les cases compatibles de la rangée 11) est strictement inférieur ; sortie par le bas. Cadence du pas : 35 ticks (0x23).
- **Effet sur le jeu** : une grenouille **occupe** (`+8 = 1`) les nénuphars qu'elle traverse : un crapaud ne peut pas y sauter (il attend). Elle ne tue pas et n'enlève rien (**probable** : aucun test de collision avec un jeton ou un Zoombini).

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
| Voix d'accueil (`DS:a2c4`) | 20075 (`0x4e6b`) | tirage 20075 à 20077 | idem | idem |
| Jingle d'entrée | 997 à l'entrée | non | non | non |
| Zoombinis lancés | tous les jetons, même règle | idem | idem | idem |

(`DS:7bce` et `DS:7bcc` sont écrites mais jamais relues : **sûr**.)

Détails : (1) la voix d'accueil dépend de `1168:5c57(S+0x34)` : 5 en entraînement ; en aventure, 1 au niveau 1 ; au niveau 2, 2 la première fois (drapeau `0x1000` de `S+0x34`), 12 la deuxième (drapeau `0x2000`), 0 ensuite. `Enter` tire la voix dans 20076-20077 si le code vaut 2, sinon prend 20075 au niveau 1 ou tire dans 20075-20077 aux niveaux 2 à 4. (2) Au niveau 1, les **deux derniers Zoombinis du groupe** (indices `N - 2` et `N - 1`) sont traités à part dans la boucle d'entrée (animation d'introduction, `DS:9702 = N - i`) : détail non élucidé (§7). (3) Les valeurs `rand(0, 100) > 75`, 2 coupures par identifiant, `r ≥ 2` et `c ≥ 2` sont les mêmes à tous les niveaux.

**Sur le « difficile »** : au niveau 1 on **sélectionne** le crapaud qui passe ; aux niveaux 2 à 4 aucun ne passe sans réparation, il faut **repérer la coupure** et **échanger** deux nénuphars (budget limité) ; aux niveaux 3-4 il faut en plus tenir compte des grenouilles qui occupent des cases.

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

- **Crapaud** (`+0x106`) : 0 = à la berge (script `10043 + i`) → **monté** (jeton arrivé) → **saute** (cases successives, cap `+0xd5`) → **arrivé** (état 11, script `10031 + r`) → **sortie** (`10057` à `10059`, `+0x10b = 1`) → **rentré** (`+0x10b = 2`, script `10043 + i`) → à la berge. Un crapaud sans chemin reste dans l'état « saute » et erre.
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

1. **`10f0:0000` / `051a` / `086f`** : le pré-calcul de compteurs de visites n'est lu que dans son rôle (« amorcer le chemin vers la colonne 11 ») ; l'effet exact sur l'ordre d'exploration (et donc sur la durée d'une errance dans une impasse) n'est pas élucidé. La règle gagnante est sûre ; la trajectoire exacte, non.
2. **`DS:9702`** : sens exact (« animation d'introduction en cours » / « tout lancé ») ; protocole du clic-clic / glisser de `1168:58c7` et rôle de `DS:2398`, `a1de`, `a43c`, `a43e`.
3. **Niveau 1 : « les deux derniers Zoombinis »** (boucle d'entrée de `10f8:0000`, `DS:9702 = N - i`, `11a8:1be6` changeant le script d'un Zoombini réel) : probablement une mise en scène d'ouverture (les deux derniers arrivent), non élucidée.
4. **Grenouilles** : les objets de type 2 (`+0x62`) créés par `10f8:4a84` (script 10067) et la variante `10f0:14cb` (descente directe) ; la correspondance exacte entre « tatouage de grenouille » et « kind tourné » ; absence éventuelle de collision avec les Zoombinis (non cherchée).
5. **`DS:7bce` et `DS:7bcc`** : écrites, jamais lues.
6. **Touche `0x016f`** : quelle entrée clavier la produit (probablement une touche de fonction du moteur) ; `1198:05b3`.
7. **Types d'objets `+0xf0`** (0 crapaud, 1 ?, 2 fée) : le type 1 n'est pas identifié (peut-être la fée épuisée).
8. **Rectangle de dépôt de la rangée 11** : `y2 = 532` (anormal).
9. **Sauts avec virage `10005`-`10016`** : tables `DS:1474`…`148c` lues par `41ec` seulement sur la diagonale ; les autres entrées sont atteintes ailleurs ou jamais.
10. **Exit** : `10f8:0b0f` appelle `11a8:021c` (appel générique de sortie d'épreuve) ; l'ordre exact avec l'écriture des marques de réussite est dans screens.md §3.4, non revu ici.
11. **Cadence** : délais d'images (6/7/8 ticks) lus à travers des arguments de `11a8:0ad6` que Ghidra a mal ordonnés ; à confirmer en jeu.
