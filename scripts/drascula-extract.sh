#!/usr/bin/env bash
# Extrait Drascula: The Vampire Strikes Back (Alcachofa Soft, 1996), tel que redistribué par ScummVM :
#  - les archives ARJ complètes (Packet.001 de base + PACKET.002 à .005 du pack international) dans archives/drascula/
#    (non versionné, pour référence) ;
#  - uniquement les fichiers utiles au jeu dans original/drascula/ (à plat, version française : images, voix et vidéos
#    de la base ; fiches de pièces .ALD, dialogues .CAL et QPC.BIN de PACKET.002 en remplacement), avec files.json,
#    drascula.dat (ScummVM), les readme d'Alcachofa (licence, à conserver intacts) et la note de provenance de drascula.dat ;
#  - l'inventaire docs/drascula/files.md.
# La musique (scripts/drascula-music.sh) et COVER.png (vague J) ne viennent pas de ces archives : conservées telles quelles.
# Usage : scripts/drascula-extract.sh [drascula-1.0.zip [drascula-int-1.1.zip [drascula.dat]]]
#   (défauts : archives/drascula-1.0.zip, archives/drascula-int-1.1.zip, archives/drascula.dat)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# Les archives sont des données non fiables : rien n'est exécuté, les ARJ sont extraits par 7zz.
# Outils requis : bsdtar, 7zz, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
zip_base="${1:-$racine/archives/drascula-1.0.zip}"
zip_int="${2:-$racine/archives/drascula-int-1.1.zip}"
dat="${3:-$racine/archives/drascula.dat}"
sortie="$racine/original/drascula"
reference="$racine/archives/drascula"
doc="$racine/docs/drascula/files.md"
utils="$racine/scripts/drascula/extract_utils.py"

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils bsdtar 7zz python3
for f in "$zip_base" "$zip_int" "$dat"; do
  [ -f "$f" ] || { echo "Fichier introuvable : $f" >&2; exit 1; }
done

ec_init_tmp

# trouve <dossier> <nom> : chemin du fichier <nom> (insensible à la casse) sous <dossier>, ou échec.
trouve() {
  local f
  f="$(find "$1" -iname "$2" -type f | head -1)"
  [ -n "$f" ] || { echo "$2 absent de $1" >&2; exit 1; }
  echo "$f"
}

echo "Zip de base et pack international..."
mkdir "$tmp/zip-base" "$tmp/zip-int"
bsdtar -xf "$zip_base" -C "$tmp/zip-base"
bsdtar -xf "$zip_int" -C "$tmp/zip-int"

echo "Archives ARJ (Packet.001 à PACKET.005)..."
mkdir "$tmp/ref"
n=1
for archive in "$(trouve "$tmp/zip-base" 'Packet.001')" \
  "$(trouve "$tmp/zip-int" 'PACKET.002')" "$(trouve "$tmp/zip-int" 'PACKET.003')" \
  "$(trouve "$tmp/zip-int" 'PACKET.004')" "$(trouve "$tmp/zip-int" 'PACKET.005')"; do
  case "$n" in 1) d=base ;; 2) d=fr ;; 3) d=de ;; 4) d=es ;; 5) d=it ;; esac
  mkdir "$tmp/ref/$d"
  7zz x -y -bso0 -bsp0 "-o$tmp/ref/$d" "$archive"
  n=$((n + 1))
done

echo "Fichiers utiles (base + français)..."
mkdir "$tmp/out"
py copier "$tmp/ref/base" "$tmp/ref/fr" "$tmp/out"

cp "$dat" "$tmp/out/drascula.dat"
cp "$(trouve "$tmp/zip-base" 'readme.txt')" "$tmp/out/README-ALCACHOFA.txt"
cp "$(trouve "$tmp/zip-int" 'readme.txt')" "$tmp/out/README-ALCACHOFA-INT.txt"
cp "$racine/scripts/drascula/drascula-dat-LICENSE.txt" "$tmp/out/drascula-dat-LICENSE.txt"
# Musique (scripts/drascula-music.sh) et jaquette : ne viennent pas des archives, conservées si présentes.
conserves=(COVER.png)
for f in "$sortie"/track*.mp3; do [ -f "$f" ] && conserves+=("$(basename "$f")"); done
ec_conserver "$sortie" "$tmp/out" "${conserves[@]}"

# Substitution d'un bloc, seulement maintenant que tout a réussi (files.json est généré avant).
mkdir -p "$racine/archives"
rm -rf "$reference.new"
mv "$tmp/ref" "$reference.new"
rm -rf "$reference"
mv "$reference.new" "$reference"
ec_publier "$tmp/out" "$sortie"

py inventaire "$sortie" "$reference/base" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; archives complètes : $reference ; inventaire : $doc"
