#!/usr/bin/env python3
"""Met à jour les blocs générés de docs/teleportaschtroumpf/re-index.md à partir des sorties de run.sh.

Lit archives/teleportaschtroumpf/re/{strings,functions,libfuncs}.tsv et
original/teleportaschtroumpf/DATA/DESCRIPT.ION, puis remplace le contenu des blocs
  <!-- GEN:stats --> ... <!-- /GEN:stats -->
  <!-- GEN:scenes --> ... <!-- /GEN:scenes -->
(le reste du document est écrit à la main et n'est pas touché). Bibliothèque standard seulement.
"""
import os
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "archives/teleportaschtroumpf/re")
DOC = os.path.join(ROOT, "docs/teleportaschtroumpf/re-index.md")
EXE = os.path.join(ROOT, "original/teleportaschtroumpf/SMURF.EXE")
DESCRIPT = os.path.join(ROOT, "original/teleportaschtroumpf/DATA/DESCRIPT.ION")
MAX_FILES = 10      # fichiers/motifs listés par fonction
MAX_OTHERS = 30     # autres fonctions du module listées


def tsv(name):
    rows = []
    with open(os.path.join(OUT, name), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            rows.append(line.rstrip("\n").split("\t"))
    return rows


def unesc(s):
    return s.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r").replace("\\\\", "\\")


def md_cell(s):
    return s.replace("|", "\\|").replace("`", "'")


# --- données --------------------------------------------------------------------------------------
functions = {}
for r in tsv("functions.tsv"):
    functions[r[0]] = {"name": r[1], "kind": r[2], "size": int(r[3]), "ins": int(r[4]),
                       "status": r[7], "file": r[8]}
strings = []
for r in tsv("strings.tsv"):
    refs = []
    if len(r) > 3 and r[3]:
        for x in r[3].split(";"):
            fa, kind = x.split("/")
            refs.append((fa, kind))
    strings.append({"addr": r[0], "len": int(r[1]), "text": unesc(r[2]), "refs": refs})
libs = tsv("libfuncs.tsv")
entries = {}  # scène -> fonction principale (dispatcher du plateau 1a3c:002a)
if os.path.exists(os.path.join(OUT, "scene_entries.tsv")):
    for r in tsv("scene_entries.tsv"):
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
                fa, nm, f["size"], f["status"], md_cell(", ".join(shown)), extra))
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


def tool_versions():
    ghidra = jdk = "?"
    try:
        b = shutil.which("brew")
        if b:
            ghidra = subprocess.run([b, "list", "--versions", "ghidra"], capture_output=True, text=True).stdout.strip() or "?"
    except Exception:
        pass
    java = os.path.join(os.environ.get("JAVA_HOME", ""), "bin", "java")
    try:
        if os.path.exists(java):
            jdk = subprocess.run([java, "-version"], capture_output=True, text=True).stderr.splitlines()[0]
    except Exception:
        pass
    return ghidra, jdk


def render_stats():
    n = len(functions)
    status = Counter(f["status"] for f in functions.values())
    kinds = Counter(f["kind"] for f in functions.values())
    sizes = sum(f["size"] for f in functions.values())
    with open(EXE, "rb") as f:
        raw = f.read()
    hdr = int.from_bytes(raw[8:10], "little") * 16
    dg = int(strings[0]["addr"].split(":")[0], 16) if strings else 0
    code_bytes = dg * 16 - 0x10000
    referenced = sum(1 for s in strings if s["refs"])
    kinds_refs = Counter(k for s in strings for _, k in s["refs"])
    named = [r for r in libs if r[4] == "certain"]
    probable = [r for r in libs if r[4] != "certain"]
    ghidra, jdk = tool_versions()
    dur = os.environ.get("RE_DURATION_S", "?")
    ok = status.get("ok", 0)
    L = []
    L.append("- Outils : %s ; JDK : %s." % (ghidra, jdk))
    L.append("- Durée de la dernière régénération : %s s." % dur)
    L.append("- Fonctions : %d (code Ghidra), %d octets (%.1f %% des %d octets de code avant DGROUP)." % (
        n, sizes, 100.0 * sizes / code_bytes if code_bytes else 0, code_bytes))
    L.append("- Types : %s." % ", ".join("%s %d" % (k, v) for k, v in sorted(kinds.items())))
    L.append("- Décompilation : %d ok (%.1f %%), %d partielle (code illisible pour Ghidra par endroits), %d en erreur." % (
        ok, 100.0 * ok / n if n else 0, status.get("partielle", 0), status.get("erreur", 0) + status.get("timeout", 0)))
    L.append("- Fonctions de bibliothèque nommées avec certitude : %d (+ %d probable, non renommée). "
             "%d fonctions du segment `1000` restent du code Borland non identifié (type `rtl`)." % (
                 len(named), len(probable), kinds.get("rtl", 0)))
    L.append("- Chaînes dans DGROUP : %d ; référencées par au moins une fonction : %d. "
             "Références heuristiques par type : %s." % (len(strings), referenced, ", ".join("%s %d" % (k, v) for k, v in sorted(kinds_refs.items()))))
    bad = sorted(fa for fa, f in functions.items() if f["status"] in ("erreur", "timeout"))
    part = sorted((fa for fa, f in functions.items() if f["status"] == "partielle"), key=lambda a: -functions[a]["size"])
    if bad:
        L.append("- Décompilation en erreur (utiliser `disasm.txt`) : %s." % ", ".join("`%s`" % a for a in bad))
    if part:
        L.append("- Décompilation partielle : %s." % ", ".join("`%s`" % a for a in part))
    L.append("- Image : %d octets, en-tête %d octets, DGROUP = segment `%04x`." % (len(raw), hdr, dg))
    return "\n".join(L)


def replace_block(text, name, body):
    pat = re.compile(r"(<!-- GEN:%s -->\n).*?(\n<!-- /GEN:%s -->)" % (name, name), re.S)
    if not pat.search(text):
        raise SystemExit("bloc <!-- GEN:%s --> absent de %s" % (name, DOC))
    return pat.sub(lambda m: m.group(1) + body + m.group(2), text)


with open(DOC, encoding="utf-8") as f:
    doc = f.read()
doc = replace_block(doc, "stats", render_stats())
doc = replace_block(doc, "scenes", render_scenes())
with open(DOC, "w", encoding="utf-8") as f:
    f.write(doc)
print("[re] %s mis à jour" % os.path.relpath(DOC, ROOT))
