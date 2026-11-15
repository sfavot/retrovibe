#!/bin/bash
# Référence de la partie : joue la solution au portage (make-reference.test.ts), la rejoue au banc (full.sh),
# compare image par image et, si tout est identique, écrit test/ween/fixtures/full-game.json.
# Usage : ref.sh DOSSIER_DE_TRAVAIL
R=${1:?dossier de travail}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../../.." && pwd)
mkdir -p "$R"; rm -f "$R"/port-*.txt
(cd "$ROOT" && WEEN_MAKE_REF=$R npx vitest run test/ween/solution/make-reference.test.ts > "$R/make-reference.log" 2>&1) || { echo "make-reference : échec ($R/make-reference.log)"; exit 1; }
"$HERE/full.sh" "$R/inputs.txt" "$(wc -l < "$R/port-vh.txt" | tr -d ' ')" "$R/bench" 3600
cp "$R/bench/vh.txt" "$R/bench/tt.txt" "$R/"
node "$HERE/compare.mjs" "$R" "$ROOT/test/ween/fixtures/full-game.json"
