#!/usr/bin/env bash
# Banc d'essai DOSBox-X sans fenêtre pour l'Armaeth d'origine (DOS, 1994, version française).
#
# ---------------------------------------------------------------------------------------------------------------
# Principe
#   Lance `vga` puis `am1 * a1f` (comme ARMAETH.BAT, sans le contrôle de protection SC0) dans DOSBox-X avec le
#   pilote vidéo SDL « dummy » (aucune fenêtre), pilote le jeu avec des touches AUTOTYPE planifiées, et enregistre
#   la partie en vidéo (DX-CAPTURE /V : AVI ZMBV, une entrée par image VGA émulée = 70,0866 images/s en mode 13h,
#   plus le son OPL2). L'instant d'une image est donc exact : image n = n / 70,0866 s d'émulation. ffmpeg (hors
#   dépôt, utilisé seulement ici) en tire des PNG ; video.py mesure (changements d'écran, position du héros…).
#
# Usage
#   scripts/armaeth/dosbox/run.sh [-s scénario] [-d secondes] [-c cycles] [-o dossier] [-p "t1 t2 …"] [-f fps]
#                                 [-r échelle] [-t essais] [-n] [-k] [-x] [-i fichier]…
#     -s  scénario de touches (format ci-dessous) ; l'introduction est passée automatiquement (sauf avec -n)
#     -d  durée émulée, en s (défaut 90) ; la session s'arrête à ce moment (ou à la sortie du jeu)
#     -c  cycles CPU fixes (défaut 25000, voir dosbox.conf)
#     -o  dossier de sortie (défaut : $DX_WORK/out, avec DX_WORK = ${TMPDIR:-/tmp}/armaeth-dosbox)
#     -p  PNG aux instants vidéo donnés (s depuis le début de l'AVI), dans <sortie>/shots/
#     -f  PNG à cette fréquence (images/s) dans <sortie>/frames/ ; -r : échelle (1 = 640x400, défaut 0,5 = 320x200)
#     -t  nombre d'essais si une attente du scénario (@expect) n'est pas vérifiée (défaut 4, voir « Fiabilité »)
#     -n  ne passe pas l'introduction (écran titre et récit, ~42 s)
#     -k  garde le dossier de travail précédent (sauvegardes du jeu, A1FTMP.SVG…) au lieu de le recopier du CD
#     -x  n'impose pas les deux attentes de l'introduction (S13 / S14) : sur certaines machines elles tombent quelques
#         centaines de ms hors des fenêtres prévues, l'essai échoue alors à chaque fois (la session est déterministe)
#     -i  fichier copié dans ARMAETH.FRE avant le lancement (par exemple une sauvegarde SVG00n.STD) ; répétable
#   Données : archives/armaeth/cd/ARMAETH.FRE (extraction : scripts/armaeth-extract.sh). Jamais modifiées :
#   le jeu travaille sur une copie ($DX_WORK/c/ARMAETH.FRE).
#   Sorties : <sortie>/video.avi (la partie), events.txt (instants où l'écran change beaucoup), console.log
#   (texte DOS), dosbox.log, autoexec.conf, scenario.txt (scénario complet), shots/ et frames/.
#   Analyse : python3 -I scripts/armaeth/dosbox/video.py --help (événements, position du héros, planches, couleurs).
#
# Scénario (autotype.py) : une ligne par action, « T jeton… », T en secondes depuis le lancement de am1 ; # = commentaire.
#   jeton = nom de touche AUTOTYPE (enter, esc, f1…f10, left, right, up, down, home, end, pageup, pagedown, space…),
#   « !texte libre » = une touche par caractère (sans accents), +1.5 = pause supplémentaire avant le jeton suivant.
#   @expect T0 T1 [seuil]  : l'écran doit changer d'au moins `seuil` (défaut 20000, voir video.py events) entre T0 et T1 ;
#                            sinon l'essai est jeté et relancé (l'attente de l'introduction est ajoutée d'office).
#   Exemple :   46 "!/dgs 99" enter        56 "!regarder dans l'armoire" enter        @expect 58 70
#   Instants : le simulateur d'autotype.py tient les comptes (une touche coûte 0,26 s, une virgule 0,4 s) ; l'erreur
#   reste de l'ordre de la seconde. Toujours vérifier sur la vidéo.
#
# Jetons de débogage (à taper dans le jeu, une fois `/dgs 99` passé ; ce niveau retombe à 0 à chaque script, donc
# après chaque `/trf`) : /trf n (salle n), /loc n (où est l'objet n), /inf n (fiche de l'objet n, 1 = le héros),
# /heu h m cs (heure du jeu), /ral n (délai de cadence), /wat n (attente de n tics BIOS), /dlo n (supprime l'objet n).
#
# Choses à savoir (cherchées à la dure, voir docs/armaeth/dosbox.md)
#   * SC0.EXE (contrôle du « tableau numérique ») est sauté. Mais sans lui `am1` s'arrête sur « Gestion vidéo non
#     disponible » : la table du pilote VGA n'est publiée qu'après l'appel de l'entrée +0x14 du bloc de liaison
#     (`vga_init_block`, le jeton `isr`), que rien d'autre ne fait au démarrage. Un mini-programme VINIT.COM de
#     20 octets (écrit ici) fait cet appel, entre `vga` et `am1`.
#   * ARMINS (lancé par START.BAT) inscrit dans A1FINS.SYS l'étiquette du volume ; le lecteur C: est donc monté
#     avec -label ARMAETH, sinon `am1` s'arrête sur « Le label disque ne correspond pas ».
#   * Dossier courant ARMAETH.FRE sous C: et argument `*` : les fichiers sont cherchés à plat.
#   * Pas de souris (int33=false) : le héros se commande aux flèches (une pression le fait marcher en continu), les
#     ordres se tapent. Alt+lettre (réglage de cadence) n'est pas envoyable : AUTOTYPE ne tient qu'une touche.
#   * AUTOTYPE : une SEULE commande par session (deux commandes qui se suivent figent DOSBox-X en jeu) ; cadence
#     0,2 s (à 0,5 s et plus la touche est tenue assez longtemps pour se répéter et fausser les fenêtres) ;
#     DOSBox-X ne quitte qu'une fois toutes les touches envoyées, d'où le chien de garde de durée + 40 s.
#   * Fiabilité : environ une session sur cinq perd les touches (une fenêtre ou la ligne de saisie ignore Entrée
#     pendant des dizaines de secondes ; cause non trouvée, peut-être une condition de course entre AUTOTYPE et la
#     lecture clavier du jeu). Les @expect détectent l'échec et relancent. Les sessions réussies sont reproductibles
#     à l'image près.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SRC="$ROOT/archives/armaeth/cd/ARMAETH.FRE"
DX_WORK="${DX_WORK:-${TMPDIR:-/tmp}/armaeth-dosbox}"
SCENARIO="" INTRO_EXPECT=1 SKIP_INTRO=1 DURATION=90 CYCLES=25000 OUT="" SHOTS="" FPS="" SCALE=0.5 KEEP=0 TRIES=4 EXTRA=()

while getopts "s:d:c:o:p:f:r:t:knxi:" opt; do
  case $opt in
    s) SCENARIO="$OPTARG" ;;
    d) DURATION="$OPTARG" ;;
    c) CYCLES="$OPTARG" ;;
    o) OUT="$OPTARG" ;;
    p) SHOTS="$OPTARG" ;;
    f) FPS="$OPTARG" ;;
    r) SCALE="$OPTARG" ;;
    t) TRIES="$OPTARG" ;;
    k) KEEP=1 ;;
    n) SKIP_INTRO=0 ;;
    x) INTRO_EXPECT=0 ;;
    i) EXTRA+=("$OPTARG") ;;
    *) sed -n '2,60p' "$0"; exit 2 ;;
  esac
done
OUT="${OUT:-$DX_WORK/out}"

command -v dosbox-x >/dev/null || { echo "dosbox-x introuvable (brew install dosbox-x)" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg introuvable (brew install ffmpeg) : nécessaire pour lire la vidéo" >&2; exit 1; }
[ -d "$SRC" ] || { echo "CD extrait introuvable : $SRC (scripts/armaeth-extract.sh)" >&2; exit 1; }
mkdir -p "$OUT"

# 1. Dossier de travail : une copie du jeu, pour que les sauvegardes et A1FINS.SYS ne touchent jamais au CD extrait.
C="$DX_WORK/c"
prepare_game() {
  if [ "$KEEP" = 0 ] || [ ! -d "$C/ARMAETH.FRE" ]; then
    mkdir -p "$C/ARMAETH.FRE"
    rsync -a --delete "$SRC/" "$C/ARMAETH.FRE/"
  fi
  for f in ${EXTRA[@]+"${EXTRA[@]}"}; do cp "$f" "$C/ARMAETH.FRE/"; done
  # VINIT.COM : MOV AX,1D5Fh / MOV CX,00CBh / INT 16h (adresse du bloc du pilote) ; MOV ES,DX / MOV BX,CX /
  # CALL FAR ES:[BX+14h] (vga_init_block) ; MOV AH,4Ch / INT 21h.
  printf '\xB8\x5F\x1D\xB9\xCB\x00\xCD\x16\x8E\xC2\x89\xCB\x26\xFF\x5F\x14\xB4\x4C\xCD\x21' > "$C/ARMAETH.FRE/VINIT.COM"
}

# 2. Scénario complet : l'introduction est passée en appuyant sur Entrée (une fenêtre toutes les ~1,6 s dès 11,7 s :
# 10 paragraphes de récit, puis S13 et S14 60 tics après l'arrivée dans la salle 1, soit à ~37,7 s et ~39,1 s), avec
# de la marge ; ensuite le scénario de l'appelant. Les @expect du scénario sont mis de côté (dans EXPECTS).
FULL_SCENARIO="$OUT/scenario.txt"
EXPECTS="$OUT/expects.txt"
: > "$FULL_SCENARIO"; : > "$EXPECTS"
if [ "$SKIP_INTRO" = 1 ]; then
  for k in $(seq 0 13); do echo "$(python3 -c "print(11.5 + 1.6 * $k)") enter" >> "$FULL_SCENARIO"; done
  printf '38.4 enter\n40 enter\n41.6 enter\n43.2 enter\n' >> "$FULL_SCENARIO"
  # S14 apparaît (~39,1 s) puis se ferme (~41,1 s) : deux changements d'écran importants, sinon les touches se perdent
  [ "$INTRO_EXPECT" = 1 ] && printf '38.8 39.7 20000\n40.6 41.9 20000\n' >> "$EXPECTS"
fi
if [ -n "$SCENARIO" ]; then
  grep -v '^[[:space:]]*@expect' "$SCENARIO" >> "$FULL_SCENARIO" || true
  grep '^[[:space:]]*@expect' "$SCENARIO" | sed -E 's/^[[:space:]]*@expect[[:space:]]+//' >> "$EXPECTS" || true
fi

# 3. AUTOEXEC : ce que fait START.BAT / ARMAETH.BAT, plus les touches planifiées juste avant le lancement de am1.
AUTO="$OUT/autoexec.conf"
{
  echo "[autoexec]"
  echo "@echo off"
  echo "mount c $C -label ARMAETH"
  echo "c:"
  echo "cd armaeth.fre"
  echo "armins"
  echo "vga"
  echo "vinit"
  [ -s "$FULL_SCENARIO" ] && python3 -I "$HERE/autotype.py" "$FULL_SCENARIO"
  echo "dx-capture /v am1 * a1f"
  echo "exit"
} > "$AUTO"

# 4. Un essai : lancement sans fenêtre (SDL « dummy »), avec un chien de garde (macOS n'a pas timeout(1)).
attempt() {
  rm -rf "$OUT/cap"; mkdir -p "$OUT/cap"
  rm -f "$OUT/video.avi" "$OUT/console.log" "$OUT/dosbox.log" "$OUT/events.txt"
  prepare_game
  export SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy
  perl -e 'alarm shift; exec @ARGV' $((DURATION + 40)) \
    dosbox-x -conf "$HERE/dosbox.conf" -conf "$AUTO" -fastlaunch -log-con -time-limit "$DURATION" \
    -set "dosbox captures=$OUT/cap" -set "cpu cycles=fixed $CYCLES" > "$OUT/dosbox.log" 2>&1 || \
    echo "dosbox-x terminé avec le code $? (chien de garde)" >&2
  grep "DOS CON" "$OUT/dosbox.log" | sed 's/^LOG: DOS CON: //' > "$OUT/console.log" || true
  # La vidéo de la partie = la plus grosse des captures (les autres sont des passages en mode texte).
  local best
  best=$(ls -S "$OUT"/cap/*.avi 2>/dev/null | head -1 || true)
  [ -n "$best" ] || { echo "aucune vidéo produite, voir $OUT/dosbox.log" >&2; return 2; }
  mv "$best" "$OUT/video.avi"; rm -rf "$OUT/cap"
  python3 -I "$HERE/video.py" events "$OUT/video.avi" > "$OUT/events.txt"
  # Attentes : au moins un changement d'écran d'au moins `seuil` dans [T0, T1].
  local t0 t1 thr ok=0
  while read -r t0 t1 thr; do
    [ -n "${t0:-}" ] || continue
    if ! python3 -I "$HERE/video.py" events "$OUT/video.avi" "$t0" "$t1" --thr "${thr:-20000}" | grep -q .; then
      echo "attente non vérifiée : aucun changement d'écran >= ${thr:-20000} entre $t0 et $t1 s" >&2; ok=1
    fi
  done < "$EXPECTS"
  return $ok
}
n=1
until attempt; do
  [ "$n" -lt "$TRIES" ] || { echo "échec après $TRIES essais (les touches se perdent parfois : voir « Fiabilité »)" >&2; exit 3; }
  n=$((n + 1)); echo "nouvel essai ($n/$TRIES)" >&2
done
echo "vidéo : $OUT/video.avi ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/video.avi") s), essai $n"
tail -3 "$OUT/console.log" | sed 's/^/console : /'

# 5. PNG (ffmpeg) : instants précis ou séquence. 320x200 par défaut (pixels du jeu), 640x400 avec -r 1.
W=$(python3 -c "print(int(640*$SCALE))"); H=$(python3 -c "print(int(400*$SCALE))")
png() { # png <entrée.avi> <sortie.png> <options d'entrée…>
  ffmpeg -loglevel error -y "${@:3}" -i "$1" -frames:v 1 -vf "crop=640:400:0:0,scale=$W:$H:flags=neighbor" -pix_fmt pal8 "$2"
}
rm -rf "$OUT/shots" "$OUT/frames"
if [ -n "$SHOTS" ]; then
  mkdir -p "$OUT/shots"
  for t in $SHOTS; do png "$OUT/video.avi" "$OUT/shots/t$(printf %07.2f "$t").png" -ss "$t"; done
  echo "PNG : $OUT/shots/"
fi
if [ -n "$FPS" ]; then
  mkdir -p "$OUT/frames"
  ffmpeg -loglevel error -y -i "$OUT/video.avi" -vf "fps=$FPS,crop=640:400:0:0,scale=$W:$H:flags=neighbor" -pix_fmt pal8 "$OUT/frames/f%05d.png"
  echo "PNG : $OUT/frames/ (une image toutes les $(python3 -c "print(1/$FPS)") s)"
fi
