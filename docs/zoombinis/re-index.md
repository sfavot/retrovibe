# L'Odyssée des Zoombinis : index de rétro-ingénierie

Corpus Ghidra de `ZOOMBINI.EXE` (sur le CD : `ZOOMBINI._EX`, identique octet pour octet au `ZOOMBINI.EXE` installé) et du lanceur MIDI `BROEMIDI`.
Le jeu est un exécutable Windows 16 bits (NE) compilé avec Borland C++ 1994, sur le moteur « Mohawk » de Broderbund : le même que Mathémagique, dans une version plus récente (1996).

## Régénérer

```
bash scripts/zoombinis/re/run.sh
```

Prérequis : `scripts/zoombinis-extract.sh` a rempli `archives/zoombinis/cd/` ; Ghidra et un JDK (`brew install ghidra`).
Les fichiers du CD sont des données non fiables : ils sont seulement lus (Ghidra, `ne_dump.py` avec `python3 -I`), jamais exécutés.

Sorties dans `archives/zoombinis/re/` (non versionné) : un dossier par programme (`ZOOMBINI/`, `BROEMIDI/`) avec `functions.tsv`, `strings.tsv`, `imports.tsv`, `tags.tsv`, `resources.tsv`, `seed.tsv`, `decomp/*.c` et `disasm.txt` ; `exports/` (tables d'exports NE) ; `project/` (projet Ghidra `zoombinis`) ; `run.log`.

Tout l'outillage est commun (`scripts/re/`, partagé avec Mathémagique) : `ne_dump.py`, `SeedFunctions.java` (amorçage par les pointeurs lointains des données ; pas encore de table de scènes connue pour ce jeu), `ExportStrings.java`, `ExportImports.java`, `ExportTags.java` (tags Mohawk, dont ceux propres à Zoombinis : `SCRB`, `SCRS`, `NODE`, `PATH`, `REGS`, `tMID`), `ExportDecompiled.java`, `ExportDisasm.java`, `make_index_ne.py`. Seul `scripts/zoombinis/re/make_index.py` (la liste des programmes) est propre au jeu.

## Statistiques

<!-- GEN:stats -->
- Outils : ghidra 12.2 ; JDK : openjdk version "25.0.5" 2026-10-20.
- Durée de la dernière régénération (2 programmes) : 105 s.

| Programme | Octets | Fonctions | Octets de code | Décomp. ok | Partielle | Erreur | Taux ok | Chaînes (référencées) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `ZOOMBINI._EX` | 934416 | 2255 | 548326 | 2187 | 66 | 2 | 97.0 % | 462 (198) |
| `BROEMIDI` | 230080 | 486 | 72130 | 470 | 13 | 3 | 96.7 % | 117 (41) |
| **Total** | | 2741 | | 2657 | 79 | 5 | 96.9 % | |

- `ZOOMBINI` : fonctions créées par `SeedFunctions` : 316 (table des scènes 0, pointeurs lointains des données 316 ; 0 handlers de scène nommés, 18 cibles ignorées) ; la ré-analyse en ajoute 146 par appels directs.
- `ZOOMBINI` : types de fonctions export 1, func 2253, thunk 1.
- `ZOOMBINI` : décompilation en erreur (utiliser `disasm.txt`) : `11c0:8b76`, `11e8:52f5`.
- `ZOOMBINI` : décompilation partielle (66) : `10c0:131a`, `11c0:6f5d`, `11e8:9eee`, `11c0:42e6`, `11c8:0000`, `1000:1d91`, `1190:2748`, `1168:0ba8`, `11c8:0ed7`, `11a0:316d`, `1190:2af8`, `11c8:273f` ….
- `BROEMIDI` : décompilation en erreur (utiliser `disasm.txt`) : `1000:6067`, `1000:60a7`, `1000:60e7`.
- `BROEMIDI` : décompilation partielle (13) : `1000:01a4`, `1000:78b3`, `1000:100b`, `1008:0364`, `1008:0697`, `1020:1fcf`, `1008:0b84`, `1000:a37c`, `1010:4d87`, `1000:9395`, `1000:9399`, `1000:939d` ….
<!-- /GEN:stats -->

## Imports

<!-- GEN:imports -->
| Programme | Modules importés | Imports | Nommés par Ghidra | Nommés via une DLL | Sans nom | Appels (références) |
|---|---|---:|---:|---:|---:|---:|
| `ZOOMBINI._EX` | GDI (65), KERNEL (50), MMSYSTEM (34), USER (61) | 210 | 210 | 0 | 0 | 502 |
| `BROEMIDI` | GDI (1), KERNEL (44), MMSYSTEM (30), USER (38) | 113 | 113 | 0 | 0 | 127 |

Imports restés sans nom (le loader NE de Ghidra ne connaît pas la table d'ordinaux du module et aucune DLL analysée ne l'exporte) : aucun.

Imports de `ZOOMBINI` vers les DLL `BROD*` : aucun (la table des modules importés de `ZOOMBINI` ne contient pas de `BROD*`).

Imports de `ZOOMBINI` les plus appelés (nombre de fonctions appelantes) :

| Import | Appelantes | Exemples d'appelantes |
|---|---:|---|
| `GDI::DELETEOBJECT` | 29 | `11d8:076c`, `11e8:0302`, `11e8:0841`, `11e8:092c` |
| `GDI::SELECTOBJECT` | 14 | `11e8:0302`, `11e8:0cbe`, `11e8:0ee9`, `11e8:1067` |
| `GDI::DELETEDC` | 13 | `11e8:0302`, `11e8:1c8b`, `11e8:28c3`, `11e8:3df5` |
| `KERNEL::FREELIBRARY` | 11 | `1000:02a8`, `1000:0324`, `1000:03ca`, `1000:04fe` |
| `USER::SELECTPALETTE` | 11 | `11e8:0302`, `11e8:092c`, `11e8:0cbe`, `11e8:1a1d` |
| `GDI::CREATERECTRGN` | 10 | `11d8:076c`, `11e8:0841`, `11e8:092c`, `11e8:0b62` |
| `GDI::LPTODP` | 10 | `11e8:0302`, `11e8:0b62`, `11e8:1c8b`, `11e8:21ec` |
| `KERNEL::GETPROCADDRESS` | 9 | `1000:02a8`, `1000:0324`, `1000:03ca`, `1000:0532` |
| `GDI::GETSTOCKOBJECT` | 8 | `1148:0275`, `11e8:0cbe`, `11e8:21ec`, `11e8:2324` |
| `GDI::SETMAPMODE` | 7 | `11e8:0302`, `11e8:077e`, `11e8:1c8b`, `11e8:5d70` |
| `KERNEL::GLOBALALLOC` | 7 | `1000:15e2`, `1000:15ff`, `1000:4839`, `1148:041f` |
| `KERNEL::LOADLIBRARY` | 7 | `1000:02a8`, `1000:0324`, `1000:03ca`, `1000:0580` |
| `USER::RELEASEDC` | 7 | `11e8:683f`, `11e8:6b95`, `11e8:752d`, `11e8:7d44` |
| `GDI::SELECTCLIPRGN` | 6 | `11e8:0841`, `11e8:0e83`, `11e8:1c8b`, `11e8:8f0d` |
| `KERNEL::GLOBALFREE` | 6 | `1000:1670`, `1000:4873`, `1148:041f`, `11c8:6578` |
| `KERNEL::GLOBALLOCK` | 6 | `1000:15e2`, `1000:15ff`, `1000:4839`, `1000:4991` |
| `KERNEL::GLOBALHANDLE` | 6 | `1000:1670`, `1000:4873`, `1000:488a`, `1000:4991` |
| `USER::GETDC` | 6 | `11e8:683f`, `11e8:6b95`, `11e8:752d`, `11e8:7d44` |
| `USER::REALIZEPALETTE` | 6 | `11e8:0dc1`, `11e8:4a08`, `11e8:5659`, `11e8:5b14` |
| `GDI::INTERSECTCLIPRECT` | 5 | `11e8:0841`, `11e8:0e83`, `11e8:1c8b`, `11e8:5d70` |
| `GDI::GETDEVICECAPS` | 5 | `11e8:092c`, `11e8:5a99`, `11e8:618c`, `11e8:6af5` |
| `GDI::SETWINDOWORGEX` | 5 | `11e8:077e`, `11e8:5d70`, `11e8:9343`, `11e8:95e3` |
| `KERNEL::GLOBALUNLOCK` | 5 | `1000:1670`, `1000:4873`, `1000:4991`, `1148:041f` |
| `KERNEL::GETWINFLAGS` | 5 | `1000:0000`, `1000:01fa`, `1160:0000`, `11c8:7738` |
| `KERNEL::GLOBALFIX` | 5 | `11c8:6eba`, `11c8:77f7`, `11c8:a846`, `11e8:6580` |
<!-- /GEN:imports -->

## Archives Mohawk et tags

<!-- GEN:dats -->
Tags Mohawk trouvés comme constantes dans le code de `ZOOMBINI` (fonctions distinctes) :

| Tag | Fonctions | Liste |
|---|---:|---|
| `\0SND` | 49 | `1020:00af`, `1020:1278`, `1028:035d`, `1028:04ea`, `1028:0c0a`, `1028:0cc9`, `1028:0d9e`, `1028:0e53`, `1038:065e`, `10a8:09b3`, `10b0:073d`, `10b0:19b4` … |
| `tWAV` | 20 | `1028:04ea`, `1028:08f9`, `1028:0f78`, `1028:1036`, `10a0:0020`, `10a0:0040`, `10a0:005e`, `10a0:007c`, `10a0:009f`, `10a0:00c2`, `10a0:00e0`, `10a0:00fe` … |
| `tMID` | 18 | `1020:00af`, `1020:1278`, `1028:04ea`, `1028:08f9`, `1068:0020`, `1068:003e`, `1068:005c`, `1068:007f`, `1068:009d`, `1068:00bb`, `1068:00db`, `1068:0104` … |
| `SCRB` | 8 | `10d8:1271`, `10e8:2ade`, `10f8:4bf9`, `11a0:1597`, `11a0:1737`, `11a8:14ab`, `11a8:15a6`, `11a8:1be6` |
| `SCRS` | 8 | `10e0:0ee1`, `10e0:0f51`, `10e0:18a7`, `1168:0376`, `1168:03ef`, `1168:04d0`, `1168:05fa`, `1168:3f76` |
| `REGS` | 4 | `10c8:1afe`, `10f8:692f`, `1118:11b8`, `1168:01f4` |
| `STRL` | 2 | `1018:0266`, `1178:0103` |
| `SHAP` | 2 | `10a8:09b3`, `11b8:0497` |
| `tBMP` | 2 | `11a8:2ae6`, `11b8:0497` |
| `CURS` | 1 | `1160:0000` |
| `NODE` | 1 | `1168:2a5c` |
| `PATH` | 1 | `1168:2a5c` |
| `SHPL` | 1 | `11b8:0b5b` |
| `tPAL` | 1 | `11b8:0d20` |
| `SNDL` | 1 | `11b8:0dd3` |

Fonctions qui référencent un nom de fichier `.DAT` (chaîne passée en immédiat) :

| Fonction | Octets | DAT | Tags dans la même fonction |
|---|---:|---|---|
| `10b0:0027` | 1491 | BaseCamp.MHK | - |
| `10b8:0030` | 1538 | bctwo.mhk | - |
| `10c0:00e6` | 889 | bridge.mhk | - |
| `10c8:0000` | 2373 | Caves.MHK | - |
| `10d8:0071` | 1020 | Ferry.MHK | - |
| `10e0:00ea` | 993 | Fleens.MHK | - |
| `10e8:0000` | 1471 | Hotel.MHK | - |
| `10f8:0000` | 2529 | Lilly.MHK | - |
| `1110:0107` | 621 | Map.MHK | `\0SND` |
| `1110:20f6` | 606 | Picker.MHK | `\0SND` |
| `1110:2f46` | 472 | Picker.MHK | `\0SND` |
| `1118:0000` | 4514 | Maze2.MHK | - |
| `1120:0000` | 955 | Net.MHK | - |
| `1128:006d` | 1069 | Picker.MHK | `\0SND` |
| `1130:0000` | 3038 | Pizza.MHK | - |
| `1130:5ea9` | 140 | bctwo.mhk | - |
| `1158:0000` | 2733 | Smoke.MHK | - |
| `1168:004f` | 211 | MidiMPC.MHK, Zoombini.MHK | - |
| `1168:01ca` | 42 | MidiMPC.MHK, Zoombini.MHK | - |
| `1170:0000` | 941 | Slides.MHK | - |
| `1188:0128` | 1915 | Town.MHK | - |
| `1190:0107` | 1117 | Tunnels.MHK | - |
| `11b0:00c4` | 4246 | xfer.MHK | - |

Noms de fichiers `.DAT` présents dans le segment de données sans aucune référence immédiate trouvée : `MIDIMAP.DAT`, `textstr.mhk`, `Zoombini.mhk`.

Fonctions référençant un tag sans nom de DAT dans la même fonction : 104 sur 108 fonctions à tags (voir `ZOOMBINI/tags.tsv`).
<!-- /GEN:dats -->

## Ressources NE

<!-- GEN:resources -->
| Programme | Ressources NE | Détail |
|---|---:|---|
| `ZOOMBINI._EX` | 4 | NAMETABLE 1, ICON 2, GROUP_ICON 1 |
| `BROEMIDI` | 18 | STRING 7, ICON 1, GROUP_ICON 1, DIALOG 9 |
<!-- /GEN:resources -->
