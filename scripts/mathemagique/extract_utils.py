"""Utilitaires du script scripts/mathemagique-extract.sh (Math Workshop, Broderbund, 1994).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté).
Sous-commandes :
  iso <iso> <dest>                    -> extrait tout l'ISO 9660 (analyse faite ici : 7zz oublie des fichiers)
  copier <cd> <dest> <stats_json>     -> copie dans <dest> les fichiers utiles au jeu (hors vidéos) ; stats JSON
  videos <cd>                         -> liste (un par ligne) les chemins relatifs des QTW/*.MOV à convertir
  inventaire <dest> <cd> <stats> <sortie_md>
"""
import json
import os
import re
import shutil
import struct
import sys

SECTEUR = 2048

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
    ('`QTW/` (QuickTime et `.MOV`)', 'QuickTime pour Windows et vidéos d\'origine ; les vidéos sont gardées converties en `.mp4`.'),
    ('`MPCRSRC/`', 'sauvegardes `.BAK` et doublons.'),
    ('`MWROSTER`', 'modèle de fichier de sauvegarde (liste des élèves).'),
    ('autres fichiers à la racine du CD', 'non utilisés par la réimplémentation.'),
]


def nom_sur(nom):
    if not nom or nom in ('.', '..') or '/' in nom or '\\' in nom or '\0' in nom:
        sys.exit('Nom de fichier ISO refusé : %r' % nom)
    return nom


def cmd_iso(iso, dest):
    taille = os.path.getsize(iso)
    f = open(iso, 'rb')

    def secteurs(n, c):
        f.seek(n * SECTEUR)
        return f.read(SECTEUR * c)

    pvd = secteurs(16, 1)
    if pvd[1:6] != b'CD001':
        sys.exit('Pas un ISO 9660')
    nb = [0]

    def parcourir(lba, ln, cible):
        os.makedirs(cible, exist_ok=True)
        data = secteurs(lba, (ln + SECTEUR - 1) // SECTEUR)
        i = 0
        while i < ln:
            l = data[i]
            if l == 0:
                i = (i // SECTEUR + 1) * SECTEUR
                continue
            r = data[i:i + l]
            i += l
            elba, = struct.unpack('<I', r[2:6])
            el, = struct.unpack('<I', r[10:14])
            nl = r[32]
            brut = r[33:33 + nl]
            if brut in (b'\x00', b'\x01'):
                continue
            nom = nom_sur(brut.decode('latin-1').split(';')[0])
            chemin = os.path.join(cible, nom)
            if r[25] & 2:
                parcourir(elba, el, chemin)
            else:
                if elba * SECTEUR + el > taille:
                    sys.exit('Fichier hors de l\'ISO : %s' % chemin)
                f.seek(elba * SECTEUR)
                with open(chemin, 'wb') as o:
                    restant = el
                    while restant:
                        morceau = f.read(min(restant, 1 << 20))
                        if not morceau:
                            sys.exit('ISO tronqué : %s' % chemin)
                        o.write(morceau)
                        restant -= len(morceau)
                nb[0] += 1

    racine = pvd[156:190]
    elba, = struct.unpack('<I', racine[2:6])
    el, = struct.unpack('<I', racine[10:14])
    parcourir(elba, el, dest)
    print('%d fichiers extraits de l\'ISO' % nb[0])


def liste_fichiers(racine):
    for dossier, _, noms in os.walk(racine):
        for n in sorted(noms):
            c = os.path.join(dossier, n)
            yield c, os.path.relpath(c, racine).replace(os.sep, '/')


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


def cmd_copier(cd, dest, stats_json):
    gardes = []
    for chemin, rel in liste_fichiers(cd):
        if rel.startswith('QTW/') and rel.upper().endswith('.MOV'):
            continue  # converties en mp4 par le script shell
        taille = os.path.getsize(chemin)
        if est_garde(rel):
            cible = os.path.join(dest, rel)
            os.makedirs(os.path.dirname(cible), exist_ok=True)
            shutil.copyfile(chemin, cible)
            gardes.append({'rel': rel, 'taille': taille})
    with open(stats_json, 'w') as o:
        json.dump({'gardes': gardes}, o)


def cmd_videos(cd):
    for _, rel in liste_fichiers(cd):
        if rel.startswith('QTW/') and rel.upper().endswith('.MOV'):
            print(rel)


def mohawk(chemin):
    """Retourne {tag: nombre de ressources} d'une archive Mohawk (MHWK/RSRC), ou None."""
    d = open(chemin, 'rb').read()
    if d[:4] != b'MHWK' or d[8:12] != b'RSRC':
        return None
    absoff, = struct.unpack('>I', d[20:24])
    n, = struct.unpack('>H', d[absoff + 2:absoff + 4])
    types = []
    for i in range(n):
        tag, rto, _ = struct.unpack('>4sHH', d[absoff + 4 + i * 8:absoff + 12 + i * 8])
        c, = struct.unpack('>H', d[absoff + rto:absoff + rto + 2])
        types.append((tag, c))
    return types


def echappe(tag):
    return ''.join(chr(b) if 32 <= b < 127 else '\\x%02x' % b for b in tag)


def mo(n):
    return '%.1f Mo' % (n / 1048576) if n >= 1048576 else '%.1f Ko' % (n / 1024)


def cmd_inventaire(dest, cd, stats_json, sortie):
    gardes = json.load(open(stats_json))['gardes']
    total, par_groupe = 0, {}
    tailles = {}
    for chemin, rel in liste_fichiers(dest):
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
    L = ['# Inventaire des fichiers de Math Workshop (Mathémagique)', '',
         'Généré par `scripts/mathemagique-extract.sh` (ne pas éditer à la main).', '',
         '## Taille', '',
         '- Total versionné (`original/mathemagique/`) : **%s** (%d octets), %d fichiers' % (mo(total), total, len(tailles)),
         '', '## Par groupe de fichiers', '',
         '| Extension | Fichiers | Taille |', '|---|---:|---:|']
    for k in sorted(par_groupe):
        L.append('| %s | %d | %s |' % (k, par_groupe[k][0], mo(par_groupe[k][1])))
    L += ['', '## Archives Mohawk', '',
          'Types de ressources (tag de 4 octets : nombre de ressources). Les octets non imprimables sont échappés.', '']
    mhk = sorted(r for r in tailles if os.path.splitext(r)[1].upper() in ('.DAT', '.MHK'))
    L += ['| Fichier | Taille | Types de ressources |', '|---|---:|---|']
    for rel in mhk:
        types = mohawk(os.path.join(dest, rel))
        if types is None:
            L.append('| `%s` | %s | pas une archive Mohawk |' % (rel, mo(tailles[rel])))
        else:
            L.append('| `%s` | %s | %s |' % (rel, mo(tailles[rel]),
                                           ', '.join('`%s` : %d' % (echappe(t), c) for t, c in types)))
    L.append('')
    L += ['## Gardé uniquement dans `archives/mathemagique/cd/`', '']
    for nom, raison in POURQUOI_EXCLUS:
        L.append('- %s : %s' % (nom, raison))
    L += ['', 'Le CD complet est extrait dans `archives/mathemagique/cd/` (non versionné).', '',
          '## Régénérer', '', '```', 'bash scripts/mathemagique-extract.sh [archive.zip]', '```', '',
          'Archive par défaut : `archives/mathemagique/Math-Workshop_Win_EN_ISO-Version.zip` (non versionnée). '
          'Outils requis : `unzip`, `ffmpeg`, `python3`.', '']
    os.makedirs(os.path.dirname(sortie), exist_ok=True)
    with open(sortie, 'w') as o:
        o.write('\n'.join(L))


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'iso': cmd_iso, 'copier': cmd_copier, 'videos': cmd_videos, 'inventaire': cmd_inventaire}[c](*a)
