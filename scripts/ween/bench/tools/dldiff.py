# Compare les attentes DL (banc : GOB_TRACE=3 ; portage : zz-debug) : affiche le premier écart et le contexte.
import sys
def load(p, lo, hi):
    out = []
    for line in open(p, 'rb'):
        if not line.startswith(b'DL '): continue
        q = line.decode('latin1').split()
        n = int(q[1])
        if lo <= n <= hi: out.append((n, int(q[2]), int(q[3]), q[4].upper(), q[5] if len(q) > 5 else ''))
    return out
lo, hi = int(sys.argv[3]), int(sys.argv[4])
b, p = load(sys.argv[1], lo, hi), load(sys.argv[2], lo, hi)
for i in range(min(len(b), len(p))):
    if b[i][:4] != p[i][:4]:
        print('premier écart à l\'indice', i)
        for j in range(max(0, i - 6), min(i + 12, max(len(b), len(p)))):
            print('  B', b[j] if j < len(b) else '-', '| P', p[j] if j < len(p) else '-')
        break
else:
    print('identiques sur', min(len(b), len(p)), 'attentes ; longueurs', len(b), len(p))
