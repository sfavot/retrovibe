#!/usr/bin/env bash
# Extrait du CD du Téléportaschtroumpf uniquement les fichiers utiles au jeu
# (original/teleportaschtroumpf/) et génère l'inventaire docs/teleportaschtroumpf/files.md.
# Usage : scripts/teleportaschtroumpf-extract.sh [archive.rar]
#   (défaut : archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar)
# Idempotent : le dossier de sortie est régénéré à côté puis substitué d’un bloc, sauf la jaquette de l'accueil
# (original/teleportaschtroumpf/COVER.webp), qui ne vient pas du CD et est conservée telle quelle.
# La notice d'origine (« Lisez moi.doc » à la racine du CD) est convertie en MANUEL.pdf : textutil (macOS) la lit en
# HTML, Chrome en mode headless l'imprime. En cas d’échec ou sans l’un des deux, l’éventuel MANUEL.pdf existant est conservé.
# Outils requis : bsdtar (7zz ne sait pas lire ce RAR), 7zz, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar}"
sortie="$racine/original/teleportaschtroumpf"
doc="$racine/docs/teleportaschtroumpf/files.md"
utils="$racine/scripts/teleportaschtroumpf/extract_utils.py"
chrome="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

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

# Tout est construit dans $tmp/out ; original/ n'est remplacé qu'à la fin, une fois files.json généré.
[ -f "$sortie/COVER.webp" ] && cp "$sortie/COVER.webp" "$tmp/COVER.webp"
[ -f "$sortie/MANUEL.pdf" ] && cp "$sortie/MANUEL.pdf" "$tmp/MANUEL.old.pdf"
mkdir "$tmp/out"
py copier "$tmp/iso" "$tmp/out" "$tmp/stats.json"
[ -f "$tmp/COVER.webp" ] && cp "$tmp/COVER.webp" "$tmp/out/COVER.webp"

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

python3 -I "$racine/scripts/manifest.py" "$tmp/out"
rm -rf "$sortie"
mv "$tmp/out" "$sortie"

py inventaire "$sortie" "$tmp/stats.json" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
