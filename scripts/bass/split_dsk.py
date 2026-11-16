"""Utilitaires du script scripts/bass-extract.sh (Beneath a Steel Sky, version CD 1.2, sky.dsk + sky.dnr, voir
docs/bass/formats.md § 2, 3 et 6).

Lancé avec `python3 -I` : les données extraites ne sont pas de confiance (rien n'en est exécuté, tailles et bornes
validées avant toute lecture ou écriture).
Sous-commandes :
  decouper <sky.dnr> <sky.dsk> <dest> <dest_raw>
      -> écrit dans <dest> un sky.dsk et un sky.dnr reconstruits SANS les voix (identifiants 50000 à 55277), au même
         format : octets stockés recopiés tels quels, positions recalculées, même ordre, mêmes drapeaux ;
         écrit dans <dest_raw> chaque voix en PCM 8 bits non signé, mono, 11 025 Hz : <identifiant>.raw
  check <sky.dnr> <sky.dsk> <nouveau sky.dnr> <nouveau sky.dsk>
      -> vérifie que chaque fichier hors voix du couple reconstruit est identique à l'original (octets stockés
         et contenu décompressé), que les voix en sont absentes et que la structure de l'index est conservée
  inventaire <out> <dossier de l'archive> <dest_raw> <sortie_md>
      -> écrit l'inventaire Markdown (docs/bass/files.md)
"""
import hashlib
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

TAILLE_DSK = 72395713
NB_ENTREES = 5097
NB_VOIX = 3491
VOIX_MIN, VOIX_MAX = 50000, 55277  # identifiants des voix (formats.md § 6) ; l'introduction (59494-59672) reste
ENTETE = 22  # DataFileHeader : 11 mots u16 LE
FREQUENCE = 11025
BIT_POSITION_ALIGNEE = 1 << 23  # dans la position de l'index : position réelle = (v & 0x7FFFFF) << 4
POSITION_MAX = 0x7FFFFF


def est_voix(ident):
    return VOIX_MIN <= ident <= VOIX_MAX


# --- Index -----------------------------------------------------------------------------------------------------------

class Entree:
    """Une entrée de sky.dnr (8 octets). `flags` est recopié tel quel dans l'index reconstruit."""
    __slots__ = ('ident', 'pos', 'alignee', 'flags', 'taille', 'sans_entete', 'non_compresse')

    def __init__(self, brut):
        self.ident, = struct.unpack_from('<H', brut, 0)
        p = brut[2] | brut[3] << 8 | brut[4] << 16
        self.alignee = bool(p & BIT_POSITION_ALIGNEE)
        self.pos = (p & POSITION_MAX) << (4 if self.alignee else 0)
        self.flags = brut[5] | brut[6] << 8 | brut[7] << 16
        self.taille = self.flags & 0x3FFFFF  # octets stockés
        self.sans_entete = bool(self.flags >> 22 & 1)  # l'en-tête n'est pas recopié devant la sortie décompressée
        self.non_compresse = bool(self.flags >> 23 & 1)

    def encoder(self):
        """Les 8 octets de l'entrée, avec la position courante `pos`."""
        if self.alignee:
            if self.pos % 16:
                sys.exit('Position %d non alignée (identifiant %d)' % (self.pos, self.ident))
            v = (self.pos >> 4) | BIT_POSITION_ALIGNEE
        else:
            v = self.pos
        if (v & ~(BIT_POSITION_ALIGNEE | POSITION_MAX)) or (not self.alignee and self.pos > POSITION_MAX):
            sys.exit('Position %d hors de l\'index (identifiant %d)' % (self.pos, self.ident))
        return struct.pack('<H', self.ident) + v.to_bytes(3, 'little') + self.flags.to_bytes(3, 'little')


def lire_index(chemin_dnr, taille_dsk):
    """Entrées de sky.dnr dans l'ordre du fichier, après les contrôles de structure (formats.md § 2)."""
    with open(chemin_dnr, 'rb') as f:
        d = f.read()
    if len(d) < 4:
        sys.exit('sky.dnr trop court')
    n, = struct.unpack_from('<I', d, 0)
    if len(d) != 4 + 8 * n:
        sys.exit('sky.dnr : %d entrées annoncées, %d octets' % (n, len(d)))
    entrees = [Entree(d[4 + 8 * i:12 + 8 * i]) for i in range(n)]
    if len({e.ident for e in entrees}) != n:
        sys.exit('sky.dnr : identifiants en double')
    for e in entrees:
        if e.pos + e.taille > taille_dsk:
            sys.exit('Identifiant %d : fichier au-delà de la fin de sky.dsk' % e.ident)
    return entrees


def verifier_disposition(entrees, taille_dsk):
    """Les fichiers se suivent dans l'ordre de l'index, avec au plus 15 octets de remplissage devant un fichier à
    position alignée, aucun devant un autre ; le dernier finit à la fin de sky.dsk. Hypothèse de la reconstruction."""
    fin = 0
    for e in entrees:
        ecart = e.pos - fin
        if ecart < 0 or ecart > (15 if e.alignee else 0):
            sys.exit('Identifiant %d : écart de %d octets avec le fichier précédent' % (e.ident, ecart))
        fin = e.pos + e.taille
    if fin != taille_dsk:
        sys.exit('Le dernier fichier finit en %d, sky.dsk fait %d octets' % (fin, taille_dsk))


# --- RNC méthode 1 (common/compression/rnc_deco.cpp, unpackM1) ----------------------------------------------------------

def crc16(donnees):
    c = 0
    for x in donnees:
        c ^= x
        for _ in range(8):
            c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
    return c


def rnc1(tampon):
    """Décompresse un flux RNC méthode 1. Retourne None s'il n'a pas la signature RNC, lève ValueError s'il est
    corrompu (CRC ou tailles invalides)."""
    if tampon[:4] != b'RNC\x01':
        return None
    taille_sortie, taille_entree = struct.unpack_from('>II', tampon, 4)
    crc_sortie, crc_entree = struct.unpack_from('>HH', tampon, 12)
    blocs = tampon[17]
    if 18 + taille_entree > len(tampon):
        raise ValueError('flux RNC tronqué')
    if crc16(tampon[18:18 + taille_entree]) != crc_entree:
        raise ValueError('CRC du flux compressé')
    n = len(tampon)
    etat = [0, 0, 18]  # bits restants, leur nombre, position de lecture dans le tampon

    def mot(p):
        return (tampon[p] | tampon[p + 1] << 8) if p + 1 < n else (tampon[p] if p < n else 0)

    def voir(k):
        v, c, p = etat
        while c < k:
            v |= mot(p) << c
            p += 2
            c += 16
        return v & ((1 << k) - 1)

    def prendre(k):
        v, c, p = etat
        while c < k:
            v |= mot(p) << c
            p += 2
            c += 16
        etat[0], etat[1], etat[2] = v >> k, c - k, p
        return v & ((1 << k) - 1)

    def table():
        """Table de Huffman canonique : [(longueur du code, code, valeur)] ; les bits arrivent poids faible d'abord."""
        nb = prendre(5)
        if not nb:
            return []
        longueurs = [prendre(4) for _ in range(nb)]
        t, code = [], 0
        for bl in range(1, 17):
            for i in range(nb):
                if longueurs[i] == bl:
                    b = code >> (16 - bl)
                    miroir = 0
                    for j in range(bl):
                        miroir |= (b >> j & 1) << (bl - j - 1)
                    t.append((bl, miroir, i))
                    code += 1 << (16 - bl)
        return t

    def valeur(t):
        v16 = voir(16)
        for bl, a, i in t:
            if v16 & ((1 << bl) - 1) == a:
                break
        else:
            raise ValueError('code de Huffman inconnu')
        prendre(bl)
        if i >= 2:
            i -= 1
            i = prendre(i) | (1 << i)
        return i

    prendre(2)
    sortie = bytearray()
    for _ in range(blocs):
        litteraux, distances, longueurs = table(), table(), table()
        restants = prendre(16)
        while True:
            nb = valeur(litteraux)
            if nb:
                p = etat[2]
                sortie += tampon[p:p + nb]
                etat[2] = p + nb
            if restants > 1:
                dist = valeur(distances) + 1
                lon = valeur(longueurs) + 2
                if dist > len(sortie):
                    raise ValueError('distance de copie invalide')
                for _ in range(lon):
                    sortie.append(sortie[-dist])
            restants -= 1
            if restants == 0:
                break
        if len(sortie) > taille_sortie:
            raise ValueError('sortie plus grande que prévu')
    if len(sortie) != taille_sortie or crc16(sortie) != crc_sortie:
        raise ValueError('taille ou CRC de la sortie')
    return bytes(sortie)


def charger(e, brut):
    """Contenu d'un fichier comme `Disk::loadFile` (disk.cpp:181-296) : `brut` = octets stockés. Retourne
    (contenu, était_compressé)."""
    if len(brut) < ENTETE:
        return brut, False
    flag, = struct.unpack_from('<H', brut, 0)
    if not e.non_compresse and flag >> 7 & 1:
        sortie = rnc1(brut[ENTETE:])
        if sortie is not None:
            return (sortie if e.sans_entete else brut[:ENTETE] + sortie), True
    return brut, False


# --- Découpage -------------------------------------------------------------------------------------------------------

class Dsk:
    def __init__(self, chemin_dnr, chemin_dsk):
        self.taille = os.path.getsize(chemin_dsk)
        self.entrees = lire_index(chemin_dnr, self.taille)
        self.f = open(chemin_dsk, 'rb')

    def stocke(self, e):
        self.f.seek(e.pos)
        return self.f.read(e.taille)


def controler_origine(dnr, dsk):
    """Contrôles d'entrée (taille de sky.dsk, nombre d'entrées, nombre de voix, disposition) ; retourne le Dsk."""
    d = Dsk(dnr, dsk)
    if d.taille != TAILLE_DSK:
        sys.exit('sky.dsk : %d octets attendus, %d trouvés' % (TAILLE_DSK, d.taille))
    if len(d.entrees) != NB_ENTREES:
        sys.exit('%d entrées attendues, %d trouvées' % (NB_ENTREES, len(d.entrees)))
    voix = sum(est_voix(e.ident) for e in d.entrees)
    if voix != NB_VOIX:
        sys.exit('%d voix attendues, %d trouvées' % (NB_VOIX, voix))
    verifier_disposition(d.entrees, d.taille)
    return d


def pcm_voix(d, e):
    """PCM 8 bits non signé d'une voix : contenu décompressé sans l'en-tête de 22 octets, sur `s_tot_size - 22`
    octets (sound.cpp : la taille utile vient de l'en-tête, pas de la fin du fichier)."""
    contenu, _ = charger(e, d.stocke(e))
    if len(contenu) < ENTETE:
        sys.exit('Voix %d : en-tête incomplet' % e.ident)
    s_tot_size, = struct.unpack_from('<H', contenu, 12)
    if s_tot_size < ENTETE or s_tot_size > len(contenu):
        sys.exit('Voix %d : s_tot_size = %d pour %d octets décompressés' % (e.ident, s_tot_size, len(contenu)))
    return contenu[ENTETE:s_tot_size]


def cmd_decouper(dnr, dsk, dest, dest_raw):
    d = controler_origine(dnr, dsk)
    os.makedirs(dest, exist_ok=True)
    os.makedirs(dest_raw, exist_ok=True)
    nouvelles, fin, nb_voix = [], 0, 0
    with open(os.path.join(dest, 'sky.dsk'), 'wb') as sortie:
        for e in d.entrees:
            if est_voix(e.ident):
                with open(os.path.join(dest_raw, '%d.raw' % e.ident), 'wb') as r:
                    r.write(pcm_voix(d, e))
                nb_voix += 1
                continue
            n = Entree(e.encoder())
            # Même encodage : si l'entrée est alignée, remplissage de zéros jusqu'au multiple de 16 suivant ;
            # sinon elle suit directement la précédente (comme dans l'original).
            n.pos = (fin + 15) // 16 * 16 if n.alignee else fin
            sortie.write(b'\0' * (n.pos - fin))
            sortie.write(d.stocke(e))
            fin = n.pos + n.taille
            nouvelles.append(n)
    with open(os.path.join(dest, 'sky.dnr'), 'wb') as f:
        f.write(struct.pack('<I', len(nouvelles)))
        for n in nouvelles:
            f.write(n.encoder())
    print('%d fichiers conservés (sky.dsk : %d octets), %d voix écrites en PCM' % (len(nouvelles), fin, nb_voix))


def cmd_check(dnr, dsk, nouveau_dnr, nouveau_dsk):
    o = controler_origine(dnr, dsk)
    n = Dsk(nouveau_dnr, nouveau_dsk)
    verifier_disposition(n.entrees, n.taille)
    attendu = [e for e in o.entrees if not est_voix(e.ident)]
    if [e.ident for e in n.entrees] != [e.ident for e in attendu]:
        sys.exit('Les identifiants du couple reconstruit ne sont pas ceux de l\'original sans les voix')
    for eo, en in zip(attendu, n.entrees):
        if eo.flags != en.flags or eo.alignee != en.alignee:
            sys.exit('Identifiant %d : drapeaux ou mode de position modifiés' % eo.ident)
        so, sn = o.stocke(eo), n.stocke(en)
        if so != sn:
            sys.exit('Identifiant %d : octets stockés différents' % eo.ident)
        if charger(eo, so) != charger(en, sn):
            sys.exit('Identifiant %d : contenu décompressé différent' % eo.ident)
    with open(nouveau_dsk, 'rb') as f:
        d = f.read()
    # Le remplissage entre fichiers n'est que des zéros.
    fin = 0
    for en in n.entrees:
        if any(d[fin:en.pos]):
            sys.exit('Remplissage non nul avant l\'identifiant %d' % en.ident)
        fin = en.pos + en.taille
    print('%d fichiers hors voix identiques à l\'original (octets stockés et contenu décompressé), aucune voix, '
          'index conforme' % len(attendu))


# --- Inventaire ------------------------------------------------------------------------------------------------------

def sha(chemin, complet=False):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest() if complet else h.hexdigest()[:16]


def hms(secondes):
    s = int(round(secondes))
    return '%d h %02d min %02d s' % (s // 3600, s % 3600 // 60, s % 60)


def cmd_inventaire(out, archive, dest_raw, sortie):
    fichiers = {rel: c for c, rel in ec.liste_fichiers(out) if rel != 'files.json'}
    voix = {rel: c for rel, c in fichiers.items() if rel.startswith('voices/')}
    autres = sorted(set(fichiers) - set(voix))
    total = sum(os.path.getsize(c) for c in fichiers.values())
    taille_voix = sum(os.path.getsize(c) for c in voix.values())
    brut = sum(os.path.getsize(os.path.join(dest_raw, n)) for n in os.listdir(dest_raw))
    duree = brut / FREQUENCE
    dnr_o, dsk_o, cpt_o = (os.path.join(archive, n) for n in ('sky.dnr', 'sky.dsk', 'sky.cpt'))
    nb_origine = struct.unpack_from('<I', open(dnr_o, 'rb').read(4), 0)[0]
    origines = {
        'COVER.webp': 'jaquette de la boîte d\'origine (Wikipédia anglophone), conservé d\'une exécution à l\'autre',
        'README-BASS.txt': '`readme.txt` de l\'archive (licence de Revolution Software, à conserver intacte)',
        'sky.cpt': '`sky.cpt` de l\'archive, tel quel (décision D2)',
        'sky.dnr': 'index de `sky.dnr` de l\'archive recalculé pour `sky.dsk` sans les voix (`scripts/bass/split_dsk.py`)',
        'sky.dsk': '`sky.dsk` de l\'archive sans les 3 491 voix (50000 à 55277) ; octets stockés copiés tels quels',
    }
    lignes = [(n, os.path.getsize(fichiers[n]), '`%s`' % sha(fichiers[n]), origines.get(n, '')) for n in autres]
    lignes.append(('voices/<id>.mp3', taille_voix, '', '%d voix, une par identifiant 50000 à 55277 de `sky.dsk` ; '
                   'MP3 mono 22 050 Hz, 24 kb/s CBR (`ec_encoder_voix`)' % len(voix)))
    sections = [
        ('Taille', [
            '- Total versionné (`original/bass/`) : **%s** (%d octets), %d fichiers (hors `files.json`)' % (ec.mo(total), total, len(fichiers)),
            '- Voix (`voices/`) : %s ; données du jeu : %s' % (ec.mo(taille_voix), ec.mo(total - taille_voix)),
            '- Hors extraction, conservé d\'une exécution à l\'autre : `COVER.webp` (jaquette de la boîte d\'origine)']),
        ('Fichiers', ec.tableau(['Fichier', 'Octets', 'SHA-256 (16 premiers hex)', 'Origine'], lignes, droite=(1,))),
        ('Voix', [
            '- %d fichiers MP3 (`voices/<id>.mp3`), %s au total (%d octets)' % (len(voix), ec.mo(taille_voix), taille_voix),
            '- Source : PCM 8 bits non signé, mono, %d Hz, %d octets, soit **%s** (%.0f s)' % (FREQUENCE, brut, hms(duree), duree),
            '- Identifiants : 50000 à 55277 (`50000 + table[section] + rang`, voir `formats.md` § 6) ; les voix de l\'introduction '
            '(59494 à 59672) restent dans `sky.dsk`, au format d\'origine',
            '- Encodage : `libmp3lame`, 24 kb/s CBR, 22 050 Hz, mono, `-fflags +bitexact`, sans métadonnées (`ec_encoder_voix` de `scripts/lib/extract-common.sh`, partagé avec FOTAQ)']),
        ('Contrôles faits à l\'extraction', [
            '- `sky.dsk` : %d octets ; `sky.dnr` : %d entrées ; mêmes valeurs que l\'entrée `{5097, 72395713, "CD", 372}` de `detection.cpp` de ScummVM (CD v0.0372).' % (os.path.getsize(dsk_o), nb_origine),
            '- SHA-256 de l\'archive : `sky.dsk` `%s`, `sky.dnr` `%s`, `sky.cpt` `%s`.' % (sha(dsk_o, True), sha(dnr_o, True), sha(cpt_o, True)),
            '- Index : les fichiers se suivent dans l\'ordre de l\'index (0 à 15 octets de remplissage devant les positions alignées sur 16, aucun devant les autres), le dernier finit à la fin de `sky.dsk`.',
            '- `sky.dsk` et `sky.dnr` reconstruits : mêmes drapeaux, même mode de position (alignée `<< 4` ou brute) et même ordre ; **chacun des %d fichiers hors voix est identique à celui de l\'archive** (octets stockés et contenu décompressé, comparés par `split_dsk.py check`).' % (NB_ENTREES - NB_VOIX),
            '- Voix : décompressées en RNC méthode 1 (CRC de l\'entrée et de la sortie valides), en-tête de 22 octets retiré, `s_tot_size - 22` octets conservés.',
            '- `sky.cpt` : copié tel quel (419 427 octets). Contrôle fait en vague X par régénération avec `devtools/skycpt/` de ScummVM (compilé hors dépôt, `COMPACT.TXT` en entrée) : les 357 685 premiers octets sont identiques ; les 61 742 derniers (données de remise à zéro) ne sont pas régénérables sans les sept `RESET.nnn` (voir `formats.md` § 4). `skycpt` n\'est pas porté.']),
        ('Régénérer', ['```', 'bash scripts/bass-extract.sh', '```', '',
                       'Archive par défaut : `archives/bass/bass-cd-1.2.zip` (non versionnée). Outils requis : `bsdtar`, `python3`, `ffmpeg` (`libmp3lame`).']),
    ]
    ec.rendre_inventaire(sortie, 'Inventaire des fichiers de Beneath a Steel Sky', 'scripts/bass-extract.sh', sections)


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in ('decouper', 'check', 'inventaire'):
        sys.exit(__doc__)
    {'decouper': cmd_decouper, 'check': cmd_check, 'inventaire': cmd_inventaire}[sys.argv[1]](*sys.argv[2:])
