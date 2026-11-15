#!/bin/bash
# Rejoue des entrées GOB_INPUT au banc ScummVM et écrit les VH masqués image par image (vh.txt) et les TT (tt.txt).
# Usage : full.sh ENTREES DERNIERE_IMAGE SORTIE [SECONDES]
# Variables : WEEN_BENCH (dossier scummvm-build du banc), WEEN_BENCH_INI (copie privée de cfg/ween.ini).
# Un seul ScummVM à la fois ; voir docs/ween/walkthrough.md, « Comparaison au banc ».
IN=$1; STOP=$2; OUT=$3; MAX=${4:-1800}
HERE=$(cd "$(dirname "$0")" && pwd)
: "${WEEN_BENCH:?dossier scummvm-build du banc}" "${WEEN_BENCH_INI:?configuration privée}"
rm -rf "$OUT"; mkdir -p "$OUT"
# scénario du banc qui ne fait qu'attendre (celui du banc, `ween-replay.txt`, quitte après 600 s de jeu)
printf 'realmouse\nwait 86400000\nquit\n' > "$OUT/scenario.txt"
SKY_VIRTUAL_TIME=1 GOB_VIRTUAL_AUDIO=1 GOB_TRACE=1 GOB_DUMP=1-$STOP GOB_INPUT=$IN GOB_STOP_FRAME=$STOP \
SDL_RENDER_DRIVER=software SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
BENCH_SCRIPT="$OUT/scenario.txt" BENCH_OUT="$OUT" \
  perl -e 'alarm shift; exec @ARGV' "$MAX" "$WEEN_BENCH/out/scummvm" -c "$WEEN_BENCH_INI" --random-seed=1 --subtitles \
  --savepath="$OUT" ween-fr 2>&1 >/dev/null | node "$HERE/vhfilter.mjs" "$OUT"
