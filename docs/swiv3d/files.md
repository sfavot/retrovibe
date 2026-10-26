# Inventaire des fichiers de SWIV 3D

Généré par `scripts/swiv3d-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/swiv3d/`, à plat) : **86.9 Mo** (91146292 octets), dont la musique : 49.5 Mo
- Fichiers gardés : 28

## Par catégorie (fichiers gardés)

| Catégorie | Fichiers | Taille |
|---|---:|---:|
| animations | 7 | 26.8 Mo |
| données | 7 | 10.6 Mo |
| manuel | 1 | 0.0 Mo |
| musique (MP3) | 9 | 49.5 Mo |
| scripts d'animation | 4 | 0.0 Mo |

## Fichiers gardés

| Fichier | Catégorie | Taille |
|---|---|---:|
| `ANIMS/BR_TER0.SCR` | scripts d'animation | 0.0 Mo |
| `ANIMS/BR_TER0.SMK` | animations | 2.2 Mo |
| `ANIMS/BR_TER1.SCR` | scripts d'animation | 0.0 Mo |
| `ANIMS/BR_TER1.SMK` | animations | 1.3 Mo |
| `ANIMS/BR_TER2.SCR` | scripts d'animation | 0.0 Mo |
| `ANIMS/BR_TER2.SMK` | animations | 1.0 Mo |
| `ANIMS/BR_TER3.SCR` | scripts d'animation | 0.0 Mo |
| `ANIMS/BR_TER3.SMK` | animations | 1.1 Mo |
| `ANIMS/INTRO1.SMK` | animations | 2.3 Mo |
| `ANIMS/INTRO2.SMK` | animations | 10.6 Mo |
| `ANIMS/IPLAY.SMK` | animations | 8.2 Mo |
| `DEMO.SLV` | données | 1.7 Mo |
| `GLOBAL.BD` | données | 1.9 Mo |
| `MANUEL.TXT` | manuel | 0.0 Mo |
| `MUSIC/TRACK02.MP3` | musique (MP3) | 6.6 Mo |
| `MUSIC/TRACK03.MP3` | musique (MP3) | 6.2 Mo |
| `MUSIC/TRACK04.MP3` | musique (MP3) | 4.6 Mo |
| `MUSIC/TRACK05.MP3` | musique (MP3) | 4.6 Mo |
| `MUSIC/TRACK06.MP3` | musique (MP3) | 4.2 Mo |
| `MUSIC/TRACK07.MP3` | musique (MP3) | 4.5 Mo |
| `MUSIC/TRACK08.MP3` | musique (MP3) | 4.6 Mo |
| `MUSIC/TRACK09.MP3` | musique (MP3) | 9.8 Mo |
| `MUSIC/TRACK10.MP3` | musique (MP3) | 4.5 Mo |
| `SOUNDS.BD` | données | 0.3 Mo |
| `TERRAN00.SLV` | données | 1.7 Mo |
| `TERRAN01.SLV` | données | 1.7 Mo |
| `TERRAN02.SLV` | données | 1.7 Mo |
| `TERRAN03.SLV` | données | 1.7 Mo |

## Fichiers exclus (agrégés par catégorie)

| Catégorie | Fichiers | Taille |
|---|---:|---:|
| GameData : exécutables et DLL | 7 | 1.2 Mo |
| INSTDAT (installeur, DirectX) | 394 | 16.8 Mo |
| Manuels autres langues | 7 | 0.1 Mo |
| Racine du CD (Setup, CRCLOG, textes) | 5 | 0.3 Mo |

## Pourquoi exclus

- `GameData/*.EXE`, `*.DLL` : exécutables et bibliothèques Windows (`SWIV_WIN.EXE` est la cible de rétro-ingénierie, `SWIV_WFX.EXE` la variante 3Dfx) : gardés dans `archives/swiv3d/cd/` uniquement.
- `INSTDAT/` : installeur et DirectX 3/5 redistribuable : sans objet pour le port.
- `SETUP*.EXE`, `CRCLOG.DAT`, `README.TXT`, `LEGAL.TXT` : installeur, journal de contrôle et textes légaux.
- `Manuals/` hors français : manuels anglais, allemand, espagnol, italien, portugais, tchèque et polonais.

## Remarques

- Le CD est le build CUTDOWN de `GLOBAL.BD` (7 mai 1997), cohérent avec `GameData/SWIV_WIN.EXE`. L'installeur Abandonware France contient le build NORMAL (17 juin 1997), plus récent : il reste dans `archives/swiv3d/setup/` uniquement.
- Les 9 pistes CD-DA (2 à 10) sont encodées en MP3 128 kbit/s CBR, 44,1 kHz stéréo ; les numéros du CD sont conservés (`MUSIC/TRACKNN.MP3`) car l'exécutable joue « cdaudio from track N ».
- `MANUEL.TXT` est le manuel français du CD, octets inchangés.

## Régénérer

```
bash scripts/swiv3d-extract.sh [jeu.7z [patch.7z [installeur.exe]]]
```

Archives par défaut dans `archives/swiv3d/` (non versionnées). Outils requis : `7zz`, `innoextract`, `ffmpeg`, `python3`. Le CD complet est extrait dans `archives/swiv3d/cd/`, le patch dans `archives/swiv3d/patch/` et l'installeur dans `archives/swiv3d/setup/` (références de rétro-ingénierie).
