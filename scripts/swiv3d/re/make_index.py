#!/usr/bin/env python3
"""Met à jour les blocs générés de docs/swiv3d/re-index.md à partir des sorties de run.sh.

Lit archives/swiv3d/re/{functions,strings,keyfuncs,imports}.tsv et remplace
  <!-- GEN:stats -->, <!-- GEN:keyfuncs -->, <!-- GEN:strings -->, <!-- GEN:imports -->
Le reste du document est écrit à la main. Bibliothèque standard seulement (briques : scripts/re/make_index_lib.py).
"""
import os
import sys
from collections import OrderedDict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "re"))
import make_index_lib as lib  # noqa: E402

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "archives/swiv3d/re")
DOC = os.path.join(ROOT, "docs/swiv3d/re-index.md")
EXE = os.path.join(ROOT, "archives/swiv3d/cd/GAMEDATA/SWIV_WIN.EXE")

functions = lib.load_functions(OUT)
strings = lib.load_strings(OUT)
keys = lib.tsv(OUT, "keyfuncs.tsv")
imports = lib.tsv(OUT, "imports.tsv")


def render_keyfuncs():
    by = OrderedDict()
    for r in sorted(keys, key=lambda r: r[0]):
        by.setdefault(r[4], []).append(r)
    out = []
    for g, rows in by.items():
        out += ["#### %s\n" % g, "| Adresse | Nom | Octets | Appelants | Rôle | Preuve | Confiance |", "|---|---|---:|---:|---|---|---|"]
        for r in rows:
            out.append("| `%s` | `%s` | %s | %s | %s | %s | %s |" % (r[0], r[1], r[2], r[3], lib.md_cell(r[6]), lib.md_cell(r[7]), r[5]))
        out.append("")
    return "\n".join(out).rstrip("\n")


def render_strings():
    rows = [s for s in strings if s["refs"] and len(s["text"]) >= 4 and s["text"].isprintable()]
    out = ["| Adresse | Chaîne | Fonctions |", "|---|---|---|"]
    for s in rows:
        fs = sorted({fa for fa, _ in s["refs"]})
        out.append("| `%s` | `%s` | %s |" % (s["addr"], lib.md_cell(s["text"]), " ".join("`%s`" % f for f in fs[:6]) + (" …" if len(fs) > 6 else "")))
    return "\n".join(out)


def render_imports():
    by = OrderedDict()
    for r in imports:
        by.setdefault(r[1].lower(), []).append(r)
    out = ["| DLL | Imports (nombre de fonctions appelantes) |", "|---|---|"]
    for dll, rows in sorted(by.items()):
        out.append("| %s | %s |" % (dll, ", ".join("`%s` (%d)" % (r[2], len([x for x in r[3].split(",") if x])) for r in rows)))
    return "\n".join(out)


with open(DOC, encoding="utf-8") as f:
    doc = f.read()
doc = lib.replace_block(doc, "stats", lib.render_stats_pe(functions, strings, EXE), DOC)
doc = lib.replace_block(doc, "keyfuncs", render_keyfuncs(), DOC)
doc = lib.replace_block(doc, "strings", render_strings(), DOC)
doc = lib.replace_block(doc, "imports", render_imports(), DOC)
with open(DOC, "w", encoding="utf-8") as f:
    f.write(doc)
print("[re] %s mis à jour" % os.path.relpath(DOC, ROOT))
