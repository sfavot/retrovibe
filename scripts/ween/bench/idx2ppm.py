# idx2ppm.py FICHIER.idx [LARGEUR] : FICHIER.idx (indices bruts) + FICHIER.pal (768 octets, 0-255) -> FICHIER.ppm
import sys
p = sys.argv[1]; w = int(sys.argv[2]) if len(sys.argv) > 2 else 320
idx = open(p, 'rb').read(); pal = open(p[:-4] + '.pal', 'rb').read()
h = len(idx) // w
with open(p[:-4] + '.ppm', 'wb') as f:
    f.write(b'P6\n%d %d\n255\n' % (w, h))
    f.write(bytes(b for i in idx for b in pal[3 * i:3 * i + 3]))
