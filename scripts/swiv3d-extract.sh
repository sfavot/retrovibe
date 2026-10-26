#!/usr/bin/env bash
# Extrait SWIV 3D (SWIV - Temperate Zone, Sales Curve, 1997, Windows 95 CD) :
#  - le CD complet (piste de données décompressée) dans archives/swiv3d/cd/, le patch D3D/3DFX dans
#    archives/swiv3d/patch/ et le contenu de l'installeur Inno Setup dans archives/swiv3d/setup/
#    (non versionnés, références de rétro-ingénierie) ;
#  - uniquement les fichiers utiles au jeu dans original/swiv3d/ (à plat, noms en majuscules) avec files.json :
#    GLOBAL.BD, SOUNDS.BD, TERRAN00-03.SLV, DEMO.SLV, ANIMS/ (*.SMK, *.SCR), MANUEL.TXT (manuel français),
#    MUSIC/TRACKNN.MP3 (pistes CD-DA 02 à 10 encodées en MP3, numéros du CD conservés) ;
#  - l'inventaire docs/swiv3d/files.md.
# Usage : scripts/swiv3d-extract.sh [jeu.7z [patch.7z [installeur.exe]]]
#   (défauts : archives/swiv3d/jeu-01254-swiv-pcwin.7z, pat-01254-swiv-pcwin.7z,
#    setup-01254-SWIV_3D_Temperate_Zone-PCWin.exe)
# Idempotent : les dossiers de sortie sont régénérés à côté puis substitués d'un bloc.
# Briques communes : scripts/lib/ (BIN/CUE, ISO 9660, inventaire, remplacement atomique).
# Outils requis : 7zz, innoextract, ffmpeg, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
dossier_archives="$racine/archives/swiv3d"
archive="${1:-$dossier_archives/jeu-01254-swiv-pcwin.7z}"
patch="${2:-$dossier_archives/pat-01254-swiv-pcwin.7z}"
installeur="${3:-$dossier_archives/setup-01254-SWIV_3D_Temperate_Zone-PCWin.exe}"
sortie="$racine/original/swiv3d"
doc="$racine/docs/swiv3d/files.md"
utils="$racine/scripts/swiv3d/extract_utils.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils 7zz innoextract ffmpeg python3
for f in "$archive" "$patch" "$installeur"; do
  [ -f "$f" ] || { echo "Fichier introuvable : $f" >&2; exit 1; }
done

ec_init_tmp

# remplacer <source> <cible> : substitue <cible> par <source> d'un bloc (la source est déjà à côté, sur le même volume).
remplacer() {
  rm -rf "$2"
  mv "$1" "$2"
}

echo "Extraction de l'archive du CD..."
mkdir "$tmp/7z"
7zz x -y -bso0 -bsp0 "-o$tmp/7z" "$archive"
cue="$(find "$tmp/7z" -iname '*.cue' | head -1)"
[ -n "$cue" ] || { echo "Fichier .cue absent de l'archive" >&2; exit 1; }
bin="$(find "$tmp/7z" -iname '*.bin' | head -1)"
[ -n "$bin" ] || { echo "Fichier .bin absent de l'archive" >&2; exit 1; }

echo "Piste de données -> ISO -> fichiers..."
py iso "$cue" "$bin" "$tmp/data.iso"
py extraire "$tmp/data.iso" "$tmp/iso"
rm -f "$tmp/data.iso"

echo "Pistes audio -> WAV -> MP3..."
mkdir "$tmp/wav" "$tmp/mp3"
py audio "$cue" "$bin" "$tmp/wav"
for wav in "$tmp"/wav/Track*.wav; do
  n="$(basename "$wav" .wav)"
  n="${n#Track}"
  ffmpeg -nostdin -loglevel error -y -i "$wav" -vn -map_metadata -1 -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 \
    -write_xing 1 -fflags +bitexact "$tmp/mp3/TRACK$n.MP3"
  rm -f "$wav"
done
rm -f "$bin"

# CD complet, patch et installeur : construits à côté, puis substitués d'un bloc.
mkdir -p "$dossier_archives"
rm -rf "$dossier_archives/cd.new" "$dossier_archives/patch.new" "$dossier_archives/setup.new"
cp -R "$tmp/iso" "$dossier_archives/cd.new"
remplacer "$dossier_archives/cd.new" "$dossier_archives/cd"

echo "Patch D3D/3DFX..."
mkdir "$tmp/patch"
7zz x -y -bso0 -bsp0 "-o$tmp/patch" "$patch"
find "$tmp/patch" \( -name '.DS_Store' -o -name '._*' \) -type f -delete
rm -rf "$tmp/patch/__MACOSX"
cp -R "$tmp/patch" "$dossier_archives/patch.new"
remplacer "$dossier_archives/patch.new" "$dossier_archives/patch"

echo "Installeur Inno Setup..."
mkdir "$tmp/setup"
innoextract -s -d "$tmp/setup" "$installeur" >/dev/null
cp -R "$tmp/setup" "$dossier_archives/setup.new"
remplacer "$dossier_archives/setup.new" "$dossier_archives/setup"

# Fichiers utiles au jeu, à plat.
mkdir "$tmp/out"
py copier "$tmp/iso" "$tmp/out" "$tmp/stats.json"
mkdir "$tmp/out/MUSIC"
cp "$tmp"/mp3/TRACK*.MP3 "$tmp/out/MUSIC/"
ec_conserver "$sortie" "$tmp/out" COVER.png

ec_publier "$tmp/out" "$sortie"

py inventaire "$sortie" "$tmp/stats.json" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; archives : $dossier_archives/{cd,patch,setup} ; inventaire : $doc"
