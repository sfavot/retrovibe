#!/usr/bin/env python3
"""Extrait des exécutables NE : tables d'exports (pour nommer les imports) et ressources.

Usage : python3 -I ne_dump.py <dossier_des_fichiers> <dossier_de_sortie> PROGRAMME...
Écrit, dans <sortie> :
  exports/<MODULE>.tsv        « ordinal<TAB>nom » (tables de noms résidente et non résidente) ;
  <programme>/resources.tsv   type, id/nom, offset, taille ;
  <programme>/resources/      chaînes (STRING), dialogues (DIALOG) et menus (MENU) en texte.
Les fichiers lus sont des données non fiables : ils sont seulement lus, jamais exécutés.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ne  # noqa: E402

CLASSES = {0x80: "BUTTON", 0x81: "EDIT", 0x82: "STATIC", 0x83: "LISTBOX", 0x84: "SCROLLBAR", 0x85: "COMBOBOX"}


def cstr(d, p):
    e = d.index(b"\0", p)
    return d[p:e].decode("cp1252"), e + 1


def dump_strings(ident, data):
    """Table de chaînes : 16 chaînes préfixées par leur longueur ; l'id du bloc donne les numéros ((id-1)*16 + i)."""
    out, p = [], 0
    for i in range(16):
        if p >= len(data):
            break
        ln = data[p]
        s = data[p + 1:p + 1 + ln].decode("cp1252")
        p += 1 + ln
        if ln:
            out.append("%d\t%s" % ((ident - 1) * 16 + i, s.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")))
    return "\n".join(out) + "\n"


def dump_dialog(data):
    style, nitems, x, y, cx, cy = struct.unpack_from("<IBhhhh", data, 0)
    p = 13
    def name(p):
        if data[p] == 0:
            return "", p + 1
        if data[p] == 0xFF:
            return "#%d" % struct.unpack_from("<H", data, p + 1)[0], p + 3
        return cstr(data, p)
    menu, p = name(p)
    cls, p = name(p)
    caption, p = cstr(data, p)
    font = ""
    if style & 0x40:
        (pt,) = struct.unpack_from("<H", data, p)
        face, p = cstr(data, p + 2)
        font = ' FONT %d,"%s"' % (pt, face)
    L = ['DIALOG %d,%d,%d,%d STYLE 0x%08x%s' % (x, y, cx, cy, style, font), 'CAPTION "%s"' % caption]
    if menu:
        L.append("MENU %s" % menu)
    if cls:
        L.append("CLASS %s" % cls)
    for _ in range(nitems):
        ix, iy, icx, icy, iid, istyle = struct.unpack_from("<hhhhHI", data, p)
        p += 14
        if data[p] & 0x80:
            c = CLASSES.get(data[p], "0x%02x" % data[p])
            p += 1
        else:
            c, p = cstr(data, p)
        if data[p] == 0xFF:
            text = "#%d" % struct.unpack_from("<H", data, p + 1)[0]
            p += 3
        else:
            text, p = cstr(data, p)
        extra = data[p]
        p += 1 + extra
        L.append('  %s "%s", id=%d, %d,%d,%d,%d, style=0x%08x' % (c, text, iid, ix, iy, icx, icy, istyle))
    return "\n".join(L) + "\n"


def dump_menu(data):
    p = 4  # version + taille de l'en-tête
    L = []

    def items(p, depth):
        while p < len(data):
            (fl,) = struct.unpack_from("<H", data, p)
            p += 2
            if fl & 0x10:  # POPUP
                t, p = cstr(data, p)
                L.append("  " * depth + 'POPUP "%s"' % t)
                p = items(p, depth + 1)
            else:
                (mid,) = struct.unpack_from("<H", data, p)
                t, p = cstr(data, p + 2)
                L.append("  " * depth + 'ITEM "%s", id=%d%s' % (t, mid, " (séparateur)" if fl == 0 and mid == 0 and not t else ""))
            if fl & 0x80:  # END
                return p
        return p

    items(p, 0)
    return "\n".join(L) + "\n"


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.join(out, "exports"), exist_ok=True)
    for prog in sys.argv[3:]:
        n = ne.NE(os.path.join(src, prog))
        base = os.path.splitext(prog)[0].upper()
        ex = n.exports()
        with open(os.path.join(out, "exports", base + ".tsv"), "w", encoding="utf-8") as f:
            for o in sorted(ex):
                f.write("%d\t%s\n" % (o, ex[o]))
        pdir = os.path.join(out, base)
        os.makedirs(pdir, exist_ok=True)
        rsrc = n.resources()
        rdir = os.path.join(pdir, "resources")
        if os.path.isdir(rdir):
            for x in os.listdir(rdir):
                os.remove(os.path.join(rdir, x))
        with open(os.path.join(pdir, "resources.tsv"), "w", encoding="utf-8") as f:
            f.write("# type\tid\toffset_fichier\ttaille\n")
            for t, i, off, ln in rsrc:
                f.write("%s\t%s\t%d\t%d\n" % (ne.type_name(t), i, off, ln))
        for t, i, off, ln in rsrc:
            tn = ne.type_name(t)
            if tn not in ("STRING", "DIALOG", "MENU"):
                continue
            os.makedirs(rdir, exist_ok=True)
            data = n.data(off, ln)
            try:
                text = {"STRING": lambda: dump_strings(i, data), "DIALOG": lambda: dump_dialog(data), "MENU": lambda: dump_menu(data)}[tn]()
            except Exception as e:  # ressource mal formée : on le dit dans le fichier plutôt que d'échouer
                text = "; ressource illisible : %s\n" % e
            with open(os.path.join(rdir, "%s_%s.txt" % (tn.lower(), i)), "w", encoding="utf-8") as f:
                f.write(text)
        print("[re] %s : %d exports, %d ressources, modules importés : %s" % (prog, len(ex), len(rsrc), ", ".join(n.imported_modules())))


if __name__ == "__main__":
    main()
