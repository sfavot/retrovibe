#!/usr/bin/env bash
# Extrait Beneath a Steel Sky (Revolution Software, 1994), version CD 1.2 (bass-cd-1.2.zip : sky.dsk, sky.dnr,
# sky.cpt, readme.txt, archive préparée par ScummVM), dans original/bass/ :
#  - sky.dsk et sky.dnr reconstruits SANS les voix (identifiants 50000 à 55277), au même format : les fichiers
#    restants sont copiés octet pour octet, les positions de l'index recalculées (scripts/bass/split_dsk.py) ;
#  - voices/<id>.mp3 : les 3 491 voix (PCM 8 bits 11 025 Hz, décompressé du RNC), en MP3 comme FOTAQ (ec_encoder_voix) ;
#  - sky.cpt tel quel, README-BASS.txt (readme d'origine, licence : à conserver intact) et files.json ;
#  - l'inventaire docs/bass/files.md.
# COVER.png vient de la vague J : conservé tel quel s'il existe.
# Usage : scripts/bass-extract.sh [bass-cd-1.2.zip]   (défaut : archives/bass-cd-1.2.zip)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'archive est une donnée non fiable : rien n'en est exécuté (python en -I, ffmpeg ne lit que des fichiers locaux).
# Outils requis : bsdtar, python3, ffmpeg (libmp3lame).
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
archive="${1:-$racine/archives/bass-cd-1.2.zip}"
sortie="$racine/original/bass"
doc="$racine/docs/bass/files.md"
utils="$racine/scripts/bass/split_dsk.py"

# Valeurs de l'archive v0.0372 (observées à la vague X, voir docs/bass/files.md).
TAILLE_DSK=72395713
NB_ENTREES=5097
NB_VOIX=3491
SHA_DSK=9ef6ca3dcb6f9ceb31e950bc3a05d5105bbbb38a5e9fc9a9f6508363c87849e2
SHA_DNR=1aa426bc9b04d962c98f2c6108f770b23a45a32cb85bd4e053a6eb1779173164
SHA_CPT=9f41a3be39db91391400401152bd62435500b772bc92613d2c2eea0eb816982f

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils bsdtar python3 ffmpeg
[ -f "$archive" ] || { echo "Fichier introuvable : $archive" >&2; exit 1; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
taille() { wc -c <"$1" | tr -d ' '; }

ec_init_tmp
mkdir "$tmp/zip" "$tmp/out" "$tmp/dsk" "$tmp/raw"
bsdtar -xf "$archive" -C "$tmp/zip"
trouver() {
  local f
  f="$(find "$tmp/zip" -iname "$1" -type f | head -1)"
  [ -n "$f" ] || { echo "$1 absent de $archive" >&2; exit 1; }
  printf '%s\n' "$f"
}
dsk="$(trouver sky.dsk)"; dnr="$(trouver sky.dnr)"; cpt="$(trouver sky.cpt)"; readme="$(trouver readme.txt)"

# Contrôles d'entrée : tailles, nombre d'entrées de l'index (4 octets LE), hachages.
[ "$(taille "$dsk")" -eq "$TAILLE_DSK" ] || { echo "sky.dsk : $TAILLE_DSK octets attendus" >&2; exit 1; }
[ "$(taille "$dnr")" -eq $((4 + 8 * NB_ENTREES)) ] || { echo "sky.dnr : $NB_ENTREES entrées attendues" >&2; exit 1; }
[ "$(sha256 "$dsk")" = "$SHA_DSK" ] || { echo "sky.dsk : SHA-256 inattendu" >&2; exit 1; }
[ "$(sha256 "$dnr")" = "$SHA_DNR" ] || { echo "sky.dnr : SHA-256 inattendu" >&2; exit 1; }
[ "$(sha256 "$cpt")" = "$SHA_CPT" ] || { echo "sky.cpt : SHA-256 inattendu" >&2; exit 1; }

# Découpage, puis contrôle : chaque fichier hors voix du couple reconstruit est identique à l'original.
py decouper "$dnr" "$dsk" "$tmp/dsk" "$tmp/raw"
py check "$dnr" "$dsk" "$tmp/dsk/sky.dnr" "$tmp/dsk/sky.dsk"
mv "$tmp/dsk/sky.dsk" "$tmp/dsk/sky.dnr" "$tmp/out/"

# Voix : PCM brut 8 bits non signé, 11 025 Hz, mono -> MP3 (mêmes options que FOTAQ).
ec_encoder_voix "$tmp/raw" raw "$tmp/out/voices" 24k -f u8 -ar 11025 -ac 1
[ "$ec_nb_voix" -eq "$NB_VOIX" ] || { echo "$NB_VOIX voix attendues, $ec_nb_voix converties" >&2; exit 1; }

cp "$cpt" "$tmp/out/sky.cpt"
cp "$readme" "$tmp/out/README-BASS.txt"
# Jaquette (vague J) : ne vient pas de cette extraction, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.png

py inventaire "$tmp/out" "$(dirname "$dsk")" "$tmp/raw" "$doc"
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
