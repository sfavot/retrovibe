#!/usr/bin/env bash
# Extrait Croisière pour un cadavre (Delphine Software International, 1991), version DOS VGA 256 couleurs française,
# de l'installeur Abandonware France (setup-00074-Croisiere_pour_un_cadavre-Dosbox.exe, Inno Setup), dans original/croisiere/ :
#  - D1..D5 et VOL.CNF : les volumes d'origine, octet pour octet (décision D2 : le lecteur est celui du jeu) ;
#  - DELPHINE.LNG, SYSTEM.FNT : textes et police système, tels quels ; LISEZ.MOI : léame de l'installeur (provenance) ;
#  - COVER.png (vague J) conservé tel quel s'il existe, et files.json ;
#  - l'inventaire docs/croisiere/files.md (scripts/croisiere/list_volumes.py).
# Le reste de l'installeur (DOSBox, DELPHINE.EXE, VGADRV.BIN, VOL.1..5...) n'est pas lu par le port : écarté.
# Usage : scripts/croisiere-extract.sh [installeur]   (défaut : archives/croisiere/setup-00074-Croisiere_pour_un_cadavre-Dosbox.exe)
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'installeur est une donnée non fiable : il n'est JAMAIS exécuté (innoextract seul, dans un dossier vide ; python en -I).
# Outils requis : innoextract, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
installeur="${1:-$racine/archives/croisiere/setup-00074-Croisiere_pour_un_cadavre-Dosbox.exe}"
sortie="$racine/original/croisiere"
doc="$racine/docs/croisiere/files.md"
liste="$racine/scripts/croisiere/list_volumes.py"

# Fichiers gardés, avec taille et SHA-256 observés à la vague X.
FICHIERS="D1 D2 D3 D4 D5 VOL.CNF DELPHINE.LNG SYSTEM.FNT LISEZ.MOI"
attendu() {
  case "$1" in
    D1) echo "611387 ec46313a26603ac9e9e5d84da204abdb6073d27c6a41f14d5a18d1628ef4ba19" ;;
    D2) echo "637687 b0eded6bcabc05f72c49bcfb1e7bfb2c28ecb197a01487c3de491517976b6ca9" ;;
    D3) echo "699783 cc9b621e82c8e8d456eabd25ac35d207ef7a8e5fd0d273c7ad993fc9e1296f9e" ;;
    D4) echo "787008 041680487ac775e20bd647285719573c0a327dd0733d0e93db009d6a2de2ce77" ;;
    D5) echo "729041 e0762b81554c40967ee733fc31b5f47ba0a7b98d21df4aa38003fb1e72ba0453" ;;
    VOL.CNF) echo "14372 40cac611b89fcab36bd282a59553f6c37c2f33240dfbd67b5c5cc5f0ea0461ae" ;;
    DELPHINE.LNG) echo "620 e269b5c1f3ffb213f8de95e6298070687309b079b25dd4c002391fa947cd2cd4" ;;
    SYSTEM.FNT) echo "6362 2cd11e8710626d5d95303bea200c1cbc7e01851fef146a2cec797c10eabc923f" ;;
    LISEZ.MOI) echo "4022 b5cf83ac16ee8e9b2c97c9bc805108f27cac8cc6d06d4028d347a6dc3b630a32" ;;
  esac
}

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils innoextract python3
[ -f "$installeur" ] || { echo "Fichier introuvable : $installeur" >&2; exit 1; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
taille() { wc -c <"$1" | tr -d ' '; }

ec_init_tmp
mkdir "$tmp/inno" "$tmp/out"
innoextract --silent --extract --output-dir "$tmp/inno" "$installeur" >/dev/null

source_dir="$(find "$tmp/inno" -type d -name Croisier | head -1)"
[ -n "$source_dir" ] || { echo "Dossier Croisier absent de $installeur" >&2; exit 1; }

# Contrôles d'entrée puis copie octet pour octet (aucun autre fichier de l'installeur n'est gardé).
for f in $FICHIERS; do
  [ -f "$source_dir/$f" ] || { echo "$f absent de $installeur" >&2; exit 1; }
  read -r taille_attendue sha_attendu <<<"$(attendu "$f")"
  [ "$(taille "$source_dir/$f")" -eq "$taille_attendue" ] || { echo "$f : $taille_attendue octets attendus" >&2; exit 1; }
  [ "$(sha256 "$source_dir/$f")" = "$sha_attendu" ] || { echo "$f : SHA-256 inattendu" >&2; exit 1; }
  cp "$source_dir/$f" "$tmp/out/$f"
done

# Inventaire : lit VOL.CNF et les répertoires de D1..D5 (écrit docs/croisiere/files.md ; contrôle la concordance).
python3 -I "$liste" "$tmp/out" "$tmp/files.md"

# Jaquette (vague J) : ne vient pas de l'installeur, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.png

mkdir -p "$(dirname "$doc")"
cp "$tmp/files.md" "$doc"
ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
