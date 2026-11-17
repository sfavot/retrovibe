"""Génère test/asterix/data/lzma-vectors.ts : les vecteurs de test du décodeur LZMA (src/data/lzma.ts) et du lecteur
de conteneur vidéo (src/games/asterix/data/video.ts), compressés par le module `lzma` de Python.

Usage : python3 -I scripts/asterix/lzma_vectors.py > test/asterix/data/lzma-vectors.ts
Les données en clair ne sont pas dans le fichier généré : le test les reconstruit avec les mêmes règles (voir
`test/asterix/data/lzma.test.ts` et `video.test.ts`) et compare ; le SHA-1 attendu est donné en plus.
"""
import base64
import hashlib
import lzma
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I : pas de PYTHONPATH
import video  # noqa: E402

TEXTE = ('Nous sommes en 50 avant Jésus-Christ. Toute la Gaule est occupée par les Romains… Toute ? Non ! '
         'Un village peuplé d\'irréductibles Gaulois résiste encore et toujours à l\'envahisseur.').encode('utf-8')


def lcg(graine, n):
    """Octets pseudo-aléatoires : x = (x × 1103515245 + 12345) mod 2^31, octet = bits 16 à 23."""
    out = bytearray()
    x = graine
    for _ in range(n):
        x = (x * 1103515245 + 12345) & 0x7FFFFFFF
        out.append((x >> 16) & 0xFF)
    return bytes(out)


def fenetre():
    """40 fois le même motif de 1 500 octets, un octet inversé par copie : avec un dictionnaire de 4 096 octets, la
    fenêtre circulaire du décodeur fait une quinzaine de tours."""
    motif = lcg(2, 1500)
    out = bytearray()
    for i in range(40):
        copie = bytearray(motif)
        copie[i] ^= 0xFF
        out += copie
    return bytes(out)


def series():
    """Longues séries (correspondances de 273 octets, répétitions de distance) et un peu de bruit."""
    return bytes(70000) + b'abc' * 1000 + bytes([7]) * 5000 + lcg(3, 200) + bytes(300)


def contextes():
    """Enregistrements de 4 octets : compteur, 2 bits, zéro, 4 bits (met en jeu lp et pb)."""
    bruit = lcg(4, 10000)
    out = bytearray()
    for i in range(5000):
        out += bytes((i & 0xFF, bruit[2 * i] & 3, 0, bruit[2 * i + 1] & 0x0F))
    return bytes(out)


def alone(donnees, **filtre):
    f = {'id': lzma.FILTER_LZMA1, 'preset': 6}
    f.update(filtre)
    return lzma.compress(donnees, format=lzma.FORMAT_ALONE, filters=[f])


def taille_connue(donnees, lc=3, lp=0, pb=2, dictionnaire=1 << 16):
    """En-tête « alone » avec la taille décompressée, comme en écrit le SDK LZMA. liblzma termine quand même le flux
    LZMA1 par un marqueur de fin : le décodeur doit s'arrêter à la taille annoncée, sans avoir à le lire."""
    brut = lzma.compress(donnees, format=lzma.FORMAT_RAW,
                         filters=[{'id': lzma.FILTER_LZMA1, 'preset': 6, 'lc': lc, 'lp': lp, 'pb': pb,
                                   'dict_size': dictionnaire}])
    return bytes(((pb * 5 + lp) * 9 + lc,)) + struct.pack('<IQ', dictionnaire, len(donnees)) + brut


def conteneur():
    """Petit conteneur vidéo de 4 images, construit sans passer par un MUX (voir video.test.ts pour le contenu attendu)."""
    e = video.Ecrivain(video.ORIGINE_MUK, 9039, 18867)
    # Image 0 : tout écrit (pixel i = i mod 251), palette (octet i = i mod 256), marqueurs « 1 » et « -1 ».
    e.pixels[:] = bytes(i % 251 for i in range(video.PIXELS))
    e.ecrits[:] = b'\x01' * video.PIXELS
    e.video = True
    e.palette = bytes(i % 256 for i in range(768))
    e.marqueurs = [b'1', b'-1']
    e.audio = 6860
    e.fin_image(0)
    # Image 1 : pas de bloc vidéo.
    e.audio = 13720
    e.fin_image(1)
    # Image 2 : la ligne 10 écrite à 200 (pixels 3200 à 3519) ; le pixel 7 est « écrit » sans changer de valeur.
    # Valeurs de type 0 et champ MUK.
    e.pixels[3200:3520] = bytes([200]) * 320
    e.ecrits[3200:3520] = b'\x01' * 320
    e.ecrits[7] = 1
    e.video = True
    e.valeurs = [0x1234, 7]
    e.champ = 0xDEADBEEF
    e.fin_image(2)
    # Image 3 : bloc vidéo qui n'écrit aucun pixel, nouvelle palette (octet i = 255 − i mod 256).
    e.video = True
    e.palette = bytes(255 - i % 256 for i in range(768))
    e.fin_image(770)
    return e.compresse()


VECTEURS = [
    ('vide', b'', alone(b'')),
    ('texte', TEXTE, alone(TEXTE)),
    ('aleatoire', lcg(1, 3000), alone(lcg(1, 3000))),
    ('fenetre', fenetre(), alone(fenetre(), dict_size=4096)),
    ('series', series(), alone(series(), preset=9 | lzma.PRESET_EXTREME)),
    ('contextes-lc1-lp2-pb1', contextes(), alone(contextes(), lc=1, lp=2, pb=1)),
    ('contextes-lc0-lp4-pb4', contextes(), alone(contextes(), lc=0, lp=4, pb=4)),
    ('taille-connue', series(), taille_connue(series())),
    ('taille-connue-lc4-pb0', contextes(), taille_connue(contextes(), lc=4, lp=0, pb=0, dictionnaire=4096)),
]


def main():
    print('// Généré par scripts/asterix/lzma_vectors.py (ne pas éditer à la main).')
    print('// Flux LZMA « alone » produits par le module lzma de Python, en base64 ; sha1 = SHA-1 des données en clair.')
    print()
    print('export interface LzmaVector {\n  name: string;\n  length: number;\n  sha1: string;\n  base64: string;\n}\n')
    print('export const LZMA_VECTORS: LzmaVector[] = [')
    for nom, clair, compresse in VECTEURS:
        assert lzma.decompress(compresse, format=lzma.FORMAT_ALONE) == clair, nom
        print('  {\n    name: "%s",\n    length: %d,\n    sha1: "%s",\n    base64: "%s",\n  },'
              % (nom, len(clair), hashlib.sha1(clair).hexdigest(), base64.b64encode(compresse).decode('ascii')))
    print('];\n')
    print('/** Conteneur vidéo de 4 images (`conteneur()` du script). */')
    print('export const VIDEO_VECTOR = "%s";' % base64.b64encode(conteneur()).decode('ascii'))


if __name__ == '__main__':
    main()
