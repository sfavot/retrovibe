#!/usr/bin/env python3
"""Lecteur minimal d'exécutables NE (Windows 16 bits), bibliothèque standard seulement.

Utilisé par run.sh / make_index.py (à lancer avec `python3 -I`) pour :
  - lister les exports nommés d'un module (tables de noms résidente et non résidente) ;
  - lister les modules importés ;
  - lire les ressources (type, id/nom, taille, contenu).
Les fichiers lus sont des données non fiables : aucun n'est exécuté, tout est borné par la taille du fichier.
"""
import struct

RT_NAMES = {
    1: "CURSOR", 2: "BITMAP", 3: "ICON", 4: "MENU", 5: "DIALOG", 6: "STRING", 7: "FONTDIR", 8: "FONT",
    9: "ACCELERATOR", 10: "RCDATA", 11: "MESSAGETABLE", 12: "GROUP_CURSOR", 14: "GROUP_ICON", 15: "NAMETABLE", 16: "VERSION",
}


class NE:
    def __init__(self, path):
        with open(path, "rb") as f:
            self.d = f.read()
        d = self.d
        if d[:2] != b"MZ":
            raise ValueError("pas un MZ : " + path)
        self.ne = struct.unpack_from("<I", d, 0x3C)[0]
        if d[self.ne:self.ne + 2] != b"NE":
            raise ValueError("pas un NE : " + path)
        n = self.ne
        (self.flags,) = struct.unpack_from("<H", d, n + 0x0C)
        (self.nseg,) = struct.unpack_from("<H", d, n + 0x1C)
        (self.nmodref,) = struct.unpack_from("<H", d, n + 0x1E)
        (self.nonres_size,) = struct.unpack_from("<H", d, n + 0x20)
        (self.segtab,) = struct.unpack_from("<H", d, n + 0x22)
        (self.rsrctab,) = struct.unpack_from("<H", d, n + 0x24)
        (self.restab,) = struct.unpack_from("<H", d, n + 0x26)
        (self.modreftab,) = struct.unpack_from("<H", d, n + 0x28)
        (self.impnametab,) = struct.unpack_from("<H", d, n + 0x2A)
        (self.nonres_off,) = struct.unpack_from("<I", d, n + 0x2C)
        (self.align,) = struct.unpack_from("<H", d, n + 0x32)
        self.align = self.align or 9

    # --- noms ------------------------------------------------------------------------------
    def _names(self, off, end):
        """[(nom, ordinal)] d'une table de noms (longueur, texte, ordinal 16 bits)."""
        d, out = self.d, []
        p = off
        while p < end and p < len(d):
            ln = d[p]
            if ln == 0:
                break
            name = d[p + 1:p + 1 + ln].decode("latin-1")
            (ordv,) = struct.unpack_from("<H", d, p + 1 + ln)
            out.append((name, ordv))
            p += ln + 3
        return out

    def exports(self):
        """{ordinal: nom} (le premier nom de la table résidente est le nom du module)."""
        res = self._names(self.ne + self.restab, len(self.d))
        non = self._names(self.nonres_off, self.nonres_off + self.nonres_size)
        self.module_name = res[0][0] if res else ""
        out = {}
        for name, o in res[1:] + non[1:]:
            if o:
                out[o] = name
        return out

    def imported_modules(self):
        out = []
        for i in range(self.nmodref):
            (off,) = struct.unpack_from("<H", self.d, self.ne + self.modreftab + 2 * i)
            p = self.ne + self.impnametab + off
            out.append(self.d[p + 1:p + 1 + self.d[p]].decode("latin-1"))
        return out

    # --- ressources --------------------------------------------------------------------------
    def resources(self):
        """[(type, ident, offset, taille)] ; type = nombre ou chaîne, ident = nombre ou chaîne."""
        d = self.d
        base = self.ne + self.rsrctab
        if self.rsrctab == self.restab:
            return []
        (shift,) = struct.unpack_from("<H", d, base)
        p = base + 2
        out = []
        while True:
            (tid,) = struct.unpack_from("<H", d, p)
            if tid == 0:
                break
            (cnt,) = struct.unpack_from("<H", d, p + 2)
            p += 8
            if tid & 0x8000:
                typ = tid & 0x7FFF
            else:
                q = base + tid
                typ = d[q + 1:q + 1 + d[q]].decode("latin-1")
            for _ in range(cnt):
                off, ln, fl, rid = struct.unpack_from("<HHHH", d, p)
                p += 12
                if rid & 0x8000:
                    ident = rid & 0x7FFF
                else:
                    q = base + rid
                    ident = d[q + 1:q + 1 + d[q]].decode("latin-1")
                out.append((typ, ident, off << shift, ln << shift))
        return out

    def data(self, off, size):
        return self.d[off:off + size]


def type_name(t):
    return RT_NAMES.get(t, str(t)) if isinstance(t, int) else t
