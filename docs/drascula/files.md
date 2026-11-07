# Inventaire des fichiers de Drascula

Généré par `scripts/drascula-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/drascula/`) : **85.1 Mo** (89248194 octets), 1146 fichiers (hors `files.json`)
- Musique : 26.8 Mo ; voix et sons `.ALS` : 30.7 Mo ; reste : 27.6 Mo
- Hors extraction, conservés d'une exécution à l'autre : `COVER.png` (vague J), `track*.mp3` (`scripts/drascula-music.sh`)

## Par extension

| Extension | Fichiers | Taille |
|---|---:|---:|
| .ALD | 57 | 19.2 Ko |
| .ALG | 225 | 5.4 Mo |
| .ALS | 783 | 30.7 Mo |
| .BIN | 33 | 21.9 Mo |
| .CAL | 13 | 2.6 Ko |
| .DAT | 1 | 253.5 Ko |
| .TXT | 3 | 7.1 Ko |
| .mp3 (musique) | 31 | 26.8 Mo |

## Provenance

| Fichiers | Origine |
|---|---|
| `*.ALG`, `*.ALS`, `*.BIN` (sauf `QPC.BIN`) | `Packet.001` (base, voix anglaises) du zip `drascula-1.0.zip` |
| `*.ALD`, `*.CAL`, `QPC.BIN` | `PACKET.002` (français) de `drascula-int-1.1.zip`, en remplacement de ceux de la base |
| `drascula.dat`, `drascula-dat-LICENSE.txt` | `archives/drascula.dat` (ScummVM, version 7) ; licence : voir la note |
| `README-ALCACHOFA.txt`, `README-ALCACHOFA-INT.txt` | `readme.txt` des zips de base et international (licence d'Alcachofa Soft, à conserver intacte) |
| `track1.mp3` à `track31.mp3` | `drascula-audio-2.0.zip` (OGG), convertis par `scripts/drascula-music.sh` (MP3 80 kb/s) |

## Fichiers de `Packet.001` exclus (agrégés par extension)

| Extension | Fichiers | Taille |
|---|---:|---:|
| (sans extension) | 11 | 0.0 Mo |
| .CFG | 1 | 0.0 Mo |
| .COM | 1 | 0.0 Mo |
| .DEV | 7 | 0.0 Mo |
| .DRV | 1 | 0.1 Mo |
| .EPA | 1 | 0.0 Mo |
| .EXE | 10 | 1.5 Mo |
| .RCT | 1 | 0.0 Mo |
| .VOC | 1 | 0.0 Mo |

- `*.EXE`, `DRASCULA.COM` : exécutables DOS d'origine (DOS4GW, SETUP, LOGODDM, HACKER*, IGOR, PENDULO, YODA, UNINSTAL) : non versionnés.
- `*.DEV`, `GHOST.DRV`, `SOUND.CFG`, `SETUP.VOC`, `INFO.RCT`, `SAVES.EPA` : pilotes et réglages de l'exécutable d'origine, non lus par ScummVM.
- `GSAVE00` à `GSAVE10` : sauvegardes d'origine (le portage a ses propres sauvegardes).
- `drascula.doc` (zip de base) : manuel Word, non extrait.
- packs allemand, espagnol, italien (`PACKET.003` à `.005`) : extraits dans `archives/drascula/` seulement ; version portée : français.

## Régénérer

```
bash scripts/drascula-extract.sh
bash scripts/drascula-music.sh
```

Archives par défaut : `archives/drascula-1.0.zip`, `drascula-int-1.1.zip`, `drascula-audio-2.0.zip`, `drascula.dat` (non versionnées). Outils requis : `bsdtar`, `7zz`, `python3`, `ffmpeg` (musique). Extractions complètes (dont les autres langues) : `archives/drascula/`.
