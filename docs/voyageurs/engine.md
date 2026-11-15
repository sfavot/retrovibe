> Étude du 14/11/2026, par lecture de `engines/cine/` de ScummVM (GPL v3+). Numéros de ligne : arbre ScummVM du banc (`scummvm-build/src`). Rien n'est copié : référence de comportement à réécrire.

# Moteur `cine` (ScummVM) — Future Wars / Les Voyageurs du temps, PC CD Sony FR

Source étudiée (lecture seule, GPL) : `scummvm-build/src/engines/cine/`. Toutes les références sont `fichier:fonction` (+ ligne quand utile).
Convention : **FW** = Future Wars (à porter), **OS** = Operation Stealth (à ignorer).

> Rappel détection : la version « Sony CD FR » est la version Sony CD US + **patch de traduction française** (fan patch, ticket #12490) — `detection_tables.h:56-71`, flags `GF_CD | GF_CRYPTED_BOOT_PRC`, **pas** `GF_ALT_FONT` → table de police standard (`texte.cpp:initLanguage`, l.752-758).

---

## 1. Architecture

### 1.1 Démarrage
- `cine.cpp:CineEngine::run` : version CD FW → splash `sony.lbm` 640×480 2 s (`showSplashScreen`), puis 320×200 ; vérifie les pistes CD extraites ≥ 19 (`existExtractedCDAudioFiles(19)`, « tracks <19 are not used »). Driver son PC (`PCSound`). Boucle `initialize()` + `mainLoop(BOOT_SCRIPT_INDEX=1)` tant que restart.
- `cine.cpp:initialize` : 256 vars globales (+1), 255 objets, 255 slots anim, 16 zones ; `setupOpcodes()` ; `FWRenderer` ; `collisionPage` 320×200 ; `loadTextData("texte.dat")` (police) ; `loadPrc("AUTO00.PRC")`.
- `AUTO00.PRC` de la version Sony est **chiffré** : chaque octet tourné à droite de 1 → décodage `rolByte(b,1)` — `part.cpp:readFile` l.332-343, appelé par `prc.cpp:loadPrc` l.60-63 (lu hors bundle, fichier brut).

### 1.2 Boucle principale et timing — `main_loop.cpp:CineEngine::mainLoop`
Ordre d'une itération (= 1 « tick ») :
1. `executePlayerInput()` (`various.cpp`) : **attend `getTimerDelay()`** en lisant la souris (et met à jour la ligne de commande au survol) — `manageEvents(EXECUTE_PLAYER_INPUT, UNTIL_WAIT_ENDED)` si input autorisé, sinon `UNTIL_MOUSE_BUTTON_UP_AND_WAIT_ENDED`. Puis traite clic gauche/droit/les deux (cf. §4).
2. (OS seulement : `processSeqList`, raz `_zoneQuery`.)
3. `executeObjectScripts()` puis `executeGlobalScripts()` (`script_fw.cpp`).
4. Curseur : `MOUSE_CURSOR_CROSS` si une commande est en cours (`playerCommand != -1`), sinon normal.
5. `renderer->drawFrame(true)` (fond → overlays → ligne de commande → palette → menus → blit → fade-in éventuel).
6. `removeMessages()` : supprime les overlays type 2/3 (messages) **après les avoir dessinés une fois**.
7. Si `waitForPlayerClick` (un message a été dessiné) : **bloque jusqu'à clic** (`UNTIL_MOUSE_BUTTON_UP_DOWN_UP`). `_messageLen` est calculé (`<<=3`, min 800) mais **n'est utilisé nulle part** → pas de disparition automatique dans ScummVM (`main_loop.cpp` l.535-542 ; `gfx.cpp:renderOverlay` l.1184/1193).
8. Si `checkForPendingDataLoadSwitch` : `checkForPendingDataLoad()` (chargement différé PRC/REL/OBJ/MSG).
9. (Code mort : saisie « quit » via `menuVar`, jamais alimenté.)

Timing :
- `cine.cpp:getTimerDelay` = `10923000 * mult / 1193180` ms, `mult` = 12 par défaut (`setDefaultGameSpeed`) → **≈ 109,85 ms par tick ≈ 9,1 ticks/s**. Réglable 1..50 (`modifyGameSpeed`, touches +/-/KP0).
- Dans l'original l'attente était dans `drawFrame` ; ScummVM l'a déplacée dans `executePlayerInput` (commentaires `gfx.cpp:FWRenderer::drawFrame` l.1258-1265, `various.cpp:executePlayerInput` l.1219-1226).
- `manageEvents` découpe l'attente en « frames » de 20 ms (blit + `AudioCDManager::update()`), poll toutes les 10 ms (`main_loop.cpp:manageEvents`).
- **La vitesse du jeu (marche, anims) = nombre de `break` × tick.** Aucune autre horloge logique.
- Effets bloquants hors tick : `fadeToBlack`/`fadeFromBlack` = 8 pas × 42 ms (`gfx.cpp:fadeDelayMs`, l.1646-1656), joués de façon synchrone.

### 1.3 État global — `cine.h:CineEngine` (membres publics) + `various.cpp` (globals)
| État | Taille / type | Portée |
|---|---|---|
| `_objectTable` | 255 × `ObjectStruct {x,y,mask,frame,costume,name[20],part}` (`object.h`) | rechargé par OBJ, **sauf objets `costume == -2` (inventaire)** (`object.cpp:loadObject` l.66-68) |
| `_globalVars` | 255 int16 (+1 pour var 255) | global, persistant |
| `_scriptTable` | ≤50 `RawScript` (bytecode PRC) | par PRC (`prc.cpp:loadPrc` vide **aussi `_globalScripts`**) |
| `_relTable` | `RawObjectScript` (bytecode REL + p1,p2,p3 + runCount) | par REL (`rel.cpp:loadRel` vide aussi `_objectScripts`) |
| `_globalScripts` / `_objectScripts` | listes d'instances `FWScript` (pos, labels[50], localVars[50], compare, index) | dynamiques |
| `_messageTable` | chaînes MSG | par MSG |
| `_animDataTable` | 255 `AnimData` (sprites/masques/sons décodés) | libéré par `freePartRange` |
| `_overlayList` | liste ordonnée `overlay {objIdx,type,x,y,width,color}` | vidée au chargement d'un OBJ (`checkForPendingDataLoad`) ou `unloadAllMasks` |
| `_bgIncrustList` | `BGIncrust` (sprites « incrustés » dans le fond) | vidée par `loadBg` (FW) |
| `_zoneData` | 16 int16 (remap couleur CT → zone) | global |
| `_partBuffer` | index du bundle courant (`PartBuffer {name[14],offset,packed,unpacked}`) | par `loadPart` |
| `collisionPage` | 320×200, 4 bits/pixel (CT) | par `loadCt` |
| renderer | `_background`, `_backBuffer`, `_activePal`, `_backupPal`, `_cmd`, `_cmdY`(185), `_messageBg`(1) | — |
| input/UI | `allowPlayerInput`, `disableSystemMenu`, `playerCommand`, `commandVar1/2/3[]`, `_commandBuffer`, `inMenu` | — |
| noms courants | `currentPrcName/RelName/ObjectName/MsgName/CtName/PartName/DatName`, `new*Name` | sauvegardés |

Vars globales spéciales (`cine.h` enum) : 249 = `VAR_MOUSE_X_POS`, 250 = `VAR_MOUSE_Y_POS` (cible de marche), FW : 253 = `VAR_MOUSE_X_MODE`, 251 = `VAR_MOUSE_Y_MODE` (déplacement clavier). Var 255 = contrôle de la protection (cf. §9).

### 1.4 Ressources et chargement
- **Bundle** (`part.cpp:loadPart`) : fichier `PARTxx` = `u16 count, u16 entrySize(30)`, puis entrées `name[14], u32 offset, u32 packed, u32 unpacked, u32 unused` (BE). En DOS FW charge aussi `PARTxx.PAL` (`loadPal`) — **inutile** pour le rendu : `loadRelatedPalette` remplit `paletteBuffer1/2` jamais relus (`pal.cpp` l.32-33, 84-104).
- `part.cpp:readBundleFile` → `CineUnpacker::unpack` (LZ type « Delphine », lecture **à rebours**, CRC ; si packed == unpacked = copie) — `unpack.cpp:unpack` l.95-152.
- `findFileInBundle` (FW) : cherche uniquement dans le bundle courant (pas de `vol.cnf`, OS-only).
- Sons/musique FW lus dans `BASESON.SND` via `readBundleSoundFileFW` (swap temporaire de bundle) — `part.cpp` l.286-306.
- **PRC** (`prc.cpp:loadPrc`) : `u16 n` puis n × `u16 size`, puis bytecodes concaténés. Le nom `L201.ANI` = échec de protection → retour launcher (l.51-57).
- **REL** (`rel.cpp:loadRel`) : `u16 n`, n × `{u16 size, u16 p1 (verbe), u16 p2 (objet 1), u16 p3 (objet 2)}`, puis bytecodes.
- **OBJ** (`object.cpp:loadObject`) : `u16 n, u16 entrySize`, entrées `x,y,mask,frame,costume (s16), name[20], part (u16)`. Cas spécial `INTRO.OBJ` : costume des 10 premiers objets forcé à 0 (l.92-96).
- **MSG** (`msg.cpp:loadMsg`) : `u16 n`, n × `u16 len`, puis chaînes NUL-terminées concaténées.
- **Fond PI1** (`bg.cpp:loadBg` → `gfx.cpp:FWRenderer::loadBg16`) : `u16 bpp`, palette 16 × u16 BE (format `0RGB` 3 bits/canal), puis 320×200 en plans entrelacés Atari ST (`gfxConvertSpriteToRaw`, l.2768-2793).
- **CT** (`bg.cpp:loadCtFW`) : fichier `.NEO`, image 4 bpp à l'offset 0x80 → `collisionPage`.
- **Ressources anim** (`anim.cpp:loadResource`, l.862-919) : `.ANI/.ANM` (sprite 4 bpp + masque généré par couleur transparente, table `transparencyData` l.59-191 + cas `L2202`/`L4601` l.694-699), `.MSK` (masque 1 bpp), `.SET` (planches multi-format), `.SPL/.AMI/.HP/.ADL` (données son brutes), `.SEQ`. Nom contenant `ECHEC` → quitte le jeu (l.912-913).
  - Slot = **premier slot libre** (`emptyAnimSpace`) quand appelé par `o1_loadAnim` → l'ordre de chargement détermine les numéros de frame utilisés par les scripts. Critique pour la fidélité.
  - Header ANI 0x16 octets (`loadAnimHeader`) : frameWidth (en mots de 16 px/4… largeur réelle = w×2), frameHeight, numFrames…
- **Chargement différé** : `o1_loadNewPrcName(type,name)` écrit `newPrcName/newRelName/newObjectName/newMsgName`, puis `o1_requestCheckPendingDataLoad` → fin de tick `various.cpp:checkForPendingDataLoad` (l.1482-1524) : PRC (vide les scripts globaux puis lance le script 1 du nouveau PRC), REL (vide scripts objets), OBJ (**vide l'overlay list**), MSG.
- Par-scène vs global : PRC/REL/MSG/OBJ/CT/fond/anim = par scène ; vars globales, objets inventaire (costume −2), zoneData, palette = persistants.

---

## 2. VM de scripts

### 2.1 Format bytecode — `script.h`, `script_fw.cpp`
- Un octet d'opcode, **décalé de 1** : l'octet `N` exécute l'entrée `N-1` de la table (`FWScriptInfo::opcodeHandler` l.754-765). Octet 0 et entrées nulles = no-op (warning). Les numéros ci-dessous sont ceux de la table ScummVM (= octet − 1).
- Signatures d'arguments : `b` octet, `w` mot **big-endian**, `c` = octet type puis (type≠0 ? octet index : mot immédiat), `s` chaîne C, `l` label (octet), `x` fin de script.
- Variables : 50 locales int16 par instance, 255 globales int16 ; arithmétique int16 avec débordement (mul ScummVM signée, original non signé — FIXME `o1_mulObjectParam` l.872).
- Labels : 50 par script. Pré-calculés au chargement (`RawScript::computeLabels`) **en s'arrêtant au premier `endScript`** (`getNextLabel` retourne sur `x`), et redéfinis à l'exécution par `o1_label`. Les sauts utilisent `_labels[]` de l'instance (copié depuis le pré-calcul).
- Comparaison : registre `_compare` = bits `EQ=1, GT=2, LT=4` (`cine.h`).
- Exécution (`FWScript::execute` l.702-718) : boucle d'opcodes jusqu'à retour ≠0 ; `break` → 1 (pause jusqu'au tick suivant), `endScript` → −1 (supprimé).
- Paramètres objet (`object.cpp:getObjectParam`) : 1=x, 2=y, 3=mask (= **priorité/z**), 4=frame, 5=costume (FW : position/animation, −2 = inventaire ; écrire −1 copie `globalVars[0]`, `modifyObjectParam` l.259), 6=part (couleur de transparence/hauteur…).

### 2.2 Table des opcodes FW — **78 opcodes définis** (table 0x00..0x7B, 46 trous) — `FWScript::setupTable` l.45-206
| op | nom | args | sémantique |
|---|---|---|---|
| 00 | modifyObjectParam | bbw | obj[o].param[p] = imm (param 3 → re-tri overlay) |
| 01 | getObjectParam | bbb | local[v] = obj[o].param[p] |
| 02 | addObjectParam | bbw | += imm |
| 03 | subObjectParam | bbw | −= imm |
| 04 | mulObjectParam | bbw | ×= imm |
| 05 | divObjectParam | bbw | /= imm (signé) |
| 06 | compareObjectParam | bbw | compare(obj.param, imm) |
| 07 | setupObject | bwwww | x,y,mask,frame ; si overlay type 0 existe, le ré-insère trié (`object.cpp:setupObject`) |
| 08 | checkCollision | bwwww | obj, dx, dy, largeur, zone → compare=1(EQ) si un pixel CT de la ligne (x+dx..+largeur, y+dy) a `zoneData[c]==zone` (`checkCollisionFW` l.2052-2065) |
| 09 | loadVar | bc | local = imm / local / global / mouseX(3) / mouseY(4) / **rand(5)** / packedSize(8) / unpackedSize(9) |
| 0A–0D | add/sub/mul/divVar | bc | local op= imm/local/global |
| 0E | compareVar | bc | compare(local, imm/local/global) |
| 0F | modifyObjectParam2 | bbb | obj.param = local[v] |
| 13 | loadMask0 | b | addOverlay(obj, type 0 = sprite) |
| 14 | unloadMask0 | b | removeOverlay type 0 |
| 15 | addToBgList | b | incruste le sprite de l'objet dans le fond (persistant jusqu'au loadBg) |
| 16 | loadMask1 | b | overlay type 1 (zone cliquable par masque, non dessiné en FW) |
| 17 | unloadMask1 | b | |
| 18 | loadMask4 | b | overlay type 4 (masque rempli couleur 0) |
| 19 | unloadMask4 | b | |
| 1A | addSpriteFilledToBgList | b | incruste masque rempli dans le fond |
| 1B | clearBgIncrustList | — | vide la liste d'incrustations (pas le fond déjà dessiné) |
| 1D | label | l | labels[i] = pos |
| 1E | goto | b | saut |
| 1F–24 | gotoIfSup/SupEqu/Inf/InfEqu/Equ/Diff | b | saut conditionnel sur `_compare` |
| 25 | removeLabel | b | labels[i] = −1 |
| 26 | loop | bb | --local[v] ; si ≥0 saut |
| 31 | startGlobalScript | b | ajoute une instance du script PRC n (fin de liste → s'exécute **dans le même tick**) |
| 32 | endGlobalScript | b | marque toutes les instances d'index n (index = −1, supprimées à leur prochain passage) |
| 3B | loadAnim | s | `loadResource` dans le premier slot libre |
| 3C | loadBg | s | charge le fond, **vide les incrustations**, CD : `setBgMusic(atoi(nom+1))` |
| 3D | loadCt | s | charge la carte de collision |
| 3F | loadPart | s | ouvre le bundle |
| 40 | closePart | — | no-op |
| 41 | loadNewPrcName | bs | programme un chargement différé (0 PRC, 1 REL, 2 OBJ, 3 MSG) |
| 42 | requestCheckPendingDataLoad | — | déclenche les chargements en fin de tick |
| 45 | blitAndFade | — | demande un fade-in au prochain `drawFrame` (+ hack palette noire) |
| 46 | fadeToBlack | — | fondu au noir **bloquant** |
| 47 | transformPaletteRange | bbwww | active[i] = clip(backup[i] + (r,g,b)) pour i∈[a,b] (unités 0..7) |
| 49 | setDefaultMenuBgColor | b | couleur de fond des menus |
| 4A | palRotate | bbb | mode 1 rotation droite, 2 gauche, sinon restaure backup |
| 4F | **break** | — | **yield** jusqu'au tick suivant |
| 50 | endScript | x | fin |
| 51 | message | bwwww | affiche MSG[idx] à (x,y,largeur,couleur) → attente clic en fin de tick |
| 52 | loadGlobalVar | bc | global = imm/local/global |
| 53 | compareGlobalVar | bc | compare(global, …) — **hack var 255** |
| 59 | declareFunctionName | s | commentaire (no-op) |
| 5A | freePartRange | bb | libère slots anim [start, start+n) |
| 5B | unloadAllMasks | — | vide l'overlay list |
| 63 | setScreenDimensions | wwww | stub |
| 64 | displayBackground | — | stub |
| 65 | initializeZoneData | — | zoneData[i] = i |
| 66 | setZoneDataEntry | bw | zoneData[i] = v |
| 67 | getZoneDataEntry | bb | local = zoneData[i] |
| 68 | setPlayerCommandPosY | b | y de la ligne de commande |
| 69 | allowPlayerInput | — | active l'interaction |
| 6A | disallowPlayerInput | — | cinématique |
| 6B | changeDataDisk | b | no-op (mémorise le disque) |
| 6D | loadMusic | s | CD : mappe le nom → piste ; sinon module AdLib |
| 6E | playMusic | — | |
| 6F | fadeOutMusic | — | |
| 70 | stopSample | — | en fait `stopMusic` |
| 71 | op71 | bw | no-op sur PC (Amiga) |
| 72/73 | op72/op73 | wbw | no-op sur PC |
| 77 | playSample | bbwbww | anim, canal, freq, repeat, volume, size : DOS → size 0xFFFF = jouer, sinon stop canal |
| 78 | playSampleSwapped | bbwbww | DOS = playSample |
| 79 | disableSystemMenu | b | bloque menus (et dessin ligne de commande) |
| 7A | loadMask5 | b | overlay type 5 (occulteur des sprites dessinés avant) |
| 7B | unloadMask5 | b | |

OS seulement (à ignorer) : `script_os.cpp` (≈34 `o2_*` : seqList, multi-fonds, scroll, `loadAbs`, `gotoIf*Nearest`, `startObjectScript`, `op8D`…).

Opcodes délicats :
- **Attente** : seul `break` suspend un script. Les « waits » sont des boucles `loop` + `break`. `message` bloque *tout* le moteur jusqu'au clic (fin de tick). `fadeToBlack` bloque en plein milieu du script.
- **Entrée** : `loadVar` 3/4 lit la position souris *courante* ; la cible de marche arrive via globals 249/250.
- **Aléa** : `loadVar` type 5 (`getRandomNumber(n-1)` → 0..n−1 ; n=0 → débordement, cas à gérer).
- **Sons/CD** : 6D–70, 77/78, 3C (effet de bord musique de fond).
- **Changement de fond/scène** : 3C/3D/3F + 41/42 (différé), 5A, 5B.
- **Sorties du script courant** : un script qui fait `loadNewPrcName+request` continue jusqu'à son `break` ; le remplacement a lieu en fin de tick.

### 2.3 Ordonnancement
- Global : instances créées depuis `_scriptTable[idx]` (`addScriptToGlobalScripts` l.2010-2014) ; boot = script 1 de AUTO00 ; chaque nouveau PRC lance son script 1.
- Objet : créées sur action joueur depuis `_relTable[idx]` (`various.cpp:runObjectScript` l.177-181) ; **local[0] = nombre d'exécutions précédentes** de cette entrée REL (`FWScript` ctor objet l.629-635, `RawObjectScript::run`).
- Par tick : tous les scripts objets puis tous les globaux, dans l'ordre de liste ; une instance tourne jusqu'à `break`/`end` ; index <0 → supprimée (`executeObjectScripts`/`executeGlobalScripts` l.2122-2144). `purge*Scripts` vides (no-op).
- Plusieurs instances du même script possibles.

### 2.4 Correspondance avec un moteur à générateurs
- Recommandation : **ne pas faire un générateur JS par script**. L'état d'un script doit être sérialisable (pos, labels, locals, compare, index — c'est exactement ce que sauve `FWScript::save` l.724-731) ; un générateur JS ne l'est pas. Implémenter un interpréteur à état explicite `step(script): 'break'|'end'` (boucle d'opcodes).
- Les générateurs servent au niveau moteur : `function* mainLoop()` = un tick par `yield` ; sous-séquences bloquantes `yield* waitTicks(…)`, `yield* fadeToBlack()` (8 × 42 ms), `yield* waitClick()` (messages), `yield* menuChoice(…)`. Comme `fadeToBlack` est synchrone *au milieu* d'un opcode, faire retourner à l'opcode un « effet bloquant » que la boucle principale consomme avant de reprendre le même script (sans exécuter d'autres scripts entretemps).
- Préserver l'ordre : objets puis globaux, ajouts en fin de liste exécutés dans le même tick.

---

## 3. Rendu — `gfx.cpp:FWRenderer`
- 320×200, 16 couleurs (palette 9 bits `0RGB`, 3 bits/canal ; conversion 8 bits = c×255/7 — `pal.cpp:Palette::save`). Format `kLowPalFormat` (`gfx.cpp` l.46-52).
- Deux palettes : `_backupPal` (celle du fond chargé) et `_activePal` (affichée). `transformPalette` = active = backup + delta (saturé) ; `rotatePalette` ; fades sur active (pas de 1/7 de gris, `saturatedAddNormalizedGray`).
- `drawFrame` (l.1250-1288) : `memcpy(back, background)` → `drawOverlays` dans l'ordre de liste → ligne de commande (si `_cmd` non vide) → palette si `_changePal` → menus empilés → blit → `fadeFromBlack` si demandé.
- **Calques** :
  - Fond `_background` (+ incrustations dessinées dedans au moment de `addToBgList` / `addSpriteFilledToBgList` : `incrustSprite` l.626-673, `incrustMask` l.581-592). Attention : l'incrustation lit x/y/frame **actuels** de l'objet, pas ceux stockés dans `BGIncrust`.
  - Overlays (`renderOverlay` l.1070-1220) : type 0 = sprite masqué (masque = transparence générée), **remasqué par les overlays type 5 situés plus loin dans la liste** (`remaskSprite` l.1027-1050, `gfxUpdateSpriteMask` l.2628-2663) ; type 1 = non dessiné (masque de clic) ; type 2 = message script ; type 3 = message d'échec ; type 4 = masque rempli couleur 0 (`fillSprite`) ; type 5 = occulteur. frame < 0 → non dessiné.
  - Priorité : `addOverlay` insère avant le premier overlay dont l'objet a `mask ≥` → liste triée par `mask` croissant, dessinée dans l'ordre (`object.cpp:addOverlay` l.126-160). Modifier `mask` (param 3) ou `setupObject` ré-insère.
  - Masques de collision « CT » : séparés, jamais affichés (debug F11 `showCollisionPage`).
- Transparence : couleur clé par fichier ANI (`anim.cpp:transparencyData`, défaut 0) ; police : couleur 0.
- Boîtes de texte : `drawMessage` (l.745-822) : fond uni `color`, bordure double (couleur 2 + noir), texte justifié, interligne 9, espace 5 px, `|` = retour forcé, largeur des glyphes par `fontParamTable` (glyphes 16×8, 4 bpp — `texte.cpp:loadTextData`). Message hors écran remonté (fix #11708).
- Ligne de commande : boîte 301×11 à (10, `_cmdY`=185), fond 0, bord 2 (`drawCommand` l.678-696), masquée si `disableSystemMenu`.
- Menus : `SelectionMenu` (fond `_messageBg`, lignes de 9 px, sélection en fond 0 ; `gfx.cpp:SelectionMenu::drawMenu`).
- Fades : `fadeToBlack` 8 pas, efface le backbuffer ; `fadeFromBlack` depuis `_backupPal` ; hack anti double-fade 1 s (l.1673-1680).
- Option ScummVM « transparentdialogboxes » (look Amiga) : ignorable.
- Curseurs : 3 curseurs 16×16 monochromes codés en dur (normal, disquette, croix) avec hotspots (1,1)/(0,0)/(7,7) — `gfx.cpp` l.63-94, `setMouseCursor` l.2565-2590.

---

## 4. Interaction joueur — `various.cpp`
- **Clic droit** (input autorisé) → menu verbes à la souris, largeur 70 (`makeActionMenu` l.1010-1037) : EXAMINER, PRENDRE, INVENTAIRE, UTILISER, ACTIONNER, PARLER (`texte.cpp` l.373-381). Puis `makeFWCommandLine` (l.764-819).
- **Deux boutons** (ou bouton milieu) → menu système (`makeSystemMenu` l.392-557) : Pause, Nouvelle partie, Quitter, « Lecteur de Svg. A: » (no-op), Charger, Sauver ; confirmation « Ok , Vas-y ... / Surtout Pas ! ». Sauver absent si input interdit. Bloqué si `disableSystemMenu == 1`.
- Verbes : nombre d'objets requis `choiceResultTable = {1,1,1,2,1,1,1}` (l.133). UTILISER : popup inventaire d'abord (objets `costume == -2`, `selectSubObject(-2)` largeur 140) puis clic sur la scène ; préposition « sur ». INVENTAIRE : simple liste, attente clic, aucune action (`processInventory` l.571-610).
- Clic gauche avec verbe (`playerCommandMouseLeft` l.1050-1109) : objet sous curseur ajouté ; quand complet → `getRelEntryForObject(verbe, n, obj)` (l.197-217) : premier REL avec p1=verbe, p2=obj1 (et p3=obj2 si 2 objets) → `runObjectScript`, sinon message d'échec type 3 (4 variantes par verbe, choix **aléatoire** — `renderOverlay` l.1190-1199, textes FR `texte.cpp` l.304-335). Clic dans le vide avec verbe → met à jour la cible de marche (249/250).
- Clic gauche sans verbe (`noPlayerCommandMouseLeft` l.1141-1197) : globals 249/250 = position (x=0 forcé à 1), et si objet sous curseur avec un REL verbe **6** → lancé.
- Survol avec verbe : ligne de commande « VERBE objet » mise à jour en continu pendant l'attente du tick (`playerCommandMouseLeftRightUp` l.1111-1139, `manageEvents` l.305-317).
- Objet sous curseur (`getObjectUnderCursor` l.225-293) : overlays parcourus du dessus vers le dessous, types 0/1 seulement, objets nommés ; test boîte puis pixel du masque (type 0 : masque de transparence ; type 1 : bitmap du masque). Quirk : `ydif <= 0` exclu (ligne du haut non cliquable), largeur via `_var1<<4`.
- Messages : `o1_message` → affichage jusqu'au clic (pas de timeout dans ScummVM). `drawString` (y=80/20/140) pour pause/sauvegarde.
- Clavier (keymap `metaengine.cpp` l.277-420) : F1–F6 verbes, F9 menu verbes, F10 menu système, F11 page collision, pavé numérique déplacement, Entrée/KP5 = clic gauche, Échap = clic droit, +/−/KP0 vitesse, molette = sélection menu.
- Menus (`makeMenuChoice` l.826-1008) : bloquants, sélection au survol, validation au clic ; clic droit = −1 (FW).
- Pause : `otherMessages[2]` « PAUSE », attente clic.

## 5. Déplacement
- **Pas de pathfinding moteur en FW.** La marche est entièrement scriptée : les scripts globaux de déplacement lisent la cible (globals 249/250), avancent l'objet héros (objet 1) pas à pas avec `checkCollision` contre les zones de la page CT (via `zoneData`), changent `frame`, et font `break` entre deux pas (cf. commentaire `o1_break` l.1519-1540 : scripts 36/37 de PART02 = marche horizontale/verticale).
- `seqList`/`addAni`/`processSeqListElement` (marche « moteur ») = **OS seulement** (`mainLoop` n'appelle `processSeqList` que pour OS).
- Clavier FW (`executePlayerInput` l.1313-1368) : calcule une cible fictive (bords d'écran 1/320, 1/200) avec décalages selon `VAR_MOUSE_X_MODE`/`Y_MODE` (x+12/x+7, y+34/y+28). ScummVM note que c'est peu fiable (FIXME l.145).
- Collision hors écran → 0 (fix #4581, `getZoneFromPositionRaw` l.2029-2050) ; l'original lisait hors buffer.

## 6. Aléatoire
- `Common::RandomSource _rnd("cine")` (`cine.cpp` ctor l.184), graine système, non déterministe. Utilisations FW : `o1_loadVar` type 5 (`script_fw.cpp` l.958-961) et choix du message d'échec (`gfx.cpp:renderOverlay` l.1191). `getRandomNumber(max)` est inclusif. Pour nos tests : RNG injectable/seedé.

## 7. Son et musique
- DOS : `PCSound` ; sans MT-32 → `AdLibSoundDriverINS` (FW) — OPL2, timer 109 Hz (`sound.cpp:AdLibSoundDriver` ctor l.294-306). Pas de haut-parleur PC dans ScummVM pour FW.
- **Musique CD (notre version)** : `loadMusic(nom)` ne charge rien, mappe le nom vers une piste (`musicFileNames`/`musicCDTracks` l.1230-1246 : DUGGER 20, SUITE21 21, FWARS 22, SUITE23 23, SUITE22 24, ESCAL 25, MOINES 26, MEDIAVAL 27, SFUTUR 28, ALIENS 30, TELESONG 22) ; `playMusic` joue `piste−1` en boucle infinie (`AudioCDManager::play(track-1, -1, …)`). Donc fichiers `track19..track29` (présents dans les données : track1–29).
- **Musique d'ambiance par fond** (`setBgMusic`, l.1275-1294) : à chaque `loadBg("Lnn.PI1")`, slot = `atoi(nom+1)` ; table `bgCDTracks[49]` (L1/L2→21, L3→23, L5→29, L11→27, L33/L34→22, L35→23). Rejouée si slot 1 (toujours relancée !) ou si aucune musique de script en cours et piste différente. Pas de borne sur l'index (slot ≥ 49 = débordement).
- `stopMusic` n'arrête pas le CD si slot 1 ; `fadeOutMusic` revient à la musique de fond mais joue **`_currentBgSlot − 1` au lieu de `bgCDTracks[slot] − 1`** (`sound.cpp` l.1317-1319) → bug probable de ScummVM, à vérifier à l'oreille.
- Version CD : `o1_playSample` **n'arrête pas** la musique (l.1925-1927).
- **Effets sonores** (même en CD) : AdLib. Ressource `.SPL` (~387 o) chargée en slot anim brut ; `playSample` DOS : si size == 0xFFFF → `AdLibSoundDriverINS::playSample(data)` = instrument OPL lu à `data+257`, note fixe 12 (l.523-546) ; sinon stop du canal. Volume clampé 50..63 mais ignoré.
- Musique non-CD (pour info) : module type SoundFX dans BASESON.SND + instruments `.INS` (`PCSoundFxPlayer`, l.1015-1168).
- Port navigateur : CD → fichiers audio (ogg/mp3) ; SFX → soit émulateur OPL2 en JS/WASM, soit pré-rendu des ~88 `.SPL` en échantillons (plus simple, fidèle car note fixe).

## 8. Sauvegarde
- Format FW versionné `C1FW` v4 (`saveload.cpp:makeSaveFW` l.893-935) : disque, noms part/dat, musicIsPlaying, noms PRC/REL/MSG/BG/CT, table objets, palettes active+backup, 255 globales, zoneData, commandVar3[4], buffer commande (80), `_cmdY`, bgVar0, allowPlayerInput, playerCommand, commandVar1, isDrawCommandEnabled, var2-5, commandVar2, `_messageBg`, **table anim par nom (fichier+frame) rechargée au load**, params écran, scripts globaux et objets (labels, locals, compare, pos, index), overlay list, bg incrust list. + en-tête étendu ScummVM (miniature, temps de jeu).
- Chargement (`loadPlainSaveFW` l.665-799) : recharge part, PRC, REL, fond (+ musique de fond CD), CT, puis restaure, re-dessine les incrustations, recharge MSG et relance la musique.
- Différences avec l'original : `disableSystemMenu` non sauvé (lu mais ignoré en v4 — et `makeSaveFW` ne l'écrit pas : le loader lit 2 octets de l'en-tête étendu) (`cine.cpp:initialize` l.403-418, `saveload.cpp` l.779-785) ; UI ScummVM par défaut (option `originalsaveload` pour l'UI d'origine 5×20 slots) ; slot d'autosave ; save interdite si input bloqué / menu système désactivé / en menu (`metaengine.cpp` l.545-551). Anciens formats (ANIMSIZE_23/30) supportés.
- Pour nous : sauvegarde JSON de cet état ; tout est sérialisable si la VM est à état explicite.

## 9. Protection et hacks ScummVM pertinents pour FW (PC)
Protection DOS : écran texte `PROTEC.PI1` puis écran couleur `FW.PI1` (taches de peinture, 2 essais ; couleurs objets 150..157) — repéré via TTS `gfx.cpp:loadBg16` l.1400-1419, `cine.cpp:mouseOverButton`. Échec → script charge `L201.ANI` comme PRC → retour au launcher (`prc.cpp:loadPrc` l.51-57) ; ressource `ECHEC*` → quitte (`anim.cpp:loadResource` l.912). Vérification ultérieure par la var globale 255 (143 attendu selon le commentaire).

| Fichier:ligne | Hack / correctif | Portée |
|---|---|---|
| `script_fw.cpp:o1_compareGlobalVar` l.1655-1666 | compare(var 255, imm) **toujours EQ** (sinon les moines vous tuent, bug #3866) — contournement de la vérif de protection | FW tous |
| `script_fw.cpp:getZoneFromPositionRaw` l.2030-2042 | hors 320×200 → zone 0 (crash #4581, pendentif/futur) | FW |
| `script_fw.cpp:o1_blitAndFade` l.1457-1465 | palette noire avant fade-in (anti-flash) | hacksEnabled |
| `gfx.cpp:fadeToBlack` l.1673-1680, 1695-1701 | throttling double fade (<1 s) ; annule reload palette | hacksEnabled |
| `gfx.cpp:incrustSprite` l.664-672 | ignore sprite sans masque (bug #3868 au load) | FW |
| `gfx.cpp:renderOverlay` l.1085-1092 | masque nul → tout visible (#10643, Amiga FR) | FW |
| `gfx.cpp:drawMessage` l.746-759 | boîte remontée si déborde (#11708) | tous |
| `various.cpp:playerCommandMouseLeftRightUp` l.1117-1129 | ligne de commande toujours mise à jour | FW |
| `cine.cpp:initialize` l.403-418 ; `saveload.cpp` l.779-785 | `disableSystemMenu` non restauré | FW |
| `object.cpp:loadObject` l.92-96 | `INTRO.OBJ` : costume des objets 0-9 = 0 | FW |
| `object.cpp:modifyObjectParam` l.259 | costume −1 → globalVars[0] | FW |
| `anim.cpp` l.59-191, 694-699 | table de couleurs transparentes par ANI + `L2202`/`L4601` par frame | FW |
| `part.cpp:readFile` l.336-343 | déchiffrement ROL1 de AUTO00.PRC Sony | FW CD |
| `script_fw.cpp:o1_playSample` l.1925-1927 | CD : ne coupe pas la musique | FW CD |
| `sound.cpp` l.1244-1324 | mapping musique → pistes CD, musique de fond par décor | FW CD |
| Amiga/Atari uniquement (ignorer) : `o1_compareVar` CODE2.PRC l.1081-1093 ; `o1_break` double BREAK l.1519-1577 ; `ALPHA.ANI` l.673-680 ; `TITRE.ANI` démo l.683-688 | | |
| OS uniquement (ignorer) : `main_loop.cpp` l.463-493, `o1_setZoneDataEntry` l.1741-1746, `object.cpp` l.70-74, `part.cpp` l.197, `various.cpp` l.1172, `gfx.cpp` l.1226, 2122-2230, 2943, cheats labyrinthe l.1335-1344, `runOnlyUntilFreePartRangeFirst200` | | |

## 10. Taille et risques
- Code effectif du moteur (hors lignes vides/commentaires) ≈ 12,6 k lignes. **Part FW ≈ 5,5–6 k** : `script_fw.cpp` ≈1,2 k (hors décompilateur ≈1 k), `various.cpp` ≈1 k, `gfx.cpp` FW ≈0,9 k (hors tables TTS et `OSRenderer`), `sound.cpp` FW ≈0,5 k (AdLib INS + CD), `saveload.cpp` FW ≈0,4 k, `anim.cpp` ≈0,5 k, `main_loop.cpp` ≈0,3 k, `texte/pal/part/object/bg/prc/rel/msg/unpack` ≈1 k. À ignorer : `script_os.cpp`, `OSRenderer`, seqList, `vol.cnf`, MT-32, ADL, Paula, TTS, détection.
- Port TS estimé : 3–4 k lignes.

Points durs / risques :
1. **Timing** : tout repose sur tick ≈110 ms × `break` ; le moindre écart change la vitesse de marche et les cinématiques. Fades bloquants à intercaler correctement.
2. **Ordre des overlays et masques** (tri par `mask`, type 5 occulteurs, incrustations utilisant l'état courant des objets, hit-test à quirks).
3. **Sémantique VM fine** : décalage d'opcode +1, labels pré-calculés jusqu'au premier END, int16 wrap, scripts ajoutés dans le même tick, `endGlobalScript` différé, local[0] = runCount, chargements différés qui vident les listes.
4. **Allocation des slots anim** (premier libre) : à reproduire exactement, sinon mauvais sprites.
5. **Audio** : SFX AdLib (OPL2) ; logique CD avec quirks (slot 1 relancé, bug probable `fadeOutMusic`).
6. **Messages** : ScummVM attend un clic (pas de timeout) ; l'original avait vraisemblablement une durée liée à la longueur (`_messageLen`) — choix à faire.
7. Protection : décider de contourner (var 255 + court-circuit de l'écran couleur) — à confirmer en désassemblant AUTO00.PRC/TOTO.PRC.
8. Surprises : version FR = patch fan ; fichiers `.PAL` inutiles ; « pathfinding » inexistant (scripts) ; incrustation qui lit l'état courant de l'objet.
