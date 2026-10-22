import zlib, struct
def write_png(path, w, h, idx, pal, trans=None):
    """idx: bytes w*h palette indices; pal: 768 bytes RGB (8-bit)."""
    def chunk(t, b): return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b))
    raw = b''.join(b'\0' + idx[y*w:(y+1)*w] for y in range(h))
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 3, 0, 0, 0))
    out += chunk(b'PLTE', bytes(pal[:768]))
    if trans is not None:
        out += chunk(b'tRNS', bytes(255 if i != trans else 0 for i in range(256)))
    out += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(out)
