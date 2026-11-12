"""Utilitaires de scripts/lure-extract.sh (Lure of the Temptress, version française, voir docs/lure/formats.md).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté, tout est lu).
Sous-commandes (chemins en arguments) :
  verifier <dossier_extrait>                  -> contrôle DISK1-4.VGA (conteneurs heywow), disk1.vga (MD5 des 1 024
                                                 premiers octets, détection de ScummVM) et LURE.EXE (somme 0xD38C)
  bloc <lure.dat> <sortie>                    -> lit la table des langues et la version, écrit le bloc français
  inventaire <dest> <dossier_extrait> <lure.dat> <sortie_md> -> écrit l'inventaire Markdown (docs/lure/files.md)
"""
import hashlib
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

NB_ENTREES = 0xBF                    # entrées de 8 octets de l'index d'un conteneur
TAILLE_ENTREE = 8
DEBUT_ENTREES = 8                    # "heywow" (6) + numéro de disque (2, grand-boutiste)
ALIGNEMENT = 32
FIN = 0xFFFF
DISQUES = {1: 39, 2: 103, 3: 118, 4: 77}  # nombre de ressources attendu (formats.md § 2)
MD5_DISK1 = '1c94475c1bb7e0e88c1757d3b5377e94'  # 1 024 premiers octets de disk1.vga : FR_FRA de ScummVM
SOMME_EXE = 0xD38C                   # somme des 1 024 premiers octets de LURE.EXE : FRENCH_FILE_CHECKSUM de create_lure
LANGUE_FR = 6                        # code de la langue française dans lure.dat (Common::FR_FRA)
VERSION_DAT = (1, 32)                # VERSION_MAJOR / VERSION_MINOR de create_lure
NB_RESSOURCES_FR = 26                # 0x3F01 à 0x3F1A
IDS_FR = list(range(0x3F01, 0x3F1B))
OCTETS_UTILES_FR = 127489
LANGUES = {3: 'anglais', 5: 'espagnol', 6: 'français', 7: 'italien', 10: 'allemand', 17: 'russe'}


def lire(chemin):
    with open(chemin, 'rb') as f:
        return f.read()


def lire_conteneur(d, nom, disque):
    """[(id, position, taille)] d'un conteneur heywow (disque ou bloc de lure.dat), après contrôle de structure.
    `disque` : numéro attendu (0 pour un bloc de lure.dat)."""
    if d[:6] != b'heywow':
        sys.exit('%s : signature heywow absente' % nom)
    num, = struct.unpack('>H', d[6:8])
    if num != disque:
        sys.exit('%s : numéro de disque %d, %d attendu' % (nom, num, disque))
    if len(d) < DEBUT_ENTREES + NB_ENTREES * TAILLE_ENTREE:
        sys.exit('%s : index tronqué' % nom)
    table, fin_donnees, termine = [], 0, False
    for i in range(NB_ENTREES):
        rid, _, ext, taille, off = struct.unpack('<HBBHH', d[DEBUT_ENTREES + i * 8:DEBUT_ENTREES + i * 8 + 8])
        if rid == FIN:
            termine = True
            break
        pos, n = off * ALIGNEMENT, taille + (0x10000 if ext else 0)
        if pos + n > len(d):
            sys.exit('%s : ressource 0x%04X hors du fichier' % (nom, rid))
        table.append((rid, pos, n))
        fin_donnees = max(fin_donnees, pos + n)
    if not termine:
        sys.exit('%s : fin de l\'index (0xFFFF) introuvable' % nom)
    if len({t[0] for t in table}) != len(table):
        sys.exit('%s : identifiants en double' % nom)
    if len(d) - fin_donnees >= ALIGNEMENT:
        sys.exit('%s : %d octets après la dernière ressource (moins de %d attendus)' % (nom, len(d) - fin_donnees, ALIGNEMENT))
    return table


def trouver(dossier, nom):
    """Chemin de `nom` (insensible à la casse) dans le dossier extrait, ou arrêt."""
    for c, rel in ec.liste_fichiers(dossier):
        if os.path.basename(rel).lower() == nom.lower():
            return c
    sys.exit('%s absent de l\'archive' % nom)


def cmd_verifier(dossier):
    for n, attendu in DISQUES.items():
        nom = 'DISK%d.VGA' % n
        table = lire_conteneur(lire(trouver(dossier, nom)), nom, n)
        if len(table) != attendu:
            sys.exit('%s : %d ressources, %d attendues' % (nom, len(table), attendu))
        for rid, _, _ in table:
            if (rid >> 14) + 1 != n and rid != 0xFFFF:
                sys.exit('%s : l\'identifiant 0x%04X n\'appartient pas à ce disque' % (nom, rid))
    d1 = lire(trouver(dossier, 'DISK1.VGA'))
    if hashlib.md5(d1[:1024]).hexdigest() != MD5_DISK1:
        sys.exit('DISK1.VGA : empreinte des 1 024 premiers octets inattendue (ce n\'est pas la version française)')
    exe = lire(trouver(dossier, 'LURE.EXE'))
    if exe[:2] != b'MZ' or sum(exe[:1024]) & 0xFFFF != SOMME_EXE:
        sys.exit('LURE.EXE : somme de contrôle inattendue (ce n\'est pas la version française)')
    print('disques, empreinte de disk1.vga et somme de LURE.EXE conformes')


def lire_dat(d):
    """(version, {langue: (début, fin)}) de lure.dat, après contrôles de la table des langues."""
    if d[:4] != b'lure' or d[4:6] != b'\0\0':
        sys.exit('lure.dat : signature absente')
    # L'entrée de version est une FileEntry à 0xBF * 8 : id 0xFFFF, unused = majeure, sizeExtension = mineure.
    v = d[NB_ENTREES * 8:NB_ENTREES * 8 + 8]
    if len(v) < 8 or v[:2] != b'\xff\xff':
        sys.exit('lure.dat : entrée de version absente')
    version = (v[2], v[3])
    debuts, p = {}, 6
    while d[p] != 0xFF:
        langue, = d[p:p + 1]
        debut, = struct.unpack('<I', d[p + 1:p + 5])
        if langue in debuts:
            sys.exit('lure.dat : langue %d en double' % langue)
        debuts[langue] = debut
        p += 5
    ordre = sorted(debuts.items(), key=lambda kv: kv[1])
    blocs = {}
    for i, (langue, debut) in enumerate(ordre):
        fin = ordre[i + 1][1] if i + 1 < len(ordre) else len(d)
        blocs[langue] = (debut, fin)
    return version, blocs


def extraire_bloc_fr(d):
    version, blocs = lire_dat(d)
    if version != VERSION_DAT:
        sys.exit('lure.dat : version %d.%d, %d.%d attendue (relire formats.md avant de continuer)' % (version + VERSION_DAT))
    if LANGUE_FR not in blocs:
        sys.exit('lure.dat : pas de bloc français (langue %d)' % LANGUE_FR)
    debut, fin = blocs[LANGUE_FR]
    bloc = d[debut:fin]
    table = lire_conteneur(bloc, 'bloc français', 0)
    if [t[0] for t in table] != IDS_FR:
        sys.exit('bloc français : identifiants inattendus (0x3F01 à 0x3F1A attendus)')
    return bloc, table, version, blocs


def cmd_bloc(dat, sortie):
    bloc, table, version, _ = extraire_bloc_fr(lire(dat))
    with open(sortie, 'wb') as f:
        f.write(bloc)
    print('bloc français (version %d.%d) : %d ressources, %d octets' % (version + (len(table), len(bloc))))


def cmd_inventaire(dest, dossier, dat, sortie):
    d = lire(dat)
    bloc, table, version, blocs = extraire_bloc_fr(d)
    utiles = sum(t[2] for t in table)
    if len(table) != NB_RESSOURCES_FR or utiles != OCTETS_UTILES_FR:
        sys.exit('bloc français : %d ressources, %d octets utiles (%d et %d attendus)' % (len(table), utiles, NB_RESSOURCES_FR, OCTETS_UTILES_FR))
    fichiers = [(c, rel) for c, rel in ec.liste_fichiers(dest) if rel != 'files.json']
    total = sum(os.path.getsize(c) for c, _ in fichiers)
    lignes = []
    for c, rel in fichiers:
        h = hashlib.sha256(lire(c)).hexdigest()[:16]
        lignes.append((rel, os.path.getsize(c), h))
    disques = {n: len(lire_conteneur(lire(trouver(dossier, 'DISK%d.VGA' % n)), 'DISK%d.VGA' % n, n)) for n in DISQUES}
    origines = {
        'LURE-FR.DAT': 'bloc français de `lure.dat` de ScummVM (langue 6, `0x%X` à `0x%X`), %d ressources `0x3F01` à `0x3F1A`' % (blocs[LANGUE_FR] + (len(table),)),
        'LICENSE-LURE.txt': '`LICENSE.txt` de l\'archive (licence de Revolution Software, à conserver intacte)',
        'MANUEL.pdf': '`Manual.pdf` de l\'archive (manuel français, 42 pages)',
        'COVER.png': 'vague J (`scripts/lure-cover.mts`), conservé d\'une exécution à l\'autre',
    }
    for n in DISQUES:
        origines['DISK%d.VGA' % n] = '`DISK%d.VGA` de l\'archive, tel quel (conteneur `heywow` n° %d, %d ressources)' % (n, n, disques[n])
    exclus = [('`LURE.EXE`', 'exécutable DOS (138 220 octets) : jamais exécuté, sert seulement à régénérer le bloc français avec `create_lure` de ScummVM.'),
              ('`PROTECT.PDF`', 'feuille de la protection de copie, non portée (D2).'),
              ('`README`', 'note de ScummVM de 2007 (pas un fichier de Revolution) ; l\'essentiel est repris dans l\'aide et `plan.md`.')]
    sections = [
        ('Taille', [
            '- Total versionné (`original/lure/`) : **%s** (%d octets), %d fichiers (hors `files.json`)' % (ec.mo(total, ko=True), total, len(fichiers)),
            '- Hors extraction, conservé d\'une exécution à l\'autre : `COVER.png` (vague J)']),
        ('Fichiers', ec.tableau(['Fichier', 'Octets', 'SHA-256 (16 premiers hex)', 'Origine'],
                                [(r, t, '`%s`' % h, origines.get(r, '')) for r, t, h in lignes], droite=(1,))),
        ('Contrôles faits à l\'extraction', [
            '- `DISK1.VGA` à `DISK4.VGA` : signature `heywow`, numéro de disque, %s ressources, identifiants du bon disque, dernière ressource à moins de 32 octets de la fin.' % ', '.join(str(disques[n]) for n in DISQUES),
            '- `DISK1.VGA` : MD5 des 1 024 premiers octets = `%s` (entrée `FR_FRA` de la détection de ScummVM).' % MD5_DISK1,
            '- `LURE.EXE` : somme des 1 024 premiers octets = `0x%04X` (`FRENCH_FILE_CHECKSUM` de `create_lure`).' % SOMME_EXE,
            '- `lure.dat` (%s, %d octets) : version %d.%d (entrée à `0xBF * 8`) ; langues de la table : %s ; le bloc 6 va de `0x%X` à `0x%X` (fin du fichier).' % (
                ec.mo(len(d), ko=True), len(d), version[0], version[1],
                ', '.join('%s (%d, `0x%X`)' % (LANGUES.get(l, str(l)), l, blocs[l][0]) for l in sorted(blocs, key=lambda k: blocs[k][0])),
                blocs[LANGUE_FR][0], blocs[LANGUE_FR][1]),
            '- Bloc français : `heywow`, numéro 0, %d ressources `0x3F01` à `0x3F1A` consécutives, %d octets utiles.' % (len(table), utiles)]),
        ('Non versionnés', ec.pourquoi_exclus(exclus)),
        ('Régénérer', ['```', 'bash scripts/lure-extract.sh', '```', '',
                       'Archive par défaut : `archives/lure-fr-1.1.zip` ; `lure.dat` par défaut : `archives/lure.dat` (copie de `dists/engine-data/lure.dat` de ScummVM). Aucun des deux n\'est versionné. Outils requis : `bsdtar`, `python3`.']),
    ]
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de Lure of the Temptress', 'scripts/lure-extract.sh', sections)


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'verifier': cmd_verifier, 'bloc': cmd_bloc, 'inventaire': cmd_inventaire}[c](*a)
