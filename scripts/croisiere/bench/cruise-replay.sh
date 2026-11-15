#!/usr/bin/env bash
# Rejoue dans ScummVM `cruise` patché (scummvm-cruise-bench.patch) les entrées par tour d'une partie (CRUISE_INPUT) jusqu'au tour STOP :
# cible cruise-fr, graine 1, temps virtuel, contournement de la protection. Mode d'emploi : README.md (même dossier).
# Usage : cruise-replay.sh INPUTS DOSSIER STOP [NIVEAU] [DELAI_MAX_S]   (chemins absolus)
# Requis : SCUMMVM (binaire patché), CRUISE_GAME_DIR (dossier `Croisier` extrait de l'installeur, voir README.md).
# Facultatif : NOSKIP=1 (garder la protection), KEYS (fichier CRUISE_KEYS), SHOTS (CRUISE_SHOT_FRAMES), DUMPVARS (a-b), SEED ;
# CRUISE_PROT_CHEAT, CRUISE_DUMPBSS, CRUISE_DUMP_OVL sont transmises telles quelles.
# Sortie : DOSSIER/cruise.trace (lignes FR/SS/NF/RN/PL/RL/CL/AC/OP/VH/SC/MF/DV/PROT), DOSSIER/scummvm.err (brut), DOSSIER/shots.
# Ne jamais lancer deux instances sur le même DOSSIER. La configuration est un fichier dédié, copié par lancement (ScummVM le réécrit en
# sortant) : la configuration ScummVM de l'utilisateur n'est jamais lue.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
: "${SCUMMVM:?SCUMMVM = chemin du binaire ScummVM patché}"
: "${CRUISE_GAME_DIR:?CRUISE_GAME_DIR = dossier du jeu extrait de l installeur}"
IN=$1; OUT=$2; STOP=$3; LVL=${4:-1}; MAX=${5:-3600}
mkdir -p "$OUT/shots"
sed "s#@GAME_DIR@#$CRUISE_GAME_DIR#" "$here/scummvm.ini.in" > "$OUT/scummvm.ini"
[ -z "${NOSKIP:-}" ] && export CRUISE_SKIP_PROTECTION=1
[ -n "${KEYS:-}" ] && export CRUISE_KEYS="$KEYS"
[ -n "${SHOTS:-}" ] && export CRUISE_SHOT_FRAMES="$SHOTS" CRUISE_SHOT_DIR="$OUT/shots"
[ -n "${DUMPVARS:-}" ] && export CRUISE_DUMPVARS="$DUMPVARS"
CRUISE_TRACE=$LVL CRUISE_VARHASH=1 CRUISE_INPUT="$IN" CRUISE_STOP_FRAME=$STOP CRUISE_VIRTUAL_TIME=1 \
  SDL_RENDER_DRIVER=software SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  "$SCUMMVM" -c "$OUT/scummvm.ini" --random-seed="${SEED:-1}" --savepath="$OUT" cruise-fr 2> "$OUT/scummvm.err" > "$OUT/scummvm.out" &
PID=$!
for ((i = 0; i < MAX * 10; i++)); do kill -0 $PID 2>/dev/null || break; sleep 0.1; done
kill $PID 2>/dev/null && echo "timeout" >> "$OUT/scummvm.err"
grep -E "^(FR|MF|SS|NF|RN|PL|RL|CL|AC|OP|VH|SC|DV|PC|BH|BS|PROT) " "$OUT/scummvm.err" > "$OUT/cruise.trace" || true
grep -E "^bench: " "$OUT/scummvm.err" | head || true
echo "frames $(grep -c '^FR' "$OUT/cruise.trace") lines $(wc -l < "$OUT/cruise.trace")"
