#!/usr/bin/env python3
"""Met à jour les blocs générés de docs/mathemagique/re-index.md à partir des sorties de run.sh (scripts/re/make_index_ne.py)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "re"))  # -I : pas de PYTHONPATH
import make_index_ne  # noqa: E402  (outillage commun : scripts/re/)

make_index_ne.main(sys.argv[1] if len(sys.argv) > 1 else os.getcwd(), "mathemagique",
                   [("MATH", "MATH"), ("BRODFONT", "BRODFONT.DLL"), ("BRODMIDI", "BRODMIDI.DLL"),
                    ("BRODPGI", "BRODPGI.DLL"), ("BRODUTIL", "BRODUTIL.DLL"), ("BROEMIDI", "BROEMIDI")], "MATH")
