# Inventaire des fichiers de Flight of the Amazon Queen

Généré par `scripts/fotaq-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/fotaq/`) : **61.9 Mo** (64903887 octets), 7671 fichiers (hors `files.json`)
- Voix et effets (`voices/`) : 42.6 Mo ; données du jeu : 19.2 Mo
- Hors extraction, conservés d'une exécution à l'autre : `voices/` (`scripts/fotaq-voices.sh`), `COVER.png` (vague J)

## Par extension

| Extension | Fichiers | Taille |
|---|---:|---:|
| .ACT | 64 | 2.1 Mo |
| .BBK | 131 | 4.7 Mo |
| .CRD | 2 | 5.9 Ko |
| .CUT | 302 | 290.5 Ko |
| .DOG | 73 | 232.2 Ko |
| .JAS | 2 | 116.1 Ko |
| .LUM | 63 | 1.5 Ko |
| .MSK | 65 | 507.8 Ko |
| .MUS | 1 | 319.6 Ko |
| .PCX | 128 | 5.1 Mo |
| .RL | 1 | 399.8 Ko |
| .SAM | 86 | 5.5 Mo |
| .TXT | 1 | 5.3 Ko |
| DATA (sans extension) | 1 | 5.1 Ko |
| voices/*.mp3 (voix) | 6751 | 42.6 Mo |

## Provenance

| Fichiers | Origine |
|---|---|
| tous sauf `voices/` et `README-FOTAQ.txt` | `queen.1c` de `FOTAQ_Fr_Talkie_1.0.zip` (7 671 ressources à plat, noms d'origine), découpé par `scripts/fotaq/split_queen.py` |
| `voices/<nom>.mp3` | ressources `.SB` de `queen.1c` (OGG Vorbis mono 11 840 Hz), converties par `scripts/fotaq-voices.sh` (MP3 mono 22 050 Hz, 24 kb/s CBR) |
| `AQ.RL`, `AQBANK.MUS` | musique : MIDI pour le MT-32 (`AQ.RL`, 106 morceaux) et AdLib (`AQBANK.MUS`, 102 morceaux, repli) |
| `README-FOTAQ.txt` | `readme.txt` du zip (licence de John Passfield et Steven Stamatiadis, à conserver intacte) |

## Ressources de `queen.1c` non extraites (agrégées)

| Ressource | Fichiers | Taille |
|---|---:|---:|
| .SB | 6751 | 73.5 Mo |
| AQBANK.RL | 1 | 0.0 Mo |

- `*.SB` (6 751) : voix et effets en OGG Vorbis : convertis en MP3 dans `voices/` par `scripts/fotaq-voices.sh`.
- `AQBANK.RL` : banque d'instruments Roland, non lue par le moteur (ScummVM ne charge que `AQ.RL` pour le MT-32).

## Régénérer

```
bash scripts/fotaq-extract.sh
bash scripts/fotaq-voices.sh
```

Archive par défaut : `archives/FOTAQ_Fr_Talkie_1.0.zip` (non versionnée). Outils requis : `bsdtar`, `python3`, `ffmpeg` (voix).
