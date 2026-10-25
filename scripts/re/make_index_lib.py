"""Briques communes des make_index.py de rétro-ingénierie (scripts/<jeu>/re/make_index.py).

Un make_index.py de jeu ajoute scripts/re au chemin d'import, lit les TSV de archives/<jeu>/re/ avec
`tsv`, construit ses blocs (`render_stats` pour les statistiques générales, le reste est propre au jeu)
et les écrit dans son document avec `replace_block`. Les blocs sont délimités par
  <!-- GEN:nom --> ... <!-- /GEN:nom -->
et le reste du document, écrit à la main, n'est pas touché. Bibliothèque standard seulement.
"""
import os
import re
import shutil
import subprocess
from collections import Counter


def tsv(out_dir, name):
    """Lignes d'un TSV de out_dir, sans commentaires (#) ni lignes vides, découpées sur les tabulations."""
    rows = []
    with open(os.path.join(out_dir, name), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            rows.append(line.rstrip("\n").split("\t"))
    return rows


def unesc(s):
    """Inverse de ReCommon.esc pour les échappements courants."""
    return s.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r").replace("\\\\", "\\")


def md_cell(s):
    return s.replace("|", "\\|").replace("`", "'")


def load_functions(out_dir):
    """functions.tsv -> {adresse: {name, kind, size, ins, status, file}}."""
    functions = {}
    for r in tsv(out_dir, "functions.tsv"):
        functions[r[0]] = {"name": r[1], "kind": r[2], "size": int(r[3]), "ins": int(r[4]),
                           "status": r[7], "file": r[8]}
    return functions


def load_strings(out_dir):
    """strings.tsv -> [{addr, len, text, refs: [(fonction, type)]}]."""
    strings = []
    for r in tsv(out_dir, "strings.tsv"):
        refs = []
        if len(r) > 3 and r[3]:
            for x in r[3].split(";"):
                fa, kind = x.split("/")
                refs.append((fa, kind))
        strings.append({"addr": r[0], "len": int(r[1]), "text": unesc(r[2]), "refs": refs})
    return strings


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


def render_stats(functions, strings, libs, exe_path, rtl_seg="1000", rtl_label="de bibliothèque", code_base=0x10000):
    """Bloc de statistiques d'un exécutable MZ.

    libs : lignes de libfuncs.tsv (colonne 5 = « certain » ou non) ; rtl_seg / rtl_label : segment et
    nature du code de bibliothèque non identifié (type « rtl ») ; code_base : adresse linéaire du premier
    octet de code (le code s'étend de là jusqu'à DGROUP).
    """
    n = len(functions)
    status = Counter(f["status"] for f in functions.values())
    kinds = Counter(f["kind"] for f in functions.values())
    sizes = sum(f["size"] for f in functions.values())
    with open(exe_path, "rb") as f:
        raw = f.read()
    hdr = int.from_bytes(raw[8:10], "little") * 16
    dg = int(strings[0]["addr"].split(":")[0], 16) if strings else 0
    code_bytes = dg * 16 - code_base
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
             "%d fonctions du segment `%s` restent du code %s non identifié (type `rtl`)." % (
                 len(named), len(probable), kinds.get("rtl", 0), rtl_seg, rtl_label))
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


def replace_block(text, name, body, doc_path="le document"):
    pat = re.compile(r"(<!-- GEN:%s -->\n)(?:.*?\n)?(<!-- /GEN:%s -->)" % (name, name), re.S)
    if not pat.search(text):
        raise SystemExit("bloc <!-- GEN:%s --> absent de %s" % (name, doc_path))
    return pat.sub(lambda m: m.group(1) + body + "\n" + m.group(2), text)


def render_stats_pe(functions, strings, exe_path):
    """Bloc de statistiques d'un exécutable PE 32 bits plat (mode plat de scripts/re ; adresses linéaires)."""
    n = len(functions)
    status = Counter(f["status"] for f in functions.values())
    kinds = Counter(f["kind"] for f in functions.values())
    sizes = sum(f["size"] for f in functions.values())
    with open(exe_path, "rb") as f:
        raw = f.read()
    ghidra, jdk = tool_versions()
    referenced = sum(1 for s in strings if s["refs"])
    ok = status.get("ok", 0)
    L = [
        "- Outils : %s ; JDK : %s." % (ghidra, jdk),
        "- Durée de la dernière régénération : %s s." % os.environ.get("RE_DURATION_S", "?"),
        "- Image : %d octets." % len(raw),
        "- Fonctions : %d, %d octets (types : %s)." % (n, sizes, ", ".join("%s %d" % (k, v) for k, v in sorted(kinds.items()))),
        "- Décompilation : %d ok (%.1f %%), %d partielle, %d en erreur." % (
            ok, 100.0 * ok / n if n else 0, status.get("partielle", 0), status.get("erreur", 0) + status.get("timeout", 0)),
        "- Chaînes de la zone de données : %d ; référencées par au moins une fonction : %d." % (len(strings), referenced),
    ]
    part = sorted((fa for fa, f in functions.items() if f["status"] == "partielle"), key=lambda a: -functions[a]["size"])
    if part:
        L.append("- Décompilation partielle : %s." % ", ".join("`%s`" % a for a in part))
    return "\n".join(L)
