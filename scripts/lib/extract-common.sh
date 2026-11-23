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

# ec_refuser_liens <dossier>... : échoue si un lien symbolique se trouve dans un dossier issu d'une archive (avant tout cp).
ec_refuser_liens() {
  local d
  for d in "$@"; do
    if [ -n "$(find "$d" -type l -print -quit)" ]; then echo "Lien symbolique refusé dans $d" >&2; exit 1; fi
  done
}

# ec_publier <out> <sortie> : génère files.json dans <out> (scripts/manifest.py) puis substitue <sortie> d'un bloc.
# À appeler seulement quand tout a réussi.
ec_publier() {
  python3 -I "$racine/scripts/manifest.py" "$1"
  rm -rf "${2:?ec_publier : sortie vide}"
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

# ec_encoder_pcm <pcm> <sortie> [débit] : encode avec ec_encoder_voix le PCM 8 bits non signé mono rangé en
# <pcm>/<fréquence en Hz>/<sous-dossiers>/<nom>.u8 (`ecrire_pcm` de extract_common.py) vers
# <sortie>/<sous-dossiers>/<nom>.mp3. Un ffmpeg par son, les dossiers étant répartis sur autant de processus que de
# cœurs ; le résultat ne dépend pas de la répartition. Arrête le script si un encodage échoue.
ec_encoder_pcm() {
  local pcm="$1" sortie="$2" debit="${3:-24k}" procs g pid d dossiers=() pids=()
  procs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
  while IFS= read -r d; do dossiers+=("$d"); done < <(find "$pcm" -type f -name '*.u8' -exec dirname {} \; | LC_ALL=C sort -u)
  for ((g = 0; g < procs; g++)); do
    (
      local i rel frequence
      for ((i = g; i < ${#dossiers[@]}; i += procs)); do
        rel="${dossiers[$i]#"$pcm"/}"
        frequence="${rel%%/*}"
        ec_encoder_voix "${dossiers[$i]}" u8 "$sortie/${rel#*/}" "$debit" -f u8 -ar "$frequence" -ac 1
      done
    ) &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do wait "$pid" || { echo "Échec de l'encodage MP3" >&2; exit 1; }; done
}
