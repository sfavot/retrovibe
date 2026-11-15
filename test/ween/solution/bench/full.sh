#!/bin/bash
# Rejoue des entrées GOB_INPUT au banc ScummVM et écrit les VH masqués image par image (vh.txt) et les TT (tt.txt).
# Usage : full.sh ENTREES DERNIERE_IMAGE SORTIE [SECONDES]
# Variables : SCUMMVM (binaire patché), WEEN_GAME_DIR (dossier du jeu) ; voir scripts/ween/bench/README.md.
# Un seul ScummVM à la fois ; voir docs/ween/walkthrough.md, « Comparaison au banc ».
IN=$1; STOP=$2; OUT=$3; MAX=${4:-1800}
HERE=$(cd "$(dirname "$0")" && pwd)
: "${SCUMMVM:?binaire ScummVM patché}" "${WEEN_GAME_DIR:?dossier du jeu}"
DUMP=1-$STOP "$HERE/../../../../scripts/ween/bench/ween-replay.sh" "$OUT" "$STOP" "$IN" "$MAX" > /dev/null
