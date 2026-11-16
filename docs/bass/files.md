# Inventaire des fichiers de Beneath a Steel Sky

Généré par `scripts/bass-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/bass/`) : **34.3 Mo** (35993168 octets), 3495 fichiers (hors `files.json`)
- Voix (`voices/`) : 21.2 Mo ; données du jeu : 13.1 Mo
- Hors extraction, conservé d'une exécution à l'autre : `COVER.webp` (jaquette de la boîte d'origine)

## Fichiers

| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |
|---|---:|---|---|
| README-BASS.txt | 5891 | `8bf1d302dbe203e6` | `readme.txt` de l'archive (licence de Revolution Software, à conserver intacte) |
| sky.cpt | 419427 | `9f41a3be39db9139` | `sky.cpt` de l'archive, tel quel (décision D2) |
| sky.dnr | 12852 | `3554e261108eece9` | index de `sky.dnr` de l'archive recalculé pour `sky.dsk` sans les voix (`scripts/bass/split_dsk.py`) |
| sky.dsk | 13309715 | `6b8705ef6070992b` | `sky.dsk` de l'archive sans les 3 491 voix (50000 à 55277) ; octets stockés copiés tels quels |
| voices/<id>.mp3 | 22245283 |  | 3491 voix, une par identifiant 50000 à 55277 de `sky.dsk` ; MP3 mono 22 050 Hz, 24 kb/s CBR (`ec_encoder_voix`) |

## Voix

- 3491 fichiers MP3 (`voices/<id>.mp3`), 21.2 Mo au total (22245283 octets)
- Source : PCM 8 bits non signé, mono, 11025 Hz, 76655617 octets, soit **1 h 55 min 53 s** (6953 s)
- Identifiants : 50000 à 55277 (`50000 + table[section] + rang`, voir `formats.md` § 6) ; les voix de l'introduction (59494 à 59672) restent dans `sky.dsk`, au format d'origine
- Encodage : `libmp3lame`, 24 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées (`ec_encoder_voix` de `scripts/lib/extract-common.sh`, partagé avec FOTAQ)

## Contrôles faits à l'extraction

- `sky.dsk` : 72395713 octets ; `sky.dnr` : 5097 entrées ; mêmes valeurs que l'entrée `{5097, 72395713, "CD", 372}` de `detection.cpp` de ScummVM (CD v0.0372).
- SHA-256 de l'archive : `sky.dsk` `9ef6ca3dcb6f9ceb31e950bc3a05d5105bbbb38a5e9fc9a9f6508363c87849e2`, `sky.dnr` `1aa426bc9b04d962c98f2c6108f770b23a45a32cb85bd4e053a6eb1779173164`, `sky.cpt` `9f41a3be39db91391400401152bd62435500b772bc92613d2c2eea0eb816982f`.
- Index : les fichiers se suivent dans l'ordre de l'index (0 à 15 octets de remplissage devant les positions alignées sur 16, aucun devant les autres), le dernier finit à la fin de `sky.dsk`.
- `sky.dsk` et `sky.dnr` reconstruits : mêmes drapeaux, même mode de position (alignée `<< 4` ou brute) et même ordre ; **chacun des 1606 fichiers hors voix est identique à celui de l'archive** (octets stockés et contenu décompressé, comparés par `split_dsk.py check`).
- Voix : décompressées en RNC méthode 1 (CRC de l'entrée et de la sortie valides), en-tête de 22 octets retiré, `s_tot_size - 22` octets conservés.
- `sky.cpt` : copié tel quel (419 427 octets). Contrôle fait en vague X par régénération avec `devtools/skycpt/` de ScummVM (compilé hors dépôt, `COMPACT.TXT` en entrée) : les 357 685 premiers octets sont identiques ; les 61 742 derniers (données de remise à zéro) ne sont pas régénérables sans les sept `RESET.nnn` (voir `formats.md` § 4). `skycpt` n'est pas porté.

## Régénérer

```
bash scripts/bass-extract.sh
```

Archive par défaut : `archives/bass/bass-cd-1.2.zip` (non versionnée). Outils requis : `bsdtar`, `python3`, `ffmpeg` (`libmp3lame`).
