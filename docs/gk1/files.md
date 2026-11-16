# Inventaire des fichiers de Gabriel Knight: Sins of the Fathers

Généré par `scripts/gk1-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/gk1/`) : **142.5 Mo** (149456458 octets), 7818 fichiers (hors `files.json`)
- Voix (`voices/`) : 95.2 Mo ; bruitages (`audio/`) : 7.1 Mo ; cinématiques (`SEQ/`) : 10.4 Mo ; ressources, patchs et PDF : 29.9 Mo
- Plus gros fichier : `RESOURCE.000` (12.7 Mo)
- Hors extraction, conservé d'une exécution à l'autre : `COVER.webp` (jaquette, si présente)

## Fichiers

| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |
|---|---:|---|---|
| ALT.MAP | 364 | `bf0df81184693334` | `ALT.MAP` du CD, tel quel (répertoire de `RESOURCE.ALT`) |
| BD.pdf | 10228022 | `ac8eacd7c2bd8a84` | bande dessinée de la boîte, « … (Bande dessinée).pdf » de l'archive des manuels, telle quelle |
| COVER.webp | 19478 | `283c92d23e6a837f` | jaquette, ne vient pas du CD : conservée d'une exécution à l'autre |
| MANUEL.pdf | 4112295 | `699035b9d876c665` | manuel, « … (Manuel).pdf » de l'archive des manuels, tel quel |
| PATCHES/316.SND | 98 | `526f90dfb948d1eb` | `PATCHES/316.SND` du CD, tel quel (patch de la ressource sound 316) |
| PATCHES/803.SND | 98 | `526f90dfb948d1eb` | `PATCHES/803.SND` du CD, tel quel (patch de la ressource sound 803) |
| RESOURCE.000 | 13325145 | `7c141bb0e32814ea` | `RESOURCE.000` du CD, tel quel (volume de ressources SCI2) |
| RESOURCE.ALT | 3616871 | `3a47064256a4674a` | `RESOURCE.ALT` du CD, tel quel (59 vues, variantes haute résolution, pour une option future) |
| RESOURCE.MAP | 11392 | `cc1dc1accaf065f4` | `RESOURCE.MAP` du CD, tel quel (répertoire de `RESOURCE.000`) |
| VERSION | 50 | `ae18577ab942546d` | `VERSION.` du CD, tel quel (numéro de version, nom et date du CD, lus par le jeu) |
| SEQ/*.SEQ | 10867942 |  | 25 cinématiques Sierra SEQ du dossier `SEQ/` du CD, telles quelles |
| voices/<module>/<noun>-<verb>-<cond>-<seq>.mp3 | 99194910 |  | 7469 clips de voix (`AUD/RESOURCE.AUD` et patchs `AUD/@…`) ; MP3 mono 22 050 Hz, 24 kb/s CBR (`ec_encoder_voix`) |
| voices/<module>/sync.json | 516949 |  | 9 fichiers, synchronisation labiale de 1785 clips (blocs sync de `AUD/RESOURCE.AUD` et patchs `AUD/#…`) |
| voices/<module>/index.json, audio/index.json | 137497 |  | 74 fichiers, durée exacte de chaque clip et de chaque bruitage, en échantillons à 22 050 Hz |
| audio/<numéro>.mp3 | 7425347 |  | 231 bruitages numériques (`RESOURCE.SFX` et `SFX/*.WAV`) ; MP3 mono 22 050 Hz, 64 kb/s CBR |

## Voix

- 7469 fichiers MP3, 94.6 Mo (99194910 octets) : `voices/<module>/<noun>-<verb>-<cond>-<seq>.mp3`, en décimal ; le module est le numéro de la ressource message, (noun, verb, cond, seq) la clé du message ; seq sans le drapeau 0x80
- Source : 7469 clips des 73 maps audio36 de `RESOURCE.000` (audio SOL de `AUD/RESOURCE.AUD`, DPCM 8 bits, 4 bits par échantillon), dont 21 remplacés et 0 ajoutés par les 21 patchs `AUD/@…` (SOL PCM 8 bits) ; mono 22050 Hz, soit **8 h 54 min 35 s** (32075 s)
- Les voix sont en anglais : la version française de 1994 associe les voix d'origine aux textes français
- DPCM : variante « ancienne » de SCI2 (quartet n ≥ 8 : retire `table[7 - (n & 7)]`), choisie sur un contrôle objectif (300 clips : 0,01 % d'échantillons saturés et moyenne à 1,4 de 128, contre 59 % et 105 avec l'autre variante)
- Encodage : `libmp3lame`, 24 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées (`ec_encoder_voix` de `scripts/lib/extract-common.sh`)
- Synchronisation labiale : `voices/<module>/sync.json`, `{"<noun>-<verb>-<cond>-<seq>": [tick, pose, tick, pose, …]}` : les paires u16 du bloc sync, sans l'en-tête (`8E 00`) ni le tick final 0xFFFF ; un tick vaut 1/60 s ; un patch `AUD/#…` remplace le bloc de `RESOURCE.AUD` (10 patchs, octets après le terminateur non repris)
- Durées : `voices/<module>/index.json`, `{"<noun>-<verb>-<cond>-<seq>": échantillons}`, et `audio/index.json`, `{"<numéro>": échantillons}` : nombre d'échantillons du PCM source (mono 22 050 Hz), avant l'encodage MP3 ; en ticks de 1/60 s, arrondi de ScummVM (`Audio32::play`) : `1 + floor(floor(échantillons × 1000 / 22050) × 60 / 1000)`
- Priorités : un patch `AUD/@…` remplace l'audio du clip de `RESOURCE.AUD` de même clé, un patch `AUD/#…` remplace ou ajoute son bloc sync ; `SFX/<n>.WAV` remplace la ressource `n` de `RESOURCE.SFX`

| Module | Clips | Avec sync | Octets MP3 | Durée |
|---:|---:|---:|---:|---:|
| 0 | 89 | 0 | 810754 | 258 s |
| 15 | 227 | 0 | 4165813 | 1359 s |
| 18 | 68 | 0 | 813167 | 262 s |
| 50 | 245 | 245 | 2887831 | 930 s |
| 51 | 464 | 461 | 6363939 | 2060 s |
| 52 | 153 | 147 | 1954297 | 631 s |
| 53 | 292 | 292 | 4815216 | 1566 s |
| 54 | 169 | 169 | 2497482 | 810 s |
| 55 | 170 | 170 | 3067177 | 1000 s |
| 56 | 194 | 194 | 3453517 | 1125 s |
| 57 | 99 | 99 | 1399668 | 453 s |
| 200 | 7 | 0 | 145062 | 47 s |
| 205 | 6 | 0 | 107400 | 35 s |
| 206 | 4 | 0 | 86151 | 28 s |
| 210 | 336 | 0 | 3801725 | 1223 s |
| 211 | 255 | 0 | 4272958 | 1390 s |
| 220 | 283 | 0 | 3263988 | 1051 s |
| 230 | 213 | 0 | 2232007 | 716 s |
| 240 | 272 | 0 | 3606513 | 1166 s |
| 250 | 153 | 0 | 2313289 | 751 s |
| 260 | 258 | 0 | 2870782 | 923 s |
| 270 | 62 | 0 | 751534 | 242 s |
| 280 | 115 | 0 | 1475230 | 476 s |
| 290 | 152 | 0 | 1817027 | 586 s |
| 300 | 44 | 0 | 643830 | 209 s |
| 301 | 42 | 0 | 483629 | 156 s |
| 302 | 20 | 0 | 261088 | 84 s |
| 310 | 40 | 0 | 513553 | 166 s |
| 320 | 64 | 0 | 867061 | 281 s |
| 325 | 55 | 0 | 563765 | 181 s |
| 330 | 84 | 0 | 1605092 | 524 s |
| 339 | 1 | 0 | 7020 | 2 s |
| 340 | 119 | 0 | 1427371 | 460 s |
| 350 | 74 | 0 | 882799 | 284 s |
| 360 | 80 | 0 | 809090 | 259 s |
| 370 | 14 | 0 | 119832 | 38 s |
| 380 | 102 | 0 | 1170268 | 377 s |
| 390 | 90 | 0 | 995269 | 320 s |
| 400 | 19 | 0 | 354140 | 116 s |
| 401 | 53 | 0 | 722211 | 234 s |
| 410 | 90 | 0 | 927250 | 297 s |
| 420 | 95 | 0 | 1243531 | 402 s |
| 430 | 51 | 0 | 540778 | 174 s |
| 440 | 109 | 0 | 1049817 | 336 s |
| 450 | 83 | 0 | 1117444 | 362 s |
| 455 | 92 | 0 | 1006420 | 323 s |
| 457 | 48 | 0 | 573087 | 185 s |
| 460 | 223 | 0 | 2333241 | 748 s |
| 470 | 117 | 0 | 1543978 | 499 s |
| 480 | 43 | 0 | 469962 | 151 s |
| 490 | 34 | 0 | 603092 | 197 s |
| 510 | 121 | 0 | 1456860 | 470 s |
| 520 | 98 | 0 | 1952895 | 638 s |
| 530 | 95 | 0 | 1111801 | 358 s |
| 540 | 76 | 0 | 1110227 | 360 s |
| 550 | 13 | 0 | 309907 | 102 s |
| 670 | 33 | 8 | 385185 | 124 s |
| 700 | 22 | 0 | 344639 | 112 s |
| 710 | 107 | 0 | 1408333 | 455 s |
| 720 | 107 | 0 | 1594064 | 517 s |
| 800 | 86 | 0 | 1118993 | 362 s |
| 801 | 21 | 0 | 224456 | 72 s |
| 802 | 33 | 0 | 416142 | 134 s |
| 803 | 39 | 0 | 574714 | 186 s |
| 804 | 33 | 0 | 440509 | 142 s |
| 806 | 18 | 0 | 219385 | 71 s |
| 807 | 26 | 0 | 311125 | 100 s |
| 808 | 109 | 0 | 1400434 | 452 s |
| 809 | 9 | 0 | 82381 | 26 s |
| 810 | 17 | 0 | 266594 | 87 s |
| 811 | 34 | 0 | 457014 | 148 s |
| 815 | 6 | 0 | 68217 | 22 s |
| 900 | 194 | 0 | 2133890 | 685 s |

## Bruitages numériques

- 231 fichiers MP3 (`audio/<numéro>.mp3`), 7.1 Mo (7425347 octets), 0 h 15 min 06 s (906 s)
- Source : les 186 ressources de `RESOURCE.SFX` (map 65535 de `RESOURCE.000`) et les 46 `SFX/*.WAV`, qui gagnent en cas de conflit (1 numéro commun) ; RIFF WAVE PCM mono 22050 Hz, 16 ou 8 bits
- Encodage : `libmp3lame`, 64 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées

## Fichiers du CD non versionnés

| Catégorie | Fichiers | Taille |
|---|---:|---:|
| audio converti en MP3 (`RESOURCE.SFX`, `SFX/`, `AUD/`) | 79 | 376.6 Mo |
| exécutables et pilotes DOS (`*.EXE`, `*.DRV`) | 21 | 1.0 Mo |
| installeur, configuration et lisez-moi | 11 | 0.1 Mo |

## Contrôles faits à l'extraction

- Archives 7z extraites dans un dossier temporaire vide, ISO lu par l'analyseur de `scripts/lib/extract_common.py` ; rien n'est exécuté.
- Tailles et SHA-256 des fichiers sources : `RESOURCE.MAP` 11392 octets `cc1dc1accaf065f4ba0efcdddb44ab7175346ee6e22c16789c991686e27662cd` ; `RESOURCE.000` 13325145 octets `7c141bb0e32814ea34d3b1a64cc203a56b1fb5b9e51da043cc7e0318fdfb051d` ; `ALT.MAP` 364 octets `bf0df811846933340a6564d527487cab9dc548490ef1b3653409516185be9d64` ; `RESOURCE.ALT` 3616871 octets `3a47064256a4674a7f7668e41726f3561fbb9e64069d7c0b05599897da6188c7` ; `RESOURCE.SFX` 13589592 octets `9477f157b636fb90c459fe268697bca554cb30941377bb7f6dd20b96120144df` ; `AUD/RESOURCE.AUD` 354272859 octets `681239426b91ff22be501fa93c62f1faae7b22b5037d6c00f70a3b1c9bf5f1d7` ; `PATCHES/316.SND` 98 octets `526f90dfb948d1eb8ad75e878c443cdfae5a76ed5ca08536a955af57d76df017` ; `PATCHES/803.SND` 98 octets `526f90dfb948d1eb8ad75e878c443cdfae5a76ed5ca08536a955af57d76df017` ; `VERSION.` 50 octets `ae18577ab942546d9d6037b57129aad24a61d24d77ab1674df9aa64f7bb11de7`.
- Tailles et SHA-256 des deux PDF : `MANUEL.pdf` 4112295 octets `699035b9d876c665dfd6b5931362d88b5cad71cae811489305a56868f090122a` ; `BD.pdf` 10228022 octets `ac8eacd7c2bd8a8473641fa841309f3af570a7ba015da5db8ab73307821d7d4b`.
- Nombres attendus : 73 maps audio36, 7469 clips dont 1777 avec synchronisation, 21 patchs `@` et 10 patchs `#`, 186 entrées dans la map 65535, 46 `SFX/*.WAV`, 25 `SEQ/*.SEQ` ; 7469 MP3 de voix et 231 de bruitages en sortie.
- Audio : en-tête SOL (22 050 Hz, drapeaux 0 ou 1) et taille de chaque clip, bloc sync terminé par 0xFFFF exactement à sa fin (dans `RESOURCE.AUD`), ticks croissants, pas de synchronisation sans audio ; chaque bruitage est un RIFF WAVE PCM mono 22 050 Hz dont les chunks tiennent dans la ressource.

## Régénérer

```
bash scripts/gk1-extract.sh [jeu.7z] [manuels.7z]
```

Archives par défaut : `archives/jeu-00686-gabriel_knight_cd-pcdos.7z` (contient `GabK.iso`) et `archives/man-00686-gabriel_knight.7z` (non versionnées). Outils requis : `7zz`, `python3`, `ffmpeg` (`libmp3lame`).
