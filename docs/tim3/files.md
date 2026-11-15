# Inventaire des fichiers de The Incredible Machine 3

Généré par `scripts/tim3-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/tim3/`) : **17.4 Mo** (18271765 octets), 660 fichiers (hors `files.json`)
- Voix (`voices/`, MP3) : 7.6 Mo ; données du jeu : 9.8 Mo
- Hors extraction, conservé d'une exécution à l'autre : `COVER.png` (vague J, si présent)

## Fichiers

| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |
|---|---:|---|---|
| FRENCH.DAT | 469457 | `72cd26d4c722ab30` | `TIMWIN/FRENCH.DAT` de l'ISO, tel quel (pack de langue : textes français) |
| RESOURCE.001 | 7508126 | `022987060475eec9` | `TIMWIN/RESOURCE.001` de l'ISO, tel quel |
| RESOURCE.002 | 1783838 | `27b30fd7bd2dcfe1` | `TIMWIN/RESOURCE.002` de l'ISO, tel quel |
| RESOURCE.MAP | 12276 | `d0c076e413ab0184` | `TIMWIN/RESOURCE.MAP` de l'ISO, tel quel |
| TIMWIN.EXE | 454656 | `a2562ae1ff835566` | `TIMWIN/TIMWIN.EXE` de l'ISO, tel quel (source des tables, non lu à l'exécution) |
| voices/lipsync.json | 85944 | `3dfb4a95c31f0708` | octets de synchronisation labiale de chaque entrée, bruts en base64 (voir `formats.md` § 8) |
| voices/<archive>/<n>.mp3 | 7957468 |  | 654 voix, une par entrée non vide des 10 archives `.VOC` ; MP3 mono 22 050 Hz, 24 kb/s CBR (`ec_encoder_voix`) |

## Voix

| Archive | Voix | Octets MP3 | Durée |
|---|---:|---:|---:|
| GOALS.VOC | 206 | 1499580 | 473 s |
| HINT1.VOC | 104 | 1142768 | 367 s |
| HINT2.VOC | 74 | 724729 | 232 s |
| HINT3.VOC | 30 | 338104 | 109 s |
| HINT4.VOC | 10 | 114950 | 37 s |
| HINT5.VOC | 5 | 43014 | 14 s |
| HINT6.VOC | 4 | 58879 | 19 s |
| HINT7.VOC | 1 | 8274 | 3 s |
| HELP.VOC | 188 | 3200588 | 1042 s |
| PROFESOR.VOC | 32 | 826582 | 271 s |

- 654 fichiers MP3 (`voices/<archive en minuscules>/<index sur 3 chiffres>.mp3`), 7.6 Mo (7957468 octets) ; l'index est celui de l'entrée dans l'archive (les entrées vides sont sautées, les autres gardent leur index)
- Source : PCM 8 bits non signé, mono, 11025 Hz, soit **0 h 42 min 47 s** (2567 s)
- Encodage : `libmp3lame`, 24 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées (`ec_encoder_voix` de `scripts/lib/extract-common.sh`)
- Synchronisation labiale : `voices/lipsync.json`, `{archive: {index: octets bruts en base64}}`, pour les entrées de HELP.VOC et PROFESOR.VOC (seules à en avoir)

## Contrôles faits à l'extraction

- Archive 7z puis ISO extraites dans un dossier temporaire vide ; rien n'est exécuté.
- Tailles et SHA-256 des cinq fichiers copiés : `RESOURCE.MAP` 12276 octets `d0c076e413ab0184db9880075d2307b6d78150c093eaf919fcfee71931130ebb` ; `RESOURCE.001` 7508126 octets `022987060475eec96b6f5720b5e61ec29811fa996be79d13d1e26cda4270f69c` ; `RESOURCE.002` 1783838 octets `27b30fd7bd2dcfe15f5f2398954bc11f63b02d3506cc64ccb1ab2ee940aa42eb` ; `FRENCH.DAT` 469457 octets `72cd26d4c722ab30ad1077e8bd6f243c64500cae8d7a0fc27b266c1c7f93395e` ; `TIMWIN.EXE` 454656 octets `a2562ae1ff8355666e2c55f8dc7cb5f262f5b2798680f390cb374e3fcaae3080`.
- Archives VOC : table d'offsets strictement croissante, chaque entrée finit à l'offset de la suivante (la dernière à la fin du fichier), chaque WAV est un RIFF PCM 8 bits mono 11025 Hz dont les chunks tiennent dans l'entrée.

## Régénérer

```
bash scripts/tim3-extract.sh [archive.7z]
```

Archive par défaut : `jeu-00235-incredible_machine_3-pcwin.7z` à la racine, sinon dans `archives/` (non versionnée). Outils requis : `7zz`, `python3`, `ffmpeg` (`libmp3lame`).
