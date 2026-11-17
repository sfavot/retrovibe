# Inventaire des fichiers du Téléportaschtroumpf

Généré par `scripts/teleportaschtroumpf-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/teleportaschtroumpf/`) : **129.7 Mo** (136005588 octets)
- Fichiers de données (`DATA/`) : 1423 ; `SMURF.EXE` : 0.2 Mo
- Fichiers d'origine repris : 192.1 Mo ; les `.VOC` sont versionnés en MP3 (voir « Son »), le reste tel quel.

## Par extension (fichiers d'origine repris, taille d'origine)

| Extension | Fichiers | Taille |
|---|---:|---:|
| (MUX sans extension) | 1 | 0.0 Mo |
| .DAT | 2 | 0.0 Mo |
| .DOC | 2 | 0.0 Mo |
| .HY8 | 33 | 1.2 Mo |
| .ION | 1 | 0.0 Mo |
| .MCG | 118 | 7.3 Mo |
| .MUT | 8 | 0.7 Mo |
| .MUX | 232 | 100.5 Mo |
| .PAL | 34 | 0.0 Mo |
| .PFN | 9 | 0.0 Mo |
| .PRC | 8 | 0.0 Mo |
| .VOC | 975 | 82.0 Mo |

## Son

- `*.VOC` (voix, musiques, bruitages) : 975 fichiers, 82.0 Mo à l'origine ; versionnés en `*.VOC.mp3` (nom d'origine suivi de `.mp3`) : 975 fichiers, 19.1 Mo.
- MP3 mono 22 050 Hz, 32 kb/s CBR, sans métadonnées (`ec_encoder_voix` de `scripts/lib/extract-common.sh`), à partir du PCM 8 bits non signé d'origine (fichiers par fréquence : 1 à 11025 Hz, 959 à 18868 Hz, 15 à 19231 Hz).
- `audio.json` : `{"DATA/.../<nom>.VOC.mp3": [échantillons, fréquence]}`, 975 entrées : nombre d'échantillons et fréquence du PCM d'origine, avant l'encodage (durée exacte = échantillons / fréquence). Le moteur attend la fin des sons d'après cet index, pas d'après le MP3 décodé.
- Durée totale : 81 min 24 s.
- Le son des vidéos (`.MUX`) reste dans les fichiers MUX, tels quels.

## Par scène

| Scène | Fichiers |
|---|---:|
| (racine) | 1 |
| S01 | 67 |
| S02 | 8 |
| S03 | 2 |
| S04 | 2 |
| S05 | 4 |
| S06 | 1 |
| S07 | 10 |
| S08 | 21 |
| S09 | 13 |
| S10 | 2 |
| S11 | 1 |
| S13 | 63 |
| S14 | 10 |
| S15 | 36 |
| S16 | 7 |
| S17 | 7 |
| S18 | 10 |
| S19 | 23 |
| S20 | 33 |
| S21 | 22 |
| S22 | 12 |
| S23 | 15 |
| S24 | 42 |
| S25 | 55 |
| S26 | 47 |
| S27 | 23 |
| S28 | 10 |
| S29 | 10 |
| S30 | 13 |
| S31 | 12 |
| S32 | 7 |
| S33 | 28 |
| S34 | 16 |
| S35 | 46 |
| S36 | 37 |
| S38 | 36 |
| S39 | 82 |
| S40 | 235 |
| S41 | 38 |
| S42 | 217 |
| S45 | 34 |
| S46 | 7 |
| S48 | 12 |
| S49 | 14 |
| S51 | 15 |
| S52 | 17 |

## Fichiers exclus (agrégés par catégorie)

| Catégorie | Fichiers | Taille |
|---|---:|---:|
| (sans extension, non MUX) | 6 | 7.3 Mo |
| .BAT | 2 | 0.0 Mo |
| .CC | 1 | 0.3 Mo |
| .FRM | 8 | 0.0 Mo |
| .LBM | 4 | 0.2 Mo |
| .LSR | 1 | 0.0 Mo |
| .MCC | 5 | 0.1 Mo |
| .MOL | 1 | 0.4 Mo |
| .MUK | 1 | 0.1 Mo |
| .MX | 1 | 0.0 Mo |
| .OLD | 2 | 0.0 Mo |
| .OPT | 2 | 0.9 Mo |
| .PCM | 7 | 2.0 Mo |
| .TMP | 6 | 0.0 Mo |
| .TRP | 8 | 0.0 Mo |
| .UER | 1 | 0.4 Mo |
| .XA2 | 2 | 0.2 Mo |

## Pistes audio du CD

- Les pistes CD-DA 2 à 7 existent sur le disque mais ne sont pas extraites : le jeu ne les lit jamais (voir `docs/teleportaschtroumpf/engine.md` §5).

## Notice

- `MANUEL.pdf` : la notice d'Infogrames (`Lisez moi.doc` à la racine du CD), convertie par `textutil` puis Chrome en mode headless (mise en page simplifiée : le lecteur Word de `textutil` perd gras et tailles). Elle n'est pas lue par le jeu.

## Régénérer

```
bash scripts/teleportaschtroumpf-extract.sh [archive.rar]
```

Archive par défaut : `archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar` (non versionnée). Outils requis : `bsdtar`, `python3`, `ffmpeg` (libmp3lame) ; pour la notice, `textutil` et Google Chrome (macOS). Hors notice, le résultat est le même à chaque exécution, avec la même version de `ffmpeg`.
