import sys, struct, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import write_png

class Reader:
    def __init__(s, b, p=0): s.b, s.p, s.bits, s.nbits, s.nib = b, p, 0, 0, None
    def byte(s):
        v = s.b[s.p]; s.p += 1; return v
    def u32(s):
        v = struct.unpack_from('<I', s.b, s.p)[0]; s.p += 4; return v
    def nibble(s):
        if s.nib is not None:
            v, s.nib = s.nib, None; return v
        v = s.byte(); s.nib = v & 15; return v >> 4
    def bit(s):
        if s.nbits == 0: s.bits, s.nbits = s.u32(), 32
        s.nbits -= 1; return (s.bits >> s.nbits) & 1

def unlz(src, outlen):
    r, out = Reader(src), bytearray()
    while r.p < len(src) and len(out) < outlen:
        flags = r.u32()
        while True:
            bit = flags >> 31; flags = (flags << 1) & 0xffffffff
            if not flags: break
            if bit:
                n = r.nibble() + 1
                out += src[r.p:r.p+n]; r.p += n
            else:
                off = r.byte(); n = r.nibble() + 2
                for _ in range(n): out.append(out[-off])
            if r.p >= len(src): break
    return bytes(out)

def decode(fb, payload, w, h):
    flags = payload[0]
    start, bsz, csz = struct.unpack_from('<III', payload, 1)
    data = payload[13:]
    if flags & 4: data = unlz(data, bsz + csz)
    elif flags & 1: raise NotImplementedError('partial LZ')
    ctl, col = Reader(data[:bsz]), Reader(data[bsz:bsz+csz])
    inter = flags & 2
    p, end = start, w * h
    while p < end:
        if not ctl.bit(): n = 1
        elif not ctl.bit():
            n = ctl.nibble(); n = n + 4 if n else ctl.byte() + 20
        elif not ctl.bit(): n = 2
        elif not ctl.bit(): n = 3
        elif not inter or not ctl.bit(): n = 4
        else:
            p += ctl.byte(); continue
        c = col.byte(); fb[p:p+n] = bytes([c]) * n; p += n

def frames(path):
    d = open(path, 'rb').read()
    n = struct.unpack_from('<H', d, 6)[0]; w, h = struct.unpack_from('<HH', d, 0x1c)
    p = struct.unpack_from('<I', d, 0x20)[0] & 0x3fffffff
    fb, pal, audio, i = bytearray(w * h), bytes(768), bytearray(), 0
    while p + 6 <= len(d):
        t, sz = d[p], struct.unpack_from('<I', d, p + 2)[0]; body = d[p+6:p+6+sz]
        if t in (0x65, 0x70): pal = body[:768]
        elif t in (0x64, 0x6f): decode(fb, body, w, h)
        elif t in (6, 7): audio += body
        elif t == 5: yield i, w, h, bytes(fb), pal; i += 1
        elif t == 4: break
        p += 6 + sz
    frames.audio = bytes(audio)

if __name__ == '__main__':
    src, outdir, want = sys.argv[1], sys.argv[2], set(map(int, sys.argv[3].split(',')))
    for i, w, h, fb, pal in frames(src):
        if i in want: write_png(f'{outdir}/f{i:04d}.png', w, h, fb, pal)
    print('audio bytes', len(frames.audio))
