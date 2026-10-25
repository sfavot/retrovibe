"""Utilitaires du script scripts/armaeth-extract.sh.

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance.
Sous-commandes :
  extraire <iso> <dest>              -> extrait l'ISO 9660 (scripts/lib/extract_common.py)
  copier <racine_iso> <dest> <stats> -> filtre et copie la version française à plat ; stats JSON
  inventaire <dest> <stats> <sortie_md>
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

DOSSIER_FR = 'ARMAETH.FRE'
PREFIXE_FR = 'A1F'
COMMUNS = {'SVG001.STD', 'MSGHRD', 'MSGINT', 'MSGUTL'}
MOTEUR = 'AM1.EXE'  # le moteur peut avoir besoin de tables qu'il contient
EXCLUS = [
    ('`ARMAETH.RNC`', 'archive Rob Northen utilisée par l\'installeur disque dur ; le jeu ne la lit pas.'),
    ('Autres `.EXE`', 'installeurs, configuration du son (`SC0`/`SC1`/`SOS`), `VGA.EXE`, `CDPATCH.EXE` : sans objet pour le port.'),
    ('`.BAT`', 'lanceurs et aides DOS.'),
    ('`ARMAETH.ENG` et `ARMAETH.DEU`', 'versions anglaise et allemande ; le CD complet reste dans `archives/armaeth/cd/`.'),
    ('Fichiers racine du CD', 'scripts d\'installation et d\'aide uniquement (`.BAT`).'),
]


def classer(chemin, rel, nom):
    """(catégorie, gardé) d'un fichier de ARMAETH.FRE."""
    ext = os.path.splitext(nom)[1].upper() or '(sans extension)'
    nom_u = nom.upper()
    return ext, nom_u.startswith(PREFIXE_FR) or nom_u in COMMUNS or nom_u == MOTEUR


def cmd_extraire(iso, dest):
    ec.extraire_iso(iso, dest)


def cmd_copier(racine, dest, stats_json):
    """Copie à plat la version française ; le reste du CD (autres langues, racine) est compté dans les exclus."""
    fr = os.path.join(racine, DOSSIER_FR)
    gardes, exclus = ec.copier_filtre(fr, dest, classer)
    for dossier, _, fichiers in os.walk(racine):
        if os.path.abspath(dossier) == os.path.abspath(fr):
            continue
        rel = os.path.relpath(dossier, racine)
        cat = 'racine du CD' if rel == '.' else 'dossier ' + rel.split(os.sep)[0]
        for nom in fichiers:
            e = exclus.setdefault(cat, [0, 0])
            e[0] += 1
            e[1] += os.path.getsize(os.path.join(dossier, nom))
    with open(stats_json, 'w') as o:
        json.dump({'gardes': gardes, 'exclus': exclus}, o)


def cmd_inventaire(dest, stats_json, sortie):
    st = json.load(open(stats_json))
    gardes = st['gardes']
    total = ec.taille_dossier(dest)
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers d\'Armaeth', 'scripts/armaeth-extract.sh', [
        ('Taille', [
            '- Total versionné (`original/armaeth/`, version française à plat) : **%s** (%d octets)'
            % (ec.mo(total), total),
            '- Fichiers gardés : %d' % len(gardes)]
            + (['- Hors CD, conservé d\'une extraction à l\'autre : `COVER.png` (jaquette 320 x 200 générée par '
                '`scripts/armaeth-cover.mts` depuis la scène 20 de `A1F00E.VGA`)']
               if os.path.exists(os.path.join(dest, 'COVER.png')) else [])),
        ('Par extension (fichiers gardés)', ec.tableau_par_categorie('Extension', ec.agreger_gardes(gardes))),
        ('Fichiers exclus (agrégés par catégorie)', ec.tableau_par_categorie('Catégorie', st['exclus'])),
        ('Pourquoi exclus', ec.pourquoi_exclus(EXCLUS)),
        ('Régénérer', ['```', 'bash scripts/armaeth-extract.sh [archive.7z]', '```', '',
            'Archive par défaut : `archives/armaeth/jeu-02436-armaeth-CD-pcdos.7z` (non versionnée). '
            'Outils requis : `7zz`, `python3`. Le CD complet (3 langues) est extrait dans `archives/armaeth/cd/`.']),
    ])


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'extraire': cmd_extraire, 'copier': cmd_copier, 'inventaire': cmd_inventaire}[c](*a)
