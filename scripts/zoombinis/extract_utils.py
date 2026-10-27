"""Utilitaires du script scripts/zoombinis-extract.sh (L'Odyssée des Zoombinis, Broderbund / TERC, 1996).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté).
Sous-commandes :
  iso <iso> <dest>                    -> extrait tout l'ISO 9660 (scripts/lib/extract_common.py)
  copier <cd> <dest>                  -> copie à plat dans <dest> les fichiers utiles au jeu (version française)
  inventaire <dest> <sortie_md>
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

LANGUE = 'FRENCH'
# Archives Mohawk de la langue retenue, sauf MIDIMAC.MHK (jeu MIDI pour Mac ; MIDIMPC.MHK est la version PC).
EXCLUS_LANGUE = {'MIDIMAC.MHK'}
# Fichiers de la racine du CD gardés : table d'adaptation MIDI (SYSX) et police TrueType du jeu.
FICHIERS_RACINE = {'MIDIMAP.DAT', 'CORNER.TTF'}

POURQUOI_EXCLUS = [
    ('`ENGLISH/`, `GERMAN/`', 'versions anglaise et allemande (seule `FRENCH/` est servie).'),
    ('`FRENCH/MIDIMAC.MHK`', 'jeu MIDI pour Mac (`MIDIMPC.MHK`, version PC, est gardé).'),
    ('`FRENCH/LOGO*.MOV`, `FRENCH/LOGO*.PRF`',
     'vidéos QuickTime des logos et leurs fichiers de préchargement : à étudier (lues par le jeu au démarrage ?).'),
    ('`ZOOMBINI._EX`', 'exécutable NE 16 bits du jeu (Borland C++), cible de la rétro-ingénierie.'),
    ('`BROEMIDI`, `BROEMIDI.TMI`, `DIB.DRV`, `MOHAWK.WIN`, `QB.DEC`',
     'lanceur MIDI, pilote DIB, configuration du moteur et décodeur QuickTime : utiles à la rétro-ingénierie, pas servis au navigateur.'),
    ('`SETUP.*/`, `INSTALL.EXE`, `AUTORUN.*`, `SYSTEM/`', 'installeurs (Microsoft Setup, QuickTime, WinG) et lanceur du CD.'),
    ('`*.TXT`', 'notes techniques de la version 1.0 (français, anglais, allemand).'),
]


def cmd_iso(iso, dest):
    print('%d fichiers extraits de l\'ISO' % ec.extraire_iso(iso, dest))


def destination(rel):
    """Nom de sortie (à plat, en majuscules) d'un fichier du CD, ou None s'il n'est pas gardé."""
    u = rel.replace(os.sep, '/').upper()
    dossier, _, nom = u.rpartition('/')
    if dossier == '':
        return nom if nom in FICHIERS_RACINE else None
    if dossier == LANGUE and nom.endswith('.MHK') and nom not in EXCLUS_LANGUE:
        return nom
    return None


def cmd_copier(cd, dest):
    os.makedirs(dest, exist_ok=True)
    n = 0
    for chemin, rel in ec.liste_fichiers(cd):
        nom = destination(rel)
        if nom:
            shutil.copyfile(chemin, os.path.join(dest, nom))
            n += 1
    print('%d fichiers gardés' % n)


def cmd_inventaire(dest, sortie):
    tailles = {rel: os.path.getsize(c) for c, rel in ec.liste_fichiers(dest) if rel != 'files.json'}
    total = sum(tailles.values())
    lignes_mhk, autres = [], []
    for rel in sorted(tailles):
        types = ec.mohawk_types(os.path.join(dest, rel))
        if types is None:
            autres.append(('`%s`' % rel, ec.mo(tailles[rel], ko=True)))
        else:
            lignes_mhk.append(('`%s`' % rel, ec.mo(tailles[rel], ko=True),
                               ', '.join('`%s` : %d' % (ec.echappe_tag(t), c) for t, c in types)))
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de L\'Odyssée des Zoombinis', 'scripts/zoombinis-extract.sh', [
        ('Taille', [
            '- Total versionné (`original/zoombinis/`) : **%s** (%d octets), %d fichiers' % (ec.mo(total), total, len(tailles)),
            '- Version française du CD (`FRENCH/`), à plat.']),
        ('Archives Mohawk', [
            'Types de ressources (tag de 4 octets : nombre de ressources). Les octets non imprimables sont échappés. '
            '`MIDIMAP.DAT` est aussi une archive Mohawk malgré son extension.', '']
            + ec.tableau(['Fichier', 'Taille', 'Types de ressources'], lignes_mhk, droite=(1,))),
        ('Autres fichiers', ec.tableau(['Fichier', 'Taille'], autres, droite=(1,))),
        ('Gardé uniquement dans `archives/zoombinis/`', ec.pourquoi_exclus(POURQUOI_EXCLUS) + [
            '', 'Le CD complet est extrait dans `archives/zoombinis/cd/`, l\'installation DOSBox d\'Abandonware France '
            '(Windows 3.1 installé, avec `ZOOMBINI.EXE`, `ZOOMBINI.CFG` et `ZOOMBINI.WHO`) dans `archives/zoombinis/setup/` '
            'et le manuel PDF dans `archives/zoombinis/manuel/` (non versionnés).']),
        ('Régénérer', ['```', 'bash scripts/zoombinis-extract.sh [jeu.7z [installeur.exe [manuel.7z]]]', '```', '',
            'Archives par défaut dans `archives/zoombinis/` (non versionnées) : `jeu-02069-odyssee_des_zoombinis-pcwin.7z`, '
            '`setup-02069-Zoombinis_Logique-Dosbox.exe`, `man-02069-l_odyssee_des_zoombinis.7z`. '
            'Outils requis : `7zz`, `innoextract`, `python3`.']),
    ])


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'iso': cmd_iso, 'copier': cmd_copier, 'inventaire': cmd_inventaire}[c](*a)
