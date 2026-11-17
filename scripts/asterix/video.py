"""Vidéos d'Astérix : décodage des MUX et des MUK d'origine, écriture du conteneur maison `.vid`.

Module importé par extract_utils.py (python3 -I). Formats : docs/asterix/formats.md.

Le décodeur suit pas à pas `src/games/teleportaschtroumpf/data/mux.ts` (même code machine dans ASTERIX.EXE, `2b17`),
et il est strict : un flux épuisé, un drapeau ou un bloc inconnu arrêtent l'extraction.

Conteneur `.vid` (little-endian), compressé d'un bloc en LZMA « alone » :
  en-tête de 24 octets : "AVID", u16 version (1), u8 origine (0 = MUX, 1 = MUK), u8 0, u16 largeur, u16 hauteur,
    u16 diviseur du PIT (0 pour un MUK), u16 fréquence audio (0 = muet), u32 échantillons audio, u32 nombre d'images ;
  puis, par image : u8 drapeaux, u16 numéro, u32 échantillons audio lus avant la fin de l'image, et selon les drapeaux :
    0x01 palette (768 octets) ; 0x10 marqueurs (u8 nombre, puis u8 longueur + octets) ; 0x20 valeurs de type 0 d'un MUK
    (u8 nombre, puis u16) ; 0x40 u32 du second champ d'un enregistrement MUK ; 0x04 masque (largeur × hauteur / 8 octets,
    bit de poids fort d'abord, 1 = pixel écrit par le bloc vidéo) ; 0x02 différence (largeur × hauteur octets : XOR
    avec l'image précédente, la première étant comparée à une image nulle).
  0x08 : l'image avait un bloc vidéo. Sans 0x04, ce bloc écrit tous les pixels ; sans 0x08, aucun.
"""
import lzma
import struct

LARGEUR, HAUTEUR = 320, 200
PIXELS = LARGEUR * HAUTEUR
MAGIE = b'AVID'
VERSION = 1
ORIGINE_MUX, ORIGINE_MUK = 0, 1
D_PALETTE, D_DIFF, D_MASQUE, D_VIDEO, D_MARQUEURS, D_VALEURS, D_CHAMP = 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40
# Dictionnaire de 8 Mio au plus (mesuré sur les 148 vidéos : 23,8 Mio, contre 28,7 Mio à 1 Mio), ramené à la puissance de
# deux qui couvre le fichier quand il est plus petit : le décodeur du navigateur alloue une fenêtre de cette taille.
DICTIONNAIRE_MAX = 1 << 23


def _filtres(taille):
    dictionnaire = 1 << 12
    while dictionnaire < taille and dictionnaire < DICTIONNAIRE_MAX:
        dictionnaire <<= 1
    return [{'id': lzma.FILTER_LZMA1, 'preset': 9 | lzma.PRESET_EXTREME, 'dict_size': dictionnaire,
             'lc': 3, 'lp': 0, 'pb': 2}]


_BITS = bytes.maketrans(b'\x00\x01', b'01')


class Erreur(Exception):
    pass


class _Flux:
    """Bits, quartets et octets d'un flux : bits par mots u32 little-endian lus du poids fort au poids faible ; un
    quartet est le poids fort d'un octet, son poids faible servant au quartet suivant (il survit aux lectures d'octet)."""

    def __init__(self, donnees, debut, fin):
        self.b, self.p, self.fin = donnees, debut, fin
        self.bits = self.nb = 0
        self.quartet = -1

    def octet(self):
        if self.p >= self.fin:
            raise Erreur('flux vidéo épuisé')
        v = self.b[self.p]
        self.p += 1
        return v

    def demi(self):
        if self.quartet >= 0:
            v, self.quartet = self.quartet, -1
            return v
        v = self.octet()
        self.quartet = v & 15
        return v >> 4

    def bit(self):
        if self.nb == 0:
            if self.p + 4 > self.fin:
                raise Erreur('flux vidéo épuisé')
            self.bits, = struct.unpack_from('<I', self.b, self.p)
            self.p += 4
            self.nb = 32
        self.nb -= 1
        return (self.bits >> self.nb) & 1


def _lz(src, debut, attendu):
    """Décompresse le LZ d'un bloc vidéo (voir mux.ts `unpack`) ; retourne les octets produits."""
    fin = len(src)
    out = bytearray()
    p = debut
    quartet = -1
    while p < fin and len(out) < attendu:
        if p + 4 > fin:
            raise Erreur('flux LZ tronqué')
        drapeaux, = struct.unpack_from('<I', src, p)
        p += 4
        while True:
            bit = drapeaux >> 31
            drapeaux = (drapeaux << 1) & 0xFFFFFFFF
            if not drapeaux:
                break
            if not bit:
                if p >= fin:
                    raise Erreur('flux LZ tronqué')
                decalage = src[p]
                p += 1
            if quartet >= 0:
                q, quartet = quartet, -1
            else:
                if p >= fin:
                    raise Erreur('flux LZ tronqué')
                q, quartet = src[p] >> 4, src[p] & 15
                p += 1
            if bit:
                out += src[p:p + q + 1]
                p += q + 1
            else:
                if decalage == 0 or decalage > len(out):
                    raise Erreur('copie LZ hors fenêtre')
                for _ in range(q + 2):
                    out.append(out[-decalage])
            if p >= fin:
                break
    return out


def decoder_bloc(bloc, pixels, ecrits):
    """Applique un bloc vidéo (en-tête de 13 octets compris) à `pixels` ; met à 1 dans `ecrits` les pixels écrits."""
    if len(bloc) < 13:
        raise Erreur('bloc vidéo trop court')
    drapeaux, depart, t_bits, t_couleurs = struct.unpack_from('<BIII', bloc, 0)
    if drapeaux & ~6:
        raise Erreur('drapeau vidéo %#x inconnu' % drapeaux)
    if drapeaux & 4:
        donnees = _lz(bloc, 13, t_bits + t_couleurs)
        d0, fin = 0, len(donnees)
    else:
        donnees, d0, fin = bloc, 13, len(bloc)
    ctl = _Flux(donnees, d0, min(d0 + t_bits, fin))
    coul = _Flux(donnees, d0 + t_bits, min(d0 + t_bits + t_couleurs, fin))
    inter = drapeaux & 2
    p = depart
    bit, demi, octet = ctl.bit, ctl.demi, ctl.octet
    while p < PIXELS:
        if not bit():
            n = 1
        elif not bit():
            n = demi()
            n = n + 4 if n else octet() + 20
        elif not bit():
            n = 2
        elif not bit():
            n = 3
        elif not inter or not bit():
            n = 4
        else:
            p += octet()
            continue
        f = min(p + n, PIXELS)
        c = coul.octet()
        if n == 1:
            pixels[p] = c
            ecrits[p] = 1
        else:
            pixels[p:f] = bytes((c,)) * (f - p)
            ecrits[p:f] = b'\x01' * (f - p)
        p += n
    return drapeaux


class Ecrivain:
    """Construit le conteneur image par image à partir des blocs d'origine."""

    def __init__(self, origine, diviseur, frequence):
        self.origine, self.diviseur, self.frequence = origine, diviseur, frequence
        self.pixels = bytearray(PIXELS)
        self.precedente = bytes(PIXELS)
        self.corps = []
        self.images = 0
        self.audio = 0
        self.hachage = None
        self._neuve()

    def _neuve(self):
        self.palette = None
        self.marqueurs = []
        self.valeurs = []
        self.champ = None
        self.video = False
        self.ecrits = bytearray(PIXELS)

    def bloc_video(self, bloc):
        decoder_bloc(bloc, self.pixels, self.ecrits)
        self.video = True

    def fin_image(self, numero):
        d = 0
        suite = []
        if self.palette is not None:
            d |= D_PALETTE
            suite.append(self.palette)
        if self.marqueurs:
            d |= D_MARQUEURS
            suite.append(bytes((len(self.marqueurs),)) + b''.join(bytes((len(m),)) + m for m in self.marqueurs))
        if self.valeurs:
            d |= D_VALEURS
            suite.append(bytes((len(self.valeurs),)) + b''.join(struct.pack('<H', v) for v in self.valeurs))
        if self.champ is not None:
            d |= D_CHAMP
            suite.append(struct.pack('<I', self.champ))
        courante = bytes(self.pixels)
        diff = None
        if courante != self.precedente:
            d |= D_DIFF
            diff = (int.from_bytes(courante, 'little') ^ int.from_bytes(self.precedente, 'little')).to_bytes(PIXELS, 'little')
            self.precedente = courante
        if self.video:
            d |= D_VIDEO
            if self.ecrits.count(1) != PIXELS:
                d |= D_MASQUE
                suite.append(int(bytes(self.ecrits).translate(_BITS), 2).to_bytes(PIXELS // 8, 'big'))
        if diff is not None:
            suite.append(diff)
        self.corps.append(struct.pack('<BHI', d, numero, self.audio) + b''.join(suite))
        self.images += 1
        if self.hachage is not None:
            self.hachage.update(courante)
        self._neuve()

    def brut(self):
        entete = MAGIE + struct.pack('<HBBHHHHII', VERSION, self.origine, 0, LARGEUR, HAUTEUR, self.diviseur,
                                     self.frequence, self.audio, self.images)
        return entete + b''.join(self.corps)

    def compresse(self):
        brut = self.brut()
        return lzma.compress(brut, format=lzma.FORMAT_ALONE, filters=_filtres(len(brut)))


def convertir_mux(b, hachage=None):
    """MUX -> (conteneur compressé, PCM 8 bits non signé, infos). Voir formats.md pour les blocs."""
    if len(b) < 0x24 or struct.unpack_from('<I', b, 0)[0] != 0xAA07:
        raise Erreur('signature MUX absente')
    diviseur, frequence = struct.unpack_from('<HH', b, 0x0C)
    if struct.unpack_from('<HH', b, 0x1C) != (LARGEUR, HAUTEUR):
        raise Erreur('dimensions inattendues')
    e = Ecrivain(ORIGINE_MUX, diviseur, frequence)
    e.hachage = hachage
    pcm = []
    pos = struct.unpack_from('<I', b, 0x20)[0] & 0x3FFFFFFF
    fin = False
    vides = 0  # blocs 05 sans numéro : remplissage, ignoré (144 dans la dernière image de 07/M07A.MUX)
    en_cours = False  # un bloc autre que du son a été lu depuis la dernière fin d'image
    while pos + 6 <= len(b):
        t, _, taille = struct.unpack_from('<BBI', b, pos)
        debut = pos + 6
        pos = debut + taille
        if pos > len(b):
            raise Erreur('bloc %#x tronqué' % t)
        if t == 0x04:
            fin = True
            break
        if t == 0x05:
            if taille < 2:
                vides += 1
                continue
            e.fin_image(struct.unpack_from('<H', b, debut)[0])
            en_cours = False
            continue
        charge = b[debut:pos]
        if t in (0x06, 0x07):
            # Du son peut suivre la dernière image (36/M36A.MUX) : il reste dans la piste, sans image associée.
            pcm.append(charge)
            e.audio += taille
            continue
        en_cours = True
        if t in (0x65, 0x70):
            if taille < 768:
                raise Erreur('palette trop courte')
            e.palette = charge[:768]
        elif t in (0x64, 0x6F):
            e.bloc_video(charge)
        elif t == 0x08:
            if taille > 255 or len(e.marqueurs) == 255:
                raise Erreur('marqueur trop long')
            e.marqueurs.append(charge)
        else:
            raise Erreur('bloc inconnu %#x' % t)
    if en_cours:
        raise Erreur('palette, image ou marqueur après la dernière fin d\'image')
    if pos != len(b):
        raise Erreur('octets après le bloc de fin')
    if frequence == 0 and e.audio:
        raise Erreur('son sans fréquence')
    infos = {'images': e.images, 'fin': fin, 'vides': vides, 'frequence': frequence, 'diviseur': diviseur,
             'echantillons': e.audio}
    return e.compresse(), b''.join(pcm), infos


def convertir_muk(b, hachage=None):
    """MUK (`19b9:000c`) -> (conteneur compressé, infos). Une image = les enregistrements jusqu'au bloc vidéo compris."""
    e = Ecrivain(ORIGINE_MUK, 0, 0)
    e.hachage = hachage
    pos = 0
    en_cours = False
    while pos < len(b):
        t = b[pos]
        pos += 1
        en_cours = True
        if t == 0:
            if pos + 2 > len(b) or len(e.valeurs) == 255:
                raise Erreur('enregistrement 0 tronqué')
            e.valeurs.append(struct.unpack_from('<H', b, pos)[0])
            pos += 2
        elif t == 1:
            if pos + 768 > len(b):
                raise Erreur('palette tronquée')
            e.palette = b[pos:pos + 768]
            pos += 768
        elif t == 2:
            if pos + 8 > len(b):
                raise Erreur('enregistrement 2 tronqué')
            taille, e.champ = struct.unpack_from('<II', b, pos)
            pos += 8
            if pos + taille > len(b):
                raise Erreur('bloc vidéo tronqué')
            e.bloc_video(b[pos:pos + taille])
            pos += taille
            e.fin_image(e.images)
            en_cours = False
        else:
            raise Erreur('enregistrement %d inconnu' % t)
    if en_cours:
        raise Erreur('enregistrements sans image en fin de fichier')
    return e.compresse(), {'images': e.images}


def lire(conteneur):
    """Relit un conteneur (contrôle d'aller-retour) : génère (drapeaux, numéro, audio, pixels) par image."""
    brut = lzma.decompress(conteneur, format=lzma.FORMAT_ALONE)
    if brut[:4] != MAGIE:
        raise Erreur('conteneur : signature absente')
    version, _, _, largeur, hauteur, _, _, _, images = struct.unpack_from('<HBBHHHHII', brut, 4)
    if version != VERSION or (largeur, hauteur) != (LARGEUR, HAUTEUR):
        raise Erreur('conteneur : en-tête inattendu')
    pos = 24
    pixels = bytes(PIXELS)
    for _ in range(images):
        d, numero, audio = struct.unpack_from('<BHI', brut, pos)
        pos += 7
        if d & D_PALETTE:
            pos += 768
        if d & D_MARQUEURS:
            n = brut[pos]
            pos += 1
            for _ in range(n):
                pos += 1 + brut[pos]
        if d & D_VALEURS:
            pos += 1 + 2 * brut[pos]
        if d & D_CHAMP:
            pos += 4
        if d & D_MASQUE:
            pos += PIXELS // 8
        if d & D_DIFF:
            x = int.from_bytes(brut[pos:pos + PIXELS], 'little') ^ int.from_bytes(pixels, 'little')
            pixels = x.to_bytes(PIXELS, 'little')
            pos += PIXELS
        yield d, numero, audio, pixels
    if pos != len(brut):
        raise Erreur('conteneur : octets en trop')
