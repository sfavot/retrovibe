# Lure of the Temptress : formats des fichiers

Étude de la vague 0, mise à jour par la vague D (hors sons : lecteurs de `src/games/lure/data/`, tests de `test/lure/data/`). Statut de chaque point : **vérifié** (mesuré sur les fichiers d'`original/lure/` ou confronté à ScummVM compilé), **lu** (lu dans le code de ScummVM, pas encore confronté aux fichiers), **supposé**.
Référence : moteur `lure` de ScummVM (`engines/lure/`, GPL v3 ou ultérieure) et outil `devtools/create_lure/` qui produit `dists/engine-data/lure.dat`. On lit le code pour comprendre, puis on le réécrit.

## 1. Contenu de l'archive (vérifié)

`archives/lure-fr-1.1.zip` (3,4 Mo), dossier `lure-fr/` :

| Fichier | Octets | Rôle | À versionner |
| --- | --- | --- | --- |
| `DISK1.VGA` | 603 648 | conteneur `heywow` n° 1 : 39 ressources (police, curseurs, menus, textes, sons, écrans de l'introduction) | oui, tel quel |
| `DISK2.VGA` | 659 488 | conteneur n° 2 : 103 ressources (dont la protection `0x4139`, le générique `0x7800`) | oui |
| `DISK3.VGA` | 699 072 | conteneur n° 3 : 118 ressources | oui |
| `DISK4.VGA` | 609 984 | conteneur n° 4 : 77 ressources (dont la fin `0xFF00`/`0xFF01`, le tonneau `0xE9F0`) | oui |
| `LURE.EXE` | 138 220 | exécutable DOS (MZ, **non compressé** : la chaîne « Copyright Revolution Software 1990-1992 … assembled 11:08:08 on 07/22/92 » est lisible) ; toutes les tables codées en dur du jeu | non (sert seulement à régénérer `lure.dat`, reste dans `archives/`) |
| `Manual.pdf` | 1 742 214 | manuel français, 42 pages (« Procédure d'installation de Lure of the temptress ») | à décider (D3 du plan) |
| `PROTECT.PDF` | 138 359 | 3 pages de la protection de copie | non (protection non portée, D2) |
| `LICENSE.txt` | 1 285 | licence de Revolution (freeware) | oui, **obligatoire** (copié en `LICENSE-LURE.txt`) |
| `README` | 692 | note de ScummVM (2007) | non (pas un fichier de Revolution) ; son contenu utile va dans l'aide |

Identification (vérifié) : la détection de ScummVM hache les 1 024 premiers octets de `disk1.vga` (`_md5Bytes = 1024`) : `1c94475c1bb7e0e88c1757d3b5377e94` = entrée `FR_FRA`, DOS, VGA, disquettes. La somme des 1 024 premiers octets de `LURE.EXE` vaut `0xD38C` = `FRENCH_FILE_CHECKSUM` de `create_lure` (segment de données `0xB060`).

Licence de Revolution (résumé) : distribution gratuite avec la licence et les mentions intactes (1), pas de vente du jeu (3), **modification autorisée si la version modifiée porte une mention visible qui le dit** (4), contenu © Revolution Software (5). Même régime que Drascula et FOTAQ : `LICENSE-LURE.txt` dans `original/lure/`, mention de version modifiée dans l'aide.

## 2. Conteneur `heywow` (DISKn.VGA) (vérifié, `data/container.ts`)

- En-tête : `"heywow"` (6 octets), numéro de disque en **grand-boutiste** sur 16 bits (1 à 4 ; 0 pour un bloc de `lure.dat`).
- Puis **0xBF = 191 entrées de 8 octets** (petit-boutiste) : `id` u16, `unused` u8 (**`0xFF`** dans tous les fichiers du jeu, pas 0), `sizeExtension` u8, `size` u16, `offset` u16. Fin de la liste au premier `id = 0xFFFF`.
- Position = `offset × 32` (alignement sur 32 octets) ; taille = `size + (sizeExtension ? 0x10000 : 0)` (ressources de plus de 64 Ko).
- Nombre d'entrées : 39, 103, 118, 77 (= 337) ; la dernière ressource finit à moins de 32 octets de la fin du fichier ; aucun identifiant en double ; aucune ressource ne déborde du fichier (le lecteur le refuse).
- **Disque d'une ressource** = `(id >> 14) + 1` (deux bits de poids fort de l'identifiant) ; les identifiants `0x3Fxx` sont ceux de `lure.dat` (`diskOfId`). Chaque identifiant se trouve bien sur le disque que la règle désigne.
- **Écrans de remplacement** (lu, `Disk::getEntry`) : pour les identifiants `0x008`, `0x120`, `0x311`, `0x410` (aux deux bits hauts près), si le champ `AREA_FLAG` de l'état vaut non nul, l'identifiant est inversé sur le bit `0x8000`. **Correction** : ces quatre identifiants désignent des **animations de hotspots** (`0xC008`, `0xC120`, `0xC311`, `0xC410` du disque 4, mêmes formats et tailles que `0x4008`, `0x4120`, `0x4311`, `0x4410`), pas des écrans. C'est un état du jeu, pas du lecteur : le lecteur reste pur, le moteur passe l'identifiant corrigé (`areaScreenId`).
- API : `HeywowContainer` (un fichier), `LureResources` (les quatre disques et le bloc : `get(id)`, `has(id)`, `size(id)`, `allIds()`), `diskOfId`, `areaScreenId`.

## 3. `lure.dat` (vérifié, `data/lure-dat.ts`)

Produit par `devtools/create_lure` (≈ 3 200 lignes C++) **à partir des `LURE.EXE` de chaque langue**, à des positions codées en dur par langue (`if (language == FR_FRA) dataStart = …`), avec des **corrections** de ScummVM (`WORKAROUND`, 5 dans l'outil) et des **tables écrites à la main** (verbes et menus `frenchTextStrings`, table de décodage des textes `frenchDecoders`, identifiants `frenchGiveTalkIds`).

Fichier de ScummVM (`dists/engine-data/lure.dat`, 768 832 octets, version **1.32**, l'entrée de version est à `0xBF × 8` : `unused = 1`, `sizeExtension = 0x20`) :
- `"lure"`, u16 0, puis une table de langues (u8 langue, u32 position), terminée par `0xFF`.
- Six blocs : anglais (3, `0x600`), italien (7), allemand (10), espagnol (5), russe (17), **français (6, `0x9C200`, 129 344 octets jusqu'à la fin du fichier)**.
- **Chaque bloc a exactement le format d'un `DISKn.VGA`** (`"heywow"`, numéro 0, 191 entrées, positions relatives au début du bloc). `LureResources` ouvre donc `LURE-FR.DAT` comme un disque de numéro 0.

Contenu du bloc français (vérifié : 26 ressources, 127 489 octets utiles). Colonne « lecture » : le lecteur qui la décode ; « reste » : octets que la structure ne lit pas (tous expliqués plus bas).

| Id | Octets | Contenu | Lecteur | Reste non lu |
| --- | --- | --- | --- | --- |
| `0x3F01` | 768 | palette du jeu (256 couleurs de 6 bits) | `parsePalette` | aucun |
| `0x3F02` | 204 | sous-palette de remplacement (68 couleurs) | `parsePalette` | aucun |
| `0x3F03` | 336 | cadre des boîtes de texte | `expandDialogFrame` | 2 derniers octets (zéros) |
| `0x3F04` | 48 | cadre des bulles de dialogue | `expandTalkDialogFrame` | 5 derniers octets (zéros) |
| `0x3F05` | 3 552 | pièces : table de décalages (**45 pièces**) puis `RoomResource` (40 octets) et sorties (16 octets chacune) | `parseRooms` | octets 92 à 103 (zéros) |
| `0x3F06` | 4 164 | emplois du temps : 33 index de scripts, 39 ensembles d'actions aléatoires, 53 emplois du temps (de 608 à 4 164, contigus) | `parseNpcSchedules` | octets 590 à 607 (**non initialisés**) |
| `0x3F07` | 13 084 | hotspots : 211 enregistrements de 62 octets, `0xFFFF` | `parseHotspots` | aucun |
| `0x3F08` | 862 | surcharges de hotspots : 86 x 10 octets, `0xFFFF` | `parseHotspotOverrides` | aucun |
| `0x3F09` | 1 624 | sorties-hotspots : table par numéro de pièce (51 mots), 47 listes de 14 octets | `parseRoomExitHotspots` | aucun |
| `0x3F0A` | 158 | jonctions de sorties : 12 x 13 octets, `0xFFFF` | `parseRoomExitJoins` | aucun |
| `0x3F0B` | 47 676 | animations de hotspots : 161 x 18 octets, `0xFFFF`, puis les listes de mouvements (6 octets, `0xFFFF`) | `parseAnimData` | aucun |
| `0x3F0C` | 11 351 | segment de scripts (séquences, bytecode de `Script::execute`) | `Segment` | aucun (segment adressé par décalage) |
| `0x3F0D` | 10 240 | second segment (scripts d'animation des hotspots, opcodes `S2_OPCODE_*`) | `Segment` | aucun (idem) |
| `0x3F0E` | 48 | 24 décalages de scripts de hotspots | `parseHotspotScriptOffsets` | aucun |
| `0x3F0F` | 1 168 | messages : 23 personnages, listes de couples `(valeur, id)` | `parseMessages` | octets 1 154 à 1 167 (zéros) |
| `0x3F10` | 1 168 | listes d'actions (verbe vers séquence) : 74 listes | `parseActionLists` | octets 1 025 à 1 167 (**non initialisés**) |
| `0x3F11` | 1 394 | en-têtes des dialogues : 28 personnages | `parseTalkHeaders` | octets 1 392 et 1 393 (**non initialisés**) |
| `0x3F12` | 10 272 | dialogues : 6 identifiants de « Donne », 226 enregistrements (entrées et réponses de 6 octets) | `parseTalkData` | octets 1 370 à 1 381 (**non initialisés**) |
| `0x3F13` | 6 120 | grilles de cheminement : 51 grilles de 120 octets (40 x 24 blocs de 8 pixels, 1 bit par bloc), pièce `n` à `(n - 1) × 120` | `parseRooms` (vue), `decompressPaths` | grilles des pièces 16, 26, 33, 37 (données de l'exécutable) et 50, 51 (zéros), sans pièce |
| `0x3F14` | 4 314 | coordonnées des sorties : 49 x 88 octets, `0xFFFF` | `parseRoomExitCoordinates` | aucun |
| `0x3F15` | 90 | hotspots des sorties : 22 x 4 octets, `0xFFFF` | `parseExitHotspotIds` | aucun |
| `0x3F16` | 6 224 | segment des combats (`FighterRecord`, mouvements) | `Segment` | aucun (segment adressé par décalage) |
| `0x3F17` | 394 | 56 textes de l'interface (verbes à `action - 1`, menu, « Texte rapide », « Avec son »…) **écrits à la main dans `create_lure`** | `parseUiStrings` | aucun |
| `0x3F18` | 265 | descriptions des sons : 53 x 5 octets (`SoundDescResource`) | `parseSoundDescs` | aucun |
| `0x3F19` | 1 769 | table de décodage des textes : 145 codes préfixes, `0xFF` | `CharacterDecoder` | aucun |
| `0x3F1A` | 196 | icône d'initialisation audio (14 x 14) | `parseAudioInitIcon` | aucun |

**Octets non initialisés** (vérifié par régénération : `create_lure` compilé dans le scratchpad, exécuté sur `LURE.EXE` comme sur des données) : le bloc régénéré et le bloc livré par ScummVM sont **identiques, hors 175 octets** où `create_lure` n'écrit rien (mémoire `malloc` brute : `0xCD` dans le bloc livré, zéros ou débris ailleurs) :
- `0x3F06` octets 590 à 607 (18) : la liste des index d'emplois du temps réserve 63 mots, 54 servent (53 offsets et la marque `0xFFFF`), les 9 autres ne sont pas écrits ;
- `0x3F10` octets 1 025 à 1 167 (143) : `read_actions_list` ne renseigne pas la taille de la ressource, qui reprend celle de la ressource précédente (1 168, les messages) ;
- `0x3F11` octets 1 392 et 1 393 (2) : la taille compte un mot de trop ;
- `0x3F12` octets 1 370 à 1 381 (12) : la table des enregistrements réserve deux enregistrements de 6 octets de plus que ceux qui servent (entrées en double).
Le critère « régénération identique » de la vague X (D1) s'entend donc **identique hors ces 175 octets**. Le lecteur ne les lit jamais (mesuré : plages non lues exactes) et un test brouille ces octets pour montrer que rien ne change à la lecture.

**Remplissage à zéro** (copié de l'exécutable ou laissé par `memset`) : `0x3F05` octets 92 à 103 (six emplacements de pièce non utilisés dans la table), `0x3F0F` octets 1 154 à 1 167, fins des deux cadres, grilles des pièces 50 et 51. Les grilles des pièces absentes 16, 26, 33 et 37 ne sont pas vides (`create_lure` copie les 51 grilles de l'exécutable).

Particularités mesurées :
- `unused` de l'en-tête vaut `0xFF` ; l'identifiant d'un hotspot commence à `1000` (`0x3E8`, le joueur, `PLAYER_ID`) et finit à 30 063.
- **Hotspots non visuels** (`hotspotId >= 0x7530`, 63 enregistrements, 30 000 à 30 063) : leurs champs de position, de taille et de marche (`startX` à `talkY`) sont des restes de mémoire que le jeu ne lit pas (ex. `0x7538` « Tas de paille » : x = 32 671, y = -128, hauteur 28 215 ; `0x755E` « Fissure ») : le rectangle d'un hotspot non visuel vient de sa surcharge de `0x3F08` (60 des 63 en ont une ; `Room::checkRoomHotspots`), sa direction de `scriptLoadFlag` (`nonVisualDirection`). Ce n'est pas une erreur de lecture : les 211 enregistrements ont la taille de `HotspotResource` et leurs identifiants se suivent. Les 148 autres ont des valeurs cohérentes, sauf `10040` (pièce 443 : enregistrement sans emploi, même nature).
- `HotspotResource.npcSchedule` est un identifiant d'entrée : `(rang de l'ensemble, à partir de 1) << 10 | rang de l'instruction` ; les 11 hotspots avec un identifiant supérieur à 53 en brut sont normaux.
- Une action de `0x3F10` dont la séquence vaut `>= 0x8000` montre un message (`showMessage`, identifiant `& 0x7FFF`) au lieu d'exécuter un script.
- `0x3F11` cite un dialogue absent de `0x3F12` : `0xDA10`, pour le personnage 1007 ; `create_lure` saute l'enregistrement « spécial » (`0xD930` en anglais, décalé de `0xE0` en français). Jamais utilisé à notre connaissance ; le moteur de ScummVM lèverait « Unknown talk entry offset ».
- Les 4 cases de `RoomResource.layers` : seules les `numLayers` premières sont des calques ; la suivante est le calque de recouvrement (`showOverlay`) pour les pièces 1, 4 et 35 (ressources `0x4102`, `0x4403`, `0xA302`).
- 161 enregistrements d'animation, 149 identifiants d'animation, dont 12 qui ne sont pas des ressources (`0`, `2`, `0xD6`, `0x200`, `0x2065`, `0x452E`, `0x6F43`, `0x6F76`, `0x706F`, `0x7279`, `0x7672`, `0xFFFF` : `Hotspot::setAnimation` ne fait rien quand `Disk::exists` est faux) et un (`0xFF00`) qui est la palette de la fin.
- `0x3F0C` : tous les décalages de séquence cités par les pièces, sorties et actions tombent dans le segment.
- Coordonnées : `create_lure` a déjà retranché `0x80` à celles de l'exécutable ; le lecteur les rend telles que stockées. Dans `0x3F14`, le mot `y` porte un numéro de hotspot de sortie dans ses 4 bits hauts (`hotspotIndexId`) et la coordonnée dans les 12 bits bas.

### Écarts documentés par rapport à ScummVM (D9)

- **« Parle » → « Parle à »** : `frenchTextStrings[11]` vaut `"Parle \0x81"`, où `\0` coupe la chaîne ; la ressource stocke « Parle » (vérifié, `0x3F17` octets de la liste) et ScummVM affiche « Parle » (alors que les voisins sont « Dis à », « Va à », « Demande à »). **Vérifié contre `LURE.EXE`** : la table des verbes de l'exécutable contient « Parle \x81 » (`0x81` = « à »). `parseUiStrings` rend « Parle \x81 » quand le verbe vaut exactement « Parle ». La ressource n'est pas modifiée.
- **« Vous  êtes sûr (o/n)? » → « Vous êtes sûr (o/n)? »** (D9, corrigé) : la table de `create_lure` a deux espaces, le texte du jeu `0/380` n'en a qu'un ; `parseUiStrings` rend un seul espace (la ressource n'est pas modifiée).
- Autres entrées de la table examinées et **non corrigées** (pas de certitude) : articles « les », « le », « la » sans espace final (identiques à ceux de l'exécutable, qui les stocke ainsi) ; « Texte lent  √ » (deux espaces, comme dans l'exécutable).
- La variante « 5 bits » des écrans (EGA) n'est pas portée (voir § 4).

## 4. Images (vérifié, `data/picture.ts`, `anim.ts`, `palette.ts`, `font.ts`, `dialog-frame.ts`)

- **Écrans** (décors, écrans de l'introduction, générique, redémarrage, barre de menus) : `vgaDecode` (`decode.cpp`), table de 1 024 octets (successeurs), `u32` à `0x400`, flux de bits à `0x404`. **98 écrans** et la barre de menus (ressource 5, 320 x 8 = 2 560 octets) ; chaque écran décode en **61 440 octets = 320 x 192** : `Surface::loadScreen` le colle sous la barre de menus (`loadGameScreen`, 8 lignes à zéro au-dessus). **Comparé à `decode.cpp` de ScummVM compilé tel quel** : identique octet à octet sur les 98 écrans et 14 écrans de séquences. La variante « 5 bits » (`egaDecode`, en-tête `0x140`/`0x141`) **n'est utilisée par aucun écran** des quatre disques VGA : non portée, refusée par `decodeScreen`.
- **Animations de hotspots** (`AnimationDecoder::decode_data`, réécrite avec les mêmes registres) : ressource = `u16` nombre d'images N, N `u16` (taille de chaque image en pixels), 6 octets, flux. **137 animations**, toutes décompressées ; la taille de sortie vaut exactement la somme des tailles de l'en-tête divisée par 2 (quartets) ; **identiques à ScummVM compilé** (comparaison octet à octet sur les 137). Les images font `largeur x hauteur` du hotspot (pas de la ressource) ; cinq hotspots (1036, 1040, 1051, 1068, 1069) sont redimensionnés par script, leurs tailles de `0x3F07` ne correspondent pas. `PIXELFLAG_HAS_TABLE` (drapeau 4) place les images d'après la table de l'en-tête.
- **Séquences plein écran** (`AnimationSequence`) : 14 écrans de départ (`0x40`, `0x42`, `0x44`, `0x24`, `0x46`, `0x48` de l'introduction ; `0x404D`, `0x404F`, `0x4051` la chute ; `0x4061` la capture ; `0xE9F1` le tonneau ; `0xFF01`, `0xFF03`, `0xFF05` la fin) et leur ressource « lignes » `id + 1` (15 avec `0x23`, lignes de `0x22`). Décompression `vgaDecode` (jusqu'à 300 000 octets) : les 64 000 premiers octets sont l'écran de départ, la suite les pixels ; images : 76, 100, 242, 123, 5, 24, 11, 5, 24, 176, 138 ; `0x24`, `0xFF03` et `0xFF05` n'ont pas d'image (lignes de 4 octets).
- **Calques de pièce** (`RoomLayer`) : jusqu'à quatre écrans par pièce (fond + calques d'avant-plan) découpés en cellules 32 x 32 (lu) ; la palette d'un écran est la ressource `(id & 0xFFE0) - 1` (vérifié : elle existe pour chaque écran de pièce).
- **Curseurs** : ressource 1, 26 images de 16 x 16 (6 656 octets), concaténées (`LureData.cursors`) ; indices de `CursorType` (lu).
- **Police** : ressource 4, **115 glyphes** de 8 x 8 (1 bit par pixel, bit 7 à gauche), codes 32 à 146 (`0x92`). La ressource 3 (920 octets) a la même taille mais n'est jamais lue.
- **Palettes** : composantes de 6 bits (toutes `<= 63`, vérifié sur les 49 palettes), 220 couleurs par palette de pièce ou d'écran (660 octets ; `0x9BFF` : 128), 256 pour `0x3F01`, 68 pour `0x3F02` ; palette de travail de 228 entrées (`MAIN_PALETTE_SIZE`) : `composeRoomPalette` = palette du jeu, recouverte par celle du calque de fond, puis la sous-palette en 129 (60 couleurs) et 220 (8) ; collection de l'introduction `0x32` : 5 sous-palettes de 64 (la palette française a déjà les gris que la correction de ScummVM impose, qui ne se déclenche donc pas) ; fondus par pas de 4 (lu).
- **Cadres de boîtes** : `0x3F03` (334 octets lus sur 336) et `0x3F04` (43 sur 48) : coin gauche, une colonne répétée, coin droit, sur trois blocs (haut, côté répété, bas).

## 5. Textes (vérifié, `data/strings.ts`, `charset.ts`)

- Trois ressources de textes (`0x10`, `0x11`, `0x12`) : **400, 1 278 et 126 textes** (identifiants 0 à 399, 2 000 à 3 277, 4 000 à 4 125 ; les trois bits de poids fort portent le numéro d'article, `& 0x1FFF`), plus 83 fragments de noms (ressource 9). Chaque texte est une suite de bits décodée par la table `0x3F19` (code préfixe, 145 codes, au plus 18 bits ; le premier bit lu est le bit de rang 0). **Les 1 804 textes se décodent sans séquence inconnue**, chacun jusqu'à son caractère nul, et se suivent dans le flux avec 2 à 20 bits de remplissage entre eux (au plus 18 bits après le dernier) : rien n'est sauté.
- Caractères spéciaux : `%1` (nom du hotspot), `%` suivi d'un autre caractère (nom du personnage), code `>= 0xA0` (fragment de nom d'indice `code - 0xA0`, des syllabes françaises « de », « ment », « tre »…).
- **Remappage selon la pièce** (`StringData::initPosition`, testé) : à partir de la pièce `0x2A`, les identifiants 2 000 à 3 999 renvoient au texte `0x76` (« ? ») ; avant, ceux de 4 000 et plus aussi.
- **Jeu de caractères** (vérifié par les mots connus et par la forme des glyphes) : les codes `0x20` à `0x7D` sont de l'ASCII ; `0x7E` Ç, `0x7F` é, `0x80` â, `0x81` à, `0x82` ç, `0x83` ê, `0x84` ë, `0x85` è, `0x86` ï, `0x87` î, `0x88` ô, `0x89` û, `0x8A` ù, `0x8B` coche (« Texte rapide√ »), `0x8C` ü, `0x8D` ä, `0x8E` Ä, `0x8F` ö, `0x90` Ö, `0x91` Ü, `0x92` ß. Tous les caractères produits par la table de décodage et tous ceux des textes et des noms ont un glyphe (testé). `charset.ts` fait la conversion en Unicode ; le rendu dessine les glyphes.

## 6. Son et musique (vérifié, `data/sound.ts` ; le pilote et la lecture sont en vague A)

- **Tout le son est MIDI** : il n'y a **aucun échantillon** dans la version DOS. Musique et bruitages sont des morceaux SMF joués sur le même pilote (AdLib ou Roland).
- Sections : `0x0D` (AdLib, jeu : **73 sons**), `0x31` (AdLib, introduction : **4 sons**), `0xFF11` (AdLib, fin : **1 son**) ; leurs pendants Roland `0x0C`, `0x30`, `0xFF10` et les SysEx du MT-32 `0x0B` ne sont pas utilisés (AdLib décidé). Identifiées et ignorées par `catalog.ts` (vérifié : 3 AdLib, 4 Roland). Les ressources `0x0A` et `0x0F` du disque 1 ne sont **pas** des sons : c'est du code x86 (pilotes DOS), jamais exécuté.
- **Disposition d'une section** (vérifié, lue jusqu'au dernier octet) : `u8` nombre de sons, `u8` à 0, `nombre` positions `u32` (depuis le début de la section), marque `80 00`, puis les sons, contigus ; le dernier va jusqu'à la fin de la section (les sections Roland ajoutent après la marque l'adresse des timbres MT-32).
- **Compression** (`MidiMusic::MidiMusic`) : un son qui commence par `'C'` ou `'c'` porte un dictionnaire de 256 mots de 16 bits (512 octets) puis une suite d'indices d'un octet, chacun valant deux octets du SMF. Avec `'c'`, le premier octet décompressé est un remplissage. **Trouvés** : 4 sons `'c'` dans la section principale (indices 1, 25, 59, 60) et 1 son `'C'` dans l'introduction (indice 2) ; tous les autres sont des SMF bruts. **Les octets décompressés de la suite des 78 sons sont identiques à ceux de ScummVM** (extrait de `sound.cpp` compilé hors dépôt, comparé son par son ; sha-1 dans les tests).
- **Forme des SMF** : format 0, une piste, **420 ticks par noire** (division relevée par le pilote, voir `audio.md`). **La longueur de piste omet l'événement de fin** (`00 FF 2F 00`, 4 octets qui suivent) dans tous les sons ; l'analyseur de ScummVM le tolère. `normalizeMidiFile` coupe le fichier après cet événement et corrige la longueur de piste (écart documenté, l'analyseur commun `src/audio/smf.ts` lit alors tous les sons sans erreur). Avec `'c'` de longueur impaire, un octet nul de remplissage suit (`trailing`).
- Les instruments AdLib sont dans des méta-événements **`FF 7F`** de la forme `00 00 3F 00`, type, argument : type 1 (34 octets : canal puis les 28 octets d'une définition BNK sans ses deux premiers champs), type 2 (mode rythme, toujours désactivé), type 3 (sensibilité du pitch bend). **Vérifié sur les 78 sons** : chaque son a exactement un type 2 et un type 3 ; 214 + 101 + 59 = 374 instruments (section principale, introduction, fin), canaux 0 à 15, aucun autre type. `parseSequencerMeta` les décode, `src/audio/smf.ts` les rend déjà (`sequencerSpecific`).
- Pilote : `MidiDriver_ADLIB_Lure` (sous-classe de `MidiDriver_ADLIB_Multisource`, `audio/adlib_ms.cpp`) : OPL2, 9 voix, **jusqu'à 10 sources simultanées** (musique + bruitages) se partageant les voix, minuterie à **250 Hz** (`kDefaultCallbackFrequency`), note abaissée d'une octave, volume des opérateurs mis à l'échelle par la vélocité.
- `SoundDescResource` (`0x3F18`, **vérifié** : 53 enregistrements de 5 octets, `parseSoundDescs`) : numéro de son (7 bits bas : rang dans la section principale, tous `< 73`, 47 sons distincts ; bit 7 : boucle, 12 descriptions ; `soundDescTarget`), canal, nombre de canaux (bits 0-1 Roland, 2-3 AdLib, 4-5 internes), drapeaux (`SF_IN_USE`, `SF_RESTORE` : son relancé au chargement d'une partie), volume.

## 7. Points à vérifier en vague D

1. **Fait hors sons** : les 337 ressources des quatre disques sont attribuées à un type (`catalog.ts`, aucune « inconnue ») ; écrans, animations, palettes, police, curseurs, textes se décodent ; les ressources Roland, la protection, le code x86 et les ressources sans emploi (`0x400E`, `0x0003`) sont identifiées et ignorées. Les sections de sons (AdLib) sont lues (§ 6).
2. **Fait** : les 26 ressources du bloc français se lisent jusqu'au dernier octet avec les structures de `res_struct.h` : le seul reste non lu est le remplissage expliqué au § 3 (dont les 175 octets non initialisés).
3. **Fait** : tous les textes (1 804 textes, 83 noms, 56 textes de l'interface) se décodent sans séquence inconnue ; chaque caractère produit a un glyphe.
4. **Fait** : les 78 sons de `0x0D`, `0x31`, `0xFF11` donnent un SMF valide (compressés compris, octets identiques à ceux de ScummVM) ; les `FF 7F` sont tous de type 1, 2 ou 3 (§ 6).
5. Régénération du bloc français par `create_lure` = bloc livré **hors octets non initialisés** (175 octets, voir § 3). **Vérifié** (vague D) : seules les plages `0x3F06` 590-608, `0x3F10` 1025-1168, `0x3F11` 1392-1394 et `0x3F12` 1370-1382 diffèrent, et le lecteur ne les lit pas. Reste pour la vague X : automatiser ce contrôle dans `scripts/lure-extract.sh`.
