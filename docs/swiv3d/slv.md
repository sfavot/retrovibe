# Niveaux `.SLV` de SWIV 3D (hors modèles 3D)

Lecteur : `src/games/swiv3d/data/level.ts` (`parseLevel`), tests : `test/swiv3d/level.test.ts`. Conteneur `.BD` commun : voir `re-index.md` et `src/games/swiv3d/data/bd.ts`. Les modèles 3D (blocs 10xxx/11xxx) sont traités à part (`model.ts`). Fichiers : `TERRAN00-03.SLV` et `DEMO.SLV` (« cutdown » : 169 ressources, pas de bloc 200).

Les études `objects.md` (objets, chemins) et `render.md` (rendu, palettes, tables) sont plus précises et font foi en cas de contradiction avec ce document ; les corrections qu'elles imposaient y sont reportées.

Légende : **confirmé** = établi par le code décompilé et/ou un rendu qui a l'air juste ; **hypothèse** = déduit.

## Chargement (`gm_slv_load`, `004545a8`)

Le fichier entier est lu dans un tampon de 2 000 000 octets (`gm_slv_alloc` `00453ac4`), les blocs sont retrouvés par id dans le répertoire final (`gm_slv_find` `00453bbc`, ou boucles inline `(offset, taille, id)`), puis :

| Id | Pointeur | Utilisation |
|---|---|---|
| 100 | `005b1fc4` | hauteur |
| 102 | `005b1fa8` | carte « sol » |
| 103 | `005b1fac` | carte de couleurs (passée à `gm_draw_overlay_sw`) |
| 105 | `005b1fc8` | objets |
| 107 | `005b1fc0` | points de passage |
| 106 | `005b1fa4` | table du terrain de faible détail, 64 lignes × 256 |
| 108 | `005bc180` | table de fondu 256×256 |
| 109 | `005bc13c` | table de teintes |
| 110 | `005b1f9c` | silhouettes d'ombres (faces de type 0x28) |
| 500 / 501 | `005b1f74` / `005b1f94` | 500 : table d'assombrissement (lignes 0..31) et flou du rotor (lignes 32..47) ; 501 absent de nos fichiers |
| 11003 | `005b1f98` | palette du jeu (0x300 octets) puis table d'attributs `005bc158` |
| 200 | copie dans `005bbe28` | 0x300 octets ; **absent** des SLV livrés |

Puis `gm_slv_index_models`, `gm_slv_setup_tiles` (textures 12xxx), `gm_level_spawn_objects` (`0043e958`, bloc 105). Le bloc 104 n'est référencé par aucun code : la liste des identifiants cherchés par `gm_slv_load` (100, 102, 103, 105, 107, 106, 108, 109, 110, 500, 501, 200, 11003, 11004) est la même dans `SWIV_WIN.EXE`, `SWIV_WFX.EXE` (`004545a8`) et `SWIV_WDX.EXE` (`0045b5fb`-`0045bb9d`).

## Terrain

### 100 : carte de hauteur (confirmé)

512×512 octets, index `z * 512 + x`, monde **torique** (indices masqués `& 0x1ff`). `gm_terrain_height` (`004256c0`) : cellule = `position >> 14` (positions en virgule fixe `<< 8`), fraction sur 8 bits `(position >> 6) & 0xff`, interpolation bilinéaire, résultat `octet * 0x400`. En unités de position d'objet (celles du bloc 105 : 64 par cellule), **1 pas de hauteur = 4 unités** (`HEIGHT_UNITS`), soit 1/16 de cellule : 255 pas = environ 16 cellules. Valeurs observées : min 28 (eau à 28-30 dans TERRAN00), max 255 ; TERRAN03 descend à 0. `gm_terrain_crater` (`00424a24`, `00424f44`) abaisse les cellules d'un cratère de 4×4 cellules dans cette carte. Rendu en niveaux de gris : relief cohérent (rivière, collines).

### 102 : carte « sol », indice de couleur par cellule (confirmé pour l'accès, hypothèse pour le lien avec le bloc 12000)

512×512 octets. Même interpolation (`gm_terrain_map2_sample` `00425840`), copiée dans l'attribut de couleur du sommet par `00426c14` (`unaff_EBX[3]`) avec un éclairage calculé à partir des pentes de la carte 100. Constats :

- `(valeur & 0xe0) == 0`, soit **valeur < 0x20 : eau**. Le jeu y ajoute une vague animée (table `00481050`, `00425c94`, `004268fc`, `00426c14`). Dans TERRAN00 : 5 359 cellules d'eau, toutes à hauteur 28-30 ; TERRAN03 : aucune.
- Les cratères ajoutent `2 × profondeur` à la valeur, plafonnée à `0xf0` (`00424f44`) ; max observé 240-246.
- Corrélation de 0,90 avec la hauteur : la valeur croît avec l'altitude (eau, sable, herbe, roche).
- **Confirmé** (`render.md` §6.1) : le sol est texturé par le bloc 12000 lu comme **32 tuiles 64×64 contiguës** ; tuile = `valeur >> 3` (eau : tuiles 0 à 3, la tuile 0 est animée), texel `(x & 63, z & 63)` de la tuile. Ce n'est pas un atlas de 256 colonnes : l'ancienne lecture « ligne `2 × valeur` de l'atlas 256×512 » revenait à cette tuile. Le terrain de faible détail n'est pas texturé : `couleur = t106[(lumière >> 1) << 8 | valeur]` (bloc 106).

### 103 : carte de couleurs précalculée (confirmé)

512×512 octets, indices dans la palette du jeu (bloc 11003, voir plus bas). Rendue telle quelle, c'est la vue de dessus complète du niveau (rivière, plages, herbe, roche, routes). Le seul lecteur trouvé est `gm_draw_overlay_sw` (`004362b8`, appelée par `gm_frame` `0042f64c` avec `005b1fac`) : échantillonnage tourné autour du joueur, donc la carte radar. Le moteur 3D utilise 102 + 12000 (+ 106 à faible détail) pour le sol.

### Palette du jeu (11003, confirmé) et ce que le moteur doit faire

Les `0x300` premiers octets du bloc 11003 sont une palette VGA 6 bits (valeurs 0..63) ; le jeu la convertit en `v << 2` (`gm_slv_setup_tiles` `00453ed4`), le lecteur utilise `vga6ToRgb8` (`v << 2 | v >> 4`). Le reste du bloc (8 960 - 768 octets, table `005bc158` indexée par un champ d'objet, `0043607c`) et le bloc 11004 (`004442ec`) relèvent des blocs 11xxx : non traités ici.

**La palette d'exécution est 11003** (`render.md` §1-2) : c'est elle que le jeu envoie au DAC, à travers une table de gamma 4×64 (niveau 0 = identité ; un port peut s'en passer). Tout pixel du niveau (carte 103, sprites, framebuffer) est un indice de 11003. Les textures n'en sortent jamais directement : un texel d'atlas `i` est envoyé par la **table de lumière** (`+0x100` du bloc 12xxx : 128 lignes de 256 octets) : `pixel = table[lumière][i]` est l'indice 11003 affiché. Lumière plafonnée à 110 (0x6e) ; ligne 100 pour les faces de type 4 (non éclairées).

**La palette de queue des blocs 12xxx n'est pas lue par le jeu.** Elle est exacte pour l'aperçu : c'est la couleur de l'atlas à pleine luminosité (ligne 126 de la table ≈ 98 % de cette palette ; ligne 100 ≈ 77 %), ce qui explique que le visionneur trouve les pixels d'atlas « directement » justes avec la palette de queue et justes via la ligne 100 de la table avec 11003. La palette de texture `005b1c70` que fabrique `gm_slv_setup_tiles` (`11003[ligne100[i]] << 2`, indice 0 = magenta pour 12001-12004) n'est lue par aucun chemin logiciel. Pour le moteur : charger 11003 comme palette unique, rendre les textures par `table[lumière][texel]` avec les tables des blocs 12xxx (jamais 11003 direct sur un texel d'atlas, jamais la palette de queue), et ne se servir de la queue que pour des aperçus hors moteur.

## Textures 12000-12004 (confirmé)

`gm_slv_setup_tiles` (`00453ed4`) et `gm_slv_load_tilesets` (`00453c18`). Disposition d'un bloc :

| Offset | Taille | Contenu |
|---|---|---|
| `0x0000` | `0x100` | en-tête (non lu) |
| `0x0100` | `0x8000` | **table de lumière**, 128 lignes de 256 : `table[lumière][texel] → indice 11003` (le jeu la recopie à une adresse alignée sur 256 ; pour 12001-12004 la colonne 0 est remise à 0) ; la ligne 100 sert aux faces de type 4 |
| `0x8100` | `0x10000` (12001-12004) ou `0x20000` (12000) | pixels indexés : 12001-12004 = atlas 256×256 ; 12000 = **32 tuiles 64×64 contiguës** |
| suite | `0x300` | palette RGB **8 bits** (non lue par le jeu mais exacte : couleur d'atlas à pleine luminosité ; l'indice 0 est le magenta `ff00ff` de transparence dans 12001-12004) |
| suite | `0x180` (12000 seul) | 32 triplets `(r, g, b)` de u32 : **teinte de chacune des 32 tuiles de sol** (couleur moyenne de la tuile, canal maximal ramené à 255) ; pointeur `_DAT_005b1fb4`, écrit et jamais relu |

Tailles : 12000 = `0x28580`, 12001-12004 = `0x18400`.

- **12001-12004** : atlas 256×256 = 4×4 tuiles de 64×64, tuile `k` à `+(k & 3) * 0x40 + (k >> 2) * 0x4000`, pas de ligne 256. Le bloc `12000 + n` remplit les emplacements `16n + k` (`k` de 0 à 15) des tables `005b0690` (pointeur de tuile) et `005b1950` (table de lumière). Ces emplacements sont indexés par le champ « texture » `in_EAX[5]` des polygones des modèles (`00430380`, `00430f40`, `004329b4`) : ce sont les **textures des modèles 3D** (avions, véhicules, bâtiments), pas du terrain. Vérifié visuellement (cockpits, ailes, roues).
- **12000** : **32 tuiles 64×64 contiguës** de 4 096 octets (offset `k × 0x1000`, pas de ligne 64 ; `Tileset.layout = "tiles"`, lues ainsi par le terrain, `DAT_0058369c`). Tous les 200 emplacements pointent d'abord sur son début ; les emplacements 16 à 79 sont ensuite remplacés par 12001-12004. C'est la texture du sol (voir 102) ; la table de lumière du sol est celle de l'emplacement 0 (12000). Le lecteur l'expose ainsi (`tileOffset`, `tileStride`, `groundTile`) ; la queue de 0x180 octets s'exploite par `groundTileTints` et la palette de queue reste lue.

## Objets : bloc 105 (confirmé)

Enregistrements de **64 octets** (16 i32 LE, et non 16 octets comme supposé dans `re-index.md`), lus avec le pas `+0x10` entiers par `gm_level_spawn_objects`. Le dernier enregistrement a `type = -1`. Détail des comportements et de la création : `objects.md` §4.3 (qui fait foi). Champs `REC[i]` (nom dans `LevelObject`) :

| Champ | Nom | Sens |
|---|---|---|
| 0 | `type` | type |
| 1, 2 | `x`, `z` | x, z en unités d'objet (64 par cellule de carte ; passés à `gm_object_init`, qui les décale de 8) |
| 3 | `angle` | cap sur 512 pas (`& 0x1ff` dans les tables de sinus `00483186`/`00483986`), max observé 504 |
| 4 | `model` | modèle du corps (`+0x4c`) ; modèle des avions engendrés pour 6300 ; non lu pour 1000-1002 |
| 5 | `childModel` | modèle de l'enfant (tourelle, antenne) ou du bonus (largué par un 2000 si `REC[7] ∈ [1000, 2000[`, posé par 7000/7002) |
| 6 | `hitPoints` | points de vie du corps ; l'enfant reprend les mêmes |
| 7 | `subtype` | code d'arme (100-701) des tourelles, chars, bateaux, avions ; bonus `1000 + n` (porté ou posé) ; **groupe d'objectifs `5000 + g`** (`g` de 0 à 9, `objectiveGroup`, `0043cda4`). Ce n'est **pas** un « sous-modèle `REC[7] - 5000` » (affirmation antérieure erronée) ; aucune autre valeur n'est lue |
| 8 | `thrust` | `+0x0c` de l'objet : vitesse/poussée (chars, bateaux : 0, 40 ou 50 ; poussée = `3 × thrust`) |
| 9, 10 | `params[5..6]` | **non lus** par le jeu (`REC[10]` recopie l'indice de la carte 102 dans 84 % des cas : valeur d'éditeur) |
| 11 à 15 | `params[7..11]` | paramètres des fabriques et hangars (6000 : modèle du char, modèle de la tourelle, pv, arme, vitesse ; 6100-6110 : modèle de l'avion, -, pv, arme, vitesse ; `REC[15]` aussi vitesse des avions) ; 6300 n'en lit aucun |

`LevelObject.params` conserve les champs 4 à 15 bruts (`params[i]` = champ `i + 4`).

Les coordonnées vont de 832 à 32 331 (carré de 512 cellules), sauf **TERRAN03 qui monte à 46 022** : le monde étant torique, les objets sont replacés modulo.

Classes de types dans le code (seuils comparés) : `1000-1002` départs des joueurs (la 1001 de DEMO est l'unique départ du niveau de démo), `1002` n'est pas rencontré ; `2000-2003` cibles destructibles et décors (arbres, bâtiments) ; `3000-3001` structures ; `4001-4002` ; `5000-5500` ; `6000-6300` ; `7000-7011` décors/bonus. Le sens de chaque type (modèles, pv, comportements, table de création) est établi dans `objects.md` §4.4-5.

Comptes par niveau (le terminateur est exclu, vérifié par `level.test.ts`) :

| Type | T00 | T01 | T02 | T03 | DEMO |
|---|--:|--:|--:|--:|--:|
| 1000 | 1 | 1 | 1 | 1 | 0 |
| 1001 | 0 | 0 | 0 | 0 | 1 |
| 2000 | 114 | 321 | 221 | 150 | 40 |
| 2002 | 165 | 141 | 353 | 260 | 0 |
| 2003 | 225 | 131 | 24 | 143 | 263 |
| 3000 | 18 | 77 | 72 | 40 | 9 |
| 3001 | 0 | 2 | 0 | 8 | 0 |
| 4001 | 5 | 11 | 0 | 0 | 0 |
| 4002 | 0 | 7 | 10 | 3 | 0 |
| 5000 | 5 | 17 | 23 | 9 | 0 |
| 5002 | 0 | 7 | 13 | 6 | 0 |
| 5500 | 0 | 0 | 20 | 0 | 6 |
| 6000 | 0 | 1 | 8 | 1 | 0 |
| 6100-6110 | 0 | 2 (6110) | 7 (6100) | 3 (6101) | 0 |
| 6300 | 0 | 0 | 0 | 3 | 0 |
| 7000 | 48 | 96 | 73 | 61 | 0 |
| 7002/7010/7011 | 0 | 0 | 2 (7010 ×1, 7011 ×1) | 7 (7002 ×5, 7011 ×2) | 0 |
| **Total** | 581 | 814 | 827 | 695 | 319 |

Le rendu composite montre les 2000/2002/2003 serrés le long de la route et de la base centrale de TERRAN00, des 7000 isolés dans la campagne (bonus/décors), des 3000 autour de la rivière.

## Points de passage : bloc 107 (confirmé, `objects.md` §9)

Nœuds de 9 i32 (36 octets), terminés par un nœud tout à zéro dont le champ 6 vaut -1 : `(lien0, lien1, lien2, lien3, x, z, navires, aéronefs, terrestres)`. Le lien 0 vaut l'indice précédent, le lien 1 le suivant (sauf le premier nœud, qui renvoie au dernier tronçon), les deux autres relient les embranchements (-1 si aucun). Positions en unités d'objet : le tracé (points verts du rendu composite) suit les routes/chemins de la carte 103. Nombres de nœuds : 86, 265, 757, 182 et 83 (DEMO). Lu par les fonctions de comportement `004262a4`…`00443284`.

Les champs 6, 7, 8 sont des **compteurs de capacité par classe de véhicule** (`Waypoint.capacity`) : champ 6 = navires (`5500`), champ 7 = aéronefs (`4002`), champ 8 = véhicules terrestres (`5000`, `5002`, `6000`). Un nœud accepte un véhicule de la classe tant que son compteur est `> 0` ; en s'y engageant le véhicule fait `c -= 1`, en partant `c += 1` : avec `c = 1`, **un seul véhicule par nœud et par classe**. Valeurs : terrestres 1 sur presque tous (15 nœuds à 0 dans TERRAN02, 51 dans DEMO), navires 0 sauf 245 nœuds d'eau de TERRAN02 et 51 de DEMO, aéronefs 1 sauf DEMO (0 sur les nœuds d'eau).

## Tables et sprites de rendu (exposés bruts)

Les blocs 104, 106, 108, 109, 110, 500, la palette 11003 et les atlas 12000-12004 sont **identiques dans les cinq fichiers** (vérifié) : seuls 100, 102, 103, 105 et 107 changent d'un niveau à l'autre.

- **104** (1 048 octets, **non chargé**) : en-tête de 6 u32 `0x93 0x93 0x93 1 1 0`, puis 1 024 octets (octets ≤ 0x7f) d'ensembles de couleurs `(r, g, b)` en dégradés de tons verts, jaunes et rouges, les premières entrées de 16 octets prenant la forme `(c, d, c, 0)` avec `c`, `d` à trois octets (`07 2a 07`, `2a 7f 2a`…) mais le découpage cesse d'être aligné ensuite (les canaux se décalent d'un octet d'une entrée à l'autre : pas de structure en quatre couleurs). Aucun des trois exécutables ne le charge (identifiants de `gm_slv_load` relevés dans WIN, WFX et WDX) : donnée résiduelle d'éditeur, rôle inconnu et sans conséquence pour un port. Identique dans les cinq fichiers. Exposé brut (`Level.rampTable`).
- **106** (16 384) : 64 lignes × 256 colonnes, table du **terrain de faible détail** : `couleur = t106[(lumière >> 1) << 8 | carte102]` (`004147df`, `render.md` §6). Le lecteur l'expose dans `pattern106`.
- **108** (65 536) : table 256×256 de fondu des sprites RLE (`pixel = table[(teinte + banque) << 8 | pixel]`), commence par une ligne de zéros. Déjà décrit dans `re-index.md`.
- **109** (32 768) : 128 lignes de 256 octets ; la ligne 0 est l'identité, la dernière est constante `0x5d`. Lue par `004349ac`, `004353f4`, `00435688`, `00437c38`.
- **110** (65 536) : image 256×256 à 32 valeurs (0..31) : silhouettes d'avions de profil, cernées de dégradés = **silhouettes d'ombres** projetées au sol par les faces de type 0x28 (`00433f64`, `render.md` §8.3).
- **500** (12 288 = 48 × 256) : lignes 0..31 = table d'assombrissement `dst' = t500[s << 8 | dst]` (ombres) ; lignes 32..47 = image 64×64 de flou du rotor (valeurs 0..31, faces de type 1, `00433414`).

## Rendus de vérification (non versionnés, dossier temporaire)

- Composite TERRAN00 (carte 103 en palette 11003, ombrée par la pente de 100, objets en points colorés par type, nœuds 107 en vert) : `/private/tmp/claude-501/-Users-suzy--claude-spares-spare-9bRfK1/05eebc03-1c7e-4340-b149-d5424537c369/scratchpad/composite.png`. Les objets suivent la route et la base centrale, bordent la rivière : bonne preuve de la lecture des coordonnées et de l'échelle de 64 unités par cellule.
- Atlas : `.../atlas12001_tail.png` (palette de queue de bloc) et `.../atlas12000_tail.png` (lecture ancienne en 256 colonnes).
- Terrain texturé par 12000 via 102 : `.../terrain102_atlas.png` (ancienne lecture ligne `2 × valeur`, équivalente à la tuile `valeur >> 3`).

## Questions ouvertes

- Rastériseur du terrain, éclairage et tables 108/109 : voir `render.md` (§6, §2) ; ouverts là-bas : quel emplacement de texture pour quel modèle hors 14..68, ligne 127 des tables de lumière.
- Types d'objets absents des niveaux livrés (2001, 3002, 5001, 8000-8040, 14000…) : `objects.md` §4.4.
- Bloc 200 (palette de secours, absent des fichiers livrés) et bloc 501 (absent : son seul lecteur `00415259`, fonction sans appelant, dessine des sprites par entrées de 16 octets, hypothèse : code mort).
- Bloc 104 : rôle inconnu (non chargé par le jeu).
