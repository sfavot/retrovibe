#!/usr/bin/env bash
# Convertit la musique de Drascula (drascula-audio-2.0.zip : audio/track1.ogg ... track31.ogg, OGG Vorbis stéréo 44,1 kHz)
# en MP3 pour le web (les navigateurs d'Apple ne lisent pas tous l'OGG), dans original/drascula/track<N>.mp3.
# Usage : scripts/drascula-music.sh [drascula-audio-2.0.zip]   (défaut : archives/drascula-audio-2.0.zip)
# Idempotent : les MP3 sont reconstruits à côté puis substitués ; files.json et l'inventaire sont régénérés.
# À lancer après (ou avant) scripts/drascula-extract.sh : celui-ci conserve les track*.mp3 existants.
# Outils requis : bsdtar, ffmpeg (libmp3lame), python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/drascula-audio-2.0.zip}"
sortie="$racine/original/drascula"
utils="$racine/scripts/drascula/extract_utils.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils bsdtar ffmpeg python3
[ -f "$archive" ] || { echo "Fichier introuvable : $archive" >&2; exit 1; }

ec_init_tmp
mkdir "$tmp/zip" "$tmp/mp3"
bsdtar -xf "$archive" -C "$tmp/zip"

nb=0
for ogg in "$tmp"/zip/audio/track*.ogg; do
  nom="$(basename "$ogg" .ogg)"
  # MP3 joint stereo 44,1 kHz, 80 kb/s CBR (seek par `currentTime` linéaire) ; en-tête Xing ; métadonnées retirées ;
  # -fflags +bitexact et pas de filtre : durée conservée, sans padding ni coupe (comme lost-in-time-music.sh).
  ffmpeg -hide_banner -loglevel error -y -i "$ogg" -vn -map_metadata -1 -c:a libmp3lame -b:a 80k -joint_stereo 1 \
    -ar 44100 -ac 2 -write_xing 1 -fflags +bitexact "$tmp/mp3/$nom.mp3"
  nb=$((nb + 1))
done
[ "$nb" -eq 31 ] || { echo "31 pistes attendues, $nb trouvées" >&2; exit 1; }

mkdir -p "$sortie"
rm -f "$sortie"/track*.mp3
mv "$tmp"/mp3/track*.mp3 "$sortie/"
python3 -I "$racine/scripts/manifest.py" "$sortie"
[ -d "$racine/archives/drascula/base" ] && py inventaire "$sortie" "$racine/archives/drascula/base" "$racine/docs/drascula/files.md"
echo "Terminé : $nb pistes dans $sortie ($(du -ch "$sortie"/track*.mp3 | tail -1 | cut -f1))"
