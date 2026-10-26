# Niveaux `.SLV` de SWIV 3D (hors modèles 3D)

Lecteur : `src/games/swiv3d/data/level.ts` (`parseLevel`), tests : `test/swiv3d/level.test.ts`. Conteneur `.BD` commun : voir `re-index.md` et `src/games/swiv3d/data/bd.ts`. Les modèles 3D (blocs 10xxx/11xxx) sont traités à part (`model.ts`). Fichiers : `TERRAN00-03.SLV` et `DEMO.SLV` (« cutdown » : 169 ressources, pas de bloc 200).

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
| 106 | `005b1fa4` | motif 128×128 |
| 108 | `005bc180` | table de fondu 256×256 |
| 109 | `005bc13c` | table de teintes |
| 110 | `005b1f9c` | silhouettes d'ombres |
| 500 / 501 | `005b1f74` / `005b1f94` | tables (501 absent de nos fichiers) |
| 11003 | `005b1f98` | palette du jeu (0x300 octets) puis table d'attributs `005bc158` |
| 200 | copie dans `005bbe28` | 0x300 octets ; **absent** des SLV livrés |

Puis `gm_slv_index_models`, `gm_slv_setup_tiles` (textures 12xxx), `gm_level_spawn_objects` (`0043e958`, bloc 105). Le bloc 104 n'est référencé par aucun code.

## Terrain

### 100 : carte de hauteur (confirmé)

512×512 octets, index `z * 512 + x`, monde **torique** (indices masqués `& 0x1ff`). `gm_terrain_height` (`004256c0`) : cellule = `position >> 14` (positions en virgule fixe `<< 8`), fraction sur 8 bits `(position >> 6) & 0xff`, interpolation bilinéaire, résultat `octet * 0x400`. En unités de position d'objet (celles du bloc 105 : 64 par cellule), **1 pas de hauteur = 4 unités** (`HEIGHT_UNITS`), soit 1/16 de cellule : 255 pas = environ 16 cellules. Valeurs observées : min 28 (eau à 28-30 dans TERRAN00), max 255 ; TERRAN03 descend à 0. `gm_terrain_crater` (`00424a24`, `00424f44`) abaisse les cellules d'un cratère de 4×4 cellules dans cette carte. Rendu en niveaux de gris : relief cohérent (rivière, collines).

### 102 : carte « sol », indice de couleur par cellule (confirmé pour l'accès, hypothèse pour le lien avec le bloc 12000)

512×512 octets. Même interpolation (`gm_terrain_map2_sample` `00425840`), copiée dans l'attribut de couleur du sommet par `00426c14` (`unaff_EBX[3]`) avec un éclairage calculé à partir des pentes de la carte 100. Constats :

- `(valeur & 0xe0) == 0`, soit **valeur < 0x20 : eau**. Le jeu y ajoute une vague animée (table `00481050`, `00425c94`, `004268fc`, `00426c14`). Dans TERRAN00 : 5 359 cellules d'eau, toutes à hauteur 28-30 ; TERRAN03 : aucune.
- Les cratères ajoutent `2 × profondeur` à la valeur, plafonnée à `0xf0` (`00424f44`) ; max observé 240-246.
- Corrélation de 0,90 avec la hauteur : la valeur croît avec l'altitude (eau, sable, herbe, roche).
- **Hypothèse forte** : le sol est texturé par le bloc 12000 (atlas 256×512 en bandes d'altitude : eau en haut, sable, herbe, roche en bas) à la ligne `2 × valeur`. Un rendu à plat `atlas12000[2 * v][(3x + 5z) & 255]` donne un terrain réaliste (voir plus bas). Le tracé exact (colonne, répétition) n'est pas établi : le rastériseur du terrain n'a pas été isolé.

### 103 : carte de couleurs précalculée (confirmé)

512×512 octets, indices dans la palette du jeu (bloc 11003, voir plus bas). Rendue telle quelle, c'est la vue de dessus complète du niveau (rivière, plages, herbe, roche, routes). Le seul lecteur trouvé est `gm_draw_overlay_sw` (`004362b8`, appelée par `gm_frame` `0042f64c` avec `005b1fac`) : échantillonnage tourné autour du joueur, donc la carte radar. Le moteur 3D utilise 102 + 12000 pour le sol.

### Palette du jeu (11003, confirmé)

Les `0x300` premiers octets du bloc 11003 sont une palette VGA 6 bits (valeurs 0..63) ; le jeu la convertit en `v << 2` (`gm_slv_setup_tiles` `00453ed4`), le lecteur utilise `vga6ToRgb8` (`v << 2 | v >> 4`). Le reste du bloc (8 960 - 768 octets, table `005bc158` indexée par un champ d'objet, `0043607c`) et le bloc 11004 (`004442ec`) relèvent des blocs 11xxx : non traités ici. La palette d'exécution du terrain est `palette[ligne 100 de la table de teintes du jeu de textures][i]` (`DAT_005b1c70`, `0x6400` octets après le début des données) : elle donne les verts et ocres du sol.

## Textures 12000-12004 (confirmé)

`gm_slv_setup_tiles` (`00453ed4`) et `gm_slv_load_tilesets` (`00453c18`). Disposition d'un bloc :

| Offset | Taille | Contenu |
|---|---|---|
| `0x0000` | `0x100` | en-tête (non lu) |
| `0x0100` | `0x8000` | table de teintes, 128 lignes de 256 (le jeu la recopie à une adresse alignée sur 256) ; la ligne 100 sert de table de recodage vers la palette 11003 |
| `0x8100` | `0x10000` (12001-12004) ou `0x20000` (12000) | atlas indexé, largeur 256 |
| suite | `0x300` | palette RGB **8 bits** (non lue par le jeu mais exacte : l'indice 0 est le magenta `ff00ff` de transparence dans 12001-12004 et le rendu est correct) |
| suite | `0x180` (12000 seul) | trois u32 répétés `0x62 0xdd 0xff` : non identifié (`_DAT_005b1fb4`) |

Tailles : 12000 = `0x28580`, 12001-12004 = `0x18400`.

- **12001-12004** : atlas 256×256 = 4×4 tuiles de 64×64, tuile `k` à `+(k & 3) * 0x40 + (k >> 2) * 0x4000`, pas de ligne 256. Le bloc `12000 + n` remplit les emplacements `16n + k` (`k` de 0 à 15) des tables `005b0690` (pointeur de tuile) et `005b1950` (table de teintes). Ces emplacements sont indexés par le champ « texture » `in_EAX[5]` des polygones des modèles (`00430380`, `00430f40`, `004329b4`) : ce sont les **textures des modèles 3D** (avions, véhicules, bâtiments), pas du terrain. Vérifié visuellement (cockpits, ailes, roues).
- **12000** : atlas 256×512, tous les 200 emplacements pointent d'abord sur son début ; les emplacements 16 à 79 sont ensuite remplacés par 12001-12004. C'est la texture du sol (voir 102).

## Objets : bloc 105 (confirmé)

Enregistrements de **64 octets** (16 i32 LE, et non 16 octets comme supposé dans `re-index.md`), lus avec le pas `+0x10` entiers par `gm_level_spawn_objects`. Le dernier enregistrement a `type = -1`. Champs :

| Champ | Sens |
|---|---|
| 0 | type |
| 1, 2 | x, z en unités d'objet (64 par cellule de carte ; passés à `gm_object_init`, qui les décale de 8) |
| 3 | cap sur 512 pas (`& 0x1ff` dans les tables de sinus `00483186`/`00483986`), max observé 504 |
| 5, 6 | passés aux comportements (`004261a0(local_28[5], local_28[6], …)`) : hypothèse, points de vie ou vitesse |
| 7 | sous-type des ennemis 2000 et 2003 : `local_28[7] - 5000` choisit le modèle (`0043cda4`), 1000-1999 compte comme cible (`005b03f4`), 5000+ = chargements |
| 8, 11 à 15 | lus par certains types |

Les coordonnées vont de 832 à 32 331 (carré de 512 cellules), sauf **TERRAN03 qui monte à 46 022** : le monde étant torique, les objets sont replacés modulo.

Classes de types dans le code (seuils comparés) : `1000-1002` départs des joueurs (la 1001 de DEMO est l'unique départ du niveau de démo), `1002` n'est pas rencontré ; `2000-2003` ennemis aériens ou terrestres ; `3000-3001` structures ; `4001-4002` ; `5000-5500` ; `6000-6300` ; `7000-7011` décors/bonus. Le sens de chaque type fin n'a pas été établi au-delà de cette classification : `gm_level_spawn_objects` fait 11 Ko, ses branches ne sont pas toutes décodées.

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

## Points de passage : bloc 107 (hypothèse sur le sens, confirmé pour la forme)

Nœuds de 9 i32 (36 octets), terminés par un nœud tout à zéro dont le champ 6 vaut -1 : `(lien0, lien1, lien2, lien3, x, z, 0, 1, 1)`. Le lien 0 vaut l'indice précédent, le lien 1 le suivant (sauf le premier nœud, qui renvoie au dernier tronçon), les deux autres relient les embranchements (-1 si aucun). Positions en unités d'objet : le tracé (points verts du rendu composite) suit les routes/chemins de la carte 103. Nombres de nœuds : 86, 265, 757, 182 et 83 (DEMO). Lu par les fonctions de comportement `004262a4`…`00443284`. Hypothèse : réseau suivi par les véhicules ennemis.

## Tables et sprites de rendu (exposés bruts)

Les blocs 104, 106, 108, 109, 110, 500, la palette 11003 et les atlas 12000-12004 sont **identiques dans les cinq fichiers** (vérifié) : seuls 100, 102, 103, 105 et 107 changent d'un niveau à l'autre.

- **104** (1 048 octets) : en-tête de 6 u32 `0x93 0x93 0x93 1 1 0`, puis 64 groupes de 4 u32 de la forme `(c, d, c, 0)` avec `c`, `d` à trois octets (`07 2a 07`, `2a 7f 2a`…), probablement des rampes de couleur (hypothèse). Aucun lecteur trouvé ; identique dans les cinq fichiers.
- **106** (16 384) : motif de 128×128 octets, périodique de 8 en 8 (valeurs `20/8a/08/0b/dd`), lu par un tracé de spans texturés (`004147df`, appelé par `gm_render_view`). Rôle inconnu.
- **108** (65 536) : table 256×256 de fondu des sprites RLE (`pixel = table[(teinte + banque) << 8 | pixel]`), commence par une ligne de zéros. Déjà décrit dans `re-index.md`.
- **109** (32 768) : 128 lignes de 256 octets ; la ligne 0 est l'identité, la dernière est constante `0x5d`. Lue par `004349ac`, `004353f4`, `00435688`, `00437c38`.
- **110** (65 536) : image 256×256 à 32 valeurs (0..31) : silhouettes d'avions de profil, cernées de dégradés = **sprites d'ombre** (hypothèse sur l'emploi : ombres au sol). Lue par `00433f64` et `00453ed4`.
- **500** (12 288) : 3 × 64 × 64 ; les trois premières lignes sont `00..3f`, `40..7f`, `80..bf`, puis du bruit ; rôle inconnu (lue par `00433414`, `00433f64`).

## Rendus de vérification (non versionnés, dossier temporaire)

- Composite TERRAN00 (carte 103 en palette 11003, ombrée par la pente de 100, objets en points colorés par type, nœuds 107 en vert) : `/private/tmp/claude-501/-Users-suzy--claude-spares-spare-9bRfK1/05eebc03-1c7e-4340-b149-d5424537c369/scratchpad/composite.png`. Les objets suivent la route et la base centrale, bordent la rivière : bonne preuve de la lecture des coordonnées et de l'échelle de 64 unités par cellule.
- Atlas : `.../atlas12001_tail.png` (palette de queue de bloc) et `.../atlas12000_tail.png`.
- Terrain texturé par 12000 via 102 : `.../terrain102_atlas.png`.

## Questions ouvertes

- Rastériseur du terrain : colonne de texture dans 12000, rôle exact de l'éclairage (blocs 108/109), lien entre 102 et la palette d'exécution.
- Table complète des types d'objets (1000-14000) ↔ modèles 10xxx ↔ comportements ; rôle des champs 5, 6, 8, 11-15.
- Blocs 104, 106, 500 ; bloc 200 (palette de secours, absent) et 501.
- Nature exacte des 0x180 octets de fin de 12000.
