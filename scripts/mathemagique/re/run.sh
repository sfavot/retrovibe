#!/usr/bin/env bash
# Régénère tout le corpus de rétro-ingénierie de MATH et des DLL Broderbund (Ghidra headless).
# Usage : bash scripts/mathemagique/re/run.sh
# Sorties : archives/mathemagique/re/ (non versionné) et les blocs générés de docs/mathemagique/re-index.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/mathemagique/re"
CD="$ROOT/archives/mathemagique/cd"
export RE_OUT="$ROOT/archives/mathemagique/re"
PROJECT_DIR="$RE_OUT/project"
PROJECT_NAME="mathemagique"
# Programmes NE analysés (noms de fichiers sur le CD) : le jeu, ses DLL, le lanceur MIDI.
PROGRAMS="MATH BRODFONT.DLL BRODMIDI.DLL BRODPGI.DLL BRODUTIL.DLL BROEMIDI"

for p in $PROGRAMS; do
  [ -f "$CD/$p" ] || { echo "$p introuvable : $CD/$p" >&2; exit 1; }
done

# --- Ghidra et JDK (installés par Homebrew : `brew install ghidra`, qui tire openjdk) -------------
GHIDRA_HOME="${GHIDRA_HOME:-$(brew --prefix ghidra)/libexec}"
[ -x "$GHIDRA_HOME/support/analyzeHeadless" ] || { echo "Ghidra introuvable (brew install ghidra)" >&2; exit 1; }
if [ -z "${JAVA_HOME:-}" ]; then
  for jdk in openjdk@21 openjdk@25 openjdk; do
    cand="$(brew --prefix "$jdk" 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
    if [ -x "$cand/bin/java" ]; then JAVA_HOME="$cand"; break; fi
  done
  export JAVA_HOME
fi
[ -x "${JAVA_HOME:-}/bin/java" ] || { echo "JDK introuvable (brew install openjdk@21)" >&2; exit 1; }

# --- Décompileur natif -------------------------------------------------------------------------
# Le paquet Homebrew ne livre pas le binaire du décompileur (os/<plateforme>/decompile) : on le
# compile depuis les sources fournies avec Ghidra (une fois, ~15 s).
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  OSDIR=mac_arm_64;  ARCH="-arch arm64" ;;
  Darwin-x86_64) OSDIR=mac_x86_64;  ARCH="-arch x86_64" ;;
  Linux-x86_64)  OSDIR=linux_x86_64; ARCH="" ;;
  *) echo "plateforme non gérée : $(uname -sm)" >&2; exit 1 ;;
esac
DECOMP_DIR="$GHIDRA_HOME/Ghidra/Features/Decompiler/os/$OSDIR"
if [ ! -x "$DECOMP_DIR/decompile" ]; then
  echo "== Compilation du décompileur natif ($OSDIR) =="
  TMP="$(mktemp -d)"
  cp -R "$GHIDRA_HOME/Ghidra/Features/Decompiler/src/decompile/cpp" "$TMP/cpp"
  (cd "$TMP/cpp" && make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" ghidra_opt ARCH_TYPE="$ARCH" >/dev/null)
  mkdir -p "$DECOMP_DIR"
  cp "$TMP/cpp/ghidra_opt" "$DECOMP_DIR/decompile"
  chmod +x "$DECOMP_DIR/decompile"
  rm -rf "$TMP"
fi

# --- Exports NE et ressources (Python, avant Ghidra : les exports nomment les imports) -----------
mkdir -p "$RE_OUT"
python3 -I "$SCRIPTS/ne_dump.py" "$CD" "$RE_OUT" $PROGRAMS

# --- Import + analyse + exports, un programme à la fois dans le même projet ----------------------
mkdir -p "$PROJECT_DIR"
: > "$RE_OUT/run.log"
START=$(date +%s)
for p in $PROGRAMS; do
  base="${p%.*}"
  export RE_PROG="$base"
  mkdir -p "$RE_OUT/$base"
  rm -rf "$RE_OUT/$base/decomp"
  echo "== $p =="
  "$GHIDRA_HOME/support/analyzeHeadless" "$PROJECT_DIR" "$PROJECT_NAME" \
    -import "$CD/$p" -overwrite \
    -scriptPath "$SCRIPTS" \
    -postScript SeedFunctions.java \
    -postScript ExportStrings.java \
    -postScript ExportImports.java \
    -postScript ExportTags.java \
    -postScript ExportDecompiled.java \
    -postScript ExportDisasm.java \
    -analysisTimeoutPerFile 1800 \
    2>&1 | tee -a "$RE_OUT/run.log" | grep -E "(^|> )(ERROR|\[re\])|error:" || true
done
RE_DURATION_S=$(( $(date +%s) - START ))
export RE_DURATION_S
echo "== Ghidra terminé en $RE_DURATION_S s =="

# --- Vérifications : un script Ghidra en erreur n'arrête pas analyzeHeadless ---------------------
if /usr/bin/grep -q "SCRIPT ERROR" "$RE_OUT/run.log"; then
  echo "Un script Ghidra a échoué : voir $RE_OUT/run.log" >&2
  exit 1
fi
for p in $PROGRAMS; do
  base="${p%.*}"
  for f in functions.tsv strings.tsv imports.tsv tags.tsv disasm.txt; do
    [ -f "$RE_OUT/$base/$f" ] || { echo "sortie manquante : $base/$f" >&2; exit 1; }
  done
  NFUNC=$(( $(wc -l < "$RE_OUT/$base/functions.tsv") - 1 ))
  NFILES=$(find "$RE_OUT/$base/decomp" -name '*.c' | wc -l)
  [ "$NFUNC" -gt 0 ] && [ "$NFUNC" -eq "$NFILES" ] || { echo "$base/decomp : $NFILES fichiers pour $NFUNC fonctions" >&2; exit 1; }
done
[ "$(wc -l < "$RE_OUT/MATH/tags.tsv")" -gt 1 ] || { echo "MATH/tags.tsv est vide" >&2; exit 1; }

# --- Blocs générés de docs/ ----------------------------------------------------------------------
python3 -I "$SCRIPTS/make_index.py" "$ROOT"
