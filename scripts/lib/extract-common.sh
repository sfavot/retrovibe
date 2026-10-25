# Briques communes des scripts d'extraction de CD (scripts/<jeu>-extract.sh). À sourcer, pas à exécuter :
#   racine=...; utils="$racine/scripts/<jeu>/extract_utils.py"
#   source "$racine/scripts/lib/extract-common.sh"
#   ec_verifier_outils bsdtar python3 ; ec_init_tmp
# Les assistants Python sont lancés en `python3 -I` (données extraites non fiables, rien n'en est exécuté) :
# -I ignore PYTHONPATH et le dossier courant, c'est donc extract_utils.py qui ajoute scripts/lib à sys.path.
# Variables attendues de l'appelant : racine, utils (pour py). Fournit : tmp (dossier temporaire).

ec_verifier_outils() {
  local outil
  for outil in "$@"; do
    command -v "$outil" >/dev/null || { echo "Outil manquant : $outil" >&2; exit 1; }
  done
}

# Dossier temporaire $tmp, supprimé à la sortie du script.
ec_init_tmp() {
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
}

py() { python3 -I "$utils" "$@"; }

# ec_conserver <sortie> <dest> <fichier>... : copie dans <dest> les fichiers de l'ancienne <sortie> qui ne viennent
# pas du CD (jaquette, etc.), s'ils existent.
ec_conserver() {
  local sortie="$1" dest="$2" fichier
  shift 2
  for fichier in "$@"; do
    if [ -f "$sortie/$fichier" ]; then cp "$sortie/$fichier" "$dest/$fichier"; fi
  done
}

# ec_publier <out> <sortie> : génère files.json dans <out> (scripts/manifest.py) puis substitue <sortie> d'un bloc.
# À appeler seulement quand tout a réussi.
ec_publier() {
  python3 -I "$racine/scripts/manifest.py" "$1"
  rm -rf "$2"
  mv "$1" "$2"
}
