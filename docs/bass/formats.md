# Beneath a Steel Sky : formats des fichiers

Légende : **vérifié** sur les vrais fichiers (archive extraite dans le scratchpad, scripts Python lancés en `-I`, rien de l'archive exécuté) ; **lu** dans le code de ScummVM (`engines/sky/`, v2026.4.0, GPL v3 ou ultérieure) ; **supposé**.
Les références `fichier.cpp:N` renvoient à `engines/sky/` sauf mention contraire. Scripts d'étude (hors dépôt) : `dnr.py` (index), `bass.py` (lecteur et RNC méthode 1), `allfiles.py` (décompresse tout), `texts.py` (Huffman), `cpt.py` (`sky.cpt`) ; ils serviront de référence aux tests de la vague D. Lecteurs TypeScript de la vague D (partie 1) : `src/games/bass/data/` ; les points marqués **vérifié (TS)** l'ont été par les tests de `test/bass/data/` sur `original/bass/` (version sans voix).

## 1. Contenu de l'archive (vérifié)

`archives/bass/bass-cd-1.2.zip` (66,2 Mo) :

| Fichier | Octets | Rôle |
| --- | --- | --- |
| `sky.dsk` | 72 395 713 | conteneur de tous les fichiers du jeu |
| `sky.dnr` | 40 780 | index (4 + 5 097 × 8 octets) |
| `sky.cpt` | 419 427 | « compacts » (objets du jeu) extraits de l'exécutable d'origine par ScummVM, livrés dans l'archive |
| `readme.txt` | 5 891 | présentation et **licence** de Revolution (à conserver intacte, article 4 : version modifiée signalée) |

**Version** : l'entrée `{5097, 72395713, "CD", 372}` de `detection.cpp:47-58` correspond exactement : **CD v0.0372**, la version finale du CD (vérifié). Toute la suite ne vise que celle-ci : arbres Huffman, offsets des pilotes, rustines des autres versions ignorés.

**Langues** : les huit fichiers de texte de chaque langue sont présents (60600 à 60663, vérifié) : 0 anglais (GB), 1 allemand, **2 français**, 3 anglais (US), 4 suédois, 5 italien, 6 portugais (BR), 7 espagnol (`detection.cpp:129-138`).

## 2. `sky.dnr` et `sky.dsk` (vérifié)

**Index** (`disk.cpp:80-87, 307-320`) : `u32 LE` nombre d'entrées (5 097), puis des entrées de 8 octets, **dans l'ordre des positions et non des identifiants** (vérifié en X ; le moteur cherche linéairement) :

| Octets | Champ |
| --- | --- |
| 0-1 | `u16 LE` identifiant |
| 2-4 | `u24 LE` position ; bit 23 posé : position réelle = `(v & 0x7FFFFF) << 4` (4 361 entrées, toutes alignées sur 16) ; sinon position brute (`disk.cpp:213-226`) |
| 5-7 | `u24 LE` drapeaux : bits 0-21 = taille stockée ; bit 22 = l'en-tête n'est pas recopié devant la sortie décompressée ; bit 23 = fichier non compressé |

Les fichiers sont contigus : la dernière fin vaut la taille de `sky.dsk`. Section d'un fichier = `id >> 11`, rang dans la section = `id & 2047` (`disk.cpp:205`).

**En-tête `DataFileHeader`** (`struc.h:36-49`, 22 octets = 11 `u16 LE`) : `flag` (bit 7 = compressé RNC, bit 2 = 32 couleurs, bits 8-15 = poids fort de la taille décompressée), `s_x`, `s_y`, `s_width`, `s_height`, `s_sp_size` (octets par image), `s_tot_size`, `s_n_sprites`, `s_offset_x`, `s_offset_y` (signés), `s_compressed_size`. Taille décompressée = `((flag & 0xFF00) << 8) | s_tot_size` (`disk.cpp:246`).

**Chargement** (`disk.cpp:181-296`) : lire la taille stockée à la position ; si le bit 23 de l'index est nul et le bit 7 de `flag` posé, décompresser (RNC) les octets qui suivent l'en-tête, puis recopier l'en-tête devant la sortie sauf si le bit 22 est posé ; si la décompression échoue (pas de signature RNC), rendre le fichier tel quel.

Vérification : **5 097 fichiers sur 5 097 chargés**, les **4 764 fichiers RNC** ont leurs deux CRC valides. Cas particuliers reproduits par le lecteur : 26 fichiers ont le bit 7 sans signature RNC (rendus bruts), 4 ont une signature RNC mais le bit 23 « non compressé » (non décompressés par le moteur, à laisser tels quels).

**Vérifié (TS)** (`SkyDisk`, `rnc.ts`, `header.ts`) sur le `sky.dsk` sans voix : **1 606 fichiers sur 1 606 chargés** ; 1 273 flux RNC (CRC d'entrée et de sortie valides, taille égale à celle de l'en-tête), 26 « bit 7 sans signature » et 4 « signature mais non compressé » rendus bruts (mêmes décomptes que le contrôle des 5 097 fichiers : aucun n'est une voix) ; sommes des tailles décompressées par plage **identiques** à celles de `scripts/bass/split_dsk.py` (`charger`) : 0-49 999 : 1 231 fichiers, 23 373 212 octets ; 59 494-59 672 : 159, 9 308 256 ; 60 000-60 069 : 70, 8 400 ; 60 070-60 599 : 82, 4 788 088 ; 60 600-60 663 : 64, 928 795. Pour chaque fichier RNC la taille décompressée de l'en-tête (`decompressedSize`) est exactement la taille rendue par `load` : en-tête de 22 octets recopié compris, ou, pour les 246 entrées au bit 22 posé (en-tête non recopié), le contenu seul. Les 1 606 fichiers se chargent en moins d'une seconde.

| Identifiants | Fichiers | Stocké | Décompressé | Contenu |
| --- | --- | --- | --- | --- |
| 0 à ~30 000 (sections) | 1 231 | 4,96 Mo | 23,4 Mo | décors, sprites, palettes, modules de scripts |
| 50 000 à 55 277 | **3 491** | **59,06 Mo** | 76,7 Mo | **voix** (§ 6) |
| 59 494 à 59 672 | 159 | 4,44 Mo | 9,3 Mo | introduction du CD (images, palettes, voix du narrateur) |
| 60 000 à 60 522 | 152 | 2,98 Mo | 4,8 Mo | grilles, polices, curseurs, panneau, musique, effets |
| 60 600 à 60 663 | 64 | 0,93 Mo | 0,93 Mo | textes (8 langues × 8 sections) |

Total stocké 72,36 Mo, dont **13,30 Mo hors voix**. Le dossier versionné pourra donc garder le même format en retirant les voix (décision D1 du plan).

## 3. RNC (vérifié)

`common/compression/rnc_deco.cpp` (431 lignes) ; seul `unpackM1` est appelé (`disk.cpp:257, 268`) et **les 4 764 fichiers sont en méthode 1**.
En-tête de 18 octets : `"RNC\x01"`, `u32 BE` taille décompressée, `u32 BE` taille compressée, `u16 BE` CRC de la sortie, `u16 BE` CRC de l'entrée, un octet de marge, un octet de nombre de blocs. Puis flux de bits, poids faible d'abord, lu par mots `u16 LE`, deux bits d'en-tête ignorés ; par bloc : trois tables de Huffman (littéraux, distances, longueurs ; 5 bits de nombre de codes, 4 bits par longueur), un compte sur 16 bits, puis alternance de littéraux copiés et de copies (distance, longueur ≥ 2). CRC-16 polynôme `0xA001`.
Piège : après une copie de littéraux, le tampon de bits garde les bits restants du mot courant (lecture non alignée) : les octets littéraux se trouvent **après** le dernier mot chargé, les bits suivants continuent dans ce mot. **Vérifié (TS)** : `rnc1Unpack` (~100 lignes, mots chargés à la demande) décode les 1 273 flux hors voix avec les deux CRC valides ; cas limites repris de ScummVM : 0 bloc = 256, compte 0 = 65 536 ; une table de plus de 16 codes (tableau de 16 octets dans ScummVM) est refusée ; un cas synthétique (littéraux + copie recouvrante) fait partie des tests. Écart : ScummVM rend « pas compressé » sans signature et un code d'erreur négatif sur CRC faux (que `loadFile` ne teste pas) ; le port lève `RncError` pour toute corruption.

## 4. `sky.cpt` (vérifié)

Lu par `SkyCompact::SkyCompact` (`compact.cpp:125-240`), taille imposée `SKY_CPT_SIZE = 419427` (`compact.cpp:33`) :

| Partie (LE) | Valeurs du fichier |
| --- | --- |
| `u16` version | 0 |
| `u16` nombre de listes, `u16` longueurs | 9 listes : 1 046, 272, 353, 412, 487, 608, 257, 198, 2 entrées (3 635 en tout) |
| `u32` taille brute, `u32` taille source + données, `u32` taille des noms + noms | 148 603 mots ; 155 496 mots ; 42 395 octets de noms en chaînes C |
| entrées | par entrée : `u16` taille (0 = vide) puis `u16` type et les mots ; **3 258 compacts**, 377 entrées vides ; types 1 : 846, 2 : 29, 3 : 624, 4 : 1 630, 5 : 101, 6 : 19, 7 : 9 (`compact.h`) |
| alias (« dlincs ») | 76 paires (alias, cible), **dont 53 visent le compact 0 (vide : pointeur nul)** ; les 23 autres désignent un vrai compact (vérifié (TS)) |
| différences v0.0288 | 188 ; ignorées en 0.0372 |
| identifiants à sauvegarder | 854 (`_saveIds`) |
| données de remise à zéro | à partir de l'octet 357 685 (61 742 octets) : état initial v0.0288 et différences par version (303, 331, 348, 365, 368, 372) ; servent à « Recommencer » et à la restauration (`createResetData`, `compact.cpp:465`) |

Identifiant d'un compact = `(liste << 12) | rang`. Un compact est un tableau de mots `u16` ; les champs sont désignés par les décalages de `compactOffsets[]` (`compact.cpp:41-97`) : 55 champs puis 4 « MegaSet » de 14 mots (voir `engine.md` § 2).

**Adressage par les scripts** (vérifié (TS), `compact-fields.ts`) : le « rang » de `compactOffsets[]` est un **décalage en octets de la structure DOS d'origine**, où `getToTableId`, `grafixProgId`, `turnProgId`, `animScratchId` et les identifiants de MegaSet font 4 octets (le second mot, `grafixProgPos`, `turnProgPos`, est absorbé) ; le tableau a une entrée par octet DOS (MK16 = 2 entrées, MK32 = 4, la seconde valant 0). Ordre de `getCompactElem` : compact (114 décalages, `C_MEGA_SET` = 112, `C_GRID_WIDTH` = 114), puis pour chacun des 4 MegaSet 44 décalages et 100 pour sa table de rotation (lue dans le compact désigné par `turnTableId`), soit 114 + 4 × 144 = 690 décalages (`NEXT_MEGA_SET` = 144). Vérifié : `C_ACTION_MODE` (4) = `sync`, `C_SP_COLOR` (90) = `spColor`, `C_ANIM_UP` (122) = `animUpId`, `C_STAND_UP` (138) = `standUpId`, `C_TURN_TABLE` (158) = début de la table de rotation. Un compact complet (Foster, id 3) fait 111 mots.

**Écart avec le fichier de ScummVM** : le `sky.cpt` de l'archive et `dists/engine-data/sky.cpt` ont la même taille mais **diffèrent de 2 octets** (octets 17 142-17 143) : `0x40DF` (`ID_SC31_GUARD_TALK`) dans l'archive, `0x4138` (`ID_SC31_GUARD_TALK2`) dans ScummVM. C'est le bogue 2687 (« Officer Blunt ») que ScummVM corrige aussi au chargement (`compact.cpp:260-270`, `talkTable[158]`) : le lecteur fera de même.

**Contrôle par régénération** (`devtools/skycpt/`, l'équivalent de `create_lure` ; il n'y a pas de `create_sky`) : `COMPACT.TXT` (154 465 lignes) est la source texte complète des compacts, avec `288diff.txt` et `savedata.txt`. L'outil compile (`c++ -std=c++14`, dans le scratchpad, hors de l'arbre source) et s'exécute : **les 357 685 premiers octets produits sont identiques à ceux du `sky.cpt` de l'archive** (en-tête, compacts, alias, différences, identifiants à sauvegarder). Les 61 742 derniers (remise à zéro) ne sont pas régénérables : l'outil demande sept fichiers `RESET.nnn` produits en jouant chaque version avec un ScummVM modifié (`README`, étapes 3 à 9). Conclusion : contrôle à 85,3 %, suffisant ; pas de portage de `skycpt`.

**Vérifié (TS)** (`SkyCpt`) : 9 listes (1 046, 272, 353, 412, 487, 608, 257, 198, 2), **3 258 compacts**, types 1 : 846, 2 : 29, 3 : 624, 4 : 1 630, 5 : 101, 6 : 19, 7 : 9 ; 148 603 mots bruts ; 76 alias ; 188 différences v0.0288 (lues, non appliquées, certaines diffèrent bien des données courantes) ; 854 identifiants à sauvegarder ; données de remise à zéro de **61 742 octets** (l'état initial se construit pour la v0.0372) ; correction d'Officer Blunt à `talkTable[158]` : `0x40DF` → `0x4138`, effective sur le fichier de l'archive (octets 17 142-17 143) et sans effet sur un fichier déjà corrigé. `CPT_TALK_TABLE_LIST` = `0xBC`, qui n'est pas un alias. Écart : `type` et taille d'un alias valent ceux de sa cible (ScummVM stocke 0).

## 5. Textes et sous-titres

- Fichier = `60600 + 8 × langue + section`, section 0 à 7 (`text.cpp:139`) ; **français = 60616 à 60623** (vérifié, non compressés, 12 328, 12 238, 28 991, 24 026, 28 744, 14 796, 2 598, 2 057 octets). Numéro de texte : section = `(n >> 12) & 0xF`, rang = `n & 0xFFF`. La section 7 contient l'interface (panneau de contrôle).
- Format (`text.cpp:115-190`) : `u16` position de la table des tailles, `u16` début du flux ; un `u16` par bloc de 32 lignes (position en quarts d'octet) ; une taille par ligne sur un octet (bit 7 : `(v & 0x7F) << 3`) ; flux Huffman lu par le bit de poids fort, chaîne terminée par 0.
- Arbre : `_huffTree_00372` (`hufftext.cpp:1756-2002`, ~245 nœuds `{gauche, droite, valeur}`, feuille quand les deux fils sont nuls). **Décodage vérifié** : texte 5, anglais « Mind if I look around? », français « Vous permettez que je jette un coup d'oeil? ». Lignes françaises décodées par section : **567, 485, 1 304, 923, 1 141, 532, 121, 121** (vérifié (TS), `text.ts` : nombre de lignes = écart entre les deux `u16` de tête). Numéro de texte 5 de la section 2 (`0x2005`) = « Vous permettez… » ; en anglais « Mind if I look around? ».
- **Accents** (vérifié (TS), `charset.ts`) : la police 60150 n'a pas de glyphes accentués aux codes habituels, les textes détournent des caractères ASCII. Table établie en dessinant les glyphes (`SkyFont.ascii`) et confirmée par des mots (texte 0x2005 « Vous permettez que je jette un coup d'oeil? » ; section 0 : « Temp+rature », « =tre s>r », « /a sert », « ^a SUFFIT », « O\x92 SUIS-JE? ») :

| Code | Glyphe | Code | Glyphe | Code | Glyphe |
| --- | --- | --- | --- | --- | --- |
| `+` (0x2B) | é | `[` (0x5B) | â | 0x80 | `<` (flèche) |
| `/` (0x2F) | ç | `]` (0x5D) | è | 0x81 | `>` (flèche) |
| `=` (0x3D) | ê | `^` (0x5E) | Ç | 0x82 | `/` |
| `>` (0x3E) | û | `` ` `` (0x60) | ‘ (fermé par `'`) | 0x91 | à |
| `@` (0x40) | ô | `{` (0x7B) | ï | 0x92 | Ù |

  Les 125 glyphes de 60150 couvrent 0x20 à 0x9C. Les codes utilisés par les 5 194 lignes françaises : 0x20 à 0x7B, 0x80 à 0x82, 0x91, 0x92 et la tabulation (9, qui termine des textes anglais laissés dans les fichiers ; `displayText` s'arrête au premier code < 0x20) : tous ont un glyphe non vide (0x20 : espace) et une traduction. Les autres langues détournent d'autres codes (`#` = ü en allemand) : table non faite, hors portage. Pas de « œ » ni de « « » » dans le français (« oeil », guillemets droits).
- Rustines de ScummVM : `Text::patchMessage` (`text.cpp:524-536`) remplace quelques libellés par langue (italien 3, suédois 4, allemand 1, français 1) : tables générées (`tables/text-patches.ts`) et reprises ; en français le texte 28 686 patché est identique à celui du fichier (aucun effet visible).
- Polices (`text.cpp:41-60`) : 60150 (principale, 6 128 octets, hauteur 12), 60520 (panneau), 60521 (liens, codes ≥ 0x80 remplacés par l'espace) ; format (vérifié (TS), `font.ts` : 60150 = 125 glyphes de 12 lignes) : 128 octets de largeurs (code − 0x20), puis par caractère et par ligne un `u16 BE` de pixels et un `u16 BE` de masque (≤ 16 px), contour en couleur 240 (`makeGameCharacter`, `:414-449`).
- `ibasstext.cpp` : aides du remake iOS, sans objet.

## 6. Voix et effets sonores

**Voix** (vérifié) :
- Fichier = `50000 + table[section] + rang`, table `0, 600, 1100, 2430, 3380, 4530, 5080, 5230` (`sound.cpp:60-68, 1225-1256`). **Aucun paramètre de langue** : une seule piste, l'anglaise (le readme parle de la version « CD talkie » anglaise ; à confirmer à l'écoute en vague X). Fichier absent : le sous-titre s'affiche quand même (§ 7 d'`engine.md`).
- Format : en-tête `DataFileHeader` de 22 octets (`flag = 0x81`, le reste en remplissage) + **PCM 8 bits non signé, mono, 11 025 Hz**, compressé RNC dans `sky.dsk`. La plus longue fait 59 770 octets.
- **3 491 fichiers, 6 953 s (1 h 56 min)**, moyenne 2 s ; ~5 230 numéros de texte possibles : environ 1 700 répliques n'ont pas de voix (le readme le signale : « several lines of dialog in the game are missing voices »).
- MP3 à 24 kb/s : 6 953 s × 3 Ko/s ≈ **20,9 Mo**, plus ~1 Mo d'en-têtes et de trames de remplissage pour 3 491 petits fichiers (supposé, mesuré en vague X). L'introduction du CD a ses propres voix dans 59 494-59 672 : elles restent dans `sky.dsk` (format d'origine).

**Effets** (lu, offsets vérifiés sur 60203) :
- Un fichier par section : `60203 + 4 × section`, sections 0 à 6 (37 334 à 216 982 octets, ~1 Mo en tout) : code x86 du pilote d'origine + tables + PCM. Le moteur vérifie des octets de code à `0x7E` (`0x3C`, `0x8D 0x1E`, `0x8D 0x36`), lit le nombre de sons à `0x7F` (2, 26, 26, 26, 29, 27, 26 : 162 au plus), la table des fréquences à `LE16(0x7E + 0x29)`, la table des sons à `LE16(0x7E + 0x31)` (`sound.cpp:1037-1130`).
- Par son, **en big-endian** : fréquence `BE16(taux + 4n)` plafonnée à 11 025 ; position `BE16(info + 8n) << 4` + base ; taille `BE16(info + 8n + 2)` ; boucle `BE16(info + 8n + 6)` = nombre d'octets de fin rejoués en boucle. PCM 8 bits non signé, mono.
- **Vérifié (TS)** (`sfx-file.ts`) : signatures contrôlées sur les 7 fichiers ; sons 2, 26, 26, 26, 29, 27, 26 ; tous les PCM tiennent dans le fichier (max 65 370 octets) ; taux lus 128, 256, 4 189, 10 426, 11 025 (plafond 11 025 jamais atteint par excès ; **taux 128 et 256 présents, à écouter en vague X**). Boucle ≤ taille. ScummVM accepte `son == soundsTotal` (hors table) : refusé ici (`sample(n)` pour `n < soundsTotal`).
- **Voix, vérifié (TS)** (`speech.ts`) : le numéro de texte vaut `section << 12 | rang` ; la table de conversion est `SPEECH_SECTION_BASE` (`ids.ts`) ; section 8 à 15 : pas de voix (ScummVM lirait hors table). Les 3 491 MP3 de `original/bass/voices` retombent tous sur leur section et leur rang.
- Table de volume par pièce et de départ différé : `musicList[]` de `sound.cpp` (~393 entrées, lignes ~72-990) : **une table écrite dans le code de ScummVM**, pas dans les données ; à générer par script depuis la source (vague D).

## 7. Musique AdLib

- Un fichier par section, `60202 + 4 × section` (`adlibmusic.cpp:37`, `FILES_PER_SECTION = 4`) : 21 382, 11 212, 18 282, 23 751, 48 505, 26 259, 14 446 octets (~164 Ko, vérifié). Ce sont **le pilote DOS d'origine et ses données** : ScummVM lit des tables à des positions fixes pour la v0.0372 (`adlibchannel.cpp:50-56`, `adlibmusic.cpp:68-70`).

| Donnée | Position |
| --- | --- |
| début des données musicales | `LE16 @0x1201` (= `0x1207` dans les 7 fichiers, vérifié) |
| séquence d'initialisation OPL (paires registre, valeur ; fin `00 00`) | `@0xE91` |
| instruments | `LE16 @0x1205` : table note → instrument (0x80 octets) puis instruments de 16 octets |
| fréquences (`u16`, 0x300 entrées) | `@0x7FE` |
| registres des opérateurs par voix | `@0xDFE` |
| niveaux de sortie (0x81 entrées) | `@0xE10` |
| miroir des registres (256 octets) | `@0xF5F` |

- Données : nombre de morceaux, puis positions ; morceau = `tempo0`, `tempo1`, nombre de canaux (7 à 10), positions des canaux. **31 morceaux** (2, 4, 4, 3, 11, 6, 1 par section, vérifié). Code des canaux et minuterie : `engine.md` § 8.
- **Vérifié (TS)** (`music-file.ts`) : les 7 fichiers se lisent ; morceaux 2, 4, 4, 3, 11, 6, 1 (31) ; table des morceaux à `musicDataLoc + LE16(musicDataLoc + 1)` (`u16` par morceau, relatifs à `musicDataLoc`) ; 7 à 10 canaux par morceau ; les 31 × ~9 flux se parcourent sans opcode inconnu jusqu'à `0x91` (arrêt) ou `0x98` (boucle) ; séquences d'initialisation : 102 paires, fin `00 00` ; instrument = 16 octets (`InstrumentStruct`). Opcodes à argument d'un octet : `0x90`, `0x92`, `0x93`, `0x95`, `0x96`, `0x97` ; sans argument : `0x91`, `0x98`, `0x99`, `0x9C`, `0x80-0x8F`, `0xFF`. Les 13 morceaux de la liste « sans boucle » (`musicbase.cpp:106-118`, qui ne sert qu'aux pistes numériques) n'ont aucun `0x98` ; seuls deux autres morceaux n'en ont pas non plus (section 0 morceau 2, section 4 morceau 7) : la boucle du pilote AdLib vient des flux, pas de la liste.
- Les autres fichiers de section : `60200 + 4s` pilote General MIDI / MT-32 (non utilisé), `60201 + 4s` non lu par ScummVM.

## 8. Images

- **Palettes** : 768 octets, 256 × RGB en VGA 6 bits ; 240 couleurs de jeu (`GAME_COLORS`), les 16 dernières pour l'interface (`screen.cpp:342`, `screen.h:49`). **Vérifié (TS)** : `convertPalette` convertit les 256 couleurs par `(v << 2) + (v >> 4)` (octet) ; la palette 60510 du panneau fait bien 768 octets de composantes ≤ 63 (`palette.ts`).
- **Décors** : 81 fichiers de 61 440 octets (320 × 192, 8 bits), sans en-tête ; la palette est un fichier séparé. L'introduction utilise des images 320 × 200 (64 000 octets).
- **Sprites** : `DataFileHeader` + `s_n_sprites` images de `s_width × s_height` (vérifié sur l'identifiant 12 : 32 × 56, 50 images, décalage (−16, −48)) ; 967 fichiers, ~17 Mo décompressés. Codage des pixels (0 transparent, variante 32 couleurs) : lu dans `screen.cpp`, à vérifier en vague D (partie 2).
- **Séquences** (« flirt », introduction et scènes plein écran) : images compressées par différence (`screen.cpp`, `startSequence`) ; à décrire en vague D.
- **Grilles de collision** : 60000 à 60069 (70 grilles), 120 octets = **40 × 24 bits**, un bit par bloc de 8 × 8 pixels ; table écran → grille `grid.cpp:32`. **Vérifié (TS)** (`grid-file.ts`) : la case de rang `k = ligne × 40 + colonne` est dans le mot de 32 bits petit-boutiste `k >> 5`, au bit `31 - (k & 31)` (première case en poids fort ; octet = `bit >> 3`, masque `1 << (bit & 7)`, `bit = (k & ~31) + 31 - (k & 31)`) ; les lignes de 40 cases ne sont pas alignées sur les mots. Les 70 fichiers existent et font 120 octets ; la table écran → grille (97 entrées) est reprise dans `GRID_CONVERT_TABLE`.
- **Curseurs** 60300-60302 ; **panneau de contrôle** 60500-60510 (palette 60510).

## 9. Points à vérifier en vague D

1. Tous les fichiers lus jusqu'au dernier octet par les lecteurs TypeScript, sorties identiques au décodeur d'étude (sommes par plage).
2. Toutes les lignes des huit sections françaises décodées ; table code → Unicode complète (chaque code utilisé a un glyphe dans 60150).
3. Format des sprites et des séquences (différences) confirmé sur échantillons et au banc.
4. Tables des pilotes de musique et d'effets aux positions de la v0.0372, signatures contrôlées.
5. `musicList` et les tables propres à ScummVM (arbre Huffman, `_speechConvertTable`, rustines) générées depuis la source par un script, avec leur provenance : **fait** (§ 11).

## 10. État de la vague D (partie 1)

Code : `src/games/bass/data/` ; tests : `test/bass/data/` (45 tests, ~0,6 s ; ceux qui lisent `original/bass/` sont ignorés si les fichiers manquent).

| Module | Contenu | Points 1 à 5 du § 9 |
| --- | --- | --- |
| `rnc.ts`, `header.ts`, `disk.ts` | RNC méthode 1 (deux CRC), `DataFileHeader`, `SkyDisk` (`has`, `load`, `entry`, `declaredSize`) | point 1 fait pour `sky.dsk` sans voix : 1 606 fichiers sur 1 606, sommes par plage égales à `split_dsk.py` |
| `cpt.ts`, `compact-fields.ts` | `SkyCpt` (compacts, alias, différences v0.0288, identifiants à sauvegarder, remise à zéro, correction d'Officer Blunt) ; indices de mot et adressage des scripts | fait |
| `palette.ts`, `grid-file.ts`, `ids.ts` | palette VGA → RVB, grilles et table écran → grille, identifiants de fichiers | fait |

Reste en vague D : textes (Huffman, accents), polices, sprites et séquences (format des pixels, différences), pilotes de musique et d'effets (signatures), tables générées de ScummVM (`musicList`, arbre Huffman, rustines) : points 2 à 5 du § 9. La première décompression des voix (3 491 fichiers retirés de `sky.dsk`) n'est plus à faire côté lecteur : elles sont versionnées en MP3.

**Sprites et séquences (vague R, partie 1)** : `sprite.ts` et `sequence.ts` ; formats confirmés sur fichiers réels (24 séquences de l'introduction décodées sans reste, 948 fichiers de sprites cohérents, pas de variante 32 couleurs) et décor de jeu **par blocs de 16 x 8** : voir `graphics.md`.

**Partie 3 (musique, effets, voix)** : `music-file.ts` (`MusicFile`, `scanChannel`, `isNonLoopingSong`), `sfx-file.ts` (`SfxFile`), `speech.ts` (numéro de texte → `voices/<id>.mp3`) ; tests `test/bass/data/music-sfx-speech.test.ts` (11 tests, points 4 du § 9 faits pour la lecture ; les pilotes eux-mêmes sont en vague A).

## 11. État de la vague D (partie 2 : textes, polices, tables)

Points 2 et 5 du § 9 faits. Tests : `test/bass/data/{text,font,text-layout}.test.ts`.

| Module | Contenu |
| --- | --- |
| `scripts/bass/gen-tables.py` | `python3 -I scripts/bass/gen-tables.py <scummvm>/engines/sky src/games/bass/data/tables` : analyse stricte (échoue si la forme d'une table change) ; produit `huffman-372.ts`, `speech-convert.ts`, `sfx-list.ts`, `script-var-names.ts`, `mcode-names.ts`, `text-patches.ts` |
| `tables/*.ts` | générés, ne pas modifier. Arbre : triplets `gauche, droite, valeur`. `sfx-list.ts` : `SFX_DEFS` (définitions distinctes `[son, drapeaux, pièce, volume AdLib, volume Roland…]`) et `MUSIC_LIST` (139 indices, effet `256 + i`, l'entrée 138 sert l'effet 394). 115 mcodes dans l'ordre de `setupMcodeTable`. **837 noms de variables** pour 838 variables : `debug.cpp` ne nomme pas la dernière |
| `text.ts` | `SkyTexts.getText` (`Text::getText`, rustine appliquée), `decodeSectionLine`, `sectionLineCount` |
| `font.ts`, `charset.ts` | `SkyFont` (largeurs, `draw` = `makeGameCharacter`, `ascii`), table des accents, `toUnicode` |
| `text-layout.ts` | `layoutText` (coupure, largeurs d'alignement, 10 lignes), `renderText` (sprite de texte avec en-tête de 22 octets), `changeTextSpriteColor`. Non repris : contournements allemand et espagnol de `displayText` (hors français), Big5, texte de droite à gauche |

Vérifié : les 5 194 lignes françaises décodent sans erreur ; toutes les lignes des sections 2 à 5 se mettent en page en 128 pixels sans dépasser 10 lignes.
