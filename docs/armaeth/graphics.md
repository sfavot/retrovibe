# Armaeth : graphismes

Archives `.VGA`, sprites, images de scènes (codec) et palette d'*Armaeth*. Lecteurs : `src/games/armaeth/data/{vga-archive,sprite,scene,palette}.ts`, tests : `test/armaeth/{vga-archive,sprite,scene,palette}.test.ts`. Les formats ont été établis par l'étude des données (`docs/armaeth/formats.md`) puis **confirmés par la lecture du code d'`AM1.EXE`** (`docs/armaeth/re-index.md`).

Confiance : **confirmé** = vérifié par le code et par un décodage exact de tous les fichiers ; **hypothèse** = lecture plausible non établie.

Adresses : `segment:offset` Ghidra (segment de base `1000`), avec entre parenthèses l'offset dans `AM1.EXE` (`0x4000 + (segment - 0x1000) * 16 + offset`).

## Archives `.VGA`

Deux variantes, toutes deux à entrées de 10 octets `{u16 id, u32 offset, u32 taille}` (offsets absolus), little-endian.

| Variante | Fichiers | Table | Code du moteur |
|---|---|---|---|
| A, à compteur | `A1FOBJ`, `A1FANM`, `A1FDEC`, `A1FINT` | `u16 n` puis `n` entrées | `gm_load_sprite_resource` `1735:000e` (0xB35E) |
| B, à 5 emplacements | `A1F00A`..`A1F03D` | 5 entrées fixes, sans compteur ; un emplacement vide est nul | `gm_load_scene` `1cc3:000e` (0x10C3E) : `lib_fread(buf, 10, 5)`, cherche l'id, échoue si offset et taille sont nuls |

Le nom du fichier de scène est calculé par `gm_open_scene_file` (`1e68:0322`, 0x129A2) : `A1F` + centaine de l'id + lettre `'A' + (id % 100) / 5` : cinq scènes par fichier.

**Confirmé** (tests) : pour les 4 + 15 fichiers, les ressources non vides se suivent sans trou (la première à `2 + 10n` ou à 50) et la dernière finit à la taille du fichier. 60 scènes (ids 0 à 315, tous distincts) ; sprites : INT 30, DEC 20, OBJ 92, ANM 47 ressources. `readCountedArchive` / `readSceneArchive` renvoient la liste des entrées et `bytes(id)`.

## Sprites

Ressource = en-tête de 0x20 octets, table d'offsets, section d'animation, images brutes (`gm_load_sprite_resource`, `1735:000e`).

| Octets | Contenu |
|---|---|
| +0 | u16 id interne : `OBJ` 2000 + id, `DEC` 1000 + id, `ANM` 3000 + id, `INT` id |
| +2 | u16 `n` : nombre d'images |
| +4 | u16 `a` : enregistrements d'animation de 12 octets |
| +6 | u16 `b` : mots (u16) d'animation |
| +8 | u32 `P` : taille de la zone d'images (la longueur est contrôlée par le moteur) |
| +12 | u16 0x16, puis 18 octets de pointeurs mémoire sauvegardés tels quels (sans sens dans le fichier ; seuls octets qui diffèrent entre langues : 4 mots de segment) |
| +0x20 | `n` u32 : offsets des images, relatifs au début de la zone d'images |
| +0x20 + 4n | section d'animation : `12a + 2b` octets |
| `taille - P` | zone d'images |

Image : `u8 H`, `u8 L`, puis `L` colonnes de `H` pixels, **rangées colonne par colonne** (largeur `L`, hauteur `H`) ; `0xFF` = transparent. `readSprite` renvoie les images en lignes (`pixels[y * width + x]`).

**Confirmé** : les **189 ressources** se décodent sans reste (les images se suivent sans trou et finissent à la fin de la ressource), soit **1 028 images** (INT 82, DEC 182, OBJ 493, ANM 271), de 16 × 28 à 48 × 58. Contrôle visuel : planche des 102 images de `OBJ` 1 (le héros : debout, de profil, escalade, assis, couché) et de `OBJ` 101 (personnage en vert), avec la palette d'`AM1.EXE`.

La section d'animation est conservée **brute** (`animation.bytes`, avec `records` et `words`). Sens établi par `engine.md` § 6.3 (`animStep`, `1833:0006`) : `a` enregistrements de 12 octets **indexés par `Fig`** (`rec[1]` : l'image est en miroir à gauche ; `rec[2]`, `rec[3]` : pas `dpX`, `dpY` ; `rec[4+2d]` : début de la séquence de la direction `d`), puis des séquences de mots `[n, pas…]` où **pas = `(durée << 8) | image`** (bit 0x80 de l'octet haut = miroir). Pour les ressources `INT` : 3 enregistrements (`Fig 0` variante gauche, `Fig 1` variante droite, `Fig 2` image cachée 1×1) ; détail et exemples dans `interface.md` § 3.2.

## Images de scènes

### Ressource de scène

Ordre de lecture de `gm_load_scene` (`1cc3:000e`) ; mots u16 de l'en-tête de 0x30 octets :

| Octet | Rôle | Preuve |
|---|---|---|
| +0 | id | table de l'archive |
| +4 | nombre d'enregistrements de 20 octets en fin de ressource : **décors** (objets de type 1, `gm_create_object` ; champs dans `engine.md` § 5.3) | `1cc3` |
| +6 | nombre d'enregistrements de 10 octets en fin de ressource : **points sensibles** `{id de message, x0, x1, y0, y1}` (`engine.md` § 5.2) | `1cc3` |
| +8, +10 | `x`, `y` du rectangle de l'image dans l'écran | paramètres de `1f94:0008` |
| +12, +14 | largeur, hauteur | idem ; contrôle `x + largeur <= 320`, `y + hauteur <= 200` (`1cc3:0221..0291`) |
| +0x1E | nombre de plans (grille de marche 81 x 21 = 0x6A5 cases par plan) | `1cc3` |
| +0x20 | nombre d'enregistrements de 16 octets de la grille | `1cc3` |
| +0x22 | nombre d'enregistrements de 16 octets (le moteur vérifie `w[5] >= w[2]` et `w[3] >= w[4]`) : **zones** des objets de `Dep` 2 et 4 : enregistrements `{u8 type, u8 0xFF, s16 rangée, s16 col début, s16 Y haut (hi), s16 Y bas (lo), s16 col fin}` (`Y haut` avant `Y bas` ; `movement.md` § 1.1) | `1cc3` |
| +0x24..0x29 | 6 octets, permutation de 0..5 (`DGROUP:4b88`, `4b94`) ; absente (non `00..05`) dans 105, 201, 306, 311, 314 | `1cc3` |
| +0x2C, +0x2E | **taille en octets des couches A et B**, type compris (0 = couche absente) | **confirmé** : chaque couche décodée consomme exactement ce nombre |

Les mots 9 à 14 de l'en-tête (`header.words`, octets +0x12 à +0x1C) sont les **limites de la salle** `Xmin, Xmax, Ymin, Ymax, Pmin, Pmax` (`movement.md` § 1.1, typiquement `0, 319, 0, 179, 8, 159`) ; le mot 8 (+0x10) n'est pas `Pmax + 1` (faux sur les 60 scènes), son rôle reste inconnu. Le reste (mots +2, +0x2A, mot 8) est conservé brut (`header.words`). Ordre : en-tête, enregistrements de 16 octets (grille), enregistrements de 16 octets (zones), 40 mots (80 octets : **20 paires (X min, X max) par rangée de profondeur**, `engine.md` § 5.2 et § 7.4), couche A, couche B, points sensibles de 10 octets, décors de 20 octets. `readScene` expose ces trois derniers en champs typés (`rowRanges`, `hotspots`, `decors`). **Confirmé** : la somme tombe exactement sur la taille de la ressource pour les 60 scènes.

### Couche d'image : `gm_decode_scene_image` (`1f94:0008`, 0x13948)

Appelée par `gm_load_scene` avec le rectangle de l'en-tête (`AX` = mode du pilote vidéo, 0x13 en VGA ; `DX` = largeur, `BX` = hauteur ; `x`, `y` sur la pile). Flux :

1. un octet de **type** : 0, 1 ou 2 (autre : erreur 2) ;
2. pour chacune des `hauteur` lignes : un entier `n`, un entier `m`, puis `m` octets. Un entier est la somme d'octets lus tant qu'ils valent 0xFF (`1f94:028e`, `1f94:02d6`) ; `n` doit être <= 100 (erreur 4), `m` < 0x400 (erreur 6) ;
3. le décompresseur (`type` 0 et 1 : `34bb:0008`, `type` 2 : `34bb:0142`) reçoit l'entrée, une sortie, la taille de tampon 0x400, `&n` et `&m` ; il décompresse **sur place** (copie de l'entrée dans un tampon de travail) et laisse dans `m` le nombre de pixels. Ce nombre doit égaler la largeur (erreur 10) ;
4. recoloration (une table de 256 octets lue octet par octet) : type 1 si `mode == 0x13` (table `DGROUP:5312`), type 2 si `mode != 0x13` (table `DGROUP:5412`). **En VGA, seul le type 1 est recoloré.**

**Décompresseur A** (`34bb:0008`, `gm_unpack_rle`, 0x28BB8) : si `n == 0` rend l'entrée telle quelle ; sinon une seule passe (`n` n'est lu que pour ce test) : paquets `00 k <k octets>` (littéraux) ou `c v` (`v` répété `c` fois), jusqu'à épuisement de l'entrée ; erreur si la sortie dépasse 0x400.

**Décompresseur B** (`34bb:0142`, `gm_unpack_nibble`, 0x28CF2) : **`n` passes** successives ; la sortie d'une passe est l'entrée de la suivante (`34bb:02e5..02fd` : l'entrée épuisée, saut à `34bb:014a` qui décrémente `n` et recopie la sortie dans le tampon d'entrée) ; `n == 0` rend l'entrée telle quelle. Une passe lit des paquets `00 k <k octets>` (littéraux) ou `c base <ceil(c/2) octets>` : chaque octet donne `base + (b >> 4)` puis `base + (b & 15)`, modulo 256 ; si `c` est impair le dernier pixel est écarté (la boucle l'écrit mais le pointeur d'écriture n'avance que de `c`). Limite de sortie : 0x400 pour les littéraux, 0x401 pour un paquet de pixels.

C'était la clé du cas `n > 1` signalé comme non élucidé dans `re-index.md` : ces lignes sont **compressées plusieurs fois** (jusqu'à 7 passes) ; une ligne à `n = 2` décodée en une passe ne donnait que 214 pixels sur 320, en deux passes elle en donne 320.

**Confirmé** : toutes les couches des **60 scènes** (120 couches) se décodent avec consommation exacte de l'entrée, aucune sortie de rectangle et un total d'octets égal à la taille annoncée en +0x2C / +0x2E. Statistiques des lignes : type 2, `n` = 0 : 119 lignes (copiées telles quelles, de largeur déjà exacte), 1 : 7 148, 2 : 925, 3 : 120, 4 : 24, 5 : 160, 6 : 37, 7 : 1 ; type 0 : `n` = 1 partout (8 534 lignes). **Aucune scène ne contient de couche de type 1** : le chemin est implémenté d'après le code (`SceneOptions.recolorType1`, table `readRecolorTables(exe).type1`) mais n'a jamais été exercé sur des données réelles.

### Rôle des deux couches

Dans les 60 scènes la couche A est de type 2 et la couche B de type 0. **Contrôle visuel** (rendu PNG avec la palette d'`AM1.EXE`, sans cisaillement ni bruit) : scènes 0 (cadre d'interface 320 x 200), 2, 5 (chapitre 0), 20 (écran 00E avec les portraits Killian, Armaeth, Minas, Prytwen), 101, 106 (chapitre 1), 201, 211 (chapitre 2), 302, 315 (chapitre 3) : la couche A est l'image de décor (ou le cadre pour la scène 0) ; la couche B n'est **pas** une image colorée :

- hors scène 0, ses valeurs sont uniquement des multiples de 8 de 0 à 160 (21 niveaux, comme les 21 rangées de la grille de marche), en aplats qui suivent le relief du décor : c'est une **carte de profondeur / de masque d'avant-plan** (hypothèse : le moteur ne dessine un personnage devant un pixel que si sa profondeur le permet) ;
- dans la scène 0 (cadre d'interface), la couche B est de même un gabarit en aplats qui reprend la forme du cadre, pas une image du cadre (valeurs non relevées).

Dans le moteur, la couche B (type 0) est écrite dans le tampon d'écran 320 x 200 (`DGROUP:0ee0`, taille 0xFA00, `1005:0109`) ; une couche de type 1 ou 2 est écrite sur l'écran lui-même (lecture / écriture de lignes par les entrées `+0x42` / `+0x3e` du pilote vidéo). Dans les deux cas un pixel n'est remplacé que si la valeur déjà présente dans le tampon `0ee0` est inférieure à 200, et les pixels hors du rectangle sont remplis de 0xDD (VGA) ou 0 (autre) et marqués 199 dans le tampon. Cette composition n'est pas portée par `readScene` : le lecteur renvoie les couches telles quelles.

## Palette

**Confirmé** : une seule palette, de 256 entrées VGA 6 bits (768 valeurs de 0 à 63) à l'offset **246 402** d'`AM1.EXE` (`DGROUP:5512`, DGROUP = 224 624). Le pointeur de palette (`DGROUP:4b04`) n'est écrit qu'**une fois**, par `gm_init_engine` (`1005:00af`, 0x40FF). Il est passé au pilote vidéo (entrée `+0x4a` de sa table) avec trois entiers par `gm_init_video` (`1d7b:004c`, avec 0, 0, 0), la boucle principale (`18a9:04c7`, trois fois la même valeur), un jeton de commande (`1250:011a`) et `1611:01b9` : **ce sont les mêmes appels avec le même pointeur ; seuls les trois entiers changent** (hypothèse : coefficients de luminosité par composante, utilisés pour les fondus). Il n'existe donc **pas de palette par scène ni par chapitre** : les scènes, les sprites et l'interface partagent celle-ci. Aucun accès direct aux registres DAC (3C8h/3C9h) dans `AM1.EXE`.

Contenu : entrée 0 noire, entrées 1 à 9 magenta (63, 0, 63), rampe de gris, puis rampes de couleur ; entrée 255 = clé de transparence des sprites. Les six octets qui suivent la palette (`DGROUP:5812..5817`) et la couleur de texte (`5818..581a`, passée à l'entrée `+0x72` du pilote) ne sont pas lus.

Les deux tables de 256 octets qui précèdent la palette sont `DGROUP:5312` (type 1, offset 245 890) et `DGROUP:5412` (type 2, offset 246 146). La seconde ressemble à une conversion vers les 16 couleurs EGA (nombreuses valeurs 0, 8, 7, 15, 0x88, 0xFF) ; la première n'est pas une identité (valeurs 10, 85, 36, 16, 180...). `palette.ts` : `readDefaultPalette(exe)` (à convertir par `vga6ToRgb8`), `readRecolorTables(exe)`.

## Ce qui reste inconnu

- **Couches de type 1** : aucune dans les données ; la recoloration par `DGROUP:5312` est portée mais non vérifiée.
- **Rôle exact de la couche B** (carte de profondeur ?) et composition réelle dans le moteur (tampon `0ee0`, seuil 200) : à confirmer en lisant les routines de blit du pilote `VGA.EXE` (`+0x6a`, `+0x6e` de sa table).
- `A1FDEF.SYS` : non étudié ici (section d'animation des sprites : voir plus haut ; `A1FANI.SYS` : `formats.md`).
- **Enregistrements de 16 octets** de la grille de marche et des zones (sémantique dans `engine.md` § 7.1 et § 7.2), mots +2, 8 et +0x2A de l'en-tête : conservés bruts par `readScene` (mots 9 à 14 = limites de la salle).
- **Permutation de 6 octets** (+0x24) : usage inconnu ; valeurs différentes de `00..05` dans les scènes 105, 201, 306, 311, 314.
- **Trois entiers du pilote de palette** : sens (fondus ?) non vérifié ; sixième octet après la palette inutilisé.
