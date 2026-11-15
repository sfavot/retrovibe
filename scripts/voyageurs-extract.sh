#!/usr/bin/env bash
# Extrait Les Voyageurs du temps (Future Wars, Delphine Software, 1989), CD ScummVM d'Abandonware France
# (setup-00099-Les_Voyageurs_du_temps_CD-ScummVM.exe, installeur Inno Setup), dans original/voyageurs/ :
#  - PART01 PART02 PART03 PART04 PART04B AUTO00.PRC TEXTE.DAT tels quels (décision D2), md5 contrôlés ;
#  - music/track19.mp3 … track29.mp3 : pistes 19 à 29 converties depuis trackNN.flac (décision D3),
#    MP3 joint stéréo 44,1 kHz, 96 kb/s CBR, en-tête Xing, sans métadonnées, déterministe (comme Lost in Time) ;
#  - files.json ; COVER.webp (jaquette de la boîte Amiga de Future Wars, Wikipédia anglophone) conservé s'il existe ; l'inventaire docs/voyageurs/files.md.
# Non repris : .PAL, BASESON.SND, exécutables, MANUAL.*, SONY.LBM, VOL.*, pistes 1 à 18.
# Usage : scripts/voyageurs-extract.sh [installeur]   (défaut : archives/voyageurs/setup-00099-…exe)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'installeur est une donnée non fiable : il n'est JAMAIS exécuté (innoextract ne lit que l'archive, python en -I,
# ffmpeg ne lit que des fichiers locaux).
# Outils requis : innoextract, python3, ffmpeg (libmp3lame), ffprobe.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
installeur="${1:-$racine/archives/voyageurs/setup-00099-Les_Voyageurs_du_temps_CD-ScummVM.exe}"
sortie="$racine/original/voyageurs"
doc="$racine/docs/voyageurs/files.md"

# Fichiers du jeu : « nom md5 ».
FICHIERS="PART01 309c40b1d01c4352ec632ef3c99918bd
PART02 1762a2356b903b5df674890168b7daf2
PART03 e08762cc7d92280e3f7bd726a2ef9140
PART04 45b7b7fa6f7842d73bd6fe6a1d03ba16
PART04B 8a56ee89bbb511c9d3d4791743153d75
AUTO00.PRC 4fe1e7930b38e3c63f0f2474d471bf8f
TEXTE.DAT b7243a1d6f1c9740fcdd5bf18fec7caf"
# Pistes CD référencées par le jeu : « n° durée-en-secondes ».
PISTES="19 163.37
20 127.09
21 126.44
22 124.03
23 183.40
24 171.27
25 158.40
26 123.37
27 157.87
28 44.60
29 136.39"
TOLERANCE=0.1

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils innoextract python3 ffmpeg ffprobe
[ -f "$installeur" ] || { echo "Fichier introuvable : $installeur" >&2; exit 1; }

md5() { if command -v md5sum >/dev/null; then md5sum "$1"; else md5 -q "$1"; fi | cut -d' ' -f1; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
taille() { wc -c <"$1" | tr -d ' '; }
duree() { ffprobe -v error -protocol_whitelist file -show_entries format=duration -of csv=p=0 "$1"; }
mo() { awk -v o="$1" 'BEGIN { printf "%.1f", o / 1048576 }'; }

ec_init_tmp
mkdir "$tmp/src" "$tmp/out"
# Extraction seule (jamais d'exécution) : uniquement les fichiers utiles de app/data.
# -I désigne des chemins exacts (pas de préfixe) : on liste seulement les fichiers voulus.
filtres=()
while read -r nom _; do filtres+=(-I "app/data/$nom"); done <<<"$FICHIERS"
while read -r n _; do filtres+=(-I "app/data/track$n.flac"); done <<<"$PISTES"
innoextract -s "${filtres[@]}" -d "$tmp/src" "$installeur"
data="$tmp/src/app/data"
[ -d "$data" ] || { echo "app/data absent de $installeur" >&2; exit 1; }

# Fichiers du jeu, tels quels, contrôle md5 complet.
while read -r nom attendu; do
  [ -f "$data/$nom" ] || { echo "$nom absent de $installeur" >&2; exit 1; }
  [ "$(md5 "$data/$nom")" = "$attendu" ] || { echo "$nom : MD5 inattendu" >&2; exit 1; }
  cp "$data/$nom" "$tmp/out/$nom"
done <<<"$FICHIERS"

# Musique : FLAC -> MP3 (joint stéréo 44,1 kHz, 96 kb/s CBR, Xing, sans métadonnées, déterministe).
mkdir "$tmp/out/music"
while read -r n attendue; do
  flac="$data/track$n.flac"
  [ -f "$flac" ] || { echo "track$n.flac absent de $installeur" >&2; exit 1; }
  ffmpeg -hide_banner -loglevel error -nostdin -y -protocol_whitelist file -i "$flac" -vn -map_metadata -1 \
    -c:a libmp3lame -b:a 96k -joint_stereo 1 -ar 44100 -ac 2 -write_xing 1 -fflags +bitexact "$tmp/out/music/track$n.mp3"
  d="$(duree "$tmp/out/music/track$n.mp3")"
  awk -v d="$d" -v a="$attendue" -v t="$TOLERANCE" 'BEGIN { x = d - a; if (x < 0) x = -x; exit !(x <= t) }' \
    || { echo "track$n.mp3 : durée $d s, $attendue s attendues" >&2; exit 1; }
done <<<"$PISTES"

# Jaquette (boîte Amiga de Future Wars) : ne vient pas de cette extraction, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.webp

# Inventaire (avant ec_publier, qui ajoute files.json puis déplace le dossier).
{
  total_jeu=0; total_mp3=0; duree_totale=0
  for f in "$tmp/out"/*; do [ -f "$f" ] && total_jeu=$((total_jeu + $(taille "$f"))); done
  for f in "$tmp/out"/music/*.mp3; do total_mp3=$((total_mp3 + $(taille "$f"))); done
  while read -r n attendue; do duree_totale="$(awk -v a="$duree_totale" -v b="$attendue" 'BEGIN { printf "%.2f", a + b }')"; done <<<"$PISTES"
  echo "# Inventaire des fichiers des Voyageurs du temps"
  echo
  echo "Généré par \`scripts/voyageurs-extract.sh\` (ne pas éditer à la main)."
  echo
  echo "## Taille"
  echo
  echo "- Total versionné (\`original/voyageurs/\`, hors \`files.json\`) : **$(mo $((total_jeu + total_mp3))) Mo** ($((total_jeu + total_mp3)) octets)"
  echo "- Données du jeu : $(mo "$total_jeu") Mo ; musique (\`music/\`) : $(mo "$total_mp3") Mo, 11 pistes, $duree_totale s"
  echo "- Hors extraction, conservé d'une exécution à l'autre : \`COVER.webp\` (jaquette de la boîte Amiga de Future Wars)"
  echo
  echo "## Fichiers"
  echo
  echo "| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |"
  echo "|---|---:|---|---|"
  for f in "$tmp/out"/*; do
    [ -f "$f" ] || continue
    nom="$(basename "$f")"
    if [ "$nom" = COVER.webp ]; then orig="jaquette de la boîte Amiga de Future Wars (Wikipédia anglophone), conservée"; else orig="\`app/data/$nom\` de l'installeur, tel quel (décision D2), MD5 contrôlé"; fi
    echo "| $nom | $(taille "$f") | \`$(sha256 "$f" | cut -c1-16)\` | $orig |"
  done
  while read -r n attendue; do
    f="$tmp/out/music/track$n.mp3"
    echo "| music/track$n.mp3 | $(taille "$f") | \`$(sha256 "$f" | cut -c1-16)\` | \`track$n.flac\` converti, $attendue s (décision D3) |"
  done <<<"$PISTES"
  echo
  echo "## Musique"
  echo
  echo "- Pistes CD 19 à 29, numérotées comme ScummVM ; les pistes 1 à 18 ne sont référencées ni par ScummVM ni par les scripts du jeu : non versionnées"
  echo "- Encodage : \`libmp3lame\`, MP3 joint stéréo 44,1 kHz, 96 kb/s CBR, en-tête Xing, sans métadonnées, \`-fflags +bitexact\` (déterministe) ; même régime que Lost in Time"
  echo
  echo "## Non repris"
  echo
  echo "- \`.PAL\` (chargés par ScummVM mais jamais relus), \`BASESON.SND\` (musique AdLib/MT-32, inutile en version CD), exécutables, \`MANUAL.*\`, \`SONY.LBM\`, \`VOL.*\`"
  echo
  echo "## Contrôles faits à l'extraction"
  echo
  echo "- MD5 du fichier entier pour les 7 fichiers du jeu"
  echo "- Durée de chaque MP3 égale à celle du FLAC (tolérance $TOLERANCE s)"
} >"$tmp/files.md"

ec_publier "$tmp/out" "$sortie"
mkdir -p "$(dirname "$doc")"
cp "$tmp/files.md" "$doc"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
