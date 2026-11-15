# Inventaire des fichiers de Ween : The Prophecy

Généré par `scripts/ween-extract.sh` (ne pas éditer à la main).

## Taille

- Total versionné (`original/ween/`) : **6.7 Mo** (7067845 octets), 2 fichier(s) (hors `files.json`)
- Hors extraction, conservé d'une exécution à l'autre : `COVER.webp` (jaquette de la boîte d'origine)

## Fichiers

| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |
|---|---:|---|---|
| COVER.webp | 38254 | `e99bc4952a714f67` | jaquette de la boîte d'origine (Wikipédia anglophone), conservé d'une exécution à l'autre |
| INTRO.STK | 7029591 | `4b7cef03be19f489` | `INTRO.STK` de l'installeur, tel quel (décision D3 : tout le jeu est dans ce fichier) |

## Contrôles faits à l'extraction

- `INTRO.STK` : 7029591 octets, MD5 `3ff06b7834918564f220f669c72de494` (vérifiés avant la copie).
- SHA-256 complet de `INTRO.STK` : `4b7cef03be19f489a0e554cc0b1321e5b2022ad3c3302ef6d87d6d504ea4a44a`.
- L'installeur (Inno Setup) n'est jamais exécuté : `innoextract` seul, dans un dossier temporaire vide.
