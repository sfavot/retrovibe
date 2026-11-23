#!/usr/bin/env bash
# Extrait du CD du Téléportaschtroumpf uniquement les fichiers utiles au jeu
# (original/teleportaschtroumpf/) et génère l'inventaire docs/teleportaschtroumpf/files.md.
# Les sons (975 VOC : voix, musiques, bruitages) sont trop lourds pour être versionnés tels quels (docs/asterix/plan.md,
# décision D3) : chacun devient <nom d'origine>.VOC.mp3 (MP3 mono 22 050 Hz à 32 kb/s), et audio.json garde le nombre
# d'échantillons et la fréquence du PCM d'origine (durées exactes pour le moteur). Le reste est copié tel quel.
# Usage : scripts/teleportaschtroumpf-extract.sh [archive.rar]
#   (défaut : archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar)
# Idempotent : le dossier de sortie est régénéré à côté puis substitué d’un bloc, sauf la jaquette de l'accueil
# (original/teleportaschtroumpf/COVER.webp), qui ne vient pas du CD et est conservée telle quelle.
# La notice d'origine (« Lisez moi.doc » à la racine du CD) est convertie en MANUEL.pdf : textutil (macOS) la lit en
# HTML, Chrome en mode headless l'imprime. En cas d’échec ou sans l’un des deux, l’éventuel MANUEL.pdf existant est conservé.
# Déterministe hors MANUEL.pdf (même résultat à chaque exécution avec la même version de ffmpeg).
# L'archive est une donnée non fiable : rien n'en est exécuté (python en -I, ffmpeg ne lit que des fichiers locaux).
# Briques communes : scripts/lib/ (extraction ISO 9660, VOC -> MP3 et index des sons, inventaire, remplacement atomique).
# Outils requis : bsdtar (7zz ne sait pas lire ce RAR), python3, ffmpeg (libmp3lame).
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar}"
sortie="$racine/original/teleportaschtroumpf"
doc="$racine/docs/teleportaschtroumpf/files.md"
utils="$racine/scripts/teleportaschtroumpf/extract_utils.py"
chrome="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

NB_SONS=975

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils bsdtar python3 ffmpeg
[ -f "$archive" ] || { echo "Archive introuvable : $archive" >&2; exit 1; }

ec_init_tmp

echo "Extraction de l'archive..."
mkdir "$tmp/rar"
bsdtar -xf "$archive" -C "$tmp/rar"
bin="$(find "$tmp/rar" -type f -iname 'Teleport.bin' | head -1)"
cue="$(find "$tmp/rar" -type f -iname 'Teleport.cue' | head -1)"
[ -n "$bin" ] && [ -n "$cue" ] || { echo "Teleport.bin/.cue absents de l'archive" >&2; exit 1; }

# Nombre de secteurs de la piste 1 (données), lu dans le .cue.
nb_iso="$(py pistes "$cue")"

echo "Piste 1 -> ISO -> fichiers..."
py iso "$bin" "$tmp/data.iso" "$nb_iso"
py extraire "$tmp/data.iso" "$tmp/iso"

# Tout est construit dans $tmp/out ; original/ n'est remplacé qu'à la fin, une fois files.json généré.
[ -f "$sortie/MANUEL.pdf" ] && cp "$sortie/MANUEL.pdf" "$tmp/MANUEL.old.pdf"
mkdir "$tmp/out"
nb="$(py copier "$tmp/iso" "$tmp/out" "$tmp/pcm" "$tmp/stats.json")"
[ "$nb" -eq "$NB_SONS" ] || { echo "$NB_SONS sons attendus, $nb décodés" >&2; exit 1; }

# Son : PCM 8 bits non signé -> MP3 32 kb/s, de $tmp/pcm/<fréquence>/DATA/... vers DATA/...
echo "Encodage MP3 de $nb sons..."
ec_encoder_pcm "$tmp/pcm" "$tmp/out" 32k
total="$(find "$tmp/out/DATA" -type f -name '*.mp3' | wc -l | tr -d ' ')"
[ "$total" -eq "$NB_SONS" ] || { echo "$NB_SONS MP3 attendus, $total encodés" >&2; exit 1; }
ec_conserver "$sortie" "$tmp/out" COVER.webp

# Notice d'origine -> MANUEL.pdf (le nom de fichier du CD contient une espace et la casse varie).
# Le PDF est produit dans $tmp ; en cas d'échec, l'ancien est conservé.
doc_notice="$(find "$tmp/iso" -maxdepth 1 -iname 'Lisez moi.doc' | head -1)"
manuel_ok=0
if [ -n "$doc_notice" ] && command -v textutil >/dev/null && [ -x "$chrome" ]; then
  echo "Notice -> MANUEL.pdf..."
  mkdir "$tmp/notice"
  if textutil -convert html -encoding UTF-8 "$doc_notice" -output "$tmp/notice/brut.html" \
    && py manuel "$tmp/notice/brut.html" "$tmp/notice/notice.html" \
    && "$chrome" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="$tmp/notice/profil" \
      --print-to-pdf="$tmp/notice/MANUEL.pdf" "file://$tmp/notice/notice.html" >/dev/null \
    && [ -s "$tmp/notice/MANUEL.pdf" ]; then
    cp "$tmp/notice/MANUEL.pdf" "$tmp/out/MANUEL.pdf"
    manuel_ok=1
  else
    echo "Échec de la conversion de la notice en PDF (voir les messages ci-dessus)." >&2
  fi
else
  echo "textutil ou Chrome absent : pas de conversion de la notice." >&2
fi
if [ "$manuel_ok" = 0 ]; then
  if [ -f "$tmp/MANUEL.old.pdf" ]; then
    echo "MANUEL.pdf existant conservé." >&2
    cp "$tmp/MANUEL.old.pdf" "$tmp/out/MANUEL.pdf"
  else
    echo "Pas de MANUEL.pdf." >&2
  fi
fi

ec_publier "$tmp/out" "$sortie"

py inventaire "$sortie" "$tmp/stats.json" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
