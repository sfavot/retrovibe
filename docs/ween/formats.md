# Ween: The Prophecy : formats des fichiers

Légende : **vérifié** sur les vrais fichiers (installeur extrait dans le scratchpad de l'étude, scripts Python lancés en `-I`, puis, pour les points marqués **vérifié (LiT)**, lecteurs TypeScript de Lost in Time exécutés tels quels sur les données, rien de l'installeur exécuté) ; **lu** dans le code de ScummVM (moteur `gob`, commit 7d2709da du 10/10/2026, GPL v3 ou ultérieure) ; **supposé**.
Les références `fichier.cpp:N` renvoient à `engines/gob/` sauf mention contraire. Scripts d'étude (hors dépôt, scratchpad de l'étude) : `stk.py`, `tot.py`, `media.py`, `snd.py`, `text.py` ; sorties : `stk-list.txt`, `tot-report.txt`, `media-report.txt`, `snd-report.txt`, `text-report.txt`.
Lecteurs : `src/engine/coktel/data/` (module partagé issu de Lost in Time, § 14) ; aucun lecteur propre à Ween n'est nécessaire (vague D, § 16). Tests : `test/ween/data/`.

Jeu : *Ween: The Prophecy* (Coktel Vision, 1992), DOS disquettes, VGA, français, AdLib. Entrée `tables_ween.h:75-86` : `intro.stk`, md5 des 5 000 premiers octets `4b10525a3782aa7ecd9d833b5c1d308b`, 7 029 591 octets, `FR_FRA`, `GUIO_NOSUBTITLES|GUIO_NOSPEECH`, `kFeaturesAdLib`. Le fichier mesure exactement 7 029 591 octets (vérifié).

## 1. Contenu de l'installeur (vérifié)

L'installeur étudié est un paquet « Abandonware France » : le jeu est déjà installé dans `C/Ween/`, avec un DOSBox et son lanceur autour.

| Fichier | Octets | md5 | Rôle |
| --- | --- | --- | --- |
| `C/Ween/INTRO.STK` | 7 029 591 | `3ff06b7834918564f220f669c72de494` | **archive de tout le jeu** (§ 2) ; seul fichier requis |
| `C/Ween/CAT.INF` | 187 080 | `d91155115c045bac3f7f161f38a1a0e5` | sauvegardes livrées (§ 12) |
| `C/Ween/SAVE.INF` | 64 000 | `ea34a10a39c69ffc1a19c50d1f902d75` | sprite temporaire (§ 12) |
| `C/Ween/BLOC.INF` | 600 | `f8dcea394a4208719aabe08fede1fc0d` | bloc-notes (§ 12) |
| `C/Ween/LOADER.EXE` | 87 905 | `95612c6fdbfe353783442f410ff653c2` | lanceur DOS, LZEXE (§ 13) |
| `C/Ween/LVGA.GDR`, `L360.GDR` | 4 844, 3 524 | `2d8b5312…`, `f638643e…` | pilotes graphiques du lanceur (§ 13) |
| `C/Ween/ALL.ASK` | 8 566 | `32d227ca4e9ce67d93a46ec799c0b7ee` | textes du menu de configuration du lanceur (§ 13) |
| `C/Ween/WEEN.BAT` | 31 | `79ee2ad2…` | `loader vga mouse lg_fr` puis `exit` |
| `DOSBox.exe`, `SDL.dll`, `SDL_net.dll`, `libpng13.dll`, `zlib.dll`, `Ween.ICO`, `Ween.bat`, `dosbox-test.conf` | divers | `DOSBox.exe` `33294e0a…`, `Ween.bat` `d6bd8a3c…`, `dosbox-test.conf` `28c30bb2…` | **à écarter** : émulateur et lanceur de l'éditeur du paquet, aucune donnée du jeu |
| `Lisez-Moi.txt` | 2 144 | | **à écarter** : notice d'Abandonware France (UTF-16, renvoi vers leur site et leur FAQ) |

Seul `INTRO.STK` est nécessaire à un portage. Le dossier versionné pourra le garder tel quel (aucune voix à retirer, aucun son externe : le jeu ne tient que sur cette archive).

**Langue** : une seule, le français. Pas de `.ALL`, `.ESP`, `.ITA`, `.USA`, `.ANG`, `.LDE` ; les textes sont des `.DAT` (§ 6). `INTRO.DAT` contient pourtant les cinq langues de la protection de copie (DE, ES, FR, GB, IT).

## 2. `INTRO.STK` (vérifié)

Format STK identique à celui de Lost in Time (`data/archive.ts`) : `u16 LE` nombre d'entrées (**264**), puis des entrées de 22 octets : nom (13 octets, terminé par 0), `u32 LE` taille stockée, `u32 LE` position, `u8` compression. Les données ne sont pas rangées dans l'ordre de la table (ex. `EMAJ1031.TOT`, non compressé, est à la position 6 999 106, en fin de fichier).

**Compression** : 117 entrées à 1 (LZSS, § 3), 147 à 0 (brut), **aucune à 2** (chunks) : la branche « paquets » de `dataio.cpp` n'est jamais atteinte. La taille décompressée est un `u32 LE` en tête du bloc. **117 blocs sur 117 décompressés**, tailles égales à celles annoncées.

| Extension | Entrées | Stocké (o) | Décompressé (o) | Compressées | Contenu |
| --- | --- | --- | --- | --- | --- |
| `.TOT` | 67 | 818 738 | 1 317 084 | 58 | scripts (§ 4) |
| `.EXT` | 57 | 3 075 878 | 3 075 878 | 0 | images, sprites, sons, musiques (§ 5) |
| `.IMD` | 30 | 2 328 950 | 2 328 950 | 0 | animations (§ 7) |
| `.DAT` | 59 | 104 527 | 178 780 | 51 | textes français (§ 6) |
| `.CAT` | 41 | 198 644 | 198 644 | 0 | données d'état (§ 11) |
| `.LET` | 7 | 7 100 | 14 772 | 7 | polices (§ 10) |
| `.IM1` | 1 | 38 086 | 43 780 | 1 | `COMMUN.IM1`, palettes partagées (§ 4) |
| `.EX1` | 1 | 440 103 | 440 103 | 0 | `COMMUN.EX1`, ressources partagées (§ 4) |
| `.INF` | 1 | 25 | 25 | 0 | `INTRO.INF` (§ 10) |

Total 264 entrées. **Absents** : `.CMP`, `.MUS`, `.ADL`, `.MDY`, `.TBR`, `.SND`, `.ITK`, `.VMD`, `.INS`, `.LDE`, `.FRE`, `.ALL` en fichier séparé. Musiques et échantillons sont **dans les `.EXT`** (§ 8, 9).

**Nommage** : 38 `EMAJ10xx.*` (salles, plus `EMAJ1END`), `INTRO`, `INTRO0` à `INTRO5`, effets `*FX` (`BORG1FX`, `DRAGFX`, `FEUFX`, `FIOLFX`, `GAGNEFX`, `GARDEFX`, `PERDUFX`, `PONTFX`, `REVUSSFX`, `VER1FX`…), `SABLE`, `PARTIE`, `JOKER`, `MENU`, `ADL`, `EDIT` (bloc-notes), `REGLAGE`.

## 3. LZSS (vérifié)

Algorithme de `dataio.cpp` (`unpackChunk`) comparé à `data/lzss.ts` : **identique pour tout ce qui sert** : fenêtre 4 096 octets initialisée à 0x20, départ à l'index 4 078, extension `0x1234` / `0x5678` (départ 273, longueur 18, un octet de plus). Aucun bloc au format étendu (magic `0x1234`) dans ce STK.
Écarts purement théoriques : ScummVM n'initialise à 0x20 que les `tmpIndex` premiers octets de la fenêtre (le reste est non initialisé), le TypeScript remplit toute la fenêtre ; le mode 2 (chunks, Geisha `.0OT`) n'est pas géré par le TypeScript et ne sert pas ici.
**Vérifié (LiT)** : `lzss.ts` lancé sous node sur les 117 blocs : md5 identiques au décodeur Python et à une variante « ScummVM stricte » (0 écart).

## 4. TOT v1.2, ressources, `COMMUN.IM1` / `COMMUN.EX1` (vérifié)

**Version** : les 67 TOT sont en **« 1.2 »** (Lost in Time : « 1.3 »). Même en-tête de 128 octets et mêmes offsets : variables (44), textes (48), ressources (52), animations (56), `im` / `ex` / `commun` (59 / 60 / 61), fonctions (100). **Vérifié (LiT)** : `parseTot()` lit les 67 sans erreur. Pas de TOT compressé en chunks.

**Variables** : `variablesCount` = 3 885 pour le jeu (15 540 octets), 287 pour `EDIT`, 101 pour `REGLAGE`. Le nombre du jeu est lu dans `intro.tot` à l'initialisation (`init.cpp:89-220`).

**Textes** : `textsOffset` = 0 pour 57 TOT (textes dans `<nom>.DAT`) ; `0xFFFFFFFF` pour `EDIT`, `REGLAGE` (pas de texte). Huit TOT n'ont pas de `.DAT` : `ADL`, `EMAJ1008`, `EMAJ1010`, `FEUFX`, `FIOLFX`, `JOKER`, `PARTIE`, `PONTFX` (rapport d'anomalies de `tot.py`, sans effet : ils n'impriment aucun texte).

**Table de ressources** : `i16` nombre, `u8`, puis par entrée `i32` offset, `u16` taille, `i16` largeur, `i16` hauteur. La fin de table plus les données embarquées tombe exactement sur la fin du fichier pour les 67 TOT. Offset < 0 : donnée dans `COMMUN.IM1` ; sinon embarquée dans le TOT (blocs de 768 octets = palettes ; exceptions : `EMAJ1004` 15 056 octets, `PONTFX` 22 237 octets, d'images embarquées).
**`im` / `ex`** : `imFileNumber` = `exFileNumber` = 1 pour 60 TOT (donc `COMMUN.IM1` et `COMMUN.EX1`) et 0 pour 7 TOT système (`ADL`, `EDIT`, `INTRO`, `JOKER`, `MENU`, `PARTIE`, `REGLAGE`), qui n'en lisent pas (**vérifié**, vague D). `commun` = 2 (fichier commun partagé) dans les 67.

**`COMMUN.IM1`** (43 780 octets décompressés) : table de `u32 LE` d'offsets (828, 1 596, 2 364, 3 132, …), entrées de 768 octets = palettes (**vérifié**).
**`COMMUN.EX1`** (440 103 octets) : pas de table, données brutes adressées par les `.EXT` (§ 5) ; 1 395 références comptées (**vérifié**).

**Différences avec Lost in Time** (v1.3) : version de la chaîne ; textes en `.DAT` (LiT aussi pour le français) ; palettes dans `im` ; pas de VMD, pas de CMP, pas de chunks. Le désassemblage (opcodes) est traité dans `engine.md`. Décodage : les 67 TOT sont désassemblés par une copie du décodeur de LiT patchée (table v2, opcode gob inconnu sauté) ; **une seule anomalie** (§ 15, `INTRO1.TOT`).

## 5. EXT (vérifié)

Table de 10 octets par entrée (identique à `data/ext.ts` pour le format de base ; `resources.cpp`, section EXT). Offset < 0 : donnée dans `COMMUN.EX1` (position = `-offset - 1`). Bit `0x8000` de la largeur : donnée compressée LZSS (`u32` taille décompressée, puis flux).

**Écart avec `ext.ts`** : l'extension de taille de LiT (bits `0x4000` / `0x2000` / `0x1000` de la largeur, et `height == 0` → `size += width << 16`) est **inutile ici** : aucun de ces bits n'est utilisé. 1 522 entrées ont `height = 0` mais ce sont des non-images (`width = 0` : sons, ADL, tables), donc sans effet ; 227 sont des images (« image-ish »). **Vérifié (LiT)** : `parseExtTable()` ne dépasse aucun fichier sur les 57 EXT. Le format v1.2 est le `u16` de taille simple.

**Contenu** : images (largeur × hauteur, brutes ou compressées), sprites et animations (largeur = hauteur = 0, compressés), échantillons SND (§ 8), et les 6 morceaux AdLib de `ADL.EXT` (§ 9, 39 678 octets, 6 entrées compressées).

## 6. Textes `.DAT` (vérifié)

59 fichiers, **2 434 items non vides** (271 items vides ou trop courts ; 2 385 non vides dans les 57 `.DAT` qui ont un TOT, 4 136 lignes ; `ECOPE.DAT` et `INTRO016.DAT` n'ont aucun TOT et ne sont jamais lus), ~4 100 lignes (segments de commande `02`), ~108 600 caractères. Dump brut dans le scratchpad (`ween-fr-text.txt`).
- **Codage** : CP850 (accents français), avec des caractères de contrôle résiduels de la forme `$` et `` ` `` dans certains textes. Codes de contrôle comptés : 5 (170 fois), 8 (138), 16 (33), 4 (11), 12 (6), 28 (8), 24 (6), 20 (2), 11 (3), 14 (2).
- **Volume** : de 145 octets (`BORG1FX.DAT`) à plusieurs Ko par salle (`EMAJ1000.DAT` 6 533 octets, 87 items).
- **Format d'item** : rectangle (`x`, `y`, `x2`, `y2` en `u16`) et couleur de fond ; liste de rectangles de décor de 9 octets terminée par `0xFFFF` ; 2 octets ; puis des commandes : `02` (`u16 x`, `u16 y`, texte), `03` (couleur `u8`), `01` = fin. Le bit `0x8000` de `x` signale un sous-titre (inutilisé : `GUIO_NOSUBTITLES`).
- **Langue** : `Resources::loadTOTLocTexts` (`resources.cpp:495-545`), suffixe `.DAT` pour le français (`resources.cpp:458-480`) ; `data/tot.ts:182-194` fait déjà `fr` → `.DAT`.
- **`INTRO.DAT`** : cinq langues, choisies par `switch` sur `VAR(16)` (0 = français → texte 2).

## 7. IMD (vérifié)

30 fichiers, 2 328 950 octets : **28 en version 3, 2 en version 2** (`FINAL.IMD`, `WE_17.IMD`). Octet de fonctionnalités brut = 0 pour tous (ScummVM force `|0x408`, d'où `0x408` affiché) ; drapeaux `0x49`. **Aucun son embarqué** dans les IMD. Films de petite taille, positionnés par script dans la scène : de 40×55 (`LAB01`) à 200×158 (`PRES4`), de 11 (`AMOR_`) à 138 images (`CAVE01`). Plus gros : `AUTEL` 222 327 octets, `CAVE01` 134 251, `WE_20` 127 658 ; plus petit : `LAB01` 4 443. **Vérifié (LiT)** : les 30 sont décodés intégralement par `data/imd.ts`.

## 8. SND (vérifié)

274 références à **192 échantillons uniques**, 1 048 944 octets, ~160 s au total, rangés dans les `.EXT` et `COMMUN.EX1`. Format identique à `data/snd.ts` : `u32 BE` taille, `u16 BE` fréquence, données 8 bits non signées, mono. Fréquences de 3 024 à 11 363 Hz (les plus fréquentes : 5 000, 7 714, 6 000, 10 286, 7 919). Octet de drapeaux : 136 pour 170 échantillons, 0 pour 22. **Vérifié (LiT)** : `parseSnd` les décode.

## 9. ADL (vérifié)

Six morceaux AdLib dans `ADL.EXT`, appelés par `ADL.TOT` (ressources 30000-30005), 5 à 23 Ko décompressés ; les salles chargent aussi leurs ADL en slot −19. En-tête type `adlplayer` : `u8` mode, `u8` nombre de timbres − 1, `u8` saut, timbres en `u16`… (6 à 22 timbres). **Vérifié (LiT)** : `parseAdl` du portage les décode. Aucun `.MDY`, `.TBR`, `.MUS`.

## 10. Polices `.LET`, `INTRO.INF` (vérifié, sauf mention)

`INTRO.INF` (25 octets) : `ema2 ema5 ema3 profecy`, la liste des polices à charger à l'initialisation (`init.cpp`). Sept `.LET` dans l'archive : `EMA1` à `EMA6` et `PROFECY` (7 100 octets stockés, 14 772 décompressés, tous compressés). En-tête lu : `u8` largeur, `u8` hauteur, `u8` premier code (0x20), `u8` dernier code (0xE1). **Vérifié** (vague D) : identiques à `data/font.ts` et à `Font` de ScummVM (`video.cpp:45-150`), voir § 15.2.

## 11. `.CAT` (partiellement vérifié)

41 fichiers, 198 644 octets, non compressés : `EMAJxxxx.CAT` (~3,6 Ko chacun), `CAT.CAT` (42 324 octets), `MENU.CAT`, `OBJET1.CAT` à `OBJET4.CAT`, `ECOPE.CAT`… Ce sont des **données lues depuis l'archive** (état initial des salles et des objets, `MENU.CAT`, `OBJET1..4.CAT` par `PARTIE.TOT`, `EMAJxxxx.CAT` par un nom en variable), **pas des sauvegardes** (lu, `gob-ween`). En-tête texte « 1.00 » puis données. Aucun lecteur dans Lost in Time ; le moteur les lit comme des fichiers de données ordinaires (`o2_readData`) donc **aucun décodage n'est nécessaire** au portage : il suffit de servir l'octet brut du STK (**vérifié**, vague D : 41 entrées, aucune compressée, 198 644 octets). Deux en-têtes en tête de fichier : texte « 1.00 » ou chaîne « essai ». Leur structure interne (**supposé** : tables d'objets ou de hotspots par écran) n'est pas décodée.

## 12. Fichiers de sauvegarde (vérifié, lu)

Format de ScummVM `SaveLoad_v2` (`save/saveload_v2.cpp:35-40`, `save/savehandler.cpp`). Les scripts (`MENU.TOT`) lisent et écrivent par `o2_readData` / `o2_writeData` ; le moteur intercepte ces noms :

| Fichier | Handler | Taille livrée | Contenu |
| --- | --- | --- | --- |
| `cat.inf` (alias `cat.cat`) | `GameHandler` | 187 080 | index de 15 × 40 octets (600 octets) à l'offset 0, puis les 15 emplacements |
| `save.inf` | `TempSpriteHandler` | 64 000 | sprite temporaire 320 × 200, 8 bits (= 64 000 exactement) |
| `bloc.inf` | `NotesHandler(600)` | 600 | bloc-notes du joueur : 15 lignes de 40 octets, ASCII sans accents |

Emplacement = `(offset − 600) / varSize`, reste nul exigé ; taille nulle = `varSize`. `varSize` = taille de toutes les variables = 3 885 × 4 = **15 540 octets** (`savehandler.cpp:220-226`). `CAT.CAT` existe aussi **dans l'archive** (42 324 octets) mais ce n'est pas la même chose : l'alias de `cat.cat` ne vise que le fichier de sauvegarde.

**Écart de taille de slot du `CAT.INF` livré** : 187 080 = 600 + 15 × **12 432**, or `varSize` vaut 15 540. 12 432 = 3 108 × 4 : **supposé** que les sauvegardes livrées viennent d'une version de développement à 3 108 variables ; le moteur de ScummVM ne les relirait pas telles quelles. Ce fichier est un **état de développement ou de test livré** : noms résiduels (`mie5`…`mie11`, `cheline`, `CAT.INF`, `BOULE CRISTAL`, `TENAILLES`, `URM`). Ne pas l'importer ; recréer les trois fichiers vides au premier lancement (décision de plan D4 recommandée : menu d'origine, 15 emplacements, sur le stockage du navigateur).
Aucune protection de copie ni clé dans ces fichiers.

## 13. Fichiers inutiles (vérifié)

- **`LOADER.EXE`** (87 905 octets) : exécutable compressé **LZEXE 0.90** (marqueur `LZ09` en 0x1C), Borland C++ 1991. Chaînes lisibles (dump brut, non décompressé) : `LVGA.GDR`, `System_`, `SYSTEM.0`, `NOSOUND`, `BREAK`, `DEBUG`, `LG_GT` (préfixe de langue `lg_xx`), `LEVEL`, `commun.ex1`, `intro.stk` (« …ty.stk »), `_IMD_`, la signature « Fabrice BELLARD ». Ni ScummVM ni le portage ne le lisent.
- **`LVGA.GDR`**, **`L360.GDR`** : pilotes graphiques x86 (table de quatre offsets `u32` puis code `55 8B EC`), VGA 320×200 et une variante 360. Aucune donnée de jeu.
- **`ALL.ASK`** : textes du menu de configuration du lanceur (`@L0`…`@L4` : français, allemand, anglais, espagnol, italien ; `@G` graphique, `@M` souris, `@S` son, `@P` récapitulatif, `@K`), CP437/850 ; choix de son : aucun, haut-parleur, ProAudio, AdLib, SoundBlaster, InterSound. Aucun texte du jeu.
- **`WEEN.BAT`** : `loader vga mouse lg_fr`.

## 14. Compatibilité avec les lecteurs de Lost in Time

| Lecteur (`src/engine/coktel/data/`, ex-`src/games/lost-in-time/data/`) | Compatible | Écart |
| --- | --- | --- |
| `data/archive.ts` (STK) | oui, testé | aucune entrée en compression 2 ; 264 entrées, 7 598 016 octets décompressés |
| `data/lzss.ts` | oui (117/117) | écarts théoriques seulement (§ 3) |
| `data/tot.ts` | oui (67/67) | version « 1.2 » acceptée par `parseTot()` (**vérifié**) ; ressources et langue `.DAT` : même chemin |
| `data/ext.ts` | oui (57/57) | extension de taille de LiT inutilisée, sans effet (§ 5) |
| `data/imd.ts` | oui (30/30) | v2 (2 films) et v3 ; pas de son |
| `data/snd.ts` | oui | 192 échantillons uniques |
| ADL (`parseAdl`, `adl-player.ts`) | oui (6/6) | à écouter contre le banc (`engine.md` § 13) |
| `data/font.ts` | oui, testé | 7 polices à chasse fixe, glyphes identiques à `Font::drawLetterRaw` (§ 15.2) |
| `data/palette.ts`, `sprite.ts`, `surface.ts` | oui | |
| `data/lic.ts` | sans objet | aucun `.LIC` |
| `engine/opcodes.ts` | **non en l'état** | opcode gob 3 et 13 : le décodeur lève « opcode gob inconnu » dans `INTRO`, `INTRO5`, `MENU` ; table gob v2 et saut des inconnus requis (`engine.md` § 2) |
| `engine/saves.ts` | **non** | SaveLoad_v3 (`cat.inf` 30 descriptions, `ima.inf`, `intro.$$$`, `bloc.inf` 2 560) ; v2 à écrire |
| `engine/parts.ts` | sans objet | ITK/PARTIE propres à LiT |

## 15. Points à vérifier

Résultats de la vague D (tests `test/ween/data/`) :

1. **`.CAT` : réglé.** Les 41 `.CAT` sont stockés non compressés dans le STK et lus par `o2_readData` (octets bruts, aucun décodage requis). Rien à écrire côté lecteur ; la structure interne n'est pas décodée.
2. **`.LET` contre `font.ts` : réglé, compatible.** `Font::Font` (`video.cpp:45-64`) est la même logique que `font.ts` : octet 0 = largeur (bit 7 : table de largeurs), 1 = hauteur, 2 et 3 = premier et dernier code, glyphes de `⌈largeur/8⌉ × hauteur` octets, bit fort à gauche. Les sept `.LET` n'ont pas de table de largeurs (chasse fixe) : `EMA1`-`EMA6` 8×8 (1 556 octets), `PROFECY` 12×14 (5 436 octets), plage 0x20-0xE1 (194 glyphes), fichier = en-tête + glyphes exactement. Un test redessine les 7 × 194 glyphes avec une réécriture de `drawLetterRaw` et compare au pixel près. Aucune capture du banc n'a été comparée (non nécessaire : le format est lu, pas supposé).
3. **Bloc @190 d'`INTRO1.TOT` : ni zones ni scenery mal décodées, particularité réelle sans effet.** Le bloc (14 commandes, taille déclarée jusqu'à 1 237) a pour dernière commande un `if` @386 dont le `then` finit en 1 224, suivi du marqueur `0xC0` puis d'un bloc `else` de 12 octets (1 225-1 237 : `stopSound`, `freeSoundSlot`). Ce `else` est le dernier bloc du script : sa fin (1 237) est `scriptEnd` (début de la table de ressources). `Script::seek` (`script.cpp:102-126`, `_totSize = scriptEnd`, ligne 391) refuse `offset >= _totSize`, donc `skipBlock` échoue et la position reste en 1 225 ; le désassembleur du portage reproduit ce comportement, d'où « fin à 1 225 ». Dans ScummVM, le décompte de commandes (`counter == cmdCount`) termine de toute façon le bloc (`setFinished(true)`) et `o1_if` ne lit rien après : le comportement d'exécution est identique, il n'y a **rien à corriger** (ne pas « réparer » `seek`). Le test `tot.test.ts` fixe ces faits ; la sortie du désassembleur pour ce bloc doit rester signalée comme attendue.
4. **`STK21` non requis : confirmé.** Aucune ressource ne vise un autre STK. Les seules citations de `.STK` dans les 264 entrées décompressées sont `DISK2.STK` et `DISK3.STK` dans `MENU.TOT` (@12 840 et @12 881), invite de changement de disquette (variable de nom + sous-routine @6 803 qui appelle `o1_manageDataFile`, 0x4F). Dans ScummVM, ouvrir une archive absente est sans effet (`dataio.cpp:235-265`, `openArchive` renvoie faux) : le portage doit seulement faire de `manageDataFile` un no-op sur un fichier absent.
5. **`CAT.INF` à 12 432 octets par emplacement** (§ 12) : sans conséquence pour le portage, à garder en note.
6. **Position de la rustine VAR(59)** : voir `engine.md` § 11 (offset 729 de ScummVM contre 727 mesuré). Hors vague D.

## 16. État de la vague D

Tests ajoutés (`test/ween/`, ignorés sans `original/ween/INTRO.STK`, 23 tests, helpers dans `test/ween/helpers.ts`) : `archive` (264 entrées, 117 blocs LZSS, tailles déclarées, sha1 de l'ensemble décompressé, citations `.STK`, `.CAT`), `tot` (67 TOT, ressources `COMMUN.IM1`, textes, bloc @190), `ext` (57 EXT, 1 749 entrées dont 1 395 dans `COMMUN.EX1`, 412 compressées, sha1 des données), `imd` (30 films, 1 162 images, sha1 des surfaces finales), `snd` (274 références, 192 échantillons distincts, 1 048 944 octets), `font` (7 polices), `text` (items `.DAT`, chaîne « WEEN, mes forces m'abandonnent, mes », 4 136 lignes, sha1).
Corrections de ce document : `im` / `ex` à 0 pour 7 TOT (§ 4), 2 `.DAT` sans TOT (§ 6), en-tête des `.CAT` (§ 11).
Lecteurs de `src/engine/coktel/data/` : **aucun changement nécessaire** pour Ween ; Lost in Time inchangé. Reste hors périmètre de cette vague : opcodes v2, sauvegardes v2, rustines (§ 14, `engine.md`).
