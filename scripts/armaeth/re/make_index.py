#!/usr/bin/env python3
"""Met à jour les blocs générés de docs/armaeth/re-index.md à partir des sorties de run.sh.

Lit archives/armaeth/re/{strings,functions,libfuncs,keyfuncs}.tsv, puis remplace le contenu des blocs
  <!-- GEN:stats --> ... <!-- /GEN:stats -->
  <!-- GEN:modules --> ... <!-- /GEN:modules -->
  <!-- GEN:keyfuncs --> ... <!-- /GEN:keyfuncs -->
  <!-- GEN:libfuncs --> ... <!-- /GEN:libfuncs -->
  <!-- GEN:vgastats --> ... <!-- /GEN:vgastats -->
  <!-- GEN:vgafuncs --> ... <!-- /GEN:vgafuncs -->
(les deux derniers viennent de archives/armaeth/re/vga/, le pilote VGA.EXE ; le reste du document est écrit à la main et n'est pas touché). Bibliothèque standard seulement
(briques communes : scripts/re/make_index_lib.py).
"""
import os
import sys
from collections import Counter, OrderedDict, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "re"))
import make_index_lib as lib  # noqa: E402  (outillage commun : scripts/re/)

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "archives/armaeth/re")
DOC = os.path.join(ROOT, "docs/armaeth/re-index.md")
EXE = os.path.join(ROOT, "original/armaeth/AM1.EXE")
VGA_OUT = os.path.join(OUT, "vga")
VGA_EXE = os.path.join(ROOT, "archives/armaeth/cd/ARMAETH.FRE/VGA.EXE")

GROUPS = [
    "Démarrage et boucle principale",
    "Fichiers et chargement des données",
    "Graphique",
    "Texte et commandes",
    "Entrées",
    "Son",
    "Minuterie",
    "Logique de jeu",
    "Sauvegardes et état du monde",
]

# Modules du code identifiés (plages de segments Ghidra, chargement en 1000) : (premier, dernier, rôle).
# Le reste du code est regroupé sur une dernière ligne « non classé ».
MODULES = [
    (0x1000, 0x1004, "main (1000:0000)"),
    (0x1005, 0x1005, "initialisation du moteur"),
    (0x105e, 0x1264, "gestionnaires des 11 groupes de jetons de commande (105e, 10f2, 10fb, 111f, 117d, 11dc, 1218, 123d, 1250), DEF (10b3), recherche d'objet (1118)"),
    (0x1265, 0x1265, "affichage de tous les champs d'un objet (dump de débogage)"),
    (0x12c2, 0x12c2, "tracé de lignes (écriture directe en A000)"),
    (0x1346, 0x1346, "scripts CM1-CM4 (XOR 0xBB)"),
    (0x1564, 0x1564, "contrôle du héros à la souris / déplacement"),
    (0x16f5, 0x1735, "ANI et ressources sprite"),
    (0x18a9, 0x18a9, "boucle principale"),
    (0x192e, 0x192e, "chargement du monde (CFG / STD / SVG)"),
    (0x19a6, 0x1a7a, "création et listes d'objets"),
    (0x1cc3, 0x1cc3, "chargement de salle"),
    (0x1d4a, 0x1d4a, "sauvegarde du monde"),
    (0x1d83, 0x1dd4, "erreurs, analyse de la commande tapée, dictionnaire"),
    (0x1e08, 0x1e68, "hasard, listes, chemins et ouverture des fichiers de données"),
    (0x1ee6, 0x1ee6, "sortie"),
    (0x1f94, 0x1f94, "décodeur d'images de fond"),
    (0x1ff8, 0x2013, "allocation, messages (TMS / MSG)"),
    (0x2052, 0x2065, "emplacements de sauvegarde, MSGINT"),
    (0x2255, 0x2255, "tables du monde"),
    (0x2f33, 0x3024, "son (MIX et pilote)"),
    (0x3187, 0x3187, "recherche de chemin"),
    (0x325a, 0x327a, "police GPH, affichage de texte"),
    (0x348a, 0x34ba, "erreurs critiques DOS (INT 24h), erreurs fatales, disque"),
    (0x34eb, 0x356b, "arguments, ouverture avec invite de disque, messages matériels"),
    (0x3574, 0x35f9, "BIOS : écran INT 10h, clavier INT 16h, minuterie INT 1Ah, souris INT 33h (35c0-35e8)"),
    (0x35fa, 0x3937, "curseur logiciel et état vidéo (35fa-36d4 : appels INT 33h/10h, accès EGA/VGA direct 3CEh), clavier INT 16h (3928), palette EGA (3855)"),
    (0x34bb, 0x34bb, "décompresseurs de ligne d'image"),
    (0x3938, 0x3dfe, "startup + bibliothèque C Microsoft 6.0 (modèle large)"),
    (0x3dff, 0x406d, "émulateur 8087 (INT 34h-3Dh)"),
    (0x406e, 0x40f6, "données du pilote musical embarqué (DS = 406e)"),
    (0x40f7, 0x42d6, "pilote musical embarqué (OPL2, MIDI, haut-parleur ; ISR IRQ0)"),
]


def seg_of(a):
    return int(a.split(":")[0], 16)


functions = lib.load_functions(OUT)
strings = lib.load_strings(OUT)
libs = lib.tsv(OUT, "libfuncs.tsv")
keys = lib.tsv(OUT, "keyfuncs.tsv")


def render_modules():
    rows = []
    used = set()
    for lo, hi, label in sorted(MODULES):
        fs = [(a, f) for a, f in functions.items() if lo <= seg_of(a) <= hi]
        used.update(a for a, _ in fs)
        segs = {seg_of(a) for a, _ in fs}
        size = sum(f["size"] for _, f in fs)
        ok = sum(1 for _, f in fs if f["status"] == "ok")
        rows.append("| `%04x`%s | %d | %d | %d | %d %% | %s |" % (
            lo, "" if lo == hi else "-`%04x`" % hi, len(segs), len(fs), size, 100 * ok // len(fs) if fs else 0, lib.md_cell(label)))
    rest = [(a, f) for a, f in functions.items() if a not in used]
    rows.append("| autres | %d | %d | %d | %d %% | non classé : comportements d'objets et de salles (2363-2f32, 3187-3340...), objets, graphique et pilotes divers |" % (
        len({seg_of(a) for a, _ in rest}), len(rest), sum(f["size"] for _, f in rest),
        100 * sum(1 for _, f in rest if f["status"] == "ok") // max(1, len(rest))))
    head = ["| Segments | Segments non vides | Fonctions | Octets | Décompil. ok | Rôle |", "|---|---:|---:|---:|---:|---|"]
    return "\n".join(head + rows)


def render_keyfuncs():
    by = defaultdict(list)
    for r in keys:
        by[r[4]].append(r)
    out = []
    for g in GROUPS:
        rows = sorted(by.get(g, []), key=lambda r: tuple(int(x, 16) for x in r[0].split(":")))
        if not rows:
            continue
        out.append("#### %s\n" % g)
        out.append("| Adresse | Nom proposé | Octets | Appelants | Rôle | Preuve | Confiance |")
        out.append("|---|---|---:|---:|---|---|---|")
        for r in rows:
            out.append("| `%s` | `%s` | %s | %s | %s | %s | %s |" % (
                r[0], r[1], r[2], r[3], lib.md_cell(r[6]), lib.md_cell(r[7]), r[5]))
        out.append("")
    return "\n".join(out).rstrip("\n")


def render_libfuncs():
    rows = sorted(libs, key=lambda r: tuple(int(x, 16) for x in r[0].split(":")))
    out = ["| Adresse | Nom | Octets | Appelants | Confiance | Preuve |", "|---|---|---:|---:|---|---|"]
    for r in rows:
        out.append("| `%s` | `%s` | %s | %s | %s | %s |" % (r[0], r[1], r[2], r[3], r[4], lib.md_cell(r[5])))
    return "\n".join(out)


VGA_GROUPS = [
    "Installation résidente (TSR)",
    "Gestionnaires d'interruption",
    "Table du pilote (appelée par AM1 via CALLF [table+n])",
    "Support interne (tampons, VGA)",
]


def render_vga_stats():
    vf = lib.load_functions(VGA_OUT)
    vk = lib.tsv(VGA_OUT, "keyfuncs.tsv")
    with open(VGA_EXE, "rb") as f:
        raw = f.read()
    kinds = Counter(f["kind"] for f in vf.values())
    status = Counter(f["status"] for f in vf.values())
    sizes = sum(f["size"] for f in vf.values())
    dur = os.environ.get("RE_DURATION_VGA_S", "?")
    return "\n".join([
        "- Durée de la dernière régénération du pilote : %s s." % dur,
        "- Fonctions : %d (%s), %d octets ; %d nommées (`vga_*`), décompilation : %s." % (
            len(vf), ", ".join("%s %d" % (k, v) for k, v in sorted(kinds.items())), sizes, len(vk),
            ", ".join("%s %d" % (k, v) for k, v in sorted(status.items()))),
        "- Image : %d octets ; un seul segment de code (`1000` en chargement Ghidra), DGROUP = segment `12f5`." % len(raw),
    ])


def render_vga_funcs():
    by = defaultdict(list)
    for r in lib.tsv(VGA_OUT, "keyfuncs.tsv"):
        by[r[4]].append(r)
    out = []
    for g in VGA_GROUPS:
        rows = sorted(by.get(g, []), key=lambda r: tuple(int(x, 16) for x in r[0].split(":")))
        if not rows:
            continue
        out.append("#### %s\n" % g)
        out.append("| Adresse | Nom | Octets | Rôle | Preuve | Confiance |")
        out.append("|---|---|---:|---|---|---|")
        for r in rows:
            out.append("| `%s` | `%s` | %s | %s | %s | %s |" % (r[0], r[1], r[2], lib.md_cell(r[6]), lib.md_cell(r[7]), r[5]))
        out.append("")
    return "\n".join(out).rstrip("\n")


with open(DOC, encoding="utf-8") as f:
    doc = f.read()
os.environ["RE_DURATION_S"] = os.environ.get("RE_DURATION_AM1_S", os.environ.get("RE_DURATION_S", "?"))
doc = lib.replace_block(doc, "stats", lib.render_stats(functions, strings, libs, EXE, rtl_seg="3938",
                                                      rtl_label="C Microsoft", code_base=0x10000), DOC)
doc = lib.replace_block(doc, "modules", render_modules(), DOC)
doc = lib.replace_block(doc, "keyfuncs", render_keyfuncs(), DOC)
doc = lib.replace_block(doc, "libfuncs", render_libfuncs(), DOC)
doc = lib.replace_block(doc, "vgastats", render_vga_stats(), DOC)
doc = lib.replace_block(doc, "vgafuncs", render_vga_funcs(), DOC)
with open(DOC, "w", encoding="utf-8") as f:
    f.write(doc)
print("[re] %s mis à jour" % os.path.relpath(DOC, ROOT))
