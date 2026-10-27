# Bibliothèque shell de la rétro-ingénierie Ghidra headless (à SOURCER depuis scripts/<jeu>/re/run.sh).
# Ghidra et le JDK viennent de Homebrew (`brew install ghidra`, qui tire openjdk).
#
# Un run.sh de jeu :
#   1. définit ROOT, SCRIPTS (son dossier), EXE, RE_OUT, PROJECT_NAME et, si besoin, les variables
#      RE_DGROUP / RE_RTL_SEG / RE_STR_ALIAS_REGEX (voir scripts/re/ReCommon.java) ;
#   2. source ce fichier, puis appelle re_setup_tools, re_run_headless, re_check_log, re_check_outputs ;
#   3. lance son make_index.py.
# Ghidra compile chaque dossier de scripts comme un bundle isolé : les classes d'un dossier ne voient pas
# celles d'un autre. re_run_headless assemble donc les scripts partagés (scripts/re/*.java) et ceux du
# jeu ($SCRIPTS/*.java, qui l'emportent en cas de même nom) dans $RE_OUT/scripts, copie jetable.

RE_SHARED="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Trouve Ghidra et un JDK ; exporte GHIDRA_HOME et JAVA_HOME ; compile le décompileur natif au besoin.
re_setup_tools() {
  GHIDRA_HOME="${GHIDRA_HOME:-$(brew --prefix ghidra)/libexec}"
  [ -x "$GHIDRA_HOME/support/analyzeHeadless" ] || { echo "Ghidra introuvable (brew install ghidra)" >&2; return 1; }
  if [ -z "${JAVA_HOME:-}" ]; then
    local jdk cand
    for jdk in openjdk@21 openjdk@25 openjdk; do
      cand="$(brew --prefix "$jdk" 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
      if [ -x "$cand/bin/java" ]; then JAVA_HOME="$cand"; break; fi
    done
  fi
  [ -x "${JAVA_HOME:-}/bin/java" ] || { echo "JDK introuvable (brew install openjdk@21)" >&2; return 1; }
  export GHIDRA_HOME JAVA_HOME

  # Le paquet Homebrew ne livre pas le binaire du décompileur (os/<plateforme>/decompile) : on le
  # compile depuis les sources fournies avec Ghidra (une fois, ~15 s).
  local osdir arch
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  osdir=mac_arm_64;  arch="-arch arm64" ;;
    Darwin-x86_64) osdir=mac_x86_64;  arch="-arch x86_64" ;;
    Linux-x86_64)  osdir=linux_x86_64; arch="" ;;
    *) echo "plateforme non gérée : $(uname -sm)" >&2; return 1 ;;
  esac
  local decomp_dir="$GHIDRA_HOME/Ghidra/Features/Decompiler/os/$osdir"
  if [ ! -x "$decomp_dir/decompile" ]; then
    echo "== Compilation du décompileur natif ($osdir) =="
    local tmp
    tmp="$(mktemp -d)"
    cp -R "$GHIDRA_HOME/Ghidra/Features/Decompiler/src/decompile/cpp" "$tmp/cpp"
    (cd "$tmp/cpp" && make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" ghidra_opt ARCH_TYPE="$arch" >/dev/null)
    mkdir -p "$decomp_dir"
    cp "$tmp/cpp/ghidra_opt" "$decomp_dir/decompile"
    chmod +x "$decomp_dir/decompile"
    rm -rf "$tmp"
  fi
}

# re_run_headless EXE LOADER PROCESSOR SCRIPT...
#   Importe EXE dans $RE_OUT/project (projet $PROJECT_NAME), l'analyse puis enchaîne les scripts dans
#   l'ordre. SCRIPT = « Nom.java » (post-script) ou « pre:Nom.java » (pre-script, avant l'analyse).
#   LOADER / PROCESSOR vides : Ghidra les détecte (exécutables NE).
#   Utilise $SCRIPTS (dossier du jeu), $RE_OUT (assemble $RE_OUT/scripts), $PROJECT_NAME ; écrit $RE_OUT/run.log, supprime
#   $RE_OUT/decomp, exporte RE_DURATION_S.
#   Plusieurs programmes dans un même corpus (Win16) : RE_PROG = sous-dossier de $RE_OUT où vont les sorties
#   (decomp/ y est supprimé), RE_LOG_APPEND non vide = le journal $RE_OUT/run.log est complété au lieu d'être écrasé.
re_run_headless() {
  local exe="$1" loader="$2" processor="$3"; shift 3
  local project_dir="$RE_OUT/project" args=() lp_args=() tee_args=() s
  for s in "$@"; do
    case "$s" in
      pre:*) args+=(-preScript "${s#pre:}") ;;
      *)     args+=(-postScript "$s") ;;
    esac
  done
  [ -n "$loader" ] && lp_args+=(-loader "$loader")
  [ -n "$processor" ] && lp_args+=(-processor "$processor")
  [ -n "${RE_LOG_APPEND:-}" ] && tee_args=(-a)
  export RE_OUT
  mkdir -p "$project_dir"
  local stage="$RE_OUT/scripts"
  rm -rf "$stage"
  mkdir -p "$stage"
  cp "$RE_SHARED"/*.java "$stage"/
  # scripts propres au jeu, facultatifs (Zoombinis n'utilise que les scripts communs)
  for s in "$SCRIPTS"/*.java; do
    [ -e "$s" ] && cp "$s" "$stage"/
  done
  rm -rf "$RE_OUT${RE_PROG:+/$RE_PROG}/decomp"
  local start
  start=$(date +%s)
  "$GHIDRA_HOME/support/analyzeHeadless" "$project_dir" "$PROJECT_NAME" \
    -import "$exe" -overwrite \
    ${lp_args[@]+"${lp_args[@]}"} \
    -scriptPath "$stage" \
    "${args[@]}" \
    -analysisTimeoutPerFile 1800 \
    2>&1 | tee ${tee_args[@]+"${tee_args[@]}"} "$RE_OUT/run.log" | grep -E "(^|> )(ERROR|passe |fonctions|DGROUP|\[re\])" || true
  RE_DURATION_S=$(( $(date +%s) - start ))
  export RE_DURATION_S
  echo "== Ghidra terminé en $RE_DURATION_S s =="
}

# Un script Ghidra en erreur n'arrête pas analyzeHeadless : on le cherche dans le journal.
re_check_log() {
  if /usr/bin/grep -q "SCRIPT ERROR" "$RE_OUT/run.log"; then
    echo "Un script Ghidra a échoué : voir $RE_OUT/run.log" >&2
    return 1
  fi
}

# re_check_outputs FICHIER... : sorties non vides (dans $RE_OUT, ou $RE_OUT/$RE_PROG), et un fichier decomp/*.c par
# fonction de functions.tsv.
re_check_outputs() {
  local f nfunc nfiles out="$RE_OUT${RE_PROG:+/$RE_PROG}"
  for f in "$@"; do
    [ -s "$out/$f" ] || { echo "sortie manquante : $f" >&2; return 1; }
  done
  nfunc=$(( $(wc -l < "$out/functions.tsv") - 1 ))
  nfiles=$(find "$out/decomp" -name '*.c' | wc -l)
  [ "$nfunc" -eq "$nfiles" ] || { echo "decomp/ : $nfiles fichiers pour $nfunc fonctions" >&2; return 1; }
}
