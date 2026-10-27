#!/usr/bin/env python3
"""Blocs générés du re-index.md d'un jeu Mohawk dont le code est dans des exécutables NE (Win16).

Appelé par scripts/<jeu>/re/make_index.py : main(root, jeu, programmes, principal). Lit
archives/<jeu>/re/<programme>/{functions,strings,imports,tags,resources,seed}.tsv et remplace le contenu des blocs
  <!-- GEN:stats --> ... <!-- /GEN:stats -->
  <!-- GEN:imports --> ... <!-- /GEN:imports -->
  <!-- GEN:dats --> ... <!-- /GEN:dats -->
  <!-- GEN:resources --> ... <!-- /GEN:resources -->
de docs/<jeu>/re-index.md (le reste du document est écrit à la main et n'est pas touché). Bibliothèque standard
seulement (briques communes : make_index_lib.py).
"""
import os
import re
from collections import Counter, defaultdict

import make_index_lib as lib

def main(root, game, programs, main_prog):
    """programs : [(sous-dossier de archives/<jeu>/re/, nom du fichier sur le CD)] ; main_prog : le sous-dossier de l'exécutable du jeu."""
    OUT = os.path.join(root, "archives/%s/re" % game)
    CD = os.path.join(root, "archives/%s/cd" % game)
    DOC = os.path.join(root, "docs/%s/re-index.md" % game)
    ROOT = root
    PROGRAMS = programs
    MAIN = main_prog
    MAX_LIST = 12


    def tsv(prog, name):
        """Lignes d'un TSV de OUT/<programme>, ou aucune si le fichier n'existe pas."""
        if not os.path.exists(os.path.join(OUT, prog, name)):
            return []
        return lib.tsv(os.path.join(OUT, prog), name)


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
        ghidra, jdk = lib.tool_versions()
        L = ["- Outils : %s ; JDK : %s." % (ghidra, jdk),
             "- Durée de la dernière régénération (%d programmes) : %s s." % (len(PROGRAMS), os.environ.get("RE_DURATION_S", "?")),
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
        kinds = Counter(r[2] for r in data[MAIN]["functions"])
        seed = {}
        for r in tsv(MAIN, "seed.tsv"):
            seed[r[0]] = int(r[1])
        if seed:
            L.append("- `" + MAIN + "` : fonctions créées par `SeedFunctions` : %d (table des scènes %d, pointeurs lointains des données %d ; %d handlers de scène nommés, %d cibles ignorées) ; la ré-analyse en ajoute %d par appels directs." % (
                seed["scene"] + seed["pointeurs"], seed["scene"], seed["pointeurs"], seed["nommes"], seed["ignorees"],
                seed["apres"] - seed["avant"] - seed["scene"] - seed["pointeurs"]))
        L.append(("- `" + MAIN + "` : types de fonctions %s.") % ", ".join("%s %d" % (k, v) for k, v in sorted(kinds.items())))
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
        brod = [m for r in data[MAIN]["imports"] for m in [r[0]] if m.startswith("BROD") or m == "INSTFONT"]
        L.append("")
        L.append("Imports de `%s` vers les DLL `BROD*` : %s." % (MAIN, "%d" % len(brod) if brod else "aucun (la table des modules importés de `%s` ne contient pas de `BROD*`)" % MAIN))
        L.append("")
        L.append("Imports de `" + MAIN + "` les plus appelés (nombre de fonctions appelantes) :")
        L.append("")
        L.append("| Import | Appelantes | Exemples d'appelantes |")
        L.append("|---|---:|---|")
        top = sorted(data[MAIN]["imports"], key=lambda r: -int(r[4]))[:25]
        for r in top:
            callers = r[5].split(",") if r[5] else []
            L.append("| `%s::%s` | %s | %s |" % (r[0], r[2], r[4], ", ".join("`%s`" % c for c in callers[:4])))
        return "\n".join(L)


    def render_dats():
        d = data[MAIN]
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
        L.append("Tags Mohawk trouvés comme constantes dans le code de `%s` (fonctions distinctes) :" % MAIN)
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
        L.append("Fonctions référençant un tag sans nom de DAT dans la même fonction : %d sur %d fonctions à tags (voir `%s/tags.tsv`)." % (
            sum(1 for v in by_func.values() if (v["tag"] or v["data"]) and not v["dat"]),
            sum(1 for v in by_func.values() if v["tag"] or v["data"]), MAIN))
        return "\n".join(L)


    def render_resources():
        L = ["| Programme | Ressources NE | Détail |", "|---|---:|---|"]
        for prog, d in data.items():
            c = Counter(r[0] for r in d["resources"])
            L.append("| `%s` | %d | %s |" % (d["file"], len(d["resources"]), ", ".join("%s %d" % (k, v) for k, v in c.items()) or "aucune"))
        return "\n".join(L)


    with open(DOC, encoding="utf-8") as f:
        doc = f.read()
    for name, fn_ in (("stats", render_stats), ("imports", render_imports), ("dats", render_dats), ("resources", render_resources)):
        doc = lib.replace_block(doc, name, fn_(), DOC)
    with open(DOC, "w", encoding="utf-8") as f:
        f.write(doc)
    print("[re] %s mis à jour" % os.path.relpath(DOC, ROOT))
