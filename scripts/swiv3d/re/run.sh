#!/usr/bin/env bash
# Régénère le corpus de rétro-ingénierie de SWIV 3D (Ghidra headless) : SWIV_WIN.EXE, PE32 Windows 95
# (version rendu logiciel / MMX).
# Usage : bash scripts/swiv3d/re/run.sh
# Sorties : archives/swiv3d/re/ (non versionné) et les blocs générés de docs/swiv3d/re-index.md.
# Outillage commun (Ghidra, scripts d'export, mode « plat 32 bits » auto-détecté) : scripts/re/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/swiv3d/re"
EXE="$ROOT/archives/swiv3d/cd/GAMEDATA/SWIV_WIN.EXE"
export RE_OUT="$ROOT/archives/swiv3d/re"
PROJECT_NAME="swiv3d"

[ -f "$EXE" ] || { echo "SWIV_WIN.EXE introuvable : $EXE" >&2; exit 1; }

# PE 32 bits plat : ni DGROUP ni segment de bibliothèque (RE_DGROUP / RE_RTL_SEG ne servent pas).
export SWIV3D_KEYFUNCS_DEF="$SCRIPTS/keyfuncs.def.tsv" # fonctions du jeu nommées (NameGameFuncs.java)

source "$ROOT/scripts/re/run-lib.sh"
re_setup_tools

re_run_headless "$EXE" PeLoader "x86:LE:32:default" \
  NamePeImports.java \
  ExportStrings.java \
  NameGameFuncs.java \
  ExportDecompiled.java \
  ExportDisasm.java

re_check_log
re_check_outputs functions.tsv strings.tsv imports.tsv keyfuncs.tsv disasm.txt

python3 -I "$SCRIPTS/make_index.py" "$ROOT"
