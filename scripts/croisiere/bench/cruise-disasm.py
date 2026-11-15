#!/usr/bin/env python3
"""Desassembleur des scripts Cruise ecrits par CRUISE_DUMP_OVL : cruise-disasm.py DOSSIER NOM (ex. XX2.p2 ou XX2.r7)."""
import sys, struct, re, os
names = [l.strip().strip(',').strip('"') for l in open(os.path.join(os.path.dirname(__file__), 'func-names.txt'))]
d, n = sys.argv[1], sys.argv[2]
b = open(f'{d}/{n}.bin', 'rb').read()
hdr = dict(kv.split('=') for kv in open(f'{d}/{n}.txt').read().split())
end = int(hdr['import']) if int(hdr['numReloc']) else len(b)
u16 = lambda o: struct.unpack('>H', b[o:o+2])[0]
s16 = lambda o: struct.unpack('>h', b[o:o+2])[0]
pc = 0
def mem(t, ovl, off, sz):
    sp = t & 7
    return f"{'w' if sz==1 else 'b'}[sp{sp}{'@'+str(ovl) if ovl else ''}+{off}]"
while pc < end:
    ip = pc; op = b[pc]; pc += 1
    idx = (op & 0xFB) >> 3; sub = op & 7
    if idx == 1:
        if sub == 0: t = f"PUSH {s16(pc)}"; pc += 2
        elif sub in (1, 5):
            t = f"LOAD {mem(b[pc], b[pc+1], s16(pc+2), (b[pc]>>3)&3)}{'+idx' if sub==5 else ''} (type={b[pc]:#x})"; pc += 4
        elif sub == 2: t = f"LOADOBJ param={b[pc]} ovl={b[pc+1]} obj={s16(pc+2)}"; pc += 4
        else: t = f"?LOAD{sub}"
    elif idx == 2:
        if sub == 0: t = "POP"
        elif sub in (1, 5):
            t = f"STORE {mem(b[pc], b[pc+1], s16(pc+2), (b[pc]>>3)&3)}{'+idx' if sub==5 else ''} (type={b[pc]:#x})"; pc += 4
        elif sub == 2: t = f"SETOBJ mode={b[pc]} ovl={b[pc+1]} obj={s16(pc+2)}"; pc += 4
        elif sub == 4: t = "SAVEIDX"
        else: t = f"?STORE{sub}"
    elif idx == 3:
        if sub in (1, 5):
            t = f"ADDR {mem(b[pc], b[pc+1], s16(pc+2), (b[pc]>>3)&3)}{'+idx' if sub==5 else ''} (type={b[pc]:#x})"; pc += 4
        else: t = f"?ADDR{sub}"
    elif idx == 4: t = "MATH " + ['add', 'div', 'sub', 'mul', 'mod', 'or', 'and', 'or'][sub]
    elif idx == 5: t = "CMP " + ['!=', '==', '<', '<=', '>', '>='][sub] if sub < 6 else "?CMP"
    elif idx == 6:
        o = s16(pc); pc += 2
        t = f"J{['NZ','Z','P','NN','NEG','NP','NEVER','ALWAYS'][sub]} -> {pc - 2 + o}"
    elif idx == 7: t = "CCR"
    elif idx == 8: t = "SWAP"
    elif idx == 9:
        f = b[pc]; pc += 1
        t = f"CALL {f:#04x} {names[f] if f < len(names) else '?'}"
    elif idx == 10: t = "STOP"
    elif idx == 11: t = "NOP"
    elif idx == 12: t = "YIELD"
    else: t = f"?? {op:#x}"
    print(f"{ip:5d}: {t}")
if int(hdr['numReloc']):
    io = int(hdr['import']); inm = int(hdr['importName'])
    print(f"-- imports ({hdr['numReloc']}) at {io}, names at {inm}:")
    for i in range(int(hdr['numReloc'])):
        e = b[io+i*10: io+i*10+10]
        print(' ', struct.unpack('>5H', e), b[inm:].split(b'\0')[0:6] if i == 0 else '')
