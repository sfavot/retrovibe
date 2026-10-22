#!/usr/bin/env bash
# Convertit la piste audio du CD de Lost in Time (FLAC) en MP3 pour le web.
# Usage : scripts/lost-in-time-music.sh /chemin/vers/track01.flac
set -euo pipefail

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: $0 <track01.flac>" >&2
  exit 1
fi

racine="$(cd "$(dirname "$0")/.." && pwd)"
sortie="$racine/original/lost-in-time/MUSIC.mp3"
mkdir -p "$(dirname "$sortie")"

# MP3 stéréo 44,1 kHz, 128 kbps CBR ; en-tête Xing pour un seek précis.
# -fflags +bitexact et pas de filtre : durée conservée, sans padding ni coupe.
ffmpeg -y -i "$1" -vn -map_metadata -1 -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 \
  -write_xing 1 -fflags +bitexact "$sortie"
