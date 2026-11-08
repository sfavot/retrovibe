"""Utilitaires des scripts scripts/fotaq-extract.sh et scripts/fotaq-voices.sh (Flight of the Amazon Queen, version
française parlante, conteneur `queen.1c`, voir docs/fotaq/formats.md § 1).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté, noms validés).
Sous-commandes :
  donnees <queen.1c> <dest>             -> écrit à plat dans <dest> les ressources utiles au jeu (tout sauf les .SB et
                                           les fichiers exclus : EXCLUS)
  voix <queen.1c> <dest>                -> écrit les 6 751 voix et effets `.SB` (OGG Vorbis) dans <dest>
  inventaire <dest> <queen.1c> <sortie_md> -> écrit l'inventaire Markdown (docs/fotaq/files.md)
"""
import os
import re
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

ENTETE = 15
TAILLE_ENTREE = 21
NB_ENTREES = 7671
NB_VOIX = 6751
NOM_VALIDE = re.compile(rb'^[A-Z0-9_]{1,8}\.[A-Z0-9]{1,3}$|^DATA$')

# Ressources de queen.1c non extraites : musique Roland MT-32 des instruments (jamais lue par le moteur, qui charge
# AQ.RL pour le MIDI et AQBANK.MUS pour AdLib).
EXCLUS = {'AQBANK.RL'}

POURQUOI_EXCLUS = [
    ('`*.SB` (6 751)', 'voix et effets en OGG Vorbis : convertis en MP3 dans `voices/` par `scripts/fotaq-voices.sh`.'),
    ('`AQBANK.RL`', 'banque d\'instruments Roland, non lue par le moteur (ScummVM ne charge que `AQ.RL` pour le MT-32).'),
]


def lire_table(chemin):
    """[(nom, offset, taille)] du conteneur, après les contrôles de structure (formats.md § 1)."""
    with open(chemin, 'rb') as f:
        d = f.read()
    if d[:4] != b'QTBL' or d[4:9] != b'CFM10':
        sys.exit('Ce n\'est pas queen.1c en version CFM10')
    n, = struct.unpack('>H', d[0x0d:0x0f])
    if n != NB_ENTREES:
        sys.exit('%d entrées attendues, %d trouvées' % (NB_ENTREES, n))
    table, suivant = [], ENTETE + n * TAILLE_ENTREE
    for i in range(n):
        e = d[ENTETE + i * TAILLE_ENTREE:ENTETE + (i + 1) * TAILLE_ENTREE]
        nom = e[:12].split(b'\0')[0]
        off, taille = struct.unpack('>II', e[13:21])
        if not NOM_VALIDE.match(nom):
            sys.exit('Nom de ressource invalide : %r' % nom)
        if off != suivant:
            sys.exit('%s : ressources non contiguës (offset %d, attendu %d)' % (nom.decode(), off, suivant))
        suivant = off + taille
        table.append((nom.decode(), off, taille))
    if suivant != len(d):
        sys.exit('La dernière ressource finit en %d, le fichier fait %d octets' % (suivant, len(d)))
    if len({t[0] for t in table}) != n:
        sys.exit('Noms de ressources en double')
    return d, table


def ecrire(d, table, dest, garde):
    os.makedirs(dest, exist_ok=True)
    nb = 0
    for nom, off, taille in table:
        if garde(nom):
            with open(os.path.join(dest, nom), 'wb') as f:
                f.write(d[off:off + taille])
            nb += 1
    return nb


def est_voix(nom):
    return nom.endswith('.SB')


def cmd_donnees(queen, dest):
    d, table = lire_table(queen)
    nb = ecrire(d, table, dest, lambda n: not est_voix(n) and n not in EXCLUS)
    attendu = NB_ENTREES - NB_VOIX - len(EXCLUS)
    if nb != attendu:
        sys.exit('%d fichiers de données attendus, %d écrits' % (attendu, nb))
    print('%d fichiers de données écrits' % nb)


def cmd_voix(queen, dest):
    d, table = lire_table(queen)
    nb = ecrire(d, table, dest, est_voix)
    if nb != NB_VOIX:
        sys.exit('%d voix attendues, %d écrites' % (NB_VOIX, nb))
    print('%d voix écrites' % nb)


def cmd_inventaire(dest, queen, sortie):
    _, table = lire_table(queen)
    total, groupes = 0, {}
    for chemin, rel in ec.liste_fichiers(dest):
        if rel == 'files.json':
            continue
        t = os.path.getsize(chemin)
        total += t
        e = 'voices/*.mp3 (voix)' if rel.startswith('voices/') else (os.path.splitext(rel)[1].upper() or 'DATA (sans extension)')
        g = groupes.setdefault(e, [0, 0])
        g[0] += 1
        g[1] += t
    nb = sum(g[0] for g in groupes.values())
    voix = groupes.get('voices/*.mp3 (voix)', [0, 0])[1]
    exclus = {}
    for nom, _, taille in table:
        if est_voix(nom) or nom in EXCLUS:
            e = exclus.setdefault('.SB' if est_voix(nom) else nom, [0, 0])
            e[0] += 1
            e[1] += taille
    sections = [
        ('Taille', [
            '- Total versionné (`original/fotaq/`) : **%s** (%d octets), %d fichiers (hors `files.json`)' % (ec.mo(total), total, nb),
            '- Voix et effets (`voices/`) : %s ; données du jeu : %s' % (ec.mo(voix), ec.mo(total - voix)),
            '- Hors extraction, conservés d\'une exécution à l\'autre : `voices/` (`scripts/fotaq-voices.sh`), `COVER.png` (vague J)']),
        ('Par extension', ec.tableau(['Extension', 'Fichiers', 'Taille'],
                                     [(k, groupes[k][0], ec.mo(groupes[k][1], ko=True)) for k in sorted(groupes)], droite=(1, 2))),
        ('Provenance', ec.tableau(['Fichiers', 'Origine'], [
            ('tous sauf `voices/` et `README-FOTAQ.txt`', '`queen.1c` de `FOTAQ_Fr_Talkie_1.0.zip` (7 671 ressources à plat, noms d\'origine), découpé par `scripts/fotaq/split_queen.py`'),
            ('`voices/<nom>.mp3`', 'ressources `.SB` de `queen.1c` (OGG Vorbis mono 11 840 Hz), converties par `scripts/fotaq-voices.sh` (MP3 mono 22 050 Hz, 24 kb/s CBR)'),
            ('`AQ.RL`, `AQBANK.MUS`', 'musique : MIDI pour le MT-32 (`AQ.RL`, 106 morceaux) et AdLib (`AQBANK.MUS`, 102 morceaux, repli)'),
            ('`README-FOTAQ.txt`', '`readme.txt` du zip (licence de John Passfield et Steven Stamatiadis, à conserver intacte)'),
        ])),
        ('Ressources de `queen.1c` non extraites (agrégées)', ec.tableau_par_categorie('Ressource', exclus)
         + [''] + ec.pourquoi_exclus(POURQUOI_EXCLUS)),
        ('Régénérer', ['```', 'bash scripts/fotaq-extract.sh', 'bash scripts/fotaq-voices.sh', '```', '',
                       'Archive par défaut : `archives/FOTAQ_Fr_Talkie_1.0.zip` (non versionnée). Outils requis : `bsdtar`, `python3`, `ffmpeg` (voix).']),
    ]
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de Flight of the Amazon Queen', 'scripts/fotaq-extract.sh', sections)


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'donnees': cmd_donnees, 'voix': cmd_voix, 'inventaire': cmd_inventaire}[c](*a)
