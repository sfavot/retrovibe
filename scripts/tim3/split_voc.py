"""Utilitaires du script scripts/tim3-extract.sh (The Incredible Machine 3, voix : docs/tim3/formats.md § 8).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté, tailles et bornes
validées avant toute lecture ou écriture).
Les .VOC de TIM3 sont des archives maison, pas du Creative Voice :
    u16 n ; u32 offset[n] ; entrée : u32 lenSync ; u8 sync[lenSync] ; u32 lenWav ; RIFF WAVE (PCM 8 bits mono 11 025 Hz)
Sous-commandes :
  decouper <dest_wav> <lipsync.json> <archive.VOC>...
      -> écrit chaque entrée non vide en <dest_wav>/<archive en minuscules>/<index sur 3 chiffres>.wav (octets du WAV
         recopiés tels quels) et la synchronisation des lèvres dans <lipsync.json> ;
         affiche "<archive> <entrées> <non vides>" par archive
  inventaire <out> <dossier de l'ISO> <dest_wav> <sortie_md>
      -> écrit l'inventaire Markdown (docs/tim3/files.md)
"""
import base64
import hashlib
import json
import os
import struct
import sys
import wave

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

FREQUENCE = 11025
ARCHIVES = ('GOALS', 'HINT1', 'HINT2', 'HINT3', 'HINT4', 'HINT5', 'HINT6', 'HINT7', 'HELP', 'PROFESOR')
FICHIERS_TELS_QUELS = ('RESOURCE.MAP', 'RESOURCE.001', 'RESOURCE.002', 'FRENCH.DAT', 'TIMWIN.EXE')


def lire(b, fmt, pos, nom):
    taille = struct.calcsize(fmt)
    if pos < 0 or pos + taille > len(b):
        sys.exit('%s : lecture hors fichier à %d' % (nom, pos))
    return struct.unpack_from(fmt, b, pos)


def valider_wav(wav, nom):
    """RIFF WAVE PCM 8 bits mono 11 025 Hz, tailles de chunks cohérentes avec la taille de l'entrée."""
    if len(wav) < 12 or wav[:4] != b'RIFF' or wav[8:12] != b'WAVE':
        sys.exit('%s : pas un RIFF WAVE' % nom)
    if struct.unpack_from('<I', wav, 4)[0] + 8 != len(wav):
        sys.exit('%s : taille RIFF incohérente' % nom)
    pos, fmt, data = 12, None, None
    while pos + 8 <= len(wav):
        cid, cl = struct.unpack_from('<4sI', wav, pos)
        if pos + 8 + cl > len(wav):
            sys.exit('%s : chunk %r hors du WAV' % (nom, cid))
        if cid == b'fmt ':
            fmt = struct.unpack_from('<HHIIHH', wav, pos + 8)
        elif cid == b'data':
            data = cl
        pos += 8 + cl + (cl & 1)
    if fmt is None or data is None or (fmt[0], fmt[1], fmt[2], fmt[5]) != (1, 1, FREQUENCE, 8):
        sys.exit('%s : format inattendu (PCM 8 bits mono %d Hz attendu) : %r' % (nom, FREQUENCE, fmt))


def lire_archive(chemin):
    """Retourne la liste des (sync, wav) de chaque entrée ; wav vaut b'' pour une entrée vide."""
    nom = os.path.basename(chemin)
    b = open(chemin, 'rb').read()
    n, = lire(b, '<H', 0, nom)
    offsets = lire(b, '<%dI' % n, 2, nom)
    if any(offsets[i] >= offsets[i + 1] for i in range(n - 1)) or (n and offsets[0] < 2 + 4 * n):
        sys.exit('%s : table d\'offsets incohérente' % nom)
    entrees = []
    for i, o in enumerate(offsets):
        ls, = lire(b, '<I', o, nom)
        sync = b[o + 4:o + 4 + ls]
        lw, = lire(b, '<I', o + 4 + ls, nom)
        debut = o + 8 + ls
        fin = offsets[i + 1] if i + 1 < n else len(b)
        if len(sync) != ls or debut + lw != fin:
            sys.exit('%s entrée %d : tailles incohérentes (l\'entrée doit finir à l\'offset suivant)' % (nom, i))
        wav = b[debut:fin]
        if lw:
            valider_wav(wav, '%s entrée %d' % (nom, i))
        entrees.append((sync, wav))
    return entrees


def cmd_decouper(dest, lipsync, *archives):
    sync_par_archive = {}
    for chemin in archives:
        nom = os.path.splitext(os.path.basename(chemin))[0].upper()
        if nom not in ARCHIVES:
            sys.exit('Archive inattendue : %s' % chemin)
        minuscules = nom.lower()
        os.makedirs(os.path.join(dest, minuscules), exist_ok=True)
        entrees = lire_archive(chemin)
        non_vides, sync = 0, {}
        for i, (s, wav) in enumerate(entrees):
            if not wav:
                continue  # entrée vide (indice absent) : sautée, l'index des suivantes est conservé
            with open(os.path.join(dest, minuscules, '%03d.wav' % i), 'wb') as f:
                f.write(wav)
            non_vides += 1
            if s:
                sync[str(i)] = base64.b64encode(s).decode('ascii')
        if sync:
            sync_par_archive[minuscules] = sync
        print('%s %d %d' % (minuscules, len(entrees), non_vides))
    # Octets bruts en base64 par entrée : la structure interne n'est pas décodée (formats.md § 8).
    with open(lipsync, 'w', encoding='ascii') as f:
        json.dump(sync_par_archive, f, sort_keys=True, separators=(',', ':'))
        f.write('\n')


def sha(chemin, complet=False):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest() if complet else h.hexdigest()[:16]


def hms(secondes):
    s = int(round(secondes))
    return '%d h %02d min %02d s' % (s // 3600, s % 3600 // 60, s % 60)


def cmd_inventaire(out, iso, dest_wav, sortie):
    fichiers = {rel: c for c, rel in ec.liste_fichiers(out) if rel != 'files.json'}
    voix = {rel: c for rel, c in fichiers.items() if rel.startswith('voices/') and rel.endswith('.mp3')}
    autres = sorted(set(fichiers) - set(voix))
    total = sum(os.path.getsize(c) for c in fichiers.values())
    taille_voix = sum(os.path.getsize(c) for c in voix.values())
    par_archive = []
    duree_totale = 0.0
    for a in ARCHIVES:
        a = a.lower()
        wavs = sorted(os.listdir(os.path.join(dest_wav, a)))
        duree = 0.0
        for w in wavs:
            with wave.open(os.path.join(dest_wav, a, w)) as r:
                duree += r.getnframes() / r.getframerate()
        mp3 = [c for rel, c in voix.items() if rel.startswith('voices/%s/' % a)]
        par_archive.append((a.upper() + '.VOC', len(wavs), sum(os.path.getsize(c) for c in mp3), '%.0f s' % duree))
        duree_totale += duree
    origines = {
        'COVER.png': 'vague J (`scripts/tim3-cover.mts`), conservé d\'une exécution à l\'autre',
        'FRENCH.DAT': '`TIMWIN/FRENCH.DAT` de l\'ISO, tel quel (pack de langue : textes français)',
        'RESOURCE.001': '`TIMWIN/RESOURCE.001` de l\'ISO, tel quel',
        'RESOURCE.002': '`TIMWIN/RESOURCE.002` de l\'ISO, tel quel',
        'RESOURCE.MAP': '`TIMWIN/RESOURCE.MAP` de l\'ISO, tel quel',
        'TIMWIN.EXE': '`TIMWIN/TIMWIN.EXE` de l\'ISO, tel quel (source des tables, non lu à l\'exécution)',
        'voices/lipsync.json': 'octets de synchronisation labiale de chaque entrée, bruts en base64 (voir `formats.md` § 8)',
    }
    lignes = [(n, os.path.getsize(fichiers[n]), '`%s`' % sha(fichiers[n]), origines.get(n, '')) for n in autres]
    lignes.append(('voices/<archive>/<n>.mp3', taille_voix, '', '%d voix, une par entrée non vide des 10 archives `.VOC` ; '
                   'MP3 mono 22 050 Hz, 24 kb/s CBR (`ec_encoder_voix`)' % len(voix)))
    sections = [
        ('Taille', [
            '- Total versionné (`original/tim3/`) : **%s** (%d octets), %d fichiers (hors `files.json`)' % (ec.mo(total), total, len(fichiers)),
            '- Voix (`voices/`, MP3) : %s ; données du jeu : %s' % (ec.mo(taille_voix), ec.mo(total - taille_voix)),
            '- Hors extraction, conservé d\'une exécution à l\'autre : `COVER.png` (vague J, si présent)']),
        ('Fichiers', ec.tableau(['Fichier', 'Octets', 'SHA-256 (16 premiers hex)', 'Origine'], lignes, droite=(1,))),
        ('Voix', ec.tableau(['Archive', 'Voix', 'Octets MP3', 'Durée'], par_archive, droite=(1, 2, 3)) + [
            '',
            '- %d fichiers MP3 (`voices/<archive en minuscules>/<index sur 3 chiffres>.mp3`), %s (%d octets) ; l\'index est celui de l\'entrée dans l\'archive (les entrées vides sont sautées, les autres gardent leur index)' % (len(voix), ec.mo(taille_voix), taille_voix),
            '- Source : PCM 8 bits non signé, mono, %d Hz, soit **%s** (%.0f s)' % (FREQUENCE, hms(duree_totale), duree_totale),
            '- Encodage : `libmp3lame`, 24 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées (`ec_encoder_voix` de `scripts/lib/extract-common.sh`)',
            '- Synchronisation labiale : `voices/lipsync.json`, `{archive: {index: octets bruts en base64}}`, pour les entrées de HELP.VOC et PROFESOR.VOC (seules à en avoir)']),
        ('Contrôles faits à l\'extraction', [
            '- Archive 7z puis ISO extraites dans un dossier temporaire vide ; rien n\'est exécuté.',
            '- Tailles et SHA-256 des cinq fichiers copiés : %s.' % ' ; '.join(
                '`%s` %d octets `%s`' % (n, os.path.getsize(os.path.join(iso, n)), sha(os.path.join(iso, n), True)) for n in FICHIERS_TELS_QUELS),
            '- Archives VOC : table d\'offsets strictement croissante, chaque entrée finit à l\'offset de la suivante (la dernière à la fin du fichier), chaque WAV est un RIFF PCM 8 bits mono %d Hz dont les chunks tiennent dans l\'entrée.' % FREQUENCE]),
        ('Régénérer', ['```', 'bash scripts/tim3-extract.sh [archive.7z]', '```', '',
                       'Archive par défaut : `jeu-00235-incredible_machine_3-pcwin.7z` à la racine, sinon dans `archives/` (non versionnée). Outils requis : `7zz`, `python3`, `ffmpeg` (`libmp3lame`).']),
    ]
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de The Incredible Machine 3', 'scripts/tim3-extract.sh', sections)


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in ('decouper', 'inventaire'):
        sys.exit(__doc__)
    {'decouper': cmd_decouper, 'inventaire': cmd_inventaire}[sys.argv[1]](*sys.argv[2:])
