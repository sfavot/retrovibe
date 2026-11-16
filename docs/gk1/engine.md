# Gabriel Knight : moteur (machine virtuelle, modèle objet, noyau)

Ce document reçoit ce que les vagues V et S1 établissent sur le moteur. **Vague V (16/11/2026)** : le code des 213 scripts, désassemblé en entier par `src/games/gk1/engine/disasm.ts`, et le **relevé définitif des fonctions et sous-fonctions du noyau que GK1 appelle**. Tous les chiffres sont **vérifiés** par `test/gk1/engine/disasm.test.ts` sur les fichiers de `original/gk1/`, sauf mention contraire. Les noms de sous-fonctions sont **lus** dans `engines/sci/engine/kernel_tables.h` de ScummVM (tables `k…_subops`, GPL v3 ou ultérieure).

## 1. Outils

- **Désassembleur** : `loadProgram(index)` lit vocabulaires et scripts ; `disassembleScript(script)` rend les routines (méthodes, procédures exportées, procédures locales), l'usage de chaque octet et les anomalies ; `formatScript` / `formatRoutine` écrivent le code avec les noms de sélecteurs (vocabulaire 997), de classes (vocabulaire 996 et scripts), de propriétés, d'opcodes (vocabulaire 998) et de fonctions du noyau ; `surveyKernelCalls` fait le relevé du § 4.
- **Sélecteurs des envois** : `analyzeCalls` suit la pile le long d'une routine et retrouve, pour chaque `send` / `self` / `super`, les sélecteurs et leur nombre d'arguments, et pour chaque appel les arguments constants. 26 180 envois sur 26 187 sont ainsi nommés ; les 7 autres ont un sélecteur calculé (script 211 export 0 ; 510 `giveTheCard::changeState` ; 64943 `eachLineDo`, `PolyEdit::select`, `PolyEdit::advanceRetreat` × 2 ; 64999 export 6).
- **Visionneuse** : `npm run dev`, puis `/src/games/gk1/ui/asset-viewer.html` ; l'onglet Scripts montre objets, exports, chaînes et désassemblage (`#scripts/<numéro>`).

## 2. Code des scripts

| Mesure | Valeur |
| --- | --- |
| Scripts | 213 |
| Méthodes | 3 346 |
| Procédures exportées | 42 |
| Procédures locales (cibles de `call`) | 35 |
| Instructions | 306 877 |
| Opcodes distincts utilisés | 78 sur 128 (77 hors script 952, qui ajoute `lea`) |
| Octets de code jamais atteint | 1 491 |
| Octets non attribués | 0 |

- **Chaque octet des 213 scripts est attribué** : en-tête, table d'exports, dictionnaires de propriétés (classes) et de méthodes, code atteint, code mort, table de relocation. `formats.md` § 16.16 est refermé pour les scripts.
- **Relocations** : les 7 216 opérandes de `lofsa` sont exactement les entrées de code des tables de relocation, et aucune relocation ne vise autre chose (un export d'objet ou un `lofsa`). `lofss` n'est jamais utilisé.
- **Code mort** : ce que le compilateur laisse après un `return` ou un `break` (469 `jmp`, 56 `ret` et quelques dizaines d'autres instructions jamais atteintes) et 112 octets nuls de remplissage. Il suit toujours le code d'une routine nommée ; il se décode sans reste.
- **Appels entre scripts** : 3 133 `calle` (scripts 13 : 2 249 ; 50 : 526 ; 64999 : 306 ; 64921 : 30 ; 64958 : 10 ; 64255 : 5 ; 64990 : 3 ; 64908 et 64982 : 2), 136 `call`, **aucun `callb`**.
- **Opcodes jamais rencontrés** (hors script 952) : `ugt?`, `uge?`, `callb`, `lea`, `sTop`, `ipTos`, `dpTos`, `lofss`, `lagi`, `lati`, `lsti`, `ssg`, `ssl`, `sst`, `ssp`, `sati`, tous les `ss?i`, `+ap`, tous les `+s?`, `+?i` et `+s?i`, `-ag`, tous les `-s?`, `-?i` et `-s?i`, et les opcodes de débogage `file` et `line`. La machine virtuelle les porte quand même (SCI2 les définit), mais aucun test sur les scripts réels ne les exerce.
- **Langue** : l'objet du jeu (`GK`) porte `printLang = 1` (anglais) dans les scripts et **aucun script ne l'écrit** ; 57 envois le relisent (scripts 13, 92, 216, 302, 370, 500, 670, 700, 815). L'interpréteur d'origine y range au démarrage le `language` de `RESOURCE.CFG` (33 sur ce CD ; `SciEngine::setSciLanguage` et `getSciLanguage` de ScummVM, `engine/state.cpp`) : `Vm.boot` fait de même (`CONFIG_LANGUAGE`, `engine/ids.ts`). La procédure 6 du script 13 choisit parmi cinq valeurs selon la langue (49 allemand, 34 espagnol, 33 français, 39 italien, sinon anglais) : positions du carton « Jour N » (pièce 370 : « JOUR » en (45, 50), chiffre en (250, 52) ; en anglais (76, 68) et (88, 115)), mises en page des scripts ci-dessus. L'allemand y change aussi l'ordre (chiffre avant le mot). **Relevé des 57 lectures (vague G3)** : cartons « Jour N » des pièces 370 (jours 1 à 7, chiffre = boucle du jour de la vue 375), 500 (jour 8), 700 (jour 9) et 216 (jour 10 : « 1 » en (250, 52), « 0 » en (275, 52), mot en (35, 50)), tous rendus et vérifiés (`test/gk1/render/day-card.test.ts`) ; la troisième ligne `dayPeriod` n'existe qu'en allemand. `theDayNum::init` (pièce 700) passe **six** valeurs à la procédure pour `y` (`115, 31, 52, 31, 31, 31`) : la française reste la troisième, 52. Pièce 302 (message codé de la tombe) : 7 colonnes de 17 × 20 au lieu de 6 de 20 × 24, messages et phrase « plus de place » en français, rendu relu. Lus sans être rendus : script 92 (titres « Le Jeu: », « Remerciements », « Comment Jouer », « Aides », bouton en x = 65), 670 (`endTalker` : police 4 au lieu de 999), 815 (35 phrases du livre des tambours, `leftX` 184), 216, 500 et 700 (répliques choisies par langue).

**Deux anomalies, sans effet sur le jeu :**
- **Script 952 (`sysLogger`)** : compilé pour un interpréteur d'avant SCI2 (nombre d'octets d'arguments sur un octet, numéros de noyau d'une autre table). Lu en SCI2, son code est incohérent ; lu à l'ancienne, il se désassemble sans reste (1 méthode, 1 procédure locale, 66 `callk`). Aucun `ScriptID`, `calle` ni `DisposeScript` constant ne le désigne : reste de débogage. `disassembleScript` le signale par `legacyEncoding` et le relevé du noyau l'ignore. **La machine virtuelle n'a pas à le prendre en charge.**
- **Script 241, export 25** : vaut 675, qui n'est ni un objet du heap (pas dans la table de relocation) ni le début d'une instruction (il tombe dans l'opérande d'un `pushi`). Aucun `calle` ne le vise. Signalé par `strayExports`.

## 3. Table des fonctions du noyau : correction de `formats.md` § 15

**La table lue dans `SIERRA.EXE` avait perdu une entrée : `Abs`, à l'indice 94.** Tous les indices de `formats.md` § 15 à partir de 94 sont donc trop petits de 1. La table de GK1 est celle de ScummVM (`sci2_default_knames`, 139 noms de `Load` à `PointSize`), **lue** et **vérifiée** par les appels : `Abs` reçoit 1 argument (27 appels), `Platform` aucun (65 appels, dans les scripts de cinématiques), `FileIO` a les sous-fonctions 0 à 11, etc.
Conséquence : **les « Dummy » 124 et 132 de `formats.md` § 16.3 étaient `FileIO` (43 appels) et `RemapColors` (24 appels)** ; 113 était `MergePoly`, 114 `SetDebug`, 116 `MemoryInfo`. **Aucune fonction « Dummy » n'est appelée.** La table à jour est `src/games/gk1/engine/kernel/names.ts` (vague S1), que le désassembleur importe.

## 4. Fonctions du noyau appelées par GK1 (relevé définitif)

**104 fonctions appelées, 3 838 appels** dans les 212 scripts SCI2 (méthodes, procédures exportées et locales, code mort compris ; `formats.md` § 15 ne comptait que les méthodes). « Scripts » : nombre de scripts appelants. « Arguments » : nombre d'arguments annoncé (nombre d'appels), hors `&rest`. « Premier argument » : sous-fonction ou type de ressource quand le premier argument est une constante.

| Indice | Fonction | Appels | Scripts | Arguments | Premier argument |
| --- | --- | --- | --- | --- | --- |
| 0 | `Load` | 185 | 49 | 2 (184), 3 (1) | calculé × 1, view × 110, pic × 10, script × 9, font × 2, palette × 1, audio 0x8c × 22, message × 30 |
| 1 | `Unload` | 54 | 10 | 2 (54) | view × 35, pic × 13, mémoire 0x85 × 2, audio 0x8c × 4 |
| 2 | `ScriptID` | 1384 | 66 | 1 (70), 2 (1314) |  |
| 3 | `DisposeScript` | 146 | 67 | 1 (144), 2 (2) |  |
| 6 | `Purge` | 1 | 1 | 1 (1) |  |
| 7 | `Clone` | 5 | 3 | 1 (5) |  |
| 8 | `DisposeClone` | 3 | 3 | 1 (3) |  |
| 9 | `RespondsTo` | 1 | 1 | 2 (1) |  |
| 10 | `SetNowSeen` | 2 | 2 | 1 (2) |  |
| 11 | `NumLoops` | 7 | 3 | 1 (7) |  |
| 12 | `NumCels` | 5 | 4 | 1 (5) |  |
| 13 | `CelWide` | 25 | 16 | 0 (1), 3 (24) |  |
| 14 | `CelHigh` | 31 | 13 | 0 (1), 3 (30) |  |
| 15 | `GetHighPlanePri` | 12 | 9 | 0 (12) |  |
| 17 | `ShakeScreen` | 21 | 4 | 1 (1), 2 (20) |  |
| 18 | `OnMe` | 1 | 1 | 4 (1) |  |
| 19 | `ShowMovie` | 187 | 9 | 1 (38), 2 (77), 4 (34), 5 (38) | nom de fichier (forme DOS) × 35, 0 WinOpen × 38, 1 WinInit × 38, 2 WinPlay × 38, 6 WinClose × 38 |
| 20 | `SetVideoMode` | 20 | 6 | 1 (20) |  |
| 21 | `AddScreenItem` | 11 | 9 | 1 (11) |  |
| 22 | `DeleteScreenItem` | 12 | 8 | 1 (12) |  |
| 23 | `UpdateScreenItem` | 176 | 43 | 1 (176) |  |
| 24 | `FrameOut` | 152 | 38 | 0 (152) |  |
| 25 | `AddPlane` | 4 | 3 | 1 (4) |  |
| 26 | `DeletePlane` | 2 | 2 | 1 (2) |  |
| 27 | `UpdatePlane` | 29 | 18 | 1 (29) |  |
| 29 | `SetShowStyle` | 2 | 1 | 7 (1), 8 (1) |  |
| 31 | `SetScroll` | 1 | 1 | 6 (1) |  |
| 32 | `AddMagnify` | 1 | 1 | 1 (1) |  |
| 33 | `DeleteMagnify` | 1 | 1 | 1 (1) |  |
| 34 | `IsHiRes` | 161 | 29 | 0 (161) |  |
| 35 | `Graph` | 1 | 1 | 1 (1) |  |
| 37 | `TextSize` | 9 | 8 | 4 (9) |  |
| 38 | `Message` | 76 | 22 | 2 (4), 6 (37), 7 (35) | 0 Get × 63, 1 Next × 1, 2 Size × 8, 4 RefNoun × 1, 9 LastMessage × 3 |
| 42 | `SetQuitStr` | 1 | 1 | 1 (1) |  |
| 43 | `EditText` | 1 | 1 | 1 (1) |  |
| 45 | `CreateTextBitmap` | 3 | 2 | 2 (1), 4 (2) | 0 Sized × 2, 1 FromObject × 1 |
| 46 | `DisposeTextBitmap` | 10 | 7 | 1 (10) |  |
| 47 | `GetEvent` | 3 | 3 | 2 (3) |  |
| 48 | `GlobalToLocal` | 5 | 3 | 1 (4), 2 (1) |  |
| 49 | `LocalToGlobal` | 4 | 2 | 1 (2), 2 (2) |  |
| 50 | `MapKeyToDir` | 5 | 5 | 1 (5) |  |
| 51 | `HaveMouse` | 6 | 4 | 0 (6) |  |
| 52 | `SetCursor` | 66 | 26 | 1 (29), 2 (5), 3 (1), 4 (29), 5 (2) |  |
| 54 | `SaveGame` | 1 | 1 | 4 (1) |  |
| 55 | `RestoreGame` | 1 | 1 | 3 (1) |  |
| 56 | `RestartGame` | 1 | 1 | 0 (1) |  |
| 57 | `GameIsRestarting` | 1 | 1 | 1 (1) |  |
| 58 | `MakeSaveCatName` | 1 | 1 | 2 (1) |  |
| 59 | `MakeSaveFileName` | 1 | 1 | 3 (1) |  |
| 60 | `GetSaveFiles` | 1 | 1 | 3 (1) |  |
| 61 | `GetSaveDir` | 2 | 1 | 0 (1), 1 (1) |  |
| 62 | `CheckSaveGame` | 1 | 1 | 3 (1) |  |
| 63 | `CheckFreeSpace` | 1 | 1 | 2 (1) |  |
| 64 | `DoSound` | 65 | 30 | 1 (45), 2 (7), 3 (7), 6 (6) | 0 MasterVolume × 2, 2 Restore × 2, 3 GetPolyphony × 1, 4 GetAudioCapability × 41, 6 Init × 1, 7 Dispose × 1, 8 Play × 1, 9 Stop × 1, 10 Pause × 1, 11 Fade × 2, 12 SetHold × 2, 14 SetVolume × 1, 15 SetPriority × 1, 16 SetLoop × 1, 17 UpdateCues × 3, 18 SendMidi × 4 |
| 65 | `DoAudio` | 17 | 7 | 1 (1), 2 (8), 6 (8) | 1 WaitPlay × 1, 2 Play × 3, 3 Stop × 3, 6 Position × 2, 13 SetBufferSize × 8 |
| 66 | `DoSync` | 3 | 1 | 1 (1), 2 (1), 7 (1) | 0 Start × 1, 1 Next × 1, 2 Stop × 1 |
| 67 | `NewList` | 4 | 1 | 0 (4) |  |
| 68 | `DisposeList` | 1 | 1 | 1 (1) |  |
| 69 | `NewNode` | 4 | 1 | 2 (4) |  |
| 70 | `FirstNode` | 36 | 13 | 1 (36) |  |
| 71 | `LastNode` | 1 | 1 | 1 (1) |  |
| 72 | `EmptyList` | 1 | 1 | 1 (1) |  |
| 73 | `NextNode` | 43 | 13 | 1 (43) |  |
| 74 | `PrevNode` | 3 | 2 | 1 (3) |  |
| 75 | `NodeValue` | 79 | 17 | 1 (79) |  |
| 76 | `AddAfter` | 1 | 1 | 3 (1) |  |
| 77 | `AddToFront` | 1 | 1 | 2 (1) |  |
| 78 | `AddToEnd` | 2 | 1 | 2 (2) |  |
| 81 | `FindKey` | 8 | 2 | 2 (8) |  |
| 85 | `DeleteKey` | 1 | 1 | 2 (1) |  |
| 88 | `ListAt` | 1 | 1 | 2 (1) |  |
| 89 | `ListIndexOf` | 1 | 1 | 2 (1) |  |
| 90 | `ListEachElementDo` | 1 | 1 | 2 (1) |  |
| 91 | `ListFirstTrue` | 1 | 1 | 2 (1) |  |
| 92 | `ListAllTrue` | 1 | 1 | 2 (1) |  |
| 93 | `Random` | 175 | 52 | 2 (175) |  |
| 94 | `Abs` | 27 | 15 | 1 (27) |  |
| 96 | `GetAngle` | 12 | 9 | 4 (12) |  |
| 97 | `GetDistance` | 11 | 8 | 4 (9), 5 (2) |  |
| 98 | `ATan` | 1 | 1 | 4 (1) |  |
| 99 | `SinMult` | 4 | 3 | 2 (4) |  |
| 100 | `CosMult` | 5 | 3 | 2 (5) |  |
| 103 | `GetTime` | 25 | 14 | 0 (21), 1 (4) | sans argument (ticks) × 21, 1 Time12Hour × 2, 2 Time24Hour × 1, 3 Date × 1 |
| 104 | `Platform` | 65 | 8 | 0 (65) |  |
| 105 | `BaseSetter` | 4 | 1 | 1 (4) |  |
| 106 | `DirLoop` | 6 | 5 | 2 (6) |  |
| 107 | `CantBeHere` | 1 | 1 | 2 (1) |  |
| 108 | `InitBresen` | 1 | 1 | 1 (1) |  |
| 109 | `DoBresen` | 1 | 1 | 1 (1) |  |
| 110 | `SetJump` | 1 | 1 | 4 (1) |  |
| 111 | `AvoidPath` | 4 | 2 | 8 (4) |  |
| 112 | `InPolygon` | 28 | 2 | 3 (28) |  |
| 113 | `MergePoly` | 1 | 1 | 3 (1) |  |
| 114 | `SetDebug` | 1 | 1 | 0 (1) |  |
| 116 | `MemoryInfo` | 6 | 2 | 1 (6) |  |
| 122 | `GetCWD` | 1 | 1 | 1 (1) |  |
| 123 | `ValidPath` | 3 | 2 | 1 (3) |  |
| 124 | `FileIO` | 43 | 8 | 2 (15), 3 (19), 4 (9) | 0 Open × 11, 1 Close × 8, 2 ReadRaw × 1, 3 WriteRaw × 1, 4 Unlink × 2, 5 ReadString × 5, 6 WriteString × 8, 7 Seek × 1, 8 FindFirst × 1, 9 FindNext × 1, 10 Exists × 3, 11 Rename × 1 |
| 127 | `Palette` | 181 | 34 | 4 (181) | 2 SetFade × 174, 3 FindColor × 7 |
| 128 | `PalVary` | 21 | 5 | 1 (10), 2 (4), 3 (6), 4 (1) | 0 SetVary × 5, 1 SetPercent × 2, 2 GetPercent × 1, 3 Off × 9, 8 SetStart × 4 |
| 129 | `PalCycle` | 23 | 2 | 1 (1), 2 (14), 5 (8) | 0 SetCycle × 8, 4 Off × 15 |
| 130 | `Array` | 2 | 2 | 0 (1), 2 (1) | `&rest` seul × 1, 4 Free × 1 |
| 131 | `String` | 43 | 10 | 0 (1), 2 (41), 3 (1) | `&rest` seul × 1, 4 Free × 2, 7 Compare × 1, 8 Duplicate × 17, 9 GetData × 20, 10 Length × 2 |
| 132 | `RemapColors` | 24 | 6 | 1 (6), 3 (1), 4 (7), 5 (10) | 0 Off × 6, 1 ByRange × 10, 2 ByPercent × 8 |

**Jamais appelées** (35) : 4 `Lock`, 5 `ResCheck`, 16 `GetHighItemPri`, 28 `RepaintPlane`, 30 `ShowStylePercent`, 36 `InvertRect`, 39 `TextColors`, 40 `TextFonts`, 44 `InputText`, 53 `VibrateMouse`, 95 `Sqrt`, 101 `SinDiv`, 102 `CosDiv`, 126 `DeviceInfo`, 135 `ObjectIntersect`, 137 `TextWidth`, 138 `PointSize` ; les « Dummy » 41, 79, 80, 82 à 84, 86, 87, 125 ; les fonctions de débogage 115 `InspectObject`, 117 `Profiler`, 118 `Record`, 119 `PlayBack`, 120 `MonoOut`, 121 `SetFatalStr`, 133 `IntegrityChecking`, 134 `CheckIntegrity`, 136 `MarkMemory`. Elles restent des souches qui journalisent (`plan.md`) : un appel par un sélecteur calculé ou par `&rest` n'est pas exclu.

## 5. Sous-fonctions : ce qu'il faut porter

Toutes les sous-fonctions sont choisies par une **constante** : aucune n'est calculée, sauf les deux appels `Array` et `String` faits avec `&rest` seul (classes `Array` 64920 et `Str` 64918, qui relaient n'importe quelle sous-fonction : **`Array` et `String` sont à porter en entier**, sous-fonctions 0 à 9 et 0 à 16).

- **`DoSound`** : 0 `MasterVolume`, 2 `Restore`, 3 `GetPolyphony`, 4 `GetAudioCapability` (41 appels : tests « y a-t-il une carte son numérique ? »), 6 `Init`, 7 `Dispose`, 8 `Play`, 9 `Stop`, 10 `Pause`, 11 `Fade`, 12 `SetHold`, 14 `SetVolume`, 15 `SetPriority`, 16 `SetLoop`, 17 `UpdateCues`, 18 `SendMidi`. Jamais : 1 `Mute`, 5 `Suspend`, 13, 19 `GlobalReverb`, 20 `Update`.
- **`DoAudio`** (porté en vague A2 : `kernel/audio.ts`, `audio/digital.ts`) : 2 `Play(ressource[, boucle[, volume]])` rend la durée en ticks (`1 + ms × 60 / 1000`, millisecondes et ticks tronqués), 0 si la ressource n'existe pas, et sans argument le nombre de canaux ; une ressource est une clé de voix `module, noun, verb, cond, seq` ou un numéro de son ; rejouer une ressource en cours ne la relance pas. 3 `Stop([ressource])` rend le nombre de canaux d'avant. 6 `Position([ressource])` rend les ticks écoulés, −1 si le canal n'existe plus ; **sans argument** (`Sync::syncCheck`) : ticks depuis le début du premier son lancé quand rien ne jouait. 13 `SetBufferSize` (8 appels) : sans effet. **1 n'existe pas dans l'interpréteur SCI2** (lu, table de ScummVM : à partir de SCI2.1) : son seul appel, `ScriptSync::init` du script 64929, est du code que rien n'instancie ; nous rendons la durée sans jouer. Jamais : 0, 4, 5, 7 à 12 (0, 4, 5, 9 portées quand même). Volume : SCI2 n'a que cinq niveaux (0 ; 1 à 42 ; 43 à 84 ; 85 à 126 ; 127). Les sons de `DoSound` qui ont un `audio/<n>.mp3` passent par les mêmes canaux, un par objet `Sound`, avec le fondu d'`Audio32` (ligne droite de `tickerStep × step` ticks).
- **`DoSync`** (porté en vague A2 : `kernel/audio.ts`, `audio/sync.ts`) : 0 `Start(objet, module, noun, verb, cond, seq)` écrit `syncCue` = 0, ou −1 si le clip n'a pas de synchronisation ; 1 `Next(objet)` écrit `syncTime` et `syncCue` du repère suivant, puis −1 et −1 après le dernier ; 2 `Stop`. Tous dans le script 64929 : `MouthSync` (le cycleur de la bouche d'un `Talker`) avance tant que `syncTime` ne dépasse pas `DoAudio(Position)` et pose le cel `repère & 15`.
- **`Message`** (porté en vague T : `engine/message.ts`, `kernel/message.ts`) : 0 `Get` (63), 1 `Next`, 2 `Size` (8), 4 `RefNoun`, 9 `LastMessage` (3). **SCI2 décale les sous-fonctions 3 à 8 de SCI1.1 vers 4 à 9** (lu, ScummVM `kMessage`). Jamais : 5 `RefVerb`, 6 `RefCond`, 7 `Push`, 8 `Pop` (portées quand même). `Get(module, noun, verb, cond, seq[, tampon])` rend le talker, 0 sans message ; **sans tampon (6 arguments) le curseur ne bouge pas** (`Messager::say` s'en sert pour savoir si le message existe) ; avec tampon (`data` d'un `Str`) le texte est écrit et le curseur avance, `Next(tampon)` lit la suite. Renvois suivis par une pile de clés ; `LastMessage(tableau)` écrit `module, noun, verb, cond, seq` du texte rendu (renvois suivis), que `Messager::nextMsg` passe au talker pour la voix. **Mode texte / voix (D2)** : variable globale 90 (bit 0 texte, bit 1 voix) et 166 (narratrice doublée), fixées par `gKInitCode::doit` (script 10) d'après `DoSound(GetAudioCapability)` : 3 et 1 chez nous ; changées par le panneau de réglages (script 14), jamais à 0 ; `Messager::nextMsg` force le texte seul le temps d'un message des talkers 64 et 97, et de la narratrice (99) si elle n'est pas doublée. Lecture et écriture : `messageModeOf`, `narratorVoiceOf`, `setMessageMode`.
- **`FileIO`** : 0 `Open`, 1 `Close`, 2 `ReadRaw`, 3 `WriteRaw`, 4 `Unlink`, 5 `ReadString`, 6 `WriteString`, 7 `Seek`, 8 `FindFirst`, 9 `FindNext`, 10 `Exists`, 11 `Rename`. Scripts 0, 10, 805, 64943, 64944, 64952, 64990 (sauvegardes), 64993 (classe `File`).
- **`Palette`** : 2 `SetFade` (174 appels, toujours 4 arguments : sous-fonction, première couleur, dernière couleur, pourcentage) et 3 `FindColor` (7). Jamais : 1 `SetFromResource`, 4.
- **`PalVary`** : 0 `SetVary`, 1 `SetPercent`, 2 `GetPercent`, 3 `Off`, 8 `SetStart`. **`PalCycle`** : 0 `SetCycle`, 4 `Off`. **`RemapColors`** : 0 `Off`, 1 `ByRange`, 2 `ByPercent`.
- **`ShowMovie`** : deux formes, choisies par les scripts selon `Platform()`. **DOS** (35 appels, portée en vague Q : `kernel/movie.ts`, `render/seq-player.ts`) : `ShowMovie(nom, durée[, x, y])` joue le fichier `SEQ`, `durée` ticks de 1/60 s par image (7, ou 8 pour `MAP.SEQ` et `205.SEQ`), toile posée en (`x`, `y`) : (150, 135) si `IsHiRes`, sinon (0, 0) ; la fonction ne revient qu'à la fin ou au clic, accumulateur inchangé (`formats.md` § 12). **Windows** (152 appels) : 0 `WinOpen`, 1 `WinInit`, 2 `WinPlay`, 6 `WinClose`, pour des AVI absents du CD. **Notre `Platform()` répond 1 (DOS)** : seule la forme DOS est portée, l'autre est signalée par un avertissement.
- **`Platform`** : toujours sans argument (65 appels), comparé à 1. **`GetTime`** : sans argument (ticks, 21 appels), 1 (heure sur 12 h), 2 (heure sur 24 h), 3 (date). **`Graph`** : un seul appel, `Graph(1)` dans le script 10, dont le résultat est comparé à 2 et à 16 : le nombre de couleurs de l'écran (répondre 256 ; supposé).
- **`Load` / `Unload`** : vues, pics, scripts, polices, palette, messages, mémoire (0x85, `Unload` seulement), et **0x8c (26 appels)** : type absent de `RESOURCE.MAP`, qui désigne l'audio numérisé par numéro (supposé : ce que `audio/<n>.mp3` remplace). Y répondre sans rien charger.
- **`SetCursor`** : 1 à 5 arguments : `SetCursor(0)` et `SetCursor(1)` (cacher, montrer : supposé), `SetCursor(-2)` (12 appels), `SetCursor(vue, boucle, cel)`, et des formes à 2, 4 et 5 arguments (position, zone de déplacement : supposé). À lire dans `kSetCursor` (SCI32) de ScummVM en vague G2. **Lu (G2, G3)** : § 6.3 ; la forme à 5 arguments est du code mort.
- **`CreateTextBitmap`** : 0 (largeur, hauteur, objet) et 1 (objet). **`ShakeScreen`** : `(1 à 5, 1)`, nombre de secousses puis direction (supposé). **`SetVideoMode`** : 0 et 1, autour des cinématiques (bascule en mode X de l'original : sans effet pour nous, supposé).
- **`MemoryInfo(0)`** (6 appels, scripts 64952 et 64994) et **`SetDebug()`** (1 appel) : fonctions de l'interpréteur de développement. `MemoryInfo` doit rendre une grande valeur (mémoire libre) ; `SetDebug` ne fait rien.

**Compte à porter** : 104 fonctions, dont 14 à sous-fonctions (`DoSound` 16, `DoAudio` 5, `DoSync` 3, `Message` 5, `FileIO` 12, `Palette` 2, `PalVary` 5, `PalCycle` 2, `RemapColors` 3, `Array` et `String` en entier, `GetTime` 4, `CreateTextBitmap` 2, `ShowMovie` forme DOS).

## 6. Points ouverts

1. `DoAudio` : **refermé par la vague A2** (§ 5). Message sans clip : `Play` rend 0 dans l'original comme dans ScummVM, et `Narrator::doit` ferme alors le texte à l'image suivante en « texte et voix » ; **écart volontaire : nous rendons le temps de lecture de `Narrator::startText`** (`max(120, 24 × longueur / 10 × vitesse)`, vitesse = variable globale 94), y compris quand les fichiers audio manquent ou n'arrivent pas (repli en texte seul). Des 3 525 messages sans clip à leur clé, 2 436 sont des renvois vers un message doublé ; restent 1 089 : 669 des talkers 64 et 97 (toujours en texte seul), 349 « !!! », 33 libellés du talker 98 et **38 répliques** (18 du prêcheur de la pièce 220, 8 de la narratrice). Non vérifié sur l'interpréteur d'origine. Relevé de la vague T : **Ce que les messages attendent de `DoAudio` (relevé en vague T, `Narrator` et `Talker`, script 64928)** : `Play` (2, clé `module, noun, verb, cond, seq` de `LastMessage`) rend la durée en ticks, rangée dans `ticks` ; `Position` (6, même clé) rend −1 quand le clip est fini, ce qui ferme le talker ; `Stop` (3). Tant que la souche rend 0, un texte reste jusqu'au clic ou à Entrée dans tous les modes, et le mode « voix seule » ne montre ni ne joue rien pour un personnage. À trancher en A2 : la réponse de `Play` pour les 3 525 messages sans clip (0 fermerait le texte aussitôt en mode « texte et voix »).
2. `ShowMovie` forme DOS : refermé par la vague Q (durée d'une image en ticks, puis position ; § 5).
3. `Graph(1)` : porté en G1, réponse 256 toujours **supposée** (`kgraphics32.cpp` de ScummVM ne définit pas `Graph` ; le script 10 la compare à 2 et à 16). `SetCursor` : **lu en G2** dans `kSetCursor32` (−2 lève la zone de déplacement ; 0 cache, en s'empilant ; toute autre valeur montre ; 2 arguments : position ; 3 : vue, boucle, cel ; 4 : zone, bords compris ; 5 arguments : forme inconnue de ScummVM, et **jamais atteinte** : les deux appels, à la fin de `Game::setCursor` et de `GK::setCursor`, demandent un `setCursor` à plus de quatre arguments, or les 280 envois en passent quatre au plus ; avertissement gardé). **`AddMagnify`, `DeleteMagnify` (vague G3)** : appelés seulement par `Magnifier::init` et `dispose` (script 64979), et un `Magnifier` n'est créé que par `View::setMagnifier`, qu'aucun script n'envoie : code mort, `kDummy` dans ScummVM, laissés sans implémentation. **`SetShowStyle` (vague G3)** : types demandés 0, 12 (une fois, pièce 471), 13 et 14 ; tableau dans `render/transitions.ts` ; plan retourné (`mirrored`, bit 1024 du style) jamais demandé. `SetVideoMode` : sans effet, toujours supposé. `Load(0x8c)` : supposé.
4. Opcodes jamais rencontrés : portés sans épreuve sur les scripts réels (tests synthétiques seulement). (S1)
5. **Sauvegardes et fichiers : refermé par la vague S2.** `FileIO` 0 à 11 sur un système de fichiers virtuel (`kernel/fileio.ts`) : `version` (le fichier `VERSION` du CD, chargé par la page depuis la vague J : le jeu affiche « 1.000.000 » ; sans lui, « xx.yyy.zzz »), catalogue `GKsg.cat` et sauvegardes `GKsg.NNN` virtuels (composés depuis les emplacements, `Unlink` vide l'emplacement), `buster` toujours présent (comme ScummVM, script 805), le reste dans le stockage du site (`gk1:file:NOM`). `GetSaveDir` rend un tableau de caractères vide ; `ValidPath` et `CheckFreeSpace(…, 2)` répondent oui ; `GetSaveFiles`, `SaveGame`, `CheckSaveGame`, `RestoreGame`, `MakeSaveCatName`, `MakeSaveFileName`, `GameIsRestarting`, `RestartGame` dans `kernel/save.ts` ; `EditText` dans `kernel/edit-text.ts`. Plus aucune souche appelée au démarrage ni dans les fenêtres de sauvegarde.
6. **`DisposeScript` décharge toujours** (corrigé en S2) : la fenêtre de sauvegarde se décharge depuis son propre code (`DisposeScript(64990, valeur)`). Le test « pas sous son propre code » de ScummVM porte sur la trame du noyau, donc n'empêche jamais rien ; l'avoir appliqué au code du script laissait 64990 chargé, et la fenêtre grandissait et dérivait à chaque ouverture.

## 7. Sauvegardes : ce que l'image ne contient pas (vague S2)

L'image (`engine/save.ts`, JSON versionné, environ 85 000 caractères dans la librairie) porte la mémoire des scripts, la pile d'exécution, le graphisme, le son et les messages : la reprise continue à l'instruction qui suit `SaveGame`, et les images suivantes sont celles d'une exécution non interrompue. Restent hors de l'image :

- **cinématique `SEQ` en cours** (toile, image décodée) : sauvegarde refusée (`canSaveGame`), `SaveGame` rend 0 ;
- l'image composée (noire jusqu'au `FrameOut` suivant), la file d'évènements et les boutons tenus (vidés), les fichiers ouverts par `FileIO` (fermés) ;
- les notes MIDI qui sonnaient (non rejouées, comme ScummVM) ; la voix d'une réplique en cours finit **en silence** (la sortie ne sait pas partir du milieu d'un échantillon), une boucle d'ambiance repart du début ;
- les réglages de la page : son coupé, sorties audio, sources de fichiers, horloge du système ;
- pas de `replay` ni de `GameIsRestarting` après une reprise (écart volontaire : rien n'est à reconstruire).

L'icône d'aide « ? » de la barre d'icônes, trouvée bloquante pendant cette vague, est corrigée : § 9.

## 8. Correctifs de scripts et contournements (vague J, D12)

**Mécanisme** : `engine/patches.ts` (`ScriptPatcher`, notation des signatures) ; `ScriptManager` y fait passer le code et le heap de chaque script à sa lecture (chargement, rechargement après `DisposeScript`, reprise d'une sauvegarde), sans toucher aux ressources. La liste propre au jeu est `game/fixes.ts` (`GK1_FIXES`, passée par défaut à `Vm` ; `NO_FIXES` exécute les scripts tels quels). Source : la table `gk1Signatures` de `engines/sci/engine/script_patches.cpp` et les tables de `workarounds.cpp` de ScummVM, **lues** ; chaque signature a été **cherchée dans les scripts du CD français** et chaque script corrigé **relu au désassembleur** (`test/gk1/engine/patches.test.ts` : signatures présentes, aucun saut au milieu d'une instruction, sommes de contrôle figées).

**Correctifs de scripts appliqués (31 correctifs, 38 entrées de la table, 25 scripts)** :

| Script | Correctif | Méthode | Ce qui change |
| --- | --- | --- | --- |
| 0 | touche Alt+N | `GK::handleEvent` | le journal de débogage des CD français et espagnol ne s'ouvre plus |
| 21 | curseur de sortie | `ExitFeature::dispose` | l'ancien curseur n'est rendu que si le curseur de sortie est celui de cet objet |
| 93 | inventaire au redémarrage | `doTheRestart::changeState` | chaque objet est rendu par `put` : plus d'objet tenu au jour 1 |
| 210, 212 | téléphone du jour 5 (2) | `bookStoreNarrator::display`, `startOfDay5`, `getTheVeve` | Gabriel ne reste plus figé (variable globale 209) |
| 210 | enveloppe du jour 6 | `bookstore::cue` (2 endroits) | la minuterie attend la fin des messages |
| 211 | téléphone de Grace | `startingCartoon::changeState(18)` | six secondes d'attente : la phrase n'est plus coupée |
| 212 | livre des tambours | `getTheVeve::changeState` | le dialogue ne se répète plus |
| 220 | position au téléphone | `rm220::init`, `useThePhone` | (107, 124) au lieu de (104, 126), hors zone |
| 230 | minuteries du commissariat (3) | `daySixBeignet`, `sInGateWithPermission`, `sargSleeping` | 22, 20 et 22 secondes au lieu de 220, 200 et 220 cycles |
| 230, 250 | vitesse de Gabriel (2) | `sGabeEnters`, `egoExits` | `normalize` après la porte |
| 231 | vendeur de beignets | heap | `moveSpeed` 6 au lieu de 0 |
| 260 | climatiseur du musée | `flipTheSwitch::changeState` | les états attendent la fin des répliques |
| 260 | attaque du serpent (2) | `snakeAttack::changeState` | vitesse, départ et positions de Gabriel |
| 280 | chemin chez Mme Cazanoux | `rm280::init` | sommet du polygone en y = 103 |
| 350 | majordome | `shutTheDoor::doit` | à l'arrêt pendant un gros plan |
| 380 | chambre de la grand-mère | `rm380::init` | initialisation de l'entrée normale |
| 420 | loge vide | `booth`, `chair1`, `chair2::doVerb` (6 endroits) | test sur le jour |
| 420 | danse de Lorelei | `fortuneTeller::cue` | une seule minuterie, la pièce pour client |
| 471, 480, 720, 891, 892, 894 | pauses des bandes dessinées (2 correctifs, 35 endroits) | `changeState` | 60 et 120 ticks au lieu de 1 et 2 `seconds` |
| 480 | vue du bayou | `roomScript::changeState(64)` | vue 6142 |
| 530 | chambre du château | `enterFromHall::changeState` | arrivée en y = 124 |
| 710 | liane | `vineSwing::changeState(1)` | attend la fin de la réplique |
| 710 | momies | `rightWay::changeState(1)` | initialisation complète de la momie |
| 64928 | blocage du narrateur | `Narrator::say` | heure de fin 65 535 ramenée à 0 |
| 64990 | changer de répertoire | `SRDialog::init` | bouton inactif (premier des deux endroits : le second est « Annuler ») |

**Signature absente du CD français (non repris)** : `InterrogationBug` (script 51, disquette), `Day5MoselyVevePoints` (240, disquette anglaise), `Day2BinocularsLockup` (410, disquette), `HonfourUnlockDoor` (800, disquette), `MummyAnimateFloppy` (710), `ItalianTranslation` (91, 815, 920, 64913 à 64915, 64990), `MacTalismanInset` (24, Macintosh).

**Signature présente, non appliqué (écarts volontaires)** :
- `sci2Benchmark` (script 17) : ScummVM remplace le test de vitesse par 0 pour garantir le niveau de détail maximal. Notre horloge ne dépend pas de la machine et le test donne déjà `_detailLevel = 3` ; le retirer ne ferait que décaler toutes les images de référence des tests.
- `sci2NumSaves` 1 et 2 (64990) : confort de ScummVM (99 sauvegardes) ; D10 garde les 20 emplacements de la fenêtre d'origine.
- `BayouRitualAvi` (480, trois endroits) : choisit les vidéos AVI de Windows ; `Platform` répond DOS et le CD français n'a que les `SEQ`.
- `EndGameFont` (670, heap) : ScummVM ne l'active qu'en anglais ; en français `endTalker` prend déjà la police 4 (§ 2).

**Écart sur un correctif repris** : « livre des tambours » saute en 0x1867 (la cible du branchement d'origine) ; la valeur relevée dans ScummVM menait en 0x1865, au milieu d'un `jmp`. Deux correctifs (danse de Lorelei, liane) déplacent ou retirent un `lofsa` : la table de relocation du script ne correspond plus à ces opérandes (§ 2), sans effet, le moteur ne la lit que pour la table des exports. **Vérifié en jeu** (vague K, `test/gk1/play/day5.test.ts`) : ScummVM remplace `not` + `bnt` 0x25 par `bt` 0x23 (commentaire : même cible, décalage « ajusté », deux octets gagnés) ; d'après notre décompte des octets du correctif, les deux instructions finissent au même octet : 0x23 mène deux octets avant la cible, 0x25 la garde. La branche n'est prise que si Gabriel a le livre sans le drapeau 73, ce qu'aucun chemin connu ne produit ; la cible 0x1867 est celle où arrive aussi le test « a la coupure de presse ». Le scénario du défaut (motif demandé au jour 3, tambours au jour 4) donne une remise du livre avec le correctif, deux sans, avec le dialogue du motif rejoué.

**Paramètre non passé (écart volontaire, sans équivalent dans ScummVM)** : `GameFixes.missingParams` (`engine/patches.ts`), lu par `Vm.readVariable` quand une méthode lit un paramètre d'indice supérieur à `argc`. Une seule entrée : `GKEgo::getPoints` (script 18), paramètre 2 → 1. `getTheEnvelope` (script 210, jour 6) et `startOfDay4` (script 214) envoient `getPoints(drapeau)` sans le nombre de points ; la méthode fait `lsg global15` puis `lap param2`, or la case du paramètre absent est la première case libre de la pile, celle où `lsg` vient d'empiler le score : le score double (159 → 318 au jour 6). ScummVM lit la même case (`read_var` rend la case de pile telle quelle quand elle n'est pas marquée non initialisée) et n'a pas de correctif ; l'interpréteur d'origine reste à observer (banc DOSBox, D6). Un point est rendu, comme pour les autres ramassages. Tests : `patches.test.ts`, `test/gk1/play/day6.test.ts` (avec et sans l'entrée).

**Lectures non initialisées** (`uninitializedReadWorkarounds`) : `Feature::handleEvent` temporaire 0 → 0 (script 64950 : la méthode rend sa temporaire sans l'avoir écrite quand l'évènement ne la concerne pas ; reconnu pour tous les héritiers de `Feature`, par le nom des classes mères) ; `GKControls::dispatchEvent` temporaire 6 → 0 (64937) ; `GKIconbar::showInvItem` paramètre 1 → 1 (12). Sans avertissement. Non repris : `Game::save` et `Game::restore` (Macintosh).

**Autres contournements de ScummVM pour GK1** :
- messages (`messageWorkarounds`) : 410 3-48-31-1 → 3-24-31-1 ; 420 2-32-3-1 → 2-32-0-1 et 2-32-0-1 → 2-32-2-1 (un seul remplacement par lecture) ; voix (`audio36Workarounds`) : 420 2-32-0-1 → 2-32-3-1. **Vérifié** sur le CD : les clés de départ manquent (ou n'ont pas de voix) et les clés d'arrivée existent. Les trois renvois « disquette » (290, 420 4-8-3-1) ne sont pas repris ;
- arithmétique : `Fwd::doit` (64992) compare un objet à un entier ; `regCompare` rend déjà « plus grand » pour une référence, comme la valeur imposée par ScummVM. Rien à ajouter ;
- `PalVary` avec un argument de trop (`graceComeOut::changeState`, pièce 370) : l'argument est ignoré, la scène d'ouverture tourne sans avertissement ;
- `DoSound(Play)` avec un argument de trop : Macintosh, non repris.

**Opcodes** : les correctifs amènent `ssg` (téléphone du jour 5) et `sTop` (majordome), que les scripts d'origine n'utilisent pas (§ 2).

**Sauvegardes** : les correctifs ne changent pas la taille des scripts ; une sauvegarde faite avant eux reste lisible. Seule la propriété `moveSpeed` du vendeur de beignets (heap du script 231) est relue par différence avec une valeur initiale qui a changé.

**D11 (protection)** : confirmé, rien à porter. Aucun des 10 982 messages ni des 3 284 chaînes des scripts ne demande un mot ou une page du manuel (seule mention : « Lisez le manuel technique », dans l'aide du jeu) ; aucun objet ni script de protection ; le parcours sans tête va de l'écran titre à la librairie sans question.

## 9. Boucles d'attente sans `FrameOut` (vague J)

Les scripts ont des boucles qui attendent une entrée ou l'heure sans composer d'image. L'original lisait le matériel à chaque tour ; ici la machine virtuelle ne reçoit les entrées qu'entre deux images, donc une telle boucle doit rendre la main.

- **`GetEvent`** : ScummVM (`kGetEvent`, SCI32) compte les appels depuis le dernier `FrameOut` (`_eventCounter`) et, à partir du troisième, rafraîchit l'écran puis attend 10 ms. **Ici, à partir de la troisième lecture depuis le dernier `FrameOut`, `GetEvent` sert la file puis rend la main** (`SUSPEND_GET_EVENT`, `kernel/events.ts` ; le compte est dans `EventQueue`, remis à zéro par `FrameOut`) : la page présente l'image (le curseur suit le pointeur), l'horloge avance d'un tick, les entrées arrivent. Écart volontaire : un tour de trop coûte 1/60 s, pas 10 ms. Aucune image de référence des tests n'a bougé.
- **`GetTime`** : `Dialog::doit` (64922) relit `GetTime` jusqu'à ce qu'il change. ScummVM n'y fait rien (son horloge est celle de la machine) ; ici une tranche d'instructions épuisée sans `FrameOut` avance l'horloge d'un tick (`engine/loop.ts`, inchangé).

**Relevé** (désassemblage des 213 scripts : boucles qui appellent `GetEvent`, directement ou par `Event new:`, ou `GetTime`) :

| Script | Boucle | `FrameOut` dans la boucle | Tenue par |
| --- | --- | --- | --- |
| 12, 815, 64937 | `GKIconbar`, `myBar`, `IconBar::noClickHelp` (aide « ? ») | seulement quand le texte change | `GetEvent` (**testé**, et vu dans le navigateur) |
| 14, 64910 | `SlideBar::select`, `DSlider::select` (glisser un curseur) | non | `GetEvent` (`SlideBar` **testé**) |
| 64995 | `Inv::retreat`, début de `Inv::doit` | non | `GetEvent` |
| 64994 | `Game::newRoom` (vide la file) | non | finit seule quand la file est vide |
| 64922 | `Dialog::doit`, attente du tick suivant | non | horloge (tranche épuisée) |
| 99, 64943 | `debugHandler::handleEvent`, `PolyEdit::doit` | non | `GetEvent` ; outils de débogage, hors d'atteinte |
| 64911, 64937, 64976 | `DButton::track`, `IconI::select`, `Cat::track` | oui, à chaque tour | `FrameOut` |
| 12, 14, 64922, 64937, 64995, 64996 | boucles principales (`GKIconbar::doit`, `GKControls::doit`, `Dialog::doit`, `IconBar::doit`, `Inv::doit`, `User::handleEvent`) | oui | `FrameOut` |
| 64908 | test de vitesse | oui | `FrameOut` |

Tests : `test/gk1/engine/wait-loops.test.ts` (aide « ? » : le texte suit l'icône survolée, un clic quitte l'aide, une image par tick ; glisser du curseur de vitesse).
