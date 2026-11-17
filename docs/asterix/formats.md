# Astérix : le défi de César : formats de fichiers

Référence des formats du CD DOS français (`ASTERIX.EXE` « Version 2.5 », 30/05/1995) et des fichiers versionnés dans `original/asterix/`, produits par `scripts/asterix-extract.sh` (inventaire : `files.md`).

Niveaux de confiance :
- **[vérifié]** : mesuré sur tous les fichiers du CD, ou recoupé par deux décodeurs indépendants ;
- **[lu]** : lu dans le désassemblage de `ASTERIX.EXE` (Ghidra, adresses `segment:offset`), sans autre recoupement ;
- **[supposé]** : déduit des données, à confirmer par le désassemblage (vague C).

Tout est little-endian. Les images font toujours 320 × 200 en 8 bits indexés (64 000 pixels, ligne par ligne). Une palette fait 768 octets : 256 triplets RVB sur 8 bits.

## Vue d'ensemble

| Origine | Nb | Rôle | Versionné | Lecteur |
|---|---:|---|---|---|
| `.MUX` | 117 | vidéos et calques animés, avec son | `.MUX.vid` + `.MUX.mp3` | `src/games/asterix/data/video.ts` |
| `.MUK` | 31 | animations sans son | `.MUK.vid` | `video.ts` (structure d'origine : `muk.ts`) |
| `.VOC` | 736 | voix, musiques, bruitages | `.VOC.mp3` + `audio.json` | `audio-index.ts` |
| `.MCG` | 106 | images brutes | tel quel | moteur commun (`src/engine/infogrames/`) |
| `.MCC` | 80 | images compressées par séries | tel quel | `mcc.ts` |
| `.HY8` | 30 | banques de sprites | tel quel | moteur commun |
| `.PFN` | 4 | polices | tel quel | moteur commun |
| `.PAL` | 1 | palette | tel quel | moteur commun |
| `M40*.TXT` | 9 | questions du quiz | tel quel | `quiz.ts` |
| `M47.DAT` | 1 | générique | tel quel | `credits.ts` |
| `ASTERIX.EXE` | 1 | tables du jeu | tel quel | vague C |

Les fichiers sont rangés par module : `MDF/NN/` (53 dossiers, de `01` à `63`). Un fichier converti garde son nom d'origine complet, suivi de `.vid` ou `.mp3` : `MDF/06/M06AB.MUX` donne `M06AB.MUX.vid` et `M06AB.MUX.mp3`, sans collision avec `M06AB.VOC.mp3`.

Les formats MUX, MCG, HY8, PFN et VOC sont ceux du Téléportaschtroumpf, dont l'exécutable descend de celui d'Astérix (même code machine pour le décodeur vidéo, les sprites, la police, le chargeur d'images et le pilote son). Leur description détaillée est dans `docs/teleportaschtroumpf/` (`mux.md`, `hy8.md`, `pfn.md`) ; ce document donne ce qui est propre à Astérix.

## Formats d'origine

### MUX : vidéo avec son

Décodeur d'image : segment `2b17` (routine de bloc `2b17:0119`), identique à 100 % au `357c` de `SMURF.EXE`. Lecteur de fichier : `1948:04cc` (87 % de `179a:0673`) ; enveloppes `15d7:07f7`, `15d7:08e9`.

**En-tête et table** [vérifié, 117/117] : signature `07 AA 00 00`, taille d'en-tête `0x1800`, nombre d'entrées, deux champs nuls, diviseur du PIT en `0x0C`, fréquence audio en `0x0E`, tailles de tampons, largeur et hauteur (320 × 200) en `0x1C`, puis la table d'offsets à partir de `0x20` (2 bits de poids fort = drapeaux). Seul le premier offset sert : les blocs se suivent.

**Blocs** `u8 type, u8 0, u32 taille, données` [vérifié] :

| Type | Nb | Rôle |
|---|---:|---|
| `07` / `06` | 116 / 4 588 | son, PCM 8 bits non signé mono (`07` = premier bloc) |
| `70` | 119 | palette, 768 octets |
| `6F` | 18 369 | image (voir le bloc vidéo de `docs/teleportaschtroumpf/mux.md`) |
| `08` | 202 | marqueur de 1 ou 2 octets ASCII |
| `05` | 18 597 | fin d'image ; charge utile u16 = numéro de l'image |
| `04` | 117 | fin de fichier |

Les types `64` et `65` du Téléportaschtroumpf n'apparaissent pas.

**Images** [vérifié] : 18 453 images. Drapeaux des blocs vidéo : `0` (10), `2` (7 923), `4` (5 089), `6` (5 347) ; jamais `1` ni `8`. Une image peut ne pas avoir de bloc vidéo (84 images dans 58 fichiers, dont 27 dans `44/M44AB.MUX`) : l'image précédente reste. 57 fichiers commencent par un bloc marqué « inter » (drapeau 2), mais ce premier bloc écrit quand même les 64 000 pixels dans les 117 fichiers.

**Cadence** [vérifié pour le calcul, lu pour le « 12 » dans `docs/teleportaschtroumpf/mux.md`] : images par seconde = 1 193 182 / diviseur / 12.

| Diviseur | Images/s | Fichiers |
|---:|---:|---:|
| 7 648 | 13 | 27 |
| 8 285 | 12 | 39 |
| 9 039 | 11 | 28 |
| 9 943 | 10 | 12 |
| 11 047 | 9 | 3 |
| 12 428 | 8 | 5 |
| 14 204 | 7 | 1 |
| 16 571 | 6 | 1 |
| 24 857 | 4 | 1 |

**Son** [vérifié] : 18 867 Hz (91 fichiers), 19 230 Hz (23), 19 607 Hz (1), 11 111 Hz (1), aucun (`23/M23AA.MUX`). Un bloc de son toutes les 4 images, partout sauf `36/M36A.MUX`.

**Marqueurs `08`** [vérifié pour le contenu, supposé pour le rôle] : 202 dans 17 fichiers (`06/M06AC`, `07/M07A`, `26/M26AA`, `27/M27AA` à `AF`, `30/M30A`, `34/M34AA` à `AF`, `36/M36A`). Valeurs : `1` (73), `2` (67), `3` (27), `-1` (14), `4` (8), `5` (7), `8` (2), `6`, `7`, `9`, `10` (1 chacun). Rôle supposé : repères pour le code (boucles, attentes), rangés par le lecteur à chaque image ; à établir en vague C.

**Composition** [supposé] : beaucoup de MUX sont des calques (fond magenta ou noir, personnage qui parle, pion). Le lecteur des Schtroumpfs sait décoder une vidéo « en surimpression », chaque image sur un fond restauré (`179a:0673` avec `0x1000`) ; l'usage qu'en fait `1948:04cc` reste à lire. Le conteneur garde ce qu'il faut pour les deux cas (masque des pixels écrits).

### MUK : animation sans son

Lecteur d'un enregistrement : `19b9:000c` [lu]. Lecture d'un fichier entier : `19b9:019f` (`m34ag.muk`, appelée par `1f31:0294`) ; autres appelants de `19b9:000c` : `23d1:05fb`, `23d1:09c1`.

Pas d'en-tête : une suite d'enregistrements, chacun commençant par un octet de type [lu, puis vérifié sur 31/31 fichiers lus jusqu'au dernier octet].

| Type | Suite | Effet |
|---|---|---|
| 0 | u16 | valeur rangée en `DS:6425` [lu] ; **absent des 31 fichiers** ; rôle inconnu |
| 1 | 768 octets | palette, appliquée aussitôt (`15b0:0233`) |
| 2 | u32 taille, u32 champ, puis `taille` octets | bloc vidéo MUX (en-tête de 13 octets compris), décodé par `2b17:0119` |

- Le second champ du type 2 est lu puis ignoré par `19b9:000c` [lu]. Il vaut toujours la taille du flux « bits » du bloc vidéo (octets 5 à 8 de son en-tête) [vérifié, 530/530].
- Le bloc est décodé sur l'écran courant, ou sur un second tampon suivi d'un rappel si l'appelant en donne un [lu].
- `26/M26D?00n.MUK` (30 fichiers) : 16 images, chacune précédée de sa palette ; la première écrit toute l'image, les suivantes sont des différences. Associés aux images `M26D?00n.MCG` [supposé].
- `34/M34AG.MUK` : 50 images sans palette, toutes partielles, **y compris la première** : c'est le seul fichier du jeu dont la première image dépend de ce qui est déjà à l'écran [vérifié].

### VOC : son

Creative Voice 1.10 [vérifié, 736/736] : en-tête de 26 octets, **un seul bloc de type 1** (PCM 8 bits non signé, mono, codec 0), puis le terminateur (un octet nul) et rien d'autre. Fréquence = `round(1 000 000 / (256 − constante de temps))` : 19 231 Hz (731 fichiers), 18 868 Hz (4), 11 111 Hz (1). Durée totale : 57 min 22 s.

Familles de noms : `K??TE??` (579 voix), `M??M*` (musiques en boucle), `B??_??` et `M??B*` (bruitages et répliques courtes). Chemin des voix construit par `135a:0007` : `md%c\%s\K%sTE%s.voc` (la lettre de langue choisit le dossier `MD?` ; seul `MDF` existe) [lu]. Lecture : `MyNoise()` `16cb:08c9`.

### MCG : image brute

Chargeur `1481:0089`, affichage `1481:0155` (identiques à `13fc:0084` et `13fc:0150` de `SMURF.EXE`). 64 770 octets : 2 octets nuls, palette, 64 000 pixels [vérifié, 106/106]. Les composantes de palette vont de 0 à 255 et ne sont pas toutes multiples de 4 [vérifié].

### MCC : image compressée par séries

Chargeur : `1481:01ff` [lu, puis vérifié sur 80/80] ; il sert aussi à `1481:027d`.

Palette de 768 octets, puis des paires `(u8 couleur, u8 longueur)` jusqu'à 64 000 pixels. Le chargeur lit une paire, écrit `longueur` pixels en s'arrêtant à 64 000, et recommence tant que l'image n'est pas pleine.

Cas limites :
- **longueur nulle** : n'écrit rien [lu] ; absente des 80 fichiers [vérifié] ;
- **`49/M49DA005.MCC` déborde** : ses séries totalisent 64 014 pixels ; la dernière est coupée à la fin de l'image (14 pixels perdus), le fichier est lu jusqu'au dernier octet [vérifié] ;
- **aplats** : `52/M52B0.MCC`, `M52C0.MCC` et `M52F0.MCC` font 1 280 octets (palette + 256 séries d'une seule couleur) ; `34/M34DA000.MCC` en fait 1 632 (3 couleurs) [vérifié] ;
- le magenta `FF00FF` sert de couleur transparente sur certaines images [supposé pour l'usage].

Lecteur : `parseMcc` rend la palette, les pixels et le débordement ; il refuse des séries trop courtes ou des octets après la fin de l'image.

### HY8, PFN, PAL

- **HY8** (30 fichiers) : format de `docs/teleportaschtroumpf/hy8.md` ; dessin `2b57:01d2`, sprite composé `2bdb:0477` (100 % identiques). En-tête de six u32, le premier valant `0x18` et le dernier la taille du fichier [vérifié, 30/30]. `32/M32SA000.HY8` (sprite 60) utilise une **partie de type 5** que le lecteur des Schtroumpfs ne gère pas encore ; le code qui la traite est dans la table de sauts de `2bdb:0477` [lu, à porter dans le moteur commun].
- **PFN** (4 fichiers) : format de `docs/teleportaschtroumpf/pfn.md`, segment `2cd0`. `M52D0` et `M52D3` : hauteur 12, 253 glyphes à partir du code 1 ; `M52D1` et `M52D2` : hauteur 10, 223 glyphes à partir de `0x20` [vérifié par le lecteur des Schtroumpfs pendant l'étude].
- **PAL** : `27/M27S.PAL`, une palette de 768 octets [vérifié].

### Quiz : `MDF/40/M40*.TXT`

Neuf fichiers, un par pays : `EGYPT`, `GAULE`, `GBRET`, `GERMA`, `GRECE`, `IBERE`, `MEPAL`, `NORMD`, `ROMAN`. Texte **CP850**, lignes terminées par CR LF, deux lignes par question [vérifié, 9/9] :

```
NNXquestion
NN réponse1,réponse2,réponse3/B
```

- `NN` : numéro sur deux chiffres, de `01` à `99` (99 questions par fichier, 891 au total) ;
- `X` : niveau, `F`, `M` ou `D` (270, 360 et 261 questions) : facile, moyen, difficile [supposé pour le sens, qui recoupe le réglage « réflexion »] ;
- trois réponses séparées par des virgules, puis `/` et le numéro de la bonne (1 à 3 : 328, 284, 279) ;
- le texte est en minuscules accentuées ; aucune réponse ne contient de virgule ;
- 5 fichiers finissent par l'octet de fin de fichier DOS `0x1A`, 4 non ; une ligne de `M40ROMAN.TXT` (question 85) a une espace après le numéro de la bonne réponse.

La routine qui lit ces fichiers n'a pas été cherchée dans l'exécutable : le tirage des questions et l'usage du niveau sont à établir en vague C.

### Générique : `MDF/47/M47.DAT`

Texte CP850, CR LF, 126 lignes [vérifié]. Une ligne peut commencer par une balise : `@1` (26 lignes, les titres : « Conception », « Réalisation »…), `@2` et `@3` (une fois chacune, seules sur leur ligne, lignes 100 et 111). Les lignes vides espacent les blocs. Sens des balises [supposé] : `@1` change la présentation de la ligne, `@2` et `@3` commandent le défilement ; à lire dans le module 47.

## Fichiers convertis

### Son : `.mp3` et `audio.json`

Les VOC et le son des MUX sont encodés en **MP3 mono 22 050 Hz, 32 kb/s CBR** (`ec_encoder_voix`), à partir du PCM d'origine. Un MP3 ne redonne pas la durée à l'échantillon près, et le moteur attend la fin des sons : `audio.json` la conserve.

```json
{"MDF/01/B01_01B.VOC.mp3": [5000, 19231], "MDF/06/M06AAA.MUX.mp3": [550916, 18867]}
```

Clé : chemin du MP3 ; valeur : `[échantillons, fréquence en Hz]` du PCM d'origine. Durée exacte = échantillons / fréquence. Pour un VOC, la fréquence est celle que calcule le lecteur VOC du moteur (arrondie) ; pour un MUX, celle de son en-tête. 852 entrées (736 VOC, 116 MUX).

### Vidéo : conteneur `.vid`

Écrit par `scripts/asterix/video.py`, lu par `src/games/asterix/data/video.ts`. Un fichier `.vid` est un flux **LZMA « alone »** (`lzma.FORMAT_ALONE` de Python : 13 octets d'en-tête, taille inconnue, marqueur de fin ; `lc = 3`, `lp = 0`, `pb = 2`, dictionnaire de 8 Mio au plus, ramené à la puissance de deux qui couvre le fichier). Décodeur : `src/data/lzma.ts`.

Contenu décompressé :

| Offset | Type | Champ |
|---:|---|---|
| 0 | 4 octets | `"AVID"` |
| 4 | u16 | version (1) |
| 6 | u8 | origine : 0 = MUX, 1 = MUK |
| 7 | u8 | 0 |
| 8, 10 | u16 × 2 | largeur, hauteur |
| 12 | u16 | diviseur du PIT (0 pour un MUK) |
| 14 | u16 | fréquence audio en Hz (0 = muet) |
| 16 | u32 | nombre d'échantillons audio (ceux du `.mp3` voisin) |
| 20 | u32 | nombre d'images |

Puis, pour chaque image : `u8 drapeaux, u16 numéro, u32 échantillons audio lus avant la fin de l'image`, et selon les drapeaux, dans cet ordre :

| Drapeau | Données | Sens |
|---|---|---|
| `0x01` | 768 octets | palette (la dernière lue avant la fin de l'image) |
| `0x10` | u8 nombre, puis u8 longueur + octets | marqueurs `08` du MUX |
| `0x20` | u8 nombre, puis u16 | valeurs des enregistrements de type 0 d'un MUK |
| `0x40` | u32 | second champ de l'enregistrement vidéo d'un MUK |
| `0x08` | — | l'image avait un bloc vidéo |
| `0x04` | 8 000 octets | masque : un bit par pixel, poids fort d'abord, 1 = pixel écrit par le bloc vidéo |
| `0x02` | 64 000 octets | différence : XOR avec l'image précédente (la première avec une image nulle) |

- Le **numéro** est la charge utile du bloc `05` d'un MUX, ou le rang de l'image dans un MUK.
- L'**horodatage** est le cumul des octets de son que le MUX avait fournis avant le bloc `05` de l'image : avec la cadence de l'en-tête et la fréquence, il permet de caler l'image sur l'horloge du son, comme le lecteur d'origine (une image tant que la position du son la dépasse).
- **Masque** : sans `0x08`, aucun pixel n'est écrit ; avec `0x08` et sans `0x04`, tous le sont. Le masque rend le conteneur équivalent au bloc vidéo d'origine quel que soit le tampon sur lequel on le décode : `VideoDecoder.pixels` donne l'image cumulée (celle du décodeur MUX), `VideoDecoder.compose(fond)` ne recopie que les pixels écrits. Vérifié sur 5 fichiers : la composition sur un fond quelconque égale le décodage du bloc d'origine sur ce fond.
- Rien n'est perdu sauf : la table d'offsets et les tailles de tampons de l'en-tête MUX (inutiles hors DOS), le découpage du son en blocs (remplacé par l'horodatage), les blocs `05` vides de `07/M07A.MUX`, et le codage d'origine des images (remplacé par leur résultat).

**Sans perte, vérifié** : le script relit chaque conteneur et compare ses images à celles qu'il vient de décoder (SHA-1). Indépendamment, `test/asterix/data/video.test.ts` compare les images de 15 conteneurs aux SHA-1 obtenus sur les fichiers d'origine par le `MuxDecoder` TypeScript des Schtroumpfs ; pendant la mise au point, les 116 MUX que ce décodeur lit ont été comparés (116/116 identiques).

**Poids** (1 Mo = 1 048 576 octets, comme dans `files.md`) : 872 Mo décompressés, 23,8 Mo compressés (MUX 18,6 Mo, MUK 5,2 Mo). Mesures : dictionnaire de 1 Mio, 28,7 Mo ; de 8 Mio, 23,8 Mo ; de 8 Mio sans le masque, 21,9 Mo. Un masque limité aux pixels écrits sans changement de valeur est plus lourd (26,7 Mo) que le masque complet.

## Cas limites

| Fichier | Particularité | Traitement |
|---|---|---|
| `07/M07A.MUX` | 144 blocs `05` vides (taille 0) dans la dernière image (n° 356), entre son bloc vidéo et son vrai bloc `05` ; le fichier finit bien par un bloc `04`. Le lecteur des Schtroumpfs s'arrête sur le premier (« fin d'image sans numéro »). | Blocs vides ignorés : 357 images. Comportement du lecteur d'origine [supposé], à lire dans `1948:04cc`. |
| `36/M36A.MUX` | 19 blocs de son après la dernière image. | Son gardé en entier dans le MP3 ; `audioSamples` dépasse l'horodatage de la dernière image. |
| `23/M23AA.MUX` | Pas de son (fréquence 0). | Pas de MP3, pas d'entrée dans `audio.json`. |
| `44/M44AB.MUX` et 57 autres | Images sans bloc vidéo. | Image sans drapeau `0x08`. |
| `34/M34AG.MUK` | Première image partielle. | Masque ; à composer sur l'écran du module 34. |
| `49/M49DA005.MCC` | Séries de 64 014 pixels. | Dernière série coupée, comme `1481:01ff`. |
| MCC de 1 280 octets | Aplats. | Rien de particulier. |
| `32/M32SA000.HY8` | Partie de sprite de type 5. | À ajouter au lecteur HY8 du moteur commun. |

## Ce qui reste à établir (vague C)

- Rôle des marqueurs `08` et des enregistrements MUK de type 0.
- Composition des calques MUX (fond magenta ou noir, surimpression) dans `1948:04cc` et ses enveloppes.
- Lecture du quiz (tirage, niveau) et du générique (balises).
- Segment `2d7b`, non identifié.
