# Ween: The Prophecy : le moteur de ScummVM et le découpage du portage

Étude en lecture du moteur `gob` de ScummVM (commit 7d2709da du 10/10/2026, GPL v3 ou ultérieure), comparée au portage existant de Lost in Time (LiT, `src/games/lost-in-time/`, ~15,7 k lignes). Références `fichier.cpp:N` relatives à `engines/gob/`. Statut : **lu**, sauf mention ; les chiffres de données sont vérifiés dans `formats.md`. Les décisions « recommandé, plan Dn » viennent du plan du portage (`plan.md`) et **ne sont pas encore validées**.

Idée directrice : Ween emprunte un **sous-ensemble v2** de ce que le portage de LiT (v3) implémente déjà. Le travail est de paramétrer le moteur par version et par jeu plutôt que d'écrire de nouvelles fonctions.

## 1. Classes instanciées pour Ween et pour LiT

`gob.cpp:558-569` (Ween partage le `case` de Gob2 et Crousti) et `gob.cpp:623-633` (LiT) :

| Rôle | Ween | LiT |
| --- | --- | --- |
| Init | `Init_v2` | `Init_v3` |
| Video | `Video_v2` | `Video_v2` |
| Inter | `Inter_v2` | `Inter_v3` (dérive de `Inter_v2`) |
| Mult | `Mult_v2` | `Mult_v2` |
| Draw | `Draw_v2` | `Draw_v2` |
| Map | `Map_v2` | `Map_v2` |
| Goblin | `Goblin_v2` | `Goblin_v3` (dérive de `Goblin_v2`) |
| Scenery | `Scenery_v2` | `Scenery_v2` |
| SaveLoad | `SaveLoad_v2` | `SaveLoad_v3(…, kScreenshotTypeLost)` |

Seuls Init, Inter, Goblin et SaveLoad diffèrent. Config commune (`gob.cpp:331-339`) : `_videoMode = 0x13`, `_useMouse = 1`, `_soundFlags = MIDI|SPEAKER|BLASTER|ADLIB` ; `copy_protection` lu en `gob.cpp:143`. Seul champ propre à Ween : `_weenVoiceNotepad` (`gob.h:232`, `gob.cpp:146`), pour la synthèse vocale : sans objet.

`Init::initGame` (`init.cpp:89-220`, commun) : ouvre `intro.stk`, charge les polices de `intro.inf` (`ema2 ema5 ema3 profecy`), alloue `Script::getVariablesCount("intro.tot")` = 3 885 variables (15 540 octets), puis `Game::start()`. `Init_v2::initGame` (`init_v2.cpp:76-93`) ne traite que Adibou1 avant d'appeler cette routine.

## 2. Interpréteur : différences v2 / v3 et opcodes utilisés

### Inter_v3 contre Inter_v2 (`inter_v3.cpp:51-71`, `inter_v2.cpp:64-154`)

Inter_v3 = Inter_v2 plus trois différences ; **Ween prend le côté v2 dans les trois cas** :

| Opcode | Ween (v2) | LiT (v3) |
| --- | --- | --- |
| FUNC `0x22` / `0x23` haut-parleur | `o1_speakerOn/Off` (`inter_v1.cpp:1480-1505`) ; le contournement « fréquence 50 → durée 5, ignorer le off suivant » n'existe que pour Gob2 (`inter_v1.cpp:1491`) : **Ween ne l'a pas** | `o3_speakerOn/Off` avec ce contournement (`inter_v3.cpp:73-101`) |
| FUNC `0x32` copie de sprite | `o1_copySprite` simple (`inter_v1.cpp:1627`) | `o3_copySprite` = `o1_copySprite` + `sparseRetrace(20)` si destination = écran (`inter_v3.cpp:103-109`) |
| Table gob | 0 `o2_loadInfogramesIns`, 1 `o2_startInfogrames`, 2 `o2_stopInfogrames`, 10 `o2_playInfogrames`, 100 `o2_handleGoblins`, 500 / 501 Protracker (`inter_v2.cpp:143-154`) | 100 `o3_wobble`, plus de 500 / 501 (`inter_v3.cpp:63-71`) |

Le portage de LiT fusionne ses tables d'opcodes en v1 < v2 < v3 et ne surcharge que ces trois points (`engine/opcodes.ts`). Pour Ween : table de version « v2 » sans les trois surcharges v3.

### Opcodes gob inconnus : 3 et 13

Un opcode gob inconnu est sauté de `paramCount × 2` octets avec un avertissement (`inter.cpp:98-114`). Ween en appelle deux, **non implémentés dans ScummVM** : **gob 3** (4 fois) et **gob 13** (4 fois), `paramCount = 1`, dans `INTRO`, `INTRO5` et `MENU`, avant un `loadTot END`. Effet d'origine inconnu (**supposé** : son ou fondu). Le portage de LiT **lève** une erreur sur ces opcodes (`opcodes.ts:743-758`), donc plante sur Ween. Recommandé, plan D9 : sauter comme ScummVM. Les fonctions Infogrames ne font rien sous DOS (`_infogrames` nul, `sound/sound.cpp:185-200` ; `ween.ins` n'existe que pour Amiga et Atari, `tables_ween.h:134,187`).

Usage mesuré (`o2_goblinFunc`, 13 appels dans les 67 TOT) : `o2_loadInfogramesIns` (1, `MENU`), `o2_startInfogrames` (1, `EMAJ1003`), `o2_stopInfogrames` (4), gob 3 (4), gob 13 (4). Aucun `o2_handleGoblins`, aucun `o3_wobble`.

### Opcodes utilisés par Ween

Union sur les 67 TOT (nombre de TOT entre parenthèses quand il est connu). Tous existent déjà **par leur nom** dans le portage de LiT :
`o1_animate` (41), `o1_animateCursor`, `o1_animatePalette`, `o1_blitCursor`, `o1_callSub`, `o1_capturePush/Pop`, `o1_clearCursorAnim`, `o1_drawLine` (3), `o1_fillRect`, `o1_freeAnim`, `o1_freeFontToSprite` (1), `o1_freeMult`, `o1_freeSoundSlot`, `o1_freeSprite` (2), `o1_if`, `o1_initCursor`, `o1_initCursorAnim`, `o1_istrlen`, `o1_keyFunc`, `o1_loadAnim`, `o1_loadCursor`, `o1_loadFont` (1), `o1_loadSpriteContent` (3), `o1_loadSpriteToPos`, `o1_loadTot` (8), `o1_palLoad`, `o1_playComposition` (1, `INTRO0`), `o1_playSound`, `o1_printTotText`, `o1_renewTimeInVars` (1), `o1_repeatUntil`, `o1_return` (1), `o1_returnTo` (6), `o1_setFrameRate`, `o1_setMousePos` (1), `o1_setcmdCount` (1), `o1_speakerOn` (3), `o1_speakerOff` (4), `o1_strToLong` (2), `o1_switch`, `o1_updateAnim` (4), `o1_waitEndPlay`, `o1_whileDo`, `o1_copySprite` (13, décodé `o3_copySprite` par LiT), `o2_animPalInit` (7), `o2_assign`, `o2_checkData`, `o2_createSprite` (2), `o2_getFreeMem` (1), `o2_goblinFunc` (4), `o2_initMult`, `o2_initScreen` (4), `o2_loadFontToSprite` (1), `o2_loadMultObject`, `o2_loadSound`, **`o2_playImd` (47 TOT, 192 appels)**, `o2_popVars` (1), `o2_printText`, `o2_pushVars` (1), `o2_readData`, `o2_setRenderFlags` (1), `o2_setScrollOffset` (3), `o2_stopSound`, `o2_switchTotSub`, `o2_totSub` (2), `o2_writeData` (2).
**Absents** : `o2_loadMult`, `o2_playMult` (pas de fichier MULT : animations par `o1_loadAnim` et objets mult), `o1_loadStatic`, `o1_renderStatic`, `o2_scroll`, `o2_addHotspot`, tout CD / LIC / ITK, gobelins, wobble.

**Chemins v2 peu exercés par LiT** (risque de régression à tester) : `o2_totSub` avec flags 2 / 3 et `pushVars` / `popVars` (MENU : PARTIE, ADL, salle, JOKER, `edit`, `reglage`), `o2_createSprite` + `o2_loadFontToSprite` (`INTRO2`), `o1_playComposition`, `o2_animPalInit`, surfaces 640×200 et 320×465, bloc-notes (saisie, `forceMouseUp`), jokers.

## 3. Ce qui n'est pas utilisé

| Domaine | Raison | Fichiers ScummVM écartés |
| --- | --- | --- |
| Gobelins | 0 occurrence de `o2_loadMapObjects` (0x50), `o2_freeGoblins`, `o2_moveGoblin`, `o2_writeGoblinPos`, `o2_stopGoblin`, `o2_setGoblinState`, `o2_placeGoblin` (0x51-0x56), `o2_handleGoblins` | `goblin_v2.cpp:144-670`, `goblin_v3.cpp:37-138` ; seul `Goblin::freeObjects` est appelé en fin de TOT (`game.cpp:669`). Le `NO_GOBLINS` de LiT (`engine/system.ts:27`) suffit |
| Carte | pas de chargement d'objets | `map_v2.cpp:50-195` |
| Fichiers MULT | animations par `o1_loadAnim` | `mult_v2` reste utilisé pour les objets mult |
| Infogrames, Protracker | Amiga / Atari | `sound/infogrames.cpp`, `sound/protracker.cpp` |
| CD, LIC, ITK, VMD | pas de CD ; IMD seuls | `sound/cdrom.cpp` |
| Voix, sous-titres | `GUIO_NOSPEECH|GUIO_NOSUBTITLES` | |
| Synthèse vocale du bloc-notes | TTS d'accessibilité de ScummVM | `draw_v2.cpp:886-895`, `hotspots.cpp:1963-2000`, `inter_v1.cpp:1397`, `game.cpp:707` |

Branches propres à LiT ou Gob3 à ne **pas** appliquer à Ween : `mult_v2.cpp:280-288` (IMD→VMD Windows) ; `videoplayer.cpp:214-226` (vidéos gardant le curseur, dupliquée en dur dans `engine/video/player.ts:82`) ; `inter_v2.cpp:807-830` (passage 640×400×16 d'`o2_initScreen`, dupliqué en dur dans `engine/graphics/draw.ts:161-170`). `scenery.cpp:60-69` : `_maxDrawOrder` = 40 pour Gob2 et Gob3, **100 pour Ween et LiT**.

## 4. Graphismes

Mode vidéo `0x14` 320×200 pour Ween (`gob.cpp:770-785`) ; LiT ajoute le mode 640×400 (`gob.cpp:787-790`). `o2_initScreen` crée trois formes d'écran :
- **320×200** : `MENU` et la plupart des salles ;
- **640×200** : `INTRO` et `EMAJ1010` (panorama) ;
- **320×465** : `EMAJ1008`, **défilement vertical** piloté par script (`o2_setScrollOffset`, 3 TOT).

**`_noScroll`** : avec `Init_v2`, il reste à `true` (`game.cpp:492`), donc `Game::evaluateScroll` (`game.cpp:804-806`) ne fait **pas** de défilement à la souris ; avec `Init_v3` (`init_v3.cpp:43-56`) il passe à `false` à `initVideo`. Pour Ween : pas d'`evaluateScroll`, le défilement est entièrement par script. Le portage de LiT n'a de toute façon pas d'`evaluateScroll` (seulement `preventScroll`, `engine/graphics/draw.ts:93`).
**Palettes** : par `o1_palLoad` à partir de `COMMUN.IM1` ou des palettes embarquées dans le TOT. Rendu : `draw_v2` et `mult_v2` identiques à LiT.

## 5. Boucle, cadence, attente active

`Init::initGame` → `Game::start` → `Game::playTot` (`game.cpp:560-690`), identique à LiT : par TOT, `initControlVars`, `mult->initAll` / `zeroMultData`, chargement du script et des ressources, `VAR(13) = _useMouse`, `VAR(14) = _soundFlags`, `VAR(15) = _fakeVideoMode`, **`VAR(16) = _language`** (`game.cpp:640-647`), `callSub(2)`, puis libérations (`goblin->freeObjects`, samples SND, `game.cpp:671-679`) et enchaînement sur `_totToLoad`.
Chaîne d'introduction : `INTRO` → `totSub INTRO0` (flags 0) → `loadTot INTRO1` … `INTRO5` (→ `DEMO`) ; `INTRO` → `MENU`.

**Cadence** : `Util::setFrameRate` (`util.cpp:461-468`, `_frameWaitTime = 1000 / cadence`), `Util::waitEndFrame` (`util.cpp:474-502`), `getTimeKey` en ms (`util.cpp:57`), délais d'`o1_keyFunc` (commandes 100 / 250 / 1000 dans `INTRO`).
**Attente active** : `Inter::handleBusyWait` (`inter.cpp:477-486`) fait `longDelay(1)` si deux appels sont séparés de moins de 20 ms. Conséquence connue (bug ScummVM #3205) : voir § 11, rustine VAR(59).

## 6. Hasard

Seul chemin actif pour Ween : le `rand()` des expressions (`expression.cpp:827-830`) → `Util::getRandom(max)` = `_rnd.getRandomNumber(max − 1)` (`util.cpp:61-65`), `RandomSource("gob")` (`gob.cpp:124`). Environ **161 motifs** `OP_FUNC(29) FUNC_RAND(10)` dans **39 TOT** (estimation par octets) : `INTRO` (protection), `INTRO0`/`3`/`5`, la plupart des `EMAJ`. Les autres sources (`goblin.cpp:547-549`, `goblin_v1/v2`, `inter_v1.cpp:2446`) ne sont pas atteintes.
Le portage de LiT utilise `Math.random` (`ui/browser-host.ts:104-105`). Recommandé, plan D7 : hasard **injecté**, `scummvmRandom` (`src/engine/rng.ts:89`) pour reproduire le banc dans les tests.

## 7. Langue

L'entrée de détection donne `FR_FRA` → `_global->_language = kLanguageFrench` (0) (`gob.cpp:342-390`, `global.h:71-81`). Textes : TOT avec `textsOffset = 0` → `Resources::loadTOTLocTexts` (`resources.cpp:495-545`), suffixe `.DAT` (`resources.cpp:458-480`). `INTRO.DAT` contient les cinq langues de la protection ; `switch` sur `VAR(16)` (0 → texte 2 = français). `lg_fr` du lanceur d'origine et `ALL.ASK` ne servent pas. LiT a déjà `fr → .DAT` (`data/tot.ts:182-194`). Ween n'est livré qu'en français : pas de sélecteur de langue.

## 8. Son

- **Musique AdLib (ADL)** : `o2_loadSound` avec slot négatif → `SOUND_ADL` (`inter_v2.cpp:1669-1683`), id ≥ 30000 (EXT). `ADL.TOT` (sélecteur de musique appelé par `MENU`) charge 30000-30005 ; les salles chargent leurs ADL en slot −19. Lecture : `o1_playSound` → `adlibLoadADL` + `adlibSetRepeating(repCount − 1)` + `adlibPlay` (`inter_v1.cpp:1767-1770`), lecteur `sound/adlplayer.cpp`. Le portage de LiT a déjà ce lecteur sur `src/audio/opl2.ts` ; sa sortie est celle de LiT (à confirmer sur Ween par le banc, § 13).
- **Échantillons SND** : slots 0-9, libérés en fin de TOT (`game.cpp:671-679`). `o1_playComposition` (`INTRO0` uniquement) → `Sound::blasterPlayComposition` (`sound/sound.cpp:481`).
- **Haut-parleur PC** : `o1_speakerOn/Off` (bips de la protection, de `MENU`, de `EMAJ1031`) → `sound/pcspeaker.cpp` (`sound.cpp:160-175`). **Stub** dans LiT (`engine/audio/sound.ts:452-453`) ; onde carrée à écrire (~60-100 lignes) ; sans le contournement « pas » de `o3_speakerOn` (§ 2).
- Pas de CD, pas de MDY / TBR, pas de voix.

## 9. Vidéos IMD

`o2_playImd` dans 47 TOT (192 appels), noms de fichiers en variables ; 30 IMD, **sans son**, fenêtres de 40×55 à 200×158. Les 30 sont décodés par `data/imd.ts` de LiT. Le lecteur (`engine/video/player.ts`) est repris ; sa liste en dur `VIDEOS_WITH_CURSOR` est propre à LiT et devient un crochet par jeu (§ 12).

## 10. Sauvegardes : `SaveLoad_v2`

Fichiers interceptés (`save/saveload_v2.cpp:35-40`, handlers `:259-270`) : `cat.inf` et son alias `cat.cat` (`GameHandler` : index de 15 × 40 octets = 600 octets à l'offset 0, puis 15 emplacements), `save.inf` (`TempSpriteHandler`, `savehandler.cpp:243-420`), `bloc.inf` (`NotesHandler(600)`, `savehandler.cpp:423-540`). Emplacement = `(offset − 600) / varSize`, reste nul exigé, taille nulle = `varSize` = 15 540 (`saveload_v2.cpp:50-66, 89-172, 174-242`). Format ScummVM : un fichier par emplacement `<cible>.sNN` (`SlotFileIndexed`), parties `SavePartInfo` (description 40 octets) et `SavePartVars` ; `SaveConverter_v2` pour les anciens formats.
**Différence avec LiT** (`save/saveload_v3.cpp:34-41`, portage `engine/saves.ts`) : v3 = `cat.inf` (propriétés + 30 descriptions), `ima.inf` (captures), `intro.$$$` (sprite), `bloc.inf` de 2 560 octets, `prot` et `config` ignorés. Couche v2 à écrire sur la même ossature (`src/engine/save-slots.ts`) : ~300-400 lignes et tests.
Côté script (`MENU.TOT`) : lecture de l'index (`readData` variable 0x44, taille 600, offset 0), écriture de l'index puis de `CAT.INF` à `600 + emplacement × …`. Les `MENU.CAT`, `OBJET1..4.CAT`, `EMAJxxxx.CAT` ne sont **pas** des sauvegardes (`formats.md` § 11).
Recommandé, plan D4 : menu d'origine du jeu (15 emplacements de `cat.inf`, `SaveLoad_v2`) sur le stockage du navigateur ; bloc-notes (`bloc.inf`) conservé. Les `CAT.INF` livrés (12 432 octets par emplacement) ne sont pas importés (`formats.md` § 12).

## 11. Cas particuliers de Ween et protection

`kGameTypeWeen` hors détection : `gob.cpp:558`, `inter_v1.cpp:1359`, `inter_v1.cpp:1397`, `draw_v2.cpp:888`, `game.cpp:707`, `hotspots.cpp:1965,1992`.

- **Attente active VAR(59)** (`inter_v1.cpp:1356-1361`, bug #3205) : dans `intro5.tot`, si `pos() == 729` et `VAR(59) < 4000`, force `VAR(59) = 4000`. L'intro attend activement qu'un compteur atteigne 5 000 (`handleBusyWait` ralentit l'attente). Dans **ce** `INTRO5.TOT` : `VAR59 = 0` @715, `repeatUntil` @722 { `keyFunc(1)` (argument lu à 727), `VAR59 = VAR59 + 1` @730 } jusqu'à `VAR59 > 5000` (@741). L'offset 729 de ScummVM ne correspond pas au 727 mesuré : **à vérifier** (convention de position ou version visée). Recommandé, plan D9 : appliquer la rustine **par motif** (TOT + boucle), pas par offset brut.
- **Bloc-notes `edit.tot`** : 287 variables, lit et écrit `BLOC.INF`. `o2_totSub("edit")` n'appelle pas `forceMouseUp` (`inter_v2.cpp:575-577`, course dans le script à l'ouverture du bloc-notes) : à reproduire, sans quoi l'ouverture peut fermer aussitôt.
- **Protection de copie : grille de couleurs, non contournée par ScummVM** (`inter_v1.cpp:719-737` ne saute la protection que pour Gob1, Gob2 et Adibou1, option `copy_protection`, `gob.cpp:143`). Dans `INTRO.TOT`, après `o2_totSub INTRO0` (@301) : `if(…) o1_callSub 348` (@339) puis `o1_loadTot MENU` (@343). La routine 348-1771 affiche une case (texte selon la langue, `switch` → `o1_printTotText` 0-4), saisie clavier, bip (`o1_speakerOn/Off` @1508 / @1516), échec → « WEEN error ! » (texte 5) puis `loadTot END` ; utilise `rand()` (2 motifs). Recommandé, plan D2 : **sauter `callSub 348`**, écart documenté ; le banc reçoit le même saut. **À valider** : que la routine ne positionne aucune variable lue plus tard.
- **TOT absent** : `o1_loadTot "END"` / `"DEMO"` visent des TOT inexistants : `Script::load` échoue → `_terminate = 2`, fin du jeu (`game.cpp:612-616`). Recommandé, plan D9 : « TOT absent » = fin propre, retour à l'accueil.

## 12. Découpage proposé

Recommandé, plan D1 : extraire le moteur Coktel de LiT vers un module partagé `src/engine/coktel/` (précédent : `src/engine/mohawk/`), **en deux temps** : (1) déplacement sans changement de comportement, LiT repassant sur le module avec ses tests inchangés ; (2) tables d'opcodes par version (v1 / v2 / v3) et crochets par jeu.

**Migrent vers `src/engine/coktel/`** (fichiers de `src/games/lost-in-time/`) :

| Zone | Fichiers |
| --- | --- |
| `data/` | `archive.ts`, `lzss.ts`, `tot.ts`, `ext.ts`, `imd.ts`, `font.ts`, `snd.ts`, `sprite.ts`, `palette.ts`, `surface.ts` (`lic.ts`, pistes du CD, reste dans Lost in Time) |
| interpréteur | `engine/interpreter.ts`, `opcodes.ts`, `script.ts`, `variables.ts`, `resources.ts`, `game.ts`, `hotspots.ts`, `input.ts`, `system.ts`, `host.ts` |
| graphismes | `engine/graphics/*` (`core`, `cursor`, `draw`, `index`, `palette`, `surface`, `text`) |
| mult, scenery, vidéo | `engine/mult/*`, `engine/video/*` |
| audio | `engine/audio/sound.ts`, `source.ts`, `backend.ts`, `prefs.ts`, `web-audio.ts`, `adlib/*` (pipeline OPL2 sur `src/audio/opl2.ts`) |
| rendu, interface | `render/canvas.ts` ; `ui/*` vers `src/ui/coktel/`, paramétré par jeu, toujours sur `src/ui/game-shell` (pas `point-click-app`), recommandé, plan D5, M3 |

**Crochets par jeu** (à introduire au temps 2) :
- table d'opcodes par version : v1, v2 (Ween), v3 (LiT) ; les trois surcharges v3 de § 2 deviennent la différence v2 → v3 ; table gob par version ;
- config d'écran : modes 320×200 / 640×400, `_maxDrawOrder`, liste `VIDEOS_WITH_CURSOR`, nom du jeu, wobble (dupliqués en dur dans LiT) ;
- rustines : contournement VAR(59), saut de la protection, opcodes gob inconnus, TOT absent ;
- hasard injecté (`scummvmRandom`) ; couche de sauvegarde (v2 ou v3) ; haut-parleur PC.

**Reste dans `src/games/lost-in-time/`** : `engine/parts.ts` (ITK / PARTIE), `engine/saves.ts` (SaveLoad_v3), CD audio (`audio/cd.ts`, `html-cd.ts`), contournements propres (Échap sur les vidéos, parties), `data/lic.ts`, `copy.ts`, `index.ts`.
**Nouveau dans `src/games/ween/`** : `SaveLoad_v2` (cat.inf / save.inf / bloc.inf), contournements Ween (§ 11), haut-parleur PC (peut aller dans le module partagé), enregistrement du jeu, `copy.ts` (français, textes directs), interface, extraction des données (`INTRO.STK` seul). Estimation du spécifique Ween : ~800-1 200 lignes hors partage, plus les tests.

## 13. Ce qui se teste sans navigateur, comparaison au banc

Sans navigateur (vitest headless, comme LiT, **ignorés sans `original/ween/`**) :
- désassemblage des 67 TOT (aucune anomalie hormis `INTRO1.TOT` @190), avec fixture d'opcodes comme `degob-ops` de LiT ;
- décodage des 264 entrées du STK (117 blocs LZSS), des 30 IMD, des 57 EXT, des 6 ADL (hachage sha1 de la sortie AdLib) et des 192 SND ;
- scénarios de sauvegarde v2 (index, emplacements, `bloc.inf`, `save.inf`) ;
- exécution headless de l'introduction et de `MENU` avec hachages crc32 de surfaces ; hasard par `scummvmRandom`.
**Comparaison au banc** : `scripts/ween/bench/` (patch `scummvm-ween-bench.patch`, `ween-replay.sh`, cible `ween-fr`, configuration `ween.ini.in` ; `README.md` pour tout refaire de zéro). Même démarche que pour LiT : mêmes séquences de touches, surfaces comparées à des captures du banc. Le banc reçoit le même **saut de protection** que le portage. À comparer en priorité : intro (`INTRO0`-`INTRO5`, attente VAR(59)), `MENU`, une salle à défilement vertical (`EMAJ1008`), une salle 640×200 (`EMAJ1010`), le bloc-notes, un cycle sauvegarde / chargement.

## 14. Points ouverts

1. Effet d'origine des opcodes gob 3 et 13 (inconnu, sautés par ScummVM) : à observer sur le banc, sans autre source.
2. Rustine VAR(59) : réglé (vague C, § 15) : reprise par motif dans le portage et au banc, identité vérifiée.
3. Protection : réglé (vague C, § 15) : deux appels sautés (`INTRO.TOT` @348, `INTRO5.TOT` @1023), VAR(210) = 1 et VAR(211) = 10 fixés comme au banc ; reste VAR(212).
4. Anomalie du bloc @190 d'`INTRO1.TOT` (fin 1 225 contre 1 237 attendus).
5. `.LET` contre `font.ts` ; structure des `.CAT` (`formats.md` § 15).
6. Comportement de `o2_totSub("edit")` sans `forceMouseUp` : reproduire à l'identique, à tester au banc.
7. Chemins v2 peu exercés par LiT (§ 2) : surfaces 640×200 et 320×465, `createSprite`, `playComposition`, bloc-notes : tests de non-régression à écrire avant le temps 2 du découpage.
8. Haut-parleur PC : onde carrée à implémenter et à calibrer sur le banc (bip de la protection sautée, `MENU`, `EMAJ1031`).
9. Sauvegardes d'origine du `CAT.INF` livré (12 432 octets par emplacement) : non importées ; décision D4 à valider.
10. `lic.ts` reste avec LiT (CD) ; `ui/*` migre vers `src/ui/coktel/` en vague J (plan D5, M3).

## 15. État de la vague C (démarrage)

**Définition** (`src/games/ween/engine/ween.ts`) : `WEEN` = interpréteur v2 (`opcodeTable(2)`), `INTRO.STK` / `INTRO.TOT` (valeurs par défaut de l'entrée `FR_FRA` de `tables_ween.h`), langue `fr` → `VAR(16) = 0`, sauvegardes `WeenSaves`, pas de CD. `WeenGame` ajoute `endedOn` (TOT absent qui a terminé le jeu) ; `createWeenSystem` assemble les sous-systèmes. Hasard : `scummvmRandom(1)` par défaut, la suite de `Common::RandomSource` avec `--random-seed=1` (graine lue par `generateNewSeed`, l'enregistreur d'événements n'est pas compilé au banc) ; l'identité des variables au banc pendant l'introduction (qui tire au hasard) le confirme.

**Crochets et écarts** :
- **Protection** (D2) : `beforeCallSub` saute `callSub 348` d'`INTRO.TOT` (introduction interrompue) et `callSub 1023` d'`INTRO5.TOT` (introduction regardée), reconnus par TOT et cible, et fixe `VAR(210) = 1`, `VAR(211) = 10`, exactement comme le correctif du banc (le générateur n'avance pas). `VAR(212)` reste à 0 (0 à 4 dans l'original, lue avant écriture dans `EMAJ1015/1016`) : risque résiduel noté au banc.
- **VAR(59)** (plan D9) : rustine de ScummVM (`inter_v1.cpp:1373-1380`, bogue #3205) **reprise et corrigée** : telle quelle elle teste la position 729 et ne se déclenche jamais sur cette version (keyFunc lu à 727) ; le crochet `onKeyFunc` (après `handleBusyWait`, au même point que ScummVM) la reconnaît aussi par motif (`intro5.tot`, `keyFunc(1)` suivi de l'affectation de VAR(59)) et passe VAR(59) à 4 000 : 1 000 tours au lieu de 5 000. Durée : 25 s virtuels au banc, **≈ 17 s à 60 Hz** dans le navigateur (une image par tour, test `boot.test.ts`) ; Échap l'interrompt. Le banc reçoit la même correction dans `inter_v1.cpp` (compilée : `WK 2550 intro5.tot 727 0`).
- **Opcodes gob 3 et 13** : sautés par la table v2 (U2) ; chemin « Quitter » identique au banc.
- **Archive absente** (`DISK2.STK`, `DISK3.STK`) : `o1_manageDataFile` ne fait rien (`DataFiles.openArchive` renvoie faux), comme `DataIO::openArchive`. **TOT absent** (`END`, `DEMO`) : le moteur commun termine (`terminate = 2`) ; `onMissingTot` note le TOT dans `endedOn` (retour à l'accueil en vague J).
- **Sauvegardes provisoires** (`src/games/ween/engine/saves.ts`) : la logique de SaveLoad_v2 (`cat.inf` / `cat.cat` : index de 15 × 40 octets et emplacements de la taille des variables ; `bloc.inf` : NotesHandler de 600 octets) en mémoire seulement ; `save.inf` (TempSpriteHandler) vu absent. Vague S : stockage du navigateur, format versionné, sprite temporaire.

**Alignement des images sur le banc.** Une image = `Host.markImage()`, appelé aux points de `BenchTrace::onFrame` : début de `FrameTimer.waitEndFrame` et de `handleBusyWait`, début de l'attente d'une image de vidéo, chaque tour de la boucle de `Hotspots.check`, de `waitMouseRelease` et de `waitEndPlay`. `HeadlessHost` les compte (`images`, `onImage`). Le temps virtuel du banc (`SKY_VIRTUAL_TIME`, avancé seulement par `delayMillis`) est reproduit par une **horloge exacte** facultative de l'hôte (`Host.delay`, `HeadlessHost({ exactTime: true })`) : le moteur y fait les attentes de ScummVM à la milliseconde (`FrameTimer.delay`, `longDelay`, `waitRetrace`, `advanceClock` pour les attentes faites dans du code synchrone) ; un hôte cadencé par images (navigateur, tests de Lost in Time) garde le comportement d'avant (au moins une image par attente, `waitRetrace` confondu avec l'image). Le banc démarre le jeu à 600 ms d'horloge virtuelle et sa souris reste en (0, 0) (`warpMouse` sans effet sous SDL sans fenêtre) : le harnais (`test/ween/engine/bench.ts`) fait de même.

**Corrections du moteur commun** (`src/engine/coktel/`, trouvées par la comparaison, Lost in Time inchangé : 312 tests verts) :
- attentes de ScummVM qui manquaient : `waitRetrace` de `Util::setScrollOffset` (fin d'`o2_initScreen`, `o2_setScrollOffset`), d'`Inter_v2::animPalette`, de `Draw_v2::animateCursor` (et `delay(5)` près du haut de l'écran), du début de `Hotspots::check` ; `longDelay` à la place de `sleep` pour `keyFunc` 0 et ≥ 20, `handleBusyWait`, le CD ; `blasterWaitEndPlay` par `longDelay(200)` ;
- `Hotspots::check` : le survol n'est traité avant la boucle que sans curseur (`Draw::_cursorIndex == -1`), et la mise à jour de l'affichage en tête de boucle n'a lieu que s'il y a à redessiner (`hotspots.cpp:800, 830-836`) ;
- souris dans la surface : `checkKeys` ajoute le défilement de l'écran (`Util::getMouseState`), visible dans `INTRO0` (VAR(2) suit le défilement) ;
- mixeur : sur l'horloge exacte, le canal SoundBlaster suit le mixeur de ScummVM à la trame près (44 100 Hz, pas de lecture tronqué, lecture par blocs de 512 trames du convertisseur, fondu compté en trames depuis la position de lecture) ; ailleurs, durées idéales comme avant.
- crochet `onLoadTot` (traces des tests).

**Identité au banc** (tests `test/ween/engine/boot.test.ts`, références `test/ween/fixtures/` : `TT`, `PS` et hachage des variables par image, date `VAR(5-11)` exclue car réelle au banc) : **identiques image par image** sur l'introduction regardée jusqu'à `EMAJ1000` (4 000 images, rustine VAR(59) à l'image 2 550, `TT EMAJ1000` à l'image 3 549), le chemin Échap → protection d'`intro.tot` → `MENU` → `EMAJ1000` (400 images), et le chemin « Quitter » de la disquette jusqu'à `END` absent (723 images). Les suites d'instructions et d'attentes (`OP`, `DL` du banc) sont elles aussi identiques sur les trois chemins. Désassemblage v2 des 67 TOT sans opcode inconnu (`disasm.test.ts`). Banc reconstruit le 15/11 (arbre `src/` recloné et repatché après sa perte) ; références de l'introduction régénérées avec la rustine corrigée.

**Banc** : trace `GOB_TRACE=3` (`DL n t ms tot pos`, chaque `Util::delay`) ajoutée au patch du banc (`scripts/ween/bench/scummvm-ween-bench.patch`) ; références refaites avec `GOB_DUMP` (hachage recalculé sans la date) par un lanceur à configuration privée (`scripts/ween/bench/ween-replay.sh` : des instances orphelines de ScummVM tournaient sur une configuration partagée).

## Sauvegardes (vague S)

`src/games/ween/engine/saves.ts` : `WeenSaves(gfx, store)`, SaveLoad_v2 sur le stockage du navigateur (`weenStorage()` : `localStorage`, préfixe `ween:`). Stockage absent, bloqué ou plein : lectures vues « absentes », écritures qui renvoient faux, aucune exception.

- **Format** : JSON versionné `{"v":1,…}`, octets en base64. Clés `cat.s00`…`cat.s14` (`varSize`, `desc` de 40 octets, `vars` de 15 540 octets : environ 21 Ko par emplacement) et `bloc` (`data` de 600 octets). Version inconnue, JSON invalide, base64 ou tailles incohérentes = fichier absent (l'emplacement n'apparaît pas dans l'index, la lecture échoue) ; une écriture ultérieure remplace la valeur.
- **`cat.inf` / `cat.cat`** (`GameHandler`) : offset 0 = index de 600 octets (taille exigée 600, reconstruit à chaque lecture : description des emplacements lisibles **avec la taille de variables courante** — `SavePartInfo::read` échoue sinon —, zéros ailleurs ; destination = n'importe quelle variable). Offset ≥ 600 : emplacement `(offset − 600) / varSize`, reste nul, variable 0 et taille `varSize` exigés (taille nulle = tout). L'écriture d'un emplacement exige l'index écrit juste avant (`_hasIndex`, consommé) et en tire la description. `getSize` = (dernier emplacement rempli + 1) × `varSize` + 600, -1 sans emplacement. Les divisions sont celles de C (offset entre 0 et 600 : reste négatif, refusé).
- **`bloc.inf`** (`NotesHandler(600)`) : persistant, `getSize` 600 ou -1. Écriture : `SavePartVars(600)` neuve, seul le segment `[offset, offset + taille)` renseigné, le fichier est réécrit en entier ; le reste n'est pas initialisé dans ScummVM, ici des zéros. Lecture : refusée si absent ou si `offset + taille > 600`.
- **`save.inf`** (`TempSpriteHandler` partagé) : **en mémoire seulement, comme ScummVM** (`MENU.TOT` et `EDIT.TOT` le citent), vu absent (-1, lecture refusée) tant qu'aucun sprite n'est écrit. Taille nulle = succès sans effet ; taille négative = sprite `-taille - 1` (au-delà de -1000 : avec la palette ; de -3000 : encore 1000 de plus) ; mêmes dimensions (largeur × hauteur) exigées à la relecture ; les sprites 20 (écran) et 21 (fond) sont réaffichés.
- **VAR(212)** : une sauvegarde enregistre toutes les variables (210-214 comprises) et le chargement les restitue telles quelles : la reprise ne réinitialise ni ne perturbe VAR(212) (valeur de la sauvegarde). Le risque résiduel reste celui d'une partie démarrée avec 212 à 0 après le saut de la protection (§ 11), pas un effet des sauvegardes.
- **Branchement** dans `ween.ts` (à faire) : `createSaves: ({ gfx, store }) => new WeenSaves(gfx, store)` ; l'interface passe `store: weenStorage()` à `createWeenSystem`. Tests : `test/ween/saves/` (gestionnaire sur variables factices ; aller-retour par le harnais jusqu'à `EMAJ1000`).
- **Code partagé** : le sprite temporaire (`TempSpriteHandler`, `SpritePart`, `SaveGraphics`) est dans `src/engine/coktel/saves/temp-sprite.ts`, le base64 et `slotKey` dans `src/engine/coktel/saves/encoding.ts` ; Lost in Time et Ween s'en servent (formats et clés inchangés). Tests : `test/coktel/temp-sprite.test.ts`.
