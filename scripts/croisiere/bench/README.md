# Banc ScummVM de Croisière pour un cadavre

Banc de référence du portage : le moteur `cruise` de ScummVM 2026.4.0 (GPL v3+), patché pour tracer chaque tour, tourner en temps virtuel
et rejouer des entrées de souris tour par tour. Il a produit les fixtures de `test/croisiere/solution/` : `scummvm-replay.test.ts`
compare le portage à ce banc tour par tour sur une partie complète (`docs/croisiere/plan.md`, vague K).

## Contenu
- `scummvm-cruise-bench.patch` : patch de ScummVM `v2026.4.0` (`git apply` à la racine du dépôt ScummVM). Moteur `engines/cruise`
  (nouveaux `bench.cpp`/`bench.h`, accroches dans `cruise_main.cpp`, `script.cpp`, `function.cpp`, `menu.cpp`, `sound.cpp`, `cruise.h`,
  `module.mk`) et banc commun du dorsal SDL (`backends/platform/sdl/sdl.cpp` : horloge virtuelle `SKY_VIRTUAL_TIME`/`CRUISE_VIRTUAL_TIME`
  et minuterie OPL de 50 Hz ; `backends/events/sdl/bench.cpp` : scénarios `BENCH_SCRIPT`). Toute la lecture des variables d'environnement
  du moteur est dans `engines/cruise/bench.cpp`.
- `cruise-replay.sh` : lanceur sans fenêtre (voir plus bas). `scummvm.ini.in` : configuration dédiée (cible `cruise-fr`).
- `cruise-checkpoints.py` : points de contrôle de la partie complète à partir d'une trace.
- `cruise-disasm.py` (+ `func-names.txt`) : désassembleur des scripts d'overlay vidés par `CRUISE_DUMP_OVL`. `idx2png.py` : captures
  `.idx`/`.pal` en PNG (ffmpeg).

## Préparer
1. ScummVM : `git clone https://github.com/scummvm/scummvm && cd scummvm && git checkout v2026.4.0 && git apply <ce dossier>/scummvm-cruise-bench.patch`,
   puis, dans un dossier de build séparé, `<scummvm>/configure --disable-all-engines --enable-engine=cruise && make -j8` (≈ 1 min).
   Le binaire produit (`scummvm`) est la variable `SCUMMVM` des scripts. Garder ce build à part de tout ScummVM installé.
2. Données : ScummVM lit aussi `VOL.1` à `VOL.5`, `VOL.END` et `DELPHINE.CFG`, absents de `original/croisiere/`. Extraire l'installeur
   (`archives/croisiere/setup-00074-Croisiere_pour_un_cadavre-Dosbox.exe`) dans un dossier vide, sans jamais l'exécuter :
   `innoextract --extract --output-dir <vide> <installeur>`. Le dossier `Croisier` obtenu est la variable `CRUISE_GAME_DIR`.
3. Ne jamais lancer ScummVM sans `-c` : `cruise-replay.sh` écrit une configuration dédiée par lancement et ne lit jamais celle de
   l'utilisateur.

## Refaire les fixtures de la partie complète
1. `CROISIERE_BENCH_OUT=/abs/rec npx vitest run test/croisiere/solution/bench-record.test.ts` : le portage joue la solution et écrit
   `inputs.txt` (entrées par tour) et `steps.txt` (fins d'étape).
2. `SCUMMVM=... CRUISE_GAME_DIR=... scripts/croisiere/bench/cruise-replay.sh /abs/rec/inputs.txt /abs/out 224150 1 3000` (≈ 4 min).
3. `python3 -I scripts/croisiere/bench/cruise-checkpoints.py /abs/out/cruise.trace /abs/rec/steps.txt > test/croisiere/solution/fixtures/scummvm-checkpoints.txt`,
   et copier `/abs/rec/inputs.txt` en `test/croisiere/solution/fixtures/scummvm-inputs.txt`.
4. `npx vitest run test/croisiere/solution/scummvm-replay.test.ts`.

Résultat du 15/11/2026 : 16 545 niveaux d'entrée, 224 148 tours jusqu'au chargement de `GEN` ; les 672 444 lignes `FR`/`VH`/`SC` du
portage sont identiques à celles du banc. Deux lancements identiques du banc donnent des traces identiques octet pour octet.

## Contournement de la protection (`CRUISE_SKIP_PROTECTION=1`)
Au début d'`Op_ProtectionFlag(-1)` appelé par la procédure 2 de l'overlay `XX2`, le banc écrit `1` dans les mots BE `SUPER.BSS[4]` et
`[6]`, puis `protectionCode = SUPER.BSS[8]` (la somme que le script vient de calculer, -29430) : le jeu prend son chemin « déjà validé ».
Le portage fait la même chose (`docs/croisiere/engine.md` § 12, qui détaille le mécanisme du jeu). `NOSKIP=1` garde la vraie protection ;
`CRUISE_PROT_CHEAT=1` recopie alors la réponse attendue avant le bouton OK, sans forcer l'interface.

## Variables d'environnement
| Variable | Effet |
|---|---|
| `CRUISE_TRACE=1\|2\|3` | trace sur stderr (formats ci-dessous) |
| `CRUISE_VARHASH=1` | `VH n h` et `SC n crc pal` après chaque tick |
| `CRUISE_DUMPVARS=a-b` | pour les ticks a à b : `DV n i:v ...` (`globalVars` non nuls), `PC n protectionCode`, `BH n NOM hash` (FNV-1a du BSS de chaque overlay chargé) ; avec `CRUISE_DUMPBSS=NOM` : `BS n NOM off:val ...` (mots BE non nuls de ce BSS) |
| `CRUISE_INPUT=fichier` | entrées souris par tick |
| `CRUISE_KEYS=fichier` | touches par tick |
| `CRUISE_STOP_FRAME=n` | quitte à la fin du tick n |
| `CRUISE_SHOT_FRAMES=n1,n2,.. CRUISE_SHOT_DIR=dossier` | `fr-NNNN.idx` (64000 indices de `globalScreen`) + `fr-NNNN.pal` (768 octets RGB 8 bits de la palette envoyée à l'écran) à la fin du tick ; `bench/idx2png.py` convertit en PNG |
| `CRUISE_VIRTUAL_TIME=1` | horloge virtuelle |
| `CRUISE_SKIP_PROTECTION=1` | contournement de la protection |
| `CRUISE_PROT_CHEAT=1` | vérification seulement (voir plus bas), jamais avec le contournement |
| `CRUISE_DUMP_OVL=dossier` | dump des scripts à l'arrêt |

Le numéro de **tick** `n` (compté à partir de 1) est incrémenté à chaque tour de `mainLoop` (juste après l'attente, avant `processInput`) **et** à chaque itération des boucles modales (menu joueur `processMenu`, pause) : un clic dans le menu joueur est donc rejouable. `FR n` ne couvre que les tours de `mainLoop` ; `MF n où x y b` (où = `menu` ou `pause`) trace une itération modale. `CRUISE_STOP_FRAME` et les captures comptent des ticks.

## Format de la trace (stderr ; `cruise-replay.sh` filtre vers `cruise.trace`)
Niveau 1 : `FR n x y b ue uw at menu dlg rel spd ud` après `processInput` : souris vue par le jeu (x, y, bits 1 gauche / 2 droit / 4 milieu-Échap), `userEnabled`, `userWait`, `autoTrack`, `currentActiveMenu`, `dialogueEnabled`, `linkedRelation != null`, `_gameSpeed`, `userDelay`.
Niveau 2 (en plus) :
- `SS P|R OVL idx script type ip0 ip1 ret=r rc=c` : une tranche de script (P = liste proc, R = liste rel ; `ret` = valeur de retour du dernier opcode, 1 = yield/stop, négatif = abandon ; `rc` = retour de `executeScripts`), dans l'ordre d'exécution.
- `NF 0xNN Nom (a0,a1,..) -> r` : appel de fonction native (`opcodeType8`), avant sa tranche `SS`. Arguments dans l'ordre de dépilement ; `P` = pointeur ; chaîne `S"..."` (lue **avant** l'appel ; non imprimable en `\xNN`) pour les fonctions qui en prennent (la destination de Strcpy/Strcat/Itoa reste `P`). `RN borne résultat` après chaque `Random` ; `LoadOverlay` donne nom -> index dans le `NF`.
- après les scripts : `PL n ovl:script:type:ip:freeze:sysKey ...` (procs), `RL n ...` (rels), `CL n ovl:idx:type:freeze:plan:x:y:sprite ...` (cellules, ordre de la liste) ; après `processAnimation` : `AC n ovl:idx:type:x:y:xdest:ydest:phase:counter:pathId:startDir:nextDir:endDir:stepX:stepY:poly:flag:start:freeze ...`.
Niveau 3 (en plus) : `OP ovl script ip 0xOP` avant chaque opcode (IP avant lecture, octet brut).
Avec `CRUISE_VARHASH` : `VH n h` (FNV-1a 32 bits des 2000 `globalVars`, 2 octets chacun, octet de poids faible d'abord) et `SC n crc pal` (CRC32 hex de `globalScreen` 64000 octets, et de la palette 768 octets RGB). Ordre dans un tick : `FR`, (`SS`/`NF`/`RN`), `PL RL CL`, `AC`, `VH`, `SC`. Les écritures d'état individuelles (item 4 de `engine.md` §11), le journal OPL, la musique horodatée et `freeAutoCell` ne sont pas tracés (non demandés ici).

## Entrées par tick
`CRUISE_INPUT` : lignes `n x y b` (`#` = commentaire) : à partir du tick n, la souris est en (x,y) avec les boutons b (bits 1/2/4). C'est un niveau (valable jusqu'à la ligne suivante) rejoué comme les événements ScummVM : un changement de position ou de bit met à jour `currentMouseX/Y` / ne change que le bit concerné (`_mouseButtonDown`/`endpause` comme `manageEvents`) ; si le moteur remet le bouton à zéro (userDelay, fin d'`userWait`) il reste à zéro jusqu'au changement suivant. Avant la première ligne : (0,0) boutons 0. `CRUISE_KEYS` : `n NOM` (`ESC` = bouton milieu pendant ce seul tick + action `kActionEscape`, `SPACE` fin d'attente, `F10` menu joueur, `P` pause, `X` quitter, `I` inventaire, `PLUS`, `MINUS`). Dès que l'un des deux est défini, tous les événements souris/clavier réels (dont ceux du banc `BENCH_SCRIPT`) sont ignorés, sauf la fermeture. La position ne sert pas à l'affichage du curseur au-delà du survol du jeu lui-même.
Pour cliquer : trois lignes, par exemple `980 151 187 0 / 982 151 187 1 / 984 151 187 0` (un changement de bouton par tick au plus, comme le moteur).

## Temps virtuel et musique OPL
- `CRUISE_VIRTUAL_TIME=1` : `getMillis` n'avance que par `delayMillis` (sans attente) ; 4000 ticks en ~1 s de calcul.
- Le callback OPL à 50 Hz de ScummVM tourne sur le fil audio (mixeur SDL) en temps réel. En temps virtuel, `AdLibSoundDriver` n'appelle pas `_opl->start` : il enregistre son `onTimer` dans `g_benchTimer50`, que `delayMillis` appelle dans le fil principal chaque fois que l'horloge franchit un multiple de 20 ms (pas de réentrance). La musique avance donc de 1 pas toutes les 20 ms virtuelles, de façon déterministe (le fondu `fadeOut` : +2 par pas jusqu'à 100 = 50 pas = 1 s ; `songPlayed` passe à vrai au pas où il atteint 100 ; l'attente active de `load()` utilise `delayMillis(50)` donc 2,5 pas). **Il n'y a plus de son** dans ce mode. Le portage doit compter ses ticks de 20 ms sur la même horloge ; la phase est « multiples de 20 ms de l'horloge virtuelle depuis 0 » (première échéance au prochain multiple après la création du pilote, sans rattrapage), avancée par les `delayMillis(10)` de la boucle (1 tick de 50 ms = 5 attentes de 10 ms = 2,5 pas OPL).
- `audio_driver=null` de la config est sans effet réel (le mixeur SDL factice est utilisé) ; sans temps virtuel le fil audio reste non déterministe.

## Limites
- Pas de son en temps virtuel (OPL piloté à la main, pas de mixage). Aucun test hors `cruise-fr`.
- La trace ne couvre pas les écritures mémoire individuelles, les auto-cellules, ni les écritures OPL.
- Niveau 2 : ~560 octets par tour ; la comparaison avec le portage se fait par empreintes (`VH`, `SC`), puis par niveau pour localiser
  une divergence. Les chaînes des `NF` sont celles d'avant l'appel, limitées à 40 octets.
