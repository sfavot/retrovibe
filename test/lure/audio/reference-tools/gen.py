import json, subprocess, hashlib, os, sys
# Régénère test/lure/audio/reference.json avec le harnais de référence (voir build.sh) :
#   python3 gen.py <harnais compilé> <dossier des sons .mid (dump-sounds.mts)> <reference.json de sortie>
import sys
H, MID, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
WORK = os.path.dirname(os.path.abspath(OUT)) + '/.scn.txt'
I1="01 02 03 0c 05 01 07 04 14 01 01 01 00 02 01 00 0f 06 01 03 05 0a 00 01 00 01 01 02"
I2="00 01 07 0a 08 01 02 06 05 01 00 00 00 03 02 00 09 04 00 04 02 12 01 00 01 00 02 00"   # op0 connexion 0 = additive
def instr(src,ch,i): return f"1 meta {src} 7f 00 00 3f 00 01 {ch:02x} {i}"
def pbs(src,n): return f"1 meta {src} 7f 00 00 3f 00 03 {n:02x}"
def bank(): return f"driver generic\nbank 0 00 00 {I1}\nbank 1 00 00 {I2}\nbank 2 00 00 {I1}\n"
sc={}
# A : une note, un instrument
sc['note']=f"""{pbs(1,1)}
{instr(1,0,I1)}
2 raw 1 90 3c 64
10 raw 1 80 3c 40
end 20
"""
# B : plage de notes et de vélocités
lines=[pbs(1,1),instr(1,0,I1),instr(1,1,I2)]
t=2
for ch in (0,1):
  for note in (0,5,11,12,13,36,60,71,72,96,107,108,119,120,127):
    for vel in (1,64,127):
      lines.append(f"{t} raw 1 {0x90+ch:02x} {note:02x} {vel:02x}"); t+=3
      lines.append(f"{t} raw 1 {0x80+ch:02x} {note:02x} 00"); t+=1
lines.append(f"end {t+5}")
sc['notes']="\n".join(lines)+"\n"
# C : pitch bend et sensibilité
lines=[instr(1,0,I1)]
t=2
for sens in (1,2,12,0,3):
  lines.append(f"{t} meta 1 7f 00 00 3f 00 03 {sens:02x}"); t+=1
  lines.append(f"{t} raw 1 90 40 64"); t+=2
  for pb in (0x0000,0x0100,0x1000,0x1fff,0x2000,0x2001,0x3000,0x3fff,0x2000):
    lines.append(f"{t} raw 1 e0 {pb&0x7f:02x} {pb>>7:02x}"); t+=2
  lines.append(f"{t} raw 1 80 40 00"); t+=2
  # note basse et haute avec pitch bend
  for note in (3,12,100,115):
    lines.append(f"{t} raw 1 e0 00 30"); t+=1
    lines.append(f"{t} raw 1 90 {note:02x} 50"); t+=2
    lines.append(f"{t} raw 1 80 {note:02x} 00"); t+=2
lines.append(f"end {t+5}")
sc['pitchbend']="\n".join(lines)+"\n"
# D : pression de canal
sc['aftertouch']=f"""{instr(1,0,I1)}
{instr(1,1,I2)}
{instr(2,0,I1)}
2 raw 1 90 3c 7f
3 raw 2 90 40 7f
4 raw 1 91 41 60
6 raw 1 d0 40
8 raw 1 d0 08
9 raw 2 d0 20
10 raw 1 d1 7f
12 raw 1 d0 00
14 raw 1 80 3c 00
16 raw 1 d0 7f
20 raw 1 81 41 00
end 30
"""
# E : deux sources sur 9 voix, allocation statique de Lure
lines=[pbs(1,1),pbs(2,1)]
for ch in range(8):
  lines.append(instr(1,ch,I1)); lines.append(instr(2,ch,I2))
t=2
for ch in range(5):
  lines.append(f"{t} raw 1 {0x90+ch:02x} {0x30+ch:02x} 60"); t+=1
for ch in range(6):
  lines.append(f"{t} raw 2 {0x90+ch:02x} {0x40+ch:02x} 60"); t+=1   # source 2 : canaux 4 et 5 sans voix
lines.append(f"{t+3} raw 2 90 50 60")        # note sur une voix déjà allouée (canal 0)
lines.append(f"{t+6} raw 1 80 30 00")
lines.append(f"{t+8} meta 1 2f ")             # fin de piste de la source 1 : ses voix reviennent
lines.append(f"{t+10} raw 2 95 55 60")        # le canal 5 de la source 2 trouve une voix
lines.append(f"{t+12} raw 2 94 54 60")
lines.append(f"{t+14} raw 1 93 3b 60")
lines.append(f"end {t+30}")
sc['two-sources-static']="\n".join(lines)+"\n"
# F : pilote générique, allocation dynamique, vol de voix, contrôleurs
lines=[bank().rstrip()]
t=2
lines.append(f"{t} raw 0 c1 01"); t+=1
for i in range(12):
  lines.append(f"{t} raw 0 90 {0x30+i:02x} {40+i*5:02x}"); t+=2      # 12 notes sur 9 voix : vol
lines.append(f"{t} raw 1 c0 00"); t+=1
lines.append(f"{t} raw 1 90 50 70"); t+=2
lines.append(f"{t} raw 1 b0 40 7f"); t+=1                           # pédale
lines.append(f"{t} raw 1 80 50 00"); t+=2
lines.append(f"{t} raw 1 b0 40 00"); t+=2
lines.append(f"{t} raw 0 b0 07 40"); t+=2                           # volume de canal
lines.append(f"{t} raw 0 b0 0b 20"); t+=2                           # expression
lines.append(f"{t} raw 0 e0 00 50"); t+=2                           # pitch bend SB16
lines.append(f"{t} raw 0 e0 7f 7f"); t+=2
lines.append(f"{t} raw 0 b0 65 00"); t+=1
lines.append(f"{t} raw 0 b0 64 00"); t+=1
lines.append(f"{t} raw 0 b0 06 04"); t+=2                           # RPN sensibilité
lines.append(f"{t} srcvol 0 128"); t+=2
lines.append(f"{t} uservol 192 192"); t+=2
lines.append(f"{t} raw 0 b0 7b 00"); t+=3                           # all notes off
lines.append(f"{t} raw 0 b0 79 00"); t+=3
lines.append(f"{t} stopall"); t+=3
lines.append(f"end {t}")
sc['generic-dynamic']="\n".join(lines)+"\n"
sc['generic-static']=sc['generic-dynamic'].replace('driver generic','driver generic-static')
# fondu de volume
sc['fade']=f"""{instr(1,0,I1)}
{instr(1,1,I2)}
{instr(2,0,I2)}
2 raw 1 90 3c 7f
2 raw 1 91 40 60
3 raw 2 90 44 70
5 fade 400 0
60 raw 1 81 40 00
70 meta 1 2f
80 raw 2 d0 30
120 srcvol 2 200
end 160
"""
sc['fade-abort-start']=sc['fade'].replace('70 meta 1 2f','70 meta 2 2f')
# G : sons réels
def solo(name, loop=0, extra=50):
  return f"1 play 1 {name} {loop}\nend auto {extra}\n"
sc['real-main-1']=solo('main-1')
sc['real-main-5']=solo('main-5')
sc['real-intro-2']=solo('intro-2')
sc['real-ending-0']=solo('ending-0')
sc['real-loop-main-30']="1 play 0 main-30 1\n3000 stop 0\nend 3100\n"
sc['real-music-and-sfx']="""1 play 0 main-14 1
200 play 1 main-3 0
450 play 2 main-6 0
480 play 3 main-20 0
900 play 4 main-9 0
1500 stop 0
1600 stop 2
end auto 100
"""
sc['real-music-fade']="""1 play 0 main-14 1
200 play 1 main-3 0
900 fade 1000 0
1500 stop 0
end 1600
"""
sc['real-fade-then-kill']="""1 play 0 main-25 1
100 fade 3000 0
500 stop 0
end auto 20
"""
for n in range(0,73): sc[f'real-all-main-{n}']=solo(f'main-{n}')
for n in range(0,4): sc[f'real-all-intro-{n}']=solo(f'intro-{n}')
sc['real-all-ending-0']=solo('ending-0')
out={}
for name,text in sc.items():
  # fichiers référencés
  files=sorted(set(w for l in text.split('\n') for w in l.split() if (w.startswith('main-') or w.startswith('intro-') or w.startswith('ending-'))))
  real=text
  for f in files: real=real.replace(f, f"{MID}/{f}.mid")
  open(WORK,'w').write(real)
  res=subprocess.run([H,WORK],capture_output=True,text=True)
  if res.returncode!=0: print('ECHEC',name,res.stderr[:300]); continue
  lines=res.stdout.strip().split('\n') if res.stdout.strip() else []
  ent={'scenario':text,'count':len(lines)}
  if files:
    ent['sha1']=hashlib.sha1(('\n'.join(lines)+'\n').encode()).hexdigest()
    ent['lastTick']=int(lines[-1].split()[0]) if lines else 0
  else:
    ent['lines']=lines
  out[name]=ent
  print(name, len(lines), ent.get('sha1','')[:8])
json.dump(out,open(OUT,'w'))
os.remove(WORK)
