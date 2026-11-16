"""Utilitaires du script scripts/gk1-extract.sh (Gabriel Knight: Sins of the Fathers, CD français, Sierra SCI2).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté, tailles et bornes
validées avant toute lecture ou écriture, noms de fichiers de sortie construits à partir de nombres seulement).

Formats lus (tout en petit-boutiste) :
  RESOURCE.MAP   répertoire de types (u8 type, u16 offset ; fin : type 0xFF), puis entrées de 6 octets
                 (u16 numéro, u32 offset dans RESOURCE.000).
  RESOURCE.000   en-tête de 13 octets par ressource : u8 type, u16 numéro, u32 taille compressée, u32 taille
                 décompressée, u16 méthode (0 = brut, 32 = LZS/STACpack).
  map 65535      (type 0x90) entrées de 5 octets : u16 numéro, u24 delta cumulatif d'offset dans RESOURCE.SFX ;
                 fin : numéro 0xFFFF. Chaque ressource de RESOURCE.SFX est un RIFF WAVE.
  maps audio36   (type 0x90, numéro = module = numéro de la ressource message) : u32 offset de base dans
                 AUD/RESOURCE.AUD, puis entrées u8 noun, u8 verb, u8 cond, u8 seq, u24 delta cumulatif ; si seq & 0x80,
                 un u16 suit : taille du bloc de synchronisation labiale placé avant l'audio. Fin : 0xFF.
  audio SOL      0x8D, u8 taille d'en-tête (11 ou 12), "SOL\\0", u16 fréquence, u8 drapeaux, u32 taille des données.
                 Drapeaux 0 = PCM 8 bits non signé ; 1 = DPCM 8 bits (4 bits par échantillon, voir dpcm8).
  sync           0x8E, 0x00, puis des paires (u16 tick, u16 pose de bouche) terminées par un tick 0xFFFF.
  patchs AUD/    nom en base 36 : préfixe `@` (audio) ou `#` (sync), module (3 caractères), noun (2), verb (2), `.`,
                 cond (2), seq (1). Un patch remplace ou complète le clip de RESOURCE.AUD de même clé.

Sous-commandes :
  iso <GabK.iso> <dest>
      -> extrait l'ISO 9660 (analyseur de scripts/lib/extract_common.py)
  voix <cd> <dest_pcm> <out>
      -> écrit chaque clip de voix en <dest_pcm>/<module>/<noun>-<verb>-<cond>-<seq>.u8 (PCM 8 bits non signé mono
         22 050 Hz, DPCM décodé), les durées en <out>/voices/<module>/index.json et la synchronisation labiale en
         <out>/voices/<module>/sync.json ; affiche le nombre de clips écrits
  bruitages <cd> <dest_wav> <index.json>
      -> écrit chaque bruitage numérique en <dest_wav>/<numéro>.wav (RIFF recopié tel quel : ressources de
         RESOURCE.SFX, puis SFX/*.WAV qui gagne en cas de conflit) et leurs durées dans <index.json> ; affiche le
         nombre de fichiers écrits
  inventaire <out> <cd> <dest_pcm> <dest_wav> <sortie_md>
      -> écrit l'inventaire Markdown (docs/gk1/files.md)

sync.json : `{"<noun>-<verb>-<cond>-<seq>": [tick, pose, tick, pose, ...]}`, les paires u16 du bloc de synchronisation
dans l'ordre, sans l'en-tête de 2 octets ni le tick final 0xFFFF. Un tick vaut 1/60 s depuis le début du clip. Les
octets qui suivent le terminateur dans les patchs `#` (restes de l'outil de Sierra, après la fin des données) ne sont
pas repris. Le seq des noms de fichiers et des clés est sans le drapeau 0x80.

index.json (durées exactes, mesurées sur le PCM source avant l'encodage MP3, qui ajoute du silence) :
`voices/<module>/index.json` = `{"<noun>-<verb>-<cond>-<seq>": échantillons}` pour chaque clip du module, et
`audio/index.json` = `{"<numéro>": échantillons}` pour chaque bruitage. Tout est mono à 22 050 Hz : la durée vaut
échantillons / 22050 s. En ticks de 1/60 s, ScummVM (Audio32::play, valeur rendue à DoAudio) arrondit ainsi :
ms = floor(échantillons * 1000 / 22050) puis ticks = 1 + floor(ms * 60 / 1000) ; ce calcul est laissé au lecteur.
"""
import hashlib
import itertools
import json
import multiprocessing
import os
import re
import struct
import sys
import wave

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

FREQUENCE = 22050
TYPE_MAP = 0x90
MAP_SFX = 65535
# Valeurs du CD français (« 1.000.000 Gabriel Knight French CD May 3, 1994 »).
NB_CLIPS_MAPS = 7469
NB_CLIPS_SYNC = 1777
NB_MAPS_AUDIO36 = 73
NB_ENTREES_SFX = 186
NB_WAV_SFX = 46
NB_PATCHS_AUDIO = 21
NB_PATCHS_SYNC = 10
PATCH_RE = re.compile(r'^([@#])([0-9A-Z]{3})([0-9A-Z]{2})([0-9A-Z]{2})\.([0-9A-Z]{2})([0-9A-Z])$')


def lire(b, fmt, pos, nom):
    taille = struct.calcsize(fmt)
    if pos < 0 or pos + taille > len(b):
        sys.exit('%s : lecture hors fichier à %d' % (nom, pos))
    return struct.unpack_from(fmt, b, pos)


def u24(b, pos, nom):
    if pos + 3 > len(b):
        sys.exit('%s : lecture hors fichier à %d' % (nom, pos))
    return b[pos] | b[pos + 1] << 8 | b[pos + 2] << 16


# --- Volume de ressources -------------------------------------------------------------------------------------------

def lire_map(chemin):
    """Retourne {(type, numéro): offset dans le volume} ; en cas de doublon, la première entrée gagne."""
    m = open(chemin, 'rb').read()
    types, i = [], 0
    while True:
        t, o = lire(m, '<BH', i, 'RESOURCE.MAP')
        types.append((t, o))
        i += 3
        if t == 0xFF:
            break
    entrees = {}
    for k in range(len(types) - 1):
        t, debut = types[k]
        fin = types[k + 1][1]
        if not i + 4 <= debut <= fin <= len(m) or (fin - debut) % 6:
            sys.exit('RESOURCE.MAP : répertoire de types incohérent')
        for p in range(debut, fin, 6):
            n, off = struct.unpack_from('<HI', m, p)
            entrees.setdefault((t, n), off)
    return entrees


def lzs(src, taille):
    """Décompression LZS/STACpack (méthode 32 de SCI32)."""
    out = bytearray()
    pos = bits = nb = 0

    def lire_bits(n):
        nonlocal pos, bits, nb
        while nb < n:
            if pos >= len(src):
                sys.exit('LZS : flux tronqué')
            bits = (bits << 8) | src[pos]
            pos += 1
            nb += 8
        nb -= n
        v = (bits >> nb) & ((1 << n) - 1)
        bits &= (1 << nb) - 1
        return v

    def longueur():
        v = lire_bits(2)
        if v < 3:
            return v + 2
        v = lire_bits(2)
        if v < 3:
            return v + 5
        l = 8
        while True:
            x = lire_bits(4)
            l += x
            if x != 15:
                return l

    while len(out) < taille:
        if lire_bits(1):
            if lire_bits(1):
                recul = lire_bits(7)
                if recul == 0:
                    break
            else:
                recul = lire_bits(11)
            l = longueur()
            s = len(out) - recul
            if s < 0:
                sys.exit('LZS : recul hors du tampon')
            for k in range(l):
                out.append(out[s + k])
        else:
            out.append(lire_bits(8))
    if len(out) != taille:
        sys.exit('LZS : %d octets décompressés, %d attendus' % (len(out), taille))
    return bytes(out)


def charger(vol, entrees, type_, numero):
    off = entrees[(type_, numero)]
    t, n, compresse, taille, methode = lire(vol, '<BHIIH', off, 'RESOURCE.000')
    if (t | 0x80, n) != (type_, numero) or off + 13 + compresse > len(vol):
        sys.exit('RESOURCE.000 : en-tête inattendu pour la ressource %#x/%d' % (type_, numero))
    d = vol[off + 13:off + 13 + compresse]
    if methode == 0:
        return d
    if methode == 32:
        return lzs(d, taille)
    sys.exit('RESOURCE.000 : méthode de compression %d non gérée' % methode)


# --- Audio SOL ------------------------------------------------------------------------------------------------------

# DPCM 8 bits de SCI2 : chaque quartet (fort puis faible) ajoute TABLE[n & 7] à l'échantillon si n < 8, et retire
# TABLE[7 - (n & 7)] sinon, avec saturation dans [0, 255] ; l'échantillon initial vaut 0x80. C'est la variante
# « ancienne » (celle de ScummVM pour SCI2 ; l'autre, `- TABLE[n & 7]`, est celle de SCI2.1 et suivants). Contrôle
# objectif sur 300 clips tirés au hasard : avec la bonne variante 0,01 % des échantillons saturent et la moyenne
# reste à 1,4 de 128 ; avec l'autre, 59 % des échantillons saturent et le signal dérive à 105 de 128 (collé à 0).
_DELTA = (0, 1, 2, 3, 6, 10, 15, 21, -21, -15, -10, -6, -3, -2, -1, 0)
_DELTA_FORT = [_DELTA[b >> 4] for b in range(256)]
_DELTA_FAIBLE = [_DELTA[b & 15] for b in range(256)]
_BLOC = 4096


def dpcm8(d):
    """DPCM 8 bits -> PCM 8 bits non signé (2 échantillons par octet). Somme cumulée par blocs (rapide, en C) ; un
    bloc qui sature est repris échantillon par échantillon."""
    deltas = [0] * (2 * len(d))
    deltas[0::2] = map(_DELTA_FORT.__getitem__, d)
    deltas[1::2] = map(_DELTA_FAIBLE.__getitem__, d)
    out = bytearray()
    s = 0x80
    for i in range(0, len(deltas), _BLOC):
        bloc = deltas[i:i + _BLOC]
        bloc[0] += s
        acc = list(itertools.accumulate(bloc))
        if min(acc) < 0 or max(acc) > 255:
            bloc[0] -= s
            acc = []
            for delta in bloc:
                s += delta
                s = 0 if s < 0 else 255 if s > 255 else s
                acc.append(s)
        out += bytes(acc)
        s = acc[-1]
    return bytes(out)


def entete_sol(b, pos, nom):
    """Retourne (drapeaux, début des données, taille des données) d'une ressource audio SOL à `pos`."""
    marque, taille_entete, magie, frequence, drapeaux, taille = lire(b, '<BB4sHBI', pos, nom)
    if marque != 0x8D or taille_entete not in (11, 12) or magie != b'SOL\0':
        sys.exit('%s : en-tête SOL inattendu' % nom)
    if frequence != FREQUENCE or drapeaux not in (0, 1):
        sys.exit('%s : audio SOL inattendu (%d Hz, drapeaux %#x)' % (nom, frequence, drapeaux))
    return drapeaux, pos + 2 + taille_entete, taille


def pcm_sol(drapeaux, donnees):
    return dpcm8(donnees) if drapeaux & 1 else donnees


def decoder_sync(bloc, nom, strict):
    """Bloc de synchronisation -> [tick, pose, tick, pose, ...]. `strict` : le terminateur doit finir le bloc."""
    if len(bloc) < 4 or bloc[0] != 0x8E or bloc[1] != 0:
        sys.exit('%s : bloc de synchronisation inattendu' % nom)
    paires, pos = [], 2
    while True:
        tick, = lire(bloc, '<H', pos, nom)
        pos += 2
        if tick == 0xFFFF:
            break
        pose, = lire(bloc, '<H', pos, nom)
        pos += 2
        if paires and tick < paires[-2]:
            sys.exit('%s : ticks de synchronisation non croissants' % nom)
        paires += [tick, pose]
    if strict and pos != len(bloc):
        sys.exit('%s : %d octets après la fin de la synchronisation' % (nom, len(bloc) - pos))
    return paires


# --- Voix -----------------------------------------------------------------------------------------------------------

def clips_des_maps(vol, entrees, taille_aud):
    """{module: {(noun, verb, cond, seq): (offset, taille du bloc sync)}} depuis les maps audio36."""
    modules = {}
    for (t, module) in sorted(entrees):
        if t != TYPE_MAP or module == MAP_SFX:
            continue
        nom = 'map %d' % module
        r = charger(vol, entrees, t, module)
        off, = lire(r, '<I', 0, nom)
        p, clips = 4, {}
        while True:
            if p >= len(r):
                sys.exit('%s : fin 0xFF absente' % nom)
            if r[p] == 0xFF:
                break
            noun, verb, cond, seq = lire(r, '<BBBB', p, nom)
            off += u24(r, p + 4, nom)
            p += 7
            sync = 0
            if seq & 0x80:
                sync, = lire(r, '<H', p, nom)
                p += 2
            if seq & 0x40 or off + sync + 13 > taille_aud:
                sys.exit('%s : entrée inattendue (%d %d %d %d)' % (nom, noun, verb, cond, seq))
            cle = (noun, verb, cond, seq & 0x7F)
            if cle in clips:
                sys.exit('%s : clip en double %r' % (nom, cle))
            clips[cle] = (off, sync)
        modules[module] = clips
    return modules


def patchs_aud(dossier):
    """({(module, noun, verb, cond, seq): chemin} des patchs `@`, idem des patchs `#`) du dossier AUD/ du CD."""
    audio, sync = {}, {}
    for nom in sorted(os.listdir(dossier)):
        m = PATCH_RE.match(nom.upper())
        if not m:
            continue
        module, noun, verb, cond, seq = (int(g, 36) for g in m.groups()[1:])
        if module >= MAP_SFX or max(noun, verb, cond) > 255 or seq > 0x3F:
            sys.exit('Patch au nom inattendu : %s' % nom)
        (audio if m.group(1) == '@' else sync)[(module, noun, verb, cond, seq)] = os.path.join(dossier, nom)
    return audio, sync


def ecrire_json(chemin, objet):
    with open(chemin, 'w', encoding='ascii') as f:
        json.dump(objet, f, separators=(',', ':'))
        f.write('\n')


def nom_clip(cle):
    return '%d-%d-%d-%d' % cle


def _traiter_module(args):
    """Écrit les PCM et le sync.json d'un module ; retourne (clips écrits, None) ou (0, message d'erreur) : un
    sys.exit dans un processus du Pool bloquerait pool.map."""
    try:
        return _ecrire_module(*args), None
    except SystemExit as e:
        return 0, str(e)


def _ecrire_module(module, clips, patchs_audio, patchs_sync, chemin_aud, dest_pcm, dest_voix):
    dossier = os.path.join(dest_pcm, str(module))
    os.makedirs(dossier, exist_ok=True)
    syncs, echantillons = {}, {}

    def ecrire_pcm(cle, pcm):
        echantillons[cle] = len(pcm)  # PCM 8 bits mono : un octet par échantillon
        with open(os.path.join(dossier, nom_clip(cle) + '.u8'), 'wb') as f:
            f.write(pcm)

    with open(chemin_aud, 'rb') as aud:
        for cle, (off, taille_sync) in sorted(clips.items()):
            nom = 'RESOURCE.AUD module %d clip %s' % (module, nom_clip(cle))
            aud.seek(off)
            tete = aud.read(taille_sync + 13)
            if taille_sync:
                syncs[cle] = decoder_sync(tete[:taille_sync], nom, True)
            if cle in patchs_audio:
                continue  # audio remplacé par un patch `@` (écrit plus bas)
            drapeaux, debut, taille = entete_sol(tete, taille_sync, nom)
            aud.seek(off + debut)
            donnees = aud.read(taille)
            if len(donnees) != taille or not taille:
                sys.exit('%s : données audio tronquées ou vides' % nom)
            ecrire_pcm(cle, pcm_sol(drapeaux, donnees))
    for cle, chemin in sorted(patchs_audio.items()):
        nom = os.path.basename(chemin)
        b = open(chemin, 'rb').read()
        drapeaux, debut, taille = entete_sol(b, 0, nom)
        if debut + taille != len(b) or not taille:
            sys.exit('%s : taille SOL incohérente avec le fichier' % nom)
        ecrire_pcm(cle, pcm_sol(drapeaux, b[debut:]))
    for cle, chemin in sorted(patchs_sync.items()):
        syncs[cle] = decoder_sync(open(chemin, 'rb').read(), os.path.basename(chemin), False)
    audios = set(clips) | set(patchs_audio)
    orphelins = sorted(set(syncs) - audios)
    if orphelins:
        sys.exit('Module %d : synchronisation sans audio pour %s' % (module, ', '.join(map(nom_clip, orphelins))))
    os.makedirs(os.path.join(dest_voix, str(module)), exist_ok=True)
    ecrire_json(os.path.join(dest_voix, str(module), 'index.json'),
                {nom_clip(c): echantillons[c] for c in sorted(echantillons)})
    if syncs:
        ecrire_json(os.path.join(dest_voix, str(module), 'sync.json'), {nom_clip(c): syncs[c] for c in sorted(syncs)})
    return len(audios)


def cmd_voix(cd, dest_pcm, out):
    vol = open(os.path.join(cd, 'RESOURCE.000'), 'rb').read()
    entrees = lire_map(os.path.join(cd, 'RESOURCE.MAP'))
    chemin_aud = os.path.join(cd, 'AUD', 'RESOURCE.AUD')
    modules = clips_des_maps(vol, entrees, os.path.getsize(chemin_aud))
    nb = sum(len(c) for c in modules.values())
    nb_sync = sum(1 for c in modules.values() for _, s in c.values() if s)
    if (len(modules), nb, nb_sync) != (NB_MAPS_AUDIO36, NB_CLIPS_MAPS, NB_CLIPS_SYNC):
        sys.exit('Maps audio36 : %d maps, %d clips dont %d avec synchronisation (%d, %d, %d attendus)'
                 % (len(modules), nb, nb_sync, NB_MAPS_AUDIO36, NB_CLIPS_MAPS, NB_CLIPS_SYNC))
    p_audio, p_sync = patchs_aud(os.path.join(cd, 'AUD'))
    if (len(p_audio), len(p_sync)) != (NB_PATCHS_AUDIO, NB_PATCHS_SYNC):
        sys.exit('AUD/ : %d patchs audio et %d patchs sync (%d et %d attendus)'
                 % (len(p_audio), len(p_sync), NB_PATCHS_AUDIO, NB_PATCHS_SYNC))
    dest_voix = os.path.join(out, 'voices')
    taches = []
    for module in sorted(set(modules) | {c[0] for c in p_audio} | {c[0] for c in p_sync}):
        taches.append((module, modules.get(module, {}),
                       {c[1:]: f for c, f in p_audio.items() if c[0] == module},
                       {c[1:]: f for c, f in p_sync.items() if c[0] == module},
                       chemin_aud, dest_pcm, dest_voix))
    taches.sort(key=lambda t: -len(t[1]))  # les gros modules d'abord : meilleure répartition entre processus
    with multiprocessing.Pool() as pool:
        resultats = pool.map(_traiter_module, taches, chunksize=1)
    erreurs = [e for _, e in resultats if e]
    if erreurs:
        sys.exit('\n'.join(erreurs))
    print(sum(n for n, _ in resultats))


# --- Bruitages numériques -------------------------------------------------------------------------------------------

def valider_wav(wav, nom):
    """RIFF WAVE PCM mono 22 050 Hz (8 ou 16 bits) dont les chunks tiennent dans le fichier ; retourne le nombre
    d'échantillons."""
    if len(wav) < 12 or wav[:4] != b'RIFF' or wav[8:12] != b'WAVE':
        sys.exit('%s : pas un RIFF WAVE' % nom)
    if struct.unpack_from('<I', wav, 4)[0] + 8 > len(wav):
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
    if fmt is None or not data or (fmt[0], fmt[1], fmt[2]) != (1, 1, FREQUENCE) or fmt[5] not in (8, 16):
        sys.exit('%s : format inattendu (PCM mono %d Hz attendu) : %r' % (nom, FREQUENCE, fmt))
    if fmt[4] != fmt[5] // 8 or data % fmt[4]:
        sys.exit('%s : taille des données incohérente avec le format' % nom)
    return data // fmt[4]


def cmd_bruitages(cd, dest, index):
    vol = open(os.path.join(cd, 'RESOURCE.000'), 'rb').read()
    entrees = lire_map(os.path.join(cd, 'RESOURCE.MAP'))
    r = charger(vol, entrees, TYPE_MAP, MAP_SFX)
    sfx = open(os.path.join(cd, 'RESOURCE.SFX'), 'rb').read()
    os.makedirs(dest, exist_ok=True)
    numeros, off, p = {}, 0, 0
    while True:
        n, = lire(r, '<H', p, 'map 65535')
        if n == 0xFFFF:
            break
        off += u24(r, p + 2, 'map 65535')
        p += 5
        nom = 'RESOURCE.SFX ressource %d' % n
        if n in numeros:
            sys.exit('%s : numéro en double' % nom)
        magie, taille = lire(sfx, '<4sI', off, nom)
        wav = sfx[off:off + 8 + taille]
        if magie != b'RIFF' or len(wav) != 8 + taille:
            sys.exit('%s : RIFF attendu' % nom)
        numeros[n] = valider_wav(wav, nom)
        with open(os.path.join(dest, '%d.wav' % n), 'wb') as f:
            f.write(wav)
    if len(numeros) != NB_ENTREES_SFX:
        sys.exit('map 65535 : %d entrées, %d attendues' % (len(numeros), NB_ENTREES_SFX))
    patchs = 0
    for nom in sorted(os.listdir(os.path.join(cd, 'SFX'))):
        m = re.match(r'^(\d{1,5})\.WAV$', nom.upper())
        if not m:
            sys.exit('SFX/%s : nom inattendu' % nom)
        wav = open(os.path.join(cd, 'SFX', nom), 'rb').read()
        numeros[int(m.group(1))] = valider_wav(wav, 'SFX/' + nom)
        patchs += 1
        with open(os.path.join(dest, '%d.wav' % int(m.group(1))), 'wb') as f:  # SFX/ gagne sur RESOURCE.SFX
            f.write(wav)
    if patchs != NB_WAV_SFX:
        sys.exit('SFX/ : %d WAV, %d attendus' % (patchs, NB_WAV_SFX))
    os.makedirs(os.path.dirname(index), exist_ok=True)
    ecrire_json(index, {str(n): numeros[n] for n in sorted(numeros)})
    print(len(numeros))


# --- Inventaire -----------------------------------------------------------------------------------------------------

def sha(chemin, complet=False):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest() if complet else h.hexdigest()[:16]


def hms(secondes):
    s = int(round(secondes))
    return '%d h %02d min %02d s' % (s // 3600, s % 3600 // 60, s % 60)


SOURCES_CONTROLEES = ('RESOURCE.MAP', 'RESOURCE.000', 'ALT.MAP', 'RESOURCE.ALT', 'RESOURCE.SFX', 'AUD/RESOURCE.AUD',
                      'PATCHES/316.SND', 'PATCHES/803.SND', 'VERSION.')
# Fichiers du CD gardés sous un autre nom : nom dans l'ISO -> nom versionné.
RENOMMES = {'VERSION.': 'VERSION'}
ORIGINES = {
    'ALT.MAP': '`ALT.MAP` du CD, tel quel (répertoire de `RESOURCE.ALT`)',
    'BD.pdf': 'bande dessinée de la boîte, « … (Bande dessinée).pdf » de l\'archive des manuels, telle quelle',
    'COVER.webp': 'jaquette, ne vient pas du CD : conservée d\'une exécution à l\'autre',
    'MANUEL.pdf': 'manuel, « … (Manuel).pdf » de l\'archive des manuels, tel quel',
    'PATCHES/316.SND': '`PATCHES/316.SND` du CD, tel quel (patch de la ressource sound 316)',
    'PATCHES/803.SND': '`PATCHES/803.SND` du CD, tel quel (patch de la ressource sound 803)',
    'RESOURCE.000': '`RESOURCE.000` du CD, tel quel (volume de ressources SCI2)',
    'RESOURCE.ALT': '`RESOURCE.ALT` du CD, tel quel (59 vues, variantes haute résolution, pour une option future)',
    'RESOURCE.MAP': '`RESOURCE.MAP` du CD, tel quel (répertoire de `RESOURCE.000`)',
    'VERSION': '`VERSION.` du CD, tel quel (numéro de version, nom et date du CD, lus par le jeu)',
}


def cmd_inventaire(out, cd, dest_pcm, dest_wav, sortie):
    fichiers = {rel: c for c, rel in ec.liste_fichiers(out) if rel != 'files.json'}
    taille = {rel: os.path.getsize(c) for rel, c in fichiers.items()}
    voix = sorted(rel for rel in fichiers if rel.startswith('voices/') and rel.endswith('.mp3'))
    syncs = sorted(rel for rel in fichiers if rel.startswith('voices/') and rel.endswith('/sync.json'))
    index = sorted(rel for rel in fichiers if rel.endswith('/index.json'))
    bruitages = sorted(rel for rel in fichiers if rel.startswith('audio/') and rel.endswith('.mp3'))
    seqs = sorted(rel for rel in fichiers if rel.startswith('SEQ/'))
    autres = sorted(set(fichiers) - set(voix) - set(syncs) - set(index) - set(bruitages) - set(seqs))
    total = sum(taille.values())

    def somme(rels):
        return sum(taille[r] for r in rels)

    # Voix : une ligne par module.
    par_module, duree_voix, nb_sync = [], 0.0, 0
    for module in sorted({int(r.split('/')[1]) for r in voix}):
        prefixe = 'voices/%d/' % module
        mp3 = [r for r in voix if r.startswith(prefixe)]
        duree = sum(os.path.getsize(os.path.join(dest_pcm, str(module), n))
                    for n in os.listdir(os.path.join(dest_pcm, str(module)))) / FREQUENCE
        n_sync = 0
        if prefixe + 'sync.json' in fichiers:
            with open(fichiers[prefixe + 'sync.json'], encoding='ascii') as f:
                n_sync = len(json.load(f))
        par_module.append((module, len(mp3), n_sync, somme(mp3), '%.0f s' % duree))
        duree_voix += duree
        nb_sync += n_sync
    duree_bruitages = 0.0
    for n in os.listdir(dest_wav):
        with wave.open(os.path.join(dest_wav, n)) as w:
            duree_bruitages += w.getnframes() / w.getframerate()

    # Fichiers du CD non repris, par catégorie.
    gardes_cd = set(autres) | set(seqs)
    exclus = {}
    for c, rel in ec.liste_fichiers(cd):
        if RENOMMES.get(rel, rel) in gardes_cd:
            continue
        if rel in ('RESOURCE.SFX', 'AUD/RESOURCE.AUD') or rel.startswith(('AUD/', 'SFX/')):
            cat = 'audio converti en MP3 (`RESOURCE.SFX`, `SFX/`, `AUD/`)'
        elif rel.upper().endswith(('.EXE', '.DRV')):
            cat = 'exécutables et pilotes DOS (`*.EXE`, `*.DRV`)'
        else:
            cat = 'installeur, configuration et lisez-moi'
        e = exclus.setdefault(cat, [0, 0])
        e[0] += 1
        e[1] += os.path.getsize(c)

    lignes = [(n, taille[n], '`%s`' % sha(fichiers[n]), ORIGINES.get(n, '')) for n in autres]
    lignes.append(('SEQ/*.SEQ', somme(seqs), '', '%d cinématiques Sierra SEQ du dossier `SEQ/` du CD, telles quelles'
                   % len(seqs)))
    lignes.append(('voices/<module>/<noun>-<verb>-<cond>-<seq>.mp3', somme(voix), '',
                   '%d clips de voix (`AUD/RESOURCE.AUD` et patchs `AUD/@…`) ; MP3 mono 22 050 Hz, 24 kb/s CBR '
                   '(`ec_encoder_voix`)' % len(voix)))
    lignes.append(('voices/<module>/sync.json', somme(syncs), '',
                   '%d fichiers, synchronisation labiale de %d clips (blocs sync de `AUD/RESOURCE.AUD` et patchs '
                   '`AUD/#…`)' % (len(syncs), nb_sync)))
    lignes.append(('voices/<module>/index.json, audio/index.json', somme(index), '',
                   '%d fichiers, durée exacte de chaque clip et de chaque bruitage, en échantillons à 22 050 Hz'
                   % len(index)))
    lignes.append(('audio/<numéro>.mp3', somme(bruitages), '',
                   '%d bruitages numériques (`RESOURCE.SFX` et `SFX/*.WAV`) ; MP3 mono 22 050 Hz, 64 kb/s CBR'
                   % len(bruitages)))
    sections = [
        ('Taille', [
            '- Total versionné (`original/gk1/`) : **%s** (%d octets), %d fichiers (hors `files.json`)'
            % (ec.mo(total), total, len(fichiers)),
            '- Voix (`voices/`) : %s ; bruitages (`audio/`) : %s ; cinématiques (`SEQ/`) : %s ; ressources, patchs et '
            'PDF : %s' % (ec.mo(somme(voix) + somme(syncs) + somme(index) - taille['audio/index.json']),
                          ec.mo(somme(bruitages) + taille['audio/index.json']), ec.mo(somme(seqs)),
                          ec.mo(somme(autres))),
            '- Plus gros fichier : `%s` (%s)' % (max(taille, key=taille.get), ec.mo(max(taille.values()))),
            '- Hors extraction, conservé d\'une exécution à l\'autre : `COVER.webp` (jaquette, si présente)']),
        ('Fichiers', ec.tableau(['Fichier', 'Octets', 'SHA-256 (16 premiers hex)', 'Origine'], lignes, droite=(1,))),
        ('Voix', [
            '- %d fichiers MP3, %s (%d octets) : `voices/<module>/<noun>-<verb>-<cond>-<seq>.mp3`, en décimal ; le '
            'module est le numéro de la ressource message, (noun, verb, cond, seq) la clé du message ; seq sans le '
            'drapeau 0x80' % (len(voix), ec.mo(somme(voix)), somme(voix)),
            '- Source : %d clips des %d maps audio36 de `RESOURCE.000` (audio SOL de `AUD/RESOURCE.AUD`, DPCM 8 bits, '
            '4 bits par échantillon), dont %d remplacés et %d ajoutés par les %d patchs `AUD/@…` (SOL PCM 8 bits) ; '
            'mono %d Hz, soit **%s** (%.0f s)'
            % (NB_CLIPS_MAPS, NB_MAPS_AUDIO36, NB_CLIPS_MAPS + NB_PATCHS_AUDIO - len(voix),
               len(voix) - NB_CLIPS_MAPS, NB_PATCHS_AUDIO, FREQUENCE, hms(duree_voix), duree_voix),
            '- Les voix sont en anglais : la version française de 1994 associe les voix d\'origine aux textes '
            'français',
            '- DPCM : variante « ancienne » de SCI2 (quartet n ≥ 8 : retire `table[7 - (n & 7)]`), choisie sur un '
            'contrôle objectif (300 clips : 0,01 % d\'échantillons saturés et moyenne à 1,4 de 128, contre 59 % et '
            '105 avec l\'autre variante)',
            '- Encodage : `libmp3lame`, 24 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées '
            '(`ec_encoder_voix` de `scripts/lib/extract-common.sh`)',
            '- Synchronisation labiale : `voices/<module>/sync.json`, `{"<noun>-<verb>-<cond>-<seq>": [tick, pose, '
            'tick, pose, …]}` : les paires u16 du bloc sync, sans l\'en-tête (`8E 00`) ni le tick final 0xFFFF ; un '
            'tick vaut 1/60 s ; un patch `AUD/#…` remplace le bloc de `RESOURCE.AUD` (%d patchs, octets après le '
            'terminateur non repris)' % NB_PATCHS_SYNC,
            '- Durées : `voices/<module>/index.json`, `{"<noun>-<verb>-<cond>-<seq>": échantillons}`, et '
            '`audio/index.json`, `{"<numéro>": échantillons}` : nombre d\'échantillons du PCM source (mono 22 050 Hz), '
            'avant l\'encodage MP3 ; en ticks de 1/60 s, arrondi de ScummVM (`Audio32::play`) : '
            '`1 + floor(floor(échantillons × 1000 / 22050) × 60 / 1000)`',
            '- Priorités : un patch `AUD/@…` remplace l\'audio du clip de `RESOURCE.AUD` de même clé, un patch '
            '`AUD/#…` remplace ou ajoute son bloc sync ; `SFX/<n>.WAV` remplace la ressource `n` de `RESOURCE.SFX`',
            ''] + ec.tableau(['Module', 'Clips', 'Avec sync', 'Octets MP3', 'Durée'], par_module,
                             droite=(0, 1, 2, 3, 4))),
        ('Bruitages numériques', [
            '- %d fichiers MP3 (`audio/<numéro>.mp3`), %s (%d octets), %s (%.0f s)'
            % (len(bruitages), ec.mo(somme(bruitages)), somme(bruitages), hms(duree_bruitages), duree_bruitages),
            '- Source : les %d ressources de `RESOURCE.SFX` (map 65535 de `RESOURCE.000`) et les %d `SFX/*.WAV`, qui '
            'gagnent en cas de conflit (%d numéro commun) ; RIFF WAVE PCM mono %d Hz, 16 ou 8 bits'
            % (NB_ENTREES_SFX, NB_WAV_SFX, NB_ENTREES_SFX + NB_WAV_SFX - len(bruitages), FREQUENCE),
            '- Encodage : `libmp3lame`, 64 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées']),
        ('Fichiers du CD non versionnés', ec.tableau_par_categorie('Catégorie', exclus)),
        ('Contrôles faits à l\'extraction', [
            '- Archives 7z extraites dans un dossier temporaire vide, ISO lu par l\'analyseur de '
            '`scripts/lib/extract_common.py` ; rien n\'est exécuté.',
            '- Tailles et SHA-256 des fichiers sources : %s.' % ' ; '.join(
                '`%s` %d octets `%s`' % (n, os.path.getsize(os.path.join(cd, n)), sha(os.path.join(cd, n), True))
                for n in SOURCES_CONTROLEES),
            '- Tailles et SHA-256 des deux PDF : %s.' % ' ; '.join(
                '`%s` %d octets `%s`' % (n, taille[n], sha(fichiers[n], True)) for n in ('MANUEL.pdf', 'BD.pdf')),
            '- Nombres attendus : %d maps audio36, %d clips dont %d avec synchronisation, %d patchs `@` et %d patchs '
            '`#`, %d entrées dans la map 65535, %d `SFX/*.WAV`, 25 `SEQ/*.SEQ` ; %d MP3 de voix et %d de bruitages '
            'en sortie.' % (NB_MAPS_AUDIO36, NB_CLIPS_MAPS, NB_CLIPS_SYNC, NB_PATCHS_AUDIO, NB_PATCHS_SYNC,
                            NB_ENTREES_SFX, NB_WAV_SFX, len(voix), len(bruitages)),
            '- Audio : en-tête SOL (22 050 Hz, drapeaux 0 ou 1) et taille de chaque clip, bloc sync terminé par '
            '0xFFFF exactement à sa fin (dans `RESOURCE.AUD`), ticks croissants, pas de synchronisation sans audio ; '
            'chaque bruitage est un RIFF WAVE PCM mono 22 050 Hz dont les chunks tiennent dans la ressource.']),
        ('Régénérer', ['```', 'bash scripts/gk1-extract.sh [jeu.7z] [manuels.7z]', '```', '',
                       'Archives par défaut : `archives/jeu-00686-gabriel_knight_cd-pcdos.7z` (contient `GabK.iso`) '
                       'et `archives/man-00686-gabriel_knight.7z` (non versionnées). Outils requis : `7zz`, '
                       '`python3`, `ffmpeg` (`libmp3lame`).']),
    ]
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de Gabriel Knight: Sins of the Fathers',
                         'scripts/gk1-extract.sh', sections)


def cmd_iso(iso, dest):
    print('%d fichiers extraits de l\'ISO' % ec.extraire_iso(iso, dest))


if __name__ == '__main__':
    commandes = {'iso': cmd_iso, 'voix': cmd_voix, 'bruitages': cmd_bruitages, 'inventaire': cmd_inventaire}
    if len(sys.argv) < 2 or sys.argv[1] not in commandes:
        sys.exit(__doc__)
    commandes[sys.argv[1]](*sys.argv[2:])
