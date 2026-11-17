"""Utilitaires du script scripts/asterix-extract.sh (Astérix : le défi de César, CD DOS français).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance, rien n'en est exécuté, les noms de fichiers
sont validés avant toute écriture. Formats : docs/asterix/formats.md.
Sous-commandes :
  convertir <dossier Asterix/> <dest> <pcm> <stats.json>
      copie les fichiers gardés tels quels dans <dest>, convertit les MUX et les MUK en conteneurs `.vid`
      (scripts/asterix/video.py), écrit le son des VOC et des MUX en PCM brut dans <pcm>/<fréquence>/<module>/<nom>.u8
      (encodé ensuite en MP3 par le script), et l'index <dest>/audio.json
  inventaire <dest> <stats.json> <sortie_md>

audio.json : {"MDF/<module>/<nom d'origine>.mp3": [échantillons, fréquence en Hz]}, trié (`ecrire_index_audio` de
scripts/lib/extract_common.py). Les échantillons sont ceux du PCM d'origine (8 bits non signé, mono), avant l'encodage :
durée exacte = échantillons / fréquence. La fréquence d'un VOC est `round(1 000 000 / (256 − constante de temps))`,
comme la lit le moteur (`lire_voc`, même module) ; celle d'un MUX vient de son en-tête.
"""
import hashlib
import json
import multiprocessing
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_common as ec  # noqa: E402
import video  # noqa: E402

SHA256_EXE = 'af731d03133d0a96f036305fbb14049eca475db0ef31d8411c606a3e45c554d9'  # ASTERIX.EXE « Version 2.5 », 30/05/1995
TELS_QUELS = {'.MCG', '.MCC', '.HY8', '.PFN', '.PAL', '.TXT', '.DAT'}
# Nombres de fichiers du CD français (docs/asterix/files.md) : tout écart arrête l'extraction.
ATTENDUS = {'.MUX': 117, '.VOC': 736, '.MUK': 31, '.MCG': 106, '.MCC': 80, '.HY8': 30, '.TXT': 9, '.PFN': 4,
            '.DAT': 1, '.PAL': 1}
NOM = re.compile(r'^[A-Z0-9_]{1,8}\.[A-Z0-9]{1,3}$')
MODULE = re.compile(r'^[0-9]{2}$')


def ecrire(chemin, donnees):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin, 'wb') as o:
        o.write(donnees)


def tache_video(args):
    """Convertit un MUX ou un MUK (processus fils) ; retourne (rel, infos)."""
    source, rel, dest, pcm = args
    with open(source, 'rb') as f:
        b = f.read()
    h = hashlib.sha1()
    try:
        if rel.endswith('.MUK'):
            conteneur, infos = video.convertir_muk(b, h)
            son = b''
        else:
            conteneur, son, infos = video.convertir_mux(b, h)
        # Aller-retour : le conteneur relu redonne exactement les images décodées.
        relu = hashlib.sha1()
        nb = 0
        for _, _, _, pixels in video.lire(conteneur):
            relu.update(pixels)
            nb += 1
        if nb != infos['images'] or relu.digest() != h.digest():
            raise video.Erreur('le conteneur relu diffère des images décodées')
    except video.Erreur as e:
        return rel, {'erreur': str(e)}
    ecrire(os.path.join(dest, 'MDF', rel + '.vid'), conteneur)
    if son:
        ec.ecrire_pcm(pcm, infos['frequence'], rel, son)
    infos.update(origine=len(b), conteneur=len(conteneur), son=len(son), sha1=h.hexdigest())
    return rel, infos


def cmd_convertir(source, dest, pcm, stats_json):
    exe = os.path.join(source, 'ASTERIX.EXE')
    with open(exe, 'rb') as f:
        if hashlib.sha256(f.read()).hexdigest() != SHA256_EXE:
            sys.exit('ASTERIX.EXE : SHA-256 inattendu (autre version du jeu ?)')
    os.makedirs(dest)
    shutil.copyfile(exe, os.path.join(dest, 'ASTERIX.EXE'))

    mdf = os.path.join(source, 'MDF')
    origine = {}   # extension -> [nombre, octets] des fichiers d'origine repris
    exclus = {}    # catégorie -> [nombre, octets]
    index = {}     # audio.json
    videos = []
    for module in sorted(os.listdir(mdf)):
        dossier = os.path.join(mdf, module)
        if os.path.islink(dossier):
            sys.exit('Lien symbolique refusé : MDF/%s' % module)
        if not os.path.isdir(dossier):
            if module != 'LISEZMOI.TXT':
                sys.exit('Fichier inattendu : MDF/%s' % module)
            continue  # compté plus bas avec les fichiers exclus
        if not MODULE.match(module):
            sys.exit('Dossier de module inattendu : MDF/%s' % module)
        for nom in sorted(os.listdir(dossier)):
            chemin = os.path.join(dossier, nom)
            if os.path.islink(chemin) or not os.path.isfile(chemin) or not NOM.match(nom):
                sys.exit('Fichier inattendu : MDF/%s/%r' % (module, nom))
            rel = module + '/' + nom
            ext = os.path.splitext(nom)[1]
            if ext not in ATTENDUS:
                sys.exit('Extension inattendue : MDF/%s' % rel)
            o = origine.setdefault(ext, [0, 0])
            o[0] += 1
            o[1] += os.path.getsize(chemin)
            if ext in TELS_QUELS:
                cible = os.path.join(dest, 'MDF', module, nom)
                os.makedirs(os.path.dirname(cible), exist_ok=True)
                shutil.copyfile(chemin, cible)
            elif ext == '.VOC':
                with open(chemin, 'rb') as f:
                    son, frequence = ec.lire_voc(f.read(), 'MDF/' + rel)
                ec.ecrire_pcm(pcm, frequence, rel, son)
                index['MDF/%s.mp3' % rel] = [len(son), frequence]
            else:
                videos.append((chemin, rel, dest, pcm))
    for ext, n in ATTENDUS.items():
        if origine.get(ext, [0])[0] != n:
            sys.exit('%d fichiers %s attendus, %d trouvés' % (n, ext, origine.get(ext, [0])[0]))

    # Vidéos : un fichier par tâche, les plus gros d'abord ; le résultat ne dépend pas de la répartition.
    videos.sort(key=lambda v: (-os.path.getsize(v[0]), v[1]))
    infos_videos = {}
    with multiprocessing.Pool() as pool:
        for rel, infos in pool.imap_unordered(tache_video, videos, 1):
            if 'erreur' in infos:
                sys.exit('MDF/%s : %s' % (rel, infos['erreur']))
            infos_videos[rel] = infos
            if infos['son']:
                index['MDF/%s.mp3' % rel] = [infos['son'], infos['frequence']]

    for c, rel in ec.liste_fichiers(source):
        if rel == 'ASTERIX.EXE' or re.match(r'MDF/[0-9]{2}/', rel):
            continue
        cat = '`OUTLINE/` (installeur d\'un émulateur Minitel, sans rapport avec le jeu)' if rel.startswith('OUTLINE/') \
            else '`LISEZMOI.EXE` et `MDF/LISEZMOI.TXT` (aide au dépannage sous DOS)'
        e = exclus.setdefault(cat, [0, 0])
        e[0] += 1
        e[1] += os.path.getsize(c)

    ec.ecrire_index_audio(dest, index)
    with open(stats_json, 'w') as o:
        json.dump({'origine': origine, 'exclus': exclus, 'videos': infos_videos, 'index': index}, o, sort_keys=True)
    print(len(index))


def cmd_inventaire(dest, stats_json, sortie):
    with open(stats_json) as f:
        st = json.load(f)
    mo = ec.mo
    tailles = {rel: os.path.getsize(c) for c, rel in ec.liste_fichiers(dest) if rel != 'files.json'}
    total = sum(tailles.values())

    def lot(suffixe):
        rels = [r for r in tailles if r.endswith(suffixe)]
        return len(rels), sum(tailles[r] for r in rels)

    origine, videos, index = st['origine'], st['videos'], st['index']
    son_mux = sum(v['son'] for v in videos.values())
    octets_mux = origine['.MUX'][1]
    lignes = []
    for ext, libelle in (('.VOC', 'voix, musiques et bruitages'), ('.MUX', 'vidéos'), ('.MUK', 'animations')):
        n, o = origine[ext]
        if ext == '.VOC':
            c = lot('.VOC.mp3')
            lignes.append(('`*.VOC` : ' + libelle, n, mo(o), '`*.VOC.mp3` : %d fichiers, %s' % (c[0], mo(c[1]))))
        elif ext == '.MUX':
            v, a = lot('.MUX.vid'), lot('.MUX.mp3')
            lignes.append(('`*.MUX` : %s (image %s, son %s)' % (libelle, mo(octets_mux - son_mux), mo(son_mux)), n, mo(o),
                           '`*.MUX.vid` : %d fichiers, %s ; `*.MUX.mp3` : %d fichiers, %s' % (v[0], mo(v[1]), a[0], mo(a[1]))))
        else:
            v = lot('.MUK.vid')
            lignes.append(('`*.MUK` : ' + libelle, n, mo(o), '`*.MUK.vid` : %d fichiers, %s' % (v[0], mo(v[1]))))
    for ext in sorted(TELS_QUELS):
        n, o = origine[ext]
        lignes.append(('`*%s`' % ext, n, mo(o, ko=True), 'tels quels'))
    lignes.append(('`ASTERIX.EXE`', 1, mo(tailles['ASTERIX.EXE'], ko=True), 'tel quel (lu pour ses tables, jamais exécuté)'))

    images = sum(v['images'] for v in videos.values())
    duree_voc = sum(n / f for rel, (n, f) in index.items() if rel.endswith('.VOC.mp3'))
    duree_mux = sum(n / f for rel, (n, f) in index.items() if rel.endswith('.MUX.mp3'))
    muets = sorted('`%s`' % rel for rel, v in videos.items() if rel.endswith('.MUX') and not v['son'])
    vides = sorted('`%s` (%d)' % (rel, v['vides']) for rel, v in videos.items() if v.get('vides'))
    par_module = {}
    for rel, t in tailles.items():
        m = re.match(r'MDF/(\d\d)/', rel)
        if m:
            e = par_module.setdefault(m.group(1), [0, 0])
            e[0] += 1
            e[1] += t
    autres = sorted(r for r in tailles if not r.startswith('MDF/') and r != 'ASTERIX.EXE')
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers d\'Astérix : le défi de César', 'scripts/asterix-extract.sh', [
        ('Taille', [
            '- Total versionné (`original/asterix/`) : **%s** (%d octets), %d fichiers (hors `files.json`)'
            % (mo(total), total, len(tailles)),
            '- Fichiers d\'origine repris : %s' % mo(sum(o for _, o in origine.values()) + tailles['ASTERIX.EXE']),
            '- Hors `MDF/` : %s' % ', '.join('`%s` (%s)' % (r, mo(tailles[r], ko=True)) for r in autres),
            '- `COVER.webp` (jaquette) ne vient pas de l\'archive : conservé d\'une exécution à l\'autre s\'il existe.']),
        ('Par lot', ec.tableau(['Origine', 'Fichiers', 'Taille d\'origine', 'Versionné'], lignes, droite=(1, 2))),
        ('Son', [
            '- `*.VOC.mp3` et `*.MUX.mp3` : MP3 mono 22 050 Hz, 32 kb/s CBR, sans métadonnées (`ec_encoder_voix` de '
            '`scripts/lib/extract-common.sh`), à partir du PCM 8 bits non signé d\'origine.',
            '- `audio.json` : `{"MDF/<module>/<nom>.mp3": [échantillons, fréquence]}`, %d entrées : nombre '
            'd\'échantillons et fréquence du PCM d\'origine, avant l\'encodage (durée exacte = échantillons / fréquence).'
            % len(index),
            '- Durée : VOC %d min %02d s, son des MUX %d min %02d s.'
            % (duree_voc // 60, duree_voc % 60, duree_mux // 60, duree_mux % 60),
            '- MUX sans son (pas de MP3) : %s.' % (', '.join(muets) or 'aucun')]),
        ('Vidéo', [
            '- `*.MUX.vid` et `*.MUK.vid` : conteneur maison sans perte, compressé en LZMA (voir `docs/asterix/formats.md`) ; '
            '%d images au total.' % images,
            '- Chaque conteneur est relu après écriture : ses images sont identiques, pixel à pixel, à celles décodées '
            'du fichier d\'origine.',
            '- Blocs de fin d\'image vides ignorés (remplissage) : %s.' % (', '.join(vides) or 'aucun')]),
        ('Par module', ec.tableau(['Module', 'Fichiers', 'Taille'],
                                  [('`MDF/%s`' % m, n, mo(t, ko=True)) for m, (n, t) in sorted(par_module.items())],
                                  droite=(1, 2))),
        ('Fichiers exclus', ec.tableau_par_categorie('Catégorie', st['exclus']) + [
            '', 'L\'archive contient aussi `Lisez-Moi.txt` (Abandonware France), hors du dossier `Asterix/` : non repris.']),
        ('Régénérer', ['```', 'bash scripts/asterix-extract.sh [archive.7z]', '```', '',
                       'Archive par défaut : `archives/asterix/jeu-00700-asterix_defi_de_cesar-pcdos.7z` (non versionnée). '
                       'Outils requis : `7zz`, `python3` (module `lzma`), `ffmpeg` (libmp3lame). Le résultat est le même '
                       'à chaque exécution, avec les mêmes versions de `ffmpeg` et de liblzma.']),
    ])


if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'convertir': cmd_convertir, 'inventaire': cmd_inventaire}[c](*a)
