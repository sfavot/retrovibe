#!/usr/bin/env bash
# Rejoue dans ScummVM `gob` patché (scummvm-ween-bench.patch) une partie de Ween : cible ween-fr, graine 1, temps virtuel, sans fenêtre.
# Mode d'emploi : README.md (même dossier).
# Usage : ween-replay.sh DOSSIER STOP [ENTREES] [DELAI_MAX_S]   (chemins absolus ; ENTREES au format GOB_INPUT, facultatif)
# Requis : SCUMMVM (binaire patché), WEEN_GAME_DIR (dossier du jeu : INTRO.STK, WEEN.EXE... extraits de l'installeur).
# Facultatif : TRACE (GOB_TRACE, défaut 1), SHOTS (GOB_SHOT_FRAMES : captures dans DOSSIER/shots), DUMP (GOB_DUMP=a-b : vidage des variables,
# filtré en vh.txt/tt.txt par test/ween/solution/bench/vhfilter.mjs), SCENARIO (BENCH_SCRIPT ; défaut : un scénario qui ne fait qu'attendre,
# les entrées venant de GOB_INPUT), SEED (défaut 1).
# Sorties : DOSSIER/ween.trace (lignes TT/TX/PS/WK/GB/VH/OP/DL), DOSSIER/vh.txt + tt.txt si DUMP, DOSSIER/shots/, DOSSIER/scummvm.out.
# Ne jamais lancer deux instances sur la même configuration (ScummVM la réécrit en sortant) : la configuration est un fichier dédié, copié
# dans DOSSIER à chaque lancement ; la configuration ScummVM de l'utilisateur n'est jamais lue. Un seul DOSSIER par lancement.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
root="$(cd "$here/../../.." && pwd -P)"
: "${SCUMMVM:?SCUMMVM = chemin du binaire ScummVM patché}"
: "${WEEN_GAME_DIR:?WEEN_GAME_DIR = dossier du jeu extrait de l installeur}"
OUT=$1; STOP=$2; IN=${3:-}; MAX=${4:-1800}
rm -rf "${OUT:?}"; mkdir -p "$OUT/shots"
sed "s#@GAME_DIR@#$WEEN_GAME_DIR#" "$here/ween.ini.in" > "$OUT/scummvm.ini"
if [ -n "${SCENARIO:-}" ]; then scen=$SCENARIO; else
  scen="$OUT/scenario.txt"; printf 'realmouse\nwait 86400000\nquit\n' > "$scen"   # attend ; GOB_STOP_FRAME met fin au lancement
fi
export SKY_VIRTUAL_TIME=1 GOB_VIRTUAL_AUDIO=1 GOB_TRACE="${TRACE:-1}" GOB_STOP_FRAME="$STOP"
[ -n "$IN" ] && export GOB_INPUT="$IN"
[ -n "${SHOTS:-}" ] && export GOB_SHOT_FRAMES="$SHOTS" GOB_SHOT_DIR="$OUT/shots"
[ -n "${DUMP:-}" ] && export GOB_DUMP="$DUMP"
if [ -n "${DUMP:-}" ]; then filter=(node "$root/test/ween/solution/bench/vhfilter.mjs" "$OUT")
else filter=(grep -a -E "^(TT|TX|PS|WK|GB|VH|OP|DL) "); fi
# perl `alarm` : le lancement est tué à l'échéance (pas d'instance orpheline).
SDL_RENDER_DRIVER=software SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy BENCH_SCRIPT="$scen" BENCH_OUT="$OUT" \
  perl -e 'alarm shift; exec @ARGV' "$MAX" "$SCUMMVM" -c "$OUT/scummvm.ini" --random-seed="${SEED:-1}" --subtitles \
  --savepath="$OUT" ween-fr 2>&1 >"$OUT/scummvm.out" | "${filter[@]}" > "$( [ -n "${DUMP:-}" ] && echo /dev/null || echo "$OUT/ween.trace" )" || true
echo "trace $(wc -l < "$OUT/ween.trace" 2>/dev/null || echo 0) lignes, captures $(ls "$OUT/shots" | wc -l | tr -d ' ')"
