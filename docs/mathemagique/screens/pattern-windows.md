# Pattern Windows (scène 3, `PATFILL.DAT`) : étude de rétro-ingénierie

Tâche E4. Adresses `sélecteur:offset` de la décompilation Ghidra de `MATH` (segment de code `1060` = fichier `archives/mathemagique/re/MATH/decomp/1060_*.c`, segment de données `1108`). Cadre général : [engine.md](engine.md), index : [re-index.md](re-index.md), scripts : [scr.md](scr.md). « Hypothèse » marque une déduction non vérifiée. Le DS (`1108:xxxx`) est abrégé en `DS:xxxx`.

**Constat de cadrage : Pattern Windows n'est pas un jeu à énigmes.** Il n'y a ni problème, ni bonne/mauvaise réponse, ni score, ni niveau, ni masque de réussite. C'est un **coloriage de vitrail** (10 motifs géométriques, 15 couleurs, 3 sauvegardes par motif, kaléidoscope de palette, impression, aide de Poly). Le « concept mathématique » est géométrique (formes, symétries, coloriage de carte : « combien de couleurs sans que deux zones voisines soient identiques ? », manuel p. 41). Les rubriques « génération de puzzle / vérification / score » du cahier des charges sont donc traitées comme « sans objet », en gardant les seuls éléments aléatoires (quelques animations de Poly, outils cachés).

Ressources `PATFILL.DAT` : `\0SCR` 28, `\0SND` 73, `PTRN` 10, `SHAP` 378, `SHPL` 34, `SNDL` 28, `STRL` 1.

## 1. Règles et comportement

### 1.1 Ce que fait l'enfant

1. Il choisit une couleur (15 pastilles, ou touches `x`/`z`), puis clique ou **glisse** dans la fenêtre : chaque pièce touchée prend la couleur courante.
2. Re-cliquer une pièce **déjà de la couleur courante** passe en mode « effacement » pour ce geste : les pièces touchées reprennent la valeur de l'instantané (§1.4). C'est le « click that piece again » du manuel.
3. Boutons : Imprimer, Kaléidoscope, flèches de motif (précédent/suivant), Robinet (« Faucet » : remplit tout avec la couleur courante), Aide (Poly), « Yuck! » (annuler/rétablir), Sortie, trois numéros de version (3 peintures par motif), pastille de nom (change de joueur).
4. Tout est sauvegardé automatiquement (§5).

### 1.2 Pas de génération de puzzle

Rien n'est tiré au sort pour le dessin : un motif est entièrement décrit par sa ressource `PTRN` (§2.1) et ses masques `SHAP`. Les seuls tirages :

| Tirage | Où | Règle |
|---|---|---|
| RNG | `10a8:1473(n)` | LCG 32 bits `seed = seed × 0x343FD + 0x269EC3` (`DS:38f4`), résultat `(seed >> 16) mod (n+1)`, 0 si `n = 0` ; la graine est initialisée par `10a8:1460` (sur l'heure : hypothèse). `1018:04e1(max, min)` = `min + rand(max - min)` (bornes incluses). |
| Tirage sans répétition | `10a8:13af(masque0, n, &historique)` | tire `rand(n-1)` (hypothèse sur `14c1`), avance (modulo `n`) jusqu'à un bit libre de l'historique, le marque ; quand tout est pris, l'historique est remis à `masque0`. Historique à `DS:20d0` (dword). |
| Réplique de Poly à la sortie de l'aide | `1060:03d5` cas 1 | `13af(0, 11, 20d0)` choisit l'entrée d'une table de 11 `\0SCR` (§3.5). |
| Compliment | `1060:03d5` cas 1 | si l'image est « variée » (§1.6) et `04e1(100, 0) < 20` (20 chances sur 101), l'animation 1800 remplace la réplique. |
| Son du bouton Aide | `1060:008a` cas 6 | `04e1(100, 1) < 51` (50 sur 100) → son 3013, sinon 3012 (écrit dans `DS:2462`, §4). |
| Mode caché « couleurs aléatoires » | `1060:14eb` cas 4 | `04e1(14, 0)` par cellule, soit **0 à 14 inclus** (`PUSH 0xe` : `1060:156b`). |

### 1.3 Modèle de données de la peinture

- Chaque motif = un **réseau de tuiles** ; chaque tuile contient `n` **cellules** (`n` = champ `h[0]` du `PTRN`) ; chaque cellule est une pièce colorable dont la forme est un masque 1 bit (`SHAP` 40200 + …).
- Le tampon de travail `DS:7053` contient **524 octets** (`0x20c`), 1 octet par cellule (valeur 0 à 14 = indice de couleur) ; `DS:725f` est la copie d'instantané (même taille, 131 dwords : `1060:18c9`).
- Remplissage initial d'un vitrail neuf : octet `0x77` partout dans le stockage, soit **couleur 7 = bleu clair (123,204,255) = la couleur du ciel du fond** (`1060:0d65`). « Non peint » n'est donc pas une valeur spéciale : c'est la couleur 7, qu'on peut aussi choisir avec la pastille bleu clair.

### 1.4 Algorithme de peinture (`1060:03d5` cas 1, `1060:0fe8`)

Clic sur la fenêtre (entrée 0, `param = 1`) :

```
si (annulation active DS:20b4) { DS:20b4 = 0 ; instantané ← tampon (18c9(1)) }
premier = 1 ; mode = 0
tant que bouton gauche enfoncé (1098:0437(1)) :        // sondage, pas d'évènement souris
    pos = GetCursorPos
    peindre(pos)
peindre(pos) :   // 1060:0fe8 ; s'arrête après UNE cellule modifiée
    parcourir lignes r, tuiles i, cellules j dans l'ordre d'indice croissant :
        si pos hors du rectangle (x, y, x+largeur h[2], y+hauteur h[1]) de la tuile : saute n cellules
        pour chaque cellule : si le bit de pos dans le masque (SHAP 40199+base+j, pas = mot BE à +4 de l'en-tête,
                               bit 0x80 >> (dx & 7)) est à 1 :
            si premier { premier = 0 ; si tampon[c] == couleur courante : mode = 1 }
            si mode == 0 : si tampon[c] != couleur courante : tampon[c] = couleur ; modifiée
            sinon        : si tampon[c] != instantané[c]     : tampon[c] = instantané[c] ; modifiée
            si modifiée : DS:7042 = c ; écrit l'octet de stockage (§1.5) ; redessine la cellule (masque en couleur 180 + valeur) ; retour
```

Remarques : (a) une cellule dont le pixel est dans le masque mais **sans changement** n'arrête pas le parcours (les rectangles des tuiles se chevauchent) ; (b) l'« effacement » restaure l'instantané, pas le bleu : l'instantané est pris à l'entrée, à chaque changement de version/motif (`18c9(1)` dans `1060:0000`, `1060:008a` cas 3/4), à chaque **changement de couleur** (`03d5`, touches `x`/`z` `1786`), avant un Robinet (`008a` cas 5) et à la fin d'un « Yuck ! » dans l'état annulé ; (c) `DS:7042` = dernière cellule peinte (utilisée par les outils cachés).

### 1.5 Stockage et sauvegarde

`1060:1271(sens)` convertit entre le tampon (1 octet/cellule) et le stockage (2 cellules/octet : **cellule paire = quartet bas, impaire = quartet haut**). `sens = 1` : lecture du stockage vers `7053` ; `0` : écriture. `DS:704f` garde l'adresse du stockage du motif courant ; `1060:169c(i)` met à jour l'octet `i >> 1` à chaque cellule peinte (sauvegarde en temps réel dans le tampon de roster).

Stockage dans `DS:5bb2` (5 262 = 3 × 1 754 octets) : **version `v` (0–2) × 0x6da + déplacement du motif**. Tailles par motif (octets, `1060:1271`) et déplacements dans une version :

| Motif | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| nom (`STRL` 40000) | Checker | Triangles | Crosses | Stars | Links | Lace | Cubes | Turtle Shell | Hooks | Circles |
| octets | 200 | 168 | 234 | 206 | 138 | 262 | 128 | 88 | 204 | 126 |
| déplacement | 0x000 | 0x0c8 | 0x170 | 0x25a | 0x328 | 0x3b2 | 0x4b8 | 0x538 | 0x590 | 0x65c |
| cellules (`PTRN`) | 400 | 336 | 468 | 412 | 276 | 522 | 255 | 176 | 405 | 252 |

Pour les motifs 5 et 8, l'allocation a 1 octet de plus que `⌈cellules/2⌉` (262 contre 261, 204 contre 203) : marge inutilisée (hypothèse).

Un vitrail « jamais touché » a tous ses octets à `0x77`. Le défaut de roster (`1060:0d65`, appelé par la définition de sauvegarde `DS:211a`) : motif 0, versions 0, couleur 0, stockage `0x77`, `746b = 0`.

### 1.6 Boutons : sémantique complète

La fonction de rappel du groupe 1 est `1060:008a(k)`, `k` = rang du bouton + 1 (§3.2). Tous les rappels commencent par **arrêter le kaléidoscope** (`1627(1,15,180)`) et **le clignotement des flèches** (`1c2c(1)`).

| `k` | Bouton | Effet |
|---|---|---|
| 1 | Imprimer | `1050:0302` (sauvegarde roster) ; si mémoire libre `< 130 000` octets (`1000:2d5c`) : message `Not enough memory to print!` (`DS:2552`) et abandon ; sinon sablier, désactive les gadgets (`88b4 |= 1`), **arrête la musique**, imprime le rectangle `(51, 45, 394, 388)` du port de travail (fenêtre agrandie de 1 px) via `1088:0000`, document « Stained Glass » (`DS:2f28`), puis relance la musique (si `2d64 ≠ 0`). |
| 2 | Kaléidoscope | si pas déjà actif : copie les 15 entrées de palette 180–194 dans `DS:7535` (`10a8:0d9c`), `74d1 = 1`, `74ed = tick`, `74f1 = tick + 300`. Tick (`0bb0`) : tous les **8 ticks** (`74ed + 7 < tick`) rotation d'un cran (`1627(0,15,180)`) ; **à `tick > 74f1`** (300 ticks ≈ 5 s) ou au clic sur n'importe quel bouton : restauration de la palette d'entrée (`74f9`). |
| 3 / 4 | Flèche gauche / droite | motif ← `(motif - 1)` avec 0 → 9, ou `(motif + 1)` avec 9 → 0 ; recharge version courante du nouveau motif (`1271(1)`), `PTRN` (`1735`), titre, redessin, instantané. La version retenue est celle mémorisée dans `DS:7044[motif]`. |
| 5 | Robinet | instantané (`18c9(1)`), tout le tampon (524 cellules) ← couleur courante (`14eb` mode 0), pack, redessin. Outils cachés : voir ci-dessous. |
| 6 | Aide | voir §1.7. |
| 7 | Yuck ! | `1ade` compare tampon et instantané (131 dwords) ; s'ils diffèrent : `20b4 ← !20b4`, **échange** tampon ↔ instantané (`18c9(0)`), pack (`1271(0)`), redessin. C'est donc un bouton d'annulation **qui se rétablit en re-cliquant**. S'ils sont identiques : rien. |
| 8 | Sortie | `scene_patwin_exit` (`0d22`) : restaure la police, sablier, archive courante `0`, `Leave` (`0a8e` : roster sauvé si `20b8`), arrête tous les MIDI, fondu vers le noir `1b25(1, 30, 236, 10, 0)`, `1b20 = 0` (hub). |

**Outils cachés du Robinet** (probablement un œuf de Pâques de développeur ; hypothèse sur l'intention) : actifs seulement si **Ctrl était enfoncé à l'entrée de la scène** (`1098:036f(0) == 0x400`, `DS:20e0 = 1`). Le mode dépend de la position du clic dans le bouton Robinet `(453..482, 369..397)` (`008a` cas 5, marge 7 px) : `dx = x - 7 ≥ 453`, `dx' = x + 7 ≤ 482` :

| Zone du clic | Mode | Effet (`1060:14eb`) |
|---|---|---|
| bande haute (`y - 7 < 369`), gauche (`dx` faux) | 1 | décale les cellules d'un cran vers le début (rotation circulaire sur 524) |
| haute, centre | 4 | cellules aléatoires 0–14 |
| haute, droite | 2 | décale d'un cran vers la fin (rotation circulaire) |
| bande basse (`397 < y + 7`), gauche | 3 | colore avec la couleur courante la cellule de même rang dans **chaque tuile** (`i = DS:7042 mod n`, pas `n`) |
| basse, centre | 6 | inversion `c ← 14 - c` |
| basse, droite | 5 | recopie la tuile de la dernière cellule peinte sur tout le tampon (cycle de `n` cellules) |
| bande médiane, `dx` vrai | 0 | remplissage normal |
| bande médiane, `dx` faux (bord gauche) | 7 | dégradé `c = i mod 15` |

Les modes 3 et 5 ne font rien si `DS:7042 < 0` (aucune cellule peinte depuis l'entrée ; `7042` initialisé à `0xffff` par `Enter`).

### 1.7 Aide de Poly (mode « ? »)

État `DS:74e3` (« mode aide ») : `1060:1a41(1)` l'active, `1a41(0)` le quitte.

- Entrée (`008a` cas 6, bouton Aide) : son 3012 ou 3013 ; arrête la musique ; mode aide ; joue **1200** (Poly arrive, non interruptible) ; si `746b == 0` (jamais vu) : `0a68(0)` joue **1700** (long discours de 27 s) et met `746b = 1` ; sinon `74e5 = 0` et joue **1500** (7 s, interruptible) ; dessine la main « stop » (`1bcc`) ; si `74e5 == 0`, `74e7 = tick`.
- Pendant l'aide : en mode aide les entrées 0 à 17 des gadgets sont **désactivées** (bit 1 de `+0x12`) sauf l'entrée 17 « plein écran » qui capte tous les clics ; les groupes 0 et 1 sont masqués (bit 0). Chaque clic appelle `03d5` (cas 2 du `switch (local_4)` = rectangles d'aide §3.3). L'animation de Poly dépend de la zone cliquée : `2300` (courte entrée en matière) puis l'animation propre à la zone, sauf si la première a été interrompue par un clic. Les zones Aide (5) et Sortie (7) n'ont pas d'entrée en matière.
- Inactivité : si `74e7 ≠ 0`, `74eb = 0` (aucune animation en cours), `74e5 = 0` et `tick > 74e7 + 300`, `Tick` fixe `74e5 = 1` et rejoue `0a68(1)` : **1700 est rejoué de force** (argument 1), puis redessine la main. `74e5` passe à 1 dès que la souris survole une zone d'aide (`1aa3`).
- Sortie de l'aide (clic sur Poly ou la main, zone 1) : tire `13af(…, 11, 20d0)` → `{1900, 2500, 2600, 2700, 2800, 2900, 3000, 3100, 3200, 3300, 3400}` (table `DS:20ba`) ; si l'image est « variée » (`1b2d` : on compte les cellules par couleur sur `min(2 × 74d3, 524)` cellules, `seuil = ⌊n/3⌋ × 2` ; vrai si **aucune couleur ne dépasse le seuil**, soit aucune couleur sur plus des deux tiers) et `04e1(100,0) < 20` : **1800** à la place ; joue (interruptible), puis **1300** (Poly part, non interruptible), `1a41(0)`, relance la musique (si `2d64 ≠ 0`), `74e7 = 0`.

## 2. Formats

### 2.1 `PTRN` (10 ressources, ids `40500 + 500 × motif`)

**100 octets exactement**, 50 mots **big-endian** signés (relus par `10a8:058c` puis octets échangés par `1060:16d3(100, &746d)`) dans `DS:746d`…`74d0` (`1060:06f4` `0x08c3`, `1060:1735`). Aucun octet au-delà.

| Mot | Adresse DS | Nom | Sens |
|---|---|---|---|
| `h[0]` | `746d` | `n` | cellules par tuile (= nombre de masques du motif) |
| `h[1]` | `746f` | `hauteur` | hauteur du rectangle d'une tuile (= hauteur des masques) |
| `h[2]` | `7471` | `largeur` | largeur du rectangle d'une tuile |
| `h[3]`, `h[4]` | `7473`, `7475` | origine | décalage par rapport au coin haut-gauche de la fenêtre `(52, 46)` (`1060:0fa5`) |
| `h[5]`, `h[6]` | `7477`, `7479` | pas de tuile | déplacement d'une tuile à la suivante dans une ligne |
| `h[7]`, `h[8]` | `747b`, `747d` | pas de ligne | déplacement du départ d'une ligne à la suivante |
| `h[9]` | `747f` | `lignes` | nombre de lignes (≤ 20) |
| `h[10…29]` | `7481` | `saut[r]` | nombre de pas `(h[5],h[6])` avant la 1re tuile de la ligne `r` |
| `h[30…49]` | `74a9` | `nb[r]` | nombre de tuiles de la ligne `r` |

Position de la tuile `i` de la ligne `r` : `x = 52 + h[3] + r·h[7] + (saut[r] + i)·h[5]`, `y = 46 + h[4] + r·h[8] + (saut[r] + i)·h[6]` (`1060:0e35`). Cellule `j` (0 ≤ j < n) de cette tuile : masque `SHAP` d'indice `base[motif] + j` dans la `SHPL` 40200 (1-basé), soit `SHAP 40199 + base + j`, dessiné en (x, y) ; `base` = table `DS:252e` = `[1, 5, 9, 21, 25, 31, 40, 43, 47, 52]`. Indice de cellule = compteur courant (ligne, tuile, `j`), incrémenté de `n` pour une tuile.

Valeurs décodées (`h[0..9]` puis lignes) :

| Motif | `h[0..9]` | `saut` | `nb` | cellules |
|---|---|---|---|---|
| 0 Checker | 4, 35, 35, 0, 0, 34, 0, 0, 34, 10 | 0 ×10 | 10 ×10 | 400 |
| 1 Triangles | 4, 57, 49, -39, -29, 32, 0, 0, 56, 7 | 0 ×7 | 12 ×7 | 336 |
| 2 Crosses | 12, 69, 69, -34, -17, 68, 0, -34, 51, 7 | 0,1,1,2,2,3,3 | 6,5,6,5,6,5,6 | 468 |
| 3 Stars | 4, 59, 54, 1, -47, 42, 0, -21, 38, 11 | 0,0,0,1,1,2,2,3,3,4,4 | 9,9,10,9,10,9,10,9,10,9,9 | 412 |
| 4 Links | 6, 82, 115, -57, -25, 65, -16, -17, 64, 8 | 0,0,0,0,1,1,2,6 | 4,6,7,7,7,7,6,2 | 276 |
| 5 Lace | 9, 69, 71, -55, -30, 70, -29, -21, 49, 13 | 0,1,1,1,2,2,2,2,3,3,5,6,8 | 2,3,4,5,5,6,6,6,6,6,4,3,2 | 522 |
| 6 Cubes | 3, 44, 44, -19, -33, 43, -14, -14, 43, 13 | 0,0,1,1,1,2,2,2,3,3,5,8,11 | 1,4,6,9,9,8,9,9,8,9,7,4,2 | 255 |
| 7 Turtle Shell | 4, 61, 91, -45, -50, 80, -40, -20, 60, 12 | 0,0,0,1,1,1,1,2,3,4,6,7 | 1,2,4,4,5,6,6,5,4,4,2,1 | 176 |
| 8 Hooks | 5, 57, 71, -37, -43, 56, -28, -14, 42, 16 | 0,0,0,1,1,1,1,2,2,2,3,3,5,6,8,9 | 1,2,4,4,6,7,8,7,7,7,7,7,5,4,3,2 | 405 |
| 9 Circles | 7, 78, 76, -28, -34, 66, 0, 0, 68, 6 | 0 ×6 | 6 ×6 | 252 |

(Avec `h[1]` = hauteur et `h[2]` = largeur : le motif 1 utilise des masques 49 × 57 en `SHAP` ; `h[1..2] = 57, 49`. Les masques sont vérifiés égaux à ces dimensions pour les 10 motifs.) Masques : `SHAP` 40200–40257 (58 masques 1 bit) ; nombre par motif = `h[0]` = 4, 4, 12, 4, 6, 9, 3, 4, 5, 7.

### 2.2 `STRL` 40000

`parseStrl` : 10 chaînes ASCII `Checker, Triangles, Crosses, Stars, Links, Lace, Cubes, Turtle Shell, Hooks, Circles`. Chargée en `DS:74d7` (`06f4`, `10a8:0430`) ; `1060:182a` affiche la chaîne `motif + 1` (`10a0:19c3`, 1-basé) dans la zone `DS:212c` = `(429, 79, 512, 93)`, police `NCSclB12` (`DS:4a14`), couleur 108 (`0x6c`), centrée (drapeau `0x22`, hypothèse), après avoir restauré le fond sauvegardé `DS:20e6`. La pastille de nom (entrée 1, `(412,53,528,68)`) affiche le nom du joueur (`DS:5b88`) avec `NCSclB10` (`4a10`) couleur 108 (`1060:1466`). Copy visible : à reproduire telle quelle (noms des motifs en anglais), à valider.

### 2.3 Autres ressources liées

- `SHPL` 40000 : palette 10…176 (167 couleurs) du fond ; 5 formes (`SHAP` 40000 fond 576×432 ; 40001 panneau des pastilles 122×199 ; 40002 cadre de sélection 44×31 ; 40003 main « stop » 25×25 ; 40004 Poly au repos 96×180).
- `SHPL` 40100 : 6 chiffres 10×13 (version 1, 2, 3 × 2 états).
- `SHPL` 40150 : 16 icônes de boutons, 2 états chacune (§3.2).
- `SHPL` 40200 : 58 masques + palette 180–194 (15 couleurs de peinture) ; `SHPL` 999 : 0 forme, palette 216–231 (16 couleurs, complément de Poly : hypothèse) ; `SHPL` 50000 : 10 formes (247×222, 187×117, 38×37 ×2, 20×35 ×4, 73×21 ×2) **jamais référencées** par le code de la scène (hypothèse : reliquat de l'écran d'aide ou d'impression).
- Couleurs (palette 180–194, après éclaircissement `c + 31 - ⌊c/8⌋`) : 0 blanc (251,251,251), 1 jaune (255,253,39), 2 orange (255,103,36), 3 rouge (255,38,44), 4 violet (206,35,255), 5 bleu (65,79,255), 6 vert (38,198,41), 7 bleu clair (123,204,255), 8 noir/gris foncé (65,65,65), 9 gris (160,175,172), 10 marron (157,86,58), 11 rouge sombre (171,37,55), 12 rose (255,129,228), 13 vert sombre (32,106,45), 14 bleu marine (34,37,143). Ordre identique à celui du manuel (« white, yellow, orange, red, purple, blue, green, light blue, black, gray, brown, dark red, pink, dark green, dark blue »), qui est aussi l'ordre de rotation du kaléidoscope.

## 3. Disposition

Zone de jeu 576 × 432. Fond : `SHAP` 40000 (planches de bois vertes, fenêtre cuivrée, plaque dorée « ARTIST / TITLE / VERSION »).

### 3.1 Dessin initial (`1060:06f4`)

Ordre : mémorise la police courante (`10d8:68ee` → `DS:74f5`), drapeaux (`758f=1` clignotement arrêté, `758d=0`, `74e5=1`, `74e7=0`, `74eb=0`, `7042=-1`) ; Ctrl → `20e0` ; `1a41(0)` ; rectangles de bord (`DS:22ae…` ← port) ; ouvre `PatFill.DAT` ; **précharge** `\0SND` 3012, 3013, 3038, 3039, 3040, 3041, 3053, 3110, 3044 et la musique 1001 ; `SHPL` 40000 → `DS:7575` ; `SHPL` 40200 → `DS:7579` ; `SHPL` 999 ; `STRL` 40000 ; `PTRN` du motif courant ; dessine le fond (forme 1 de 40000 en (0,0), mode 0) ; sauvegarde les rectangles `(412,53,528,68)` → `DS:20e2`, `(429,79,512,93)` → `DS:20e6` ; charge le vitrail (`1271(1)`), titre (`182a`), pièces (`0e35`), instantané (`18c9`), nom (`1466`) ; installe 4 groupes de gadgets (`10a0:0000(0xc000, 4, DS:249e)`) et deux rangées d'icônes (`1038:01af`, §3.2) ; marque la version courante enfoncée (bit 4) ; sauvegarde `(406,130,533,334)` → `DS:20ea` ; `0dc5(1)` dessine le panneau des pastilles (forme 2 de 40000 en (408,132)) puis le cadre de sélection (forme 3 en `(x-2, y-2)` de la pastille courante, **dessiné d'abord** puis recouvert par le panneau : l'ordre d'appel est cadre puis panneau, hypothèse sur le rendu exact des deux) ; arrête les MIDI ; **fondu d'entrée** `1b25(1, 30, 236, 10, palette)` ; mémorise la palette 180–194 (`DS:74f9`) ; joue le son **3110** (2,39 s) et **attend sa fin** ; `20b8 = 1` ; `758f = 0` (les flèches commencent à clignoter) ; musique 1001 (MIDI) si `DS:2d64 ≠ 0`.

### 3.2 Zones cliquables (« gadgets » `10a0`, entrées de 20 octets : `RECT(8)` + 8 octets d'état + `u16 drapeaux` à `+0x12` ; bit 0 = masqué, bit 1 = inactif, bit 2 = enfoncé)

Les 4 groupes (`DS:249e`, 12 octets : pointeur de rangées, nombre de rangées, drapeaux à `+6`, rappel à `+8`) :

| Groupe | Rangée (`DS`) | Rappel | Contenu |
|---|---|---|---|
| 0 | `246e` : 3 boutons, entrées 18–20, drapeaux `0x202c`, icônes `SHPL` 40100 | `1060:0000` | versions 1, 2, 3 |
| 1 | `247e` : 8 boutons, entrées 21–28, drapeaux `0x8040`, icônes `SHPL` 40150, sons `DS:244e` | `1060:008a` | boutons d'action |
| 2 | `248e` : 18 boutons, entrées 0–17, drapeaux `0x2000` | `1060:03d5` | fenêtre, nom, 15 couleurs, plein écran |
| 3 | `DS:2eba` partagée | `1080:1192` | saisie du nom (partagée avec `1080`) |

Rectangles (gauche, haut, droite, bas ; px) :

| Entrée | Rect | Rôle (`param` du rappel) |
|---|---|---|
| 0 | `(52, 46, 393, 387)` | fenêtre de peinture (`03d5` param 1) |
| 1 | `(412, 53, 528, 68)` | pastille de nom (param 2) |
| 2–6 | `(408, 148+39k, 448, 176+39k)`, k = 0..4 (tops 148, 187, 226, 265, 304) | couleurs 0–4 (param 3–7) |
| 7–11 | `(447, 132+39k, 487, 160+39k)` (tops 132, 171, 210, 249, 288) | couleurs 5–9 (param 8–12) |
| 12–16 | `(491, 148+39k, 531, 176+39k)` | couleurs 10–14 (param 13–17) |
| 17 | `(0, 0, 576, 432)` | plein écran : actif seulement en mode aide |
| 18, 19, 20 | `(436,106,447,120)`, `(464,106,475,120)`, `(492,106,503,120)` | versions 1, 2, 3 (rappel `0000` param 1–3) |
| 21 | `(487, 369, 516, 397)` | Imprimer (k = 1) |
| 22 | `(418, 369, 447, 397)` | Kaléidoscope (k = 2) |
| 23 | `(412, 73, 428, 93)` | flèche gauche (k = 3) |
| 24 | `(512, 73, 527, 93)` | flèche droite (k = 4) |
| 25 | `(453, 369, 482, 397)` | Robinet (k = 5) |
| 26 | `(496, 339, 525, 367)` | Aide (k = 6) |
| 27 | `(408, 339, 437, 367)` | Yuck ! (k = 7) |
| 28 | `(448, 339, 484, 364)` | Sortie (k = 8) |

Icônes `SHPL` 40150 (paires normal/appuyé, hypothèse sur l'ordre) : 40150–51 Imprimer, 40152–53 Kaléidoscope, 40154–55 flèche gauche (14×19), 40156–57 flèche droite, 40158–59 Robinet, 40160–61 Aide, 40162–63 Yuck !, 40164–65 Sortie (36×25). Versions : 40100–05 (paires 1, 2, 3).

Coordonnées de pastilles : colonnes de 5 en 3 colonnes, ordre colonne par colonne (la colonne du milieu est décalée de 16 px vers le haut).

Clignotement des flèches (`1060:1c2c`) : tant que `758f = 0`, toutes les 12 ticks (≈ 200 ms) les entrées 23 et 24 (drapeau « enfoncé », bit 2) alternent. Il s'arrête au **premier clic** n'importe où (crochet souris `1060:1cd3`, appelé par `1008:05c0`) ou au premier rappel de bouton.

### 3.3 Zones d'aide (mode « ? », tableau de 12 `RECT` à `DS:24ce`, `1060:1aa3` renvoie rang + 1 de la première zone contenant la souris)

| # | Rect | Zone | Animation jouée (`03d5`) |
|---|---|---|---|
| 1 | `(317, 280, 388, 432)` | Poly / main stop | sortie de l'aide (§1.7) |
| 2 | `(487, 369, 516, 397)` | Imprimer | 2300 puis 2100 |
| 3 | `(418, 369, 447, 397)` | Kaléidoscope | 2300 puis 1100 |
| 4 | `(453, 369, 482, 397)` | Robinet | 2300 puis 3600 |
| 5 | `(496, 339, 525, 367)` | Aide | 1400 |
| 6 | `(408, 339, 437, 367)` | Yuck ! | 2300 puis 3500 |
| 7 | `(448, 339, 484, 364)` | Sortie | 3700 |
| 8 | `(410, 70, 528, 93)` | titre et flèches | 2300 puis 2000 |
| 9 | `(410, 40, 528, 68)` | pastille de nom | 2300 puis 1600 |
| 10 | `(430, 94, 509, 116)` | numéros de version | 2300 puis 2400 |
| 11 | `(408, 130, 531, 333)` | panneau des couleurs | 2300 puis 1000 |
| 12 | `(44, 37, 399, 393)` | fenêtre | 2300 puis 1000 |

(« puis » : la 2e animation n'est jouée que si 2300 est allée au bout.) Curseur : `Tick` passe en curseur « point d'interrogation » (`1008:063b(2)`) quand la souris est sur une zone de rang ≥ 2, curseur normal sinon (`DS:20b2` mémorise l'état). Animations à interruption par clic : drapeau bit 3 du descripteur `DS:20d4` (`1060:195f` param 1) ; descripteur `{ptr, id, décalage 0, drapeaux 0x13}` : bit 0 (fond sauvegardé), bit 1 (ne pas arrêter le MIDI), bit 4 (attendre les sons), bit 3 ajouté si interruptible ; rectangle sauvegardé `(248, 273, 576, 432)` → `DS:20ee`. Après interruption (`111c` n'a pas terminé) : fond restauré et **Poly au repos** = forme 5 de 40000 (40004, 96×180) en `(296, 280)`. `20b6 = 1` après 1200, `0` après 1300.

### 3.4 Main « stop »

`1060:1bcc` : forme 4 de 40000 (40003, 25×25) en `(337, 396)` (rectangle `DS:2542`) ; si la hauteur du port `DS:8bd4 < 430`, en `(336, 377)` (`DS:254a` ; jamais pris à 432). Dessinée à la fin de l'intro de l'aide et sur inactivité.

### 3.5 Animations `\0SCR` (SHPL de même id ; tick ≈ 17 ms, `scr.md`)

Aucune n'utilise de hook. Toutes jouées dans la zone `(248…, 273…)` en bas de l'écran. Durée en ticks :

| SCR | Durée | Image | Usage |
|---|---:|---|---|
| 1000 | 217 | 20 | panneau des couleurs / fenêtre |
| 1100 | 329 | 42 | Kaléidoscope |
| 1200 | 133 | 18 | Poly arrive (silencieuse) |
| 1300 | 119 | 17 | Poly part (silencieuse) |
| 1400 | 434 | 55 | bouton Aide |
| 1500 | 420 | 53 | intro courte (aide déjà vue) |
| 1600 | 441 | 46 | pastille de nom |
| 1700 | 1638 | 204 | grande présentation (1re aide, ou inactivité) |
| 1800 | 224 | 18 | compliment « image variée » |
| 1900, 2500–3400 | 49–105 | 6–11 | répliques courtes aléatoires |
| 2000 | 406 | 47 | titre / flèches |
| 2100 | 315 | 37 | Imprimer |
| 2200 | 28 | 4 | **jamais jouée** (aucune référence dans `1060`) |
| 2300 | 63 | 9 | entrée en matière commune |
| 2400 | 357 | 40 | numéros de version |
| 3500 | 385 | 38 | Yuck ! |
| 3600 | 301 | 34 | Robinet |
| 3700 | 280 | 32 | Sortie |

## 4. Sons

Tous les WAVE sont 11 025 Hz, 8 bits, mono, sans boucle ni repère. Sons d'interface (préchargés à l'entrée) :

| `\0SND` | Durée | Déclencheur |
|---|---|---|
| 1001 | MIDI | musique de fond, jouée en boucle ? (hypothèse : le moteur ne la reboucle pas explicitement ; voir `midi.ts`) ; id dans `DS:20b0` (initialisé à `0x3e9` par `Enter`). Rejouée si `DS:2d64 ≠ 0` après l'entrée, l'impression et la fin de l'aide ; arrêtée avant l'impression et l'aide. |
| 1000 | MIDI | **jamais référencé** (alternative non utilisée : hypothèse) |
| 3110 | 2,39 s | jingle d'entrée, attendu avant que la scène soit active |
| 3038 | 0,19 s | boutons Imprimer, Kaléidoscope, Robinet (`DS:244e` rang 0, 1, 4) |
| 3040 | 0,19 s | flèches de motif (rang 2, 3) |
| 3012 / 3013 | 0,82 / 1,10 s | bouton Aide (tirage 50/50, `DS:2462`, rang 5) |
| 3053 | 0,39 s | Yuck ! (rang 6) |
| rang 7 (Sortie) | – | pas de son (entrée `0`) |
| 3039 | 0,41 s | choix d'une couleur par pastille (les touches `x`/`z` ne jouent pas de son) |
| 3041 | 0,14 s | choix d'une version |
| 3044 | 0,10 s | clic sur la pastille de nom |
| 3045–3052 | 0,04–1,17 s | présents dans l'archive, **jamais référencés** |

Les voix de Poly sont les sons de la `SNDL` de chaque animation (déclenchés par l'opcode `SND_PLAY` du script ; pas de repères) : SNDL 1000 → 19500, 19501 ; 1100 → 19524, 19525 ; 1400 → 19509, 19510 ; 1500 → 19504, 19507, 19508 ; 1600 → 19531, 19532 ; 1700 → 19511–19515, 19522, 18332, 19504–19508 ; 1800 → 19502 ; 1900 → 19503 ; 2000 → 19526, 19545, 19546 ; 2100 → 19528, 19529 ; 2400 → 19533, 19534 ; 2500 → 19027 ; 2600 → 19026 ; 2700 → 19540 ; 2800 → 19028 ; 2900 → 19541 ; 3000 → 18061 ; 3100 → 19023 ; 3200 → 18382 ; 3300 → 19025 ; 3400 → 19024 ; 3500 → 19543, 19544 ; 3600 → 19542 ; 3700 → 19522, 18332 ; 1200, 1300, 2200, 2300 : liste vide. Inutilisés : 18677, 19516–19521, 19527, 19530, 19656–19658. Le texte prononcé n'est pas transcrit (§9).

## 5. Progression et roster

- **Pas de niveau, pas de score, pas de masque de réussite** : `PATFILL` n'écrit jamais dans le masque `5 × opération + niveau` (aucun appel à `1010:3fdf`).
- Accès : zones 2–5 du hub → `1b20 = 3` (engine.md §1.5). Retour : `Exit` → `1b20 = 0`.
- Définition de sauvegarde (`DS:211a` : `{5, &DS:20f2, 1060:0d65}`, lue par `1050:00fa`) : 5 variables, entiers **big-endian** dans l'enregistrement du joueur (5 424 octets), octets bruts pour les tableaux :

| Offset | Variable | Taille | Contenu |
|---|---|---|---|
| 137 | `DS:7040` | u16 | motif courant (0–9) |
| 139 | `DS:7044` | 10 × u8 | version courante (0–2) de chaque motif |
| 149 | `DS:5bb2` | 5 262 × u8 | stockage des peintures (§1.5) |
| 5411 | `DS:704e` | u8 | couleur courante (0–14) |
| 5412 | `DS:746b` | u16 | 1 = la grande présentation de Poly (1700) a déjà été vue |

- Écriture du roster (`1050:0302`) : à la sortie (`Leave` si `20b8`), avant impression, au clic sur la pastille de nom. La scène n'écrit pas ailleurs (la mise à jour des cellules est en mémoire).
- Changement de joueur : clic sur la pastille de nom (`03d5` param 2) : son 3044, sauvegarde, `88b4`… groupes 0–2 masqués (`|= 1`), `1080:0000(1, 0x8f, 0x6c, 0x6d)` (dialogue de connexion). Quand `DS:2d60 == 2` (retour du dialogue), `Tick` ré-active les groupes, recharge `1271(1)`, `PTRN`, nom, titre, pièces, cadre, instantané. `DS:2d60 == 1` : saisie de texte en cours (les touches vont à `1080:0581`).

## 6. Clavier et souris

- Souris : bouton gauche ; la peinture **sonde** l'état du bouton et la position (`1098:0437(1)`, `1098:039b`) tant qu'il est enfoncé (glisser = peindre). Rôle des boutons droit/milieu : aucun spécifique à la scène relevé (hypothèse : traités comme des clics par les gadgets).
- Touches (`1060:1786`, `scene_patwin_key`) : `x` ou `X` (`0x78`, `0x58`) = couleur suivante (14 → 0), `z` ou `Z` (`0x7a`, `0x5a`) = précédente (0 → 14) ; après changement : `0dc5(1)` (cadre) et instantané `18c9(1)` (pas de son). **Ignorées en mode aide.** Si `74e3 == 0` et `2d60 == 1` : toutes les touches vont à la saisie du nom (`1080:0581`). Les autres touches alimentent l'historique de codes secrets (`1018:03fd`). Entrée/Tab : navigation clavier des gadgets (`10a0:098e`) ; pas de touche Échap.
- Curseur : « ? » sur les zones d'aide de rang ≥ 2 en mode aide ; sablier pendant chargements et animations (`1008:0620` / `0618`).
- Pendant une animation de Poly (`74eb = 1`, `195f`), les gadgets ne sont pas sondés : un clic sert seulement à interrompre l'animation (bit 3).

## 7. Différences avec le manuel 1997 (v2, p. 19–20, 41)

Concordant : dix motifs, 15 couleurs dans l'ordre cité, flèches « Select-A-Pattern » sur la plaque, 3 versions auto-sauvegardées, Imprimer, Kaléidoscope, Robinet, « Yuck ! », re-cliquer pour annuler, étiquette de nom, Aide, Sortie. Différences / précisions :

- Le manuel place Pattern Windows au « niveau 1 » de la Control Room (vitrail) ; le hub de la v1 n'a pas d'étages (engine.md §8.1) : l'entrée est la zone vitrail (zones 2–5).
- « Yuck ! » est décrit comme annulant « ce que vous venez de faire » ; le code en fait une **bascule annuler/rétablir** par échange de tampons.
- Le « Name Tag » du manuel : le code permet d'ouvrir le dialogue de connexion depuis cette pastille (non documenté).
- Non documentés dans le manuel : outils cachés du Robinet (Ctrl à l'entrée), compliment « image variée », clignotement des flèches à l'entrée, arrêt du kaléidoscope après 300 ticks (≈ 5 s).
- Ce que la v1 ne contient pas par rapport au manuel (pas d'écart vérifiable avec un manuel v1, non disponible) : rien.

## 8. Plan d'implémentation TS

### 8.1 Module pur testable `src/games/mathemagique/games/pattern-windows/logic.ts` (aucune dépendance DOM)

- `parsePtrn(bytes): PatternGeometry` (100 octets, mots BE signés) ; `layoutCells(geometry, windowRect = {52,46}): CellDef[]` → `{index, x, y, maskIndex}` (ordre §2.1) ; `PATTERN_MASK_BASE = [1,5,9,21,25,31,40,43,47,52]`, `PATTERN_STORAGE_BYTES = [200,168,234,206,138,262,128,88,204,126]`, `PATTERN_VERSION_OFFSETS`.
- `unpackCells(bytes, count) / packCells(cells)` (nibble bas = cellule paire) ; `blankStorage()` (`0x77`).
- `hitCell(cells, masks, x, y)` : parcours §1.4 avec masque 1 bit (`bitsPerPixel === 1`, `pixels[]` ≠ 0) ; `paintStep(state, x, y)` : `{state', changedCell?}` avec les variables `first`, `mode` ; `paintStroke` = suite de `paintStep`.
- `snapshot(state)`, `toggleUndo(state)` (échange, `undoActive`), `fillAll(state)`, `hiddenTool(state, mode, lastCell, n)` (modes 1–7), `isColorful(cells, byteCount)` (`1b2d`), `nextColor/prevColor` (modulo 15), `nextPattern/prevPattern` (0–9 circulaire), `rotatePalette(colors15)` (rotation d'un cran vers le début).
- `lcg(seed)`/`rand(n)` conforme à `10a8:1473`, `pickWithHistory(history, n, rng)`, `helpFarewell(rng, colorful)`.
- Roster : `PatternWindowsSave` + (dé)sérialisation BE selon §5 ; défaut `1060:0d65`.

### 8.2 Machine à états de scène

`entering` (fond, fondu, jingle 3110, `blink off`) → `normal` (gadgets, clignotement flèches, sondage de peinture, kaléidoscope en sous-état avec échéances en ticks) ↔ `helpSpeaking` (animation de Poly, `busy`, interruptible) ↔ `helpListening` (zones §3.3, idle 300 ticks → 1700, curseur « ? ») ; `printing` ; `nameDialog` (délégué au composant de connexion, retour via événement) ; `exiting` (fondu, retour hub). Le tick de 17 ms est piloté par le moteur.

### 8.3 Services moteur nécessaires

Lecteur `\0SCR` avec zone d'écrêtage et sons synchronisés ; sauvegarde/restauration de rectangles de fond (`20e2`, `20e6`, `20ea`, `20ee`) ; blit de masque 1 bit avec couleur de palette (index 180 + c) ; **rotation de palette** (15 entrées + restauration) et fondu d'entrée/sortie ; gestionnaire de sons WAVE + MIDI (boucle) ; gadgets (groupes, états enfoncé/désactivé/masqué, clavier) ; sondage du bouton souris (glisser) ; curseurs ; roster ; impression (génération d'une image de la fenêtre, `window.print`) ; texte avec polices `NCSclB10/12` ; préférence musique (`2d64`).

### 8.4 Tests unitaires et valeurs attendues (tirées du code)

1. `PTRN` : 10 en-têtes du tableau §2.1 ; cellules = 400, 336, 468, 412, 276, 522, 255, 176, 405, 252 ; `⌈cellules/2⌉ ≤ PATTERN_STORAGE_BYTES` (égal sauf 5 et 8).
2. Masque de base : motif `m` utilise `SHAP 40199 + base + j` ; `h[0]` = nombre de masques (4,4,12,4,6,9,3,4,5,7) ; largeur/hauteur des masques = `h[2]`/`h[1]`.
3. `unpack(pack(x)) == x` ; `0x77` → cellules `[7,7]` ; octet `0xE3` → `[3, 14]` (quartet bas = cellule paire).
4. Couleurs : `nextColor(14) == 0`, `prevColor(0) == 14` ; motifs : `prev(0) == 9`, `next(9) == 0`.
5. `paintStep` : premier clic sur cellule de la couleur courante → mode effacement (restaure l'instantané) ; sinon peinture ; clic hors masque : aucun changement.
6. `toggleUndo` deux fois = identité ; `isColorful` : 400 cellules dont 267 d'une même couleur → faux (seuil `⌊400/3⌋×2 = 266`), 266 → vrai ; `byteCount` > 262 plafonné à 524 cellules.
7. `rotatePalette([a0…a14]) == [a1…a14, a0]`.
8. `hiddenTool` : mode 6 `c → 14 - c`, mode 7 `i mod 15`, mode 1/2 rotations circulaires sur 524, mode 3 `i = last mod n` par pas `n`.
9. `lcg` : `seed' = (seed × 0x343FD + 0x269EC3) mod 2^32`, `rand(n) = (seed' >>> 16) mod (n+1)` ; premier tirage pour `seed = 0` : `0x269EC3 >>> 16 = 0x26 = 38` → `rand(14) = 38 mod 15 = 8`.
10. Table de roster : offsets 137, 139, 149, 5411, 5412 et longueurs 2, 10, 5262, 1, 2.

## 9. Questions ouvertes

1. Texte prononcé et sous-titres éventuels des voix 19500–19546, 18061, 18332, 18382, 19023–19028 (non transcrits).
2. Arguments exacts de `10d8:3006`/`9ef8` (couleur de remplissage d'une cellule redessinée) : on suppose couleur = `180 + valeur` (lu en `1060:0f05`/`0f0a` pour le redessin complet).
3. Boucle de la musique 1001 (repères `loop start`/`loop end` du MIDI) et rôle de 1000.
4. Rendu exact du panneau 40001 par rapport au cadre 40002 (ordre de dessin) : à comparer par capture.
5. `1080:0000(1, 0x8f, 0x6c, 0x6d)` : signification des paramètres ; recharge des variables de scène du nouveau joueur.
6. Pourquoi `PTRN` 5 et 8 ont 1 octet de stockage en plus ; usage de `SHPL` 50000, de la `SHPL` 999 et de `SCR` 2200.
7. Détail du retour de `1090:111c` (terminé vs interrompu) : on suppose « 0 = interrompu » d'après `1060:195f`.
8. Sémantique des 8 octets intermédiaires des entrées de gadget et des bits `0x202c`/`0x8040`/`0x2000` des rangées.
9. Contenu et mise en page de l'impression (`1088:0000`, rectangle `(51,45,394,388)`).
10. Durée réelle d'un tick (17 ms) : les durées en secondes ci-dessus supposent cette valeur.

## Écarts avec engine.md

- §0 point 1 : `1060:06f4`, `0a8e`, `0bb0`, `0d22`, `1786` existent désormais dans `decomp/` (`1060_06f4_scene_patwin_enter.c`).
- §7.1 : `DS:7040` = motif courant (pas « variable générique »), `7044` = version par motif, `704e` = couleur, `746b` = drapeau « présentation de Poly vue » ; `5bb2` confirme le vitrail (3 versions × 10 motifs en nibbles).
- §4.4 « rotation du kaléidoscope (hypothèse) » : **confirmée** (`1060:1627` fait tourner les entrées 180–194 d'un cran toutes les 8 ticks pendant 300 ticks).
- §5.3 : en plus de `x/X/z/Z`, les touches sont ignorées en mode aide et redirigées vers la saisie du nom quand `2d60 == 1`.
- §9 : « `PTRN` 10, `STRL` 40000 (10 noms) » exact ; « sauvegarde 5262 octets » exact ; ajouter que `PTRN` fait exactement 100 octets.
- §1.5 : les zones 2–5 du hub mènent bien à la scène 3.
