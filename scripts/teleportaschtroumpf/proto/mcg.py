import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import write_png
d = open(sys.argv[1], 'rb').read()
write_png(sys.argv[2], 320, 200, d[770:770+64000], d[2:770])
