"""Utilitaires du script scripts/drascula-extract.sh (Drascula: The Vampire Strikes Back, Alcachofa Soft, 1996).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté).
Sous-commandes :
  copier <base> <francais> <dest>      -> copie dans <dest> les fichiers utiles : ceux de <base> (Packet.001), dont les
                                          .ALD, .CAL et QPC.BIN sont remplacés par ceux de <francais> (PACKET.002)
  inventaire <dest> <base> <sortie_md> -> écrit l'inventaire Markdown (appelé aussi par drascula-music.sh)
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

# Extensions gardées de Packet.001 (insensible à la casse). Le reste (EXE, DEV, DRV, COM, CFG, RCT, VOC, EPA, GSAVE*) n'est
# pas porté : il reste dans archives/drascula/base/.
EXT_GARDEES = {'.ALG', '.ALS', '.BIN', '.ALD', '.CAL'}
# Fichiers du pack français qui remplacent ceux de la base (les autres fichiers du pack, des .EXE, sont ignorés).
EXT_FRANCAIS = {'.ALD', '.CAL'}
NOMS_FRANCAIS = {'QPC.BIN'}
ATTENDUS = {'.ALG': 225, '.ALS': 783, '.BIN': 33, '.ALD': 57, '.CAL': 13}

POURQUOI_EXCLUS = [
    ('`*.EXE`, `DRASCULA.COM`', 'exécutables DOS d\'origine (DOS4GW, SETUP, LOGODDM, HACKER*, IGOR, PENDULO, YODA, UNINSTAL) : non versionnés.'),
    ('`*.DEV`, `GHOST.DRV`, `SOUND.CFG`, `SETUP.VOC`, `INFO.RCT`, `SAVES.EPA`', 'pilotes et réglages de l\'exécutable d\'origine, non lus par ScummVM.'),
    ('`GSAVE00` à `GSAVE10`', 'sauvegardes d\'origine (le portage a ses propres sauvegardes).'),
    ('`drascula.doc` (zip de base)', 'manuel Word, non extrait.'),
    ('packs allemand, espagnol, italien (`PACKET.003` à `.005`)', 'extraits dans `archives/drascula/` seulement ; version portée : français.'),
]


def ext(nom):
    return os.path.splitext(nom)[1].upper()


def cmd_copier(base, francais, dest):
    os.makedirs(dest, exist_ok=True)
    nb = {}
    for nom in sorted(os.listdir(base)):
        if ext(nom) not in EXT_GARDEES:
            continue
        shutil.copyfile(os.path.join(base, nom), os.path.join(dest, nom))
        nb[ext(nom)] = nb.get(ext(nom), 0) + 1
    remplaces = 0
    for nom in sorted(os.listdir(francais)):
        if ext(nom) in EXT_FRANCAIS or nom.upper() in NOMS_FRANCAIS:
            if not os.path.exists(os.path.join(dest, nom)):
                sys.exit('Fichier français sans équivalent dans la base : ' + nom)
            shutil.copyfile(os.path.join(francais, nom), os.path.join(dest, nom))
            remplaces += 1
    for e, n in ATTENDUS.items():
        if nb.get(e, 0) != n:
            sys.exit('%s : %d fichiers attendus, %d trouvés' % (e, n, nb.get(e, 0)))
    print('%d fichiers copiés, dont %d remplacés par la version française' % (sum(nb.values()), remplaces))


def cmd_inventaire(dest, base, sortie):
    total, groupes, tailles = 0, {}, {}
    for chemin, rel in ec.liste_fichiers(dest):
        if rel == 'files.json':
            continue
        t = os.path.getsize(chemin)
        total += t
        tailles[rel] = t
        e = ext(rel) or '(sans extension)'
        if rel.lower().startswith('track') and e == '.MP3':
            e = '.mp3 (musique)'
        g = groupes.setdefault(e, [0, 0])
        g[0] += 1
        g[1] += t
    sections = [
        ('Taille', [
            '- Total versionné (`original/drascula/`) : **%s** (%d octets), %d fichiers (hors `files.json`)' % (ec.mo(total), total, len(tailles)),
            '- Musique : %s ; voix et sons `.ALS` : %s ; reste : %s' % (
                ec.mo(groupes.get('.mp3 (musique)', [0, 0])[1]), ec.mo(groupes.get('.ALS', [0, 0])[1]),
                ec.mo(total - groupes.get('.mp3 (musique)', [0, 0])[1] - groupes.get('.ALS', [0, 0])[1])),
            '- Hors extraction, conservés d\'une exécution à l\'autre : `COVER.png` (vague J), `track*.mp3` (`scripts/drascula-music.sh`)']),
        ('Par extension', ec.tableau(['Extension', 'Fichiers', 'Taille'],
                                     [(k, groupes[k][0], ec.mo(groupes[k][1], ko=True)) for k in sorted(groupes)], droite=(1, 2))),
        ('Provenance', ec.tableau(['Fichiers', 'Origine'], [
            ('`*.ALG`, `*.ALS`, `*.BIN` (sauf `QPC.BIN`)', '`Packet.001` (base, voix anglaises) du zip `drascula-1.0.zip`'),
            ('`*.ALD`, `*.CAL`, `QPC.BIN`', '`PACKET.002` (français) de `drascula-int-1.1.zip`, en remplacement de ceux de la base'),
            ('`drascula.dat`, `drascula-dat-LICENSE.txt`', '`archives/drascula.dat` (ScummVM, version 7) ; licence : voir la note'),
            ('`README-ALCACHOFA.txt`, `README-ALCACHOFA-INT.txt`', '`readme.txt` des zips de base et international (licence d\'Alcachofa Soft, à conserver intacte)'),
            ('`track1.mp3` à `track31.mp3`', '`drascula-audio-2.0.zip` (OGG), convertis par `scripts/drascula-music.sh` (MP3 80 kb/s)'),
        ])),
    ]
    if os.path.isdir(base):
        exclus = {}
        for nom in os.listdir(base):
            if ext(nom) not in EXT_GARDEES:
                e = exclus.setdefault(ext(nom) or '(sans extension)', [0, 0])
                e[0] += 1
                e[1] += os.path.getsize(os.path.join(base, nom))
        sections.append(('Fichiers de `Packet.001` exclus (agrégés par extension)', ec.tableau_par_categorie('Extension', exclus)
                         + [''] + ec.pourquoi_exclus(POURQUOI_EXCLUS)))
    sections.append(('Régénérer', ['```', 'bash scripts/drascula-extract.sh', 'bash scripts/drascula-music.sh', '```', '',
                                   'Archives par défaut : `archives/drascula-1.0.zip`, `drascula-int-1.1.zip`, `drascula-audio-2.0.zip`, `drascula.dat` (non versionnées). '
                                   'Outils requis : `bsdtar`, `7zz`, `python3`, `ffmpeg` (musique). Extractions complètes (dont les autres langues) : `archives/drascula/`.']))
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de Drascula', 'scripts/drascula-extract.sh', sections)


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'copier': cmd_copier, 'inventaire': cmd_inventaire}[c](*a)
