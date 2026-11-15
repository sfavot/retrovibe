#!/usr/bin/env bash
# Extrait de l'ISO de Yoda Stories (LucasArts, 1997, Windows, version française) les fichiers utiles au jeu
# dans original/yoda/ : YODESK.DTA (données), YODESK.EXE (palette, curseurs, textes), YODESK.HLP et YODESK.CNT
# (l'aide et son sommaire) et SFX/*.WAV.
# Usage : scripts/yoda-extract.sh [Yoda.iso]   (défaut : archives/yoda-stories/Yoda.iso)
# Le patch anglais archives/yoda-stories/pat-01951-yoda_stories-pcwin.7z (Yopatch6, juin 1997) n'est pas appliqué :
# il ne contient qu'un YODESK.DTA de la version anglaise, qui remplacerait les textes français.
# original/yoda/COVER.webp (jaquette de la boîte d'origine, Wikipédia anglophone) ne vient pas de l'ISO : elle est conservée.
# Idempotent : le dossier de sortie est régénéré à côté puis substitué d'un bloc.
# Outils requis : 7zz, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
iso="${1:-$racine/archives/yoda-stories/Yoda.iso}"
sortie="$racine/original/yoda"
utils="" # aucun assistant Python propre au jeu

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils 7zz python3
[ -f "$iso" ] || { echo "ISO introuvable : $iso" >&2; exit 1; }

ec_init_tmp

echo "ISO -> fichiers..."
7zz x -y -bso0 -bsp0 "-o$tmp/iso" "$iso" 'YODA/YODESK.DTA' 'YODA/YODESK.EXE' 'YODA/YODESK.HLP' 'YODA/YODESK.CNT' 'YODA/SFX/*.WAV'

mkdir -p "$tmp/out/SFX"
cp "$tmp/iso/YODA/YODESK.DTA" "$tmp/iso/YODA/YODESK.EXE" "$tmp/iso/YODA/YODESK.HLP" "$tmp/iso/YODA/YODESK.CNT" "$tmp/out/"
cp "$tmp/iso/YODA/SFX/"*.WAV "$tmp/out/SFX/"

ec_conserver "$sortie" "$tmp/out" COVER.webp
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1))"
