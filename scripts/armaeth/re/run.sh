#!/usr/bin/env bash
# Régénère tout le corpus de rétro-ingénierie d'Armaeth (Ghidra headless) : AM1.EXE (le moteur) puis
# VGA.EXE (le pilote vidéo résident).
# Usage : bash scripts/armaeth/re/run.sh
# Sorties : archives/armaeth/re/ (non versionné) et les blocs générés de docs/armaeth/re-index.md.
# Outillage commun (Ghidra, scripts d'export) : scripts/re/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/armaeth/re"
EXE="$ROOT/original/armaeth/AM1.EXE"
export RE_OUT="$ROOT/archives/armaeth/re"
PROJECT_NAME="armaeth"

[ -f "$EXE" ] || { echo "AM1.EXE introuvable : $EXE" >&2; exit 1; }

# DGROUP : le startup Microsoft C commence par « MOV AH,30h ; INT 21h ... MOV DI,seg DGROUP ; MOV SI,[2] ;
# SUB SI,DI » (bf <seg> 8b 36 02 00 2b f7). Le segment du fichier est relatif ; Ghidra charge l'image en 1000.
dgroup_of() {
  python3 -I - "$1" <<'PY'
import re, struct, sys
d = open(sys.argv[1], "rb").read()
m = re.search(rb"\xbf(..)\x8b\x36\x02\x00\x2b\xf7", d)
if not m:
    sys.exit("startup Microsoft C introuvable dans " + sys.argv[1])
print("%04x" % (struct.unpack("<H", m.group(1))[0] + 0x1000))
PY
}
export RE_DGROUP="$(dgroup_of "$EXE")"
export RE_RTL_SEG=3938                                 # startup + bibliothèque C Microsoft (3938:0000..4c3f)
export ARMAETH_LIBS_DEF="$SCRIPTS/libs.def.tsv"        # fonctions de bibliothèque identifiées (IdentifyLibs.java)
export ARMAETH_KEYFUNCS_DEF="$SCRIPTS/keyfuncs.def.tsv" # fonctions du jeu nommées (NameGameFuncs.java)

source "$ROOT/scripts/re/run-lib.sh"
re_setup_tools

re_run_headless "$EXE" MzLoader "x86:LE:16:Real Mode" \
  pre:SetDS.java \
  SeedFunctions.java \
  ExportStrings.java \
  IdentifyLibs.java \
  NameGameFuncs.java \
  ExportDecompiled.java \
  ExportDisasm.java

re_check_log
re_check_outputs functions.tsv strings.tsv libfuncs.tsv keyfuncs.tsv disasm.txt
export RE_DURATION_AM1_S="$RE_DURATION_S"

# --- Second programme : VGA.EXE, le pilote vidéo résident (TSR), sorties dans archives/armaeth/re/vga/.
# Mêmes scripts, autres tables de noms (vga-libs.def.tsv, vga-keyfuncs.def.tsv). Petit modèle : un seul
# segment de code, startup Microsoft C identique ; le code de bibliothèque n'a pas de segment à part
# (RE_RTL_SEG vide).
VGA_EXE="$ROOT/archives/armaeth/cd/ARMAETH.FRE/VGA.EXE"
[ -f "$VGA_EXE" ] || { echo "VGA.EXE introuvable : $VGA_EXE" >&2; exit 1; }
AM1_OUT="$RE_OUT"
export RE_OUT="$AM1_OUT/vga"
PROJECT_NAME="armaeth-vga"
export RE_DGROUP="$(dgroup_of "$VGA_EXE")"
export RE_RTL_SEG=""
export ARMAETH_LIBS_DEF="$SCRIPTS/vga-libs.def.tsv"
export ARMAETH_KEYFUNCS_DEF="$SCRIPTS/vga-keyfuncs.def.tsv"

re_run_headless "$VGA_EXE" MzLoader "x86:LE:16:Real Mode" \
  pre:SetDS.java \
  SeedFunctions.java \
  ExportStrings.java \
  IdentifyLibs.java \
  NameGameFuncs.java \
  ExportDecompiled.java \
  ExportDisasm.java

re_check_log
re_check_outputs functions.tsv strings.tsv libfuncs.tsv keyfuncs.tsv disasm.txt
export RE_DURATION_VGA_S="$RE_DURATION_S"

python3 -I "$SCRIPTS/make_index.py" "$ROOT"
