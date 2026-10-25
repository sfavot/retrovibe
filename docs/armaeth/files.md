# Inventaire des fichiers d'Armaeth

Généré par `scripts/armaeth-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/armaeth/`, version française à plat) : **2.7 Mo** (2805621 octets)
- Fichiers gardés : 40
- Hors CD, conservé d'une extraction à l'autre : `COVER.png` (jaquette 320 x 200 générée par `scripts/armaeth-cover.mts` depuis la scène 20 de `A1F00E.VGA`)

## Par extension (fichiers gardés)

| Extension | Fichiers | Taille |
|---|---:|---:|
| (sans extension) | 3 | 0.0 Mo |
| .EXE | 1 | 0.2 Mo |
| .SCR | 1 | 0.0 Mo |
| .STD | 1 | 0.0 Mo |
| .SVG | 1 | 0.0 Mo |
| .SYS | 14 | 0.3 Mo |
| .VGA | 19 | 2.1 Mo |

## Fichiers exclus (agrégés par catégorie)

| Catégorie | Fichiers | Taille |
|---|---:|---:|
| .BAT | 2 | 0.0 Mo |
| .EXE | 7 | 0.2 Mo |
| .RNC | 1 | 1.7 Mo |
| dossier ARMAETH.DEU | 50 | 4.4 Mo |
| dossier ARMAETH.ENG | 50 | 4.4 Mo |
| racine du CD | 6 | 0.0 Mo |

## Pourquoi exclus

- `ARMAETH.RNC` : archive Rob Northen utilisée par l'installeur disque dur ; le jeu ne la lit pas.
- Autres `.EXE` : installeurs, configuration du son (`SC0`/`SC1`/`SOS`), `VGA.EXE`, `CDPATCH.EXE` : sans objet pour le port.
- `.BAT` : lanceurs et aides DOS.
- `ARMAETH.ENG` et `ARMAETH.DEU` : versions anglaise et allemande ; le CD complet reste dans `archives/armaeth/cd/`.
- Fichiers racine du CD : scripts d'installation et d'aide uniquement (`.BAT`).

## Régénérer

```
bash scripts/armaeth-extract.sh [archive.7z]
```

Archive par défaut : `archives/armaeth/jeu-02436-armaeth-CD-pcdos.7z` (non versionnée). Outils requis : `7zz`, `python3`. Le CD complet (3 langues) est extrait dans `archives/armaeth/cd/`.
