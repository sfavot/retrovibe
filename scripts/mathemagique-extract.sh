#!/usr/bin/env bash
# Extrait du CD de Math Workshop (Mathémagique, Broderbund, 1994) :
#  - le CD complet dans archives/mathemagique/cd/ (non versionné, pour la rétro-ingénierie) ;
#  - uniquement les fichiers utiles au jeu dans original/mathemagique/ (vidéos QuickTime converties en mp4),
#    avec files.json ; puis génère l'inventaire docs/mathemagique/files.md.
# Usage : scripts/mathemagique-extract.sh [archive.zip]
#   (défaut : archives/mathemagique/Math-Workshop_Win_EN_ISO-Version.zip)
# Idempotent : tout est construit dans un dossier temporaire, puis original/mathemagique/ et le CD complet
# sont substitués d'un bloc en fin de script, seulement si tout a réussi.
# L'ISO est lu par notre propre analyseur ISO 9660 : bsdtar et hdiutil le refusent, et 7zz oublie des fichiers.
# Outils requis : unzip, ffmpeg, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/mathemagique/Math-Workshop_Win_EN_ISO-Version.zip}"
sortie="$racine/original/mathemagique"
cd_complet="$racine/archives/mathemagique/cd"
doc="$racine/docs/mathemagique/files.md"
utils="$racine/scripts/mathemagique/extract_utils.py"

for outil in unzip ffmpeg ffprobe python3; do
  command -v "$outil" >/dev/null || { echo "Outil manquant : $outil" >&2; exit 1; }
done
[ -f "$archive" ] || { echo "Archive introuvable : $archive" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
py() { python3 -I "$utils" "$@"; }

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
py copier "$tmp/cd" "$tmp/out" "$tmp/stats.json"

# Vidéos QuickTime (Cinepak + PCM 8 bits) -> mp4 H.264 + AAC mono, taille d'origine.
# Le débruitage léger efface le bruit de blocs du Cinepak, qui coûte cher à encoder : ~13 Mo au lieu de ~35 Mo.
mkdir "$tmp/out/QTW"
while IFS= read -r mov; do
  nom="$(basename "$mov")"
  echo "Conversion de $nom..."
  ffmpeg -nostdin -loglevel error -y -i "$tmp/cd/$mov" \
    -vf hqdn3d=2:2:3:3 -c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p \
    -c:a aac -ac 1 -b:a 48k -movflags +faststart \
    "$tmp/out/QTW/${nom%.*}.mp4"
done < <(py videos "$tmp/cd")

python3 -I "$racine/scripts/manifest.py" "$tmp/out"

# Substitution d'un bloc, seulement maintenant que tout a réussi.
mkdir -p "$(dirname "$cd_complet")"
rm -rf "$sortie" "$cd_complet"
mv "$tmp/out" "$sortie"
mv "$tmp/cd" "$cd_complet"

py inventaire "$sortie" "$cd_complet" "$tmp/stats.json" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; CD complet : $cd_complet ; inventaire : $doc"
