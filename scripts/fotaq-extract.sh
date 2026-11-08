#!/usr/bin/env bash
# Extrait Flight of the Amazon Queen (Interactive Binary Illusions, 1995), version française parlante telle que
# redistribuée par ScummVM (FOTAQ_Fr_Talkie_1.0.zip : queen.1c + readme.txt), dans original/fotaq/ :
#  - les ressources de queen.1c utiles au jeu, à plat (tout sauf les voix .SB et AQBANK.RL), noms d'origine ;
#  - README-FOTAQ.txt (readme d'origine, licence : à conserver intact) et files.json ;
#  - l'inventaire docs/fotaq/files.md.
# Les voix (voices/*.mp3) viennent de scripts/fotaq-voices.sh, COVER.png de la vague J : conservés tels quels.
# Usage : scripts/fotaq-extract.sh [FOTAQ_Fr_Talkie_1.0.zip]   (défaut : archives/FOTAQ_Fr_Talkie_1.0.zip)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'archive est une donnée non fiable : rien n'est exécuté.
# Outils requis : bsdtar, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/FOTAQ_Fr_Talkie_1.0.zip}"
sortie="$racine/original/fotaq"
doc="$racine/docs/fotaq/files.md"
utils="$racine/scripts/fotaq/split_queen.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils bsdtar python3
[ -f "$archive" ] || { echo "Fichier introuvable : $archive" >&2; exit 1; }

ec_init_tmp
mkdir "$tmp/zip" "$tmp/out"
bsdtar -xf "$archive" -C "$tmp/zip"
queen="$(find "$tmp/zip" -iname 'queen.1c' -type f | head -1)"
readme="$(find "$tmp/zip" -iname 'readme.txt' -type f | head -1)"
[ -n "$queen" ] && [ -n "$readme" ] || { echo "queen.1c ou readme.txt absent de $archive" >&2; exit 1; }

py donnees "$queen" "$tmp/out"
cp "$readme" "$tmp/out/README-FOTAQ.txt"
# Voix (scripts/fotaq-voices.sh) et jaquette : ne viennent pas de cette extraction, conservées si présentes.
ec_conserver "$sortie" "$tmp/out" COVER.png
if [ -d "$sortie/voices" ]; then cp -R "$sortie/voices" "$tmp/out/voices"; fi

py inventaire "$tmp/out" "$queen" "$doc"
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
