#!/usr/bin/env bash
# Extrait du CD de Math Workshop (Mathémagique, Broderbund, 1994) :
#  - le CD complet dans archives/mathemagique/cd/ (non versionné, pour la rétro-ingénierie) ;
#  - uniquement les fichiers utiles au jeu dans original/mathemagique/ avec files.json ; puis génère l'inventaire docs/mathemagique/files.md.
# Usage : scripts/mathemagique-extract.sh [archive.zip]
#   (défaut : archives/mathemagique/Math-Workshop_Win_EN_ISO-Version.zip)
# Idempotent : tout est construit dans un dossier temporaire, puis original/mathemagique/ et le CD complet
# sont substitués d'un bloc en fin de script, seulement si tout a réussi.
# L'ISO est lu par notre propre analyseur ISO 9660 : bsdtar et hdiutil le refusent, et 7zz oublie des fichiers.
# Les vidéos QuickTime du guide des parents (QTW/*.MOV) ne sont pas gardées : le jeu ne les lit pas.
# Sont conservés, car ils ne viennent pas du CD : la soundfont réduite (mathemagique-gm.sf2) et sa licence, produites par
# scripts/mathemagique/soundfont.mts ; la jaquette COVER.png (scripts/mathemagique/cover.mts) ; le manuel en français MANUEL.html
# (écrit à la main) et ses illustrations manuel/ (scripts/mathemagique/manual-images.mts).
# Outils requis : unzip, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/mathemagique/Math-Workshop_Win_EN_ISO-Version.zip}"
sortie="$racine/original/mathemagique"
cd_complet="$racine/archives/mathemagique/cd"
doc="$racine/docs/mathemagique/files.md"
utils="$racine/scripts/mathemagique/extract_utils.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils unzip python3
[ -f "$archive" ] || { echo "Archive introuvable : $archive" >&2; exit 1; }

ec_init_tmp

echo "Extraction de l'archive..."
mkdir "$tmp/zip"
unzip -q "$archive" -d "$tmp/zip"
iso="$(find "$tmp/zip" -iname '*.iso' | head -1)"
[ -n "$iso" ] || { echo "Aucun .iso dans l'archive" >&2; exit 1; }

echo "ISO -> CD complet..."
py iso "$iso" "$tmp/cd"
rm -rf "$tmp/zip"

echo "Fichiers utiles..."
mkdir "$tmp/out"
py copier "$tmp/cd" "$tmp/out"

# La soundfont réduite et sa licence (scripts/mathemagique/soundfont.mts), la jaquette (scripts/mathemagique/cover.mts), le manuel
# MANUEL.html et ses illustrations manuel/ (scripts/mathemagique/manual-images.mts) ne viennent pas du CD : conservés tels quels.
ec_conserver "$sortie" "$tmp/out" mathemagique-gm.sf2 mathemagique-gm-LICENSE.txt COVER.png MANUEL.html
if [ -d "$sortie/manuel" ]; then cp -R "$sortie/manuel" "$tmp/out/manuel"; fi

# Substitution d'un bloc, seulement maintenant que tout a réussi (files.json est généré avant).
mkdir -p "$(dirname "$cd_complet")"
rm -rf "$cd_complet"
ec_publier "$tmp/out" "$sortie"
mv "$tmp/cd" "$cd_complet"

py inventaire "$sortie" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; CD complet : $cd_complet ; inventaire : $doc"
