#!/usr/bin/env python3
"""Met à jour les blocs générés de docs/teleportaschtroumpf/re-index.md à partir des sorties de run.sh.

Lit archives/teleportaschtroumpf/re/{strings,functions,libfuncs}.tsv et
original/teleportaschtroumpf/DATA/DESCRIPT.ION, puis remplace le contenu des blocs
  <!-- GEN:stats --> ... <!-- /GEN:stats -->
  <!-- GEN:scenes --> ... <!-- /GEN:scenes -->
(le reste du document est écrit à la main et n'est pas touché). Bibliothèque standard seulement (briques communes : scripts/re/make_index_lib.py).
"""
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "re"))
import make_index_lib as lib  # noqa: E402  (outillage commun : scripts/re/)

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "archives/teleportaschtroumpf/re")
DOC = os.path.join(ROOT, "docs/teleportaschtroumpf/re-index.md")
EXE = os.path.join(ROOT, "original/teleportaschtroumpf/SMURF.EXE")
DESCRIPT = os.path.join(ROOT, "original/teleportaschtroumpf/DATA/DESCRIPT.ION")
MAX_FILES = 10      # fichiers/motifs listés par fonction
MAX_OTHERS = 30     # autres fonctions du module listées


# --- données --------------------------------------------------------------------------------------
functions = lib.load_functions(OUT)
strings = lib.load_strings(OUT)
libs = lib.tsv(OUT, "libfuncs.tsv")
entries = {}  # scène -> fonction principale (dispatcher du plateau 1a3c:002a)
if os.path.exists(os.path.join(OUT, "scene_entries.tsv")):
    for r in lib.tsv(OUT, "scene_entries.tsv"):
        if r[2] != "-":
            entries[int(r[0])] = r[2]

scenes = []  # (num, nom)
with open(DESCRIPT, "rb") as f:
    for line in f.read().decode("cp437").splitlines():
        m = re.match(r"^s(\d\d)\s+(.*\S)\s*$", line)
        if m:
            scenes.append((int(m.group(1)), m.group(2)))
scenes.sort()

# --- scène -> fonctions ------------------------------------------------------------------------
scene_funcs = defaultdict(lambda: defaultdict(list))  # scène -> fonction -> [chaînes]
for s in strings:
    m = re.match(r"^s(\d\d)", s["text"], re.I)
    if not m:
        continue
    num = int(m.group(1))
    for fa, kind in s["refs"]:
        if fa.startswith("1000:"):  # bibliothèque Borland : pas de chargement de scène
            continue
        if s["text"] not in scene_funcs[num][fa]:
            scene_funcs[num][fa].append(s["text"])

seg_scenes = defaultdict(set)  # segment de code -> scènes dont un nom de fichier y est référencé
for num, funcs in scene_funcs.items():
    for fa in funcs:
        seg_scenes[fa.split(":")[0]].add(num)

seg_funcs = defaultdict(list)
for fa, f in functions.items():
    seg_funcs[fa.split(":")[0]].append(fa)
for seg in seg_funcs:
    seg_funcs[seg].sort()


def fn(fa):
    f = functions.get(fa)
    return f["name"] if f else "?"


def render_scenes():
    out = []
    missing = []
    for num, nom in scenes:
        funcs = scene_funcs.get(num, {})
        out.append("#### s%02d : %s\n" % (num, nom))
        if num in entries:
            out.append("Fonction principale : `%s` (appelée par le dispatcher du plateau `1a3c:002a`, scène %d).\n" % (entries[num], num))
        if not funcs:
            if num in entries:
                out.append("Aucun nom de fichier `s%02d` référencé directement ; voir la fonction principale ci-dessus.\n" % num)
            else:
                out.append("non trouvé : aucune fonction ne référence un nom de fichier commençant par `s%02d`.\n" % num)
                missing.append(num)
            continue
        segs = [entries[num].split(":")[0]] if num in entries else sorted({fa.split(":")[0] for fa in funcs})
        mod = ", ".join("`%s` (%d fonction(s), %d o)" % (
            s, len(seg_funcs[s]), sum(functions[x]["size"] for x in seg_funcs[s])) for s in segs)
        out.append("%s : %s\n" % ("Segment du module" if num in entries else "Segment(s) de code", mod))
        out.append("| Fonction | Octets | Décomp. | Fichiers / motifs référencés |")
        out.append("|---|---:|---|---|")
        for fa in sorted(funcs):
            f = functions[fa]
            names = sorted(funcs[fa])
            shown = names[:MAX_FILES]
            extra = " (+%d)" % (len(names) - MAX_FILES) if len(names) > MAX_FILES else ""
            nm = "" if f["name"].startswith("FUN_") else " %s" % f["name"]
            out.append("| `%s`%s | %d | %s | %s%s |" % (
                fa, nm, f["size"], f["status"], lib.md_cell(", ".join(shown)), extra))
        shared = sorted({n for s in segs for n in seg_scenes[s]} - {num})
        if shared:
            out.append("\nSegment partagé avec %s%s : module commun à plusieurs scènes, la liste ci-dessus est plus "
                       "fiable que « tout le segment »." % (", ".join("s%02d" % n for n in shared[:6]),
                                                          " (+%d)" % (len(shared) - 6) if len(shared) > 6 else ""))
        others = [fa for s in segs for fa in seg_funcs[s] if fa not in funcs] if not shared else []
        if others:
            lst = ", ".join("`%s` (%d)" % (fa, functions[fa]["size"]) for fa in others[:MAX_OTHERS])
            more = " … (+%d)" % (len(others) - MAX_OTHERS) if len(others) > MAX_OTHERS else ""
            out.append("\nAutres fonctions du même segment (même module, taille en octets) : %s%s" % (lst, more))
        out.append("")
    head = []
    found = len(scenes) - len(missing)
    head.append("Couverture : %d scènes sur %d ont au moins une fonction trouvée." % (found, len(scenes)))
    if missing:
        head.append("Scènes sans aucune fonction trouvée : %s." % ", ".join("s%02d" % n for n in missing))
    head.append("")
    return "\n".join(head + out)


with open(DOC, encoding="utf-8") as f:
    doc = f.read()
doc = lib.replace_block(doc, "stats", lib.render_stats(functions, strings, libs, EXE, rtl_seg="1000", rtl_label="Borland"), DOC)
doc = lib.replace_block(doc, "scenes", render_scenes(), DOC)
with open(DOC, "w", encoding="utf-8") as f:
    f.write(doc)
print("[re] %s mis à jour" % os.path.relpath(DOC, ROOT))
