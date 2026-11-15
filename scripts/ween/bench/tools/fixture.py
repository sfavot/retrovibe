# Fixture compacte d'une trace du banc : <nom>.tt.json (TT, PS) et <nom>.vh.gz (VH masqué, uint32 LE par image).
# Usage : fixture.py tt.txt vh.txt NOM DERNIERE_IMAGE (tt.txt et vh.txt viennent de ween-replay.sh avec DUMP ; vh.txt en hexadécimal).
import sys, json, gzip, struct
log, mvh, out, last = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
tots, skipped = [], []
for line in open(log, 'rb'):
    p = line.decode('latin1').split()
    if not p: continue
    if p[0] == 'TT' and int(p[1]) <= last: tots.append([int(p[1]), p[2].upper()])
    if p[0] == 'PS' and int(p[1]) <= last: skipped.append([int(p[1]), p[2].upper(), int(p[3])])
json.dump({"tots": tots, "skipped": skipped}, open(out + '.tt.json', 'w'))
vh = {}
for line in open(mvh):
    n, h = line.split(); vh[int(n)] = int(h, 16)
buf = b''.join(struct.pack('<I', vh[n]) for n in range(1, last + 1))
open(out + '.vh.gz', 'wb').write(gzip.compress(buf, 9, mtime=0))
