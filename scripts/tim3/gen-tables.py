#!/usr/bin/env python3
"""Génère src/games/tim3/data/tables/*.ts depuis TIMWIN.EXE (TIM3 3.0 pour Windows, PE32, base 0x400000).

Usage : python3 -I scripts/tim3/gen-tables.py <TIMWIN.EXE> <dossier de sortie>
        (en pratique : original/tim3/TIMWIN.EXE src/games/tim3/data/tables)

Décision D13 (docs/tim3/plan.md) : les tables de la simulation ne sont pas dans les ressources ; on les recopie de l'exe,
avec leur adresse (VA) en tête de chaque fichier. Ne jamais modifier les fichiers générés : relancer ce script.
- cosine.ts     : 0x470230, cosinus Q14 sur [0, π], 2 049 × i16 (lu par 4137d0).
- arctan.ts     : 0x471234, 512 × u32 (lu par 4138c0, indice < 0x200).
- quadrants.ts  : 0x473258 et 0x473268, 4 × i32 chacun (décalages de contact par quadrant, 42be0c et 42c1d6).
- random.ts     : état initial du générateur 4520a4 (table 0x47961c de 56 × u32, indices 0x479614 et 0x479618).
- bin-order.ts  : 0x47201c, ordre des types dans le bac (liste d'i32 terminée par −1, lue par 417133).
- descriptors.ts: table des types 0x4733a0 (281 pointeurs) et descripteurs statiques de 0x70 octets (28 × u32),
                  tels qu'ils sont dans l'image avant le chargement des PAR (433b54) et l'initialisation des types.
L'analyse est stricte : toute forme inattendue arrête le script. Rien n'est exécuté.
"""
import struct
import sys
from pathlib import Path

BASE = 0x400000
COSINE, COSINE_N = 0x470230, 2049
ARCTAN, ARCTAN_N = 0x471234, 512
QUAD_DX, QUAD_DY = 0x473258, 0x473268
TYPE_TABLE, TYPE_COUNT, DESC_SIZE = 0x4733A0, 281, 0x70
RNG_I, RNG_J, RNG_TABLE, RNG_N = 0x479614, 0x479618, 0x47961C, 56
BIN_ORDER, BIN_ORDER_MAX = 0x47201C, 400


def fail(msg):
    sys.exit(f"gen-tables : {msg}")


class Pe:
    def __init__(self, data):
        self.data = data
        if data[:2] != b"MZ":
            fail("pas un exécutable MZ")
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        if data[pe:pe + 4] != b"PE\0\0":
            fail("en-tête PE absent")
        nsec = struct.unpack_from("<H", data, pe + 6)[0]
        optsize = struct.unpack_from("<H", data, pe + 20)[0]
        base = struct.unpack_from("<I", data, pe + 24 + 28)[0]
        if base != BASE:
            fail(f"base inattendue {base:#x}")
        self.sections = []
        off = pe + 24 + optsize
        for i in range(nsec):
            name = data[off:off + 8].rstrip(b"\0").decode("ascii", "replace")
            vsize, va, rawsize, rawptr = struct.unpack_from("<IIII", data, off + 8)
            self.sections.append((name, BASE + va, max(vsize, rawsize), rawsize, rawptr))
            off += 40

    def read(self, va, n):
        for name, start, size, rawsize, rawptr in self.sections:
            if start <= va and va + n <= start + size:
                rel = va - start
                if rel + n > rawsize:
                    fail(f"{va:#x} hors des données initialisées de {name}")
                return self.data[rawptr + rel:rawptr + rel + n]
        fail(f"adresse {va:#x} hors des sections")


HEADER = """/**
 * Généré par scripts/tim3/gen-tables.py depuis TIMWIN.EXE ({what}). Ne pas modifier à la main.
 * Provenance : {where}.
 */
"""


def chunks(values, per):
    return [values[i:i + per] for i in range(0, len(values), per)]


def array_lines(values, per=16):
    return "\n".join("  " + ", ".join(str(v) for v in c) + "," for c in chunks(values, per))


def main():
    if len(sys.argv) != 3:
        fail("usage : gen-tables.py <TIMWIN.EXE> <dossier de sortie>")
    exe, out = Path(sys.argv[1]), Path(sys.argv[2])
    if not exe.is_file():
        fail(f"fichier introuvable : {exe}")
    out.mkdir(parents=True, exist_ok=True)
    pe = Pe(exe.read_bytes())

    cos = list(struct.unpack(f"<{COSINE_N}h", pe.read(COSINE, 2 * COSINE_N)))
    if cos[0] != 16384 or cos[1024] not in (0, 1, -1) or cos[2048] != -16384:
        fail("table cosinus inattendue")
    (out / "cosine.ts").write_text(
        HEADER.format(what="cosinus Q14", where=f"VA {COSINE:#x}, {COSINE_N} × i16, lue par 4137d0")
        + f"export const COSINE_VA = {COSINE:#x};\n"
        + "/** cos(i·π/2048)·16384, i = 0 … 2048. */\n"
        + f"export const COSINE_Q14 = Int16Array.from([\n{array_lines(cos)}\n]);\n")

    atan = list(struct.unpack(f"<{ARCTAN_N}I", pe.read(ARCTAN, 4 * ARCTAN_N)))
    if atan[0] != 0 or any(atan[i] > atan[i + 1] for i in range(ARCTAN_N - 1)):
        fail("table arctangente inattendue")
    (out / "arctan.ts").write_text(
        HEADER.format(what="arctangente", where=f"VA {ARCTAN:#x}, {ARCTAN_N} × u32, lue par 4138c0")
        + f"export const ARCTAN_VA = {ARCTAN:#x};\n"
        + "/** atan(i/512) en unités d'angle 16 bits (0x10000 = 2π) ; 4138c0 renvoie 0 au-delà de 511. */\n"
        + f"export const ARCTAN = Uint32Array.from([\n{array_lines(atan)}\n]);\n")

    qdx = list(struct.unpack("<4i", pe.read(QUAD_DX, 16)))
    qdy = list(struct.unpack("<4i", pe.read(QUAD_DY, 16)))
    (out / "quadrants.ts").write_text(
        HEADER.format(what="décalages par quadrant", where=f"VA {QUAD_DX:#x} et {QUAD_DY:#x}, 4 × i32, lues par 42be0c et 42c1d6")
        + f"export const QUAD_DX_VA = {QUAD_DX:#x};\nexport const QUAD_DY_VA = {QUAD_DY:#x};\n"
        + f"export const QUAD_DX = [{', '.join(map(str, qdx))}] as const;\n"
        + f"export const QUAD_DY = [{', '.join(map(str, qdy))}] as const;\n")

    ri, rj = struct.unpack("<2I", pe.read(RNG_I, 8))
    rtab = list(struct.unpack(f"<{RNG_N}I", pe.read(RNG_TABLE, 4 * RNG_N)))
    if ri >= RNG_N or rj >= RNG_N:
        fail("indices du générateur hors table")
    (out / "random.ts").write_text(
        HEADER.format(what="générateur pseudo-aléatoire", where=f"indices VA {RNG_I:#x} et {RNG_J:#x}, table VA {RNG_TABLE:#x} ({RNG_N} × u32), lus par 4520a4")
        + f"export const RNG_TABLE_VA = {RNG_TABLE:#x};\n"
        + f"/** Indices initiaux (i lu, j accumulé) de 4520a4. */\nexport const RNG_I0 = {ri};\nexport const RNG_J0 = {rj};\n"
        + f"export const RNG_TABLE0 = Uint32Array.from([\n{array_lines([f'{v:#x}' for v in rtab], 8)}\n]);\n")

    order = []
    while True:
        (v,) = struct.unpack("<i", pe.read(BIN_ORDER + 4 * len(order), 4))
        if v == -1:
            break
        if not 0 <= v < TYPE_COUNT or len(order) >= BIN_ORDER_MAX:
            fail("ordre du bac inattendu")
        order.append(v)
    (out / "bin-order.ts").write_text(
        HEADER.format(what="ordre du bac", where=f"VA {BIN_ORDER:#x}, {len(order)} × i32 suivis de −1, lus par 417133")
        + f"export const BIN_ORDER_VA = {BIN_ORDER:#x};\n"
        + "/** Types dans l'ordre du bac (un type absent garde sa place relative : voir `lists.ts`). */\n"
        + f"export const BIN_ORDER = Int16Array.from([\n{array_lines(order)}\n]);\n")

    ptrs = list(struct.unpack(f"<{TYPE_COUNT}I", pe.read(TYPE_TABLE, 4 * TYPE_COUNT)))
    distinct = sorted(set(ptrs))
    descs = []
    for p in distinct:
        words = list(struct.unpack("<28I", pe.read(p, DESC_SIZE)))
        descs.append((p, words))
    lines = []
    for p, words in descs:
        lines.append(f"  [{p:#x}, [{', '.join(f'{w:#x}' for w in words)}]],")
    (out / "descriptors.ts").write_text(
        HEADER.format(what="descripteurs de types", where=f"table VA {TYPE_TABLE:#x} ({TYPE_COUNT} pointeurs), descripteurs de {DESC_SIZE:#x} octets")
        + f"export const TYPE_TABLE_VA = {TYPE_TABLE:#x};\nexport const DESCRIPTOR_SIZE = {DESC_SIZE:#x};\n"
        + "/** Pointeur de descripteur de chaque type 0 … 280 (plusieurs types partagent un descripteur). */\n"
        + f"export const TYPE_DESCRIPTOR_VA = Uint32Array.from([\n{array_lines([f'{p:#x}' for p in ptrs], 8)}\n]);\n"
        + "/** Descripteurs distincts : [VA, 28 mots de 32 bits tels que dans l'image] (handlers en VA, 0 = aucun). */\n"
        + f"export const DESCRIPTOR_WORDS: readonly (readonly [number, readonly number[]])[] = [\n" + "\n".join(lines) + "\n];\n")
    print(f"gen-tables : {len(distinct)} descripteurs, tables écrites dans {out}")


if __name__ == "__main__":
    main()
