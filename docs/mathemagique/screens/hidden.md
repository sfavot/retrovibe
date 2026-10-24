# Hidden Picture Puzzles (scène 4, `HIDDEN.DAT`)

Étude de rétro-ingénierie (documentation seule). Adresses `sélecteur:offset` de `MATH` (DS = `1108`, segment de code `1030`). « Hypothèse » = non établi par le code. Voir [engine.md](../engine.md), [re-index.md](../re-index.md), [scr.md](../scr.md), [formats.md](../formats.md), [shap.md](../shap.md).

Conventions des désassemblages : les `RECT` du jeu sont `(gauche, haut, droite, bas)` ; `1000:56bd` copie une structure, `10b0:075e` = InsetRect (valeurs positives = rétrécit), `10b0:07bf` = OffsetRect(rect, dx, dy), `10b0:07f1` = intersection non vide, `10b0:0711` = PtInRect, `10b0:068c` = ramène un point dans un rectangle. `10a8:14c1(n)` = `rand()` dans `[0, n[` : congruentiel `seed = seed × 0x343FD + 0x269EC3`, résultat `(seed >> 16) % n` (`10a8:1473`). `10a8:13af(0, n, &historique)` = tirage sans remise dans `[0, n[` (masque 32 bits d'historique ; quand tout est tiré, le masque est remis à 0).

## 0. Résumé

**Ce n'est pas un jeu de calcul** : c'est un **puzzle de polyominos** (pièces de 1 à 7 carrés, rotation par quarts de tour) qui doivent recouvrir exactement l'écran d'une télé (grille 4×4, 5×5 ou 6×6 selon la couleur du « Level Brother »). Chaque pièce posée révèle la partie d'une photo (noir et blanc, 238×238) qu'elle recouvre ; quand toutes les pièces sont posées, la photo s'anime (`SCR` 5100+). Concept mathématique (manuel) : géométrie, sens de l'espace, transformations. **Ni score, ni minuteur, ni compteur d'essais, ni vérification de réponse, ni indice automatique, aucun bit de progression écrit** (vérifié : aucun appel de `1030` à `1010:3fdf` ni à une écriture de masque ; seul `1050:0302`, sauvegarde du roster, est appelé).

## 1. Règles

### 1.1 Déroulé (cas nominal)

1. **Entrée** (`1030:0000`) : menu des 9 vignettes du niveau vert, animation d'accueil des trois « Level Brothers » (`SCR` 2000 + voix `SND` 13107), musique `SND` 100 si la préférence musique (`DS:2d64`) est active.
2. L'enfant peut cliquer un visage (vert / orange / rouge) pour changer de niveau (3 menus différents de 9 photos), ou une vignette `k` (1..9) pour jouer.
3. **Vignette cliquée** (`1030:0490(k)`) : le menu disparaît (transition), la photo `5070 + 9×niveau + (k−1)` est chargée **mais cachée**, un découpage est tiré au hasard (§2.2), les pièces sont **dispersées au hasard dans la zone de droite** (`1030:0c67`).
4. **Jeu** : prendre une pièce, la déplacer, la faire tourner (bouton Rotate ou Espace), la lâcher. Si elle est lâchée sur la télé à peu près alignée sur la grille et sans chevauchement, elle s'**aimante** sur la grille et montre sa portion de photo. On peut reprendre une pièce posée pour la retirer.
5. **Fin** (`1030:1db5`) : dès que toutes les pièces sont posées (voir §1.5), la musique MIDI s'arrête, un jingle `SND` 5020–5023 (tiré au hasard à l'étape 3) est joué en entier, les pièces sont désactivées, puis la photo s'anime (§3.5) ; la musique reprend à la fin. Cliquer la télé rejoue l'animation.
6. Ensuite : cliquer un visage = retour au menu (même niveau ou autre) ; **Reset** = nouvelle dispersion **du même découpage** ; Exit = hub.

### 1.2 Niveaux (« Level Brothers »)

`DS:50c8` = niveau 0..2 (vert, orange, rouge ; remis à 0 à chaque entrée, non sauvegardé). Taille de cellule `DS:50cc` = `240 / (niveau + 4)` (`1030:18eb`) : **60, 48, 40 px** ; grille de 4, 5, 6 cellules de côté (16, 25, 36 cellules). `DS:50ca = 12 × niveau` : décalage dans `SHPL` 5030 (formes de bordure).

### 1.3 Sélection du puzzle

- **Photo** : choix explicite par la vignette `k`. Il y a 27 photos distinctes (`SHPL` 5070–5096), 9 par niveau.
- **Découpage** (`PUZZ`) : tiré **au hasard à chaque lancement** parmi 9 par niveau, sans remise (`1030:18eb` : `13af(0, 9, &DS:573e[niveau])`, historique de 32 bits par niveau, non sauvegardé, réinitialisé quand les 9 sont passés). Id `PUZZ` = `1000 + 32 × niveau + tirage`. Le découpage est indépendant de la photo choisie (manuel : « le téléviseur fait des puzzles différents à chaque fois »). `Reset` ne retire pas de nouveau tirage.
- `rand(4)` choisit aussi le jingle de fin : `DS:50ec = 5020 + rand(4)`, préchargé tout de suite (`1088:1125`).
- Graine : `10a8:1460` (appelée une fois ; source non relevée : hypothèse, heure).

### 1.4 Entrées de jeu, déplacement

Deux modes selon `DS:02b8` (préférence « contrôle de la souris » du dialogue `1080:1495`, bascule 0/1 ; défaut 1 dans `MWROSTER`) :

| Mode | `02b8` | Prise | Déplacement | Dépose |
|---|---|---|---|---|
| clic-clic (défaut) | ≠ 0 | clic sur la pièce (`1030:0857`, son `SND` 5012) | la pièce suit la souris (rappel de survol `1030:112d` → `1030:1311` à chaque mouvement) | **nouveau clic n'importe où** (son 5013, `1030:0b59`) |
| glisser | = 0 | bouton enfoncé sur la pièce (son 5012 ; le numéro du bouton est mémorisé dans `DS:50c6 = DS:4b34`) | `tick` (`1030:02ab`, cas 0) : tant que ce bouton est enfoncé (`1098:0437` : `GetAsyncKeyState` et pas de `WM_xBUTTONUP` en file), la pièce suit le curseur (`1098:039b`) | au relâchement : `0b59` (**pas de son de dépose**) |

Tant qu'une pièce est tenue en mode clic-clic, le groupe « pièces » capte tous les clics (`112d` renvoie « touché » pour tout point) : on ne peut pas cliquer un bouton ; un clic dépose.

Détail du **test de prise** (`1030:119b`) : le point doit être dans le rectangle englobant (`+0x98`) puis dans l'une des cellules de la pièce (précision à la cellule, pas au rectangle) ; la 1re pièce du tableau touchée gagne (le tableau est ordonné de haut en bas, voir §2.3).

### 1.5 Pose et « aimantation »

À la **prise** d'une pièce (`1030:08d1(i)`) :
1. la pièce `i` passe en **tête du tableau** (`memmove`, elle devient l'indice 0 = dessus = « dernière pièce prise ») et son drapeau « posée » est mis à 0 ;
2. **toutes les autres pièces non posées** sont retestées (`1030:0be7`) : si leur rectangle englobant est entièrement dans la télé élargie de 15 px (`InsetRect(−15, −15)` sur `(54,51,292,289)`, test `1018:00ae` = les deux coins dans le rectangle) **et** si la position alignée ne chevauche aucune autre pièce (`1030:17f7`), elles sont alignées et marquées posées ;
3. l'écran est redessiné (télé vidée `1030:1e02` puis pièces de n−1 à 1) et la pièce tenue est dessinée dessus.

À la **dépose** (`1030:0b59`) :
1. si la pièce touche la bande `(0, 304, 298, 432)` (DS `1a44` : le bas de la télé avec les boutons), elle est repoussée hors de cette bande, par le côté de plus faible pénétration : si `298 − gauche < bas − 304` décalage horizontal (vers la droite), sinon vertical (vers le haut) ;
2. si `0be7` accepte (mêmes conditions que ci-dessus) : drapeau posée = 1, la pièce est déplacée à la position alignée ;
3. `1030:1db5` : test de fin.

**Formule d'alignement** (`1030:1779`, calculée sur la position du coin haut-gauche `G` du rectangle englobant par rapport à `(54, 51)`) : `G_aligné − origine = c × ⌊(G − origine + c/2 + 1) / c⌋ − 1`, avec `c` = cellule et division entière tronquée. Donc **la grille commence en (53, 50)** (pas (54, 51)), pas de `c`, avec arrondi au plus proche. Idem pour y. Le centre de la pièce (`+0x94`, `+0x96`) est décalé de la même quantité.

**Chevauchement** (`1030:1256` / `17f7`) : une cellule candidate (carré `c × c`) est en conflit si elle coupe une cellule de **n'importe quelle autre pièce** (posée ou non, mais pas la pièce 0 pendant `08d1`, puisque la boucle part de l'indice 1 ; dans `0b59` la pièce tenue est l'indice 0 donc exclue d'elle-même).

**Fin** (`1030:1db5`) : toutes les pièces ont le drapeau posée = 1. Comme les cellules totales = `N²`, cela équivaut à un pavage exact. Vérifié par un solveur : les 27 `PUZZ` ont tous des pavages (rotations seules, sans symétrie) : de 128 à 483 840 selon le puzzle, en comptant comme distinctes les permutations de pièces identiques (ex. 1000 : 185 280, 1036 : 432, 1065 : 128 ; manuel : « plusieurs solutions »).

### 1.6 Rotation

`Rotate` (bouton 6) ou **Espace** (`1030:14c5`, via `1030:1ef2`) : tourne d'un quart de tour **dans le sens horaire** la **dernière pièce prise** (indice 0), même si elle n'est pas tenue : dans ce cas elle est « reprise » (`08d1(0)`), tournée, puis redéposée (`0b59`, donc éventuellement alignée). Ignoré (renvoie 0, touche non consommée) si Polly est à l'écran (`DS:32c2 ≠ 0`) ou si les pièces sont désactivées (menu, puzzle fini : `31ce & 1`). Son `SND` 5005. Transformation d'une cellule `(a, b)` (colonne, ligne) dans une pièce de hauteur `H` : `(a, b) → (H − 1 − b, a)` puis largeur et hauteur permutées (`1030:16b9`) ; le centre de la pièce reste fixe puis est ramené dans l'écran (`InsetRect` de la demi-taille, `068c`) ; le rectangle englobant est recalculé (`1030:0e9d` : `gauche = cx − L·c/2`, etc.).

### 1.7 Boutons

Les 7 boutons (groupe 1, rappel `1030:0396(i)`, `i` = 1..7) :

| `i` | Bouton (`SHPL` 5000, formes repos/appui) | Rect (`gauche, haut, droite, bas`) | Action |
|---|---|---|---|
| 1, 2, 3 | visages vert / orange / rouge (1-2, 3-4, 5-6) | (52,308,85,340) (88,308,121,340) (124,308,157,340) | niveau `i−1` : si un puzzle est en cours **ou** niveau différent : `50c8 = i−1`, retour au menu (`1030:0717(0)`) ; sinon rien |
| 4 | visage jaune (7-8) | (228,306,261,338) | Polly, aide (`1030:1f86`, §3.6) |
| 5 | Reset (9-10, 42 px) | (52,346,94,378) | seulement si un puzzle existe (`50ce ≠ 0`) : son 5004, attente de 30 ticks (`1088:10d2(0x1e, 0)`), nouvelle dispersion (`0c67`), pièces réactivées |
| 6 | Rotate (11-12) | (265,307,298,339) | §1.6 |
| 7 | Exit (13-14, 41 px) | (116,346,157,378) | `scene_hidden_exit` (`1030:0364`) : fondu, retour au hub (`1b20 = 0`) |

Chaque rectangle est suivi d'un second rectangle (zone d'appui, décalé de (+2,+1) et réduit) dans la table source `DS:1994` (16 octets par bouton : `1994 + 16×(i−1)`).
Les rappels reçoivent `i` = indice 1-based dans leur groupe. Pour `i ∉ {5, 6}`, le rappel annule d'abord l'animation de révélation et son préchargement (`1018:0c0f(50ee)`, `1090:135a(DS:3292)`) ; `DS:50f0` mémorise s'il fallait la relancer ; `DS:3210 |= 1` (télé non cliquable) sauf pour 6.

### 1.8 Fin d'un tour, rejouer

Cliquer la télé quand le puzzle est fini (groupe 3, rect `(54,51,292,289)`, rappel `1030:0577` → `1030:1f0c`) rejoue l'animation de la photo (`1090:138c(1, …)` puis `111c`), puis relance la musique. Le groupe 3 n'est actif qu'entre la fin du puzzle et la prochaine action (`DS:3210` bit 0).

## 2. Formats

### 2.1 `PUZZ` (27 ressources, ids 1000–1008, 1032–1040, 1064–1072)

Chargée par `10a8:058c(…, 'PUZZ', id)` dans le tampon `DS:5112` (136 octets max, il finit à `DS:519a`). Big-endian sans objet (octets).

```
u8  n                      nombre de pièces : 8 (7 pour 1036, 9 pour 1068, 1069, 1071, 1072)
n × 15 octets :
  u8  k                    nombre de cellules (1 à 7)
  7 × (u8 a, u8 b)         cellule : a = colonne (x), b = ligne (y), origine (0,0), seules les k premières comptent
```

Taille = `1 + 15 n` (121 ou 106 ou 136). Les pièces sont normalisées à `min a = min b = 0` sauf rares exceptions (ex. 1032 pièce 3 `(0,1),(1,1),(1,0)`) ; largeur `L = max a + 1`, hauteur `H = max b + 1` (`1030:18eb`). Les cellules ne sont pas triées. Somme des cellules = 16 (niveau 0, ids 1000–1008), 25 (1032–1040), 36 (1064–1072). Certaines pièces sont identiques (jusqu'à 3 monominos). Octets de bourrage du 6e record de 1001 : `00 01 00 00 …` (un résidu `01` après la 2e cellule, ignoré car `k = 2`).

Exemples décodés (`(a,b)`) :
- **1000** (4×4) : `[(0,0)] ×3`, `[(0,0),(1,0)]`, `[(0,0),(0,1)]`, `[(0,0),(1,0),(0,1)]`, `[(1,0),(1,1),(0,1)]`, `[(0,0),(0,1),(0,2)]`.
- **1036** (5×5, 7 pièces) : domino, 2 L de 3 cases, I de 3, I de 4, deux pentominos (P et X).
- **1068** (6×6, 9 pièces) : domino, domino, I3, carré 2×2, pentomino `(3,0),(0,1)…(3,1)` (L), I5 vertical en `(1,0)…(1,3)` + `(0,0)`, etc.

`PUZZ` pour Patterns et Stickler (autres agents) : cette disposition-ci est **spécifique** à Hidden (ids 1000+32×niveau, pièces de polyominos) ; les ids de Patterns (6600–7900 par 50) et Stickler (2100–4700 par 100) et leurs tailles (40 et 56 octets d'après engine.md) montrent un contenu différent : `PUZZ` n'est **pas générique** (le tag est partagé, pas la structure ; hypothèse : seul le chargeur `10a8:058c` est commun).

### 2.2 Révélation de la photo

Pas de masque `SHAP` : la photo est **une seule forme `SHAP` de 238×238** (`SHPL` `5070 + 9·niveau + k − 1`, palette 64 couleurs aux indices 154 à 217, appliquée par `10a8:0dc4(0x40, 0x9a, …)`). Quand une pièce est « posée », le dessin (`1030:0f18`) **écrête sur l'union des cellules de la pièce** (chaque cellule : `c × c` rétréci de 5 px sur chaque côté exposé, voir §2.4) et blitte la forme 1 de cette `SHPL` à l'origine de la télé `(54, 51)`. Une pièce non posée se dessine en **aplat** : couleur de palette `DS:1ab4[niveau]` = **86, 61, 140** (vert/orange/rouge ; indices de palette, valeurs relues `0x56, 0x3d, 0x8c`).

### 2.3 Structure de pièce en mémoire (160 octets, `DS:519c + 0xa0·i`)

| Offset | Contenu |
|---|---|
| `+0x00` | drapeau posée (0/1) |
| `+0x02`, `+0x04` | largeur `L`, hauteur `H` (en cellules) |
| `+0x06` | nombre de cellules |
| `+0x08 + 0x14·j` | cellule `j` : `+0` a, `+2` b, `+4..+0xa` 4 mots « côté » **N, E, S, W** (forme de bordure ou 0), `+0xc..+0x12` 4 mots « coin » **NO, NE, SE, SO** |
| `+0x94`, `+0x96` | centre `(cx, cy)` |
| `+0x98..+0x9e` | rectangle englobant `(gauche, haut, droite, bas)` |

Indice 0 du tableau = dessus (dernière pièce prise). Le tableau parallèle `DS:8364 + 20·i` contient le rectangle de bouton et, à `+8`, le centre mémorisé.

### 2.4 Bordures des pièces (`SHPL` 5030, 36 formes = 12 par niveau)

Formes par niveau (`+ DS:50ca`) : 1 = barre verticale 5×c, 2 = horizontale c×5, 3 = verticale, 4 = horizontale (côtés), 5–8 = coins concaves, 9–12 = coins convexes (5×5). Calcul (`1030:18eb`) : pour chaque cellule on construit un masque des 8 voisines (cellules de la même pièce) ; côté N/E/S/W = forme `2 / 3 / 4 / 1` **si la voisine de ce côté est absente**, sinon 0 ; coin = forme **convexe** (`9, 11, 12, 10` pour NO, NE, SE, SO) si les deux côtés adjacents sont absents, forme **concave** (`5, 7, 8, 6`) si les deux côtés sont présents mais pas la diagonale, sinon 0. Positions de dessin dans la cellule : N `(0,0)`, E `(c−5,0)`, S `(0,c−5)`, O `(0,0)` (table `DS:1a62`, `−1` remplacé par `c − 5`). À la rotation, les mots sont décalés (N←O, E←N, …) et passés par la table `DS:1a82` (`0,2,3,4,1,7,5,8,6,11,9,12,10`) ; une réimplémentation peut simplement **recalculer** les côtés/coins après chaque rotation.

### 2.5 Autres ressources de `HIDDEN.DAT` (SCR 28, SND 69, SHAP 633, SHPL 61, SNDL 28, PUZZ 27)

| `SHPL` | Contenu |
|---|---|
| 102 | fond 576×432 (palette indices 10–245) ; la télé vide (écran blanc), pas de boutons |
| 2000 | 14 formes (`SCR` 2000 : les trois visages qui bougent, 109×39 et 33×32) |
| 5000 | 14 formes : 7 boutons × 2 états (§1.7) |
| 5030 | 36 formes de bordure (§2.4) |
| 5070–5096 | 27 photos 238×238 |
| 5100…7700 par 100 | animations de fin (`SCR` de même id, `SNDL` de même id), la première forme = souvent la photo |
| 7800 / 7810 / 7820 | menus des niveaux 0/1/2 : 9 vignettes 72×72 (formes 1–9) + 1 forme 80×80 (cadre ; non dessinée par `0717`, hypothèse : cadre de survol) |

## 3. Mise en page, sprites, animations

Zone de jeu 576×432 ; fond `SHPL` 102 chargé par `1018:0000(2)` ; palette appliquée par fondu (`1088:1b25(0x1e0001, 0xa00ec, …)` : 30 ticks, entrées 10–245).

### 3.1 Rectangles (DS ; `(gauche, haut, droite, bas)`)

| Zone | Rect | DS |
|---|---|---|
| Écran de la télé | (54, 51, 292, 289) | `1a1c` (et `1a0c`, `85ec`, `8614`) |
| Grille réelle de jeu | origine (53, 50), `N × c` px | formule §1.5 |
| Pile de pièces | (332, 35, 544, 398) | `1a14` |
| Bande du bas de la télé (interdite aux pièces) | (0, 304, 298, 432) | `1a44` |
| Bandes autour de la télé (sauvegardées à l'entrée, `10a8:1023` ×4, `DS:5096..50a6`) : haut, gauche, droite, bas | (0,0,576,51) (0,51,54,289) (292,51,576,432) (0,289,292,304) | `1a24..1a42` |
| Polly cliquable (aide) | (311, 280, 388, 432) | `1a04` → `8600` |
| Zone de sauvegarde pour Polly | (219, 274, 576, 432) | `1a4c` |
| Cellule type | (0, 0, c, c) | `1a54` |
| Vignettes (menu), ligne `r`, colonne `col` (0..2) | gauche `59 + 78·col`, haut `56 + 78·r`, 72×72 | `8538 + 20·k`, créées `1030:21fa` |
| Boutons | §1.7 | `84ac + 20·i` |

Les pièces peuvent déborder de la télé (écrêtées par le cadre : bandes `5096..50a6` rejouées par `1030:1e02`) mais restent entièrement dans l'écran (`068c`).

### 3.2 Groupes de boutons (`10a0:0000(0xc000, 4, 0x3216)`)

Quatre groupes, un ensemble de boutons chacun (record de 12 octets à `DS:3216 + 12·g` : pointeur d'ensemble, nombre d'ensembles = 1, rappel) ; rappels copiés à l'entrée depuis `DS:196c` :

| Groupe | Ensemble (`DS`) | Rects | Rappel | Rôle | Activation (bit 0 du drapeau = désactivé) |
|---|---|---|---|---|---|
| 0 | `31c4` | `8364` (n pièces) | `1030:0857` | pièces | `31ce` : activé par `0c67` ; désactivé en menu / fin |
| 1 | `31de` | `84ac` (7) | `1030:0396` | boutons | toujours |
| 2 | `31f6` | `8538` (9) | `1030:0490` | vignettes | `3200` : activé en menu seulement |
| 3 | `3206` | `85ec` (1) | `1030:0577` | télé = rejouer | `3210` : activé à la fin du puzzle |

Pendant l'aide, `10a0:0000(0xc000, 1, 0x3286)` installe un groupe de 4 ensembles (Polly, copie des pièces, boutons, télé), et deux rappels de curseur (`DS:31ae` = `1088:0e3a` curseur « ? », `31b2` = `1088:0e48` retour).

Rappels de survol des vignettes (`DS:312a` = `1030:1e6a`, `312e` = `1030:1e94`, `31aa` = `1030:112d` = test de prise des pièces) : `1e6a` joue `SND` 5010 (tic de 0,03 s) et dessine un cadre autour de la vignette (rect agrandi de 4 px, forme/couleur `DS:1a5c[niveau]` = 141/139/140), `1e94` le même avec la couleur 74 (appui) : hypothèse sur le rôle exact de `10a8:0d27`.

### 3.3 Menu (`1030:0717`)

Libère la photo, `SND` 5012/5013 et 50ec ; charge `SND` 5010/5011 ; charge `SHPL 7800 + 10·niveau` dans `DS:50d2` (palette des photos par `0dc4` en fondu ou `0e86` direct si appel d'entrée), dessine les 9 vignettes (forme `k+1` à `8538 + 20k`), active le groupe 2, désactive le groupe 0. Si on vient d'un puzzle : transition `1018:09b8` (« stores vénitiens » `1018:0722/0785/0811/0889` : bandes horizontales de 10 px recopiées progressivement du tampon vers l'écran, 1,5 ou 3 lignes par tick : vitesse hypothèse) sur l'écran (puzzle en cours, `0x1e`) ou la télé seule (`0xf`), puis encore une sur la télé après dessin.

### 3.4 Lancement d'un puzzle (`1030:0490(k)`)

1. `SND` 5011 joué **en attente** (`1088:18c6`), curseur occupé (`1008:0620`), libération de 5010/5011.
2. télé vidée (`1e02`) + transition (`09b8`).
3. charge `SND` 5013 et 5012, photo `5070 + 9·niveau + k − 1` (`10a8:0355`/`0124`), palette (`0dc4`).
4. `1030:18eb` (découpage, §1.3/§2) ; `DS:3296 = niveau × 900 + (k−1) × 100 + 5100` = `SCR` de fin ; **préchargement** de ses `SHPL`/`SCR`/`SNDL` (`1018:0a04(0, id)`), poursuivi par le `tick` (cas 2 : `10c0:11dc(0x1e)` = laisse le chargeur asynchrone travailler 30 ms par tour ; `DS:50ee` = préchargement actif) : sert à éviter la latence du CD ; annulé par `1018:0c0f`.
5. `50ce = 1` (puzzle présent), dispersion `1030:0c67`.

### 3.5 Dispersion (`1030:0c67`)

Pour chaque pièce, de n−1 à 0 : drapeau 0 ; tourne `rand(4)` fois ; tourne une fois de plus si sa largeur en pixels dépasse la largeur de la pile (212) ; tire jusqu'à 10 centres `(gauche + rand(l), haut + rand(h))` dans la pile rétrécie d'une demi-pièce (+1) et retient celui qui **recouvre le moins de pièces déjà placées** (indices supérieurs) ; centre → `DS:836c + 20·i` et `+0x94` ; puis dessin. Les arguments exacts des `rand` sont perdus par le décompilateur (hypothèse : `rand(largeur)`, `rand(hauteur)`). Après la dispersion : message d'écran `1018:09b8` (transition) sur tout l'écran, `50ee` préservé.

### 3.6 Animations `SCR`

| `SCR` | Clip `(haut, gauche, bas, droite)` | Durée (ticks) | Déclencheur | Sons |
|---|---|---|---|---|
| 2000 | (308, 52, 343, 157) | 210 | entrée (`1090:0ff9(329e)`, non interruptible, drapeaux `0x11`) | 13107 (voix 2,9 s) |
| 5100 + 100·j + 900·niveau, `j` = 0..8 (5100–5800 ; 6000–6800 ; 6900–7700) | variables, souvent (51,54,289,292) | 322 – 1204 | fin du puzzle, rejouer (drapeaux `0x50`, non interruptible) | un ou plusieurs `SND` 12153, 15000–15140 (voix + effets, 0,6 à 19 s) |

Contenu : la photo « prend vie » (ex. 5100 : un oiseau, des hommes assis qui glissent hors de l'écran de la télé). Détail des sons par `SCR` : `SNDL` de même id (voir sortie de l'inventaire : 5100 : 15010/11/12 ; 5200 : 15090/91/92 ; 5300 : 15106 ; 5400 : 15105 ; 5500 : 15109 ; 5600 : 15110 ; 5700 : 15005/15115/15139/15140 ; 5800 : 12153 ; 5900 : 15116–18 ; 6000 : 15025/26 ; 6100 : 15000–03 ; 6200 : 15050 ; 6300 : 15085 ; 6400 : 15114 ; 6500 : 15128–31 ; 6600 : 15119/20/38 ; 6700 : 15111 ; 6800 : 15126/32–34 ; 6900 : 15065 ; 7000 : 15100 ; 7100 : 15101 ; 7200 : 15031 ; 7300 : 15121–24 ; 7400 : 15095 ; 7500 : 15113 ; 7600 : 15006 ; 7700 : 15135–37). Aucun hook (`0x10`–`0x13`) dans les 28 scripts.

### 3.7 Aide de Polly (`1030:1f86`, `POLLY.DAT`)

Déclenchée par le bouton 4. Ouvre `polly.dat` (archive temporaire, `10a8:0936`/`0000`, restaurée par `0080`/`09f3`), sauvegarde le fond `1a4c` (`10a8:1023`) dans `DS:5092`, installe le groupe d'aide, puis joue :
- `SCR` **25000** (arrivée de Polly) ;
- **`25100`** (long discours, 1799 ticks, 15 voix 18306…19317) **la première fois** (`DS:50d8 = 0` : `50d6 = 1` marque le roster à sauver) sinon **`25250`** (court, 364 ticks) ; `DS:50d8 = 1` ;
- si pas première fois : minuterie `50da/50dc` ; si l'enfant ne fait rien pendant 300 ticks (tick, cas 1), `1030:2148` rejoue `25100`.

Ensuite, cliquer un élément (rappel `1030:0583(i)`, `i` = 1-based dans le groupe d'aide) déclenche l'explication correspondante, encadrée par deux couches d'animation (`25150` avant, `25200` après, sauf cas particuliers) :

| `i − 1 − (nombre de pièces `DS:325e`)` | Cible | `SCR` |
|---|---|---|
| `i = 1` | Polly elle-même | sortie d'aide (`1030:2077`) |
| pièce (`≤ n`) | pièces | 25700 (`0x6464`) |
| 1, 2, 3 | visages | 25600 |
| 4 | bouton Aide | 25550 |
| 5 | Reset | 25750 |
| 6 | Rotate | 25800 |
| 7 | Exit | 25500 |
| 8 | télé | 25850 si le menu est affiché (groupe 2 actif), sinon 25650 |

Sortie (`1030:2077`) : tire `rand(12)` : phrase d'au revoir `SCR 27000 + 50·n` (12 voix 0,4–1,1 s), puis `SCR` 25050 (départ), restaure fond et archive, ré-installe les groupes normaux, relance la musique, relance le préchargement s'il avait été annulé. Les voix `SND` 18xxx/19xxx sont dans `POLLY.DAT` (jouées par les `SNDL` de ses `SCR`). `1030:2189` dessine une marque d'aide (`1018:058e`, couleur selon `DS:8bd0`) : rôle exact non établi.

## 4. Sons

| Évènement | Son | Remarques |
|---|---|---|
| Musique de fond (tout le jeu sauf fin / aide selon cas) | `SND` 100 (MIDI) | seulement si `DS:2d64 ≠ 0` ; relancée après fin / aide / replay ; arrêtée par `1088:16a5('tMID', −1)` à l'entrée (musique de transition du hub) et au début de la séquence de fin. `SND` 101 : non référencé par `1030` |
| Visages 1-3, aide (4) | `SND` 5000–5003 (0,5–0,8 s, 2 repères `Cue#`) | ids dans `DS:8490..849c` ; hypothèse : voix des 4 visages |
| Reset | `SND` 5004 (1,32 s) | |
| Rotate | `SND` 5005 (0,15 s) | |
| Survol vignette | `SND` 5010 (0,03 s) | menu |
| Clic vignette | `SND` 5011 (0,1 s) | joué en entier avant de continuer |
| Prise d'une pièce | `SND` 5012 (0,07 s) | |
| Dépose (mode clic-clic seulement) | `SND` 5013 (0,02 s) | |
| Fin du puzzle | `SND` 5020–5023 (2–3,2 s) : un tiré au hasard à chaque lancement | joué en attente (`1088:18c6`) |
| Accueil | `SND` 13107 (2,9 s) dans `SCR` 2000 | |
| Révélation | sons des `SCR` 5100+ | §3.6 |
| Aide | sons de `POLLY.DAT` | §3.7 |

Préchargés à l'entrée : 100, 5000–5005 (`1030:0059`, `006f`) ; en menu : 5010, 5011 ; en jeu : 5012, 5013 ; 50ec en jeu. Les voix servent d'explication / récompense, pas de retour sur les actions.

## 5. Progression et sauvegarde

- **Aucun masque de réussite** (bit `5 × opération + niveau`) n'est écrit. Hidden n'apparaît pas dans le Hall of Fame.
- **Variable de roster unique** : `DS:50d8` = u16 big-endian à l'offset **5414** de l'enregistrement du joueur (engine.md §7.1) = **« Polly a déjà présenté le jeu »** (0 → discours long `25100` la première fois, puis 1). Définition enregistrée par `1050:0000` ; sauvegarde à `1030:0142` seulement si `DS:50d6 ≠ 0` (mis à 1 à la 1re aide). Une fonction `1030:217e` remet `50d8 = 0` (probablement appelée par l'outil du roster, « Reset » du joueur : hypothèse).
- Non sauvegardés : niveau courant, puzzle en cours, historique des découpages (`DS:573e`).

## 6. Clavier / souris

- Souris : bouton gauche, droit et milieu sont tous acceptés pour prendre/déposer (le même numéro de bouton doit rester enfoncé en mode glisser). Pas de survol utilisé (pas de `WM_MOUSEMOVE`) : le suivi est fait par rappel ou par `tick`.
- `Key` (`1030:1ef2`) : **Espace** (`0x20`) → rotation (§1.6) ; consommé même si ignoré. Aucune autre touche propre à la scène.
- Gadgets (`10a0:098e`) : Tab / Maj+Tab parcourent les boutons des groupes actifs, Entrée active le bouton focalisé (engine.md §5.2) : applicable aux visages, Reset, Rotate, Exit, vignettes (hypothèse : pièces non concernées).
- Globaux : Ctrl+Q quitte, Ctrl+V « à propos » (engine.md §5.3).
- Curseur : occupé (`1008:0620`) pendant chargements/animations ; « ? » pendant l'aide.
- Préférences utilisées : `DS:02b8` (mode de la souris), `DS:2d64` (musique), éditables dans le dialogue de connexion (`1080:1469`, `1080:1495`).

## 7. Différences avec le manuel de 1997 (v2, pp. 25-26, 24-25 de la v1)

Le manuel décrit : choisir un Level Brother, une image dans le Puzzle Menu, des pièces empilées « à côté de l'écran », rotation « Rotate ou barre d'espace », jeu à deux (« chacun son tour, celui qui pose la dernière pièce gagne »), Help, Exit. Constats sur la v1 (CD) :
- **Pas de mode à deux joueurs** (aucune alternance dans le code) : ajout probable de la v2.
- Boutons identiques (3 visages, Help, Reset, Rotate, Exit), Reset est décrit au manuel général.
- « Prendre la pièce, la tourner, la déposer » : correct ; la rotation peut aussi s'appliquer **à la dernière pièce prise sans la tenir** (« click this button to turn the last piece you picked up »).
- Niveaux : manuel général (« Green, Orange, Red ») ✓. 

## 8. Plan d'implémentation TS

Cible : `src/games/mathemagique/screens/hidden/` (ou équivalent selon l'agent UI).

1. **`puzz.ts`** (lecture de la ressource, pur) : `parsePuzz(bytes) → { pieces: { cells: {x,y}[] }[] }` (formes `n`, 15 octets par pièce) ; test : décoder 1000 (8 pièces, 16 cellules), 1036 (7 pièces), 1068 (9 pièces), vérifier `Σ cellules = (4 + niveau)²`.
2. **`hidden-logic.ts`** (pur, sans DOM, RNG injecté `rand(n)`) :
   - `cellSize(level) = 240/(level+4)` → 60, 48, 40 ; `grid(level) = 4 + level`.
   - `rotatePiece(piece)` : `(a,b) → (H−1−b, a)`, échange `L/H`, test : le L `[(0,0),(1,0),(0,1)]` (H=2) donne `[(1,0),(1,1),(0,0)]`.
   - `edges(piece)` : côtés/coins à recalculer (§2.4) pour le rendu.
   - `snapCorner(left, top, c) = ((c·floor((left−54+c/2+1)/c) − 1) + 54, (idem y avec 51))` ; test : `c=60`, `left=54` → `53` ; `left=54+29` → `53` ; `left=54+30` → `113`.
   - `canSnap(piece, others) / overlaps` (cellules `c×c`), englobant dans `inflate(TV, 15)`.
   - `pushOutOfBottomBand(bbox)` (§1.5, bande `(0,304,298,432)`).
   - `scatter(pieces, level, rand)` (§3.5) ; `isComplete(pieces)` (tous posés).
   - `pickPuzzleLayout(level, history, rand)` : tirage sans remise sur 9, id = `1000 + 32 × level + tirage`, `history` hors sauvegarde.
   - Tests avec valeurs du code : le solveur donne 1036 → 432 pavages (rotations seules, pièces identiques distinguées), 1065 → 128 ; chaque `PUZZ` doit pouvoir se tuiler (test exhaustif sur les 27).
3. **Machine d'états de la scène** : `Menu(level)` → `Playing(puzzle)` → `Solved` → `Menu`/`Reset` ; états annexes `Help(Polly)`, `Dragging(pièce)` ; transitions §1 ; activation des groupes (pièces / vignettes / télé) comme au §3.2.
4. **Services moteur nécessaires** : lecteur `SCR` + lecture `1090:111c` (jouer jusqu'au bout, interruptible ou non), gestion des groupes de boutons (visages, Reset, Rotate, Exit, vignettes, télé), écrêtage de blit sur une union de cellules, transition en stores vénitiens, fondu de palette (SHPL 102 + photo 154–217), audio (WAVE + MIDI 100 bouclé, attente de fin de son), `rand`, préférences (musique, mode souris : clic-clic ou glisser), roster (une variable u16), capture clavier (Espace), curseur occupé / « ? ».
5. **Rendu** : fond 102 ; vignettes 7800+10·niveau ; pièces non posées = aplat (86/61/140) + bordures 5030 ; posées = photo écrêtée à `(54,51)` ; bandes autour de la télé rejouées au-dessus.
6. **Données de test** : sorties de ce document (positions des 7 boutons, vignettes, snap).

## 9. Questions ouvertes

1. Arguments exacts de `rand` dans la dispersion (`1030:0c67`) et source de la graine (`10a8:1460`).
2. Vitesse réelle et forme exacte des transitions `1018:0722` (1,5 / 3 lignes par tick ?).
3. Rôle de `10a8:0d27` (cadre de survol des vignettes ?), de la forme 10 (80×80) des `SHPL` 7800+, et de `1030:2189` / `1018:058e`.
4. Sons 5000–5003 : association exacte aux 4 visages (gadget `1038:01af`).
5. Bit 6 du drapeau de l'animation de révélation (`DS:3299 |= 0x40`) et son effet.
6. Qui appelle `1030:217e` (mise à zéro de `50d8`) ?
7. Test de prise : l'ordre exact de balayage des pièces par `10a0` (dessus d'abord ?).
8. `SND` 101 : utilisé par une autre scène ?
9. Un seul bouton de la souris à la fois ? comportement si on change de bouton en glissant.

## Écarts avec engine.md

- §7.1 / §8.4 : `DS:50d8` (offset 5414) n'est **pas** un niveau/progression mais « Polly a déjà présenté le jeu ».
- §5.3 : Espace dans Hidden = **rotation** de la dernière pièce, pas « puzzle suivant / aide ».
- §8.4 : `k` (0..8) dans `1000 + 32·niveau + k` est le **découpage** tiré au hasard, pas l'image (l'image est choisie par vignette) ; 3 niveaux = 3 tailles de grille (4, 5, 6) et 3 menus de 9 photos (27 photos).
- §9 : `PUZZ` = « 8 pièces × 15 » : de 7 à 9 pièces, `1 + 15 n` octets (106, 121 ou 136).
- §7.1 en-tête : `DS:02b8` est la préférence de **mode de la souris** (clic-clic / glisser) et `DS:2d64` la préférence **musique** (jouée via `SND` 100), pas seulement un indicateur de phrases d'attente de Poly.
- §10 q. 12 : Hidden n'a ni difficulté adaptative ni score ; hasard = découpage sans remise + dispersion + jingle.
