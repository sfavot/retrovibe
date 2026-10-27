# Inventaire des fichiers de L'Odyssée des Zoombinis

Généré par `scripts/zoombinis-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/zoombinis/`) : **63.0 Mo** (66074828 octets), 23 fichiers
- Version française du CD (`FRENCH/`), à plat.

## Archives Mohawk

Types de ressources (tag de 4 octets : nombre de ressources). Les octets non imprimables sont échappés. `MIDIMAP.DAT` est aussi une archive Mohawk malgré son extension.

| Fichier | Taille | Types de ressources |
|---|---:|---|
| `BASECAMP.MHK` | 1.1 Mo | `\x00SND` : 31, `NODE` : 1, `PATH` : 1, `REGS` : 2, `SCRB` : 32, `SHPL` : 1, `tBMP` : 7 |
| `BCTWO.MHK` | 1.6 Mo | `\x00SND` : 43, `NODE` : 1, `PATH` : 1, `REGS` : 2, `SCRB` : 30, `SHPL` : 3, `tBMP` : 27 |
| `BRIDGE.MHK` | 1.7 Mo | `\x00SND` : 49, `SCRB` : 58, `SCRS` : 45, `SHPL` : 1, `tBMP` : 6 |
| `CAVES.MHK` | 1.6 Mo | `\x00SND` : 25, `NODE` : 1, `PATH` : 1, `REGS` : 3, `SCRB` : 137, `SCRS` : 19, `SHPL` : 1, `tBMP` : 11 |
| `FERRY.MHK` | 2.2 Mo | `\x00SND` : 52, `SCRB` : 83, `SCRS` : 18, `SHPL` : 1, `tBMP` : 8 |
| `FLEENS.MHK` | 2.7 Mo | `\x00SND` : 72, `REGS` : 4, `SCRB` : 15, `SCRS` : 110, `SHPL` : 1, `tBMP` : 7 |
| `HOTEL.MHK` | 5.0 Mo | `\x00SND` : 80, `NODE` : 1, `PATH` : 1, `REGS` : 14, `SCRB` : 290, `SCRS` : 120, `SHPL` : 10, `tBMP` : 14 |
| `LILLY.MHK` | 886.0 Ko | `\x00SND` : 18, `NODE` : 1, `PATH` : 1, `REGS` : 11, `SCRB` : 187, `SHPL` : 1, `tBMP` : 6 |
| `MAP.MHK` | 487.0 Ko | `SCRB` : 8, `SHPL` : 1, `tBMP` : 2 |
| `MAZE2.MHK` | 1.3 Mo | `\x00SND` : 13, `REGS` : 22, `SCRB` : 100, `SCRS` : 104, `SHPL` : 1, `tBMP` : 9 |
| `MIDIMAP.DAT` | 0.5 Ko | `SYSX` : 2 |
| `MIDIMPC.MHK` | 75.3 Ko | `tMID` : 18 |
| `NET.MHK` | 1.2 Mo | `\x00SND` : 30, `REGS` : 4, `SCRB` : 229, `SCRS` : 54, `SHPL` : 3, `tBMP` : 8 |
| `PICKER.MHK` | 931.0 Ko | `\x00SND` : 11, `NODE` : 1, `PATH` : 1, `REGS` : 4, `SCRB` : 53, `SHPL` : 3, `tBMP` : 11 |
| `PIZZA.MHK` | 5.6 Mo | `\x00SND` : 156, `NODE` : 1, `PATH` : 1, `SCRB` : 224, `SCRS` : 46, `SHPL` : 2, `tBMP` : 8 |
| `SLIDES.MHK` | 1.0 Mo | `\x00SND` : 10, `NODE` : 1, `PATH` : 1, `SCRB` : 17, `SCRS` : 10, `SHPL` : 3, `tBMP` : 5 |
| `SMOKE.MHK` | 1.9 Mo | `\x00SND` : 18, `REGS` : 3, `SCRB` : 78, `SCRS` : 52, `SHPL` : 1, `tBMP` : 5 |
| `TEXTSTR.MHK` | 12.1 Ko | `STRL` : 40 |
| `TOWN.MHK` | 6.2 Mo | `\x00SND` : 41, `REGS` : 4, `SCRB` : 61, `SCRS` : 6, `SHPL` : 1, `tBMP` : 7 |
| `TUNNELS.MHK` | 3.1 Mo | `\x00SND` : 129, `NODE` : 1, `PATH` : 1, `SCRB` : 136, `SCRS` : 73, `SHPL` : 1, `tBMP` : 11 |
| `XFER.MHK` | 2.7 Mo | `SCRB` : 34, `SCRS` : 11, `SHPL` : 6, `tBMP` : 16 |
| `ZOOMBINI.MHK` | 21.7 Mo | `\x00SND` : 555, `CURS` : 5, `REGS` : 6, `SCRB` : 12, `SCRS` : 51, `tBMP` : 6 |

## Autres fichiers

| Fichier | Taille |
|---|---:|
| `CORNER.TTF` | 33.4 Ko |

## Gardé uniquement dans `archives/zoombinis/`

- `ENGLISH/`, `GERMAN/` : versions anglaise et allemande (seule `FRENCH/` est servie).
- `FRENCH/MIDIMAC.MHK` : jeu MIDI pour Mac (`MIDIMPC.MHK`, version PC, est gardé).
- `FRENCH/LOGO*.MOV`, `FRENCH/LOGO*.PRF` : vidéos QuickTime des logos et leurs fichiers de préchargement : à étudier (lues par le jeu au démarrage ?).
- `ZOOMBINI._EX` : exécutable NE 16 bits du jeu (Borland C++), cible de la rétro-ingénierie.
- `BROEMIDI`, `BROEMIDI.TMI`, `DIB.DRV`, `MOHAWK.WIN`, `QB.DEC` : lanceur MIDI, pilote DIB, configuration du moteur et décodeur QuickTime : utiles à la rétro-ingénierie, pas servis au navigateur.
- `SETUP.*/`, `INSTALL.EXE`, `AUTORUN.*`, `SYSTEM/` : installeurs (Microsoft Setup, QuickTime, WinG) et lanceur du CD.
- `*.TXT` : notes techniques de la version 1.0 (français, anglais, allemand).

Le CD complet est extrait dans `archives/zoombinis/cd/`, l'installation DOSBox d'Abandonware France (Windows 3.1 installé, avec `ZOOMBINI.EXE`, `ZOOMBINI.CFG` et `ZOOMBINI.WHO`) dans `archives/zoombinis/setup/` et le manuel PDF dans `archives/zoombinis/manuel/` (non versionnés).

## Régénérer

```
bash scripts/zoombinis-extract.sh [jeu.7z [installeur.exe [manuel.7z]]]
```

Archives par défaut dans `archives/zoombinis/` (non versionnées) : `jeu-02069-odyssee_des_zoombinis-pcwin.7z`, `setup-02069-Zoombinis_Logique-Dosbox.exe`, `man-02069-l_odyssee_des_zoombinis.7z`. Outils requis : `7zz`, `innoextract`, `python3`.
