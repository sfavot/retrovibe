# SWIV 3D — `GLOBAL.BD`

Les 28 ressources de `original/swiv3d/GLOBAL.BD`, leur rôle et leur format. Le conteneur (`parseBd`, `src/games/swiv3d/data/bd.ts`) est décrit dans `re-index.md`. Les adresses et noms de fonctions viennent de la rétro-ingénierie de `SWIV_WIN.EXE` (corpus décrit dans `re-index.md`, décompilations dans `archives/swiv3d/re/decomp/`). « Confirmé » : lu dans le code et vérifié sur le fichier (rendu à l'œil pour les images). « Hypothèse » : déduit, non prouvé.

Lecteurs : `strings.ts` (100), `font.ts` (507, 508 et le format des sprites RLE), `missions.ts` (600), `global.ts` (tout le reste, `parseGlobal` assemble l'ensemble). Tests : `test/swiv3d/{strings,font,missions,global}.test.ts`.

## Vue d'ensemble

| Id | Taille | Rôle | Statut | Lecteur |
|---|---:|---|---|---|
| 1 | 203 | Texte d'en-tête, jamais lu par le jeu | confirmé | `parseHeader` |
| 2 | 4 | Drapeaux u32 (= `0xb2`) | confirmé | `parseHeader` |
| 100 | 79 298 | Chaînes localisées | confirmé | `parseStrings` |
| 200 | 126 012 | Police vectorielle 3D (lettres extrudées) | confirmé | `parseVectorFont` |
| 450 | 35 297 | Police des versions accélérées (3Dfx/D3D) | hypothèse | octets bruts |
| 451 | 98 304 | Atlas 256×384 (8 bits) des icônes du HUD, versions accélérées | rendu confirmé, rôle hypothèse | octets bruts |
| 452 | 128 392 | Jauge d'énergie des versions accélérées (44 entrées) | hypothèse | octets bruts |
| 500 | 28 672 | Atlas 256×112 de formes floues (versions accélérées) | hypothèse | octets bruts |
| 501 | 24 410 | Icônes d'armes du HUD, 22 sprites RLE de 24×38 | confirmé | `parseRleSprites` |
| 502 | 1 848 | Chargé, jamais relu | inconnu | octets bruts |
| 503 | 71 280 | Jauge d'énergie du HUD, 44 images de 20×81 | confirmé | `parseGauge` |
| 504 | 229 376 | Animation d'explosion, 56 images de 64×64 | confirmé | `parseTextures` |
| 505 | 70 560 | Impacts/explosions rétrécissants, 96 images de 21×35 | confirmé | `parseSprites21x35` |
| 506 | 37 120 | Viseurs rotatifs, 32 images de 29×40 | confirmé (29ᵉ colonne : hypothèse) | `parseSprites29x40` |
| 507 | 50 237 | Police 2D : 384 glyphes RLE | confirmé | `parseFont` |
| 508 | 1 536 | Avances des 384 glyphes | confirmé | `parseFont` |
| 509 | 512 | 256 u16 : rampes de couleur | format hypothèse | `parseColorRamp` |
| 510 | 117 150 | Radar : 32 images (cadre rotatif) | confirmé, rôle hypothèse | `parseRleSprites` |
| 511 | 16 505 | Radar : 128 petites images (triangles) | confirmé, rôle hypothèse | `parseRleSprites` |
| 512 | 123 636 | Radar : 128 images (éclats rotatifs) | confirmé, rôle hypothèse | `parseRleSprites` |
| 600 | 3 024 | Script des missions | confirmé | `parseMissions` |
| 700 | 3 072 | Profils de cratère | confirmé | `parseCraters` |
| 800 | 65 536 | Table de mélange 256×256 | confirmé | `parseBlendTable` |
| 1001-1005 | 136 960 | Écrans plein cadre 320×400 | confirmé (table de 8 Ko : inconnue) | `parseScreen` |

## Chargement (`gm_global_init`, `0046fa58`)

Ordre : bloc 2 (drapeaux, `gm_global_load_block` `0046f288`), tampon de 0x21700 octets, écrans selon les drapeaux (`gm_global_read_block` `0046f3a4`, ids `0x3e8`, `0x3ec`, `0x3ed`), puis 100, 200, 502, 504, et, selon `DAT_0048464c` (0 = rendu logiciel) : 505, 501, 503, 510, 511, 512 (logiciel) ou 500, 451, 452, 450 (accéléré) ; enfin 507, 506, 508, 600, 800, 700, 509. Les blocs 1, 450-452 et 500 ne servent pas à `SWIV_WIN.EXE` (logiciel). Le bloc 1000 n'existe pas (drapeau `0x80`).

### Bloc 2, drapeaux (`DAT_0048462c`)

`0xb2` = `0x80 | 0x20 | 0x10 | 0x02`. Confirmés par le code : `0x01` démo (`swivdemo.cfg`, charge 1005) ; `0x20` charge 1004 ; `0x40` force la piste CD 2 ; `0x80` pas de chargement de 1000 et séquence d'intro de `gm_main_game`. `0x02` : testé par `gm_main_game` (chargement de 1005 pendant l'intro), effet exact non établi ; `0x10` : jamais testé trouvé. Constantes : `GLOBAL_FLAGS`.

## Bloc 100, chaînes (confirmé)

Répertoire de 163 enregistrements `(id u16, groupe u16, offset u32)` terminé par `0xffff`. Groupes 0-7 : une langue chacune (ordre English, Francais, Deutsch, Espanol, Italiano, Polski, Cestina, Portugu**ê**s), 20 tables par langue (0-13, 20, 22, 100, 200, 1000, 1001). Groupe 99 : tables communes (0 noms des langues, 1 « 0 », 2 « 00000110 »). Table = paires `(id u32, offset u32)` terminée par `0xffffffff`, textes NUL-terminés, `|` = saut de ligne. Fonctions : `gm_get_string` `0046f8f4` (clé `langue << 16 | table`), `gm_get_string_shared` `0046f9b0` (`0x630000 | table`), `gm_global_reloc_strings` `0046f834`, `gm_set_language` `0046f1e8`.

Codage : page de code 437 pour les langues de page 0 (le français décode correctement, `é` = 0x82, `ô` = 0x93, `à` = 0x85, vérifié sur la police rendue). Octets de contrôle propres au jeu : `0x18`-`0x1b` flèches haut/bas/droite/gauche, `0x1c`/`0x1d` flèches de rotation gauche/droite (glyphes de 14 et 15 pixels). La table commune 2 donne, par langue, la **page de glyphes** (`0` pour sept langues, `1` pour Polski et Cestina) : `gm_set_language` remplit `005bba28[c]` (identité 0-126, `page·128 + c` pour 128-255). Les pages 0 et 1 ne se décodent donc pas pareil ; `StringTables.get` ne décode que la page 0 (la page 1 est rendue en Latin-1, hors périmètre puisque seuls le français et l’anglais sont visés ; les glyphes 256-383 de la police, rendus, montrent bien Ą Ć Ę Ł Ń Ó Ś Ź Ż Č Ď Ě Ň Ř Š Ť Ů Ž).

Tables (français, id → usage) : 1 menu principal (10 « Commencer le jeu », 11 « Continuer », 12 « Rejouer la mission », 13 « Installer », 14 « Revoir l'intro », 15 « Crédits », 16 « Multi-joueur », 18 « Nouveau joueur », 19 « Quitter »), 2 setup, 3 contrôleurs, 4 pause, 5 multijoueur, 6 gamma, 7 fin de niveau, 8 volume, 9 musique, 10 scores, 11 rejouer une mission, 12 capture d'écran, 13 abandon, 20 objectifs, 22 repères de carte, 100 noms de bonus (40), 200 noms de missions (0-3 : Fastoche, Chercher et Détruire, L'Estuaire Sanglant, Montagnes Russes ; 100-111 : Combat à mort 1-12), 1000 `#n`, 1001 dispositions de clavier. Les fonctions `gm_menu_*` donnent le groupe lu (voir `re-index.md`). Textes affichés : la copie est celle du jeu d'origine.

## Blocs 507 et 508, police 2D (confirmé)

- 507 : table de 384 offsets u32 (relatifs au bloc, premier `0x600`), puis un sprite RLE par glyphe (format ci-dessous). 508 : 384 u32, avance en pixels (valeurs 2 à 15, 6 pour l'espace).
- Index d'un glyphe : `c` pour 0-126, 0 pour 127, `page·128 + c` pour 128-255 : donc 0-127 communs, 128-255 page 0 (CP437), 256-383 page 1. 196 glyphes sont vides (contrôles non utilisés, espace). Hauteur typique 13 pixels, ligne de base environ 4 pixels sous le point de dessin.
- Dessin : `gm_draw_text` `004229c8` (alignement 0 centré, 1 gauche, 2 droite ; coupe à 0x118 pixels), `gm_text_width` `00422e44`, blitters `FUN_00414c7e` et `gm_blit_rle_glyph_a` `0041508b`.
- Rendu vérifié : « Commencer le jeu », « Crédits », « Installation du contrôleur », « Configuration du contrôleur » (accents, flèches comprises) et le jeu de caractères complet des pages 0 et 1.

### Format des sprites RLE à 4 plans (confirmé par rendu des blocs 501, 507, 510-512)

Un bloc commence par la table d'offsets u32 (le premier offset divise par 4 pour donner le nombre de sprites). Un sprite = 4 flux, un par plan du mode X (plan `k` = colonnes `4c + k`), sur une mémoire de 80 octets par ligne et par plan :

| Octet | Sens |
|---|---|
| `0xff` | fin du plan |
| `0x80` + u16 | saute ce nombre d'octets |
| `0x80 \| n` | saute n octets |
| `n << 4 \| t` (n ≥ 1) | n pixels de teinte t |
| `0x0t` | la banque devient `t << 4` (persistante, y compris d'un plan au suivant) |

Un pixel n'est pas une couleur mais un **numéro de ligne** `banque + teinte` dans la table de mélange 256×256 (bloc 800) : la couleur écrite vaut `table[ligne << 8 | couleur_déjà_présente]`. Les sprites se superposent donc à l'image en la teintant (fondus, ombres). Les flux sont relatifs au point de dessin : `RleSprite.x/y` donne le rectangle englobant. Pour 510-512 le point de dessin est l'origine de l'écran (positions absolues).

## Bloc 200, police vectorielle (confirmé)

1024 enregistrements de 28 octets (indexés comme la police 2D) puis les données ; `gm_global_reloc_objtable` `0046f894` ajoute la base aux trois pointeurs. Champs i32 : `+0` largeur (avance du jeu : `(largeur >> 2) + 5`), `+4` sommets (offset), `+8` nombre de sommets, `+12` triangles (offset), `+16` nombre de triangles, `+20` normales (offset), `+24` nombre de normales. Les emplacements vides valent `(45, -1, 0, -1, 0, 0x7000, 23)`. Sommets = 3 i32 `(x, y, z)` (lettre centrée, `z = ±38`), triangles = 4 i32 `(a, b, c, indice de normale)`, normales = 23 vecteurs de 3 i32 partagés (256 = longueur 1, offset `0x7000`). 158 glyphes renseignés : `! %`, chiffres, majuscules, minuscules, accents de la page 0 et quelques glyphes de la page 1. Utilisation : `FUN_00423974` (projette et éclaire chaque triangle), `FUN_00424454` (disposition du texte flottant au-dessus des objets : `|` sépare les lignes, interligne 300). Rendu vérifié (« SWIV 3D ABCXYZ 0123456789 ! % é à ç è » en faces avant éclairées).

## Bloc 600, script des missions (confirmé)

189 éléments de 16 octets `(étiquette i32, a, b, c)` exécutés par `gm_main_game` `00421614` jusqu'à l'étiquette -1 :

| Étiquette | Sens |
|---|---|
| 100 / 101 / 102 / 103 `(variable, valeur)` | affecte / maximise / minimise / additionne. Variables 0, 1, 2 : champs `+0x38`, `+0x3c`, `+0x34` du profil ; 3 : `00577670` ; 4 : `004841b0` ; ≥ 5 : u16 du profil à `i·2 − 0xbc` (109 et 119 apparaissent partout). Sens métier des variables : hypothèse |
| 200 `n` | début de la mission n ; `gm_menu_retry` saute jusqu'au `200 n` choisi (balayage en avant) ; le profil mémorise la mission la plus haute (`+0x20`) |
| 300 + nom (12 octets) | niveau : fichier `<nom>.SLV` (`gm_slv_load`) puis boucle de jeu |
| 400 + 6 u16 | pistes CD par contexte (table `005bba10[6]`, défaut `{2, 9, 3, 2, 2, 2}`) |
| 500 + nom | vidéo Smacker jouée (`BR_TER0` briefing, `END_TER`, `END_ART`, `END_LUN`, `OUTRO`), coupe la piste CD |
| 600 `(r, g, b)` | `00484650 = (r·256 + g)·256 + b` : (100, 100, 120) par défaut, (170, 50, 50) sur MARS, (0, 0, 0) sur LUNAR01 ; rôle : couleur d'ambiance (brouillard/ciel : hypothèse) |
| -2 | fin de l'aventure livrée : met la progression du profil à `0xb4c69` |
| -1 | fin du script |

Structure : 17 missions (index 0-16) ; l'élément 46 (premier -1) clôt la chaîne jouée d'affilée (missions 0-3 = `TERRAN00-03`, puis `200 999`, `-2`, `-1`) ; les 13 missions suivantes (`TERRAN04-06`, `TERRANBS`, `ARCTIC01-03`, `LUNAR01`, `MARS01-05`, vidéos `BR_TER4-6`, `BR_TERB`, `END_TER`, `END_ART`, `END_LUN`, `OUTRO`) ne sont atteintes que par le menu. Seuls `TERRAN00-03.SLV` sont livrés (édition « CUTDOWN »). Les 12 octets d'un nom contiennent du résidu mémoire après le NUL. Les `500` précèdent ou suivent le `300` selon que la vidéo est un briefing ou une fin.

## Bloc 700, cratères (confirmé)

`FUN_00424f44` (`param_2` = taille 0, 1 ou 2, soit rayon 10000/20000/30000) lit `700 + taille·0x400 + ((z >> 12 & 3)·4 + (x >> 12 & 3))·0x40` : 3 tailles × 16 phases (position sous-cellule de l'impact) × 16 profondeurs i32 (4×4 cellules de terrain, abaissées de cette valeur dans la carte de hauteur). Premier profil : croix de profondeur 1, centre 11.

## Bloc 800, table de mélange (confirmé)

256×256 octets : `table[ligne << 8 | pixel]`. Ligne `0xf0` = identité (donc transparente), `0x00` = noir, `0xef`/`0x7f` = quasi constantes (tout devient la couleur `0x1a`) ; les lignes `0xe0`-`0xef` forment un fondu progressif. Pointeur `005bc180`, lu par `gm_blit_rle_glyph_a`, `FUN_00414c7e`, `FUN_00437af0`. Dépend de la palette du niveau (le `.SLV` en possède une propre, id 108, différente).

## Blocs graphiques du HUD et des effets

- **501** (confirmé) : 22 sprites RLE 24×38 : cadre vide (0), 20 icônes d'armes dans une capsule, flèche (21). `gm_draw_hud` `0042ec80` les dessine avec `FUN_00414c7e` / `FUN_004151c3` à l'image `slot + 1`.
- **503** (confirmé) : 44 images de 4 plans × 81 lignes × 5 octets = 20×81 pixels (1620 octets), chaque octet est un numéro de ligne de la table 800 (`0xf0` = transparent). `FUN_00437af0` (appelée par `gm_draw_hud`, clignote sous 100) : jauge d'énergie verticale, indexée par le niveau.
- **504** (confirmé) : 56 images de 64×64 octets, ligne par ligne ; animation d'explosion (flamme, puis fumée blanche et verte). `FUN_00435688` (appelée par `gm_render_view` `0042b31c`) les étire en sprites ; l'octet est une ligne de la table 109 des `.SLV` (`005bc13c`), 0 = transparent. Les dernières images sont vides.
- **505** (confirmé) : 96 images de 21×35 octets, rangées **colonne par colonne** (`FUN_004353f4`) : 6 séries de 16 images rétrécissantes (boules de feu, flash vert, nuage, étoile, étincelles, flamme). Même table 109.
- **506** (confirmé, `FUN_00437c38`) : 32 images de 29 colonnes × 40 lignes (pas de 0x488 octets), colonne par colonne ; le code ne lit que 28 colonnes (la 29ᵉ est un remplissage : hypothèse). Viseurs rotatifs en deux séries de 16 (jaune, rouge). Table 109, 0 = transparent.
- **510 / 511 / 512** (formats confirmés, rôle hypothèse) : sprites RLE lus par `gm_draw_overlay_sw` `004362b8` (`FUN_00414c7e` à l'origine) après le tracé du radar ; 510 (32 images, `& 0x1f`) : cadre ovale rotatif de 59×95 ; 511 (128 images de ~10×8, `& 0x7f`) : triangles ; 512 (128 images de ~61×95, `& 0x7f`) : éclats rotatifs du cadre. L'angle de la caméra choisit l'image.
- **509** (hypothèse sur le format) : 256 u16 copiés tels quels dans `005bb810` par `0046f0c0` (appelée pendant le chargement d'un niveau). Lus en ARGB 4-4-4-4 : 8 rampes de 32 couleurs (feu noir-orange-jaune-blanc, gris, rouge, vert-jaune, vert, bleu…) dont l'alpha décroît de 15 à 0 ; premier u16 `0xf000`, dernier `0x0fff`. Sans doute des rampes pour les versions accélérées.
- **502** (inconnu) : 1848 octets, tous entre `0xf0` et `0xff` (lignes proches de l'identité de la table 800). Chargé dans `005bc18c`, aucune lecture trouvée. Dimensions non établies (1848 = 4 × 462 ; le début montre une période de 3 octets).
- **450-452, 500** (versions accélérées 3Dfx/D3D, non utilisés par `SWIV_WIN.EXE`, rôle hypothèse) : 451 = atlas 8 bits de 256 colonnes × 384 lignes avec les icônes du HUD (501), les cadres du radar, une flèche ; 500 = atlas 256×112 de formes floues (valeurs 0-3, ellipses, anneaux) ; 452 = table de 44 offsets (176, 2986, …) puis données : la jauge (503) ; 450 = 384 offsets (`0x600`, `0x601`… puis irréguliers), glyphes courts à lignes terminées par `0xfe` et fin `0xff` : la police (507). Non décodés.

## Blocs 1001-1005, écrans plein cadre (confirmé)

Chaque bloc fait 136 960 = `0x300` + `0x2000` + 4 × 32 000 octets (ni 320×428 ni 640×214) : palette VGA 6 bits (768 octets), un tableau de 8192 octets, puis l'image 320×400 en 4 plans du mode X (le pixel `x` est dans le plan `x & 3`, octet `y·80 + (x >> 2)`). Fonctions : `FUN_0042fddc` (efface l'écran et charge la palette, en passant par la table de gamma `00587fb8[valeur + gamma·0x40]`), `FUN_0042fd24` (copie les plans depuis `+0x2300` et fixe `005bc158 = tampon + 0x300`), `FUN_0042ff5c` (copie vers `A0000`/`A8000`, bascule de page). Contenu (rendu vérifié) : 1001 mentions légales (Viewpoint Datalabs, Smacker, Miles Sound System, Microsoft), 1002 crédits, 1003 titre « SWIV 3D » avec Interplay/SCi et copyright, 1004 « an SCi game », 1005 titre « TEMPERATE ZONE ». `gm_main_game` affiche 1003, puis 1002, puis 1001 (une touche entre chaque) ; 1004 et 1005 viennent de l'intro (drapeaux `0x20`, `0x01`/`0x02`).

Le tableau de 8192 octets est identique pour 1001 et 1002, différent pour 1003-1005 ; il est lu sous la forme `table[(ligne << 8) | 0x7f]` par le radar (couleur de point par type d'objet, `gm_draw_overlay_sw`) et `table[n]` par `0043607c`/`004359c8` quand `005bc158` pointe sur le bloc 11003 d'un `.SLV` (qui a la même forme : `0x300` octets de palette puis `0x2000`). Pour ces écrans (affichés avant le niveau) il n'a pas de rôle visible : table de 32 lignes de 256 octets, usage dans l'écran : inconnu.

## Questions ouvertes

- Rôle des variables ≥ 5 du script de mission (109, 119…) et de l'élément 600 (couleur d'ambiance ?).
- Bloc 502 (dimensions, rôle), blocs 450-452/500 (lire `SWIV_WFX.EXE`/`SWIV_WDX.EXE`), format exact de 509.
- Bit `0x10` des drapeaux, effet exact de `0x02`.
