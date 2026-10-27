#!/usr/bin/env bash
# Régénère le corpus de rétro-ingénierie de ZOOMBINI.EXE et de son lanceur MIDI (Ghidra headless).
# Usage : bash scripts/zoombinis/re/run.sh
# Sorties : archives/zoombinis/re/ (non versionné) et les blocs générés de docs/zoombinis/re-index.md.
# Tout l'outillage NE / Mohawk est commun (scripts/re/, partagé avec Mathémagique) ; ici, la liste des programmes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/zoombinis/re"
CD="$ROOT/archives/zoombinis/cd"
export RE_OUT="$ROOT/archives/zoombinis/re"
PROJECT_NAME="zoombinis"
# Programmes NE analysés (noms de fichiers sur le CD) : le jeu (ZOOMBINI._EX, identique au ZOOMBINI.EXE installé) et le lanceur MIDI.
PROGRAMS="ZOOMBINI._EX BROEMIDI"

for p in $PROGRAMS; do
  [ -f "$CD/$p" ] || { echo "$p introuvable : $CD/$p (lancer scripts/zoombinis-extract.sh)" >&2; exit 1; }
done

source "$ROOT/scripts/re/run-lib.sh"
re_setup_tools

# --- Exports NE et ressources (Python, avant Ghidra : les exports nomment les imports) -----------
mkdir -p "$RE_OUT"
python3 -I "$ROOT/scripts/re/ne_dump.py" "$CD" "$RE_OUT" $PROGRAMS

# --- Import + analyse + exports, un programme à la fois dans le même projet ----------------------
: > "$RE_OUT/run.log"
export RE_LOG_APPEND=1
START=$(date +%s)
for p in $PROGRAMS; do
  export RE_PROG="${p%.*}"
  echo "== $p =="
  re_run_headless "$CD/$p" "" "" \
    SeedFunctions.java \
    ExportStrings.java \
    ExportImports.java \
    ExportTags.java \
    ExportDecompiled.java \
    ExportDisasm.java
done
RE_DURATION_S=$(( $(date +%s) - START ))
export RE_DURATION_S
echo "== Ghidra terminé en $RE_DURATION_S s =="

# --- Vérifications : un script Ghidra en erreur n'arrête pas analyzeHeadless ---------------------
re_check_log
for p in $PROGRAMS; do
  export RE_PROG="${p%.*}"
  re_check_outputs functions.tsv strings.tsv imports.tsv tags.tsv disasm.txt
done
unset RE_PROG
[ "$(wc -l < "$RE_OUT/ZOOMBINI/tags.tsv")" -gt 1 ] || { echo "ZOOMBINI/tags.tsv est vide" >&2; exit 1; }

# --- Blocs générés de docs/ ----------------------------------------------------------------------
python3 -I "$SCRIPTS/make_index.py" "$ROOT"
