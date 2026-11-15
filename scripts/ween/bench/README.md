# Banc ScummVM de Ween

Banc de référence du portage de Ween : le moteur `gob` de ScummVM 2026.4.0 (commit `7d2709da5136866589f7602f5f5a7b17de03420e`, GPL v3+),
patché pour tracer les TOT chargés, les variables et les attentes, tourner en temps virtuel (son compris) et rejouer des entrées par image.
Il a produit les fixtures de `test/ween/fixtures/` (`intro`, `escape`, `quit`, `frames.json`, `full-game.json`).

## Contenu
- `scummvm-ween-bench.patch` (≈ 33 Ko) : patch **autonome** de ScummVM `7d2709da` (`git apply` à la racine du dépôt ScummVM). Dorsal SDL :
  `backends/events/sdl/bench.cpp` (nouveau : scénarios `BENCH_SCRIPT`, dont `console COMMANDE` et `burst` de captures), `sdl2-events.cpp`,
  `backends/module.mk`, `backends/platform/sdl/sdl.cpp` (horloge virtuelle `SKY_VIRTUAL_TIME` et mixeur virtuel `GOB_VIRTUAL_AUDIO`),
  `gui/debugger.h` (`parseCommand` public, pour `console`). Moteur `engines/gob` : `benchtrace.{h,cpp}` (nouveaux : toutes les variables
  `GOB_*`), accroches dans `game.cpp`, `hotspots.cpp`, `inter.cpp`, `inter_v1.cpp` (saut de protection, rustine VAR(59)), `util.cpp`,
  `videoplayer.cpp`, `sound/sound.cpp`, `module.mk`.
- `scummvm-ween-over-cruise.patch` (≈ 22 Ko) : même contenu, mais à appliquer **après** `../../croisiere/bench/scummvm-cruise-bench.patch`
  (voir « Les deux patchs »).
- `ween.ini.in` : configuration dédiée (cible `ween-fr`). `ween-replay.sh` : lanceur sans fenêtre. `idx2ppm.py` : captures `.idx`/`.pal` en PPM.
- `scenarios/` : scénarios `BENCH_SCRIPT` (`ween-intro`, `ween-menu`, `ween-replay`, `ween-smoke`). `inputs/` : entrées `GOB_INPUT`
  (`esc-disk`, `esc-quit`, `room`) et liste d'images de captures de l'introduction (`frames-intro.txt`).
- `tools/` : `fixture.py` (trace -> `<nom>.tt.json` + `<nom>.vh.gz`), `dvdiff.py`, `dldiff.py`, `opdiff.py` (comparaisons de vidages `DV`, d'attentes
  `DL` et d'opcodes `OP` entre le banc et le portage).
- Hors de ce dossier, déjà dans le dépôt : `test/ween/solution/bench/` (`ref.sh`, `full.sh`, `compare.mjs`, `vhfilter.mjs` : référence de la partie
  complète) et `test/ween/render/make-frames.mts` (empreintes d'images).

## Les deux patchs (Ween et Croisière)
Même base (`7d2709da`), mais les deux patchs créent/modifient les mêmes fichiers du dorsal : `bench.cpp`, `sdl2-events.cpp` et `module.mk` sont
identiques dans les deux, `sdl.cpp` diffère (Croisière : minuterie OPL 50 Hz `g_benchTimer50` ; Ween : mixeur virtuel), donc **deux `git apply`
successifs des patchs autonomes échouent**. Pour un seul binaire `gob` + `cruise` :
1. `git apply scripts/croisiere/bench/scummvm-cruise-bench.patch`, puis
2. `git apply scripts/ween/bench/scummvm-ween-over-cruise.patch` (`engines/gob`, `gui/debugger.h` et la fusion de `sdl.cpp` : le mixeur virtuel
   s'ajoute à la minuterie 50 Hz ; vérifié par `git apply --check`, jamais compilé ici).
Le patch Croisière seul ne rend pas `parseCommand` public : seul le patch Ween le fait (inutile pour `cruise`, utile à `console`).
Configure pour les deux : `--enable-engine=gob,cruise`. `SKY_VIRTUAL_TIME` et `CRUISE_VIRTUAL_TIME` activent la même horloge virtuelle.

## Refaire le banc de zéro
1. `git clone https://github.com/scummvm/scummvm && cd scummvm && git checkout 7d2709da5136866589f7602f5f5a7b17de03420e`
   (ou `git clone --filter=blob:none --no-checkout`, puis checkout), puis `git apply <ce dossier>/scummvm-ween-bench.patch`.
2. Dans un dossier de build séparé : `<scummvm>/configure --disable-all-engines --enable-engine=gob --disable-mt32emu --disable-fluidsynth --disable-fluidlite --disable-mpeg2 --disable-theoradec --disable-vpx --disable-faad --disable-freetype2 --disable-fribidi --disable-libcurl --disable-sdlnet --disable-cloud --disable-taskbar --disable-tts --disable-discord --disable-opengl-game --disable-jpeg --disable-gif --disable-a52 --disable-readline --disable-sparkle --disable-gtk --disable-system-dialogs --disable-lua --disable-detection-full --enable-optimizations --disable-debug`
   puis `make -j8`. Le binaire `scummvm` est la variable `SCUMMVM`. Garder ce build à part de tout ScummVM installé. Ne rien laisser d'unique dans
   `/private/tmp` (nettoyé à tout moment) : le patch du dépôt suffit à tout refaire.
3. Données : dossier du jeu français extrait de l'installeur (`innoextract --extract --output-dir <dossier vide> <installeur>`, sans jamais exécuter
   l'installeur), celui qui contient `INTRO.STK` ; c'est `WEEN_GAME_DIR`. Les fichiers du jeu ne sont pas dans le dépôt.
4. Ne jamais lancer ScummVM sans `-c` : `ween-replay.sh` écrit une configuration dédiée par lancement (`ween.ini.in`, `@GAME_DIR@` remplacé) et ne lit
   jamais celle de l'utilisateur.

## Règles du banc
- **Jamais deux ScummVM sur la même configuration** (ScummVM la réécrit en sortant ; des instances orphelines ont déjà faussé des références).
  Un lancement = un dossier de sortie et une configuration à lui.
- Entre deux commandes `console` d'un scénario, laisser **environ 2,5 s** (`wait 2500`) : règle de l'usage du banc, sans quoi la commande suivante est perdue ou mal ordonnée.
- **Tuer les processus** en fin de travail (`pkill -f scummvm` si un lancement reste) : `ween-replay.sh` impose un délai maximal (`alarm`).
- Chemins absolus pour scénarios, entrées et sorties ; `path=` du jeu absolu dans la configuration (un chemin avec `..` est réécrit par ScummVM).
- Fenêtre de 640x400 (`last_window_height=400`) : une hauteur de 480 décale le pointeur de 40 pixels.
- Temps virtuel obligatoire pour la reproductibilité : `SKY_VIRTUAL_TIME=1` **avec** `GOB_VIRTUAL_AUDIO=1` (sinon `o1_waitEndPlay` attend un mixeur
  tiré en temps réel). Introduction complète + entrée en jeu : ~5 s réelles. Graine : `--random-seed=1`.

## Particularités de Ween dans le patch
- **Protection sautée par défaut** (plan D2, `inter_v1.cpp`, `o1_callSub`), comme ScummVM le fait pour Gob1/Gob2/Adibou1 (`copy_protection=true` la
  rétablit). Deux appels : `INTRO5.TOT` `callSub 1023` et `INTRO.TOT` `callSub 348` (Échap). Trace `PS n tot offset`. `VAR(210)`=1 et `VAR(211)`=10
  comme après une réponse juste ; `EMAJ1000` les remet à zéro, seule `VAR(212)` ne l'est pas (0 ici, 0 à 4 dans l'original).
- **Rustine VAR(59)** (bogue ScummVM #3205) : la position 729 de ScummVM ne correspond pas à cet `INTRO5.TOT` (keyFunc lu à 727) ; le patch la
  reconnaît aussi par motif (keyFunc(1) suivi de l'affectation de `VAR(59)`). Trace `WK n tot pos v59`.
- **Opcodes gob 3 et 13** : sautés par ScummVM, vus sur le chemin Quitter (`GB n tot pos id unimplemented`).

## Variables d'environnement (`engines/gob/benchtrace.cpp`)
| Variable | Effet |
|---|---|
| `GOB_TRACE=1\|2\|3` | 1 : `TT n nom` (TOT chargé), `TX n nom` (TOT absent : fin), `GB n tot pos id nom\|unimplemented`, `PS`, `WK` ; 2 : + `OP n tot pos opcode` ; 3 : + `DL n t ms tot pos` (chaque `Util::delay`, `t` = horloge virtuelle avant l'attente, 600 ms au premier) |
| `GOB_VARHASH=1` | `VH n h` à chaque image : FNV-1a 32 bits des 3 885 variables courantes (15 540 octets, petit-boutiste) |
| `GOB_DUMP=a-b` | `DV n v0 … v3884` (non signés) pour les images a à b. `vhfilter.mjs` en tire le `VH` masqué (variables 5 à 11, la date réelle, mises à 0) |
| `GOB_INPUT=fichier` | entrées par image : `n m x y` déplacement, `n c x y` clic gauche (appui en n, relâche en n+1), `n d\|u x y`, `n r x y` clic droit, `n k TOUCHE` (ESC, RETURN, SPACE, flèches, F1-F12 ou un caractère), `n q` |
| `GOB_SHOT_FRAMES=n1,n2,… GOB_SHOT_DIR=dossier` | `fr-NNNNN.idx` (320x200 indices bruts, sans curseur) + `fr-NNNNN.pal` (768 octets 0-255) ; `python3 -I idx2ppm.py fr-00450.idx` |
| `GOB_STOP_FRAME=n` | quitte après l'image n |
| `GOB_VIRTUAL_AUDIO=1`, `SKY_VIRTUAL_TIME=1` | mixeur et horloge virtuels (voir règles) |
Une « image » est un point où le script rend la main (`BenchTrace::onFrame`) : le portage l'aligne par `Host.markImage()`.

## Produire les fixtures
Toutes les commandes : `SCUMMVM=… WEEN_GAME_DIR=… scripts/ween/bench/ween-replay.sh DOSSIER STOP [ENTREES] [DELAI_S]`, avec `DUMP=1-STOP` pour les
références de variables (écrit `vh.txt` et `tt.txt` filtrés) et `SHOTS=…` pour les captures.
- **`intro`** (introduction regardée jusqu'à `EMAJ1000`, 4 000 images) : `DUMP=1-4000 ween-replay.sh $O 4000`, puis
  `python3 -I tools/fixture.py $O/tt.txt $O/vh.txt intro 4000` -> `test/ween/fixtures/intro.{tt.json,vh.gz}`. `escape` : entrées `20 k ESC`, 400 images ;
  `quit` : `inputs/esc-quit.txt` (Échap, menu, « Quitter », « Je confirme », `TT END` puis `TX`). Mêmes commandes.
- **`frames.json`** (empreintes d'écran) : `SHOTS=$(cat inputs/frames-intro.txt) ween-replay.sh $O 4000` (ou `ENTREES` + liste d'images pour `quit` : `esc-quit.txt`,
  `room` : `inputs/room.txt`), puis `npx vite-node test/ween/render/make-frames.mts <scénario> $O/shots`.
- **`full-game.json`** (partie complète, 48 357 images) : `test/ween/solution/bench/ref.sh DOSSIER` (portage joue la solution -> `inputs.txt`, banc rejoué par
  `full.sh` avec `SCUMMVM` et `WEEN_GAME_DIR`, via `ween-replay.sh`).
- **Scénarios `BENCH_SCRIPT`** (`SCENARIO=scenarios/ween-menu.txt`, captures PNG par `burst`/`shot`) : introduction complète (170 captures), Échap -> menu,
  `ween-replay.txt` n'attend que (entrées par `GOB_INPUT`), `ween-smoke.txt` essai court.

## Non récupéré / à savoir
- Les sorties (`out/`, captures, traces) et les données du jeu ne sont pas versionnées.
- Le vidage côté portage qui alimentait `dvdiff.py`, `dldiff.py` et `opdiff.py` (test de débogage jetable `zz-debug.test.ts`) n'est pas conservé : ces
  trois scripts lisent un fichier au même format que les lignes `DV`/`DL`/`OP` du banc.
- Le patch n'a pas été recompilé ni lancé lors de cette mise au propre (il vient du commit local `570b4e22` de l'arbre reconstruit, diff `7d2709da`
  restreint à `backends/`, `gui/` et `engines/gob`) ; les parties Sky, Lure et Drascula de ce même arbre ne sont pas incluses.
