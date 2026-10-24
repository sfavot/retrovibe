# Formats de données de Math Workshop (Mathémagique)

Broderbund, 1994, Windows 3.x. Inventaire des fichiers : [files.md](files.md). Lecteurs : `src/games/mathemagique/data/`, tests : `test/mathemagique/` (lisent les vrais fichiers de `original/mathemagique/`, ignorés s'ils sont absents).

Les fichiers de données sont des archives **Mohawk** (moteur Cyan/Broderbund, documenté par le moteur Mohawk de ScummVM). Tout y est **big-endian**, sauf indication contraire pour certaines ressources.

## Archive Mohawk (`*.DAT`, `MPC/PVG.MHK`) — `mohawk.ts`

| Octets | Contenu |
|---|---|
| 0 | `MHWK`, u32 taille (fichier - 8), `RSRC` |
| 12 | version u16 (0x100), compaction u16, taille du fichier u32 |
| 20 | u32 `abs` : décalage absolu des tables |
| 24 | u16 décalage de la table de fichiers (relatif à `abs`), u16 taille de cette table |

À `abs` :

- u16 décalage de la liste de noms, u16 nombre de types ;
- par type : tag de 4 octets, u16 décalage de la table de ressources, u16 décalage de la table de noms (relatifs à `abs`) ;
- table de ressources : u16 nombre, puis (u16 id, u16 index de fichier **1-based**) ;
- table de fichiers (à `abs` + décalage) : u32 nombre, puis entrées de 10 octets (u32 offset absolu dans le fichier, u16 taille basse, u8 taille haute, u8 flags, u16 inconnu).

Observations :

- **Aucun nom de ressource** : les tables de noms des 19 archives sont vides. `MohawkArchive` ne les lit donc pas.
- Les ids sont uniques par type (pas globalement). Un tag peut commencer par un octet NUL (`\0SND`, `\0SCR`) : il fait partie du tag (`TAG_SND = "\0SND"`).
- La taille déclarée d'une ressource est souvent **arrondie** à un multiple de 512 / 2048 octets (MIDI, SNDL, SHAP parfois) : la fin contient du bourrage, parfois des restes d'autres ressources. Chaque format ci-dessous indique où s'arrête la partie utile.
- Les 18 `.DAT` et `MPC/PVG.MHK` (tags `tBMP`, `tPAL`, `tWAV`, pas encore lus) ont tous ce format ; les nombres de ressources par type sont ceux de `files.md` (vérifiés par test).

API : `MohawkArchive.parse(bytes)`, `types()`, `count(tag)`, `ids(tag)`, `has`, `find(tag, id)` / `get(tag, id)` (vue `subarray`, sans copie).

## Fichiers (`files.ts`)

`original/mathemagique/files.json` (`[{path, size}]`, généré par `scripts/manifest.py`). `GameFiles.resolve(nom)` accepte un nom ou un chemin, casse indifférente : l'EXE demande `nim.DAT`, `PatFill.DAT`, `milkyway.dat`, les fichiers sont `NIM.DAT`, `PATFILL.DAT`, `MILKYWAY.DAT`, `MPC/PVG.MHK`. Identique au `GameFiles` de Téléportaschtroumpf (hors `scenes()`) : candidat au partage.

## `\0SND` — sons — `wave.ts`, `midi.ts`

Chaque ressource est elle-même un mini-fichier : `MHWK`, u32 taille, puis `WAVE` (1381 ressources) ou `MIDI` (66). Total 1447 sons, dans tous les `.DAT` sauf `CREDITS`, `TROPHY`, `SYSTEM`, `MIDIMAP`.

### WAVE

Suite de blocs `tag[4]`, u32 taille, données, complétés à une longueur paire :

- `Cue#` (277 sons, optionnel, avant `Data`) : u16 nombre, puis par point : u32 position (échantillons), u8 longueur du nom, nom, 1 octet de bourrage si la longueur est paire. Noms vus : `beg sele`, `end sele`… (repères pour synchroniser l'animation de la bouche avec la voix).
- `Data` : la taille **inclut les 20 octets d'entête** : u16 fréquence, u32 nombre d'échantillons, u8 bits, u8 canaux, u16 codage, u16 nombre de boucles, u32 début de boucle, u32 fin de boucle, puis les échantillons. Il peut y avoir 1 octet de plus que le nombre d'échantillons : seul le nombre déclaré compte.

Constat sur les 1381 sons : **un seul codage**, PCM brut non signé 8 bits mono (`bits = 8`, `canaux = 1`, `codage = 0`) ; 0x80 = silence. Pas d'ADPCM ni de bloc `ADPC`.

| Fréquence | Sons |
|---|---:|
| 11025 Hz | 1380 |
| 22050 Hz | 1 (`BOWLING.DAT` 14423) |

- Durée totale : **2831 s (≈ 47 min)**, soit ≈ 31 Mo de PCM. Minimum 0,02 s, médiane 1,5 s, maximum 20,8 s.
- Répartition : < 0,5 s : 118 ; 0,5-1 s : 292 ; 1-2 s : 550 ; 2-5 s : 341 ; 5-10 s : 44 ; ≥ 10 s : 36. Soit 421 sons de 2 s ou plus (voix longues, musiques) et 960 courts (effets, mots isolés).
- Boucle : un seul son déclare une boucle, `TITLE.DAT` 1000 (musique du titre, 17,4 s : 1 boucle, début 0, fin 192289 sur 192294 échantillons). Les autres ont 0 boucle, début = fin = 0.

`parseWave` renvoie `{sampleRate, samples (Uint8Array), loop*, cues}` ; `waveToFloat32` convertit pour Web Audio ((x - 128) / 128, comme pour le VOC de Téléportaschtroumpf).

### MIDI

`MHWK`, u32, `MIDI`, puis : `MThd` (14 octets, **format 0**, 1 piste, division 0x01E0 = 480), `Prg#`, `MTrk` (un seul, longueur standard), puis du bourrage jusqu'à 2048 / 4096 octets. `extractMidi` renvoie `MThd` + `MTrk` : un fichier MIDI standard valide. 45 MIDI dans `MIDIMPC.DAT` (ids 101…), 21 dans les autres archives. La taille MHWK du début est celle de la partie utile (elle ne correspond pas à la taille de la ressource).

`Prg#` (propre à Mohawk) : u32 taille (big-endian), puis u16 nombre `n` et `n` paires de u16 (taille = 2 + 4 n pour les 66). Exemple : `5 : (0,0x200) (0x0f,4) (0x2d,1) (0x3c,8) (0x4b,2)`. Sens non établi ; `parseMidi().programs` expose les octets bruts. `MIDIMAP.DAT` (`SYSX`, 192 octets : suites `Bn 79 00`, reset de contrôleurs par canal) sert au pilote MIDI.

## `STRL` — listes de chaînes — `strl.ts`

u8 nombre de chaînes, puis les chaînes terminées par NUL, puis du bourrage. Encodage : Windows-1252 par principe (`decodeText`), mais **aucun octet ≥ 0x80** dans les 11 STRL : ASCII pur. 11 ressources : `BOWLING` ×8 (ids 1000…), `PATFILL` 40000 (10 noms de motifs : Checker, Triangles, Crosses…), `RHYTHM` 30001 (45 titres de morceaux : Fanfare, Tango, Boogi Woogi…), `TROPHY` 5000 (25 grades de bowling : « Rookie Roller », « Ball Polisher », « Twinkle Toes »…). `BOWLING` 1001 : `seconds, minutes, hours, days, months, years`.

## `SNDL` — sons d'un écran — `sndl.ts`

**Little-endian** : u16 nombre `n`, puis `n` ids `\0SND` u16, puis bourrage. Un SNDL par écran `\0SCR` de même id (725 SNDL, 725 SCR correspondants ; 361 listes d'un son, 92 vides). 714 listes sur 725 ne référencent que des sons de la même archive ; 11 pointent vers des ids absents de l'archive (sons partagés avec une autre ? à vérifier).

## À étudier

Non décodés (T3b et suivants) ; observations brutes :

- **`SHAP`** (images, 16 258 ressources), **`SHPL`** (formes et palettes, 844) et `tBMP` / `tPAL` de `MPC/PVG.MHK` : décodés, voir [shap.md](shap.md) (LZ + RLE, palette, transparence = index 0).
- **`\0SCR`** (écrans) : même id que le `SNDL` ; **little-endian** (`e300 9601 3a01 e801…` = 227, 406, 314, 488…) ; liste de rectangles / hotspots et d'ids, sans structure établie.
- `PUZZ`, `PTRN` (100 octets, 0x23×0x23 ?), `PLST` (386), `STLV` (180, `0065 7530…`), `TARG` / `UNIT` (tableaux de u32 big-endian : cibles et unités des jeux), `CURS` (curseurs 1 bit, 68 octets), `SYSX` (messages MIDI), `RSFL` (2 octets, 0).
- `tWAV` de `MPC/PVG.MHK` : WAVE Mohawk comme ci-dessus, avec bourrage (`tBMP` / `tPAL` : voir [shap.md](shap.md)).
- Rôle exact des 11 SNDL pointant hors de leur archive ; sens de `Prg#` ; lien entre repères `Cue#` et animation de bouche.
