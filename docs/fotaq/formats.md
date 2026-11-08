# Flight of the Amazon Queen : formats de fichiers

Version étudiée : talkie français `FOTAQ_Fr_Talkie_1.0` (ScummVM, 2012), un seul fichier de données `queen.1c` (97 382 620 octets) et `readme.txt`.
Version interne détectée par ScummVM : `CFM10` (« CD French, Machine 1.0 »), langue française, compression audio 2 (Ogg Vorbis).

Ce document est la référence de formats du portage (`plan.md`). Légende :

- **Vérifié** : lu sur le vrai fichier, avec un test sur les vrais fichiers (`test/fotaq/data/`, ignoré si `original/fotaq/` est absent). Depuis la vague D, ce qui était « vérifié » par les scripts de l'étude l'est par ces tests ; ce qui a été tranché en vague D est signalé « (vague D) ».
- **Lu** : décrit par le code du moteur `queen` de ScummVM (`engines/queen/`, GPL v3 ou ultérieure, en-têtes lus sur `queen.cpp`), consulté pour comprendre le format, sans reprendre son code. Pas encore confronté au fichier.
- **Supposé** : déduit, à confirmer (écoute, œil, ScummVM à côté).

Les noms de champs sont ceux du dépôt à venir ; la source de chaque format est citée entre parenthèses (`resource.cpp`, `bankman.cpp`…).

## 1. Conteneur `queen.1c`

**Vérifié** (`resource.cpp`, `version.cpp` pour la structure ; contrôles faits sur le fichier) :

| Offset | Taille | Contenu |
| --- | --- | --- |
| 0x00 | 4 | `QTBL` |
| 0x04 | 6 | chaîne de version `CFM10\0` |
| 0x0a | 2 | ignorés (`00 00`) |
| 0x0c | 1 | compression audio : 0 aucune, 1 MP3, **2 Ogg Vorbis** (valeur du fichier) |
| 0x0d | 2 | nombre d'entrées, big-endian : **7 671** |
| 0x0f | 21 x N | table : nom (12 octets, nul final), bundle (1 octet, toujours 1), offset (u32 BE), taille (u32 BE) |

- La table finit à l'offset 161 106, qui est aussi l'offset de la première ressource. Les ressources sont **contiguës**, sans trou, et la dernière finit à la fin du fichier. Les entrées sont **triées par nom** (ScummVM les cherche par dichotomie) et **uniques** ; les noms (max 12 caractères) sont en majuscules.
- Aucune table externe (`queen.tbl`) ni exécutable n'est nécessaire : la version « rebuilt » embarque sa table. Le seul autre fichier est `readme.txt` (licence, à conserver).
- Les fichiers d'origine n'ont pas de chemins : les noms sont globaux (`B1.PCX`, `020001P2.SB`).

Répartition (nombre, poids) :

| Extension | Nb | Poids | Rôle |
| --- | --- | --- | --- |
| `.SB` | 6 751 | 77,0 Mo | voix et effets, Ogg Vorbis (§ 8) |
| `.SAM` | 86 | 5,8 Mo | banques de sprites (**pas** des sons : § 3) |
| `.PCX` | 128 | 5,3 Mo | décors, panneau, écrans fixes |
| `.BBK` | 131 | 4,9 Mo | banques de sprites et d'objets |
| `.ACT` | 64 | 2,2 Mo | banques de sprites des personnages |
| `.MSK` / `.LUM` | 65 / 63 | 0,52 Mo / 1,5 Ko | masque et table de lumière dynamique d'une pièce |
| `.RL` | 2 | 0,43 Mo | `AQ.RL` (musique Roland MT-32) et `AQBANK.RL` |
| `.MUS` | 1 | 0,33 Mo | `AQBANK.MUS` (musique AdLib) |
| `.CUT` | 302 | 0,30 Mo | cinématiques scriptées (« cutaways ») |
| `.DOG` | 73 | 0,24 Mo | arbres de dialogue |
| `.JAS` | 2 | 0,12 Mo | `QUEEN.JAS` (données logiques), `QUEEN2.JAS` (textes) |
| `.CRD` et `DATA` | 3 | 6 Ko | textes de générique |
| Total hors `.SB` | 920 | 20,2 Mo | |

Détail des préfixes de `.SB` : voir § 8.

## 2. Images PCX (`*.PCX`)

**Vérifié** (128 fichiers, `display.cpp` pour l'usage) :

- PCX standard version 5, RLE, 8 bits, 1 plan, palette de 256 couleurs en 8 bits (RVB, valeurs 0 à 255) dans les 768 derniers octets après l'octet `0x0C`. Le décodeur est le PCX classique (octets >= 0xC0 : répétition) ; l'image d'une pièce rendue ainsi est correcte (décor `B1.PCX`, 640 x 200, texte français peint dans l'image : « Réducteur de cheveux »).
- Dimensions relevées (test `pcx.test.ts`, lecteur `data/pcx.ts`) : 320x200 (67), 320x150 (40), 640x200 (11), 640x150 (4), 320x256 (4), 480x200 (1), 320x40 (1, `PANEL.PCX`). Les décors de 640 de large défilent horizontalement. Les données RLE finissent exactement avant la palette dans les 128 fichiers, et chaque pièce a un décor du nom que lui donne `QUEEN2.JAS` (`B1` -> `B1.PCX`) ; 12 autres images ne sont celles d'aucune pièce (`PANEL`, `JOURNAL`, `CRAP`, `F1B`, `F2B`, `F4B`, `F4S`, `L2`, `N14B`, `T28`, `T6B`, `V8`).
- Les textes peints dans les décors sont **déjà en français**.

**Hauteur du décor (vague V, visionneuse, 126 pièces)** : la hauteur du PCX ne dit pas si le panneau s'affiche. Les **43 pièces d'écran** (76 à 96 et 105 à 126 : cinématiques, écrans fixes, fin du jeu) ont toutes un décor de **200** lignes ; les **83 pièces de jeu** (1 à 75 et 97 à 104) ont un décor de **150** lignes (44) ou de **200** (39), et dans ces 200 lignes les 50 du bas portent une vraie image, pas du remplissage (33 images distinctes, vues dans la visionneuse avec la ligne y = 150). La zone de jeu (zones de marche et boîtes d'objets de `QUEEN.JAS`) reste, à quelques boîtes près, au-dessus de la ligne 150. Le champ « panneau » de l'en-tête d'un `.CUT` (0 ou 2) est **sans rapport** avec la hauteur du décor de la pièce où la cinématique se joue (2 apparaît pour des décors de 200 lignes comme de 150 : 48 et 7 cinématiques, contre 156 et 84 pour 0). Le mode d'affichage (panneau ou plein écran) se décide donc dans le code (`screenMode`) : à reprendre de ScummVM en vague R, avec 150 lignes pour tout décor de 150 et plein écran pour les pièces d'écran ; reste **supposé** que les 39 pièces de jeu à 200 lignes s'affichent avec le panneau sur les 50 dernières.

**Lu** (non confronté) : l'écran fait 320x200, dont 150 lignes de jeu et 50 lignes de panneau (`PANEL.PCX`, `GAME_SCREEN_HEIGHT`). La palette est partagée : les couleurs 0 à 143 viennent du décor (toutes les 256 pour quelques pièces, `getNumColorsForRoom`), 144 à 255 du panneau (112 couleurs), dont 16 couleurs de Joe (144 à 159) changées par la tenue (`palSetJoeNormal`, `palSetJoeDress`, tables dans `display.cpp`). Fondus : `palFadeIn/Out`.

## 3. Banques de sprites (`*.BBK`, `*.ACT`, `*.SAM`)

**Vérifié** (281 fichiers, 5 266 images : chaque banque se parcourt exactement jusqu'à son dernier octet, sans reste) :

```
u16 LE  nombre d'images
par image :
  u16 LE largeur, u16 LE hauteur, u16 LE point d'ancrage x, u16 LE point d'ancrage y
  largeur x hauteur octets : indices de palette, non compressés, ligne par ligne
```

(`bankman.cpp`, variante PC.) Les trois extensions ont **le même format** : `.BBK` objets et personnages (`JOE_A.BBK`, `OBJECTS.BBK`, `CONTROL.BBK`), `.ACT` acteurs, `.SAM` autres sprites (le nom ne dit rien d'un son). Index 0 = transparent dans les images dessinées « masquées » (sprites, images collées) : **lu** dans `Display::blit`, `masked` (vague D : les sprites contiennent bien des 0 ; tranché). Les images sont numérotées **à partir de 1** ; une image peut être vide (largeur ou hauteur nulle). Le lecteur est `data/bank.ts` (test `bank.test.ts` : 131 BBK, 64 ACT, 86 SAM, 5 266 images, fin exacte).

**Lu** : un « bob » (sprite animé) référence une banque et un numéro d'image ; les images « paste down » (numéro > 5000 dans `ObjectData`) sont collées dans le décor. 17 banques peuvent être chargées à la fois (emplacements `bankslot`). Les banques de Joe : `JOE_A/B.BBK` (normal), `JOED_A/B.BBK` (robe), `JOEU_A/B.BBK` (sous-vêtements), `JOE_E.ACT`.

## 4. Masques et lumière dynamique (`*.MSK`, `*.LUM`)

**Vérifié** (vague D, `data/dynalum.ts`, test `dynalum.test.ts`) : `.MSK` = 8 000 octets (65 pièces), `.LUM` = 24 octets (63 pièces). 63 pièces ont les deux ; `T4` et `V5` ont un masque **sans** table (ScummVM n'active alors pas la lumière dynamique : il faut les deux fichiers).
**Lu** (`Display::dynalumInit`, `dynalumUpdate`) et **tranché** (vague D) : le masque est une grille de **160 colonnes x 50 lignes** de cellules de 4 x 4 pixels du décor ; pour la position (x, y) de Joe (x borné à la largeur du décor, y à 149), l'octet `(y / 4) * 160 + (x / 4)` est un numéro de ligne de la table. La table `.LUM` a **8 triplets d'entiers signés** (B1 : `0, -3, -6, -9, -12, -15, -18`, puis `+8`) ; l'éclairage ajoute `triplet * 4` aux trois composantes des couleurs 144 à 159 de la palette de la pièce, bornées à 0..255. **Anomalie** : le masque de `T6` contient 1 912 cellules à 255, hors de la table de 8 lignes (ScummVM lit alors au-delà de son tampon) ; `lightDelta` rend `null` (le moteur laisse la palette). Pas de lumière dynamique dans les pièces d'introduction (`isPalFadingDisabled`, côté moteur).

## 5. Données logiques (`QUEEN.JAS`)

**Vérifié** (vague D, `data/jas.ts`, test `jas.test.ts`) : fichier de 79 390 octets ; en-tête de 20 octets (`AmBk`, numéros de banque AMOS, longueur, `Datas   `) à sauter (`loadFile("QUEEN.JAS", 20)`) ; ensuite tout est **big-endian** et se lit dans cet ordre (`Logic::readQueenJas`, `Grid::readDataFrom`, `Command::readCommandsFrom`). La lecture suit exactement le code de ScummVM : **elle s'arrête à l'offset 74 884 (= 0x12484), où se trouve la chaîne `CFM10\0`**, comme le contrôle de version de ScummVM l'exige ; 4 506 octets (nuls) suivent et ne sont pas lus. Valeurs lues sur le fichier français :

| Bloc | Contenu | Quantité vérifiée |
| --- | --- | --- |
| en-tête | nombre de pièces, noms, objets, descriptions (4 x u16) | 126 pièces, 325 noms, 792 objets, 724 descriptions |
| `ObjectData` | 8 x u16 : nom, x, y, description, objet associé, pièce, état, image | 792 x 16 octets |
| `roomData` | u16 x (pièces + 1) : premier objet de chaque pièce | |
| `sfxName` | u16 x pièces : numéro d'effet sonore de la pièce | |
| `ItemData` | 5 x u16 : objets d'inventaire (nom, description, état, image, effet) | 100 |
| `GraphicData` | 5 x u16 : x, y, image de départ, image de fin, vitesse | 679 |
| zones (`Grid`) | par pièce : nombre d'objets, nombre de zones, puis `Area` (voisines, boîte, échelles bas et haut, objet) ; puis une boîte par objet | 126 pièces |
| `WalkOffData` | 3 x u16 : objet d'entrée, x, y (destination de marche) | 149 |
| `ObjectDescription` | 4 x u16 | 4 |
| commandes | listes `CmdListData` (10 x u16 : verbe, objets 1 et 2, morceau, quatre drapeaux de sous-listes, ordre d'image, mouvement spécial), `CmdArea`, `CmdObject`, `CmdInventory`, `CmdGameState` | 866 / 34 / 338 / 249 / 1 356 |
| objet d'entrée | u16 (objet de départ de la partie : 639, donc la pièce de départ) | |
| meubles | 2 x u16 : pièce, objet | 203 |
| acteurs | 4 compteurs (acteurs, animations, noms, fichiers) puis 12 x u16 par acteur : pièce, numéro de bob, nom, condition d'état, couleur du texte, image debout, x, y, animation, banque, fichier | 140 acteurs, 62 animations, 74 noms, 64 fichiers |
| animations graphiques | 3 x u16 : image clé, image, vitesse (un tableau à un élément même si le compte est 0) | 220 |

(Si un compte vaut 0, ScummVM lit quand même un élément ; reproduit par le lecteur et testé sur des données synthétiques, aucun compte du fichier français n'est nul.) Tous les tableaux du lecteur sont **indexés par le numéro du jeu, à partir de 1** (l'élément 0 est nul). Vague D : l'objet d'entrée 639 est dans la pièce **95** (pièce de départ) ; `roomFirstObject[r + 1] - roomFirstObject[r]` est le nombre d'objets de la pièce `r` (un objet peut avoir un champ `room` différent de la pièce dont il fait partie, ex. l'objet 260) ; les coordonnées de `WalkOffData` sont des `u16` comme dans ScummVM (`65506` = -30 en 16 bits signés) ; le correctif de ScummVM sur la commande d'objet 175 (bug 3536 : copier 309 vers 308, le fichier dit 307) est appliqué et signalé (`appliedFixes`).

**Conséquence** : le **moteur est à une grande partie pilotée par les données** (objets, zones de marche, listes de commandes avec conditions sur 1 356 états de jeu, inventaire). Ce qui reste codé dans ScummVM (**lu**, `logic.cpp`) : 46 « mouvements spéciaux » (`_specialMoves[...]`), environ 17 cas propres à une pièce, la cinématique de la voiture, du robot, de Frank, la fin du jeu, la gestion des deux tenues, le tableau de syntaxe des commandes tapées au curseur.

## 6. Textes (`QUEEN2.JAS`, `*.CRD`, `DATA`) et police

**Vérifié** :

- `QUEEN2.JAS` (`data/text.ts`, test `text.test.ts`) : texte brut, lignes séparées par `\r\n`, **1 427 lignes** qui se découpent exactement comme dans ScummVM (`Logic::readQueenJas`) : 724 descriptions d'objets (de la ligne 0), 325 noms d'objets (724), 126 noms de pièces (1 049), 12 noms de verbes (1 175), 40 réponses de Joe, 62 animations d'acteurs, 74 noms d'acteurs, 64 noms de fichiers d'acteurs (ex. `sparky.act`, à partir de la ligne 1 363). Total : 724 + 325 + 126 + 12 + 40 + 62 + 74 + 64 = 1 427. Le dernier nom de fichier, `v3.pbob`, n'est pas un fichier de `queen.1c`.
- **Encodage** (**corrigé en vague D**) : `QUEEN2.JAS` et les `.CRD` sont en **Latin-1 / Windows-1252** (`é` = 0xE9, 362 occurrences ; `à` 0xE0, 86 ; `ç` 0xE7, 43 ; `Ç` 0xC7, 18 ; aucun octet 0x80 à 0x9F). Mais les textes des `.DOG` et des `.CUT` **mélangent deux encodages**, selon la réplique : Latin-1, ou **page de code DOS 850** (`é` = 0x82, `è` 0x8A, `à` 0x85, `ç` 0x87, `î` 0x8C…). Les deux ne se mélangent jamais dans une même chaîne, ni même dans un même fichier : **60 `.DOG` sont en CP850, 12 en Latin-1** (`BOB1`, `BOB2`, `BOB3`, `BOB5`, `BUD1`, `BUD2`, `CHIEF1`, `CHIEF2`, `ORACLE3`, `TAM4`, `WEDGE`, `ZOMBIE2`), `DOG.DOG` n'a pas d'accent (1 169 phrases CP850, 246 Latin-1, 932 sans accent) ; **220 `.CUT` sont en CP850, 4 en Latin-1** (`C13B`, `C69C`, `C75B`, `CDINT`), 78 sans accent. Les deux se distinguent par les octets 0x80 à 0x9F (accents en CP850, contrôles en Latin-1) : `decodeGameText` choisit chaîne par chaîne (CP850 avec `src/data/cp850.ts`, sinon Latin-1). Ce que la première étude disait (« Latin-1 aussi dans les `.DOG` et `.CUT`, vérifié sur `CHIEF1.DOG` et `C21A.CUT` ») n'était vrai que pour `CHIEF1.DOG` ; `C21A.CUT` est en CP850. ScummVM dessine les octets tels quels, avec une police qui a les deux jeux d'accents ; le rendu du portage passera par le texte Unicode décodé.
- Commandes dans un texte (**lu**, `Talk::speak`, `getSpeakCommand`) : le texte est découpé par `*` en segments ; `*NN` (deux chiffres) est un numéro d'animation de bouche, `*AO`, `*FL/FR/FF/FB` (tourner), `*GD`, `*GM` (saisie), `*WT` (pause), `*XYnn(x,y)` (déplacement). Chaque segment a **sa propre voix** (`<préfixe><index en hexadécimal, à partir de 1>`).
- `*.CRD`, `DATA` (`data/credits.ts`, test `credits.test.ts`) : texte avec directives (`.8`, `.c`, `.i 3`, `.p 0`, `.l`…) ; **vérifié** : `CREDIT1.CRD` (11 pages) et `CREDIT2.CRD` (22 pages) sont en français (« Jeu de Steve Stamatiadis et John Passfield »), lus jusqu'à leur ligne `EN` sans reste. **`DATA` est la version anglaise du premier générique** (« A game by », 11 pages) : aucune cinématique ne le cite (seuls `CRED.CUT` et `C69G.CUT` lancent un générique, par `#credit1.crd` et `#credit2.crd`), donc **inutilisé** par le jeu français. Directives : **lu** (`credits.cpp`), lues en pages (ce qu'affiche un `.p`).
- **Police** : **vérifié** que la police des textes est dans le **code** de ScummVM (`Display::_fontRegular`, 256 glyphes de 8x8 pixels, 8 octets chacun, 2 048 octets), pas dans `queen.1c`. Elle contient les accents aux positions Latin-1 (`é` 0xE9, `ç` 0xE7, `à` 0xE0 ; glyphes rendus et lus), plus ceux du code page 437 (0x82…) utilisés par les écrans internes du journal. Largeur de glyphe : calculée depuis les pixels (`initFont`, largeur = colonne de pixel la plus à droite + 2, espace = 4). Texte « cerclé » : 8 passes de contour (`drawText`). **Vague V** : aucune image de `queen.1c` ne porte une police (les 128 PCX et les 12 images qui ne sont celles d'aucune pièce ont été regardées dans la visionneuse : `PANEL`, `JOURNAL` (fond vide), `L2` (logo), `F1B` et `F2B` (feuilles d'objets) etc.) ; la visionneuse n'a donc rien à montrer de la police. La police devra donc être **transcrite en TypeScript** avec sa provenance (ou produite par un script depuis ScummVM) : c'est la seule donnée non fournie par `queen.1c` nécessaire à l'affichage.

## 7. Dialogues (`*.DOG`) et cinématiques (`*.CUT`)

Les deux commencent par un en-tête de 20 octets de banque AMOS (`AmBk`…, **vérifié** sur les 73 `.DOG` et 302 `.CUT`) à sauter. Tout est big-endian ; les chaînes sont « longueur (1 octet) + octets, alignées sur 2 (4 dans les sections de phrases d'un `.DOG`) » (`Talk::getString` ; la chaîne vide ne consomme que sa longueur). Textes : CP850 ou Latin-1 (§ 6).

**`.DOG`** (`data/dog.ts`, test `dog.test.ts`, **vérifié sur les 73 fichiers, lus jusqu'au dernier octet** — vague D). Disposition après les 20 octets : `levelMax` (i16, négatif = on ne peut pas quitter ; 9 fichiers), `uniqueKey`, `talkKey` (**unique par fichier**, de 1 à 84), `jMax` (phrases de Joe), `pMax` (phrases du personnage), deux triplets de conditions (état, valeur, objet d'inventaire), puis les décalages de la section du personnage, de la section de cutscene et de la section du personnage 2 ; deux mots à 28 (nul) et 30 (répète `|levelMax|`). À 32 : l'arbre, `|levelMax|` niveaux de **6 options de 16 octets** (tête, valeur de nœud, indice et valeur d'état ; quatre mots ignorés par ScummVM valent 0, sauf 65535 à la position 2 ou 4 des options retirées) — et non 8 octets comme noté à l'étude. **Sens de l'arbre (vague V, constaté dans la visionneuse sur les 73 fichiers)** : l'option 0 d'un niveau porte la **tête qui nomme le niveau** (valeur de nœud 0 ; le niveau de départ a la tête 1) ; chaque autre option est une réplique de Joe de la tête de l'option (puis la réponse du personnage de **même tête**), et sa valeur de nœud est la **tête du niveau suivant** (-1 : fin du dialogue ; 0 pour l'option d'en-tête ; aucune valeur strictement positive ne désigne un niveau inexistant, test `viewer-data.test.ts`). Puis, **enchaînées exactement** : la section de Joe (`jMax` phrases), la section du personnage (`pMax` phrases), la cutscene de fin (état, valeur, nom de fichier `.CUT` : 21 valeurs, toutes présentes), la section du personnage 2 (phrase d'accueil et réplique de Joe quand on a déjà parlé) ; le reste du fichier est nul. Une phrase : mot ignoré, numéro de tête, chaîne alignée sur 4 ; la première phrase de chaque section a la tête 0 (premier échange, `initialTalk`) et chaque arbre commence par la tête 1. Vérifié : `AND1.DOG` (niveaux -5, clé 2) correspond aux voix `02xxxxP*.SB` ; `CHIEF1.DOG` contient « Bonjour...\*17Je suis Joe King, pilote privé. ».

**`.CUT`** (`data/cut.ts`, test `cut.test.ts`, **vérifié sur les 302 fichiers, lus jusqu'au dernier octet** — vague D). En-tête de 12 octets : panneau (u16 : 0 pour 247 fichiers, 2 pour 55), nombre d'objets (i16, négatif = non sautable : 98 fichiers), drapeaux (i16, négatif = pièce finale : 59 fichiers ; 1 = enchaîne une autre cinématique : 5), trois décalages (états, phrases, noms de banques). Puis, enchaînés exactement : les **objets** (17 mots, le nombre de personnes à allumer et leurs numéros ; si l'objet est une animation exécutée, une chaîne d'animations en-tête + 9 mots jusqu'à `-2` ; 728 animations d'objets, 4 554 animations en tout) ; quelques mots de fin que ScummVM ne lit pas (`recordsTrailer`, nuls sauf dans 10 fichiers) ; les **états** (nombre, 6 mots chacun, puis pièce, x, y finals de Joe) ; une section **que ScummVM ne lit qu'en sautant la cinématique** (`Cutaway::stop`, états finaux : voir `cutaway.md` § 3 ; `extra` : nombre, 7 mots par entrée, 2 mots ; 333 entrées en tout) — **tranchée en vague V** : chaque entrée donne les **nouvelles valeurs de l'objet à la fin de la cinématique**, dans l'ordre de `ObjectData` : objet, objet associé, x, y, pièce, image, état (le dernier mot, 0 à 5, reste supposé) ; vérifié sur les 333 entrées : la pièce est celle de l'objet dans `QUEEN.JAS` pour 323, (x, y) est la position (départ ou marche) du dernier enregistrement de l'objet qui en a une pour les 230 entrées à position non nulle, et l'image est celle de la dernière animation de l'objet (négative si miroir, **1000** si elle finit sur l'image 0) pour 231 des 234 entrées qui ont une animation propre (99 entrées concernent des objets sans animation, affichés ou déplacés) ; les **phrases** (une chaîne d'entrée, orientation de Joe, puis une par objet) ; les **noms de banques** (nombre, chaînes ; les vides sont retirés comme dans ScummVM), le **dialogue de fin** (`*` : aucun, 287 fichiers ; sinon un `.dog`, 14 valeurs, toutes présentes) et l'objet à qui Joe parle. **Tous les noms de banque cités existent.** La nature d'un objet (`getObjectType`) dépend de `QUEEN.JAS` (un objet sans liste d'animations est-il une personne : image -3 ou -4 ?), mais la **structure** du fichier n'en dépend pas : testé sur les 302 fichiers avec `isPerson` toujours faux puis toujours vrai (la crainte de la lecture du code, un enregistrement dont la longueur dépendrait de l'état, ne se réalise pas). Natures : 1 781 personnes, 728 animations, 61 textes dits, 41 dits et affichés, 12 affichés, 88 sans animation. Le texte d'une cinématique est aussi en français (ex. `C21A.CUT` : « Je voudrais acheter ceci. »).

**À noter** : ScummVM charge `CHIEF1.DOG` et `CHIEF2.DOG` d'abord **depuis le dossier du jeu** pour le français, et seulement ensuite depuis la ressource (`Talk::loadDialogFile`). Ces deux fichiers existent aussi dans `queen.1c` (avec `CHIEF3` et `CHIEF4`). **Constaté en vague D** : `CHIEF1.DOG` et `CHIEF2.DOG` font partie des 12 `.DOG` en **Latin-1** (60 autres sont en CP850, un sans accent) ; rien de structurel ne les distingue des dix autres. Rien n'indique qu'ils diffèrent de ceux que ScummVM charge du dossier du jeu, et ils se lisent comme les autres ; la comparaison avec les fichiers de l'archive de ScummVM reste impossible ici (non disponibles) : le dialogue du chef (premier village) se vérifiera en vague T.
Une autre particularité du français (**lue**, `Talk::speakSegment`) : la voix `c30e_102` est un doublon inutile et n'est pas jouée.

## 8. Voix et effets (`*.SB`)

**Vérifié** (échantillon de 19 fichiers de toutes sortes) : **Ogg Vorbis**, mono, **11 840 Hz**, 29 kb/s nominal, durées de 0,24 s à 7,3 s ; taille médiane 10,4 Ko, maximum 46,8 Ko ; 6 751 fichiers, 77,0 Mo. Le fichier `BLANK000.SB` dure 0,7 ms (silence). La fréquence atypique 11 840 Hz n'est **pas** un taux MP3.

Noms (**vérifiés** sur la liste des 6 751 entrées, usage **lu** dans `talk.cpp`, `cutaway.cpp`, `logic.cpp`) :

| Forme | Nb | Usage |
| --- | --- | --- |
| `TTHHHH` + `P` ou `J` + index (ex. `020001P2`, `0200A4J1`) | ~3 980 | dialogue : `TT` = `talkKey` du `.DOG`, `HHHH` = tête en hexadécimal, `P` personnage / `J` Joe, index du segment |
| `TTXXXXP`, `TTSSSSJ`… (`1000SSSS`) | 141 | répliques d'ouverture d'un dialogue |
| `Cnn…_ABC` (ex. `C21A_012`, `C100A032`) | ~1 940 | cinématiques (`findCdCut`) |
| `JOEnnnn` + index | 564 | descriptions et réponses de Joe (`makeJoeSpeak`) |
| `BLANK000`, `MON_0001`, `UNGH_001`… | ~110 | effets (`sfxName` de `QUEEN.JAS`) et silences |

**Rattachement (vague D, `data/files.ts`, test `files.test.ts`)** : sur les 6 751 voix, 3 756 sont des répliques de dialogue, 228 des répliques d'ouverture, 564 des voix de Joe, 2 040 des voix de cinématique, 163 des effets. **Tout est rattaché** à une phrase des données (tête et rang de segment pour un `.DOG`, rang d'objet et de segment pour un `.CUT` — pour un texte dit, le segment 1 —, réponse 1 à 40 ou description + 40 pour Joe), à **une exception** près : `480409P5` (cinquième segment d'une phrase qui n'en a que quatre). Les 163 effets ne se rattachent pas aux données : 135 portent un nom de la table `_sfxName` de ScummVM (code, vague A) ; 28 autres (`DINO*`, `MON_*`, `UNGH_*`, `NOTDRAG*`, `COMXBUD*`, `GM011___`, `BLANK000`, `130SSSSS`, `21BSSSSS`, `66ASSSSS`, `66SSSSSS`) ne sont référencés par aucune donnée. Le rang d'un segment suit `splitSpeech` (`data/text.ts`) : un segment `*GD`/`*GM` n'a pas de voix mais compte dans le rang.

Le nom est la valeur calculée par le moteur, espaces remplacés par `0` (`PCSound::playSound`). Un son se joue sur **une seule voie de voix** (le suivant attend la fin du précédent, ou l'interrompt selon le contexte) et **une voie d'effet**.

Décodage navigateur : voir `plan.md`, décision D1 (Safari et iOS, conversion en MP3).

## 9. Musique (`AQ.RL`, `AQBANK.MUS`)

**Vérifié** (vague D, `data/music.ts`, test `music.test.ts`) : les deux fichiers commencent par un entier u16 (little-endian) = nombre de morceaux (**106** pour `AQ.RL`, **102** pour `AQBANK.MUS`), suivi d'une table de u32 : pour chaque morceau, `offset = (hi << 4) | lo` avec deux u16 LE (adresses segment:offset, `MidiMusic::songOffset`) ; deux octets d'information `80 00` suivent la table (volume AdLib par défaut, commenté dans ScummVM) ; les morceaux sont contigus jusqu'à la fin du fichier et la longueur d'un morceau est la différence avec l'offset suivant (le dernier va jusqu'à la fin ; ScummVM lit pour lui une entrée au-delà de la table, sans sens). Numérotation **à partir de 0** (les tables `_tune` de ScummVM comptent à partir de 1). Chaque morceau est un **fichier MIDI standard (SMF)** dont l'en-tête `MThd` est **soit direct, soit compressé** : un morceau qui commence par `C` ou `c` est un dictionnaire de 256 mots de 16 bits (512 octets) suivi d'indices d'un octet ; le contenu est la suite des mots `table[indice]` (pour `c`, on saute le premier octet du résultat) (`MidiMusic::playMusic` ; ScummVM compte un indice de trop, ce qui ajoute deux octets de bruit à la fin, non reproduit). `AQ.RL` : 92 directs, 8 `C`, 6 `c` (14 compressés) ; `AQBANK.MUS` : 58 directs, 24 `C`, 20 `c` (44 compressés). Divisions : 96 (73), 192 (20), 288 (6), 384 (7) ticks par noire pour le Roland, 420 pour l'AdLib. `AQ.RL` : 105 morceaux en format 0 à une piste et **un** en format 1 à 7 pistes ; `AQBANK.MUS` : 102 morceaux d'une piste, en format 0.

**Morceaux 48 et 88 d'`AQ.RL`, tranchés (vague D)** : l'analyse de la vague X était juste (piste plus longue que le morceau), mais les deux causes sont différentes. Le **48** (2 944 octets, direct) commence par une **souche de 22 octets** (un `MThd` et un `MTrk` annonçant 8 640 octets, restes d'un autre morceau) suivie d'un SMF **complet et correct** de 2 922 octets (`MTrk` de 2 900) : en retirant la souche, le morceau est valide (`defect: "stubPrefix"`). Aucune liste de `_tune` ne cite le numéro 49 (index 48). Le **88** (5 120 octets, direct) est **coupé** : sa piste annonce 6 396 octets, 5 098 sont présents et l'analyse échoue au dernier événement ; la fin est perdue (`defect: "truncated"`), ce que ScummVM contourne en jouant le 62 à la place du 88 et du 89. Les 104 autres sont valides, comme les 102 de l'AdLib. Dans `AQBANK.MUS`, la longueur déclarée de la piste omet la fin de piste finale `00 FF 2F 00` (ces quatre octets suivent la piste dans les 102 morceaux).

- `AQ.RL` : musique pour Roland MT-32 (ScummVM la convertit en General MIDI par une table `_mt32ToGm`, et remplace les morceaux 88 et 89 par le 62). **Lu**.
- `AQBANK.MUS` : musique pour carte AdLib. Les instruments sont **dans les morceaux** : méta-événements « spécifiques au séquenceur » (`FF 7F`, préfixe `00 3F 00 00`, 34 octets : instrument sur 26 octets + 2 numéros de canal ; types 1, 2, 3 de `AdLibMidiDriver::metaEvent`). Les messages MIDI sont de forme courte : `cmd = (état >> 4) & 7` (0 note off, 1 note on, 5 volume de canal par `D0`, 6 pitch bend ; les contrôleurs et changements de programme sont ignorés). Le pilote est petit (`midiadlib.cpp`, 544 lignes, 11 voix, tables de fréquences) : **lu**.
- Quel morceau joue quand : tables **dans le code** (`Sound::_tune[]` et la liste de morceaux de la pièce, `musicdata.cpp`), pas dans `queen.1c` : **à transcrire**. Les morceaux de numéro >= nombre de morceaux sont ignorés (ex. 176 en fin de course de voiture).
- Cadence du séquenceur (`getBaseTempo` du pilote) : **supposé**, à lire en vague A. Division SMF : 420 ticks par noire pour l'AdLib (vérifié), 96 à 384 pour le Roland ; le tempo est dans chaque morceau.

## 10. Cadence, états et ce qui n'est pas dans les données

- **Lu** : la boucle de jeu tourne par pas de `DELAY_NORMAL = 100 ms` (`QueenEngine::update`, `Input::DELAY_NORMAL`) : 10 images de logique par seconde ; les animations de bobs avancent à chaque image.
- Hors de `queen.1c` et à reprendre du code de ScummVM (GPL v3 ou ultérieure, avec provenance dans l'en-tête du module) : police (2 048 octets), tables de morceaux et d'effets (`musicdata.cpp`), palettes de Joe et couleurs de texte (`display.cpp`), mouvements spéciaux et cas de pièce (`logic.cpp`), table des tailles et vitesses de marche (`walk.cpp`), textes de l'écran « journal » (menu de sauvegarde, options, `journal.cpp` : certains textes codés en CP437, ex. « Français ») et quelques textes d'interface. L'emplacement exact de ces derniers est à confirmer en vague D ; ScummVM n'a pas de fichier `queen.tbl` à fournir pour cette version.
- Tout le reste (données du jeu, textes, voix, musique) est dans `queen.1c`.

## 11. Points restant supposés (à trancher en vagues D et V)

Tranchés en **vague D** : 1 (transparence : l'indice 0 est transparent dans les images masquées, § 3), 2 (disposition du `.MSK` : 160 x 50 cellules de 4 x 4, `.LUM` : 8 triplets signés x 4, § 4), 3 (enregistrements de cutaway : lus et enchaînés exactement sur les 302 fichiers, § 7), 4 (découpage d'un `.DOG` : les sections tombent exactement les unes sur les autres sur les 73 fichiers, CHIEF1/2 compris, § 7), 7 (CHIEF1/2 : versions en Latin-1, déjà dans l'archive, § 7) et la question des morceaux 48 et 88 (§ 9).

Tranchés en **vague V** (visionneuse `src/games/fotaq/ui/`, page `/src/games/fotaq/ui/asset-viewer.html`) : la section `extra` des `.CUT` (§ 7), le sens des valeurs de nœud d'un `.DOG` (§ 7), la hauteur des décors par pièce (§ 2, en partie : la donnée est établie, le mode d'affichage reste dans le code) et la police (§ 6 : absente des données).

Restent :

1. Mode d'affichage (panneau ou plein écran) des pièces de jeu dont le décor fait 200 lignes : **lu** dans le code de ScummVM (`screenMode`), à reprendre en vague R. Choix des couleurs du décor : 144 pour toutes les pièces sauf 114 à 125 (256) — **lu** dans `Display::setupNewRoom` et `getNumColorsForRoom` (la visionneuse applique cette règle à la palette « d'une pièce »).
2. Quel morceau pour quelle pièce, tempo du pilote AdLib (vague A).
3. Mots ignorés des objets (`recordsTrailer`, nuls sauf dans 10 fichiers), des options de l'arbre des `.DOG` (quatre mots, 0 sauf 65535 aux options retirées) et dernier mot (état, 0 à 5) des entrées `extra` : sans effet sur le jeu connu (à ignorer sauf si une cinématique se joue mal en vague C). Le champ « zones voisines » (`mapNeighbors`) des zones de marche est affiché comme un masque de bits (bit n : zone n + 1) : lecture **supposée**, à confirmer par `walk.ts`.
4. Origine des 28 effets sans rattachement et de la voix `480409P5` (§ 8) : sans doute des sons que le code de ScummVM (`sound.cpp`, `logic.cpp`) joue par leur nom, à confirmer en vague A. La visionneuse range les voix par famille et indique le texte rattaché (dialogue, cinématique, réponse ou description de Joe) ; un effet n'a pas de texte.
