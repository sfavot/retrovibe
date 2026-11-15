# The Incredible Machine 3 : formats des fichiers

Légende : **vérifié** par script sur les vrais fichiers (ISO extraite dans le scratchpad, scripts Python lancés en `python3 -I`, rien d'exécuté, PNG regardés) ; **lu** dans les octets, les chaînes de l'exécutable ou une documentation externe, cohérent sur quelques exemples sans validation exhaustive ; **supposé**.
Source : `jeu-00235-incredible_machine_3-pcwin.7z` (Abandonware France) → `IncMac3.iso`, Sierra/Dynamix 1995, **version 3.0** (écran de titre « Version 3.0 », « ©1995 Sierra On-Line », vérifié ; boîte « About » de l'exe, lu).
Références externes (lues, non reprises telles quelles) : ModdingWiki (formats de ressource, d'image, de niveau, ANM de TIM 1 à 3), `timgres` (visionneuse, noyau CC0), ScummVM `engines/dgds` (LZW et RLE, GPL v3 ou ultérieure). Aucun code de ces projets n'est repris. Droits : voir `plan.md`, décision D1 (abandonware, pas freeware).
Scripts d'étude (hors dépôt, scratchpad `tools-tim3/`) : `dgds.py` (chunks, LZW), `lev.py` (heuristique, échoue sur 161/206), etc. ; sorties : `reslist.txt`, `bmp_frames.txt`, `levels_en.txt`, `levels_fr.txt`.

## 1. Contenu de l'ISO (vérifié)

| Chemin | Octets | Rôle |
| --- | --- | --- |
| `TIMWIN/RESOURCE.MAP` | 12 276 | index des deux volumes |
| `TIMWIN/RESOURCE.001`, `.002` | 7 508 126 ; 1 783 838 | **ressources** (001 : images, puzzles, textes anglais ; 002 : effets WAV et musiques HMI) |
| `TIMWIN/{FRENCH,GERMAN,ITALIAN,SPANISH,ENGLISH}.DAT` | 469 457 ; 440 153 ; 375 213 ; 464 395 ; 788 | packs de langue (§ 2, 7) |
| `TIMWIN/{GOALS,HELP,PROFESOR,HINT1-7}.VOC` | 5,2 ; 11,6 ; 3,0 ; 4,1 ; 2,6 ; 1,2 ; 0,4 ; 0,15 ; 0,21 ; 0,03 Mo | voix anglaises (§ 8) |
| `TIMWIN/TIMWIN.EXE` | 454 656 | PE32 i386 Win32s (Borland C++ 1994, TLINK32), GUI 3.10 ; **non exécuté**, sert de documentation (chaînes, imports) |
| `TIMWIN/TIMWIN.INI` | 385 | `[Language] LANG=ENGLISH`, zone de jeu 568×378 en (7,68), barre de but 566×77, bac à pièces 432×663 (lu) |

**Utile au portage** : RESOURCE.MAP/.001/.002, FRENCH.DAT, les `.VOC`. **Ignoré** : `DEMO/` (démo Dr. Brain : `BRAIDEMO.EXE`, `BRAINSON`), `WIN32S/`, `WING/`, `SETUP.*`, `AUTORUN.*`, `BOOTDISK.*` (installateurs) ; `TIM{E,F,G,I,S}.MVB` (5 × 4 908 545 o, **MD5 identiques**, aide Multimedia Viewer anglaise, `TIMHELP.EXE`, `MV*.DLL`) ; `CTL3D.DLL` ; `SOS*.DLL`, `SOSLIB.INI`, `HMIDRV.WIN`, `HMIMDRV.WIN` (son HMI SOS) ; `DRUM.BNK`, `MELODIC.BNK` (§ 10) ; `README.WRI` (conseils MIDI Mapper, canal 10 batterie).
Dates : tout au 1995-09-09, sauf **FRENCH.DAT au 2007-09-26** (ISO créée le 27) : fichier probablement remplacé à la création de l'ISO (cause **supposée**).
Exécutable : imports KERNEL32, USER32, GDI32 (DIB, palettes), WINMM (`timeGetTime`, `mciSendStringA` seulement), COMDLG32 ; **WinG** (`GFXDevWinG`) et le son HMI SOS (~70 noms `sosDIGI*`, `sosMIDI*`) sont chargés à l'exécution (vérifié pour les imports, lu pour le reste). Pas de virgule flottante (aucun motif x87 courant) : physique en entiers ou virgule fixe (vérifié pour les comptes, supposé pour l'interprétation). Le moteur descend de TIM2 (menus `TIM2MENU`, `SYSTEM.VIN` listant `tim2.sx`, concours « TIM2 Contest Champion! ») (lu).

## 2. Conteneur : RESOURCE.MAP, volumes, .DAT (vérifié)

```
RESOURCE.MAP : u8[4] 00 01 04 07 ; u16 nVolumes (=2) ;
  par volume : char[13] nom ("RESOURCE.001\0") ; u16 nEntries ; { u32 hash ; u32 offset } × nEntries
Volume : à chaque offset : char[13] nom (8.3 + NUL) ; u32 taille ; octets
```
RESOURCE.001 : 1 384 entrées, RESOURCE.002 : 146, soit 1 530 ; le map se lit jusqu'au dernier octet et les 1 530 entrées ont la taille exacte. Le hash (octet fort = 1er caractère du nom, 2e octet ≈ 2e caractère) n'est pas reconstitué : inutile, on indexe par le nom lu dans le volume (lu).
**Un `.DAT` de langue est un map suivi de son unique volume, dans le même fichier**, le volume portant le nom du `.DAT` (vérifié). Les langues se superposent à RESOURCE.001 : un fichier du pack remplace celui du volume de même nom (**supposé**, cohérent avec la liste des fichiers). `ENGLISH.DAT` ne contient qu'un `SYSTEM.RES` (734 o) : l'anglais vit dans RESOURCE.001.

| Ext. | Nb | Octets | Contenu |
| --- | --- | --- | --- |
| BMP | 477 | 5 822 391 | images (472 « plates » v1000, 11 conteneurs DGDS) ; 3 244 frames dans RESOURCE.001 |
| ANM | 438 | 409 501 | animations (§ 4) |
| LEV | 206 | 485 779 | puzzles (§ 5) |
| PAR | 149 | 13 250 | propriétés des pièces 0 à 148 (§ 6) |
| WAV | 121 | 1 413 561 | effets (RESOURCE.002) |
| ITF | 44 | 17 472 | interface (boutons, fenêtres) |
| PAL | 28 | 28 577 | palettes (25 RIFF, 3 DGDS) |
| RES | 26 | 166 960 | textes CRLF, tables de synchro labiale `M*.RES` |
| HMI | 24 | 367 781 | musiques (RESOURCE.002) |
| PFT / FNT | 8 / 6 | 492 232 / 20 061 | polices |
| VIN | 2 | 118 | motifs de fichiers (`*.pal`, `?lev*.lev`, `*.wav`, `*.hmi`) |
| INF | 1 | 28 271 | `LEVELS.INF` (titres, buts, indices) |

Noms : `PART0` à `PART258` (+ `PART18ST/X/Y/Z`, `PART136A`), `PART0-148.PAR` et `.ANM`, `INFO*.BMP/ANM` (fiches d'aide), `ICONS1-10`, `MAIN*.BMP`, `SIERRA00-17.PAL` (fondu du logo).

## 3. Compression (vérifié)

Chunks Dynamix : `char[4] "XXX:"` + `u32 taille` ; **bit 31 de la taille = conteneur** (sous-chunks à la suite). Toutes les ressources « XXX: » se parcourent à l'octet près. Tags : `BMP:`, `INF:`, `BIN:`, `VGA:`, `SCL:` (1), `ANM:`, `TAG:` (442), `LAB:` (5), `ITF:`, `PAL:`, `EGA:`, `PAR:`, `FNT:`. Absents : `SCN:`, `TTI`, `SDS`, `TTM` (pas de scripts DGDS).
Charge compressée (`BIN:` / `VGA:` d'un BMP conteneur) : `u8 méthode` + `u32 taille décompressée` + flux. Méthode 0 = brut (20 chunks de BMP), 1 = RLE Dynamix (jamais dans un BMP, mais **dans les 7 polices FNT**), 2 = LZW Dynamix (**2 chunks**, tous deux dans `PART136.BMP`). Tout le reste est non compressé. Lecteurs : `src/games/tim3/data/dgds-chunk.ts` (chunks, parcourus à l'octet près : **vérifié** sur les BMP DGDS, PAL et FNT) et `compression.ts`.
RLE (**vérifié** : 7 FNT, flux consommés jusqu'au dernier octet) : octet de commande, bit 7 levé = répète l'octet suivant `cmd & 0x7f` fois, sinon recopie `cmd` octets.
LZW (**vérifié**) : codes poids faible d'abord, 9 bits au départ, 12 au plus, code 256 = remise à zéro (avec saut d'alignement sur un bloc de `nbits*8` bits), première entrée libre 257, largeur augmentée dès que la table atteint 2^n (le compteur d'alignement repart de 0 à chaque changement de largeur), au-delà de 4 096 entrées le dictionnaire n'évolue plus. Les 2 chunks donnent exactement les 1 236 octets annoncés (images 48×43 et 24×17). Réécrit d'après `engines/dgds/decompress.cpp` (ScummVM, lu). Les données réelles ne dépassent pas 512 codes ; **le passage 9 → 10 → 11 → 12 bits, la saturation et la remise à zéro avec alignement sont donc vérifiés sur des flux synthétiques** (encodeur de test qui rejoue les règles ci-dessus, `test/tim3/data/compression.test.ts`) et non sur des fichiers du jeu : ils ne valent que si la lecture de ScummVM est correcte. RLE et LZW rejettent un flux tronqué.

## 4. Images, animations, polices

**BMP plat** (472 fichiers, vérifié) : `"BMP:"`, `u32 taille` (= fichier − 8), `u16 version = 1000`, `u16 nFrames`, `u32 offset[nFrames]` (absolus), puis par frame `u16 w, u16 h, u8 compression (=0 partout), u32 octets (= w×h), pixels`. 8 bits indexés, lignes de haut en bas. **Vérifié sur les 472 fichiers (3 055 frames)** : offsets contigus, taille = w×h, aucun octet restant.
**BMP DGDS** (11 fichiers : CORNERS, HINTPROF, PART136, PROFESR2, TITLEMSC = 189 frames + 6 du pack français = 215 frames, vérifié) : `INF:` = `u16 n, u16 w[n], u16 h[n]` ; `BIN:` = quartets bas, `VGA:` = quartets hauts, chaque octet porte 2 pixels : pixel `2i` = `BIN[i] & 15 | (VGA[i] & 15) << 4`, pixel `2i+1` = `BIN[i] >> 4 | VGA[i] & 0xF0` ; frames concaténées sans alignement ; `SCL:` vide ignoré. La somme des w×h vaut exactement 2 × la taille de `BIN:` dans les 11 fichiers. Lecteur : `bitmap.ts`.
**Palettes** (vérifié sur les 28 + celles du pack français, `palette.ts`) : RIFF « PAL data » (taille RIFF = fichier − 8, bloc `data` de `4 + 4×256` octets : `u16 0x300, u16 256`, entrées R,G,B,drapeaux) ; `TIM_NEW.PAL` = palette du jeu (220 couleurs distinctes). DGDS `PAL:` (conteneur) → `VGA:` (TIM2.PAL, PARTTEMP.PAL, BLACK.PAL) = 768 octets RVB 6 bits, plus un `EGA:` de 17 octets dans BLACK.PAL (ignoré) ; le lecteur étend 6 → 8 bits par `v << 2 | v >> 4` (63 → 255, au lieu de `× 4`, choix du portage, aucune donnée du jeu n'en dépend). **Transparence = index 0** (magenta 255,0,255 ; coin des sprites à 0 dans 1 199 des 1 500 frames PART* testées) ; index 255 = vert pur.
Tailles : plein écran 640×480 (`SIERRA.BMP`, 307 200 o bruts), `TITLE.BMP` 640×377 (palette `TITLE.PAL`). Sprites : PART0 à 148 = pièces animées (PART0 8 frames, PART5 20, PART12 chat 27, PART15 68) ; PART1xx à 2xx surtout décors d'une frame.
**ANM** (vérifié, `src/games/tim3/data/anm.ts`) : chunks `ANM:` + `TAG:` (+ `LAB:` dans 5 fichiers). Les **442** ANM (438 + 4 du français) se lisent jusqu'au dernier octet.
```
ANM: "TB" ; u16 version (1001 ×424, 1000 ×11, 1002 ×5, 1004 ×2) ; u16 nSéq, nImages, nÉtats, octetsCommandes, largeur, hauteur
     [≥ 1002 : 3 × u16 (20, 0, 0 ou 20, 0, 23), sens inconnu]
     u16 séquence[nSéq] (index d'images) ; nImages × { i16 x, i16 y, u16 l, u16 h, u16 offset EN MOTS dans les commandes [, u16 ? si ≥ 1002] }
     nÉtats × { u16 premier (index dans la séquence, ou dans les images si elle est vide), u16 état } ; commandes
commandes (u16) : 0 fin d'image ; 1 fin du flux (dernier mot, une fois) ; 2 bitmap {id TAG, image, i16 x, i16 y, retournement 0-3} ;
     3 rectangle {x, y, l, h, couleur, remplissage = 0x8000|couleur} (14 o) ; 4 ligne {x1, y1, x2, y2, couleur} (12 o) ;
     5 son {SX_n} ; 8 son étendu {SX_n, ?, ?} (8 o, 36 fois dans MAINMENU et SIERRA)
TAG: u16 n ; { u16 id, cstring BMP } × n          LAB: u16 n ; { u16 id, cstring } × n
```
Écarts avec ModdingWiki / timgres : rectangle et ligne ont 2 octets de plus que décrit (mot de commande compté), l'offset des images est en mots, version 1004 et commande 8 non décrites. Sens des états (`état` = numéro d'état de la pièce, supposé) à confirmer avec les handlers.
**ITF** (vérifié, `src/games/tim3/data/itf.ts`) : **disposition des contrôles d'une fenêtre** (44 + 12 du français, tous lus jusqu'au dernier octet). `ITF:` = `"TBO" u8 4`, cstring ANM des images, `u16 n`, `u16 genre[n]`, puis n contrôles de 22 o `{u16 genre (= genre[i]), u16 id, i16 ? (−3 pour 435/454), i16 x, y, u16 l, h, u16 image (1 = valeur est une image de l'ANM), u16 valeur, i16 ?, i16 ?}` ; genre 4 (zone de texte) ajoute 18 o `{?, couleur, ?, x, y, l, h, drapeaux, ?}`. `TAG:` = noms des contrôles (`BS_DONE`, `HH_PLAY1NAME`). Genres (supposés d'après les noms) : 0 image/libellé ×314, 1 bouton ×144, 2 choix exclusif ×25, 3 interrupteur ×40, 4 texte ×21, 5 flèche ×80. L'`id` est la clé à 5 chiffres de `DESCRIPT.RES` et `HELP.RES` (267 contrôles sur 454 y figurent). Les `PROG<n>.ITF` = fenêtres de programmation des pièces programmables.
**Polices** (vérifié, `font.ts`, toutes lues jusqu'au dernier octet) :
- 6 `FNT:` DGDS (+ `SYS12.FNT` aussi dans FRENCH.DAT) : `u8 0xFF, u8 largeur max, u8 h, u8 ligne de base, u8 premier caractère, u8 nombre n`, `u16 taille décompressée`, puis une charge compressée (méthode 1 = RLE) qui contient `u16 offset[n]`, `u8 largeur[n]`, puis les glyphes : `ceil(largeur/8) × h` octets, bit de poids fort à gauche ; offsets relatifs au début des glyphes, contigus. Premier caractère 0x20 (n = 96, 217, 235) ou 0 (n = 249 : `RMN1_18`, `RMN8_40`).
- 8 `PFT` (« PFNT », police `GFXFont` du moteur 32 bits) : chunks `tag[4] + u32 taille` : `PFNT` (taille trop courte), `head` (12 × u32 : version 1, 0x45, 0, 0xFF, **hauteur**, **ligne de base** (supposée), 0xFF, 0, hauteur, 0x10000, 0x10000, 0), `PBMA` (`head` = 0x101 et 255 ; `user` de 3 060 octets à 0 ; `rmap` = 255 × u32, indice de glyphe + 1 par code, **pour les codes 1 à 255** : le rendu du texte du but, décalé d'une lettre avec un départ à 0, l'a établi), puis **255 chunks `PBMP`** (`head` = version 1, largeur, hauteur, 8, 1 ; `data` = lignes de `(largeur+3) & ~3` octets comme un DIB, 0xFF = encre). **La taille déclarée de chaque `PBMP` est inférieure de 4 octets à son étendue réelle** et les `PBMP` dépassent la fin déclarée de `PFNT` : le fichier se lit jusqu'à son dernier octet en avançant de `taille + 12`.

## 5. Puzzles (LEVELS.INF, LEV)

**206 `.LEV`** dans RESOURCE.001, motif `%s%d.LEV` ; l'ordre de `LEVELS.INF` (206 entrées) suit les préfixes (vérifié) :

| Préfixe | Nb | Index INF | Catégorie (anglais / français) |
| --- | --- | --- | --- |
| TLEV1-40 | 40 | 0-39 | Tutorial Puzzles / Travaux Pratiques |
| ELEV1-26 | 26 | 40-65 | Easy / Faciles |
| MLEV1-30 | 30 | 66-95 | Medium / Moyens |
| HLEV1-31 | 31 | 96-126 | Hard / Difficiles |
| RLEV1-29 | 29 | 127-155 | Really Hard / Très Difficiles |
| HH1-50 | 50 | 156-205 | Head to Head / À Deux Joueurs (2 joueurs) |

Soit **156 puzzles solo + 50 duels**. Le titre stocké dans le LEV retrouve l'index INF pour 198 des 206 (2 diffèrent d'un point final : ELEV17, HH21 ; 6 de versions 0x111/0x112 lues décalées) ; préfixe + numéro ↔ index tient pour les 206. Autres : sauvegardes `HOME%04d.TIM`, `PUZB%04d.TIM`, `tim%02d.sav`, `TIM.SAV`, `TEMP.LEV`. Pas de « Freeform » nommé : équivalent = **Professor Tim's Workshop** (« Labo »), plus « Walk-Through » et « Homemade Puzzles » (lu).
**LEVELS.INF** (vérifié, décodé en entier) : `u16 n = 206`, `u16 offset[n]`, puis par puzzle 10 chaînes NUL : titre, but, 8 indices (vides = "").

**Format `.LEV`** (vérifié, `src/games/tim3/data/lev.ts`) : **`writeLev(readLev(b)) = b` à l'octet près pour les 206 LEV** (aucun LEV dans FRENCH.DAT). Conforme à timgres (`fformat.txt`) sauf la version 0x111 et le premier mot du bloc solution.
```
u16 magic 0xACEF ; u16 version : 0x113 ×193, 0x111 ×3 (HH3/5/9), 0x112 ×3 (TLEV25/33/36), 0x114 ×7
[≥ 0x113] u8 ? (= 0) ; u8 couleur de fond (3 ×172 ; 1 à 11 ; couleur logique de 413388, voir `graphics.md`)
cstring titre ; cstring but (anglais, cp1252) ; u16 nIndices (0 à 7)
8 × { i16 x, i16 y, [≥ 0x112] u16 retournement 0-3, cstring texte }      (en 0x111 : pas de retournement)
infos 16 o : u16 pression (67), u16 gravité (272), u16 ?, u16 ? (568, 378 dans les 7 fichiers 0x114, 0 ailleurs),
             u16 musique (SX_n.HMI), u16 nFixes, u16 nMobiles, u16 ? (0)
nFixes pièces (flags1 0x6000 : 7 331) puis nMobiles (flags1 0x1000 : 1 248), taille selon le type
bloc solution 132 o, puis fin du fichier
```
**Pièce** (tailles vérifiées sur les 8 579 enregistrements) : tête commune 24 o `{type, flags1, flags2, flags3, apparence, ?, l1, h1, l2, h2, i16 x, i16 y}`, puis selon le type :
- **48 o** (défaut) : `comportement, ?, u8 attache courroie x/y, longueur courroie, ?, u8 attache corde 1 x/y, ?, u8 attache corde 2 x/y, i16 lié1, lié2, branché1, branché2` (−1 = aucun) ;
- **balle programmable 87, 60 o** : défaut + `densité, élasticité, frottement, i16 gravité/flottaison, masse, apparence 2` ;
- **corde 10 et câble 76, 54 o** : `longueur de segment, 5 × ?, i16 pièce1, i16 pièce2, u8 usage extrémité 1/2, 2 × ?, 4 liens` ;
- **courroie 8, 52 o** : `4 × ?, i16 pièce1, i16 pièce2, 4 × ?, 4 liens` ;
- **poulie 7, 56 o** : `5 × ?, u8 attache 1 x/y, 2 × i16 (−1), 2 × ?, u8 attache 2 x/y (supposé), i16 poulie1, poulie2, 2 × i16 (−1), i16 index de corde`.
Les champs non compris sont gardés bruts (`unknownXX`, XX = offset). Index de pièce = rang dans la liste fixes puis mobiles. **Bac à pièces** : pas de section, ce sont les pièces sans `flags3 & 0x40` (« verrouillée »).
**Bloc solution** (`solutions.ts`) : `u16 ?` (= 1 dans les 206 : **pas** le nombre de conditions, contrairement à timgres), 8 × `{i16 pièce (−1 = libre, le reste vaut alors 0), état1, état2, nombre, x, y, l, h}`, `u16 délai` (0 sauf 4 puzzles). Zone `(0,0,0,0)` = pas de test de position (261), `(−1,−1,−1,−1)` = hors de l'écran (19), sinon zone (109). **389 conditions, 1 à 8 par puzzle ; les 206 puzzles en ont.** `état1/état2` = numérotation interne (maison de Mel 110, ballon 1→5…), non reliée ici à `SOLVE.RES`.
**Solution d'un puzzle** (vérifié) : le jeu n'a ni démonstration ni placement automatique ; il ne connaît que ces conditions, vérifiées après le délai, et les 8 flèches d'indice. **Mais les pièces du bac sans le bit `0x100` de `flags3` sont à la place où le concepteur les a posées** (liens compris) : les poser là résout au banc les 156 puzzles solo ; celles avec `0x100` sont des leurres (vague K, `solutions.md` § 1). `SOLVE.RES` ne contient pas de solutions : c'est, pour les 149 pièces, la liste des états proposés par la fenêtre « Solution » de l'atelier (`SOLVE.ITF`) pour écrire les conditions d'un puzzle maison (`!PartN`, nom, puis `@plages` = test de position seul, 12 pièces, ou paires `plages` / libellé d'état ; plage `a,b[E][&image%]`, −1 = fin, `E` = explosion ; bloc 22 sans nom ; numéro absent au bloc 35 : l'ordre fait foi). `BINSOLVE.RES` = les 6 félicitations de fin de catégorie (5 catégories, puis tout le jeu).
**Puzzles HH, « Head to Head » / « À Deux Joueurs »** (lu dans `INTRFACE.RES`, `HELP.RES`, `DESCRIPT.RES`, `HEDTOHED.ITF`) : **deux joueurs sur le même poste, à tour de rôle**, sur le même puzzle. Chaque tour est limité par un compte à rebours réglable par joueur (`HH_P1_UP`, « Increase Time ») et n'autorise qu'une action (« You've already moved 1 part! », « You've already taken a part from the Parts Bin! ») ; « End Turn » passe la main. Le joueur pendant le tour duquel la machine résout le puzzle gagne la manche (supposé d'après « %s, you solved the puzzle! ») ; le compteur « Wins » mène à une **partie en plusieurs manches** (« The winner of the next game takes the match »). Ni course ni réseau. Format LEV identique aux autres puzzles.

## 6. Pièces (PAR)

`PART0-148.PAR` (**vérifié sur les 149 fichiers**, `part-def.ts`, lus jusqu'au dernier octet) : `"PAR:"` `u32 taille` (= fichier − 8) ; `"PROP"` ; `u8 'I'`, `u8 1`, `u16 idPièce` (= numéro du fichier). Puis **14 mots u16** :

| Mot | Nom | Valeurs / sens |
| --- | --- | --- |
| 0 | densité (descripteur +0x4C) | bowling 2832, basket 1322, base-ball 2000, ballon 9, murs 4153 ; 0 pour 34 pièces (supposé : unités de l'air = 67) |
| 1 | masse (+0x50) | bowling 200, basket 20, tennis 5, ballon 1, murs 1000 |
| 2 | élasticité (+0x54) | balle magique 0x200, billard 0xE0, bowling 0x80, murs 0x400 (1024 pour 51 pièces) ; échelle supposée |
| 3 | drapeaux | 0, 0x10 (45), 0x20, 0x18, 0x40… : bits non décodés |
| 4 | – | toujours 0 |
| 5, 6 | – | 0, 0x10, 0x20, 0x30 ou 0xF0 (frottement ? supposé) |
| 7, 8 | – | 0, 64, 96, 576 / 0, 416, 512 (murs et pentes) : sens inconnu |
| 9, 10 | largeur, hauteur | pixels |
| 11 | drapeaux de forme | 0 (120), 8 (24), 24, 136, 144, 526, 1 : **0x8 et 0x10 = copies en miroir** des polygones (engine.md § 2 ; axe supposé) |
| 12, 13 | nombre de polygones, nombre total de sommets | recoupés sur les 149 fichiers |

Puis, par polygone, **2 mots d'en-tête** (sens inconnu : (0, 0) en général, (71, 19) pour le chat, (16, 45), (22, 46), (17, 35) pour le ballon) et des sommets `{u16 drapeau, u16 x, u16 y}` ; le dernier sommet porte le bit 0x4000 et **fait partie du polygone** (boule de bowling 32×32 = octogone (8,0)(23,0)(31,8)(31,23)(23,31)(8,31)(0,23)(0,8)). Les 149 fichiers n'ont que les drapeaux 0 et 0x4000. Murs, pentes : 0 polygone (zone rectangulaire). Formes de collision = polygones en pixels ; comportements propres (moteurs, câbles, lasers) dans l'exécutable (supposé). Aucune rétro-ingénierie publiée de la physique TIM2/3 trouvée.

## 7. Textes

**Windows-1252** (vérifié), CRLF dans les `.RES`, `\n` littéral (2 caractères) dans `SYSTEM.RES`. `FRENCH.DAT` : 41 fichiers (vérifié) : `SYSTEM, DESCRIPT, HELP, INFO, INTRFACE, MUSIC, MUSIC2, SOUND, PROFESOR, PROGPART, SOLVE, BINSOLVE, CREDITS, CURSOR, TIMDOS .RES`, **`LEVELS.INF` traduit**, ITF traduits (MAINMENU, LOADSAVE…), bitmaps à texte incrusté (BUTTONS, CNTRLPNL, CURSORS, PARTSBIN, WTOOLBAR, HEDTOHED) et leurs ANM, `SYS12.FNT`, `SYSTEM.VIN`, **`KEYBOARD.MAP`** (remap AZERTY, contenu non décodé). Autres : allemand 40 fichiers, italien 35, espagnol 39.
- `INFO.RES` : `"%3d.\tNom\tDescription"` pour les 149 pièces (0 Boule de Bowling … 148 Détecteur à Laser) (vérifié, anglais et français, `text.ts`). Dix `.RES` des packs de langue (dont le `INFO.RES` français) se terminent par le marqueur DOS `0x1A` : retiré à la lecture.
- `LEVELS.INF` : lu et validé (offsets de chaque puzzle, aucun reste) en anglais et en français : 206 × (titre, but, 8 indices).
- `MUSIC.RES` : 19 titres (`1000 TIM`, `1001 Unplugged`…) ; `SOUND.RES` : 22 effets nommés (`3001 Yeee Haaa!!`…) (vérifié, `parseIdTable`).
- `DESCRIPT.RES`, `HELP.RES` : `NNNNN  texte` (identifiant à 5 chiffres = contrôle ITF ; `@` et `!` = marqueurs) ; `SOLVE.RES` : états des pièces pour la fenêtre « Solution » de l'atelier, pas des solutions (§ 5, vérifié) (lu ; les deux premiers se lisent avec `parseIdTable`, `SOLVE.RES` relève de `solutions.ts`).
- Langue : l'index de ressources superpose le pack (`ResourceIndex.overlay`), `loadTexts` lit donc la langue présentée ; l'anglais est la base (vérifié : `LEVELS.INF`, `INFO.RES`, `SYSTEM.RES` du pack remplacent ceux de RESOURCE.001).
- Les `.LEV` contiennent les textes **anglais** ; `LEVELS.INF` de la langue les remplace (supposé, cohérent : aucun LEV dans les packs). Exemple : #0 « Portées Disparues » / « Faites disparaître la balle no8 de l'écran. ».

## 8. Voix

Les `.VOC` sont des **archives maison, pas du Creative Voice** (vérifié) :
```
u16 n ; u32 offset[n] ; entrée : u32 lenSync ; u8 sync[lenSync] ; u32 lenWav ; RIFF WAVE (PCM 8 bits mono 11 025 Hz)
```
| Fichier | Entrées (non vides) | Durée |
| --- | --- | --- |
| GOALS.VOC | 206 (206), une par puzzle, ordre INF | 473 s |
| HINT1 à 7.VOC | 206 chacun (104, 74, 30, 10, 5, 4, 1) : indice n du puzzle | 781 s |
| HELP.VOC | 188 (188), avec synchro | 1 042 s |
| PROFESOR.VOC | 34 (32), avec synchro | 271 s |

Total ≈ **42,8 min**. **Voix anglaises seulement**, un jeu pour toutes les langues (corrélation durée / longueur de titre + but : 0,94 avec l'anglais, 0,77 avec le français) : en français, texte français sous voix anglaises (comme BASS). L'exe référence `HINT8.VOC`, absent. **Synchro labiale** : octets `sync` de chaque entrée (HELP, PROFESOR) et tables `MGOALS, MHELP, MHINT1-7, MPROF .RES` (mêmes comptes d'entrées), structure **à décoder** ; rôle lu.
**Extraction (vague X, vérifié)** : `scripts/tim3/split_voc.py` contrôle chaque archive (offsets strictement croissants, chaque entrée finit à l'offset suivant, la dernière à la fin du fichier, WAV = RIFF PCM 8 bits mono 11 025 Hz). Les entrées à `lenWav` = 0 sont sautées (les autres gardent leur index d'archive) : **654 voix** non vides (206 + 228 + 188 + 32), toutes converties en `voices/<archive en minuscules>/<index sur 3 chiffres>.mp3` ; durée MP3 = durée WAV. Seuls HELP et PROFESOR ont des octets `sync` (`lenSync` = 0 ailleurs) : ils sont gardés **bruts**, en base64, dans `voices/lipsync.json` = `{"help": {"<index>": "<base64>"}, "profesor": {…}}` (86 Ko). **Structure interne non décodée** : lue seulement comme `u32 142` puis des paires `u16` (valeur, instant croissant) ; les premières entrées de HELP portent un `sync` identique, donc à confronter aux `M*.RES` en vague de rendu du professeur.

## 9. Effets sonores (vérifié)

121 WAV `SX_3xxx.WAV` dans RESOURCE.002 (motif `SX_%04d.WAV`) : 120 en PCM 8 bits mono 11 025 Hz, **1 (`SX_3400`) en 16 bits 22 050 Hz** ; ≈ 88 s au total. Noms lisibles par `SOUND.RES` (22 nommés). Lecture (`wave.ts`, **vérifiée** sur les 121) : blocs `fmt ` de 16 octets puis `data`, taille RIFF = 36 + `data` (**sans octet de bourrage** pour les 60 fichiers à nombre d'octets impair) ; **`SX_3400.WAV` a 470 octets étrangers après le RIFF** (marqueurs `AMKR`, `NITS`… non décodés, ignorés).

## 10. Musique

24 fichiers `SX_1000` à `SX_1023.HMI` (motif `SX_%04d.HMI`, RESOURCE.002), de 3 282 à 33 634 o, 2 à 11 pistes, canaux General MIDI (canal 9 = batterie) (vérifié). 19 titres nommés ; 1008, 1009, 1010, 1022, 1023 sans nom mais utilisés par des puzzles. Lecteur : `src/audio/hmi.ts` (tests `test/audio/hmi.test.ts`), qui produit un `Song` de `smf.ts`. Les 24 morceaux se lisent **jusqu'au dernier octet de chaque piste** (vérifié) ; le format n'a pas de spécification publique complète (WildMIDI `HmiFileFormat.txt` est incomplet), le reste est lu sur les fichiers.
```
0x00  "HMI-MIDISONG061595" (vérifié)          0xD2 u16 192 (480 pour 1023) : rôle inconnu, non utilisé
0xD4  u16 120 = ticks par seconde ET division  0xD6 u16 position d'une table suivante, non utilisée
0xE4  u32 nombre de pistes ; 0xE8 u32 = 0x172 : table des pistes (u32 par piste, dans l'ordre du fichier) (vérifié)
piste : "HMI-MIDITRACK" ; u32 à +0x57 = position des évènements (0xCD ou proche) ; elle finit au début de la suivante
évènement : delta (durée variable standard) + message MIDI avec running status (vérifié)
  9n kk vv <durée variable>   note avec sa DURÉE : pas de Note Off dans le fichier (vérifié)
  Bn, Cn, En…                 comme en MIDI ; contrôleurs courants (RPN 100/101 + 6 pour l'étendue de pitch bend, 7, 64…) (vérifié)
  FF 2F 00                    fin de piste (vérifié)
  FE 10 <2><n><n octets><4>   point de branchement, un par piste, ignoré (taille vérifiée, sens lu)
  FE 14 FF FF                 début de boucle, sur la piste maîtresse (vérifié pour 23 morceaux sur 24)
  FE 15 80 01 <u32>           fin de boucle : renvoie à la position de FE 14 + 2 dans la même piste (vérifié sur les 23 morceaux)
  FE 11, FE 12 <2>            absents des 24 morceaux, taille supposée
```
**Tempo** : lire les évènements avec la durée de la note derrière `0x9n` fait des pistes qui se terminent presque au même tick (9 257 pour 1003 et 1004, 10 339 pour 1000…) et des boucles de 1 000 à 18 000 ticks. À **120 ticks par seconde** (1 s par noire), les morceaux durent de **14,4 s (SX_1022, jingle sans boucle) à 154,6 s (SX_1009)**, les autres de 58 à 147 s : ce sont des boucles musicales (établi par vraisemblance, **non vérifié** contre le binaire ni un enregistrement). Lire `0xD2` comme des battements par minute (192 × 120 / 60 = 384 ticks/s) donnerait des notes de 6 à 9 ticks soit 16 à 23 ms, inaudibles : écarté. L'erreur des estimations d'avant (3 à 30 min) venait du lecteur qui prenait la durée de note pour un delta. Le début de boucle est au tick 0 (ou 1) pour 11 morceaux et plus loin pour 12 (introduction jouée une fois, puis boucle) (vérifié). 1022 ne boucle pas. `DRUM.BNK` / `MELODIC.BNK` (5 404 o chacun) = banques d'instruments AdLib pour le pilote OPL : **inutiles** en GM (lu). Pas de pistes CD sur l'ISO (les pistes citées par les sources externes ne sont pas sur le volume de données, supposé).

## 11. TIM1 (référence, non porté)

L'utilisatrice a aussi fourni `setup-01113-the incredible machine-PCDOSBox.exe` : TIM1 DOS 1.0 sur disquette, anglais (RESOURCE.MAP, `.001` à `.004`, `TIM.EXE` 109 Ko, `TONSOFUN.TIM`, `CATOMATC.TIM`), extrait dans le scratchpad `tim1-setup/app/C`. **Non porté.** Format de ressource différent de TIM3 (variante `RESOURCE.MAP` à entrées `u16`, animations dans l'exe, lu dans ModdingWiki) ; 87 puzzles selon les sources. Référence possible pour la **physique de base** : OpenTIM (réimplémentation fidèle de TIM1, correctifs marqués VANILLAFIX, licence non lue), DOSBox-X installé pour observer l'original. TIM3 ne la reprend pas forcément (supposé).

## 12. Points à vérifier en vague D

1. ~~Taille des enregistrements de pièces `.LEV`, bac, fixes/mobiles, `b4/b5`, `n1/n2`, versions~~ **réglé** (§ 5, aller-retour 206/206). Reste : sens des champs `unknownXX` (poulie, courroie, corde), numérotation des états des conditions, mots 568/378 des fichiers 0x114.
2. **Physique** : sémantique et unités des champs PAR (A, C, D, 0xF0), lois de mouvement et collisions en entiers (exe à désassembler avec `objdump`, pas de Ghidra) ; comparer à OpenTIM.
3. ~~ANM, ITF, `SOLVE.RES`, mode HH~~ **réglé** (§ 4, § 5). Reste : `KEYBOARD.MAP`, mots inconnus des ANM ≥ 1002 et de la commande 8, genres ITF (supposés d'après les noms).
4. **HMI** : lecteur fait (`src/audio/hmi.ts`) ; reste à confirmer le tempo (120 ticks/s) par un enregistrement du jeu original, et le choix du synthétiseur GM (M2 fait).
5. **Synchro labiale** : `M*.RES` et octets `sync` de HELP/PROFESOR.VOC ; absence de `HINT8.VOC`.
6. ~~LZW : passage 9 → 10 bits et remise à zéro non exercés par les données ; RLE jamais rencontré~~ **réglé** : testés sur flux synthétiques (§ 3) ; le RLE est en réalité utilisé par les 7 FNT. Reste : confronter le LZW à un fichier réel qui dépasse 512 codes si un autre jeu Dynamix en fournit.
7. Superposition des `.DAT` sur RESOURCE.001 (priorité : **réglé pour les textes**, § 7 ; fichiers absents du pack : repli sur RESOURCE.001) ; origine de FRENCH.DAT daté de 2007 (pack d'origine ou retouché ?) : comparer si une autre copie existe.
8. ~~Algorithme du hash du map~~ **sans objet** : indexation par nom (§ 2).
9. Durée et poids : voix 42,8 min en PCM 11 kHz (≈ 29 Mo) à convertir comme pour BASS ; ce que le dépôt versionne dépend de D1 (`plan.md`).
