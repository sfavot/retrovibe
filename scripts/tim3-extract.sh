#!/usr/bin/env bash
# Extrait The Incredible Machine 3 (Sierra / Dynamix, 1995, Windows, ISO de jeu-00235-incredible_machine_3-pcwin.7z)
# dans original/tim3/ :
#  - RESOURCE.MAP, RESOURCE.001, RESOURCE.002, FRENCH.DAT et TIMWIN.EXE, tels quels ;
#  - voices/<archive en minuscules>/<index sur 3 chiffres>.mp3 : les voix de GOALS, HINT1 à 7, HELP et PROFESOR.VOC
#    (archives maison, PCM 8 bits 11 025 Hz), entrées vides sautées, en MP3 comme BASS (ec_encoder_voix) ;
#  - voices/lipsync.json : synchronisation labiale (scripts/tim3/split_voc.py) ;
#  - COVER.webp (jaquette de la boîte nord-américaine, LaunchBox Games Database) conservé s'il existe, files.json, et l'inventaire docs/tim3/files.md.
# Usage : scripts/tim3-extract.sh [archive.7z]
#   (défaut : jeu-00235-incredible_machine_3-pcwin.7z à la racine du dépôt, sinon dans archives/)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'archive est une donnée non fiable : rien n'en est exécuté (python en -I, ffmpeg ne lit que des fichiers locaux).
# Outils requis : 7zz, python3, ffmpeg (libmp3lame).
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
nom_archive=jeu-00235-incredible_machine_3-pcwin.7z
if [ $# -ge 1 ]; then
  archive="$1"
elif [ -f "$racine/$nom_archive" ]; then
  archive="$racine/$nom_archive"
else
  archive="$racine/archives/$nom_archive"
fi
sortie="$racine/original/tim3"
doc="$racine/docs/tim3/files.md"
utils="$racine/scripts/tim3/split_voc.py"

# Valeurs de l'ISO (observées à la vague X, voir docs/tim3/files.md) : 654 entrées de voix non vides (206 + 228 + 188 + 32).
NB_VOIX=654

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils 7zz python3 ffmpeg
[ -f "$archive" ] || { echo "Fichier introuvable : $archive" >&2; exit 1; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
taille() { wc -c <"$1" | tr -d ' '; }

ec_init_tmp
mkdir "$tmp/7z" "$tmp/iso" "$tmp/out" "$tmp/wav"
echo "Extraction de l'archive..."
7zz x -y -bso0 -bsp0 "-o$tmp/7z" "$archive"
iso="$(find "$tmp/7z" -iname '*.iso' -type f | head -1)"
[ -n "$iso" ] || { echo "Aucun .iso dans l'archive" >&2; exit 1; }
echo "ISO..."
7zz x -y -bso0 -bsp0 "-o$tmp/iso" "$iso"
rm -rf "$tmp/7z"

dossier="$(find "$tmp/iso" -maxdepth 1 -iname TIMWIN -type d | head -1)"
[ -n "$dossier" ] || { echo "Dossier TIMWIN absent de l'ISO" >&2; exit 1; }
trouver() {
  local f
  f="$(find "$dossier" -maxdepth 1 -iname "$1" -type f | head -1)"
  [ -n "$f" ] || { echo "$1 absent de l'ISO" >&2; exit 1; }
  printf '%s\n' "$f"
}

# Fichiers tels quels : contrôle de la taille et du SHA-256, puis copie.
while IFS='|' read -r nom taille_attendue sha_attendu; do
  f="$(trouver "$nom")"
  [ "$(taille "$f")" -eq "$taille_attendue" ] || { echo "$nom : $taille_attendue octets attendus" >&2; exit 1; }
  [ "$(sha256 "$f")" = "$sha_attendu" ] || { echo "$nom : SHA-256 inattendu" >&2; exit 1; }
  cp "$f" "$tmp/out/$nom"
  [ "$(sha256 "$tmp/out/$nom")" = "$sha_attendu" ] || { echo "$nom : copie différente de la source" >&2; exit 1; }
done <<'LISTE'
RESOURCE.MAP|12276|d0c076e413ab0184db9880075d2307b6d78150c093eaf919fcfee71931130ebb
RESOURCE.001|7508126|022987060475eec96b6f5720b5e61ec29811fa996be79d13d1e26cda4270f69c
RESOURCE.002|1783838|27b30fd7bd2dcfe15f5f2398954bc11f63b02d3506cc64ccb1ab2ee940aa42eb
FRENCH.DAT|469457|72cd26d4c722ab30ad1077e8bd6f243c64500cae8d7a0fc27b266c1c7f93395e
TIMWIN.EXE|454656|a2562ae1ff8355666e2c55f8dc7cb5f262f5b2798680f390cb374e3fcaae3080
LISTE

# Voix : archives VOC -> WAV (entrées non vides) + synchronisation labiale, puis MP3.
vocs=()
for a in GOALS HINT1 HINT2 HINT3 HINT4 HINT5 HINT6 HINT7 HELP PROFESOR; do vocs+=("$(trouver "$a.VOC")"); done
mkdir -p "$tmp/out/voices"
py decouper "$tmp/wav" "$tmp/out/voices/lipsync.json" "${vocs[@]}" >"$tmp/decoupe.txt"
total=0
for d in "$tmp"/wav/*/; do
  a="$(basename "$d")"
  ec_encoder_voix "$d" wav "$tmp/out/voices/$a" 24k
  total=$((total + ec_nb_voix))
done
[ "$total" -eq "$NB_VOIX" ] || { echo "$NB_VOIX voix attendues, $total converties" >&2; exit 1; }

# Jaquette (vague J) : ne vient pas de cette extraction, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.webp

py inventaire "$tmp/out" "$dossier" "$tmp/wav" "$doc"
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)), $total voix ; inventaire : $doc"
