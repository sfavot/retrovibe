#!/usr/bin/env python3
"""Met à jour les blocs générés de docs/mathemagique/re-index.md à partir des sorties de run.sh.

Lit archives/mathemagique/re/<programme>/{functions,strings,imports,tags,resources}.tsv et remplace le
contenu des blocs
  <!-- GEN:stats --> ... <!-- /GEN:stats -->
  <!-- GEN:imports --> ... <!-- /GEN:imports -->
  <!-- GEN:dats --> ... <!-- /GEN:dats -->
  <!-- GEN:resources --> ... <!-- /GEN:resources -->
(le reste du document est écrit à la main et n'est pas touché). Bibliothèque standard seulement.
"""
import os
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
OUT = os.path.join(ROOT, "archives/mathemagique/re")
CD = os.path.join(ROOT, "archives/mathemagique/cd")
DOC = os.path.join(ROOT, "docs/mathemagique/re-index.md")
PROGRAMS = [("MATH", "MATH"), ("BRODFONT", "BRODFONT.DLL"), ("BRODMIDI", "BRODMIDI.DLL"),
            ("BRODPGI", "BRODPGI.DLL"), ("BRODUTIL", "BRODUTIL.DLL"), ("BROEMIDI", "BROEMIDI")]
MAX_LIST = 12


def tsv(prog, name):
    rows = []
    path = os.path.join(OUT, prog, name)
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            rows.append(line.rstrip("\n").split("\t"))
    return rows


def md(s):
    return s.replace("|", "\\|").replace("`", "'")


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


data = {}
for prog, fname in PROGRAMS:
    data[prog] = {
        "file": fname,
        "size": os.path.getsize(os.path.join(CD, fname)),
        "functions": tsv(prog, "functions.tsv"),
        "strings": tsv(prog, "strings.tsv"),
        "imports": tsv(prog, "imports.tsv"),
        "tags": tsv(prog, "tags.tsv"),
        "resources": tsv(prog, "resources.tsv"),
    }


def render_stats():
    ghidra, jdk = tool_versions()
    L = ["- Outils : %s ; JDK : %s." % (ghidra, jdk),
         "- Durée de la dernière régénération (6 programmes) : %s s." % os.environ.get("RE_DURATION_S", "?"),
         "",
         "| Programme | Octets | Fonctions | Octets de code | Décomp. ok | Partielle | Erreur | Taux ok | Chaînes (référencées) |",
         "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    tot = Counter()
    for prog, d in data.items():
        fs = d["functions"]
        st = Counter(r[7] for r in fs)
        size = sum(int(r[3]) for r in fs)
        n = len(fs)
        ok = st.get("ok", 0)
        refd = sum(1 for r in d["strings"] if len(r) > 3 and r[3])
        L.append("| `%s` | %d | %d | %d | %d | %d | %d | %.1f %% | %d (%d) |" % (
            d["file"], d["size"], n, size, ok, st.get("partielle", 0), st.get("erreur", 0) + st.get("timeout", 0),
            100.0 * ok / n if n else 0, len(d["strings"]), refd))
        tot.update({"n": n, "ok": ok, "part": st.get("partielle", 0), "err": st.get("erreur", 0) + st.get("timeout", 0)})
    L.append("| **Total** | | %d | | %d | %d | %d | %.1f %% | |" % (
        tot["n"], tot["ok"], tot["part"], tot["err"], 100.0 * tot["ok"] / tot["n"] if tot["n"] else 0))
    L.append("")
    kinds = Counter(r[2] for r in data["MATH"]["functions"])
    seed = {}
    for r in tsv("MATH", "seed.tsv"):
        seed[r[0]] = int(r[1])
    if seed:
        L.append("- `MATH` : fonctions créées par `SeedFunctions` : %d (table des scènes %d, pointeurs lointains des données %d ; %d handlers de scène nommés, %d cibles ignorées) ; la ré-analyse en ajoute %d par appels directs." % (
            seed["scene"] + seed["pointeurs"], seed["scene"], seed["pointeurs"], seed["nommes"], seed["ignorees"],
            seed["apres"] - seed["avant"] - seed["scene"] - seed["pointeurs"]))
    L.append("- `MATH` : types de fonctions %s." % ", ".join("%s %d" % (k, v) for k, v in sorted(kinds.items())))
    for prog, d in data.items():
        part = sorted((r for r in d["functions"] if r[7] == "partielle"), key=lambda r: -int(r[3]))
        bad = [r for r in d["functions"] if r[7] in ("erreur", "timeout")]
        if bad:
            L.append("- `%s` : décompilation en erreur (utiliser `disasm.txt`) : %s." % (prog, ", ".join("`%s`" % r[0] for r in bad)))
        if part:
            shown = ", ".join("`%s`" % r[0] for r in part[:MAX_LIST])
            L.append("- `%s` : décompilation partielle (%d) : %s%s." % (prog, len(part), shown, " …" if len(part) > MAX_LIST else ""))
    return "\n".join(L)


def render_imports():
    L = ["| Programme | Modules importés | Imports | Nommés par Ghidra | Nommés via une DLL | Sans nom | Appels (références) |",
         "|---|---|---:|---:|---:|---:|---:|"]
    unnamed = defaultdict(list)
    for prog, d in data.items():
        mods = Counter(r[0] for r in d["imports"])
        src = Counter(r[3] for r in d["imports"])
        calls = sum(int(r[4]) for r in d["imports"])
        L.append("| `%s` | %s | %d | %d | %d | %d | %d |" % (
            d["file"], ", ".join("%s (%d)" % (m, c) for m, c in mods.items()), len(d["imports"]),
            src.get("ghidra", 0), src.get("dll", 0), src.get("-", 0), calls))
        for r in d["imports"]:
            if r[3] == "-":
                unnamed[(prog, r[0])].append(r[1])
    L.append("")
    L.append("Imports restés sans nom (le loader NE de Ghidra ne connaît pas la table d'ordinaux du module et aucune DLL analysée ne l'exporte) : %s." % (
        "; ".join("`%s` : module %s, ordinaux %s" % (p, m, ", ".join(o)) for (p, m), o in unnamed.items()) or "aucun"))
    brod = [m for r in data["MATH"]["imports"] for m in [r[0]] if m.startswith("BROD") or m == "INSTFONT"]
    L.append("")
    L.append("Imports de `MATH` vers les DLL `BROD*` : %s." % ("%d" % len(brod) if brod else "aucun (la table des modules importés de `MATH` ne contient pas de `BROD*`)"))
    L.append("")
    L.append("Imports de `MATH` les plus appelés (nombre de fonctions appelantes) :")
    L.append("")
    L.append("| Import | Appelantes | Exemples d'appelantes |")
    L.append("|---|---:|---|")
    top = sorted(data["MATH"]["imports"], key=lambda r: -int(r[4]))[:25]
    for r in top:
        callers = r[5].split(",") if r[5] else []
        L.append("| `%s::%s` | %s | %s |" % (r[0], r[2], r[4], ", ".join("`%s`" % c for c in callers[:4])))
    return "\n".join(L)


def render_dats():
    d = data["MATH"]
    fn = {r[0]: r for r in d["functions"]}
    by_func = defaultdict(lambda: {"dat": set(), "tag": Counter(), "data": Counter()})
    for r in d["tags"]:
        fa, kind, val = r[0], r[2], r[3].replace("\\\\", "\\")
        if kind == "dat":
            by_func[fa]["dat"].add(val)
        elif kind == "tag":
            by_func[fa]["tag"][val] += 1
        else:
            by_func[fa]["data"][val] += 1
    L = []
    tags = defaultdict(set)
    for fa, v in by_func.items():
        for t in v["tag"]:
            tags[t].add(fa)
        for t in v["data"]:
            tags[t].add(fa)
    L.append("Tags Mohawk trouvés comme constantes dans le code de `MATH` (fonctions distinctes) :")
    L.append("")
    L.append("| Tag | Fonctions | Liste |")
    L.append("|---|---:|---|")
    for t in sorted(tags, key=lambda t: -len(tags[t])):
        fs = sorted(tags[t])
        L.append("| `%s` | %d | %s%s |" % (t, len(fs), ", ".join("`%s`" % f for f in fs[:MAX_LIST]), " …" if len(fs) > MAX_LIST else ""))
    L.append("")
    dats = {r[3] for r in d["tags"] if r[2] == "dat"}
    all_dats = sorted({r[2] for r in d["strings"] if re.search(r"\.(dat|mhk)$", r[2], re.I)}, key=str.lower)
    L.append("Fonctions qui référencent un nom de fichier `.DAT` (chaîne passée en immédiat) :")
    L.append("")
    L.append("| Fonction | Octets | DAT | Tags dans la même fonction |")
    L.append("|---|---:|---|---|")
    for fa in sorted(by_func):
        v = by_func[fa]
        if not v["dat"]:
            continue
        L.append("| `%s` | %s | %s | %s |" % (fa, fn[fa][3] if fa in fn else "?", ", ".join(sorted(v["dat"], key=str.lower)),
                                              ", ".join("`%s`" % t for t in sorted(v["tag"])) or "-"))
    L.append("")
    missing = [x for x in all_dats if x not in dats]
    L.append("Noms de fichiers `.DAT` présents dans le segment de données sans aucune référence immédiate trouvée : %s." % (
        ", ".join("`%s`" % x for x in missing) or "aucun"))
    L.append("")
    L.append("Fonctions référençant un tag sans nom de DAT dans la même fonction : %d sur %d fonctions à tags (voir `MATH/tags.tsv`)." % (
        sum(1 for v in by_func.values() if (v["tag"] or v["data"]) and not v["dat"]),
        sum(1 for v in by_func.values() if v["tag"] or v["data"])))
    return "\n".join(L)


def render_resources():
    L = ["| Programme | Ressources NE | Détail |", "|---|---:|---|"]
    for prog, d in data.items():
        c = Counter(r[0] for r in d["resources"])
        L.append("| `%s` | %d | %s |" % (d["file"], len(d["resources"]), ", ".join("%s %d" % (k, v) for k, v in c.items()) or "aucune"))
    return "\n".join(L)


def replace_block(text, name, body):
    pat = re.compile(r"(<!-- GEN:%s -->\n)(?:.*?\n)?(<!-- /GEN:%s -->)" % (name, name), re.S)
    if not pat.search(text):
        raise SystemExit("bloc <!-- GEN:%s --> absent de %s" % (name, DOC))
    return pat.sub(lambda m: m.group(1) + body + "\n" + m.group(2), text)


with open(DOC, encoding="utf-8") as f:
    doc = f.read()
for name, fn_ in (("stats", render_stats), ("imports", render_imports), ("dats", render_dats), ("resources", render_resources)):
    doc = replace_block(doc, name, fn_())
with open(DOC, "w", encoding="utf-8") as f:
    f.write(doc)
print("[re] %s mis à jour" % os.path.relpath(DOC, ROOT))
