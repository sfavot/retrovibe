#!/usr/bin/env bash
# Régénère tout le corpus de rétro-ingénierie de SMURF.EXE (Ghidra headless).
# Usage : bash scripts/teleportaschtroumpf/re/run.sh
# Sorties : archives/teleportaschtroumpf/re/ (non versionné) et la table de docs/teleportaschtroumpf/re-index.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="$ROOT/scripts/teleportaschtroumpf/re"
EXE="$ROOT/original/teleportaschtroumpf/SMURF.EXE"
export RE_OUT="$ROOT/archives/teleportaschtroumpf/re"
PROJECT_DIR="$RE_OUT/project"
PROJECT_NAME="smurf"

[ -f "$EXE" ] || { echo "SMURF.EXE introuvable : $EXE" >&2; exit 1; }

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

# --- Import + analyse + exports ----------------------------------------------------------------
mkdir -p "$PROJECT_DIR"
rm -rf "$RE_OUT/decomp"
START=$(date +%s)
"$GHIDRA_HOME/support/analyzeHeadless" "$PROJECT_DIR" "$PROJECT_NAME" \
  -import "$EXE" -overwrite \
  -loader MzLoader -processor "x86:LE:16:Real Mode" \
  -scriptPath "$SCRIPTS" \
  -preScript SetDS.java \
  -postScript SeedFunctions.java \
  -postScript ExportStrings.java \
  -postScript IdentifyLibs.java \
  -postScript ExportSceneEntries.java \
  -postScript ExportDecompiled.java \
  -postScript ExportDisasm.java \
  -analysisTimeoutPerFile 1800 \
  2>&1 | tee "$RE_OUT/run.log" | grep -E "(^|> )(ERROR|passe |fonctions|DGROUP|\[re\])" || true
RE_DURATION_S=$(( $(date +%s) - START ))
export RE_DURATION_S
echo "== Ghidra terminé en $RE_DURATION_S s =="

# --- Vérifications : un script Ghidra en erreur n'arrête pas analyzeHeadless ---------------------
if /usr/bin/grep -q "SCRIPT ERROR" "$RE_OUT/run.log"; then
  echo "Un script Ghidra a échoué : voir $RE_OUT/run.log" >&2
  exit 1
fi
for f in functions.tsv strings.tsv libfuncs.tsv disasm.txt scene_entries.tsv; do
  [ -s "$RE_OUT/$f" ] || { echo "sortie manquante : $f" >&2; exit 1; }
done
NFUNC=$(( $(wc -l < "$RE_OUT/functions.tsv") - 1 ))
NFILES=$(find "$RE_OUT/decomp" -name '*.c' | wc -l)
[ "$NFUNC" -eq "$NFILES" ] || { echo "decomp/ : $NFILES fichiers pour $NFUNC fonctions" >&2; exit 1; }

# --- Table des scènes dans docs/ ---------------------------------------------------------------
python3 -I "$SCRIPTS/make_index.py" "$ROOT"
