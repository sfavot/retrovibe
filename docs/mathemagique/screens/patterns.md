# Puzzle Patterns (scène 5, `PATTERNS.DAT`) : étude de rétro-ingénierie

Tâche E6. Activité « Puzzle Patterns » de Math Workshop MPC (Brøderbund, v1.01, 1994). Adresses `sélecteur:offset` de Ghidra (segment code `1040`, segment de données `1108` ; voir [engine.md](engine.md) §0). Sauf mention « hypothèse », un fait est lu dans le code (`archives/mathemagique/re/MATH/decomp/1040_*.c`, `disasm.txt`) ou dans les données (`PATTERNS.DAT`, segment de données de `MATH`). Les adresses de données `DS:xxxx` sont celles du segment `1108`. Les relocations du segment de données ont été relues (les pointeurs lointains du fichier ne sont que des chaînes de relocation).

Tags de `PATTERNS.DAT` : `\0SCR` 28, `\0SND` 111, `PUZZ` 27, `SHAP` 1594, `SHPL` 60, `SNDL` 28.

## 0. Résumé

Puzzle de type « jigsaw » : un cadre doré contient une grille de **4 × 4 cases de 60 px** ; huit **pièces rectangulaires de 2 cases** (61 × 121 px à la verticale, 121 × 61 à l'horizontale) sont posées en deux piles dans la zone bleue à droite. L'enfant les prend à la souris, les fait tourner par quarts de tour (Espace ou bouton Rotate), les dépose dans la grille où elles s'**aimantent** sur les cases. Le **cadre autour de la grille est un indice** : il porte le motif répété de l'image (« study the puzzle's border »). Quand les 8 pièces sont à leur place et à la bonne orientation, une voix félicite, puis une **animation plein cadre** (SCR) donne vie au tableau (4 d'entre elles sont des animations par cyclage de palette). Pas de score, pas de chrono, pas de compteur : la seule progression sauvegardée est l'indicateur « Poly a déjà présenté le jeu ». 27 puzzles = 3 niveaux (Vert, Orange, Rouge) × 9.

## 1. Règles

### 1.1 Écran et modes

Deux états, portés par `DS:57d0` (puzzle actif : 0 = menu, 1 = puzzle en cours ou résolu) :

1. **Menu** : 9 vignettes 72 × 72 (grille 3 × 3) du niveau courant. Clic sur une vignette = choix du puzzle (`1040:0543`).
2. **Puzzle** : cadre indice (301 × 301, dessiné en (48, 46)), 8 pièces mélangées, boutons.

Barre de boutons au bas du cadre (cartouche), de gauche à droite : **Exit**, **Reset**, **3 visages de niveau** (vert, orange, rouge), **Help** (Poly), **Rotate**. Les rectangles sont au §3.2.

### 1.2 Sélection du puzzle

Pas de hasard dans le choix : l'enfant clique une vignette (`param` 1 à 9, `1040:0543`) dans le niveau affiché. Le niveau courant est `DS:57a6` (0, 1, 2), mis à 0 à chaque entrée dans la scène (`1040:0048` : `57a6 = 0`), **jamais sauvegardé**. Les boutons de niveau (1 à 3 de `1040:0454`) affichent le menu du niveau choisi. Un puzzle se rejoue à volonté (cliquer à nouveau la vignette ; le hasard n'intervient que dans le mélange, §1.3).

Identifiants dérivés (`1040:0543`, `1040:05ae`–`1040:064e`), avec `L` = niveau (0 à 2) et `k` = rang de la vignette (0 à 8) :

| Ressource | Formule | Valeurs |
|---|---|---|
| `PUZZ` et `SHPL` du puzzle | `6600 + 450·L + 50·k` | 6600 … 7900 par 50 (27 ids) |
| `SCR` / `SNDL` / `SHPL` de l'animation finale | `20000 + 900·L + 100·k` (variable `DS:3296`) | 20000 … 22600 par 100 |
| `SHPL` des vignettes du niveau | `6520 + 10·L` (`1040:0809`, `57a6 × 10 + 0x1978`) | 6520, 6530, 6540 |
| Voix de fin (sons) | `6520 + rnd(4)` (`DS:57de`) | 6520 à 6523 |

Contenu des vignettes (relu en les rendant), dans l'ordre du menu (gauche à droite, haut en bas) :

- **Vert (L = 0)** : Robot, Papillon, Poneys, Clowns, Paysage urbain, Insectes, Chiens et chats, Poissons, Grenouilles. (La vignette 1 est le robot, confirmé par `SCR` 20000.)
- **Orange (L = 1)** : Pois, Gens et ombres, Tie dye, Jungle, Camions et panneaux, Dinosaures, Tuyaux, Autoroute, Losange.
- **Rouge (L = 2)** : Dominos, Boîtes volantes, Tartan, Pompiers, Cartes (trèfle), Pavage de cubes, Barres et boules, Champ de fleurs, un motif de verrière coloré (non nommé dans le manuel).

Les noms viennent du manuel (v2) et du contenu des images ; la correspondance exacte nom/vignette pour les cas non évidents est une **hypothèse**. La difficulté suit la couleur (manuel : « start with Green… Orange and Red »).

### 1.3 Mélange (`1040:0d83`, appelé après le choix d'un puzzle et par Reset)

1. `1040:1566` efface la scène (§3.6), `31ce &= ~1` active les pièces.
2. Tirage d'une permutation des identifiants 0 à 7 : tableau `[0..7]`, puis pour `i = 0 … 7` : `j = rnd(8)`, échange de `a[i]` et `a[j]` (`1040:0d9a`–`0dd9`, mélange simple, non uniforme).
3. Le tableau de pièces (`DS:5818`, 8 entrées de 26 octets, §2.3) est rempli du **slot 7 vers le slot 0** (`DI = 58ce` en descendant de 26 jusqu'à `5818`) : le slot `s` reçoit l'id `a[s]`. Pour le slot `s` (`s` de 7 à 0) :
   - `id = a[s]`, `placée = 0`, `col = lig = -1`, `larg = 1`, `haut = 2` (cases) ;
   - `rot = PUZZ.orient[id]` (octet 0 ou 1, §2) : la pièce de réponse « horizontale » commence à `rot = 1` ;
   - centre : `x = 513 - 29·(s mod 4)`, `y = Y[s div 4] - 17·(s mod 4)` avec `Y = [315, 156]` (`DS:1d28`) : deux piles en cascade diagonale (pile du bas : slots 0–3, pile du haut : slots 4–7) ;
   - une fois sur deux (`rnd(2) != 0`) la pièce est tournée **deux fois** (`1040:13a8` ×2) : `rot += 2 mod 4`, dimensions inchangées ;
   - le rectangle est recalculé (`1040:0eed`) et la pièce dessinée (`1040:0f6b`), dans l'ordre slot 7 → slot 0 (le slot 0 finit au premier plan).
4. Transition d'affichage `1018:09b8(1, 0, 10, 30, rect écran)` (balayage interrompable au clic, §3.6).

Le générateur est un congruentiel linéaire à la Microsoft C : `état = état × 0x343fd + 0x269ec3` (32 bits), tirage = `(état >> 16) mod n` (`10a8:1473`), avec `rnd(n)` de `10a8:14c1` = tirage dans `[0, n)`. Graine : `1098:060f` au premier appel (`DS:38f8 ≠ 0`, hypothèse : horloge). Donc le mélange n'est pas reproductible d'une exécution à l'autre.

Conséquence : les 8 pièces ont toujours la même orientation initiale (bonne ou à 180°) ; **un quart de tour (ou trois) est donc toujours nécessaire seulement pour les pièces de réponse horizontale**, dont la position de départ est verticale (voir §1.5).

### 1.4 Saisie : prendre, déplacer, déposer

Modes (préférence `DS:02b8`, roster, **1 par défaut** : le manuel v2 parle de « click-and-stick mode » par défaut, réglé dans le moniteur Préférences du hub, `1080:1495`) :

- **02b8 ≠ 0 (clic-clic, par défaut)** : un clic sur une pièce la prend ; elle se colle au curseur ; un second clic la dépose.
- **02b8 = 0 (glisser-déposer)** : on appuie, on déplace en maintenant, on relâche pour déposer. Le bouton qui a pris la pièce est mémorisé (`DS:57ce = 4b34`) ; le relâchement est testé par `1098:0437(bouton)` dans le `Tick` (`1040:0298` cas 0). N'importe quel bouton de souris (gauche, droit, milieu) convient.

**Prise** (`1040:0949`, rappel du groupe 0, `param` = rang de la pièce dans le tableau + 1) : son de prise `6512` (`DS:1970`), puis `1040:09c3(rang)` :

1. La pièce est remontée au rang 0 du tableau (rang 0 = dessus ; le tableau de zones cliquables `DS:8364` est décalé de la même façon).
2. La pièce est marquée **non placée** (`+2 = 0`, `col = lig = -1`).
3. **Re-aimantation des autres pièces** : pour chaque autre pièce non placée (rangs 7 à 1), si `1040:0d02` réussit (§1.5), elle est placée et aimantée. C'est le seul endroit où des pièces « flottantes » sur la grille peuvent finir aimantées sans être déposées.
4. L'image sous la pièce est sauvegardée (`10a8:0eb8`, port arrière `DS:57be`), puis la pièce est redessinée.

**Déplacement** (`1040:1005(point)`) : le **centre de la pièce suit le curseur** (pas de décalage de saisie), restreint à l'écran : la zone `DS:8bce` (hypothèse : 0, 0, 576, 432) est rétrécie de la demi-largeur et de la demi-hauteur de la pièce (`10b0:075e`) puis le centre est ramené dans la zone (`10b0:068c`). On ne redessine que si la position change ou si la pièce était placée. En mode clic-clic, le déplacement est piloté par le rappel de test de survol `1040:0f97` (appelé par le gestionnaire de gadgets pour la pièce tenue, `DS:31aa`) ; en mode glisser, par le `Tick`.

**Dépôt** (`1040:0c24`, déclenché par le second clic / le relâchement, son `6513` à `DS:1971`) :

1. **Zone interdite du cartouche** `DS:1cac = (0, 354, 351, 432)` (cartouche des boutons) : si le rectangle de la pièce la coupe, la pièce est repoussée **soit vers la droite** (`dx = 351 - gauche`) **soit vers le haut** (`dy = bas - 354`), selon la plus petite des deux valeurs (à égalité : vers le haut), puis déplacée par `1005`.
2. **Aimantation** : `1040:0d02` (§1.5). Si elle réussit : `placée = 1`, la pièce va sur la case aimantée, `col = (gauche - 78) / 60`, `lig = (haut - 76) / 60` (divisions entières).
3. Sinon la pièce reste là où elle est tombée (hors grille, ou sur la grille mais chevauchant) : elle est **libre**, non placée, et peut recouvrir d'autres pièces ; la zone de dépôt est tout l'écran sauf le cartouche.
4. Libération du port arrière (`10a8:0fce`), puis test de victoire `1040:14e3` (§1.7).

### 1.5 Aimantation (`1040:0d02`, `13d7`, `1429`)

Pour une pièce non placée (`+2 ≠ 1`), de rectangle `R = (gauche, haut, droite = gauche + L, bas = haut + H)` avec `L = 60·larg + 1`, `H = 60·haut + 1` :

1. **Contenance** : `G' = grille (78, 76, 318, 316)` (`DS:1cb4`) élargie de 20 px de chaque côté : `(58, 56, 338, 336)` (`10b0:075e(-20, -20)`). La pièce doit avoir ses **deux coins** `(gauche, haut)` et `(droite, bas)` dans `G'` (`1018:00ae` : test de point à bornes semi-ouvertes `x < droite`, `y < bas`, `10b0:0711`).
2. **Case la plus proche** (`1040:13d7`) : nouveau centre `cx' = cx + 30 - ((gauche - 78 + 30) mod 60)`, `cy' = cy + 30 - ((haut - 76 + 30) mod 60)`. Cela arrondit la position de la pièce à la case voisine ; à égalité (reste de 30) on arrondit vers le bas/la droite. La contenance de l'étape 1 garantit que la pièce reste dans la grille 4 × 4 (vérifié à la main : une pièce de 2 cases dont `gauche ≤ 217` est ramenée à `gauche ≤ 198`).
3. **Collision** (`1040:1429`) : le rectangle décalé de `(cx' - cx, cy' - cy)` et rétréci de 1 px (droite - 1, bas - 1) ne doit couper aucune des **autres pièces des rangs 1 à 7** (le rang 0 est la pièce tenue/déposée, jamais testée) ; chaque autre rectangle est lui aussi rétréci de 1 px (`10b0:07f1` = intersection non vide). Les pièces libres (non placées) comptent comme obstacles, pas seulement les placées.

Si tout passe : aimantation réussie. Il n'y a **pas** de vérification que la case soit « la bonne » : n'importe quelle case libre convient ; c'est le test de victoire qui compare.

Exemple : pièce verticale (61 × 121) de centre `(198, 196)` : `gauche = 168`, `haut = 136` ; coins `(168, 136)` et `(229, 257)` dans `G'` ; `x` : `(168-78+30) mod 60 = 0` donc décalage `+30` : `cx' = 228`, `gauche' = 198`, `col = 2` ; `y` : `(136-76+30) mod 60 = 30` donc décalage 0 : `lig = 1`.

### 1.6 Rotation (`1040:11b2`)

Déclenchée par le bouton **Rotate** (`param` 6) ou la touche **Espace** (`1040:1678`, retour « consommée » si `0x20`). Ignorée si l'aide est active (`DS:32c2 ≠ 0`) ou si les pièces sont désactivées (`31ce & 1`, c.-à-d. pas de puzzle en cours, ou puzzle résolu). Son `6506` (`DS:196a`, 0,15 s). Opération :

1. Si aucune pièce n'est tenue (`57be = 0`) : `1040:09c3(0)` reprend en main la pièce du rang 0 (la **dernière prise**, comme le dit le manuel : « turn the last piece you picked up »).
2. `1040:13a8` : échange `larg`/`haut` et `rot = (rot + 1) mod 4` (**sens horaire** d'après le manuel ; l'ordre des 4 formes de `SHPL` le confirme : forme `4·id + rot + 2`).
3. Le centre est conservé mais ramené dans l'écran (même restriction qu'au déplacement, avec les nouvelles demi-dimensions), le rectangle est recalculé, le fond est resauvegardé, la pièce redessinée.
4. Si la pièce n'était pas tenue, `1040:0c24` la redépose (repoussée du cartouche si besoin, ré-aimantée si possible).

Retour : 1 si la rotation a eu lieu, 0 sinon.

### 1.7 Test de victoire (`1040:14e3`, après chaque dépôt, y compris le dépôt de rotation)

Pour chacune des 8 pièces (tableau à `DS:5818`, rang quelconque) : `placée = 1` **et** `(col, lig)` égal au couple de `PUZZ` de son id (comparaison de 4 octets `DS:581e` ↔ `DS:57f8 + 4·id`) **et** `rot = 0`. Dès qu'une pièce échoue, rien ne se passe. Si les 8 passent :

1. curseur sablier (`1008:0620`) ;
2. arrêt de tous les MIDI (`1088:16a5('tMID', -1)`) : la musique de fond s'arrête ;
3. la voix de fin (`DS:57de`, 6520 à 6523, 2 à 3,2 s) est jouée **et attendue** (`1088:18c6`) ;
4. `31ce |= 1` : les pièces sont désactivées ;
5. `1040:1692` : animation de victoire (§3.7).

Remarque : une pièce symétrique ou deux pièces d'aspect identique ne seraient pas interchangeables, car le test porte sur l'identifiant. Vérifié sur les 27 `PUZZ` : chacun est un **pavage exact** de la grille 4 × 4 (script de contrôle du scratch) ; l'indice du motif est dans le cadre.

### 1.8 Indices, aide et Reset

- **Indice permanent** : le cadre (forme 1 de la `SHPL` du puzzle, 301 × 301, dessiné en `(48, 46)`) montre le motif ; le centre (grille 4 × 4) reste blanc.
- **Reset** (bouton 5, actif seulement si `57d0 ≠ 0`) : son `6505`, `1088:10d2(30, 0)` (compteur 0 mis à 30 ticks, rôle exact non établi), puis `1040:0d83` = nouveau mélange **du même puzzle**. Utilisable aussi après la victoire (les pièces sont réactivées).
- **Help** (bouton 4) : Poly (§3.8). Les clics sur les éléments de l'écran jouent une explication ; un clic sur Poly donne un conseil aléatoire et referme l'aide.
- Rejouer l'animation : cliquer le tableau résolu (§3.7).

### 1.9 Niveaux, score, fin de manche

- **Niveaux** : 3 couleurs = 3 jeux de 9 puzzles (§1.2). Pas de déverrouillage : les trois sont libres d'accès.
- **Score** : aucun (pas de compteur de coups, temps ni étoiles). `1040:*` n'appelle jamais `1010:3fdf` ni aucune écriture du masque de réussites (§5).
- **Fin de manche** : la victoire déclenche l'animation puis l'enfant choisit : rejouer l'image (clic), Reset, un autre niveau (qui ramène au menu : `0454` remet `57d0 = 0`), ou Exit. Il n'y a pas de message de félicitations texte : la « récompense » est l'animation.

## 2. Formats

### 2.1 `PUZZ` (40 octets, 27 ressources 6600 … 7900 par 50)

Chargé par `10a8:058c(0, 0, id, tag 'PUZZ' = 0x50555a5a, -1, DS:57f0)` (`1040:05c7`), puis le deuxième bloc converti par `1050:00fa(1, DS:57f8, définition DS:1d08)`. **Gros-boutiste** :

| Offset | Taille | Champ |
|---:|---|---|
| 0 | 8 × u8 | `orient[id]` pour les pièces 0 à 7 : 0 = la pièce est **verticale** (1 col × 2 lig) dans la solution, 1 = **horizontale** (2 × 1) |
| 8 | 8 × (u16, u16) | `(col, lig)` de la case **haut-gauche** de la pièce `id` dans la solution (0 à 3) |

Total 8 + 32 = 40 octets. La définition `DS:1d08` décrit un seul bloc : destination `DS:57f8`, 16 mots de 2 octets (le premier bloc, 8 octets, est copié brut).

Sémantique : `orient[id]` est à la fois l'orientation de la solution et la **rotation initiale** `rot` (la pièce de réponse horizontale démarre verticale, donc à `rot = 1` par rapport à sa bonne orientation `rot = 0`) ; `(col, lig)` est la position de la pièce **dans son orientation correcte** (`rot = 0`).

Exemples décodés :

- `6600` (Robot) : `orient = 0,0,0,0,0,0,0,0` ; positions `(0,0) (0,2) (1,0) (1,2) (2,0) (2,2) (3,0) (3,2)` : 8 pièces verticales formant 4 colonnes de 2 pièces.
- `6650` (Papillon) : `orient = 0,0,1,1,1,1,0,0` ; positions `(0,0) (1,0) (2,0) (2,1) (0,2) (0,3) (2,2) (3,2)` : pièces 0, 1 verticales en haut à gauche, 2 et 3 horizontales (2 × 1) à droite (lignes 0 et 1), 4 et 5 horizontales en bas à gauche (lignes 2 et 3), 6 et 7 verticales en bas à droite.

Les 27 puzzles sont des pavages valides. **`PUZZ` de `PATTERNS` n'est pas partagé** avec `HIDDEN` (121 octets) ni `STICKLER` (56 octets) : seuls le tag et le nombre (27) coïncident, ids et tailles diffèrent (HIDDEN 1000…, STICKLER 2100…).

### 2.2 `SHPL` d'un puzzle (ex. 6650, 33 formes, palette de 236 couleurs à partir de l'index 10 pour les ids 6650, 6700, 6750, 6800, 6850, 7050, 7100, 7250, 7350, 7850, 7900 ; 72 à 80 couleurs à partir de 154 pour les autres)

- Forme 1 : le **cadre indice** 301 × 301.
- Formes `4·id + rot + 2` (`id` 0 à 7, `rot` 0 à 3), soit les formes 2 à 33 : la pièce `id` pour la rotation `rot` ; dimensions 61 × 121 si `rot` est pair pour une pièce de réponse verticale, 121 × 61 sinon, etc. (`1040:0f6b` : `10a8:0ce4(mode 0, y = haut, x = gauche, forme = 4·id + rot + 2, SHPL DS:57ba)`).

Les `SHPL` en « 154, 72–80 couleurs » ne remplacent que la plage 154 à 233 de la palette (la palette du fond occupe 10 à 245) : la peinture d'un puzzle a **ses propres couleurs**, installées à son chargement (`1040:0543` : `10a8:0dc4(72, 154, DS:8e42)` ; le nombre de couleurs vient de l'en-tête de la `SHPL`).

### 2.3 État d'une pièce (26 octets, tableau `DS:5818` + 26·rang, rangs 0 à 7, rang 0 = dessus)

| Offset | Champ |
|---:|---|
| 0 | id de pièce (0 à 7) |
| 2 | placée (0/1) |
| 4 | rotation 0 à 3 (0 = orientation correcte) |
| 6 | colonne (-1 si non placée) |
| 8 | ligne (-1 si non placée) |
| 10 | largeur en cases (1 ou 2) |
| 12 | hauteur en cases (2 ou 1) |
| 14 | centre x |
| 16 | centre y |
| 18 à 24 | rectangle `(gauche, haut, droite, bas)` : `gauche = cx - (60·larg + 1)/2`, `droite = gauche + 60·larg + 1` (idem en y ; `1040:0eed`, divisions entières) |

Les tables de zones cliquables du gestionnaire de gadgets (`DS:8364`, 8 entrées de 20 octets : rectangle, deuxième rectangle/point, drapeaux à `+0x12`) sont tenues dans le même ordre (décalage conjoint à chaque prise).

### 2.4 Autres ressources

- `SCR` 2000 : animation d'entrée des trois visages (§3.7). `SHPL` 2000 : 16 formes (une 105 × 37, quinze 33 × 32/33 à 34).
- `SCR` 20000 … 22600 par 100 : animations de victoire (27), 28ᵉ `SCR` = 2000. Aucune n'a de `SCR` partagé avec un autre puzzle.
- `SHPL` 103 : fond plein écran 576 × 432 (`1018:0000(3)`, base de `100 + 3`), palette 10–245.
- `SHPL` 6500 : 14 formes = 7 boutons × (normal, appuyé) : 33 × 32 / 31 × 31 (visages et Help, Rotate : `6500` formes 1 à 8 et 11 à 12), 42 × 32 / 40 × 30 (Reset, formes 9 et 10), 41 × 32 / 39 × 30 (Exit, formes 13 et 14).
- `SHPL` 6520, 6530, 6540 : 9 vignettes 72 × 72 + une forme 80 × 80 (non utilisée par cette scène : hypothèse, vestige) ; palette 154 à 188 (35 couleurs).

## 3. Disposition

### 3.1 Fond et palette

`1040:0066` charge `SHPL` 103 (fond : cadre doré, zone blanche centrale `49,47 – 348,346`, fond bleu-violet à droite). Le cartouche inférieur du cadre (`y ≥ 354`) porte les boutons. À la sortie de `Enter` : fondu de palette de 30 ticks sur les couleurs 10 à 245 (`1088:1b25(0x1e0001, 236, 10, …)`).

### 3.2 Zones (repère 576 × 432, rectangles `(gauche, haut, droite, bas)`, semi-ouverts)

Boutons de la barre (table `DS:1c1c`, 14 rectangles = 7 couples (repos, appuyé) ; callback `1040:0454`, paramètre = indice + 1 dans l'ordre de **la table**, voir le tableau). Les formes de `SHPL` 6500 sont dessinées à `(gauche, haut)` du premier rectangle de chaque couple (`1038:01af`, mode de blit 8).

| `param` de `0454` | Rôle | Rectangle repos | Rectangle appuyé | Formes `SHPL` 6500 |
|---:|---|---|---|---|
| 1 | niveau Vert | 150, 356, 183, 388 | 152, 357, 183, 388 | 1, 2 |
| 2 | niveau Orange | 185, 356, 218, 388 | 187, 357, 218, 388 | 3, 4 |
| 3 | niveau Rouge | 220, 356, 253, 388 | 222, 357, 253, 388 | 5, 6 |
| 4 | Help (Poly) | 283, 356, 316, 388 | 285, 357, 316, 388 | 7, 8 |
| 5 | Reset | 88, 356, 130, 388 | 90, 358, 130, 388 | 9, 10 |
| 6 | Rotate | 318, 356, 351, 388 | 320, 357, 351, 388 | 11, 12 |
| 7 | Exit | 45, 356, 86, 388 | 47, 358, 86, 388 | 13, 14 |

Correspondance rôle ↔ indice : établie par `1040:0454` (cas 1 à 3 : niveau ; 4 : `1040:17c7` aide ; 5 : Reset ; 6 : `11b2` rotation ; 7 : `scene_patterns_exit`), par les largeurs des formes (42 px = Reset, 41 px = Exit) et par la légende du manuel. Le dessin des trois visages donne l'ordre vert, orange, rouge (`SCR` 2000).

Autres zones :

| Rectangle | Rôle |
|---|---|
| `(49, 47, 348, 346)` (`DS:1c8c`) | intérieur du cadre : zone de jeu ; hors puzzle actif, zone « replay » après la victoire (groupe 3, callback `1040:066f` → `1040:1692`, `DS:3210 bit 0` = désactivée) |
| `(78, 76, 318, 316)` (`DS:1cb4`) | grille 4 × 4, cases de 60 px (origine `(78, 76)`) |
| `(0, 354, 351, 432)` (`DS:1cac`) | cartouche, interdit aux pièces |
| `(84 + 78·c, 82 + 78·r, +72, +72)`, `c, r` de 0 à 2 | les 9 vignettes (gabarit `DS:31ee = (0, 0, 72, 72)`, 3 × 3, pas 78 px) ; groupe 2, callback `1040:0543` (`param` = 1 à 9 : de gauche à droite, haut en bas) ; `DS:3200 bit 0` : désactivé hors menu |
| zone de dépose des piles | centres `x = 513 - 29·(s mod 4)`, `y = 315 ou 156 - 17·(s mod 4)` (§1.3) ; la zone de jeu des pièces est tout l'écran |
| `(362, 280, 438, 432)` | Poly (aide seulement, `DS:8600`) |
| `(269, 274, 576, 432)` | emplacement de l'animation de Poly (`DS:1ca4`, sauvegardé `577a`) |

Bandes de fond sauvegardées à l'entrée (`DS:1cbc`, 8 rectangles, `10a8:1023`) pour **effacer** la scène (`1040:1566`) : `(0,0,576,47)`, `(0,47,49,346)`, `(348,47,576,432)`, `(0,346,348,354)`, et quatre coins `(49,47,55,53)`, `(342,47,348,53)`, `(49,340,55,346)`, `(342,340,348,346)`. Quand un puzzle est actif, `1566` les redessine toutes (ce qui efface les pièces de la zone de droite et recouvre les débords) ; quand non, seulement les 4 coins.

Gadgets (gestionnaire `10a0`) : 4 groupes à `DS:3216` (12 octets : pointeur d'ensemble, nombre d'ensembles, drapeaux, callback) :

| Groupe | Ensemble | Éléments | Callback |
|---:|---|---|---|
| 0 | `DS:31c4` | 8 pièces (table `DS:8364`, test de survol personnalisé `1040:0f97`) | `1040:0949` |
| 1 | `DS:31de` | 7 boutons (table `DS:84ac`), sons `DS:8490` = 6501, 6502, 6503, 6504 | `1040:0454` |
| 2 | `DS:31f6` | 9 vignettes (table `DS:8538`), survol `1040:15f0`/`161a` | `1040:0543` |
| 3 | `DS:3206` | 1 zone (le cadre, table `DS:85ec`) | `1040:066f` |

Les 4 pointeurs de rappel sont posés par `1040:1a3b` depuis `DS:1bf4`.

### 3.3 Survol

- **Vignettes** : à l'entrée, son `6510` (0,03 s, `DS:196e`) et dessin d'un **cadre de survol** (`1040:162c`, rectangle de la vignette élargi de 4 px, indice de palette `DS:1d2c[niveau] = 77, 61, 79`) ; à la sortie `1040:161a` redessine avec l'indice 10 (efface). Actif seulement dans le menu.
- Boutons : états appuyé/repos (formes de la `SHPL` 6500) ; clavier : Tab/Maj+Tab et Entrée du gestionnaire (engine.md §5.2).
- Aide : tous les éléments passent en curseur « ? » (`CURS` 2, `1088:0e3a`/`0e48`).

### 3.4 Animations `SCR` déclenchées (descripteurs de 12 octets, engine.md §3.6)

| Descripteur `DS:` | `SHPL`/`SCR` | Déclencheur | Rôle |
|---|---|---|---|
| `329e` | 2000 (flags `0x11`) | fin de `Enter` (`1040:0110`, `1090:0ff9`) | les trois visages de niveau « parlent » (zone `150,356,253,390`, 238 ticks, son 13106 de 3,2 s) |
| `3292` | 20000 + 900·L + 100·k | victoire (`1040:1692`) ; **préchargé** pendant la partie | animation du tableau (zone `49,47,348,346` ou 266 × 266 centrée) |
| `32c2`, `32ce`, `32da`, `32aa`, `32b6` | `POLLY.DAT` | aide (§3.8) | corps de Poly + bulles |

Détail des `SCR` de victoire (relus) : durées de 301 à 1631 ticks (5 à 27 s à 60 ticks/s nominaux ; 1 tick ≈ 17 ms réels), 1 à 185 images, sons de `SNDL` (12xxx = effets/voix, 13xxx, 16xxx, 17xxx = voix de personnages). Quatre ont un `hook` à l'image 0 (opcode `0x10`, argument 0) : 21100, 21700, 21900, 22600 (cyclage de palette, §3.7).

### 3.5 Boucle d'inactivité (`1040:0298`)

`Tick` : quatre « cases » exécutées en rotation (`DS:1d24`, 0 à 3), jusqu'à ce qu'une agisse (max 4 par appel) :

1. **Cas 0** : si `02b8 = 0`, une pièce est tenue (`57be ≠ 0`) et pas de réentrance (`1d26`) : si le bouton mémorisé est relâché (`1098:0437(57ce) = 0`) → son `6513` + `1040:0c24` (dépôt) ; sinon `1098:039b` (position curseur) → `1040:1005` (déplacement).
2. **Cas 1** : cyclage de palette actif (`57e4 ≠ 0`) et `57ec + 57ea ≤ tick` : une rotation d'une entrée (§3.7).
3. **Cas 2** : minuterie d'aide (`57d8 ≠ 0`) et `57da + 300 ≤ tick` : `57d8 = 0`, `1040:1989` (Poly enchaîne l'explication 35100 si l'aide est ouverte).
4. **Cas 3** : si un préchargement est en cours (`57e0 ≠ 0`) : `10c0:11dc(30, 0)` (fait avancer le chargement des ressources).

### 3.6 Entrée, sortie, effacement, transitions

**`Enter`** (`1040:0000`) :

1. `patterns.dat` (`DS:1d32`) ouverte et rendue courante (`DS:5772`) ; `1040:1a3b` initialise les tables (rectangles, rappels, groupes, descripteurs d'animation) ;
2. `8732 = 1` (cadence d'animation exacte), `57d0 = 57d8 = 57d4 = 57e0 = 57a6 = 0`, `3200 |= 1`, `31ce |= 1`, `3210 |= 1` ;
3. charge le son MIDI 100, le fond `SHPL` 103 (`1018:0000(3)`), les sons 6501 à 6506, groupes de gadgets, boutons (`1038:01af`), 8 bandes de fond (`10a8:1023`) ;
4. `1040:0809(1)` : menu du niveau 0 ; `10a8:12d1` : recopie vers l'écran ; stoppe les MIDI ; fondu de palette ; animation d'entrée `329e` ; si la musique est activée (`DS:2d64 ≠ 0`) → MIDI 100.

**`Exit`** (`1040:0422`, bouton 7) : `8732 = 0`, `10a8:0000(0)`, `Leave`, fondu de sortie (30 ticks), `1b20 = 0` (retour hub). **`Leave`** (`1040:012f`) : libère SCR/SHPL/sons/ports, `1018:0c0f(57e0)` annule le préchargement ; si `57d4 ≠ 0` → `1050:0302` (écriture du roster).

**Transitions** `1018:09b8` → `1018:0722` : balayage progressif de la zone, interrompu par un clic (`1098:04d9`). Utilisées : menu → (15 pas, zone `1c8c`) ; changement de niveau en cours de puzzle (30 pas, plein écran si `31ce & 1`, sinon 15 pas) ; choix d'un puzzle (15 pas, zone `1c8c`) ; mélange/Reset (30 pas, plein écran). Détail interne : hypothèse (fondu enchaîné entre le port de travail et l'écran).

### 3.7 Animation de victoire et cyclage de palette (`1040:1692`, `1040:1749`)

`1040:1692` : sablier ; `3210 &= ~1` (le tableau devient cliquable pour rejouer) ; sauvegarde de la palette 154 à 225 (`10a8:0d9c(72, 154)`) ; `10c0:11dc(-1,-1)` termine le préchargement ; si l'objet `3292` n'existe pas, `1090:1024` le charge, sinon `1090:138c(1)` le remet au début ; hook 0 posé à `1040:1749` ; `1090:111c` joue jusqu'au bout (interruptible selon les flags du descripteur) ; `57e4 = 0` ; restauration de la palette ; si la musique est activée, MIDI 100 relancé.

**Préchargement** : au choix du puzzle (`1040:0543`), `1018:0a04(0, 3296)` met en file les ressources `SHPL`, `SCR`, `SNDL` de l'animation de victoire et `57e0 = 1` ; le `Tick` cas 3 avance le chargement par paquets. Les boutons 1 à 4 l'annulent (`0454` : `1018:0c0f`, libère `3292`), sauf Reset/Rotate. `57e2` mémorise qu'un préchargement existait et le relance au retour de l'aide (`1040:18b8`).

**Hook `1040:1749(arg)`** (opcode `0x10` des SCR) : `arg ≠ 0` → `57e4 = 0` (arrête). `arg = 0` → démarre le cyclage selon `3296` :

| SCR | Puzzle | Entrées cyclées | Début (index de palette) | Nombre |
|---|---|---|---|---:|
| 21100 | Orange 3 : Tie dye | `0x9a` | 154 | 28 |
| 21700 | Orange 8 : Autoroute | 154 | 33 |
| 21900 | Rouge 2 : Boîtes volantes | 154 | 6 |
| 22600 | Rouge 9 : motif de verrière | 155 | 17 |

(21100 est `20000 + 900·1 + 100·2` = L1, k = 2 ; 21700 = L1, k = 8 ; 21900 = L2, k = 1 ; 22600 = L2, k = 8.) Période de 7 ticks (`57ea = 7`, ≈ 119 ms). À chaque période, `Tick` cas 1 décale la plage d'une entrée (la première passe en dernière) et réapplique la palette (`10a8:0dc4`). Ces `SCR` n'ont que 1 ou 2 images : **toute l'animation est le cyclage**.

### 3.8 Aide : Poly (`1040:17c7`, `067b`, `18b8`)

`Help` (bouton 4) : désactive le jeu (groupes remplacés par `DS:3286`, 4 ensembles : Poly, 8 pièces, 7 boutons, cadre), ouvre temporairement `POLLY.DAT` (`DS:5776`), sauvegarde la zone `(269, 274, 576, 432)`, charge les animations de base `32c2` et `32ce` et :

- première fois (`57d6 = 0`, valeur lue du roster) : `57d4 = 1` (sauvegarde à la sortie) et `SCR` 35100 (explication, 1820 ticks) ; sinon `SCR` 35250 (525 ticks) ; puis `57d6 = 1` ; `57d8 = 1` (minuterie 300 ticks) seulement si `57d4 = 0`.

Clic sur une zone en mode aide (`1040:067b(param)`), numérotation cumulée des ensembles : 1 = Poly ; 2 à 9 = les 8 pièces ; 10 à 16 = les 7 boutons (dans l'ordre de la table du §3.2 : 10, 11, 12 = visages ; 13 = Help ; 14 = Reset ; 15 = Rotate ; 16 = Exit) ; 17 = le cadre. Animation jouée dans `POLLY.DAT` :

| `param` | SCR |
|---|---|
| 1 | tirage `rnd(13)` → 37000 + 50·r (13 conseils, `1040:18b8` ; **referme** l'aide) |
| 2 à 9 (pièces) | 35650 |
| 10 à 12 (visages) | 35600 |
| 13 (Help) | 35550 |
| 14 (Reset) | 35750 |
| 15 (Rotate) | 35800 |
| 16 (Exit) | 35500 |
| 17 (cadre) | 35850 si le menu est affiché (`3200 & 1 = 0`), 35700 sinon |

(Ces `SCR` existent tous dans `POLLY.DAT` ; le sens de chaque phrase n'a pas été écouté : **hypothèse** sur le rôle d'après les noms des éléments et les entrées de `1040:067b`.) La séquence d'une explication : `32c2` (corps), puis le `SCR` principal `32da`, puis `32ce` (parties), selon le sous-ensemble (voir `1040:067b`).

## 4. Sons

Sons de `PATTERNS.DAT` ; durées mesurées (WAVE 11025 Hz). Rôle déduit des appels `1088:1498`/`1088:1125`.

| Id | Type, durée | Rôle |
|---:|---|---|
| 100 | MIDI | musique de fond, jouée à l'entrée et après chaque animation si `DS:2d64 ≠ 0` (préférence « audio » du moniteur Préférences) ; boucle par marqueurs MIDI |
| 101 | MIDI | jamais référencé par la scène (hypothèse : vestige) |
| 6501, 6502, 6503 | WAVE, 0,5 s | sons de survol/clic des boutons 1 à 3 (visages) ; table `DS:8490` (hypothèse sur l'association exacte aux événements) |
| 6504 | WAVE, 0,83 s | idem, quatrième entrée (hypothèse : Help) |
| 6505 | WAVE, 1,32 s | Reset (`1040:0500`) |
| 6506 | WAVE, 0,15 s | Rotate (`1040:11b2`) |
| 6510 | WAVE, 0,03 s | survol d'une vignette (`DS:196e`) |
| 6511 | WAVE, 0,10 s | clic sur une vignette (jouée et attendue en tête de `0543`) |
| 6512 | WAVE, 0,07 s | prise d'une pièce (`DS:1970`) |
| 6513 | WAVE, 0,02 s | dépôt (`DS:1971`) |
| 6520 à 6523 | WAVE, 2,0 à 3,2 s | voix de félicitation (hypothèse : phrases d'encouragement de Poly), 1 tirée au hasard par partie, jouée et attendue au moment de la victoire |
| 12005 … 17031 | WAVE, 0,06 à 20,8 s | effets et voix des animations de victoire, listés par `SNDL` de chaque `SCR` (§3.4) |
| 13106 | WAVE, 3,2 s | `SCR` 2000 (visages) |

Les sons sont préchargés (`1088:1125`) à l'entrée (100, 6501 à 6506), à l'affichage du menu (6510, 6511) et au choix d'un puzzle (6511, 6512, 6513, voix de fin). Il n'y a pas de repères `Cue#` exploités. Les sons de `POLLY.DAT` (aide) viennent de cette archive, ouverte temporairement.

## 5. Progression

- **Masque de réussites** (`u32` du joueur, bit `5 × opération + niveau`) : **non écrit** par cette scène (aucun appel de `1010:3fdf`, `1078:0a55`). Puzzle Patterns n'alimente ni le Hall of Fame ni le suivi.
- **Niveau courant** `DS:57a6` : volatil, remis à 0 à chaque entrée.
- **Variable de roster** (définition `DS:1d1a`, un bloc : destination `DS:57d6`, 1 mot de 2 octets) : `57d6` (u16, enregistrement du joueur, offset 5416, engine.md §7.1) = **« Poly a déjà présenté le jeu »** (0 = jamais ; mis à 1 à la première ouverture de l'aide). Écrit par `1050:0302` à la sortie si `57d4 ≠ 0` ; le rappel de réinitialisation `1040:19bf` remet `57d6` à 0 (nouveau joueur). Engine.md le qualifiait de « niveau/progression (hypothèse) » : c'est un simple drapeau.
- **Variables globales utilisées** : `DS:02b8` (mode de souris), `DS:2d64` (musique), tous deux de l'en-tête du roster (engine.md §7.1), réglés dans le moniteur Préférences (`1080:1495`, `1080:1469`).

## 6. Clavier, souris, adaptation tactile

- **Souris** : pas de survol continu : le gestionnaire `10a0` interroge la position à chaque tour de boucle ; le test des pièces est le rectangle englobant 61 × 121 (pas de test au pixel), pièce du dessus d'abord. Les trois boutons marchent (clic-clic) ; en glisser, le bouton de prise doit rester enfoncé.
- **Clavier** : **Espace** = rotation de la dernière pièce (`1040:1678`, scène `Key` renvoie vrai) ; Tab / Maj+Tab / Entrée : navigation des boutons par le gestionnaire (engine.md §5.3) ; Ctrl+Q global.
- **Adaptation tactile (conseil)** : le mode clic-clic est déjà la valeur par défaut du jeu ; sur tactile, utiliser « toucher pour prendre, toucher pour poser » (le centre colle au doigt, donc prévoir un décalage vertical visuel ou un glissé pur : en pur glisser, le centre est sous le doigt et le cache). Prévoir : (a) un appui long ou un geste pour tourner (en plus de Rotate, le bouton reste utilisable) ; (b) cibles : le bouton Rotate (33 × 32) est petit ; (c) la fenêtre de dépôt (étape de contenance +20 px) tolère 20 px d'imprécision ; (d) un « double tap » sur une pièce pourrait déclencher la rotation (extension à valider).

## 7. Différences avec le manuel de 1997 (v2, pages 23 à 24)

- Manuel : « eight rectangular pieces », « drag the pieces into place » ✓ ; « click the piece, then use the spacebar or drop the piece and click Rotate » ✓ ; « If a piece doesn't fit… click it and pull it somewhere else » ✓ (reprise d'une pièce posée).
- Manuel : **neuf tableaux par menu** ✓ (9 par niveau). Mais la v2 décrit un seul « Puzzle Menu » de neuf tableaux au premier écran, alors que la v1 a **trois menus de 9 selon le niveau** (boutons visages). Le tableau d'indices du manuel liste Vert (9), Orange (9), Rouge (7 seulement) : la v1 a 9 puzzles Rouges (Dominos et le motif de verrière absents des indices : peut-être retirés ou renommés en v2).
- Manuel : « Replay : cliquer le tableau fini » ✓ (`1040:066f`).
- Manuel : le cadre est « Puzzle Frame / Border » ✓ ; bouton « Level Brothers » ✓.
- Manuel v2 : « To start Puzzle Patterns, click the picture frame on Level 1 » : v1 a un seul étage (engine.md §8.1) ; sans incidence ici.
- Manuel : musique réglable par le moniteur Préférences (« ambient music ») ✓ (`DS:2d64`), « click-and-stick par défaut » ✓ (`DS:02b8`).

## 8. Plan d'implémentation TS

### 8.1 Module pur `src/games/mathemagique/patterns/logic.ts` (aucune dépendance DOM, testable)

```
export const GRID = { x: 78, y: 76, cell: 60, cols: 4, rows: 4 }
export const PLAY_RECT = { left: 49, top: 47, right: 348, bottom: 346 }
export const TOOLBAR_NO_GO = { left: 0, top: 354, right: 351, bottom: 432 }
export interface Puzzle { orient: Uint8Array /*8*/; col: number[] /*8*/; row: number[] /*8*/ }
export function parsePuzz(bytes: Uint8Array): Puzzle                 // §2.1
export const puzzleId = (level: number, k: number) => 6600 + 450*level + 50*k
export const animId   = (level: number, k: number) => 20000 + 900*level + 100*k
export const thumbsShplId = (level: number) => 6520 + 10*level
export interface Piece { id; placed; rot; col; row; w; h; cx; cy; rect }  // §2.3
export function pieceRect(cx, cy, w, h): Rect                       // gauche = cx - floor((60w+1)/2) …
export function rotatePiece(p, screen): Piece                       // swap w/h, rot=(rot+1)&3, clamp du centre
export function deal(puzzle: Puzzle, rng: (n:number)=>number): Piece[]  // §1.3, rang 0 = dessus
export function clampCenter(p, screen): {cx, cy}                    // §1.4
export function pushOutOfToolbar(p): {cx, cy}                       // §1.4 dépôt étape 1
export function trySnap(p, others: Piece[]): {cx, cy, col, row} | null  // §1.5
export function liftPiece(pieces: Piece[], rank: number): Piece[]   // remonte au rang 0, désaimante, re-aimante les libres
export function dropPiece(pieces, screen): Piece[]                  // pushOut + trySnap
export function isSolved(pieces, puzzle): boolean                   // §1.7
export function rng(seed): (n:number)=>number                       // LCG MSVC : s = s*0x343fd + 0x269ec3 (mod 2^32); (s>>>16) % n
```

### 8.2 Machine à états de scène `PatternsScene`

États : `menu` ⇄ `playing` (pièce tenue ou non) → `solved` (animation, puis replay possible) ; `help` (modal, Poly). Entrée : `menu`, niveau 0. Événements : clic vignette, boutons 1 à 7, pointeur (prise, déplacement, dépôt selon `dragMode`), Espace, tick (minuterie d'aide 300 ticks, cyclage de palette 7 ticks, préchargement). `Exit` retourne au hub avec fondu. Au `Leave`, écrire le roster si `introSeen` vient de passer à 1.

### 8.3 Services moteur nécessaires

- Lecteur `PUZZ`, `SHPL`, `SHAP`, `SCR`, `SNDL` (existants dans `data/`) ; ajouter `parsePuzz`.
- Lecteur d'animation `\0SCR` avec hooks (hook 0 → cyclage de palette) et jeu des sons de `SNDL` ; arrêt anticipé au clic.
- Gadgets : boutons à deux états, survol (vignettes : cadre coloré 4 px), test de survol personnalisé des pièces.
- Palette : plages réécrites par `SHPL` (puzzle 154 à 225/233), cyclage d'une plage toutes les 7 ticks, fondu 30 ticks sur 10 à 245.
- Audio : WAVE + un MIDI en boucle, arrêt de tous les MIDI à la victoire, attente de fin d'un WAVE.
- Roster : flag `introSeen`, préférences `dragMode` (défaut clic-clic) et `music`.
- Port arrière : sauvegarde/restauration de la zone sous la pièce tenue (en navigateur : redessin complet suffit).

### 8.4 Tests unitaires (valeurs attendues tirées du code et des données)

- `parsePuzz(PUZZ 6600)` : `orient` tous à 0, positions `[(0,0),(0,2),(1,0),(1,2),(2,0),(2,2),(3,0),(3,2)]` ; `PUZZ 6650` : `orient = [0,0,1,1,1,1,0,0]`, positions `[(0,0),(1,0),(2,0),(2,1),(0,2),(0,3),(2,2),(3,2)]` ; les 27 pavent la grille.
- Identifiants : `puzzleId(0,0) = 6600`, `puzzleId(2,8) = 7900`, `animId(1,2) = 21100`, `animId(2,8) = 22600`, `thumbsShplId(2) = 6540`.
- `pieceRect` : centre `(198, 196)`, `w = 1`, `h = 2` → `(168, 136, 229, 257)`.
- `trySnap` : cet exemple → `cx' = 228`, `cy' = 196`, `col = 2`, `lig = 1` (§1.5). Centre `(138, 136)` vertical (`gauche = 108`, `o = 30`) → `(108-78+30) mod 60 = 0`, décalage `+30` → `gauche' = 138`, `col = 1`. Un coin hors de `(58, 56, 338, 336)` → `null`.
- Collision : une pièce aimantée tombant sur une pièce libre qui la chevauche de ≥ 1 px (rectangles rétrécis de 1 px) → `null` ; contact exact par un bord → autorisé.
- `pushOutOfToolbar` : pièce de bas = 380 et gauche = 300 → `dx = 351 - 300 = 51`, `dy = 380 - 354 = 26` → poussée vers le haut de 26 ; gauche = 340 → `dx = 11 < dy` → poussée à droite de 11.
- `rotatePiece` : 4 rotations ramènent l'état initial ; `w`/`h` échangés à chaque quart de tour ; `rot` modulo 4.
- `deal` : permutation d'ids ; rang `s` : centre `(513 - 29·(s mod 4), [315, 156][s div 4] - 17·(s mod 4))` ; `rot ∈ {orient, (orient + 2) mod 4}`.
- `isSolved` : tous placés à `(col, lig)` du `PUZZ` avec `rot = 0` ; faux si un `rot ≠ 0` ou une pièce libre.
- `rng` : état 0 → premier état `0x269ec3`, `rnd(8) = 0x26 mod 8 = 6`, `rnd(4) = 2`, `rnd(2) = 0`.

## 9. Questions ouvertes

1. **Mode de blit** 8 (boutons, cadre) vs 0 (pièces, vignettes) : sémantique non établie (engine.md §10 q. 4) ; rendu de contrôle : index 0 transparent.
2. **Zone `DS:8bce`** (écran de jeu pour la restriction du centre) : supposée 0, 0, 576, 432 ; non initialisée statiquement.
3. **Association exacte des sons** 6501 à 6504 aux événements (survol, appui, relâchement, par bouton) : table `DS:8490` non reliée au code du gestionnaire `10a0`.
4. **`1088:10d2(30, 0)`** dans Reset : rôle du compteur 0 (`DS:871a`, 30 ticks) non retrouvé.
5. **Transitions `1018:0722`** : algorithme exact (balayage, fondu ?) non étudié ; interruptibles au clic.
6. **Aide Poly** : ordre exact des animations de base `32c2`/`32ce`/`32da`/`32aa`/`32b6`, `1040:19ca` (`1018:058e` avec `0x18d`/`0x166`), choix des `SCR` ; textes non écoutés.
7. **Forme 10 (80 × 80)** des `SHPL` 6520/6530/6540 : inutilisée par cette scène (vignette sélectionnée dans un autre jeu ?).
8. **Contenu exact** de quelques vignettes Rouge (noms) et écart avec le manuel v2 (7 puzzles Rouges seulement).
9. **Graine du hasard** (`1098:060f`, horloge ?) ; mélange non uniforme (échanges avec `rnd(8)` pour tout `i`).
10. **Valeur initiale de `DS:57d6` à la création d'un joueur** : fournie par la définition de sauvegarde (`1040:19bf` remet 0) ; non vérifié sur un roster réel.
11. **Mode de souris** : le test de survol `1040:0f97` n'est évalué que si le gestionnaire appelle la méthode `+0x28` du groupe 0 à chaque idle ; comportement exact du second clic en mode clic-clic (capte-t-il aussi les clics sur les boutons ?) à vérifier visuellement.

## 10. Écarts avec les documents existants

- `engine.md` §5.3 : la touche Espace de Puzzle Patterns n'est pas « puzzle suivant / aide » mais **Rotation** (`1040:1678` → `1040:11b2`).
- `engine.md` §7.1 : la variable de scène `57d6` (offset 5416) n'est pas « niveau/progression » mais « Poly a présenté le jeu ». L'en-tête du roster : `DS:2d64` est la **préférence musique** (activée par défaut), pas « le drapeau des phrases d'attente de Poly » ; `DS:02b8` est le **mode de souris** (1 = clic-clic). Les deux sont lus par toutes les activités de puzzle (`1030:*`, `1040:*`, `1048:*`).
- `engine.md` §8.4 : « 6600–7900 par 50 pour Patterns » exact, mais l'identifiant du `SCR` de victoire (`20000 + 900·L + 100·k`) n'y figure pas. « 5 niveaux » n'est pas pertinent ici : **3** niveaux sans bonus.
- `engine.md` §9 (`PUZZ`, 40 octets) : exact ; le format est donné au §2.1.
- `formats.md` : `PUZZ` y est « à étudier » : cette note en donne la structure complète pour Patterns.
- `re-index.md` : les noms `scene_patterns_*` correspondent ; les fonctions `1040:0454`, `0543`, `066f`, `067b`, `0949` sont des rappels de gadgets (boutons, vignettes, replay, aide, pièces).

## 10. Implémentation (tâche H5)

Code : `src/games/mathemagique/scenes/patterns.ts` (`createPatternsScene(services)`, classe `PatternsScene`) et `scenes/patterns-view.ts` (identifiants, table des 7 boutons, zones de l'aide, plages de cyclage ; pur). Tests : `test/mathemagique/patterns-scene.test.ts` (aides pures, puis la scène complète sur le vrai `PATTERNS.DAT` / `POLLY.DAT`, ignorée sans `original/mathemagique/`). La règle du jeu vient du noyau `game/puzzle-kit.ts` (`PatternsBoard`, `PuzzleSession`, `attachBoard`) et de `game/poly.ts` ([../game-kit.md](../game-kit.md)). Aucune copy : tout est image ou voix.

### 10.1 Déroulé

- `load` ouvre `PATTERNS.DAT` et `POLLY.DAT` (portée « scène » : libérées par le moteur à la bascule, pas d'appel à `releasePolyArchive`). `enter` : `useArchive`, palette de la `SHPL` 103, fond 103 gardé dans une surface `base` (sans bouton), groupes de gadgets, plateau branché sur le pointeur, `PolyHelper`, menu du niveau vert (le niveau n'est jamais sauvegardé), fondu d'entrée de 30 ticks, animation `SCR` 2000 des visages (non bloquante, drapeaux `0x11`). La musique (`SND` 100, boucle, soumise à « Ambient Sounds ») démarre à la fin de cette animation, comme `Enter`.
- **Dessin** : `decor` = fond + vignettes (menu) ou + cadre-indice (forme 1 de la `SHPL` du puzzle, en `(48, 46)`, mode 8) ; `paint()` recopie `decor`, pose le cadre de survol (masque 1 bit, forme 10 de la `SHPL` des vignettes, couleur 77 / 61 / 79, rect agrandi de 4 px) ou les huit pièces (forme `4·id + rot + 2`, mode 0, le rang 0 au-dessus), puis redessine tout de suite les boutons (gadgets, formes de la `SHPL` 6500 : repos et enfoncé) pour éviter un clignotement. Pendant l'aide et les animations, la scène ne repeint pas.
- **Palette** : menu = `SHPL` 6520 / 6530 / 6540 (entrées 154–188) ; puzzle = **seulement les entrées 154–225** de sa `SHPL` (`paletteSlice`). Vérifié sur les données : les `SHPL` à 236 couleurs diffèrent de celle du fond en dehors de 154–225, les appliquer entières casserait le fond.
- **Boutons** (7 gadgets, ordre de la table `DS:1c1c`) : niveaux (re-menu, voir `PuzzleSession.pressLevel`), Help, Reset (désactivé dans le menu), Rotate, Exit. Sons d'appui : 6501–6503 (visages), 6504 (Help) ; 6505 (Reset) et 6506 (Rotate) joués quand l'action a lieu. Vignettes : 9 gadgets (6511 à l'appui), survol suivi par la scène (6510 et cadre).
- **Pièces** : `attachBoard` ; la prise est refusée si l'aide est ouverte, si une attente est en cours ou si les pièces sont désactivées (puzzle résolu). Sons 6512 (prise) et 6513 (dépôt, dans les deux modes de souris). Espace : consommée sauf Poly à l'écran, répétition clavier ignorée. Rotation d'une pièce **portée** : le pointeur garde les dimensions de la prise, la scène reprend donc la pièce (`pointer.carry`, centre sous le curseur, sans second son de prise).
- **Victoire** (machine `flow`) : `markSolved`, sablier, MIDI coupé, voix `6520 + rand1(4)` sur le canal voix **attendue** (garde-fou de 400 ticks si le son est muet), puis `SCR 20000 + 900·L + 100·k` en mode bloquant (drapeaux `interruptible | fastForwardOnInterrupt | waitSounds` : hypothèse, le descripteur `3292` n'est pas documenté ; un clic saute à l'image finale). Hook 0 d'argument 0 : cyclage de la plage du §3.7 (21100, 21700, 21900, 22600), une rotation toutes les 7 ticks ; à la fin, palette 154–225 rétablie (instantané pris au début), musique relancée, curseur normal. Cliquer le tableau résolu rejoue (même chemin, sans voix). Reset après victoire réactive les pièces.
- **Aide** : `PolyHelper` (arrivée 35000, 35100 la 1re fois pour le joueur courant puis 35250, explications, réplique 37000 + 50·r puis départ 35050). Pendant l'aide les groupes sont fermés ; les clics et le survol sont traduits en zones (`helpZoneAt` : Poly, pièces, boutons, cadre ; télé du menu → 35850, du jeu → 35700). Les boutons sont redessinés **avant** l'ouverture de Poly, qui est composée par-dessus. Le drapeau du roster `patternsPolyIntroSeen` est enregistré dans `leave` (`ctx.roster.save()`, seulement avec un joueur connecté).
- **Sortie** : Exit ou `exit()` (demande du moteur) : aide abandonnée, animations et sons coupés, fondu au noir de 30 ticks, puis `ctx.scenes.request(SceneId.hub)`. Le fondu au noir est **tenu** ; la scène suivante doit lancer son propre fondu (`fadeFromBlack`) ou `clearFade()`.

### 10.2 Écarts et hypothèses

- **Transitions** (balayage / stores vénitiens de `1018:09b8` au changement de niveau, au choix d'un puzzle et au Reset) : non reproduites, l'écran change d'un coup (`engine/graphics/transitions.ts` existe, à brancher si on les veut).
- **Bouton enfoncé** : la forme enfoncée (31 × 31) est posée à l'origine du bouton au repos, pas à l'origine du rectangle « appuyé » (décalage de 2 px en x et 1 px en y perdu : les gadgets n'ont qu'une origine par enregistrement).
- Sons 6501–6504 : association aux boutons par hypothèse (question ouverte 3) ; Exit sans son.
- Animation des visages (`SCR` 2000) lancée non bloquante ; une Entrée au clavier sur Help qui finit son clignotement (30 ticks) pendant l'aide redessinerait le bouton par-dessus Poly (cas limite non traité).
- Pas de préchargement des ressources de victoire (les archives sont en mémoire, le décodage est synchrone).
- Rotation d'une pièce portée en mode glisser : la prise reprise n'est plus surveillée par tick (un bouton perdu sans événement ne dépose plus ; le relâchement normal dépose).

### 10.3 Tests

Cliquer-poser et glisser jusqu'à la victoire (voix 6520–6523 sur le canal voix puis `SCR` 20000 / 20100), cyclage de 21100 (plage 154–181, période 7, hors plage immobile, palette rétablie), victoire sans cyclage (palette intacte), clic qui coupe l'animation, replay, Reset (mélange identique à `dealPatterns` sur le hasard courant, aussi après la victoire), repoussée du cartouche, Espace / Rotate, survol (6510 et cadre), niveaux, aide complète (arrivée, présentation, pièce, Rotate, Poly, départ, flag du roster enregistré, pièces et boutons gelés), présentation courte à la 2e ouverture, Exit et `engine.requestExit()`, chargement des 27 puzzles.
