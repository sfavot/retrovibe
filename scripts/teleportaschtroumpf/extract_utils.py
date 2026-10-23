"""Utilitaires du script scripts/teleportaschtroumpf-extract.sh.

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance.
Sous-commandes :
  pistes <cue>                       -> affiche le nombre de secteurs de la piste 1 (données)
  iso <bin> <iso> <nb_secteurs>      -> secteurs bruts MODE1/2352 -> ISO 2048
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

SECTEUR = 2352
EXT_GARDEES = {'.MCG', '.MUX', '.HY8', '.VOC', '.PAL', '.MUT', '.PRC', '.DAT', '.PFN', '.DOC'}
SIGNATURE_MUX = bytes([0x07, 0xAA, 0x00, 0x00])


def parse_cue(chemin):
    """Retourne {n° de piste: (type, secteur de début de l'INDEX 01)}."""
    pistes, courante = {}, None
    for ligne in open(chemin, encoding='latin-1'):
        m = re.match(r'\s*TRACK\s+(\d+)\s+(\S+)', ligne)
        if m:
            courante = (int(m.group(1)), m.group(2))
            continue
        m = re.match(r'\s*INDEX\s+01\s+(\d+):(\d+):(\d+)', ligne)
        if m and courante:
            mm, ss, ff = map(int, m.groups())
            pistes[courante[0]] = (courante[1], (mm * 60 + ss) * 75 + ff)
    return pistes


def cmd_pistes(cue):
    pistes = parse_cue(cue)
    audio = sorted(n for n, (t, _) in pistes.items() if t == 'AUDIO')
    # La piste 1 (données) va du secteur 0 au début de la première piste audio :
    # le PREGAP de la piste audio n'est pas stocké dans le .bin.
    print(pistes[audio[0]][1])


def cmd_iso(binf, iso, nb):
    nb = int(nb)
    with open(binf, 'rb') as f, open(iso, 'wb') as o:
        for _ in range(nb):
            s = f.read(SECTEUR)
            if len(s) < SECTEUR:
                break
            o.write(s[16:16 + 2048])


def est_mux_sans_ext(chemin):
    with open(chemin, 'rb') as f:
        return f.read(4) == SIGNATURE_MUX


def cmd_copier(racine, dest, stats_json):
    source = os.path.join(racine, 'DATA', 'JEU_F')
    gardes, exclus = [], {}
    for dossier, _, fichiers in os.walk(source):
        for nom in sorted(fichiers):
            chemin = os.path.join(dossier, nom)
            rel = os.path.relpath(chemin, source)
            ext = os.path.splitext(nom)[1].upper()
            taille = os.path.getsize(chemin)
            if ext in EXT_GARDEES or nom.upper() == 'DESCRIPT.ION':
                categorie = ext or 'DESCRIPT.ION'
                garde = True
            elif not ext and est_mux_sans_ext(chemin):
                categorie, garde = '(MUX sans extension)', True
            else:
                categorie, garde = ext or '(sans extension, non MUX)', False
            if garde:
                cible = os.path.join(dest, 'DATA', rel)
                os.makedirs(os.path.dirname(cible), exist_ok=True)
                shutil.copyfile(chemin, cible)
                gardes.append({'rel': rel, 'cat': categorie, 'taille': taille})
            else:
                e = exclus.setdefault(categorie, [0, 0])
                e[0] += 1
                e[1] += taille
    shutil.copyfile(os.path.join(racine, 'SMURF.EXE'), os.path.join(dest, 'SMURF.EXE'))
    with open(stats_json, 'w') as o:
        json.dump({'gardes': gardes, 'exclus': exclus}, o)


def mo(n):
    return '%.1f Mo' % (n / 1048576)


def cmd_inventaire(dest, stats_json, sortie):
    st = json.load(open(stats_json))
    gardes = st['gardes']
    smurf = os.path.getsize(os.path.join(dest, 'SMURF.EXE'))
    total = 0
    for dossier, _, fichiers in os.walk(dest):
        total += sum(os.path.getsize(os.path.join(dossier, f)) for f in fichiers)
    par_ext, par_scene = {}, {}
    for g in gardes:
        e = par_ext.setdefault(g['cat'], [0, 0])
        e[0] += 1
        e[1] += g['taille']
        m = re.match(r'(S\d+)', g['rel'].split(os.sep)[0].upper())
        scene = m.group(1) if m else '(racine)'
        par_scene[scene] = par_scene.get(scene, 0) + 1
    L = ['# Inventaire des fichiers du Téléportaschtroumpf', '',
         'Généré par `scripts/teleportaschtroumpf-extract.sh` (ne pas éditer à la main).', '',
         '## Taille', '',
         '- Total versionné (`original/teleportaschtroumpf/`) : **%s** (%d octets)' % (mo(total), total),
         '- Fichiers de données (`DATA/`) : %d ; `SMURF.EXE` : %s'
         % (len(gardes), mo(smurf)), '',
         '## Par extension (fichiers gardés)', '',
         '| Extension | Fichiers | Taille |', '|---|---:|---:|']
    for k in sorted(par_ext):
        L.append('| %s | %d | %s |' % (k, par_ext[k][0], mo(par_ext[k][1])))
    L += ['', '## Par scène', '', '| Scène | Fichiers |', '|---|---:|']
    for k in sorted(par_scene):
        L.append('| %s | %d |' % (k, par_scene[k]))
    L += ['', '## Fichiers exclus (agrégés par catégorie)', '',
          '| Catégorie | Fichiers | Taille |', '|---|---:|---:|']
    for k in sorted(st['exclus']):
        n, t = st['exclus'][k]
        L.append('| %s | %d | %s |' % (k, n, mo(t)))
    L += ['', '## Pistes audio du CD', '',
          '- Les pistes CD-DA 2 à 7 existent sur le disque mais ne sont pas extraites : '
          'le jeu ne les lit jamais (voir `docs/teleportaschtroumpf/engine.md` §5).', '',
          '## Notice', '',
          '- `MANUEL.pdf` : la notice d\'Infogrames (`Lisez moi.doc` à la racine du CD), convertie par '
          '`textutil` puis Chrome en mode headless (mise en page simplifiée : le lecteur Word de `textutil` perd gras et '
          'tailles). Elle n\'est pas lue par le jeu.', '',
          '## Régénérer', '', '```', 'bash scripts/teleportaschtroumpf-extract.sh [archive.rar]', '```', '',
          'Archive par défaut : `archives/teleportaschtroumpf/jeu-01592-teleportaschtroumpf-pcdos.rar` '
          '(non versionnée). Outils requis : `bsdtar`, `7zz`, `python3` ; pour la notice, `textutil` et Google Chrome (macOS).', '']
    os.makedirs(os.path.dirname(sortie), exist_ok=True)
    with open(sortie, 'w') as o:
        o.write('\n'.join(L))

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
    {'pistes': cmd_pistes, 'iso': cmd_iso,
     'copier': cmd_copier, 'inventaire': cmd_inventaire, 'manuel': cmd_manuel}[c](*a)
