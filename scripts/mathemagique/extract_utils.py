"""Utilitaires du script scripts/mathemagique-extract.sh (Math Workshop, Broderbund, 1994).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté).
Sous-commandes :
  iso <iso> <dest>                    -> extrait tout l'ISO 9660 (analyse faite ici : 7zz oublie des fichiers)
  copier <cd> <dest>                  -> copie dans <dest> les fichiers utiles au jeu
  inventaire <dest> <sortie_md>
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

# Fichiers du CD qu'on garde pour le jeu (le reste ne reste que dans archives/mathemagique/cd/).
EXT_RACINE = {'.DAT', '.WMF', '.TTF', '.FON'}
EXCLUS_NOMS = {'MIDIMAC.DAT'}  # jeu de sons MIDI pour Mac
FICHIERS_RACINE = {'MATH'}
FICHIERS_MHK = {'MPC/PVG.MHK'}

POURQUOI_EXCLUS = [
    ('`MIDIMAC.DAT`', 'jeu MIDI pour Mac (`MIDIMPC.DAT`, version PC, est gardé).'),
    ('`BROD*.DLL`, `MOHAWK.WIN`, `MATH.INF`',
     'DLL Broderbund, MOHAWK.WIN et manifeste de l\'installeur : utiles à la rétro-ingénierie, pas servis au navigateur.'),
    ('`INSTALL.EXE`, `MSSETUP.*`, `_MS*.EXE`, `MS*STF.DLL`, `MSDETECT.INC`, `BBINSTAL.MST`',
     'installeur Microsoft Setup.'),
    ('`PVG.EXE`', 'visionneuse de l\'application ; ses ressources `MPC/PVG.MHK` sont gardées.'),
    ('`QTW/` (QuickTime et `.MOV`)', 'QuickTime pour Windows et vidéos du guide des parents, que le jeu ne lit pas.'),
    ('`MPCRSRC/`', 'sauvegardes `.BAK` et doublons.'),
    ('`MWROSTER`', 'modèle de fichier de sauvegarde (liste des élèves).'),
    ('autres fichiers à la racine du CD', 'non utilisés par la réimplémentation.'),
]


def cmd_iso(iso, dest):
    print('%d fichiers extraits de l\'ISO' % ec.extraire_iso(iso, dest))


def est_garde(rel):
    nom = rel.rsplit('/', 1)[-1]
    ext = os.path.splitext(nom)[1].upper()
    if rel in FICHIERS_RACINE or rel in FICHIERS_MHK:
        return True
    if nom.upper() in EXCLUS_NOMS:
        return False
    if '/' not in rel:
        return ext in EXT_RACINE
    return rel.startswith('PVGWMF/') and ext == '.WMF'


def classer(chemin, rel, nom):
    """(catégorie, gardé) d'un fichier du CD ; `rel` porte le séparateur de l'OS."""
    return os.path.splitext(nom)[1].upper(), est_garde(rel.replace(os.sep, '/'))


def cmd_copier(cd, dest):
    ec.copier_filtre(cd, dest, classer)


def mo(n):
    return ec.mo(n, ko=True)


def cmd_inventaire(dest, sortie):
    total, par_groupe = 0, {}
    tailles = {}
    for chemin, rel in ec.liste_fichiers(dest):
        if rel == 'files.json':
            continue
        t = os.path.getsize(chemin)
        total += t
        tailles[rel] = t
        ext = os.path.splitext(rel)[1].upper() or '(sans extension)'
        cle = ext + (' (PVGWMF/)' if rel.startswith('PVGWMF/') else '')
        if rel.startswith('MPC/'):
            cle = '.MHK (MPC/)'
        e = par_groupe.setdefault(cle, [0, 0])
        e[0] += 1
        e[1] += t
    mhk = sorted(r for r in tailles if os.path.splitext(r)[1].upper() in ('.DAT', '.MHK'))
    lignes_mhk = []
    for rel in mhk:
        types = ec.mohawk_types(os.path.join(dest, rel))
        if types is None:
            lignes_mhk.append(('`%s`' % rel, mo(tailles[rel]), 'pas une archive Mohawk'))
        else:
            lignes_mhk.append(('`%s`' % rel, mo(tailles[rel]),
                               ', '.join('`%s` : %d' % (ec.echappe_tag(t), c) for t, c in types)))
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de Math Workshop (Mathémagique)',
                         'scripts/mathemagique-extract.sh', [
        ('Taille', [
            '- Total versionné (`original/mathemagique/`) : **%s** (%d octets), %d fichiers' % (mo(total), total, len(tailles))]),
        ('Par groupe de fichiers', ec.tableau(['Extension', 'Fichiers', 'Taille'],
                                              [(k, par_groupe[k][0], mo(par_groupe[k][1])) for k in sorted(par_groupe)],
                                              droite=(1, 2))),
        ('Archives Mohawk', [
            'Types de ressources (tag de 4 octets : nombre de ressources). Les octets non imprimables sont échappés.', '']
            + ec.tableau(['Fichier', 'Taille', 'Types de ressources'], lignes_mhk, droite=(1,))),
        ('Gardé uniquement dans `archives/mathemagique/cd/`', ec.pourquoi_exclus(POURQUOI_EXCLUS) + [
            '', 'Le CD complet est extrait dans `archives/mathemagique/cd/` (non versionné).']),
        ('Régénérer', ['```', 'bash scripts/mathemagique-extract.sh [archive.zip]', '```', '',
            'Archive par défaut : `archives/mathemagique/Math-Workshop_Win_EN_ISO-Version.zip` (non versionnée). '
            'Outils requis : `unzip`, `python3`.']),
    ])


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'iso': cmd_iso, 'copier': cmd_copier, 'inventaire': cmd_inventaire}[c](*a)
