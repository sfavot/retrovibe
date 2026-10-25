# Inventaire des fichiers de Math Workshop (Mathémagique)

Généré par `scripts/mathemagique-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/mathemagique/`) : **89.2 Mo** (93538753 octets), 85 fichiers

## Par groupe de fichiers

| Extension | Fichiers | Taille |
|---|---:|---:|
| (sans extension) | 1 | 381.5 Ko |
| .DAT | 18 | 68.2 Mo |
| .FON | 5 | 50.0 Ko |
| .HTML | 1 | 38.9 Ko |
| .MHK (MPC/) | 1 | 816.0 Ko |
| .PNG | 14 | 997.8 Ko |
| .SF2 | 1 | 18.2 Mo |
| .TTF | 7 | 241.2 Ko |
| .TXT | 1 | 2.3 Ko |
| .WMF | 6 | 109.3 Ko |
| .WMF (PVGWMF/) | 30 | 218.3 Ko |

## Archives Mohawk

Types de ressources (tag de 4 octets : nombre de ressources). Les octets non imprimables sont échappés.

| Fichier | Taille | Types de ressources |
|---|---:|---|
| `BOWLING.DAT` | 12.1 Mo | `\x00SCR` : 381, `\x00SND` : 168, `SHAP` : 5291, `SHPL` : 96, `SNDL` : 111, `STRL` : 8, `TARG` : 3, `UNIT` : 3 |
| `CREDITS.DAT` | 237.3 Ko | `\x00SCR` : 1, `SHAP` : 22, `SHPL` : 4, `SNDL` : 1 |
| `GUS.DAT` | 1.9 Mo | `\x00SCR` : 54, `\x00SND` : 60, `SHAP` : 608, `SHPL` : 54, `SNDL` : 54 |
| `HIDDEN.DAT` | 6.5 Mo | `\x00SCR` : 28, `\x00SND` : 69, `PUZZ` : 27, `SHAP` : 633, `SHPL` : 61, `SNDL` : 28 |
| `MAINSCRN.DAT` | 10.5 Mo | `\x00SCR` : 93, `\x00SND` : 258, `SHAP` : 1870, `SHPL` : 135, `SNDL` : 93 |
| `MIDIMAP.DAT` | 0.3 Ko | `SYSX` : 1 |
| `MIDIMPC.DAT` | 186.7 Ko | `\x00SND` : 45 |
| `MILKYWAY.DAT` | 26.6 Ko | `\x00SND` : 2, `CURS` : 2 |
| `MPC/PVG.MHK` | 816.0 Ko | `tBMP` : 128, `tPAL` : 8, `tWAV` : 4 |
| `NIM.DAT` | 7.5 Mo | `\x00SCR` : 123, `\x00SND` : 182, `SHAP` : 1423, `SHPL` : 97, `SNDL` : 123 |
| `PATFILL.DAT` | 2.4 Mo | `\x00SCR` : 28, `\x00SND` : 73, `PTRN` : 10, `SHAP` : 378, `SHPL` : 34, `SNDL` : 28, `STRL` : 1 |
| `PATTERNS.DAT` | 7.5 Mo | `\x00SCR` : 28, `\x00SND` : 111, `PUZZ` : 27, `SHAP` : 1594, `SHPL` : 60, `SNDL` : 28 |
| `POLLY.DAT` | 5.0 Mo | `\x00SCR` : 113, `\x00SND` : 190, `SHAP` : 1050, `SHPL` : 113, `SNDL` : 113 |
| `RHYTHM.DAT` | 5.6 Mo | `\x00SCR` : 76, `\x00SND` : 134, `PLST` : 45, `SHAP` : 1362, `SHPL` : 80, `SNDL` : 76, `STLV` : 1, `STRL` : 1 |
| `RSHELP.DAT` | 2.5 Mo | `\x00SCR` : 31, `\x00SND` : 82, `SHAP` : 260, `SHPL` : 33, `SNDL` : 31 |
| `STICKLER.DAT` | 5.7 Mo | `\x00SCR` : 28, `\x00SND` : 71, `PUZZ` : 27, `SHAP` : 1626, `SHPL` : 60, `SNDL` : 28 |
| `SYSTEM.DAT` | 0.1 Ko | `RSFL` : 1 |
| `TITLE.DAT` | 568.8 Ko | `\x00SCR` : 11, `\x00SND` : 2, `SHAP` : 127, `SHPL` : 13, `SNDL` : 11 |
| `TROPHY.DAT` | 71.3 Ko | `SHAP` : 14, `SHPL` : 4, `STRL` : 1 |

## Gardé uniquement dans `archives/mathemagique/cd/`

- `MIDIMAC.DAT` : jeu MIDI pour Mac (`MIDIMPC.DAT`, version PC, est gardé).
- `BROD*.DLL`, `MOHAWK.WIN`, `MATH.INF` : DLL Broderbund, MOHAWK.WIN et manifeste de l'installeur : utiles à la rétro-ingénierie, pas servis au navigateur.
- `INSTALL.EXE`, `MSSETUP.*`, `_MS*.EXE`, `MS*STF.DLL`, `MSDETECT.INC`, `BBINSTAL.MST` : installeur Microsoft Setup.
- `PVG.EXE` : visionneuse de l'application ; ses ressources `MPC/PVG.MHK` sont gardées.
- `QTW/` (QuickTime et `.MOV`) : QuickTime pour Windows et vidéos du guide des parents, que le jeu ne lit pas.
- `MPCRSRC/` : sauvegardes `.BAK` et doublons.
- `MWROSTER` : modèle de fichier de sauvegarde (liste des élèves).
- autres fichiers à la racine du CD : non utilisés par la réimplémentation.

Le CD complet est extrait dans `archives/mathemagique/cd/` (non versionné).

## Régénérer

```
bash scripts/mathemagique-extract.sh [archive.zip]
```

Archive par défaut : `archives/mathemagique/Math-Workshop_Win_EN_ISO-Version.zip` (non versionnée). Outils requis : `unzip`, `python3`.
