#!/usr/bin/env bash
# Extrait Astérix : le défi de César (Infogrames Multimedia, 1995 ; CD DOS français, ASTERIX.EXE « Version 2.5 »)
# dans original/asterix/, en convertissant les médias trop lourds pour être versionnés tels quels (docs/asterix/plan.md,
# décisions D2 et D4) :
#  - ASTERIX.EXE, tel quel (lu pour ses tables, jamais exécuté) ;
#  - MDF/<module>/*.MCG, *.MCC, *.HY8, *.PFN, *.PAL, *.TXT, *.DAT, tels quels ;
#  - MDF/<module>/<nom>.VOC.mp3 : les 736 VOC (voix, musiques, bruitages), en MP3 mono 22 050 Hz à 32 kb/s ;
#  - MDF/<module>/<nom>.MUX.vid et <nom>.MUK.vid : les 117 MUX et 31 MUK réencodés sans perte dans un conteneur maison
#    (images indexées 320×200 en différence avec la précédente, palettes, marqueurs, cadence, horodatage ; LZMA) ;
#  - MDF/<module>/<nom>.MUX.mp3 : le son des MUX, en MP3 comme les VOC ;
#  - audio.json : nombre d'échantillons et fréquence d'origine de chaque MP3 (durées exactes, calage des vidéos) ;
#  - COVER.webp (jaquette) conservé s'il existe, files.json, et l'inventaire docs/asterix/files.md.
# Non repris : OUTLINE/ (installeur sans rapport avec le jeu), LISEZMOI.EXE, MDF/LISEZMOI.TXT, Lisez-Moi.txt.
# Formats : docs/asterix/formats.md ; conversions : scripts/asterix/video.py et scripts/asterix/extract_utils.py.
# Usage : scripts/asterix-extract.sh [archive.7z]
#   (défaut : archives/asterix/jeu-00700-asterix_defi_de_cesar-pcdos.7z)
# Idempotent et déterministe : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'archive est une donnée non fiable : rien n'en est exécuté (python en -I, ffmpeg ne lit que des fichiers locaux).
# Outils requis : 7zz, python3 (module lzma), ffmpeg (libmp3lame). Compter quelques minutes et ~500 Mo d'espace temporaire.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/asterix/jeu-00700-asterix_defi_de_cesar-pcdos.7z}"
sortie="$racine/original/asterix"
doc="$racine/docs/asterix/files.md"
utils="$racine/scripts/asterix/extract_utils.py"

NB_SONS=852  # 736 VOC + 116 MUX sonores (un MUX est muet)

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils 7zz python3 ffmpeg
[ -f "$archive" ] || { echo "Archive introuvable : $archive" >&2; exit 1; }

ec_init_tmp
mkdir "$tmp/7z"
echo "Extraction de l'archive..."
7zz x -y -bso0 -bsp0 "-o$tmp/7z" "$archive"
jeu="$tmp/7z/Asterix"
[ -f "$jeu/ASTERIX.EXE" ] && [ -d "$jeu/MDF" ] || { echo "Asterix/ASTERIX.EXE ou Asterix/MDF absent de l'archive" >&2; exit 1; }

# Tout est construit dans $tmp/out ; original/ n'est remplacé qu'à la fin, une fois files.json généré.
echo "Copie, décodage des VOC, conversion des vidéos (plusieurs minutes)..."
nb="$(py convertir "$jeu" "$tmp/out" "$tmp/pcm" "$tmp/stats.json")"
[ "$nb" -eq "$NB_SONS" ] || { echo "$NB_SONS sons attendus, $nb décodés" >&2; exit 1; }

# Son : PCM 8 bits non signé -> MP3 32 kb/s, de $tmp/pcm/<fréquence>/<module>/ vers MDF/<module>/.
echo "Encodage MP3 de $nb sons..."
ec_encoder_pcm "$tmp/pcm" "$tmp/out/MDF" 32k
total="$(find "$tmp/out/MDF" -type f -name '*.mp3' | wc -l | tr -d ' ')"
[ "$total" -eq "$NB_SONS" ] || { echo "$NB_SONS MP3 attendus, $total encodés" >&2; exit 1; }

# Jaquette : ne vient pas de cette extraction, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.webp

py inventaire "$tmp/out" "$tmp/stats.json" "$doc"
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
