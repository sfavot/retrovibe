"""Utilitaires du script scripts/swiv3d-extract.sh.

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance.
Sous-commandes :
  iso <cue> <bin> <dest.iso>         -> piste de données du BIN/CUE vers une ISO 2048
  audio <cue> <bin> <dest_dir>       -> pistes audio en TrackNN.wav
  extraire <iso> <dest>              -> extrait l'ISO 9660 (scripts/lib/extract_common.py)
  copier <racine_iso> <dest> <stats> -> copie à plat les fichiers utiles au jeu ; stats JSON
  inventaire <dest> <stats> <sortie_md>
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

DONNEES = {'GLOBAL.BD', 'SOUNDS.BD', 'DEMO.SLV', 'TERRAN00.SLV', 'TERRAN01.SLV', 'TERRAN02.SLV', 'TERRAN03.SLV'}
MANUEL_SOURCE = 'MANUALS/FRANCAIS.TXT'
MANUEL = 'MANUEL.TXT'
EXCLUS = [
    ('`GameData/*.EXE`, `*.DLL`', 'exécutables et bibliothèques Windows (`SWIV_WIN.EXE` est la cible de rétro-ingénierie, `SWIV_WFX.EXE` '
     'la variante 3Dfx) : gardés dans `archives/swiv3d/cd/` uniquement.'),
    ('`INSTDAT/`', 'installeur et DirectX 3/5 redistribuable : sans objet pour le port.'),
    ('`SETUP*.EXE`, `CRCLOG.DAT`, `README.TXT`, `LEGAL.TXT`', 'installeur, journal de contrôle et textes légaux.'),
    ('`Manuals/` hors français', 'manuels anglais, allemand, espagnol, italien, portugais, tchèque et polonais.'),
]
CAT_EXCLUS = {
    'exe': 'GameData : exécutables et DLL',
    'instdat': 'INSTDAT (installeur, DirectX)',
    'racine': 'Racine du CD (Setup, CRCLOG, textes)',
    'manuels': 'Manuels autres langues',
}


def classer(rel):
    """(chemin de sortie ou None, catégorie) d'un fichier du CD ; rel avec '/' et noms normalisés en majuscules."""
    u = rel.upper()
    dossier, _, nom = u.rpartition('/')
    if dossier == 'GAMEDATA':
        if nom in DONNEES:
            return nom, 'données'
        return None, CAT_EXCLUS['exe']
    if dossier == 'ANIMS' and nom.endswith(('.SMK', '.SCR')):
        return 'ANIMS/' + nom, 'animations' if nom.endswith('.SMK') else 'scripts d\'animation'
    if u == MANUEL_SOURCE:
        return MANUEL, 'manuel'
    if dossier == 'MANUALS':
        return None, CAT_EXCLUS['manuels']
    if dossier.startswith('INSTDAT'):
        return None, CAT_EXCLUS['instdat']
    if not dossier:
        return None, CAT_EXCLUS['racine']
    return None, 'autres (%s)' % dossier


def cmd_iso(cue, binf, iso):
    pistes = ec.parse_cue(cue)
    ec.bin_vers_iso(binf, iso, ec.secteurs_piste_donnees(pistes))


def cmd_audio(cue, binf, dest):
    pistes = ec.parse_cue(cue)
    ec.extraire_pistes_audio(binf, pistes, os.path.getsize(binf), dest)


def cmd_extraire(iso, dest):
    ec.extraire_iso(iso, dest)


def cmd_copier(racine, dest, stats_json):
    """Copie à plat les fichiers utiles ; les autres sont comptés par catégorie dans les exclus."""
    gardes, exclus = [], {}
    for chemin, rel in ec.liste_fichiers(racine):
        sortie, cat = classer(rel)
        taille = os.path.getsize(chemin)
        if sortie:
            cible = os.path.join(dest, *sortie.split('/'))
            os.makedirs(os.path.dirname(cible), exist_ok=True)
            shutil.copyfile(chemin, cible)
            gardes.append({'rel': sortie, 'cat': cat, 'taille': taille})
        else:
            e = exclus.setdefault(cat, [0, 0])
            e[0] += 1
            e[1] += taille
    with open(stats_json, 'w') as o:
        json.dump({'gardes': gardes, 'exclus': exclus}, o)


def cmd_inventaire(dest, stats_json, sortie):
    st = json.load(open(stats_json))
    gardes = list(st['gardes'])
    for chemin, rel in ec.liste_fichiers(dest):  # audio encodé et extras non issus des données du CD
        if rel.startswith('MUSIC/'):
            gardes.append({'rel': rel, 'cat': 'musique (MP3)', 'taille': os.path.getsize(chemin)})
        elif rel == 'COVER.png':
            gardes.append({'rel': rel, 'cat': 'jaquette', 'taille': os.path.getsize(chemin)})
    total = sum(g['taille'] for g in gardes)
    musique = sum(g['taille'] for g in gardes if g['cat'] == 'musique (MP3)')
    detail = ec.tableau(['Fichier', 'Catégorie', 'Taille'],
                        [('`%s`' % g['rel'], g['cat'], ec.mo(g['taille'])) for g in sorted(gardes, key=lambda g: g['rel'])],
                        droite=(2,))
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de SWIV 3D', 'scripts/swiv3d-extract.sh', [
        ('Taille', [
            '- Total versionné (`original/swiv3d/`, à plat) : **%s** (%d octets), dont la musique : %s'
            % (ec.mo(total), total, ec.mo(musique)),
            '- Fichiers gardés : %d' % len(gardes)]),
        ('Par catégorie (fichiers gardés)', ec.tableau_par_categorie('Catégorie', ec.agreger_gardes(gardes))),
        ('Fichiers gardés', detail),
        ('Fichiers exclus (agrégés par catégorie)', ec.tableau_par_categorie('Catégorie', st['exclus'])),
        ('Pourquoi exclus', ec.pourquoi_exclus(EXCLUS)),
        ('Remarques', [
            '- Le CD est le build CUTDOWN de `GLOBAL.BD` (7 mai 1997), cohérent avec `GameData/SWIV_WIN.EXE`. '
            'L\'installeur Abandonware France contient le build NORMAL (17 juin 1997), plus récent : il reste dans '
            '`archives/swiv3d/setup/` uniquement.',
            '- Les 9 pistes CD-DA (2 à 10) sont encodées en MP3 128 kbit/s CBR, 44,1 kHz stéréo ; les numéros du CD '
            'sont conservés (`MUSIC/TRACKNN.MP3`) car l\'exécutable joue « cdaudio from track N ».',
            '- `MANUEL.TXT` est le manuel français du CD, octets inchangés.']),
        ('Régénérer', ['```', 'bash scripts/swiv3d-extract.sh [jeu.7z [patch.7z [installeur.exe]]]', '```', '',
            'Archives par défaut dans `archives/swiv3d/` (non versionnées). Outils requis : `7zz`, `innoextract`, '
            '`ffmpeg`, `python3`. Le CD complet est extrait dans `archives/swiv3d/cd/`, le patch dans '
            '`archives/swiv3d/patch/` et l\'installeur dans `archives/swiv3d/setup/` (références de rétro-ingénierie).']),
    ])


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'iso': cmd_iso, 'audio': cmd_audio, 'extraire': cmd_extraire, 'copier': cmd_copier,
     'inventaire': cmd_inventaire}[c](*a)
