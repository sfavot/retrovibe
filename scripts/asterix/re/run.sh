#!/usr/bin/env bash
# Régénère tout le corpus de rétro-ingénierie d'ASTERIX.EXE (Ghidra headless).
# Usage : bash scripts/asterix/re/run.sh
# Sorties : archives/asterix/re/ (non versionné) et les blocs générés de docs/asterix/re-index.md.
# Outillage commun (Ghidra, scripts d'export) : scripts/re/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/asterix/re"
EXE="$ROOT/original/asterix/ASTERIX.EXE"
export RE_OUT="$ROOT/archives/asterix/re"
PROJECT_NAME="asterix"

# Particularités du jeu lues par scripts/re/ReCommon.java (DGROUP : détecté par le startup Borland, 2de2)
export RE_RTL_SEG=1000                                  # code Borland (startup + bibliothèque)
export RE_STR_ALIAS_REGEX='[mM][0-9][0-9].{2,}'         # noms de fichiers de module précédés d'octets parasites
export ASTERIX_LIBS_DEF="$SCRIPTS/libs.def.tsv"         # fonctions de bibliothèque identifiées (IdentifyLibs.java)
export ASTERIX_KEYFUNCS_DEF="$SCRIPTS/keyfuncs.def.tsv" # fonctions du moteur et du jeu nommées (NameGameFuncs.java)

[ -f "$EXE" ] || { echo "ASTERIX.EXE introuvable : $EXE" >&2; exit 1; }

source "$ROOT/scripts/re/run-lib.sh"
re_setup_tools

re_run_headless "$EXE" MzLoader "x86:LE:16:Real Mode" \
  pre:SetDS.java \
  SeedFunctions.java \
  ExportStrings.java \
  IdentifyLibs.java \
  NameGameFuncs.java \
  ExportModuleEntries.java \
  ExportDecompiled.java \
  ExportDisasm.java

re_check_log
re_check_outputs functions.tsv strings.tsv libfuncs.tsv keyfuncs.tsv module_entries.tsv disasm.txt

# --- Blocs générés de docs/asterix/re-index.md -------------------------------------------------
python3 -I "$SCRIPTS/make_index.py" "$ROOT"
