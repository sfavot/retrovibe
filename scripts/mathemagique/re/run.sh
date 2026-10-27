#!/usr/bin/env bash
# Régénère tout le corpus de rétro-ingénierie de MATH et des DLL Broderbund (Ghidra headless).
# Usage : bash scripts/mathemagique/re/run.sh
# Sorties : archives/mathemagique/re/ (non versionné) et les blocs générés de docs/mathemagique/re-index.md.
# Outillage commun (Ghidra, scripts d'export) : scripts/re/ ; ici, seulement ce qui est propre aux exécutables NE (Win16).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/mathemagique/re"
CD="$ROOT/archives/mathemagique/cd"
export RE_OUT="$ROOT/archives/mathemagique/re"
PROJECT_NAME="mathemagique"
# Programmes NE analysés (noms de fichiers sur le CD) : le jeu, ses DLL, le lanceur MIDI.
PROGRAMS="MATH BRODFONT.DLL BRODMIDI.DLL BRODPGI.DLL BRODUTIL.DLL BROEMIDI"

for p in $PROGRAMS; do
  [ -f "$CD/$p" ] || { echo "$p introuvable : $CD/$p" >&2; exit 1; }
done

source "$ROOT/scripts/re/run-lib.sh"
re_setup_tools

# --- Exports NE et ressources (Python, avant Ghidra : les exports nomment les imports) -----------
mkdir -p "$RE_OUT"
python3 -I "$ROOT/scripts/re/ne_dump.py" "$CD" "$RE_OUT" $PROGRAMS

# --- Import + analyse + exports, un programme à la fois dans le même projet ----------------------
# Le loader et le processeur sont détectés par Ghidra (NE) ; sorties dans $RE_OUT/<programme>/ (RE_PROG).
: > "$RE_OUT/run.log"
export RE_LOG_APPEND=1
START=$(date +%s)
for p in $PROGRAMS; do
  export RE_PROG="${p%.*}"
  # Table des scènes de MATH (docs/mathemagique/engine.md §1.4), amorcée et nommée par SeedFunctions.java.
  if [ "$RE_PROG" = MATH ]; then
    export RE_SCENE_TABLE=1108:1b22 RE_SCENE_NAMES=hub,bowling,rhythm,patwin,hidden,patterns,sticklers,rockets,title,credits,trophy
  else
    unset RE_SCENE_TABLE RE_SCENE_NAMES
  fi
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
[ "$(wc -l < "$RE_OUT/MATH/tags.tsv")" -gt 1 ] || { echo "MATH/tags.tsv est vide" >&2; exit 1; }

# --- Blocs générés de docs/ ----------------------------------------------------------------------
python3 -I "$SCRIPTS/make_index.py" "$ROOT"
