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

# ec_encoder_voix <entrée> <ext> <sortie> [débit] [option d'entrée ffmpeg]... : encode chaque <entrée>/*.<ext> en
# <sortie>/<nom sans extension>.mp3, avec les options des voix du site (FOTAQ, BASS) : MP3 mono 22 050 Hz CBR
# (24k par défaut), métadonnées retirées, -fflags +bitexact, sans filtre (durée conservée, ni padding ni coupe).
# Les options d'entrée sont celles de ffmpeg avant -i, pour un PCM brut par exemple : -f u8 -ar 11025 -ac 1.
# ffmpeg ne lit que des fichiers locaux (-protocol_whitelist file). Fournit : ec_nb_voix (nombre de fichiers encodés).
ec_encoder_voix() {
  local entree="$1" ext="$2" sortie="$3" debit="${4:-24k}" f nom
  shift $(($# < 4 ? $# : 4))
  mkdir -p "$sortie"
  ec_nb_voix=0
  for f in "$entree"/*."$ext"; do
    nom="$(basename "$f" ".$ext")"
    ffmpeg -hide_banner -loglevel error -nostdin -y -protocol_whitelist file "$@" -i "$f" -vn -map_metadata -1 \
      -c:a libmp3lame -b:a "$debit" -ar 22050 -ac 1 -write_xing 1 -fflags +bitexact "$sortie/$nom.mp3"
    ec_nb_voix=$((ec_nb_voix + 1))
  done
}
