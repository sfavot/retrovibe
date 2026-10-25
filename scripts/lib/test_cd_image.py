"""Auto-test de la gestion des images CD BIN/CUE de extract_common.py.

Lancer avec : python3 -I scripts/lib/test_cd_image.py
Construit un mini .bin/.cue synthétique (1 piste de données de 3 secteurs + 2 pistes audio) et vérifie
parse_cue, l'ISO produit et les WAV.
"""
import os
import sys
import tempfile
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I : pas de PYTHONPATH
import extract_common as ec  # noqa: E402

SECTEUR = ec.SECTEUR


def main():
    charges = [bytes([i + 1]) * 2048 for i in range(3)]
    donnees = b''.join(b'\x00' + b'\xff' * 10 + b'\x00' + b'\x00\x00\x01\x01' + c + b'\xee' * 288 for c in charges)
    assert len(donnees) == 3 * SECTEUR
    # Pistes audio de 2 et 4 secteurs, trames stéréo 16 bits distinctes par piste.
    audio2 = b''.join((bytes([n]) * 4) * (SECTEUR // 4) for n in (0x11, 0x22))
    audio3 = b''.join((bytes([n]) * 4) * (SECTEUR // 4) for n in (0x31, 0x32, 0x33, 0x34))
    with tempfile.TemporaryDirectory() as tmp:
        binf, cue = os.path.join(tmp, 'a.bin'), os.path.join(tmp, 'a.cue')
        with open(binf, 'wb') as o:
            o.write(donnees + audio2 + audio3)
        with open(cue, 'w') as o:
            o.write('FILE "a.bin" BINARY\n'
                    '  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n'
                    '  TRACK 02 AUDIO\n    PREGAP 00:02:00\n    INDEX 01 00:00:03\n'
                    '  TRACK 03 AUDIO\n    INDEX 00 00:00:04\n    INDEX 01 00:00:05\n')
        pistes = ec.parse_cue(cue)
        assert pistes == {1: ('MODE1/2352', 0), 2: ('AUDIO', 3), 3: ('AUDIO', 5)}, pistes
        assert ec.secteurs_piste_donnees(pistes) == 3

        iso = os.path.join(tmp, 'a.iso')
        ec.bin_vers_iso(binf, iso, 3)
        assert open(iso, 'rb').read() == b''.join(charges)

        sorties = ec.extraire_pistes_audio(binf, pistes, os.path.getsize(binf), os.path.join(tmp, 'wav'))
        assert [os.path.basename(p) for p in sorties] == ['Track02.wav', 'Track03.wav'], sorties
        for chemin, brut in zip(sorties, (audio2, audio3)):
            with wave.open(chemin, 'rb') as w:
                assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (2, 2, 44100)
                assert w.getnframes() == len(brut) // 4
                assert w.readframes(w.getnframes()) == brut

        double = os.path.join(tmp, 'b.cue')
        with open(double, 'w') as o:
            o.write('FILE "a.bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\nFILE "b.bin" BINARY\n')
        try:
            ec.parse_cue(double)
        except SystemExit:
            pass
        else:
            raise AssertionError('CUE multi-FILE accepté')
    print('OK')


main()
