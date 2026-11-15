# Compare les vidages DV du banc et du portage : variables différentes par image (hors date 5-11).
import sys
def load(path, lo, hi):
    out = {}
    for line in open(path, 'rb'):
        if not line.startswith(b'DV '): continue
        p = line.decode('latin1').split()
        n = int(p[1])
        if lo <= n <= hi:
            extra = ''
            if 'T' in p: k = p.index('T'); extra = ' '.join(p[k:]); p = p[:k]
            out[n] = ([int(x) for x in p[2:]], extra)
    return out
bench = load(sys.argv[1], int(sys.argv[3]), int(sys.argv[4]))
port = load(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
shown = 0
for n in sorted(set(bench) | set(port)):
    if n not in bench or n not in port: print(n, 'absent', n in bench, n in port); continue
    b, _ = bench[n]; q, extra = port[n]
    d = [(i, b[i], q[i]) for i in range(max(len(b), len(q))) if not (5 <= i <= 11) and (b[i] if i < len(b) else None) != (q[i] if i < len(q) else None)]
    if d:
        print(n, extra, 'len', len(b), len(q), d[:12]); shown += 1
        if shown > int(sys.argv[5] if len(sys.argv) > 5 else 10): break
