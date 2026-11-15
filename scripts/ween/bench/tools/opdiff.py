# Compare les suites OP+DL (image, tot, position | attente) du banc et du portage.
import sys
def load(p):
    out = []
    for line in open(p, 'rb'):
        q = line.decode('latin1').split()
        if not q: continue
        if q[0] == 'OP': out.append(('OP', int(q[1]), q[2].upper(), int(q[3])))
        elif q[0] == 'DL': out.append(('DL', int(q[1]), int(q[2]), int(q[3])))
    return out
b, p = load(sys.argv[1]), load(sys.argv[2])
for i in range(min(len(b), len(p))):
    if b[i] != p[i]:
        print('écart', i)
        for j in range(max(0, i - 8), min(i + 8, len(b), len(p))): print('  B', b[j], '| P', p[j])
        break
else: print('identiques', min(len(b), len(p)), len(b), len(p))
