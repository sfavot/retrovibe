#!/usr/bin/env python3
"""idx2png.py fr-NNNN.idx [...] : convertit chaque capture (.idx 64000 indices + .pal 768 octets) en .png 640x400 (ffmpeg requis)."""
import sys, subprocess
for f in sys.argv[1:]:
    idx = open(f, 'rb').read(); pal = open(f[:-4] + '.pal', 'rb').read()
    ppm = b'P6\n320 200\n255\n' + b''.join(pal[i*3:i*3+3] for i in idx)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-i', '-', '-vf', 'scale=640:400:flags=neighbor', f[:-4] + '.png'], input=ppm, check=True)
