"""Inventaire de Croisière pour un cadavre pour scripts/croisiere-extract.sh (voir docs/croisiere/formats.md § 1).

Usage : python3 -I list_volumes.py <dossier des fichiers gardés> <sortie.md>

Lit VOL.CNF et les répertoires de D1..D5 (données extraites non fiables : rien n'en est exécuté, bornes validées), vérifie
que le catalogue et les répertoires concordent, puis écrit l'inventaire Markdown (docs/croisiere/files.md) : fichiers
gardés, contrôles, comptes par extension et les 1 096 entrées des volumes (nom, disque, offset, taille stockée, taille
dépackée). Sortie déterministe (aucune date).
"""
import hashlib
import os
import struct
import sys

NB_DISQUES = 5
TAILLE_ENTREE = 30
FICHIERS = [
    ("D1", "volume 1 (répertoire + données), tel quel (décision D2)"),
    ("D2", "volume 2, tel quel"),
    ("D3", "volume 3, tel quel"),
    ("D4", "volume 4, tel quel"),
    ("D5", "volume 5, tel quel"),
    ("VOL.CNF", "catalogue des volumes, tel quel"),
    ("DELPHINE.LNG", "textes système, tel quel"),
    ("SYSTEM.FNT", "police système, tel quel"),
    ("LISEZ.MOI", "léame d'Abandonware France (CP850), conservé pour la provenance"),
]


def nom_c(octets: bytes) -> str:
    """Nom jusqu'au premier NUL (des octets parasites suivent), en Latin-1."""
    return octets.split(b"\0", 1)[0].decode("latin-1")


def lire_catalogue(cnf: bytes) -> list:
    """VOL.CNF -> liste (par disque) des noms de fichiers."""
    nb, _taille = struct.unpack_from(">hh", cnf, 0)
    if nb != NB_DISQUES:
        sys.exit(f"VOL.CNF : {NB_DISQUES} disques attendus, {nb} trouvés")
    pos = 4 + 20 * nb
    disques = []
    for _ in range(nb):
        (taille,) = struct.unpack_from(">i", cnf, pos)
        pos += 4
        if taille < 0 or taille % 13 or pos + taille > len(cnf):
            sys.exit("VOL.CNF : liste de noms invalide")
        disques.append([nom_c(cnf[pos + i:pos + i + 13]) for i in range(0, taille, 13)])
        pos += taille
    return disques


def lire_repertoire(donnees: bytes, disque: str) -> list:
    """Répertoire de Dn -> liste de (nom, offset, taille stockée, taille dépackée)."""
    nb, taille = struct.unpack_from(">hh", donnees, 0)
    if taille != TAILLE_ENTREE or nb < 0 or 4 + nb * taille > len(donnees):
        sys.exit(f"{disque} : répertoire invalide")
    entrees = []
    for i in range(nb):
        base = 4 + i * taille
        nom = nom_c(donnees[base:base + 14])
        offset, size, ext_size, _inutilise = struct.unpack_from(">IIII", donnees, base + 14)
        if offset + size > len(donnees):
            sys.exit(f"{disque} : {nom} dépasse du fichier")
        entrees.append((nom, offset, size, ext_size))
    return entrees


def extension(nom: str) -> str:
    return nom.rsplit(".", 1)[1].upper() if "." in nom else "(aucune)"


def mo(octets: int) -> str:
    return f"{octets / 1e6:.2f}".replace(".", ",") + " Mo"


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("Usage : list_volumes.py <dossier> <sortie.md>")
    dossier, sortie = sys.argv[1], sys.argv[2]
    lire = lambda n: open(os.path.join(dossier, n), "rb").read()

    catalogue = lire_catalogue(lire("VOL.CNF"))
    entrees = []  # (nom, disque, offset, size, ext_size)
    for i in range(NB_DISQUES):
        disque = f"D{i + 1}"
        repertoire = lire_repertoire(lire(disque), disque)
        if [e[0] for e in repertoire] != catalogue[i]:
            sys.exit(f"{disque} : le répertoire ne correspond pas à VOL.CNF")
        entrees += [(n, disque, o, s, x) for n, o, s, x in repertoire]

    packes = [e for e in entrees if e[3] != e[4]]
    noms = {e[0].upper() for e in entrees}
    total_stocke = sum(e[3] for e in entrees)
    total_ext = sum(e[4] for e in entrees)
    unique_ext = {}
    for n, _d, _o, _s, x in entrees:
        unique_ext.setdefault(n.upper(), x)

    sizes = {n: os.path.getsize(os.path.join(dossier, n)) for n, _ in FICHIERS}
    total_gardes = sum(sizes.values())
    L = []
    L.append("# Inventaire des fichiers de Croisière pour un cadavre")
    L.append("")
    L.append("Généré par `scripts/croisiere-extract.sh` (`scripts/croisiere/list_volumes.py`) : ne pas éditer à la main.")
    L.append("")
    L.append("## Taille")
    L.append("")
    L.append(f"- Total versionné (`original/croisiere/`, hors `files.json`) : **{mo(total_gardes)}** ({total_gardes} octets)"
             f" en {len(FICHIERS)} fichiers, plus `COVER.png` s'il existe (vague J, conservé d'une exécution à l'autre)")
    L.append(f"- Volumes `D1`..`D5` : {mo(sum(sizes[f'D{i}'] for i in range(1, 6)))}, "
             f"{len(entrees)} entrées ({len(noms)} noms uniques), dont {len(packes)} packées (Delphine, taille stockée ≠ taille dépackée)"
             f" et {len(entrees) - len(packes)} brutes")
    L.append(f"- Octets stockés : {total_stocke} ; dépackés : {total_ext} ({len(noms)} noms uniques : {sum(unique_ext.values())})")
    L.append("")
    L.append("## Fichiers gardés")
    L.append("")
    L.append("Source : installeur Abandonware France `setup-00074-Croisiere_pour_un_cadavre-Dosbox.exe` (Inno Setup, extrait par `innoextract`, jamais exécuté),"
             " dossier `app/C/Croisier/`. Les autres fichiers de l'installeur (DOSBox, `DELPHINE.EXE`, `VGADRV.BIN`, `VOL.1`..`VOL.5`, `VOL.END`,"
             " `DELPHINE.CFG`, `INSTALL.EXE`, `DISK1.EXE`, `LISEZ.BAT`) ne sont pas lus par le moteur ScummVM et ne sont pas versionnés.")
    L.append("")
    L.append("| Fichier | Octets | SHA-256 (16 premiers hex) | Origine |")
    L.append("|---|---:|---|---|")
    for nom, origine in FICHIERS:
        h = hashlib.sha256(lire(nom)).hexdigest()[:16]
        L.append(f"| {nom} | {sizes[nom]} | `{h}` | {origine} |")
    L.append("")
    L.append("## Comptes par extension")
    L.append("")
    L.append("| Extension | Entrées | Packées | Octets stockés | Octets dépackés |")
    L.append("|---|---:|---:|---:|---:|")
    par_ext = {}
    for n, _d, _o, s, x in entrees:
        c = par_ext.setdefault(extension(n), [0, 0, 0, 0])
        c[0] += 1
        c[1] += s != x
        c[2] += s
        c[3] += x
    for ext in sorted(par_ext, key=lambda k: (-par_ext[k][3], k)):
        c = par_ext[ext]
        L.append(f"| {ext} | {c[0]} | {c[1]} | {c[2]} | {c[3]} |")
    L.append(f"| **Total** | **{len(entrees)}** | **{len(packes)}** | **{total_stocke}** | **{total_ext}** |")
    L.append("")
    L.append("## Entrées des volumes")
    L.append("")
    L.append("Dans l'ordre de `D1` à `D5` (ordre du répertoire). Packée : taille stockée ≠ taille dépackée ; le dépaqueteur peut rendre `dépackée - 1` octets"
             " (à compléter d'un zéro).")
    L.append("")
    L.append("| Nom | Disque | Offset | Stockée | Dépackée | Packée |")
    L.append("|---|---|---:|---:|---:|---|")
    for n, d, o, s, x in entrees:
        L.append(f"| {n} | {d} | {o} | {s} | {x} | {'oui' if s != x else 'non'} |")
    L.append("")
    with open(sortie, "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print(f"{len(entrees)} entrées listées")


if __name__ == "__main__":
    main()
