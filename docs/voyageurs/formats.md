> Étude du 14/11/2026. Les chemins `.../` désignent le scratchpad de l'étude (non versionné) : installeur extrait sans exécution (`fw-raw/`), fichiers décompressés (`fw-unpacked/`), outils Python (`tools-fw/`, lancés avec `python3 -I`), banc ScummVM `cine` (`scummvm-build/`).

# Future Wars / Les Voyageurs du temps — formats de données (version CD Sony/Interplay + patch de traduction française)

Sources : moteur `cine` de ScummVM (lecture seule, dossier `.../scummvm-build/src/engines/cine/`, abrégé `cine/` ci-dessous) et fichiers réels de `.../fw-raw/app/data/`.
Tout ce qui est marqué **[vérifié]** a été contrôlé sur les vrais fichiers avec les scripts de `.../tools-fw/`. Tout ce qui est marqué **[ScummVM]** vient uniquement du code. **[?]** = incertain.

Sorties produites :
- Listing complet : `.../notes/fw-bundle-list.txt` (741 entrées, une ligne par fichier + comptes par extension).
- Extraction : `.../scratchpad/fw-unpacked/<bundle>/<fichier>` (741 fichiers, 4 310 493 octets décompressés, 6 dossiers).
- Images de contrôle : `.../notes/img/` (`L1.PI1.png`, `marche.png`, `font-sheet.png`, `font-tail.png`, `sony.png`, etc.).
- Textes : `.../notes/msg-all-fr.txt` (tous les messages), `msg-sample20.txt`.
- Outils : `.../tools-fw/` (`cinelib.py` = dépaqueteur + écrivain PNG, `bundle.py`, `gfx.py`, `ani2.py`, `msg2.py`, `ilbm.py`, `flac.py`, `probe*.py`, `music.py`).

## 0. Inventaire des fichiers du jeu

| Fichier | Taille | Rôle |
|---|---|---|
| `AUTO00.PRC` | 253 o | script de boot, **hors bundle**, octets « chiffrés » (rotation d'un bit) |
| `PART01`, `PART02`, `PART03`, `PART04`, `PART04B` | 90–277 Ko | bundles de ressources (un par « chapitre ») |
| `PARTxx.PAL` | 1,4–5,7 Ko | tables de palettes associées à chaque bundle (voir §3) |
| `BASESON.SND` | 15,9 Ko | bundle sonore (modules AdLib/MT-32, instruments) |
| `TEXTE.DAT` | 4996 o | **la police** (pas des textes), voir §4 |
| `SONY.LBM` | 15,1 Ko | écran-titre « Sony Electronic Publishing presents », ILBM 640x480 |
| `FWARS.EXE`, `DISP.EXE`, `INSTALL.EXE`, `MANUAL.EXE`, `FW.BAT`, `VOL.*`, `README.TXT`, `MANUAL.GRS` | | non utilisés par ScummVM (jamais exécutés ici) |
| `track1..29.flac` | | pistes CD extraites (44,1 kHz 16 bits stéréo, 42,4 min au total) |

`README.TXT` : « CD-ROM version Copyright 1992 Interplay Productions », crédits : musique Jean Baudlot, sons Marc Minier et Antoine O'Heix.

## 1. Format des bundles (`PARTxx`, `BASESON.SND`)

Code : `cine/part.cpp:loadPart`, `findFileInBundle`, `readBundleFile`, `readFromPart` ; compression `cine/unpack.cpp:CineUnpacker::unpack`.

### 1.1 En-tête et table d'entrées (tout en **big-endian**) [vérifié sur les 6 bundles]
```
0x00  u16 BE  nombre d'entrées N         (PART01 = 173 = 0x00AD)
0x02  u16 BE  taille d'une entrée        (toujours 30 = 0x1E)
0x04  N x entrée de 30 octets :
        +0   char[14]  nom, rempli de 0 (ex. "L201.ANI")
        +14  u32 BE    offset du bloc dans le fichier (absolu)
        +18  u32 BE    taille compressée (packedSize)
        +22  u32 BE    taille décompressée (unpackedSize)
        +26  u32 BE    inutilisé (lu et ignoré par ScummVM)
```
- Le champ inutilisé vaut `offset + constante` (constante différente par bundle, ex. 295914 dans PART01) : c'est un résidu d'outil (pointeur mémoire ?) **[?]**, sans effet.
- Les données commencent juste après la table (PART01 : 4 + 173x30 = 5194).
- Recherche d'un fichier : comparaison de nom insensible à la casse, linéaire (`findFileInBundle`). Il n'y a pas de sous-répertoires ni de doublons gênants. Un même nom peut exister dans plusieurs bundles (ex. `FUTUR.ANI`, `GIRL.ANI`, `L10.PI1` dans PART02 et PART03...) : c'est le bundle courant qui compte (un seul bundle chargé à la fois, plus `BASESON.SND` temporairement pour le son).
- Un seul bundle « courant » : `loadPart(nom)` (opcode script 0x40) remplace le précédent. Pour jouer un son, `readBundleSoundFileFW` (`part.cpp`) bascule sur `BASESON.SND` puis revient au bundle précédent.

### 1.2 Compression (paquer Delphine/Cinématique) — `cine/unpack.cpp`
- Si `packedSize == unpackedSize` : donnée **brute** (copie). 27 entrées des PART + 30 de BASESON (les fichiers de 1 octet).
- Sinon : flux lu **à l'envers** (de la fin vers le début), bits LSB-first dans des mots 32 bits big-endian.
  - Les 3 derniers mots du bloc : `unpackedLength` (dernier mot), `crc`, puis premier `chunk` de bits (le crc est xoré avec chaque mot lu ; la somme doit finir à 0).
  - L'écriture se fait **de la fin vers le début** du tampon de sortie (`_dst` décrémente).
  - Codes (bits lus un à un) :
    - `00` + 3 bits n : n+1 octets bruts (1..8) ; `111` + 8 bits n : n+9 octets bruts (9..264)
    - `01` + 8 bits off : copie de 2 octets depuis `_dst+off`
    - `100` + 9 bits off : copie de 3 ; `101` + 10 bits off : copie de 4
    - `110` + 8 bits n + 12 bits off : copie de n+1 octets (1..256)
  - La marque de fin de mot est le bit 1 poussé à gauche quand `chunk` tombe à 0 (`nextBit`).
- **[vérifié]** Mon `cinelib.py:unpack` (réimplémentation Python) décompresse les 741 entrées avec CRC = 0 pour toutes, aucune erreur.
- **Surprise** : pour 63 entrées (52 dans les PART : tous les `.SPL`, `.MSG`, `.PRC`, `.REL` de taille impaire), la longueur écrite dans le flux (`unpackedLength`) vaut `unpackedSize - 1` : le répertoire arrondit la taille au pair. ScummVM alloue `unpackedSize` octets à zéro (`calloc`) donc l'octet final vaut 0 ; mes extractions font pareil (zéro de remplissage). Impact : lire les messages par comptage de longueur et non par fin de fichier.
- Ratio : 839 106 o compressés -> 4 310 493 o décompressés (≈ 5,1x ; les PI1/NEO/ANI se compressent très bien).

### 1.3 Appariement bundle / `.PAL`
`part.cpp:loadPart` : si le jeu est FW sur DOS et que le nom n'est pas `BASESON.SND`, il appelle `pal.cpp:loadPal(partName)` qui ouvre `<partName sans extension>.PAL` : `PART01` -> `PART01.PAL`, etc. `BASESON.SND` n'a pas de `.PAL`. Le `.PAL` est donc rechargé à chaque `loadPart`.

### 1.4 Listing (comptes par bundle, **[vérifié]**)
| Bundle | Entrées | Octets (fichier) | ANI | ANM | MSK | PI1 | NEO | PRC | REL | OBJ | MSG | SPL | DAT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PART01 | 173 | 165 376 | 101 | 2 | 32 | 10 | 5 | 3 | 2 | 3 | 2 | 11 | 2 |
| PART02 | 181 | 277 572 | 78 | | 57 | 13 | 13 | 3 | 1 | 1 | 2 | 13 | |
| PART03 | 162 | 155 502 | 89 | | 31 | 14 | 10 | 2 | 1 | 1 | 1 | 13 | |
| PART04 | 88 | 153 908 | 52 | | 11 | 11 | 5 | 1 | 1 | 1 | 1 | 5 | |
| PART04B | 51 | 92 704 | 28 | | 8 | 8 | 2 | 1 | 1 | 1 | 1 | | 1 |
| BASESON.SND | 86 | 16 298 | | | | | | | | | | | 8 (+3 sans extension) |
| **Total** | **741** | | 348+2 ANM | | 139 | 56 | 35 | 10 | 6 | 7 | 7 | 42 | 11 |

(+ dans BASESON : 34 `.H32`, 34 `.INS`, 7 `.HP`, 3 modules sans extension `ALIENS`, `SFUTUR`, `ESCAL`.)
Types présents : `.ANI .ANM .MSK .PI1 .NEO .PRC .REL .OBJ .MSG .SPL .DAT .H32 .INS .HP`. **Absents** : `.SET .SEQ .AMI .CT .ADL` (le code les gère pour Opération Stealth/Amiga mais ce jeu n'en contient pas).

## 2. Formats de fichier

Convention commune : tous les entiers sont **big-endian** sauf `.PAL` (little-endian, voir §3).

### 2.1 `.PI1` — fond d'écran 320x200, 16 couleurs (DEGAS Elite Atari ST) [vérifié]
Code : `cine/bg.cpp:loadBg` -> `gfx.cpp:FWRenderer::loadBg16` -> `gfxConvertSpriteToRaw`.
```
0x0000  u16 BE   mot de résolution DEGAS ("bpp" dans le code) : 0 = 16 couleurs (valeur 8 = 256 couleurs, Opération Stealth)
0x0002  16 x u16 BE  palette ST 9 bits : 0x0RGB, 3 bits par composante (R bits 8-10, G bits 4-6, B bits 0-2)
0x0022  32000 octets  pixels planaires (voir §2.1.1)
0x7D22  32 octets    (présent dans 32066 o seulement) limites d'animation de couleurs DEGAS : ignorées
```
Tailles observées : 32066 (= 2+32+32000+32) pour la quasi-totalité, 32034 pour quelques-uns (L44, L45...). Les 56 `.PI1` s'affichent correctement. **Vérifié visuellement** : `L1.PI1.png` (gratte-ciel de l'intro), `FW.PI1`, `PROTEC.PI1`, `L10.PI1` lisent bien.
Palette -> RVB 8 bits : `rouge = v*255/7` (`Palette::save` de `pal.cpp`).

#### 2.1.1 Pixels planaires (`gfx.cpp:gfxConvertSpriteToRaw`)
Pour chaque ligne, par groupe de **16 pixels = 4 mots big-endian = 8 octets** : mot 0 = plan de bits 0 des 16 pixels, mot 1 = plan 1, mot 2 = plan 2, mot 3 = plan 3 ; le pixel le plus à gauche est le bit 15 de chaque mot. Une couleur 0..15 = assemblage des 4 bits. Ligne de 320 pixels = 160 octets (`w=160` passé à la fonction = octets/ligne ; la fonction produit `2*w` pixels).

### 2.2 `.NEO` — « table de collisions » 320x200 (`*_MK.NEO`) [vérifié]
Code : `cine/bg.cpp:loadCtFW` -> `gfxConvertSpriteToRaw(collisionPage, ptr + 0x80, 160, 200)` ; `loadRelatedPalette(ctName)` (inutilisé).
```
0x00 - 0x7F  en-tête NEOchrome 128 octets (palette 16 mots en 0x04, nom en 0x24, limites d'animation...) : ScummVM saute les 128 octets
0x80  32000 octets  pixels planaires identiques au PI1
```
Total 32128 octets (35 fichiers). **Rôle** : page de collision/zones : la **valeur de la couleur (0..15) est un numéro de zone** (marche possible, hotspots d'objets...). Ex. `L1_MK.NEO` : seulement les couleurs 0 (54 900 px) et 3 (9 100 px). Le fond associé `L<n>.PI1` a son `L<n>_MK.NEO`. Le nom du fichier est chargé par l'opcode `loadCt` (0x3E).

### 2.3 `.ANI` / `.ANM` — sprites animés (frames 4 plans) [vérifié sur les 350]
Code : `cine/anim.cpp:loadAnimHeader`, `loadAni` (`.ANM` passe par la même fonction), `AnimData::load` (type `ANIM_MASKSPRITE`).
```
0x00  char[4]  "idString" : 0xBABEEBEA (341 fichiers) ou 00 00 00 00 (9 fichiers) : non testé par le moteur
0x04  i16 BE   frameWidth  = largeur d'une frame EN OCTETS de source (pixels = 2 x frameWidth)
0x06  i16 BE   frameHeight en lignes
0x08  6 octets inconnus (field_8..field_D)
0x0E  i16 BE   numFrames
0x10  6 octets inconnus (field_10..field_14)
0x16  numFrames x (frameWidth x frameHeight) octets : frames planaires (même codage 16 pixels / 8 octets qu'en §2.1.1)
```
- Taille attendue `0x16 + w*h*n` : **égale à la taille décompressée pour les 350 fichiers**.
- Exemple : `MARCHE.ANI` : w=16 octets (32 px), h=32, 34 frames (marche du héros), rendu dans `notes/img/marche.png`.
- **Transparence** : pas dans le fichier. `generateMask` crée un masque à partir d'une **couleur de transparence codée en dur** par nom : tableau `transparencyData` de `anim.cpp` (ALPHA=0xF, TITRE2=0xF, ET=0xC, L311=3, ... FIN=9) ; couleur 0 par défaut ; cas spéciaux `L2202.ANI` (frames 0-1 -> 0, sinon 7), `L4601.ANI` (frame 0 -> 0xE, sinon 0), `TITRE.ANI` hauteur 37 -> 0xF. Voir `getAnimTransparentColor` et `loadAni`. (Les sprites n'ont pas de palette propre : ils utilisent la palette du fond courant.)
- `AnimData::load` stocke ces images dans `_animDataTable` ; le numéro de slot est donné par le script (`loadAnim`, opcode 0x3C).

### 2.4 `.MSK` — masques de profondeur/collision 1 bit [vérifié]
Code : `anim.cpp:loadMsk`, `convertMask`. Même en-tête de 22 octets (idString `BABEEBEA`), puis `numFrames` x `frameWidth*frameHeight` octets ; **1 bit par pixel** (le bit à 1 = zone masquante), donc largeur en pixels = 8 x frameWidth. Ex. `FENETRE.MSK` : w=4, h=33, 1 frame = 22+132 = 154 o. Servent à faire passer le héros derrière des éléments de décor (opcodes `loadMask0/1/4`, `unloadMask*`).

### 2.5 `.SPL` — effets sonores PC [vérifié partiellement]
Code : `anim.cpp:loadSpl` (stocké tel quel via `ANIM_RAW`), joués par `script_fw.cpp:o1_playSample` (opcode 0x78) -> `sound.cpp:PCSound::playSound` -> `AdLibSoundDriverINS::playSample`.
- **Ce ne sont pas des échantillons PCM** (contrairement à Amiga/Atari). Un SPL PC = **un patch instrument OPL2** : ScummVM prend `data + 257` comme bloc instrument AdLib (`AdLibSoundDriverINS::playSample`, `loadInstrument` : mode, canal, 2 opérateurs de 26 o, 3 mots de forme d'onde).
- **[vérifié]** `ELECT375.SPL` (387 o) = 257 octets d'un patch Roland MT-32 (octet 0x80 + nom `elec375` ; même disposition qu'un `.H32` de 257 o) puis un bloc de 130 o dont le début (`01 06 ...`) ressemble à un `.INS`. Le reste du bloc (~50 o) est **inexpliqué [?]**.
- 42 SPL : 11+13+13+5. Noms : `ELECT375`, `SERRUR75`, `SEAU__75`, `ROBINE75`, `BIP00x05`, `LASER205`, `ORDI0115`, `STBY0105`, `TELEPO05`...
- La version CD joue ses SFX donc via l'émulation OPL de ScummVM (le CD ne porte que la musique).

### 2.6 `.PRC` — scripts de procédure [vérifié]
Code : `cine/prc.cpp:loadPrc`.
```
u16 BE numScripts (toujours 50)
numScripts x u16 BE  taille de chaque script (0 = script absent)
puis les scripts concaténés
```
**[vérifié]** la somme des tailles + 2 + 2*50 = taille du fichier pour les 10 PRC. Script = bytecode (`script_fw.cpp:FWScript::execute`) : 1 octet d'opcode (la table `_opcodeTable[opcode-1]`, 124 opcodes) suivi des paramètres décrits par une chaîne : `b` octet, `w` mot BE, `c` « octet non nul sinon mot », `s` chaîne ASCIIZ, `l` label, `x` fin de script (`FWScript::seekNextOpcode`, `script_fw.cpp:~430`).
Opcodes utiles (code = index de table + 1) : 0x3C `loadAnim "s"`, 0x3D `loadBg "s"`, 0x3E `loadCt "s"`, 0x40 `loadPart "s"`, 0x42 `loadNewPrcName "bs"` (b = 0 PRC / 1 REL / 2 OBJ / 3 MSG), 0x52 `message`, 0x6E `loadMusic "s"`, 0x6F `playMusic`, 0x70 `fadeOutMusic`, 0x71 `stopSample`, 0x78 `playSample`.
Contenu : PART01 = `PART01.PRC`, `INTRO.PRC`, `TOTO.PRC` ; PART02 = `PART02`, `PART02B`, `PART02C` ; PART03 = `PART03`, `PART03B` ; PART04 = `PART04` ; PART04B = `PART04B`. Les scripts référencent par nom les `.PI1`, `.NEO`, `.ANI`, `.MSK`, `.SPL`, `.OBJ`, `.REL`, `.MSG`, `.DAT` (vérifié par recherche de chaînes dans `PART01.PRC`).
**`AUTO00.PRC`** (script de boot) : lu depuis le disque (`part.cpp:readFile`), **avec `GF_CRYPTED_BOOT_PRC`** chaque octet est tourné d'un bit **à gauche** (`rolByte(.,1)`) parce que la version Sony l'a stocké tourné à droite. **[vérifié]** : brut `00 19 00 00 00 cb` -> décodé `00 32 00 00 00 97` = 50 scripts, un seul non vide (index 1 = `BOOT_SCRIPT_INDEX`, 151 octets), 2+100+151 = 253 = taille du fichier. Il contient les noms `PART01`, `TOTO.OBJ`, `INTRO.OBJ`, etc.
Protection anti-copie : le nom de procédure `L201.ANI` (`COPY_PROT_FAIL_PRC_NAME`, `cine.h`) est un faux nom que le jeu charge en cas d'échec de la protection ; `loadPrc` le détecte et quitte vers le lanceur (`prc.cpp`). Les écrans `PROTEC.PI1` et `FW.PI1` (PART01) restent donc présents ; aucune suppression de la protection dans ScummVM.

### 2.7 `.REL` — scripts d'objets (relations) [vérifié]
Code : `cine/rel.cpp:loadRel`.
```
u16 BE numEntry (255)
numEntry x { u16 size, u16 p1, u16 p2, u16 p3 }   (8 octets, en-tête)
puis les corps de script concaténés
```
`p1/p2/p3` = (type d'action, numéro d'objet, ...) pour la table `_relTable` ; `p3 = 0xFFFF` est fréquent. **[vérifié]** 2 + 8*255 + somme des tailles = taille du fichier pour les 6 REL. Un REL par chapitre (`PART01.REL` : 110 entrées non vides sur 255) + `TOTO.REL`.

### 2.8 `.OBJ` — table d'objets [vérifié]
Code : `cine/object.cpp:loadObject`.
```
u16 BE numEntry (255) ; u16 BE entrySize (32)
numEntry x 32 octets : i16 x, i16 y, u16 mask, i16 frame, i16 costume, char[20] name, u16 part
```
255 x 32 + 4 = 8164 pour les 7 fichiers. Exemple (PART01.OBJ) : #1 `heros` (x=180, y=105, mask=28, frame=18, costume=6) ; #2 `echafaudage` ; #3 `seau d'eau` ; #4 `eau`. Les noms d'objets sont donc **en français et sans accents** (ASCII), ceux du jeu original. Règle spéciale : `INTRO.OBJ` force `costume = 0` pour les 10 premiers objets (`loadObject`).

### 2.9 `.MSG` — messages [vérifié] (voir §4)
Code : `cine/msg.cpp:loadMsg`. `u16 BE count`, `count x u16 BE longueur`, puis les chaînes concaténées (ASCIIZ, la longueur sert à avancer). Les 7 MSG contiennent **1029 messages** (640 non vides).

### 2.10 `.DAT` — modules musicaux
Deux familles **[vérifié]** :
1. **Dans `BASESON.SND`** (8 `.DAT` + `ALIENS`, `SFUTUR`, `ESCAL`, soit 11 morceaux) : format « SoundFX/Soundtracker 15 instruments » de `sound.cpp:PCSoundFxPlayer` (`load`, `handleEvents`, `handlePattern`) :
   - octets 0..14 : volumes des 15 instruments (par accident ASCII sur certains, ex. `SONG+...`) ; 20 + 30*i : nom d'instrument sur 12 caractères (ex. `ELECGTR2.H32`), le moteur remplace l'extension par `.INS` (AdLib), `.H32` (MT-32) ;
   - octet 470 : nombre d'ordres ; 471 : tempo ; 472..599 : table d'ordres ; à 600 : patterns de 1024 octets (64 rangées x 4 canaux x 4 octets : période BE16, octet instrument<<4|effet, paramètre).
   Ces morceaux ne sont **pas joués** dans la version CD (la musique va au CD, §5) mais les données sont là.
2. **Dans les PART** (`PART01/DUGGER.DAT`, `PART01/SUITE23.DAT`, `PART04B/SUITE21.DAT`) : modules **Amiga/Atari** (noms d'échantillons `WEIRD.SND`, `DRWHO.SND`...), 0 sur les 20 premiers octets. Ils sont lus par `PaulaSound::loadMusic` (Amiga/ST) — **jamais** par `PCSound`. Restes inutiles dans la version DOS CD **[?]**.

### 2.11 `.H32`, `.INS`, `.HP` (dans `BASESON.SND`)
- `.INS` : 80 octets, instrument AdLib/OPL2 (`AdLibSoundDriverINS::loadInstrument`, `loadRegisterInstrument` : 2 opérateurs x 13 mots LE) — 34 fichiers.
- `.H32` : 257 octets, timbre Roland MT-32 (`MidiSoundDriverH32`, octet 0x80 + nom 10 car.) ; 34 fichiers dont beaucoup de 1 octet (vides).
- `.HP` : 7 entrées de 1 octet (vides).

## 3. Palettes

- **16 couleurs, jamais 256** dans ce jeu (le mode 8 bpp est propre à Opération Stealth : `bg.cpp:loadBg`, test `bpp == 8` jamais vrai ici).
- Format réel utilisé par ScummVM pour le DOS : la palette **ST 9 bits (0x0RGB, 3 bits/composante) incluse dans chaque `.PI1`** (`gfx.cpp` : `kLowPalFormat` = `PixelFormat(2, 3,3,3, 0, 8,4,0, 0)`, `Palette::load(... CINE_BIG_ENDIAN)`). C'est donc la **palette Atari ST/Amiga** et non une palette VGA 6 bits. (`PI1` = DEGAS : l'Amiga aurait 12 bits ; ici 9 bits.)
- Sprites et polices n'ont pas de palette propre : tout passe par la palette du fond courant (`_backupPal`/`_activePal`, dégradés par `transformPaletteRange` opcode 0x48).
- `.PAL` (un par bundle, **little-endian**) : `pal.cpp:loadPal`
  ```
  u16 LE count ; u16 LE entrySize (=42)
  count x { char[10] nom (bourré de 0 ou d'octets parasites) ; byte pal1[16] ; byte pal2[16] }
  ```
  **[vérifié]** tailles : PART01 112 entrées (4708 o), PART02 101, PART03 139, PART04 68, PART04B 35 (= 4 + n*42 exactement). Les noms correspondent aux **noms sans extension des `.PI1`, `.ANI`, `TEXTE`...** (ex. `L0`, `L1`, `ALPHA`, `ET`, `FUTUR`, `GIRL`). 
  `loadRelatedPalette(nom)` copie `pal1`/`pal2` dans `paletteBuffer1/2`, **qui ne sont lus nulle part dans ScummVM** (grep : seulement écrits dans `pal.cpp`). Ce sont donc des tables pour les modes graphiques PC d'origine (probablement conversion 16 -> CGA/Tandy/EGA, une table par parité de ligne ; valeurs type `00 ff 7f 77 64 64 31 00 cc 88 44 ab 33 88 11 00` **[?]**). ScummVM ignore ces données et affiche la palette ST : c'est le rendu attendu, pas un bug.
  Certains noms de PART02/PART03 contiennent des octets parasites (entrées 101 et 139 : 100/121 noms uniques) : bruit de fabrication.
- Le « SONY.LBM » est un **ILBM 640x480, 4 plans, compression ByteRun1**, 16 couleurs (CMAP 48 o), décodé par `image/iff` (`cine.cpp:showSplashScreen`) ; seulement affiché 2 s au démarrage si `GF_CD`. **[vérifié]** décodé en `notes/img/sony.png`.

## 4. Textes

| Source | Contenu | Encodage |
|---|---|---|
| `.MSG` (7 fichiers, 1029 messages dont 640 non vides) | tous les dialogues et descriptions du jeu | OEM DOS (CP437/850), 1 octet/caractère |
| `TEXTE.DAT` | **police** 78 glyphes (pas de texte) | voir ci-dessous |
| Code ScummVM `texte.cpp:initLanguage` (français : `failureMessages_FR`, `defaultActionCommand_FR`, `systemMenu_FR`...) | menus (« EXAMINER, PRENDRE, INVENTAIRE, UTILISER, ACTIONNER, PARLER »), messages d'échec, système (« Nouvelle partie », « Quitter »...) | CP437 en `\x82` etc. |

Messages par fichier : `PART01A.MSG` 255 (119 non vides), `TOTO.MSG` 255 (2), `PART02A.MSG` 174, `PART02B.MSG` 49, `PART03.MSG` 183, `PART04.MSG` 71, `PART04B.MSG` 42 = 1029. Le saut `|` (`gfx.cpp:~993`) = retour à la ligne dans une bulle. `PART01A.MSG` a 255 emplacements dont 136 vides (indices de la table réservés).

**Les textes sont bien en français** (patch de traduction) [vérifié].

### 4.1 Encodage des accents [vérifié]
Octets ≥ 0x80 présents dans les MSG : `0x82` (é, 650), `0x85` (à, 162), `0x87` (ç, 24), `0x8A` (è, 189), `0x97` (72). **Surprise** : `0x97` (ù en CP437) est utilisé **pour le ê** (« mùme », « ùtre », « tùte », « prùt », « intérùt »...) alors que ê = `0x88` n'apparaît jamais dans les MSG. Dans la table de police `fontParamTable_standard` (`texte.cpp`), `0x88` et `0x97` pointent vers le même glyphe 77 (ê) : donc rendu correct en jeu, mais **pour décoder il faut mapper `0x97 -> ê`** (mon `msg2.py` le fait). Aucun « ù » dans les textes (« où » est écrit sans accent, **[?]** non systématiquement vérifié).
Pas d'œ ni de majuscules accentuées (le glyphe n'existe pas dans la police : 78 caractères seulement) : « oeil », « coeur » dans les textes.

### 4.2 Police `TEXTE.DAT` [vérifié]
Code : `texte.cpp:loadTextData`, `texte.h` (`FONT_WIDTH 16`, `FONT_HEIGHT 8`, `NUM_FONT_CHARS 256`).
```
u16 BE entrySize = 8 ; u16 BE entryCount = 624
puis entryCount*entrySize = 4992 octets = 78 glyphes x 64 octets
glyphe = 8 lignes x 8 octets : 16 pixels par ligne, 4 plans (même codage planaire que §2.1.1), couleur non nulle = pixel allumé
```
Taille du fichier = 4 + 4992 = 4996 [vérifié]. **Les glyphes 0..77** : 0-25 A-Z, 26-51 a-z, 52-61 0-9, 62 `,`, 63 `!`, 64 `(`, 65 `)`, 66 `.`, 67 `/`, 68 `'`, 69 `"`, 70 é, 71 è, 72 à, 73 ç, 74 `-`, 75 `?`, 76 `:`, 77 ê (rendu dans `notes/img/font-sheet.png`, `font-tail.png`). Chaque caractère de 8 pixels de haut est dessiné sur 16 de large avec une largeur utile propre (tableau `{index glyphe, largeur}` par code ASCII, `fontParamTable_standard` ; la variante `_alt` (`GF_ALT_FONT`, 85 glyphes) est pour l'allemand/l'espagnol et **n'est pas utilisée** ici).
Table code -> glyphe (standard) : 'A'..'Z' = 0..25, 'a'..'z' = 26..51, '0'..'9' = 52..61, `, ! ( ) . / ' " - ? :` = 62..69,74..76 ; 0x82 é = 70, 0x85 à = 72, 0x87 ç = 73, 0x88 et 0x97 ê = 77, 0x8A è = 71. Les autres codes valent {0,0} (rien dessiné). La police est donc **française de fait** mais limitée.

### 4.3 20 lignes d'exemple (extraits de `msg-all-fr.txt`, indices = n° de message)
```
PART01A #3   La liste des invectives dont Ed vous abreuve serait trop longue à citer ici.
PART01A #35  Vous la ramassez.
PART01A #67  Oui mais je ne peux pas la fermer d'ici.
PART01A #99  Vous êtes dans le passage secret , fébrile de curiosité . Vous jetez machinalement un coup d'oeil ...
PART02A #10  C'est une branche qui a l'air très solide ...
PART02A #42  Au pied de l'arbre , vous trouvez une PIECE en argent !
PART02A #74  Il l'examine : " Ah ... je craignais le pire ... et je n'avais pas tort. "
PART02A #106 Je n'y arrive pas , il est trop haut.
PART02A #138 Vous pénétrez dans le passage secrêt ...
PART02A #170 Vous inspectez le sol ... RIEN !
PART02B #28  Hélas les Crughons aussi se sont emparés de cette invention , et nous craignons qu'ils l'utilisent contre nous.
PART03  #11  Vous dégagez l'objet qui ressemble vaguement à un chalumeau ...
PART03  #43  Au revoir et bonne chance !
PART03  #75  C'est bien ici , monsieur . Le prix du trajet simple est de 245 écus ...
PART03  #107 Les Crughons !!!  Votre coeur se met à battre très fort et vous sentez de la sueur froide ...
PART03  #139 COUPABLE !
PART03  #171 Vous l'interrompez : | " JE VAIS AVEC ELLE ! "
PART04  #20  Ah ! voila ce que je cherchais ! LE PENDENTIF ... Vous l'enlevez du cou de la jeune fille .
PART04  #52  UN ESPION ! HALTE ! PLUS UN GESTE OU TU ES MORT , TERRIEN !
PART04B #13  Au bout de quelques instants , ARISTOTE s'adresse de nouveau à vous : "C'est terminé , monsieur . Le Scorzuum ...
```
(« secrêt » = « secrùt » dans les données : faute d'origine du jeu.) Particularités typographiques : espace avant la ponctuation (« , », « ... »), `|` = saut de ligne, « oeil/coeur » en deux lettres.

## 5. Son

### 5.1 Matériel sonore présent
- **Musique : uniquement CD-DA** (29 pistes FLAC) pour la version CD : `sound.cpp:PCSound::loadMusic/playMusic/setBgMusic/fadeOutMusic` testent `GF_CD`.
- **Effets** : OPL/AdLib via `.SPL` (patchs instrument) ; **pas de voix/parole** (aucun fichier de voix ; `GUIO_NOSPEECH` dans `detection.cpp`). Pas de samples PCM dans ce jeu (les `.SPL` de la version Amiga/Atari seraient du PCM).
- **AdLib/PC speaker** : les 11 morceaux AdLib/MT-32 existent dans `BASESON.SND` mais ne sont **pas utilisés** quand `GF_CD` est actif (`loadMusic` ne charge que le numéro de piste). Aucun pilote PC-speaker/Tandy dans `cine`. MT-32 : si un périphérique MT-32 est détecté, les SFX/instruments passent par `MidiSoundDriverH32`.
- `BASESON.SND` = bundle (même format que PART) de 86 entrées : 11 modules, 34 `.INS`, 34 `.H32`, 7 `.HP`.

### 5.2 Correspondance musique -> piste CD (`sound.cpp`)
Les nombres du code sont des **numéros de piste CD d'origine** (20..30). L'appel `getAudioCDManager()->play(piste - 1, -1, 0, 0)` retire 1 : ScummVM cherche donc le fichier `trackN` avec **N = valeur du tableau - 1**. Preuve de cohérence : `cine.cpp:run` teste `existExtractedCDAudioFiles(19)` avec le commentaire « tracks <19 are not used » (valeur min 20 -> fichier `track19`) et la valeur max 30 -> `track29` (qui existe ; il n'y a pas de `track30`).
(Je n'ai pas le code de `audio/audiocd.cpp` dans le dossier fourni pour le confirmer ligne à ligne : l'inférence ci-dessus repose sur l'accord entre le test `19` et les 29 fichiers.)

`musicFileNames[11]` / `musicCDTracks[11]` (`sound.cpp:~1233`) :

| Nom du module (`loadMusic`) | Valeur code | Fichier FLAC | Durée | Où (script) |
|---|---|---|---|---|
| DUGGER.DAT | 20 | `track19.flac` | 2:43 | `TOTO.PRC` (PART01, intro), `PART04B.PRC` (fin) |
| SUITE21.DAT | 21 | `track20.flac` | 2:07 | `PART04B.PRC` |
| FWARS.DAT | 22 | `track21.flac` | 2:06 | `PART02C.PRC`, `PART03B.PRC` |
| TELESONG.DAT | 22 | `track21.flac` | 2:06 | `PART01.PRC` (même piste que FWARS) |
| SUITE23.DAT | 23 | `track22.flac` | 2:04 | `PART04B.PRC` (générique de fin, détecté dans `gfx.cpp`) |
| SUITE22.DAT | 24 | `track23.flac` | 3:03 | `PART04.PRC` |
| ESCAL | 25 | `track24.flac` | 2:51 | `PART03.PRC` |
| MOINES.DAT | 26 | `track25.flac` | 2:38 | `PART02B.PRC` |
| MEDIAVAL.DAT | 27 | `track26.flac` | 2:03 | `PART02.PRC` |
| SFUTUR | 28 | `track27.flac` | 2:38 | `PART03.PRC` |
| ALIENS | 30 | `track29.flac` | 2:16 | `PART03.PRC` |

`bgCDTracks[49]` (`setBgMusic(num)`, **n° du fond `L<num>.PI1`** : appelé par `o1_loadBg` et au chargement d'une sauvegarde) :

| Fond | Valeur | Fichier | Remarque |
|---|---|---|---|
| L1, L2 | 21 | `track20.flac` | si fond 1 : musique forcée immédiatement |
| L3 | 23 | `track22.flac` | |
| L5 | 29 | `track28.flac` | 0:44 — seule piste « longue » de moins d'une minute : jingle/musique d'une scène courte |
| L11 | 27 | `track26.flac` | |
| L33, L34 | 22 | `track21.flac` | |
| L35 | 23 | `track22.flac` | |
(autres fonds : 0 = pas de changement.) Règle : `_currentBgSlot == 1` ou (`_currentMusicStatus == 0` et piste différente) -> arrêt puis lecture en boucle (`numLoops = -1`).

Pistes **jamais référencées** par ScummVM : `track1..track18` (« tracks <19 are not used » dans `cine.cpp`). Observations [vérifié sur les FLAC, `notes/flac-durations.txt`] :
- `track1..track6` : 1:53, 2:30, 2:38, 2:35, 2:39, 2:38 (longues, musique) ;
- `track7..track18` : 12 pistes de **10,4 s à 13,2 s** (ce sont les « 11 s » signalées) ;
- `track19..track29` : 11 pistes de 2:03 à 3:03 sauf `track28` (0:45) = les 11 valeurs 20..30 du code ; seule `track29` correspond à la valeur 30 (ALIENS), la piste 29 (valeur) n'a aucune entrée dans `musicCDTracks`, mais `bgCDTracks[5] = 29` la fait jouer (= `track28.flac`).
**Hypothèse [?]** (non démontrée) : les pistes 1..18 sont des morceaux/stings d'une autre édition (par ex. la version CD originale d'Interplay jouait ces jingles courts) ou des pistes de démonstration ; il n'y a pas de référence dans le code ni dans les PRC (recherche des noms `DUGGER`, `SUITE2x`, ... uniquement). Pour retrovibe : **n'utiliser que `track19`..`track29`**, ce sont les seules mappables avec certitude.

Bug potentiel dans ScummVM [?] : `PCSound::fadeOutMusic` rejoue `play(_currentBgSlot - 1, ...)` (numéro de **fond** moins 1) au lieu de `bgCDTracks[_currentBgSlot] - 1` ; produit une piste incohérente après un fondu. À surveiller si on reproduit le comportement.

### 5.3 Autres comportements sonores spécifiques CD
- `script_fw.cpp:o1_playSample` (~1926) : avec `GF_CD` on **n'arrête pas la musique** quand un effet est joué (`g_sound->stopMusic()` est sauté).
- `PCSound::stopMusic` : avec `GF_CD`, arrête le CD sauf si le fond courant est le n°1.
- `PCSound::PCSound` ouvre le CD (`AudioCDManager::open`). `cine.cpp:run` affiche le message « pistes non extraites » si `track19` est absent.

## 6. Sauvegardes (ScummVM vs original)

Code : `cine/saveload.cpp` (+ `saveload.h`), `metaengine.cpp:getSavegameFile`.
- **Original (« plain »)** : fichier sans en-tête, `CineEngine::loadPlainSaveFW`, offsets en commentaire : `0x00 u16 disque`, `0x02 nom partie[13]`, `0x0F nom .DAT[13]`, `0x1C i16 musique en cours`, `0x1E PRC[13]`, `0x2B REL[13]`, `0x38 MSG[13]`, `0x45 fond[13]`, `0x52 CT[13]`, `0x5F` table d'objets (2x u16 + 255x32 o = 8164 o), puis palette, variables globales, zones, commandes, animations (`_animDataTable`), scripts globaux/objets, overlays, incrustations. Tous les nombres en **big-endian**. Plusieurs sous-formats (`ANIMSIZE_23`, `ANIMSIZE_30_PTRS_BROKEN/INTACT`) : ScummVM détecte le format.
- **ScummVM** : `makeSaveFW` écrit un chunk `ChunkHeader { u32 id = 'C1FW', u32 version = 4 (CURRENT_SAVE_VER), u32 size = 0 }` puis les mêmes champs que le format « plain » ; l'en-tête étendu ScummVM (description, date, temps de jeu, vignette) est ajouté ensuite. Fichiers `fw.<slot>` + index `fw.dir` (100 noms de 20 caractères, `SAVELIST_SIZE`) pour les saves de l'interface originale (`kMaxSavegames 100`, 20 par page).
- Le CD n'écrit pas de données de musique dans la sauvegarde autre que `currentDatName`/`musicIsPlaying` ; au rechargement `loadMusic` + `setBgMusic(atoi(bg+1))` (`saveload.cpp:~705`) relancent la bonne piste.
- Détails de sérialisation par structure non explorés fichier par fichier (hors périmètre).

## 7. Détection de cette version

`cine/detection_tables.h` (3e entrée du tableau `gameDescriptions`) :
```
gameId "fw", extra "Sony CD version with French translation patch"
AD_ENTRY2s("AUTO00.PRC", "4fe1e7930b38e3c63f0f2474d471bf8f", AD_NO_SIZE,
           "PART01",     "5d1acb97abe9591f9008e00d07add95a", AD_NO_SIZE)
langue FR_FRA, plateforme kPlatformDOS, ADGF_CD, GUIO0()
type GType_FW, features GF_CD | GF_CRYPTED_BOOT_PRC
```
- md5 d'`AdvancedDetector` = md5 des **5000 premiers octets** (ou du fichier entier si plus petit) : **[vérifié]** `AUTO00.PRC` complet = `4fe1e7930b38e3c63f0f2474d471bf8f`, `head -c 5000 PART01 | md5` = `5d1acb97abe9591f9008e00d07add95a`. Les deux correspondent bien à cette entrée.
- Le `PART01` n'est **pas** modifié par rapport à la version DOS française standard (même md5 que l'entrée « FR_FRA DOS sans CD » : 6e entrée) ; c'est `AUTO00.PRC` (version Sony, chiffré) qui distingue le CD.
- Entrées voisines : `Sony CD version` (EN_USA, `PART01` md5 `61d003202d301c29dd399acfb1354310`, mêmes flags) ; FR DOS floppy : `GF` 0.
- md5 intégraux locaux (utiles pour vérifier l'intégrité du jeu fourni) : PART01 `309c40b1d01c4352ec632ef3c99918bd`, PART02 `1762a2356b903b5df674890168b7daf2`, PART03 `e08762cc7d92280e3f7bd726a2ef9140`, PART04 `45b7b7fa6f7842d73bd6fe6a1d03ba16`, PART04B `8a56ee89bbb511c9d3d4791743153d75`.

### 7.1 Ce que changent `GF_CD` et `GF_CRYPTED_BOOT_PRC` dans le code
| Où | Effet |
|---|---|
| `part.cpp:readFile` / `prc.cpp:loadPrc` | décode `AUTO00.PRC` (rotation gauche 1 bit) |
| `cine.cpp:run` | modes 640x480 + écran `SONY.LBM` (2 s, touche « SKIPSONY ») ; avertit si pas de pistes CD >= 19 |
| `sound.cpp:PCSound` | musique via CD-DA (tables de §5.2), pas de lecteur OPL pour la musique |
| `script_fw.cpp:o1_loadBg` (~1379) | `setBgMusic(num du fond)` à chaque changement de fond |
| `script_fw.cpp:o1_playSample` (~1926) | ne coupe pas la musique pour un effet |
| `saveload.cpp:loadPlainSaveFW` (~705) | idem au chargement d'une sauvegarde |
Absent : `GF_ALT_FONT` (police standard), pas de `GF_DEMO`. **Pas de suppression de la protection anti-copie** dans ScummVM pour cette variante : les scripts d'origine la gèrent (voir §2.6).

## 8. Points incertains / à vérifier
1. Pistes CD 1..18 jamais appelées par ScummVM ; leur usage dans l'original n'est pas déterminé (une désassemblage de `FWARS.EXE` serait nécessaire ; non fait : exécutable non fiable).
2. Convention de nommage `trackN` = valeur-1 déduite de `existExtractedCDAudioFiles(19)` + présence de 29 fichiers (le gestionnaire CD de ScummVM n'est pas dans le dossier fourni).
3. Signification de `pal1`/`pal2` des `.PAL` (probables tables CGA/Tandy/EGA) : ignorées de ScummVM.
4. Fin des `.SPL` (~50 octets après le bloc instrument) non décodée ; en-tête de 257 octets = patch MT-32 apparemment.
5. Champs « unknown » des en-têtes ANI (6+6 octets) non interprétés par ScummVM (certains `field_*` sont lus mais inutilisés).
6. Les 3 `.DAT` Amiga/ST dans les PART sont probablement des restes de portage (non utilisés ici).
7. `0x97 -> ê` : confirmé par statistique de mots, la police les partage ; pas de « ù » trouvé dans les textes (non exhaustif).
8. Contenu exact du script `AUTO00.PRC` au-delà des noms (désassemblage non fait).
