import sys, struct, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import write_png

def images(d):
    h = struct.unpack_from('<6I', d, 0)
    t = h[1]
    first = struct.unpack_from('<I', d, t)[0]
    offs = [struct.unpack_from('<I', d, t + 4 * i)[0] for i in range(first // 4)]
    for o in offs:
        p = t + o
        flags = 0; w16, hgt = d[p], d[p+1]; p += 2
        w = w16 * 16; px = bytearray(w * hgt); x = y = 0
        for y in range(hgt):
            nsp = d[p]; p += 1; x = 0
            for _ in range(nsp):
                skip, n4, n1 = d[p], d[p+1], d[p+2]; p += 3
                n = 4 * n4 + n1; x += skip
                px[y*w + x:y*w + x + n] = d[p:p+n]; p += n; x += n
            p += 1  # end gap (= w - x)
        yield flags, w, hgt, bytes(px)

if __name__ == '__main__':
    d = open(sys.argv[1], 'rb').read(); pal = open(sys.argv[2], 'rb').read()[2:770]
    ims = list(images(d))
    W = 640; x = y = rowh = 0; place = []
    for f, w, h, px in ims:
        if x + w > W: x, y, rowh = 0, y + rowh + 2, 0
        place.append((x, y)); x += w + 2; rowh = max(rowh, h)
    H = y + rowh; sheet = bytearray(W * H)
    for (f, w, h, px), (ox, oy) in zip(ims, place):
        for r in range(h): sheet[(oy+r)*W+ox:(oy+r)*W+ox+w] = px[r*w:(r+1)*w]
    write_png(sys.argv[3], W, H, bytes(sheet), pal)
    print(len(ims), 'images', [(w, h, f) for f, w, h, _ in ims][:12])
