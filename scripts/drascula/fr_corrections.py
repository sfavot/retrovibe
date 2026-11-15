#!/usr/bin/env python3
"""Corrige les textes français de Drascula (orthographe, grammaire, typographie, accents) dans les fichiers extraits.

Usage : fr_corrections.py <dossier> <corrections.tsv>

Chaque ligne du TSV (UTF-8) : fichier, clé, texte d'origine, texte corrigé, séparés par des tabulations.
  - `drascula.dat` : clé `section[index]` (ex. `text[54]`), bloc français (langue 3) ;
  - `OP_<n>.CAL`   : clé `0` à `3`, numéro du choix (espaces codées par `º`, comme dans le fichier) ;
  - `<n>.ALD`      : clé `*`, nom d'objet (premier mot d'une ligne), remplacé à chaque occurrence.
Le texte d'origine doit être exactement celui du fichier : sinon le script échoue, ce qui protège d'une mise à jour
des archives. Dans `drascula.dat`, `º` (octet 167) s'affiche comme une espace mais ne coupe pas la ligne : il sert
d'espace insécable avant `! ? : ;`. Les caractères sans glyphe dans la police du jeu sont refusés.
"""
import csv
import os
import struct
import sys

SECTIONS = ['text', 'textd', 'textb', 'textbj', 'texte', 'texti', 'textl', 'textp', 'textt', 'textvb', 'textsys',
            'texthis', 'textverbs', 'textmisc', 'textd1']
FRANCAIS = 3
ALIGNEMENT = 4
# Caractères qui ont un glyphe (tables de caractères de drascula.dat, hors cyrillique).
GLYPHES = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 º.,-?¿"!¡;><$%:&/()*+\'ñÑ'
              'áéíóúàèìòùâêîôûçÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÇ')


def erreur(message):
    sys.exit(f'fr_corrections : {message}')


def verifier_glyphes(fichier, cle, texte):
    absents = sorted(set(texte) - GLYPHES)
    if absents:
        erreur(f'{fichier} {cle} : caractères sans glyphe {absents!r} dans « {texte} »')


def lire_corrections(chemin):
    par_fichier = {}
    with open(chemin, encoding='utf-8', newline='') as f:
        for n, ligne in enumerate(csv.reader(f, delimiter='\t', quoting=csv.QUOTE_NONE), 1):
            if not ligne or ligne[0].startswith('#'):
                continue
            if len(ligne) != 4:
                erreur(f'{chemin}:{n} : 4 colonnes attendues, {len(ligne)} lues')
            fichier, cle, avant, apres = ligne
            if avant == apres:
                erreur(f'{chemin}:{n} : correction sans effet')
            verifier_glyphes(fichier, cle, apres)
            corrections = par_fichier.setdefault(fichier, {})
            if cle != '*' and cle in corrections:
                erreur(f'{chemin}:{n} : {fichier} {cle} corrigé deux fois')
            corrections[cle if cle != '*' else f'*{avant}'] = (avant, apres)
    return par_fichier


def corriger_dat(chemin, corrections):
    data = open(chemin, 'rb').read()
    pos = 9 + 8
    tailles = struct.unpack_from('>4H', data, 9)
    pos += 4 * sum(tailles)
    # Listes avant les textes : taille d'un élément en octets (points, entiers, mises à jour, actions, séquences).
    for taille in (4, 4, 2, 4, 2, 4, 2, 2, 20, 20, 10, 8):
        (compte,) = struct.unpack_from('>H', data, pos)
        pos += 2 + compte * taille
    (langues,) = struct.unpack_from('>H', data, pos)
    pos += 2
    sortie = bytearray(data[:pos])
    restantes = dict(corrections)
    for section in SECTIONS:
        (compte,) = struct.unpack_from('>H', data, pos)
        sortie += data[pos:pos + 2]
        pos += 2
        for langue in range(langues):
            (longueur,) = struct.unpack_from('>H', data, pos)
            bloc = data[pos + 2:pos + 2 + longueur]
            pos += 2 + longueur
            if langue == FRANCAIS:
                bloc = corriger_bloc(bloc, compte, section, restantes)
            if len(bloc) > 0xFFFF:
                erreur(f'drascula.dat : bloc {section} trop long')
            sortie += struct.pack('>H', len(bloc)) + bloc
    if pos != len(data):
        erreur('drascula.dat : reste après les textes')
    if restantes:
        erreur(f'drascula.dat : clés inconnues {sorted(restantes)}')
    open(chemin, 'wb').write(bytes(sortie))


def corriger_bloc(bloc, compte, section, restantes):
    lignes = []
    pos = ALIGNEMENT - 2
    for i in range(compte):
        (total,) = struct.unpack_from('>H', bloc, pos)
        corps = bloc[pos + 2:pos + total]
        lignes.append(corps[:corps.index(0)])
        pos += total
    if pos != len(bloc):
        erreur(f'drascula.dat : bloc {section} mal formé')
    sortie = bytearray(bloc[:ALIGNEMENT - 2])
    for i, ligne in enumerate(lignes):
        cle = f'{section}[{i}]'
        if cle in restantes:
            avant, apres = restantes.pop(cle)
            if ligne.decode('cp850') != avant:
                erreur(f'drascula.dat {cle} : lu « {ligne.decode("cp850")} », attendu « {avant} »')
            ligne = apres.encode('cp850')
        utile = len(ligne) + 1 + 2
        total = utile + ALIGNEMENT - utile % ALIGNEMENT
        sortie += struct.pack('>H', total) + ligne + bytes(total - 2 - len(ligne))
    return bytes(sortie)


def lire_texte(chemin):
    return bytes(b ^ 0xFF for b in open(chemin, 'rb').read()).decode('cp850')


def ecrire_texte(chemin, texte):
    open(chemin, 'wb').write(bytes(b ^ 0xFF for b in texte.encode('cp850')))


def corriger_cal(chemin, corrections):
    texte = lire_texte(chemin)
    lignes = texte.split('\n')
    # Les quatre choix sont les quatre premières lignes non vides (premier mot, espaces codées par `º`).
    choix = [i for i, l in enumerate(lignes) if l.replace('\r', '').strip()][:4]
    for cle, (avant, apres) in corrections.items():
        if cle not in ('0', '1', '2', '3'):
            erreur(f'{chemin} : clé {cle} invalide')
        i = choix[int(cle)]
        ligne = lignes[i]
        mot = ligne.replace('\r', '').strip().split()[0]
        if mot.replace('º', ' ') != avant:
            erreur(f'{os.path.basename(chemin)} {cle} : lu « {mot} », attendu « {avant} »')
        lignes[i] = ligne.replace(mot, apres.replace(' ', 'º'), 1)
    ecrire_texte(chemin, '\n'.join(lignes))


def corriger_ald(chemin, corrections):
    lignes = lire_texte(chemin).split('\n')
    for avant, apres in corrections.values():
        trouve = 0
        for i, ligne in enumerate(lignes):
            mots = ligne.replace('\r', '').strip().split()
            if mots and mots[0] == avant:
                lignes[i] = ligne.replace(avant, apres, 1)
                trouve += 1
        if not trouve:
            erreur(f'{os.path.basename(chemin)} : nom « {avant} » absent')
    ecrire_texte(chemin, '\n'.join(lignes))


def main(dossier, tsv):
    for fichier, corrections in sorted(lire_corrections(tsv).items()):
        chemin = os.path.join(dossier, fichier)
        if not os.path.isfile(chemin):
            erreur(f'{fichier} absent de {dossier}')
        if fichier == 'drascula.dat':
            corriger_dat(chemin, corrections)
        elif fichier.upper().endswith('.CAL'):
            corriger_cal(chemin, corrections)
        elif fichier.upper().endswith('.ALD'):
            corriger_ald(chemin, corrections)
        else:
            erreur(f'{fichier} : type de fichier non pris en charge')
        print(f'{fichier} : {len(corrections)} correction(s)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        erreur('usage : fr_corrections.py <dossier> <corrections.tsv>')
    main(sys.argv[1], sys.argv[2])
