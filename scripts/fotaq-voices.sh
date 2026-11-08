#!/usr/bin/env bash
# Convertit les 6 751 voix et effets de Flight of the Amazon Queen (ressources .SB de queen.1c : OGG Vorbis mono
# 11 840 Hz) en MP3 pour le web (Safari et iOS ne lisent pas tous le Vorbis), dans original/fotaq/voices/<NOM>.mp3.
# MP3 mono 22 050 Hz, 24 kb/s CBR (11 840 Hz n'est pas un taux MP3) ; métadonnées retirées, -fflags +bitexact,
# sans filtre : durée conservée, sans padding ni coupe. Noms identiques à ceux de queen.1c, sans extension .SB.
# Usage : scripts/fotaq-voices.sh [FOTAQ_Fr_Talkie_1.0.zip]   (défaut : archives/FOTAQ_Fr_Talkie_1.0.zip)
# Idempotent : les MP3 sont reconstruits à côté puis substitués ; files.json et l'inventaire sont régénérés.
# À lancer après (ou avant) scripts/fotaq-extract.sh : celui-ci conserve voices/.
# L'archive est une donnée non fiable : rien n'est exécuté (ffmpeg ne lit que des fichiers locaux, -protocol_whitelist file).
# Outils requis : bsdtar, ffmpeg (libmp3lame), python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/FOTAQ_Fr_Talkie_1.0.zip}"
sortie="$racine/original/fotaq"
doc="$racine/docs/fotaq/files.md"
utils="$racine/scripts/fotaq/split_queen.py"
debit="${FOTAQ_VOICES_BITRATE:-24k}"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils bsdtar ffmpeg python3
[ -f "$archive" ] || { echo "Fichier introuvable : $archive" >&2; exit 1; }

ec_init_tmp
mkdir "$tmp/zip" "$tmp/sb" "$tmp/mp3"
bsdtar -xf "$archive" -C "$tmp/zip"
queen="$(find "$tmp/zip" -iname 'queen.1c' -type f | head -1)"
[ -n "$queen" ] || { echo "queen.1c absent de $archive" >&2; exit 1; }
py voix "$queen" "$tmp/sb"

nb=0
for sb in "$tmp"/sb/*.SB; do
  nom="$(basename "$sb" .SB)"
  ffmpeg -hide_banner -loglevel error -nostdin -y -protocol_whitelist file -i "$sb" -vn -map_metadata -1 \
    -c:a libmp3lame -b:a "$debit" -ar 22050 -ac 1 -write_xing 1 -fflags +bitexact "$tmp/mp3/$nom.mp3"
  nb=$((nb + 1))
done
[ "$nb" -eq 6751 ] || { echo "6751 voix attendues, $nb converties" >&2; exit 1; }

mkdir -p "$sortie"
rm -rf "$sortie/voices"
mv "$tmp/mp3" "$sortie/voices"
python3 -I "$racine/scripts/manifest.py" "$sortie"
py inventaire "$sortie" "$queen" "$doc"
echo "Terminé : $nb voix dans $sortie/voices ($(du -sh "$sortie/voices" | cut -f1))"
