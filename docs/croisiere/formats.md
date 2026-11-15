# Croisière pour un cadavre (Delphine 1991, DOS VGA, FR) : formats de données vus par le moteur `cruise` de ScummVM

> Étude du 14/11/2026, à partir de ScummVM (`engines/cruise/`, GPL v3+), lu et non copié. Statut : **lu et vérifié sur les fichiers** sauf mention « non vérifié » (§ 7).

Sources ScummVM : `engines/cruise/*.cpp` (noms de fichier + fonction cités par section). Vérifications faites sur les vrais fichiers (étude du 14/11/2026) avec des scripts Python
hors dépôt (volumes + dépackage, inventaire, rendu des fonds, des SET et des polygones) ; ils seront réécrits en TypeScript en vague D. Tout est **big-endian** sauf mention contraire
(ADL = little-endian, sauvegarde ScummVM = little-endian). La liste complète des fichiers ira dans `files.md` (généré en vague X).

## 0. Vue d'ensemble de ce qu'un port doit lire

| Type | Ext. | Nb entrées (D1..D5) | Rôle | Utilisé par ScummVM |
|---|---|---|---|---|
| Overlay (script + objets) | `.OVL` | 88 (82 noms) | bytecode, objets, états, imports/exports | oui |
| Textes de l'overlay | `.FR` | 86 | noms de verbes/objets + messages (français) | oui |
| Fond d'écran | `.PI1` | 162 | 320x200, palette + pixels (2 modes) | oui |
| Sprites / vecteurs / masques | `.SET` | 468 | image-set (type 0, 1, 5, 8) ; `SEC` = variante | oui |
| Zones de marche | `.CTP` | 34 | nœuds, routes, polygones de marche | oui |
| Police | `.FNT` (+ `SYSTEM.FNT` hors volume) | 1 (+1) | glyphes 2 plans | oui |
| Musique | sans extension (`CORPnn`) | 14 | module type SoundFX, 4 voix | oui |
| Instruments / effets AdLib | `.ADL` | 87 | 1 timbre OPL2 de 58 octets | oui |
| Effets sonores déclarés `.SPL` | `.SPL` | 24 | échantillons numériques (SB) | **non** (remplacés par `.ADL`) |
| Instruments MT-32 / PC-speaker | `.H32` / `.HP` | 87 / 32 | | **non** |
| Liste d'instruments | `.IST` | 13 | 15 octets, absent du code | **non** |
| Textes système | `DELPHINE.LNG` | - | 25 chaînes entre guillemets | oui (prioritaire) |

Total dépacké : 14 128 743 octets (1096 entrées), 10 952 514 octets pour les 867 noms uniques ; packé : 3 432 006 octets.
Comptes par extension (entrées / octets dépackés) : PI1 162 / 8 971 206 ; SET 468 / 3 574 056 ; OVL 88 / 1 148 893 ; FR 86 / 206 082 ;
CTP 34 / 26 150 ; SPL 24 / 28 280 ; ADL 87 / 5 046 ; H32 87 / 17 617 ; HP 32 / 1 072 ; IST 13 / 195 ; FNT 1 / 5 954 ; sans extension 14 / 144 192.

Le jeu n'a **aucun** fichier son `.MUS`/`.VOC`/`.WAV` : musique = modules SoundFX + timbres OPL2, effets = un timbre OPL2 joué sur le canal 4 (pas de PCM).

## 1. Système de volumes

### 1.1 Fichiers
- `VOL.CNF` (14 372 o) : catalogue global. `D1`..`D5` (sans extension) : les 5 « disquettes », chacune avec son propre répertoire + données.
- `VOL.1`..`VOL.5` (4 o, texte `D1\r\n`...) = étiquette disque → ident du fichier ; `VOL.END` (4 o `00 00 00 1e`) ; `DELPHINE.CFG` (6 o `00 00 01 00 00 00`). **Non lus par le moteur ScummVM** (`askDisk()` est un stub qui ne vérifie rien).

### 1.2 `VOL.CNF` (`volume.cpp::readVolCnf`)
| Offset | Taille | Champ |
|---|---|---|
| 0 | i16 | `numOfDisks` = 5 |
| 2 | i16 | taille d'une entrée d'en-tête = 20 (lu, ignoré) |
| 4 | 20 × N | une entrée par disque : `ident[10]` (`"D1"` NUL-complété), `ptr[4]` (résidu de pointeur mémoire, ignoré), `diskNumber` i16 (1..5), `size` i32 (provisoire) |
| 104 | répété N fois | `size` i32 (= 13 × nb de noms) puis `size` octets : noms de 13 octets NUL-complétés (`"AUTO00.OVL\0\0\0"`) |

Les listes de noms par disque comptent 189 / 192 / 255 / 235 / 225 noms = exactement les entrées des répertoires `D1..D5`, dans le même ordre (vérifié).
Le catalogue ne sert qu'à savoir sur quel disque se trouve un fichier ; un port peut l'ignorer et indexer directement les répertoires.

### 1.3 Répertoire d'un volume `Dn` (`volume.cpp::getVolumeDataEntry`)
| Offset | Taille | Champ |
|---|---|---|
| 0 | i16 | nb d'entrées (189, 192, 255, 235, 225) |
| 2 | i16 | taille d'entrée = **30** (le moteur fait `assert(== 14+4*4)`) |
| 4 + 30·i | 14 | `name` : lire jusqu'au premier NUL (**des octets parasites suivent le NUL**, p.ex. `AUTO00.OVL\0T\0c`) |
| +14 | u32 | `offset` absolu dans le fichier `Dn` |
| +18 | u32 | `size` (octets stockés) |
| +22 | u32 | `extSize` (taille dépackée annoncée) |
| +26 | u32 | `unk3` inutilisé (toujours `0x442E4D2E` = « D.M. ») |

- **Flag de compression** : implicite, `size != extSize` ⇒ packé Delphine (`cruise_main.cpp::loadFileSub1`, `overlay.cpp::loadOverlay`, `sound.cpp::readBundleSoundFile`). 853 entrées packées, 243 brutes.
- Le moteur alloue `extSize + 2` octets **remplis de zéros** et dépacke dedans ; la taille réelle donnée par le trailer du packer vaut `extSize` ou `extSize - 1` (18 fichiers à longueur impaire : `SUPER.OVL`, `LOGO.FR`, `I00.FR`, `HORLOGE2.SPL`, ...). Le port doit donc zéro-padder à `extSize`.
- Recherche (`findFileInDisks`) : nom mis en MAJUSCULES ; d'abord dans le volume déjà ouvert, sinon sur le disque indiqué par le CNF. 115 noms existent sur plusieurs disques (contenu identique à ±1 octet de padding près, sauf 14 variantes `.H32`/`.SPL`/`.FR` sans effet visible). Un port peut fusionner tous les répertoires (premier trouvé).
- Les « fichiers » sans extension (`CORP1`..`CORP13`, sans `CORP12` : 12 noms distincts pour 14 entrées) sont les **musiques**. *(Correction D2, 14/11 : vérifié par `test/croisiere/data/music.test.ts`.)*

## 2. Dépacker Delphine (`delphine-unpack.cpp::delphineUnpack`)

Identique, bit pour bit, à `engines/cine/unpack.cpp::CineUnpacker` (Les Voyageurs du temps / Future Wars) : mêmes 6 codes, même CRC, même lecture à rebours ;
seule différence : cine ajoute des contrôles de bornes et la copie brute `srcLen == dstLen` (chez cruise ce test est fait par l'appelant via `size == extSize`).

Trailer (les 12 derniers octets de la donnée packée, lus à rebours) : `[... flux ...][chunk0 u32][crc u32][dstSize u32]`.

Algorithme :
1. `sp = len-4` ; `dstSize = BE32(src[sp])` ; `sp -= 4` ; `crc = BE32(src[sp])` ; `sp -= 4` ; `chk = BE32(src[sp])` ; `sp -= 4` ; `crc ^= chk`. `dst = zeros(dstSize)`, `d = dstSize-1` (on **écrit de la fin vers le début**).
2. `nextBit()` : `cf = chk & 1 ; chk >>>= 1 ; si chk == 0 { chk = BE32(src[sp]) ; sp -= 4 ; crc ^= chk ; cf = chk & 1 ; chk = (chk >>> 1) | 0x80000000 }` retourne `cf`.
3. `getBits(n)` : `c = 0 ; n fois { c = (c << 1) | nextBit() }` (premier bit lu = bit de poids fort).
4. Boucle tant qu'il reste des octets à écrire :
   | bits | action |
   |---|---|
   | `0 0` | suite brute de `getBits(3)+1` octets (1..8) |
   | `0 1` | copie de 2 octets, offset = `getBits(8)` |
   | `1 0 0` | copie de 3 octets, offset = `getBits(9)` |
   | `1 0 1` | copie de 4 octets, offset = `getBits(10)` |
   | `1 1 0` | copie de `getBits(8)+1` octets, offset = `getBits(12)` |
   | `1 1 1` | suite brute de `getBits(8)+9` octets (9..264) |
   - brute : `dst[d--] = getBits(8)` ; copie : `n` fois `dst[d] = dst[d + offset] ; d--`.
5. Succès si `crc == 0` à la fin.

**Vérification** : port Python de l'étude appliqué aux 853 entrées packées de D1..D5 : **853/853 OK** (CRC = 0 et longueur ∈ {extSize, extSize-1}), 0 échec ; 243 entrées brutes copiées telles quelles.

## 3. Ressources

### 3.1 Fonds `.PI1` (`background.cpp::loadBackground`, `gfxModule.cpp::convertGfxFromMode5`, `gfxModule_setPalEntries`)
Octet 0 = ?, **octet 1 = mode** ; (si les 4 premiers octets = `PAL\0` : fichier palette seule, 4 + 768 octets, présent une fois : `S01PAL.PI1`, copié en 256×RGB).

| Mode | Taille fichier | Nb | Contenu |
|---|---|---|---|
| 8 (256 couleurs) | 64 770 | 102 | `[0,8]` + palette 256×3 octets RGB **8 bits** (max constaté 255, pas de ×4) + 64 000 pixels chunky 320×200 |
| 5 (32 couleurs, 5 plans) | 40 066 | 59 | `[0,5]` + 32 mots (2 o chacun, octet0 = `0R`, octet1 = `GB` ; couleur = nibble × 17) + 5 plans de 8000 o |
| 0 / 4 (Atari ST) | - | 0 | codés dans le moteur mais absents des données |

- Mode 5 : palette de 32 couleurs **dupliquée 8×** dans les 256 entrées (`pal[32*k + i] = pal[i]`). Décodage : plan p, ligne y, colonne c, bit b (poids fort = pixel gauche) → `pixel[y*320 + c*8 + (7-b)] |= bit(src[y*40 + c + 8000*p], b) << p`. Les plans sont **consécutifs** (plan 0 entier, puis plan 1...), pas entrelacés par ligne.
- Mode 8 : `pixels = fichier[770..]`. Aucun trailer `MEN`/`CVT` dans ces données.
- Vérifié visuellement (rendu PNG) : `I00.PI1` (mode 8), `XX2.PI1` (mode 5). `LOGO.PI1` est vide (palette de fondu seulement).
- Le moteur pose directement les octets RGB dans la palette OSystem (8 bits). Fondus gérés par les scripts/`doFade`.

### 3.2 Image-sets `.SET` / `.SEC` (`dataLoader.cpp::loadSetEntry`, `decodeGfxUnified`)
Le même format `.SET` ; le magic est `SET\0` (237 fichiers) ou `SEC\0` (161 fichiers).

| Offset | Taille | Champ |
|---|---|---|
| 0 | 4 | `"SET\0"` ou `"SEC\0"` |
| 4 | u16 | nb d'entrées `num` |
| 6 + 16·i | 16 | entrée : `offset` u32, `width` u16, `height` u16, `type` u16, `transparency` u16 (`& 0x1F`, 0xFFFF → 31), `hotspotY` u16, `hotspotX` u16 |
| 6 + 16·num + offset | | données de l'entrée |

(`hotspotX/Y` sont lus mais **ignorés** par le moteur ; position = états de l'overlay.)

Types réellement présents : SET : 0 (2250), 1 (35), 5 (53), 8 (449) ; SEC : 1 (128), 5 (1212). Le type 4 (4 plans) existe dans le code mais pas dans les données.

| Type | `width`/`height` dans l'en-tête | Taille des données | Décodage vérifié |
|---|---|---|---|
| 8 | pixels × lignes | `W*H` | octets chunky, `pixel == transparency` → transparent |
| 5, **SET** | `W` = octets de ligne **des 5 plans** | `W*H` | plans consécutifs ; largeur d'un plan = `W/5` octets ; **largeur visible = (W-10)*8/5 pixels** (les 2 octets de droite de chaque ligne de plan sont ignorés) ; `px = Σ bit(plan p) << p`, `data[ligne*(W/5) + x/8 + H*(W/5)*p]`, bit `7 - x%8` |
| 5, **SEC** | idem | `(W-10)*H` | même largeur visible `(W-10)*8/5`, mais stride de plan = `(W-10)/5` (pas de padding) |
| 1 (masque 1 plan) | `W` = octets par ligne | SET : `W*H` ; SEC : `(W-2)*H` (SEC : `W -= 2`) | largeur visible = `8*W` px ; bit 1 = opaque ; sert de masque d'occultation (`OBJ_TYPE_BGMASK`) |
| 0 (vecteur) | `H = 1`, `W` = longueur de l'enregistrement | `W` | modèle polygonal, voir 3.3 |

Exemples vérifiés (PNG) : `HORLOGE.SET` (SEC type 5, 60×66 → 80×66), `REM_TOM.SET` (SET type 5, 80×129 → 112×129, taille fichier = 22 + 80·129), `I00.SET` (type 8 et 1), `END1BGMQ.SET` (SEC type 1, 32→30 octets → 240×32).
Masque d'opacité des sprites : bit=1 si `pixel != transparency`. Mapping du moteur : `loadFile/loadFullBundle` chargent une entrée dans `filesDatabase[257]`.

### 3.3 Entrées type 0 : modèles polygonaux (« vector sprites ») (`mainDraw.cpp::buildPolyModel / mainDrawPolygons / flipPoly / getPolySize`)
**C'est la majorité des entrées (2250 / 4127)** : tous les personnages (`BIGRAOUL.SET` = 78 entrées type 0), objets, lieux de clic. Un port doit donc réimplémenter ce rastériseur. Vérifié : 2233 enregistrements analysés, tous finis par `0xFF` + 4 octets, + 17 renvois ; rendu PNG de `BIGRAOUL.SET` : personnage reconnaissable.

Enregistrement (octets) :
| Offset | Champ |
|---|---|
| 0 | si `u16 @0 == 0` → **renvoi miroir** : `[0 0][i16 offset][i16 newX][i16 newY]` (8 octets ; cible = entrée `idEntrée + offset` du même set, dessinée avec l'échelle inversée (flip), position décalée de `-newX,-newY`) |
| 1 | demi-largeur max (`upperX`, utilisé par `getPolySize`) |
| 2 | hauteur max (`upperY`) |
| 3, 4 | `lowerX`, `lowerY` : point d'origine (pivot) dans le repère du modèle |
| 5 | `N` = nb de points |
| 6 .. 6+2N | `N` paires (x, y) octets non signés |
| puis, répété | polygone : `n` (octet, nb de sommets ; `<=1` ⇒ 4 octets sautés, rien dessiné), `couleur` (octet = index palette), 1 octet inutilisé, `minScale` u16 BE (dessiné seulement si `scale >= minScale`), `n` indices de points (octets) |
| fin | octet `0xFF`, puis 4 octets (padding/inconnus, `w` = fin + 4) |

Rendu : repère = origine du premier point ; `scale` : 512 = 100 % (modèle 171 px de haut à 512) ; `up(v) = (v*scale*128 + 0x8000) >> 16` ; si `|scale| < 0x180` les coordonnées sont divisées par 2 (`>>1`) et l'échelle doublée ; `scale < 0` = miroir horizontal (x négatif) ; chaque point = `origine + up(coord - premierPoint)` ; remplissage scanline (`buildSegment`, `fillpoly`) ; occultation par les masques (`drawMask`/`blitPolyMode1`, type 1) ; collision souris `findPoly`.

### 3.4 Police `.FNT` / `SYSTEM.FNT` (`font.cpp::loadFNT / loadFNTSub / renderText / renderWord`)
Fichier : `"FNT\0"` (4 o) puis structure lue à partir de l'offset 4 (les offsets internes sont relatifs à l'offset 4).
| Offset (après les 4 o) | Taille | Champ |
|---|---|---|
| 0 | u32 | `size` (= taille fichier − 4 ; `SYSTEM.FNT` : 6358) |
| 4 | u32 | `offset` des glyphes (= 14 + 12·numChars = 1454) |
| 8 | u16 | `numChars` = 120 |
| 10 | i16 | `hSpacing` (−1 pour `SYSTEM.FNT`, 0 pour `MED.FNT`) |
| 12 | i16 | `vSpacing` (−1) |
| 14 + 12·i | 12 | `FontEntry` : `offset` u32 (relatif à `offset`), `v1` i16 (inutilisé), `charHeight` i16, `height2` i16, `charWidth` i16 |

Glyphe : `charHeight` mots u16 BE de **masque** (1 = pixel dessiné, bit 15 = pixel gauche), suivis de `charHeight` mots de **couleur** (bit 0 → index 1, bit 1 → index 2 ; l'index final est ensuite remplacé par la couleur de la police). Largeur = `charWidth` ≤ 16. Ligne de base : `y = height2 - charHeight + lineHeight` (lineHeight = max charHeight = 13). Avance = `charWidth + hSpacing` ; espace = `5 + hSpacing` ; `|` = saut de ligne. Interligne = `lineHeight + vSpacing`. Largeur max de rendu 310 px ; texte centré par ligne.
`MED.FNT` (volume, 5954 o) a la même structure (autre jeu de glyphes). Vérifié par rendu : « Sauvegarde non trouvée... Chargement à ç ù ô ê » s'affiche correctement.

### 3.5 CTP : zones de marche (`ctp.cpp::initCt`)
| Offset | Taille | Champ |
|---|---|---|
| 0 | 4 | `"CTP "` |
| 4 | i16 | `numNodes` (nœuds de routage, p.ex. 15) |
| 6 | 7 × i16 | `seg[0..6]` : tailles en octets des 7 segments |
| 20 | `seg0` | nœuds : `seg0/4` paires (x, y) i16 |
| | `seg1` | routes : `seg1/20` lignes de 10 i16 : `[nbVoisins, id1..id9]` (graphe de nœuds ; distance = max(|dx|,|dy|)) |
| | `seg2` | polygones de marche : `seg2/80` lignes de 40 i16 : `[nbPoints, x0, y0, x1, y1, ...]` (≤ 19 points) |
| | `seg3` | `walkboxColor[i]` i16 : type de zone (0 non marchable, 1 marchable, 2 sortie, d'après le commentaire ScummVM) |
| | `seg4` | `walkboxState[i]` i16 : 0/1, zone bloquée par un objet (état modifiable) |
| | `seg5` | `walkboxColorIndex[i]` i16 |
| | `seg6` | `walkboxZoom[i]` i16 ; `numberOfWalkboxes = seg6/2` |

Échelle des zones : liste « normale » à scale `0x200`, liste « étendue » à scale `walkboxZoom*20 + 0x200` ; chaque polygone est rastérisé en tranches `[xmin,xmax]` par ligne (`makeCtStruct`). Vérifié : somme des segments + 20 = taille fichier pour 33/33 CTP (exemple `S33.CTP` : 15 nœuds, 11 zones). À la restauration d'une sauvegarde, `seg3/seg4` sont ignorés (valeurs sauvegardées).

### 3.6 Overlays `.OVL` (`overlay.cpp::loadOverlay`) : layout seulement
Fichier dépacké. Tout en u16 BE. **Parse complet vérifié sur 82/82 OVL (la somme des sections = taille du fichier).**

| Ordre | Contenu |
|---|---|
| 0..59 | 60 octets de pointeurs (résidus mémoire, ignorés) |
| 60 | en-tête : 16 × u16 : `numProc, numRel, numSymbGlob, numRelocGlob, numMsgRelHeader, numObj, numStrings, size8 (nb états), size9 (nb vars objet), nameExportSize, exportNamesSize, specialString2Length, sizeOfData4 (bss), size12 (données init), specialString1Length, scriptNumber` |
| 92 | **exports** : `numSymbGlob` × 10 o (`var0, var2, var4, idx, offsetToName`), puis `exportNamesSize` o de noms |
| | **imports** : `numRelocGlob` × 10 o (`var0, var1, linkType, linkIdx, nameOffset`), puis `nameExportSize` o de noms |
| | **liens message/verbe** : `numMsgRelHeader` × 34 o (`type, id, offsetVerbeName, verbOverlay, verbNumber, obj1Overlay, obj1Number, obj2Overlay, obj2Number, trackX, trackY, obj1NewState, obj2NewState, obj1OldState, obj2OldState, trackDirection, dialog`) |
| | **procédures** (`numProc`) puis **« relocations » = scripts de relation** (`numRel`) : d'abord N en-têtes de 28 o (4 o ignorés + 12 u16 : `sizeOfData, offsetToSubData3, offsetToImportData, offsetToSubData2, offsetToImportName, offsetToSubData5, sysKey, var12, numRelocGlob, subData2Size, var18, var1A`), puis les N blocs de `sizeOfData` octets (bytecode ; `importData` = `numRelocGlob`×10 o et `subData2` = `subData2Size`×10 o en BE) |
| | données initiales : `size12` octets |
| | **objets** : `numObj` × 14 o (`type, class, nameOffset, numStates, varTableIdx, firstStateIdx, stateTableIdx`) |
| | **états** : `size8` × 12 o (`X, Y, Z, frame, scale, state`) |
| | **ids de messages** : `numStrings` × u16 |

Les variables objet (`size9`) et le bss (`sizeOfData4`) sont allouées à zéro, non lues. **Compléments vague D2 (14/11, vérifiés sur les 2 571 scripts, `test/croisiere/data/overlay.test.ts` et `disasm.test.ts`)** : 860 procédures, 1 711 relations, 2 583 objets, 2 725 messages. Un bloc de script contient le bytecode depuis l'offset 0 jusqu'au plus petit offset de section non nul (chaînes, imports, `subData2`, noms d'import, `subData5`) ; le code finit toujours par `stop` (ou `end`), suivi parfois d'**un octet de bourrage de valeur quelconque** (alignement pair). Les sauts relatifs (type 6) sont comptés depuis l'adresse de leur opérande. Un import de script désigne soit une instruction entière (double empilement), soit l'octet « type » d'un opérande de variable (un octet après l'opcode). Un `.FR` présent pour 82/82 overlays qui en ont besoin ; ses longueurs de noms égalent celles de l'en-tête. Opcode natif 0x69 (`DeletePreload`) vide dans ScummVM : appelé une fois dans `S08.OVL` (code mort).

Interpréteur de bytecode : `script.cpp`, `function.cpp` (opcodes 0x00..0x7D, table `opcodeTablePtr`) : hors périmètre de ce document mais **le plus gros chantier restant** du port.

### 3.7 Textes d'overlay `.FR` (`overlay.cpp::loadOverlay`, `various.cpp::getText`, `object.cpp::getObjectName`)
Lu seulement si `numStrings > 0` ou `specialString1Length > 0`. Nom = `<NOM-OVL>.FR`.
| Contenu |
|---|
| `u16 len1` puis `len1` o : **noms de verbes** (chaînes NUL concaténées ; `getObjectName(i)` = i-ème chaîne) |
| `u16 len2` puis `len2` o : **noms d'objets** (idem) |
| `numStrings` × (`u16 len` + `len` o, NUL inclus dans `len`) : messages ; `getText(n)` = n-ième ; `|` = saut de ligne dans les textes |

Vérifié sur `XX2.FR` (551 o) : les longueurs coïncident avec l'en-tête de `XX2.OVL`.

### 3.8 Son
**Pilote** : AdLib/OPL2 uniquement (`sound.cpp::AdLibSoundDriverADL`, `OPL::Config::create`) ; timer 50 Hz. Pas de MT-32 (`.H32`), pas de PC-speaker (`.HP`), pas de PCM (`.SPL`), malgré leur présence dans les volumes.

**Effets** : le script charge `NOM.SPL` ; `loadFileSub1` remplace l'extension par `.ADL` (`cruise_main.cpp:347`). Les 24 `.SPL` des volumes ne sont jamais lus. `Op_PlayFX` → `PCSound::playSound(data, …)` → `AdLibSoundDriverADL::playSample` : instrument joué sur le canal 4, note 48 (ou `amDepth` si ≠ 0), volume fixé à 127 (le paramètre volume est ignoré).

**Timbre `.ADL`** (58 octets, 87 entrées dont 49 noms distincts ; correction D2, 14/11, `loadInstrument / loadRegisterInstrument`) :
| Offset | Taille | Champ |
|---|---|---|
| 0 | u8 | `mode` (0 = mélodique, ≠0 = percussion) |
| 1 | u8 | `channel` (voix de percussion) |
| 2 | u8 | `waveSelectMod & 3` |
| 3 | u8 | `waveSelectCar & 3` |
| 4 | u8 | `amDepth` (si ≠ 0 : note fixe) |
| 5 | u8 | inutilisé |
| 6 | 26 | opérateur modulateur |
| 32 | 26 | opérateur porteuse |

Opérateur = 13 mots **u16 little-endian** : `+0 keyScaling, +2 freqMultiplier(&0xF), +4 feedback, +6 attack, +8 sustainLevel, +10 sustainingSound, +12 decay, +14 release, +16 outputLevel, +18 AM, +20 vibrato, +22 envelopeScaling, +24 connection(0 ⇒ FM)`. Registres OPL : `0x20 = AM<<7|VIB<<6|EG<<5|KSR<<4|mult`, `0x40 = level|keyScaling<<6`, `0x60 = attack<<4|decay`, `0x80 = sustain<<4|release`, `0xC0 = feedback<<1|(conn==0)`, `0xE0 = waveselect`. Table de fréquences OPL `_freqTable` (12 valeurs) et table de périodes `_noteTable` (96 valeurs) codées dans `sound.cpp` (à reproduire).

**Musique** (fichiers sans extension, 14 entrées pour 12 noms : `CORP1..CORP13` sans `CORP12`, de 6 496 à 18 784 o ; `PCSoundFxPlayer`) : module type SoundFX 4 voix.
| Offset | Taille | Champ |
|---|---|---|
| 0 | 15 | volume de chaque instrument (0..~97) |
| 20 + 30·i (i<15) | 30 | instrument : nom 12 o (`NYLON_AT.H32`, extension remplacée par `.ADL` ; **premier octet NUL ⇒ nom vide ⇒ instrument ignoré**, c'est le cas des `.AMI`), + 18 o inutilisés par le moteur |
| 470 | u8 | `numOrders` |
| 471 | u8 | tempo : `eventsDelay = (244 - v) * 100 / 1060` (ticks de 20 ms entre deux lignes ; ligne jouée quand `compteur > eventsDelay`) |
| 472 | 128 | table d'ordre (index de pattern) |
| 600 | 1800 | non lu par le moteur |
| 2400 + 1024·p | 1024 | pattern : 64 lignes × 16 o = 4 voix × 4 o |

Événement (4 o) : `freq` i16 BE (période ; >0 ⇒ note : `stopChannel` + `setChannelFrequency`), octet 2 : instrument = `>>4` (1..15 ; 0 = inchangé), le reste (effet, octet 3) **ignoré**. Changement d'instrument : `setupChannel(canal, adl, vol = volume[instr] - fadeOut)`. Lecture en boucle (`currentOrder` revient à 0). Fondu de sortie : `fadeOutCounter += 2` par ligne jusqu'à 100. Nb patterns vérifié : `(taille - 2400) / 1024` entier (13 pour `CORP13`).

### 3.9 `DELPHINE.LNG` (`cruise.cpp::loadLanguageStrings`)
620 o, texte. 25 chaînes (`MAX_LANGUAGE_STRINGS`) chacune entre `"`, séparées par `\r\n` (le moteur cherche `"`...`"`). Octets Latin-1 (`é` = 0xE9). Index utiles (ScummVM, `langString(ID_…)`) : 0 Pause, 1 « INSERER LE DISQUE », 2 « EN », 3/4 erreurs mémoire, 5 Inventaire, 6 Parler de..., 7 Menu Joueur, 8 Lecteur de Sauvegarde, 9 Sauvegarde, 10 Chargement, 11 Recommencer le jeu, 12 Quitter, 13 Confirmez vous ce choix?, 14 Oui, 15 Non, 16..24 messages de sauvegarde. Si le fichier manque, ScummVM retombe sur 13 chaînes codées (`staticres.cpp::frenchLanguageStrings`, **version incomplète : la pause y est `""`**) : utiliser le fichier.

### 3.10 Sauvegardes (`saveload.cpp`)
**Format propre à ScummVM**, pas celui du jeu original : `"SVMCR\0"` (6 o), version u8 (=1), nom NUL-terminé, miniature ScummVM, puis état sérialisé en **little-endian** (`Common::Serializer`) : variables globales (`syncBasicInfo`, ~45 i16 dont `protectionCode`), palettes (256×3 par écran, 8 bits), table des fonds, `filesDatabase`, `preloadData`, overlays (états, bss), scripts, cellules, incrustations, acteurs, musique (nom + position), persos, CT. Fichiers `cruise.sNN`. Un port TS n'a aucune obligation de compatibilité : définir son propre format (l'état à sérialiser = liste ci-dessus).

## 4. DELPHINE.EXE et `staticres.cpp`
`DELPHINE.EXE` (55 967 o, MZ, binaire Microsoft C 6 non packé, runtime « Microsoft C Run-Time Library 1990 ») ne contient lisiblement que quelques chaînes (`AUTO00`, `VOL.CNF`, `LOGO.PI1`, `DELPHINE.LNG`, `VGADRV.BIN`, « Affiche_perso NULL »...). **Les tables de `staticres.cpp` n'ont pas été retrouvées dans l'EXE** (recherche des motifs int16 LE/BE : mouvements d'acteur, table de police, curseurs) : elles ont été transcrites ailleurs ou stockées dans un autre format ; non vérifié. Le moteur démarre sur l'overlay `AUTO00` (le nom est dans l'EXE).

Ce que ScummVM code en dur et que le port doit reproduire :
| Table | Fichier | Contenu | Dépend de la version ? |
|---|---|---|---|
| `english_fontCharacterTable[256]` | `staticres.cpp` | code caractère → index de glyphe (−1 = non dessiné). **Sélectionnée pour FR, EN, IT** (macro `fontCharacterTable` dans `staticres.h`) ; tables séparées pour DE, ES, RU | oui, par langue/police |
| `actor_move / actor_end / actor_stat / actor_invstat` | `staticres.cpp` | séquences d'indices de frames du héros par direction (dos, droite, face, gauche ; négatif = miroir) | probablement identique entre versions (non vérifié) |
| curseurs `mouseCursorNormal/Disk/Cross/NoMouse/Walk/Exit/MagnifyingGlass` | `staticres.cpp` | 2 × 16 mots (forme + masque) 16×16 | non |
| chaînes de langue de repli | `staticres.cpp` | 13 chaînes × 6 langues | oui (inutile si `DELPHINE.LNG` présent) |
| `endTexts` | `backgroundIncrust.cpp` | « Fin » (français) pour l'écran de fin | oui |
| `_noteTable`, `_freqTable`, `_operatorsTable`, `_voiceOperatorsTable` | `sound.cpp` | tables OPL2 | non |

Table de police française effective (ASCII 0x21..0x7D → glyphe 0..92 ; 0x20 = espace sans glyphe ; tout le reste −1 sauf) : `à E0→93, ä E4→94, é E9→95, è E8→96, ê EA→97, ë EB→98, î EE→99, ï EF→100, ô F4→101, ö F6→102, ù F9→103, û FB→104, Å C5→105, Ä C4→106, Ê CA→107, Ë CB→108, Î CE→109, Ï CF→110, Ö D6→111, Ø D8→112, Û DB→113, Ü DC→114, ç E7→115, ß DF→116, æ E6→117, â E2→118`. `SYSTEM.FNT` a 120 glyphes (index 119 non mappé).

## 5. Encodage des textes français
Octets **ISO-8859-1 / Windows-1252** (pas CP850) : `é = 0xE9`, `è = 0xE8`, `à = 0xE0`, `ê = 0xEA`, `ç = 0xE7`, `ù = 0xF9`, `ô = 0xF4` (confirmé dans `DELPHINE.LNG` et `XX2.FR`, ScummVM utilise Windows-1252 pour le TTS français). Chaque caractère passe par `fontCharacterTable[octet]` : **les majuscules accentuées `À É È Ç Œ`... ne sont pas dans la table** (`À C0`, `É C9`, `È C8` → −1 : rien n'est dessiné et aucune avance), seules `Å Ä Ê Ë Î Ï Ö Ø Û Ü` sont dessinables ; ni `œ`, ni guillemets typographiques. `'` est l'apostrophe ASCII. Dans les textes, `|` = saut de ligne forcé, espace (0x20) avance de `5 + hSpacing` px, retour à la ligne automatique sur espace.

## 6. Protection anti-copie
Écran « PROTECTION » **réalisé en script** par l'overlay `XX2` (`XX2.OVL/.FR/.PI1/.SET` : roue de 12 positions, lettres A..R, boutons OK ; textes : « Entrez la combinaison », « Code incorrect. », « Placez la flèche de la roue sur le chiffre qui vous sera indiqué. Sélectionnez les objets appartenant à la case dont la lettre vous sera indiquée... Si l'ordinateur demande A1, sélectionnez les figures... »). `Codes.pdf` de l'installeur = la feuille de codes correspondante.
- **ScummVM ne contourne rien dans le moteur** : `Op_Protect` (opcode 0x76) est un stub qui dépile deux valeurs et renvoie 0 ; `Op_ProtectionFlag` (0x7C) lit/écrit la variable `protectionCode` (sauvegardée). La validation du code est donc dans le bytecode d'`XX2.OVL` (données `size12` = 1744 o, non analysées ici).
- Les seuls traitements spéciaux sont du TTS/rafraîchissement (`cell.cpp:170-186`, `cruise_main.cpp:715`) : un commentaire précise que « les versions DOS anglaise et russe sautent automatiquement l'écran de protection » (leurs scripts ne l'affichent pas) ; la version française l'affiche.
- **Non vérifié** : le mécanisme exact (table des réponses, quand l'écran est appelé). Pour contourner dans le port : ne pas lancer l'écran `XX2` (ou forcer son issue) au niveau du script, ou implémenter la roue.

## 7. Points non vérifiés / à surveiller
- Tables `staticres.cpp` non localisées dans `DELPHINE.EXE`.
- Sémantique complète du bytecode OVL (opcodes) et du validateur `XX2` non étudiée.
- `actor_*` : valeurs non recoupées avec les données.
- Type 4 (4 plans) et modes PI1 0/4 : code mort pour ces données.
- `hotspotX/Y` des SET ignorés par ScummVM ; origine des sprites = `X,Y` des états d'overlay (à confirmer dans `mainDraw.cpp` lors de l'implémentation du rendu bitmap).
- Variantes de volume (14 noms dupliqués avec contenu différent : `SHIP.FR` etc. n'ont qu'un octet de padding de différence ; `OPENHIHA.H32` D5 diffère réellement mais `.H32` est inutilisé).
