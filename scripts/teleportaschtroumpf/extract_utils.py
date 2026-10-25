"""Utilitaires du script scripts/teleportaschtroumpf-extract.sh.

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance.
Sous-commandes :
  pistes <cue>                       -> affiche le nombre de secteurs de la piste 1 (données)
  iso <bin> <iso> <nb_secteurs>      -> secteurs bruts MODE1/2352 -> ISO 2048
  extraire <iso> <dest>              -> extrait l'ISO 9660 (scripts/lib/extract_common.py)
  copier <racine_iso> <dest> <stats> -> filtre et copie DATA/JEU_F + SMURF.EXE ; stats JSON
  inventaire <dest> <stats> <sortie_md>
  manuel <html_textutil> <html_propre> -> met en page la notice (HTML de textutil) avant l'impression en PDF
"""
import html
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

EXT_GARDEES = {'.MCG', '.MUX', '.HY8', '.VOC', '.PAL', '.MUT', '.PRC', '.DAT', '.PFN', '.DOC'}
SIGNATURE_MUX = bytes([0x07, 0xAA, 0x00, 0x00])


def cmd_pistes(cue):
    print(ec.secteurs_piste_donnees(ec.parse_cue(cue)))


def cmd_iso(binf, iso, nb):
    ec.bin_vers_iso(binf, iso, nb)


def est_mux_sans_ext(chemin):
    with open(chemin, 'rb') as f:
        return f.read(4) == SIGNATURE_MUX


def classer(chemin, rel, nom):
    """(catégorie, gardé) d'un fichier de DATA/JEU_F."""
    ext = os.path.splitext(nom)[1].upper()
    if ext in EXT_GARDEES or nom.upper() == 'DESCRIPT.ION':
        return ext or 'DESCRIPT.ION', True
    if not ext and est_mux_sans_ext(chemin):
        return '(MUX sans extension)', True
    return ext or '(sans extension, non MUX)', False


def cmd_extraire(iso, dest):
    ec.extraire_iso(iso, dest)


def cmd_copier(racine, dest, stats_json):
    gardes, exclus = ec.copier_filtre(os.path.join(racine, 'DATA', 'JEU_F'), dest, classer, 'DATA')
    shutil.copyfile(os.path.join(racine, 'SMURF.EXE'), os.path.join(dest, 'SMURF.EXE'))
    with open(stats_json, 'w') as o:
        json.dump({'gardes': gardes, 'exclus': exclus}, o)


def cmd_inventaire(dest, stats_json, sortie):
    st = json.load(open(stats_json))
    gardes = st['gardes']
    mo = ec.mo
    smurf = os.path.getsize(os.path.join(dest, 'SMURF.EXE'))
    total = ec.taille_dossier(dest)
    par_scene = {}
    for g in gardes:
        m = re.match(r'(S\d+)', g['rel'].split(os.sep)[0].upper())
        scene = m.group(1) if m else '(racine)'
        par_scene[scene] = par_scene.get(scene, 0) + 1
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers du Téléportaschtroumpf',
                         'scripts/teleportaschtroumpf-extract.sh', [
        ('Taille', [
            '- Total versionné (`original/teleportaschtroumpf/`) : **%s** (%d octets)' % (mo(total), total),
            '- Fichiers de données (`DATA/`) : %d ; `SMURF.EXE` : %s' % (len(gardes), mo(smurf))]),
        ('Par extension (fichiers gardés)', ec.tableau_par_categorie('Extension', ec.agreger_gardes(gardes))),
        ('Par scène', ec.tableau(['Scène', 'Fichiers'], sorted(par_scene.items()), droite=(1,))),
        ('Fichiers exclus (agrégés par catégorie)', ec.tableau_par_categorie('Catégorie', st['exclus'])),
        ('Pistes audio du CD', [
            '- Les pistes CD-DA 2 à 7 existent sur le disque mais ne sont pas extraites : '
            'le jeu ne les lit jamais (voir `docs/teleportaschtroumpf/engine.md` §5).']),
        ('Notice', [
            '- `MANUEL.pdf` : la notice d\'Infogrames (`Lisez moi.doc` à la racine du CD), convertie par '
            '`textutil` puis Chrome en mode headless (mise en page simplifiée : le lecteur Word de `textutil` perd gras et '
            'tailles). Elle n\'est pas lue par le jeu.']),
        ('Régénérer', ['```', 'bash scripts/teleportaschtroumpf-extract.sh [archive.rar]', '```', '',
            'Archive par défaut : `archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar` '
            '(non versionnée). Outils requis : `bsdtar`, `python3` ; pour la notice, `textutil` et Google Chrome (macOS).']),
    ])


CSS_MANUEL = """
@page { size: A4; margin: 20mm 18mm; }
body { font: 11pt/1.45 Helvetica, Arial, sans-serif; color: #111; max-width: 40em; margin: 0 auto; }
h1 { font-size: 20pt; margin: 0 0 1em; }
h3 { font-size: 11pt; margin: 1.1em 0 .3em; break-after: avoid; }
h2 { font-size: 14pt; margin: 1.6em 0 .5em; break-after: avoid; border-bottom: 1px solid #999; padding-bottom: .15em; }
p { margin: 0 0 .45em; }
ul { margin: 0 0 .8em; padding-left: 1.4em; }
li { margin: 0 0 .25em; }
"""
TITRES = {
    'Crédits', 'But du jeu', 'Configuration Nécessaire', 'Commandes', 'Menu principal', 'Le menu «Schtroumpf»',
    'Personnalisation', 'par le menu «Parents»', 'Début de partie', 'Écran de jeu', 'Fin de partie', 'Ecran Pause',
    'La carte du Pays Schtroumpf', 'L’écran «Infos»', 'Temps limité', 'Aide sonore', 'Guide de Dépannage',
    'Lancement du jeu', 'AVERTISSEMENT SUR L’EPILEPSIE',
}
SOUS_TITRES = {
    'Clavier', 'Sélection', 'Validation', 'Option «durée»:', 'Option «pause»:', 'Option «motif d’arrêt de jeu»:',
    'LE PROGRAMME NE SE CHARGE PAS CORRECTEMENT', 'LE MESSAGE “ Mémoire RAM = 540 KO” APPARAÎT',
    'Optimisation de la mémoire', 'BOOT MINIMAL', 'Sous Windows 95', 'Sous Dos 5.xx ou Dos 6.xx.',
}


def cmd_manuel(entree, sortie):
    """Notice : le lecteur Word de textutil perd gras et tailles, mais garde le texte ; les titres sont donc
    repérés par leur libellé (liste fermée, la notice est un document figé)."""
    src = open(entree, encoding='utf-8').read()
    paras = []
    for m in re.finditer(r'<p class="p\d+">(.*?)</p>', src, re.S):
        brut = re.sub(r'<[^>]+>', '', m.group(1).replace('<br>', ''))
        paras.append(re.sub(r'\s+', ' ', html.unescape(brut).replace('\xa0', ' ')).strip())
    # Le « É » initial manque dans le document d'origine : « cran de jeu ».
    paras = ['Écran de jeu' if p == 'cran de jeu' else p for p in paras]
    corps, liste = [], []

    def vider():
        if liste:
            corps.append('<ul>%s</ul>' % ''.join('<li>%s</li>' % html.escape(i) for i in liste))
            liste.clear()

    for p in paras:
        if not p:
            continue
        if p.startswith('•'):
            liste.append(p.lstrip('• \t'))
            continue
        vider()
        t = html.escape(p)
        if p in TITRES:
            if p == 'par le menu «Parents»':  # titre sur deux lignes dans le document
                corps[-1] = corps[-1][:-5] + ' ' + t + '</h2>'
            else:
                corps.append('<h1>%s</h1>' % t if p == 'Crédits' else '<h2>%s</h2>' % t)
        elif p in SOUS_TITRES:
            corps.append('<h3>%s</h3>' % t)
        else:
            corps.append('<p>%s</p>' % t)
    vider()
    titre_doc = 'Le Téléportaschtroumpf : notice d\'origine'
    with open(sortie, 'w', encoding='utf-8') as o:
        o.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>%s</title><style>%s</style></head>'
                '<body>%s</body></html>' % (html.escape(titre_doc), CSS_MANUEL, '\n'.join(corps)))


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'pistes': cmd_pistes, 'iso': cmd_iso, 'extraire': cmd_extraire,
     'copier': cmd_copier, 'inventaire': cmd_inventaire, 'manuel': cmd_manuel}[c](*a)
