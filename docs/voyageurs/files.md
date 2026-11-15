# Inventaire des fichiers des Voyageurs du temps

Généré par `scripts/voyageurs-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/voyageurs/`, hors `files.json`) : **18.2 Mo** (19054007 octets)
- Données du jeu : 0.8 Mo ; musique (`music/`) : 17.4 Mo, 11 pistes, 1516.23 s
- Hors extraction, conservé d'une exécution à l'autre : `COVER.png` (vague J)

## Fichiers

| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |
|---|---:|---|---|
| AUTO00.PRC | 253 | `b036e88d7cff1377` | `app/data/AUTO00.PRC` de l'installeur, tel quel (décision D2), MD5 contrôlé |
| PART01 | 165376 | `8416cf20bbef5625` | `app/data/PART01` de l'installeur, tel quel (décision D2), MD5 contrôlé |
| PART02 | 277572 | `5487b1a8aafcb8db` | `app/data/PART02` de l'installeur, tel quel (décision D2), MD5 contrôlé |
| PART03 | 155502 | `fe362bbe43ee180d` | `app/data/PART03` de l'installeur, tel quel (décision D2), MD5 contrôlé |
| PART04 | 153908 | `84bd37362a574e8d` | `app/data/PART04` de l'installeur, tel quel (décision D2), MD5 contrôlé |
| PART04B | 92704 | `3f2ea57adfddd29b` | `app/data/PART04B` de l'installeur, tel quel (décision D2), MD5 contrôlé |
| TEXTE.DAT | 4996 | `1f97a142003dbb25` | `app/data/TEXTE.DAT` de l'installeur, tel quel (décision D2), MD5 contrôlé |
| music/track19.mp3 | 1961398 | `44c23c8f27e5511e` | `track19.flac` converti, 163.37 s (décision D3) |
| music/track20.mp3 | 1525989 | `b102df75539c533a` | `track20.flac` converti, 127.09 s (décision D3) |
| music/track21.mp3 | 1518152 | `a53d148c5337fc0a` | `track21.flac` converti, 126.44 s (décision D3) |
| music/track22.mp3 | 1488999 | `2f35fcdb6630ed3b` | `track22.flac` converti, 124.03 s (décision D3) |
| music/track23.mp3 | 2201515 | `52feeaa9fd4f4bf6` | `track23.flac` converti, 183.40 s (décision D3) |
| music/track24.mp3 | 2056065 | `c4f278cfa8208bb3` | `track24.flac` converti, 171.27 s (décision D3) |
| music/track25.mp3 | 1901525 | `3572d194f36f0384` | `track25.flac` converti, 158.40 s (décision D3) |
| music/track26.mp3 | 1481162 | `f2e937806dc352f1` | `track26.flac` converti, 123.37 s (décision D3) |
| music/track27.mp3 | 1895255 | `88bc07b540deefaa` | `track27.flac` converti, 157.87 s (décision D3) |
| music/track28.mp3 | 536052 | `05d5c7a7b23c309d` | `track28.flac` converti, 44.60 s (décision D3) |
| music/track29.mp3 | 1637584 | `da4cd2483eb1d018` | `track29.flac` converti, 136.39 s (décision D3) |

## Musique

- Pistes CD 19 à 29, numérotées comme ScummVM ; les pistes 1 à 18 ne sont référencées ni par ScummVM ni par les scripts du jeu : non versionnées
- Encodage : `libmp3lame`, MP3 joint stéréo 44,1 kHz, 96 kb/s CBR, en-tête Xing, sans métadonnées, `-fflags +bitexact` (déterministe) ; même régime que Lost in Time

## Non repris

- `.PAL` (chargés par ScummVM mais jamais relus), `BASESON.SND` (musique AdLib/MT-32, inutile en version CD), exécutables, `MANUAL.*`, `SONY.LBM`, `VOL.*`

## Contrôles faits à l'extraction

- MD5 du fichier entier pour les 7 fichiers du jeu
- Durée de chaque MP3 égale à celle du FLAC (tolérance 0.1 s)
