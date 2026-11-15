#!/usr/bin/env python3
"""cruise-checkpoints.py TRACE STEPS > checkpoints.txt

Points de controle de la partie complete (vague K) : TRACE = cruise.trace du banc (niveau 1, CRUISE_VARHASH : lignes FR, MF, VH, SC),
STEPS = steps.txt de test/croisiere/solution/bench-record.test.ts (`rang phase etape tour`). Pour chaque tour de fin d'etape (distinct) :
`tour trace sc`, ou trace = sha1 (12 chiffres) des lignes FR/MF/VH numerotees du tour suivant le point precedent a ce tour, et sc = la
ligne SC du tour (CRC32 de l'image et de la palette, sans le numero).
Le meme calcul est refait par test/croisiere/solution/scummvm-replay.test.ts sur la trace du portage.
"""
import hashlib
import sys

trace_path, steps_path = sys.argv[1], sys.argv[2]
cps = sorted({int(l.split()[3]) for l in open(steps_path) if l.strip()})
out = []
k = 0
h = hashlib.sha1()
sc = {}
for line in open(trace_path, encoding='latin-1'):
    tag = line[:2]
    if tag not in ('FR', 'MF', 'VH', 'SC'):
        continue
    n = int(line.split(' ', 2)[1])
    while k < len(cps) and n > cps[k]:
        out.append((cps[k], h.hexdigest()[:12]))
        h = hashlib.sha1()
        k += 1
    if k == len(cps):
        break
    if tag == 'SC':
        if n == cps[k]:
            sc[n] = line.split(' ', 2)[2].strip()
        continue
    h.update(line.rstrip('\n').encode('latin-1') + b'\n')
if k < len(cps):
    out.append((cps[k], h.hexdigest()[:12]))
print('# Banc ScummVM (cruise-fr, graine 1, temps virtuel, contournement de la protection) rejouant scummvm-inputs.txt : un point de controle par fin d\'etape de la solution.')
print('# tour, trace (sha1, 12 chiffres, des lignes FR, MF et VH du tour suivant le point precedent a ce tour), SC du tour (CRC32 image et palette)')
for n, digest in out:
    print(n, digest, sc.get(n, '-'))
