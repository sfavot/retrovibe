# Inventaire des fichiers de Lure of the Temptress

Généré par `scripts/lure-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/lure/`) : **4.3 Mo** (4467585 octets), 8 fichiers (hors `files.json`)
- Hors extraction, conservé d'une exécution à l'autre : `COVER.png` (vague J)

## Fichiers

| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |
|---|---:|---|---|
| COVER.png | 22550 | `69e1cdc2d5470f2b` | vague J (`scripts/lure-cover.mts`), conservé d'une exécution à l'autre |
| DISK1.VGA | 603648 | `26b140100dcc22b4` | `DISK1.VGA` de l'archive, tel quel (conteneur `heywow` n° 1, 39 ressources) |
| DISK2.VGA | 659488 | `feb533e0ce022ab3` | `DISK2.VGA` de l'archive, tel quel (conteneur `heywow` n° 2, 103 ressources) |
| DISK3.VGA | 699072 | `81678a2d90dd07a7` | `DISK3.VGA` de l'archive, tel quel (conteneur `heywow` n° 3, 118 ressources) |
| DISK4.VGA | 609984 | `ba02de459e4f826e` | `DISK4.VGA` de l'archive, tel quel (conteneur `heywow` n° 4, 77 ressources) |
| LICENSE-LURE.txt | 1285 | `f546a2370e353f3c` | `LICENSE.txt` de l'archive (licence de Revolution Software, à conserver intacte) |
| LURE-FR.DAT | 129344 | `aa6f5ef63d664e4e` | bloc français de `lure.dat` de ScummVM (langue 6, `0x9C200` à `0xBBB40`), 26 ressources `0x3F01` à `0x3F1A` |
| MANUEL.pdf | 1742214 | `b90ba08b6d043d88` | `Manual.pdf` de l'archive (manuel français, 42 pages) |

## Contrôles faits à l'extraction

- `DISK1.VGA` à `DISK4.VGA` : signature `heywow`, numéro de disque, 39, 103, 118, 77 ressources, identifiants du bon disque, dernière ressource à moins de 32 octets de la fin.
- `DISK1.VGA` : MD5 des 1 024 premiers octets = `1c94475c1bb7e0e88c1757d3b5377e94` (entrée `FR_FRA` de la détection de ScummVM).
- `LURE.EXE` : somme des 1 024 premiers octets = `0xD38C` (`FRENCH_FILE_CHECKSUM` de `create_lure`).
- `lure.dat` (750.8 Ko, 768832 octets) : version 1.32 (entrée à `0xBF * 8`) ; langues de la table : anglais (3, `0x600`), italien (7, `0x20000`), allemand (10, `0x3D200`), espagnol (5, `0x5CF00`), russe (17, `0x7CA00`), français (6, `0x9C200`) ; le bloc 6 va de `0x9C200` à `0xBBB40` (fin du fichier).
- Bloc français : `heywow`, numéro 0, 26 ressources `0x3F01` à `0x3F1A` consécutives, 127489 octets utiles.

## Non versionnés

- `LURE.EXE` : exécutable DOS (138 220 octets) : jamais exécuté, sert seulement à régénérer le bloc français avec `create_lure` de ScummVM.
- `PROTECT.PDF` : feuille de la protection de copie, non portée (D2).
- `README` : note de ScummVM de 2007 (pas un fichier de Revolution) ; l'essentiel est repris dans l'aide et `plan.md`.

## Régénérer

```
bash scripts/lure-extract.sh
```

Archive par défaut : `archives/lure-fr-1.1.zip` ; `lure.dat` par défaut : `archives/lure.dat` (copie de `dists/engine-data/lure.dat` de ScummVM). Aucun des deux n'est versionné. Outils requis : `bsdtar`, `python3`.
