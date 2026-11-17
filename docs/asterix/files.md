# Inventaire des fichiers d'Astérix : le défi de César

Généré par `scripts/asterix-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/asterix/`) : **53.6 Mo** (56210190 octets), 1233 fichiers (hors `files.json`)
- Fichiers d'origine repris : 180.7 Mo
- Hors `MDF/` : `audio.json` (32.4 Ko)
- `COVER.webp` (jaquette) ne vient pas de l'archive : conservé d'une exécution à l'autre s'il existe.

## Par lot

| Origine | Fichiers | Taille d'origine | Versionné |
|---|---:|---:|---|
| `*.VOC` : voix, musiques et bruitages | 736 | 62.8 Mo | `*.VOC.mp3` : 736 fichiers, 13.5 Mo |
| `*.MUX` : vidéos (image 66.9 Mo, son 31.3 Mo) | 117 | 98.2 Mo | `*.MUX.vid` : 117 fichiers, 18.6 Mo ; `*.MUX.mp3` : 116 fichiers, 6.7 Mo |
| `*.MUK` : animations | 31 | 10.0 Mo | `*.MUK.vid` : 31 fichiers, 5.2 Mo |
| `*.DAT` | 1 | 1.9 Ko | tels quels |
| `*.HY8` | 30 | 1.2 Mo | tels quels |
| `*.MCC` | 80 | 1.7 Mo | tels quels |
| `*.MCG` | 106 | 6.5 Mo | tels quels |
| `*.PAL` | 1 | 0.8 Ko | tels quels |
| `*.PFN` | 4 | 11.4 Ko | tels quels |
| `*.TXT` | 9 | 76.3 Ko | tels quels |
| `ASTERIX.EXE` | 1 | 149.7 Ko | tel quel (lu pour ses tables, jamais exécuté) |

## Son

- `*.VOC.mp3` et `*.MUX.mp3` : MP3 mono 22 050 Hz, 32 kb/s CBR, sans métadonnées (`ec_encoder_voix` de `scripts/lib/extract-common.sh`), à partir du PCM 8 bits non signé d'origine.
- `audio.json` : `{"MDF/<module>/<nom>.mp3": [échantillons, fréquence]}`, 852 entrées : nombre d'échantillons et fréquence du PCM d'origine, avant l'encodage (durée exacte = échantillons / fréquence).
- Durée : VOC 57 min 22 s, son des MUX 28 min 53 s.
- MUX sans son (pas de MP3) : `23/M23AA.MUX`.

## Vidéo

- `*.MUX.vid` et `*.MUK.vid` : conteneur maison sans perte, compressé en LZMA (voir `docs/asterix/formats.md`) ; 18983 images au total.
- Chaque conteneur est relu après écriture : ses images sont identiques, pixel à pixel, à celles décodées du fichier d'origine.
- Blocs de fin d'image vides ignorés (remplissage) : `07/M07A.MUX` (144).

## Par module

| Module | Fichiers | Taille |
|---|---:|---:|
| `MDF/01` | 24 | 1.3 Mo |
| `MDF/02` | 2 | 65.1 Ko |
| `MDF/03` | 8 | 465.4 Ko |
| `MDF/05` | 1 | 17.7 Ko |
| `MDF/06` | 13 | 1.9 Mo |
| `MDF/07` | 10 | 613.4 Ko |
| `MDF/08` | 25 | 496.3 Ko |
| `MDF/09` | 1 | 63.3 Ko |
| `MDF/11` | 25 | 701.0 Ko |
| `MDF/12` | 2 | 139.4 Ko |
| `MDF/13` | 19 | 1.1 Mo |
| `MDF/14` | 2 | 39.6 Ko |
| `MDF/15` | 2 | 30.0 Ko |
| `MDF/16` | 2 | 206.5 Ko |
| `MDF/17` | 2 | 53.0 Ko |
| `MDF/18` | 2 | 12.9 Ko |
| `MDF/19` | 2 | 17.9 Ko |
| `MDF/20` | 28 | 654.1 Ko |
| `MDF/21` | 32 | 1.9 Mo |
| `MDF/22` | 17 | 581.7 Ko |
| `MDF/23` | 20 | 781.4 Ko |
| `MDF/24` | 41 | 1.2 Mo |
| `MDF/25` | 69 | 3.2 Mo |
| `MDF/26` | 97 | 6.8 Mo |
| `MDF/27` | 24 | 3.3 Mo |
| `MDF/28` | 16 | 544.4 Ko |
| `MDF/29` | 18 | 705.4 Ko |
| `MDF/30` | 10 | 288.3 Ko |
| `MDF/31` | 15 | 818.7 Ko |
| `MDF/32` | 23 | 702.0 Ko |
| `MDF/33` | 14 | 569.0 Ko |
| `MDF/34` | 29 | 3.0 Mo |
| `MDF/35` | 25 | 996.1 Ko |
| `MDF/36` | 9 | 440.8 Ko |
| `MDF/37` | 24 | 382.3 Ko |
| `MDF/38` | 28 | 1.6 Mo |
| `MDF/39` | 54 | 3.9 Mo |
| `MDF/40` | 77 | 2.3 Mo |
| `MDF/41` | 37 | 1.8 Mo |
| `MDF/42` | 22 | 2.3 Mo |
| `MDF/43` | 12 | 42.8 Ko |
| `MDF/44` | 6 | 1.3 Mo |
| `MDF/45` | 24 | 1.2 Mo |
| `MDF/46` | 13 | 142.1 Ko |
| `MDF/47` | 4 | 354.6 Ko |
| `MDF/48` | 3 | 94.5 Ko |
| `MDF/49` | 6 | 77.2 Ko |
| `MDF/51` | 35 | 450.4 Ko |
| `MDF/52` | 21 | 836.7 Ko |
| `MDF/60` | 70 | 1.4 Mo |
| `MDF/61` | 114 | 1.0 Mo |
| `MDF/62` | 7 | 181.1 Ko |
| `MDF/63` | 45 | 654.1 Ko |

## Fichiers exclus

| Catégorie | Fichiers | Taille |
|---|---:|---:|
| `LISEZMOI.EXE` et `MDF/LISEZMOI.TXT` (aide au dépannage sous DOS) | 2 | 0.0 Mo |
| `OUTLINE/` (installeur d'un émulateur Minitel, sans rapport avec le jeu) | 45 | 0.8 Mo |

L'archive contient aussi `Lisez-Moi.txt` (Abandonware France), hors du dossier `Asterix/` : non repris.

## Régénérer

```
bash scripts/asterix-extract.sh [archive.7z]
```

Archive par défaut : `archives/asterix/jeu-00700-asterix_defi_de_cesar-pcdos.7z` (non versionnée). Outils requis : `7zz`, `python3` (module `lzma`), `ffmpeg` (libmp3lame). Le résultat est le même à chaque exécution, avec les mêmes versions de `ffmpeg` et de liblzma.
