# Inventaire des fichiers du Téléportaschtroumpf

Généré par `scripts/teleportaschtroumpf-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/teleportaschtroumpf/`) : **192.6 Mo** (201964058 octets)
- Fichiers de données (`DATA/`) : 1423 ; `SMURF.EXE` : 0.2 Mo

## Par extension (fichiers gardés)

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

Archive par défaut : `archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar` (non versionnée). Outils requis : `bsdtar`, `python3` ; pour la notice, `textutil` et Google Chrome (macOS).
