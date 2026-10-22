#!/usr/bin/env bash
# Extrait du CD du Téléportaschtroumpf uniquement les fichiers utiles au jeu
# (original/teleportaschtroumpf/) et génère l'inventaire docs/teleportaschtroumpf/files.md.
# Usage : scripts/teleportaschtroumpf-extract.sh [archive.rar]
#   (défaut : archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar)
# Idempotent : le dossier de sortie est supprimé puis régénéré.
# Outils requis : bsdtar (7zz ne sait pas lire ce RAR), 7zz, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar}"
sortie="$racine/original/teleportaschtroumpf"
doc="$racine/docs/teleportaschtroumpf/files.md"
utils="$racine/scripts/teleportaschtroumpf/extract_utils.py"

for outil in bsdtar 7zz python3; do
  command -v "$outil" >/dev/null || { echo "Outil manquant : $outil" >&2; exit 1; }
done
[ -f "$archive" ] || { echo "Archive introuvable : $archive" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
py() { python3 -I "$utils" "$@"; }

echo "Extraction de l'archive..."
mkdir "$tmp/rar"
bsdtar -xf "$archive" -C "$tmp/rar"
bin="$(find "$tmp/rar" -iname 'Teleport.bin' | head -1)"
cue="$(find "$tmp/rar" -iname 'Teleport.cue' | head -1)"
[ -n "$bin" ] && [ -n "$cue" ] || { echo "Teleport.bin/.cue absents de l'archive" >&2; exit 1; }

# Nombre de secteurs de la piste 1 (données), lu dans le .cue.
nb_iso="$(py pistes "$cue")"

echo "Piste 1 -> ISO -> fichiers..."
py iso "$bin" "$tmp/data.iso" "$nb_iso"
mkdir "$tmp/iso"
7zz x -y -bso0 -bsp0 "-o$tmp/iso" "$tmp/data.iso"

rm -rf "$sortie"
mkdir -p "$sortie"
py copier "$tmp/iso" "$sortie" "$tmp/stats.json"

py inventaire "$sortie" "$tmp/stats.json" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
python3 -I "$racine/scripts/teleportaschtroumpf/manifest.py" "$sortie"
