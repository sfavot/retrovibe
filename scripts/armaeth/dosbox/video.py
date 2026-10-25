#!/usr/bin/env python3
"""Outils d'analyse des vidéos du banc d'essai (run.sh). Bibliothèque standard + ffmpeg.

Les instants sont ceux de la vidéo (image n = n / 70,0866 s d'émulation) ; les coordonnées sont celles du jeu
(320 x 200 ; la vidéo fait 640 x 400, chaque pixel du jeu est doublé).

  video.py events VIDEO [T0 T1] [--thr N]          instants où l'image change beaucoup (fenêtre, salle, écran)
  video.py track  VIDEO T0 T1 X0 Y0 X1 Y1 [--rgb R G B --tol N]
                                                    centroïde des pixels de la couleur donnée (défaut : la tunique
                                                    rouge du héros) ; une ligne par changement, avec le nombre
                                                    d'images depuis le changement précédent
  video.py frame  VIDEO T OUT.png [--crop X Y W H] [--scale N]
  video.py sheet  VIDEO T0 T1 STEP OUT.png [--cols N] [--width PX] [--crop X Y W H]
                                                    planche contact : une image toutes les STEP s, de gauche à droite
  video.py patch  VIDEO T X Y [W H]                 couleur moyenne (R G B) d'un rectangle, pour mesurer la lumière
"""
import argparse
import subprocess
import sys

FPS = 70.0866  # fréquence de retour vertical du mode 13h
W, H = 320, 200


def ffmpeg_raw(video, t0, t1, vf):
    cmd = ["ffmpeg", "-loglevel", "error"]
    if t0 is not None:
        cmd += ["-ss", str(t0)]
    if t1 is not None:
        cmd += ["-t", str(t1 - (t0 or 0))]
    cmd += ["-i", video, "-vf", vf, "-f", "rawvideo", "-"]
    return subprocess.run(cmd, capture_output=True, check=True).stdout


def cmd_events(a):
    """Différence moyenne entre images successives (gris, 160 x 100), calculée par ffmpeg ; somme = moyenne x 16000."""
    import os
    import tempfile
    fd, path = tempfile.mkstemp(suffix=".txt")
    os.close(fd)
    cmd = ["ffmpeg", "-loglevel", "error"]
    if a.t0 is not None:
        cmd += ["-ss", str(a.t0)]
    if a.t1 is not None:
        cmd += ["-t", str(a.t1 - (a.t0 or 0))]
    cmd += ["-i", a.video, "-vf",
            "crop=640:400:0:0,scale=160:100,format=gray,tblend=all_mode=difference,signalstats,"
            f"metadata=print:key=lavfi.signalstats.YAVG:file={path}", "-f", "null", "-"]
    subprocess.run(cmd, check=True)
    base = a.t0 or 0
    frame = None
    for line in open(path):
        if line.startswith("frame:"):
            frame = int(line.split()[0].split(":")[1])
        elif "YAVG=" in line and frame is not None and frame > 0:  # l'image 0 est comparée à du noir
            s = float(line.split("=")[1]) * 160 * 100
            if s > a.thr:
                print(f"{base + frame / FPS:8.2f} s  image {frame:6d}  diff {s:.0f}")
    os.unlink(path)


def cmd_track(a):
    d = ffmpeg_raw(a.video, a.t0, a.t1, f"crop=640:400:0:0,scale={W}:{H}:flags=neighbor,format=rgb24")
    n = W * H * 3
    prev = pi = None
    for i in range(len(d) // n):
        fr = d[i * n:(i + 1) * n]
        sx = sy = c = 0
        for y in range(a.y0, a.y1):
            row = y * W * 3
            for x in range(a.x0, a.x1):
                r, g, b = fr[row + x * 3], fr[row + x * 3 + 1], fr[row + x * 3 + 2]
                if a.rgb:
                    ok = all(abs(v - t) <= a.tol for v, t in zip((r, g, b), a.rgb))
                else:
                    ok = r > 140 and g < 60 and b < 60
                if ok:
                    sx += x
                    sy += y
                    c += 1
        cur = (round(sx / c, 2), round(sy / c, 2), c) if c else None
        if cur != prev:
            print(f"{a.t0 + i / FPS:8.3f} s  image {i:6d}  {cur}  +{i - pi if pi is not None else '-'} images")
            pi = i
        prev = cur


def crop_vf(crop, scale):
    vf = "crop=640:400:0:0"
    if crop:
        x, y, w, h = crop
        vf = f"crop={w * 2}:{h * 2}:{x * 2}:{y * 2}"
    return vf + (f",scale=iw*{scale}:-1:flags=neighbor" if scale != 1 else "")


def cmd_frame(a):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(a.t), "-i", a.video, "-frames:v", "1",
                    "-vf", crop_vf(a.crop, a.scale), a.out], check=True)


def cmd_sheet(a):
    count = int((a.t1 - a.t0) / a.step) + 1
    rows = -(-count // a.cols)
    vf = crop_vf(a.crop, 1) + f",scale={a.width}:-1:flags=neighbor,fps=1/{a.step},tile={a.cols}x{rows}"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(a.t0), "-t", str(a.t1 - a.t0 + a.step / 2),
                    "-i", a.video, "-vf", vf, "-frames:v", "1", a.out], check=True)
    print(f"planche : image k (de gauche à droite, de haut en bas) = {a.t0} + k x {a.step} s")


def cmd_patch(a):
    d = ffmpeg_raw(a.video, a.t, a.t + 0.03, f"crop=640:400:0:0,scale={W}:{H}:flags=neighbor,format=rgb24")[:W * H * 3]
    tot = [0, 0, 0]
    for y in range(a.y, a.y + a.h):
        for x in range(a.x, a.x + a.w):
            for k in range(3):
                tot[k] += d[(y * W + x) * 3 + k]
    n = a.w * a.h
    print(" ".join(f"{v / n:.1f}" for v in tot))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("events"); e.add_argument("video"); e.add_argument("t0", nargs="?", type=float)
    e.add_argument("t1", nargs="?", type=float); e.add_argument("--thr", type=int, default=6000); e.set_defaults(f=cmd_events)
    t = sub.add_parser("track"); t.add_argument("video"); t.add_argument("t0", type=float); t.add_argument("t1", type=float)
    for k in ("x0", "y0", "x1", "y1"):
        t.add_argument(k, type=int)
    t.add_argument("--rgb", nargs=3, type=int); t.add_argument("--tol", type=int, default=20); t.set_defaults(f=cmd_track)
    f = sub.add_parser("frame"); f.add_argument("video"); f.add_argument("t", type=float); f.add_argument("out")
    f.add_argument("--crop", nargs=4, type=int); f.add_argument("--scale", type=int, default=1); f.set_defaults(f=cmd_frame)
    s = sub.add_parser("sheet"); s.add_argument("video"); s.add_argument("t0", type=float); s.add_argument("t1", type=float)
    s.add_argument("step", type=float); s.add_argument("out"); s.add_argument("--cols", type=int, default=6)
    s.add_argument("--width", type=int, default=320); s.add_argument("--crop", nargs=4, type=int); s.set_defaults(f=cmd_sheet)
    q = sub.add_parser("patch"); q.add_argument("video"); q.add_argument("t", type=float); q.add_argument("x", type=int)
    q.add_argument("y", type=int); q.add_argument("w", nargs="?", type=int, default=8); q.add_argument("h", nargs="?", type=int, default=8)
    q.set_defaults(f=cmd_patch)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
