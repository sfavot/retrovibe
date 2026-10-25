#!/usr/bin/env bash
# Régénère tout le corpus de rétro-ingénierie de SMURF.EXE (Ghidra headless).
# Usage : bash scripts/teleportaschtroumpf/re/run.sh
# Sorties : archives/teleportaschtroumpf/re/ (non versionné) et les blocs générés de docs/teleportaschtroumpf/re-index.md.
# Outillage commun (Ghidra, scripts d'export) : scripts/re/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/teleportaschtroumpf/re"
EXE="$ROOT/original/teleportaschtroumpf/SMURF.EXE"
export RE_OUT="$ROOT/archives/teleportaschtroumpf/re"
PROJECT_NAME="smurf"

# Particularités du jeu lues par scripts/re/ReCommon.java (DGROUP : détecté par le startup Borland)
export RE_RTL_SEG=1000                                # code Borland (startup + bibliothèque)
export RE_STR_ALIAS_REGEX='[sS][0-9][0-9].{2,}'       # noms de fichiers de scène précédés d'octets parasites

[ -f "$EXE" ] || { echo "SMURF.EXE introuvable : $EXE" >&2; exit 1; }

source "$ROOT/scripts/re/run-lib.sh"
re_setup_tools

re_run_headless "$EXE" MzLoader "x86:LE:16:Real Mode" \
  pre:SetDS.java \
  SeedFunctions.java \
  ExportStrings.java \
  IdentifyLibs.java \
  ExportSceneEntries.java \
  ExportDecompiled.java \
  ExportDisasm.java

re_check_log
re_check_outputs functions.tsv strings.tsv libfuncs.tsv disasm.txt scene_entries.tsv

# --- Table des scènes dans docs/ ---------------------------------------------------------------
python3 -I "$SCRIPTS/make_index.py" "$ROOT"
