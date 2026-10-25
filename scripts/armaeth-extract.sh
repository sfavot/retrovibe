#!/usr/bin/env bash
# Extrait le CD d'Armaeth (Grandslam, 1994, DOS CD) :
#  - le CD complet (3 langues) dans archives/armaeth/cd/ (non versionné, pour la rétro-ingénierie) ;
#  - uniquement les fichiers utiles au jeu en version française dans original/armaeth/ (à plat),
#    avec l'inventaire docs/armaeth/files.md.
# Usage : scripts/armaeth-extract.sh [archive.7z]
#   (défaut : archives/armaeth/jeu-02436-armaeth-CD-pcdos.7z)
# original/armaeth/COVER.png (jaquette générée par scripts/armaeth-cover.mts depuis la scène 20) ne vient pas du CD :
# elle est conservée telle quelle.
# Idempotent : les dossiers de sortie sont régénérés à côté puis substitués d'un bloc.
# Briques communes : scripts/lib/ (extraction ISO 9660, inventaire, remplacement atomique).
# Outils requis : 7zz, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/armaeth/jeu-02436-armaeth-CD-pcdos.7z}"
sortie="$racine/original/armaeth"
cd_complet="$racine/archives/armaeth/cd"
doc="$racine/docs/armaeth/files.md"
utils="$racine/scripts/armaeth/extract_utils.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils 7zz python3
[ -f "$archive" ] || { echo "Archive introuvable : $archive" >&2; exit 1; }

ec_init_tmp

echo "Extraction de l'archive..."
mkdir "$tmp/7z"
7zz x -y -bso0 -bsp0 "-o$tmp/7z" "$archive"
iso="$(find "$tmp/7z" -iname 'ARMAETH.ISO' | head -1)"
[ -n "$iso" ] || { echo "ARMAETH.ISO absent de l'archive" >&2; exit 1; }

echo "ISO -> fichiers..."
py extraire "$iso" "$tmp/iso"

# CD complet : construit dans $tmp, puis substitué d'un bloc.
mkdir -p "$(dirname "$cd_complet")"
rm -rf "$cd_complet.new"
cp -R "$tmp/iso" "$cd_complet.new"
rm -rf "$cd_complet"
mv "$cd_complet.new" "$cd_complet"

# Version française seule, à plat.
mkdir "$tmp/out"
py copier "$tmp/iso" "$tmp/out" "$tmp/stats.json"

ec_conserver "$sortie" "$tmp/out" COVER.png
ec_publier "$tmp/out" "$sortie"

py inventaire "$sortie" "$tmp/stats.json" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; CD complet : $cd_complet ; inventaire : $doc"
