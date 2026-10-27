#!/usr/bin/env bash
# Extrait L'Odyssée des Zoombinis (Broderbund / TERC, 1996, CD Windows 3.1 / 95, version 1.0 trilingue) :
#  - le CD complet dans archives/zoombinis/cd/, l'installation DOSBox d'Abandonware France dans archives/zoombinis/setup/
#    (Windows 3.1 avec le jeu installé : ZOOMBINI.EXE, ZOOMBINI.CFG, ZOOMBINI.WHO) et le manuel PDF dans
#    archives/zoombinis/manuel/ (non versionnés, références de rétro-ingénierie) ;
#  - uniquement les fichiers utiles au jeu dans original/zoombinis/ (version française, à plat) avec files.json :
#    les archives Mohawk FRENCH/*.MHK (sauf MIDIMAC.MHK), MIDIMAP.DAT et CORNER.TTF ;
#  - l'inventaire docs/zoombinis/files.md.
# Usage : scripts/zoombinis-extract.sh [jeu.7z [installeur.exe [manuel.7z]]]
#   (défauts : archives/zoombinis/jeu-02069-odyssee_des_zoombinis-pcwin.7z, setup-02069-Zoombinis_Logique-Dosbox.exe,
#    man-02069-l_odyssee_des_zoombinis.7z)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# Outils requis : 7zz, innoextract, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
dossier_archives="$racine/archives/zoombinis"
archive="${1:-$dossier_archives/jeu-02069-odyssee_des_zoombinis-pcwin.7z}"
installeur="${2:-$dossier_archives/setup-02069-Zoombinis_Logique-Dosbox.exe}"
manuel="${3:-$dossier_archives/man-02069-l_odyssee_des_zoombinis.7z}"
sortie="$racine/original/zoombinis"
doc="$racine/docs/zoombinis/files.md"
utils="$racine/scripts/zoombinis/extract_utils.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils 7zz innoextract python3
for f in "$archive" "$installeur" "$manuel"; do
  [ -f "$f" ] || { echo "Fichier introuvable : $f" >&2; exit 1; }
done

ec_init_tmp

echo "Extraction de l'archive du CD..."
mkdir "$tmp/7z"
7zz x -y -bso0 -bsp0 "-o$tmp/7z" "$archive"
iso="$(find "$tmp/7z" -iname '*.iso' | head -1)"
[ -n "$iso" ] || { echo "Aucun .iso dans l'archive" >&2; exit 1; }

echo "ISO -> CD complet..."
py iso "$iso" "$tmp/cd"
rm -rf "$tmp/7z"

echo "Installation DOSBox (Inno Setup, sans l'image du CD qu'elle embarque)..."
mkdir "$tmp/setup"
innoextract -s -d "$tmp/setup" --exclude-temp "$installeur" >/dev/null
find "$tmp/setup" -iname '*.iso' -type f -delete

echo "Manuel..."
mkdir "$tmp/manuel"
7zz e -y -bso0 -bsp0 "-o$tmp/manuel" "$manuel" '*.pdf' '*.txt' -r

echo "Fichiers utiles..."
mkdir "$tmp/out"
py copier "$tmp/cd" "$tmp/out"

# Substitution d'un bloc, seulement maintenant que tout a réussi (files.json est généré avant).
mkdir -p "$dossier_archives"
for d in cd setup manuel; do
  rm -rf "${dossier_archives:?}/$d"
  mv "$tmp/$d" "$dossier_archives/$d"
done
ec_publier "$tmp/out" "$sortie"

py inventaire "$sortie" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; archives : $dossier_archives/{cd,setup,manuel} ; inventaire : $doc"
