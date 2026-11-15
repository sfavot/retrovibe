# Cruise (Croisière pour un cadavre) : runtime du moteur ScummVM `cruise`

Source étudiée : ScummVM `engines/cruise/` (release 2026.4.0, commit 7d2709da), lu et non copié. Chemins relatifs à ce dossier.
Formats binaires non couverts (autre note), sauf quand ils expliquent un comportement.

## 0. Tailles (lignes, .cpp)

| Zone | Fichiers | Lignes |
|---|---|---|
| Boucle, entrées, relations/menus contextuels | cruise_main.cpp (2016), cruise.cpp (279), mouse.cpp (95), menu.cpp (344) | ~2 700 |
| VM de script | script.cpp (643), function.cpp (2019), stack.cpp (73), linker.cpp (269), overlay.cpp (680, dont ~350 de parsing) | ~3 700 |
| Objets / cellules / incrustations | object.cpp (336), cell.cpp (349), backgroundIncrust.cpp (355), background.cpp (230) | ~1 270 |
| Acteurs / chemins | actor.cpp (926), perso.cpp (247), ctp.cpp (332) | ~1 500 |
| Rendu | mainDraw.cpp (1575 : polygones ~900, sprites/masques/menus ~500), gfxModule.cpp (370), font.cpp (438), polys.cpp (267, quasi mort) | ~2 650 |
| Son | sound.cpp (879) | 879 |
| Sauvegarde | saveload.cpp (957) | 957 |
| Chargement données | dataLoader.cpp (544), volume.cpp (451), delphine-unpack.cpp (121) | ~1 100 |
| Hors runtime | decompiler.cpp (1385, `#ifdef DUMP_SCRIPT`), detection/metaengine (525), debugger (108), staticres (365) | — |

Total ~17 000 lignes .cpp + 2 500 .h. Le cœur à porter fidèlement ≈ 11 000 lignes.

## 1. Boucle principale

`CruiseEngine::mainLoop()` (cruise_main.cpp:1789). Tout est mono-thread sauf la musique (timer OPL, §5).

### Cadence
- Attente active : `do { … delayMillis(10); currentTick = getMillis(); } while (currentTick < _lastTick + _gameSpeed && !bFastMode)` puis `_lastTick = getMillis()` (cruise_main.cpp:1822-1872). `_lastTick` est pris après l'attente, avant le traitement : le traitement est donc inclus dans la période, qui vaut ≈ max(_gameSpeed, traitement) avec une granularité de 10 ms.
- `_gameSpeed = GAME_FRAME_DELAY_1 = 50` ms au boot (cruise.h:46, `initAllData` cruise_main.cpp:566), puis **une seule fois** passe à `GAME_FRAME_DELAY_2 = 100` ms dès que `canLoadGameStateCurrently()` (= `playerMenuEnabled != 0`, cruise.cpp) devient vrai, i.e. quand un script fait `Op_UserMenu(1)` (fin de l'intro) (cruise_main.cpp:1875). Ensuite `+`/`-` (kActionIncrease/DecreaseGameSpeed) ajustent de ±10 ms dans [20, 210] (cruise_main.cpp:1487).
- Mode rapide `Ctrl+F` (`bFastMode`) : plus d'attente du tout (cruise_main.cpp:1760, 1857-1868).
- Le jeu original avait sans doute des attentes VBL : `Op_VBL` stocke `vblLimit` jamais relu (function.cpp:976), `gfxModuleData_gfxWaitVSync()` est vide (gfxModule.cpp:194). Le rythme ScummVM est donc une approximation (cf. FIXME script.cpp:599 « game rates really need looking into »).
- Pour un port headless : un « frame » = un tour de la boucle externe ; le temps ne sert qu'à cadencer. Aucune logique ne lit l'horloge (vérifié : `getMillis` uniquement dans mainLoop et RNG seed).

### Entrées pendant l'attente
- Dans la boucle d'attente : survol → curseur (`findObject` à chaque mouvement si `userEnabled && !userWait && !autoTrack && currentActiveMenu == -1`) : type 9 (EXIT) → `CURSOR_EXIT`, autre objet nommé → loupe, rien → `CURSOR_WALK` (cruise_main.cpp:1823-1853). Pur visuel, pas d'effet d'état.
- `manageEvents()` (cruise_main.cpp:1711) dépile les événements et **s'arrête au premier événement non-mouvement** (`abortFlag`) ; `skipEvents` empêche de re-dépiler avant le frame suivant. Conséquence : au plus un changement de bouton par frame ; un clic down+up dans le même frame est vu comme bouton enfoncé pendant un frame. L'état souris est un niveau (`currentMouseButton`, bits 1=gauche 2=droit 4=milieu/Échap), pas une file.

### Ordre des opérations d'un frame (après l'attente)
1. Bascule 50→100 ms si besoin.
2. `isUserWait = userWait` ; WORKAROUND : si `userDelay`, `currentMouseButton = 0` (cruise_main.cpp:1892).
3. `processInput()` (cruise_main.cpp:1412) — voir §4. Peut ouvrir le menu joueur modal ou la pause (boucles imbriquées).
4. `enableUser` différé → `userEnabled = 1` ; `userDelay--` si pas `userWait`.
5. Si `userWait` vient de passer à faux : dégèle tous les scripts gelés 9999 (`changeScriptParamInList(-1,-1,&procHead,9999,0)` puis relHead) et efface le bouton (cruise_main.cpp:1909).
6. Scripts : `manageScripts(&relHead)` puis `manageScripts(&procHead)`, puis `removeFinishedScripts` des deux listes (cruise_main.cpp:1927). HACK : si l'écran 0 devient `S06B.PI1` pendant ce passage, 2 itérations supplémentaires (scène du livre/Raoul, FIXME cruise_main.cpp:1918-1937).
7. `processAnimation()` (actor.cpp:702) : déplacement des acteurs.
8. Si `displayOn` : `mainDraw(userWait)` puis `flipScreen()`. Si `userWait` → `continue` (saute 9). Sinon :
9. Auto-track : si `autoTrack` et le narrateur a fini (`isAnimFinished(narratorOvl, narratorIdx, …, ATP_MOUSE)`) → dégèle le message `autoMsg` (freeze 9998→0), `userWait = true` si texte non vide, dégèle les REL gelés 9998, `autoTrack = false`, `enableUser = 1` ; sinon `userEnabled = false`. Si pas d'autoTrack et `autoMsg != -1` → `removeCell(autoMsg)` (cruise_main.cpp:1975-1996).

### Rendu
`mainDraw(waitFl)` (mainDraw.cpp:1381) dessine dans `pPage10` : copie du fond `backgroundScreens[masterScreen]`, puis parcours de `cellHead` dans l'ordre de la liste pour les cellules `type == OBJ_TYPE_SPRITE (4)`, non gelées, du plan `masterScreen` ; puis toutes les cellules message (type 5) ; puis le menu actif ou le bandeau « objet:verbe » (`linkedMsgList`). **Effet de bord logique** : l'animation automatique des cellules (`Op_AutoCell`) avance pendant `mainDraw` si `!waitFl` (mainDraw.cpp:1465-1532) et réveille des scripts (freeze → 0) ; les nouvelles valeurs sont appliquées en fin de passe (`freeAutoCell`, mainDraw.cpp:55). `isMessage` (lu par `Op_MsgExist`) est recalculé ici. → ne pas séparer « draw » et « logique » dans le port.
`flipScreen()` (mainDraw.cpp:125) : applique `switchPal` (palette de `masterScreen`), échange `pPage00/pPage10`, copie vers `globalScreen`, puis si `doFade` lance `fadeIn()`.

### Fondus / palette
- `Op_FadeIn` arme seulement `doFade = 1` (function.cpp:703). Le fondu se fait au `flipScreen` suivant : `fadeIn()` (mainDraw.cpp:96) bloquant, 9 pas (offset −256…0 par 32) avec `updateScreen + delayMillis(20)` chacun (gfxModule.cpp:284) ≈ 180 ms, hors boucle de frames.
- `Op_FadeOut` (function.cpp:632) bloquant, 8 pas de −32 sur `workpal` avec `flipScreen` sans délai (instantané en pratique), puis écran noir, `fadeFlag = 1`, `PCFadeFlag = true`.
- `Op_SetColor` (function.cpp:1012) : décale `palScreen[masterScreen]` → `workpal` sur une plage avec ratio 36.57 (via `cvtPalette` si `CVTLoaded`), mais n'envoie que les entrées 0..31 au matériel (`setPalEntries(workpal, 0, 32)`).
- `Op_SetActiveBackground` → `switchPal = 1` (palette appliquée au flip). Couleur des messages = `findHighColor()` : index de la couleur la plus lumineuse de `workpal` (cruise_main.cpp:1224) — dépend de la palette courante.

## 2. VM de script

### Overlays et édition de liens
- `overlayTable[90]`, index ≥ 1 ; `numOfLoadedOverlay` ne fait que croître ; un nom libéré garde son index et le récupère au rechargement (`findOverlayByName`, overlay.cpp:671 ; `loadOverlay` overlay.cpp:120). Au premier chargement, l'overlay reçoit une tranche de `globalVars` : `state = stateID; stateID += nb objets MULTIPLE + THEME` (overlay.cpp:464).
- Boot : `initAllData()` charge `AUTO00` et attache sa procédure 0 (cruise_main.cpp:469-562). Tout le reste (TITRE, LOGO, XX2, S01…, FIN…) est chargé par script (`Op_LoadOverlay`, function.cpp:42).
- `Op_LoadOverlay` → `loadOverlay` puis `updateAllScriptsImports()` (linker.cpp:261) : **réécrit le bytecode en place** pour tous les overlays chargés (imports `OVL.SYMBOLE`, `:` = sous-fonction) en patchant octets type/overlay/index (linker.cpp:113-196), et résout les verbes/obj1/obj2 des en-têtes de relations (`arrayMsgRelHeader`) (linker.cpp:200-250). Une référence non résolue reste type&7 == 0 → l'opcode renvoie −10 et le script s'interrompt pour ce frame (script.cpp:69).
- `Op_FreeOverlay`/`Op_RemoveOverlay` → `freeOverlay` (overlay.cpp:51) : tue les scripts de l'overlay, libère tout ; les liens patchés dans les autres overlays restent pointés sur l'index (valides si rechargé au même index).
- `Op_FreezeOverlay` positionne `overlayTable[i].executeScripts` : si ≠ 0 les scripts de l'overlay ne tournent pas (script.cpp:632).

### Processus
- Deux listes chaînées : `procHead` (type 20 = PROC) et `relHead` (type 30 = REL, scripts de relations objet/verbe). Instance `scriptInstanceStruct` : overlay, scriptNumber (−1 = mort), scriptOffset (IP), `data` (BSS local, taille = `ovlData3Struct::sysKey`), `freeze`, `sysKey`, parent (`var18` ovl, `var16` n°, `var1A` type) (script.cpp:495).
- Ordonnancement : `manageScripts` parcourt la liste du début à la fin (tête comprise mais morte), exécute chaque script `scriptNumber != -1 && freeze == 0 && sysKey != 0`, puis met `sysKey = 1` (script.cpp:628). Un script ajouté pendant le parcours (en queue) peut donc tourner **dans le même frame**.
  - `Op_AddProc` (function.cpp:122) : `sysKey = 0` → saute le frame courant, démarre au suivant. Args copiés en BE dans le BSS.
  - `Op_Exec` (function.cpp:83) : type `MinusPROC` → `sysKey = 1` → démarre dans le même passage.
  - Relations : `attacheNewScriptToTail(&relHead, …, 30, …)` → `sysKey = 1`.
- Un script tourne jusqu'à un opcode qui renvoie ≠ 0 : yield (12), stop (10), ou code d'erreur négatif (−4, −7, −10, −21 : abandon silencieux du frame, IP déjà avancé) (script.cpp:591-621).
- Valeurs de `freeze` (convention) : 0 actif ; 9999 attente clic (`Op_UserWait`, function.cpp:1850) ; 9998 attente fin de marche auto (cruise_main.cpp:1146) ; 9997 parent gelé par un enfant (`Op_FreezeParent`/`Op_UnfreezeParent`, function.cpp:491/777) ; 9996 attente fin d'auto-anim (`Op_AutoCell` avec `type≠0`, function.cpp:902, réveil dans mainDraw.cpp:1482/1516). `changeScriptParamInList(ovl, n, list, oldFreeze, new)` (cruise_main.cpp:170) est l'unique primitive.
- `removeScript` (script.cpp:482) met juste `scriptNumber = -1` ; la purge a lieu après les deux `manageScripts`.

### Pile et adressage
- Pile globale unique `scriptStack[0x200]` d'unions typées short/pointeur (stack.cpp/stack.h), `positionInStack` remis à 0 à chaque `executeScripts` (script.cpp:589) : rien ne survit entre deux tranches. `popVar` sur pile vide renvoie 0 ; `assert` sur le type.
- Espaces mémoire (`scriptDataPtrTable`, script.cpp:584) : [1] BSS du processus, [2] chaînes du script, [5] BSS de l'overlay (`data4Ptr`), [6] `ptr8`. Avec un n° d'overlay ≠ 0 seul l'espace 5 d'un autre overlay est accessible. Taille d'accès : bits 3-4 du type (1 = mot BE, 2 = octet). Le type 5 ajoute un index (`saveOpcodeVar`, posé par STORE sous-type 4).
- Les pointeurs poussés (opcode 3) pointent dans ces blocs bruts ; `Op_Strcpy/Strcat/Itoa/BgName/ComputeLine` écrivent directement dedans sans borne (function.cpp:67, 1528, 1559, 1349, 1061).

### Opcodes (12 types)
Octet opcode : `index = (op & 0xFB) >> 3`, sous-type = `op & 7` (script.cpp:616-618). Table `setupFuncArray` (script.cpp:464) :

| # | Fonction | Rôle |
|---|---|---|
| 1 | opcodeType0 | LOAD : imm16 (st 0), variable mémoire (st 1/5), paramètre d'objet `getSingleObjectParam` (st 2) |
| 2 | opcodeType1 | STORE : (st 0 = pop sans effet), mémoire (1/5), `setObjectPosition` (2), `saveOpcodeVar` (4). Patch S26 ici |
| 3 | opcodeType2 | PUSH adresse (pointeur) |
| 4 | opcodeType3 | arith : + / − * % (sous-types 0-4), OR (5,7), AND (6) ; `/` et `%` par 0 → `error` |
| 5 | opcodeType4 | comparaison → 0/1 (≠ = < ≤ > ≥) |
| 6 | opcodeType5 | saut relatif conditionnel sur `ccr` (8 conditions) |
| 7 | opcodeType6 | `ccr` ← signe(pop) (bits 1=nul, 2=pos, 4=neg) |
| 8 | opcodeType7 | swap |
| 9 | opcodeType8 | appel de fonction native (function.cpp:2000), résultat poussé |
| 10 | opcodeType9 | fin de script (`scriptNumber = -1`) |
| 11 | opcodeType10 | nop (« break » qui continue) |
| 12 | opcodeType11 | yield jusqu'au frame suivant |

Attention aux bizarreries à reproduire : ordre `pop1 op pop2` (le sommet est l'opérande gauche pour `/ - %`, script.cpp:413) ; `opcodeType4` compare `var2 OP var1` ; condition 3 de saut = `ccr & 3`, 5 = `ccr & 5`.

### Table des fonctions natives
`opcodeTablePtr[]` (function.cpp:1866) : 126 entrées (0x00-0x7D), **121 implémentées**, 5 nulles (0x00, 0x0F debug, 0x12 exec debug, 0x55 MergeMsg, 0x69 DeletePreload ; appel → warning + push 0). Catégories :
- Overlays/procs (11) : LoadOverlay, FreeOverlay, FindOverlay, RemoveOverlay, FreezeOverlay, AddProc, Exec, RemoveProc, FindProc, FindSymbol, FindObject.
- Objets/cellules (≈20) : AddCell, RemoveCell, FreeCell, FreezeCell, AutoCell, LinkObjects, InitializeState, WriteObject, ReadObject, Sizeof, FrameExist, FindSet, LoadFrame, LoadAbs, RemoveFrame, AddBackgroundIncrust, RemoveBackgroundIncrust, UnmergeBackgroundIncrust, freeBackgroundInscrustList, regenerateBackgroundIncrust.
- Acteurs/marche/CT (≈18) : AddAnimation, RemoveAnimation, TrackAnim, EndAnim, FreezeAni, AniDir, Narrator, SetZoom, GetZoom, GetStep, LoadCt, FreeCT, CTOn, CTOff, SetObjectAtNode, GetNodeX/Y, SetNodeState, SetNodeColor, GetPixel, ComputeLine, XClick, YClick.
- Écran/palette (≈10) : FadeIn, FadeOut, LoadBackground, RemoveBackground, SetActiveBackground, BgName, ClearScreen, SetColor, SetStringColors, Display.
- Texte/UI (≈20) : AddMessage, RemoveMessage, MsgExist, UserWait, UserDelay, UserOn, UserMenu, UserClick, DialogOn, DialogOff, ThemeReset, SetXDial, Inventory, KillMenu, Menu, XMenuItem, YMenuItem, AutoControl, GetMouseX/Y/Button.
- Son (≈18) : PlayFX, LoopFX (= PlayFX, pas de boucle), StopFX, FreqFX (→ `startNote` « TODO »), LoadSong, PlaySong, StopSong, FadeSong, FreeSong, SongExist, SongSize, SetPattern, SongLoop, SongPlayed, SetVolume, RestoreSong, TrackPos.
- Divers : Random, Strcpy, Strcat, Itoa, comment, Sec, Protect, ProtectionFlag, Preload, FreePreload, GetlowMemory, VBL, SetFont, GetRingWord, FindMsg.
- Triviales/stubs (≈14) : GetlowMemory→0, GetRingWord→0, RestoreSong→0, TrackPos→0, FreePreload, Preload (pop), Protect (pop), VBL (stocke, inutilisé), SetFont (stocke, police unique `system.fnt`), MouseMove (pop), MouseEnd (toujours vrai, `automoveInc/Max` jamais modifiés), FindMsg (renvoie l'arg), comment (debug), FreqFX (warning). `Op_Sec` (function.cpp:983) : bascule bizarre sur `op7BVar`, à copier tel quel.

### Variables / état global des scripts
- `globalVars[2000]` int16 : états des objets MULTIPLE/THEME, par tranche d'overlay (object.cpp:77, 129, 192). Rien d'autre n'y est stocké (les « variables » de jeu sont dans les BSS d'overlay `data4Ptr` et les objets VARIABLE `arrayObjVar`).
- Objets (object.cpp) : classes `UNIQUE` (statique, setObjectPosition ignoré), `MULTIPLE`/`THEME` (état = globalVars, params lus dans `arrayStates[first+state]`), `VARIABLE` (copie mutable dans `arrayObjVar`, champs X,Y,Z,frame,scale,state). Paramètres 0..5 = X,Y,Z,frame,scale,state ; `getMultipleObjectParam` ajoute state2 et nbState. Modifier Z ou l'état appelle `sortCells` (réordonne la liste d'affichage, cell.cpp:274).
- États négatifs : état < −1 = objet dans l'inventaire / thème connu (cruise_main.cpp:809, 887) ; −2 sur un THEME = affiché en `subColor`, remis à 0 par `objectReset` (DialogOff/ThemeReset, object.cpp:296). Lecture `arrayStates[first + state]` avec state négatif : seul l'indice global < 0 est protégé (object.cpp:81) → lecture dans les états de l'objet précédent, à reproduire.

## 3. Objets, cellules, acteurs

### Liste des cellules (`cellHead`, cell.cpp)
- Double chaînage ; `addCell` insère **trié par Z** (param 2) avant le premier élément de Z ≥ (en ignorant les messages, arrêt sur type 3), refuse les doublons (cell.cpp:45). Messages (`createTextObject`) toujours en queue (cell.cpp:124). `sortCells` déplace toutes les cellules d'un objet après le dernier de Z inférieur (messages comptés Z = 32000).
- Types (cruise_main.h) : 0 LINE, 1 MASK, 2 BGMASK, 3 VIRTUAL, 4 SPRITE, 5 MESSAGE, 6 SOUND, 7 FONT, 8 POLY (ressource), 9 EXIT. La **cellule** de type 4 est dessinée selon le **type de ressource** du frame courant (`filesDatabase[frame]`) : sprite bitmap ou polygone vectoriel (mainDraw.cpp:1450).
- `followObject` (`Op_LinkObjects`, cell.cpp:241) : position et n° de frame relatifs à un autre objet (mainDraw.cpp:1424).
- `freeze` des cellules : masque l'affichage et le hit-test.
- Masques : chaque cellule BGMASK non gelée **située après** la cellule dans la liste (donc de Z supérieur) efface les pixels du sprite/polygone sous son masque (`drawMask` sur un buffer de bits, mainDraw.cpp:1118-1138, 1210-1230). C'est la gestion de profondeur décor/personnage.

### Polygones (« sprites » vectoriels)
Les personnages sont des modèles polygonaux 2D mis à l'échelle (`buildPolyModel`, mainDraw.cpp:717) : sommets en deltas, échelle fixe 16.16 (`upscaleValue`, mainDraw.cpp:193), demi-résolution si scale < 0x180, miroir si scale < 0, polygones ignorés si `minimumScale > scale` (LOD), remplissage par scanlines `XMIN_XMAX` (`buildSegment`, mainDraw.cpp:340) avec ou sans masque. `flipPoly` (mainDraw.cpp:157) : un frame commençant par 0 redirige vers un autre frame (offset relatif, hotspot) et inverse le miroir. Le hit-test souris refait le même calcul (`findPoly`, mainDraw.cpp:875). FIXME connu : indexation négative entre les 4 buffers, regroupés dans `bigPolyBuf` contigu (mainDraw.cpp:207-231) — à reproduire avec un seul tableau et des offsets.

### Incrustations de fond (backgroundIncrust.cpp)
`Op_AddBackgroundIncrust` dessine définitivement un objet (sprite ou poly) dans `backgroundScreens[n]`, avec sauvegarde du rectangle si `saveBuffer == 1` pour `removeBackgroundIncrust` / `unmerge` (backgroundIncrust.cpp:106, 286, 331). `regenerateBackgroundIncrust` rejoue toute la liste (après chargement).

### Acteurs et marche (actor.cpp, perso.cpp, ctp.cpp)
- `actorHead` : acteurs (overlay, idx, type ; type 0 = `ATP_MOUSE` = personnage piloté par la souris, type 1 = piloté par script). `Op_AddAnimation` (function.cpp:1208) crée, pose frame/zoom/poly initiaux.
- Zone de marche (.CTP, `initCt` ctp.cpp:210) : ≤ 20 nœuds de route + graphe (`ctp_routes`), ≤ 15 walkboxes polygonales rastérisées en tranches (`makeCtStruct` via `drawPolyMode2`) en deux versions : normale et élargie (`walkboxZoom*20`). `walkboxColor` = type (0 non marchable, 1 marchable, 2 sortie), `walkboxState` = activée. `getPixel(x,y)` (actor.cpp:73) → `numPoly`, `flag_obstacle`.
- Recherche de chemin `computePathfinding` (actor.cpp:557) : pas d'A*. Ligne droite testée par Bresenham (`polydroite`/`poly2`) ; sinon nœud le plus proche visible (`point_proche`, distance Chebyshev) aux deux bouts, puis **DFS exhaustive** sur le graphe gardant le plus court (`explore`, actor.cpp:363), puis élagage des points intermédiaires visibles. Si `flagCt == 0` (`Op_CTOff`), segment direct. ≤ 10 trajets simultanés (`persoTable`).
- Avancement par frame : `processActorWalk` (perso.cpp:170) suit la ligne Bresenham pré-calculée (`cor_droite`), pas = `(zoom * inc_jo) >> 8` (min 1) avec `inc_jo` = stepX horizontal / stepY vertical (ou stepX−stepY si |dx| > 30) (`direction`, perso.cpp:61). Zoom = interpolation linéaire en Y (`computeZoom`, function.cpp:1091, posé par `Op_SetZoom`).
- `processAnimation` (actor.cpp:702) : machine à états WAIT/STATIC (rotation sur place via `actor_stat`/`actor_invstat`)/MOVE (`actor_move`)/STATIC_END/END (`actor_end`), tables dans staticres.cpp. Les `case` tombent volontairement les uns dans les autres. `animationStart` (clic sol, `Op_XClick/YClick`) est consommé par le **premier** acteur traité.
- Bug ScummVM **reproduit** (D8, vague E) : `setNodeColor` (ctp.cpp:182) ne modifie la couleur que si `nodeColor == -1` (et la met à −1) ; sinon ne fait rien.

## 4. Interface et modèle d'interaction

Toute l'interaction est dans `processInput` (cruise_main.cpp:1412). Souris uniquement (plus F9/F10/Échap/P/X).

1. `sysKey` (clic synthétique `Op_UserClick`) remplace l'entrée réelle ; si `automaticMode` (Op_AutoControl) la souris est ignorée.
2. Les deux boutons ou F10 → **menu joueur** modal (`playerMenu`, menu.cpp:235) si `playerMenuEnabled && displayOn` : « Sauvegarder » (seulement si `userEnabled`), « Charger », « Recommencer », « Quitter » (textes `DELPHINE.LNG` ou staticres). Boucle propre `processMenu` (menu.cpp:172) avec `mainDraw(true)` (anims figées). Save/Load passent par les dialogues ScummVM.
3. `userWait` (message affiché) : clic gauche (ou action EndUserWaiting, non mappée) le termine ; tout le reste est ignoré.
4. Si `!userEnabled` : rien d'autre.
5. Mode dialogue (`Op_DialogOn(ovl,obj)`) : à chaque frame sans menu et bouton relâché, construit le menu « Parler de » (`createDialog`, cruise_main.cpp:860) avec les THEME d'état < −1 reliés à l'interlocuteur, à l'abscisse `xdial` (`Op_SetXDial`), y = 0. Clic gauche → `callRelation(entry, dialogueObj)`.
6. Hors dialogue, **clic gauche** :
   - sans menu : `findObject` (parcours de la liste des cellules de la fin vers le début, donc premier plan d'abord ; SPRITE/MASK/EXIT/VIRTUAL nommés non gelés ; masque bit ou polygone, VIRTUAL = rectangle) (cruise_main.cpp:632). Objet avec relations → **menu contextuel** à la souris (titre = nom de l'objet, entrées = verbes, `findRelation` cruise_main.cpp:964 ; relations à verbe vide lancées immédiatement). Objet sans relation ou rien → **marche** vers le point (`aniX/aniY`, `animationStart`).
   - avec menu ouvert : `callRelation(sélection, -1)` (cruise_main.cpp:1239) : relation sans 2e objet → exécution (REL = script, MSG = texte + changement d'états obj1/obj2) ; relation à 2e objet → `linkedRelation`, bandeau « Objet:Verbe » en haut (ou en bas si souris en haut) et curseur croix ; le clic suivant sur un objet (ou sur un objet de l'inventaire) appelle `callSubRelation` (cruise_main.cpp:1085). Clic hors entrée = fermeture.
   - Relation avec `trackX/Y` : le narrateur (`Op_Narrator`) marche d'abord vers le point (9999 = sa position, direction finale), utilisateur désactivé, script REL gelé 9998 / message gelé, libérés à l'arrivée (§1 étape 9).
7. **Clic droit** (ou F9) : ferme le menu objet (si pas de relation liée) puis ouvre l'**inventaire** = menu des objets d'état < −1 de tous les overlays (`buildInventory`, cruise_main.cpp:788). Clic gauche sur un item → menu de verbes de l'item à x+80 (`processInventory`).
8. Menus (menu.cpp, `drawMenu` mainDraw.cpp:1273) : colonnes de 160 px, hauteur de ligne = police, multi-colonnes si > (199−2h)/h entrées, max 49 entrées, recentrés dans l'écran ; survol = surbrillance (`updateMenuMouse`), sélection au clic (front montant via `buttonDown`). Couleurs `titleColor/itemColor/selectColor/subColor` (Op_SetStringColors).
9. Textes : police unique `system.fnt` (font.cpp:166), rendu en bitmap 1 = ombre noire / 2 = couleur (`drawMessage`, mainDraw.cpp:1144), `|` = saut de ligne, largeur de wrap passée (200 px pour les messages de relations, positionnés à (x−100, y−150) ou (x−100, y−40) de l'objet, clampés dans 320×198).
10. Pause `P` : boucle modale, message « Pause » ; `X` quitte.

Conséquences tactiles : 2 boutons + « les deux » ; tap = gauche, il faut un geste dédié pour inventaire (droit) et menu joueur ; les menus sont des listes texte positionnées à la souris (pas de verbes fixes à l'écran) ; pas de survol nécessaire au gameplay (curseur seulement informatif).

## 5. Son

- Uniquement AdLib/OPL : `AdLibSoundDriverADL` + `PCSoundFxPlayer` (sound.cpp:170-769). Pas de PCM : les bruitages (`Op_PlayFX/LoopFX`) jouent un instrument `.ADL` (fichier `.SPL` remplacé par `.ADL`, cruise_main.cpp:347) sur le canal 4 à la note 48 (`playSample`, sound.cpp:540). Vitesse/canal de PlayFX ignorés (`#if 0`).
- Musique : module 4 voies (15 instruments, ordres à l'octet 470, tempo 471, patterns à 2400, 1024 octets/pattern, 16 octets/ligne) ; boucle toujours sur les ordres (pas de fin naturelle). `_eventsDelay = (244 - tempo) * 100 / 1060` ticks.
- **Asynchrone** : piloté par le callback timer OPL à **50 Hz** (`_opl->start(..., 50)`, sound.cpp:315), indépendant des frames. `fadeOut` : +2 par ligne jusqu'à 100 puis `stop()`→`unload()`→`_songPlayed = true` dans le thread timer. `Op_SongPlayed`/`SongExist` lisent cet état → seul point où le son peut influer sur la logique (timing non déterministe vis-à-vis des frames). `load()` attend activement la fin d'un fondu en cours (sound.cpp:602).
- Volume : `adjustVolume` (×5/4, max 100, × volume ScummVM /128).
- Par rapport à `engines/cine/sound.cpp` : même famille de code dupliquée (classes `PCSoundDriver`, `AdLibSoundDriver`, `AdLibSoundDriverADL`, `PCSoundFxPlayer`, `setupInstrument` identique). Différences : cine timer 109 Hz et délai `(244 - t) * 109 * k / 1060` (cine/sound.cpp:305, 1083), données de patterns à 600 (FW) ou 2400 (OS) contre 2400 ici, arrêt à la fin du fondu dans `handleEvents` propre à cruise, pas de driver MIDI/INS. Un lecteur partagé paramétré (fréquence timer, offset patterns, formule de tempo) est réaliste.

## 6. Aléatoire et temps

- Unique usage : `Op_Random(n)` → 0 si n < 2, sinon `_rnd.getRandomNumber(n - 1)` (function.cpp:189-197). `_rnd("cruise")` construit une fois (cruise.cpp:44), **jamais ré-initialisé** (ni au Recommencer ni au chargement, non sauvegardé). Graine : `generateNewSeed()` = ConfMan `random_seed` si présent, sinon date+heure ×1000 + millis (common/random.cpp:42). Pour les traces : lancer ScummVM avec `--random-seed=N` et utiliser `scummvmRandom` avec la même graine ; compter les appels.
- Rien d'autre ne dépend du temps réel, sauf : la cadence (§1), le fondu musical (§5), et la granularité des entrées (un événement bouton par frame).

## 7. Sauvegarde

- Format ScummVM (`SVMCR`, en-tête + vignette, LE), pas le format d'origine (palettes 3 octets/entrée, saveload.cpp:90). Fichiers `cruise.sNN`. Pas d'autosave (seulement les slots standards ; `canSave` = `playerMenuEnabled && userEnabled`, cruise.cpp ; WORKAROUND : `DGF1.PI1` force `userEnabled = false` pour interdire la sauvegarde pendant la fin, background.cpp:92).
- Contenu (`DoSync`, saveload.cpp:611) : ~50 variables de base (souris, user, dialogue, couleurs, narrateur, zoom, `masterScreen`, `userWait`, `autoTrack`, `protectionCode`…), état musique (nom, ordre, position, playing), `newPal`/`workpal`, nom du CTP, table des fonds, palettes des écrans, `soundList`, `globalVars[0..stateID)`, `filesDatabase` (noms + index pour recharger), overlays (noms, BSS `data4`, `arrayObjVar`), preload, listes de scripts complètes (IP, BSS, freeze…), cellules, incrustations, acteurs, trajets (`persoTable`), walkboxes (couleur/état).
- Au chargement : `initVars()` puis rechargement des overlays par nom, re-link, rechargement des fichiers par plages, `initCt` sans écraser couleurs/états, `loadBackground`, `regenerateBackgroundIncrust`, `mainDraw(true)` (saveload.cpp:809). Un message (cellule type 5) présent → `assert(0)` (saveload.cpp:917) : impossible de charger une sauvegarde faite pendant un texte.
- Recommencer : `Op_FadeOut`, `initVars()`, `initAllData()` (menu.cpp:293) ; `_gameSpeed` revient à 50.

## 8. Bugs, hacks, protection, debugger

Hacks spécifiques au jeu :
- `script.cpp:205` patch « bar » : dans `S26.CTP`, STORE de position (mode 1, overlay courant) de la valeur 0x85 → 0x87.
- `script.cpp:601` crédits de fin trop lents : overlay **n° 71** à l'offset 1884 avec 1 élément sur la pile → remplacé par 50. Dépend de l'ordre de chargement des overlays (index), fragile.
- `cruise_main.cpp:1918` : +2 itérations de scripts quand le fond devient `S06B.PI1`.
- `cruise_main.cpp:1888` : `userDelay` efface le bouton (empêche un double clic de rouvrir un menu ; comportement différent de l'original).
- `background.cpp:92` : pas de sauvegarde après `DGF1.PI1`. `background.cpp:125` : `speedGame` pour `LOGO.PI1`, variable morte.
- `cell.cpp:182` : force le rafraîchissement de l'écran de protection (dirty rects).
- `#ifdef SKIP_INTRO` (script.cpp:592) : saute de l'offset 290 à 923 dans overlay 4 proc 0 (désactivé).
- Nombreux `assert(0)`/`error` sur chemins non implémentés : `mainProc14`, `cmdLine`, `linkedMsgList` libération, `loadFileSub1` avec preload, opcodeType0/2 sur autre overlay hors espace 5.
- TODO notables : `Op_FreqFX` (startNote), `Op_FreePreload`, dataLoader fuites, `saveload.cpp:671` « unfreeze anims ».

Protection de copie : overlay `XX2` (écran « OK ») géré entièrement par les scripts ; ScummVM ne le contourne pas (seul le TTS en tient compte, cruise_main.cpp:715, cell.cpp:171). Le commentaire indique que les versions DOS anglaise/russe le sautent automatiquement ; **la version française DOS l'affiche** → à jouer comme un écran normal (réponse via clics). `Op_Protect` est un stub (pop) et `Op_ProtectionFlag` lit/écrit `protectionCode` (sauvegardé).

Debugger (debugger.cpp) : seulement `hotspots` (liste des cellules cliquables avec nom, type, X,Y) et `items` (objets en inventaire). Canaux de debug : `scripts` (`debugC(5)` à chaque opcode : overlay/script/IP/opcode, script.cpp:610) et `sound`. `Op_comment` émet des `debug(1, "COMMENT: …")` venant du jeu. `decompiler.cpp` (DUMP_SCRIPT) donne un désassembleur de référence pour les tests.

## 9. Intro et fin

Entièrement scriptées : boot `AUTO00` proc 0 (cruise_main.cpp:469, 560) charge logos/titre (`LOGO.PI1`, `CFACSP02.SET` titre), protection `XX2`, puis le jeu. Pendant l'intro : 50 ms/frame, `playerMenuEnabled = 0` (pas de menu ni de sauvegarde), scripts lisant directement la souris (`Op_GetMouseButton`) pour passer. Fin : overlays `FIN*`, fond `DGF1.PI1`, incrustation `FIN14.SET` (« The End »), crédits avec le hack de délai. Aucun code C++ dédié hors TTS et hacks ci-dessus.

## 10. Pièges pour un port fidèle

- Bytecode auto-modifié par l'éditeur de liens, pointeurs bruts sur la pile vers BSS/chaînes, écritures de chaînes sans borne dans les BSS → modéliser chaque overlay comme des `Uint8Array` BE adressés par offset, et les pointeurs comme (bloc, offset).
- Big-endian partout dans les données (`READ_BE_UINT16`), y compris BSS des scripts et arguments passés à `AddProc`/`Exec`.
- Index d'overlay stables et croissants ; tranches `globalVars` allouées au premier chargement ; hack « overlay 71 ».
- Ordre exact des listes (cellules triées par Z avec règles d'insertion, scripts ajoutés en queue et exécutés dans le même passage selon `sysKey`, acteurs) : il détermine dessin, hit-test, et réveils.
- Logique dans le rendu (auto-anim, `isMessage`) et `mainDraw(true)` qui la fige pendant `userWait`/menus.
- État global partagé entre rendu de polygones, hit-test et rastérisation des walkboxes (`XMIN_XMAX`, `polyBuffer2`, `m_*`) ; indexation négative entre buffers (`bigPolyBuf`).
- Lecture d'états avec indice négatif (`arrayStates[first+state]`), `getObjectName` qui saute N chaînes sans borne.
- Mémoire non initialisée : `MemAlloc` (sans zéro) pour `persoStruct`, menus, acteurs (acteurs/cellules sont mis à zéro explicitement ; `persoStruct.inc_jo0` lu avant écriture mais écrasé avant usage, perso.cpp:174).
- Arithmétique int16 (`pushVar(int16)`), divisions C (troncature vers 0), `>>` arithmétique sur négatifs (zoom, `subOp23`).
- Musique asynchrone (50 Hz) : `SongPlayed` peut dépendre du temps réel.

## 11. Points d'accroche pour un banc de traces ScummVM

Patch de log par frame (numéro de frame = tour de `mainLoop`) :
1. Après `processInput` : souris (x, y, boutons), `userEnabled`, `userWait`, `autoTrack`, `currentActiveMenu`, `dialogueEnabled`, `linkedRelation != null`, `_gameSpeed`.
2. `executeScripts` : entrée/sortie (overlay nom+index, n°, type, IP début→fin, code de retour) ; option `debugC` existant pour l'IP par opcode.
3. `opcodeType8` : n° de fonction, résultat ; en particulier `Op_Random` (borne, résultat), `Op_LoadOverlay` (nom → index), `Op_AddProc/Exec`, `Op_UserWait`, `Op_AddMessage`, `Op_LoadBackground`, son.
4. Écritures d'état : `setObjectPosition`, `objInit`, `globalVars[i]` (diff par frame), STORE mémoire (bloc, offset, valeur).
5. Après scripts : listes proc/rel (ovl, n°, IP, freeze, sysKey), liste des cellules (ovl, idx, type, freeze, plan, Z).
6. Après `processAnimation` : acteurs (ovl, idx, type, x, y, phase, counter, pathId, startDirection, frame, zoom).
7. Dans `mainDraw` : changements d'auto-cellules appliqués (`freeAutoCell`), `isMessage`.
8. Après `flipScreen` : CRC de `pPage00` (320×200) et de `workpal`, `masterScreen`, `doFade`/fondus.
9. Musique : nom, ordre, position, `_songPlayed` (horodaté, car asynchrone).
Lancer avec `--random-seed`, entrées rejouées comme état souris par frame, mode rapide pour ne pas dépendre de l'horloge.

## 12. Contournement de la protection (D3, vague P, 14/11/2026)

Mécanisme du jeu, relevé au banc (trace niveau 2 et désassemblage) :
- `LOGO` proc 1 lance `XX2` proc 2.
- Celui-ci calcule, dans le BSS de `SUPER` (mot BE à l'offset 8), la somme de 864 mots de la table de `XX2`.
- Il appelle ensuite `ProtectionFlag(-1)` (offset 92) et compare le résultat à cette somme (offset 99).
- Si les deux sont égaux, `LOGO` saute le quiz et lance `SUPER` 4. Sinon, il lance le quiz `XX2` proc 0.

Contournement, identique dans le banc (`CRUISE_SKIP_PROTECTION=1`) et dans le portage :
- Il s'applique dans `Op_ProtectionFlag`, quand l'argument vaut −1 et que l'appelant est `XX2` proc 2.
- Il écrit le mot BE 1 aux offsets 4 et 6 du BSS de `SUPER` : `SUPER` proc 14 exige ces valeurs.
- Il pose `protectionCode` = mot BE à l'offset 8 (soit −29430), puis renvoie `protectionCode` comme d'habitude.

Comparaison avec le quiz réussi (bonne réponse injectée), au tick 4000 :
- Identiques : l'écran, `protectionCode` et le BSS.
- Différents : `globalVars[24]` contre `[26]`, et `SUPER.BSS[1130]`. La cause probable, non démontrée, est le flux de `Random` : le quiz tire environ 150 nombres de plus.
- Le quiz fait en plus `UserOn(0)` et `Display(0)`.
- `SUPER` 4 est lancé par `Exec`, au lieu d'`AddProc` dans le chemin du quiz.

Première pièce jouable : tick 3484, sans entrée.

## 13. Particularités de la marche reproduites (vagues E et F2, 14/11/2026)

- `setNodeColor` ne change la couleur que si elle vaut −1. `setNodeColor` et `setNodeState` bornent l'indice par le nombre de nœuds, et non par le nombre de zones.
- Seul `FreeCT` vide les listes de zones : deux `LoadCt` de suite mettent leurs zones bout à bout.
- Quand aucune zone ne contient le point, `getPixel` laisse `numPoly` sur la dernière zone parcourue.
- `distanceTable[20][10]` déborde sur la ligne suivante. Les trajets sont stockés à plat, selon la disposition de la structure de ScummVM, pour que les lectures hors limites tombent au même endroit.
- Les `case` de `processAnimation` s'enchaînent comme dans ScummVM, et le premier acteur traité consomme `animationStart`.
- Valeurs d'`AnimPhase` : WAIT 0, STATIC 1, MOVE 2, STATIC_END 3, END 4.
- Le dessin, le hit-test et les zones de marche partagent un seul état de polygones (`PolyRasterizer`) : le nombre de sommets d'une zone de marche influence le prochain polygone dessiné en miroir.

## 14. Sauvegardes du portage (vague S, 15/11/2026)

`src/games/croisiere/engine/save.ts` : `canSave`, `captureSave`, `restoreSave`, `describeSave`, `parseSave`, `SAVE_VERSION`. JSON versionné de 40 à 60 Ko, géré par `SaveSlots` avec le préfixe `croisiere:`.

**Contenu et reprise.** On sauve ce que sauve `saveload.cpp`. La reprise suit l'ordre de ScummVM :
1. `initVars` ;
2. overlays rechargés dans l'ordre de leurs index ;
3. fichiers rechargés par plages ;
4. `initCt` en mode sauvegarde ;
5. fonds rechargés.

Le RNG n'est pas sauvé (D5).

**Écarts voulus**, pour qu'une partie reprise soit identique à la partie ininterrompue :
- le bytecode, les liens et les données des overlays sont gardés en écarts par rapport au fichier relu, au lieu d'un nouveau passage de l'éditeur de liens ;
- les pixels des fonds sont gardés en écarts, au lieu de `regenerateBackgroundIncrust` ;
- les palettes, les pointeurs `prev` des cellules, les tables CTP et l'état de la recherche de chemin sont gardés tels quels ;
- polices et sons sont rechargés par leur fichier (ScummVM les perd) ;
- les messages à l'écran sont rendus de nouveau (ScummVM s'arrête sur une assertion).

**Perdu, comme dans ScummVM** : la relation « Objet:Verbe » en attente, les menus et la cadence.

**Refus** : `playerMenuEnabled && userEnabled` à faux (donc pendant l'intro), après `DGF1.PI1`, ou quand un menu d'objet ou l'inventaire est ouvert.

**Validation.** Six points de reprise (pièce au repos, en pleine marche, gros plan, message à l'écran, après la porte, Recommencer) donnent la même trace que le banc ininterrompu, lignes `FR`/`SC` comprises. La comparaison avec une sauvegarde de ScummVM n'a pas été faite : son dialogue demande l'interface graphique.
