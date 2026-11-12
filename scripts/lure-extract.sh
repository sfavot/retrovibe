#!/usr/bin/env bash
# Extrait Lure of the Temptress (Revolution Software, 1992), version française VGA sur disquettes
# (lure-fr-1.1.zip, préparée par ScummVM), dans original/lure/ :
#  - DISK1.VGA à DISK4.VGA (conteneurs « heywow »), tels quels ;
#  - LURE-FR.DAT : bloc français de lure.dat de ScummVM (tables du jeu, version 1.32, même format qu'un DISKn.VGA) ;
#  - LICENSE-LURE.txt (licence de Revolution, à conserver intacte), MANUEL.pdf et files.json ;
#  - l'inventaire docs/lure/files.md.
# Non versionnés : LURE.EXE (jamais exécuté), PROTECT.PDF (protection non portée), README de ScummVM.
# COVER.png vient de la vague J : conservé tel quel s'il existe.
# Usage : scripts/lure-extract.sh [lure-fr-1.1.zip] [lure.dat]
#         (défauts : archives/lure-fr-1.1.zip, archives/lure.dat = dists/engine-data/lure.dat de ScummVM)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'archive est une donnée non fiable : rien n'est exécuté, python en -I.
# Outils requis : bsdtar, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/lure-fr-1.1.zip}"
dat="${2:-$racine/archives/lure.dat}"
sortie="$racine/original/lure"
doc="$racine/docs/lure/files.md"
utils="$racine/scripts/lure/split_dat.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils bsdtar python3
[ -f "$archive" ] || { echo "Fichier introuvable : $archive" >&2; exit 1; }
[ -f "$dat" ] || { echo "Fichier introuvable : $dat (copie de dists/engine-data/lure.dat de ScummVM)" >&2; exit 1; }

ec_init_tmp
mkdir "$tmp/zip" "$tmp/out"
bsdtar -xf "$archive" -C "$tmp/zip"

py verifier "$tmp/zip"
trouver() {
  local f
  f="$(find "$tmp/zip" -iname "$1" -type f | head -1)"
  [ -n "$f" ] || { echo "$1 absent de $archive" >&2; exit 1; }
  printf '%s\n' "$f"
}
for n in 1 2 3 4; do cp "$(trouver "disk$n.vga")" "$tmp/out/DISK$n.VGA"; done
cp "$(trouver license.txt)" "$tmp/out/LICENSE-LURE.txt"
cp "$(trouver manual.pdf)" "$tmp/out/MANUEL.pdf"
py bloc "$dat" "$tmp/out/LURE-FR.DAT"
# Jaquette (vague J) : ne vient pas de cette extraction, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.png

py inventaire "$tmp/out" "$tmp/zip" "$dat" "$doc"
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
