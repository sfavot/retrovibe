# ZOOMBINI.EXE : cadre global du moteur (rétro-ingénierie)

Tâche T4. Ce document décrit le fonctionnement de `ZOOMBINI.EXE` (L'Odyssée des Zoombinis, Broderbund / TERC, version 1.0FR, 1996, NE Windows 3.1 16 bits, Borland C++ 1994) : démarrage, boucle principale, enchaînement des écrans, formats de scripts `SCRB` / `SCRS`, ressources `NODE` / `PATH` / `REGS` / `CURS`, images `tBMP`, palette, son, entrées, aléatoire. Il s'appuie sur le corpus Ghidra de [re-index.md](re-index.md) (`archives/zoombinis/re/ZOOMBINI/`) et sur des scripts de vérification lancés sur les 22 archives de `original/zoombinis/`. Le moteur est le moteur « Mohawk » de Broderbund, version plus récente que celui de Mathémagique ([../mathemagique/engine.md](../mathemagique/engine.md)) : le format d'archive, les `SHPL`, les sons `\0SND` (`WAVE`) et les `tMID` sont les mêmes ; les scripts d'animation, eux, ont changé de nature.

Niveau de confiance : **sûr** = lu dans le code ou vérifié sur toutes les données ; **probable** = déduit de plusieurs indices concordants ; **hypothèse** = déduction non vérifiée.

## 0. Conventions et pièges de lecture

1. **Adresses** : `sélecteur:offset` de Ghidra ; le sélecteur du segment de code n vaut `0x1000 + 8 × (n - 1)` ; `DS` = `1530` (segment de données du jeu, 45 800 octets, 903 pointeurs lointains relogés). Les `1530:xxxx` cités sont dans ce segment ; `DAT_1530_xxxx` des décompilations = `DS:xxxx`.
2. **Arguments `__stdcall16far` inversés** : Ghidra liste les paramètres des fonctions `pascal` dans l'ordre inverse de l'appel. Dans `disasm.txt`, le **premier** `PUSH` est donc le **dernier** paramètre de la signature décompilée. Exemple : `11a0:0000(flag, groupe, id)` apparaît dans le désassemblage comme `PUSH id ; PUSH groupe ; PUSH flag`.
3. **Mots échangés** : `11e8:2c65(x)` échange les deux octets d'un mot (big-endian → natif) ; `11a8:2c8a` charge une ressource et échange **tous** ses mots (`SCRB`, `SCRS`, `NODE`, et par `1168:01f4` les `REGS`) ; les `tBMP` ne sont échangées qu'en partie (voir §5).
4. **Handlers non appelés directement** : les handlers de la table d'écrans (§2.1) et les procédures de fenêtre n'ont aucun appelant direct (appels par pointeur lointain). `SeedFunctions` les a créés depuis les pointeurs de données ; les corps des handlers de messages `1148:0e6f`…`1148:0ee5` ne sont pas des fonctions Ghidra (lus à la main dans les octets).
5. **Carte des modules** (segments de code regroupés par rôle, **probable**) : `1080` aléatoire ; `1090` crochet de veille et horloge ; `10b0`–`1190` écrans (un module par écran, §2) ; `1148` fenêtre et messages Windows ; `1168` « snoids » (Zoombinis), chemins, sauvegarde `.WHO` ; `11a0` groupes de formes et menus ; `11a8` moteur de « features » (scripts `SCRB` / `SCRS`) ; `11b8` gestionnaire de ressources ; `11c0` pilote MIDI ; `11c8` « MOHAWK OS Manager » (minuterie, son numérique, mémoire) ; `11d8` régions et rectangles sales ; `11e8` graphismes (GDI, WinG, palette) ; `11f0` fichiers ; `1020`–`1038` gestionnaire de sons ; `1048` file d'événements d'entrée ; `1058` palette ; `1008` QuickTime.
6. **Le nom interne d'un Zoombini est « snoid »** (`Snoid Script:`, `bogus snoid script id`, `Too many snoid NORMAL scripts`). Les personnages du jeu s'appellent « features » dans le moteur (`Feature id`, `feature->Rgn`, `gFeatureClipRgn`), au sens « objet animé sur un écran ».

## 1. Démarrage, boucle principale, cadence, affichage

### 1.1 Séquence de démarrage

- `1000:0000` `entry` (sûr) : `INITTASK`, `WAITEVENT`, `INITAPP` (idiome de démarrage Windows 16 bits), `GETWINFLAGS` (mode `0x20` = mode étendu 386 ; sinon message d'erreur `Le programme nécessite Windows pour fonctionner`), puis `1160:0000` (le `WinMain`, 1313 octets), puis `1000:4eff` (exit).
- `1160:0000` `WinMain` (sûr) : mémorise `hInstance`, `hPrev`, ligne de commande et `nCmdShow` en `DS:9080`…`9088`, calcule `DS:22f6` (1 si la version de Windows renvoyée par `GETVERSION` est supérieure à 3.11), puis, **seulement en mode étendu**, enchaîne :
  1. `1018:0000` et `11e8:59da` (chaînes, structures de base) ; fixe `DS:1c96` = `"Zoombini"` (nom de la classe de fenêtre) ;
  2. **crochet de veille** `1090:0000(1160:085a)` → `DS:044e` (voir §1.3) ; `1078:0000` (gestionnaire d'erreurs fatales) ; `1098:017e`, `1148:1680` ;
  3. **vérifications d'environnement** (chacune affiche un message de `TEXTSTR` 1000–1048 via `1078:0099` et peut arrêter le jeu) : `11c8:8889` (matériel ; **640 × 480, 256 couleurs** : `local_14 = 0x280`, `local_12 = 0x1e0`, `local_10 = 0x100` sont posés plus bas pour le gestionnaire graphique), `11c8:af54` (minuterie multimédia : `timeGetDevCaps` + `timeBeginPeriod`), `11c8:62b9`, `11c8:5cbc` (mémoire libre ≥ 0x189c40 = 1 612 864 octets, et ≥ 0x389c40 = 3 710 016 octets sous Windows > 3.11), `11c8:5e4a` (mémoire physique ≥ 0x600000 = 6 Mo sous Windows > 3.11), `11e0:19ee`, `11d0:06fd`, `11f0:38b6`, `11c0:0a94`, puis `waveOutGetNumDevs` et `midiOutGetNumDevs` (message « no digital sound devices found » / « no midi sound devices found » si 0) ;
  4. `1138:0000`, `10d0:0286`, `1000:0e7a(…, 9000)`, `1058:0000` (palette), `11e8:8cbc` / `644c` / `7d44` (fenêtre, DC, palette de départ), `1148:0275` (création de la fenêtre, §1.4), `10d0:089b`, `10d0:07f5` ;
  5. `11a8:0000`, `1168:004f(1)` (ouvre `MidiMPC.MHK` et `Zoombini.MHK` : voir §2.6), `1178:004c` et `1178:0103` (ouvre `textstr.mhk`, charge les `STRL`) ;
  6. **curseurs** : boucle `i = 1…5` : charge `CURS` id i de `ZOOMBINI.MHK` (`11b8:0905(…, 'CURS')`), verrouille (`11b8:0094`, `11c8:6062`), mémorise le pointeur en `DS:a1d2[i]` (§4.4) ;
  7. `1160:0000` fixe `DS:8554 = 0` (demande de changement d'écran vers l'écran 0, le logo) puis entre dans la boucle principale (§1.3).
- À la sortie, `1160:05c9` (sûr) : si une partie est en cours, `1160:05c9` propose d'abord d'enregistrer (boîte `11a0:1737`), puis appelle le handler `+4` de chacun des 23 écrans de la table (§2.1), ferme les six `CURS`, `1160:07f5`, `11a8:017b`, et libère les gestionnaires (`1018:05b3`, `1058:019e`, `1098:000d`, `11c0:0cb8`, `11d0:07c1`, `11f0:3d8b`, `11e0:1e53`, `11c8:6561` / `afdd` / `8c5c`).

### 1.2 Fichiers de configuration

- `MOHAWK.WIN` (INI Windows, lu par `11d0:0ba3`, sûr) : `[Audio] defaultMidiDevice`, `fCacheDefaultMIDIDevice`, `DefaultWaveDevice`, `fTranslateWaveRateOnError`, `Audio.WaveRateTranslations`, `[MidiMap.TargetDevices]` / `[MidiMap.TargetDeviceInfo]` (table de repérage des périphériques MIDI, §6.3), `[wavemix] fenable` (**`FALSE`** dans la copie installée : le mixeur WaveMix n'est pas utilisé, le moteur mixe lui-même avec `waveOut*`), `[graphics] fEnableWinG` (clé `fEnableWinG`, section `Graphics`, `11e8:9bcf`), `[Resource] fShareReadOnly`, `[Graphics] fEnableCursorFix` et `Graphics.Decompressors` (§5.1).
- `ZOOMBINI.CFG` (installeur, `wing=1`), `ZOOMBINI.WHO` (fichier des joueurs, `Zoombini.who`, `ZBUser###.txt` pour les équipes) : hors périmètre ici.

### 1.3 Boucle principale

Sûr (code) :

```
1160:0000   tant que  1198:0000() != 0  et  DS:a1ee == 0 :
                1090:0018()                      // pompe de messages + crochet de veille
```

- `1090:0018` : `1148:0b16` (pompe : `PeekMessage` / `TranslateMessage` / `DispatchMessage` via `1148:0c92`), puis **le crochet de veille `DS:044e`** (= `1160:085a`) s'il est non nul, puis `1090:0337` (surveillance de la famine : message « System starvation warning! » si la boucle ne tourne plus).
- `1160:085a` (sûr) : si l'écran courant `DS:8552` ≠ -1 et que son descripteur a un handler `+8` non nul, l'appelle (c'est le **Tick de l'écran**, §2.1) ; puis `1160:092f` (affichage de diagnostic mémoire `Free:%d,%03d  Purg:%d,%03d  Min:%d,%03d` si activé) ; puis, si `DS:a1e0 > 0`, recalcule des échéances (`1198:0171` ; rôle non étudié).
- `1198:0000` (sûr) : si `DS:8554 != -1` (un changement d'écran est demandé), appelle `1108:0000` (§2.2) ; gère un minuteur de veille (`DS:235c`, 3 600 ticks) ; lit la file d'événements `1048:031f` (clic ou touche) ou, s'il n'y en a pas, la position du curseur `1148:059d` (`GetCursorPos`) → `1038:0029` (survol des régions) ; met à jour `DS:3d0a` = durée du tour de boucle (en ticks).
- **La boucle n'est pas cadencée par une minuterie** : elle tourne à vitesse libre (boucle d'attente active avec `PeekMessage`) ; chaque module compare l'horloge `1090:0132` à ses propres échéances. **Sûr.**
- **Horloge du jeu** `1090:0132` (sûr) : `timeGetTime()` (`11c8:ae3e`), moins une origine (`DS:6d5a`) plus un décalage (`DS:6d5e`), **divisé par 17** (`DS:6d58` = 1 est posé par `1160:0000`). Le **tick** vaut donc **17 ms** (≈ 58,8 Hz), comme dans Mathémagique. Les valeurs de délai entre images des animations vues dans les appels de `11a8:0ad6` sont 6 et 7 ticks (102 et 119 ms, soit ≈ 8 à 10 images / s).
- `timeSetEvent` n'est utilisé que par le gestionnaire « MOHAWK OS » (`11c8:b062`, période bornée par `timeGetDevCaps`, plafonnée à 27 ms sous Windows 3.x : `11c8:af54`) pour des services en arrière-plan (son, MIDI) : **probable**. Il n'y a pas de `SetTimer` dans la boucle de jeu (`SetTimer` n'apparaît que dans `11c8:84be`, service générique).
- **Sortie** : `DS:a1ee ≠ 0` (posé par `Ctrl+Q` `11a0:44f2`, par la touche `0x11` pendant le logo `1180:0000`, par `WM_CLOSE`).

### 1.4 Fenêtre, résolution, WinG

- `1148:0275` (sûr) : `RegisterClass` (procédure de fenêtre `1148:0d80`, icône `AppIcon`, fond `BLACK_BRUSH`), `CreateWindow` de style `0x80880000` (`WS_POPUP | WS_BORDER | WS_SYSMENU`), de la taille de l'écran plus les bordures, positionnée en `(-bordure, -bordure)` : **fenêtre plein écran sans cadre**. Le jeu exige un affichage **256 couleurs, au minimum 640 × 480** (message `This program requires a SVGA card set to %s colours and a minimum resolution of %u x %u`). La surface de dessin du jeu est de **640 × 480** : tous les fonds plein écran sont des `tBMP` de 640 × 480 (§5), le `Terrain` fait 160 × 120 = 640 × 480 / 4 (§3.4). Le placement de la zone 640 × 480 dans un écran plus grand n'a pas été étudié (**hypothèse** : coin haut-gauche, à vérifier dans `11e8:76fe`, qui convertit les coordonnées client de la souris).
- **WinG** (`11e8:9bcf`, sûr dans l'intention, **probable** dans le détail) : si `[Graphics] fEnableWinG` est vrai, que le jeu tourne sous Windows 3.x (`DS:b19e < 0x395`) et que `LoadLibrary` d'une DLL réussit (nom construit à l'exécution ; c'est `WING.DLL`), le moteur résout par ordinal `0x3e9`, `0x3ea`, `0x3eb`, `0x3ee`, `0x3f1` (WinG 1001 `WinGCreateDC`, 1002 `WinGRecommendDIBFormat`, 1003 `WinGCreateBitmap`, 1006, 1009 `WinGBitBlt`) et dessine dans un bitmap WinG ; sinon retombe sur GDI (`BitBlt`, `StretchDIBits`, DIB 8 bits ; `DIB.DRV` fourni sur le CD pour les cartes sans accélération). Le jeu importe seulement `GDI`, `KERNEL`, `MMSYSTEM`, `USER` : WinG, `QTIM.DLL`, `QTIMCMGR.DLL`, `ver.dll`, `toolhelp.dll` sont chargés dynamiquement.
- **QuickTime** : le logo de démarrage (`Logo025.MOV`, `1530:38a7`) est lu par `1008:013c` via `QTIM.DLL` (exigence : QuickTime pour Windows 2.03). Seul `Logo025.MOV` est nommé dans l'exécutable : `LOGO025B`, `LOGO027`, `LOGO027B` ne sont référencés nulle part (**sûr** pour l'absence de chaîne ; leur usage éventuel est une **hypothèse** : variantes pour d'autres versions).

## 2. Enchaînement des écrans

### 2.1 Table des écrans : `1530:14fe`

**Sûr.** 23 pointeurs lointains de 4 octets à `DS:14fe` (`14fe`, `1502`, … `1552`), indexés par le numéro d'écran `0…22`, chacun vers un **descripteur d'écran** situé dans `DS`. Lecture : `1108:0000` (Enter), `1160:05c9` (Exit, tous les écrans à la sortie), `1160:085a` (Tick), `1198:05b3` (touche). Descripteur (relogements relus dans la table de relocation du segment) :

| Offset | Contenu |
|---:|---|
| `+0x00` | **Enter** (pointeur lointain) : ouvre l'archive, charge le fond, les groupes de formes, les scripts, crée les objets (§2.6) |
| `+0x04` | **Exit** (`Leave`) : libère les groupes, les features, ferme l'archive ; appelé par le Tick de l'écran quand il quitte (`DS:8556 ≠ 0`), et par `1160:05c9` pour les 23 écrans à la fermeture |
| `+0x08` | **Tick** : appelé à chaque tour de boucle par `1160:085a` |
| `+0x0c` | toujours 0 (non utilisé) |
| `+0x10` | **Key** : `(touche) → bool`, appelé par `1198:05b3` avant les raccourcis généraux ; renvoie ≠ 0 si la touche est consommée |
| `+0x14…` | données propres à l'écran (valeurs vues : `000a 0096`, `002b 0036`, `0257 0136`, `0257 0140`, `008a 0125`, un pointeur `1530:03f8` pour le sélecteur ; rôle non étudié) |

| N° | Descripteur | Enter | Exit | Tick | Key | Archive | Écran |
|---:|---|---|---|---|---|---|---|
| 0 | `1530:3890` | `1180:0048` | `1180:007d` | `1180:012d` | `1180:0000` | (aucune) | logo QuickTime `Logo025.MOV` |
| 1 | `1530:15ac` | `1110:0107` | `1110:03b8` | `1110:0562` | `1110:0ab4` | `MAP.MHK` | carte des épreuves (« Map/Go Buttons ») |
| 2 | `1530:41c2` | `11b0:00c4` | `11b0:1326` | `11b0:139b` | `11b0:1748` | `XFER.MHK` | **transition** animée entre deux écrans (§2.4) |
| 3 | `1530:1a6a` | `1128:006d` | `1128:049a` | `1128:0566` | `1128:05dc` | `PICKER.MHK` | choix des Zoombinis (zoombinîle) |
| 4 | `1530:0498` | `10b0:0027` | `10b0:0620` | `10b0:073d` | `10b0:0fb3` | `BASECAMP.MHK` | camp de base 1 (« l'abri du rocher ») |
| 5 | `1530:0750` | `10b8:0030` | `10b8:0654` | `10b8:0771` | `10b8:0f3d` | `BCTWO.MHK` | camp de base 2 (« l'aire de grozarbre ») |
| 6 | `1530:393c` | `1188:0128` | `1188:0c1d` | `1188:0ce5` | `1188:1380` | `TOWN.MHK` | Zoombiniville |
| 7 | `1530:0a98` | `10c0:00e6` | `10c0:058d` | `10c0:05e4` | `10c0:0d20` | `BRIDGE.MHK` | épreuve 1 |
| 8 | `1530:3b7a` | `1190:0107` | `1190:06a2` | `1190:06ff` | `1190:1199` | `TUNNELS.MHK` | épreuve 2 |
| 9 | `1530:1b50` | `1130:0000` | `1130:0d28` | `1130:0d85` | `1130:1a66` | `PIZZA.MHK` | épreuve 3 |
| 10 | `1530:106a` | `10d8:0071` | `10d8:059b` | `10d8:0615` | `10d8:0df6` | `FERRY.MHK` | épreuve 4 |
| 11 | `1530:142a` | `10f8:0000` | `10f8:0b0f` | `10f8:0bd7` | `10f8:41be` | `LILLY.MHK` | épreuve 5 |
| 12 | `1530:24c6` | `1170:0000` | `1170:04db` | `1170:0532` | `1170:1740` | `SLIDES.MHK` | épreuve 6 |
| 13 | `1530:119c` | `10e0:00ea` | `10e0:0600` | `10e0:06a8` | `10e0:0def` | `FLEENS.MHK` | épreuve 7 |
| 14 | `1530:129e` | `10e8:0000` | `10e8:06f5` | `10e8:07ca` | `10e8:2289` | `HOTEL.MHK` | épreuve 8 |
| 15 | `1530:19a2` | `1120:0000` | `1120:04fd` | `1120:0554` | `1120:10cd` | `NET.MHK` | épreuve 9 |
| 16 | `1530:0bc4` | `10c8:0000` | `10c8:0945` | `10c8:09a6` | `10c8:1cf5` | `CAVES.MHK` | épreuve 10 |
| 17 | `1530:21b8` | `1158:0000` | `1158:0c4c` | `1158:0cbe` | `1158:2504` | `SMOKE.MHK` | épreuve 11 |
| 18 | `1530:180c` | `1118:0000` | `1118:145f` | `1118:1503` | `1118:2989` | `MAZE2.MHK` | épreuve 12 |
| 19 | `1530:16be` | `1110:20f6` | `1110:2354` | `1110:23ac` | `1110:2b0f` | `PICKER.MHK` | sous-écran du sélecteur (§2.5) |
| 20 | `1530:1708` | `1110:2f46` | `1110:311e` | `1110:317c` | `1110:35ae` | `PICKER.MHK` | autre sous-écran du sélecteur (§2.5) |
| 21 | `1530:16be` | (= 19) | | | | | doublon du 19 |
| 22 | `1530:3890` | (= 0) | | | | | doublon du 0 |

Les écrans de jeu (« joueurs en partie ») sont `1…18` (`0 < DS:8552 < 0x13` dans `1160:05c9`, `1160:0521`) ; `0` est le logo, `19`–`22` n'ont pas de rôle de partie.

### 2.2 Changement d'écran : `1198:0000` → `1108:0000`

Variables (sûr) : `DS:8552` écran courant, `DS:8554` écran **demandé** (-1 = aucune demande), `DS:8556` écran **à rejoindre** posé par un écran qui veut partir (le Tick le recopie en `8554` puis appelle son propre Exit, exemple `10b0:073d`), `DS:855a` écran précédent, `DS:8558` écran cible final quand on passe par la transition, `DS:4180` numéro de trajet de transition (§2.4), `DS:2362` = pointeur vers l'enregistrement du joueur courant (`0xca` = écran courant, `0xcc` = dernier écran de partie, `0x50`, `0x51`, `0x52` = bits d'épreuves terminées par niveau, `0x54` = drapeau).

`1108:0000` (sûr) :
1. **Progression** : en quittant les écrans 9 (Pizza → 4), 12 (Slides → 5), 15 (Net → 5), 18 (Maze2 → 6), met un bit `1 << (niveau & 3)` dans l'enregistrement : `+0x50` pour 9, `+0x52` bits 0–3 pour 12, `+0x52` bits 4–7 pour 15, `+0x51` pour 18 (`niveau` = `1168:515d`, de 1 à 4, ajusté de 1 si `DS:9700 ≠ 0`) ; `DS:8550` mémorise l'épreuve terminée.
2. **Transition** : `bVar3 = vrai` si l'écran quitté est 3, 4, 5, 7…18 (pas 0, 1, 2, 6) et la cible n'est pas 1 (la carte), sauf si `DS:970a ≠ 0` (partie d'entraînement / chargement) ou `DS:854e ≠ 0` (transitions désactivées par `Ctrl+T`) ; `DS:4180 ≠ 0` force la transition. Avec transition : `DS:8558 = cible`, `DS:8552 = 2` (écran `XFER`) ; sans : `DS:8552 = cible`.
3. Enregistre `rec+0xca = écran` et, si la cible n'est ni 0 ni 2, `rec+0xcc = cible` (reprise de partie : `1160:0521` rejoint `rec+0xcc` si c'est 1, 3, 4, 5, 6 ou 7…18 avec une équipe non vide, sinon l'écran 3).
4. `DS:8548 = tick + 900` (garde de 15 300 ms), efface `DS:3fca`, `DS:3fc0`, **appelle le handler Enter** `*(DS:14fe + 4 × DS:8552)`.

### 2.3 Correspondance archive → épreuve

Les 15 noms de `TEXTSTR.MHK` `STRL` 2000 (premier octet `0x10` = compte, puis chaînes en Mac Roman terminées par `\0`) sont, dans l'ordre : 0 « zoombinîle », puis **1 les gorges allergiques, 2 les grottes de passe-clos, 3 la hutte à pizza, 4 l'abri du rocher, 5 le bac du père mathieu, 6 les têtards tatoués, 7 la fosse de monte-pierre, 8 les nizibooms, 9 l'hôtel du temps-compté, 10 la muraille de signes, 11 l'aire de grozarbre, 12 la tanière du sphinx, 13 le piège de cristal, 14 le gouffre des véhibules, 15 zoombiniville**. Les écrans de la table, dans l'ordre 7, 8, 9, [4], 10, 11, 12, 13, 14, 15, [5], 16, 17, 18, [6], correspondent un à un à cette liste (séquence 7-8-9-4-10-11-12-13-14-15-5-16-17-18-6 = ordre du parcours de la carte, voir §2.4).

| Écran | Archive | Fonction Enter | Nom (`STRL` 2000) | Confiance | Indices |
|---:|---|---|---|---|---|
| 7 | `BRIDGE.MHK` | `10c0:00e6` | les gorges allergiques | sûr | chaînes `Upper bridge accepts:` / `Lower bridge accepts:` (`1530:0b97`, `0bad`) : deux ponts qui acceptent des traits de Zoombini ; rendu : falaise |
| 8 | `TUNNELS.MHK` | `1190:0107` | les grottes de passe-clos | sûr | chaînes `Left / Bottom accept:`, `Right / Top accept:`, `Right accepts:`… (6 règles de tunnels) ; rendu : grotte |
| 9 | `PIZZA.MHK` | `1130:0000` | la hutte à pizza | sûr | chaînes `Arno`, `Willa`, `Shyler`, `Meal` + 8 entiers (`1530:1bc2`…) : les trolls et le repas ; rendu : hutte |
| 10 | `FERRY.MHK` | `10d8:0071` | le bac du père mathieu | sûr | chaîne `Play FrogMan SCRB id:` (`1530:10fe`) ; rendu : ponton |
| 11 | `LILLY.MHK` | `10f8:0000` | les têtards tatoués | sûr | texte d'épreuve `STRL` 2016 : « nénuphars » ; rendu : rivière |
| 12 | `SLIDES.MHK` | `1170:0000` | la fosse de monte-pierre | probable | par élimination et ordre (écran 12 = 3e de l'étape 2) ; rendu : enclos herbeux |
| 13 | `FLEENS.MHK` | `10e0:00ea` | les nizibooms | sûr | « Fleens » = nizibooms ; `SCRS` 110 + `REGS` de coordonnées ; rendu : forêt |
| 14 | `HOTEL.MHK` | `10e8:0000` | l'hôtel du temps-compté | sûr | nom d'archive ; 290 `SCRB` |
| 15 | `NET.MHK` | `1120:0000` | la muraille de signes | probable | `STRL` 2016 : « muraille » + « catapultaboue » ; rendu : mur de dalles |
| 16 | `CAVES.MHK` | `10c8:0000` | la tanière du sphinx | probable | chaîne `Hieroglyphs` (`1530:0f39`) ; rendu : patte et serpent jaune |
| 17 | `SMOKE.MHK` | `1158:0000` | le piège de cristal | probable | par élimination (3e de l'étape 4 après la tanière) ; rendu : salle de pierre |
| 18 | `MAZE2.MHK` | `1118:0000` | le gouffre des véhibules | probable | `REGS` de niveaux ; 22 `REGS`, 104 `SCRS` ; rendu : gouffre |
| 4 | `BASECAMP.MHK` | `10b0:0027` | l'abri du rocher (camp 1) | sûr | `STRL` 2002 « abri rocher » |
| 5 | `BCTWO.MHK` | `10b8:0030` | l'aire de grozarbre (camp 2) | sûr | `STRL` 2002 « aire grozarbre » ; rendu : maison dans un arbre |
| 6 | `TOWN.MHK` | `1188:0128` | zoombiniville | sûr | |
| 3 | `PICKER.MHK` | `1128:006d` | zoombinîle (sélection des Zoombinis) | sûr | |
| 1 | `MAP.MHK` | `1110:0107` | la carte | sûr | `Map/Go Buttons` |
| 2 | `XFER.MHK` | `11b0:00c4` | transitions | sûr | `xfer.MHK` |

`STRL` 2016 (1 726 octets, 16 chaînes) donne les textes « ont bravé… » des monuments de Zoombiniville : 4 étapes × 4 niveaux de difficulté (gorges + grottes + hutte ; bac + nénuphars + fosse ; nizibooms + hôtel + muraille ; sphinx + piège de cristal + gouffre), ce qui confirme le regroupement des épreuves par trois.

### 2.4 Parcours : les 16 trajets de transition (`11b0:00c4`)

`DS:4180` (1 à 16) choisit le trajet `(départ → arrivée)` ; **sûr** (code) :

| Trajet | De → vers | Étape de transition `DS:ad26` |
|---:|---|---|
| 1 | 3 Picker → 7 Bridge | 0 |
| 2 | 7 → 8 Tunnels | 1 |
| 3 | 8 → 9 Pizza | 1 |
| 4 | 9 → 4 BaseCamp | 1 |
| 5 | 4 → 10 Ferry | 2 |
| 6 | 10 → 11 Lilly | 2 |
| 7 | 11 → 12 Slides | 2 |
| 8 | 12 → 5 BCTwo | 2 |
| 9 | 4 → 13 Fleens | 3 |
| 10 | 13 → 14 Hotel | 3 |
| 11 | 14 → 15 Net | 3 |
| 12 | 15 → 5 BCTwo | 3 |
| 13 | 5 → 16 Caves | 4 |
| 14 | 16 → 17 Smoke | 4 |
| 15 | 17 → 18 Maze2 | 4 |
| 16 | 18 → 6 Town | 5 |

Le parcours est donc : Picker → **Bridge → Tunnels → Pizza** → camp 1 (BaseCamp) → soit **Ferry → Lilly → Slides**, soit **Fleens → Hotel → Net** (deux itinéraires) → camp 2 (BCTwo) → **Caves → Smoke → Maze2** → Town. Les écrans de fin d'épreuve fixent `DS:8556` (suite) : 10c0:0a99 Bridge → 8 (ou 1 = carte si abandon), 10d8:0984 Ferry → 11, 10f8:1b3a Lilly → 12, 10e0:0ae5 Fleens → 14, 10e8:1cea Hotel → 15, 1120:0f25 Net → 5, 10c8:130f Caves → 17, 1118:2285 Maze2 → 6, 10b0:0819 BaseCamp → 10 ou 13, 10b8:088c BCTwo → 16, 1128:079c Picker → 7.

`XFER.MHK` contient 6 jeux (`tBMP` 1000, 2000, … 6000 : un fond 640 × 480 en RLE + une planche multi-images + scripts `SCRB` 1100–6108 et `SCRS` 5199–6204) ; `DS:ad26` (0 à 5) choisit le jeu de la région traversée (0 : début, 1 : étape 1, 2 : Ferry-Lilly-Slides, 3 : Fleens-Hotel-Net, 4 : Caves-Smoke-Maze2, 5 : Town). Le son d'ambiance de la transition est tiré au hasard (`10a8:04e8`) dans une plage d'ids propre au jeu (`DS:ad24`, ex. `0x4e7e`…`0x4e83` = 20094…20099 pour la région 0). `STRL` 2023 : « transitions activées / désactivées » (`Ctrl+T`, `DS:854e`).

### 2.5 Écrans 19, 20 (sous-écrans de `PICKER.MHK`)

`1110:20f6` (19 et 21) charge le fond `SHPL`/`tBMP` 1001 de `PICKER.MHK`, les groupes de formes 1100 et 1200 (6 + 5 scripts `SCRB` 1100–1105 et 1200–1204) et les sons 1200 / 1201. `1110:2f46` (20) charge le fond 4000, les formes 4100, 4200, 4300, 4400 (`SCRB` 4100–4110). Ils ne sont jamais choisis par une constante visible dans le code (aucun `MOV [8554], 0x13/0x14/0x15`) : **leur rôle est un point ouvert** (**hypothèse** : écrans de gestion des parties, `Charger` / `Enregistrer`, ou fiches d'équipe de `STRL` 2018).

### 2.6 Schéma d'un handler Enter (modèle : `BaseCamp`, `10b0:0027`)

**Sûr** (désassemblage ; arguments dans l'ordre d'appel après correction du §0.2) :

```
11b8:0fa2("BaseCamp.MHK", &DS:6df2)     ouvre l'archive (chaîne 1530:0736)
11b8:0011(archive)                        archive courante (DS:4270) pour les sons, §6
1168:2a5c(1000)                           NODE 1000 + PATH 1000 → DS:2388 / DS:2384  (§4.1, §4.2)
11a8:0f9e(".txt")                         (tBMP/REGS d'un groupe « global » : DS:a410, a41c, a420)
11a8:1783(100)                            « Terrain » : tBMP 100, 160 × 120 → DS:3fd8   (§3.4)
11a8:1475(1000)                           fond : SHPL 1000 (palette) + tBMP 1000 (640 × 480) → DS:a620
11a0:0000(0, 0, 1100)                     groupe de formes 0 = tBMP 1100 (sans REGS)
11a0:0000(0, 1, 1200)                     groupe 1 = tBMP 1200
11a8:14ab(16, 1100)                       16 SCRB « principaux » ids 1100…1115  → groupe 0
11a8:15a6(0, 16, 1200)                    16 SCRB suivants ids 1200…1215        → groupe 1
11a8:2ae6(…, 2000), 11a8:2ae6(…, 2100)    deux planches multi-images supplémentaires (hors groupes)
1058:048a(0xec, 10)                       sauve les 236 entrées de palette 10…245 (copie DS:60ce → DS:64ce)
11a8:0ad6(…)                              crée les objets animés (« features »), une fois par script (§3.5)
```

Convention observée : l'**id du groupe de formes = id du premier `SCRB` du groupe** (1100 et 1200 ici) ; le **fond a l'id 1000** (`tBMP`, `SHPL`, `NODE`, `PATH`) dans tous les écrans de jeu. Les écrans appellent aussi `1038:0000` (déclaration des régions cliquables), `1058:0ad3` (rafraîchit un rectangle), `11a8:302b`.

## 3. Les ressources `SCRB` et `SCRS` : scripts d'animation d'objets

### 3.1 Nature

**Sûr.** Contrairement aux `\0SCR` de Mathémagique (script d'un seul bloc rectangulaire, opcodes par cellule), les `SCRB` et `SCRS` sont des **séquences d'images**, chacune étant la **liste des sprites visibles** (avec leur position). Un objet animé du moteur (une « feature ») lit une image par échéance (§3.5) et redessine. Il n'y a **pas d'opcode** : tout est dans des mots de 16 bits **big-endian** (échangés au chargement par `11a8:2c8a`). **Aucun lien avec les `\0SCR` de Mathémagique** : ni zone d'écrêtage, ni délais dans le script (le délai est un paramètre de l'objet).

- `SCRB` (« script de bitmaps », 8 chargeurs : `10d8:1271`, `10e8:2ade`, `10f8:4bf9`, `11a0:1597`, `11a0:1737`, `11a8:14ab`, `11a8:15a6`, `11a8:1be6`) : animations d'objets de décor, d'interface et de personnages de puzzle. Tag `0x53435242`. 1 784 ressources dans 21 archives.
- `SCRS` (« script de snoid », 8 chargeurs : `10e0:0ee1`, `10e0:0f51`, `10e0:18a7`, `1168:0376`, `1168:03ef`, `1168:04d0`, `1168:05fa`, `1168:3f76`) : animations des **Zoombinis** (et de créatures qui se déplacent comme eux, les Fleens, les Nizibooms). Tag `0x53435253`. 719 ressources dans 15 archives.

### 3.2 Format binaire

**Sûr** : vérifié sur les **1 784 `SCRB` et les 719 `SCRS`**, qui se décodent tous exactement jusqu'à leur dernier octet, sans reste ni bourrage.

Tout est en **big-endian**, en mots de 16 bits (`i16` signés quand il est dit).

```
SCRB                              SCRS
u16 nombre d'images n             u16 nombre d'images n
(images)…                         u16 type de pose  (voir §3.6)
                                  (images)…
```

Une **image** est :

```
répéter (au plus 24 fois) :
    i16 w
    si  w > 0  : partie
                 i16 x, i16 y                  → 3 mots : (w, x, y)
    si  w == 0 : case vide (consomme 3 mots : 0, x, y)  -- 850 cas dans les SCRB, 129 dans les SCRS
    si  w < 0  : terminateur de l'image :
                 octet haut = 0xff ou 0xfe dans toutes les données ; octet bas = numéro d'événement
                 si  w < -0x100 (valeur non signée ≤ 0xfeff) : un mot supplémentaire = id de son à jouer
                 l'image est finie
```

- Une **partie** `(w, x, y)` : `w` = **indice 1-based** de l'image dans le **groupe de formes** (planche multi-image `tBMP`, §5.2) ; `(x, y)` = position en pixels dans l'écran 640 × 480 (voir §3.4 pour la soustraction de `REGS`). Vérifié : composer les 32 premières images des `SCRB` 1100–1115 et 1200–1215 de `BASECAMP.MHK` sur le fond 1000 donne bien la scène (champignons, flamme, insecte dans l'étang) : `w = 0` n'est pas dessiné, l'indice de couleur 0 de chaque forme est transparent.
- **Terminateur** `w` (non signé) : l'octet bas `b = w & 0xff` est un **numéro d'événement** : si `b ≠ 0` et que l'objet a un rappel d'événements (`+0x10`), le moteur l'appelle avec `b - 1` (`11a0:033a`). Valeurs vues : `0xff00` (plain, 23 499 fois dans les `SCRB`), `0xfe00` (avec id de son, 1 192), `0xff01`…`0xff0b`, `0xff3e`, `0xff3f`, `0xfe01`…, et `0xffc9`…`0xffd9` dans les `SCRS` (sons dépendant du Zoombini, §3.7). L'octet haut vaut `0xff` (pas de son) ou `0xfe` (un id de son suit) ; la règle du code est `w < -0x100` ⇒ un mot de son suit.
- Une image de 24 parties exactement (8 `SCRB` : FERRY 1517, 1518, 1519, 1523, 1524, 1527, 1529 et LILLY 10169, mesuré par `test/zoombinis/data.test.ts`) : **tranché** (`11a0:033a`, **sûr**), voir §3.5 et les points ouverts : la boucle de 24 itérations s'arrête sans avoir lu le terminateur ; celui-ci est lu au tour suivant comme premier mot d'une image vide.
- Nombre maximal de cases lues par image : 24 (`local_1a = 0x18` dans `11a0:1013` et `11a0:033a`).

**Exemple décodé** (`PICKER.MHK`, `SCRB` 1200, 52 octets) :

```
00 06                                   6 images
00 01 01 40 00 f0   ff 00               image 0 : partie (1, 320, 240) ; fin
00 02 01 40 00 f0   fe 01  04 b0        image 1 : partie (2, 320, 240) ; fin, événement 0, son 1200 (0x04b0)
00 03 01 40 00 f0   ff 00               image 2 : (3, 320, 240)
00 04 01 40 00 f0   ff 00               image 3 : (4, 320, 240)
00 05 01 40 00 f0   ff 00               image 4 : (5, 320, 240)
00 00 00 00 00 00   ff 00               image 5 : case vide (0, 0, 0) ; fin
```

et `SCRS` 105 de `ZOOMBINI.MHK` (260 octets) : `00 08` (8 images) `00 00` (pose 0) ; image 0 : `(4, 1, -2) (4, 2, -2) (2, 1, -2) (2, 2, -2) (6, 3, -2)` + `ff 00` ; image 1 : `(5, 2, 2) (5, 2, 2) (2, 2, 2) (2, 3, 2) (2, 3, 2)` + `ff 00` ; … Les `SCRS` comptent en pratique 5 parties (un emplacement par famille : pieds, corps, nez, yeux, cheveux, dans un ordre qui dépend de la pose, §3.6 : **sûr**).

Statistiques (toutes archives) : au plus 24 parties par image ; `SCRB` : 23 499 images à terminateur `0xff00`, 1 260 images avec un id de son (dont 1 192 à `0xfe00`) ; `SCRS` : 14 019 à `0xff00`, 1 056 images avec un id de son (dont 985 à `0xfe00`) ; second mot de `SCRS` : 0 (436 fois), 2 (127), 1 (95), 3 (59), `0xffff` (2).

### 3.3 Résolution d'un id de `SCRB` vers un groupe de formes

**Sûr.** Les `SCRB` ne portent pas l'id de leur planche : le lien est établi à l'inscription des scripts par l'écran.

- `11a8:14ab(nombre, id_premier)` : charge `nombre` `SCRB` consécutifs (`id_premier + i`) dans le tableau `DS:a750` (300 emplacements de 4 octets = pointeur lointain ; « Too many main-feature SCRBs » au-delà de 300) ; enregistre la plage dans `DS:a624[k]` (premier id) / `DS:a634[k]` (nombre), `k = DS:a644` (jusqu'à 8 plages).
- `11a8:15a6(max, nombre, id_premier)` : ajoute une plage suivante (« next-group-feature SCRBs ») à la suite des emplacements déjà pris.
- `11a8:166e(id)` : id de script → **emplacement** (`+0xc2` de l'objet) et **groupe** `k` (`+0xc4`), `k` = rang de la plage contenant `id`.
- `11a0:0000(flag, k, id_tBMP)` (module « groupes de formes ») : charge le **groupe `k`** (0 à 7) = planche multi-image `tBMP id_tBMP` (`11a8:2ae6`, stockée en `DS:a21a[k]`, 4 octets) ; si `flag ≠ 0`, charge aussi **`REGS id_tBMP` et `REGS id_tBMP + 1`** (`1168:01f4`) en `DS:a27a[k]` et `DS:a29a[k]`. Sinon les parties sont posées telles quelles (cas du camp de base).

Pour les Zoombinis, la planche et ses `REGS` sont chargés par `1168:004f` : `tBMP` 3000 (890 images) avec `REGS` 100 / 101, `tBMP` 3100 (798 images) avec `REGS` 102 / 103, `tBMP` 3200 (568 images) avec `REGS` 3200 / 3201 ; les 51 `SCRS` communs 100…150 sont chargés par `1168:0376` (`DS:9754[0…50]`), et un écran en ajoute d'autres par `1168:03ef` (REJECT, `DS:9820[0…109]`, max 110, id de départ `param_3`) et `1168:04d0` (NORMAL). **Confirmé par `1168:004f` et `1168:5a13`** : `REGS` 100 / 101 ↔ `tBMP` 3000, 102 / 103 ↔ 3100, 3200 / 3201 ↔ 3200 (`1168:5a13(0)` remplace 3000 par 3200 dans HOTEL, TOWN et XFER). Composition des parties de Zoombini : §3.6. Les tailles se recoupent : `REGS` 100 = 1 782 octets = 891 mots = 890 images + 1.

### 3.4 Soustraction de `REGS` et rectangle

**Sûr.** Quand le groupe a des `REGS`, chaque partie `(w, x, y)` est recalée avant le dessin (`11a0:1013`, `11a0:033a`) :

```
x_écran = x - REGS_X[w]        y_écran = y - REGS_Y[w]        (REGS_X = REGS id, REGS_Y = REGS id+1, indexés par w, mot 0 = 0)
```

c'est-à-dire que `REGS` donne le **point d'ancrage** de chaque image dans sa planche. Le rectangle d'une partie est `(x_écran, y_écran, x_écran + largeur, y_écran + hauteur)` où largeur et hauteur sont les deux premiers mots (big-endian) de la sous-image (§5.2) ; l'union des parties d'une feature donne son rectangle `(+0xce, +0xd0, +0xd2, +0xd4)`, utilisé comme rectangle sale (`11d8:01a2`, `11d8:1998`, `11d8:10aa`).

Le « terrain » (`11a8:1783(100)`, tBMP 100, 160 × 120, **un octet par cellule de 4 × 4 pixels**, valeurs 0, 1, 2 : 0 = hors zone, 1 = zone marchable, 2 = rare (`HOTEL.MHK` : 8 cellules)) sert aux déplacements des Zoombinis (**probable** : vu la taille, la valeur et l'usage de `DS:3fd8` par `1168:*`).

### 3.5 Objet « feature » et interpréteur

**Sûr** pour les champs et l'algorithme ; les significations de drapeaux sont **probables**.

`11a8:0ad6(profondeur, ordre, ptr_position, délai, id_script, crochet_tick, crochet_dessin, drapeaux)` crée une feature (objet de `0xec`, `0x133` ou `0x25a` octets selon les drapeaux 1 / 2), l'insère dans la liste chaînée `DS:3fee` triée par profondeur (`11a8:231b`, `11a8:25ad`, `11a8:2737`) et l'enregistre. Champs :

| Offset | Contenu |
|---:|---|
| `+0x00` / `+0x04` | liens précédent / suivant |
| `+0x08` | rappel appelé **après** le dessin de l'image courante (`param_7`) |
| `+0x0c` | rappel appelé **avant** (`param_6`, chaîné par `11a8:04b9`) |
| `+0x10` | rappel d'événement `(image, numéro)` : numéro = octet bas du terminateur − 1 ; appelé avec `0xffff` à la fin de l'animation |
| `+0x14` | rappel appelé à chaque image jouée ; **probable** : non posé pour les snoids, que pilote leur crochet « avant » `+0x0c` = `1168:0ba8` (§3.6) |
| `+0x18` | région (`11d8:0958`) quand le drapeau `0x08000000` est posé |
| `+0x1a` | numéro d'ordre (créé par `11a8:0ad6`) |
| `+0x1c` | id du script courant ; `+0x1e` id mis en file (négatif : jouer en mode aléatoire) |
| `+0x20` | drapeaux (dword, ci-dessous) |
| `+0x24` | instant de la prochaine image (ticks de 17 ms) ; `+0x28` délai entre images (`param_4`) |
| `+0x2c` | à redessiner ; `+0x2d` script en cours de remplacement ; `+0x2e` première image ; `+0x2f` rappel à notifier |
| `+0x30…` | tampon des parties de l'image courante : jusqu'à 24 triplets `(w, x, y)` de 3 mots, terminé par `w = 0` |
| `+0xc2` / `+0xc4` | emplacement du script (index dans `DS:a750` / `DS:9754`) / numéro de groupe |
| `+0xc6` | dernier indice d'image (`n - 1`) ; `+0xc8` image courante |
| `+0xca` | **index en mots** de l'image courante dans le script (1 au début pour un `SCRB`) |
| `+0xce…+0xd4` | rectangle `(gauche, haut, droite, bas)` de l'image courante |
| `+0xd6…+0xdc` | position de référence (`0x800000`) |
| `+0xe0` | **en lecture** (booléen) ; `+0xe2` mode d'écrêtage ; `+0xe4…` rectangle d'écrêtage |

**Ordre de dessin (`11a8:231b`, `25ad`, `2737`, **sûr**).** La liste `DS:3fee` n'est pas figée à l'insertion : `11a8:04b9` (tour du moteur) rappelle `11a8:231b` à chaque tour, après les rappels « avant » des features (`+0x0c`, dont `11a0:033a` qui met les rectangles à jour), si `DS:3fdc ≠ 0` (`11a8:29c4(1)`, `29f6` ; `29c4(0)` le coupe) et `DS:a2da == 0`. Elle a deux nœuds fixes : tête `DS:a448` (drapeaux `0x1008000`) et queue `DS:a534` (`0x1000`). Répartition (dans l'ordre des tests) : `0x8000` → reste en tête ; `0x4000000` → liste A (déjà triée, ordre conservé) ; drapeaux `== 1` ou `== 2` (mobile) → liste C ; sinon liste B, et si `0x1000` n'est pas posé le bit `0x4000000` est posé (tri unique). B et C passent par `25ad` (tri par insertion sur le rectangle `+0xce` : bord bas, puis bord gauche, croissants ; un objet `0x1000` va en fin de liste) puis `2737` les insère dans la liste (B d'abord, puis C) : devant la première feature qu'ils précèdent (même clé) à partir de la fin du bloc `0x8000`, sauf si elle porte `0x40000000` (il faut que son bord gauche ≤ celui du passant), `0x10000000` (bord droit du passant ≤ le sien) ou `0x20000000` (son bord haut ≤ celui du passant) tant que le bord bas du passant n'est pas au-dessus de son bord haut ; une feature `0x1000` arrête toujours la recherche, et un objet `0x1000` est ajouté en dernier. Conséquence : ce n'est ni l'ordonnée de la position ni l'ancre qui compte, mais le **bord bas du rectangle de l'image** ; les mobiles sont re-triés à chaque tour, le décor une fois (au premier tour, rectangle de sa première image). Portage : `Features.reorder` (`engine/features.ts`).

Drapeaux (`+0x20`) vus dans `11a0:033a` / `11a0:1013` / `11a8:1be6` : `0x1` snoid (utilise les tables `SCRS` `DS:9754` / `DS:9820` et un objet `0x133` octets), `0x2` autre type (`0x25a` octets), `0x2000` joue sa première image à la création, `0x4000` ne pas dessiner, `0x8000` objet « actif » mémorisé (`DS:a646`), `0x10000` arrêt et retour au début (le bit est effacé), `0x20000` s'arrête après chaque image, `0x40000` à la fin du script prend le script en file (`+0x1e`), `0x80000` ne pas rejouer, `0x100000` **arrêt à la fin** (sans ce bit, l'animation reboucle à l'image 0), `0x800000` position relative, `0x1000000`, `0x2000000` **lecture aléatoire** (l'image suivante est tirée par `10a8:04e8(dernier, 0)`), `0x4000000`, `0x8000000` région attachée.

Algorithme (`11a0:033a`, chaque tour, par feature active `+0xe0 ≠ 0`) :

1. si `tick ≥ +0x24` : `+0x24 = tick + +0x28` ; dessine/efface les parties précédentes (`11d8:1998`) ;
2. avance : si l'image courante < dernière → image + 1 (ou tirage aléatoire) ; sinon, selon les drapeaux : file `+0x1e`, reboucle (`+0xc8 = 0`, `+0xca = 1`), ou arrêt avec rappel `0xffff` ;
3. lit **jusqu'à 24 cases** à partir de `+0xca` (§3.2) ; recopie les parties en tampon (en ajoutant la position de référence), joue le son éventuel (`11a0:0ee7(0, id)` si le son est activé), appelle le rappel d'événement, met à jour `+0xca` (= position de lecture / 2) ;
4. appelle `+0x14`, soustrait `REGS` (§3.4), calcule le rectangle, marque les rectangles sales.

**Images de 24 parties et images vides (`11a0:033a`, lecture de la boucle `local_6 = 0x18`, **sûr**).** Le compteur `local_6` décroît à chaque mot lu. Un terminateur lu alors que `local_6 ≠ 0` ferme la liste (`*tampon = 0`) ; un terminateur lu comme 24e mot ferme aussi la boucle, mais une image de 24 parties vraies ne lit jamais son terminateur (la boucle s'arrête à `local_6 == 0` avant). Il reste donc à lire au tour suivant, où il est le **premier** mot de l'image : le test `local_6 == 0x17` le reconnaît, exécute son son et son évènement, met à jour `+0xca`, puis **retourne sans effacer ni redessiner** (la liste de parties de l'image précédente reste affichée) : c'est une image « vide » d'une durée (le délai `+0x28` est déjà armé). Conséquences : (1) le comportement à reproduire est celui de `script.ts` (`terminated: false`, le terminateur est relu comme image sans case, ses évènements et son son se déclenchent à ce tour-là) ; (2) le compteur d'images `+0xc8` avance d'un cran par tour, y compris pour cette image vide, alors que `n` ne la compte pas : le dernier ou les derniers vrais images du script sont donc **tronqués** (autant que d'images de 24 parties) et les derniers mots du script ne sont jamais lus, ce qui est le défaut de l'original (aucun autre code ne rattrape). Seuls les `SCRB` de FERRY et LILLY sont concernés (les `SCRS` n'ont pas plus de 16 parties). Une image dont la première case est `w == 0` (case vide) n'a pas de rectangle : elle efface l'image précédente et ne dessine rien (le rappel `+0x14` n'est appelé que si le premier mot est `> 0`).

`11a8:216f(0|1, &image, script)` calcule l'index en mots de l'image `n` (accès aléatoire : saute 3 mots par partie, 1 mot par terminateur, 2 si `w < -0x100`) ; avec le premier paramètre ≠ 0, il démarre au mot 2 (cas `SCRS`, qui a deux mots d'en-tête). `11a8:1be6(…, id, feature)` change le script d'une feature : recharge si besoin (`11a8:2c8a(SCRB)`), met `+0xc6 = n - 1`, `+0xc8 = 0`, `+0xca = 1`, `+0x24 = 0`.

### 3.6 Les `SCRS` (snoids)

Résultat de la tâche G1 (`src/games/zoombinis/data/zoombini.ts`, `test/zoombinis/zoombini.test.ts`). **Sûr** sauf mention : lu dans `1168:004f`, `0755`, `09f7`, `0858`, `0ba8`, `3f76`, `4231`, `4741`, `4dc9`, `5a13` et `5ddd`, et vérifié par les tailles des plages sur les 51 `SCRS` communs.

**Objet.** Un Zoombini est une *feature* de drapeau `0x1` (`0x133` octets, §3.5), créée par `1168:09f7` (`11a8:0ad6(profondeur 0, ordre 0, snoid, délai 6, script 0, crochet « avant » = tick `1168:0ba8`, crochet « après » = dessin `1168:0aa6`, drapeaux 1)` ; les `PUSH` de constantes y sont sur 32 bits, `RETF 0x1a`). Sa **structure propre (le « snoid »)** commence en `feature + 0x30` (là où les autres features ont leur tampon de parties) ; les `+0xNN` ci-dessous sont relatifs à elle, comme dans `1168:*`. `1168:0858` (tous les membres d'un groupe) et `1168:0755` (un seul) la construisent sur la pile depuis la fiche de 19 octets (`screens.md` §6.3), `11a8:0ad6` la recopie en `+0x30` de la feature ; `1168:5ddd` la remet à blanc.

| Offset | Contenu |
|---:|---|
| `+0x00…` | tampon de parties : triplets `(image 1-based de la planche, x, y)` de 3 mots, terminé par 0 (16 au plus) |
| `+0x92` | indice du script courant dans `DS:9754` (51 scripts communs) ou `DS:9820` (REJECT et NORMAL de l'écran) ; `+0x96` nombre d'images ; `+0x98` image courante ; `+0x9a` (dword) index en mots dans le script (2 au début, après l'entête) |
| `+0x9e` | rectangle sale (4 mots) |
| `+0xa6`, `+0xa8` | position `(x, y)` du Zoombini |
| `+0xaa`, `+0xac` | cible du trajet rectiligne en cours (états 7 et `0x70`) ; en états 8 et 9, **décalage** « première partie du script − point d'ancrage » (voir ci-dessous) |
| `+0xbc` à `+0xbf` | les 4 attributs, octets 0 à 3 de la fiche : **cheveux, yeux, nez, pieds** (**sûr**, voir ci-dessous) |
| `+0xc0` | pose courante (`0xffff` = aucune) |
| `+0xc2…+0xe0` | 16 mots : **bases de variantes** par emplacement (0 sauf `+0xc4…+0xcc`, écrits par `4dc9`) |
| `+0xe6`, `+0xe8` | destination finale de la marche |
| `+0xea` (i8), `+0xeb` | rang et numéro de chemin dans `PATH` (§4.2) ; `+0xf0` (i8) sens de parcours (1 ou −1) ; `+0xec`, `+0xee` pas de marche |
| `+0xf1` | variante d'attente : le script d'attente est `100 + (+0xf1)` (états 0, 1, 2, 4, 10 de `1168:4231`) |
| `+0xf2` | **orientation** (mot) : 0 = tourné vers la droite, 1 = vers la gauche |
| `+0xf4` | **état** (octet, voir plus bas) ; `+0xf5` (mot) secteur de marche (0 à 4) ou numéro d'animation d'attente (0 à 7) ou masque d'attributs (état 3) |
| `+0xf7` | présent (octet 8 de la fiche) |
| `+0xf8` | compteur d'attente : tiré à la création par `10a8:04e8(0x40, 0)` (0 à 64) pour que les Zoombinis ne clignent pas tous ensemble ; en état 0 il compte les ticks jusqu'au tirage d'une animation (`DS:235c`) |
| `+0xf9…+0x102` | 10 octets : les octets 9 à 18 de la fiche, recopiés tels quels ; **jamais lus** par `1168`, `1188`, `10b0`, `10b8` (réservés ; l'hypothèse « nom généré » de `screens.md` §6.3 reste non vérifiée) |

**Les 4 attributs (sûr).** `+0xbc` = cheveux, `+0xbd` = yeux, `+0xbe` = nez, `+0xbf` = pieds. Preuve : (1) les quatre tables de bases lues par `4dc9` donnent, pour chaque valeur 1 à 5, des plages de variantes de 16 (cheveux et yeux), 4 (nez) et de 55, 89, 25, 51, 34 (pieds) ; les maxima réels de `w` dans les 51 `SCRS` communs, une fois rangés par famille, valent exactement 16, 16, 4 et 11 (corps), et les `SCRS` 146 à 150 (un par valeur de pieds) montent à 55, 89, 25, 51 et 14 ; (2) l'état 3 de `1168:4231` remplace chaque famille par une image de « catalogue » de base `0x1a9` (cheveux), `0x1ae` (yeux), `0x1b8` (nez), `0x1b3` (pieds) ; (3) la voix dépend de `+0xbc` et de `+0xbe` (§3.7).

**Planches (sûr).** `1168:004f` charge `tBMP` 3000 (890 images, `REGS` 100 / 101, planche « grande »), `tBMP` 3100 (798 images, `REGS` 102 / 103, scripts de rejet) et `tBMP` 3001 (3 images de 87, 131 et 198 × 19 pixels, rangée en `DS:2368` ; usage non établi). `1168:5a13(0)` bascule en mode « petit » : `DS:99fc` passe à `tBMP` 3200 (568 images) et `REGS` 3200 / 3201, et les tables de bases cheveux, yeux, nez, pieds sont remplacées par celles du segment `14e0` ; `1168:5a13(1)` rétablit. Appelée par HOTEL (`10e8:0000`, `06f5`, `07ca`), TOWN (`1188:0128`, `0c1d`) et XFER (`11b0:00c4`, `1326`). Les `REGS` 102 / 103 ne changent pas dans ce mode.

**Tables de bases (sûr).** Ce ne sont pas des tables du `DS` `1530` : `1168:4dc9` les lit dans le segment de données initialisées `14c0` (870 octets, offsets `0306`…`035a`, six mots par table, mot 0 = 0), et la version « petit » dans `14e0` (offsets `0082`…`00a6`). L'ancien texte (`DS:032a` / `DS:035a` « à zéro dans le fichier, remplies à l'exécution ») venait d'une lecture dans le mauvais segment.

| Valeur | pieds `0306` | nez `0312` | yeux `031e` | cheveux `032a` |
|---|---|---|---|---|
| 1 | 191 | 171 | 91 | 11 |
| 2 | 246 | 175 | 107 | 27 |
| 3 | 335 | 179 | 123 | 43 |
| 4 | 360 | 183 | 139 | 59 |
| 5 | 411 | 187 | 155 | 75 |

Les variantes 1 à 11 (base 0) sont les corps. Mode petit (`14e0`) : pieds 131, 174, 227, 235, 278 ; nez 111, 115, 119, 123, 127 ; yeux 91, 95, 99, 103, 107 ; cheveux comme ci-dessus. Scripts de rejet (planche 3100, `0336`, `0342`, `034e`, `035a`) : pieds 288, 306, 324, 342, 360 ; nez 198, 216, 234, 252, 270 ; yeux 108, 126, 144, 162, 180 ; cheveux 18, 72, 36, 54, 90 ; corps = variantes 1 à 18.

**Pose et emplacements (sûr).** Le second mot de l'entête d'un `SCRS` est la **pose** (`piVar1[1]` de `1168:3f76`, argument de `1168:4dc9`). Elle ne choisit ni planche ni marche : elle décide **quelle famille occupe quel emplacement** d'une image, c'est-à-dire l'ordre de superposition. `4dc9` écrit `+0xc4…+0xcc` (cinq emplacements, de l'arrière vers l'avant) et la valeur de `+0xcc` (que l'ancien texte donnait pour un choix de planche) est simplement la base des cheveux :

| Pose | emplacement 1 (`+0xc4`) | 2 (`+0xc6`) | 3 (`+0xc8`) | 4 (`+0xca`) | 5 (`+0xcc`) |
|---|---|---|---|---|---|
| 0 | pieds | corps | nez | yeux | cheveux |
| 1 | pieds | nez | corps | yeux | cheveux |
| 2 | corps | yeux | nez | pieds | cheveux |

La pose 1 est celle des marches vers le haut de l'écran (secteurs 3 et 4 : le nez passe derrière le corps), la pose 2 celle des scripts de rejet. Les poses 3 (59 `SCRS`, tous dans `FLEENS.MHK`) et `0xffff` (2) ne modifient pas les bases (`4dc9` ne les traite pas) : **hypothèse**, les indices y sont bruts (bases à 0) ; les Fleens ne sont pas des Zoombinis.

**Composition d'une image (`1168:4741`, sûr).** Le tableau de bases est lu à partir de `+0xc4` (états 0 à 8) ; en état 9 (rejet), à partir de `+0xc4` si le premier mot de l'image est `< 0x13`, sinon de `+0xc2` (l'emplacement 0 est alors une partie brute, de base 0, par exemple une grosse forme de décor `w` jusqu'à 399). Pour la case de rang `k` (cases vides comprises, qui ne dessinent rien mais occupent leur emplacement) de numéro `w > 0` : `variante = bases[k] + w`, puis image de la planche `2 × variante − 1` si `+0xf2 == 0`, `2 × variante` sinon (les images vont par paires, droite puis gauche, de même taille et de miroir l'une de l'autre, vérifié à l'œil sur 3000) ; la position est `(x + origine_x − REGS_X[image], y + origine_y − REGS_Y[image])`. L'origine est la position du Zoombini `(+0xa6, +0xa8)` en états 0 à 7, et en états 8 et 9 `−(+0xaa, +0xac)`. Nombre de cases lues : 6 (états 0 à 8, dont le terminateur) ou 16 (état 9). La fonction renvoie aussi le numéro d'évènement et l'id de son du terminateur (§3.7). Rendu de contrôle des 5 Zoombinis (tête, cheveux, yeux, nez, pieds alignés dans les poses 0, 1 et 2, tournés à droite et à gauche, en mode petit) : confirme les tables et les ancres.

**Décalage des scripts d'écran (`1168:3f76`, sûr).** `3f76(octet, point, id_script, snoid)` retrouve l'indice du script par `1168:058f` (plages `DS:9a1c` / `DS:9a20` posées par `1168:03ef` = **REJECT**, première plage → état **9**, et `1168:04d0` = **NORMAL**, deuxième plage → état **8**), le charge au besoin (`11a8:2c8a`), recopie le nombre d'images (`+0x96`) et pose `+0xaa` / `+0xac` = « première partie de l'image de référence − point d'ancrage ». Sans point : référence = image 0, ancrage = la position courante (le script démarre là, ses images bougent ensuite par leurs propres décalages). Avec un point : référence = la **dernière** image dont la première case est une partie, ancrage = le point (le script se termine là). Puis `4dc9(pose)` et `4741` pour l'image 0.

**États `+0xf4` (`1168:4231` pour l'entrée, `1168:0ba8` à chaque tick ; tables dans le segment de code `1168`, `CS:461e` et `CS:1617`).** Sûr pour 0, 7, `0x70`, 8 et 9 ; probable pour les autres.

| État | Rôle | Script |
|---:|---|---|
| 0 | attente (`+0xf5 = 1`). Tous les `DS:235c` ticks, une chance sur dix de jouer une animation d'attente (`+0xf5 = rand(0, 7)`, état 6) | `100 + (+0xf1)` |
| 1, 2, 4 | variantes d'attente (**probable** ; 4 met `+0xf0 = 0`) | `100 + (+0xf1)` |
| 3 | **probable** : attributs du masque `+0xf5` (1 cheveux, 2 yeux, 4 nez, 8 pieds) remplacés par les images de « catalogue » (cheveux 426 à 430, yeux 431 à 435, pieds 436 à 440, nez 441 à 445) : le Zoombini en cours de construction du choix | aucun |
| 5 | animation propre aux pieds | `145 + pieds` (146 à 150) |
| 6 | animation d'attente avec sons : si les effets sont actifs, un cri de code de voix 4 ou 5 (une chance sur deux) ; tous les 32 appels, `1028:02cb('SND', id)` pour les ids 100 à 424 (**hypothèse** : libération du cache des sons de voix) | `130 + (+0xf5)` si `+0xf1` vaut 0 ou 1, `138 + (+0xf5)` s'il vaut 2 (130 à 145) |
| 7 | marche vers `(+0xe6, +0xe8)` : `1168:2f9f` puis `2b30`, puis état `0x70` | `100 + 5 × pieds + secteur` |
| `0x70` | marche en cours (§4.2) | idem |
| 8 | script NORMAL d'un écran (planche 3000 / 3200) | de l'écran |
| 9 | script REJECT d'un écran (planche 3100) | de l'écran |
| 10 | **probable** : attend son tour de départ (`1168:2982` échelonne `+0x24`), puis passe à 7 et incrémente `DS:9702` | |

Scripts communs `SCRS` 100 à 150 de `ZOOMBINI.MHK` (**sûr**) : 100 à 104 attente (une image de 5 parties) ; 105 à 129 marche, `105 + 5 × (pieds − 1) + secteur` ; 130 à 145 animations d'attente (cases en nombre variable, yeux jusqu'à la variante 16) ; 146 à 150 animation propre à chaque valeur de pieds. Les scripts de pieds (105 à 129, 146 à 150) ne composent en indices valides qu'avec leurs pieds. Les poses de la marche valent 0 pour les secteurs 0 à 2 et 1 pour les secteurs 3 et 4.

Les scripts d'épreuve suivent le même rangement : cinq scripts NORMAL (un par valeur de pieds : leur `w` maximal est 27, 45, 11, 27, 10 dans BRIDGE) puis des scripts REJECT à 9 ou 10 parties de pose 2.

#### Routines communes des épreuves (tâche H0, `1168`, `11a8`, `11a0`)

Relevé dans `decomp/*.c` et `disasm.txt`, complété par la lecture des octets du segment `1168` (`CS:1617`, `CS:461e`, `CS:1603` : tables d'états et handlers que Ghidra n'a pas désassemblés). **Sûr** sauf mention. Un objet de Zoombini est une feature `+0x00…` dont la partie snoid commence à `+0x30` : `+0x124` = état `+0xf4`, `+0x127` = `+0xf7` (**présent** de la fiche, qui sert de drapeau « sauvé » dans les épreuves), `+0xd6 / +0xd8` = position `(+0xa6, +0xa8)`, `+0x116 / +0x118` = destination `(+0xe6, +0xe8)` (abscisse en premier, comme la position), `+0x24` = échéance, `+0x28` = délai.

- **Ordre des arguments (piège de §0.2).** `1168:274e` est appelée `PUSH écart(long) ; PUSH départ(long)` dans le désassemblage, donc `274e(départ, écart)` en signature Ghidra : `10b0:0409` etc. poussent `0x2d` (45) puis `0x1e` (30) → premier départ 30 ticks après l'entrée, puis un toutes les 45. `1168:2982(écart, y, x)` en signature Ghidra, et dans le code le **premier mot poussé est l'abscisse** de la destination : `PUSH 0x2a8 (680) ; PUSH 0x13c (316) ; PUSH dword 0x2d` à `10b0:08a4` = destination **(680, 316)** (hors écran à droite), pas (316, 680) ; de même `1170:0719` : (800, 200) et `(1280, 240)` ; `1190:0cae` : (670, 30) ; `11b0:1143` : (670, 445). Les paramètres « 45, 0, 200, 800 » de `slides.md` §7 point 6 sont donc : écart 45 (le long « 0 » est sa moitié haute), `y = 200`, `x = 800` (et `y = 240`, `x = 1280`). Le premier départ a lieu tout de suite (`+0x24 = maintenant`), les autres `écart` ticks plus tard.
- **`1168:2505(dy)`** (arrivée) : remet `DS:9702 = DS:9704 = 0` ; `DS:9a26 = 1` (entrée à pied) si `S+0x20 == 0` (« plus d'action ») **et** `DS:970a == 0` (pas de reprise), sinon `970a = 0` et `9a26 = 0`. `n` = nombre d'objets visibles du groupe (`1168:02cc`). Pour chaque objet présent (`+0x127`), dans l'ordre de création : si `9a26 == 0` ou rang `< ⌊3n/4⌋` (`IMUL 3 ; IDIV 4`), il est **debout** et s'inscrit comme occupant de la première place libre de chaque liste (rectangle de prise de demi-côté `DS:9706` autour de ses pieds, `11d8:0000`) ; sinon il **entre à pied** : position `(−50, y de la place ⌊3n/4⌋ + k + dy)`, destination = place `⌊3n/4⌋ + k`, état 7, `DS:9702 += 1` (si la place existe dans la liste de `11a8:0ed9`). Le membre de rang `i` est créé sur la place d'attente `i` : `1168:0858` lit `1520:(i+1)×4+1000` par `1168:16cb`, et `11a8:0ed9(places, n)` a rempli `1520:03ec + 4k` (125 places au plus, propriétaires `1520:05e0 + 2k` remis à 0).
- **`1168:274e(départ, écart)`** : trie les objets par abscisse de destination (`1168:280c` : insertion croissante dans `DS:9714`, ex æquo : le dernier créé après), puis parcourt la liste de la **fin vers le début** : ceux qui sont en état 7 ou `0x70` et présents reçoivent `+0x24 = maintenant + départ`, `+ écart`… ; la place la plus à droite part donc la première. **`1168:2982`** fait pareil pour les présents en état 0 (immobiles) : destination posée, état 10 (« attend son tour »), `+0x24 = maintenant + k × écart`, `DS:9702 = DS:9704 = 0` avant. L'état 10 (`CS:12b9`) passe à 7 et fait `DS:9702 += 1` à l'échéance.
- **Compteurs** : à l'arrivée d'une marche (`CS:0cdd` → `4231(0, DS:9712)`, `DS:9712` = état de retour, 0 en pratique), `if (9702 > 0) { 9702 -= 1 ; 9704 += 1 }`, puis le marcheur s'inscrit comme occupant de la place dont le point est dans son carré de prise (si `DS:96fc ≠ 0`, 1 par défaut). `9702` = marcheurs en route, `9704` = arrivés. Les épreuves testent `9702 < 1` avant de laisser prendre un Zoombini (`10c0:0a99`) et `a406 ≠ 0 || 9702 == 0 || 9704 > 0` avant de quitter (`10c0:05e4`, `10b0:073d`).
- **Handlers de `1168:0ba8`** (table `CS:1617`, clés `0…10, 0x70`) : 0 → `CS:1131`, 1 et 2 → `CS:106b`, 3 → `CS:1236`, 4 → `CS:11b4`, 5 → `CS:105b`, 6 → `CS:1063`, 7 → `CS:0cdd`, 8 et 9 → `CS:122e`, 10 → `CS:12b9`, `0x70` → `CS:0d06`. La fin d'un script (table `CS:1603`, états 5, 7, 8, 9, `0x70`) recharge l'image 1 ; tout autre état (0, 4, 6…) qui arrive au bout rappelle `4231(0, 0)` : retour à l'état 0.
  - **État 0 (attente)** : `+0xf8 = 0` si l'état était 1 ou 2 ; sinon, à chaque échéance : si `DS:235c ≠ 0` (valeur initiale **`0x40`**) et qu'aucune boîte n'est ouverte (`DS:a2da == 0`), `if (+0xf8++ > DS:235c) { +0xf8 = 0 ; if (DS:239a == 0 [toujours 0] && 10a8:04e8(100, 0) < 10) { +0xf5 = 10a8:04e8(7, 0) ; 4231(0, 6) } }`. `+0xf8` est tiré à la création entre 0 et 64 (`1168:0858`). L'attente de **60 ou 120** de `DS:908a` ne vient pas d'ici : `DS:908a` est la copie globale de « moins d'action » (`10d0:0960` la met dans `S+0x20`, `1148` la remet à 0 au démarrage) et ne sert qu'aux **périodes propres** à chaque épreuve (`10c0:00ba` : `70c2 = 120` ou `60`, `10e0:00c3`, `1188:003e`, `1190:00b9`).
  - **État 6** (`4231`, `CS:4424`) : script `130 + (+0xf5)` si `+0xf1` vaut 0 ou 1, `138 + (+0xf5)` si 2, `+0xf1` forcé à 1 sinon ; si `DS:235c ≠ 0` et `DS:a43a` (voix et effets) : `10a8:04e8(100, 1) ≤ 50` → code de voix **4**, sinon **5**, joué par `11a0:0ee7(0, 1168:575b(code))` ; tous les 32 appels, `1028:02cb('SND', id)` pour les ids 100 à 424 (cache). Il joue une fois et revient à l'état 0.
  - **État 4 (« posé »)** : à chaque échéance, si la position n'est pas la destination `+0xe6` : `+0xf1 = 1`, `+0xf2 = 0` (tourné à droite) et la position **devient** la destination d'un coup ; sinon délai remis à 6, `+0xf8 = 0` et `4231(0, DS:9712)` (état 0, donc attente en variante 1).
  - **État 5 (transport)** : joue `145 + pieds` en boucle (`CS:105b` ne fait que redessiner).
- **Glisser-déposer `1168:1742(rappel, rect, souris, objet)`** (Ghidra) puis `1168:58c7` à chaque tour. Boucle **bloquante** de l'original (un `while (58c7())`), portée en machine à états. Prise : `DS:235c` mis à 0 (pas d'attente animée pendant le transport) et restauré à la fin ; l'objet passe en id `0xfffd` (devant tout, `11a8:1356`), délai 3, état 5 (sauf `DS:96fa`), son propriétaire est retiré des deux listes de places (`1520:2f0 + 2k` pour les cibles de dépôt de `1520:0000` et `1520:5e0 + 2k` pour les places d'attente de `1520:03ea`). Chaque tour : position `= souris − (souris − pieds à la prise)` bornée au rectangle (`DS:6092` par défaut), `+0xf2 = 1` si la souris va à gauche, 0 à droite ; la **cible libre** `1520:0xfc + 4k` (un **point** `(x, y)`, pas un rectangle : `11d8:0000(point, rect)` teste l'appartenance) dans le carré de demi-côté `DS:9706` autour des pieds est mise en surbrillance (`DS:9708 ≠ 0`). Fin : la cible prise reçoit l'objet (`1520:2f0 + 2k = id`, `DS:99d8` = rang, `DS:99da` = id ; la valeur renvoyée est le rang + 1 de la cible **quittée**), sinon `1168:1e27` : seulement s'il y a une carte de terrain (`DS:3fd8`, ni les épreuves ni la ville, `[8552] == 6`) et que la case vaut 1, l'objet reste là ; sinon `+0xe6 = position à la prise` (retour). Puis état 4 (voir ci-dessus). **La décision** (accepter, ou renvoyer le Zoombini sur sa place d'attente) est prise **après** le retour par le code de l'épreuve, qui lit `DS:99d8 / 99da`.
  - `1168:58c7` (**sûr** pour la structure, **probable** pour le nom des options) : au premier appel `DS:9b3e = bouton gauche enfoncé`, `DS:9b40 = [a43c]` (**souris aimantée** : transport « collé ») et le curseur système est masqué (`11e8:77bc`) si `[a43d]` (**curseur masqué**). Par appel suivant : mode non collé → fin dès que le bouton est relâché, sauf si `[a43e]` (**auto-aimantation**) est vrai et que le temps depuis `DS:3d06` est inférieur à `[a438]` (`S+0x02`, 0 pour une partie neuve donc jamais) : le transport devient alors collé ; mode collé → `DS:9b3e` retombe à 0 au premier relâchement, puis le prochain appui (bouton, ou événement `WM_LBUTTONDOWN` / `RBUTTONDOWN` / `MBUTTONDOWN` / touche en attente, `1148:073c`) termine. `DS:96f4 = 1` (posé par une épreuve) et `DS:96fe` (transport au clavier) terminent ou remplacent la lecture du bouton. À la fin le curseur est rendu (`11e8:8d20`).
  - `DS:9706` (demi-côté de prise, `1168:0034` = 15 au départ) est réglé par l'épreuve : 55 (`10c0:0041`, gorges), 100 (`10e0:006e`, nizibooms), 60 (`1128:0007`, choix), 25 (`1130:0337`, pizza), +10 (`10e8:1784`, hôtel).
- **Enregistrement `11a0:141e`** : appelée avant chaque écriture de la partie (pas une fonction du corpus). Elle commence par `1168:36e1(1, 1)` (relocation lue : cette forme **range les objets dans le tampon de groupe sans scorer l'épreuve**, tous présents), puis selon `[8552]` : écrans 3, 4, 5 → copie du groupe (`S−0x56D2`, `0x266` octets) dans la réserve de groupe (`S−0x5E04`, `S−0x5B9E`, `S−0x5938`), vide le groupe, écrit (`10d0:06ad`) puis efface le drapeau de la réserve ; écrans 1, 6 → vide le groupe, écrit ; écrans 2, 7 à 18 → écrit, puis groupe vidé (`1168:0858` l'a déjà vidé en créant les objets) ; écrans 0, 19 à 22 → `[87e4] = 0` et groupe vidé, sans écriture. Dans une épreuve, une partie enregistrée contient donc **tout le groupe, perdus rendus** (`present = 1` pour tous : `uVar3 = 1` quand `param_1 ≠ 0`), et `1160:0521` reprend à l'épreuve si ce groupe n'est pas vide (`DS:970a`).
- **Aide vocale `11a0:155e`** : `if (DS:a2c4 ≠ 0) { if (DS:a402 == DS:a2c4) { 1028:0c0a('SND', a402) ; a402 = 0 } else 11a0:0ee7(0, a2c4) }` : rejoue la voix d'introduction, ou la coupe si elle joue encore. Appelée par les handlers de touche des épreuves `10c0:0d20`, `10e0:0def`, `10f8:41be`, `1118:2989` pour le code **`0x16f`**. Le code d'une touche vient de `WM_KEYDOWN` (`1148:0ea4` : `wParam + 0xff` puis `1148:0566` ajoute `0x800` si Maj et `0x400` si Ctrl) ; `WM_CHAR` donne le caractère tel quel (Maj+Tab : `0x809`). `0x16f − 0xff = 0x70` = `VK_F1` : la touche d'aide est **F1** (**sûr**). Seules quatre épreuves appellent `11a0:155e` directement (gorges, nizibooms, étang, véhibules) ; aux gorges (`10c0:0d20`) la touche n'est prise que si `DS:7058 ≠ 0` (épreuve active) et `DS:9702 ≤ 0` (plus personne en marche) ; les autres ne la filtrent pas. Les autres épreuves qui ont une voix d'introduction (`DS:a2c4`, grottes…) la gèrent peut-être par un autre chemin (non relevé).
- **Musiques** (appels `11a0:0ee7(0, id)` avec `id ≥ 30000`, balayage des constantes `0x7530…0x7556` dans tout le code) : hôtel `0x7544 + [74c8]` (`10e8:0b72`, relancée à `10e8:0de7`), tanière du sphinx `0x7549 + niveau` si `[7106] < 4` (`10c8:091b`), piège de cristal `0x754e + niveau` (`1158:0a5f`), gouffre des véhibules `0x7553 + niveau` (`1118:1173`), avec `niveau` = `1168:515d()`. Les écrans 19 et 20 (`1110:2342`, `1110:310c`) et le choix (`1128:03d4`, 30001) en lancent d'autres. Les huit autres épreuves (gorges, grottes, pizza, bac, têtards, monte-pierre, nizibooms, muraille) **n'ont aucun `tMID`** à l'entrée. Les 18 `tMID` de `MIDIMPC.MHK` : 30000, 30001, 30020–30023, 30025–30028, 30030–30033, 30035–30038 ; 30028 n'est lancée par aucune épreuve relevée (**probable** : caves.md lit `[7106] < 4` comme « niveaux 0 à 2 »).
- **Voix de réussite / de regret** : aucune fonction commune. Chaque épreuve tire `10a8:04e8(20063, 20055)` (réussite : `10c8:1574`, `10c8:1644`, `10f8:3e84`, `1118:18e8`, `1130:15bb`, `1150:2fdb`, `1158:0ff9`) ou `10a8:04e8(20048, 20045)` (regret : `10f8:7934`, `1120:0717`, `1130:15d0`) sous une condition qui lui est propre.

### 3.7 Sons dans les scripts

- Terminateur à `w < -0x100` : le mot suivant est un **id de son** (`\0SND` de l'archive de l'écran ou de `ZOOMBINI.MHK`, §6). `11a8:32b2` (préchargement, via `11a8:3533`) parcourt un script entier pour collecter ses ids (max `param_2` sons).
- Dans les `SCRS`, un terminateur d'octet bas `0xc9`…`0xda` désigne un son **dépendant du Zoombini**. Il est déclenché **à l'exécution** par le tick du snoid (`1168:0ba8`, `1168:14d2`…`1595`, **sûr**) : `1168:4741` rend le numéro d'évènement, le tick lui retranche 1, et pour `0xc8…0xd9` il traduit par une table de 18 entrées en code de voix `8, 6, 7, 10, 2, 12, 1, 9, 0, 4, 5, 3, 11, 13, 14, 15, 16, 17` (`script.ts`, `SNOID_VOICE_CODES` ; le préchargeur `11a8:32b2` a la même table), puis `1168:575b(code, snoid)` donne l'id de `\0SND` et `11a0:0ee7(0, id)` le joue. Les autres évènements `0xc8…0xef` (octet bas `0xdb…0xf0`) sont avalés (le code vaut 0), ceux d'octet bas supérieur à `0xf0` (`0xf2`…`0xfc`) et inférieur à `0xc9` partent au rappel `+0x10` de la feature.
- Id d'un code (`1168:575b`, **sûr**) : base de `0` à `15` = `100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 475, 450, 425` ; plus un décalage selon le **type de voix = valeur des cheveux** (`+0xbc`, types 1 à 5 : `0`, `5`, `0x14`, `0x0f`, `0x0a`) ; plus la **variante = valeur du nez** (`+0xbe`) moins 1 (0 à 4). Le code `16` tire un id dans `1800…1814` (`10a8:04e8(1814, 1800)`) et le code `17` donne `99`, tous deux sans décalage. Ces ids sont dans la plage `99…499` de `ZOOMBINI.MHK` (sons des Zoombinis). `snoidVoiceId` / `snoidVoiceIdForEvent` (`zoombini.ts`) les calculent. Fréquences dans les 719 `SCRS` : octets bas `0xc9` à `0xda` en 38, 9, 3, 2, 3, 6, 12, 0, 2, 0, 0, 50, 10, 72, 13, 5, 5, 7 images (le `0xdb` en a une).

## 4. `NODE`, `PATH`, `REGS`, `CURS`

### 4.1 `NODE`

**Sûr** (code `1168:2b30`, `1168:319b`, données de 9 archives). Chargée par `1168:2a5c(id)` (`11a8:2c8a`, mots échangés) dans `DS:2388`.

```
u16 n                    nombre de points de passage (n ≥ 1)
n × ( u16 x, u16 y )     coordonnées en pixels (écran 640 × 480)
```

Exemple `BASECAMP.MHK` NODE 1000 (34 octets) : `n = 8`, points `(11, 325) (69, 355) (439, 342) (508, 344) (616, 310) (634, 422) (250, 350) (370, 345)`. Présente dans `BASECAMP`, `BCTWO`, `CAVES`, `HOTEL`, `LILLY`, `PICKER`, `PIZZA`, `SLIDES`, `TUNNELS` (id 1000 toujours) ; **inutilisée** dans `HOTEL` et `LILLY` (leurs écrans n'appellent pas `1168:2a5c`).

### 4.2 `PATH`

**Sûr** (`1168:2b30` lit `PATH + 2 + chemin × 0x18 + indice`). Chargée par `1168:2a5c` dans `DS:2384` (seul le premier mot est échangé ; le reste est lu **octet par octet**).

```
u16 n                    nombre de chemins
n × 24 octets            chemin : suite d'indices de nœuds (octets, 1-based dans NODE), terminée par 0 ;
                         la partie après le 0 est du bourrage à 0
```

Exemples : `BASECAMP` PATH 1000 (122 octets = 2 + 5 × 24) : `[1,2] [1,2,7] [1,2,7,8] [3,4,5] …` ; `PICKER` : `[1..6]`, `[1,2,3,4,7]`… `TUNNELS` : 2 chemins. Un chemin décrit le **parcours que suit un Zoombini** sur la carte d'un écran. `1168:319b` est l'outil de visualisation du mode de débogage.

**Marche d'un Zoombini (sûr ; `src/games/zoombinis/data/zoombini.ts`, tâche G1).** Champs du snoid : §3.6. La marche se fait en **segments rectilignes** entre des points de passage ; la vitesse est celle de la feature, soit un pas toutes les **6 ticks de 17 ms** (≈ 102 ms ; `1168:09f7` pose le délai 6, `1168:0ba8` le rétablit à l'arrivée).

1. **Départ** (état 7 de `1168:0ba8`, pose du script `100 + 5 × pieds` par `1168:4231`). `1168:2f9f(destination, snoid)` choisit le chemin (non listée par Ghidra : lue dans les octets, `1168:2f9f`…`3198`). Sans `NODE` / `PATH` chargés (`DS:2384` ou `DS:2388` nuls) ou si `DS:970c ≠ 0` : la cible est la destination (`+0xaa = +0xe6`). Sinon : (a) le **nœud le plus proche de la destination** (distance au carré ≤ 999 999, ex æquo : le dernier) ; (b) pour chaque chemin qui le contient, à la première position `SI` où il apparaît, le **nœud du chemin le plus proche de la position courante** (rang `k`), en gardant le meilleur de tous les chemins : `+0xea = k + 1`, `+0xeb = numéro du chemin`, `+0xf0 = +1`, mais `−1` si `SI ≠ 0` et `SI ≤ k` (si le nœud de la destination est en tête du chemin le sens reste +1 : défaut du code, reproduit). Puis `1168:2b30` une première fois.
2. **Point de passage** (`1168:2b30`, première moitié). Rang négatif : la destination. Sinon l'octet du chemin au rang `+0xea` (1-based dans `NODE`, 0 = fin), puis `+0xea += +0xf0`. 0 : la destination. Sinon le nœud, **sauf** si la destination est plus proche (≤, distances au carré) de la position courante que le nœud, auquel cas la cible est la destination. La cible va en `+0xaa`, `+0xac`.
3. **Secteur et pas** (`1168:2b30`, seconde moitié). `dx = cible.x − x`, `dy = y − cible.y` (positif vers le haut). Pente `p = (dy × 1024) / |dx|` (division tronquée vers 0, **résultat gardé sur 16 bits** : une pente de plus de 32 767 déborde et change de secteur ; `dx = 0` : `±0x582` selon le signe de `dy`). Secteur `+0xf5` : `p < −0x580` → 0 (descend à pic) ; `< −0x14b` → 1 (descend en diagonale) ; `< 0x14c` → 2 (presque à plat) ; `< 0x581` → 3 (monte en diagonale) ; sinon 4 (monte à pic). Ce sont 1024 × tan 54° et 1024 × tan 18°, pas de distinction droite / gauche (le sens vient de `dx`). Pas de base `(a, c)` du secteur : `(5, −15)`, `(13, −10)`, `(16, 8)`, `(13, 10)`, `(5, 15)`. Si `|a| < |c|` (secteurs 0 et 4) : `+0xee = c`, `n = |dy| / |c|` et `+0xec = dx / n` (`dx` si `n = 0` ; `±1` si le quotient est nul et `dx ≠ 0`). Sinon : `+0xec = a`, `n = |dx| / |a|` et `+0xee = dy / n` (`dy` si `n = 0` ; `±1` si nul et `dy ≠ 0`). Les deux axes arrivent donc ensemble ; seules les valeurs absolues de `+0xec`, `+0xee` servent. **Si le secteur change**, le script de marche devient `100 + 5 × pieds + secteur` (`+0x92`, `+0x98 = 0`, `+0x9a = 2`) et `4dc9(pose du script)` est rappelé : **sûr** (le secteur de départ est 0 car `4231` met `+0xf5 = 0` hors état 0, et charge déjà le script 0).
4. **Un tick** (état `0x70`). `dx`, `dy` comme ci-dessus. Sur la cible (`dx = dy = 0`) : `1168:2b30` donne le point suivant ; s'il est confondu avec la position, c'est l'**arrivée** (retour à l'attente par `4231(0, DS:9712)`), sinon ce tick-là n'avance pas (le premier pas du nouveau trajet est au tick suivant). Sinon : si `dx ≠ 0`, `x += signe(dx) × min(|dx|, |+0xec|)` et `+0xf2 = 1` si `dx < 0`, 0 sinon (`dx = 0` ne change pas l'orientation) ; si `dy ≠ 0`, `y −= signe(dy) × min(|dy|, |+0xee|)`. À l'état 7, le premier pas a lieu dans le tick même du départ.
5. **Vitesses** (pixels par pas puis par seconde, dans le secteur) : 0 : 15 px (≈ 147) ; 1 : 13 (≈ 127) ; 2 : 16 (≈ 157) ; 3 : 13 (≈ 127) ; 4 : 15 (≈ 147), en comptant 102 ms par pas.

Fonctions de `zoombini.ts` : `walkSector`, `walkLeg`, `walkStep`, `planPath`, `nextWaypoint`, `startWalk`, `tickWalk`, `snoidWalkScriptId`.

### 4.3 `REGS`

**Sûr** pour les deux emplois principaux (vérifié par les tailles). Tableau de **mots 16 bits big-endian**, échangés par `1168:01f4`, sans structure imposée par le moteur : la **signification est propre à l'appelant**.

1. **Points d'ancrage** d'un groupe de formes (§3.4) : `REGS id` = X, `REGS id + 1` = Y, un mot par image de la planche `tBMP id`, mot 0 = 0 (taille = `(n + 1) × 2` octets) ; les valeurs sont **signées** (`0xfffe` = -2). Exemples : `BASECAMP` 9000 / 9001 (10 octets : 4 images), `PICKER` 1000 / 1001 / 1200 / 1201, `ZOOMBINI` 100 / 101 / 102 / 103, 3200 / 3201, `LILLY` 10000–10002 (292 mots), `SMOKE` 10000–10002, `MAZE2` 17000–17002 et 18000–18002, `NET` 7000 / 7001, `TOWN` 2000 / 2001 et 6000 / 6001, `FLEENS` 4000 / 4001, `CAVES` 200–202 (3 jeux de 20 valeurs).
2. **Tables de données d'épreuve** : `LILLY` 15000–15002 (`10f8:692f`), `MAZE2` 16000–16002 (points d'impact), 16499, 16500, 16501, 16600–16609 (niveaux, `1118:11b8`), `FLEENS` 5000 / 5001 (liste `u16 n` puis `n` paires `(x, y)` : trois puis dix-sept points), `NET` 9000 / 9001 (tableaux de 0). Le détail appartient aux études d'épreuve (`puzzles/*.md`).

Chargeurs : `1168:01f4` (générique, `DS:a41c` / `a420` pour le groupe global), `10c8:1afe` (Caves), `10f8:692f` (Lilly), `1118:11b8` (Maze2).

### 4.4 `CURS`

**Sûr** pour la structure (`11e8:851e`). 5 ressources (ids 1 à 5) dans `ZOOMBINI.MHK`, de 68 octets chacune :

```
0x00  16 × u16 big-endian   plan « image » : 1 = pixel noir (16 lignes de 16 pixels, bit 15 = pixel de gauche)
0x20  16 × u16 big-endian   plan « masque » : 1 = pixel opaque
0x40  u16                   point chaud, première valeur
0x42  u16                   point chaud, seconde valeur
```

`11e8:851e(ptr)` construit un curseur Windows 32 × 32 (`CreateCursor`) : XOR = `~image & masque`, AND = `~masque` (donc noir quand image = 1 et masque = 1, blanc quand image = 0 et masque = 1, transparent quand masque = 0). Les points chauds valent `(8, 6)` pour `CURS` 1 et `(0, 0)` pour 2 à 5. L'ordre `(x, y)` n'est pas confirmé (le code lit `+0x42` avant `+0x40` : **hypothèse** `x = +0x40`, `y = +0x42`). `11e8:851e(0..3)` charge des curseurs système (`IDC_ARROW` `0x7f00`, `0x7f03`, `0x7f01`, `0x7f02`). `CURS` 1 est une forme de main, 2 à 5 des visages (rendu du masque, **probable**).

## 5. `tBMP`, `SHPL`, palette, transitions

### 5.1 Chargement et dispatch

- `11b8:0497(nom, id, &poignée)` (« Terrain », fonds, formes isolées, sûr) : tente le tag `tBMP` (`0x74424d50`), sinon `SHAP` (`0x53484150`) ; verrouille puis **décompresse en place** par `11e8:9eee`. Aucune archive du jeu n'a de `SHAP` : le repli est du code hérité de Mathémagique.
- `11a8:2ae6(&poignée, id)` (planches multi-images, sûr) : charge `tBMP id`, **échange le premier mot** (nombre d'images `n`) et les **`n` mots doubles suivants** (la table de décalages, §5.2), mais **ne décompresse pas** : chaque sous-image est décodée au moment de la lecture ou de l'écriture.
- `11e8:9eee` (décompresseur d'une image isolée, **probable** pour le dispatch) : lit les quatre mots d'en-tête ; si `(drapeaux & 0xf00) == 0x100` → décompression LZ intégrée (la même que `SHAP`) ; si `(drapeaux & 0xf00) == 0xf00` → décompresseur **externe** recherché dans la liste `DS:b0c4` (clé de config `Graphics.Decompressors`, comparaison de 8 octets) ; dispatch par la table de 5 entrées `11e8:a58f` = `0x100`, `0x200`, `0x400`, `0x800`, `0x1000` (handlers `11e8:9f8b`, `9f92`, `9f99`, `9fa0`, `9fa7`). **Dans les données, seuls les drapeaux `0x002`, `0x012`, `0x102`, `0x112` existent** (LZ éventuel + RLE éventuel + 8 bits) : ce sont les seuls cas à implémenter.

### 5.2 Variantes de `tBMP`

**Sûr** : vérifié sur les 174 `tBMP` : 110 planches et 64 images isolées, 10 068 images décodées sans erreur (`test/zoombinis/data.test.ts`). Un premier comptage (8 711) oubliait les 27 planches compressées en LZ (drapeaux `0x0102`).

En-tête commun, big-endian :

```
u16 largeur   u16 hauteur   u16 pas (octets par ligne du bitmap décompressé)   u16 drapeaux
```

Drapeaux (valeurs présentes dans les données) :

| Valeur | Sens | Ressources |
|---|---|---:|
| `0x0002` | 8 bits par pixel, non compressé, **ou planche multi-images** (§ ci-dessous) | 98 (15 images brutes + 83 planches) |
| `0x0012` | 8 bits, **RLE par lignes** | 30 |
| `0x0102` | 8 bits, **LZ** puis lignes brutes, **ou planche compressée** (27 planches, voir `formats.md`) | 42 |
| `0x0112` | 8 bits, **LZ** puis RLE | 4 |

**Image isolée** (variantes 1 à 4), mêmes algorithmes que `SHAP` ([../mathemagique/shap.md](../mathemagique/shap.md), `src/data/mohawk/shap.ts`) :

- brute (`0x0002`, 15 cas : `BCTWO` 9000…9015…) : `pas × hauteur` octets à partir de l'octet 8 ; taille de ressource = `8 + pas × hauteur` ;
- RLE (`0x0012`) : à partir de l'octet 8, pour chaque ligne un `u16` (nombre d'octets de la ligne), puis des codes : bit 7 = répétition (un octet de valeur suit), sinon copie ; longueur = `(code & 0x7f) + 1` ; les lignes sont ensuite à `largeur` pixels (le pas ne sert pas) ;
- LZ (`0x0100` posé) : octets 8 à 17 : `u32` taille décompressée, `u32` taille compressée, `u16` taille d'anneau (**toujours `0x0400`**) ; données LZSS à partir de l'octet 18 (anneau de 1 024 octets initialisé à 0, position d'écriture `0x3be`, drapeaux lus du bit de poids faible, 1 = littéral, sinon 2 octets `hi lo` : décalage = `((hi << 8) | lo) & 0x3ff`, longueur = `(hi >> 2) + 3`). Le résultat est ensuite lu comme une image brute (`0x0102`) ou RLE (`0x0112`).

**Planche multi-images** (`0x0002`, 83 ressources, jusqu'à 890 images, **toutes** vérifiées : `tBMP` des groupes de formes de §3.3) :

```
0x00  u16 n                 nombre d'images
0x02  u16 hauteur           valeur sans usage  (≈ (taille - 8) / pas, ±1)
0x04  u16 pas               = (n + 3) & ~3
0x06  u16 drapeaux = 0x0002
0x08  n × u32 big-endian    décalages absolus (depuis le début de la ressource) des sous-images ; décalage[0] = 8 + 4 n
…     sous-images
```

- L'en-tête reproduit celui d'une image brute (`largeur = n`) parce que la planche a été fabriquée comme un faux bitmap : seuls `n` et la table comptent. `11a8:2ae6` n'échange que `n` et la table ; `n` est le mot à l'offset 0, l'entrée `i` (1-based) est le mot double à `4 + 4 i`.
- **Chaque sous-image** est un en-tête de 8 octets `(largeur, hauteur, pas, drapeaux)` suivi de ses pixels : **`0x0012`** (6 558 sous-images : RLE par lignes, comme ci-dessus) ou **`0x0002`** (2 153 : brute, `pas × hauteur` octets). Aucune sous-image n'est en LZ. Les décalages sont **alignés sur 4 octets** : il reste 2 à 5 octets de bourrage après une sous-image RLE (0 après une brute, dont la taille est déjà un multiple de 4 pour `pas` multiple de 4).
- **Distinguer** une planche d'une image brute de même drapeau : l'appelant le sait (`11a8:2ae6` ou `11b8:0497`). En lecture seule, la planche est reconnaissable par `largeur == n`, `pas == (n + 3) & ~3`, `décalage[0] == 8 + 4 n`, décalages croissants et dernier décalage `< taille` ; **les 83 planches satisfont ce test, les 15 images brutes le refusent** (6 cas ambigus par la seule taille, résolus par le test ci-dessus).
- Usage : `SCRB`/`SCRS` référencent la sous-image `w` (1-based) d'une planche ; les largeur / hauteur lus dans l'en-tête de la sous-image donnent le rectangle (§3.4).

Dessin : **l'indice de couleur 0 est transparent** pour les sprites (rendu vérifié), les fonds (640 × 480 en `0x0012` ou `0x0112`) sont opaques. Les modes de dessin des primitives `11e8:*` (écrêtage, miroir, etc.) n'ont pas été étudiés.

### 5.3 `SHPL`, `tPAL`, `SNDL`, `tCNT`

- `11b8:0b5b` charge d'abord un tag **`tCNT`** (`0x74434e54`), sinon `SHPL` (`0x5348504c`) ; `11b8:0d20` charge `tPAL` (`0x7450414c`) ; `11b8:0dd3` charge `SNDL` : **aucune archive ne contient `tCNT`, `tPAL` ni `SNDL`** (code hérité).
- **`SHPL`** : identique à Mathémagique ([../mathemagique/engine.md](../mathemagique/engine.md) §3.8) : `u16 id` (= id de la ressource), `u16 nombre de formes` (1 sauf `BASECAMP`…, valeurs 1, 6, 16), `u16 premier index de palette`, `u16 nombre d'entrées`, puis `nombre × 4` octets `(R, G, B, drapeau)` ; taille exacte `8 + 4 × nombre` (41 `SHPL`). Plages vues : `(premier, nombre)` = `(10, 217…237)` pour les fonds (couleurs 10 à ~246), `(46, 197…200)`, `(1, 254)`, `(255, 1)` (index 255, blanc : 11 fois), `(10, 79)`. Le 4e octet vaut 1 (6 075 fois : entrée « réservée » pour l'animation de palette) ou 0 (13 fois).
- **Éclaircissement (sûr, code `1148:0a5a`)** : appliqué à chaque composante non nulle, `c ← c + 31 − ⌊c / 8⌋` (255 reste 255) ; `11b8:0c84` copie `nombre × 4` octets à `DS:60ce + 4 × premier` puis appelle `1148:0a5a`. **Identique à Mathémagique** (`src/games/mathemagique/data/palette.ts`, `brighten`). Rendu de `BASECAMP` 1000 vérifié avec cette formule : couleurs correctes (sans elle, trop sombres).
- Le système crée une palette logique de 256 entrées (`GDI::CREATEPALETTE`, `11e8:661f`, `11e8:6b95`) ; les entrées 10 à 245 sont animables (`ANIMATEPALETTE`, `SETPALETTEENTRIES` dans `11e8:7d44`, `11e8:4a08`, `11e8:0dc1`). `1058:048a(236, 10)` sauvegarde la palette de l'écran (copie `DS:60ce` → `DS:64ce`) pour les fondus (`1058:03e5`, `11e8:88a8`). Les **fondus de palette** n'ont pas été étudiés en détail.

### 5.4 Transitions d'écran

Voir §2.4 : la « transition » est un **écran à part** (`XFER`, écran 2), pas un effet graphique (volet, fondu). Elle anime sur la carte le trajet entre deux écrans (`SCRB` 1100…6108, `SCRS` 5199…6204, décors 640 × 480 et planches). `Ctrl+T` (`DS:854e`) la désactive ; l'écran suivant est alors chargé directement. Des effets de balayage de palette éventuels pendant le changement de fond ne sont pas identifiés.

## 6. Sons et musique

### 6.1 Ressources

- **`\0SND`** : 1 333 ressources dans 15 archives, **toutes** de type `WAVE` (conteneur `MHWK`, taille, `WAVE`, blocs `Data` et parfois `Cue#` : 22 avec repères), PCM non signé 8 bits mono **11 025 Hz**, 0 ou `0xffff` (boucle) répétitions (22 bouclés). Format identique à Mathémagique (`src/data/mohawk/wave.ts`). Aucun `\0SND` de type `MIDI`.
- **`tWAV`** (20 fonctions : `10a0:*` et `1028:*`) et **`WAVE`** (tag `0x57415645`) : tags acceptés par le gestionnaire (`1028:04ea`) mais absents des archives. Le tag `\0SND` est la seule source de sons numériques.
- **`tMID`** : 18 `MIDI` dans `MIDIMPC.MHK` (ids `30000`, `30001`, `30020`…`30023`, `30025`…`30028`, `30030`…`30033`, `30035`…`30038`), format `MHWK` + `MIDI` + `MThd` + `Prg#` + `MTrk` (ressource complétée), identique à `src/data/mohawk/midi.ts`. Les ids de musique sont ≥ 30 000. `1068:0020…01c6` (18 petits enveloppes d'appel de `1028:0265` / `1028:02cb` avec le tag `tMID`) et `10a0:0020…0241` (idem avec `tWAV`) sont des enveloppes de chargement / libération par tag ; elles ne contiennent aucun id en constante.
- **`SYSX`** (`MIDIMAP.DAT`, 2 ressources identiques d'ids 1 et `0xffff`, 192 octets) : **64 messages MIDI courts de 3 octets** envoyés à la réinitialisation du périphérique : pour chacun des 16 canaux `n` : `Bn 79 00` (reset all controllers), `Bn 07 7f` (volume 127), `Bn 0b 5a` (expression 90), `Bn 0a 40` (pan centre). Clés de configuration `XSYSMidiMap`, `fEnableHardReset` (`1530:4310`, `431c`).

### 6.2 Ids de sons et files de lecture

**Sûr** (`11a0:0ee7`, `11a8:2d3f`, `11a8:317c`) :

- `11a0:0ee7(?, id)` met un id dans une **file de 32 places** : file « effets / voix » (`DS:a648`, gardée par le drapeau `DS:a43a`, ids < 30 000) ou file « musique » (`DS:a6ca`, drapeau `DS:a43b`, ids ≥ 30 000 ; l'id 0 rappelle la dernière musique `DS:3ea6`). File pleine : message `Que overflow id: ` en mode de débogage.
- Les ids `< 30000` sont des `\0SND` (l'archive courante, ou `ZOOMBINI.MHK`) et les ids `≥ 30000` des `tMID` de `MIDIMPC.MHK` ; **plages par archive** : `ZOOMBINI.MHK` : `99…499` (voix des Zoombinis), `900…944`, `996…999`, `20000…20104` (voix / dialogues) ; les archives d'écran : `1000…15000` (`PIZZA` jusqu'à 15006 : 156 sons).
- `11a8:2d3f` (appelé à chaque `11a8:04b9`) traite la file : pour chaque place, id `< 1000` ou `≥ 30000` → archive commune `ZOOMBINI.MHK` / `MIDIMPC.MHK` (via `11b8:0011`), `1000…19999` → archive de l'écran, `≥ 20000` → son « s-sound » (mode `+0x42 = 1`, démarré par `1028:0b04`, **probable** : son en flux), sinon son normal `1028:0a12`. `11a8:317c` choisit parmi les places la plus prioritaire (voir ci-dessous).
- **Un seul canal numérique** (**sûr**) : `1028:0a12(canal −1, …)` prend le canal par `1028:0b3d` parmi `[DS:0296 + 2 × type]` canaux, puis coupe ce qui y joue (`1028:0c0a`) avant de lancer le son. `DS:0296` (type des `\0SND`) et `DS:0298` valent **1** dans le segment de données de l'exécutable et ne sont jamais écrits : un son qui démarre coupe le précédent. Un `\0SND` répété `0xffff` (22 sons : pas et roulettes des gorges 2000 / 2003, des grottes 8500 / 8503, ambiances des camps, du cristal…) joue donc jusqu'au son suivant ou jusqu'à `1028:0e53` (Exit de chaque écran) : les scripts de marche le relancent toutes les deux images, et la voix du Zoombini à l'arrivée le coupe.
- **Priorités** (**sûr**, `11a8:317c`, seulement pour la file des effets : `11a8:086b` passe 1, la musique 0) : à chaque tick, parmi les places occupées (le son qui joue encore y reste jusqu'à sa fin, `1028:0d9e`) un seul id est gardé : celui de plus haute priorité, le plus récent à égalité (`local_a <= local_8`) ; les autres places sont vidées, donc les ids perdus. Priorité (`11a8:30e7`) : `0x20 − i` pour la première plage `i` de la table `DS:ac00` (32 plages `[ac02]` min, `[ac42]` max, `[ac82]` drapeau) qui contient l'id, 0 sinon ; le drapeau 1 fait lire le son en « s-sound » (`+0x42 = 1`). La table est remplie par `11a8:313a(min, max, drapeau)` : `11a8:0000` (démarrage) et `11a8:021c` (Exit commun) la remettent à [996…997, 0] ; l'Enter de chaque écran ajoute ses plages (la ville `1188:0142` et le bac `10d8:00a2` la vident d'abord) : liste complète dans `SCREEN_SOUND_PRIORITIES` (`src/games/zoombinis/engine/sound.ts`). Les voix (20000…29999) passent presque partout juste après 996…997 ; un son hors plage (les pas) vaut 0 et cède à tout.
- **`DS:a402`** : `11a8:2d3f` rend l'id du dernier son démarré dans le tick (`11a8:0874` l'écrit s'il est non nul) ; les épreuves testent « la voix en cours » par sa plage puis `1028:0d9e` (ex. grottes `1190:06ff` : 4000…4699 ou 7000…7099).

### 6.3 Pilotes

- **Numérique** : `waveOut*` direct (`11c8:1d4b`, `11c8:5590`, `11c8:584b`), mixage dans le moteur ; WaveMix désactivé (`MOHAWK.WIN` : `fenable = FALSE`). Fréquence 11 025 Hz, avec « translation » de fréquence si le périphérique la refuse (`Audio.WaveRateTranslations`).
- **MIDI** : pilote `11c0:*` (`midiOutOpen` `11c0:2681`, `midiOutLongMsg`, `midiOutShortMsg`, `midiOutCachePatches`), table de remplacement de canaux par périphérique dans `MOHAWK.WIN` : `Nom du périphérique = n` renvoie à `[MidiMap.TargetDeviceInfo]` `n = 012345678XXXXXXF;16;1;1` : 16 caractères = destination de chacun des 16 canaux sources (`X` = coupé), puis trois champs (16 ou 10 : nombre de canaux utilisables ; 1 ; 1 : **hypothèse** : voix / paramètres de patch). Exemples : `1 = 012345678XXXXXXF` (coupe 10–15), `2 = 012345678XXXXXX9;10` (coupe 10–15, canal 16 → 10), `5 = 01234XX789ABCDXX;10`. `BROEMIDI.EXE` (lanceur fourni) écrit `defaultMidiDevice` dans `MOHAWK.WIN` ; il n'est pas utilisé par le jeu au démarrage (`chaincommand` du `ZOOMBINI.CFG`).

## 7. Entrées

### 7.1 Souris

- Procédure de fenêtre `1148:0d80`, table de 20 messages à `1148:11ab` (messages à `11ab`, handlers à `11d3`) : `WM_DESTROY`, `WM_ACTIVATE` (6), `WM_SETFOCUS` (7), `WM_KILLFOCUS` (8), `WM_PAINT` (`0xf`), `WM_CLOSE` / `WM_QUIT` / `WM_ENDSESSION` (`0x10`, `0x12`, `0x16`), `WM_ACTIVATEAPP` (`0x1c`), `WM_SETCURSOR` (`0x20`), `WM_NCACTIVATE` (`0x86`), **`WM_KEYDOWN`** (`0x100`), **`WM_CHAR`** / `WM_DEADCHAR` (`0x102`, `0x103`), `WM_SYSCOMMAND` (`0x112`), **`WM_LBUTTONDOWN`** (`0x201`), **`WM_RBUTTONDOWN`** (`0x204`), **`WM_MBUTTONDOWN`** (`0x207`), `WM_QUERYNEWPALETTE` (`0x30f`), `WM_PALETTECHANGED` (`0x311`). Aucun `WM_MOUSEMOVE` ni `WM_LBUTTONUP` : **la position est lue par scrutation** (`GetCursorPos`, `1148:059d`, par `1198:0000`).
- Les clics de bouton `1`, `2`, `3` (gauche, droit, milieu) passent par `1148:0bdc` (conversion en coordonnées de jeu par `11e8:76fe`, mémorisation `DS:a3fc`) puis `1048:024a(bouton, point)` : file d'événements de `1048`. `1198:0000` dépile (`1048:031f`, `1048:02fb`) et appelle la détection de région `1038:*` (régions cliquables déclarées par `1038:0000`).
- **Souris aimantée** : `SetCursorPos` (`1148:0601`, `11e8:77bc`) : repositionne le curseur sur les zones importantes ; `STRL` 2023 : « souris aimantée / souris normale », « auto-aimantation oui / non » ; bascules `Ctrl+J` (`DS:a43c`) et `Ctrl+U` (`DS:a43e`). **Probable.**

### 7.2 Clavier : raccourcis (`1198:05b3`)

Le code reçoit le caractère ou la touche ; `1198:05b3(touche)` appelle d'abord le handler `+0x10` de l'écran. Raccourcis généraux **sûrs** (codes de contrôle ASCII) :

| Touche | Code | Action |
|---|---|---|
| `Ctrl+N` | `0x0e` | nouvelle partie (`11a0:425e`) |
| `Ctrl+C` | `0x03` (aussi `0x0c`) | charger une partie (`11a0:4434`) |
| `Ctrl+S` | `0x12`, `0x13` | enregistrer (`11a0:4493`) |
| `Ctrl+Q` | `0x11` | quitter (`11a0:44f2`) |
| `Ctrl+V` | `0x02`, `0x16` | bascule la **musique** (`DS:a43b`) ; messages `STRL` 2023 n° 1 / 2 « musique activée / désactivée » |
| `Ctrl+Y` | `0x19` | bascule les **voix et effets** (`DS:a43a`) ; messages 3 / 4 « sonores activés / désactivés » |
| `Ctrl+T` | `0x14` | transitions (`DS:854e` ; messages 11 / 12) |
| `Ctrl+J` | `0x0a` | souris aimantée (`DS:a43c` ; messages 9 / 10) |
| `Ctrl+U` | `0x15` | auto-aimantation (`DS:a43e` ; messages 13 / 14) |
| `Ctrl+G` | `0x07` | bascule `rec+0x20` (« moins d'action » / « plus d'action », messages 5 / 6) |
| `Ctrl+H` | `0x08` | bascule `DS:a43d` (« curseur masqué / affiché », messages 7 / 8) |
| `Ctrl+D`, `Ctrl+E`, `Ctrl+F` | `0x04`, `0x05`, `0x06` | posent `DS:013a` à 2, 0, 1 puis `11a0:4346` (rôle non étudié ; **hypothèse** : réglage de niveau) |
| `/`, `?` | `0x2f`, `0x3f` | ouvre `11a0:1737(0,0,0,0,0,1)` (aide ou menu) |

Les libellés de `STRL` 2018 (menu « Options ») portent « Dialogues & effets (ctrl v) » et « Musique de fond (ctrl y) », ce qui est **l'inverse** du code (`Ctrl+V` = file musique, `Ctrl+Y` = file voix / effets). Les messages affichés suivent le code : seule l'indication de touche des libellés est inversée (défaut de l'original, `screens.md` §5.2).

**Mode de débogage** (jamais accessible normalement ; `DS:a43f` posé par une séquence de saisie testée par `10a8:041f` avec un condensé, `0x20` = espace) : messages `you got it`, `Cheat on`, `Step-Mode ON / OFF`, `midi test on / off`, `Free:…`, touches `[` `]` (mode pas à pas), `P` (cadence : `%d-%d-%d` = mini / maxi / moyenne, en images par 600 ticks), `S`, `N`, `*`, `=`, `@`, `^`. Hors périmètre.

### 7.3 Curseurs

§4.4. Six emplacements `DS:a1ba / a1d2` : indice 0 = curseur système, 1 à 5 = `CURS` 1 à 5 de `ZOOMBINI.MHK`, convertis une fois au démarrage (`1160:0000`). `11e8:77bc` / `11e8:8d20` (`ShowCursor`) gèrent le masquage ; `Graphics.fEnableCursorFix` corrige des pilotes d'affichage.

## 8. Générateur aléatoire

**Sûr** (`1080:0028`, `1080:0000`, `1080:0086`).

```
graine32 ← graine32 × 0x343fd + 0x269ec3            (modulo 2³²)    LCG de Microsoft C
résultat ← (graine32 >> 16) mod (n + 1)              (n = 0 → 0)       i.e. nombre de 0 à n inclus
```

- `DS:0448` (dword) = graine ; `DS:044c` = 1 au chargement : à **la première utilisation** `1080:0000` initialise `DS:0448` = `time()` (`1000:5882` : horloge Borland, secondes depuis 1970) puis `DS:044c = 0`. Pas de graine fixe : **chaque partie est différente**.
- `10a8:04e8(max, min)` = `min + 1080:0028(max − min)` : entier de `min` à `max` inclus (utilisé partout : 80 fonctions). `1080:0086(n)` = `1080:0028(n − 1)` : entier de 0 à `n − 1` (appelé par `1098:0098`). Le 16 bit haut est utilisé en entier (pas de masque `0x7fff`) : le modulo porte sur 0…65 535.

## 9. Points ouverts

1. **Écrans 19, 20, 21, 22** : 19 et 20 (`PICKER.MHK`, `1110:20f6`, `1110:2f46`) n'ont pas de rôle établi (hypothèse : gestion des parties / équipes) ; aucun transfert `DS:8554 = 0x13…0x16` en constante ; la table a deux doublons (21 = 19, 22 = 0).
2. **`SCRS`** : **résolu** (§3.6, G1). Reste ouvert : les états 1, 2, 3, 4, 6 et 10 de `+0xf4` ne sont lus que dans `1168:4231` / `1168:0ba8` sans les avoir suivis dans tous les écrans (rôles marqués **probable**) ; les bases pour les poses 3 et `0xffff` (Fleens : **hypothèse**, nulles) ; le sens des octets 9 à 18 de la fiche (jamais lus) ; l'usage de la `tBMP` 3001 ; la pose du premier emplacement des scripts de rejet à première partie ≥ `0x13` (partie brute : déduit de la lecture de `4741`, pas observé en jeu).
3. **Image de 24 parties** : **tranché** (§3.5, `11a0:033a`) : le terminateur n'est pas lu dans la boucle de 24 cases ; il est relu au tour suivant comme premier mot d'une image vide (évènement et son déclenchés, aucun redessin), et le compteur d'images, qui avance d'un cran pour cette image vide, tronque le script d'autant d'images. `script.ts` le reproduit. Reste à confirmer en jeu sur FERRY 1517.
4. **Terminateurs** : sens des numéros d'événement `0xff01`…`0xff0b`, `0xff3e`, `0xff3f`, `0xfe01`… : ils appellent `+0x10(image, n - 1)`, la signification dépend de chaque épreuve ; `0xffc9…0xffda` : **résolu** (§3.7), déclenchés par le tick des snoids `1168:0ba8`.
5. **Drapeaux de feature (`+0x20`)** : signification des bits `0x2`, `0x2000`, `0x8000`, `0x80000`, `0x1000000`, `0x4000000` à confirmer ; délais utilisés par écran (valeurs 6, 7, autres ?).
6. **Placement de la zone 640 × 480** dans un écran plus grand et conversion de coordonnées (`11e8:76fe`, `11e8:5d70`) ; modes de dessin (écrêtage, miroir) des primitives graphiques de `11e8:*`.
7. **Fondus de palette** : mécanisme exact autour de `1058:03e5`, `11e8:88a8`, `11e8:7d44` (durée, pas) non décrit ; effets de palette pendant les transitions `XFER`.
8. **Sons** : priorités et canaux (`11a8:317c`, `1028:0b3d`, `1028:065f`) ; ids de la plage `20000…29999` (« s-sound » : flux ?) ; boucle des 22 sons à `Cue#` ; lecture simultanée maximale.
9. ~~`Ctrl+V` / `Ctrl+Y`~~ : résolu, défaut des libellés du menu seulement (§7.2).
10. **`NODE` / `PATH`** : **résolu** (§4.2, G1) : choix du chemin (`1168:2f9f`), points de passage, 5 secteurs, pas et vitesses (`1168:2b30`, `1168:0ba8`). Reste : `DS:970c` (coupe-circuit des chemins : qui le pose ?), `DS:9712` (variante d'attente à l'arrivée, `1168:464e`), `NODE` + `PATH` de `HOTEL` et `LILLY` apparemment inutilisés ; rôle exact du « terrain » (valeur 2, 8 cellules dans `HOTEL`).
11. **Correspondance d'épreuves** : `SLIDES` = « fosse de monte-pierre », `NET` = « muraille de signes », `CAVES` = « tanière du sphinx », `SMOKE` = « piège de cristal » et `MAZE2` = « gouffre des véhibules » sont déduites de l'ordre et des visuels ; à confirmer en lisant le premier texte d'aide de chaque épreuve (ids `STRL` des épreuves).
12. **`CURS`** : ordre `(x, y)` du point chaud ; `LOGO025B.MOV`, `LOGO027(B).MOV` non référencés.
13. **Format du `tBMP` ≥ `0x200`** (décompresseurs externes `Graphics.Decompressors`) : jamais rencontré dans les données.
