#!/usr/bin/env bash
# Extrait Gabriel Knight: Sins of the Fathers (Sierra, 1993 ; CD français de 1994, moteur SCI2, GabK.iso de
# jeu-00686-gabriel_knight_cd-pcdos.7z) dans original/gk1/ :
#  - RESOURCE.MAP, RESOURCE.000, ALT.MAP, RESOURCE.ALT (vues haute résolution, pour une option future),
#    PATCHES/316.SND, PATCHES/803.SND et SEQ/*.SEQ (25 cinématiques), tels quels ;
#  - VERSION (numéro de version, nom et date du CD : le jeu l'affiche et le range dans ses sauvegardes), tel quel ;
#  - voices/<module>/<noun>-<verb>-<cond>-<seq>.mp3 : les 7469 clips de voix (AUD/RESOURCE.AUD, audio SOL en DPCM
#    décodé en PCM, et patchs AUD/@… qui les remplacent), en MP3 comme les autres jeux (ec_encoder_voix) ; nombres en
#    décimal, seq sans le drapeau 0x80 ;
#  - voices/<module>/sync.json : synchronisation labiale, {"<noun>-<verb>-<cond>-<seq>": [tick, pose, tick, pose, …]},
#    les paires u16 du bloc sync (RESOURCE.AUD, ou patch AUD/#… qui gagne) sans en-tête ni terminateur 0xFFFF ;
#  - voices/<module>/index.json et audio/index.json : durée exacte de chaque clip et bruitage, {"<clé>": échantillons}
#    (PCM source mono 22 050 Hz, avant encodage ; clé = "<noun>-<verb>-<cond>-<seq>" ou "<numéro>") ;
#  - audio/<numéro>.mp3 : bruitages numériques (RESOURCE.SFX via la map 65535, puis SFX/*.WAV qui gagne), MP3 mono
#    22 050 Hz à 64 kb/s ;
#  - MANUEL.pdf et BD.pdf (bande dessinée de la boîte), de man-00686-gabriel_knight.7z, tels quels ;
#  - COVER.webp (jaquette) conservé s'il existe, files.json, et l'inventaire docs/gk1/files.md.
# Non versionnés : RESOURCE.SFX et AUD/ (convertis), SIERRA.EXE, pilotes, installeur.
# Formats et choix (variante du DPCM, forme de sync.json et d'index.json, arrondi en ticks) : en-tête de scripts/gk1/extract_utils.py.
# Usage : scripts/gk1-extract.sh [jeu.7z] [manuels.7z]
#   (défauts : archives/jeu-00686-gabriel_knight_cd-pcdos.7z, archives/man-00686-gabriel_knight.7z)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# Les archives sont des données non fiables : rien n'en est exécuté (python en -I, ffmpeg ne lit que des fichiers locaux).
# Outils requis : 7zz, python3, ffmpeg (libmp3lame). Compter quelques minutes et ~1,5 Go d'espace temporaire.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/jeu-00686-gabriel_knight_cd-pcdos.7z}"
manuels="${2:-$racine/archives/man-00686-gabriel_knight.7z}"
sortie="$racine/original/gk1"
doc="$racine/docs/gk1/files.md"
utils="$racine/scripts/gk1/extract_utils.py"

# Valeurs du CD français (voir docs/gk1/files.md) ; les nombres lus dans les maps sont contrôlés par extract_utils.py.
NB_VOIX=7469      # clips des maps audio36 ; les 21 patchs AUD/@… remplacent des clips existants
NB_BRUITAGES=231  # 186 entrées de la map 65535 + 46 SFX/*.WAV - 1 numéro commun
NB_SEQ=25

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils 7zz python3 ffmpeg
[ -f "$archive" ] || { echo "Fichier introuvable : $archive" >&2; exit 1; }
[ -f "$manuels" ] || { echo "Fichier introuvable : $manuels" >&2; exit 1; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
taille() { wc -c <"$1" | tr -d ' '; }
# controler <fichier> <nom affiché> <taille> <SHA-256>
controler() {
  [ -f "$1" ] || { echo "$2 absent" >&2; exit 1; }
  [ "$(taille "$1")" -eq "$3" ] || { echo "$2 : $3 octets attendus" >&2; exit 1; }
  [ "$(sha256 "$1")" = "$4" ] || { echo "$2 : SHA-256 inattendu" >&2; exit 1; }
}

ec_init_tmp
mkdir "$tmp/7z" "$tmp/man" "$tmp/out" "$tmp/out/PATCHES" "$tmp/out/SEQ"
echo "Extraction des archives..."
7zz x -y -bso0 -bsp0 "-o$tmp/7z" "$archive"
iso="$(find "$tmp/7z" -iname '*.iso' -type f | head -1)"
[ -n "$iso" ] || { echo "Aucun .iso dans l'archive" >&2; exit 1; }
py iso "$iso" "$tmp/cd"
rm -rf "$tmp/7z"
7zz x -y -bso0 -bsp0 "-o$tmp/man" "$manuels"
cd_="$tmp/cd"

# Fichiers sources : contrôle de la taille et du SHA-256, puis copie de ceux gardés tels quels (colonne 4 = 1).
while IFS='|' read -r nom taille_attendue sha_attendu copie; do
  controler "$cd_/$nom" "$nom" "$taille_attendue" "$sha_attendu"
  if [ "$copie" = 1 ]; then
    cp "$cd_/$nom" "$tmp/out/$nom"
    [ "$(sha256 "$tmp/out/$nom")" = "$sha_attendu" ] || { echo "$nom : copie différente de la source" >&2; exit 1; }
  fi
done <<'LISTE'
RESOURCE.MAP|11392|cc1dc1accaf065f4ba0efcdddb44ab7175346ee6e22c16789c991686e27662cd|1
RESOURCE.000|13325145|7c141bb0e32814ea34d3b1a64cc203a56b1fb5b9e51da043cc7e0318fdfb051d|1
ALT.MAP|364|bf0df811846933340a6564d527487cab9dc548490ef1b3653409516185be9d64|1
RESOURCE.ALT|3616871|3a47064256a4674a7f7668e41726f3561fbb9e64069d7c0b05599897da6188c7|1
PATCHES/316.SND|98|526f90dfb948d1eb8ad75e878c443cdfae5a76ed5ca08536a955af57d76df017|1
PATCHES/803.SND|98|526f90dfb948d1eb8ad75e878c443cdfae5a76ed5ca08536a955af57d76df017|1
RESOURCE.SFX|13589592|9477f157b636fb90c459fe268697bca554cb30941377bb7f6dd20b96120144df|0
AUD/RESOURCE.AUD|354272859|681239426b91ff22be501fa93c62f1faae7b22b5037d6c00f70a3b1c9bf5f1d7|0
LISTE

# VERSION : l'ISO le nomme « VERSION. » (pas d'extension), le jeu l'ouvre sous le nom « VERSION ».
controler "$cd_/VERSION." VERSION 50 ae18577ab942546d9d6037b57129aad24a61d24d77ab1674df9aa64f7bb11de7
cp "$cd_/VERSION." "$tmp/out/VERSION"
[ "$(sha256 "$tmp/out/VERSION")" = "$(sha256 "$cd_/VERSION.")" ] || { echo "VERSION : copie différente de la source" >&2; exit 1; }

# Cinématiques, telles quelles.
nb_seq=0
for f in "$cd_"/SEQ/*.SEQ; do
  cp "$f" "$tmp/out/SEQ/"
  nb_seq=$((nb_seq + 1))
done
[ "$nb_seq" -eq "$NB_SEQ" ] || { echo "$NB_SEQ cinématiques SEQ attendues, $nb_seq trouvées" >&2; exit 1; }

# Manuel et bande dessinée (les noms de l'archive portent des accents : repérés par leur motif).
pdf() {
  local f
  f="$(find "$tmp/man" -type f -iname "$1" | head -1)"
  [ -n "$f" ] || { echo "PDF $1 absent de $manuels" >&2; exit 1; }
  controler "$f" "$2" "$3" "$4"
  cp "$f" "$tmp/out/$2"
}
pdf '*(Manuel).pdf' MANUEL.pdf 4112295 699035b9d876c665dfd6b5931362d88b5cad71cae811489305a56868f090122a
pdf '*(Bande dessin*).pdf' BD.pdf 10228022 ac8eacd7c2bd8a8473641fa841309f3af570a7ba015da5db8ab73307821d7d4b

# Voix : SOL (DPCM ou PCM) -> PCM 8 bits non signé par module + sync.json, puis MP3. L'encodage (un ffmpeg par clip)
# est réparti sur plusieurs processus, par groupes de modules ; le résultat ne dépend pas de la répartition.
echo "Voix : décodage..."
nb="$(py voix "$cd_" "$tmp/pcm" "$tmp/out")"
[ "$nb" -eq "$NB_VOIX" ] || { echo "$NB_VOIX voix attendues, $nb décodées" >&2; exit 1; }
echo "Voix : encodage MP3 de $nb clips..."
procs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
pids=()
for ((g = 0; g < procs; g++)); do
  (
    i=0
    for d in "$tmp"/pcm/*/; do
      if [ $((i % procs)) -eq "$g" ]; then
        ec_encoder_voix "$d" u8 "$tmp/out/voices/$(basename "$d")" 24k -f u8 -ar 22050 -ac 1
      fi
      i=$((i + 1))
    done
  ) &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid" || { echo "Échec de l'encodage des voix" >&2; exit 1; }; done
total="$(find "$tmp/out/voices" -type f -name '*.mp3' | wc -l | tr -d ' ')"
[ "$total" -eq "$NB_VOIX" ] || { echo "$NB_VOIX voix attendues, $total encodées" >&2; exit 1; }

# Bruitages numériques : RIFF WAVE -> MP3 64 kb/s.
echo "Bruitages..."
nb="$(py bruitages "$cd_" "$tmp/wav" "$tmp/out/audio/index.json")"
ec_encoder_voix "$tmp/wav" wav "$tmp/out/audio" 64k
[ "$nb" -eq "$NB_BRUITAGES" ] && [ "$ec_nb_voix" -eq "$NB_BRUITAGES" ] \
  || { echo "$NB_BRUITAGES bruitages attendus, $nb extraits, $ec_nb_voix encodés" >&2; exit 1; }

# Jaquette : ne vient pas de cette extraction, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.webp

py inventaire "$tmp/out" "$cd_" "$tmp/pcm" "$tmp/wav" "$doc"
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)), $total voix, $NB_BRUITAGES bruitages ; inventaire : $doc"
