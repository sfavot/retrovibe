# SWIV 3D : modèles 3D des niveaux (blocs 10xxx)

Lecteur : `src/games/swiv3d/data/model.ts` (`parseModel`, `listModels`), tests : `test/swiv3d/model.test.ts`. Conteneur : `bd.ts` (voir `slv.md`). Fonctions du jeu : `gm_slv_index_models` (`004543f0`, indexation et relocalisation) et la boucle de collecte des objets de `gm_render_terrain` (`0042718c`, nom hérité : elle ne dessine pas le terrain, elle transforme les modèles, calcule l'éclairage et empile les faces dans la file de tri `00423620` ; le tracé se fait ensuite par les rastériseurs, `render.md` §7-8). Chargeurs de texture : voir `slv.md` (atlas 12001-12004) ; étude de rendu qui fait foi pour les types de face, l'éclairage et les ombres : `render.md`.

## Ce qui est un modèle

Seuls les ids `id / 1000 == 10` sont des modèles (`gm_slv_index_models`) : **151 blocs, ids 10100 à 10991**, rangés dans la table `005b09b0[id % 1000]` (l'« emplacement » de l'objet, champ `+0x4c`). Le premier bloc du répertoire (10800) remplit d'abord les 1 000 emplacements : un objet sans modèle propre est dessiné avec lui. Les blocs **11003** (palette 6 bits + table d'attributs) et **11004** (voir plus bas) ne sont pas des modèles. Les 151 blocs sont **identiques octet pour octet** dans TERRAN00-03 et DEMO.

## Disposition du bloc (établi, 151/151 blocs × 5 fichiers)

Un seul tampon, sans pointeur absolu. En-tête de 8 × i32 LE, puis trois tableaux contigus qui couvrent exactement le bloc (aucun octet résiduel) :

| Offset | Contenu |
|---|---|
| `+0x00` | nombre de sommets `nv` |
| `+0x04` | nombre de triangles `nf` |
| `+0x08` | nombre de normales `nn` (`piVar1[2]`) |
| `+0x0c` | rayon de collision **au carré** (`0042a084`, `00443ac0` : comparé à des distances au carré). Valeur d'auteur : égale au vrai rayon² des sommets dans 540 cas sur 755 seulement |
| `+0x10` | décalage de pose : `gm_object_init` (`004265ec`, mode 2) met l'objet à `hauteur du terrain - champ * 256` (négatif : relevé). Souvent égal au y minimum (375/755) |
| `+0x14` | lumière ambiante ajoutée à l'intensité (30 pour 108xx/109xx/101xx.., 40 ou 100 ailleurs) |
| `+0x18` | offset des triangles, toujours `0x20 + 16·nv` (le jeu y ajoute l'adresse du bloc) |
| `+0x1c` | offset des normales, toujours `+0x18 + 42·nf` ; fin du bloc = `+0x1c + 12·nn` |
| `+0x20` | sommets : `nv` × 16 octets |

**Sommet** (16 octets) : `x, y, z` i32 et `mode` i32. Unités : le jeu stocke les positions en 8.8 et dessine avec `pos >> 8` ; un sommet est donc en **unités du monde**, une cellule de terrain = 64 unités (voir `slv.md`). Y vers le haut (les pieds sont à y < 0, le champ `+0x10` est négatif). Mode : 0 libre ; 1 collé au terrain (y = hauteur du sol sous le sommet, pas de tangage/roulis : ombre portée et bas de coque, 2 265 sommets) ; 2 relevé au sol s'il passe dessous (120 sommets). Le test `piVar13[3] != 1` de la boucle applique ou non tangage/roulis.

**Triangle** (42 octets, tous les polygones sont des triangles) :

| Offset | Taille | Champ |
|---|---|---|
| `+0x00` | 3 × i32 | indices des sommets |
| `+0x0c` | 3 × i32 | indice de la normale de chaque sommet (ombrage de Gouraud) |
| `+0x18` | i32 | numéro de texture (emplacement `005b0690[t]`) |
| `+0x1c` | 3 × i16 | u par sommet |
| `+0x22` | 3 × i16 | v par sommet (signés ; lus modulo la tuile de 64) |
| `+0x28` | u16 | octet bas : type de rendu ; octet haut : drapeaux |

**Normale** (12 octets) : 3 × i32, de longueur 100 (vecteurs unitaires × 100).

## Rendu (établi par le code)

- Projection : coordonnées monde − caméra, matrice de vue, puis division perspective par `profondeur + 0x19` (0x25 unités d'écran / 25 unités de recul).
- Éclairage : par normale, `i = max(0, n · L >> 8) + ambiant`, plafonné à `0x6e` ; chaque sommet d'un triangle prend l'intensité de sa propre normale (Gouraud). Un drapeau d'objet (octet 6, bit 1) force `0x7f` (plein feu). `L` est une direction fixe dans le monde, recalculée avec l'orientation de l'objet.
- Élimination des faces arrière : pour les types 0 et 0x28 (le type 1 en dépend pour sa clé de tri), le triangle est dessiné si le produit vectoriel projeté `(x1-x0)(y2-y0) - (x2-x0)(y1-y0)` est positif (y d'écran vers le bas). Vérifié sur les données : la normale sortante est `(b - a) × (c - a)` en coordonnées du modèle (2 188 faces concordent avec les normales stockées, 7 non, 184 dégénérées ou à normales nulles).
- Tri : par face (pas par objet), clé = plus grand z des 3 sommets pour les types 0, 2, 4 ; type 1 : `max D` de l'objet si face avant, `min D` sinon ; type 5 : `min D` de l'objet ; type 0x28 : `max D` de l'objet (les ombres sortent avant les faces de l'objet). File `00423620` triée clé décroissante (le plus lointain d'abord), au plus 2995 entrées par image.
- Texture : `t` indexe les emplacements `16n + k` remplis par les atlas 12001-12004 : **bloc `12000 + (t >> 4)`, tuile `t & 15`** (4×4 de 64×64, voir `slv.md`). Valeurs rencontrées : 14 à 68 (+ 0 pour le type 5). u et v lus en texels de la tuile (le rendu matériel les multiplie par 4).

### Types de rendu (octet bas de `+0x28`)

| Type | Faces | Sens |
|---|---:|---|
| 0 | 10 125 | texturé, ombré, face arrière éliminée (cas général) |
| 1 | 40 | **disque d'hélice/de rotor** : un grand triangle inscrit, recouvert d'un **masque de flou tournant** (image 64×64 des lignes 32..47 de SLV 500, qui assombrit le sol : `render.md` §8.4) ; u/v du fichier ignorés et remplacés par trois points d'un cercle (table de sinus, phases 0, 0x55, 0xab = 120°) selon l'image `00481150` ; pas d'ombrage |
| 2 | 145 | texturé, ombré, double face |
| 4 | 1 545 | texturé, **texel 0 transparent** (clé de transparence), **non éclairé** (`table[100][texel]`, `004329b4`), double face ; essentiellement les textures 44-59 |
| 5 | 40 | texture prise sur l'objet (`objet+0x50`), non ombrée, double face : peau variable (texture 0 dans le modèle) |
| 0x28 | 365 | **ombre au sol** (et non décalque) : quadrilatère de sommets de mode 1 dont `u`, `v` (0..255) adressent une silhouette de l'image SLV 110 ; chaque pixel du sol dessous est assombri par la table SLV 500 (`00433f64` ; polygone noir à faible détail, `00432264`). Face avant seulement, tracée avant les faces de l'objet. **Les champs normales et texture de ces faces contiennent des octets résiduels** (textures aberrantes `1427505258`, etc.) et ne sont pas lus |

Le type 3 n'existe pas dans les données (le code ne dessine rien pour lui). Drapeaux (octet haut) : bit 1 (valeur 2, 305 faces) = texture animée : `v += ((image >> 2) & 3) << 4` (4 images empilées de 16 texels), sauf si le bit 0 du drapeau d'objet est posé (l'image est `frame >> 2`, ou `frame` entière si le bit 4 du drapeau d'objet est posé).

## Blocs 11003 et 11004 (hors modèles)

- **11003** : palette VGA 6 bits (0x300 octets) puis table d'attributs par type de 8 192 octets (voir `slv.md`).
- **11004** (3 540 octets) : table de débris, identique dans les 5 niveaux. Liste chaînée de nœuds de 12 octets `(suivant, sous-liste, clé)` dont la clé est un emplacement de modèle (`+0x10000` et `+0x20000` pour deux gabarits de fragments), et sous-listes circulaires de nœuds `(?, suivant, modèle)` pointant sur les modèles 700-712 (offsets relatifs relocalisés par `gm_slv_reloc_list`). Lue par `004442ec` à la destruction d'un objet : elle fait naître des fragments (`004261a0`) avec les modèles 107xx. Hypothèse raisonnable, non lue par un parseur.

## Vérification visuelle (scratch, non commitée)

Rastériseur logiciel en script jetable (3 vues orthographiques + perspective, remplissage Lambert + fil de fer, puis version texturée avec les atlas 12001-12004 et leur palette de queue). Modèles reconnaissables, fermés, symétriques, sans pointe vers l'origine : 10990 (hélicoptère du joueur, disque de rotor type 1), 10991 (second véhicule du joueur), 10203 (char : chenilles à galets texturées), 10300 (vedette), 10504 (hangar à porte), 10101 (bimoteur à hélices), 10560/10564 (sapin, arbre), 10800 (avion à ailes delta). Les couleurs des textures dépendent de la palette choisie (la palette de queue des blocs 12xxx est la couleur d'atlas à pleine luminosité ; le jeu rend `table[lumière][texel]` vers la palette 11003, cf. `slv.md`).

## Identification (probable, d'après le code et les rendus)

- Le joueur : `FUN_0043de0c` (changement de forme du joueur) pose `objet+0x4c = 0x3de` (**990**, forme 0, hélicoptère) ou `0x3df` (**991**, forme 1, véhicule) ; `0x3d4` (980), 982 et 983 sont les roues enfants des formes 1 et 2 (`004446a0` : roue, roue dans l'eau, ski de la motoneige ; `0043b4f4` : roues éjectées à la mort, `player.md` §3.6) ; 980/982 servent aussi de corps à la forme 5.
- 101xx : grands appareils volants (10100 hélicoptère, 10101 bimoteur à hélices) ; 102xx : véhicules terrestres (10203 char) et blocs ; 103xx : navires (10300 vedette) ; 104xx : petits objets/tourelles (non identifiés) ; 105xx : bâtiments (10504 hangar) ; 10552-10565 : pylônes, sapins et arbres (une seule normale, ambiant 100) ; 106xx : bonus et caisses (10607 caisse, 10608 étoile ; 10600-10604 et 10609 sans rayon de collision) ; 107xx : débris/fragments (700-712 cités par 11004) et effets sans éclairage (757-770, une normale) ; 108xx : 10800, 10801, 10855, 10857, 10858 partagent la même géométrie (avion/missile à ailes delta, rayons différents), 10810-10856 : blocs et rochers posés avec ombre ; 109xx : 10900-10902 quadrilatères plats (sans rayon), 10980-10984 objets du joueur, 10990/10991 joueur.

## Modèles (identiques dans TERRAN00-03 et DEMO) : `emplacement sommets/triangles/normales`

- 101xx : 100 41/59/65 · 101 38/53/56 · 102 43/42/38 · 103 37/51/54
- 102xx : 200 14/24/12 · 201 8/12/6 · 202 14/24/25 · 203 32/60/28 · 204 20/36/39 · 205 12/20/21 · 206 12/20/21
- 103xx : 300 28/39/42 · 301 8/12/6
- 104xx : 400 10/14/8 · 401 8/12/6 · 402 9/12/8
- 105xx : 500 10/14/8 · 501 12/18/8 · 502 17/28/12 · 503 38/60/16 · 504 22/36/9 · 505 10/14/8 · 506 14/22/16 · 507 12/18/10 · 508 10/8/5 · 509 12/18/9 · 510 16/26/16 · 511 10/14/8 · 512 20/30/11 · 513 34/47/24 · 514 22/36/17 · 515 15/22/9 · 516 18/28/19 · 517 10/14/8 · 518 26/34/17 · 521 16/25/21 · 522 27/46/8 · 523 12/16/6 · 552 36/24/1 · 553 20/12/1 · 560 17/10/1 · 561 17/10/1 · 562 3/1/1 · 563 3/1/1 · 564 25/18/1 · 565 25/18/1
- 106xx : 600 7/6/1 · 601 7/6/1 · 602 7/6/1 · 603 7/6/1 · 604 4/2/1 · 605 8/12/6 · 606 8/12/6 · 607 12/20/6 · 608 14/24/36 · 609 4/2/1
- 107xx : 700 16/28/33 · 701 8/12/14 · 702 8/12/14 · 703 10/16/20 · 704 4/4/4 · 705 4/4/4 · 706 13/22/30 · 707 9/14/15 · 708 9/14/14 · 709 8/9/13 · 710 4/4/4 · 711 4/4/4 · 712 8/9/13 · 713 8/9/13 · 714 8/9/13 · 715 4/4/4 · 716 11/13/21 · 717 5/6/9 · 718 12/14/21 · 719 12/14/21 · 720 7/10/10 · 721 5/6/9 · 722 19/22/28 · 723 19/22/15 · 724 10/14/13 · 725 10/14/13 · 726 6/8/5 · 727 9/11/15 · 728 9/11/15 · 729 5/6/9 · 730 9/9/17 · 731 9/9/17 · 732 6/8/12 · 733 4/2/4 · 734 6/7/9 · 735 10/8/5 · 736 9/11/15 · 737 7/7/11 · 738 16/18/26 · 739 15/16/24 · 740 10/11/16 · 741 4/2/1 · 742 7/10/11 · 743 5/6/9 · 744 4/4/4 · 745 11/14/14 · 746 11/14/14 · 747 8/9/13 · 748 8/9/13 · 749 6/8/9 · 750 21/23/32 · 751 23/22/32 · 752 5/6/7 · 753 18/17/15 · 754 14/15/24 · 755 8/12/10 · 756 7/10/16 · 757 8/8/1 · 758 8/8/1 · 759 6/2/1 · 760 6/2/1 · 761-766 12/6/1 · 767-770 10/8/1
- 108xx : 800 19/14/12 · 801 19/14/12 · 810 19/29/24 · 811 29/25/29 · 812 12/14/13 · 813 16/24/22 · 850 14/16/6 · 851 19/29/24 · 852 17/25/31 · 853 24/24/24 · 854 14/18/7 · 855 19/14/12 · 856 12/15/17 · 857 19/14/12 · 858 19/14/12
- 109xx : 900-902 4/2/1 · 980 15/21/13 · 981 16/24/22 · 982 13/20/10 · 984 13/17/23 · 990 42/60/55 · 991 27/41/34

Ordre dans le répertoire : 10800, 10801, 10810, … puis 10100…, et fin 10607-10609 (non trié ; `listModels` trie).

## Hypothèses et points ouverts

- Les noms d'objets ci-dessus sont déduits de la forme et de l'usage ; seul le joueur (990/991) est établi par le code.
- Rôle exact de `+0x10` et `+0x0c` pour les modèles où ils ne se déduisent pas des sommets (valeurs d'auteur).
- Le lien entre l'octet résiduel des faces 0x28 et un éventuel second usage n'est pas établi.
- Quel emplacement de texture pour quel modèle hors 14..68 (`render.md` §12).
