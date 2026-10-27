"""Briques communes des scripts d'extraction de CD (scripts/<jeu>-extract.sh).

Module importable : les scripts `python3 -I` ignorent PYTHONPATH et le dossier courant, donc l'appelant ajoute
explicitement `scripts/lib` à sys.path avant `import extract_common`. Les données extraites ne sont pas de
confiance : rien n'en est exécuté, les noms de fichiers sont validés avant toute écriture.
"""
import os
import re
import shutil
import struct
import sys
import wave

SECTEUR_ISO = 2048
SECTEUR = 2352  # secteur brut d'un CD : MODE1/2352 (données) ou CD-DA (audio PCM 16 bits stéréo 44,1 kHz)


def parse_cue(chemin):
    """Retourne {n° de piste: (type, secteur de début de l'INDEX 01)}. Un seul FILE est géré : les secteurs d'un
    CUE multi-fichiers sont relatifs à chaque .bin et ne se comparent pas."""
    pistes, courante, fichiers = {}, None, 0
    for ligne in open(chemin, encoding='latin-1'):
        if re.match(r'\s*FILE\s', ligne):
            fichiers += 1
            continue
        m = re.match(r'\s*TRACK\s+(\d+)\s+(\S+)', ligne)
        if m:
            courante = (int(m.group(1)), m.group(2))
            continue
        m = re.match(r'\s*INDEX\s+01\s+(\d+):(\d+):(\d+)', ligne)
        if m and courante:
            mm, ss, ff = map(int, m.groups())
            pistes[courante[0]] = (courante[1], (mm * 60 + ss) * 75 + ff)
    if fichiers != 1:
        sys.exit('CUE avec %d FILE : un seul .bin est géré (%s)' % (fichiers, chemin))
    return pistes


def secteurs_piste_donnees(pistes):
    """Nombre de secteurs de la piste de données (piste 1) : du secteur 0 à l'INDEX 01 de la première piste audio.
    Le PREGAP de la piste audio n'est pas stocké dans le .bin."""
    audio = sorted(n for n, (t, _) in pistes.items() if t == 'AUDIO')
    if not audio:
        sys.exit('Aucune piste audio dans le CUE')
    return pistes[audio[0]][1]


def bin_vers_iso(binf, iso, nb_secteurs):
    """Secteurs bruts MODE1/2352 -> ISO 2048 (16 octets d'en-tête ignorés), en flux ; s'arrête à la fin du .bin."""
    with open(binf, 'rb') as f, open(iso, 'wb') as o:
        for _ in range(int(nb_secteurs)):
            s = f.read(SECTEUR)
            if len(s) < SECTEUR:
                break
            o.write(s[16:16 + SECTEUR_ISO])


def extraire_pistes_audio(binf, pistes, taille_bin, dest_dir):
    """Écrit chaque piste AUDIO en dest_dir/TrackNN.wav (PCM 16 bits LE, stéréo, 44100 Hz) ; retourne les chemins.
    Une piste va de son INDEX 01 à celui de la piste suivante (ou à la fin du .bin) ; le PREGAP n'est pas stocké
    dans le .bin, donc les secteurs du CUE n'en tiennent pas compte non plus. Lecture et écriture en flux."""
    fin_bin = taille_bin // SECTEUR
    ordre = sorted(pistes)
    os.makedirs(dest_dir, exist_ok=True)
    sorties = []
    with open(binf, 'rb') as f:
        for i, n in enumerate(ordre):
            type_, debut = pistes[n]
            if type_ != 'AUDIO':
                continue
            fin = pistes[ordre[i + 1]][1] if i + 1 < len(ordre) else fin_bin
            if not debut <= fin <= fin_bin:
                sys.exit('Piste %d hors du .bin (secteurs %d-%d sur %d)' % (n, debut, fin, fin_bin))
            chemin = os.path.join(dest_dir, 'Track%02d.wav' % n)
            f.seek(debut * SECTEUR)
            with wave.open(chemin, 'wb') as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(44100)
                for _ in range(fin - debut):
                    s = f.read(SECTEUR)
                    if len(s) < SECTEUR:
                        sys.exit('.bin tronqué dans la piste %d' % n)
                    w.writeframesraw(s)
            sorties.append(chemin)
    return sorties


def nom_sur(nom):
    """Refuse les noms ISO qui sortiraient du dossier de destination (séparateurs, '..', NUL, vide)."""
    if not nom or nom in ('.', '..') or '/' in nom or '\\' in nom or '\0' in nom:
        sys.exit('Nom de fichier ISO refusé : %r' % nom)
    return nom


def extraire_iso(iso, dest):
    """Extrait tout un ISO 9660 (tronc primaire, sans Joliet ni Rock Ridge) dans dest ; retourne le nombre de
    fichiers. Analyseur maison : 7zz oublie des fichiers sur certains ISO, bsdtar et hdiutil en refusent."""
    taille = os.path.getsize(iso)
    f = open(iso, 'rb')

    def secteurs(n, c):
        f.seek(n * SECTEUR_ISO)
        return f.read(SECTEUR_ISO * c)

    pvd = secteurs(16, 1)
    if pvd[1:6] != b'CD001':
        sys.exit('Pas un ISO 9660')
    nb = [0]

    def parcourir(lba, ln, cible):
        os.makedirs(cible, exist_ok=True)
        data = secteurs(lba, (ln + SECTEUR_ISO - 1) // SECTEUR_ISO)
        i = 0
        while i < ln:
            l = data[i]
            if l == 0:
                i = (i // SECTEUR_ISO + 1) * SECTEUR_ISO
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
                if elba * SECTEUR_ISO + el > taille:
                    sys.exit('Fichier hors de l\'ISO : %s' % chemin)
                f.seek(elba * SECTEUR_ISO)
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
    f.close()
    return nb[0]


def mo(n, ko=False):
    """Taille en Mo ; avec `ko`, les tailles inférieures à 1 Mo sont données en Ko."""
    if ko and n < 1048576:
        return '%.1f Ko' % (n / 1024)
    return '%.1f Mo' % (n / 1048576)


def mohawk_types(chemin):
    """[(tag, nombre de ressources)] d'une archive Mohawk (MHWK/RSRC, Broderbund), ou None si ce n'en est pas une."""
    with open(chemin, 'rb') as f:
        d = f.read()
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


def echappe_tag(tag):
    """Tag de 4 octets lisible : les octets non imprimables sont échappés (`\\x00SND`)."""
    return ''.join(chr(b) if 32 <= b < 127 else '\\x%02x' % b for b in tag)


def liste_fichiers(racine):
    """Génère (chemin absolu, chemin relatif à '/') de tous les fichiers sous racine, triés par dossier."""
    for dossier, _, noms in os.walk(racine):
        for n in sorted(noms):
            c = os.path.join(dossier, n)
            yield c, os.path.relpath(c, racine).replace(os.sep, '/')


def taille_dossier(racine):
    return sum(os.path.getsize(c) for c, _ in liste_fichiers(racine))


def copier_filtre(source, dest, classer, sous_dossier=''):
    """Copie dans dest/<sous_dossier>/ les fichiers de source retenus par classer(chemin, rel, nom) -> (catégorie,
    gardé). Retourne (gardes, exclus) : gardes = [{'rel', 'cat', 'taille'}], exclus = {catégorie: [nombre, octets]}.
    `rel` est relatif à source, avec le séparateur de l'OS."""
    gardes, exclus = [], {}
    for dossier, _, fichiers in os.walk(source):
        for nom in sorted(fichiers):
            chemin = os.path.join(dossier, nom)
            rel = os.path.relpath(chemin, source)
            taille = os.path.getsize(chemin)
            categorie, garde = classer(chemin, rel, nom)
            if garde:
                cible = os.path.join(dest, sous_dossier, rel)
                os.makedirs(os.path.dirname(cible), exist_ok=True)
                shutil.copyfile(chemin, cible)
                gardes.append({'rel': rel, 'cat': categorie, 'taille': taille})
            else:
                e = exclus.setdefault(categorie, [0, 0])
                e[0] += 1
                e[1] += taille
    return gardes, exclus


def tableau(entetes, lignes, droite=()):
    """Tableau Markdown ; `droite` : indices des colonnes alignées à droite (nombres, tailles)."""
    L = ['| ' + ' | '.join(entetes) + ' |',
         '|' + '|'.join('---:' if i in droite else '---' for i in range(len(entetes))) + '|']
    L += ['| ' + ' | '.join(str(c) for c in ligne) + ' |' for ligne in lignes]
    return L


def tableau_par_categorie(titre_col, agreges):
    """Tableau « catégorie | fichiers | taille » depuis {catégorie: [nombre, octets]}, trié par catégorie."""
    return tableau([titre_col, 'Fichiers', 'Taille'],
                   [(k, agreges[k][0], mo(agreges[k][1])) for k in sorted(agreges)], droite=(1, 2))


def agreger_gardes(gardes, cle='cat'):
    """{valeur de gardes[i][cle]: [nombre, octets]} pour les fichiers gardés."""
    res = {}
    for g in gardes:
        e = res.setdefault(g[cle], [0, 0])
        e[0] += 1
        e[1] += g['taille']
    return res


def pourquoi_exclus(raisons):
    """Liste Markdown « pourquoi exclus » depuis [(motif Markdown, explication)]."""
    return ['- %s : %s' % (motif, expl) for motif, expl in raisons]


def rendre_inventaire(sortie, titre, script, sections):
    """Écrit l'inventaire Markdown (files.md) : titre, mention « généré par », puis chaque section
    (titre, lignes Markdown) sous un `## `. Les sections vont typiquement : taille, tableau des fichiers gardés,
    exclus / pourquoi, régénération."""
    L = ['# ' + titre, '', 'Généré par `%s` (ne pas éditer à la main).' % script, '']
    for t, lignes in sections:
        L += ['## ' + t, ''] + list(lignes) + ['']
    os.makedirs(os.path.dirname(sortie), exist_ok=True)
    with open(sortie, 'w') as o:
        o.write('\n'.join(L))
