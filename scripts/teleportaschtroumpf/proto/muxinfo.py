import sys, struct, collections
d = open(sys.argv[1], 'rb').read()
sig, hs, n, u2, u3, rate, freq, vbs, sbs, cbs, nsb, w, h = struct.unpack_from('<IHHHHHHIHIHHH', d, 0)
print(dict(sig=hex(sig), hs=hs, n=n, u2=u2, u3=u3, rate=rate, freq=freq, vbs=vbs, sbs=sbs, cbs=cbs, nsb=nsb, w=w, h=h))
offs = struct.unpack_from('<%dI' % n, d, 0x20)
print('first offs', [hex(o) for o in offs[:4]], 'last', hex(offs[-1]))
p = offs[0] & 0x3fffffff
types = collections.Counter(); flags = collections.Counter(); shown = 0
while p + 6 <= len(d):
    t, st, sz = d[p], d[p+1], struct.unpack_from('<I', d, p+2)[0]
    types[(t, st)] += 1
    if t in (0x64, 0x6f):
        flags[d[p+6]] += 1
        if shown < 3: print('video', hex(t), st, sz, d[p+6:p+19].hex(' ')); shown += 1
    if t == 4: break
    p += 6 + sz
print('types', {f'{k[0]:02x}/{k[1]}': v for k, v in types.items()}, 'vflags', dict(flags), 'end', p, len(d))
