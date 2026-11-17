#!/usr/bin/env python3
"""Met à jour les blocs générés de docs/asterix/re-index.md à partir des sorties de run.sh.

Lit archives/asterix/re/{strings,functions,libfuncs,keyfuncs,module_entries}.tsv, puis remplace le contenu des blocs
  <!-- GEN:stats --> ... <!-- /GEN:stats -->
  <!-- GEN:modules --> ... <!-- /GEN:modules -->     (mini-jeux : case, dossier MDF/NN, fonction d'entrée, tailles)
  <!-- GEN:segments --> ... <!-- /GEN:segments -->   (répartition du code par groupe de segments et état de lecture)
  <!-- GEN:funcs --> ... <!-- /GEN:funcs -->         (index de toutes les fonctions hors bibliothèque)
  <!-- GEN:libfuncs --> ... <!-- /GEN:libfuncs -->
(le reste du document est écrit à la main et n'est pas touché). Bibliothèque standard seulement (briques communes :
scripts/re/make_index_lib.py). Les noms, rôles, statuts de lecture et équivalents SMURF.EXE viennent de
scripts/asterix/re/keyfuncs.def.tsv (via keyfuncs.tsv).
"""
import os
import re
import sys
from collections import OrderedDict, defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "re"))
import make_index_lib as lib  # noqa: E402  (outillage commun : scripts/re/)

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "archives/asterix/re")
DOC = os.path.join(ROOT, "docs/asterix/re-index.md")
EXE = os.path.join(ROOT, "original/asterix/ASTERIX.EXE")

# Mini-jeux : case du plateau (1..54) -> (dossier MDF, nom du manuel, genre). Le lien case -> fonction est lu
# dans l'exe (module_entries.tsv) ; le dossier vient des noms de fichiers référencés par la fonction d'entrée
# (strings.tsv, vérifié plus bas) ; le nom vient du manuel.
GAMES = OrderedDict([
    (2, ("22", "Des poissons pas très frais", "action")),
    (3, ("23", "Non, tu ne chanteras pas !!", "réflexion")),
    (4, ("24", "Des détails à la loupe...", "réflexion")),
    (8, ("26", "Le brouillard", "réflexion")),
    (11, ("27", "Tempête en mer du Nord", "action")),
    (20, ("28", "Les sangliers", "action")),
    (23, ("36", "Le ciel sur la tête", "action")),
    (27, ("35", "Coloriages", "réflexion")),
    (33, ("30", "Les jeux olympiques", "action")),
    (36, ("31", "Le fakir", "action")),
    (40, ("25", "Anachronismes", "réflexion")),
    (42, ("32", "Bagarre avec les Romains", "action")),
    (44, ("33", "Les hiéroglyphes de Cléopâtre", "réflexion")),
    (47, ("34", "Idéfix dans la pyramide", "action")),
    (52, ("29", "Pirates à bâbord !", "action")),
])
STATUS_ORDER = ["lue", "survolée", "non lue"]


def key(a):
    return tuple(int(x, 16) for x in a.split(":"))


functions = lib.load_functions(OUT)
strings = lib.load_strings(OUT)
libs = lib.tsv(OUT, "libfuncs.tsv")
keys = {r[0]: r for r in lib.tsv(OUT, "keyfuncs.tsv")}
entries = lib.tsv(OUT, "module_entries.tsv")

func_files = defaultdict(set)  # fonction -> noms de fichiers de module référencés
for s in strings:
    if re.match(r"^[mMbB]\d\d", s["text"]):
        for fa, _ in s["refs"]:
            func_files[fa].add(s["text"])


def info(a):
    """(nom, groupe, confiance, rôle, statut, équivalent SMURF) d'une fonction, d'après keyfuncs.tsv."""
    r = keys.get(a)
    if not r:
        return functions[a]["name"], None, "", "", "non lue", ""
    m = re.match(r"statut : (.*?) ; SMURF\.EXE : (.*)$", r[7])
    status, smurf = (m.group(1), m.group(2)) if m else ("non lue", "")
    return r[1], r[4], r[5], r[6], status, "" if smurf == "aucun" else smurf


SKIP_SEGS = ("1000", "2de2")  # bibliothèque Borland (et ses fragments), segment de données
SEG_GROUP = {}
for _a in sorted(keys, key=key):
    SEG_GROUP.setdefault(_a.split(":")[0], keys[_a][4])


def indexed(a):
    return functions[a]["kind"] not in ("rtl", "lib") and a.split(":")[0] not in SKIP_SEGS


def group_of(a):
    return SEG_GROUP.get(a.split(":")[0], "Non classé")


def seg_stats(seg):
    fs = [(a, f) for a, f in functions.items() if a.startswith(seg + ":")]
    return len(fs), sum(f["size"] for _, f in fs)


def render_modules():
    out = ["| Case | Jeu (nom du manuel) | Genre | Dossier | Fonction d'entrée | Argument | Annonce K60TE | Octets (entrée) | Segment : fonctions, octets | Fichiers référencés par l'entrée |",
           "|---:|---|---|---|---|---|---|---:|---|---|"]
    seen = {}
    for r in entries:
        case, _blk, annonce, fa, arg, size, nseg, bseg = r
        case = int(case)
        folder, name, genre = GAMES.get(case, ("?", "?", "?"))
        files = sorted(func_files.get(fa, ()), key=str.lower)
        dirs = sorted({f[1:3] for f in files if f[0] in "mM"})
        note = ""
        if fa in seen:
            note = " (code partagé avec la case %d)" % seen[fa]
        seen.setdefault(fa, case)
        a = int(annonce)
        out.append("| %d | %s | %s | `MDF/%s`%s | `%s`%s | %s | %d à %d | %s | `%s` : %s, %s | %s |" % (
            case, name, genre, folder,
            "" if folder in dirs else " (dossiers référencés : %s)" % ", ".join(dirs),
            fa, note, "-" if arg == "-" else arg, 3 * a + 1, 3 * a + 3, size, fa.split(":")[0], nseg, bseg,
            lib.md_cell(", ".join(files[:8]) + (" (+%d)" % (len(files) - 8) if len(files) > 8 else ""))))
    segs = sorted({r[3].split(":")[0] for r in entries if r[3] != "-"})
    total = sum(seg_stats(s)[1] for s in segs)
    out.append("")
    out.append("Total des %d segments de mini-jeux : %d octets de code (%d fonctions), tous à lire en vague E." % (
        len(segs), total, sum(seg_stats(s)[0] for s in segs)))
    return "\n".join(out)


def render_segments():
    groups = OrderedDict()
    for a in sorted(functions, key=key):
        if not indexed(a):
            continue
        status = info(a)[4]
        g = group_of(a)
        d = groups.setdefault(g, {"segs": [], "n": 0, "size": 0, "st": defaultdict(int)})
        s = a.split(":")[0]
        if s not in d["segs"]:
            d["segs"].append(s)
        d["n"] += 1
        d["size"] += functions[a]["size"]
        d["st"][status] += functions[a]["size"]
    out = ["| Groupe | Segments | Fonctions | Octets | Lu | Survolé | Non lu |", "|---|---|---:|---:|---:|---:|---:|"]
    tot = defaultdict(int)
    for g, d in groups.items():
        out.append("| %s | %s | %d | %d | %d | %d | %d |" % (
            g, ", ".join("`%s`" % s for s in d["segs"]), d["n"], d["size"], d["st"]["lue"], d["st"]["survolée"], d["st"]["non lue"]))
        tot["n"] += d["n"]
        tot["size"] += d["size"]
        for s in STATUS_ORDER:
            tot[s] += d["st"][s]
    out.append("| **Total hors bibliothèque** | | %d | %d | %d | %d | %d |" % (tot["n"], tot["size"], tot["lue"], tot["survolée"], tot["non lue"]))
    return "\n".join(out)


def render_funcs():
    by = OrderedDict()
    for a in sorted(functions, key=key):
        if not indexed(a):
            continue
        by.setdefault(a.split(":")[0], []).append(a)
    out = []
    for seg, fs in by.items():
        g = group_of(fs[0])
        out.append("#### `%s` : %s (%d fonctions, %d octets)\n" % (seg, g, len(fs), sum(functions[a]["size"] for a in fs)))
        out.append("| Adresse | Nom | Octets | Rôle | Équivalent SMURF.EXE | Statut | Confiance |")
        out.append("|---|---|---:|---|---|---|---|")
        for a in fs:
            name, _, conf, role, status, smurf = info(a)
            out.append("| `%s` | %s | %d | %s | %s | %s | %s |" % (
                a, "" if name.startswith("FUN_") else "`%s`" % name, functions[a]["size"], lib.md_cell(role),
                "`%s`" % smurf if smurf else "", status, conf))
        out.append("")
    return "\n".join(out).rstrip("\n")


def render_libfuncs():
    out = ["| Adresse | Nom | Octets | Appelants | Confiance | Preuve |", "|---|---|---:|---:|---|---|"]
    for r in sorted(libs, key=lambda r: key(r[0])):
        out.append("| `%s` | `%s` | %s | %s | %s | %s |" % (r[0], r[1], r[2], r[3], r[4], lib.md_cell(r[5])))
    return "\n".join(out)


with open(DOC, encoding="utf-8") as f:
    doc = f.read()
doc = lib.replace_block(doc, "stats", lib.render_stats(functions, strings, libs, EXE, rtl_seg="1000", rtl_label="Borland"), DOC)
doc = lib.replace_block(doc, "modules", render_modules(), DOC)
doc = lib.replace_block(doc, "segments", render_segments(), DOC)
doc = lib.replace_block(doc, "funcs", render_funcs(), DOC)
doc = lib.replace_block(doc, "libfuncs", render_libfuncs(), DOC)
with open(DOC, "w", encoding="utf-8") as f:
    f.write(doc)
print("[re] %s mis à jour" % os.path.relpath(DOC, ROOT))
