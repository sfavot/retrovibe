#!/usr/bin/env python3
"""Génère src/games/bass/data/tables/*.ts depuis la source de ScummVM (engines/sky/, v2026.4.0, GPL v3 ou ultérieure).

Usage : python3 -I scripts/bass/gen-tables.py <dossier engines/sky de ScummVM> <dossier de sortie>

Tables : arbre Huffman 0.0372 (hufftext.cpp), table de conversion des voix, effets sonores `musicList` (sound.cpp),
noms des variables de script (debug.cpp), noms des mcodes (logic.cpp, ordre de setupMcodeTable), rustines de textes (text.cpp).
L'analyse est stricte : toute forme de table inattendue arrête le script.
"""
import re
import sys
from pathlib import Path

VERSION = "v2026.4.0"


def fail(msg):
    sys.exit(f"gen-tables : {msg}")


def read(src, name):
    p = Path(src) / name
    if not p.is_file():
        fail(f"fichier introuvable : {p}")
    return p.read_text(encoding="utf-8", errors="replace")


def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def strip_if0(text):
    """Retire les blocs `#if 0 ... #endif` (pas d'imbrication dans sound.cpp : vérifié)."""
    out, depth, skipping = [], 0, False
    for line in text.split("\n"):
        s = line.strip()
        if skipping:
            if s.startswith("#if"):
                depth += 1
            elif s.startswith("#endif"):
                if depth == 0:
                    skipping = False
                else:
                    depth -= 1
            continue
        if re.match(r"#if\s+0\b", s):
            skipping, depth = True, 0
            continue
        out.append(line)
    if skipping:
        fail("#if 0 sans #endif")
    return "\n".join(out)


def body(text, head_re, what):
    """Contenu entre accolades d'une définition dont l'en-tête correspond à head_re (jusqu'au `};` de tête de ligne)."""
    m = re.search(head_re + r"\s*=\s*\{(.*?)\n\};", text, re.S)
    if not m:
        fail(f"table introuvable : {what}")
    return m.group(1)


def header(source, extra=""):
    return (
        f"/**\n * Fichier généré, ne pas modifier : `python3 -I scripts/bass/gen-tables.py <scummvm>/engines/sky <sortie>`.\n"
        f" * Source : ScummVM engines/sky/{source} ({VERSION}, GPL v3 ou ultérieure).{extra}\n */\n\n"
    )


def ts_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def wrap_numbers(nums, per=16, indent="  "):
    rows = [indent + ", ".join(str(n) for n in nums[i : i + per]) + "," for i in range(0, len(nums), per)]
    return "\n".join(rows)


def c_char(tok):
    tok = tok.strip()
    if tok.startswith("'"):
        m = re.fullmatch(r"'(\\.|[^\\'])'", tok)
        if not m:
            fail(f"littéral de caractère inattendu : {tok}")
        c = m.group(1)
        if c.startswith("\\"):
            c = {"n": "\n", "\\": "\\", "'": "'", '"': '"', "0": "\0"}.get(c[1])
            if c is None:
                fail(f"échappement inattendu : {tok}")
        v = ord(c)
    else:
        v = int(tok)
    if not 0 <= v <= 255:
        fail(f"valeur hors d'un octet : {tok}")
    return v


def gen_huffman(src):
    text = strip_comments(read(src, "hufftext.cpp"))
    b = body(text, r"const HuffTree Text::_huffTree_00372\[\]", "_huffTree_00372")
    rows = re.findall(r"\{\s*(\d+)\s*,\s*(\d+)\s*,\s*('(?:\\.|[^\\'])'|\d+)\s*\}", b)
    rest = re.sub(r"\{\s*\d+\s*,\s*\d+\s*,\s*(?:'(?:\\.|[^\\'])'|\d+)\s*\}\s*,?", "", b).strip()
    if rest:
        fail(f"_huffTree_00372 : contenu inattendu {rest[:40]!r}")
    if not 200 <= len(rows) <= 255:
        fail(f"_huffTree_00372 : {len(rows)} nœuds (200 à 255 attendus)")
    flat = []
    for l, r, v in rows:
        l, r, v = int(l), int(r), c_char(v)
        if l >= len(rows) or r >= len(rows):
            fail("_huffTree_00372 : fils hors de l'arbre")
        flat += [l, r, v]
    out = header("hufftext.cpp", " Table `_huffTree_00372` (v0.0372).")
    out += f"/** Arbre de Huffman des textes : triplets `gauche, droite, valeur` ({len(rows)} nœuds) ; feuille quand les deux fils valent 0. */\n"
    out += "export const HUFFMAN_372: readonly number[] = [\n" + wrap_numbers(flat, 15) + "\n];\n"
    return out


def gen_speech(src):
    text = strip_comments(read(src, "sound.cpp"))
    b = body(text, r"uint16 Sound::_speechConvertTable\[8\]", "_speechConvertTable")
    vals = []
    for item in b.strip().rstrip(",").split(","):
        item = item.strip()
        if not re.fullmatch(r"\d+(\s*\+\s*\d+)*", item):
            fail(f"_speechConvertTable : terme inattendu {item!r}")
        vals.append(sum(int(x) for x in item.split("+")))
    if len(vals) != 8 or vals != sorted(vals):
        fail("_speechConvertTable : 8 valeurs croissantes attendues")
    out = header("sound.cpp", " Table `_speechConvertTable`.")
    out += "/** Numéro de texte (section `n >> 12`) vers numéro de fichier de voix : `SPEECH_CONVERT[section] + (n & 0xFFF)` (hors base 50 000). */\n"
    out += "export const SPEECH_CONVERT: readonly number[] = [" + ", ".join(map(str, vals)) + "];\n"
    return out


def gen_sfx(src):
    text = strip_if0(read(src, "sound.cpp"))
    text = strip_comments(text)
    defs = {}
    consts = {"SFXF_SAVE": 0x20, "SFXF_START_DELAY": 0x80}

    def expr(tok, name):
        """Entier, constante SFXF_* ou somme/union de ces termes."""
        total = 0
        for part in re.split(r"[+|]", tok):
            part = part.strip()
            if part in consts:
                total += consts[part]
            elif re.fullmatch(r"\d+", part):
                total += int(part)
            else:
                fail(f"{name} : terme {part!r} inattendu")
        return total

    for m in re.finditer(r"static const Sfx (\w+) = \{\s*([\w+| ]+?)\s*,\s*([\w+| ]+?)\s*,\s*\{(.*?)\}\s*\};", text, re.S):
        name, rooms = m.group(1), m.group(4)
        snd, f = expr(m.group(2), name), expr(m.group(3), name)
        triples = re.findall(r"\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}", rooms)
        if not triples or len(triples) > 10 or re.sub(r"\{[^{}]*\}\s*,?\s*", "", rooms).strip():
            fail(f"{name} : liste de pièces inattendue")
        flat = [int(x) for t in triples for x in t]
        if any(x > 255 for x in flat) or snd > 255:
            fail(f"{name} : valeur hors d'un octet")
        defs[name] = (snd, f, tuple(flat))
    if len(defs) < 90:
        fail(f"seulement {len(defs)} effets analysés")
    m = re.search(r"static const Sfx \*const musicList\[\]\s*=\s*\{(.*?)\n\};", text, re.S)
    if not m:
        fail("musicList introuvable")
    names = re.findall(r"&(\w+)\s*,?", m.group(1))
    if re.sub(r"&\w+\s*,?\s*", "", m.group(1)).strip():
        fail("musicList : contenu inattendu")
    if len(names) != 139:  # sons 256 à 393, plus l'entrée 394 (soudure de la pièce 25), indexés par `sound & ~0x100`
        fail(f"musicList : {len(names)} entrées (139 attendues)")
    unique, order = {}, []
    for n in names:
        if n not in defs:
            fail(f"musicList : effet inconnu {n}")
        key = defs[n]
        if key not in unique:
            unique[key] = len(unique)
            order.append(key)
    idx = [unique[defs[n]] for n in names]
    out = header("sound.cpp", " Tables `musicList` et `Sfx`.")
    out += "/**\n * Définitions d'effets distinctes : `[numéro de son du pilote, drapeaux, pièces...]`, pièces = triplets `pièce, volume AdLib, volume Roland` ;\n"
    out += " * drapeaux : `0x20` à relancer au chargement, `0x80` départ différé ; pièce 255 = toutes les pièces (fin de liste, ou liste seule).\n */\n"
    out += "export const SFX_DEFS: readonly (readonly number[])[] = [\n"
    for snd, f, flat in order:
        out += f"  [{snd}, {f}, {', '.join(map(str, flat))}],\n"
    out += "];\n\n"
    out += "/** `musicList` : indice dans `SFX_DEFS` du numéro d'effet `256 + i` ; l'entrée 138 est celle de l'effet 394 (soudure de la pièce 25). */\n"
    out += "export const MUSIC_LIST: readonly number[] = [\n" + wrap_numbers(idx, 20) + "\n];\n"
    return out


def gen_script_vars(src):
    text = strip_comments(read(src, "debug.cpp"))
    b = body(text, r"static const char \*const scriptVars\[\]", "scriptVars")
    names = re.findall(r'"([^"]*)"', b)
    if re.sub(r'"[^"]*"\s*,?\s*', "", b).strip():
        fail("scriptVars : contenu inattendu")
    # NUM_SKY_SCRIPTVARS = 838, mais debug.cpp ne nomme que les 837 premières (la dernière n'a pas de nom).
    if len(names) != 837:
        fail(f"scriptVars : {len(names)} noms (837 attendus)")
    out = header("debug.cpp", " Table `scriptVars`.")
    out += "/** Noms des 837 premières des 838 variables de script, par numéro (pour les traces et les tests). */\n"
    out += "export const SCRIPT_VAR_NAMES: readonly string[] = [\n" + "\n".join(f"  {ts_str(n)}," for n in names) + "\n];\n"
    return out


def gen_mcodes(src):
    text = strip_comments(read(src, "logic.cpp"))
    m = re.search(r"static const McodeTable mcodeTable\[\]\s*=\s*\{(.*?)\n\t\};", text, re.S)
    if not m:
        fail("mcodeTable introuvable")
    names = re.findall(r"&Logic::(\w+)\s*,?", m.group(1))
    if re.sub(r"&Logic::\w+\s*,?\s*", "", m.group(1)).strip():
        fail("mcodeTable : contenu inattendu")
    if len(names) != 115:
        fail(f"mcodeTable : {len(names)} entrées (115 attendues)")
    out = header("logic.cpp", " Table `mcodeTable` de `setupMcodeTable`.")
    out += "/** Noms des 115 mcodes (fonctions `Logic::fn…`), dans l'ordre de la table du moteur. */\n"
    out += "export const MCODE_NAMES: readonly string[] = [\n" + "\n".join(f"  {ts_str(n)}," for n in names) + "\n];\n"
    return out


LANG_ORDER = ["SKY_ENGLISH", "SKY_GERMAN", "SKY_FRENCH", "SKY_USA", "SKY_SWEDISH", "SKY_ITALIAN", "SKY_PORTUGUESE", "SKY_SPANISH"]


def gen_patches(src):
    raw = read(src, "text.cpp")
    text = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    text = re.sub(r"//[^\n\"]*(?=\n)", "", text)  # commentaires de fin de ligne (aucun texte patché n'en contient)
    b = body(text, r"const PatchMessage Text::_patchedMessages\[NUM_PATCH_MSG\]", "_patchedMessages")
    msgs = re.findall(r'\{\s*(\d+)\s*,\s*"((?:\\.|[^"\\])*)"\s*\}', b)
    if re.sub(r'\{\s*\d+\s*,\s*"(?:\\.|[^"\\])*"\s*\}\s*,?\s*', "", b).strip():
        fail("_patchedMessages : contenu inattendu")
    idx = re.search(r"_patchLangIdx\[8\]\s*=\s*\{(.*?)\};", text, re.S)
    num = re.search(r"_patchLangNum\[8\]\s*=\s*\{(.*?)\};", text, re.S)
    if not idx or not num:
        fail("_patchLangIdx / _patchLangNum introuvables")

    def ints(s):
        vals = re.findall(r"0x[0-9A-Fa-f]+|\d+", s)
        if len(vals) != 8:
            fail("table de rustines : 8 valeurs attendues")
        return [int(v, 0) for v in vals]

    idx, num = ints(idx.group(1)), ints(num.group(1))
    out = header("text.cpp", " Tables `_patchedMessages`, `_patchLangIdx` et `_patchLangNum`.")
    out += "/** Rustines de `Text::patchMessage` par langue (indice de `Language`) : paires `[numéro de texte, texte]` ; les codes sont ceux de la police du jeu. */\n"
    out += "export const PATCHED_MESSAGES: readonly (readonly (readonly [number, string])[])[] = [\n"
    total = 0
    for lang in range(8):
        entries = []
        if num[lang]:
            if idx[lang] + num[lang] > len(msgs):
                fail("rustines : indice hors de la table")
            entries = msgs[idx[lang] : idx[lang] + num[lang]]
            total += len(entries)
        out += "  [" + ", ".join(f"[{n}, {ts_str(t)}]" for n, t in entries) + "],\n"
    if total != len(msgs):
        fail(f"rustines : {total} utilisées sur {len(msgs)}")
    out += "];\n"
    return out


def main():
    if len(sys.argv) != 3:
        fail("usage : gen-tables.py <engines/sky de ScummVM> <dossier de sortie>")
    src, dest = sys.argv[1], Path(sys.argv[2])
    dest.mkdir(parents=True, exist_ok=True)
    files = {
        "huffman-372.ts": gen_huffman,
        "speech-convert.ts": gen_speech,
        "sfx-list.ts": gen_sfx,
        "script-var-names.ts": gen_script_vars,
        "mcode-names.ts": gen_mcodes,
        "text-patches.ts": gen_patches,
    }
    for name, fn in files.items():
        (dest / name).write_text(fn(src), encoding="utf-8")
        print(f"écrit {dest / name}")


main()
