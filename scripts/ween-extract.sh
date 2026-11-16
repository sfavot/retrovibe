#!/usr/bin/env bash
# Extrait Ween : The Prophecy (Coktel Vision, 1992), version DOS française, de l'installeur Abandonware France
# (setup-00126-Ween_The_Prophecy-dosbox.exe, Inno Setup), dans original/ween/ :
#  - INTRO.STK tel quel (décision D3 : tout le jeu y est) ; COVER.webp (jaquette de la boîte d'origine, Wikipédia anglophone) conservé tel quel s'il existe ;
#  - files.json ;
#  - l'inventaire docs/ween/files.md.
# Le reste de l'installeur (LOADER.EXE, *.GDR, ALL.ASK, *.INF, DOSBox, DLL...) n'est pas lu par le port : écarté.
# Usage : scripts/ween-extract.sh [installeur]
#   défaut : archives/ween/setup-00126-Ween_The_Prophecy-dosbox.exe.
# Idempotent : tout est construit dans un dossier temporaire, puis substitué d'un bloc en fin de script.
# L'installeur est une donnée non fiable : il n'est JAMAIS exécuté (innoextract seul, dans un dossier vide neuf).
# Outils requis : innoextract, python3.
set -euo pipefail

racine="$(cd "$(dirname "$0")/.." && pwd)"
nom="setup-00126-Ween_The_Prophecy-dosbox.exe"
installeur="${1:-$racine/archives/ween/$nom}"
sortie="$racine/original/ween"
doc="$racine/docs/ween/files.md"

# Valeurs observées à la vague X.
TAILLE_STK=7029591
MD5_STK=3ff06b7834918564f220f669c72de494

# shellcheck source=lib/extract-common.sh
source "$racine/scripts/lib/extract-common.sh"
ec_verifier_outils innoextract python3
[ -f "$installeur" ] || { echo "Fichier introuvable : $installeur" >&2; exit 1; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
md5() { if command -v md5sum >/dev/null; then md5sum "$1"; else md5 -q "$1"; fi | cut -d' ' -f1; }
taille() { wc -c <"$1" | tr -d ' '; }

ec_init_tmp
mkdir "$tmp/inno" "$tmp/out"
innoextract --silent --extract --output-dir "$tmp/inno" "$installeur" >/dev/null

stk="$(find "$tmp/inno" -type f -name INTRO.STK | head -1)"
[ -n "$stk" ] || { echo "INTRO.STK absent de $installeur" >&2; exit 1; }
[ "$(taille "$stk")" -eq "$TAILLE_STK" ] || { echo "INTRO.STK : $TAILLE_STK octets attendus" >&2; exit 1; }
[ "$(md5 "$stk")" = "$MD5_STK" ] || { echo "INTRO.STK : MD5 inattendu" >&2; exit 1; }
cp "$stk" "$tmp/out/INTRO.STK"

# Jaquette : ne vient pas de l'installeur, conservée si présente.
ec_conserver "$sortie" "$tmp/out" COVER.webp

# Inventaire (même format que docs/bass/files.md).
total=0
lignes=""
for f in "$tmp/out"/*; do
  n="$(basename "$f")"
  t="$(taille "$f")"
  total=$((total + t))
  case "$n" in
    INTRO.STK) origine="\`INTRO.STK\` de l'installeur, tel quel (décision D3 : tout le jeu est dans ce fichier)" ;;
    COVER.webp) origine="jaquette de la boîte d'origine (Wikipédia anglophone), conservé d'une exécution à l'autre" ;;
    *) origine="" ;;
  esac
  lignes="$lignes| $n | $t | \`$(sha256 "$f" | cut -c1-16)\` | $origine |"$'\n'
done
mkdir -p "$(dirname "$doc")"
{
  echo "# Inventaire des fichiers de Ween : The Prophecy"
  echo
  echo "Généré par \`scripts/ween-extract.sh\` (ne pas éditer à la main)."
  echo
  echo "## Taille"
  echo
  echo "- Total versionné (\`original/ween/\`) : **$(awk -v t="$total" 'BEGIN{printf "%.1f Mo", t/1048576}')** ($total octets), $(find "$tmp/out" -type f | wc -l | tr -d ' ') fichier(s) (hors \`files.json\`)"
  echo "- Hors extraction, conservé d'une exécution à l'autre : \`COVER.webp\` (jaquette de la boîte d'origine)"
  echo
  echo "## Fichiers"
  echo
  echo "| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |"
  echo "|---|---:|---|---|"
  printf '%s' "$lignes"
  echo
  echo "## Contrôles faits à l'extraction"
  echo
  echo "- \`INTRO.STK\` : $TAILLE_STK octets, MD5 \`$MD5_STK\` (vérifiés avant la copie)."
  echo "- SHA-256 complet de \`INTRO.STK\` : \`$(sha256 "$tmp/out/INTRO.STK")\`."
  echo "- L'installeur (Inno Setup) n'est jamais exécuté : \`innoextract\` seul, dans un dossier temporaire vide."
} >"$doc"

ec_publier "$tmp/out" "$sortie"
echo "Terminé : $sortie ($(du -sh "$sortie" | cut -f1)) ; inventaire : $doc"
